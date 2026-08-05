# Feature: API dispatch engine — auto-match, offer cascade, geozone queue fairness, unclaimed alerts, force-assign

The following plan should be complete, but it's important that you validate documentation and codebase patterns and
task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files etc. In particular:
`@taxi/shared` is the ONLY source of cross-surface contracts, `@taxi/db` is the ONLY source of tables, the realtime
slice's `RealtimeService` is the ONLY way to emit a socket event, and **every ride status write goes through
`assertTransition()`** — this ticket introduces the first ones in the codebase.

## Feature Description

The matching heart of the platform, plus the human override that defines the product.

Four concerns in one vertical slice (`services/api/src/features/dispatch/`), with two small supporting pieces
elsewhere:

1. **Candidate selection behind the `DispatchStrategy` seam.** `auto_match` ranks by proximity; `geozone_queue`
   ranks by FIFO queue position ("izsaukumi rindas kārtībā"). Which one runs is decided per geozone
   (`geozones.queue_mode_enabled`), falling back to `platform_config.default_dispatch_mode`. The engine must
   never import a concrete strategy directly.
2. **The offer cascade.** Best candidate gets a `ride:offer` with a deadline. Accept → the ride is theirs.
   Decline or timeout → the ride returns `offered → requested` and the next candidate is tried. The driver sees
   the **full fare the rider pays** on that card — S2-5 is the entire wedge, and `assertOfferSplitConsistent`
   is what stops a stale quote from turning "€20.00 fare · you keep €17.00" into a lie.
3. **The unclaimed-order alert.** When the cascade runs out of candidates, or a ride has sat unmatched past
   `platform_config.unclaimed_alert_seconds`, Dina's board gets `dispatch:unclaimed`. This is her S9-4 trigger —
   the moment the human takes over from the algorithm.
4. **Dispatcher force-assign.** `POST /dispatch/rides/:rideId/assign` puts a specific driver on a specific ride,
   mid-cascade if need be, and writes a `dispatch_audit_log` row naming the dispatcher. An override without an
   actor is an unauditable one (S9-2).

**The load-bearing constraint is that dispatch is a background process, not a request handler.** Nobody is waiting
on an HTTP connection while a cascade runs — a cascade takes `offerTimeoutSeconds` (seeded 20) per candidate and
may try several. So the engine is driven by a **sweeper tick** that polls for work: rides awaiting dispatch,
offers past their deadline, rides past the unclaimed threshold. This is also what makes it restart-safe — every
piece of cascade state is a row in `ride_offers`, not a `setTimeout` that dies with the process.

## User Story

As a **Sakta Cab driver** (Atis)
I want to **be offered the rides I am actually closest to — or the ride my place in the airport queue has earned me —
and to see the full fare before I say yes**
So that **I can trust the platform is not quietly routing the good jobs somewhere else, the way I cannot see what
Bolt's passenger paid (S2-5).**

As **Dina, the dispatcher**
I want to **see the moment an order nobody has taken goes stale, and put a car on it myself**
So that **the caller who trusted a real person gets their taxi — which is the whole reason they phoned instead of
opening an app (S9-2, S9-4).**

As a **rider**
I want **a driver assigned in seconds without doing anything**
So that **I stop refreshing and don't open Bolt.**

## Problem Statement

After #8 and #9 the API can create a ride and can answer "who is near this point" — and the two never meet.
`services/api/src/features/rides/index.ts` says it in its own KNOWN GAPS block:

> A created ride is NEVER DISPATCHED. There is no offer, no matching, no driver selection (#10). A ride sits at
> `requested` indefinitely; that is the correct end state for this slice, not an oversight.

Concretely, everything below is wired and unused:

- **`DispatchStrategy` exists with no implementation.** `packages/shared/src/seams/dispatch-strategy.ts` defines
  the interface and `DriverCandidate`; nothing implements it.
- **`ride_offers` and `dispatch_audit_log` exist and are empty forever.** Both tables landed in #6
  (`db/src/schema/rides.ts:93`, `db/src/schema/dispatch-audit.ts:13`), indexed for reads that no code performs.
- **Five socket events have no producer**: `ride:offer`, `ride:offer_revoked`, `ride:assigned`,
  `dispatch:unclaimed`, `driver:queue`. `RT_EVENT_SCHEMAS` types them all.
- **`rideOptions` are persisted and nothing reads them** — `rides/index.ts` says so explicitly. `childSeat` and
  `femaleDriver` are the filter inputs this ticket finally consumes.
- **`DriversRepository.findMatchAttributes` was built for this caller and has none.** Its docblock:
  "The read #10 calls once per dispatch round to filter a proximity list."
- **`platform_config` carries three knobs nothing reads**: `defaultDispatchMode`, `offerTimeoutSeconds`,
  `unclaimedAlertSeconds`.
- **`geozoneId` is always null on every ride.** `rides/index.ts`: "Zone-resolution precedence (Vecrīga
  deliberately overlaps centre) is #10's problem."
- **There is no guarded status writer at all.** `RidesRepository` has exactly one method, `create()`. No code in
  the repository has ever called `assertTransition()`.

Downstream, #11 (lifecycle), #15 (driver offer UI), #18 (Dina's board), #19 (override UI), #26 (return-ride
matching) are all blocked on this.

## Solution Statement

One `dispatch` slice driven by a polling sweeper, composed from seams that already exist.

**Selection** is two `DispatchStrategy` implementations sharing one eligibility filter. `AutoMatchStrategy` calls
`DriverLocationService.findNearest()` (Redis GEO, already nearest-first) and keeps that order.
`GeozoneQueueStrategy` calls the same proximity query, then re-ranks by position in a per-geozone Redis list.
Both then filter by `DriversRepository.findMatchAttributes()` — category, child seat, female driver, status,
balance. Neither is ever imported by the engine: a `DispatchStrategyResolver` picks one from the ride's geozone.

**ETA is computed, not fetched.** `DriverLocationStore.findNearby` already returns `distanceMeters` from the
query centre; ETA is that over an average urban speed from `dispatch.policy.ts`. A per-candidate `MapsProvider.route`
call would be a paid Routes call per candidate per cascade round — straight through the `<€100/mo` guardrail.

**The cascade is rows, not timers.** An offer is a `ride_offers` row with `status='pending'` and an `expires_at`.
`DispatchSweeper.tick()` does three passes per interval:

1. `expireOverdueOffers()` — pending offers past `expires_at` → `expired`, emit `ride:offer_revoked`, ride
   `offered → requested`.
2. `dispatchAwaitingRides()` — `requested` rides with no pending offer → resolve zone, pick strategy, offer the
   best candidate not already tried.
3. `alertUnclaimed()` — rides past `unclaimedAlertSeconds` with no driver → `dispatch:unclaimed` to Dina.

`tick()` is public so tests drive it directly with no sleeping and no fake clock — an offer seeded with a past
`expires_at` is expired by Postgres's own `now()`.

**Every race is a conditional UPDATE**, following `DriversRepository.setOnlineIfHasVehicle` (`drivers.repository.ts:144`)
and the L8 rationale written out there. Accepting an offer is `UPDATE ride_offers SET status='accepted' WHERE
id=? AND driver_id=? AND status='pending'`; a ride transition is `UPDATE rides SET status=? WHERE id=? AND
status=?`. `undefined` back means someone else won — a 409, never a 500.

**Force-assign goes through the machine, not around it.** `requested → accepted` is not a legal transition
(`ALLOWED_TRANSITIONS.requested` is `["offered", "queued", ...]`), so a dispatcher override writes an offer row
with `source: 'dispatcher'` and immediately accepts it: `requested → offered → accepted`. The audit trail and the
state machine both come out intact, and #15's driver app gets the same `ride:assigned` it would from a normal accept.

## Out of Scope / Non-Goals

- **Not included: driver enrollment into geozone queues on zone entry.** The reference describes drivers joining
  "when entering the zone online", which means point-in-polygon on every location ping — and the ping path is
  forbidden from touching `DRIZZLE` (`services/api/CLAUDE.md`; `driver-location.service.spec.ts` boots it with a
  throwing Drizzle provider). This plan enrolls lazily at dispatch time instead: a candidate seen in the pickup
  zone and not yet queued is appended to the back, and an already-queued driver keeps their earned position. Same
  fairness property, no polygon check on the hot path. Record the difference in the slice's KNOWN GAPS.
- **Not included: the `driver:queue` event.** Nothing consumes it until #14/#19 draw a queue view. The event
  schema stays unused; note it as a gap.
- **Not included: any transition from `accepted` onward** — `arriving`, `arrived`, `in_progress`, `completed`,
  `settled`, and every cancellation route belong to #11. This ticket stops the instant a ride has a driver.
- **Not included: `drivers.status = 'on_ride'`.** Written only by #11 (`enums.ts` says so, and the presence route
  refuses it). A driver who accepts here stays `online`; #11 flips it. Consequence to accept knowingly: until #11
  lands, a driver with an accepted ride is still an eligible candidate for a second one.
- **Not included: dispatcher `reassign` and `cancel`.** `dispatch-strategies.md` lists all three privileged
  commands; #10's AC names only force-assign. `reassign` needs a cancellation path (#11) to be coherent.
- **Not included: the dispatch board payload itself.** `dispatch:board` is #18's; `dispatchBoardEventSchema`'s
  own docblock says "#18 owns the dispatch board's real shape and will widen this."
