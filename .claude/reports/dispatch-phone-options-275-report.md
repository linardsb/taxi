# Implementation Report — Dina's phone form options, the announce badge, and the dispatcher PIN read (#275)

**Plan**: `.claude/plans/dispatch-phone-options-275.md`   **Branch**: `feature/dispatch-phone-options-275` (worktree `~/taxi-worktrees/wt-275`)   **Status**: COMPLETE

## This ticket reverses a #258 rule (Q1)

#258 said "the PIN never reaches the driver, the dispatcher or the tracking page" (`pickup-pin.md:11`). #275 opens **one** door on the dispatcher leg: `GET /rides/:rideId/pickup-pin`, for dispatcher and admin only, on a phone-booked ride only (PR #300 M1), at `arrived` only, and logged per read with the actor. The PIN never rides on a ride shape: `rideSchema` stays PIN-free, and the response is its own `dispatcherPickupPinSchema`. The driver and tracking legs are unchanged. User decision 2026-09-28 (PR #277 L2). The claims this makes false were rewritten (T4b), and `pickup-pin.md` carries an AMENDMENTS line.

## Summary

- **Phone form.** Dina's form gets «PIN kods» and «Šoferis pieteiksies balsī» checkboxes, each with its hint as the accessible description. They sit between payment and note, persist with the draft, reset after a booking and are never prefilled.
- **Board flags.** The board frame carries `announceArrival` and `pickupPinRequired`, both derived tolerantly from the request options, and a row booked with the announcement shows a text badge.
- **PIN read.** On a phone-booked PIN ride at `arrived`, «Rādīt PIN» opens a dialog that reads the PIN from the new dispatcher-only route.

## Tasks completed

- T1 board wire flags, `.default(false)` → `packages/shared/src/realtime-events.ts` (UPDATE)
- T2 frame compatibility → `packages/shared/tests/realtime-events.test.ts` (UPDATE)
- T3 `dispatcherPickupPinSchema` → `packages/shared/src/schemas/dispatch.ts` (UPDATE)
- T4 → `packages/shared/tests/schemas-dispatch.test.ts` (UPDATE)
- T4b claims retired → `packages/shared/src/schemas/ride.ts`, `ride-pickup-pin.integration.spec.ts` (`:254` and the file docblock), `.claude/references/ride-state-machine.md`, `.claude/plans/pickup-pin.md` (UPDATE)
- T5 12 keys × LV/EN/RU → `packages/shared/src/i18n/{lv,en,ru}.ts` (UPDATE). Line counts after (`observed`, `wc -l`): 420 / 427 / 434.
- T6 `boardFlagsOf` + `BoardRide` fields → `services/api/src/features/rides/board-ride.ts` (UPDATE)
- T7 → `rides.repository.ts`, `dispatch/board/board.service.ts`, `board.service.spec.ts` (UPDATE)
- T8 → `services/api/src/features/rides/board-ride.spec.ts` (CREATE)
- T9 → `services/api/src/features/rides/rides.integration.spec.ts` (UPDATE)
- T10 → `lifecycle/pickup-pin-read.service.ts` (CREATE), `ride-lifecycle.repository.ts` `findPickupPinTarget`, `ride-lifecycle.controller.ts` `GET :rideId/pickup-pin`, `rides.module.ts` (UPDATE)
- T11 → `lifecycle/pickup-pin-read.service.spec.ts` (CREATE)
- T12 → `lifecycle/ride-pickup-pin.integration.spec.ts` (UPDATE)
- T13 → `apps/dispatch/src/features/phone-orders/booking-draft.ts` (UPDATE)
- T14 → `booking-draft.test.ts` (UPDATE)
- T15 → `use-booking-form.ts` (UPDATE)
- T16 → `use-booking-form.test.tsx` (UPDATE)
- T17 → `booking-form.tsx` (UPDATE)
- T18 → `booking-form.test.tsx` (UPDATE)
- T19 → `board/ride-queue.tsx`, `override/row-actions.tsx` (UPDATE)
- T20 → `board/ride-queue.test.tsx` (UPDATE)
- T21 → `override/use-pickup-pin.ts`, `override/pin-dialog.tsx` + tests (CREATE); `override/index.ts`, `override/use-assign.ts` (`errorCodeOf` exported) (UPDATE)
- T22 → `app/dispatch/page.tsx` (UPDATE, 387 lines, `observed` `wc -l`), `board/dispatch-page.test.tsx` (UPDATE)
- T1 fixture sweep → `override/assign-state.test.ts` (UPDATE)
- Cosmetics logged → `.claude/references/ui-decisions.md` (UPDATE, 4 lines)
- T17 follow-up, Enter toggles instead of submitting → `booking-form.tsx`, `booking-form.test.tsx` (UPDATE; see Deviation 10)
- T23 gate, T24 Level 4 and the #275 checkbox: done.

