/**
 * Dispatch policy. Constants and key builders only.
 *
 * WHAT DOES NOT BELONG HERE: `offerTimeoutSeconds`, `unclaimedAlertSeconds` and
 * `defaultDispatchMode`. Those are `platform_config` COLUMNS, read per city
 * through `PlatformConfigService` — they are business knobs Dina can change
 * without a deploy, and moving them here would break the config-not-constant
 * rule the whole codebase runs on. Do not "tidy" them in.
 *
 * What is here is genuinely non-business tuning: numbers that describe how the
 * engine paces itself, not what the platform charges or promises.
 */

/**
 * Average urban driving speed used to derive an ETA from straight-line
 * distance — ~30 km/h, the usual figure for city traffic with lights.
 *
 * A RANKING APPROXIMATION, not a promise to the rider. Straight-line distance
 * under-estimates on a river city with four bridges: a driver across the
 * Daugava can look nearer than they drive. The alternative — a `MapsProvider`
 * route call per candidate per cascade round — is a paid Routes call straight
 * through the <€100/mo guardrail. Revisit if drivers report the ETA on the
 * offer card reads optimistic.
 */
export const DISPATCH_AVG_SPEED_MPS = 8.3;

/** How many nearby drivers a single dispatch round considers. */
export const CANDIDATE_LIMIT = 10;

/**
 * How many offers one ride may cascade through before the engine gives up and
 * hands it to Dina. Bounds a ride that would otherwise cycle candidates
 * forever while the rider watches nothing happen.
 */
export const MAX_OFFER_ATTEMPTS = 5;

/** How often the sweeper looks for work. */
export const SWEEP_INTERVAL_MS = 1_000;

/** How many awaiting rides one tick will try to dispatch. */
export const AWAITING_BATCH_LIMIT = 20;

/**
 * How long an unclaimed alert suppresses its own repeats.
 *
 * At one tick per second an un-deduped alert would flash Dina's board 60 times
 * a minute for a single stale order — the opposite of the S9-4 signal it exists
 * to be.
 */
export const UNCLAIMED_ALERT_DEDUPE_SECONDS = 300;

/** The per-geozone FIFO queue list ("izsaukumi rindas kārtībā", S7-2). */
export const dispatchQueueKey = (geozoneId: string) =>
  `dispatch:queue:${geozoneId}`;

/** Dedupe marker for one ride's unclaimed alert. */
export const unclaimedAlertKey = (rideId: string) =>
  `dispatch:unclaimed:${rideId}`;

/**
 * Straight-line distance → a whole number of seconds. Never negative, and never
 * fractional: `DriverCandidate.etaSeconds` and `ride_offers.eta_seconds` are
 * both integers.
 */
export const etaSecondsFor = (distanceMeters: number): number =>
  Math.max(0, Math.round(distanceMeters / DISPATCH_AVG_SPEED_MPS));
