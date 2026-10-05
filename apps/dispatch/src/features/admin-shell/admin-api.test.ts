import type { AuthSession } from '@taxi/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AdminApiError,
  AdminAuthExpiredError,
  adminErrorKey,
  adminFetch,
  adminFetchBlob,
} from './admin-api';

const SESSION_KEY = 'taxi.console.session';

const session: AuthSession = {
  accessToken: 'token-admin',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: {
    id: '99999999-8888-4777-8666-555555555555',
    phone: '+37129999009',
    role: 'admin',
    language: 'lv',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
};

const reply = (status: number, body: string) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
    blob: async () => new Blob([body]),
  }) as Response;

beforeEach(() => {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('adminFetch', () => {
  it('parses a 200 through the schema, bearer + no-store (expected)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, '{"n":1}'));

    await expect(
      adminFetch('/admin/x', z.object({ n: z.number() })),
    ).resolves.toEqual({ n: 1 });

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.cache).toBe('no-store');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer token-admin' });
    // No body, so no content-type claim.
    expect(init?.headers).not.toHaveProperty('content-type');
  });

  it('sends JSON with content-type when a body is set (expected)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, '{}'));

    await adminFetch('/admin/x', z.object({}), {
      method: 'PUT',
      body: JSON.stringify({ status: 'approved' }),
    });

    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toMatchObject({
      'content-type': 'application/json',
    });
  });

  it('hands an empty 204 body to the schema as null (edge)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(204, ''));

    await expect(
      adminFetch('/admin/vehicles/v', z.null(), { method: 'DELETE' }),
    ).resolves.toBeNull();
  });

  it('throws AdminAuthExpiredError on 401 and on a dispatcher 403 (failure)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(401, '{}'));
    await expect(adminFetch('/admin/x', z.unknown())).rejects.toBeInstanceOf(
      AdminAuthExpiredError,
    );

    vi.mocked(fetch).mockResolvedValueOnce(
      reply(403, '{"message":"insufficient_role"}'),
    );
    await expect(adminFetch('/admin/x', z.unknown())).rejects.toBeInstanceOf(
      AdminAuthExpiredError,
    );
  });

  it('throws AdminAuthExpiredError without calling the api when there is no session (failure)', async () => {
    window.localStorage.clear();

    await expect(adminFetch('/admin/x', z.unknown())).rejects.toBeInstanceOf(
      AdminAuthExpiredError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('carries the api code on a 409 (failure)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      reply(409, '{"message":"plate_taken","statusCode":409}'),
    );

    const error = await adminFetch('/admin/x', z.unknown()).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AdminApiError);
    expect((error as AdminApiError).code).toBe('plate_taken');
  });

  it('degrades a body-less 500 to an undefined code (edge)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(500, ''));

    const error = await adminFetch('/admin/x', z.unknown()).catch(
      (e: unknown) => e,
    );
    expect((error as AdminApiError).code).toBeUndefined();
  });
});

describe('adminFetchBlob', () => {
  it('returns the body as a Blob (expected)', async () => {
    const file = new Blob(['a,b\r\n'], { type: 'text/csv' });
    vi.mocked(fetch).mockResolvedValueOnce({
      ...reply(200, ''),
      blob: async () => file,
    } as Response);

    await expect(adminFetchBlob('/admin/trips/export.csv')).resolves.toBe(file);
  });
});

describe('adminErrorKey', () => {
  it('maps a known code to its admin key (expected)', () => {
    expect(adminErrorKey(new AdminApiError('driver_on_ride'))).toBe(
      'admin.error.driver_on_ride',
    );
  });

  it('falls back to generic for an unknown code, a network error, or a prototype name (edge)', () => {
    expect(adminErrorKey(new AdminApiError('no_such_code'))).toBe(
      'admin.error.generic',
    );
    expect(adminErrorKey(new TypeError('Failed to fetch'))).toBe(
      'admin.error.generic',
    );
    expect(adminErrorKey(new AdminApiError(undefined))).toBe(
      'admin.error.generic',
    );
    expect(adminErrorKey(new AdminApiError('__proto__'))).toBe(
      'admin.error.generic',
    );
  });
});
