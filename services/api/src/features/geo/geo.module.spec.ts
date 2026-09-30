import type { MapsProvider } from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { KV_STORE } from '../../common/kv/kv.store';
import {
  CountingMapsProvider,
  InMemoryKeyValueStore,
} from '../../../test/harness';
import { GeoModule, mapsProviderSourceFactory } from './geo.module';
import {
  MAPS_PROVIDER,
  MAPS_PROVIDER_ETA,
  MAPS_PROVIDER_SOURCE,
} from './maps.tokens';
import { StubMapsProvider } from './stub-maps.provider';

const env = (NODE_ENV: Env['NODE_ENV']) => ({ NODE_ENV }) as Env;

const CENTRE = { lat: 56.9496, lng: 24.1052 };
const RIX = { lat: 56.9236, lng: 23.9711 };

type ProviderEntry = {
  provide?: unknown;
  useClass?: unknown;
  useFactory?: (...args: unknown[]) => unknown;
  inject?: unknown[];
};

const providerFor = (token: string): ProviderEntry => {
  const providers = Reflect.getMetadata(
    'providers',
    GeoModule,
  ) as ProviderEntry[];
  return providers.find((p) => p.provide === token) ?? {};
};

/**
 * Built THROUGH the module's own factories, deliberately — hand-constructing
 * two `CachingMapsProvider`s here would assert the class's behavior and leave
 * `geo.module.ts` free to swap the arguments unnoticed, which is the exact
 * mistake these cases exist to catch.
 */
const buildFacades = () => {
  const kv = new InMemoryKeyValueStore();
  const source = new CountingMapsProvider();
  const fakeEnv = {
    MAPS_ROUTE_CACHE_TTL_SECONDS: 86_400,
    MAPS_ETA_CACHE_TTL_SECONDS: 300,
    MAPS_ETA_FAILURE_TTL_SECONDS: 60,
    MAPS_ROUTE_TIMEOUT_MS: 3_000,
    MAPS_PLACE_CACHE_TTL_SECONDS: 2_592_000,
  } as Env;
  const make = (token: string) =>
    providerFor(token).useFactory!(source, kv, fakeEnv) as MapsProvider;
  return {
    source,
    quote: make(MAPS_PROVIDER),
    eta: make(MAPS_PROVIDER_ETA),
  };
};

