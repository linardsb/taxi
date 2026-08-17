# Implementation Report — #19 Phase A: force-assign / override UI

**Plan**: `.claude/plans/dispatch-override-phone-orders-zones.md` (Phase A only)
**Branch**: `feature/dispatch-override-phone-orders` (worktree `/Users/Berzins/Desktop/taxi-dispatch-override`, cut from `origin/main` @ `30d057b`)
**Status**: COMPLETE (Phase A) — Phases B and C not started, by design

## Summary

Dina's board became actionable. Ride rows now carry assign / reassign / cancel affordances driving #10's shipped force-assign endpoint, a new reassign endpoint, and the lifecycle cancel route that already accepted a dispatcher. The picker lists **every** driver including offline ones, because #10 documents force-assign as deliberately unfiltered — an ineligible driver gets a warning and a second confirm, never a block. Reassignment of an already-accepted ride required one new state-machine transition (`accepted|arriving → requested`, the dispatcher release), so swapping the car is a release back into the cascade rather than a cancellation that would lose the ride id, tracking token and SMS thread.

## Tasks completed

| Plan task | Outcome |
|---|---|
| A1 | `packages/shared/src/schemas/dispatch.ts` (CREATE) — `forceAssignBodySchema` promoted from the controller, plus `reassignBodySchema`, `dispatchDriverSchema`, `dispatchRosterSchema`; exported from `src/index.ts` (UPDATE) |
| A2 | `services/api/src/features/dispatch/dispatch.controller.ts` (UPDATE) — imports the promoted schema; local copy and the now-unused `zod` import removed |
| A3 | `services/api/src/features/dispatch/roster.service.ts` + `.spec.ts` (CREATE); `drivers.repository.ts`, `drivers.service.ts`, `drivers/index.ts` (UPDATE) — new `findRosterContacts()` and `DriverRosterContact`; `rides.repository.ts` (UPDATE) — new `findActiveRideIdsByDriver()` |
| A4 | `GET /dispatch/drivers` added to the controller; `RosterService` registered in `dispatch.module.ts` (UPDATE) |
| A5 | `packages/shared/src/ride-state-machine.ts` (UPDATE) — `'requested'` added to the `accepted` and `arriving` rows, with the dispatcher-release docblock |
| A6 | `services/api/src/features/dispatch/reassign.service.ts` + `.spec.ts` (CREATE); `rides.repository.ts` (UPDATE) — new `unassignDriver()`; `dispatch.repository.ts` (UPDATE) — `AuditEntry.payload` |
| A7 | `POST /dispatch/rides/:rideId/reassign` added to the controller |
| A8 | `apps/dispatch/src/features/override/assign-state.ts` + `.test.ts` (CREATE) |
| A9 | `apps/dispatch/src/features/override/use-assign.ts` + `.test.tsx` (CREATE) |
| A10 | `override/dialog-shell.tsx`, `override/driver-picker.tsx` + `.test.tsx`, `override/assign-dialog.tsx` + `.test.tsx` (CREATE) |
| A11 | `override/cancel-dialog.tsx` + `.test.tsx` (CREATE) |
| A12 | `override/row-actions.tsx`, `override/index.ts` (CREATE); `board/ride-queue.tsx`, `app/dispatch/page.tsx` (UPDATE) |
| A13 | `packages/shared/src/i18n.ts` (UPDATE) — 33 `console.*` keys across LV / RU / EN (`observed`: 99 added lines ÷ 3 catalogs, `git diff main -- packages/shared/src/i18n.ts`. Was written as 30 and inherited into the PR body; the commit as reviewed added 28, and the #120 review-fix pass added 5 more) |
| A14 | Gate — see Validation results |
| A15 (added during execution) | `services/api/src/features/notifications/ride-notifications.service.ts` (UPDATE) — comment only. Its docblock justified having no dedupe table with "each is reachable at most once per ride (the re-offer loop never passes through either)". A5's dispatcher release falsifies that: a reassign walks `accepted → requested → offered → accepted`, so a phone-booked rider now gets a second `sms.driver_assigned` naming the new driver, plate and ETA. That repeat is the correct behaviour — there is no "your car changed" message and this one states every fact that changed — so the decision stands but its *reason* was rewritten to rest on `emitStatus` firing once per APPLIED transition. Leaving the old sentence would have been the #87/#107 shape: a retired claim still load-bearing for a live decision. |

## Tests added

| File | Cases | Result |
|---|---|---|
| `packages/shared/tests/schemas-dispatch.test.ts` | 8 — reason default/limit/over-limit, no `dispatcherId` field, offline driver + null zone accepted, active ride carried, non-ISO `at` rejected | pass |
| `packages/shared/tests/ride-state-machine.test.ts` (UPDATE) | +2 — dispatcher release allowed from `accepted`/`arriving`, refused from `arrived`/`in_progress` | pass |
| `services/api/.../roster.service.spec.ts` | 7 — every driver incl. offline, `lv` collation, phone-name fallback, active ride attached, zone lookups bounded to positioned drivers, null zone, empty roster | pass |
| `services/api/.../reassign.service.spec.ts` | 11 — release-then-force-assign, the two-transaction ordering ledger, release audited against the OUTGOING driver, `arriving` release, unclaimed-driver tolerance, refusals for `arrived`/`in_progress`/same-driver/404/two 409 races | pass |
| `apps/dispatch/.../override/assign-state.test.ts` | 18 — verb per status incl. totality over `BOARD_LIVE_RIDE_STATUSES`, warnings without blocking, error-code mapping + unknown-code fallback, sort ranks, filter, `pickupZoneOf` | pass |
| `apps/dispatch/.../override/use-assign.test.tsx` | 10 — roster fetched only on demand, 401 → `/login`, unparseable body, route-per-verb, 409 mapping, unmapped code, network throw, reset | pass |
| `apps/dispatch/.../override/driver-picker.test.tsx` | 8 — offline drivers listed and selectable, ↓+Enter keyboard pick, `aria-activedescendant`, plate/phone filter, index clamp, empty state, no run-off | pass |
| `apps/dispatch/.../override/assign-dialog.test.tsx` | 9 — submit with/without reason, offline warn-and-confirm, verb-specific title, back, Escape, offline-disabled with reason, 409 returns to picker, double-submit blocked | pass |
| `apps/dispatch/.../override/cancel-dialog.test.tsx` | 6 — cancel with/without reason, destructive button not focused, keep-it, offline refusal, failure surfaced | pass |
| `apps/dispatch/.../board/ride-queue.test.tsx` (UPDATE) | +2 — right verb per row and ride reported back, no assign verb once `arrived` | pass |
| `services/api/.../dispatch.integration.spec.ts` (UPDATE) | +4 against the real database — see below | pass (23/23 in file) |

Every new module ships ≥1 expected + 1 edge + 1 failure case.

**The four integration tests exist because the unit specs could not prove the thing most likely to be wrong.** `reassign.service.spec.ts` asserts the two-transaction ORDER against a fake `db.transaction` that just invokes its callback; what it cannot check is how the real conditional UPDATEs interlock — `unassignDriver` guarded on `eq(rides.driverId, previousDriverId)` and `assignDriver` on `isNull(rides.driverId)`, across two separately-committed transactions. So:

1. **reassign end-to-end** — seeds an accepted ride, POSTs `/reassign`, asserts the new `driver_id`, the outgoing driver's `drivers.status` back to `online`, the incoming driver's to `on_ride`, and two dispatcher audit rows told apart by `payload.event`. It also asserts `vehicle_id` is **non-null and different** after the swap: the release sets it null and `assignDriver`'s subquery has to re-stamp the new driver's car, and a rider matching a plate at the kerb is the failure if it doesn't. It does.
2. **`arrived` refusal** — drives the ride to `arrived` through the real driver endpoints and confirms `/reassign` 409s with the ride and driver untouched.
3. **roster lists offline drivers** — the S9-2 property the board frame deliberately cannot express, asserted through the wire schema.
4. **roster is dispatcher-only** — a driver token gets 403.

Mid-cascade force-assign and the offline-driver override were already covered by #10's own integration tests in this file (`force-assigns mid-cascade and clears the overridden card`, `force-assigns a pooled ride to an OFFLINE driver`), so Phase A did not duplicate them.

## Validation results

`observed` — `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force`, run in the worktree 2026-08-17:

```
Tasks:    18 successful, 18 total
Cached:    0 cached, 18 total
Time:     49.964s
```

| Package | Result |
|---|---|
| `@taxi/api` test | **510 passed**, 0 skipped, 57 of 57 suites |
| `@taxi/shared` test | **167 passed** (19 files) |
| `@taxi/dispatch` test | **147 passed** (20 files) |
| `@taxi/db` test | **17 passed** (3 files) |
| typecheck · lint · build | clean, all packages |

**Zero skips — the Redis-gated suites RAN.** The worktree still has no `.env`, so `docker compose` could not start `taxi-redis-1`; Redis was supplied directly instead (`docker run -d --name taxi-redis-6381 -p 6381:6379 redis:7-alpine`) and `REDIS_TEST_URL` pointed at it. That matters here specifically: `RosterService` injects `DRIVER_LOCATION_STORE` and calls `listOnline(cityId)` — the Redis presence set — so a Redis-skipped gate would have left the roster's only real-store dependency unexercised, with `roster.service.spec.ts` stubbing the store and proving nothing about it. This run is 0 short.

**On "24 short":** root `CLAUDE.md` said 24, and quoting it here was wrong — this branch's own gated tests moved the real figure to 28, which the intermediate `478 passed, 28 skipped` run below already showed and this line inherited past. Re-observed after the #120 review-fix pass: `env -u REDIS_TEST_URL` on this head gives `28 skipped, 492 passed, 520 total`, 2 skipped suites of 57. `CLAUDE.md:43` is corrected to 28 in the same commit.

An earlier Redis-skipped run showed `478 passed, 28 skipped` — recorded here only so the delta is legible, not as this phase's result.

**Two intermittent failures were seen and neither reproduces.** `payments.integration.spec.ts › lets an admin settle a ride they do not own` failed once with `Parse Error: Expected HTTP/, RTSP/ or ICE/`, then passed 10/10 in isolation and on every later run. One further single-test failure appeared in a mid-sequence gate and did not recur across three subsequent full runs (`510 passed` each). Both are consistent with root `CLAUDE.md`'s warning that integration runs are mutually destructive across concurrent sessions — other Claude sessions share this database. Nothing in Phase A touches payments. **Flagged rather than dismissed: if CI shows the same shape, it is not this branch.**

**File-length rule:** largest shipped source file added is `apps/dispatch/src/features/override/driver-picker.tsx` at **221 lines**; nothing approaches the 500 cap, and no `max-lines` disable comment was written.

## Deviations from the plan

1. **`AssignDialog` lost its `rideId` prop.** The plan listed it; the component never read it (the page owns the id and passes it to the hook). Removing it was forced by `@typescript-eslint/no-unused-vars`.
2. **The failed-submit reset is derived, not an effect.** The plan implied `useEffect(() => setPicked(null), [errorKey])`. The repo's eslint config rejects setState-in-effect ("can trigger cascading renders"), so the step is computed: `showPicker = picked === null || errorKey !== null`, with a new `onClearError` prop so picking again drops the stale error. Behaviour is identical; one fewer render.
3. **`dialog-shell.tsx` and `row-actions.tsx` are new files the plan did not name.** Both are extractions, not scope: the shell holds the focus trap and Escape handling both dialogs need, and `row-actions` keeps the override slice — not the board slice — owning what Dina can do to a row, which is what kept `ride-queue.tsx` well inside the 500-line cap (largest shipped file in this change: `driver-picker.tsx`, 221 lines).
4. **`AuditEntry` gained an optional `payload`.** The plan's reassign task wrote `payload: { event: 'released' }` but `insertAudit` built its payload internally and ignored the caller's. One field plus a spread; without it, the release row and the assign row are indistinguishable in the audit trail.
5. **`unassignDriver()` added to `RidesRepository`.** Not in the plan's task list, but `assignDriver` guards on `isNull(driverId)`, so the new driver cannot be stamped until the old one is cleared. Guarded on the outgoing driver id so two dispatchers racing produce a 409 rather than both proceeding.
6. **`RosterService` takes `DriverLocationStore` directly**, mirroring `BoardService`, rather than going through a service wrapper — the plan said "reuse the geozone lookup"; this is the same shape #18 already uses.
7. **`dispatch-page.test.tsx` now mocks `next/navigation`.** Not a plan task. `useAssign` calls `useRouter`, which throws "invariant expected app router to be mounted" outside the app-router runtime, so the existing page test failed until mocked.
8. **Four integration tests were added in Phase A rather than deferred to Phase D**, and a stale comment in `dispatch.integration.spec.ts` was corrected — it said reassignment "needs a cancellation path (#11)", which #19 replaced. My new dispatcher fixtures also had to move to the `p(110)`–`p(112)` phone range: `p(95)`–`p(97)` are already used as DRIVER phones in that file, and reusing them made two unrelated pre-existing tests fail.

## Issues encountered

- **Colima was wedged** — `colima start` reported "already running" while `colima status` failed with "error retrieving current runtime: empty value" and both the colima and Docker Desktop sockets were dead. A `colima stop && colima start` fixed it. Any `@taxi/api` or `@taxi/db` test fails at the `pretest` docker step until this is healthy, and the failure reads as unrelated.
- **The worktree has no `.env`, and this cost 25 minutes.** The repo's PreToolUse hook blocks the agent from copying it (it matches command text, not intent), so it must be copied by hand. Without it, compose falls back to `REDIS_PORT=6379` — already held by an unrelated `vtv-redis-1` container — so `taxi-redis-1` never starts. A gate run with `REDIS_TEST_URL=redis://localhost:6381` then points ioredis at a closed port and **jest hangs indefinitely rather than failing**, with turbo buffering all output so it looks like a slow test rather than a hang. Copy `.env` in, then re-run the gate with `REDIS_TEST_URL` set to un-skip the 28 gated tests.
- **`ride_not_reassignable` vs `ride_already_assigned`** are both 409s with different operator copy; the mapping lives in `assign-state.ts:ERROR_KEYS` and an unmapped code renders the generic message rather than the raw identifier.

## Not done in this phase (by design)

- **Phase B** (phone orders, customers/venues, Google Places typeahead, telephony seam) and **Phase C** (zone/queue grid, cascade visibility, shared explanation string) — the plan's phases are independent and were sequenced deliberately; Phase B carries the plan's lowest one-pass confidence (7.5/10).
- **Phase D** acceptance closure — the *phone-order* AC scenario, the phone-channel-share query, and the ledger measurements. (Phase A's own integration coverage landed here rather than waiting for D; see Tests added.)
- **The hotkey to open the assign dialog** (plan task A12 mentioned `⌥A`). Rows are fully keyboard-reachable by Tab and the dialog itself is zero-mouse, but no global shortcut was added — the plan's keyboard-first requirement binds to Phase B's booking form, and a board-level hotkey is better designed alongside Phase B's `⌥N`.
- **Open question Q2 is now live**: `accepted|arriving → requested` is shipped in `@taxi/shared`, so #15/#16/#17 inherit it. A rider watching an accepted ride can see it return to "searching for a driver". Flagged in the plan; unchanged by implementation.
