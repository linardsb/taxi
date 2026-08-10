# Feature: Close the double-assignment hole (#61)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Two reachable chains still let one driver end up committed to two rides at once, even after #11's
`on_ride` claim. This ticket closes both:

- **Chain A — presence lost mid-offer.** A driver whose socket drops mid-offer is written `offline`
  by `clearPresenceOnDisconnect`. They reconnect, accept before expiry (nothing in `acceptOffer`
  checks presence), and the `on_ride` claim — conditional on `status = 'online'` — matches nothing.
  The `driver_on_ride` guard in `setPresence` tests `profile.status === 'on_ride'`, but they are
  `offline`, so nothing stops them tapping "go online" mid-ride and getting a second car next tick.
  **Fix:** gate going `online` on "no live post-acceptance ride" — decided by the **rides table**,
  not `drivers.status`, so the chain-A driver is caught.

- **Chain B — two live offers.** Nothing in candidate selection excludes a driver already holding a
  pending offer on a *different* ride (the `tried` set is per-ride). Two `requested` rides, one
  online driver → both offered, both accepted. **Fix:** exclude drivers holding any live pending
  offer from candidate selection — one card per driver, platform-wide.

## User Story

As a **rider** (and as Dina, the dispatcher)
I want **a driver to be committed to at most one ride at a time**
So that **an accepted ride is never silently starved by a second assignment to the same car**.

## Problem Statement

`drivers.status` is a derived cache of the driver's ride state, and chains A and B are the two
places where the cache and the truth (the `rides` / `ride_offers` tables) diverge. Every guard that
reads only `drivers.status` inherits that divergence.

## Solution Statement

Put the two guards on the durable truth instead:

1. `setPresence('online')` refuses (409 `driver_on_ride`) while a ride with `driver_id = driver`
   sits in an active post-acceptance status. The check lives **inside the UPDATE's WHERE** (the
   repo's established L8 pattern — see `setOnlineIfHasVehicle`), with a follow-up read only to pick
   the right 409 message (the payment-lock pattern from `ride-lifecycle.repository.ts`).
2. `offerNext` skips candidates already holding a live pending offer on any ride, exactly the way
   it already skips the per-ride `tried` set. The sweeper is single-flight and processes awaiting
   rides sequentially, so query-time exclusion is race-free within a tick.

The "active post-acceptance" status set becomes a shared state-machine constant so it cannot rot
apart from `ALLOWED_TRANSITIONS`.

## Out of Scope / Non-Goals

- **Not adding an accept-time guard.** `accept` still does not re-check the driver's ride state
  inside its transaction, so a force-assign (HTTP) committing in the milliseconds between
  `offerNext`'s busy-set read and its offer insert can still hand a committed driver a card. Single
  process + sequential sweeper makes this window ms-wide; it goes in KNOWN GAPS, not in code.
  (Flagged in Open Questions — confirm you accept this residual.)
- **Not changing force-assign.** Dina overriding onto a busy/offline driver stays deliberately
  unfiltered (S9-2); the audit row is what makes that safe.