describe('mapsProviderSourceFactory', () => {
  it('provides the stub outside production (expected)', () => {
    expect(mapsProviderSourceFactory(env('development'))).toBeInstanceOf(
      StubMapsProvider,
    );
    expect(mapsProviderSourceFactory(env('test'))).toBeInstanceOf(
      StubMapsProvider,
    );
  });

  const PROD_BOUND = {
    NODE_ENV: 'production',
    OSRM_URL: 'http://osrm:5000',
    GOOGLE_MAPS_API_KEY: 'k',
    MAPS_ROUTE_TIMEOUT_MS: 3_000,
  } as Env;

  it('binds OSRM for routes in production and reaches it through the seam (expected — #134)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: () =>
        Promise.resolve({
          code: 'Ok',
          routes: [{ distance: 5486.2, duration: 591.1, geometry: 'abc' }],
          waypoints: [{ distance: 3 }, { distance: 4 }],
        }),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      const source = mapsProviderSourceFactory(PROD_BOUND);

      expect(source).not.toBeInstanceOf(StubMapsProvider);
      await expect(source.route(CENTRE, RIX)).resolves.toEqual({
        distanceMeters: 5486,
        durationSeconds: 591,
        polyline: 'abc',
      });
      expect((fetchMock.mock.calls as [[string]])[0][0]).toMatch(
        /^http:\/\/osrm:5000\/route\/v1\/driving\//,
      );
      // OSRM does not geocode: that half still reaches the stub, which throws.
      expect(() => source.geocode('Brīvības iela 1', 'lv')).toThrow(
        /no geocoder/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('refuses to boot in production without OSRM_URL, with no switch to relax it (failure — #134)', () => {
    // The stub prices rides off straight-line distance and returns no
    // polyline. A silent stub is worse than no boot, and since #134 nothing
    // accepts it — the message names OSRM_URL and nothing else to set.
    const noOsrm = { ...PROD_BOUND, OSRM_URL: undefined } as Env;
    expect(() => mapsProviderSourceFactory(noOsrm)).toThrow(
      /No production MapsProvider is bound.*OSRM_URL/,
    );
    expect(() => mapsProviderSourceFactory(noOsrm)).not.toThrow(
      /GOOGLE_MAPS_API_KEY/,
    );
  });

  it('a host env still carrying the retired maps switch refuses all the same (failure — AC #1)', () => {
    // Belt to `env.schema.spec.ts`'s braces: the schema strips the key, but
    // were it ever to reach the factory, the factory must not read it.
    const stale = {
      ...PROD_BOUND,
      OSRM_URL: undefined,
      [['ALLOW_STUB', 'MAPS_PROVIDER'].join('_')]: true,
    } as unknown as Env;
    expect(() => mapsProviderSourceFactory(stale)).toThrow(/OSRM_URL/);
  });

  it('the Places gap is reported on its own when routes are bound (failure)', () => {
    const noKey = { ...PROD_BOUND, GOOGLE_MAPS_API_KEY: undefined } as Env;
    expect(() => mapsProviderSourceFactory(noKey)).toThrow(
      /GOOGLE_MAPS_API_KEY/,
    );
    expect(() => mapsProviderSourceFactory(noKey)).not.toThrow(/OSRM_URL/);
  });

  it('names both gaps in one refusal when both are open (failure)', () => {
    // The address-search gap is reported alongside the routes gap rather than
    // after it: a deploy that fixes routes must not then discover the typeahead
    // 500s from Dina's first keystroke.
    expect(() => mapsProviderSourceFactory(env('production'))).toThrow(
      /OSRM_URL[\s\S]*GOOGLE_MAPS_API_KEY/,
    );
  });

  it('binds OSRM outside production when a URL is given, with no Places key (edge)', () => {
    const source = mapsProviderSourceFactory({
      NODE_ENV: 'development',
      OSRM_URL: 'http://localhost:5000',
      MAPS_ROUTE_TIMEOUT_MS: 3_000,
    } as Env);

    expect(source).not.toBeInstanceOf(StubMapsProvider);
    // Address search still reaches the stub's named throw, not OSRM.
    expect(() =>
      source.searchAddress('bri', 'lv', {
        bias: { center: CENTRE, radiusMeters: 1 },
        sessionToken: 's',
      }),
    ).toThrow(/GOOGLE_MAPS_API_KEY/);
  });

  it('binds the Places provider when a key is present (edge)', () => {
    const withKey = {
      NODE_ENV: 'development',
      GOOGLE_MAPS_API_KEY: 'test-key',
      MAPS_ROUTE_TIMEOUT_MS: 3_000,
    } as Env;

    const source = mapsProviderSourceFactory(withKey);

    // Composed, not the stub: with no OSRM_URL, routes still come from
    // `StubMapsProvider` while address search reaches Google.
    expect(source).not.toBeInstanceOf(StubMapsProvider);
    expect(typeof source.searchAddress).toBe('function');
  });

  it('is what the module actually binds MAPS_PROVIDER_SOURCE to (edge)', () => {
    // Without this, the two cases above pass just as happily against a
    // `useClass: StubMapsProvider` registration — the factory would be dead
    // code and production would still boot the stub.
    const source = providerFor(MAPS_PROVIDER_SOURCE);

    expect(source.useFactory).toBe(mapsProviderSourceFactory);
    expect(source.inject).toEqual([APP_ENV]);
    expect(source.useClass).toBeUndefined();
  });
});

describe('the two cached facades', () => {
  it('both decorate the one source, on identical injections (expected)', () => {
    // A second `MAPS_PROVIDER_SOURCE` provider would split the counter the
    // integration suite reads, and its whole spend assertion would quietly
    // stop meaning anything.
    for (const token of [MAPS_PROVIDER, MAPS_PROVIDER_ETA]) {
      const facade = providerFor(token);
      expect(typeof facade.useFactory).toBe('function');
      expect(facade.inject).toEqual([MAPS_PROVIDER_SOURCE, KV_STORE, APP_ENV]);
      expect(facade.useClass).toBeUndefined();
    }
  });

  it('do not share cache entries (edge — AC #6)', async () => {
    // Namespace separation proven by OBSERVABLE behavior, not private fields:
    // identical coordinates through both facades must cost two source calls.
    // Without this leg both bindings could pass 'quote' and the TTL split
    // would be silently dead.
    const { source, quote, eta } = buildFacades();

    await quote.route(CENTRE, RIX);
    await eta.route(CENTRE, RIX);

    expect(source.routeCalls).toBe(2);
  });

  it('the quote facade does not negative-cache (edge — AC #2)', async () => {
    // THE CASE THAT GUARDS THE BOOKING PATH, and the only place the `0`
    // argument in geo.module.ts is enforced rather than merely written down.
    const { source, quote, eta } = buildFacades();

    // eta: a remembered failure, so the poll after it never reaches the source.
    // That is the point — N viewers polling an outage cost one call, not N×12.
    source.failNext();
    await expect(eta.route(CENTRE, RIX)).rejects.toThrow();
    const afterEtaFailure = source.routeCalls;
    await expect(eta.route(CENTRE, RIX)).rejects.toThrow(
      'maps_route_unavailable',
    );
    expect(source.routeCalls).toBe(afterEtaFailure);

    // quote: the same corridor, the same transient blip — and the retry MUST
    // reach the source. `PricingService` does not catch route failures, so a
    // cached failure here fails `POST /rides` for the whole TTL: one blip
    // would block that pickup→destination pair on the one path that earns
    // money.
    source.failNext();
    await expect(quote.route(CENTRE, RIX)).rejects.toThrow();
    const afterQuoteFailure = source.routeCalls;

    const route = await quote.route(CENTRE, RIX);
    expect(source.routeCalls).toBe(afterQuoteFailure + 1);
    expect(route.distanceMeters).toBeGreaterThan(0);
  });
});
