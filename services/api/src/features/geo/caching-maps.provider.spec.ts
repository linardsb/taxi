import { Logger } from '@nestjs/common';
import type { LatLng, MapsProvider, RouteResult } from '@taxi/shared';
import { InMemoryKeyValueStore } from '../../../test/harness';
import {
  CachingMapsProvider,
  routeCacheKey,
  routeFailureKey,
  type MapsCaller,
} from './caching-maps.provider';
import { placeCacheKey } from './place-cache';
import { StubMapsProvider } from './stub-maps.provider';

const CENTRE = { lat: 56.9496, lng: 24.1052 };
const RIX = { lat: 56.9236, lng: 23.9711 };
const TEIKA = { lat: 56.97, lng: 24.18 };

const CACHE_TTL = 3600;
const FAILURE_TTL = 60;
const TIMEOUT_MS = 5_000;
const PLACE_TTL = 2_592_000;

/** Records what a real (paid) provider would have been asked to do. */
class CountingProvider implements MapsProvider {
  routeCalls = 0;

  constructor(private readonly inner: MapsProvider = new StubMapsProvider()) {}

  route(from: LatLng, to: LatLng, stops?: LatLng[]): Promise<RouteResult> {
    this.routeCalls += 1;
    return this.inner.route(from, to, stops);
  }

  geocode = jest.fn();
  reverseGeocode = jest.fn();
  searchAddress = jest.fn();
  resolvePlace = jest.fn();
}

/** Rejects the first `times` calls, then routes normally — a transient outage. */
function failingSource(times: number): MapsProvider {
  const stub = new StubMapsProvider();
  let remaining = times;
  return {
    route(from: LatLng, to: LatLng, stops?: LatLng[]): Promise<RouteResult> {
      if (remaining > 0) {
        remaining -= 1;
        return Promise.reject(new Error('provider down'));
      }
      return stub.route(from, to, stops);
    },
    geocode: jest.fn(),
    reverseGeocode: jest.fn(),
    searchAddress: jest.fn(),
    resolvePlace: jest.fn(),
  };
}

/** Never settles — what a hung Routes call looks like from this side. */
const hangingSource: MapsProvider = {
  route: () => new Promise<RouteResult>(() => {}),
  geocode: jest.fn(),
  reverseGeocode: jest.fn(),
  searchAddress: jest.fn(),
  resolvePlace: jest.fn(),
};

/**
 * The structured payload of the first logged call carrying `event`. Takes the
 * spy's `calls` rather than the spy so one helper serves `log`, `warn` and
 * `error`, whose Nest signatures differ.
 */
function payloadFor(
  calls: unknown[][],
  event: string,
): Record<string, unknown> | undefined {
  return calls
    .map(([first]) => first)
    .find(
      (arg): arg is Record<string, unknown> =>
        typeof arg === 'object' &&
        arg !== null &&
        'event' in arg &&
        arg.event === event,
    );
}

/** Answers one fixed shape, valid or not — the write path's input under test. */
function fixedSource(result: unknown): MapsProvider {
  return {
    route: () => Promise.resolve(result as RouteResult),
    geocode: jest.fn(),
    reverseGeocode: jest.fn(),
    searchAddress: jest.fn(),
    resolvePlace: jest.fn(),
  };
}

