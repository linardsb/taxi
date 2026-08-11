# Implementation Report — Record the vehicle on the ride at acceptance (#86)

**Plan**: `.claude/plans/api-ride-vehicle-stamp.md`   **Branch**: `feature/api-ride-vehicle-stamp`   **Status**: COMPLETE

## Summary

`rides.vehicle_id` (nullable FK → `vehicles.id`, `ON DELETE SET NULL`) is now stamped inside `RidesRepository.assignDriver`'s single conditional UPDATE via a correlated subquery — category match first, then plate ASC, else NULL — so both dispatch paths (accept and force-assign) record the car atomically with the driver, with zero dispatch-slice changes. `NotificationsRepository.driverCard` reads the plate by that stamped PK; the read-time fleet heuristic is deleted. Tracking page and ride SMS now show the frozen, deterministic plate.

## Tasks completed

- `vehicleId` column + docblock → `db/src/schema/rides.ts` (UPDATE)
- Migration `0008_lying_power_man.sql` (generated, hand-checked: nullable uuid + FK `ON DELETE set null`) → `db/migrations/` (CREATE); applied to dev DB
- Vehicle-resolution subquery in `assignDriver`, signature unchanged; docblock now names it sole writer of both assignment columns → `services/api/src/features/rides/rides.repository.ts` (UPDATE)
- `NotifiableRide` +`vehicleId` −`category`; `toNotifiable` follows; `driverCard(driverId, vehicleId)` plate-by-PK, heuristic + `RideCategory` import deleted → `services/api/src/features/notifications/notifications.repository.ts` (UPDATE)
- Both callers pass `vehicleId` → `tracking/tracking.service.ts`, `ride-notifications.service.ts` (UPDATE)
- Doc one-liners → `services/api/CLAUDE.md` (single-writer sentence), `.claude/plans/rider-comms-sms-tracking-page.md` (Forward-references) (UPDATE)

## Tests added

- `ride-notifications.service.spec.ts` — fakes reshaped (`vehicleId` in, `category` out); the `driver_assigned` expected case now asserts `driverCard` received the ride's stamped `vehicleId` (recorded in the calls array as `repo.driverCard(<vehicleId>)`).
- `tracking.integration.spec.ts` — three new cases:
  1. *(expected — #86 AC #1, #2)* multi-vehicle driver, limo ride: DB row stamps the limo id; page and SMS show the limo plate, never the standard one.
  2. *(edge — #86 AC #1)* force-assign of a vehicle-less driver: 201, stamp NULL, page 200 with `vehiclePlate: null`.
  3. *(failure — #86 AC #3)* vehicle deleted after `complete`: DELETE answers 204 (FK never 500s), `vehicle_id` SET NULL, receipt page 200 with `vehiclePlate: null` — pins the heuristic's death (no plate resurrected from the fleet).

All pass; existing `rides`/`dispatch` suites (143 tests) re-ran green against the new stamp — the free regression net the plan predicted.

## Validation results

- `pnpm --filter @taxi/db typecheck` / `test` — pass (17 tests)
- `services/api` `npx jest db-schema` — pass; `npx jest rides dispatch` — 16 suites / 143 tests pass; `npx jest notifications` — 2 suites / 19 tests pass
- Full gate `pnpm turbo run typecheck lint test build --force` (with `REDIS_TEST_URL`) — **20/20 tasks green** (api lint: 0 errors; 7 pre-existing `no-unsafe-argument` warnings on main-side harness usage, untouched)

## Deviations from the plan

- **`DELETE /drivers/me/vehicles/:id` answers 204, not 200** — the controller sets `@HttpCode(204)`; the test asserts 204. The plan's "→ 200" was imprecise about the existing route.
- **`as RideRequestBody` cast dropped** from the limo booking body — `eslint --fix` flagged it unnecessary (receiver already accepts the type); two multi-line formatting fixes in the same file, same source.
- **Two commits, not one** — an unrelated session collision (below) forced a mid-implementation checkpoint commit of Phases 1–3; Phase 4 (tests + docs + report) is the second commit.
- Everything else landed exactly per plan, including the drizzle `${vehicles} as v` aliasing (worked first try; no fallback needed).

## Issues encountered

- **Three concurrent Claude sessions shared `~/Desktop/taxi`** during this run (this ticket, the Twilio SMS ticket, the tracking-ETA ticket). The shared checkout's branch changed under this session twice; one commit transiently landed on `feature/tracking-eta-maps-quantized-cache` and was repaired with compare-and-swap ref updates (`81d81b9` now sits only on `feature/api-ride-vehicle-stamp`; the other branches are back at `80bd98c`). Work then moved to a git worktree (session scratchpad), and the shared checkout was restored to `feature/real-sms-provider-twilio` with the Twilio session's uncommitted files intact.
- **Worktree gate pothole**: `@taxi/db`'s `pretest` runs `docker compose up` with the compose project named after the worktree directory, so it tries to start a second Postgres on the occupied port 5432. Fixed by running the gate with `COMPOSE_PROJECT_NAME=taxi` (reuses the healthy shared container); the transient `vehicle-stamp-db-1` container was removed. A stale `taxi-46-idempotency-db-1` container from an earlier session's worktree shows this pothole is recurring — worth a system-review note.
- Dev DB is migrated to 0008 while other sessions' checkouts still carry migrations through 0007 — additive/nullable, harmless.
