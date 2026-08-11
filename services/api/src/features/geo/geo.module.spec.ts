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

  it('refuses to boot in production (failure)', () => {
    // The stub prices rides off straight-line distance and returns no polyline,
    // so an internet-facing deploy before #13/#16 quotes real money off
    // geometry. Failing at boot is the point: a silent stub is worse than no
    // boot.
    expect(() => mapsProviderSourceFactory(env('production'))).toThrow(
      /No production MapsProvider is bound/,
    );
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
