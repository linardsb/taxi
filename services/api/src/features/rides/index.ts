/**
 * The rides slice's public API — nothing outside imports past this file.
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - THE RIDE ENDS AT `completed` *IN THIS SLICE*. `completed → settled` now
 *   exists, but it belongs to `features/payments` (#12) — it charges, posts the
 *   ledger entries that give `settled` its meaning, and moves the driver's
 *   balance. This slice still performs no payment capture, no cash netting and
 *   no balance movement, and must NOT import payments: the dependency runs
 *   `PaymentsModule → RidesModule` only, which is why the transition writer and
 *   the repository are exported below.
 * - THERE IS NO `GET /rides/:rideId`. `POST /rides/:rideId/complete` returns the
 *   settled ride, which is what a driver needs at the moment they need it. The
 *   general ride read belongs to #16/#17, which know what they want on it.
 * - `cancelled_by_system` STILL HAS NO PRODUCTION TRIGGER. The actor is
 *   supported end to end and covered by a spec. #12 was expected to be its
 *   caller via a payment pre-authorization failure, and is NOT: that ticket
 *   charges at settlement rather than pre-authorizing at booking, so the gap
 *   survives and is now unassigned. Whether to pre-authorize at request time is
 *   an open product question — it costs a provider call per booking and would
 *   let the platform refuse a ride the rider cannot pay for.
 * - NO CANCELLATION FEE, no no-show flow, no free-cancellation window. Still
 *   open after #12, which deliberately scoped itself to settling a completed
 *   ride: every one of these is a money movement with no evidenced policy, and
 *   they need one before they need code.
 * - THE CANCELLATION `reason` IS EPHEMERAL. It reaches the rider's and driver's
 *   phones on `ride:status` and is then gone: no column holds it, and the log
 *   records only `hasReason`, because the text is author-written free text and
 *   `.claude/references/logging-standard.md` forbids the address and phone
 *   number a rider will put in it. So "why was this ride cancelled" has no
 *   durable answer — only WHO, via `actorId` on the transition log.
 *   `dispatch_audit_log` is shaped for assignments and is the wrong home; a
 *   cancellation audit is its own ticket.
 * - A DRIVER STRANDED ON `in_progress` HAS NO SELF-SERVICE EXIT.
 *   `ALLOWED_TRANSITIONS.in_progress` is `['completed', 'cancelled_by_dispatcher']`,
 *   so they cannot cancel; and `setPresence` refuses BOTH `online` and
 *   `offline` while `on_ride`, so they cannot end their shift either. Their
 *   only exits are tapping Complete — settling a fare for a ride that may not
 *   have happened — or phoning a dispatcher. Deliberate: at
 *   `accepted`/`arriving`/`arrived` the driver CAN self-cancel and be released,
 *   and no sweeper timeout was invented here. The escalation is a driver-side
 *   `in_progress` cancellation with a reason — a money question that #12 did
 *   NOT answer: it settles completed rides and rules cancellation policy out of
 *   scope, so this one is still unassigned.
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
export type { BoardRide } from './board-ride';
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
/**
 * Same exception again, for a decorator rather than a service: #19's dispatcher
 * booking takes the SAME required `Idempotency-Key` header as `POST /rides`,
 * and a second copy of the decorator would be a second place that decides what
 * a missing header means. One reader of the header, one 400.
 */
export { IdempotencyKeyHeader } from './idempotency-key.decorator';
