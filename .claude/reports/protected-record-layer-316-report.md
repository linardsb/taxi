# Implementation Report — Protected record layer (#316)

**Plan**: `.claude/plans/protected-record-layer-316.md`   **Branch**: `feature/protected-record-layer-316`   **Status**: PARTIAL — all code and tests written; every DB-backed check (db tests, every api jest run, mutation checks, the full gate) is **not yet run**: this machine has no Docker/Postgres.

## Summary
Adds the K1/K2 compliance record layer. `ride_events` is an append-only history that `RideTransitionService` writes in the change's own transaction (actor required), plus `created`/`assigned`/`released` events from `RidesRepository`. Migration 0018 adds triggers that block DELETE/TRUNCATE on `rides`/`drivers`/`vehicles`, block UPDATE/DELETE on `ride_events`, and guard `ride_offers` moves. Vehicles are retired instead of deleted. Cancel and decline reasons are stored as shared enums, and console cancels must carry one: the dispatch dialog has a required picker and the API answers 422 without one. An eslint rule bans `.delete(<protected table>)`, and a table-driven K1 test in `db/tests` covers the same tables.

## Tasks completed
- T1 reasons → `packages/shared/src/reasons.ts` (CREATE)
- T2 strings → `packages/shared/src/i18n/{lv,ru,en}-reasons.ts` (CREATE); `lv.ts`/`ru.ts`/`en.ts` (UPDATE: spread + `console.cancel_reason` reworded)
- T3 schemas → `packages/shared/src/schemas/reasons.ts` (CREATE); `schemas/ride.ts` (old `rideCancelSchema` removed); `index.ts` (UPDATE)
- T4 → `packages/shared/tests/reasons.test.ts` (CREATE); old cancel case removed from `schemas-ride-request.test.ts`
- T5 → `db/src/schema/ride-events.ts` (CREATE), `enums.ts`, `schema/index.ts` (UPDATE)
- T6 → `db/src/schema/rides.ts`, `vehicles.ts` (UPDATE); `db/migrations/0017_nasty_enchantress.sql` (generated)
- T7 → `db/migrations/0018_protected_records.sql` (custom)
- T8 → `db/src/protected-tables.ts` (CREATE), `db/src/index.ts` (UPDATE)
- T9 → `db/tests/protected-tables.test.ts` (CREATE), `db/tests/helpers.ts` (`getTestPool`)
- T10 → `services/api/src/features/rides/ride-events.repository.ts` (CREATE), rides barrel
- T11 → `ride-transition.service.ts` + spec
- T12 → lifecycle service/controller/policy/logging, settlement, dispatch, force-assign, reassign, dispatch controller, bookings service/controller + unit specs
- T13 → `rides.repository.ts` (`create`/`assignDriver`/`unassignDriver`), `rides.service.ts`
- T14 → cancel: `ride-lifecycle.policy.ts` `assertCancelReason`, `CancelInput`
- T15 → decline: `dispatch.controller.ts`, `dispatch.repository.ts`, `dispatch.service.ts`
- T16 → vehicles retire: `vehicles.{repository,service,controller}.ts`, `admin-vehicles.controller.ts`, `admin-drivers.{service,repository}.ts`, `drivers.repository.ts`, `rides.repository.ts` subselect, `notifications.repository.ts` comment
- T17 → `drivers.integration.spec.ts`, `admin-drivers.integration.spec.ts`, `tracking.integration.spec.ts`, `vehicles.service.spec.ts`
- T18 → `dispatch.integration.spec.ts` (`tickAsOf`)
- T19 → `services/api/eslint.config.mjs`
- T20 → `services/api/src/features/rides/ride-events.integration.spec.ts` (CREATE, written by a separate agent)
- T21 → `dialog-shell.tsx` (+ new `dialog-shell.test.tsx`, separate agent)
- T22 → `cancel-dialog.tsx`, `use-assign.ts`, `assign-state.ts`, `page.tsx`, `app/dispatch/layout.tsx` (`select:focus-visible`)
- T23 → `cancel-dialog.test.tsx`, `use-assign.test.tsx` (separate agent)
- T24 → `drivers-api.ts`, `use-drivers.ts`, `driver-detail.tsx`, `driver-detail.test.tsx`; `{lv,ru,en}-admin.ts` label values
- T25 → grep clean (see Validation)
- T26 → `.claude/references/ride-state-machine.md`, `services/api/CLAUDE.md`, `.claude/references/ui-decisions.md`; the rides barrel's "cancellation reason is ephemeral" known gap rewritten
- T27 → partial (see Validation)

