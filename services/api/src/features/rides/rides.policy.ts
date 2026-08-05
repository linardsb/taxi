/**
 * Ride-request policy. Constants, not env vars — this is the <€100/mo budget
 * guardrail in code.
 *
 * `CachingMapsProvider` only saves you when coordinates repeat: `COORD_PRECISION`
 * is ~11 m, so a caller varying them by more than that gets a fresh cache key,
 * hence a fresh paid Routes call, every single request. The cache bounds the
 * cost of ordinary traffic; this cap is what bounds the hostile case.
 */
export const RIDE_REQUEST_MAX_PER_WINDOW = 20;
export const RIDE_REQUEST_WINDOW_SECONDS = 600; // 10 min

export const rideRequestRateKey = (riderId: string): string =>
  `rides:rate:${riderId}`;
