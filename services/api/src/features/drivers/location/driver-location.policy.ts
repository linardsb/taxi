/**
 * Location policy. Constants, not env vars — these are dispatch-correctness
 * limits, not deployment knobs, and a wrong TTL silently hands offers to
 * drivers who are no longer there.
 */

/**
 * How long a recorded position stays dispatchable without a refresh.
 *
 * This is a READ-TIME FILTER, not a Redis key expiry, and it cannot be one:
 * GEO members are sorted-set members and carry no per-member TTL, so `EXPIRE`
 * would evict every driver in the city at once. `findNearby` drops anything
 * whose last ping is older than this window instead.
 */
export const DRIVER_LOCATION_TTL_SECONDS = 60;

/** Greater-Rīga pickup radius — the default catchment for a nearest-driver query. */
export const NEAREST_DEFAULT_RADIUS_METERS = 5_000;

/** How many candidates a nearest-driver query returns by default. */
export const NEAREST_DEFAULT_LIMIT = 10;
