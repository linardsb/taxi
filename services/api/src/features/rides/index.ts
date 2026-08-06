/**
 * The rides slice's public API — nothing outside imports past this file.
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - #11 OWNS EVERY TRANSITION FROM `accepted` ONWARD. This slice performs none
 *   itself: it exposes `RideTransitionService` as the one guarded writer, #10
 *   drives the dispatch transitions through it, and no arrive/start/complete or
 *   cancellation route exists yet.
 * - A `scheduled` ride is INERT. Nothing promotes it to `requested`; the timer
 *   is #21's. A past `scheduledFor` is rejected at the boundary precisely
 *   because nothing would ever pick it up.
 * - `vehicleCount > 1` is rejected. #22 deletes that guard and fans one order
 *   into N rides sharing an `orderId`.
 * - A REPLAY IS UNTHROTTLED. The idempotency reservation sits ABOVE the rate
 *   limit deliberately — the cap bounds paid Routes calls and a replay reaches
 *   none, so charging it would throttle exactly the rider this protects. The
 *   consequence, and there is no global throttler to catch it: a repeated key
 *   costs unbounded Postgres reads (`rides`, `ride_fare_lines`, and an uncached
 *   `platform_config` via `previewSplit`). Accepted for the pilot — it needs a
 *   valid rider JWT and buys an attacker nothing a fresh key would not. If that
 *   stops holding under load the escalation is a separate, much larger replay
 *   cap, NOT a reordering.
 * - Pickup and destination are UNBOUNDED. `latLngSchema` only checks the
 *   coordinates are valid on Earth, so a Rīga rider can book Sydney →
 *   Reykjavík and the stub will happily quote it. A service-area rejection is
 *   cheaper than, and separate from, #10's zone resolution — it just isn't
 *   this slice's.
 */
export { RidesModule } from './rides.module';
export { RidesService } from './rides.service';
/**
 * Exported ACROSS a slice boundary as a deliberate, documented exception.
 *
 * #10's dispatch engine needs two things this slice owns: reading a ride with
 * its quote, and the one guarded writer of `rides.status`. Duplicating either
 * inside `dispatch` would give the codebase two places that know how to read a
 * ride and two callers of `assertTransition` — the exact fork the state machine
 * exists to prevent. The narrower evil is this export.
 */
export { RidesRepository } from './rides.repository';
export type { AwaitingRide } from './rides.repository';
export { RideTransitionService } from './ride-transition.service';
export type { DbTx, TransitionedRide } from './ride-transition.service';
