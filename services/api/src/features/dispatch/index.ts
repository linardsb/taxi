/**
 * The dispatch slice's public API — nothing outside imports past this file.
 *
 * The matching heart: candidate selection behind the `DispatchStrategy` seam,
 * the offer cascade, the unclaimed-order alert, and Dina's force-assign.
 * Driven by a polling sweeper, because dispatch is a background process and not
 * a request handler — every piece of cascade state is a `ride_offers` row, so a
 * restart strands nothing.
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - NO ZONE-ENTRY QUEUE ENROLLMENT. Drivers are enrolled into a geozone queue
 *   LAZILY, the first time dispatch sees them in the zone, not when they drive
 *   into it. Real zone-entry enrollment means point-in-polygon on every location
 *   ping, and the ping path is forbidden from touching `DRIZZLE` (a spec boots
 *   it with a throwing Drizzle provider). Same fairness property — an
 *   already-queued driver keeps their earned position — without a polygon check
 *   on the hot path. Real enrollment needs an in-memory polygon cache and its
 *   own ticket.
 * - `driver:queue` IS NEVER EMITTED. A driver cannot see their own place in the
 *   rank; the schema is typed and unused until #14/#19 draw a queue view.
 * - THE `on_ride` CLAIM NARROWS DOUBLE-ASSIGNMENT BUT DOES NOT CLOSE IT. #11
 *   made `accept` claim the driver, so the ordinary path no longer leaves them
 *   `online` for the next tick to offer a second car. Two holes remain, both
 *   reachable: (a) a driver whose socket drops mid-offer is written `offline`
 *   by `clearPresenceOnDisconnect`, so the claim — conditional on
 *   `status = 'online'` — matches nothing, and the `driver_on_ride` guard in
 *   `setPresence` then cannot stop them going `online` again mid-ride; (b)
 *   nothing excludes a driver who already holds a pending offer on a DIFFERENT
 *   ride, so one driver can be offered and accept two. `accept` logs
 *   `dispatch.assign.driver_not_claimed` when the claim misses, so (a) is at
 *   least observable. Widening the claim's WHERE to `status <> 'on_ride'` is
 *   NOT the fix — `releaseFromRide` would then put a force-assigned offline
 *   driver `online` at completion, which is the case the guard exists for. The
 *   real fix gates `setPresence('online')` on "no active post-acceptance ride"
 *   and stops offering a second card; it belongs to this slice's offer model
 *   and is #61.
 * - NO `reassign` AND NO `cancel`. `dispatch-strategies.md` lists all three
 *   privileged dispatcher commands; #10's AC names only force-assign, and
 *   `reassign` needs a cancellation path (#11) to be coherent. Force-assigning a
 *   ride a driver has ALREADY accepted therefore 409s — `accepted → accepted` is
 *   not a transition.
 * - THE SWEEPER POLLS rather than reacting to ride creation, once a second. It
 *   avoids a circular rides ↔ dispatch module dependency and is restart-safe;
 *   the cost is up to ~1s of added match latency and one indexed query per
 *   second forever. At ≤10 drivers that is free; at scale it becomes Postgres
 *   `LISTEN/NOTIFY` or an in-process event emitter.
 * - ETA IS `distance / average speed`, not a routed leg. Straight-line distance
 *   under-estimates on a river city with four bridges. A `MapsProvider.route`
 *   call per candidate per cascade round would be a paid Routes call straight
 *   through the <€100/mo guardrail.
 * - BALANCE ELIGIBILITY IS `>= 0`. The reference says "positive-balance check",
 *   but until #12's ledger exists every driver sits at 0 and a strict `> 0`
 *   would match nobody. The real threshold is a product decision for that
 *   ticket.
 * - THE SWEEPER DOES NOT AUTO-START UNDER `NODE_ENV=test`. Specs drive `tick()`
 *   by hand, so a background pass cannot race the one a test called.
 */
export { DispatchModule } from './dispatch.module';
export { DispatchService } from './dispatch.service';
export { DispatchSweeper } from './dispatch.sweeper';
export { DISPATCH_QUEUE_STORE } from './queue/dispatch-queue.store';
export type { DispatchQueueStore } from './queue/dispatch-queue.store';
