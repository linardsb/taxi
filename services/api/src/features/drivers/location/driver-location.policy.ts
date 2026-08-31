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

/**
 * No accepted fix for this long while online → offline + nudge (#14). Equal to
 * the dispatch freshness window ON PURPOSE: the moment `findNearby` stops
 * seeing a driver is the moment the durable record says offline — one number,
 * no window in which the board says online while dispatch excludes.
 */
export const PRESENCE_DARK_AFTER_SECONDS = DRIVER_LOCATION_TTL_SECONDS;

/**
 * Sweep cadence. Worst-case mark latency = PRESENCE_DARK_AFTER_SECONDS + this
 * = 60 + 15 = 75 s after the last accepted fix (`derived`).
 */
export const PRESENCE_SWEEP_INTERVAL_MS = 15_000;

/**
 * Nudge delay after a server-initiated offline. A reconnect inside it cancels
 * the push — a bridge or a Wi-Fi handover is not a reason to buzz a phone.
 */
export const OFFLINE_NUDGE_DELAY_SECONDS = 30;

/** How many due nudges one sweep pass sends. */
export const NUDGE_BATCH_LIMIT = 50;
