/**
 * The geo slice's public API — nothing outside imports past this file.
 *
 * It owns the `MapsProvider` seam binding, as TWO cached facades over one
 * source. `PricingService` (#5) is the only injector of `MAPS_PROVIDER`, for
 * route legs; #87's tracking page injects `MAPS_PROVIDER_ETA` — that one snaps
 * its origin to a ~100 m grid first, so a 5 s poll rides the cache instead of
 * buying a route. Both reach them here rather than through the pricing barrel,
 * which would be a lie about ownership.
 *
 * The assigned-SMS ETA (`etaToPickup`) routes through NEITHER — it is still
 * haversine, being one-shot per ride rather than polled. #87's open thread,
 * and still open.
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - Routes are real only where `OSRM_URL` is set: production (always — the
 *   factory refuses to boot without it, #134) and any dev checkout running
 *   the container. Everywhere else, tests included, a quote is straight-line
 *   distance × 1.35 at a flat 40 km/h — plausible and deterministic, not real.
 * - `geocode`/`reverseGeocode` throw. A `RideRequest` already carries resolved
 *   `AddressPoint`s, so nothing needs them yet, and OSRM cannot geocode.
 *   Address SEARCH does not wait on them: #19 binds `GooglePlacesProvider`
 *   (Places API New) for `searchAddress`/`resolvePlace` — three owners
 *   (OSRM, the stub, Places) composed into one seam by
 *   `mapsProviderSourceFactory`.
 * - Predictions are never cached, by policy rather than by omission. Only a
 *   RESOLVED place id is (`place-cache.ts`), under a TTL.
 * - IN-FLIGHT COALESCING IS STILL ABSENT, and it is the remaining spend gap.
 *   #94 gave the seam a timeout, a negative cache (`eta` only) and a miss-path
 *   counter, but requests arriving before the first `setWithTtl` lands still
 *   all miss and all reach the source. The tracking page's throttle BOUNDS
 *   that path; nothing here closes it. #134 bound self-hosted OSRM, which has
 *   no per-call price, so for routes this is now load on our own box rather
 *   than spend — still open, and no longer #134's.
 */
export { GeoModule } from './geo.module';
// A contract of the slice rather than a private detail: the tracking grid's
// coarseness claim (`notifications.policy.ts:34`) depends on this number, and
// `notifications.policy.spec.ts` now checks it rather than asserting it in prose.
export { COORD_PRECISION } from './caching-maps.provider';
export {
  MAPS_PROVIDER,
  MAPS_PROVIDER_ETA,
  MAPS_PROVIDER_SOURCE,
} from './maps.tokens';
