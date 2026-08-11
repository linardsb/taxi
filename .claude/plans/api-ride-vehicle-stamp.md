# Feature: Record the vehicle on the ride at acceptance (kill the tracking-page plate heuristic)

The following plan should be complete, but validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files.

## Feature Description

Issue #86, follow-up from #63. `rides` has no vehicle FK, so today the tracking page and the ride SMS resolve the plate at **read time** via a driver→vehicles heuristic (category match, else first vehicle) — documented as assumption #4 in `.claude/plans/rider-comms-sms-tracking-page.md` and in `notifications.repository.ts:95-99`.

This ticket stamps `rides.vehicle_id` **once, when the driver is assigned** (accept and force-assign both flow through the same single writer), migrates, and switches the notifications read path to the stamped id. The plate the rider matches at the kerb (`services/api/CLAUDE.md`: "the identity a rider matches") is then frozen at assignment: multi-vehicle drivers always show one deterministic car, fleet edits mid-ride no longer flip the page's plate, and the read-time heuristic is deleted.

## User Story

As a **rider watching the tracking page (or reading the driver-assigned SMS)**
I want to **see the plate of the actual car assigned to my ride**
So that **I can match the car at the kerb even when my driver owns several vehicles**.

## Problem Statement

The plate shown to the rider is re-derived on every read from the driver's *current* fleet. For a multi-vehicle driver it is a guess (category match, else arbitrary first row — the `fleet[0]` fallback is not even deterministic, the query has no ORDER BY), and it can change mid-ride if the fleet changes. The ride row never records which car served it.

## Solution Statement

- Add nullable `rides.vehicle_id` → `vehicles.id` with **ON DELETE SET NULL** (vehicles are legitimately deletable — `VehiclesService.remove` only blocks `on_ride`; a plain FK would 500 any delete of a car with ride history).
- Stamp it inside `RidesRepository.assignDriver` — the documented **sole writer** of `rides.driver_id` (`services/api/CLAUDE.md`) — as the same single conditional UPDATE, with a correlated subquery choosing the vehicle: ride-category match first, then plate ASC (deterministic), else NULL. Both dispatch paths (accept `dispatch.service.ts:199`, force-assign `force-assign.service.ts:117`) call it inside their transactions, so the stamp commits atomically with the assignment and **zero dispatch files change**; the `assignDriver(rideId, driverId, tx?)` signature is unchanged, so unit-spec fakes don't change either.
- Switch `NotificationsRepository.driverCard` from `(driverId, category)` + fleet heuristic to `(driverId, vehicleId)` + plate-by-PK lookup; `NotifiableRide` gains `vehicleId` and drops `category` (its only consumer was the heuristic). Both callers (`tracking.service.ts:89`, `ride-notifications.service.ts:100`) already hold the `NotifiableRide` re-read post-commit, so ordering is safe by construction.
- The resolution heuristic still exists — but exactly once, at assignment time, in SQL, documented on `assignDriver`. The read path becomes heuristic-free. When a future "driver selects today's car" concept lands, it improves this one stamp point and every reader is already correct.

## Out of Scope / Non-Goals

- Not included: a **driver-app "active vehicle" selector** (the future better input to the stamp; the stamp point is ready for it).
- Not included: **backfill** of existing rides' `vehicle_id`. Pre-production: dev/test DBs are reseeded, no pilot data exists. Legacy rides with a driver but NULL `vehicle_id` simply render `vehiclePlate: null` (and the SMS `'—'` fallback at `ride-notifications.service.ts:104`) — same graceful path the zero-vehicle force-assign already needs.
- Not included: recording the vehicle on `ride_offers` / `dispatch_audit_log`, an index on `rides.vehicle_id` (no read path filters by vehicle; FK-delete scans are negligible at pilot scale), or exposing `vehicleId` on any wire contract.
- Not changing: `packages/shared` — nothing. `trackingViewSchema` (the page contract) is unchanged; `rideSchema` deliberately does NOT gain `vehicleId`, following the `paymentProviderRef` precedent (`db/src/schema/rides.ts:59-67` — an operational DB column with no cross-surface consumer stays off the domain object until one exists). `apps/dispatch` page code: nothing.
- Not changing: dispatch eligibility/matching, the offer cascade, `claimDriver` semantics.

## Feature Metadata