## Tests added
- `packages/shared/tests/reasons.test.ts` — 17 cases (schemas, `undefined` body, `*_other`, 281 chars, tuple equalities, labels in all catalogs). **Run: green.**
- `db/tests/protected-tables.test.ts` — table-driven over both lists (drizzle + raw UPDATE/DELETE, TRUNCATE CASCADE, mutable UPDATE), drift check (`pg_trigger`, `confdeltype`), offer-guard matrix (5 allowed, 7 refused), vehicle-referenced-by-ride delete. **Not run.**
- `services/api/src/features/rides/ride-events.integration.spec.ts` — 19 cases (`grep -c` observed). Coverage:
  - edge walk over `ALLOWED_TRANSITIONS`; each edge runs in a rolled-back transaction, so a parallel worker's sweeper cannot add events mid-walk
  - lost race, rollback, per-caller actors
  - decline with and without a body, expiry, admin force-assign
  - reassign `released`, including a null vehicle
  - retired car never stamped: two same-category cars, and the retired one is `AA9001`, which `order by plate asc` would otherwise pick
  - console cancel 201/422/422/400

  **Not run.**
- Unit: `ride-transition.service.spec.ts` (+2: event on match, none on miss), `ride-lifecycle.service.spec.ts` (+2: 422 required for dispatcher and admin, 422 not-allowed), `bookings.service.spec.ts` (+1 assertion: `createdBy`). **Not run** (jest `globalSetup` needs Postgres).
- Dispatch app: `cancel-dialog.test.tsx` (16), `use-assign.test.tsx` (+4), `dialog-shell.test.tsx` (5, new). **Run: green.**

## Validation results
All `observed` on this machine unless marked.
- `pnpm turbo run typecheck lint build --force`: **16/16 tasks successful**.
- api eslint, re-run after the last edits: **0 errors, 18 warnings**. That is the 17-warning baseline plus 1 `no-unsafe-argument` in the new ride-events spec, the same `request(ctx.app.getHttpServer())` pattern every integration spec has.
- `@taxi/shared` vitest: **32 files, 336 passed**.
- `@taxi/dispatch` vitest: **38 files, 365 passed**. This needed `NODE_OPTIONS=--no-experimental-webstorage`: Node v26.12.1's built-in `localStorage` clashes with jsdom and fails the localStorage suites (session, RequireRole, useBoard, useAssign…) whether or not this ticket's changes are present. The flag is a local workaround and the repo does not set it.
- Lint probe (Task 19): `db.delete(rideEvents)` → 1 `no-restricted-syntax` hit; `Map.delete` → 0.
- `drizzle-kit generate` after 0018: "No schema changes".
- **Not run**:
  - `@taxi/db` tests
  - every `@taxi/api` jest run, unit and integration
  - Task 9 and Task 20 mutation checks
  - Task 18 step (1), the before-edit red run
  - Level 3 gate with `REDIS_TEST_URL`
  - Level 4 manual
- File budgets (`wc -l`, all under 500): `ride-lifecycle.service.ts` 495, `rides.service.ts` 497, `rides.repository.ts` 460, `dispatch.service.ts` 466, `dispatch.repository.ts` 435.

## Deviations from the plan
1. **DB-backed validation not run** (no Docker). Every "VALIDATE" line that needs Postgres is outstanding, including Task 18's recorded "exactly 3 red before the edit": the trigger SQL was never exercised against the fixtures here. R1 in the plan's risk register stays fully open.
2. **`driverActor(id)` helper** (`ride-events.repository.ts`). It was added to keep `ride-lifecycle.service.ts` under the cap: three object literals took it to 498 before the helper and 495 after. The plan's fallback was to move the `cancel` input type into the policy file. I did that as well (`CancelInput`), as the plan describes.
3. **Creator actor plumbing.** The plan said to "carry the role the same way as Task 12". I did it like this:
   - `BookingsService.book` gains a required 4th argument, `creatorKind`.
   - The phone-path `RideRider`/`caller` objects carry `createdBy`.
   - `RidesService.request`'s signature is unchanged; the app path derives `{ kind: 'rider' }`.
   - `bookings.service.spec.ts`: 10 `book(...)` calls gained `'dispatcher'`.
