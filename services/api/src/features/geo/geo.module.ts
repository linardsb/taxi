import { Module } from '@nestjs/common';
import type { MapsProvider } from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { KV_STORE, type KeyValueStore } from '../../common/kv/kv.store';
import { CachingMapsProvider } from './caching-maps.provider';
import { MAPS_PROVIDER, MAPS_PROVIDER_SOURCE } from './maps.tokens';
import { StubMapsProvider } from './stub-maps.provider';

/**
 * Refuses to boot in production while the stub is the only bound provider.
 * `StubMapsProvider` prices rides off straight-line distance and returns no
 * polyline, so an internet-facing deploy that reached it would quote real money
 * off geometry. Structural rather than conventional, exactly like
 * `smsProviderFactory`: #13/#16 replace this factory with the Google Routes
 * provider, and until they do, `NODE_ENV=production` cannot start at all.
 */
export function mapsProviderSourceFactory(env: Env): MapsProvider {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'No production MapsProvider is bound: StubMapsProvider prices rides off straight-line distance and returns no polyline. Bind the Google Routes provider before running with NODE_ENV=production.',
    );
  }
  return new StubMapsProvider();
}

/**
 * `MAPS_PROVIDER_SOURCE` is exported despite being an implementation detail:
 * the test harness overrides it so the integration suite exercises the REAL
 * cache against a fake source, which is the only arrangement where "cache hit
 * on a repeated route" is a meaningful assertion. Exporting it documents that
 * as sanctioned rather than a reach-through.
 *
 * No `imports`: `KvModule` is `@Global()`, so `KV_STORE` resolves without one.
 */
@Module({
  providers: [
    {
      provide: MAPS_PROVIDER_SOURCE,
      useFactory: mapsProviderSourceFactory,
      inject: [APP_ENV],
    },
    {
      provide: MAPS_PROVIDER,
      useFactory: (source: MapsProvider, kv: KeyValueStore, env: Env) =>
        new CachingMapsProvider(source, kv, env.MAPS_ROUTE_CACHE_TTL_SECONDS),
      inject: [MAPS_PROVIDER_SOURCE, KV_STORE, APP_ENV],
    },
  ],
  exports: [MAPS_PROVIDER, MAPS_PROVIDER_SOURCE],
})
export class GeoModule {}
