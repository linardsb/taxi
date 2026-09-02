/**
 * The cached facade the PRICING path injects (`caller: 'quote'`). Bound to a
 * `CachingMapsProvider` wrapping whatever `MAPS_PROVIDER_SOURCE` resolves to.
 *
 * Deliberately not renamed to `MAPS_PROVIDER_QUOTE` for symmetry with the ETA
 * token below: that touches `pricing.service.ts`, the harness comments and
 * `services/api/CLAUDE.md` for zero behavior change. Adding a token beats
 * renaming one.
 */
export const MAPS_PROVIDER = 'MAPS_PROVIDER';

/**
 * The TRACKING page's cached facade — its own `CachingMapsProvider` over the
 * same source, with the `eta` key namespace and the shorter
 * `MAPS_ETA_CACHE_TTL_SECONDS`.
 *
 * Separate from `MAPS_PROVIDER` because the two consumers read DIFFERENT
 * FIELDS: pricing reads `distanceMeters` (near time-invariant, 24 h is fine),
 * tracking reads `durationSeconds` (exactly what traffic moves). One shared
 * namespace would let a pricing write pin a tracking read to 24 h staleness;
 * separate namespaces make that impossible rather than unlikely.
 *
 * It is also what gives `geo.maps.route_fetched` its `caller` field without a
 * `packages/shared` contract change, and what lets the negative cache be ON
 * for `eta` and OFF for `quote` — poll amplification is the tracking page's
 * problem alone, and on the booking path a cached failure blocks real
 * bookings (reasoned in `geo.module.ts`).
 */
export const MAPS_PROVIDER_ETA = 'MAPS_PROVIDER_ETA';

/**
 * The underlying implementation the cache decorates — its own token so a test
 * can swap the provider and still exercise the cache path.
 *
 * Overriding `MAPS_PROVIDER` instead would bypass `CachingMapsProvider`
 * entirely, and the cache-hit assertion behind the <€100/mo guardrail would
 * prove nothing. #134 drops the real routing provider (`OsrmMapsProvider`) in
 * here with the caching untouched.
 */
export const MAPS_PROVIDER_SOURCE = 'MAPS_PROVIDER_SOURCE';