- **Not touching the stranded-`in_progress`-driver gap** (PR #60 review Low 7) — separate concern.
- **Not widening `claimForRide`'s WHERE** to `status <> 'on_ride'` — the issue explicitly rules
  this out: `releaseFromRide` would then put a legitimately-offline force-assigned driver `online`
  at completion (the S9-2 case the `online`-only guard exists for).
- **Not building zone-entry queue enrollment, `reassign`, or `cancel`** — other KNOWN GAPS bullets.

## Feature Metadata

**Feature Type**: Bug Fix (closing a documented known gap)
**Estimated Complexity**: Medium
**Primary Systems Affected**: `packages/shared` (one constant), `services/api` drivers slice,
`services/api` dispatch slice, two reference docs
**Dependencies**: none new — drizzle-orm's `notExists` (already a dependency; `exists` is in use)

## Related Work

**Implements**: [#61](https://github.com/linardsb/taxi/issues/61) — deferred from PR #60 review
(`.claude/code-reviews/pr-60-review.md`, Medium 3). The small half (the `driver_not_claimed` warn +
KNOWN GAPS line) shipped with #11; this is the real fix. · **Epic**: no epic engineering plan —
descends from #10 (dispatch engine) and #11 (ride lifecycle); architecture context in
`docs/epics/sakta-cab.architecture.md` (nothing there is re-decided here).

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/api-dispatch-engine.md` - Why: owns the offer model, sweeper, strategies, `tried` set
- `.claude/plans/api-ride-lifecycle.md` - Why: owns `claimDriver`/`releaseFromRide` and the `on_ride` semantics
- `.claude/plans/api-drivers-slice.md` - Why: owns `setPresence` and the two-store presence discipline

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `services/api/src/features/drivers/drivers.repository.ts` (lines 140-211) - Why:
  `setOnlineIfHasVehicle` is the method being extended; its docblock documents the L8
  check-inside-the-UPDATE pattern you must follow. `claimForRide` (204) shows the guard you must NOT widen.
- `services/api/src/features/drivers/drivers.service.ts` (lines 75-147) - Why: `setPresence` is the
  edit site; note the deliberate Postgres/Redis write ordering (throw BEFORE `markOnline`) and the
  existing `driver_on_ride` fast-path guard at 84-85, which stays.
- `services/api/src/features/dispatch/dispatch.service.ts` (lines 71-175) - Why: `offerNext` and the
  `tried` set at 113-114 — the exact pattern the busy-set exclusion mirrors. Lines 231-243: the
  `driver_not_claimed` warn comment that needs updating.
- `services/api/src/features/dispatch/dispatch.repository.ts` (lines 107-120) - Why: `findOverdue`
  is the pattern for the new query — Postgres `now()` in expiry predicates, never a JS Date.
- `services/api/src/features/dispatch/dispatch.sweeper.ts` (lines 74-121) - Why: proves ticks are
  single-flight and awaiting rides are processed sequentially — the argument for query-time
  exclusion being race-free within a tick.
- `packages/shared/src/ride-state-machine.ts` - Why: where the new constant lands; mirror
  `CANCELLED_STATUSES` (lines 20-25) in style.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts` (lines 100-135) - Why:
  the payment-lock UPDATE is the precedent for "conditions in the WHERE, follow-up read only to
  pick the error message — racing the read costs a wrong message, never a wrong write".
- `services/api/src/features/payments/settlement.repository.ts` (line 2) - Why: precedent for a
  slice repository importing the `rides` table from `@taxi/db` (cross-slice **read**; avoids a
  circular DriversModule → RidesModule import — RidesModule already imports DriversModule).
- `services/api/src/features/dispatch/index.ts` (lines 22-37) - Why: the KNOWN GAPS bullet this
  ticket closes; rewrite it, don't append.
- `services/api/src/features/dispatch/dispatch.integration.spec.ts` (lines 53-230 harness;
  235-331 AC #1-#2; 566-588 the "never offers to an offline driver" template) - Why: harness
  helpers (`onlineDriver`, `bookRide`, `pendingOffer`, `rideRow`, per-file phone namespace
  `+371250`, `createdRides`/`usedDrivers` cleanup) and the accept/decline HTTP calls to mirror.
- `services/api/src/features/drivers/drivers.integration.spec.ts` (lines 261-272, 385-402) - Why:
  the `vehicle_required` and `driver_on_ride` 409 tests the new tests sit beside; the
  direct-DB-write technique (389-392) for states no route can produce.
- `packages/shared/tests/ride-state-machine.test.ts` - Why: test style for the constant's
  consistency test.
- `db/src/schema/rides.ts` (lines 30-84) - Why: NOT NULL columns for the hand-inserted ride row in
  the drivers spec (`orderId`, `status`, `riderId`, `request`, `paymentMethod`, `category`);
  `rides_driver_idx` + `rides_status_idx` already exist, so no migration.

### New Files to Create

None. Every change lands in existing files — this is a gap-closing fix, not a new slice.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `.claude/references/dispatch-strategies.md` - the offer model this extends (gets a one-line update)
- `.claude/references/ride-state-machine.md` - semantics of the statuses; `completed` is the
  physical end (driver already released) which is why it is NOT in the active set
- `.claude/references/logging-standard.md` - if you add any log line: `domain.component.action_state`,
  ids always, no free text, no coordinates
- `services/api/CLAUDE.md` - the presence/claim rules bullet (gets a one-clause update)

### Patterns to Follow

**Check inside the UPDATE, not before it (L8):** from `drivers.repository.ts:151-170` —

```ts
const [row] = await this.db
  .update(drivers)
  .set({ status: 'online' })
  .where(and(eq(drivers.userId, userId), exists(/* vehicles subquery */)))
  .returning();
return row ? toProfile(row) : undefined;
```

**Follow-up read only for the error message:** `ride-lifecycle.repository.ts` payment lock — the
WHERE decides; a second read picks between 409 codes; racing it costs a wrong message, never a
wrong write.

**Per-ride exclusion set:** `dispatch.service.ts:113-114` —

```ts
const tried = new Set(await this.offers.findTriedDriverIds(ride.id));
const candidate = candidates.find((c) => !tried.has(c.driverId));
```

**Postgres clock for offer liveness:** `dispatch.repository.ts:108-120` — `expires_at` compared to
`sql`now()``, never `new Date()`.

**Error taxonomy:** preconditions answer typed 409s (`ConflictException('driver_on_ride')`),
matching the existing client contract — the driver app already handles `driver_on_ride`.

**Test naming:** `it('… (expected|edge|failure)')` with the parenthetical category; each slice
change ships ≥1 expected + 1 edge + 1 failure across the affected suites.

---

## IMPLEMENTATION PLAN

### Phase 1: Shared contract — the active-status set

**Tasks:**

- Add `ACTIVE_DRIVER_RIDE_STATUSES` to `packages/shared/src/ride-state-machine.ts`
- Pin it with a consistency test against the machine

### Phase 2: Chain A — the presence gate (drivers slice)

**Depends on:** Phase 1 (imports the constant)

**Tasks:**

- Extend the go-online UPDATE with a `notExists` rides subquery; rename to `setOnlineIfEligible`
- Add the `hasActiveRide` follow-up read
- Pick between `driver_on_ride` / `vehicle_required` in `setPresence`
- Integration tests: gate fires (failure), `completed` does not block (edge)

### Phase 3: Chain B — one live card per driver (dispatch slice)

**Independent of:** Phase 2 (different slice, different chain — parallelizable if desired; both
depend on nothing in each other)

**Tasks:**

- Add `findDriverIdsWithLiveOffers` to `DispatchRepository`
- Exclude that set in `offerNext`, beside `tried`
- Integration tests: second card withheld + liveness after decline; chain A end-to-end
- Keep AC #2's mode-switch proof honest (surgical one-statement edit)

### Phase 4: Docs & KNOWN GAPS truth

**Depends on:** Phases 2-3 (documents what they shipped)

**Tasks:**

- Rewrite the dispatch barrel's double-assignment KNOWN GAPS bullet
- Update the stale comment above the `driver_not_claimed` warn in `accept`
- One clause in `services/api/CLAUDE.md`, one line in `dispatch-strategies.md`

### Phase 5: Validation

**Tasks:**

- Full gate with Redis suites enabled; confirm no existing suite trips the new gate

---

## STEP-BY-STEP TASKS

### UPDATE `packages/shared/src/ride-state-machine.ts`

- **IMPLEMENT**: below `CANCELLED_STATUSES`, add:

  ```ts
  /**
   * Statuses in which a ride has a driver actively committed to it — from
   * acceptance until the physical end of the ride. `completed` is NOT here:
   * the driver is released inside `complete()` (#11), so a completed-but-
   * unsettled ride must not pin them offline. #61 gates going online on this
   * set, read from the rides table — `drivers.status` is a derived cache and
   * chain A is exactly the case where the cache lies.
   */
  export const ACTIVE_DRIVER_RIDE_STATUSES = [
    'accepted',
    'arriving',
    'arrived',
    'in_progress',
  ] as const satisfies readonly RideStatus[];
  ```

- **PATTERN**: `CANCELLED_STATUSES` at `ride-state-machine.ts:20-25` (same `as const satisfies` form)
- **IMPORTS**: none; already exported via `export * from './ride-state-machine'` in `src/index.ts`
- **GOTCHA**: do NOT hand-write a twin list in the api — this constant exists so the api can't rot
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #1 (gate decided by ride state)

### UPDATE `packages/shared/tests/ride-state-machine.test.ts`

- **IMPLEMENT**: one test pinning the set to the machine rather than to itself:

  ```ts
  it('active-driver statuses are the non-terminal payment-locked ones minus completed (#61)', () => {
    expect(ACTIVE_DRIVER_RIDE_STATUSES).toEqual(
      RIDE_STATUSES.filter(
        (s) => isPaymentMethodLocked(s) && !isTerminal(s) && s !== 'completed',
      ),
    );
  });
  ```

  Payment lock starts at acceptance (Atis's rule) and `completed` is excluded because
  `releaseFromRide` runs inside `complete()` — the filter derivation IS the semantic claim, so a
  new status added to the machine forces a conscious decision here.
- **PATTERN**: `ride-state-machine.test.ts` — 'terminal and cancelled states are consistent' (line 45)
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/drivers/drivers.repository.ts`

- **IMPLEMENT**: (1) extend `setOnlineIfHasVehicle`'s WHERE with a second precondition and rename
  it `setOnlineIfEligible` (the old name would lie — it no longer checks only the vehicle):

  ```ts
  async setOnlineIfEligible(userId: string): Promise<DriverProfile | undefined> {
    const [row] = await this.db
      .update(drivers)
      .set({ status: 'online' })
      .where(
        and(
          eq(drivers.userId, userId),
          exists(
            this.db
              .select({ one: sql`1` })
              .from(vehicles)
              .where(eq(vehicles.driverId, userId)),
          ),
          // #61 chain A: the rides table decides, not `drivers.status` — an
          // offline driver who accepted mid-disconnect has a live ride and no
          // `on_ride` status. Inside the WHERE (L8), so an accept landing
          // between a read and this write cannot slip through.
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(rides)
              .where(
                and(
                  eq(rides.driverId, userId),
                  inArray(rides.status, [...ACTIVE_DRIVER_RIDE_STATUSES]),
                ),
              ),
          ),
        ),
      )
      .returning();
    return row ? toProfile(row) : undefined;
  }
  ```

  (2) add the follow-up read used only to pick the 409 message:

  ```ts
  /** Follow-up read for the error message ONLY — the WHERE above decides. */
  async hasActiveRide(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql`1` })
      .from(rides)
      .where(
        and(
          eq(rides.driverId, userId),
          inArray(rides.status, [...ACTIVE_DRIVER_RIDE_STATUSES]),
        ),
      )
      .limit(1);
    return row !== undefined;
  }
  ```

- **PATTERN**: L8 subquery-in-UPDATE — `drivers.repository.ts:151-170`; error-message read —
  `ride-lifecycle.repository.ts` payment lock
- **IMPORTS**: add `rides` to the `@taxi/db` import (precedent: `settlement.repository.ts:2`);
  add `notExists` to the `drizzle-orm` import; add `ACTIVE_DRIVER_RIDE_STATUSES` from `@taxi/shared`
- **GOTCHA**: `inArray` rejects a `readonly` tuple — spread it (`[...ACTIVE_DRIVER_RIDE_STATUSES]`).
  Extend the existing docblock (which explains L8) rather than replacing it. `rides_driver_idx` and
  `rides_status_idx` already exist — no migration.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/drivers/drivers.service.ts`

- **IMPLEMENT**: in `setPresence`'s online branch (lines 90-101), rename the call and split the
  409 on the follow-up read:

  ```ts
  const online = await this.drivers.setOnlineIfEligible(userId);
  if (!online) {
    // The UPDATE said no; this read only picks the message. #61 chain A: an
    // active ride outranks a missing vehicle — that driver is mid-ride, and
    // `vehicle_required` would send them to the garage instead of the ride.
    throw new ConflictException(
      (await this.drivers.hasActiveRide(userId))
        ? 'driver_on_ride'
        : 'vehicle_required',
    );
  }
  updated = online;
  await this.locations.markOnline(cityId, userId);
  ```

  Leave the `profile.status === 'on_ride'` fast-path guard (84-85) untouched — it still guards the
  offline direction and stays the cheap first gate. Extend its comment: chain A's driver is
  `offline` with a live ride, which is what the rides-table check below it catches.
- **PATTERN**: existing branch structure at `drivers.service.ts:90-105`; the throw stays BEFORE
  `markOnline` so a refusal never touches Redis (the deliberate two-store ordering)
- **GOTCHA**: reuse the `driver_on_ride` message — same client contract as the existing guard; do
  not mint a new error code
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #1, AC #2

### UPDATE `services/api/src/features/drivers/drivers.integration.spec.ts`

- **IMPLEMENT**: two tests beside 'refuses a presence toggle while on_ride' (line 385), using the
  direct-DB-write technique for states no route can produce:

  1. **(failure)** `refuses to go online for an offline driver with a live accepted ride (#61 chain A)`:
     `driver(n)` + `addCar`, sign in a rider (`signIn(p(m), 'rider')`) for the FK, insert a ride row
     directly (`orderId: randomUUID()`, `status: 'accepted'`, `riderId`, `driverId: d.id`,
     `request: {}` (minimal jsonb — never parsed on this path), `paymentMethod: 'cash'`, `category: 'standard'`), driver status
     stays `offline` → `PUT /drivers/me/status {status:'online'}` → expect 409, message
     `driver_on_ride`; assert `(await d.row())!.status` still `'offline'` and
     `ctx.locations.isOnline(cityId, d.id)` false. Retire the ride at the end of the test
     (`status: 'cancelled_by_system'`) — this file has no `createdRides` afterEach.
  2. **(edge)** `lets a driver back online once their ride is completed but unsettled (#61)`: same
     setup with `status: 'completed'` → PUT online → expect 200; retire the ride row after.

- **PATTERN**: harness at lines 29-88 (`driver(n)`, `addCar`, `d.row()`); direct write at 389-392;
  category values are `['standard','fastest','limo','vip']` (`RIDE_CATEGORIES`)
- **IMPORTS**: add `rides` to the spec's `@taxi/db` import; `randomUUID` from `node:crypto` if not present
- **GOTCHA**: pick unused phone numbers — grep the file for `driver(` / `p(` first (namespace
  `+371220`). The `request` jsonb is never parsed on this path, so a minimal object is fine.
- **VALIDATE**: `pnpm --filter @taxi/api test -- src/features/drivers/drivers.integration.spec.ts`
- **SATISFIES**: AC #1, AC #2, AC #5

### UPDATE `services/api/src/features/dispatch/dispatch.repository.ts`

- **IMPLEMENT**: one read, below `findOverdue`:

  ```ts
  /**
   * Drivers currently holding a LIVE card on any ride — #61 chain B: one card
   * per driver platform-wide. Liveness matches `acceptOffer`'s predicate
   * (`pending` + unexpired, by Postgres's clock), so a card this query counts
   * is exactly a card its holder could still accept.
   */
  async findDriverIdsWithLiveOffers(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ driverId: rideOffers.driverId })
      .from(rideOffers)
      .where(
        and(
          eq(rideOffers.status, 'pending'),
          sql`${rideOffers.expiresAt} > now()`,
        ),
      );
    return rows.map((r) => r.driverId);
  }
  ```

- **PATTERN**: `findOverdue` (107-120) — status + Postgres-clock predicate; `findTriedDriverIds`
  (91-97) — ids-only projection
- **GOTCHA**: no ride-id filter, deliberately: the sweeper only calls `offerNext` for rides with no
  pending offer, and this ride's past offers are already in `tried`. Keep it global and simple.
  Pilot scale needs no new index (`findOverdue` already scans the same shape).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3

### UPDATE `services/api/src/features/dispatch/dispatch.service.ts`

- **IMPLEMENT**: in `offerNext`, beside the `tried` set (113-114):

  ```ts
  // One shot per driver per ride, or the cascade would re-offer to whoever
  // just declined.
  const tried = new Set(await this.offers.findTriedDriverIds(ride.id));
  // One LIVE card per driver across all rides (#61 chain B) — a driver already
  // deciding on one offer must not be holding a second. A skip is a wait, not
  // a ban: the card resolves within `offerTimeoutSeconds` and the next tick
  // re-reads the world.
  const busy = new Set(await this.offers.findDriverIdsWithLiveOffers());
  const candidate = candidates.find(
    (c) => !tried.has(c.driverId) && !busy.has(c.driverId),
  );
  ```

  Also update the stale comment above the `driver_not_claimed` warn (231-234): after #61 the warn's
  reachable trigger in `accept` is the ms seam where a force-assign lands between `offerNext`'s
  busy-set read and its insert — "Narrowed by this PR, not closed" is no longer the story.
- **PATTERN**: the `tried` exclusion it sits beside — same shape, same placement
- **GOTCHA**: do NOT put this in `toCandidates` — that is a pure attribute filter shared by both
  strategies, and holding-a-card is cascade state, which `offerNext` already owns (`tried`). Do NOT
  touch `forceAssign` — bypassing eligibility is Dina's feature. When every candidate is busy the
  existing `raiseUnclaimed` path is the correct outcome (nobody offerable NOW; dedupe bounds the
  noise; the ride stays `requested` and retries next tick).
- **VALIDATE**: `pnpm --filter @taxi/api test -- src/features/dispatch/dispatch.service.spec.ts`
  (no harness change needed — `offerNext` is not unit-tested there and the `offers` mock is not
  reached; integration covers the new path against real Postgres)
- **SATISFIES**: AC #3

### UPDATE `services/api/src/features/dispatch/dispatch.integration.spec.ts`

- **IMPLEMENT**: three edits.

  1. **(edge)** `never deals a second card to a driver already holding one (#61 chain B)`: one
     `onlineDriver`, two `bookRide`s (same pickup), one `sweeper.tick()`. Assert: ride A has a
     pending offer for the driver; `await pendingOffer(rideB.id)` is `undefined`;
     `(await rideRow(rideB.id)).status` is `'requested'`. Then prove the skip is a wait, not a ban:
     decline ride A's offer over HTTP (mirror AC #1's decline call), `tick()` again, assert ride B
     now has a pending offer for that driver (ride A goes to unclaimed — its `tried` set is spent —
     which is fine and already deduped).
  2. **(failure)** `refuses to go online for a driver who accepted while offline (#61 chain A)`:
     `onlineDriver` + `bookRide` + `tick()` → pending offer. Then replay the chain exactly:
     `await ctx.app.get(DriversService).clearPresenceOnDisconnect(d.id)` (what the location
     gateway's `handleDisconnect` calls — status → `offline`), accept the offer over HTTP (mirror
     AC #1's accept call — it succeeds; that is the hole), then
     `PUT /drivers/me/status {status:'online'}` → expect 409 `driver_on_ride`. Assert
     `drivers.status` is still `'offline'` and the location store shows them offline — mid-ride, a
     lost socket must not resurrect them as a candidate.
  3. **Keep AC #2 honest (surgical)**: the busy exclusion gives the test's second half a second
     reason to pick `nearD` (queuedD still holds the first half's live card), which silently
     defeats its "if both halves returned the same driver, the mode never switched" proof. After
     the first half's assertions (line 315), retire the card so the proof stands on mode alone:

     ```ts
     // Clear queuedD's live card, or #61's one-card rule — not the mode switch —
     // would hand the second half to nearD.
     await ctx.db
       .update(rideOffers)
       .set({ status: 'revoked' })
       .where(eq(rideOffers.id, queueOffer!.id));
     ```

- **PATTERN**: 'never offers a ride to an offline driver (edge)' (566-588) for shape; AC #1
  (235-296) for the accept/decline HTTP calls; `createdRides`/`usedDrivers` cleanup is automatic
  via the harness helpers
- **IMPORTS**: `DriversService` from `../drivers` for test 2
- **GOTCHA**: pick unused rider/driver numbers (grep `onlineDriver(` and `bookRide(` — namespace
  `+371250`). In test 1 book ride A strictly before ride B — `findAwaitingDispatch` is
  oldest-first and the assertions assume A is dealt first.
- **VALIDATE**: `pnpm --filter @taxi/api test -- src/features/dispatch/dispatch.integration.spec.ts`
- **SATISFIES**: AC #3, AC #4, AC #5

### UPDATE `services/api/src/features/dispatch/index.ts`

- **IMPLEMENT**: rewrite the third KNOWN GAPS bullet (lines 22-37). It currently documents the open
  hole; after this ticket it must document the closed state and the accepted residual:

  ```
  - DOUBLE-ASSIGNMENT IS CLOSED AT BOTH ENDS (#61), WITH ONE ms-WIDE SEAM
    ACCEPTED. Going online is gated on "no live post-acceptance ride" read from
    the RIDES table (`setOnlineIfEligible`), so the offline-mid-offer driver of
    chain A is caught where `drivers.status` lies; and `offerNext` skips
    candidates already holding a live card anywhere (chain B) — one card per
    driver, platform-wide. What remains: `accept` never re-checks the driver's
    ride state inside its transaction, so a force-assign committing between
    `offerNext`'s busy-set read and its insert — or a go-online racing an
    in-flight accept — can still briefly double-commit a driver. Sequential
    single-process sweeper makes that window milliseconds at pilot scale;
    `dispatch.assign.driver_not_claimed` is the tripwire, and an accept-time
    guard is the full fix if it ever fires in the wild.
  ```

- **PATTERN**: the surrounding bullets' voice — state the decision and the cost, no hedging
- **VALIDATE**: `pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #6

### UPDATE `services/api/CLAUDE.md` + `.claude/references/dispatch-strategies.md`

- **IMPLEMENT**: (1) in the api CLAUDE.md bullet on `drivers.status`/presence (the one ending
  "…accepts `online`/`offline` only (`DRIVER_PRESENCE_STATUSES`)"), append: "Going online is
  additionally refused (409 `driver_on_ride`) while the driver has a ride in
  `ACTIVE_DRIVER_RIDE_STATUSES` — the rides table decides, not `drivers.status` (#61)." (2) in
  `dispatch-strategies.md`'s auto_match section, after the debt-limit paragraph: "**One live card
  per driver, platform-wide** (#61): a candidate already holding a pending unexpired offer on any
  ride is skipped this round — a skip is a wait, not a ban."
- **GOTCHA**: two sentences total; these files are rules, not changelogs
- **VALIDATE**: proofread; no build step
- **SATISFIES**: AC #6

### Final validation sweep

- **IMPLEMENT**: full gate from a clean slate; watch specifically for suites that put a driver
  online AFTER that driver holds an active ride (the new gate's blast radius). Every integration
  file retires its rides to `cancelled_by_system` (terminal → not in the active set) and namespaces
  its phone numbers, so nothing should trip — but the gate run is the proof, not this sentence.
- **VALIDATE**: see VALIDATION COMMANDS
- **SATISFIES**: AC #5

---

## TESTING STRATEGY

### Unit Tests

- `packages/shared/tests/ride-state-machine.test.ts` — the constant is pinned to a derivation from
  the machine (`isPaymentMethodLocked && !isTerminal && !== 'completed'`), not to a copy of itself,
  so adding a status forces a conscious re-decision.
- No new unit tests in `dispatch.service.spec.ts`: `offerNext` is not unit-tested there (its
  harness short-circuits before candidates), and building that harness out for one filter would
  duplicate what the integration suite proves against real Postgres. The `offers` mock does not
  need the new method — no mock leak (#74's lesson checked).

### Integration Tests

- **Chain A, unit-ish** (drivers suite): the paradox state (offline + live accepted ride) is
  hand-inserted; the gate answers 409 and both presence stores stay offline.
- **Chain A, end-to-end** (dispatch suite): offer → `clearPresenceOnDisconnect` → accept (succeeds;
  the hole) → go online → 409. Replays the issue's five-step chain exactly.
- **Chain B** (dispatch suite): two rides, one driver, one tick → exactly one live card; plus the
  liveness half — decline resolves the card and the next tick deals ride B to the same driver.
- **Non-regression**: AC #2's mode-switch proof restored by revoking the first half's card.

### Edge Cases

- Driver with a `completed`-but-unsettled ride goes online fine (the set excludes `completed` —
  the driver was released inside `complete()`).
- All candidates busy → existing `raiseUnclaimed` path (deduped), ride stays `requested`, retried.
- Force-assign onto a busy/offline driver still works — deliberately unfiltered (existing AC #4 and
  offline-force-assign tests must stay green untouched).
- `vehicle_required` vs `driver_on_ride`: active ride outranks missing vehicle in the follow-up read.

---

## VALIDATION COMMANDS

Prereq: `docker compose up -d --wait` (Postgres healthy; Redis on the port in `.env` — 6381 locally).

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/shared typecheck && pnpm --filter @taxi/api typecheck
pnpm --filter @taxi/api lint
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm --filter @taxi/api test -- src/features/dispatch/dispatch.service.spec.ts
```

### Level 3: Integration Tests

```bash
pnpm --filter @taxi/api test -- src/features/drivers/drivers.integration.spec.ts
pnpm --filter @taxi/api test -- src/features/dispatch/dispatch.integration.spec.ts
pnpm --filter @taxi/api test    # the whole service — the gate's blast-radius check
```

### Level 4: Manual Validation

Covered by the two new integration tests, which drive the real HTTP routes and sweeper. If a live
check is wanted: boot `pnpm --filter @taxi/api dev`, create two rides for one online driver via
`POST /rides`, watch the second stay `requested` while the first card is live.

### Level 5: The gate (CI parity — from cleared dist, Redis suites on)

```bash
REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force
```

Without `REDIS_TEST_URL` the Redis-backed store contracts `describe.skip` and a green gate is five
tests short — set it (memory: port 6381 locally).

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1**: `PUT /drivers/me/status {status:'online'}` answers 409 `driver_on_ride` whenever
  the driver has a ride in an active post-acceptance status — decided by the rides table, so it
  fires even when `drivers.status` is `offline` (chain A's exact state).
- [ ] **AC #2**: the gate does not over-block: a driver whose ride is `completed`, `settled`, or
  cancelled goes online normally; the offline direction is unchanged.
- [ ] **AC #3**: `offerNext` never deals a card to a driver holding a live pending offer on another
  ride; when the card resolves (decline/expiry/accept), the driver is offerable again next tick.
- [ ] **AC #4**: the issue's five-step chain A, replayed end-to-end, ends in a 409 instead of a
  second car.
- [ ] **AC #5**: zero regressions — full api suite green, including force-assign-onto-offline and
  AC #2's mode-switch proof (restored, not weakened).
- [ ] **AC #6**: KNOWN GAPS tells the new truth (closed + the accepted ms seam), and the two
  reference docs carry the one-card and presence-gate rules.
- [ ] Validation gate `REDIS_TEST_URL=… pnpm turbo run typecheck lint test build --force` exits 0.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] New tests fail against the pre-fix code (verify at least chain B's by stashing the
  `offerNext` edit once — a regression test that passes without the fix tests nothing)
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

1. **The accepted residual (needs your explicit OK).** No accept-time guard: a force-assign
   committing inside `offerNext`'s read-to-insert window, or a go-online racing an in-flight
   accept, can still double-commit for milliseconds. Documented in KNOWN GAPS with
   `driver_not_claimed` as the tripwire. If you want it fully closed, that is an in-transaction
   ride-state check in `accept` — say so and it becomes a task, but the issue's proposed fix does
   not ask for it.
2. **Assumption — 409 code reuse**: mid-ride go-online answers the existing `driver_on_ride`, not a
   new code. The driver app already handles it; a second code would be a new client contract.
3. **Assumption — naming**: `ACTIVE_DRIVER_RIDE_STATUSES`, `setOnlineIfEligible` (rename of
   `setOnlineIfHasVehicle` — one call site, name would otherwise lie), `findDriverIdsWithLiveOffers`.
   Cheap to change at review.
4. **Assumption — AC #2 edit is in scope**: one revoke statement to keep the mode-switch proof
   honest. Alternative was leaving a test that passes for the wrong reason — this repo's review
   history (PR #60 Low 6) rejects exactly that.

## NOTES (open canvas)

**Why the gate is in the WHERE and not a pre-check.** The repo already learned this twice (L8):
`setOnlineIfHasVehicle`'s docblock records how check-then-write let a concurrent delete slip
between. A pre-read rides check would reopen the same window against a concurrent accept. In the
WHERE, the only remaining seam is MVCC (an uncommitted accept is invisible) — the same ms seam as
the force-assign race, hence one KNOWN GAPS entry covering both.

**Why chain B lives in `offerNext`, not `toCandidates` or `DispatchContext`.** `toCandidates` is a
pure attribute filter both strategies share; the busy set is cascade state, like `tried`, and
`offerNext` is where cascade state already lives. Threading it through `DispatchContext` would be a
shared-contract change for zero gain — `findCandidates` has exactly one caller. Side effect kept:
a busy driver still gets lazily enrolled in a geozone queue by the strategy — harmless (they are
genuinely online) and consistent with "a skip is a wait".

**Why the sweeper needs no change.** Ticks are single-flight (`running` guard) and awaiting rides
are processed sequentially, so ride N's committed offer is visible to ride N+1's busy-set read in
the same tick. Two rides can never both deal a card to one driver within a tick, and across ticks
the query re-reads the world. The one extra query per awaiting ride per tick is nothing at ≤10
drivers; hoisting it to tick level is premature.

**Rejected: widening `claimForRide` to `status <> 'on_ride'`** — issue rules it out;
`releaseFromRide` would resurrect a force-assigned offline driver to `online` at completion (S9-2).

**Rejected: presence gate via RidesModule service** — DriversModule ← RidesModule already, so the
clean injection is circular. Direct `rides`-table read from the drivers repository follows the
settlement repository's precedent; the status list comes from `@taxi/shared`, so nothing rots.

**Deploy note (nothing to do):** a driver already double-committed before this ships would be
caught by the gate the next time they toggle presence; no data backfill needed, `drivers.status`
is untouched.

## AMENDMENTS

<!-- Append-only; newest at the bottom. Each entry: date — what changed and why. -->
