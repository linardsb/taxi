import { Logger } from '@nestjs/common';
import {
  EXPO_PUSH_ENDPOINT,
  ExpoPushProvider,
  PUSH_HTTP_TIMEOUT_MS,
} from './expo-push.provider';

const TOKEN = 'ExponentPushToken[abcdefghijklmnopqrstuv]';
const MESSAGE = { title: 'Sakta Cab', body: 'Jūs esat bezsaistē.' };

/** Captures every (url, init) and answers with one canned Response. */
function fakeFetch(body: string, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(body, { status }));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ticket = (t: Record<string, unknown>) => JSON.stringify({ data: [t] });

describe('ExpoPushProvider (#14)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => warn.mockRestore());

  it('posts one message and reads an ok ticket, with no bearer when none is configured (expected)', async () => {
    const { fetchImpl, calls } = fakeFetch(ticket({ status: 'ok' }));
    const push = new ExpoPushProvider({ fetchImpl });

    await expect(push.send(TOKEN, MESSAGE)).resolves.toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(EXPO_PUSH_ENDPOINT);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    const body = JSON.parse(calls[0]!.init.body as string) as unknown[];
    expect(body).toEqual([
      expect.objectContaining({
        to: TOKEN,
        title: MESSAGE.title,
        body: MESSAGE.body,
        channelId: 'presence',
        priority: 'high',
      }),
    ]);
  });

  it('sends the bearer header only when an access token is configured (edge)', async () => {
    const { fetchImpl, calls } = fakeFetch(ticket({ status: 'ok' }));
    const push = new ExpoPushProvider({ fetchImpl, accessToken: 'tok' });

    await push.send(TOKEN, MESSAGE);

    expect(
      (calls[0]!.init.headers as Record<string, string>).Authorization,
    ).toBe('Bearer tok');
  });

  it('maps DeviceNotRegistered to device_not_registered — the one reason that forgets the token (edge)', async () => {
    const { fetchImpl } = fakeFetch(
      ticket({ status: 'error', details: { error: 'DeviceNotRegistered' } }),
    );

    await expect(
      new ExpoPushProvider({ fetchImpl }).send(TOKEN, MESSAGE),
    ).resolves.toEqual({ ok: false, reason: 'device_not_registered' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers provider_error and never throws on a 5xx, a thrown fetch, garbage JSON or an unknown ticket error (failure)', async () => {
    const thrown = (() =>
      Promise.reject(new Error('ECONNRESET'))) as unknown as typeof fetch;
    const cases: { name: string; fetchImpl: typeof fetch; reason: string }[] = [
      {
        name: '500',
        fetchImpl: fakeFetch('', 500).fetchImpl,
        reason: 'http_500',
      },
      { name: 'thrown', fetchImpl: thrown, reason: 'network' },
      {
        name: 'garbage',
        fetchImpl: fakeFetch('not json').fetchImpl,
        reason: 'unreadable_response',
      },
      {
        name: 'wrong shape',
        fetchImpl: fakeFetch(JSON.stringify({ data: [] })).fetchImpl,
        reason: 'unreadable_response',
      },
      {
        name: 'other ticket error',
        fetchImpl: fakeFetch(
          ticket({ status: 'error', details: { error: 'MessageTooBig' } }),
        ).fetchImpl,
        reason: 'ticket_error',
      },
    ];
    for (const c of cases) {
      warn.mockClear();
      await expect(
        new ExpoPushProvider({ fetchImpl: c.fetchImpl }).send(TOKEN, MESSAGE),
      ).resolves.toEqual({ ok: false, reason: 'provider_error' });
      // A closed-enum reason, and never Expo's free text (`MessageTooBig`).
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'driver.push.request_failed',
          reason: c.reason,
        }),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('MessageTooBig');
    }
  });

  it('bounds the request: a hung Expo call is provider_error/timeout inside timeoutMs, never a stalled sweep (failure)', async () => {
    const inits: RequestInit[] = [];
    // Honours the signal like undici does: rejects with `signal.reason` on abort, never otherwise.
    const hung = ((_url: string, init: RequestInit) => {
      inits.push(init);
      return new Promise<Response>((_, reject) =>
        init.signal!.addEventListener('abort', () =>
          reject(init.signal!.reason as Error),
        ),
      );
    }) as unknown as typeof fetch;
    const push = new ExpoPushProvider({ fetchImpl: hung, timeoutMs: 20 });
    const started = Date.now();

    await expect(push.send(TOKEN, MESSAGE)).resolves.toEqual({
      ok: false,
      reason: 'provider_error',
    });

    expect(Date.now() - started).toBeLessThan(1000);
    expect(inits[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'driver.push.request_failed',
        reason: 'timeout',
      }),
    );
    expect(PUSH_HTTP_TIMEOUT_MS).toBe(5_000);
  });
});
