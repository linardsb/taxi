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
 * The DISPATCHER path's cap (#19). Sized for a console, not for a rider — the
 * cap above was written for "a real rider re-quotes a handful of times at
 * most", and a dispatcher is not that actor.
 *
 * `derived`, from the model `address-search.policy.ts` already uses for the
 * same human, and stated with what it assumes:
 * - That policy puts a busy dispatcher at ~3 bookings/minute → 3 × 10 = **30
 *   bookings** in one 600 s window.
 * - Plan Q7's motivating case, the reason this subject moved at all, is **a
 *   venue booking 25 cars in ten minutes**.
 * - Worst case the cap must NOT refuse is the two coinciding: 30 + 25 = **55**.
 * - 60 clears that with ~9% headroom (60 ÷ 55 = 1.09).
 *
 * The window is FIXED, not sliding (`incrWithTtl` sets the TTL only when the
 * key is absent), so a cap that is merely "usually enough" locks a dispatcher
 * out for the remainder of the window mid-shift. That is why it is sized to the
 * sum rather than to the larger of the two.
 *
 * Still a guess in the same way the rider cap is — there is no traffic yet.
 * Tune against the first Google bill, the trigger `COORD_PRECISION` carries.
 */
export const DISPATCHER_BOOKING_MAX_PER_WINDOW = 60;

/**
 * A SEPARATE key, so the two caps cannot mix. One person can hold both roles in
 * a small operator, and sharing `rides:rate:<id>` would spend a dispatcher's
 * booking quota on their own rider requests.
 */
export const dispatcherBookingRateKey = (dispatcherId: string): string =>
  `rides:rate:dispatcher:${dispatcherId}`;

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
 * That ceiling IS enforced now (#94): `MAPS_ROUTE_TIMEOUT_MS` bounds every
 * route call at 3 s by default, and the env schema's `.max(30_000)` is what
 * keeps a misconfiguration from re-opening #46 by a new door — a bound in the
 * schema rather than a comment asking the next reader to remember one.
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
