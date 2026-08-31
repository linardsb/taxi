import { ApiError, createApiClient } from './api-client';

/** Captures every (url, init) and answers with one canned Response. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('api client', () => {
  it('sends the bearer header and parses the body through the schema (expected)', async () => {
    const { fetchImpl, calls } = fakeFetch(200, { ok: 1 });
    const onUnauthorized = jest.fn();
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      onUnauthorized,
      fetchImpl,
    });

    const parsed = await api.request('GET', '/drivers/me', {
      schema: { parse: (v: unknown) => ({ seen: v }) },
    });

    expect(parsed).toEqual({ seen: { ok: 1 } });
    expect(calls[0]!.url).toBe('http://api/drivers/me');
    expect(
      (calls[0]!.init.headers as Record<string, string>).authorization,
    ).toBe('Bearer tok');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("turns the api's 409 into an ApiError carrying the code, and a 429 into one carrying retryAfterSeconds (edge)", async () => {
    const api409 = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      onUnauthorized: jest.fn(),
      fetchImpl: fakeFetch(409, {
        statusCode: 409,
        message: 'vehicle_required',
      }).fetchImpl,
    });
    await expect(
      api409.request('PUT', '/drivers/me/status', {
        body: { status: 'online' },
      }),
    ).rejects.toMatchObject({ status: 409, code: 'vehicle_required' });

    const api429 = createApiClient({
      baseUrl: 'http://api',
      getToken: () => null,
      onUnauthorized: jest.fn(),
      fetchImpl: fakeFetch(429, {
        message: 'resend_too_soon',
        retryAfterSeconds: 42,
      }).fetchImpl,
    });
    await expect(
      api429.request('POST', '/auth/otp/request'),
    ).rejects.toMatchObject({
      status: 429,
      code: 'resend_too_soon',
      retryAfterSeconds: 42,
    });
  });

  it('signs out on a 401 to an authenticated request, but not on the OTP screen (failure — the expired-token path)', async () => {
    const onUnauthorized = jest.fn();
    const withToken = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      onUnauthorized,
      fetchImpl: fakeFetch(401, { message: 'unauthorized' }).fetchImpl,
    });
    await expect(
      withToken.request('GET', '/drivers/me'),
    ).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    // A wrong OTP code is also a 401 — with no token yet, nothing to sign out.
    const noToken = createApiClient({
      baseUrl: 'http://api',
      getToken: () => null,
      onUnauthorized,
      fetchImpl: fakeFetch(401, { message: 'invalid_or_expired_code' })
        .fetchImpl,
    });
    await expect(
      noToken.request('POST', '/auth/otp/verify'),
    ).rejects.toMatchObject({ code: 'invalid_or_expired_code' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure as offline and a 204 as undefined (edge)', async () => {
    const dead = createApiClient({
      baseUrl: 'http://api',
      getToken: () => null,
      onUnauthorized: jest.fn(),
      fetchImpl: (() =>
        Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
    });
    await expect(dead.request('GET', '/x')).rejects.toMatchObject({
      status: 0,
      code: 'offline',
    });

    const noContent = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      onUnauthorized: jest.fn(),
      fetchImpl: fakeFetch(204, undefined).fetchImpl,
    });
    await expect(
      noContent.request('DELETE', '/drivers/me/push-token'),
    ).resolves.toBeUndefined();
  });
});
