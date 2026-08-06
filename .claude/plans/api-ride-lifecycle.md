# Feature: API ride lifecycle — accepted → completed, payment-method lock, settled fare split

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

The half of the ride the platform has never had. Today a ride can be requested (#9), matched and
accepted (#10) — and then nothing. There is no way for a driver to say "I'm on my way", "I'm at the
kerb", "we're moving" or "we're there"; no way for anyone to cancel; no way for a rider to change
their payment method (and therefore no way for the lock that Atis demanded to be enforced against
anything); and the four `rides.commission_*` columns that hold the **settled** fare split are still
null on every row in the database.

This ticket closes all of it:

- **The driver's four lifecycle steps** — `accepted → arriving → arrived → in_progress → completed`,
  each a guarded transition through the existing `RideTransitionService`, each emitting `ride:status`.
- **All four cancellation branches** — `cancelled_by_{rider,driver,dispatcher,system}` — with the
  actor derived from the JWT role, never from the body, and a pending offer revoked (finally giving
  `ride:offer_revoked`'s third reason, `cancelled`, its first consumer).
- **The payment-method lock** — a `PATCH /rides/:rideId/payment-method` route whose one job is to
  refuse after acceptance, enforced by `isPaymentMethodLocked()` inside a single race-free
  conditional UPDATE.
- **The settled fare split** — written at completion from the split the driver was **actually shown
  on the offer card**, not recomputed. Full fare + explicit commission line, integer cents, summing
  exactly. This is the S2-5 wedge becoming a persisted record instead of a promise.
- **`drivers.status = 'on_ride'`** — claimed at acceptance, released at completion and at every
  post-acceptance cancellation. Without it, a driver mid-ride is still an eligible dispatch candidate
  and gets offered a second car.

## User Story

As a **driver on an accepted ride**
I want to **move the ride through its real-world steps and see exactly what I earned when it ends**
So that **the passenger's app tracks me honestly, and I can check the full fare and the 15% line
instead of taking a foreign platform's word for a number I am not allowed to see.**

## Problem Statement

Three concrete problems, in descending order of how much they matter to the pitch:

1. **The transparency wedge is not yet a record.** `ride_offers.split` proves what a driver was
   *shown*; nothing proves what they were *paid*. The four `commission_*` columns on `rides` exist,
   are documented as "written at completion (#11)", and are null on every row. The €200→€130 story
   (S2-4) is precisely a story about the settled number differing from the shown number, and today
   the platform has no settled number at all.
2. **A ride cannot end.** `accepted` is a sink: no route advances it, no route cancels it. The ride
   state machine's entire right-hand side is unreachable code.
3. **The payment-method lock is unenforced because it is untestable.** `isPaymentMethodLocked()`
   exists in `@taxi/shared` and is called by nothing. There is no route that changes a payment
   method, so there is nothing for the hard rule to refuse.

Plus one live bug that falls out of (2): after `POST /dispatch/offers/:id/accept`, the driver stays
`drivers.status = 'online'`. `toCandidates` (`candidate-filter.ts:29`) only excludes non-`online`
drivers, so the very next sweeper tick can offer that driver a second ride while they are driving
the first. `DriversService.setPresence` already throws `driver_on_ride` in anticipation of a status
that nothing ever writes.

## Solution Statement

A `lifecycle/` sub-slice inside `features/rides/`, built on the machinery #9 and #10 already left in
place:

- Every status write goes through the existing `RideTransitionService.transitionInTx()` — the one
  caller of `assertTransition()`. This ticket adds **zero** new transition machinery and **no**
  second transition table.
- Client-visible illegality (cancelling a completed ride) is checked with `canTransition()` first and
  answered with a typed 409; `assertTransition` keeps its role as the 500-worthy programming-error
  guard. Every rejection logs `ride.lifecycle.transition_rejected` per the logging standard.
- The settled split is **copied from the accepted `ride_offers` row's `split` snapshot**, parsed
  through `fareSplitSchema` (whose refinement is the no-cent-leak invariant), checked against the
  ride's quote with `assertRideSplitConsistent`, and written to the four columns in the same
  transaction as `in_progress → completed`.
- `on_ride` is claimed by the lifecycle (never by dispatch itself) through one exported method that
  dispatch composes into its existing accept/force-assign transactions.
- No new socket events, no new database migration. One small `@taxi/shared` addition
  (`rideSchema.paymentMethod` plus two request-body schemas the rider app needs).

## Out of Scope / Non-Goals

- **`completed → settled` is NOT implemented.** `settled` means "money movement finished (ledger
  entries written)" (`.claude/references/ride-state-machine.md`) and the ledger is #12's, whose own
  AC is "card ride settles with correct ledger entries". A `settled` status with no ledger rows is a
  status that lies. This narrows the ticket's scope bullet — see **OPEN QUESTIONS** #1. The ride ends
  at `completed` here; #12 adds the settle step and its ledger writes together.
- **No ledger entries, no payment capture, no cash netting, no driver balance movement** — all #12.
- **No `GET /rides/:rideId`.** `POST .../complete` returns the completed ride with its split, which
  is what a driver needs at the moment they need it. The general ride-read route belongs to #15/#17
  which know what they need on it. (The known-gaps note in `features/rides/index.ts` says "ride reads
  belong to #11/#16" — this plan deliberately hands the read to #16/#17 and says so.)
- **No cancellation fee, no no-show flow, no free-cancellation window.** No evidence for any policy
  yet, and every one of them is a money movement, i.e. #12.
- **No production trigger for `cancelled_by_system`.** The actor is supported end-to-end and covered
  by a spec; the caller that will use it is #12's payment-preauth failure. No sweeper timeout is
  invented here.
- **No dispatch-board (`dispatch:board`) updates on lifecycle changes.** #18 owns the board's shape.
- **Not changing** `POST /rides` (#9), the idempotency reservation, the offer cascade, the sweeper,
  the geozone queue, or any pricing behaviour.
- **No `db/` migration.** All 14 `ride_status` enum values and all four `commission_*` columns
  already exist — verified in migration `0001_worried_grim_reaper.sql` (line 12 for the 14-value
  `ride_status` enum, lines 115-118 for `commission_pct` / `commission_source` / `commission_cents` /
  `driver_net_cents`), mirrored at `db/src/schema/rides.ts:35,52-55`. Do **not** run
  `pnpm --filter @taxi/db generate`.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (state machine × 4 actors × side effects, plus a cross-slice hook)
**Primary Systems Affected**: `services/api/src/features/rides/` (new `lifecycle/` sub-slice),
`services/api/src/features/drivers/` (two conditional-status methods),
`services/api/src/features/dispatch/` (two claim call-sites), `packages/shared/src/schemas/ride.ts`
**Dependencies**: none new — no package installs, no migration

## Related Work

**Implements**: [#11](https://github.com/linardsb/taxi/issues/11) · **Epic**:
[#1](https://github.com/linardsb/taxi/issues/1) (`docs/epics/sakta-cab.architecture.md`, decided
2026-08-03)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/shared-contracts-ride-loop.md` — Why: owns `ride-state-machine.ts`,
  `isPaymentMethodLocked`, `splitFare`/`fareSplitSchema`, and the deliberate
  predicate-not-`.refine()` decision this plan's assertions depend on.
- `.claude/plans/api-rides-pricing.md` — Why: `RideTransitionService`, `ride-entry.ts`,
  `RidesRepository.findWithQuote`, and the "#11 owns everything from `accepted` onward" boundary
  this ticket now fills in.
- `.claude/plans/api-dispatch-engine.md` — Why: the accept/force-assign transactions this plan hooks
  into, `buildOffer`'s per-driver commission resolution (the reason the settled split is *copied*,
  not recomputed), and the post-commit-emit discipline.
- `.claude/plans/api-drivers-slice.md` — Why: `drivers.status`, the conditional-UPDATE pattern
  (`setOnlineIfHasVehicle` / `setOfflineIfOnline`) that the two new status methods mirror exactly.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet — expected: #12 payments/ledger adds `completed → settled`; #15 driver app; #17 rider
  app; #21/#22/#23 extend the machine's edges)

**Inherited from the epic — do not re-decide**: NestJS + Drizzle + PostGIS + Redis; commission is a
`platform_config` row resolved by `resolveCommissionPct`, never a literal; integer cents EUR; every
cross-surface contract lives in `@taxi/shared`; providers only via `packages/shared/src/seams/`;
payment method locks at acceptance; status changes via `assertTransition`.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**The contract seam (read first — everything else is downstream of these):**

- `packages/shared/src/ride-state-machine.ts` (whole file, 129 lines) — Why: `ALLOWED_TRANSITIONS` is
  the spec for every route in this ticket. Note `accepted → arriving → arrived → in_progress →
  completed`, that `in_progress` only allows `completed` **and** `cancelled_by_dispatcher`, and that
  `isPaymentMethodLocked()` (line 118) is true from `accepted` onward.
- `packages/shared/src/commission.ts` (lines 43-91) — Why: `fareSplitSchema`'s `.refine()` **is** the
  no-cent-leak invariant, so parsing the stored offer split re-proves it for free. `splitFare()` is
  NOT called by this ticket (see PATTERNS: settlement copies, never recomputes).
- `packages/shared/src/schemas/ride.ts` (lines 25-69 quote, 126-175 offer + `assertOfferSplitConsistent`,
  178-245 `rideSchema` + `assertRideSplitConsistent`) — Why: the file you edit in Phase 1, and
  `assertRideSplitConsistent`'s docblock literally says "Call this at write boundaries (#11)".
- `packages/shared/src/realtime-events.ts` (lines 22-31 `RT`, 64-73 `rideStatusEventSchema`, 95-102
  `rideOfferRevokedEventSchema`) — Why: the only two events this ticket emits. Note
  `rideOfferRevokedEventSchema.reason` includes `'cancelled'`, unused until now.
- `packages/shared/src/money.ts` (whole file, 42 lines) — Why: `nonNegativeCentsSchema`,
  `commissionPctSchema`. No new money primitive is needed.
- `packages/shared/src/enums.ts` (lines 10-16 `PAYMENT_METHOD_TYPES`, 28-39 driver statuses) — Why:
  `DRIVER_PRESENCE_STATUSES`' docblock states the rule this ticket implements: `on_ride` "is written
  only by the ride lifecycle (#11)".

**The api slice this ticket extends:**

- `services/api/src/features/rides/ride-transition.service.ts` (whole file, 145 lines) — Why: the ONE
  guarded writer. `transitionInTx` (composable, no emit) vs `emitStatus` (post-commit) — the split
  this ticket must respect at every call site. Also defines `DbTx` (line 31), which Task 3 moves.
- `services/api/src/features/rides/rides.repository.ts` (lines 63-83 `toRide`, 101-145 `create`,
  179-221 `findWithQuote`, 233-244 `assignDriver`) — Why: `toRide` is edited in Task 12; `create`'s
  docblock explains that the `commission_*` columns are deliberately left unset "which carry the
  SETTLED split and belong to #11".
- `services/api/src/features/rides/rides.service.ts` (lines 297-326 `notifyRider`) — Why: the
  join-before-emit rule and the never-throw-after-commit discipline, both copied verbatim by this
  slice.
- `services/api/src/features/rides/rides.controller.ts` (whole file, 41 lines) — Why: the controller
  pattern (`@CurrentUser`, `ZodValidationPipe`, class-level `@Roles`) and the explicit note that this
  controller is rider-only, which is why the lifecycle needs its own.
- `services/api/src/features/rides/index.ts` (whole file, 44 lines) — Why: the barrel is the slice's
  public API and carries the KNOWN GAPS list this ticket must update. Read the cross-slice-export
  rationale at lines 32-40 before adding to it.
- `services/api/src/features/rides/rides.module.ts`, `rides.policy.ts`, `ride-entry.ts` — Why: module
  wiring, the constants-not-env-vars convention, and the entry-vs-transition distinction.
- `services/api/src/features/dispatch/dispatch.service.ts` (lines 174-221 `accept`, 273-391
  `forceAssign`, 466-527 `emitAssigned`) — Why: the two transactions Task 13 adds one line to. Note
  the `── committed ──` markers: everything below them is emit-only and must never throw.
- `services/api/src/features/dispatch/dispatch.repository.ts` (lines 127-145 `acceptOffer`, 175-201
  `revokePendingForRide`) — Why: `acceptOffer` flips the row to `accepted` — that row is the one this
  ticket's settlement reads. `revokePendingForRide`'s RETURNING-is-load-bearing docblock is the exact
  pattern the cancel path reuses.
- `services/api/src/features/dispatch/offer-builder.ts` (whole file, 89 lines) — **Why: the single
  most important file for the settlement decision.** Line 53 resolves the commission **per driver**
  (`driverAttrs.commissionPctOverride`), so the split stored on the offer row can legitimately differ
  from a fresh platform-base resolution. That is why settlement copies it.
- `services/api/src/features/drivers/drivers.repository.ts` (lines 140-200 —
  `setOnlineIfHasVehicle`, `setOfflineIfOnline`, `setStatus`) — Why: the conditional-UPDATE-as-one-
  statement pattern the two new methods mirror, including the "no transaction needed; one statement
  cannot interleave" rationale.
- `services/api/src/features/drivers/drivers.service.ts` (lines 61-146) — Why: `setPresence` already
  throws `driver_on_ride` (line 83) and `clearPresenceOnDisconnect` already refuses to touch
  `on_ride` (line 133) — both written for the status this ticket finally writes.
- `services/api/src/features/dispatch/strategies/candidate-filter.ts` (line 29) — Why: `a.status !==
  'online'` is why claiming `on_ride` is a correctness fix, not bookkeeping.
- `services/api/src/features/realtime/realtime.service.ts` (whole file, 76 lines) — Why: `emitToRide`
  / `emitToDriver` / `joinRideRoom`, and the parse-before-emit guarantee.
- `services/api/src/common/db/db.module.ts` — Why: `DRIZZLE` token; the new home of `DbTx` (Task 3).
- `services/api/src/common/zod-validation.pipe.ts` — Why: the body-validation pipe every controller
  uses.
- `services/api/src/features/auth/decorators/{current-user,roles}.decorator.ts` — Why: `@CurrentUser`
  yields `JwtClaims` (`sub`, `role`); `@Roles` is per-route on shared controllers.

**Tests to mirror:**

- `services/api/test/harness.ts` (whole file, 385 lines) — Why: `createTestApp()`, `insertUser`,
  `phoneFor`, `connectClient`, `closeClients`. **Every** integration spec starts here.
- `services/api/src/features/dispatch/dispatch.integration.spec.ts` (lines 1-235 setup +
  `waitFor`/`rideRow`/`pendingOffer` helpers, then the AC-labelled `it()` blocks) — Why: **the**
  model for this ticket's integration spec. Copy the per-file phone range comment, the `afterEach`
  ride-retirement, the ride-id-filtered `waitFor`, and the `AC #n` labelling.
- `services/api/src/features/rides/rides.integration.spec.ts` (lines 1-80) — Why: the `signIn`
  helper and the phone-range allocation comment.
- `services/api/src/features/rides/ride-transition.service.spec.ts` (whole file, 113 lines) — Why:
  how a service that owns transitions is unit-tested with a faked Drizzle handle.
- `services/api/src/features/dispatch/dispatch.service.spec.ts` — Why: the mock-the-collaborators
  unit-spec style for a service with many injected dependencies.
- `packages/shared/tests/schemas.test.ts` (lines 389-460) — Why: the `rideSchema` `base` fixture Task
  2 edits, and the expected/edge/failure naming convention.

### New Files to Create

- `services/api/src/features/rides/lifecycle/ride-lifecycle.policy.ts` — actor→cancelled-status map,
  the driver step table, and the locked/terminal status sets derived from `@taxi/shared` predicates.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts` — the lifecycle's own
  reads/writes: the light ride read, the settled-split write, the accepted-offer-split read, and the
  cancel-time offer revoke.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` — orchestration: authorize →
  guard → transaction → post-commit emits → log.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.controller.ts` — the six REST routes,
  per-route `@Roles`.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.spec.ts` — unit tests.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.integration.spec.ts` — the socket+REST
  e2e and every acceptance branch.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

In-repo (these are the authority — read them before any external source):

- `.claude/references/ride-state-machine.md` — the whole file (17 lines). Specifically: "rider/driver
  can cancel until `in_progress`; dispatcher can cancel anything up to and including `in_progress`;
  system cancels only pre-acceptance states", and "`completed` is the physical end of the ride,
  `settled` the financial one".
- `.claude/references/realtime-events.md` — room names and the event catalog. This ticket emits only
  `ride:status` and `ride:offer_revoked`; it adds no event.
- `.claude/references/logging-standard.md` — `domain.component.action_state`. The example
  `ride.lifecycle.transition_applied` is this slice's namespace, and the rule "Every state-machine
  rejection logs `ride.lifecycle.transition_rejected` with `from`, `to`, `actor`" is a hard
  requirement of this ticket, not a suggestion.
- `services/api/CLAUDE.md` — the whole file. Two lines are this ticket's contract:
  "`drivers.status = 'on_ride'` is written only by the ride lifecycle (#11)" and "No socket emit
  inside a database transaction."
- `packages/shared/CLAUDE.md` — the contract-seam rules for Phase 1.
- `docs/epics/sakta-cab.prd.md` §6 (core loop) and §1 (the €200→€130 evidence) — Why: the settlement
  decision below is a direct response to that evidence.

External:

- [Drizzle ORM — transactions](https://orm.drizzle.team/docs/transactions) — Why: `db.transaction(async (tx) => …)`
  semantics; the callback's throw is what rolls back, which is how every conflict in this slice
  aborts cleanly.
- [Drizzle ORM — `update ... where ... returning`](https://orm.drizzle.team/docs/update) — Why: every
  guard in this slice is a conditional UPDATE whose empty `returning()` means "someone else won" —
  a 409, never a 500.
- [NestJS — custom decorators / execution context](https://docs.nestjs.com/custom-decorators) — Why:
  `@CurrentUser()` supplies `JwtClaims.role`, which is the cancellation actor. Do not read an actor
  off the body.
- [NestJS — exception filters & built-in HTTP exceptions](https://docs.nestjs.com/exception-filters#built-in-http-exceptions)
  — Why: `ConflictException` (409), `ForbiddenException` (403), `NotFoundException` (404) are the
  three this slice throws; the codebase passes a bare snake_case string as the message.
- [Zod — `.parse()` on refined objects](https://zod.dev/?id=refine) — Why: `fareSplitSchema` is a
  `ZodEffects`; parsing the stored jsonb re-runs the sum invariant.

### Patterns to Follow

**The settlement rule — COPY the accepted offer's split, never recompute it.** This is the single
most important decision in this plan.

`buildOffer` resolves the commission **per driver**:

```ts
// services/api/src/features/dispatch/offer-builder.ts:53
const resolution = resolveCommissionPct(
  { commissionPctOverride: input.driverAttrs.commissionPctOverride },
  input.config,
);
const split = splitFare(input.quote.totalCents, resolution);
```

…and that `split` is persisted verbatim on the offer row (`ride_offers.split`, documented on the
table as "audit 'what was shown' (the S2-5 transparency card)"). Both assignment paths leave exactly
one `accepted` offer row: `DispatchService.accept` flips a `pending` row via
`DispatchRepository.acceptOffer`, and `forceAssign` inserts one at `status: 'accepted'`.

If settlement re-resolved instead, an admin edit to `platform_config.commission_pct` (#20) or to a
driver's `commission_pct_override` between acceptance and completion would silently change what the
driver is paid relative to the card they accepted. `assertRideSplitConsistent` would **not** catch it
— `totalCents` is identical either way. That is the €200→€130 failure mode reproduced in our own
codebase. Copy the snapshot.

**Guarded transition, composed into the caller's transaction** (`ride-transition.service.ts:75`):

```ts
const moved = await this.transitions.transitionInTx(tx, rideId, from, to);
if (!moved) throw new ConflictException('ride_transition_conflict');
```

**Post-commit emit only.** Never inside `db.transaction`. Mirror `dispatch.service.ts`'s literal
comment marker:

```ts
// ── committed ──
this.transitions.emitStatus(ride, from, reason);
```

**Conditional UPDATE as the guard, one statement** (`drivers.repository.ts:151`):

```ts
const [row] = await (tx ?? this.db)
  .update(drivers)
  .set({ status: 'on_ride' })
  .where(and(eq(drivers.userId, userId), eq(drivers.status, 'online')))
  .returning();
return row !== undefined;
```

**Cross-slice reads: the mirror of the existing exception.** `features/rides/index.ts` already
documents exporting `RidesRepository`/`RideTransitionService` **out** to dispatch as "the narrower
evil". This ticket needs the reverse direction twice — read the accepted offer's `split`, and revoke
pending offers on a cancel. Do **not** import `DispatchRepository` into rides: `DispatchModule`
already imports `RidesModule`, so that is a `forwardRef` cycle. Instead, `ride-lifecycle.repository.ts`
touches `ride_offers` directly, with a docblock naming it as the mirror of the barrel's exception.

**Client-illegal vs programmer-illegal.** `assertTransition` throws
`InvalidRideTransitionError`, which the codebase treats as a 500. A rider cancelling an already-
completed ride is not a programming error. So: check `canTransition(from, to)` first and throw
`ConflictException`; `transitionInTx` then re-asserts harmlessly.

**Naming:** files kebab-case (`ride-lifecycle.service.ts`); classes PascalCase; error messages bare
snake_case strings (`payment_method_locked`), matching `offer_not_pending` / `ride_already_assigned`.

**Logging** (`.claude/references/logging-standard.md`), component = `lifecycle`:

```ts
this.logger.log({
  event: 'ride.lifecycle.transition_applied',
  rideId, orderId, driverId, actor, from, to,
  at: new Date().toISOString(),
});
```

Required events: `transition_applied`, `transition_rejected` (with `from`, `to`, `actor`),
`settlement_written` (with `totalCents`, `commissionPct`, `commissionSource`, `commissionCents`,
`driverNetCents`), `payment_method_changed`, `payment_method_rejected`, `driver_claimed`,
`driver_released`, `notify_failed`. **Never** log addresses or coordinates.

**Redis presence is NOT touched when a driver goes `on_ride`.** `DriverLocationStore.record()`
refuses a position for a driver who is not in the online set (`harness.ts:184` models the production
Lua gate). Calling `markOffline` on acceptance would silently drop every location ping for the whole
ride and freeze #17's rider tracking. Postgres `drivers.status` alone excludes them from dispatch —
`candidate-filter.ts:29` checks it explicitly *because* "these are two stores, and `drivers.status` is
the durable truth".

---

## IMPLEMENTATION PLAN

### Phase 1: Contract (`packages/shared`)

The operative payment method needs a home distinct from the immutable request snapshot, and the two
new request bodies cross a surface boundary (#17 sends both), so they belong in the seam.

**Tasks:** add `rideSchema.paymentMethod`; add `ridePaymentMethodUpdateSchema` and
`rideCancelSchema`; extend the shared tests.

### Phase 2: Plumbing (`common`, `drivers`)

**Depends on:** nothing — **Independent of:** Phase 1. (Can be done first or in parallel; Phase 3
needs both.)

Move `DbTx` to `common/db` so the drivers slice can compose a transaction without a type edge to the
rides slice, then add the two conditional driver-status methods.

### Phase 3: The lifecycle sub-slice (`features/rides/lifecycle/`)

**Depends on:** Phases 1 and 2.

Policy → repository → service → controller → module wiring, plus `toRide` learning to project the
settled split and the payment method.

### Phase 4: Dispatch integration

**Depends on:** Phase 3 (`RideLifecycleService` must exist and be exported).

Two one-line claims inside the existing accept and force-assign transactions.

### Phase 5: Tests

**Depends on:** Phases 1-4.

Unit spec for the service's guards; integration spec for the socket+REST happy path, all four
cancellation branches, and the payment-lock failure.

### Phase 6: Documentation

**Depends on:** Phase 5 green.

Update the three docs whose text says "#11 will…" and now must say "#11 does".

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task Format Guidelines

- **CREATE**: New files or components · **UPDATE**: Modify existing files · **ADD**: Insert new
  functionality · **REMOVE**: Delete deprecated code · **REFACTOR**: Restructure without changing
  behavior · **MIRROR**: Copy pattern from elsewhere in codebase

---

### UPDATE `packages/shared/src/schemas/ride.ts`

- **IMPLEMENT**:
  1. Add a top-level field to `rideSchema` (after `riderId`/`driverId`, before `request`):
     `paymentMethod: z.enum(PAYMENT_METHOD_TYPES)`. Docblock: **the operative, mutable value** —
     `rides.payment_method`, changeable by the rider until `isPaymentMethodLocked()` turns true.
     Deliberately distinct from `request.paymentMethod`, which is the immutable "what was asked"
     wire snapshot the table docblock describes and which must NOT be rewritten.
  2. Add `export const ridePaymentMethodUpdateSchema = z.object({ paymentMethod: z.enum(PAYMENT_METHOD_TYPES) });`
     + `export type RidePaymentMethodUpdate = z.infer<…>`. Docblock: the `PATCH
     /rides/:rideId/payment-method` body; lives here rather than in the controller (unlike #10's
     local `forceAssignBodySchema`) because #17's rider app is a named consumer today.
  3. Add `export const rideCancelSchema = z.object({ reason: z.string().max(280).nullable().default(null) });`
     + type. `max(280)` matches `rideAssignmentSchema.reason` and `rideStatusEventSchema.reason` —
     the reason travels straight onto the wire.
- **PATTERN**: `rideRequestBodySchema` (line 100) for a body schema; `rideAssignmentSchema.reason`
  (line 116) for the 280 cap.
- **IMPORTS**: `PAYMENT_METHOD_TYPES` is already imported at line 5. Nothing new.
- **GOTCHA**: Do **not** add a `.refine()` to `rideSchema` — its docblock at lines 198-206 explains
  that a `ZodEffects` loses `.omit()`/`.pick()`/`.extend()`, which `db/` and other tickets depend on.
  The existing test at `schemas.test.ts:422` asserts this and will fail if you do.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #3 (payment-method lock needs a mutable value to guard)

### UPDATE `packages/shared/tests/schemas.test.ts`

- **IMPLEMENT**: Add `paymentMethod: 'cash'` to the `rideSchema` `base` fixture (line ~390). Add
  three tests: `ridePaymentMethodUpdateSchema` accepts `{ paymentMethod: 'card' }` (expected);
  rejects `{ paymentMethod: 'crypto' }` (failure); `rideCancelSchema` defaults `reason` to `null`
  (edge).
- **PATTERN**: the existing expected/edge/failure `it()` naming in the same file.
- **IMPORTS**: add the two new schemas to the import block at line ~19.
- **GOTCHA**: `base` is shared by five `it()` blocks; one line added to it fixes all five.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #3

### UPDATE `services/api/src/common/db/db.module.ts`

- **IMPLEMENT**: Move the `DbTx` type here verbatim (with its docblock — "Deriving from `Db` needs no
  type arguments and cannot drift"):
  `export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];`
- **PATTERN**: this file already owns the `DRIZZLE` token — Drizzle plumbing is cross-cutting, and
  `services/api/CLAUDE.md` puts cross-cutting Nest plumbing in `src/common/`.
- **IMPORTS**: `import type { Db } from '@taxi/db';` (likely already present).
- **GOTCHA**: the drivers slice needs `DbTx` in Task 5. Leaving it in `features/rides/` would give
  drivers a type-edge to rides while rides depends on drivers at runtime. Type-only imports don't
  cycle at runtime, but the right home for "Drizzle's transaction handle" is `common/db`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, #2 (enables the transactional side effects)

### UPDATE `services/api/src/features/rides/ride-transition.service.ts`

- **IMPLEMENT**: Delete the local `DbTx` definition (line 31) and replace with a re-export:
  `export type { DbTx } from '../../common/db/db.module';`, plus `import type { DbTx } from '../../common/db/db.module';`
  for local use in `transitionInTx`.
- **PATTERN**: the rides barrel already re-exports `DbTx` (`index.ts:44`), and
  `dispatch.repository.ts:10` imports it from `'../rides'` — both keep working untouched.
- **IMPORTS**: as above.
- **GOTCHA**: keep the re-export. Removing it breaks `dispatch.repository.ts` and the barrel.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/drivers/drivers.repository.ts`

- **IMPLEMENT**: Two conditional-UPDATE methods, both taking `tx?: DbTx`:
  ```ts
  /** online → on_ride, only if still online. `false` = not claimable. */
  async claimForRide(userId: string, tx?: DbTx): Promise<boolean>
  /** on_ride → online, only if currently on_ride. `false` = nothing to release. */
  async releaseFromRide(userId: string, tx?: DbTx): Promise<boolean>
  ```
  Both `.update(drivers).set({ status }).where(and(eq(userId), eq(status, <expected>))).returning()`,
  returning `row !== undefined`.
- **PATTERN**: `setOnlineIfHasVehicle` (line 151) / `setOfflineIfOnline` (line 181) — same shape,
  same "one statement cannot interleave" reasoning. `tx?: DbTx` threading mirrors
  `RidesRepository.assignDriver` (line 233).
- **IMPORTS**: `import type { DbTx } from '../../common/db/db.module';`
- **GOTCHA**: `claimForRide` is guarded on `status = 'online'` **on purpose**. A force-assigned
  driver may be `offline` (force-assign "deliberately NOT filtered through the eligibility rules"),
  and claiming them would end the ride by putting an offline driver online. Guarded this way, an
  offline force-assigned driver stays offline throughout and `releaseFromRide` correctly does
  nothing — which is why both return `boolean` rather than a profile, and why `false` is an ordinary
  outcome that must never throw.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api test -- drivers`
- **SATISFIES**: AC #1, #2

### UPDATE `services/api/src/features/drivers/drivers.service.ts`

- **IMPLEMENT**: Expose both through the service (the barrel's boundary), each logging on a real
  change only:
  ```ts
  async claimForRide(driverId: string, tx?: DbTx): Promise<boolean>   // logs driver.presence.claimed_for_ride
  async releaseFromRide(driverId: string, tx?: DbTx): Promise<boolean> // logs driver.presence.released_from_ride
  ```
- **PATTERN**: `setPresence`'s structured log (line 106).
- **IMPORTS**: `DbTx` from `common/db/db.module`.
- **GOTCHA**: Log **after** the write returns `true`, and never inside a rollback-able branch's
  success assumption — a log line about a transaction that later rolls back is a lie. Since this runs
  inside the caller's tx, keep the message factual ("claim written") and let the caller's post-commit
  `transition_applied` log be the authoritative one.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, #2

### CREATE `services/api/src/features/rides/lifecycle/ride-lifecycle.policy.ts`

- **IMPLEMENT**: pure, DI-free, no I/O:
  ```ts
  /** Who is acting. Derived from the JWT role — never from a request body. */
  export type LifecycleActor = 'rider' | 'driver' | 'dispatcher' | 'system';

  /** actor → terminal cancellation status. Exhaustive over LifecycleActor. */
  export function cancelledStatusFor(actor: LifecycleActor): RideStatus

  /** The driver's four steps, in order. `from` doubles as the 409 error code. */
  export const DRIVER_STEPS = {
    arriving:   { from: 'accepted',    to: 'arriving' },
    arrived:    { from: 'arriving',    to: 'arrived' },
    start:      { from: 'arrived',     to: 'in_progress' },
    complete:   { from: 'in_progress', to: 'completed' },
  } as const satisfies Record<string, { from: RideStatus; to: RideStatus }>;
  export type DriverStep = keyof typeof DRIVER_STEPS;

  /** Derived from the shared predicate — never a hand-written list. */
  export const PAYMENT_METHOD_EDITABLE_STATUSES = RIDE_STATUSES.filter(
    (s) => !isPaymentMethodLocked(s) && !isTerminal(s),
  );

  /** Statuses at which a pending offer may still exist and must be revoked on cancel. */
  export const PRE_ACCEPTANCE_STATUSES = ['requested', 'offered', 'queued'] as const satisfies readonly RideStatus[];
  ```
- **PATTERN**: `ride-entry.ts` — a small pure module of status knowledge with
  `as const satisfies readonly RideStatus[]` (and its docblock explaining why an annotation would
  widen the tuple). `rides.policy.ts` for the constants-with-rationale style.
- **IMPORTS**: `RIDE_STATUSES`, `isPaymentMethodLocked`, `isTerminal`, type `RideStatus` from
  `@taxi/shared`.
- **GOTCHA**: `PAYMENT_METHOD_EDITABLE_STATUSES` MUST be derived by filtering `RIDE_STATUSES` through
  `isPaymentMethodLocked`. Hand-listing it is exactly the "never bypass `isPaymentMethodLocked()`"
  hard rule being bypassed by copy-paste, and it silently rots when #21/#22 add a status. `isTerminal`
  is in the filter because a cancelled ride is not locked (`isPaymentMethodLocked('cancelled_by_rider')`
  is `false`) but must not be editable either.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #2, #3

### CREATE `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts`

- **IMPLEMENT**: `@Injectable()`, `@Inject(DRIZZLE) db: Db`. Methods:
  1. `findForAction(rideId): Promise<LifecycleRide | undefined>` — one light SELECT returning
     `{ id, orderId, status, riderId, driverId, totalCents }`. Deliberately not `findWithQuote`: the
     authorization + guard step needs no fare lines. Mirror the rationale on
     `RidesRepository.findGeozoneId` (line 246).
  2. `findAcceptedOfferSplit(rideId): Promise<FareSplit | undefined>` — SELECT `split` FROM
     `ride_offers` WHERE `ride_id = $1 AND status = 'accepted'` LIMIT 1, returning
     `fareSplitSchema.parse(row.split)`. Docblock: **the mirror of the barrel's cross-slice
     exception** — dispatch owns `ride_offers`, but importing `DispatchRepository` here would create a
     `DispatchModule ⇄ RidesModule` cycle needing `forwardRef`, and this is one read of one column.
  3. `writeSettledSplit(tx, rideId, split): Promise<void>` — UPDATE the four `commission_*` columns
     (`commissionPct`, `commissionSource`, `commissionCents`, `driverNetCents`) WHERE `id = $1`.
  4. `updatePaymentMethod(rideId, riderId, paymentMethod): Promise<boolean>` — ONE conditional
     UPDATE: `WHERE id = $1 AND rider_id = $2 AND status IN (PAYMENT_METHOD_EDITABLE_STATUSES)`,
     `.returning({ id })`. `false` means not-found / not-theirs / not-editable; the service
     disambiguates with a follow-up read.
  5. `revokePendingOffers(tx, rideId): Promise<{ offerId: string; driverId: string }[]>` — UPDATE
     `ride_offers SET status = 'revoked' WHERE ride_id = $1 AND status = 'pending'`
     `.returning({ offerId: rideOffers.id, driverId: rideOffers.driverId })`.
- **PATTERN**: `DispatchRepository.revokePendingForRide` (line 184) — copy its
  RETURNING-is-load-bearing docblock reasoning: the fan-out happens after commit, by which time a
  re-query finds nothing.
- **IMPORTS**: `{ rideOffers, rides, type Db }` from `@taxi/db`; `{ fareSplitSchema, type FareSplit }`
  from `@taxi/shared`; `{ and, eq, inArray }` from `drizzle-orm`; `DRIZZLE` + `DbTx` from `common/db`.
- **GOTCHA**: `ride_offers.split` is stored as the **wire** shape (`DispatchRepository.insertOffer`
  writes `offer.split` into jsonb). `fareSplitSchema` has no `Date` fields, so a plain `.parse()`
  round-trips cleanly — but parse it, never cast: the refinement is the no-cent-leak check and this
  is the one place a corrupted split would otherwise reach a driver's earnings.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #2, #3, #4

### CREATE `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts`

- **IMPLEMENT**: `@Injectable()` injecting `RideLifecycleRepository`, `RidesRepository`,
  `RideTransitionService`, `DriversService`, `RealtimeService`. Public methods:

  **`claimDriver(tx, driverId)`** — thin delegate to `DriversService.claimForRide`. Exists so
  `on_ride` has exactly one owner (the lifecycle), per `services/api/CLAUDE.md`; dispatch calls this
  rather than reaching into the drivers slice itself.

  **`driverStep(step: DriverStep, driverId, rideId)`**:
  1. `findForAction` → `NotFoundException('ride_not_found')`
  2. `ride.driverId !== driverId` → `ForbiddenException('ride_not_yours')`
  3. `const { from, to } = DRIVER_STEPS[step]`; `canTransition(ride.status, to) === false ||
     ride.status !== from` → log `transition_rejected`, throw `ConflictException(`ride_not_${from}`)`
  4. `step === 'complete'` → delegate to `complete()`; otherwise
     `this.transitions.transition(rideId, from, to)` (the convenience form — genuinely one statement,
     nothing else in flight), `undefined` → `ConflictException('ride_transition_conflict')`
  5. log `transition_applied`

  **`complete(ride, driverId)`** (private, reached only via `driverStep`):
  1. **Before** the transaction: `findAcceptedOfferSplit(rideId)`. Missing → throw a loud `Error`
     naming the invariant (both assignment paths write one; a 500 here is correct — inventing a
     split is not).
  2. `split.totalCents !== ride.totalCents` → throw a loud `Error` (the settled-vs-quote check
     `assertRideSplitConsistent` exists for).
  3. `db.transaction`: `transitionInTx(in_progress → completed)` → `undefined` = 409;
     `writeSettledSplit(tx, rideId, split)`; `driversService.releaseFromRide(driverId, tx)`.
  4. `── committed ──` `emitStatus(moved, 'in_progress')`; log `settlement_written` with all five
     money fields.
  5. Re-read via `RidesRepository.findWithQuote(rideId)` and return `{ ride }` — the driver gets the
     full fare and the commission line in the response to the tap that ended the ride. That call
     returns `undefined` when `pricingModel`/`totalCents` are null; unreachable (a ride is quoted
     before it is inserted), so throw a loud `Error` naming the invariant rather than reaching for a
     `!` or an optional chain. Same register as the missing-accepted-offer case above.

  **`cancel({ rideId, actor, actorId, reason })`**:
  1. `findForAction` → 404
  2. authorize: `rider` → `ride.riderId === actorId` else 403; `driver` → `ride.driverId === actorId`
     else 403; `dispatcher`/`admin`/`system` → no ownership check (that IS the override, S9-2)
  3. `const to = cancelledStatusFor(actor)`; `canTransition(ride.status, to) === false` → log
     `transition_rejected` (with `from`, `to`, `actor` — required by the logging standard), throw
     `ConflictException('ride_not_cancellable')`
  4. `db.transaction`: `transitionInTx(ride.status → to)` → `undefined` = 409;
     if `ride.status` ∈ `PRE_ACCEPTANCE_STATUSES` → `revoked = revokePendingOffers(tx, rideId)`;
     if `ride.driverId !== null` → `releaseFromRide(ride.driverId, tx)`
  5. `── committed ──` `emitStatus(moved, from, reason)`; for each `revoked`, `emitToDriver(…,
     RT.rideOfferRevoked, { offerId, rideId, reason: 'cancelled', at })` inside a try/catch that only
     warns; log `transition_applied`.

  **`changePaymentMethod(rideId, riderId, paymentMethod)`**:
  1. `updatePaymentMethod(...)` → `true`: log `payment_method_changed`, return the updated ride via
     `findWithQuote` (same loud-`Error`-on-`undefined` rule as `complete`).
  2. `false`: one follow-up `findForAction` to name the reason — no row or `riderId` mismatch → 404
     `ride_not_found`; `isPaymentMethodLocked(status)` → 409 `payment_method_locked`; otherwise
     (terminal) → 409 `ride_not_editable`. Log `payment_method_rejected` with `from`/`status`.

- **PATTERN**: `DispatchService.accept` (line 182) for the transaction-then-emit shape and the
  `── committed ──` marker; `RidesService.notifyRider` (line 297) for never-throw-after-commit;
  `dispatch.service.ts:402` `raiseUnclaimed` for guarded emits.
- **IMPORTS**: `{ ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException }`
  from `@nestjs/common`; `{ canTransition, isPaymentMethodLocked, RT, type FareSplit, type RideStatus }`
  from `@taxi/shared`; `DRIZZLE`, `type Db`; the policy module; `DriversService` from `'../../drivers'`
  (the barrel).
- **GOTCHA**: The write-then-disambiguate order in `changePaymentMethod` is deliberate. A
  read-then-write would let a driver's accept land between the two and change the payment method on
  an accepted ride — the exact hard-rule violation this route exists to prevent. The single
  conditional UPDATE is the lock; the second read only produces a good error message.
- **GOTCHA**: Keep the file under ~500 lines (`CLAUDE.md`). If it grows, split `complete()` into
  `ride-settlement.ts` rather than letting it sprawl.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, #2, #3, #4

### CREATE `services/api/src/features/rides/lifecycle/ride-lifecycle.controller.ts`

- **IMPLEMENT**: `@Controller('rides')`, **per-route** `@Roles` (no class-level role):
  | Route | Roles | Calls |
  |---|---|---|
  | `POST /rides/:rideId/arriving` | `driver` | `driverStep('arriving', …)` |
  | `POST /rides/:rideId/arrived` | `driver` | `driverStep('arrived', …)` |
  | `POST /rides/:rideId/start` | `driver` | `driverStep('start', …)` |
  | `POST /rides/:rideId/complete` | `driver` | `driverStep('complete', …)` → `{ ride }` |
  | `POST /rides/:rideId/cancel` | `rider`, `driver`, `dispatcher`, `admin` | `cancel(...)` |
  | `PATCH /rides/:rideId/payment-method` | `rider` | `changePaymentMethod(...)` → `{ ride }` |

  `@Param('rideId', ParseUUIDPipe)`; `@CurrentUser() user: JwtClaims`; bodies through
  `new ZodValidationPipe(rideCancelSchema | ridePaymentMethodUpdateSchema)`. The cancel actor is
  `user.role`, mapped `admin → 'dispatcher'` (an admin cancelling is a dispatcher-class override; the
  four cancelled statuses have no `admin` variant).
- **PATTERN**: `DispatchController` (whole file, 74 lines) — per-route `@Roles` on a
  multi-role controller, `ParseUUIDPipe` on the id param, identity from the JWT only, and its
  docblock explaining why the roles are per-route.
- **IMPORTS**: `{ Body, Controller, Param, ParseUUIDPipe, Patch, Post }` from `@nestjs/common`;
  `{ rideCancelSchema, ridePaymentMethodUpdateSchema, type JwtClaims, type Ride }` from `@taxi/shared`;
  `ZodValidationPipe`; `{ CurrentUser, Roles }` from `'../../auth'`.
- **GOTCHA**: two controllers share the `rides` prefix (`RidesController` is class-level
  `@Roles('rider')`). That is fine in Nest and is why the lifecycle routes need their own controller
  rather than being added to the existing one — a class-level rider role would lock the driver out of
  their own ride.
- **GOTCHA**: `@Post` returns 201 by default in Nest — the dispatch integration spec asserts
  `.expect(201)` on `POST /dispatch/offers/:id/decline` for exactly this reason. Do not add
  `@HttpCode(200)`; match the existing convention and assert 201 in the specs.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #1, #2, #3

### UPDATE `services/api/src/features/rides/rides.repository.ts`

- **IMPLEMENT**: In `toRide` (line 68):
  1. pass `paymentMethod: row.paymentMethod`;
  2. build `split` from the four columns — non-null only when **all four** are set:
     ```ts
     split:
       row.commissionPct !== null &&
       row.commissionSource !== null &&
       row.commissionCents !== null &&
       row.driverNetCents !== null
         ? { currency: 'EUR', totalCents: row.totalCents, commissionPct: row.commissionPct,
             commissionSource: row.commissionSource, commissionCents: row.commissionCents,
             driverNetCents: row.driverNetCents }
         : null,
     ```
     `rideSchema.parse` then runs `fareSplitSchema`'s sum refinement over it — a settled row that
     does not sum fails on the read, loudly, at the boundary.
- **PATTERN**: the existing `toRide` already parses rather than casts, for the stated jsonb-date
  reason; this extends the same principle to the money columns.
- **IMPORTS**: none new.
- **GOTCHA**: `row.totalCents` is `number | null` on the Drizzle row. `findWithQuote` already returns
  early when it is null (line 188), so inside that path it is non-null — but `toRide` is also called
  from `create()`, where the quote is always present. Keep the all-four-non-null guard so a partially
  written settlement can never be projected as a split.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api test -- rides`
- **SATISFIES**: AC #4

### UPDATE `services/api/src/features/rides/rides.module.ts` and `services/api/src/features/rides/index.ts`

- **IMPLEMENT**:
  - module: `imports: [PricingModule, RealtimeModule, DriversModule]`; add
    `RideLifecycleController` to `controllers`; add `RideLifecycleService`,
    `RideLifecycleRepository` to `providers`; add `RideLifecycleService` to `exports` (dispatch needs
    `claimDriver`).
  - barrel: `export { RideLifecycleService } from './lifecycle/ride-lifecycle.service';` and rewrite
    the KNOWN GAPS block — remove "#11 OWNS EVERY TRANSITION FROM `accepted` ONWARD… no
    arrive/start/complete or cancellation route exists yet", and add the new honest gaps: no
    `completed → settled` (#12), no `GET /rides/:rideId` (#16/#17), no production trigger for
    `cancelled_by_system` (#12), no cancellation-fee policy.
- **PATTERN**: `DispatchModule` (whole file) for imports+exports; the barrel's existing KNOWN GAPS
  prose style.
- **IMPORTS**: `DriversModule` from `'../drivers'`.
- **GOTCHA**: `DriversModule` imports only `RealtimeModule` — no cycle is created. Do **not** import
  `DispatchModule` here (it imports `RidesModule`); that is what Task 8's direct `ride_offers` access
  avoids.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api test`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/dispatch/dispatch.service.ts`

- **IMPLEMENT**: Inject `RideLifecycleService`. Inside `accept`'s transaction (after
  `rides.assignDriver`, before `insertAudit`) and inside `forceAssign`'s transaction (same position):
  `await this.lifecycle.claimDriver(tx, driverId);`
- **PATTERN**: the surrounding conditional writes in the same transactions.
- **IMPORTS**: add `RideLifecycleService` to the existing `'../rides'` import block.
- **GOTCHA**: the return value is `boolean` and a `false` must **not** throw. In `accept` it cannot
  realistically be false (the driver was `online` to be offered), but in `forceAssign` a `false` is
  the ordinary, correct outcome for an offline driver Dina overrode onto the ride — throwing would
  break the S9-2 override that "deliberately is NOT filtered through the eligibility rules".
- **GOTCHA**: this call goes **inside** the transaction, above the `── committed ──` marker. Nothing
  about it may emit.
- **CORRECTION (PR #60 review)**: "in `accept` it cannot realistically be false (the driver was
  `online` to be offered)" is **wrong**, and the assumption is left here rather than edited away so
  the next reader does not re-derive it. A driver whose socket drops between the offer and the tap is
  written `offline` by `clearPresenceOnDisconnect`; `acceptOffer` checks `pending` + `driverId` +
  `expiresAt` and nothing about presence, so the accept succeeds and the claim silently matches no
  row. `accept` therefore captures the boolean and logs `dispatch.assign.driver_not_claimed`. The
  residual hole — `setPresence` cannot refuse an `offline` driver going `online` mid-ride — is
  recorded in the dispatch slice's KNOWN GAPS.
- **VALIDATE**: `pnpm --filter @taxi/api test -- dispatch`
- **SATISFIES**: AC #1

### CREATE `services/api/src/features/rides/lifecycle/ride-lifecycle.service.spec.ts`

- **IMPLEMENT**: unit tests with hand-rolled fakes for the five collaborators (no database). Cover:
  - (expected) `driverStep('arrived')` on an `arriving` ride owned by the caller transitions and logs.
  - (edge) `cancel` as `system` on a `requested` ride → `cancelled_by_system`, pending offers revoked,
    `ride:offer_revoked` emitted with `reason: 'cancelled'`. **This is the only coverage
    `cancelled_by_system` gets — there is no HTTP route for it** (see Out of Scope).
  - (edge) `claimForRide` returning `false` during `forceAssign`-style acceptance does not throw.
  - (failure) `driverStep('start')` by a driver who is not `ride.driverId` → `ForbiddenException`.
  - (failure) `complete` when the accepted offer's `split.totalCents` ≠ the ride's `totalCents` →
    throws, and **no** transaction is opened.
  - (failure) `changePaymentMethod` on an `accepted` ride → `ConflictException('payment_method_locked')`.
- **PATTERN**: `dispatch.service.spec.ts` for fake collaborators;
  `ride-transition.service.spec.ts` for a faked Drizzle `transaction`.
- **IMPORTS**: `@nestjs/testing` `Test.createTestingModule` or direct `new RideLifecycleService(...)`
  — match whichever the two reference specs use.
- **GOTCHA**: assert the *ordering* invariant explicitly in at least one test: the emit fake must
  record that it was called after the transaction fake resolved. That is the "no socket emit inside a
  database transaction" rule under test, not just under review.
- **VALIDATE**: `pnpm --filter @taxi/api test -- ride-lifecycle.service`
- **SATISFIES**: AC #1, #2, #3, #4

### CREATE `services/api/src/features/rides/lifecycle/ride-lifecycle.integration.spec.ts`

- **IMPLEMENT**: full app via `createTestApp()`, `app.listen(0)`, real Postgres, sockets. Allocate
  **`+371260`** as this file's E.164 range (`+371210`/`220`/`230`/`240`/`250` are taken) with the
  same explanatory comment `rides.integration.spec.ts:22` carries. Copy dispatch's `afterEach`
  ride-retirement, `waitFor` (ride-id filtered), `rideRow`, `signIn`, `onlineDriver`, `bookRide`
  helpers.

  Tests, labelled by AC:
  1. **(expected) AC #1 — happy path over socket + REST.** Connect the rider's socket → book →
     `sweeper.tick()` → accept the pending offer → `arriving` → `arrived` → `start` → `complete`.
     Pickup is **`CENTRE_PICKUP`** (see the mode gotcha below). Assert: the rider's socket
     receives `ride:status` for each of `offered`, `accepted`, `arriving`, `arrived`, `in_progress`,
     `completed` with the right `previousStatus`; `drivers.status` is `on_ride` after accept and
     `online` after complete; the `rides` row has all four `commission_*` columns set.
  2. **(expected) AC #4 — the split.** `commissionCents + driverNetCents === totalCents` exactly,
     all integers; `commissionCents` equals the accepted `ride_offers.split.commissionCents`; the
     `POST .../complete` response body's `ride.split.totalCents` equals `ride.quote.totalCents`.
  3. **(edge) AC #2 — rider cancels pre-acceptance.** Book → tick (offer pending) → rider cancels →
     status `cancelled_by_rider`, the `ride_offers` row is `revoked`, and the offered driver's socket
     receives `ride:offer_revoked` with `reason: 'cancelled'`.
  4. **(edge) AC #2 — driver cancels post-acceptance.** After accept, driver cancels →
     `cancelled_by_driver` and `drivers.status` is back to `online`.
  5. **(edge) AC #2 — dispatcher cancels mid-ride.** After `start`, a `dispatcher` user (via
     `insertUser`) cancels an `in_progress` ride → `cancelled_by_dispatcher`. Assert a **rider**
     cannot: a rider cancel on `in_progress` → 409 `ride_not_cancellable` (the state machine allows
     only `cancelled_by_dispatcher` from `in_progress`).
  6. **(failure) AC #3 — the payment-method lock.** `PATCH /rides/:id/payment-method` succeeds while
     `requested`; after the driver accepts, the same call → **409 `payment_method_locked`**, and the
     `rides.payment_method` column is unchanged.
  7. **(failure) AC #1 — out-of-order and cross-driver.** `POST .../start` on an `accepted` ride →
     409 `ride_not_arrived`; `POST .../arrived` by a driver who is not on the ride → 403
     `ride_not_yours`; a repeated `POST .../complete` → 409.
- **PATTERN**: `dispatch.integration.spec.ts` end to end — it is the closest existing analogue and
  already solves every hard part (shared test database, ride-filtered socket waits, sweeper control).
- **IMPORTS**: `{ drivers, rideOffers, rides }` from `@taxi/db`; `{ RT, IDEMPOTENCY_KEY_HEADER,
  rideCreatedSchema, authSessionSchema, fareSplitSchema }` from `@taxi/shared`; harness helpers;
  `DispatchSweeper`.
- **GOTCHA — this one will eat an afternoon if missed**: **connect the rider's socket BEFORE
  `POST /rides`.** `RealtimeService.joinRideRoom` is
  `server.in(userRoom(riderId)).socketsJoin(rideRoom(rideId))` — it only reaches sockets that exist at
  that instant, and `RidesService.notifyRider` calls it exactly once, at creation. A rider socket
  opened *after* booking sits in `userRoom` alone and receives **zero** `ride:status` events, so every
  `waitFor` times out with nothing naming the cause. `dispatch.integration.spec.ts` never hit this
  because it only asserts on driver sockets, and `emitAssigned` re-joins the driver at assignment. Do
  **not** "fix" it by adding a re-join to production code — the ordering is the test's job.
- **GOTCHA**: use **`CENTRE_PICKUP`**, not RIX, for the happy path. RIX ships
  `queueModeEnabled: true`, and in queue mode `DispatchService.offerNext` walks `['queued','offered']`
  inside one transaction and calls `emitStatus` **once** with `previousStatus: 'requested'` — the
  `queued` hop emits nothing. The asserted `offered → accepted → …` sequence is the auto-match
  sequence; pinning the pickup to centre is what makes the assertion mean what it claims.
- **GOTCHA**: the sweeper does not auto-start under `NODE_ENV=test` — call `sweeper.tick()`
  explicitly (`services/api/CLAUDE.md`).
- **GOTCHA**: the test database is **not** reset between files. Retire this file's rides in
  `afterEach` (set them `cancelled_by_system` directly, as dispatch's spec does) or they crowd the
  sweeper's oldest-first batch and another file's test starts failing intermittently.
- **GOTCHA**: `afterEach(closeClients)` must come **before** `afterAll(() => app.close())` or jest
  hangs on open handles.
- **VALIDATE**: `pnpm --filter @taxi/api test -- ride-lifecycle.integration`
- **SATISFIES**: AC #1, #2, #3, #4

### UPDATE `services/api/CLAUDE.md`, `.claude/references/ride-state-machine.md`, `services/api/src/features/rides/index.ts`

- **IMPLEMENT**: minimal, factual edits only:
  - `services/api/CLAUDE.md`: "#11 owns everything from `accepted` onward" → describe the
    `lifecycle/` sub-slice as existing; "`drivers.status = 'on_ride'` is written only by the ride
    lifecycle (#11)" → name `RideLifecycleService.claimDriver`/`releaseFromRide` as the writers and
    state that dispatch composes `claimDriver` into its accept transaction; add one line: the settled
    split is **copied** from the accepted offer row, never recomputed.
  - `.claude/references/ride-state-machine.md`: add one line under the payment-lock bullet naming the
    route and the 409 code, and one noting `completed → settled` is #12's.
  - `features/rides/index.ts`: the rewritten KNOWN GAPS from the module task.
- **PATTERN**: both docs are terse rule-lists — match the register, add no prose.
- **GOTCHA**: `.claude/references/realtime-events.md` has a doc-sync check against `RT` in
  `realtime-events.ts`. This ticket adds no event, so that file needs **no** change — do not touch it.
- **VALIDATE**: `pnpm turbo run typecheck lint test build --force`
- **SATISFIES**: AC #6

---

## TESTING STRATEGY

Framework: **jest + ts-jest** for `services/api` (`testRegex: .*\.spec\.ts$`, `rootDir: src`,
`testTimeout: 20000`, `globalSetup` brings up Postgres); **vitest** for `packages/shared`. Tests live
beside the code they test (`services/api/CLAUDE.md`: tests mirror slices). Every feature ships
**≥1 expected + 1 edge + 1 failure** case (root `CLAUDE.md`).

### Unit Tests

`ride-lifecycle.service.spec.ts` — hand-rolled fakes for `RideLifecycleRepository`,
`RidesRepository`, `RideTransitionService`, `DriversService`, `RealtimeService`. No database, no app.
Focus on the decision logic that integration tests cannot isolate: actor→status mapping, ownership
403s, the `canTransition` 409 (including that `transition_rejected` was logged with `from`/`to`/
`actor`), the pre-transaction split checks, and the emit-after-commit ordering.

`packages/shared/tests/schemas.test.ts` — the two new body schemas and the widened `rideSchema`.

### Integration Tests

`ride-lifecycle.integration.spec.ts` — the real module graph with four providers swapped (KV,
dispatch queue, SMS, maps source), real Postgres, real Socket.IO. This is where the AC's
"happy path e2e over socket+REST" lives, and the only place the driver-status side effects and the
persisted `commission_*` columns can be asserted honestly.

`dispatch.integration.spec.ts` — unchanged, but must stay green: Task 13 adds a write inside its two
transactions.

### Edge Cases

Every one of these must have a test:

- Cancellation from each of `requested`, `offered`, `accepted`, `arriving`, `arrived`, `in_progress`
  — and the illegal combinations: rider from `in_progress` (409), driver from `requested` (403 — no
  driver on the ride yet), system from `accepted` (409 — the machine forbids it).
- A repeated `POST .../complete` → 409, not a second settlement write.
- Two concurrent `complete` calls: the conditional UPDATE means exactly one wins; the loser gets 409
  and writes no split.
- Force-assign onto an **offline** driver → `claimForRide` returns `false`, the assignment still
  succeeds, and completion's `releaseFromRide` also returns `false` without throwing (the driver
  stays `offline` throughout).
- `PATCH payment-method` on a `cancelled_by_rider` ride → 409 `ride_not_editable` (not
  `payment_method_locked` — a cancelled ride is not locked, it is over).
- A completion whose accepted offer split has a `commissionPctOverride` ≠ `platform_config`'s base:
  the persisted `commission_pct` must equal the **offer's**, proving settlement copies rather than
  recomputes.
- A `commissionPct` of `0` (the evidenced S6-7 pilot case) settles correctly —
  `commissionCents === 0`, `driverNetCents === totalCents`. Guard against a truthiness bug.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 0: Environment

```bash
cp .env.example .env                # if absent — set REDIS_PORT=6381 if 6379 is taken
docker compose up -d --wait         # postgres+postgis, redis
pnpm install
export REDIS_TEST_URL=redis://localhost:6381   # match REDIS_PORT — see below
```

**`REDIS_TEST_URL` is not optional for this ticket's sign-off.** Redis-backed suites
`describe.skip` without it, so a green run can be five tests short (root `CLAUDE.md`).

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/shared lint && pnpm --filter @taxi/api lint
pnpm --filter @taxi/shared typecheck && pnpm --filter @taxi/api typecheck
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm --filter @taxi/api test -- ride-lifecycle.service
```

### Level 3: Integration Tests

```bash
pnpm --filter @taxi/api test -- ride-lifecycle.integration
pnpm --filter @taxi/api test -- dispatch          # must stay green after Task 13
pnpm --filter @taxi/api test                      # whole api suite
```

### Level 4: The gate (CI parity)

```bash
pnpm turbo run typecheck lint test build --force
```

`pnpm check` is **not** the gate — it omits `build` and rides warm `dist` output. This ticket edits
`packages/shared`, whose `dist` every other package consumes, so a stale build is exactly the failure
mode `--force` exists to catch.

### Level 5: Manual Validation (the playbook's phase gate)

`docs/build-playbook.md` phase gate: "scripted end-to-end ride via curl/socket client: request →
match → accept → lifecycle → completed, all events observed."

```bash
pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db seed
pnpm --filter @taxi/api dev
# then, with a rider and a driver token:
#  POST /auth/otp/request + /auth/otp/verify   (rider and driver)
#  POST /drivers/me/vehicles ; PUT /drivers/me/status {"status":"online"}
#  POST /rides  (Idempotency-Key: $(uuidgen))
#  POST /dispatch/offers/<offerId>/accept
#  PATCH /rides/<rideId>/payment-method  -> expect 409 payment_method_locked
#  POST /rides/<rideId>/arriving ; /arrived ; /start ; /complete
# then confirm:
psql "$DATABASE_URL" -c \
  "select status, total_cents, commission_pct, commission_source, commission_cents, driver_net_cents,
          commission_cents + driver_net_cents = total_cents as sums
   from rides order by created_at desc limit 1;"
psql "$DATABASE_URL" -c "select status from drivers where user_id = '<driverId>';"  -- expect online
```

### Level 6: Additional Validation (optional)

```bash
pnpm --filter @taxi/api test -- --coverage   # lifecycle files should sit with the slice's peers
```

---

## ACCEPTANCE CRITERIA

Mapped to the ticket's own AC block, then the project's standing bar.

- [ ] **AC #1 — Happy path e2e over socket + REST (expected).** `accepted → arriving → arrived →
      in_progress → completed`, every change through `assertTransition()` via
      `RideTransitionService`; `ride:status` observed on the rider's socket for each hop with the
      correct `previousStatus`; no direct `rides.status` write exists anywhere in the new code.
- [ ] **AC #2 — Every cancellation branch (edge).** All four of `cancelled_by_rider`,
      `cancelled_by_driver`, `cancelled_by_dispatcher`, `cancelled_by_system` are reachable and
      tested; the actor comes from the JWT role, never a body field; a pending offer is revoked and
      its driver receives `ride:offer_revoked` with `reason: 'cancelled'`; an illegal cancel is a
      typed 409 with a `ride.lifecycle.transition_rejected` log carrying `from`, `to`, `actor`.
- [ ] **AC #3 — Post-acceptance payment-method change → typed error (failure).**
      `PATCH /rides/:rideId/payment-method` returns 409 `payment_method_locked` from `accepted`
      onward; the editable-status set is **derived from `isPaymentMethodLocked()`**, not hand-listed;
      the guard is a single conditional UPDATE, so it cannot be raced by a concurrent acceptance.
- [ ] **AC #4 — Split sums to the fare exactly, integer cents.** All four `rides.commission_*`
      columns written at completion; `commissionCents + driverNetCents === totalCents`; every value
      an integer; the persisted `commissionPct`/`commissionSource` equal the **accepted offer row's**,
      proving the driver is paid what the card showed.
- [ ] **AC #5 — Lifecycle events emitted per catalog.** Exactly `ride:status` and
      `ride:offer_revoked`. No new event name, no new payload field, no change to
      `.claude/references/realtime-events.md`.
- [ ] **AC #6 — `pnpm turbo run typecheck lint test build --force` green**, with `REDIS_TEST_URL`
      set, from a cleared `dist`.
- [ ] Every new feature ships ≥1 expected + 1 edge + 1 failure test (root `CLAUDE.md`).
- [ ] `drivers.status = 'on_ride'` is claimed at acceptance and released at completion **and at all
      four post-acceptance cancellations** — five release sites, all covered.
- [ ] Vertical slice intact: `lifecycle/` owns its routes/service/repository/policy/tests; the rides
      barrel is the only public API; no file over ~500 lines.
- [ ] No money literal, no commission literal, no hand-written status list anywhere in the diff.
- [ ] No `db/` migration generated.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully (Levels 1-4, plus Level 5 manual)
- [ ] Full test suite passes (unit + integration), with `REDIS_TEST_URL` exported
- [ ] No linting or type checking errors
- [ ] Manual playbook phase-gate ride completes and the SQL check returns `sums = true`
- [ ] Acceptance criteria all met
- [ ] `services/api/CLAUDE.md`, `.claude/references/ride-state-machine.md` and the rides barrel's
      KNOWN GAPS reflect what shipped
- [ ] Code reviewed for quality and maintainability (`code-reviewer` agent / `piv-review-changes`)
- [ ] Commit and PR follow `.claude/references/conventions.md`; PR body carries `Closes #11`

---

## OPEN QUESTIONS / ASSUMPTIONS

**Q1 — `completed → settled` is deliberately NOT implemented (needs your sign-off).**
The ticket's scope bullet lists `… → completed → settled` and the title says "→paid". This plan stops
at `completed`. Reasoning: `.claude/references/ride-state-machine.md` defines `settled` as "money
movement finished (ledger entries written)", #12's AC is "card ride settles with correct ledger
entries", and #11's own acceptance criteria never mention `settled`. Transitioning to `settled` with
zero ledger rows makes the status false for every ride until #12 ships, and #12 would then have to
un-ship it. **If you want `settled` reachable in this ticket anyway, say so** — it is ~30 lines (a
`POST /rides/:rideId/settle` or an auto-hop inside `complete`), but the plan recommends against it.

**Q2 — `arriving` is a separate driver-initiated step, not automatic on accept.**
The machine has no `accepted → arrived` edge, so something must traverse `arriving`. This plan gives
it its own route rather than auto-hopping inside `arrived` (the way `forceAssign` walks `requested →
offered → accepted`). Rationale: `arriving` is a real, distinct thing to show a waiting rider ("your
driver is on the way"), and hiding it would make #17's tracking screen poorer. #15's driver app may
choose to fire it automatically on accept-confirmation — that is a client decision, and the API
supports either. If you'd rather the API auto-hop, it's a one-line change in `DRIVER_STEPS`.

**Q3 — an `admin` cancelling maps to `cancelled_by_dispatcher`.**
There is no `cancelled_by_admin` status and adding one is a shared-contract + database-enum change
this ticket should not make. `dispatcher` is the closest true statement (an admin doing a
dispatcher's job). The audit answer is #20's admin audit view, not a fifth status.

**Assumptions this plan makes:**

1. Every accepted ride has exactly one `ride_offers` row at `status = 'accepted'`. Verified by
   reading both paths: `DispatchService.accept` → `DispatchRepository.acceptOffer` (conditional flip)
   and `forceAssign` → `insertOffer(status: 'accepted')`. A missing row is treated as a loud 500,
   not a recoverable case.
2. `platform_config.commissionPct` and `drivers.commission_pct_override` may legitimately change
   mid-ride (#20 will make this routine), which is the whole reason settlement copies.
3. No app consumes `rideSchema` yet (grep confirms: only `rides.repository.ts` and the shared tests),
   so widening it with `paymentMethod` breaks nothing outside this diff.
4. `rides.updated_at` is maintained entirely by the `rides_set_updated_at` trigger (migration
   `0003`) — the lifecycle writes must **not** set it in JS.
5. The pilot's ≤10 drivers means the extra per-action reads (one light ride SELECT, one offer SELECT
   at completion) need no caching or batching.

---

## NOTES (open canvas)

### The settlement decision, in full

Three options were on the table for where the settled split comes from:

| Option | How | Verdict |
|---|---|---|
| **A. Copy the accepted offer's `split` jsonb** | one SELECT of one column at completion | ✅ **chosen** |
| B. Re-resolve at completion (`resolveCommissionPct` + `splitFare`) | mirrors `buildOffer` exactly, no cross-slice read | ❌ rejected |
| C. Copy the split onto `rides.commission_*` at acceptance | no completion-time read at all | ❌ rejected |

**B** is the one that looks cheapest and is wrong. `buildOffer` resolves **per driver**
(`offer-builder.ts:53`, using `driverAttrs.commissionPctOverride`), so any admin edit to that
override or to `platform_config.commission_pct` between acceptance and completion changes what the
driver is paid relative to the card they said yes to. `assertRideSplitConsistent` cannot catch it
(`totalCents` is identical either way), so the divergence would be silent — and "the number you were
shown is not the number you got" is precisely the €200→€130 grievance the whole venture is a response
to (PRD §1, S2-4/S2-5).

**C** was rejected because `db/src/schema/rides.ts:51` documents those four columns as "The settled
split — all four written at completion (#11), null until then", and
`RidesRepository.create`'s docblock adds that writing a preview into them "would make an estimate look
like a settlement". A ride that is cancelled after acceptance would carry a settled split for money
that never moved.

**A**'s only cost is a rides→`ride_offers` read across a slice boundary, resolved by putting it in
`ride-lifecycle.repository.ts` with a docblock rather than by importing `DispatchRepository` (which
would need `forwardRef` — `DispatchModule` already imports `RidesModule`).

### Why cancellation revokes offers

At `requested`/`offered`/`queued` a pending offer may be sitting on a driver's phone. Without the
revoke, the failure is **not** data corruption — `DispatchRepository.acceptOffer` is conditional on
`status = 'pending'` and `transitionInTx` is conditional on `status = 'offered'`, so a late accept
gets a clean 409. The failure is UX: the driver's card sits there until `expiresAt`, they tap it, and
they get an error. `ride:offer_revoked`'s `reason: 'cancelled'` has existed in the catalog since #2
with no producer; this is it.

Note the deliberate asymmetry with #10: `DispatchService.decline` explicitly does **not** emit
`ride:offer_revoked` to the decliner, because "`cancelled` would read on #15 and Dina's board as the
RIDER cancelling". Here it *is* the rider cancelling, so the reason is finally accurate.

### The five driver-release sites

The easiest way to half-ship this ticket is to release `on_ride` at completion and forget the
cancellations. Enumerated so the implementer can tick them off:

1. `complete` — `in_progress → completed`
2. `cancel` from `accepted`
3. `cancel` from `arriving`
4. `cancel` from `arrived`
5. `cancel` from `in_progress` (dispatcher only)

Implementation shortcut that covers all five without a status list: in `cancel`, release whenever
`ride.driverId !== null`. `releaseFromRide` is itself conditional on `status = 'on_ride'`, so a
pre-acceptance cancel (no driver) and a force-assigned-offline driver both no-op correctly. **One
line, five sites.**

### Data-flow sketch — completion

```
POST /rides/:id/complete  (driver JWT)
   │
   ├─ findForAction(rideId) ──────────── 404 / 403 / 409 ride_not_in_progress
   ├─ findAcceptedOfferSplit(rideId) ─── 500 if absent  ┐  BOTH before the tx:
   └─ split.totalCents === ride.totalCents ── 500 if not ┘  nothing is written on a bad split
        │
        ▼  db.transaction
        ├─ transitionInTx(in_progress → completed)   ── undefined ⇒ 409, rollback
        ├─ writeSettledSplit(tx, rideId, split)      ── rides.commission_{pct,source,cents} + driver_net_cents
        └─ drivers.releaseFromRide(driverId, tx)     ── on_ride → online (false is fine)
        │
        ▼  ── committed ──
        ├─ emitStatus(ride, 'in_progress')           ── ride:status to the ride room (never throws)
        ├─ log ride.lifecycle.settlement_written
        └─ return { ride }   ← findWithQuote, now projecting quote + settled split
```

### Sequencing / parallelism

Phases 1 and 2 are independent and could run in either order. Phases 3→4→5 are strictly sequential.
Per `docs/build-playbook.md`'s hygiene rule ("never two execute sessions in the same package"), this
ticket should hold `services/api` alone — #18 (dispatch console) is the epic's parallel partner for
this wave and lives in `apps/dispatch`.

### Risks

- **Highest**: forgetting a driver-release site, or releasing outside the transaction. Mitigated by
  the one-line shortcut above and by integration test #4.
- **Medium**: the integration spec is the fifth file sharing one un-reset test database. Use the
  `+371260` range and retire this file's rides in `afterEach`, or you will get intermittent failures
  in *other* files and spend an afternoon on it.
- **Medium**: `rideSchema` gaining a required field is a contract change — the compiler catches
  `toRide`, but check `pnpm turbo run build --force` rather than `pnpm check`, or a stale `dist`
  hides it.
- **Low**: `changePaymentMethod`'s two-query error disambiguation. It is a race only for the *error
  message*, never for the lock, because the lock is the conditional UPDATE.

### Confidence

**9.5/10** for one-pass success. The slice is large but every mechanism it needs already exists and
is documented in place: the guarded transition writer, the post-commit emit discipline, the
conditional-UPDATE guard, the offer split snapshot, the test harness, and the reference docs. The
open question that could send it back is Q1 (`settled`), which is flagged rather than guessed.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty until this plan has been executed. -->
