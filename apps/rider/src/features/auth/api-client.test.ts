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

    const parsed = await api.request('GET', '/rides/me', {
      schema: { parse: (v: unknown) => ({ seen: v }) },
    });

    expect(parsed).toEqual({ seen: { ok: 1 } });
    expect(calls[0]!.url).toBe('http://api/rides/me');
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
        message: 'place_not_found',
      }).fetchImpl,
    });
    await expect(
      api409.request('PUT', '/rides', {
        body: { status: 'online' },
      }),
    ).rejects.toMatchObject({ status: 409, code: 'place_not_found' });

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
    await expect(withToken.request('GET', '/rides/me')).rejects.toBeInstanceOf(
      ApiError,
    );
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
      noContent.request('DELETE', '/rides/status-socket'),
    ).resolves.toBeUndefined();
  });

  it('the timeout covers the body: a stalled body read is offline, not a hang (failure)', async () => {
    // Headers arrive; the body never does unless the signal aborts it. The
    // 500 ms fallback is what an UNBOUNDED read would produce — a wrong,
    // late answer instead of `offline`.
    const stalled = ((_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_, reject) => {
            init.signal!.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
            setTimeout(() => reject(new Error('hung past the budget')), 500);
          }),
      } as unknown as Response)) as unknown as typeof fetch;
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => null,
      onUnauthorized: jest.fn(),
      fetchImpl: stalled,
      timeoutMs: 20,
    });

    await expect(api.request('GET', '/rides/me')).rejects.toMatchObject({
      status: 0,
      code: 'offline',
    });
  });

  it('reads a body outside the shared error envelope as generic — an HTML 502, a message array (edge)', async () => {
    const html = createApiClient({
      baseUrl: 'http://api',
      getToken: () => null,
      onUnauthorized: jest.fn(),
      fetchImpl: (() =>
        Promise.resolve(
          new Response('<html>502</html>', { status: 502 }),
        )) as unknown as typeof fetch,
    });
    await expect(html.request('GET', '/x')).rejects.toMatchObject({
      status: 502,
      code: 'generic',
    });

    const arr = createApiClient({
      baseUrl: 'http://api',
      getToken: () => null,
      onUnauthorized: jest.fn(),
      fetchImpl: fakeFetch(400, { message: ['a', 'b'], issues: 'nope' })
        .fetchImpl,
    });
    await expect(arr.request('GET', '/x')).rejects.toMatchObject({
      status: 400,
      code: 'generic',
      issues: undefined,
    });
  });

  it('forwards a per-request header — POST /rides 400s without one (expected)', async () => {
    const { fetchImpl, calls } = fakeFetch(201, { ride: {} });
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      onUnauthorized: jest.fn(),
      fetchImpl,
    });

    await api.request('POST', '/rides', {
      body: { pickup: {} },
      headers: { 'Idempotency-Key': 'key-1' },
    });

    const sent = calls[0]!.init.headers as Record<string, string>;
    expect(sent['Idempotency-Key']).toBe('key-1');
    expect(sent['content-type']).toBe('application/json');
  });

  it('refuses to let a caller header replace the live session bearer (failure)', async () => {
    const { fetchImpl, calls } = fakeFetch(200, {});
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'real-token',
      onUnauthorized: jest.fn(),
      fetchImpl,
    });

    // A screen sending its own token would be sending one the session layer
    // knows nothing about — and would never be signed out when it died.
    await api.request('GET', '/rides/me', {
      headers: { authorization: 'Bearer smuggled' },
    });

    expect(
      (calls[0]!.init.headers as Record<string, string>).authorization,
    ).toBe('Bearer real-token');
  });
});
