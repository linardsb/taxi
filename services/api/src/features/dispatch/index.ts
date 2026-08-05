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
 * - `drivers.status` NEVER BECOMES `on_ride` — that write belongs to #11. A
 *   driver who accepts here stays `online`, so until #11 lands they remain an
 *   eligible candidate for a SECOND ride. Known and accepted, not an oversight.
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
