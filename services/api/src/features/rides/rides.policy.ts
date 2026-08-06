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
 * The IN-FLIGHT reservation's window, not the settled key's.
 *
 * Must comfortably exceed the worst-case first request — config read, Routes
 * call, two-table transaction. Too short and a slow first request lets a second
 * one reserve, which is #46 back again; that constraint sets the floor, and the
 * value above it is deliberately the smallest one that clears it.
 *
 * NOTHING ENFORCES THAT CEILING YET: no maps call carries a timeout, so a hang
 * past this window would reopen #46 by a new door. Unreachable today — the only
 * provider is `StubMapsProvider` — but a real Routes client needs a timeout
 * well under this value, not a longer window here.
 *
 * Short because a `pending` marker is the one state nothing can clear on its
 * own: a process death between the commit and `recordIdempotency` leaves it
 * behind, and the rider — who never got a 201, so holds no ride id — 409s on
 * every retry until it expires while a car is already on its way. That residue
 * is two minutes here instead of a day. A key that settles is promoted to
 * `RIDE_IDEMPOTENCY_TTL_SECONDS` by `recordIdempotency`, so the retry window a
 * client actually relies on is unaffected.
 */
export const RIDE_IDEMPOTENCY_PENDING_TTL_SECONDS = 120; // 2 min

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