## Tests added

| Where | Cases |
|---|---|
| shared `realtime-events.test.ts` | a cached frame without the flags parses as both false (edge); both flags round-trip through JSON (expected) |
| shared `schemas-dispatch.test.ts` | `0042` keeps its zeros (expected); `42` and `12345` fail (failure) |
| api `board-ride.spec.ts` | valid options (expected); `{}` → false (edge); `options: 'junk'` → false, no throw (failure); `null` → false (failure) |
| api `board.service.spec.ts` | both flags reach the frame, and a sibling reads false (expected) |
| api `pickup-pin-read.service.spec.ts` | `arrived` + PIN → `{ pin }` and one audit log with the actor (expected); no row → 404 (failure); no PIN → 409 `pickup_pin_not_set` (edge); app ride with a PIN → 409 `pickup_pin_not_phone` (failure, PR #300 M1); `arriving` → 409 `ride_not_arrived` plus the rejection log (edge). `afterEach` asserts that no log call in any case contains the PIN. |
| api `rides.integration.spec.ts` | flags through the real `findBoardRides` (expected); malformed `options` stays on the board, unbadged (edge) |
| api `ride-pickup-pin.integration.spec.ts` | L2 recovery: phone booking → accept → arrived → Dina reads the PIN, and an admin reads it too (PR #300 L2) → the driver starts with it → 201 (expected). Refusals: rider 403, driver 403, unknown uuid 404, `accepted` 409 `ride_not_arrived`, no-PIN ride at `arrived` 409 `pickup_pin_not_set`, app-booked PIN ride at `arrived` 409 `pickup_pin_not_phone` (PR #300 M1) (failure). Board: `GET /dispatch/board` has both flags true, no key matching `/pin/i` other than `pickupPinRequired`, and no string equal to the PIN (expected + leak check). |
| dispatch `booking-draft.test.ts` | pre-#275 draft restores with both false (edge); a tick round-trips (expected); `pickupPin: 'yes'` → null (failure) |
| dispatch `use-booking-form.test.tsx` | both ticks reach the body, `childSeat`/`femaleDriver` stay false, and the draft resets after success (expected + E4); no ticks → both false (regression); `prefillFrom('recent')` never sets an option (E5); a tick survives close-and-reopen (edge) |
| dispatch `booking-form.test.tsx` | tab order now includes the two checkboxes (expected); ticking both through the DOM sends both (expected); Enter on a focused checkbox toggles it and prevents the default, so the form does not submit (edge, added after Level 4 step 8); each checkbox's accessible description is its hint (AC5) |
| dispatch `ride-queue.test.tsx` | badge on the flagged row only, no flash, no live region (expected + regression); «Rādīt PIN» absent at `arriving` with the flag and at `arrived` without it, absent on an app-booked ride at `arrived` with it (PR #300 M1), present on a phone ride at `arrived` with it (E13); click reports the ride, and the accessible name carries the address (expected) |
| dispatch `use-pickup-pin.test.tsx` | 200 → shown with a bearer GET, `no-store` (expected); 409 `ride_not_arrived` → mapped key (edge); 500 → generic (failure); 401 → `/login` (failure); stale response loses (E12); no PIN in `localStorage`, and `clear()` → idle (E11); a read still in flight at `clear()` lands and the state stays idle (PR #300 L1) |
| dispatch `pin-dialog.test.tsx` | shown → digits and hint in `role="status"` (expected); loading inside the same status (edge); error → `role="alert"`, no status (failure); «Aizvērt» → `onClose` (expected) |
| dispatch `dispatch-page.test.tsx` | click «Rādīt PIN» on an `arrived` PIN ride → the stubbed PIN is shown → Escape → no PIN text anywhere in the document (expected) |

**Mutation checks** (`observed`, all reverted and green again):

- **T11, success path** (at `36df1f2`, 4 cases). `pin` added to the success log → 1 of 4 red. `pin` added to the rejection log → 3 of 4 red. PR #300 added a fifth case; the re-observed rejection-log count is in `pr-300-review-fixes.md`.
  - The first attempt turned all 4 red. The failing `afterEach` skipped `restoreAllMocks`, so the leftover spy calls leaked into the next case. The hook now reads the calls, restores, then asserts.
- **T21, stale guard** (at `36df1f2`). The `requestId` comparison removed → the stale-response case goes red (1 of 6). After PR #300 L1 it is 2 of 7: the new in-flight `clear()` case goes red too.
- **Enter handler.** `preventDefault()` removed → the Enter case goes red (1 of 12).

## Validation results

- **Full gate at the head `36df1f2`** (`observed`, recorded in `.claude/last-gate.json`: `head 36df1f2`, `dirty: false`): `pnpm turbo run typecheck lint test build --force`, started 2026-09-28T15:40:05Z, after the commit at 14:45:22Z. Exit 0, `Tasks: 22 successful, 22 total`, `elapsed 1m44.782s`. Its counts equal the table below digit for digit, and CI's `check` job (run 36445642185) reproduced them at the same head. This is the run the PR body cites.
- **Full gate before the commit** (`observed`, on the uncommitted tree; corrected label, PR #300 L4 — this run was called "final" but predates `36df1f2`): `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force`, started 2026-09-28T14:39:48Z from cleared `dist`/`.next`, after the Enter fix. Exit 0, `Tasks: 22 successful, 22 total`, 2m05s wall.

  | package | result |
  |---|---|
  | shared | 30 files, 304 tests |
  | dispatch | 32 files, 302 tests |
  | db | 3 files, 17 tests |
  | rider | 37 suites, 231 tests |
  | driver | 46 suites, 357 tests |
  | api | 91 suites, 927 tests, none skipped (`REDIS_TEST_URL` set) |

  The first gate (14:22:52Z, same 22/22, dispatch 301) predates the Enter fix and is superseded by both runs above. The PR #300 round-1 fixes change these counts; their gate is in `.claude/reports/pr-300-review-fixes.md`.

- **Level 3 targeted run** (`observed`, before the gate): `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- rides.integration ride-pickup-pin arrival-announce` → 4 suites, 52 tests passed. The pickup-PIN file ran 12 cases, the 9 it had plus the 3 new ones, which confirms the new cases executed and were not skipped.
- **Lint.** `@taxi/api` shows 16 warnings, all pre-existing `no-unsafe-argument` on the `request(ctx.app.getHttpServer())` lines. `@taxi/dispatch` is clean.

## Level 4 (AC9), run 2026-09-28 ~14:31–14:38Z against this worktree's api (`:3001`) and console (`:3000`)

All results `observed`.

1. **Sign-in.** Dispatcher `+37120000099` and driver `+37120000002` signed in over OTP, with codes from the stub log. `role: 'dispatcher'` is refused by `POST /auth/otp/request`: the enum is `rider | driver`, and an existing user's stored role wins, so the request used `role: 'driver'`.
2. **Booking.** `POST /dispatch/bookings`, caller `+37120275001`, `options: { pickupPin: true, announceArrival: true }` → ride `981f69cb…`. The booking response carries no PIN string.
3. **Board.** `GET /dispatch/board` → the ride has `"announceArrival":true,"pickupPinRequired":true`, and no PIN key or value.
4. **Early read.** `GET /rides/<id>/pickup-pin` → `409 ride_not_arrived`, logged as `dispatcher_read_rejected` with `cause` and `actorId`.
5. **Arrival.** Force-assign, then `arriving` and `arrived`, each → 201.
6. **Read at arrival.** `GET …/pickup-pin` → `{"pin":"8376"}` (200). The stub SMS line reads `Jūsu taksometrs (EMU224) ir klāt. PIN: 8376`. `grep 8376` on the api log prints that one line only; the `ride.pickup_pin.dispatcher_read` entry has `rideId`, `actorId` and `at`, and no PIN.
7. **Start.** Driver `start {"pin":"8376"}` → 201, then `complete` → 201.
8. **Console, in Chrome via `agent-browser`.**
   - **Form.** ⌥N, typed the caller, and the recent-ride prefill offered «Hanzas iela, Rīga → Teika, Rīga». Tab from the destination went payment radio → `booking-pickup-pin` → `booking-announce-arrival` → note → «Pasūtīt». Each checkbox carries `aria-describedby` to its hint, and both hints are visible. Space ticked both. Screenshot: native focus ring on the checkbox.
   - **Enter on a focused «PIN kods» SUBMITTED the form.** The success screen appeared and the api create count went from 1 to 2. That is the T17 gotcha, confirmed, and it is fixed: see Deviation 10. After the fix, on a bookable form, Enter toggled «PIN kods» on, then off, and toggled «Šoferis pieteiksies balsī» on; nothing submitted, and the create count stayed at 2.
   - **Board.** The row read «Hanzas iela, Rīga | Meklē šoferi | Pieteikšanās balsī | 00:17 | …». After a curl force-assign to `arrived`, the row offered «Rādīt PIN — Hanzas iela, Rīga» first in the cluster.
   - **Dialog.** Clicking it showed «Ielādē…», then `5203` within about 1 s, with the hint. That matches the stub SMS `PIN: 5203`. Focus lands on «Aizvērt».
   - **After Escape.** No dialog, `document.body` does not contain `5203`, and no `localStorage` value (`booking-draft`, `board-snapshot`, `session`) contains it.
   - **Tool note.** The first `agent-browser click` on «Rādīt PIN» did nothing: the row was below the fold (y=1042 in a 577 px viewport), and the pre-existing «Atcelt braucienu» button failed the same way. After `scrollintoview`, the pointer click worked. A JS `click()` worked throughout. This is the tool's off-screen click, not the console.
9. **Cleanup.** The console-booked ride `28ae7679…` was cancelled as the dispatcher (201). Ride `981f69cb…` had already completed. The driver was set offline. No Hanzas ride is left on the board. The six «Brīvības iela 30» rides on the board predate this run and were left alone.

**Level 5 (VoiceOver): not run.**

## UX states (per surface)

| Surface | Loading | Empty | Error | Offline |
|---|---|---|---|---|
| Checkboxes | n/a | ✅ unticked by default (T16 regression case) | n/a | ✅ unchanged: the draft persists and submit is disabled with its existing reason (no new code) |
| Badge | n/a | ✅ absent when false (T20) | ✅ a bad `options` degrades to no badge (T8, T9) | ✅ last-known under the existing stale banner (no new code) |
| PIN dialog | ✅ `console.loading` in the status region (pin-dialog test) | n/a | ✅ `role="alert"` with the mapped key (T21) | ✅ not gated, by design, with a comment in `page.tsx`; a failed fetch shows `console.pin_failed` |

## Deviations from the plan

1. **`console.show_pin_at` is «Rādīt PIN — {address}»,** not the plan's «Rādīt PIN: {address}». This matches the other `_at` row-action keys (`console.cancel_ride_at` and others). It is cosmetic and logged in `ui-decisions.md`.
2. **`clear()` also invalidates an in-flight read** by bumping the request id. The plan's guard covered two `reveal`s. This extends it to close-then-late-response, so a read cannot repaint a closed dialog.
3. **The `role="status"` region wraps the loading text too,** not only the PIN. A live region has to be in the DOM before its content changes for a screen reader to announce the change. The error state swaps it for a `role="alert"`.
4. **T11 runs two mutations,** on the success log and on the rejection log, where the plan named one. The `afterEach` was reordered (read, restore, assert) after the first mutation showed a red case leaking its spy calls into the next.
5. **The T12 board leak check walks the RAW response body.** Walking the parsed one could strip an unknown key. It also reuses the file's existing `flatten` helper for the string check.
6. **The `ride-pickup-pin.integration.spec.ts` file docblock** changed "the rider-only read" to "the rider's read … plus the dispatcher's logged read at `arrived`". This is the same retire-the-subject rule as T4b, applied at one more site the plan did not list.
7. **T16's persist test waits on `localStorage` with `waitFor`** instead of advancing fake timers. This matches the file's existing close-and-reopen case.
8. **The T1 fixture sweep touched only `assign-state.test.ts`.** `use-board.test.tsx:372` and `board-state.test.ts:58` build `dispatch:unclaimed` events, not board rides, which is what the plan suspected, so they need no change. `ride-queue.test.tsx` was updated as the plan listed.
9. **EN and RU wording is mine.** The plan gave LV only. Placeholder parity is enforced by `tests/i18n.test.ts`, which is green.
10. **Enter on a pickup checkbox toggles it instead of submitting the form.** The plan made this conditional on Level 4 step 8, and Chrome did submit (see Level 4). The fix is an `onKeyDown` on both checkboxes that prevents Enter's default and flips the box, plus a test (`booking-form.test.tsx`) and a mutation check. The full gate was re-run after the fix.

## Issues encountered

- The worktree had no `node_modules` or `dist` at start. `@taxi/db` had to be built before the api typecheck would resolve.
- **The env file could not be copied into the worktree.** The PreToolUse hook blocks any command that names it, correctly. Integration suites and the gate ran on harness defaults. The user copied it in for Level 4.
- `next dev` regenerated the tracked `apps/dispatch/AGENTS.md`. It was restored with `git checkout` after the servers stopped, so it is not in this diff.
- The pre-gate check `ps aux | grep -c "[t]urbo run"` printed 1 before the second gate. That was a self-match: the same shell command contained the text `turbo run`. Re-checked afterwards: the only matching processes were this session's own shells, so no other gate was running.
- Latest migration in this worktree: `db/migrations/0013_concerned_wiccan.sql`. This ticket adds none.

## Closed out

- **AC10.** #275's PR #277 L2 checkbox is ticked. A sub-line records the decision and points at Q1 in this plan, with no closing keyword.
