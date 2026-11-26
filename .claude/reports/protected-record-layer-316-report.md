# Implementation Report — Protected record layer (#316)

**Plan**: `.claude/plans/protected-record-layer-316.md`   **Branch**: `feature/protected-record-layer-316`   **Status**: COMPLETE — gate green with Redis-gated suites included (see Validation). Level 4 manual check not run.

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
- `db/tests/protected-tables.test.ts` — table-driven over both lists (drizzle + raw UPDATE/DELETE, TRUNCATE CASCADE, mutable UPDATE), drift check (`pg_trigger`, `confdeltype`), offer-guard matrix (5 allowed, 7 refused), vehicle-referenced-by-ride delete. **Run: green** (gate).
- `services/api/src/features/rides/ride-events.integration.spec.ts` — 19 cases (`grep -c` observed). Coverage:
  - edge walk over `ALLOWED_TRANSITIONS`; each edge runs in a rolled-back transaction, so a parallel worker's sweeper cannot add events mid-walk
  - lost race, rollback, per-caller actors
  - decline with and without a body, expiry, admin force-assign
  - reassign `released`, including a null vehicle
  - retired car never stamped: two same-category cars, and the retired one is `AA9001`, which `order by plate asc` would otherwise pick
  - console cancel 201/422/422/400

  **Run: green** (gate).
- Unit: `ride-transition.service.spec.ts` (+2: event on match, none on miss), `ride-lifecycle.service.spec.ts` (+2: 422 required for dispatcher and admin, 422 not-allowed), `bookings.service.spec.ts` (+1 assertion: `createdBy`). **Run: green** (gate).
- Dispatch app: `cancel-dialog.test.tsx` (16), `use-assign.test.tsx` (+4), `dialog-shell.test.tsx` (5, new). **Run: green.**

## Validation results
All `observed` on 2026-11-26 against the compose Postgres 16 + Redis.
- **Gate:** `REDIS_TEST_URL=redis://localhost:6379 COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force`, via `record-gate.sh --clean`.
  - 23/23 tasks green. Per package:
    - api: 96 suites, 1022 tests
    - db: 48
    - shared: 336
    - dispatch: 365
    - driver: 364
    - rider: 231
  - The first gate run was red: 1 rider test still expected the old `{ reason: null }` cancel body. Fixed in `02f43cc`; see deviation 15.
  - The gate ran with `NODE_OPTIONS=--no-experimental-webstorage`, a local workaround for Node 26's built-in `localStorage` clashing with jsdom. CI does not need it.
- **db mutation (Task 9):** with `CREATE TRIGGER rides_no_delete` replaced, 3 tests went red: the 2 rides delete cases and the drift check. 45 stayed green: drivers and vehicles, plus the other 3 db files, which shows the rollback wrapping holds. Restored.
- **Task 18 before the edit:** the base `b890929` dispatch spec against 0018 had 4 failures of 29, against the 3 predicted.
  - 3 were the predicted `protected_record:` refusals, at `:410`, `:794` and `:1228`.
  - The 4th, "force-assigns mid-cascade (AC #4)", timed out on socket events. It passes on its own in that same base spec (`-t`: 1 passed, 28 skipped), so it is a knock-on from AC #3 failing mid-test.
  - After the edit: 29/29.
- **Task 20 mutation:** with `transitionInTx`'s `insertRideEvent` disabled, the edge walk and the 9 caller cases that assert `status` rows went red (10). 9 stayed green:
  - `created` from a rider booking and from a phone booking
  - retired-car `assigned`
  - unstamped `released`
  - lost race and rollback
  - the three 422/400 cancel refusals

  The `assigned`/`released` writers are unaffected. Restored.
- **Task 19 lint probe:** 1 hit on `db.delete(rideEvents)`, 0 on `Map.delete`.
- **Static:** api eslint 0 errors, 18 warnings: the 17-warning baseline plus 1 in the new spec. `drizzle-kit generate` → "No schema changes".
- **File budgets** (`wc -l`): `ride-lifecycle.service.ts` 496, `rides.service.ts` 497, `rides.repository.ts` 460, `dispatch.service.ts` 466, `dispatch.repository.ts` 435.
- **Not run:** Level 4 manual.

## Deviations from the plan
1. **Task 18's prediction was 3 red; the observed count was 4.** The 4th is a knock-on, not a fixture the plan missed (see Validation).
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
14. **`apps/rider/.../status-screen.test.tsx`** asserted the old `{ reason: null }` cancel body. The plan's Task 3 gotcha checked the rider app with typecheck only, and this runtime assertion was not on its list. It is updated to `{ reasonCode: null, reasonText: null }` in `02f43cc`.
15. **The `#320` issue note (plan Q4/D4)** has not been posted. It is outward-facing and belongs with `piv-create-pr`.

UX states (console cancel picker, `/dispatch`):
- loading ✅
- empty ✅
- error ✅
- offline ✅

All four are built and tested in `cancel-dialog.test.tsx`. The plan said the 422 maps by code; `assign-state.ts` maps on the message code and ignores the status, so the 422 status itself is not asserted in the dispatch tests.

## Issues encountered
- No Docker or pnpm at first. pnpm ran through an `npx pnpm@10.33.2` shim until Docker arrived.
- Mid-run, Homebrew upgraded `simdjson` and Node stopped starting with a `dyld` error. `brew reinstall node` (user-approved) fixed it; Node is now v26.13.1.
- Running prettier over the dispatch app reformatted files it doesn't use prettier for. I reverted those and re-applied my edits by hand; this app is not prettier-formatted.
- Latest migration on this branch: `db/migrations/0018_protected_records.sql`. Base `main` was at 0016, and `origin/main` was still `b890929` at branch time.
- Subagent notes to check on the first DB run:
  - The edge walk writes every `ALLOWED_TRANSITIONS` source status directly into `rides.status`, including `scheduled`, `queued` and terminal states.
  - The reassign case asserts an exact cross-transaction `seq` order: status, released, then the force-assign trio.
