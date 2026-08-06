/**
 * Ride-request policy. Constants, not env vars — this is the <€100/mo budget
 * guardrail in code.
 *
 * `CachingMapsProvider` only saves you when coordinates repeat: `COORD_PRECISION`
 * is ~11 m, so a caller varying them by more than that gets a fresh cache key,
 * hence a fresh paid Routes call, every single request. The cache bounds the
 * cost of ordinary traffic; this cap is what bounds the hostile case.
 *
 * The numbers themselves are a guess: there is no traffic yet, and a real
 * rider re-quotes a handful of times at most. Tune them when the first Google
 * bill exists — the same trigger `COORD_PRECISION` carries.
 */
export const RIDE_REQUEST_MAX_PER_WINDOW = 20;
export const RIDE_REQUEST_WINDOW_SECONDS = 600; // 10 min

export const rideRequestRateKey = (riderId: string): string =>
  `rides:rate:${riderId}`;

/**
 * A booking attempt's key outlives the attempt by a day.
 *
 * Long is safe here in a way it would NOT be for server-side dedupe: the client
 * mints a fresh uuid per attempt, so a wide window never merges two bookings the
 * rider meant to be separate — it only catches a retry. Matches the de-facto
 * standard (Stripe's is 24h), which is what a client library author will assume.
 */
export const RIDE_IDEMPOTENCY_TTL_SECONDS = 86_400; // 24 h

/**
 * Reserved, not yet resolved to a ride — see `RidesService.request`.
 *
 * Deliberately NOT a uuid: the replay path tells a marker from a ride id by
 * comparing against this value, and a uuid-shaped marker would be indexed as a
 * ride that does not exist.
 */
export const RIDE_IDEMPOTENCY_PENDING = 'pending';

/**
 * Scoped by rider, deliberately. Two riders colliding on a key must not share a
 * ride, and an unscoped key would let a guessed uuid return someone else's ride
 * id.
 */
export const rideIdempotencyKey = (riderId: string, key: string): string =>
  `rides:idem:${riderId}:${key}`;
