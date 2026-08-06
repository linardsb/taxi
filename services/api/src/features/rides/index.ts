/**
 * The rides slice's public API — nothing outside imports past this file.
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - THE RIDE ENDS AT `completed`. `completed → settled` is #12's, together with
 *   the ledger entries that give it meaning: `settled` means "money movement
 *   finished" (`.claude/references/ride-state-machine.md`), and a `settled`
 *   status with no ledger rows is a status that lies. No payment capture, no
 *   cash netting, no driver balance movement here either.
 * - THERE IS NO `GET /rides/:rideId`. `POST /rides/:rideId/complete` returns the
 *   settled ride, which is what a driver needs at the moment they need it. The
 *   general ride read belongs to #16/#17, which know what they want on it.
 * - `cancelled_by_system` HAS NO PRODUCTION TRIGGER. The actor is supported end
 *   to end and covered by a spec, but the caller that will use it is #12's
 *   payment-preauth failure. No sweeper timeout was invented for it here.
 * - NO CANCELLATION FEE, no no-show flow, no free-cancellation window. There is
 *   no evidence for a policy yet, and every one of them is a money movement,
 *   i.e. #12.
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
/**
 * Same exception, one more consumer: `drivers.status = 'on_ride'` is written
 * only by the ride lifecycle, so dispatch composes `claimDriver` into its
 * accept and force-assign transactions rather than reaching into the drivers
 * slice itself. One owner for the status, one place to read how it is claimed.
 */
export { RideLifecycleService } from './lifecycle/ride-lifecycle.service';