4. **`assignDriver`/`unassignDriver` take `tx` as required**, with the actor last, as planned. Both writes moved from `(tx ?? this.db)` to `tx`.
5. **Driver-path `VehiclesRepository.update` also filters `retired_at IS NULL`.** The plan named only the admin `updateVehicle`. A retired car being editable through the driver route would contradict "a retired car is a record".
6. **`logTransitionApplied`'s `reason` argument is now `{ reasonCode, reasonText }`** (`TransitionReason`), not a string. `hasReason` is still computed from the text only.
7. **Cancel integration bodies in `ride-lifecycle.integration.spec.ts` reshaped.** The rider and driver bodies use `reasonText`. The dispatcher body adds `reasonCode: 'dispatcher_rider_request'`, because without it the dispatcher case now 422s. This edits a spec that AC 8's "rides fixtures pass unchanged" set covers. The rider and driver bodies would still have passed with the old `{ reason }`; that text would just have been dropped.
8. **"A retired car is never stamped" lives in `ride-events.integration.spec.ts`**, not `drivers.integration.spec.ts`, which is where the plan put it. That file already had the book/offer/accept helpers it needs.
9. **Added test cases beyond the plan:**
   - "not yours" retire → 404
   - admin PATCH on a retired car → 404 `vehicle_not_found`
   - the vehicle-list check folded into the plate re-registration case
   - "online refused when only car retired" folded into the last-car case
10. **Separation of duties is partial.** The global rule is that the builder does not write the tests that prove its work.
    - A separate agent wrote the Task 20, 21 and 23 tests.
    - I wrote the Task 4, 9, 11 and 14 test cases myself.
    - The mechanical spec rewrites for the new signatures and routes (T12, T17, T18, T24) are also mine.
    - A reviewer should treat `db/tests/protected-tables.test.ts` and `reasons.test.ts` as builder-written.
11. **Admin label values** changed to retire wording; the keys keep `admin.vehicle.delete*` (logged in ui-decisions).
12. **A system cancel records `actor_id` null** (`ride-lifecycle.service.ts`). This was not in the plan. `CancelInput` carries an `actorId` even for `system`, and `ride_events_actor_id_ck` would reject that pair, so the first real system-cancel caller would have hit a check violation. The unit spec now expects `id: null`.
13. **`scripts/mint-tracked-ride.ts` comment.** "Plate globally unique" now reads "unique among active cars". The script's behaviour is unchanged, and the GET-then-POST stays idempotent. A `grep -rn onConflict` confirmed that no `ON CONFLICT` targets `vehicles` (a partial unique index cannot be inferred from a conflict target without its predicate). Observed.
14. **The `#320` issue note (plan Q4/D4)** has not been posted. It is outward-facing and belongs with `piv-create-pr`.

UX states (console cancel picker, `/dispatch`):
- loading ✅
- empty ✅
- error ✅
- offline ✅

All four are built and tested in `cancel-dialog.test.tsx`. The plan said the 422 maps by code; `assign-state.ts` maps on the message code and ignores the status, so the 422 status itself is not asserted in the dispatch tests.

## Outstanding run order (needs Docker)
1. `cp -n .env.example .env; docker compose up -d --wait`
2. `pnpm --filter @taxi/db test`, the K1 test, then its mutation check: comment out `CREATE TRIGGER rides_no_delete` in 0018. Expected: the rides cases and the drift check go red, and drivers, vehicles and the other files stay green. Then restore.
3. Task 18 pre-edit red: `git show b890929:services/api/src/features/dispatch/dispatch.integration.spec.ts > services/api/src/features/dispatch/dispatch.integration.spec.ts`. Run it and record exactly 3 red, each `protected_record:`. Then `git checkout` the file back and confirm it is green with the same test count.
4. Task 20 mutation: remove the `insertRideEvent` call from `transitionInTx`. Expected: the edge walk goes red and the created, assigned and released cases stay green. Then restore.
5. Gate: `REDIS_TEST_URL=redis://localhost:${REDIS_PORT:-6379} COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force`. Record the api `Tests:` line.
6. Level 4 manual (plan § Level 4).

## Issues encountered
- **No Docker, Postgres or pnpm on PATH.** pnpm ran as `npx pnpm@10.33.2`. The user chose to start Docker later, after which the DB checks and the gate run.
- Running prettier over the dispatch app reformatted files it doesn't use prettier for. I reverted those and re-applied my edits by hand; this app is not prettier-formatted.
- Latest migration on this branch: `db/migrations/0018_protected_records.sql`. Base `main` was at 0016, and `origin/main` was still `b890929` at branch time.
- Subagent notes to check on the first DB run:
  - The edge walk writes every `ALLOWED_TRANSITIONS` source status directly into `rides.status`, including `scheduled`, `queued` and terminal states.
  - The reassign case asserts an exact cross-transaction `seq` order: status, released, then the force-assign trio.
