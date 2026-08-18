import { Module } from '@nestjs/common';
import type { MapsProvider } from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { KV_STORE, type KeyValueStore } from '../../common/kv/kv.store';
import { AddressSearchController } from './address-search.controller';
import { CachingMapsProvider } from './caching-maps.provider';
import {
  GooglePlacesProvider,
  type PlacesProvider,
} from './google-places.provider';
import {
  MAPS_PROVIDER,
  MAPS_PROVIDER_ETA,
  MAPS_PROVIDER_SOURCE,
} from './maps.tokens';
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
    // TWO independent production gaps, reported in ONE throw. The routes gap is
    // unconditional today; the address-search gap is conditional on the key and
    // becomes the whole message when #13/#16 binds a real routes provider and
    // deletes the first clause. Naming both means the deploy that fixes routes
    // does not then discover address search from Dina's first keystroke.
    const gaps = [
      'StubMapsProvider prices rides off straight-line distance and returns no polyline',
      ...(env.GOOGLE_MAPS_API_KEY === undefined
        ? [
            'no GOOGLE_MAPS_API_KEY is set, so the address typeahead would throw on every keystroke (#19)',
          ]
        : []),
    ];
    throw new Error(
      `No production MapsProvider is bound: ${gaps.join('; ')}. Bind the Google Routes provider before running with NODE_ENV=production.`,
    );
  }

  const routes = new StubMapsProvider();
  if (env.GOOGLE_MAPS_API_KEY === undefined) return routes;
  return composePlaces(
    routes,
    new GooglePlacesProvider(
      env.GOOGLE_MAPS_API_KEY,
      // Shares the routes timeout rather than earning a knob of its own: both
      // bound a dispatcher's keystroke-to-answer latency, and a second number
      // would be one more thing to keep in step for no observed difference.
      env.MAPS_ROUTE_TIMEOUT_MS,
    ),
  );
}

/**
 * ONE `MapsProvider` from two implementations that each own part of it. Places
 * (New) is a different API from Routes with a different price list, so
 * `GooglePlacesProvider` implements two methods rather than pretending to be a
 * whole seam — and this is where the two halves become the one object
 * `MAPS_PROVIDER_SOURCE` binds.
 *
 * Explicit delegation, not a spread over `routes`: a method added to the seam
 * then fails to compile here instead of silently reaching the stub.
 */
function composePlaces(
  routes: MapsProvider,
  places: PlacesProvider,
): MapsProvider {
  return {
    geocode: (query, language) => routes.geocode(query, language),
    reverseGeocode: (location, language) =>
      routes.reverseGeocode(location, language),
    route: (from, to, stops) => routes.route(from, to, stops),
    searchAddress: (query, language, options) =>
      places.searchAddress(query, language, options),
    resolvePlace: (placeId, language, sessionToken) =>
      places.resolvePlace(placeId, language, sessionToken),
  };
}

/**
 * `MAPS_PROVIDER_SOURCE` is exported despite being an implementation detail:
 * the test harness overrides it so the integration suite exercises the REAL
 * cache against a fake source, which is the only arrangement where "cache hit
 * on a repeated route" is a meaningful assertion. Exporting it documents that
 * as sanctioned rather than a reach-through.
 *
 * No `imports`: `KvModule` is `@Global()`, so `KV_STORE` resolves without one.
 *
 * TWO cached facades decorate ONE source. That is what keeps the harness's
 * single `MAPS_PROVIDER_SOURCE` override counting every paid call across both,
 * and it is why both factories take an identical `inject` array — a second
 * source provider would split the counter and quietly defeat the integration
 * suite's whole spend assertion.
 */
@Module({
  controllers: [AddressSearchController],
  providers: [
    {
      provide: MAPS_PROVIDER_SOURCE,
      useFactory: mapsProviderSourceFactory,
      inject: [APP_ENV],
    },
    {
      provide: MAPS_PROVIDER,
      useFactory: (source: MapsProvider, kv: KeyValueStore, env: Env) =>
        new CachingMapsProvider(
          source,
          kv,
          'quote',
          env.MAPS_ROUTE_CACHE_TTL_SECONDS,
          // NEGATIVE CACHE OFF, and this `0` is the least obvious line in the
          // module. The negative cache exists to break POLL AMPLIFICATION, and
          // only the tracking page polls. Here it would buy almost nothing and
          // cost real bookings: `PricingService` does not catch route failures,
          // so a rejection fails `POST /rides`; the rider taps Book again,
          // which mints a fresh Idempotency-Key and re-enters the quote, where
          // it would meet the cached failure. One transient Routes 5xx would
          // then block that exact pickup→destination pair for the whole failure
          // TTL — strictly worse than today, on the one path that earns money.
          // Spend here is already bounded from the other end by
          // RIDE_REQUEST_MAX_PER_WINDOW = 20 per 10 min per rider. Turn this on
          // only if a real bill ever shows quote-path FAILURE spend, and then
          // with a TTL in seconds rather than a minute.
          0,
          env.MAPS_ROUTE_TIMEOUT_MS,
          env.MAPS_PLACE_CACHE_TTL_SECONDS,
        ),
      inject: [MAPS_PROVIDER_SOURCE, KV_STORE, APP_ENV],
    },
    {
      provide: MAPS_PROVIDER_ETA,
      useFactory: (source: MapsProvider, kv: KeyValueStore, env: Env) =>
        new CachingMapsProvider(
          source,
          kv,
          'eta',
          env.MAPS_ETA_CACHE_TTL_SECONDS,
          env.MAPS_ETA_FAILURE_TTL_SECONDS,
          env.MAPS_ROUTE_TIMEOUT_MS,
          env.MAPS_PLACE_CACHE_TTL_SECONDS,
        ),
      inject: [MAPS_PROVIDER_SOURCE, KV_STORE, APP_ENV],
    },
  ],
  exports: [MAPS_PROVIDER, MAPS_PROVIDER_ETA, MAPS_PROVIDER_SOURCE],
})
export class GeoModule {}