- **Not included: return-offer windows (#26), scheduled-ride promotion (#21), multi-taxi fan-out (#22).**
- **Not changing:** the ping hot path, `POST /rides`, the pricing seam, the auth guards, or `packages/shared` —
  **this ticket should add no new shared contract.** #2 already shipped every schema, enum, event and seam it
  needs. If you find yourself adding one, stop and re-check; the one sanctioned exception is widening the
  api-local `DriverMatchAttributes` (Task 3), which is not a shared contract.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High — the highest-concurrency slice in the codebase, and the first to write ride status.
**Primary Systems Affected**: `services/api` (new `dispatch` + new `geozones` slices; small additions to `rides`
and `drivers`), Redis (queue lists), Postgres (`ride_offers`, `dispatch_audit_log`, `rides.status/driver_id/geozone_id`)
**Dependencies**: no new packages. Everything needed is already installed (`ioredis`, `drizzle-orm`, `zod`,
`socket.io`). **Do not add `@nestjs/schedule` or BullMQ** — see NOTES.

## Related Work

**Implements**: [#10](https://github.com/linardsb/taxi/issues/10) · **Epic**: [#1](https://github.com/linardsb/taxi/issues/1)
(`docs/epics/sakta-cab.architecture.md` — dispatch strategy plugin design listed under "Skipped: decided in the
skeleton and unchanged", so `.claude/references/dispatch-strategies.md` is the inherited decision)

**Back-references**:

- `.claude/plans/shared-contracts-ride-loop.md` — every contract this ticket consumes (`DispatchStrategy`,
  `rideOfferSchema`, `rideAssignmentSchema`, the five unused events, `OFFER_STATUSES`, `ASSIGNMENT_SOURCES`).
- `.claude/plans/db-foundation-drizzle-postgis.md` — `ride_offers`, `dispatch_audit_log`, `geozones` + GIST index,
  and the Rīga seed whose RIX/autoosta zones ship `queueModeEnabled: true`.
- `.claude/plans/api-drivers-slice.md` — `DriverLocationService.findNearest()` and
  `DriversRepository.findMatchAttributes()`, both built for this caller.
- `.claude/plans/api-rides-pricing.md` — `RidesRepository.create()`, `PricingService.quote()`, and the
  platform-base-preview-vs-per-driver-split distinction this ticket finally acts on.

**Forward-references**: (none yet — #11 will supersede this plan's `RideTransitionService` ownership)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**The contracts (read first — this ticket adds none):**

- `packages/shared/src/seams/dispatch-strategy.ts` (all 30 lines) — Why: `DispatchStrategy`, `DriverCandidate`
  (note the optional `queuePosition`), `DispatchContext`. The interface you implement twice.
- `packages/shared/src/schemas/ride.ts` (lines 104–200) — Why: `rideAssignmentSchema` (and its
  dispatcher-requires-dispatcherId `.refine()`), `rideOfferSchema`, `isOfferSplitConsistent` /
  `assertOfferSplitConsistent`. The docblock on `rideCreatedSchema` (lines 250–265) explains why you MUST
  re-resolve the split per driver instead of reusing #9's preview.
- `packages/shared/src/ride-state-machine.ts` (lines 30–70) — Why: `ALLOWED_TRANSITIONS` is the authority.
  Confirm for yourself that `requested → accepted` is absent; that single fact shapes force-assign.
- `packages/shared/src/realtime-events.ts` (lines 88–160) — Why: `rideOfferEventSchema` (wire = ISO strings, domain
  = `Date` — the override comment explains what breaks otherwise), `rideOfferRevokedEventSchema`,
  `rideAssignedEventSchema`, `dispatchUnclaimedEventSchema`.
- `packages/shared/src/commission.ts` (lines 27–95) — Why: `resolveCommissionPct` + `splitFare`. Note
  `CommissionDriverInput` is structural, so a driver's `commissionPctOverride` alone satisfies it.
- `packages/shared/src/schemas/platform-config.ts` (whole file) — Why: `defaultDispatchMode`,
  `offerTimeoutSeconds`, `unclaimedAlertSeconds`. **These are the config-not-constant values** — never a literal.

**The patterns to mirror:**

- `services/api/src/features/drivers/drivers.repository.ts` (lines 133–182) — Why: `setOnlineIfHasVehicle` /
  `setOfflineIfOnline` are THE precedent for a race-safe conditional UPDATE returning `undefined`, with the L8
  rationale written out. Every optimistic write in this ticket copies this shape.
- `services/api/src/features/drivers/drivers.repository.ts` (lines 195–238) — Why: `findMatchAttributes`, the read
  you call and widen. Note the `leftJoin` null branch for a driver with no vehicle.
- `services/api/src/features/drivers/location/driver-location.store.ts` (whole file) — Why: THE port pattern for
  this repo. Token + interface + docblock explaining it is "a port, not an abstraction layer". Your
  `DispatchQueueStore` is its sibling. Note "the store holds no clock — every caller supplies the time".
- `services/api/src/features/drivers/location/driver-location.service.ts` (whole file) — Why: how a service
  composes store + realtime + `APP_ENV`, and the `findNearest` you call.
- `services/api/src/features/rides/rides.service.ts` (lines 141–170) — Why: `notifyRider` shows the
  emit-must-not-fail-the-write pattern. Dispatch emits a lot; the same rule applies.
- `services/api/src/features/rides/rides.repository.ts` (whole file) — Why: `toRide` parses rather than casts
  (jsonb round-trip turns `Date` into ISO strings), and the transaction pattern.
- `services/api/src/features/realtime/realtime.service.ts` (whole file) — Why: the ONLY way to emit. Note
  `emitToDriver`, `emitToDispatch`, `emitToRide`, `joinRideRoom`, and that `emit` parses through
  `RT_EVENT_SCHEMAS` before sending — so a `Date` where the wire wants an ISO string throws at emit time.
- `services/api/src/features/pricing/pricing.service.ts` (whole file) — Why: reads config before spending, and
  the `NO_DRIVER_YET` comment that names your job: "#10 re-resolves per driver once one is picked".
- `services/api/src/features/rides/rides.controller.ts` (whole file) — Why: controller shape —
  `@Roles(...)`, `@CurrentUser()`, `ZodValidationPipe`, identity from the JWT never the body.
- `services/api/src/features/drivers/index.ts` (whole file) — Why: the barrel convention, including the
  **KNOWN GAPS** block. Your `dispatch/index.ts` must carry one.
- `services/api/src/features/rides/index.ts` (whole file) — Why: the gaps listed there are your inbox. Delete the
  ones you close.
- `services/api/src/features/drivers/location/driver-location.store.spec.ts` +
  `redis-driver-location.store.spec.ts` — Why: THE shared-store-contract test pattern, run against both the fake
  and the real Redis impl. Copy it for the queue store; PR #36's reviewer note 2 is this lesson learned the hard way.
- `services/api/src/features/drivers/drivers.integration.spec.ts` — Why: integration-test bootstrap (real Nest app,
  supertest, seeded fixtures, JWT minting).
- `services/api/src/features/drivers/location/driver-location.policy.ts` — Why: where non-config constants live.

**The data:**

- `db/src/schema/rides.ts` (lines 92–122) — Why: `rideOffers` columns and its two indexes.
- `db/src/schema/dispatch-audit.ts` (whole file) — Why: `dispatchAuditLog`. Note `driverId` and `dispatcherId` are
  both nullable and the dispatcher-required rule is app-level (zod), not DDL.
- `db/src/schema/geo.ts` (whole file) — Why: `geozones.polygon` + `queueModeEnabled` + the GIST index.
- `db/src/postgis.ts` (whole file) — Why: "nothing in this ticket reads polygons into JS — **dispatch does zone
  lookups in SQL via ST_Contains**". That sentence was written for you.
- `db/src/seed/riga.ts` (lines 18–75) — Why: `RIGA_ZONE_IDS`, and **RIX + autoosta ship `queueModeEnabled: true`**
  while centre + old_town are `false`. That is your queue-mode fixture, already seeded. Also: "Vecrīga deliberately
  overlaps centre" — the overlap your precedence rule must resolve.

**The rules:**

- `services/api/CLAUDE.md` (whole file) — Why: the ping path must never reach `DRIZZLE`; `on_ride` is #11's;
  no rate or percentage is ever a literal; socket names only from `RT`.
- `.claude/references/dispatch-strategies.md` — Why: the inherited design. **Note the stale line** — see Open Questions.
- `.claude/references/ride-state-machine.md` and `.claude/references/realtime-events.md`
- `.claude/references/logging-standard.md` — Why: `domain.component.action_state`, and the rule that nothing
  finer than a geozone name may be logged (no coordinates, no addresses).

### New Files to Create

**`services/api/src/features/dispatch/`** — the slice

- `dispatch.module.ts` — wires the slice; imports `DriversModule`, `RidesModule`, `GeozonesModule`,
  `PlatformConfigModule`, `RealtimeModule`, `KvModule`.
- `dispatch.controller.ts` — `POST /dispatch/offers/:offerId/accept`, `/decline` (driver);
  `POST /dispatch/rides/:rideId/assign` (dispatcher/admin).
- `dispatch.service.ts` — orchestration: `offerNext`, `accept`, `decline`, `forceAssign`, `raiseUnclaimed`.
- `dispatch.repository.ts` — all `ride_offers` and `dispatch_audit_log` reads/writes.
- `dispatch.policy.ts` — non-config constants (avg speed, candidate limit, max attempts, sweep interval) + key builders.
- `dispatch.sweeper.ts` — `tick()` and its three passes; `OnModuleInit`/`OnModuleDestroy` interval.
- `offer-builder.ts` — quote + per-driver split → a `RideOffer`, with `assertOfferSplitConsistent`.
- `index.ts` — barrel + KNOWN GAPS.
- `strategies/dispatch.tokens.ts` — `DISPATCH_STRATEGY_RESOLVER`.
- `strategies/candidate-filter.ts` — shared eligibility filter + ETA derivation.
- `strategies/auto-match.strategy.ts`
- `strategies/geozone-queue.strategy.ts`
- `strategies/dispatch-strategy.resolver.ts` — geozone → mode → strategy.
- `queue/dispatch-queue.store.ts` — port + `DISPATCH_QUEUE_STORE` token.
- `queue/redis-dispatch-queue.store.ts`
- `queue/in-memory-dispatch-queue.store.ts`
- Specs: `dispatch.service.spec.ts`, `dispatch.sweeper.spec.ts`, `dispatch.integration.spec.ts`,
  `offer-builder.spec.ts`, `strategies/candidate-filter.spec.ts`, `strategies/auto-match.strategy.spec.ts`,
  `strategies/geozone-queue.strategy.spec.ts`, `strategies/dispatch-strategy.resolver.spec.ts`,
  `queue/dispatch-queue.store.spec.ts` (shared contract, both impls),
  `queue/redis-dispatch-queue.store.spec.ts`

**`services/api/src/features/geozones/`** — new small slice (the api CLAUDE.md slice menu already names it)

- `geozones.module.ts`, `geozones.repository.ts`, `geozones.service.ts`, `index.ts`, `geozones.service.spec.ts`

**`services/api/src/features/rides/`** — additions

- `ride-transition.service.ts` + `ride-transition.service.spec.ts` — the guarded status writer, exported for #10
  and #11.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [PostGIS `ST_Contains`](https://postgis.net/docs/ST_Contains.html) — Why: the zone lookup. Argument order is
  `ST_Contains(polygon, point)`; reversed silently returns false for every zone and every ride gets
  `geozoneId: null`, which quietly disables queue mode.
- [PostGIS `ST_Area`](https://postgis.net/docs/ST_Area.html) — Why: the overlap precedence tiebreak. On a
  `geography` cast it returns m²; on raw 4326 geometry it returns squared degrees. Either is fine for *ordering*
  — you only need a consistent comparison, not a real area — but pick one and say so in a comment.
- [PostGIS `ST_SetSRID` / `ST_MakePoint`](https://postgis.net/docs/ST_MakePoint.html) — Why: building the query
  point. **`ST_MakePoint(lng, lat)` — longitude first.** This is the same transposition trap #8 hit; its
  `redis-driver-location.store.spec.ts` has an ordering test precisely because a round-trip test cannot see a
  consistent swap.
- [Redis `LPOS`](https://redis.io/docs/latest/commands/lpos/) — Why: 0-based index of a driver in the queue list.
  `queueEntrySchema.position` is **1-based** ("#10's Redis list is 0-based and owns that conversion" — that
  docblock is an instruction to you).
- [Redis `RPUSH` / `LREM` / `LRANGE`](https://redis.io/docs/latest/commands/rpush/) — Why: append to back, remove
  on offline/decline, read the list. `LREM key 0 member` removes all occurrences — use count `0`, not `1`, so a
  double-enrolled driver cannot hold two positions.
- [Drizzle `sql` operator](https://orm.drizzle.team/docs/sql) — Why: raw PostGIS predicates inside a Drizzle
  `where`. `db/src/postgis.ts` and `drivers.repository.ts:153` (`exists(...)` + `sql\`1\``) are the in-repo examples.
- [NestJS lifecycle hooks](https://docs.nestjs.com/fundamentals/lifecycle-events) — Why: `OnModuleInit` /
  `OnModuleDestroy` for the sweeper interval. **`OnModuleDestroy` must `clearInterval`** or Jest hangs after the
  suite and the CI job times out rather than fails.

### Patterns to Follow

**Race-safe write — the house pattern.** From `drivers.repository.ts:144`:

```ts
const [row] = await this.db
  .update(drivers)
  .set({ status: 'online' })
  .where(and(eq(drivers.userId, userId), exists(/* precondition */)))
  .returning();
return row ? toProfile(row) : undefined;   // undefined = precondition failed → 409, not 500
```

Every optimistic write in this ticket is this shape. Never read-then-write.

**Port + fake + shared contract spec.** From `driver-location.store.ts`:

```ts
export const DRIVER_LOCATION_STORE = 'DRIVER_LOCATION_STORE';
export interface DriverLocationStore { /* narrow, 4 methods */ }
```

…with `driver-location.store.spec.ts` exporting a contract function run against BOTH implementations. Do the same
for `DispatchQueueStore`, or the queue-fairness AC silently `describe.skip`s without `REDIS_TEST_URL`.

**Emit through `RealtimeService` only, and never let an emit fail the write.** From `rides.service.ts:141`:

```ts
try {
  this.realtime.joinRideRoom(riderId, ride.id);
  this.realtime.emitToRide(ride.id, RT.rideStatus, { /* ISO strings */ });
} catch (error) {
  this.logger.warn({ event: 'ride.request.notify_failed', /* ... */ });
}
```

**Structured logging.** `domain.component.action_state`, one flat object, ISO `at`, no coordinates or addresses:

```ts
this.logger.log({
  event: 'dispatch.offer.sent',
  rideId, driverId, offerId,
  mode, etaSeconds, attempt,
  at: new Date().toISOString(),
});
```

**Config, never constants.** `offerTimeoutSeconds`, `unclaimedAlertSeconds`, `defaultDispatchMode` come from
`PlatformConfigService.forCity(env.DEFAULT_CITY_ID)`. Only genuinely non-business tuning values
(avg speed, candidate limit, sweep interval) go in `dispatch.policy.ts` — mirroring `driver-location.policy.ts`.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundations outside the slice

The three pieces `dispatch` needs to exist before it can be written. All independent of each other.

**Tasks:** guarded ride transitions in the `rides` slice · the `geozones` slice · widen `DriverMatchAttributes`.

### Phase 2: The queue store

**Independent of:** Phase 1 — nothing here touches Postgres.

**Tasks:** `DispatchQueueStore` port, Redis and in-memory implementations, and the shared contract spec run
against both.

### Phase 3: Strategies

**Depends on:** Phase 1 (needs `GeozonesService` and the widened attributes) and Phase 2 (queue strategy needs the store).

**Tasks:** eligibility filter + ETA, `AutoMatchStrategy`, `GeozoneQueueStrategy`, the resolver.

### Phase 4: The engine

**Depends on:** Phase 3.

**Tasks:** offer builder, dispatch repository, `DispatchService` (offer/accept/decline/force-assign), the sweeper.

### Phase 5: Integration

**Depends on:** Phase 4.

**Tasks:** controller, module wiring, `app.module.ts`, barrels, close the KNOWN GAPS that are now closed,
update `services/api/CLAUDE.md`.

### Phase 6: Testing & validation

**Depends on:** Phase 5.

**Tasks:** integration suite against a real Nest app, the three AC cases, edge cases, full CI-parity gate.

---

## PRE-FLIGHT (5 minutes, before Task 1)

This plan asserts a handful of facts about code it did not write. Verify them first — each one, if it has drifted,
changes a task rather than being discovered three hours in. Every command should be run from the repo root.

| # | Check | Command | Expected | If it differs |
|---|---|---|---|---|
| 1 | `requested → accepted` is illegal | `grep -A3 '  requested:' packages/shared/src/ride-state-machine.ts` | `["offered", "queued", …]` — no `accepted` | if `accepted` is now listed, force-assign no longer needs the `offered` hop; simplify Task 18 |
| 2 | Nothing reads `ride_fare_lines` | `grep -rn "rideFareLines" services/api/src` | only `rides.repository.ts` (insert side) | if a reader exists, Task 3's `findWithQuote` shrinks to reusing it |
| 3 | The three config knobs exist | `grep -n "offerTimeoutSeconds\|unclaimedAlertSeconds\|defaultDispatchMode" packages/shared/src/schemas/platform-config.ts` | all three present | if absent, they are NOT literals — they are a `platform_config` change and a `@taxi/db` migration |
| 4 | Both queue zones are seeded | `grep -n "queueModeEnabled" db/src/seed/riga.ts` | two `true` (rix, autoosta), two `false` | AC #2's fixture depends on this; if all are `false`, the test must flip one itself |
| 5 | The offer/audit tables are untouched | `psql "$DATABASE_URL" -c "select count(*) from ride_offers; select count(*) from dispatch_audit_log;"` | `0` and `0` | non-zero means someone started this; reconcile before writing |
| 6 | `DriverMatchAttributes` lacks the commission field | `grep -n "commissionPctOverride" services/api/src/features/drivers/drivers.repository.ts` | no match in the interface | if present, skip Task 6 |
| 7 | The gate is green **before** you start | `pnpm turbo run typecheck lint test build --force` | green | never start on a red gate — you will not know which failures are yours |

Also confirm the environment matches the local-ports memory: Docker Postgres reached by LAN IP (not `localhost:5432`,
which brew's Postgres shadows) and `REDIS_TEST_URL` on the port your `REDIS_PORT` uses. A queue-store contract spec
that silently skips is the failure mode this whole plan is built to avoid.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom.

### 1. CREATE `services/api/src/features/rides/ride-transition.service.ts`

- **IMPLEMENT**: **three** members, because the write and the emit must be separable — see GOTCHA.

  ```ts
  /** The columns every caller of this service needs. NOT a `Ride` — see GOTCHA. */
  export interface TransitionedRide {
    id: string; orderId: string; status: RideStatus;
    riderId: string; driverId: string | null; geozoneId: string | null; createdAt: Date;
  }

  /**
   * Drizzle's transaction handle, derived so it never drifts from `Db`.
   * VERIFIED during planning: this compiles, and a helper typed `(tx: DbTx)` accepts
   * the `tx` from `db.transaction(async (tx) => …)` with full
   * `.update().set().where().returning()` support. Do NOT reach for a
   * `PgTransaction<...>` generic — deriving from `Db` needs no type arguments and
   * cannot drift when the schema or driver changes.
   */
  type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

  class RideTransitionService {
    /** The composable half: guarded conditional UPDATE inside a caller's transaction. NO emit. */
    transitionInTx(tx: DbTx, rideId, from, to): Promise<TransitionedRide | undefined>
    /** Fire-and-forget `ride:status`, call AFTER the transaction commits. Never throws. */
    emitStatus(ride: TransitionedRide, from: RideStatus, reason?: string | null): void
    /** Convenience for single-statement callers: own transaction, then emit. */
    transition(rideId, from, to, reason?): Promise<TransitionedRide | undefined>
  }
  ```

  `transitionInTx` calls `assertTransition(from, to)` FIRST (throws `InvalidRideTransitionError` — a programming
  error, let it 500), then `UPDATE rides SET status = to WHERE id = rideId AND status = from RETURNING *`.
  `undefined` means no row matched — the caller lost the race.
- **PATTERN**: conditional UPDATE — `drivers.repository.ts:144-163`. Emit-guard — `rides.service.ts:141-170`.
  Transaction — `rides.repository.ts:70`.
- **IMPORTS**: `assertTransition`, `RT`, `type RideStatus` from `@taxi/shared`; `rides`, `type Db` from `@taxi/db`;
  `DRIZZLE`; `RealtimeService`.
- **GOTCHA**: **Do not emit inside a transaction.** A single `transition()` that updates and emits looks right and
  is wrong for Task 18's accept path: that path needs the offer accept, the status change, the `driver_id` write
  and the audit insert to commit or roll back together — and a socket event emitted mid-transaction has already
  reached the driver's phone when the rollback happens. #15 would show an accepted ride that does not exist.
  Hence the split: DB inside the transaction, emits after commit. The convenience `transition()` exists only for
  the genuinely single-statement callers (`offered → requested` on decline and expiry).
  Second: the emit needs `orderId`, which `RETURNING *` gives you — never a second read. And **return
  `TransitionedRide`, not `Ride`**: `rideSchema` requires a `quote`, which lives in `total_cents` +
  `ride_fare_lines` and is not on this row, so returning a `Ride` would force a `findWithQuote` on every
  transition for data no caller of this service uses.
- **VALIDATE**: `pnpm --filter @taxi/api exec tsc --noEmit`
- **SATISFIES**: prerequisite for AC #1, #2, #3

### 2. CREATE `services/api/src/features/rides/ride-transition.service.spec.ts`

- **IMPLEMENT**: unit spec with a fake Drizzle. Cases: (expected) `transition()` updates and emits `ride:status`
  with the right `previousStatus`; (edge) a conditional update matching no row returns `undefined` and emits
  nothing; (failure) an illegal transition throws `InvalidRideTransitionError` **before** any DB call — assert the
  fake db was never touched. **Plus the split's own guarantee**: `transitionInTx` on a successful update emits
  **nothing** (assert `RealtimeService` was never called) — that assertion is what stops a later refactor from
  quietly folding the emit back in and reintroducing the mid-transaction-emit bug.
- **PATTERN**: `services/api/src/features/drivers/vehicles.service.spec.ts`
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/rides/ride-transition.service.spec.ts`
- **SATISFIES**: AC #6 (1+1+1 on the transition writer)

### 3. UPDATE `services/api/src/features/rides/rides.repository.ts` and `rides.module.ts` and `index.ts`

- **IMPLEMENT**: three additions to `RidesRepository`.
  - `findAwaitingDispatch(limit)` — `SELECT ... FROM rides WHERE status = 'requested' AND driver_id IS NULL
    ORDER BY created_at ASC LIMIT ?`.
  - **`findWithQuote(rideId): Promise<{ ride: Ride; quote: FareQuote } | undefined>`** — reads the ride row AND
    its `ride_fare_lines`, and **reconstructs a `FareQuote`**. This does not exist today and the offer cannot be
    built without it (see GOTCHA).
  - `assignDriver(rideId, driverId): Promise<boolean>` — conditional `UPDATE rides SET driver_id = ? WHERE id = ?
    AND driver_id IS NULL`, returning whether it matched.

  Register `RideTransitionService` as a provider; export `RideTransitionService` and `RidesRepository` from the
  module and the barrel.
- **PATTERN**: `rides.repository.ts:87-110` writes the fare lines — read that to see exactly what you are
  reversing. Conditional UPDATE — `drivers.repository.ts:144-163`. Barrel — `drivers/index.ts`.
- **GOTCHA**: **Nothing in the codebase has ever read `ride_fare_lines` back.** `toRide` takes the quote as an
  argument because the write path already held it; there is no reader. Reconstruction:
  `model` ← `rides.pricing_model` (nullable — a ride with no quote is not dispatchable, return `undefined`),
  `totalCents` ← `rides.total_cents`, `currency` ← `'EUR'` (`eurCurrencySchema` is `z.literal("EUR")`),
  `breakdown` ← the `base`/`distance`/`time` lines. **`discountCents` MUST default to 0 when no row exists** —
  `rides.repository.ts:99-105` deliberately omits a zero discount line ("A zero discount line is noise in #11's
  settlement read"), so expecting a row there makes every ordinary ride fail. Finish with
  `fareQuoteSchema.parse(...)` and `assertFareQuoteConsistent(...)`: if the reassembled parts do not sum to
  `total_cents`, that is a real data bug and must fail loudly here rather than land on a driver's offer card.
  `findAwaitingDispatch` runs every sweep tick; `rides_status_idx` already covers it.
  Exporting a repository across a slice boundary is a deliberate, documented exception — write the reason in the
  barrel (dispatch needs ride reads and the transition writer; duplicating either in `dispatch` would give the
  codebase two places that know how to read a ride). See Open Questions.
- **VALIDATE**: `pnpm --filter @taxi/api exec tsc --noEmit`
- **SATISFIES**: prerequisite for AC #1

### 3b. CREATE the spec for the quote reconstructor (in `rides.repository`'s existing spec, or a new one)

- **IMPLEMENT**: integration cases against real Postgres. (expected) a ride created with a discount round-trips
  through `findWithQuote` to a `FareQuote` identical to the one `create()` was given; (edge) a ride with **no**
  discount line reconstructs with `discountCents: 0` and passes `assertFareQuoteConsistent`; (failure) a ride whose
  `pricing_model`/`total_cents` are null returns `undefined` rather than a half-built quote.
- **GOTCHA**: the round-trip case is the one that catches a wrong line-type mapping — assert the whole `FareQuote`
  object, not just `totalCents`, or a swapped `distance`/`time` mapping passes every check (both sum the same).
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/rides`
- **SATISFIES**: AC #6, prerequisite for AC #1

### 4. CREATE `services/api/src/features/geozones/` (repository, service, module, index)

- **IMPLEMENT**: `GeozonesRepository.findContaining(cityId, point: LatLng): Promise<Geozone-ish | undefined>` —
  `SELECT id, slug, queue_mode_enabled FROM geozones WHERE city_id = ? AND ST_Contains(polygon,
  ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)) ORDER BY ST_Area(polygon) ASC LIMIT 1`. `GeozonesService.resolveForPoint()`
  wraps it. Return a narrow api-local type (`ResolvedGeozone { id, slug, queueModeEnabled }`), not the shared
  `Geozone` — you do not read the polygon back into JS.
- **PATTERN**: raw SQL in Drizzle — `sql` template, as in `drivers.repository.ts:155`. Slice shape —
  `features/platform-config/`.
- **IMPORTS**: `geozones` from `@taxi/db`; `sql`, `and`, `eq` from `drizzle-orm`; `DRIZZLE`.
- **GOTCHA**: **`ST_MakePoint(lng, lat)` — longitude first.** And `ST_Contains(polygon, point)` — polygon first;
  reversed returns false for every row and silently disables queue mode everywhere. **Write the precedence rule
  in a docblock**: smallest polygon wins, because Vecrīga is deliberately nested inside centre (`db/src/seed/riga.ts:27`)
  and the more specific zone is the more useful answer for both queue mode and Dina's district stats. A point in
  no zone returns `undefined` — legal, and means "city default mode".
- **VALIDATE**: `pnpm --filter @taxi/api exec tsc --noEmit`
- **SATISFIES**: prerequisite for AC #2

### 5. CREATE `services/api/src/features/geozones/geozones.service.spec.ts`

- **IMPLEMENT**: integration spec against the real seeded DB. Cases: (expected) a point in RIX resolves to the RIX
  zone with `queueModeEnabled: true`; (edge) a point inside the Vecrīga∩centre overlap resolves to **old_town**,
  the smaller zone; (failure) a point outside every zone returns `undefined`.
  **Plus an explicit anti-transposition case**: assert that the point with lat and lng **swapped** resolves to
  `undefined`. Rīga sits at lat ≈56.9 / lng ≈24.1, so a swapped pair is a valid Earth coordinate in the Arabian
  Sea — inside no zone. That makes the swap detectable, which a same-hemisphere city would not.
- **PATTERN**: `drivers.integration.spec.ts` bootstrap. The mutation-verification discipline comes from #8 —
  `redis-driver-location.store.spec.ts` carries a dedicated ordering test for exactly this reason.
- **GOTCHA**: derive the test coordinates from `db/src/seed/riga.ts`'s actual rings — do not invent them. Verify
  the overlap point really is inside both before asserting which wins.
  **Verify the anti-transposition case by mutation, not by assumption**: temporarily swap the arguments in
  `ST_MakePoint` and confirm this spec goes red (the expected/edge cases should fail — every zone lookup returns
  `undefined`), then revert and confirm green. A round-trip test cannot see a *consistent* swap; only a fixed
  reference point can, and only if you have watched it fail. Note in the spec that this was checked.
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/geozones`
- **SATISFIES**: AC #6

### 6. UPDATE `services/api/src/features/drivers/drivers.repository.ts`

- **IMPLEMENT**: add `commissionPctOverride: number | null` to the `DriverMatchAttributes` interface and populate
  it in `findMatchAttributes` from `driver.commissionPctOverride`.
- **PATTERN**: the surrounding aggregation loop, `drivers.repository.ts:213-237`.
- **GOTCHA**: this is the whole reason the per-driver split can differ from #9's preview
  (`rideCreatedSchema` docblock: "a `commissionPctOverride` changes it, so reusing this one would show the wrong
  number on the card the whole pitch rests on"). Without this field the offer card silently shows the platform
  base for every driver and the S2-5 wedge is quietly wrong. `DriverMatchAttributes` is api-local — this is NOT a
  shared-contract change.
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/drivers`
- **SATISFIES**: prerequisite for AC #1

### 7. CREATE `services/api/src/features/dispatch/queue/dispatch-queue.store.ts`

- **IMPLEMENT**: `DISPATCH_QUEUE_STORE` token + `DispatchQueueStore` interface:
  `joinBack(geozoneId, driverId): Promise<void>` (idempotent — a driver already queued keeps their position),
  `sendToBack(geozoneId, driverId): Promise<void>`, `leave(geozoneId, driverId): Promise<void>`,
  `positions(geozoneId, driverIds): Promise<Map<string, number>>` (1-based; absent = not queued).
- **PATTERN**: `driver-location.store.ts` — token, narrow interface, docblock stating it is a port and not an
  abstraction layer, and that there is exactly one production implementation.
- **GOTCHA**: keep it four methods. Resist adding `size()`/`snapshot()` — nothing reads them until #19's zone view.
- **VALIDATE**: `pnpm --filter @taxi/api exec tsc --noEmit`
- **SATISFIES**: prerequisite for AC #2

### 8. CREATE `queue/redis-dispatch-queue.store.ts` and `queue/in-memory-dispatch-queue.store.ts`

- **IMPLEMENT**: Redis impl over a list key per zone (`dispatchQueueKey(geozoneId)` in `dispatch.policy.ts`).
  `joinBack` = `LPOS` then `RPUSH` only if absent; `sendToBack` = `LREM key 0 member` then `RPUSH`;
  `leave` = `LREM key 0 member`; `positions` = one `LRANGE key 0 -1` then index in JS. In-memory impl mirrors it
  with a `Map<string, string[]>`.
- **PATTERN**: `redis-driver-location.store.ts` for the ioredis wiring and key namespacing.
- **IMPORTS**: `Redis` from `ioredis` (already a dependency).
- **GOTCHA**: `LREM key 0 member` — count **0** removes every occurrence. Count `1` leaves a duplicate holding a
  second position, and a driver who declines twice ends up ahead of where they started. `positions` returns
  **1-based** values: `queueEntrySchema` says so, and its docblock explicitly assigns the conversion to this code.
  `joinBack` must be race-tolerant but need not be atomic — a doubly-appended driver is corrected by `LREM ... 0`
  on the next decline, and at pilot scale one dispatcher process runs the sweep.
- **VALIDATE**: `pnpm --filter @taxi/api exec tsc --noEmit`
- **SATISFIES**: prerequisite for AC #2

### 9. CREATE `queue/dispatch-queue.store.spec.ts` (shared contract) and `queue/redis-dispatch-queue.store.spec.ts`

- **IMPLEMENT**: export a contract function `describeDispatchQueueStore(name, makeStore, opts)` covering:
  (expected) three drivers joined in order report positions 1, 2, 3; (expected) `joinBack` on an already-queued
  driver does NOT move them; (edge) `sendToBack` moves a head driver to last and shifts everyone up;
  (edge) `positions` returns an empty map for a zone with no queue; (failure) `leave` on a driver who never
  joined is a no-op, not a throw. Run it against the in-memory fake unconditionally, and against the Redis impl
  under `REDIS_TEST_URL`.
  **Plus one case that mirrors Task 14's actual call sequence**, because the isolated cases above never exercise
  it: start with a partly-queued zone (2 of 4 drivers already in it), `joinBack` the other two, then re-read
  `positions` for all four — assert the result is a **total order over all four with no duplicate positions and no
  gaps**, and that the two pre-existing drivers kept their original positions.
- **PATTERN**: `driver-location.store.spec.ts` + `redis-driver-location.store.spec.ts` — including the per-`pid`
  key namespace, since Jest workers share one Redis and these keys are not namespaced.
- **GOTCHA**: **This task is the whole reason the queue-fairness AC does not silently skip in CI.** The contract
  must run against the fake with no Redis present — if the only runner is the Redis spec, a green local gate
  proves nothing about the AC's edge case. This is PR #36 reviewer note 2, repeated.
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/dispatch/queue` then again with `REDIS_TEST_URL` set
- **SATISFIES**: AC #2, AC #6

### 10. CREATE `services/api/src/features/dispatch/dispatch.policy.ts`

- **IMPLEMENT**: non-config constants and key builders only —
  `DISPATCH_AVG_SPEED_MPS` (≈8.3 m/s ≈ 30 km/h urban), `CANDIDATE_LIMIT` (10), `MAX_OFFER_ATTEMPTS` (5),
  `SWEEP_INTERVAL_MS` (1000), `AWAITING_BATCH_LIMIT` (20), `UNCLAIMED_ALERT_DEDUPE_SECONDS` (300),
  `dispatchQueueKey(geozoneId)`, `unclaimedAlertKey(rideId)`, `etaSecondsFor(distanceMeters)`.
- **PATTERN**: `location/driver-location.policy.ts`.
- **GOTCHA**: `offerTimeoutSeconds`, `unclaimedAlertSeconds`, `defaultDispatchMode` do **NOT** belong here — they
  are `platform_config` columns and putting them here breaks the config-not-constant rule. Write that in a comment
  so the next reader does not "tidy" them in. Document the average-speed number as a ranking approximation, not a
  promise to the rider — the ETA on the card is derived from it.
- **VALIDATE**: `pnpm --filter @taxi/api exec tsc --noEmit`
- **SATISFIES**: prerequisite for AC #1

### 11. CREATE `strategies/candidate-filter.ts`

- **IMPLEMENT**: `toCandidates(nearby: NearbyDriver[], attrs: DriverMatchAttributes[], request: RideRequest):
  DriverCandidate[]` — join by `driverId`, drop any driver whose attributes are missing, then filter:
  `status === 'online'`; `attrs.categories.includes(request.category)`; if `request.options.childSeat` then
  `attrs.hasChildSeat`; if `request.options.femaleDriver` then `attrs.isFemale === true`; `attrs.balanceCents >= 0`.
  Map survivors to `DriverCandidate` with `etaSeconds: etaSecondsFor(nearby.distanceMeters)`, preserving the
  nearest-first order the store returned.
- **PATTERN**: `drivers.repository.ts:213-237` aggregation style.
- **IMPORTS**: `type DriverCandidate` from `@taxi/shared`; `type NearbyDriver`, `type DriverMatchAttributes` from
  `../../drivers`; `etaSecondsFor` from `../dispatch.policy`.
- **GOTCHA**: `isFemale` is `boolean | null` — `=== true`, never truthiness, because `null` means "not stated" and
  a rider who asked for a female driver must not be matched to an unknown. `status` must be checked against
  Postgres even though Redis already excludes offline drivers: Redis presence and `drivers.status` are two stores
  and the Postgres one is the durable truth. A pure function — no DI, no I/O, so it unit-tests directly.
- **VALIDATE**: `pnpm --filter @taxi/api exec tsc --noEmit`
- **SATISFIES**: AC #1

### 12. CREATE `strategies/candidate-filter.spec.ts`

- **IMPLEMENT**: (expected) a mixed list filters to the eligible drivers in nearest-first order with correct ETAs;
  (edge) `femaleDriver: true` excludes both `isFemale: false` **and** `isFemale: null`; (edge) a nearby driver with
  no attributes row is dropped rather than crashing; (failure) `childSeat: true` with no child-seat vehicle
  anywhere yields an empty list.
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/dispatch/strategies/candidate-filter.spec.ts`
- **SATISFIES**: AC #1, AC #6

### 13. CREATE `strategies/auto-match.strategy.ts` + spec

- **IMPLEMENT**: `AutoMatchStrategy implements DispatchStrategy` with `readonly mode = 'auto_match'`.
  `findCandidates(request, ctx)` → `DriverLocationService.findNearest(request.pickup.location)` →
  `DriversRepository.findMatchAttributes(ids)` → `toCandidates(...)`. No `queuePosition`.
- **PATTERN**: `driver-location.service.ts` composition style.
- **GOTCHA**: `findNearest` already returns nearest-first — do not re-sort. Return `[]` on no nearby drivers
  before calling `findMatchAttributes` (which short-circuits on `[]` anyway, but the round trip is on the tick loop).
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/dispatch/strategies/auto-match`
- **SATISFIES**: AC #1

### 14. CREATE `strategies/geozone-queue.strategy.ts` + spec

- **IMPLEMENT**: `GeozoneQueueStrategy implements DispatchStrategy` with `readonly mode = 'geozone_queue'`. Same
  proximity + attribute pipeline as auto-match, then: if `ctx.geozoneId` is null, fall through to the proximity
  order unchanged. Otherwise `queue.positions(ctx.geozoneId, eligibleIds)`; **lazily enroll** any eligible driver
  with no position via `joinBack`, re-read positions, then sort ascending by position and set `queuePosition` on
  each candidate.
- **GOTCHA**: **This is the AC's edge case** — a queued driver at position 1 must beat a nearer driver at position
  2. Sort by `queuePosition` ONLY; distance must not be a tiebreak, or the fairness the whole feature exists for
  leaks back out. `queuePosition` is 1-based. Enrollment order for a batch of newly-seen drivers is their
  proximity order, which is arbitrary-but-stable — say so in a comment; it is the lazy-enrollment compromise from
  Non-Goals, not a fairness claim.
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/dispatch/strategies/geozone-queue`
- **SATISFIES**: **AC #2 (the queue-fairness edge case)**

### 15. CREATE `strategies/dispatch-strategy.resolver.ts` + `strategies/dispatch.tokens.ts` + spec

- **IMPLEMENT**: `DispatchStrategyResolver.forZone(zone: ResolvedGeozone | undefined, config: PlatformConfig):
  DispatchStrategy` — mode is `zone?.queueModeEnabled ? 'geozone_queue' : config.defaultDispatchMode`, then return
  the matching injected strategy.
- **GOTCHA**: `queueModeEnabled` is a non-nullable boolean, so `false` genuinely means "this zone opted out" and
  correctly falls back to the city default rather than forcing auto-match — `dispatch-strategies.md` says "Mode
  selected per geozone, falling back to the city default". The engine must reach a strategy **only** through this
  resolver; `DispatchService` importing `AutoMatchStrategy` directly is the one thing the reference forbids
  outright ("the engine must never import a concrete strategy directly").
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/dispatch/strategies/dispatch-strategy.resolver.spec.ts`
- **SATISFIES**: AC #2

### 16. CREATE `services/api/src/features/dispatch/offer-builder.ts` + spec

- **IMPLEMENT**: `buildOffer({ ride, request, quote, candidate, driverAttrs, config, offerTimeoutSeconds }):
  RideOffer` — `resolveCommissionPct({ commissionPctOverride: driverAttrs.commissionPctOverride }, config)` →
  `splitFare(quote.totalCents, resolution)` → assemble the `RideOffer` → `assertOfferSplitConsistent(offer)`.
  `sentAt = new Date()`, `expiresAt = sentAt + offerTimeoutSeconds * 1000`.
- **IMPORTS**: `resolveCommissionPct`, `splitFare`, `assertOfferSplitConsistent`, `type RideOffer` from `@taxi/shared`.
- **GOTCHA**: this is the S2-5 transparency card. `quote.totalCents` is what the **rider** pays and the driver sees
  it in full — never substitute the net. `assertOfferSplitConsistent` must be called before the row is written, per
  its own docblock ("Call at the write and emit boundaries (#10/#11)"). The quote comes from
  **`RidesRepository.findWithQuote` (Task 3)** — the ride's persisted `total_cents` + `ride_fare_lines` — and NOT
  from a fresh `PricingService.quote()`: re-quoting mid-cascade would spend a paid Routes call per offer per round
  and could change the price after the rider already agreed to it.
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/dispatch/offer-builder.spec.ts`
- **SATISFIES**: AC #1

### 17. CREATE `services/api/src/features/dispatch/dispatch.repository.ts`

- **IMPLEMENT**: all `ride_offers` / `dispatch_audit_log` access:
  `insertOffer(offer)`; `findPendingForRide(rideId)`; `findTriedDriverIds(rideId)` (any offer row, any status);
  `countAttempts(rideId)`; `findOverdue(limit)` (`status='pending' AND expires_at <= now()`);
  `acceptOffer(offerId, driverId)` → conditional `UPDATE ... SET status='accepted' WHERE id=? AND driver_id=? AND
  status='pending' AND expires_at > now() RETURNING *`; `declineOffer(offerId, driverId)` → same shape to
  `'declined'`; `expireOffer(offerId)` → to `'expired'` guarded on `status='pending'`;
  `revokePendingForRide(rideId, exceptOfferId?)` → to `'revoked'`, **`RETURNING id, driver_id`** so it hands back
  the `{ offerId, driverId }` pairs (see GOTCHA); `insertAudit(entry)`.
- **PATTERN**: conditional-UPDATE-returns-undefined — `drivers.repository.ts:144-181`.
- **GOTCHA**: every **write** method (`insertOffer`, `acceptOffer`, `declineOffer`, `expireOffer`,
  `revokePendingForRide`, `insertAudit`) must take an **optional first `tx?: DbTx` parameter** and run against
  `tx ?? this.db` — Task 18's accept path composes four of them inside one transaction, and a method that can
  only use `this.db` silently opens its own connection and commits outside the caller's transaction, which is the
  exact atomicity the rollback depends on. Reuse the `DbTx` type from Task 1 rather than redeclaring it.
  **`revokePendingForRide` MUST return the rows it revoked** (`RETURNING id, driver_id`). The
  `ride:offer_revoked` fan-out happens *after* the commit, and by then those rows are `revoked` — a
  find-the-pending-offers query returns nothing and the other drivers' offer cards never clear. The ids have to
  travel out of the transaction with the result; there is no second chance to read them.
  Use Postgres `now()` in the expiry predicates, not a JS `Date` — one clock, and it is the one the
  rows were written against. `insertAudit` must run `rideAssignmentSchema.parse()` on dispatcher-sourced entries
  first, so the "dispatcher assignments require dispatcherId" refine fires at the write boundary; the DDL does not
  enforce it (see the table docblock). The jsonb columns (`pickup`, `destination`, `quote`, `split`) store **wire
  shapes** — serialize dates to ISO before insert, per the table comment.
- **VALIDATE**: `pnpm --filter @taxi/api exec tsc --noEmit`
- **SATISFIES**: AC #1, #3, #4

### 18. CREATE `services/api/src/features/dispatch/dispatch.service.ts`

- **IMPLEMENT**: five public methods.
  - `offerNext(rideId)`: load ride → resolve zone (persist `rides.geozone_id` if null) → read config → resolve
    strategy → `findCandidates` → drop `findTriedDriverIds` → if empty, `raiseUnclaimed` and leave the ride at
    `requested` → else build offer for the head, `insertOffer`, transition `requested → offered`
    (in queue mode: `requested → queued` then `queued → offered`), emit `RT.rideOffer` to the driver room.
  - `accept(driverId, offerId)` — **one transaction, then the emits.**

    ```
    const { ride, revoked } = await db.transaction(async tx => {
      const offer = await acceptOffer(tx, offerId, driverId)  // undefined → 409 offer_not_pending
      const rideId = offer.rideId                             // ← from the ROW, not the request
      const ride = await transitionInTx(tx, rideId, 'offered', 'accepted')  // undefined → 409 ride_not_offered
      if (!await assignDriver(tx, rideId, driverId)) throw new ConflictException('ride_already_assigned')
      await insertAudit(tx, { rideId, source: mode, driverId })
      const revoked = await revokePendingForRide(tx, rideId, offerId)  // → [{ offerId, driverId }]
      return { ride, revoked }
    })
    // ── committed ──
    emitStatus(ride, 'offered'); joinRideRoom(driverId, ride.id)
    emit RT.rideAssigned → ride room
    for (const r of revoked) emit RT.rideOfferRevoked({ reason: 'taken' }) → driverRoom(r.driverId)
    ```

    **`rideId` comes from `acceptOffer`'s returned row, never from the request** — the route is
    `/offers/:offerId/accept` and carries no ride id, and taking it from anywhere else would let a driver accept
    one offer onto a different ride. Throw the `ConflictException` from **inside** the callback so the transaction
    rolls back; nothing has been emitted yet, so a 409 leaves no trace on any phone.
  - `decline(driverId, offerId)`: `declineOffer` (409 on undefined) → in queue mode `queue.sendToBack` →
    `transition('offered' → 'requested')` (the convenience form; single statement, safe to emit inline) →
    `offerNext`. **No `ride:offer_revoked` to the decliner** — `rideOfferRevokedEventSchema`'s three reasons are
    `expired | taken | cancelled`, and none of them describes "you declined this yourself": `cancelled` would read
    on #15 and Dina's board as *the rider* cancelled. The event exists to clear a card the driver did **not** act
    on; a decliner's card clears from their own HTTP response. Revocation events go only to the *other* drivers,
    from the accept path.
  - `forceAssign(dispatcherId, rideId, driverId, reason)`: same transaction shape as `accept` — insert an offer
    row with `source: 'dispatcher'` and `status: 'accepted'`, walk the ride `requested → offered → accepted` with
    two `transitionInTx` calls, `insertAudit({ source: 'dispatcher', dispatcherId, reason })`, `assignDriver`, and
    `revokePendingForRide` **keeping its returned pairs** — then the identical post-commit emit tail (the
    `taken` fan-out matters more here than on a normal accept: a driver holding a live offer that Dina just
    overrode must see the card clear). Here `rideId` *is* a route param, and `driverId` a body field — both
    legitimate, because a dispatcher is acting on someone else's behalf by design.
  - `raiseUnclaimed(ride, attempts)`: **dedupe first**, then emit `RT.dispatchUnclaimed` to the dispatch room —
    `kv.incrWithTtl(unclaimedAlertKey(rideId), UNCLAIMED_ALERT_DEDUPE_SECONDS)` and return early unless it
    returns `1`. Both callers (`offerNext` with no candidates, and the sweeper's `alertUnclaimed` pass) go
    through this one method, so the dedupe covers both.
- **GOTCHA**: **`requested → accepted` is not a legal transition** — check `ALLOWED_TRANSITIONS` yourself.
  Force-assign MUST go through `offered`. Never write `rides.status` outside `RideTransitionService`, and never
  write `rides.driver_id` outside `RidesRepository.assignDriver` — `isRideAssignmentConsistent` exists precisely
  because the denormalized `rides.driver_id` and the audit record must not drift.
  **Every emit happens after the commit, never inside the callback** (Task 1's GOTCHA): a `ride:assigned` that
  reaches the driver's phone and is then rolled back is worse than the 409 it replaced.
  A conditional update returning `undefined`/`false` is a `ConflictException`, never a 500 — mirror the
  `vehicle_required` 409 in `drivers.service.ts`. Emits go through `RealtimeService` inside the
  never-fails-the-write guard; `rideOfferEventSchema` wants **ISO strings** for `sentAt`/`expiresAt` while
  `rideOfferSchema` holds `Date`s — serialize at the emit boundary or `RT_EVENT_SCHEMAS.parse` throws (that is the
  whole point of the override comment in `realtime-events.ts`).
- **VALIDATE**: `pnpm --filter @taxi/api exec tsc --noEmit`
- **SATISFIES**: AC #1, #3, #4

### 19. CREATE `services/api/src/features/dispatch/dispatch.sweeper.ts`

- **IMPLEMENT**: `DispatchSweeper implements OnModuleInit, OnModuleDestroy`. `onModuleInit` starts
  `setInterval(() => void this.tick(), SWEEP_INTERVAL_MS)` and calls `.unref()` on the handle; `onModuleDestroy`
  clears it. Public `async tick()` runs three passes in order, each wrapped so one failure cannot kill the loop:
  `expireOverdueOffers()` → `dispatchAwaitingRides()` → `alertUnclaimed()`. A re-entrancy flag skips a tick still
  in flight.
  `alertUnclaimed()` selects rides at `requested` with no driver whose `created_at` is older than
  `config.unclaimedAlertSeconds`, plus any whose attempt count has reached `MAX_OFFER_ATTEMPTS`, and calls
  `DispatchService.raiseUnclaimed` for each — which owns the dedupe.
- **GOTCHA**: **`clearInterval` in `onModuleDestroy` or Jest hangs** and CI times out instead of failing.
  `.unref()` so the interval never holds the process open. `tick()` must be public and awaitable — it is how every
  cascade test advances the world without sleeping.
  **The dedupe is decided, not left open** (Task 18's `raiseUnclaimed`): a KV key per ride via
  `kv.incrWithTtl(...) === 1`, TTL `UNCLAIMED_ALERT_DEDUPE_SECONDS`. Reasons for this over the alternatives — a
  `rides` column would need a migration for an ephemeral fact; an attempt-count check cannot distinguish
  "0 candidates ever" from "already alerted" and so would re-fire every tick; and letting #18 dedupe pushes a
  server concern onto a UI that does not exist yet. At one tick per second an un-deduped alert would flash Dina's
  board 60 times a minute for one stale order — the opposite of the S9-4 signal it exists to be.
  `incrWithTtl` is the same atomic-first-writer trick the auth and rides rate limits already use
  (`rides.service.ts:118`); a GET-then-SET would let two ticks both alert.
- **VALIDATE**: `pnpm --filter @taxi/api exec tsc --noEmit`
- **SATISFIES**: AC #3

### 20. CREATE `services/api/src/features/dispatch/dispatch.controller.ts`

- **IMPLEMENT**: `@Controller('dispatch')`.
  `@Post('offers/:offerId/accept')` and `@Post('offers/:offerId/decline')` — `@Roles('driver')`, driver id from
  `@CurrentUser()`. `@Post('rides/:rideId/assign')` — `@Roles('dispatcher', 'admin')`, body
  `{ driverId, reason? }` validated by a `ZodValidationPipe`, dispatcher id from the JWT.
- **PATTERN**: `rides.controller.ts` — `@Roles` at the right scope, `@CurrentUser()`, `ZodValidationPipe`.
- **GOTCHA**: `@Roles` is per-route here, not per-controller, because drivers and dispatchers share the controller —
  do not put a class-level `@Roles('driver')` on it. The dispatcher id comes from the JWT and never the body; a
  body-supplied `dispatcherId` would make the S9-2 audit trail forgeable. Validate the body with a **locally
  defined** zod object — do not add a shared schema (see Non-Goals); it never crosses a surface boundary until
  #19, which can promote it then.
- **VALIDATE**: `pnpm --filter @taxi/api exec tsc --noEmit`
- **SATISFIES**: AC #1, #4

### 21. CREATE `dispatch.module.ts` + `index.ts`, UPDATE `app.module.ts`

- **IMPLEMENT**: module wires repository, service, sweeper, controller, both strategies, the resolver, and the
  `DISPATCH_QUEUE_STORE` provider. Imports `DriversModule`, `RidesModule`, `GeozonesModule`,
  `PlatformConfigModule`, `RealtimeModule`. Barrel exports `DispatchModule` and `DispatchService` plus a
  **KNOWN GAPS** block. Register `DispatchModule` and `GeozonesModule` in `app.module.ts`.
- **PATTERN**: `drivers.module.ts:34-39` — the `DRIVER_LOCATION_STORE` factory is **unconditionally the Redis
  implementation** (`useFactory: (env) => new RedisDriverLocationStore(env.REDIS_URL)`), and the module `exports`
  the token so tests can override the provider. Copy that exactly: the in-memory queue store is a **test-only**
  construct, never an env-conditional production fallback — an in-memory queue silently forgets every driver's
  earned position on restart, which is a fairness bug that would never surface as an error. `drivers/index.ts`
  for the KNOWN GAPS block.
- **GOTCHA**: KNOWN GAPS must name, at minimum: no zone-entry queue enrollment (lazy at dispatch time instead, and
  why); `driver:queue` never emitted; `drivers.status` never becomes `on_ride` so an accepted driver stays
  eligible until #11; no `reassign`/`cancel`; the sweeper polls rather than reacting to ride creation, and what
  would replace it.
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/dispatch/dispatch.integration.spec.ts` (boots the app)
- **SATISFIES**: AC #5

### 22. CREATE `services/api/src/features/dispatch/dispatch.service.spec.ts` and `dispatch.sweeper.spec.ts`

- **IMPLEMENT**: unit specs with fakes. Service: (expected) a successful accept writes the audit row, revokes the
  siblings and emits `ride:assigned`; (edge) accept on an offer another driver already took returns 409 and
  transitions nothing; (failure) force-assign without a dispatcher id fails the `rideAssignmentSchema` refine.
  Sweeper: (expected) one `tick()` offers an awaiting ride; (edge) a tick still in flight is skipped;
  (failure) a throwing pass does not stop the following passes or the interval.
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/dispatch`
- **SATISFIES**: AC #6

### 23. CREATE `services/api/src/features/dispatch/dispatch.integration.spec.ts` — the acceptance suite

- **IMPLEMENT**: real Nest app, real Postgres, seeded Rīga fixtures, sockets where an emit must be observed.
  - **(expected) AC #1 — cascade under fixture**: two eligible drivers online near a centre pickup; `tick()` offers
    the nearer; that driver declines; `tick()` offers the second; the second accepts; assert `rides.status =
    'accepted'`, `rides.driver_id` set, one `dispatch_audit_log` row with `source: 'auto_match'`, and the offer
    row statuses are `declined` then `accepted`.
  - **(edge) AC #2 — queue fairness**: pickup inside the **RIX** zone (seeded `queueModeEnabled: true`); driver B
    queued ahead of driver A but A strictly nearer; assert the offer goes to **B**. Then assert the same fixture
    under a **centre** pickup (`queueModeEnabled: false`) offers **A** — proving the mode switched the answer, not
    the fixture.
  - **(failure) AC #3 — timeout → next → unclaimed**: one eligible driver; offer expires (seed `expires_at` in the
    past, then `tick()`); assert `ride:offer_revoked` with reason `expired`, ride back at `requested`, no candidate
    left, and `dispatch:unclaimed` emitted with the right `offerAttempts`.
  - **AC #4 — force-assign mid-cascade**: with a pending offer live, force-assign a *different* driver; assert the
    pending offer is `revoked`, the ride is `accepted` by the forced driver, the audit row carries
    `source: 'dispatcher'` **and** the dispatcher's id, and **the overridden driver's socket receives
    `ride:offer_revoked` with reason `taken`** — the returned-pairs path from Task 17 is only exercised here and
    in the concurrent-accept case, so without this assertion a silently-empty `RETURNING` ships green.
  - Plus: (edge) an offline driver is never a candidate; (edge) `femaleDriver: true` with only male drivers online
    goes straight to unclaimed; (failure) accepting an expired offer 409s.
- **PATTERN**: `drivers.integration.spec.ts` for bootstrap, JWT minting, and socket assertions.
- **GOTCHA**: drive time with `tick()` and seeded past timestamps — **no `setTimeout`, no sleeping**.

  **Wire the queue store explicitly, and prove you did.** This is the single most likely way this suite passes
  while testing nothing. Build the module with the in-memory store overridden in, then pull the *resolved*
  instance back out of the container and seed through that — never construct a second one:

  ```ts
  const queue = new InMemoryDispatchQueueStore();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DISPATCH_QUEUE_STORE).useValue(queue)
    .compile();
  // The self-check: the container must hand back the very object we seed.
  expect(moduleRef.get(DISPATCH_QUEUE_STORE)).toBe(queue);
  ```

  Without that `toBe`, seeding a store the strategy never reads leaves the queue empty at dispatch time, the
  strategy falls back to proximity order, and the queue-fairness case **passes for the auto-match reason** — a
  green test asserting the opposite of what it claims. The paired centre-pickup assertion in the same case is the
  second guard: if both pickups return the same driver, the mode never switched and both assertions are lying.

  Also disable the interval for this suite (build the app without calling `listen`, or stop the sweeper in
  `beforeEach`) so a background tick cannot race the one you call by hand and consume the candidate you were
  about to assert on. Guard the socket assertions the way `driver-location.gateway.spec.ts` does.
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/dispatch/dispatch.integration.spec.ts`
- **SATISFIES**: **AC #1, #2, #3, #4**

### 24. UPDATE the barrels and `services/api/CLAUDE.md`

- **IMPLEMENT**: delete from `rides/index.ts` the gaps this ticket closed ("A created ride is NEVER DISPATCHED",
  "`geozoneId` is always null", "`rideOptions` … NOTHING READS THEM") and narrow "A created ride NEVER TRANSITIONS"
  to "#11 owns every transition from `accepted` onward". Update `drivers/index.ts`'s note about #10's two
  consumers if it drifted. Add to `services/api/CLAUDE.md`: the `dispatch` and `geozones` slices, the rule that
  ride status is written only through `RideTransitionService`, the engine-never-imports-a-strategy rule, and the
  geozone precedence rule (smallest polygon wins).
- **GOTCHA**: do not leave a closed gap listed — a stale KNOWN GAPS block is worse than none, because the next
  session plans around a constraint that no longer exists.
- **VALIDATE**: `pnpm --filter @taxi/api exec jest`
- **SATISFIES**: AC #7

### 25. VALIDATE the full gate

- **IMPLEMENT**: run the CI-parity gate from a cleared `dist`, then again with `REDIS_TEST_URL` set so no suite
  skips.
- **VALIDATE**: `pnpm turbo run typecheck lint test build --force`
- **SATISFIES**: AC #5

---

## TESTING STRATEGY

Jest (`services/api`), specs beside the code they test, `1 expected + 1 edge + 1 failure` per feature minimum.

### Unit Tests

Pure logic first, because it is where the subtle bugs are and it needs no infrastructure: `candidate-filter`
(eligibility + ETA), `offer-builder` (split consistency, per-driver commission), `dispatch-strategy.resolver`
(mode selection), `ride-transition.service` (guard + conditional update + emit). Fakes for Drizzle and
`RealtimeService`, as `vehicles.service.spec.ts` does.

### Integration Tests

`dispatch.integration.spec.ts` boots the real app against real Postgres with the Rīga seed, mints JWTs, drives the
world with `tick()`, and asserts over both HTTP and sockets. This is where all four acceptance criteria are proven.
`geozones.service.spec.ts` is integration too — `ST_Contains` and `ST_Area` cannot be faked usefully.

### Store Contract Tests

`dispatch-queue.store.spec.ts` exports one contract run against the in-memory fake (always) and the Redis impl
(under `REDIS_TEST_URL`). Without the fake half, the queue-fairness AC silently does not run in a Redis-less
environment — the known trap from PR #36.

### Edge Cases

1. Two drivers accept the same offer concurrently — exactly one wins, the other gets 409.
2. A driver accepts an offer at the instant the sweeper expires it — the `expires_at > now()` predicate decides,
   and both paths are conditional so neither 500s.
3. A driver goes offline while holding a pending offer — the offer expires normally; no candidate re-check needed.
4. A driver declines twice (double-tap) — second is 409, and `LREM ... 0` means they hold exactly one queue slot.
5. Pickup in the Vecrīga∩centre overlap — the smaller zone wins, deterministically.
6. Pickup outside every geozone — `geozoneId` null, city default mode, no crash.
7. A ride whose every nearby driver is ineligible — straight to unclaimed, no offer rows.
8. `MAX_OFFER_ATTEMPTS` reached with candidates still available — stop and alert rather than cascade forever.
9. Force-assign to a driver who is offline or ineligible — allowed on purpose (Dina overrides the algorithm; that
   is the feature), but assert it still writes the audit row.
10. Force-assign a ride that a driver accepted a millisecond earlier — the conditional transition fails → 409.
11. The sweeper's Postgres call throws — the tick logs and the interval survives.
12. A zone with `queueModeEnabled: true` but an empty queue — every candidate is lazily enrolled, order stable.
13. An accept whose transaction rolls back (any of the four conditional writes fails) — **no socket event was
    emitted**, because every emit is post-commit. Assert this directly: the losing driver of a concurrent accept
    must receive neither `ride:assigned` nor a `ride:status` of `accepted`.
14. The unclaimed alert fires **once** across many ticks past the threshold — assert a second and third `tick()`
    emit nothing further for the same ride.
15. A driver holding a live offer when someone else accepts (or Dina overrides) — their card clears via
    `ride:offer_revoked` reason `taken`. This is the only consumer of `revokePendingForRide`'s returned pairs.
16. A driver declines — they receive **no** `ride:offer_revoked`; the other drivers receive nothing either,
    because nothing was revoked. Only the HTTP 200 and the next offer follow.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/api exec tsc --noEmit
pnpm --filter @taxi/api lint
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/api exec jest src/features/dispatch
pnpm --filter @taxi/api exec jest src/features/geozones src/features/rides src/features/drivers
```

### Level 3: Integration Tests

```bash
docker compose up -d
pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db seed
pnpm --filter @taxi/api exec jest src/features/dispatch/dispatch.integration.spec.ts
REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm --filter @taxi/api test   # no suite may skip
```

### Level 4: Manual Validation

With the API running and a seeded DB:

1. Two driver JWTs; both `PUT /drivers/me/status {"status":"online"}` with a vehicle each; both ping
   `driver:location` near a **centre** pickup.
2. Rider `POST /rides` → note the ride id. Within ~1s the nearer driver's socket receives `ride:offer`; confirm
   the card carries the **full rider fare** and a commission line.
3. Decline it → the other driver receives an offer. Accept → both sockets see `ride:assigned`; `SELECT status,
   driver_id FROM rides` shows `accepted`; `SELECT * FROM dispatch_audit_log` has one `auto_match` row.
4. Repeat with a pickup inside **RIX**; confirm the offer follows queue order, not distance.
5. Book again, let both offers time out; a dispatcher socket receives `dispatch:unclaimed`.
6. `POST /dispatch/rides/:id/assign` as a dispatcher mid-cascade; confirm the pending offer is revoked, the ride is
   `accepted`, and the audit row names the dispatcher.
7. Confirm the ping path still never touches Postgres — the #8 spec that asserts this must still pass.

### Level 5: Additional Validation

- `pnpm turbo run typecheck lint test build --force` from a cleared `dist` — the real gate.
- Watch the API logs during a cascade for the `dispatch.*` taxonomy and confirm **no coordinates or addresses**
  appear in any of them.

---

## ACCEPTANCE CRITERIA

Traced from issue #10:

- [ ] **AC #1 (expected)** — the offer cascade works under a seeded fixture: best candidate offered, decline
      re-offers the next, accept assigns the ride and writes the audit row.
- [ ] **AC #2 (edge)** — geozone queue fairness: in queue mode the queue-ranked driver beats a nearer out-of-turn
      driver; the same fixture in auto-match mode picks the nearer one.
- [ ] **AC #3 (failure)** — timeout → next offer → eventual `dispatch:unclaimed` alert with the right attempt count.
- [ ] **AC #4** — force-assign writes a `dispatch_audit_log` row naming the dispatcher, and works mid-cascade.
- [ ] **AC #5** — `pnpm turbo run typecheck lint test build --force` green from a cleared `dist` (the AC says
      `pnpm check`; the root CLAUDE.md's gate is the stricter command and is what "green" means here), and green
      again with `REDIS_TEST_URL` set so nothing skips.
- [ ] **AC #6** — 1 expected + 1 edge + 1 failure case per new unit of behaviour.
- [ ] **AC #7** — the engine never imports a concrete strategy; ride status is written only through
      `assertTransition`; `rides.driver_id` only through `assignDriver`; **no socket emit inside a transaction**;
      no rate, percentage or timeout is a literal; no new shared contract.

---

## COMPLETION CHECKLIST

- [ ] Pre-flight table run, all 7 checks as expected (or the deviation handled)
- [ ] All 26 tasks completed in order (1–25, plus 3b)
- [ ] The anti-transposition case (Task 5) verified **by mutation** — watched red, reverted, watched green
- [ ] The integration suite's `expect(moduleRef.get(DISPATCH_QUEUE_STORE)).toBe(queue)` self-check present and passing
- [ ] No socket emit happens inside a transaction — grep the dispatch service for `emit` inside a `transaction(` callback
- [ ] Each task's validation ran and passed at the time it was done
- [ ] Full gate green from a cleared `dist`, and green again under `REDIS_TEST_URL`
- [ ] Manual walkthrough (Level 4) done against live Postgres + Redis
- [ ] All four ACs demonstrated by a named test, not by inspection
- [ ] Barrels' KNOWN GAPS updated — closed gaps deleted, new ones written
- [ ] `services/api/CLAUDE.md` updated
- [ ] No new dependency added

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes** (each would change the plan if wrong):

1. **Queue mode is in scope for #10.** `.claude/references/dispatch-strategies.md` says "Phase 1 ships auto_match
   only; geozone_queue lands Phase 4 (decision 2026-07-06)", and `docs/skeleton-proposal.md:138` lists it under
   Phase 4. But #10's title and AC name it explicitly, `docs/build-playbook.md:96` puts "nearest + geozone queue
   fairness" inside slice 2.5, the epic has no other queue ticket in #2–#27, and the seed already ships two zones
   with `queueModeEnabled: true`. The ticket (2026-08-04) is newer than the reference (2026-07-06), so the ticket
   wins. **Action: after this ships, fix that line in `dispatch-strategies.md`** — it is now false.
2. **The guarded transition writer lives in the `rides` slice** (Task 1), exported for `dispatch` to use.
   **DECIDED — implement it there; do not stop to ask.** The rejected alternative was a dispatch-owned writer that
   #11 later absorbs. Three things settle it: `rides` already owns ride-status vocabulary (`ride-entry.ts`, and
   `services/api/CLAUDE.md`'s "Nothing else in the slice may name a ride status"); the writer needs
   `RidesRepository`'s table access either way, so a dispatch-owned copy would import across the same boundary in
   the opposite direction; and #11 is the next ticket in the wave, so "absorb it later" means a refactor one
   ticket from now with two writers of `rides.status` in between — the exact fork `assertTransition` exists to
   prevent. Cost accepted: this ticket touches `services/api/src/features/rides/`, beyond the issue's
   `dispatch/**` file estimate. Note it in the PR body rather than treating it as scope creep.
3. **Lazy queue enrollment replaces zone-entry enrollment**, because zone entry needs point-in-polygon on the ping
   path and that path is forbidden from touching `DRIZZLE`. The AC only requires ranking, not enrollment. If real
   zone-entry enrollment is wanted, it needs an in-memory polygon cache and belongs in its own ticket.
4. **Dispatch is driven by a 1s polling sweeper**, not by `RidesService` calling into it. This avoids a circular
   module dependency (rides ↔ dispatch) and is restart-safe. Cost: up to ~1s of added match latency, and one
   indexed query per second forever. At ≤10 drivers that is free; at scale it becomes Postgres `LISTEN/NOTIFY` or
   an event emitter.
5. **The deferred `dispatch_audit_log_driver_idx` is NOT added.** Issue #10's comment conditions it on "when this
   ticket builds the per-driver read path" — force-assign *writes* audit rows and nothing here reads them by
   driver. Condition not met; it stays deferred, and #20 (admin driver history) is where it lands. Saying so
   explicitly so the next reader knows it was considered, not missed.
6. **ETA is `distanceMeters / avgSpeed`, not a Routes call.** Straight-line distance underestimates on a river
   city with four bridges — a driver across the Daugava may look nearer than they drive. Accepted for the pilot
   (the alternative is a paid call per candidate per round, against a <€100/mo budget); revisit if drivers
   complain the ETA on the card is optimistic.
7. **Balance eligibility is `balanceCents >= 0`.** The reference says "positive-balance check", but until #12's
   ledger exists every driver sits at 0 and a strict `> 0` would match nobody. Flagging rather than deciding
   silently: **should a driver with a negative balance be undispatchable, and at what threshold?** That is a
   product policy question for the ledger ticket.

**Question that would change the plan if answered differently:** should force-assign be allowed to override a ride
that a driver has **already accepted**? This plan says no — `accepted → accepted` is not a transition and the
override 409s. Dina's real workflow may want reassignment there, but that needs a cancellation path, which is #11's.

---

## NOTES (open canvas)

### Why a sweeper and not timers, BullMQ, or `@nestjs/schedule`

| Option | Restart-safe | New dep | Testable without sleeping | Verdict |
|---|---|---|---|---|
| `setTimeout` per offer | ✗ — a restart strands every in-flight offer | none | ✗ (fake timers, fragile with async) | rejected |
| `@nestjs/schedule` `@Interval` | ✓ | +1 | awkward — the decorator owns the loop | rejected: buys nothing over `setInterval` |
| BullMQ delayed jobs | ✓ | +1 heavy (+ Redis queue semantics) | ✗ | rejected: real answer at 1000 drivers, not 10 |
| `setInterval` + public `tick()` | ✓ — state is rows | none | ✓ — call `tick()` directly | **chosen** |

The deciding factor is testability. Every cascade test in Task 23 is `seed → tick() → assert`, with no timers and
no sleeps, because `expires_at` is a column and Postgres's `now()` is the clock. The skeleton mentions BullMQ
(`docs/skeleton-proposal.md:68`) as a NestJS selling point, not a decision — at ≤10 drivers a 1s poll on an
indexed query is cheaper than the operational surface of a job queue.

### The transaction/emit boundary

The one structural rule that shapes three tasks, stated once:

```
db.transaction(tx => {           ← every conditional write lives here
   acceptOffer · transitionInTx · assignDriver · insertAudit · revokePending
})                                ← commit
emitStatus · rideAssigned · offerRevoked · joinRideRoom   ← only now
```

Why it cannot be one step: a `ride:assigned` emitted inside the transaction has already reached the driver's phone
when the rollback happens. #15's offer card would clear, the driver would drive to a pickup, and the ride would
still be `requested` in Postgres — strictly worse than the 409 the rollback was raising. Socket.IO has no
rollback, so the transaction must finish first.

The cost is that `RideTransitionService` cannot be one tidy method (Task 1): the write half must be composable
into someone else's transaction, and the emit half must be callable after it. Hence `transitionInTx` + `emitStatus`,
with `transition()` as the convenience wrapper for the two callers that genuinely are one statement — decline and
expiry, both of which are `offered → requested` and touch nothing else.

### The transition-writer seam, drawn

```
rides slice                     dispatch slice
─────────────                   ──────────────
RidesRepository.create()   ←──  (untouched)
RideTransitionService      ←──  DispatchService  (requested→offered→accepted, offered→requested)
  .transition(id,from,to)  ←──  #11 lifecycle     (accepted→arriving→…→settled)
       │
       └── assertTransition() + conditional UPDATE + ride:status emit
```

One guarded writer, two consumers. The alternative — dispatch writing status directly — would mean
`assertTransition` is called in two places and #11 arrives to find the invariant already forked.

### Force-assign has to walk through `offered`

Worth restating because it looks like a bug on first read:

```
ALLOWED_TRANSITIONS.requested = ["offered", "queued", "cancelled_by_*"]
                                  ↑ no "accepted"
```

So `forceAssign` writes a `ride_offers` row with `source: 'dispatcher'` and `status: 'accepted'`, then moves the
ride `requested → offered → accepted`. Two upsides fall out for free: the audit trail records what the dispatcher
put in front of the driver, and #15's driver app receives the same `ride:assigned` it would from a normal accept —
no special case in the client.

### What the cascade looks like end to end

```
POST /rides  →  ride @ requested
                     │
        ┌────────────┴─────────── DispatchSweeper.tick() every 1s ───────────┐
        │                                                                     │
  dispatchAwaitingRides()          expireOverdueOffers()            alertUnclaimed()
        │                                  │                                  │
  resolve zone (ST_Contains,          pending && expires_at<now()      past unclaimedAlertSeconds
   smallest wins)                          │                            or attempts≥MAX
        │                             → expired                               │
  resolver → strategy                 → ride:offer_revoked            → dispatch:unclaimed
        │                             → offered→requested                  (Dina, S9-4)
  candidates − alreadyTried                │
        │                                  └──→ back to dispatchAwaitingRides
  buildOffer (per-driver split)
        │
  insert ride_offers @ pending
  requested→offered  (queue mode: →queued→offered)
        │
  ride:offer → driver room
        │
        ├── accept  → offered→accepted, audit row, revoke siblings, ride:assigned
        └── decline → offered→requested, sendToBack (queue mode), re-offer
```

### The one genuinely missing piece nobody wrote down

`ride_fare_lines` is **write-only** in the codebase today. `RidesRepository.create()` writes the four lines;
`toRide()` takes the `FareQuote` as a parameter because the write path already had it in hand. No reader exists,
and none of #9's KNOWN GAPS mentions it — so "the offer card carries the fare" looks like a read of existing data
and is actually a small build (Task 3). It is on the critical path for every offer, which is why it sits in
Phase 1 rather than being discovered at Task 16.

### The trap most likely to eat an afternoon

Lat/lng transposition, in two new places: `ST_MakePoint(lng, lat)` and the queue's zone lookups. #8 hit exactly
this and its Redis store spec carries a dedicated ordering test because a round-trip test cannot see a *consistent*
swap — both halves agree and everything looks fine until a real coordinate meets a real polygon. Write the
geozone test (Task 5) with coordinates lifted from `db/src/seed/riga.ts`, and sanity-check that a point you believe
is in RIX is not silently resolving to `undefined`.

### Second most likely: a green gate that proved nothing

`REDIS_TEST_URL` is opt-in (root CLAUDE.md). The queue store is Redis-backed. If the only runner of the queue
contract is the Redis spec, then on a machine without `REDIS_TEST_URL` the AC #2 edge case *does not execute* and
the gate is still green. Task 9 exists to prevent exactly that. Run the suite both ways before calling it done.

---

## AMENDMENTS

(none yet — created 2026-08-05)
