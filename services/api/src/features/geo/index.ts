/**
 * The geo slice's public API — nothing outside imports past this file.
 *
 * It owns the `MapsProvider` seam binding. #10 injects `MAPS_PROVIDER` for
 * driver→pickup ETAs, #5 (pricing) for route legs, and #87 for the tracking
 * page's road ETA — that one snaps its origin to a ~100 m grid first, so a
 * 5 s poll rides the cache instead of buying a route. All reach it here rather
 * than through the pricing barrel, which would be a lie about ownership.
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
 */
export { GeoModule } from './geo.module';
export { MAPS_PROVIDER, MAPS_PROVIDER_SOURCE } from './maps.tokens';
