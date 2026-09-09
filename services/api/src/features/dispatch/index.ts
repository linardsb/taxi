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
 * - `driver:queue` IS EMITTED ON EVERY QUEUE MUTATION (#15): `QueueNotifier`
 *   broadcasts the whole zone's ranks after lazy enrolment and after a decline
 *   demotion, so every queued driver reads the same number Dina's grid shows.
 *   What is still NOT there follows from the first gap: no zone-entry
 *   enrolment means the first `driver:queue` a driver ever sees arrives when
 *   dispatch first ranks them for a ride, not when they park at the rank.
 * - DOUBLE-ASSIGNMENT IS CLOSED AT BOTH ENDS (#61), WITH ONE ms-WIDE SEAM
 *   ACCEPTED. Going online is gated on "no live post-acceptance ride" read from
 *   the RIDES table (`setOnlineIfEligible`), so the offline-mid-offer driver of
 *   chain A is caught where `drivers.status` lies; and `offerNext` skips
 *   candidates already holding a live card anywhere (chain B) — one card per
 *   driver, platform-wide. What remains: `accept` never re-checks the driver's
 *   ride state inside its transaction, so a force-assign committing between
 *   `offerNext`'s busy-set read and its insert — or a go-online racing an
 *   in-flight accept — can still briefly double-commit a driver. Sequential
 *   single-process sweeper makes that window milliseconds at pilot scale;
 *   `dispatch.assign.driver_not_claimed` is the tripwire — it also fires
 *   benignly on a mid-offer-disconnect accept, so read its `driverStatus`
 *   field: `offline` is that ordinary case, `on_ride` is this seam — and an
 *   accept-time guard is the full fix if the seam ever fires in the wild.
 * - ALL THREE DISPATCHER COMMANDS EXIST (#19 closed the gap #10 left). Cancel is
 *   not here: `POST /rides/:id/cancel` already accepts `dispatcher`/`admin`, so
 *   the console calls the lifecycle route rather than this slice re-wrapping it.
 *   `reassign` is a RELEASE followed by a force-assign, as two committed
 *   transactions — see `ReassignService`, and do not merge them. Force-assigning
 *   a ride a driver has already accepted still 409s (`accepted → accepted` is
 *   not a transition); reassign is the verb for that ride.
 * - THE SWEEPER POLLS rather than reacting to ride creation, once a second. It
 *   avoids a circular rides ↔ dispatch module dependency and is restart-safe;
 *   the cost is up to ~1s of added match latency and one indexed query per
 *   second forever. At ≤10 drivers that is free; at scale it becomes Postgres
 *   `LISTEN/NOTIFY` or an in-process event emitter.
 * - ETA IS `distance / average speed`, not a routed leg. Straight-line distance
 *   under-estimates on a river city with four bridges. A `MapsProvider.route`
 *   call per candidate per cascade round would be a paid Routes call straight
 *   through the <€100/mo guardrail.
 * - BALANCE ELIGIBILITY IS A DEBT LIMIT, NOT ZERO. A driver carries commission
 *   owed between settlements and every cash ride debits it (#12), so blocking
 *   at the first cent would strand a cash-only driver after one fare. The
 *   threshold is `platform_config.driver_debt_limit_cents`, carried to the
 *   strategies on `DispatchContext` and applied by `toCandidates`
 *   (`strategies/candidate-filter.ts`) — never a literal. The pilot's seed sets
 *   it to 5000 (`db/src/seed/riga.ts`, `observed`); that is seed data, not a
 *   constant, and an operator can change it without touching this slice.
 * - THE SWEEPER DOES NOT AUTO-START UNDER `NODE_ENV=test`. Specs drive `tick()`
 *   by hand, so a background pass cannot race the one a test called.
 */
export { DispatchModule } from './dispatch.module';
export { DispatchService } from './dispatch.service';
export { DispatchSweeper } from './dispatch.sweeper';
export { DISPATCH_QUEUE_STORE } from './queue/dispatch-queue.store';
export type { DispatchQueueStore } from './queue/dispatch-queue.store';
