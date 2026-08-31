export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** One zod issue, as the api's `ZodValidationPipe` reports it. */
export interface ApiIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Every non-2xx (and every network failure) becomes one of these. `code` is
 * the api's snake_case message (`vehicle_required`), `'offline'` when the
 * request never got an answer, `'generic'` when the body was not ours.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
    readonly issues?: ApiIssue[],
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
  }
}

/** Anything with a zod-shaped `parse` — keeps zod itself out of this package's imports. */
export interface Parser<T> {
  parse(input: unknown): T;
}

export interface RequestOptions<T> {
  body?: unknown;
  schema?: Parser<T>;
}

export interface ApiClient {
  request<T = void>(
    method: HttpMethod,
    path: string,
    opts?: RequestOptions<T>,
  ): Promise<T>;
}

export interface ApiClientDeps {
  baseUrl: string;
  getToken: () => string | null;
  /** Fired on a 401 to a request that CARRIED a token — the session is dead. */
  onUnauthorized: () => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * JSON in, JSON out, bearer on, 8 s to answer. A thrown `ApiError` is the
 * only failure shape screens see; a 401 with a token also signs the driver
 * out (the "expired-token re-auth" path — back to the OTP screen).
 */
export function createApiClient(deps: ApiClientDeps): ApiClient {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 8_000;

  return {
    async request<T = void>(
      method: HttpMethod,
      path: string,
      opts: RequestOptions<T> = {},
    ): Promise<T> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const token = deps.getToken();
      const headers: Record<string, string> = { accept: 'application/json' };
      if (opts.body !== undefined) headers['content-type'] = 'application/json';
      if (token) headers.authorization = `Bearer ${token}`;

      let res: Response;
      try {
        res = await fetchImpl(`${deps.baseUrl}${path}`, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: controller.signal,
        });
      } catch {
        throw new ApiError(0, 'offline');
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 204) return undefined as T;
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }

      if (!res.ok) {
        const body = (json ?? {}) as Record<string, unknown>;
        const code =
          typeof body.message === 'string' ? body.message : 'generic';
        if (res.status === 401 && token) deps.onUnauthorized();
        throw new ApiError(
          res.status,
          code,
          typeof body.retryAfterSeconds === 'number'
            ? body.retryAfterSeconds
            : undefined,
          Array.isArray(body.issues) ? (body.issues as ApiIssue[]) : undefined,
        );
      }
      return opts.schema ? opts.schema.parse(json) : (json as T);
    },
  };
}
