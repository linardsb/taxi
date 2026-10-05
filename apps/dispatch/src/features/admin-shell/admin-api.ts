'use client';

import {
  apiErrorBodySchema,
  isMessageKey,
  type MessageKey,
} from '@taxi/shared';
import type { z } from 'zod';
import { apiUrl, loadSession } from '@/features/auth';

/**
 * The one fetch every `/admin` surface (#20) makes. Shape copied from
 * `phone-orders/booking-api.ts`'s `authedFetch`, not imported: that one is
 * slice-private, and the four existing copies stay as they are.
 *
 * Every response is PARSED through the caller's shared schema, so a contract
 * drift fails loudly instead of rendering `undefined` in an admin form.
 */

/**
 * Thrown for no session, 401 and 403. A 403 on an admin route means the
 * session is not an admin's (a dispatcher token): the caller drops it and
 * bounces to /login, as `use-assign.ts` does, rather than showing an error the
 * user cannot act on.
 */
export class AdminAuthExpiredError extends Error {
  constructor() {
    super('auth_expired');
    this.name = 'AdminAuthExpiredError';
  }
}

/** Carries the api's snake_case error code (`plate_taken`, `driver_on_ride`). */
export class AdminApiError extends Error {
  constructor(readonly code: string | undefined) {
    super(code ?? 'api_error');
    this.name = 'AdminApiError';
  }
}

async function apiErrorOf(res: Response): Promise<AdminApiError> {
  try {
    const parsed = apiErrorBodySchema.safeParse(await res.json());
    if (parsed.success) return new AdminApiError(parsed.data.message);
  } catch {
    /* a body-less error is ordinary; the generic key covers it */
  }
  return new AdminApiError(undefined);
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const session = loadSession();
  if (session === null) throw new AdminAuthExpiredError();

  const res = await fetch(`${apiUrl()}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      authorization: `Bearer ${session.accessToken}`,
    },
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403) throw new AdminAuthExpiredError();
  if (!res.ok) throw await apiErrorOf(res);
  return res;
}

/**
 * JSON in, parsed JSON out. An EMPTY BODY (a 204 from DELETE) reaches the
 * schema as `null` — pass `z.null()` for those routes — because `res.json()`
 * rejects on a zero-length body.
 */
export async function adminFetch<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  init: RequestInit = {},
): Promise<T> {
  const res = await send(path, init);
  const body = await res.text();
  return schema.parse(body === '' ? null : (JSON.parse(body) as unknown));
}

/**
 * For downloads (the trips CSV). The browser cannot attach the bearer token to
 * a plain `<a href>`, so the file is fetched and handed over as a Blob.
 */
export async function adminFetchBlob(path: string): Promise<Blob> {
  return (await send(path, {})).blob();
}

/** `admin.error.<code>` when the catalog has it, else the generic message. */
export function adminErrorKey(error: unknown): MessageKey {
  if (error instanceof AdminApiError && error.code !== undefined) {
    const key = `admin.error.${error.code}`;
    if (isMessageKey(key)) return key;
  }
  return 'admin.error.generic';
}
