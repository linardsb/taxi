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
 * - No real maps provider is bound. Every quote in dev and test is
 *   straight-line distance × 1.35 at a flat 40 km/h, so the numbers are
 *   plausible and deterministic but not real. Production cannot boot until
 *   #13/#16 bind the Google Routes provider — the factory throws.
 * - `geocode`/`reverseGeocode` throw. A `RideRequest` already carries resolved
 *   `AddressPoint`s, so nothing needs them yet; address search (#16) must bind
 *   the Google implementation first.
 * - IN-FLIGHT COALESCING IS STILL ABSENT, and it is the remaining spend gap.
 *   #94 gave the seam a timeout, a negative cache (`eta` only) and a miss-path
 *   counter, but requests arriving before the first `setWithTtl` lands still
 *   all miss and all reach the source. The tracking page's throttle BOUNDS
 *   that path; nothing here closes it. Deferred to #13/#16, alongside the first
 *   real bill — against `StubMapsProvider` the true concurrency shape is
 *   unmeasurable.
 */
export { GeoModule } from './geo.module';
export {
  MAPS_PROVIDER,
  MAPS_PROVIDER_ETA,
  MAPS_PROVIDER_SOURCE,
} from './maps.tokens';
