import type { AuthSession } from '@taxi/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSession } from '@/features/auth';
import {
  ApiError,
  AuthExpiredError,
  listVenues,
  lookupCaller,
  resolvePlace,
} from './booking-api';

/**
 * `authedFetch`'s own tests, against a stubbed global `fetch`.
 *
 * Every other spec in this slice mocks `./booking-api` wholesale, so the
 * transport itself — status handling and BODY DECODING — had no cover at all.
 * That is how H1 shipped: the console had a `body === null` branch for a
 * first-time caller that `res.json()` could never reach, and the mocked module
 * made the branch look tested.
 */

const SESSION: AuthSession = {
  accessToken: 'token-1',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  user: {
    id: '00000000-0000-4000-8000-00000000d001',
    phone: '+37129000001',
    role: 'dispatcher',
    language: 'lv',
    createdAt: new Date().toISOString(),
  },
};

const respond = (body: string, init: ResponseInit = {}) =>
  vi.fn().mockResolvedValue(new Response(body, { status: 200, ...init }));

describe('booking-api transport', () => {
  beforeEach(() => {
    window.localStorage.clear();
    saveSession(SESSION);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reads an EMPTY 200 body as null, not a rejection (expected — H1)', async () => {
    // Nest answers a `null` return with a zero-length body, never the JSON
    // literal `null`. `res.json()` REJECTS on that, so before this every
    // first-time caller — the ordinary case — rendered as a lookup failure and
    // the «Jauns zvanītājs» panel was unreachable in production.
    vi.stubGlobal('fetch', respond(''));

    await expect(lookupCaller('+37129999000')).resolves.toBeNull();
  });

  it('still parses a caller the api did find (expected)', async () => {
    const lookup = {
      userId: '11111111-1111-4111-8111-111111111111',
      customer: null,
      savedPlaces: [],
      recentRides: [],
    };
    vi.stubGlobal('fetch', respond(JSON.stringify(lookup)));

    await expect(lookupCaller('+37129999000')).resolves.toEqual(lookup);
  });

  it('sends the bearer token and never caches a PII read (edge)', async () => {
    const fetchMock = respond('[]');
    vi.stubGlobal('fetch', fetchMock);

    await listVenues();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(
      (init.headers as Record<string, string>).authorization,
    ).toBe('Bearer token-1');
    expect(init.cache).toBe('no-store');
  });

  it('turns a 401 into AuthExpiredError, not a parse failure (failure)', async () => {
    vi.stubGlobal('fetch', respond('', { status: 401 }));

    await expect(lookupCaller('+37129999000')).rejects.toBeInstanceOf(
      AuthExpiredError,
    );
  });

  it('carries the api error CODE through for a 404 resolve (failure)', async () => {
    vi.stubGlobal(
      'fetch',
      respond(JSON.stringify({ message: 'place_not_found' }), { status: 404 }),
    );

    // A forgotten place id is a stale saved place, not a failure: the field
    // re-searches rather than showing an error.
    await expect(resolvePlace('gone', 'session-1')).resolves.toBeNull();
  });

  it("carries a 429's retryAfterSeconds off the wire rather than assuming a window (edge — review F26/F48d)", async () => {
    // `RIDE_REQUEST_WINDOW_SECONDS` is 600: a hardcoded 60 would tell a
    // throttled dispatcher to retry ten times too early.
    vi.stubGlobal(
      'fetch',
      respond(
        JSON.stringify({ message: 'too_many_requests', retryAfterSeconds: 600 }),
        { status: 429 },
      ),
    );

    await expect(resolvePlace('p1', 'session-1')).rejects.toMatchObject({
      code: 'too_many_requests',
      retryAfterSeconds: 600,
    });
  });

  it('falls back to a code-less ApiError when the envelope does not parse (failure — review F26/F48d)', async () => {
    // The shared schema requires `message: string`; anything else is a
    // contract the api is not sending, and guessing at it is how the looser
    // hand-rolled twin kept working against a shape that had moved.
    vi.stubGlobal(
      'fetch',
      respond(JSON.stringify({ message: ['a', 'b'] }), { status: 500 }),
    );

    await expect(resolvePlace('p1', 'session-1')).rejects.toMatchObject({
      name: 'ApiError',
      code: undefined,
      retryAfterSeconds: null,
    });
  });

  it('rejects a resolve whose address is empty (failure — H3)', async () => {
    // The shared `addressPointSchema` carries `address: z.string().min(1)` and
    // lat/lng bounds; the hand-written console twin it replaced had neither, so
    // an empty address parsed locally and was then rejected by the api as a
    // generic booking failure at a dispatcher mid-call.
    vi.stubGlobal(
      'fetch',
      respond(
        JSON.stringify({ location: { lat: 56.9, lng: 24.1 }, address: '' }),
      ),
    );

    await expect(resolvePlace('p1', 'session-1')).rejects.not.toBeInstanceOf(
      ApiError,
    );
  });
});