**Feature Type**: Enhancement
**Estimated Complexity**: Low-Medium (one column + one UPDATE subquery + one repository read swap; the care is in FK semantics and tests)
**Primary Systems Affected**: `db` (migration 0008), `services/api` (`rides.repository`, `notifications` slice)
**Dependencies**: none new

## Related Work

**Implements**: [#86](https://github.com/linardsb/taxi/issues/86) · **Epic**: #1 (via #63) — architecture inherited from `docs/epics/sakta-cab.architecture.md`; nothing here reopens an epic-level call

**Back-references**:

- `.claude/plans/rider-comms-sms-tracking-page.md` — created the heuristic this plan kills (its OPEN QUESTIONS #4 and NOTES "Post-merge follow-ups" both name this exact change); the notifications slice, `NotifiableRide`, and the test harness patterns all come from it
- `services/api/CLAUDE.md` — "`rides.driver_id` is written only by `RidesRepository.assignDriver`" (the invariant this plan extends to `vehicle_id`) and the plate-uniqueness kerb-identity rationale

**Forward-references**:

- (future) driver-app active-vehicle selection — would replace the category-match subquery input with the driver's declared car; the stamp point and readers stay as built here

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**The write path:**

- `services/api/src/features/rides/rides.repository.ts:257-278` — `assignDriver`: the race-safe conditional UPDATE (`isNull(rides.driverId)` guard) this plan extends. Read its docblock; the vehicle-resolution comment lands here. Also `:79-115` (`toRide`) — deliberately NOT touched (no `rideSchema` change).
- `services/api/src/features/dispatch/dispatch.service.ts:180-253` — accept: `assignDriver` at `:199` inside the transaction, `claimDriver` at `:207`. **Read-only** — verify, do not edit.
- `services/api/src/features/dispatch/force-assign.service.ts:90-145` — force-assign: `assignDriver` at `:117`, `claimDriver` at `:125`, and the `:121-124` comment (offline/ineligible driver is the FEATURE — the stamp must never block it; a zero-vehicle driver stamps NULL).
- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts:73-85` — `claimDriver`: why it is NOT the stamp point (no `rideId` in its signature; its single-owner contract is `drivers.status`, not the ride row). The ticket says "when the driver is claimed" — the truer anchor for a ride-row write is `assignDriver`, which runs in the same transactions.
- `services/api/src/features/drivers/drivers.repository.ts:141-180` — `setOnlineIfEligible`: the house precedent for checks/reads living INSIDE the UPDATE statement (the "L8" rule), which the correlated subquery follows.

**The read path:**

- `services/api/src/features/notifications/notifications.repository.ts` (whole file, 131 lines) — `NotifiableRide` `:17-27` (+`vehicleId`, −`category`), `toNotifiable` `:39-51`, `driverCard` `:95-130` (the heuristic to delete; keep the name/photo join, replace the fleet query with plate-by-PK).
- `services/api/src/features/notifications/tracking/tracking.service.ts:82-123` — caller #1: passes `ride.category` at `:91`; switches to `ride.vehicleId`. Note `:88` — the whole block is already guarded on `ride.driverId`.
- `services/api/src/features/notifications/ride-notifications.service.ts:85-129` — caller #2: `onStatus` re-reads via `rideById` at `:91` (post-commit → the stamp is visible), `driverCard` at `:100-103`, and the `card.plate ?? '—'` fallback at `:104` that makes NULL-vehicle rides degrade gracefully with zero new code.

**Schema & migration:**

- `db/src/schema/rides.ts:32-102` — the rides table; new column goes beside `driverId` `:43`; mind the table's jsonb-vs-columns docblock and the `updated_at` warning `:84-88` (no `.$onUpdate()`).
- `db/src/schema/vehicles.ts:14-38` — FK target; `category` NOT NULL (the subquery's ORDER BY needs no NULL handling), plate-uniqueness comment.
- `db/src/schema/drizzle-import-note`: `rides.ts` gains `import { vehicles } from './vehicles'` — no cycle (`vehicles.ts` imports only `drivers.ts`).
- `db/migrations/0007_uneven_mulholland_black.sql` — the latest migration (next is `0008_*`); `0006_harsh_donald_blake.sql` — the hand-edit precedent if drizzle-kit output needs correcting.
- `services/api/src/features/drivers/vehicles.service.ts:78-114` — `remove()`: deletes are allowed except `on_ride`; this is WHY the FK must be `ON DELETE SET NULL` (RESTRICT would make any car with ride history undeletable forever).

**Tests to mirror / update:**

- `services/api/src/features/notifications/tracking/tracking.integration.spec.ts` — the home for the three new cases. Read `:23-28` (E.164 range `+371280` — reuse it, pick `p(n)` values unused in the file), `:104-147` (`onlineDriver` helper — registers ONE standard vehicle; new tests add a second via `POST /drivers/me/vehicles`), `:167-187` (`acceptBy` — offer + HTTP accept), the first `it` (`:216+`) for the assert style, and the `afterEach` cleanup contract (`createdRides` / `usedDrivers` arrays).
- `services/api/src/features/dispatch/dispatch.integration.spec.ts:485-527` — the offline force-assign pattern: `insertUser(ctx.db, { phone, role: 'dispatcher' })` + `tokens.issue(...)` + `POST /dispatch/rides/:id/assign`. Mirror it for the zero-vehicle edge case (note: `findMatchAttributes` 404s without a `drivers` row — have the vehicle-less driver call `GET /drivers/me` first to `findOrCreate` it).
- `services/api/src/features/notifications/ride-notifications.service.spec.ts:60-115` — the unit fakes: `NotifiableRide` literals and the `driverCard` fake `:98-103` must follow the new shapes (typecheck will enumerate every site).
- `services/api/src/features/dispatch/dispatch.service.spec.ts:112-116` — `assignDriver` fake is a boolean-returning `jest.fn()`; signature unchanged → **no edits** (verify, don't touch).

### New Files to Create

- `db/migrations/0008_*.sql` — generated by `pnpm --filter @taxi/db generate`, then hand-checked

(Everything else is edits to existing files.)

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `services/api/CLAUDE.md` — the single-writer rules ("`rides.driver_id` is written only by `RidesRepository.assignDriver`", "`vehicles.plate` … is the identity a rider matches at the kerb") and the no-socket-emit-in-tx rule (not triggered here, but the reason stamping stays inside the existing transactions)
- `.claude/plans/rider-comms-sms-tracking-page.md` §OPEN QUESTIONS #4, §NOTES — the recorded assumption this plan resolves
- Drizzle `sql` operator (offline knowledge is fine — stable API): `sql` template fragments are legal as `.set()` values; interpolating a column (`${rides.category}`) renders the qualified column name, legal in a SET-expression subquery because the UPDATE target row is in scope

### Patterns to Follow

**The stamp — one conditional UPDATE, checks inside the statement (the L8 house rule, `drivers.repository.ts:146-151`):**

```ts
// rides.repository.ts — assignDriver body; signature UNCHANGED
const [row] = await (tx ?? this.db)
  .update(rides)
  .set({
    driverId,
    // The vehicle the rider will match at the kerb, frozen at assignment:
    // the driver's vehicle in the ride's category, else their first by
    // plate (deterministic), else NULL — a force-assigned driver may own
    // no car at all, and refusing the assignment for that would break S9-2.
    vehicleId: sql`(
      select v.id from ${vehicles} as v
      where v.driver_id = ${driverId}
      order by (v.category = ${rides.category}) desc, v.plate asc
      limit 1
    )`,
  })
  .where(and(eq(rides.id, rideId), isNull(rides.driverId)))
  .returning({ id: rides.id });
```

**The read — by PK, no heuristic (replaces `driverCard`'s fleet query):**

```ts
// notifications.repository.ts — plate resolution reads the stamp (#86)
async driverCard(
  driverId: string,
  vehicleId: string | null,
): Promise<{ name: string | null; photoUrl: string | null; plate: string | null }> {
  // name/photo join stays exactly as-is …
  let plate: string | null = null;
  if (vehicleId) {
    const [vehicle] = await this.db
      .select({ plate: vehicles.plate })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);
    plate = vehicle?.plate ?? null; // ON DELETE SET NULL makes a miss ~impossible, but never throw here
  }
  return { name: …, photoUrl: …, plate };
}
```

**Schema column (drizzle):**

```ts
// db/src/schema/rides.ts — beside driverId
/**
 * The car serving this ride (#86), stamped by `assignDriver` in the same
 * UPDATE as `driver_id` — category match, else first by plate, else NULL
 * (a force-assigned driver may own no vehicle). SET NULL on vehicle delete:
 * vehicles are deletable (`VehiclesService.remove`), ride history must not
 * pin them forever. Null also = pre-#86 rows and unassigned rides.
 */
vehicleId: uuid('vehicle_id').references(() => vehicles.id, {
  onDelete: 'set null',
}),
```

**Test titles**: `(expected)/(edge)/(failure)` with the AC cited inline — `rides.service.spec.ts` house style.

---

## IMPLEMENTATION PLAN

### Phase 1: DB — column + migration

**Tasks:**

- Add `vehicleId` to `db/src/schema/rides.ts` (+ `vehicles` import); generate migration 0008; hand-check; migrate.

### Phase 2: API write path — stamp in `assignDriver`

**Depends on:** Phase 1 (column must exist)

**Tasks:**

- Extend the UPDATE in `RidesRepository.assignDriver` with the vehicle subquery; move the heuristic documentation here.

### Phase 3: API read path — heuristic-free `driverCard`

**Depends on:** Phase 1 (`row.vehicleId` must exist on `$inferSelect`); **Independent of:** Phase 2 (compiles/runs either order — but land Phase 2 first so the integration specs see stamped rows)

**Tasks:**

- `NotifiableRide`: `+vehicleId: string | null`, `−category`; `toNotifiable` follows; `driverCard(driverId, vehicleId)` plate-by-PK; delete the heuristic and the now-unused `RideCategory` import; update both callers.

### Phase 4: Tests & docs

**Tasks:**

- Update unit fakes; add the three integration cases; one-line doc touches; full gate.

---

## STEP-BY-STEP TASKS

### UPDATE `db/src/schema/rides.ts`

- **IMPLEMENT**: `vehicleId` column per the Patterns snippet, placed directly under `driverId` (`:43`); add `import { vehicles } from './vehicles'`. No index (see Non-Goals). Do NOT touch anything else in the table.
- **PATTERN**: `driverId` `:43` (nullable FK column with a one-line why-comment); `geozoneId` `:45`.
- **GOTCHA**: no import cycle (`vehicles.ts` → `drivers.ts` only). `db/src/schema/index.ts` needs nothing — new *tables* only, per its own docblock.
- **VALIDATE**: `pnpm --filter @taxi/db typecheck`
- **SATISFIES**: AC #1

### GENERATE migration 0008 → migrate

- **IMPLEMENT**: `pnpm --filter @taxi/db generate` → hand-check the new `db/migrations/0008_*.sql`: expect exactly `ALTER TABLE "rides" ADD COLUMN "vehicle_id" uuid;` plus the FK constraint with `ON DELETE set null`. Then `docker compose up -d --wait` (if not up) and `pnpm --filter @taxi/db migrate`. No seed changes (no rides are seeded; vehicles/tariffs untouched).
- **PATTERN**: `0006_harsh_donald_blake.sql` precedent — hand-edit with a comment ONLY if the generated SQL is wrong; a plain nullable ADD COLUMN needs no DEFAULT dance.
- **GOTCHA**: docker Postgres reachability per the port-conflict memory (LAN-IP `DATABASE_URL` if brew pg shadows 5432).
- **VALIDATE**: `pnpm --filter @taxi/db test && cd services/api && npx jest db-schema`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/rides/rides.repository.ts` — `assignDriver`

- **IMPLEMENT**: the Patterns snippet — `.set()` gains `vehicleId` as a `sql` subquery; signature, guard (`isNull(rides.driverId)`), and return contract unchanged. Extend the method docblock: it is now the sole writer of BOTH assignment columns, and the resolution rule lives here (category match → plate ASC → NULL).
- **IMPORTS**: `vehicles` added to the existing `@taxi/db` import; `sql` added to the existing `drizzle-orm` import.
- **GOTCHA**: interpolate the COLUMN (`${rides.category}`), never a JS value, so the ride's category is read in-statement — no extra round trip, no staleness. Verify the rendered SQL once via the integration run; if drizzle's `${vehicles} as v` aliasing misbehaves, fall back to the unaliased table name in the fragment.
- **VALIDATE**: `cd services/api && npx jest rides dispatch` — every existing accept/force-assign integration case now exercises the subquery (their drivers own one vehicle; green = the stamp doesn't break assignment)
- **SATISFIES**: AC #1, #2

### UPDATE `services/api/src/features/notifications/notifications.repository.ts` + both callers

- **IMPLEMENT**: `NotifiableRide` `+vehicleId: string | null`, `−category`; `toNotifiable` maps `vehicleId: row.vehicleId`, drops `category`; `driverCard(driverId, vehicleId)` per the Patterns snippet — delete the fleet query, the heuristic comment block (`:95-99`), and the now-unused `RideCategory` import. Update `tracking.service.ts:89-92` → `this.repository.driverCard(ride.driverId, ride.vehicleId)` and `ride-notifications.service.ts:100-103` → `this.repository.driverCard(details.driverId, details.vehicleId)`.
- **PATTERN**: `driverCard`'s existing name/photo join stays byte-identical; the repository's "owns its own queries" docblock (`:53-57`) still holds — trim its vehicles clause if it reads stale after the change.
- **GOTCHA**: keep `driverCard` never-throwing on a missing vehicle row (return `plate: null`) — the SMS path runs inside the never-throws envelope, but a throw would still cost the rider their SMS body. The `'—'` fallback at `ride-notifications.service.ts:104` is already the display path for NULL.
- **VALIDATE**: `cd services/api && pnpm typecheck` (unit specs still red until the next task — expected)
- **SATISFIES**: AC #2, #3

### UPDATE `services/api/src/features/notifications/ride-notifications.service.spec.ts`

- **IMPLEMENT**: follow typecheck — fake `NotifiableRide` literals gain `vehicleId` (a fixed uuid), drop `category`; the `driverCard` fake keeps returning `{ name, photoUrl, plate: 'AB-1234' }`. Strengthen one existing assertion: the `driver_assigned` case asserts `driverCard` was called with the ride's `vehicleId` (the calls-array house style already records the invocation).
- **PATTERN**: the spec's own `build()` factory + shared `calls: string[]` style.
- **VALIDATE**: `cd services/api && npx jest notifications` (unit half)
- **SATISFIES**: AC #4 test bar (unit)

### ADD three cases to `services/api/src/features/notifications/tracking/tracking.integration.spec.ts`

- **IMPLEMENT**:
  1. **(expected — AC #1, #2)** Multi-vehicle driver, category preferred: `onlineDriver(...)` (standard car), then `POST /drivers/me/vehicles` a second car with `category: 'limo'` (capture its `id` and plate from the 201 body — all four `RIDE_CATEGORIES` have seeded tariffs, so a limo ride quotes fine). Book by phone with `{ ...BODY, category: 'limo' }`, `acceptBy(...)`. Assert: the `rides` row's `vehicleId` equals the limo vehicle's id (DB read via `ctx.db`); `GET /track/:token` shows the LIMO plate; the `driver_assigned` SMS contains the limo plate, not the standard one.
  2. **(edge — AC #1)** Force-assign a vehicle-less driver stamps NULL and blocks nothing: driver signs in, calls `GET /drivers/me` (creates the `drivers` row), registers NO vehicle; dispatcher via the `insertUser` + `tokens.issue` pattern (`dispatch.integration.spec.ts:497-510`); `POST /dispatch/rides/:id/assign` → 201. Assert: `rides.vehicleId` IS NULL; `GET /track/:token` → 200, `state: 'assigned'`, `driverName` set, `vehiclePlate: null`.
  3. **(failure — AC #3)** Vehicle deleted after the ride → SET NULL, page never 500s: single-vehicle driver completes a full lifecycle (mirror the first `it`'s REST walk); after `complete`, `DELETE /drivers/me/vehicles/:id` → 200 (the FK must not turn this into a 500; the driver was released so the `on_ride` guard passes). Assert: `rides.vehicleId` IS NULL (the FK fired); `GET /track/:token` within the terminal grace → 200, `state: 'completed'`, `vehiclePlate: null`. This is the case that PINS the heuristic's death: the old code would resurrect a plate from the remaining fleet (here: none → also null; the stamped-id read is what makes the DB assert meaningful).
- **PATTERN**: existing helpers (`onlineDriver`, `bookByPhone`, `acceptBy`, `waitForSms`, `view`) and the `createdRides`/`usedDrivers` cleanup contract; `(expected)/(edge)/(failure)` titles with AC refs.
- **GOTCHA**: stay inside the file's `+371280` E.164 range with `p(n)` values unused in the file; the suite runs serially (`maxWorkers: 1`) but integration runs are mutually destructive across concurrent Claude sessions (global-setup `DROP DATABASE … WITH (FORCE)`) — check no other session is testing.
- **VALIDATE**: `cd services/api && REDIS_TEST_URL=redis://localhost:6381 npx jest notifications dispatch rides` (port per your `.env` `REDIS_PORT`)
- **SATISFIES**: AC #1, #2, #3, #4

### UPDATE docs (two one-liners)

- **IMPLEMENT**: (a) `services/api/CLAUDE.md` — extend the existing single-writer sentence: "`rides.driver_id` is written only by `RidesRepository.assignDriver`" → "…which also stamps `rides.vehicle_id` (#86)". (b) `.claude/plans/rider-comms-sms-tracking-page.md` — append one Forward-references line: `- #86 → .claude/plans/api-ride-vehicle-stamp.md — resolves OPEN QUESTIONS #4: the ride now records its vehicle at assignment`.
- **GOTCHA**: surgical — no other drift-fixing in this PR (`rules-check-drift` owns that separately).
- **VALIDATE**: n/a (docs)
- **SATISFIES**: convention hygiene

### Gate

- **IMPLEMENT**: from repo root, cleared dist: `pnpm turbo run typecheck lint test build --force` (CI parity — `pnpm check` is NOT the gate; set `REDIS_TEST_URL` or the Redis suites silently skip).
- **VALIDATE**: the command itself, green
- **SATISFIES**: Done definition

---

## TESTING STRATEGY

### Unit Tests

`ride-notifications.service.spec.ts` — shape updates plus one strengthened assertion (`driverCard` receives the stamped `vehicleId`). No new unit files: the stamp is SQL inside a repository, meaningfully testable only against Postgres.

### Integration Tests

The three cases above in `tracking.integration.spec.ts` (the slice under change; they exercise accept AND force-assign end-to-end through the real `AppModule`, asserting both the DB row and the page/SMS surface). Existing `dispatch`/`rides`/`notifications` integration suites regression-guard the write path for free — their drivers all own exactly one vehicle, so stamped-plate output is identical to the old heuristic's.

### Edge Cases

Multi-vehicle driver, category match wins · two same-category vehicles → plate-ASC deterministic (covered by the subquery's ORDER BY; asserted implicitly via case 1's DB read) · force-assigned driver with zero vehicles → NULL stamp, 201, page renders · vehicle deleted post-ride → SET NULL, page 200 with `vehiclePlate: null`, DELETE route stays 200 · legacy ride (driver set, `vehicle_id` NULL) → plate null / SMS `'—'` (same code path as zero-vehicle) · accept race → loser's UPDATE matches no row, stamps nothing (guard unchanged) · plate typo fixed mid-ride → page shows the corrected plate (read-through by id — desired).

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`pnpm turbo run typecheck lint --force`

### Level 2: Unit Tests

`cd services/api && npx jest notifications` · `pnpm --filter @taxi/db test`

### Level 3: Integration Tests

`cd services/api && REDIS_TEST_URL=redis://localhost:6381 npx jest notifications dispatch rides`

> ⚠️ Mutually destructive across concurrent Claude sessions (global-setup `DROP DATABASE … WITH (FORCE)`) — check `git reflog -8` / other sessions before running.

### Level 4: Manual Validation

`docker compose up -d --wait` → api dev → register a driver with two vehicles (standard + limo) → book a limo ride by service layer → accept → `curl -s localhost:3001/track/<token>` shows the limo plate; `psql`-check `rides.vehicle_id`.

### Level 5: Full gate

`pnpm turbo run typecheck lint test build --force` — the Done definition.

---

## ACCEPTANCE CRITERIA

- [ ] AC #1 — every driver assignment (accept AND force-assign) stamps `rides.vehicle_id` in the same transaction as `driver_id`: the driver's vehicle in the ride's category, else first by plate, else NULL — never blocking the assignment
- [ ] AC #2 — tracking page and ride SMS resolve the plate from `rides.vehicle_id` only; the read-time fleet heuristic is deleted from `notifications.repository.ts`
- [ ] AC #3 — vehicle deletion still works (FK `ON DELETE SET NULL`) and a stamped-then-deleted vehicle degrades to `vehiclePlate: null`, never a 500
- [ ] AC #4 — ≥1 expected + 1 edge + 1 failure test, per above
- [ ] `pnpm turbo run typecheck lint test build --force` green

## COMPLETION CHECKLIST

- [ ] `git pull` + `git reflog -8` checked first (concurrent-sessions rule); branch from current `main`
- [ ] Migration 0008 hand-checked (nullable uuid + `ON DELETE set null`)
- [ ] `assignDriver` signature unchanged; dispatch slice files untouched; `dispatch.service.spec.ts` fakes untouched
- [ ] `NotifiableRide.category` and the `RideCategory` import removed (made unused by THIS change)
- [ ] Both doc one-liners applied; nothing else "improved"
- [ ] PR body links `Closes #86`

---

## OPEN QUESTIONS / ASSUMPTIONS

Starred = the plan proceeds on this resolution; override before execution if wrong.

1. ★ **Stamp point = `assignDriver`, not `claimDriver`.** The ticket says "when the driver is claimed (accept + force-assign both compose `RideLifecycleService.claimDriver`)" — but `claimDriver(tx, driverId)` has no `rideId` and its documented single-owner contract is `drivers.status`. `assignDriver` is the documented sole writer of the ride's assignment column, runs in the SAME transactions on both paths, and gives the atomicity the ticket intends. Same intent, truer seam.
2. ★ **FK is `ON DELETE SET NULL`** — vehicles are deletable today (only `on_ride` blocks); RESTRICT would make any car with ride history permanently undeletable, and a plain non-FK uuid loses integrity. Cost: a deleted car's terminal-state page (≤24 h grace) shows no plate. Alternative rejected: denormalizing `vehicle_plate` text onto rides (survives deletion AND edits, better audit) — diverges from the ticket's explicit `rides.vehicle_id`, and the id keeps make/model/photo expansion open for the page.
3. ★ **No `rideSchema` change** — `paymentProviderRef` precedent: operational column, no cross-surface consumer, stays off the domain object. If a later ticket (#17 share-trip, admin stats) wants `ride.vehicleId` on the wire, it is an additive nullable-with-default field then.
4. ★ **Tie-break = `plate ASC`** — any deterministic order beats the old `fleet[0]`; plate is human-explainable in a log or dispute.
5. ★ **No backfill** — pre-production; legacy NULLs degrade to the same rendering as the zero-vehicle case.

## NOTES (open canvas)

- **Why the subquery instead of resolving in TS and passing `vehicleId` in**: one statement keeps `assignDriver`'s signature and race shape identical (zero dispatch edits, zero fake edits), makes the stamp impossible for a future caller to forget, and follows the L8 "checks live inside the UPDATE" house rule. The alternative (resolve in each dispatch path, pass explicitly) duplicates the heuristic at two call sites in a slice this ticket otherwise doesn't touch.
- **Ordering proof for the SMS/page**: the stamp commits in the accept/force-assign transaction; `emitStatus` fires post-commit; `onStatus` re-reads the ride row (`rideById`, `ride-notifications.service.ts:91`) before building the SMS — so the stamped id is always visible to every reader. No reader consumes the pre-commit `TransitionedRide` for the plate.
- **What actually changes observably**: for the single-vehicle drivers of today, nothing — old heuristic and new stamp agree, which is why the whole existing suite is a free regression net. The new behavior shows at: multi-vehicle same-category (deterministic), fleet edits mid-ride (frozen), vehicle deleted post-ride (null, not resurrected-from-fleet), and the DB row itself (the durable record dispatch/audit lacked).
- **Deliberately not asserting the stamp in `dispatch.integration.spec.ts`**: the three tracking cases already assert the row on both paths; adding parallel asserts there would be coverage duplication in a file this ticket otherwise leaves untouched.
- **`updated_at` note**: the stamp happens before/with `accepted`'s status write in one transaction — the trigger bumps `updated_at` once per UPDATE statement; nothing here changes tracking-grace semantics.

## CONFIDENCE

**9.5/10** for one-pass implementation. Every integration point is read and cited at file:line on current `main @ 80bd98c`; the write path is one statement behind an unchanged signature; the read path has exactly two callers, both already holding the re-read row; the existing integration suites regression-guard the common case for free. Residual 0.5: drizzle's rendering of the correlated subquery fragment (aliasing) may need one mechanical adjustment on first run — the integration suite catches it immediately.

## AMENDMENTS

<!-- append-only after first approval; newest at the bottom -->