describe('CachingMapsProvider', () => {
  const build = (
    options: {
      caller?: MapsCaller;
      failureTtlSeconds?: number;
      timeoutMs?: number;
      inner?: MapsProvider;
    } = {},
  ) => {
    const kv = new InMemoryKeyValueStore();
    // Always wrapped, so `routeCalls` counts every source reach regardless of
    // what the scripted provider underneath does.
    const source = new CountingProvider(options.inner);
    return {
      kv,
      source,
      maps: new CachingMapsProvider(
        source,
        kv,
        options.caller ?? 'quote',
        CACHE_TTL,
        options.failureTtlSeconds ?? FAILURE_TTL,
        options.timeoutMs ?? TIMEOUT_MS,
        PLACE_TTL,
      ),
    };
  };

  it('delegates the first call and writes the cache key (expected)', async () => {
    const { kv, source, maps } = build();

    const route = await maps.route(CENTRE, RIX);

    expect(source.routeCalls).toBe(1);
    expect(route.distanceMeters).toBeGreaterThan(0);
    expect(await kv.get(routeCacheKey('quote', CENTRE, RIX))).toBe(
      JSON.stringify(route),
    );
  });

  it('serves a repeated route from cache and still delegates a different one (edge)', async () => {
    // This is the <€100/mo guardrail: an uncached Routes call per request is
    // how the budget becomes a €400 bill. The different-route leg matters —
    // without it a cache key that collapses every route to one entry passes.
    const { source, maps } = build();

    const first = await maps.route(CENTRE, RIX);
    const second = await maps.route(CENTRE, RIX);

    expect(source.routeCalls).toBe(1);
    expect(second).toEqual(first);

    await maps.route(CENTRE, TEIKA);
    expect(source.routeCalls).toBe(2);
  });

  it('treats stops as part of the cache identity (edge)', async () => {
    const { source, maps } = build();

    await maps.route(CENTRE, RIX);
    await maps.route(CENTRE, RIX, [TEIKA]);

    expect(source.routeCalls).toBe(2);
  });

  it('drops a corrupt cache entry and re-routes rather than returning garbage (failure)', async () => {
    const { kv, source, maps } = build();
    // A cache entry is untrusted input like any other boundary — casting
    // instead of parsing would feed `NaN` cents into a fare. Rejecting it is
    // not enough on its own, though: throwing pinned the corridor to a 500
    // until the TTL expired, so the entry is dropped and re-fetched instead.
    await kv.setWithTtl(
      routeCacheKey('quote', CENTRE, RIX),
      '{"distanceMeters":"nope"}',
      60,
    );

    const route = await maps.route(CENTRE, RIX);

    expect(source.routeCalls).toBe(1);
    expect(route.distanceMeters).toBeGreaterThan(0);
    expect(await kv.get(routeCacheKey('quote', CENTRE, RIX))).toBe(
      JSON.stringify(route),
    );
  });

  it('recovers from cache bytes JSON.parse cannot read (failure)', async () => {
    const { kv, source, maps } = build();
    await kv.setWithTtl(
      routeCacheKey('quote', CENTRE, RIX),
      'not json at all',
      60,
    );

    const route = await maps.route(CENTRE, RIX);

    expect(source.routeCalls).toBe(1);
    expect(route.distanceMeters).toBeGreaterThan(0);
  });

  it('rounds a fractional provider result instead of degrading every ETA (failure — AC #7)', async () => {
    // THIS ASSERTION FLIPPED DELIBERATELY (#94). It used to demand a rejection.
    // Google documents Routes' `duration` as a fractional-seconds string
    // ("1187.400s"), so fractional is the DOCUMENTED SHAPE, not an edge case:
    // refusing it threw on every single call, was swallowed by `roadEta`'s
    // catch, and pinned every ETA on the platform to haversine permanently —
    // while the page kept answering 200 and nothing counted the warn.
    const { kv, maps } = build({
      inner: fixedSource({
        distanceMeters: 10234.5,
        durationSeconds: 1187.4,
        polyline: 'abc',
      }),
    });

    const route = await maps.route(CENTRE, RIX);

    // 10234.5 rounds UP — `Math.round` breaks ties toward +Infinity.
    expect(route).toEqual({
      distanceMeters: 10235,
      durationSeconds: 1187,
      polyline: 'abc',
    });
    expect(await kv.get(routeCacheKey('quote', CENTRE, RIX))).toBe(
      JSON.stringify(route),
    );
    // Rounded, not merely tolerated: nothing about this is a failure.
    expect(await kv.get(routeFailureKey('quote', CENTRE, RIX))).toBeNull();
  });

  it('still refuses a genuinely broken result (failure)', async () => {
    // Rounding NARROWED the write-path guard; it did not remove it. `parse()`
    // was always there for NaN, negatives, missing fields and wrong types —
    // fractional seconds were never the thing it was protecting against.
    const broken: unknown[] = [
      { distanceMeters: Number.NaN, durationSeconds: 60, polyline: 'abc' },
      { distanceMeters: -5, durationSeconds: 60, polyline: 'abc' },
      { distanceMeters: 100, durationSeconds: 60 },
    ];

    for (const result of broken) {
      const { kv, maps } = build({ inner: fixedSource(result) });

      await expect(maps.route(CENTRE, RIX)).rejects.toThrow();
      expect(await kv.get(routeCacheKey('quote', CENTRE, RIX))).toBeNull();
      // Negative-cached too: a systematically broken adapter fails identically
      // next time, and each retry costs money.
      expect(await kv.get(routeFailureKey('quote', CENTRE, RIX))).toBe(
        'contract_violation',
      );
    }
  });

  it('an outage is cached: the second call never reaches the source (edge — AC #2)', async () => {
    // The row that matters in the spend arithmetic. A throttle does NOT close
    // this: those calls come from legitimate viewers each polling within their
    // own limit, so N viewers still produce N×12 upstream calls per minute.
    const { kv, source, maps } = build({ inner: failingSource(5) });

    await expect(maps.route(CENTRE, RIX)).rejects.toThrow('provider down');
    expect(await kv.get(routeFailureKey('quote', CENTRE, RIX))).toBe(
      'source_rejected',
    );

    await expect(maps.route(CENTRE, RIX)).rejects.toThrow(
      'maps_route_unavailable',
    );
    expect(source.routeCalls).toBe(1);
  });

  it('the negative cache expires and the corridor recovers (edge — AC #2)', async () => {
    const { kv, source, maps } = build({ inner: failingSource(1) });

    await expect(maps.route(CENTRE, RIX)).rejects.toThrow('provider down');

    // ORDER IS LOAD-BEARING: this blocked call is the one that would REFRESH
    // the fail key if serving a cached failure also wrote one. `setWithTtl`
    // resets the expiry, so a 5 s poll would hold a 60 s memory open forever
    // and turn a transient blip into a permanent outage. Without this step the
    // recovery below passes with that bug present.
    await expect(maps.route(CENTRE, RIX)).rejects.toThrow(
      'maps_route_unavailable',
    );
    expect(source.routeCalls).toBe(1);

    kv.advance(FAILURE_TTL + 1);

    const route = await maps.route(CENTRE, RIX);
    expect(source.routeCalls).toBe(2);
    expect(route.distanceMeters).toBeGreaterThan(0);
  });

  it('a cached success outranks a cached failure (edge)', async () => {
    // A corridor that routed before an outage keeps serving until its OWN TTL,
    // rather than going dark with everything else.
    const { kv, source, maps } = build();
    const cached = {
      distanceMeters: 4321,
      durationSeconds: 600,
      polyline: 'xyz',
    };
    await kv.setWithTtl(
      routeCacheKey('quote', CENTRE, RIX),
      JSON.stringify(cached),
      CACHE_TTL,
    );
    await kv.setWithTtl(
      routeFailureKey('quote', CENTRE, RIX),
      'source_rejected',
      FAILURE_TTL,
    );

    expect(await maps.route(CENTRE, RIX)).toEqual(cached);
    expect(source.routeCalls).toBe(0);
  });

  it('a hung provider rejects on the timeout and is negative-cached (failure — AC #4)', async () => {
    // 20 ms, not the 3 s default: a real wait here would cost the suite three
    // seconds to assert something a millisecond can prove.
    const { kv, source, maps } = build({
      inner: hangingSource,
      timeoutMs: 20,
    });

    await expect(maps.route(CENTRE, RIX)).rejects.toThrow('maps_route_timeout');
    expect(await kv.get(routeFailureKey('quote', CENTRE, RIX))).toBe('timeout');

    // The hung first call is still running upstream and still billing — which
    // is exactly why the timeout is documented as bounding LATENCY, not spend.
    await expect(maps.route(CENTRE, RIX)).rejects.toThrow(
      'maps_route_unavailable',
    );
    expect(source.routeCalls).toBe(1);
  });

  it('quote and eta callers do not share cache entries (edge — AC #6)', async () => {
    // The TTL split is structural, not probabilistic: with one namespace a
    // 24 h pricing write could pin a tracking read to 24 h staleness.
    const kv = new InMemoryKeyValueStore();
    const source = new CountingProvider();
    const quote = new CachingMapsProvider(
      source,
      kv,
      'quote',
      CACHE_TTL,
      0,
      TIMEOUT_MS,
      PLACE_TTL,
    );
    const eta = new CachingMapsProvider(
      source,
      kv,
      'eta',
      CACHE_TTL,
      FAILURE_TTL,
      TIMEOUT_MS,
      PLACE_TTL,
    );

    await quote.route(CENTRE, RIX);
    await eta.route(CENTRE, RIX);

    expect(source.routeCalls).toBe(2);
    expect(await kv.get(routeCacheKey('quote', CENTRE, RIX))).not.toBeNull();
    expect(await kv.get(routeCacheKey('eta', CENTRE, RIX))).not.toBeNull();
  });

  it('a caller with the negative cache off retries the source instead of blocking (edge — AC #2)', async () => {
    // THE BOOKING PATH. `PricingService` does not catch route failures, so a
    // cached failure would fail `POST /rides` for the whole TTL after one
    // transient blip. This case exists so a future "simplification" that makes
    // the negative cache unconditional fails loudly here, not in production.
    const { kv, source, maps } = build({
      inner: failingSource(1),
      failureTtlSeconds: 0,
    });

    await expect(maps.route(CENTRE, RIX)).rejects.toThrow('provider down');
    expect(await kv.get(routeFailureKey('quote', CENTRE, RIX))).toBeNull();

    const route = await maps.route(CENTRE, RIX);

    expect(source.routeCalls).toBe(2);
    expect(route.distanceMeters).toBeGreaterThan(0);
  });

  it('the miss-path log carries the caller and cell but no coordinates (expected — AC #3)', async () => {
    // THE paid-call counter. Before it existed the only counter in the
    // codebase was a test fake, and #87's "poll twice, check the logs" manual
    // step could not be performed as written.
    const logged = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { maps } = build({ caller: 'eta' });

    await maps.route(CENTRE, RIX);

    const payload = logged.mock.calls
      .map(([first]) => first as unknown)
      .find(
        (arg): arg is Record<string, unknown> =>
          typeof arg === 'object' &&
          arg !== null &&
          'event' in arg &&
          arg.event === 'geo.maps.route_fetched',
      );
    expect(payload).toBeDefined();

    // The whole key set, not `objectContaining`: what matters is that no
    // coordinate ever reaches a log line (logging-standard.md:14), and only
    // pinning every key can say that.
    expect(Object.keys(payload!).sort()).toEqual([
      'at',
      'caller',
      'cell',
      'distanceMeters',
      'durationSeconds',
      'event',
    ]);
    expect(payload!.caller).toBe('eta');

    // `at` is excluded on purpose: an ISO timestamp's seconds-and-milliseconds
    // can spell "56.9" by chance roughly once every few hundred runs, and a
    // flaky coordinate assertion is worse than none.
    const withoutTimestamp = { ...payload };
    delete withoutTimestamp.at;
    expect(JSON.stringify(withoutTimestamp)).not.toMatch(/56\.9|24\.1/);

    logged.mockRestore();
  });

  it('the failure log pins the same key set and drops a provider-set error name (failure — AC #3)', async () => {
    // `error.name` is the ONE provider-controlled value that reaches a log
    // line here, and `name` is a writable own property on any `Error` — so a
    // hostile adapter is the only case that can actually test the claim
    // `services/api/CLAUDE.md` states as law. A benign `Error` would pass this
    // assertion while the field was logged raw, which is why the name below
    // carries a coordinate.
    const hostile: MapsProvider = {
      route: () => {
        const error = new Error('provider down');
        error.name = 'route 56.9,24.1 failed';
        return Promise.reject(error);
      },
      searchAddress: jest.fn(),
      resolvePlace: jest.fn(),
      geocode: jest.fn(),
      reverseGeocode: jest.fn(),
    };
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { maps } = build({ caller: 'eta', inner: hostile });

    await expect(maps.route(CENTRE, RIX)).rejects.toThrow('provider down');

    const payload = payloadFor(warned.mock.calls, 'geo.maps.route_failed');
    expect(payload).toBeDefined();

    // The whole key set, for the same reason as the miss-path case above: it
    // pins the ABSENCE of any free-text field, so a provider message could not
    // be added back without failing here.
    expect(Object.keys(payload!).sort()).toEqual([
      'at',
      'caller',
      'cell',
      'errorName',
      'event',
      'reason',
    ]);
    expect(payload!.reason).toBe('source_rejected');
    expect(payload!.errorName).toBe('unsafe_name');

    // `at` excluded on purpose — same ISO-timestamp flake as the sibling case.
    const withoutTimestamp = { ...payload };
    delete withoutTimestamp.at;
    expect(JSON.stringify(withoutTimestamp)).not.toMatch(/56\.9|24\.1/);

    warned.mockRestore();
  });

  it('a failed SUCCESS-key write still returns the route and still counts it (failure)', async () => {
    // The billed call already happened. A partial Redis fault (writes refused,
    // reads fine — OOM under `noeviction`, a READONLY replica) used to turn it
    // into a `source_rejected` throw: a false attribution, an uncounted paid
    // call, and a 60 s dark corridor on the `eta` caller from a route that
    // actually SUCCEEDED.
    const logged = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { kv, maps } = build({ caller: 'eta' });
    // Only the success key faults, so the assertion below genuinely proves the
    // fail key was never ASKED for rather than merely failing to land too.
    jest
      .spyOn(kv, 'setWithTtl')
      .mockImplementation((key: string) =>
        key.startsWith('maps:route:v1:')
          ? Promise.reject(new Error('OOM command not allowed'))
          : Promise.resolve(),
      );

    const route = await maps.route(CENTRE, RIX);

    expect(route.distanceMeters).toBeGreaterThan(0);
    expect(
      logged.mock.calls.some(
        ([first]) =>
          typeof first === 'object' &&
          first !== null &&
          (first as Record<string, unknown>).event === 'geo.maps.route_fetched',
      ),
    ).toBe(true);
    // The defect itself: no misattributed failure, and nothing negative-cached.
    expect(
      payloadFor(warned.mock.calls, 'geo.maps.route_failed'),
    ).toBeUndefined();
    expect(await kv.get(routeFailureKey('eta', CENTRE, RIX))).toBeNull();
    // Not silent: a cache that has stopped writing means every later call for
    // this corridor re-pays, which is the spend this class exists to prevent.
    expect(
      payloadFor(warned.mock.calls, 'geo.maps.cache_write_failed'),
    ).toMatchObject({
      caller: 'eta',
      kind: 'route',
    });

    logged.mockRestore();
    warned.mockRestore();
  });

  it('a failed FAIL-key write still emits route_failed and still throws the real error (failure)', async () => {
    // `geo.maps.route_failed` is the only production signal that the provider
    // is down. Writing the fail key first meant losing it exactly when it
    // mattered — and handing the caller a Redis error in place of the real one,
    // which `TrackingService.roadEta` would then log as an ETA failure with no
    // trace of the actual cause.
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { kv, maps } = build({ caller: 'eta', inner: failingSource(1) });
    jest
      .spyOn(kv, 'setWithTtl')
      .mockImplementation((key: string) =>
        key.startsWith('maps:route:fail:')
          ? Promise.reject(new Error('READONLY against a read only replica'))
          : Promise.resolve(),
      );

    await expect(maps.route(CENTRE, RIX)).rejects.toThrow('provider down');

    expect(
      payloadFor(warned.mock.calls, 'geo.maps.route_failed'),
    ).toMatchObject({
      reason: 'source_rejected',
    });
    expect(
      payloadFor(warned.mock.calls, 'geo.maps.cache_write_failed'),
    ).toMatchObject({
      kind: 'failure',
    });

    warned.mockRestore();
  });

  describe('places', () => {
    const POINT = {
      location: { lat: 56.9496, lng: 24.1052 },
      address: 'Brīvības iela 45, Rīga',
    };

    it('serves a session-free re-resolve from cache (expected)', async () => {
      const { source, maps } = build();
      source.resolvePlace.mockResolvedValue(POINT);

      // The first call opens no session (a saved-place refresh), so its write
      // is what the second one reads.
      await expect(maps.resolvePlace('p1', 'lv', null)).resolves.toEqual(POINT);
      await expect(maps.resolvePlace('p1', 'lv', null)).resolves.toEqual(POINT);

      expect(source.resolvePlace).toHaveBeenCalledTimes(1);
    });

    it('never serves a SESSION-bearing resolve from cache (expected — AC #7)', async () => {
      const { source, maps } = build();
      source.resolvePlace.mockResolvedValue(POINT);

      await maps.resolvePlace('p1', 'lv', null);
      await expect(maps.resolvePlace('p1', 'lv', 's1')).resolves.toEqual(POINT);

      // THE spend case. A hit here would abandon the session those keystrokes
      // were billed under: at 5 autocomplete requests per field that is
      // 5 × $2.83/1,000 = $14.15/1,000 instead of one $5.00/1,000 Place
      // Details call. The cache must NOT save the money here.
      expect(source.resolvePlace).toHaveBeenCalledTimes(2);
      expect(source.resolvePlace).toHaveBeenLastCalledWith('p1', 'lv', 's1');
    });

    it('never caches autocomplete predictions (edge — Places policy)', async () => {
      const { source, maps } = build();
      source.searchAddress.mockResolvedValue([
        { placeId: 'p1', primaryText: 'Brīvības iela 45', secondaryText: '' },
      ]);
      const options = {
        bias: { center: CENTRE, radiusMeters: 30_000 },
        sessionToken: 's1',
      };

      await maps.searchAddress('briv', 'lv', options);
      await maps.searchAddress('briv', 'lv', options);

      // Two identical searches MUST cost two source calls. Caching them would
      // be cheaper and would breach the policy this codebase reads literally:
      // the place ID is the exempt field, predictions are content.
      expect(source.searchAddress).toHaveBeenCalledTimes(2);
    });

    it('keeps one entry per language for the same place (edge)', async () => {
      const { source, maps } = build();
      source.resolvePlace.mockResolvedValue(POINT);

      await maps.resolvePlace('p1', 'lv', null);
      await maps.resolvePlace('p1', 'lv', null);
      await maps.resolvePlace('p1', 'ru', null);

      // `formattedAddress` comes back localized, so one shared entry would
      // serve whichever language asked first to everyone after.
      expect(source.resolvePlace).toHaveBeenCalledTimes(2);
    });

    it('does not remember a place the provider has forgotten (failure)', async () => {
      const { source, maps } = build();
      source.resolvePlace.mockResolvedValue(null);

      await expect(maps.resolvePlace('gone', 'lv', null)).resolves.toBeNull();
      await expect(maps.resolvePlace('gone', 'lv', null)).resolves.toBeNull();

      // Caching the null would keep a since-corrected place dark for 30 days.
      expect(source.resolvePlace).toHaveBeenCalledTimes(2);
    });

    it('drops a corrupt cache entry and re-resolves (failure)', async () => {
      const { kv, source, maps } = build();
      source.resolvePlace.mockResolvedValue(POINT);
      await kv.setWithTtl(
        placeCacheKey('lv', 'p1'),
        '{"location":{"lat":"north"}}',
        PLACE_TTL,
      );

      await expect(maps.resolvePlace('p1', 'lv', null)).resolves.toEqual(POINT);

      expect(source.resolvePlace).toHaveBeenCalledTimes(1);
      expect(await kv.get(placeCacheKey('lv', 'p1'))).toBe(
        JSON.stringify(POINT),
      );
    });
  });
});
