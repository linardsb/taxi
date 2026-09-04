import { apiErrorBodySchema, type ApiIssue } from '@taxi/shared';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** One zod issue, as the api's `ZodValidationPipe` reports it — the shared contract's type. */
export type { ApiIssue };

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
  /**
   * Per-request headers, merged AFTER the client's own — `POST /rides` requires
   * an `Idempotency-Key` and a missing one is a 400, not a pass.
   *
   * An option here rather than a bespoke booking client: one place builds a
   * request, one place turns a failure into an `ApiError`, and one place signs
   * the rider out on a 401. Do not use it to set `authorization` — the bearer
   * comes from the live session, and an override would let a screen send a token
   * the session layer knows nothing about.
   */
  headers?: Record<string, string>;
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
 * JSON in, JSON out, bearer on, 8 s to answer — headers AND body: the timer
 * runs until the body is read, so a stalled body is `offline`, not a hang.
 * A thrown `ApiError` is the only failure shape screens see; a 401 with a
 * token also signs the rider out (the "expired-token re-auth" path — back
 * to the OTP screen). Error bodies are parsed through the shared envelope
 * schema; anything else is `generic`.
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
      const headers: Record<string, string> = {
        accept: 'application/json',
        ...opts.headers,
      };
      if (opts.body !== undefined) headers['content-type'] = 'application/json';
      // LAST, so a caller's `headers` cannot replace the live session's bearer.
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
        clearTimeout(timer);
        throw new ApiError(0, 'offline');
      }

      if (res.status === 204) {
        clearTimeout(timer);
        return undefined as T;
      }
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      } finally {
        clearTimeout(timer);
      }
      if (controller.signal.aborted) throw new ApiError(0, 'offline');

      if (!res.ok) {
        const body = apiErrorBodySchema.safeParse(json);
        if (res.status === 401 && token) deps.onUnauthorized();
        throw new ApiError(
          res.status,
          body.success ? body.data.message : 'generic',
          body.success ? body.data.retryAfterSeconds : undefined,
          body.success ? body.data.issues : undefined,
        );
      }
      return opts.schema ? opts.schema.parse(json) : (json as T);
    },
  };
}
