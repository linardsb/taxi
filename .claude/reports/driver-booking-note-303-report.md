# Implementation Report — the driver sees the dispatcher's booking note (#303)

**Plan**: `.claude/plans/driver-booking-note-303.md`   **Branch**: `feature/driver-booking-note-303` (worktree `/Users/Berzins/taxi-worktrees/wt-303`, base `da9c933`)   **Status**: COMPLETE (Level 4 step 7, VoiceOver, not performable here, as planned)

## Summary

Dina's phone-booking note is trimmed once in `BookingsService` (blank → null), stored in a new nullable `rides.dispatcher_note` column inside the ride's own insert, returned by `findWithQuote` as a sibling of `ride`, and projected only by `toDriverRide` inside `DISPATCHER_NOTE_VISIBLE_STATUSES` (the whole active ride). The driver's active-ride screen shows it as one bordered, screen-reader-grouped block under the arrival prompt, gated again on the same shared set.

## Tasks completed

- T0 → branch `feature/driver-booking-note-303` cut from `docs/plan-303-driver-booking-note`; plan committed (`0d2537d`); `wt-303-probe.patch` applied (`git apply --check` passed first)
- T1 → `packages/shared/src/ride-state-machine.ts` (UPDATE, from patch)
- T2 → `packages/shared/src/schemas/ride.ts` (UPDATE, from patch)
- T3 → `packages/shared/src/i18n/{lv,ru,en}.ts` (UPDATE, from patch)
- T4 → `packages/shared/tests/schemas-driver-ride.test.ts` (UPDATE)
- T5 → `db/src/schema/rides.ts` (UPDATE), `db/migrations/0014_redundant_mandroid.sql` + `meta/0014_snapshot.json` + `_journal.json` (CREATE/UPDATE, drizzle-generated, from patch). SQL is exactly `ALTER TABLE "rides" ADD COLUMN "dispatcher_note" text;`
- T6 → `services/api/src/features/rides/rides.repository.ts` (UPDATE, from patch)
- T7 → `services/api/src/features/rides/rides.service.ts` (UPDATE, from patch) — 496 lines at T7, before the AC8 import; 497 at `579d434` (see Validation), cap 500 (`observed`, `wc -l`)
- T8 → `services/api/src/features/dispatch/bookings/bookings.service.ts` (UPDATE, from patch)
- T9 → `services/api/src/features/dispatch/bookings/bookings.service.spec.ts` (UPDATE)
- T10 → `driver-ride.ts` (UPDATE, from patch), `driver-ride.spec.ts` (UPDATE: `:115` fix from patch, new cases here)
- T11 → `services/api/src/features/rides/lifecycle/ride-read.integration.spec.ts` (UPDATE, from patch)
- T12 → `apps/driver/src/features/active-ride/active-ride-screen.tsx` (UPDATE, from patch)
- T13 → `apps/driver/src/features/active-ride/active-ride-screen.test.tsx` (UPDATE, from patch)
- T14 → `.claude/references/ui-decisions.md` (UPDATE)
- T15 → comment on #271: https://github.com/linardsb/taxi/issues/271#issuecomment-5891604399
- T16 → full gate, below

## Tests added

| File | Cases | Result (`observed`) |
|---|---|---|
| `packages/shared/tests/schemas-driver-ride.test.ts` | expected: note round-trips · edge: omitted → null, 280 LV+RU chars parse (length asserted in the test), window pinned literally and `toBe(ACTIVE_DRIVER_RIDE_STATUSES)` · failure: `''` and 281 chars refused | shared 307/307 |
| `bookings.service.spec.ts` | expected: sixth `rides.request` argument is the note · edge: `'  Ratiņkrēsls  '` → trimmed to both ride and audit; `'   '` → null and `payload: {}` · failure: with the audit rejecting, the note was the sixth argument and `rides.request` ran before `insertBookingAudit` (`invocationCallOrder`) | api unit 49/49 for this file + `driver-ride.spec` |
| `driver-ride.spec.ts` | 14-status `it.each` through `driverRideSchema.parse`: note in the 4 active statuses, null in the other 10 · edge: null note stays null at `accepted` · expected: `readDriverRide` passes `findWithQuote`'s `dispatcherNote` through (mock sets it explicitly) | as above |
| `ride-read.integration.spec.ts` | the three #303 cases from the patch (whole active ride + offer socket/push + rider GET + booking 201; audit-insert failure; blank note and app booking) | `ride-read.integration` + `bookings.integration`: 19/19 |
| `active-ride-screen.test.tsx` | the four #303 cases from the patch (composed label; 280 chars whole at `in_progress`, no `numberOfLines`; no box when null; client gate at `offered`) | driver 361/361 |

**Probes** (`observed`, this worktree, 2026-09-29):

| Probe | Planted | Restored |
|---|---|---|
| T10: `toDriverRide`'s note gate swapped to `RIDER_PHONE_VISIBLE_STATUSES` | `driver-ride.spec`: 1 failed, 41 passed of 42 | 42/42 |
| T11: `dispatcherNote: snap.dispatcherNote` planted in `findForRider`'s return (`rides.service.ts:257`) | `cd services/api && npx jest ride-read.integration -t '#303'`: 1 failed, 2 passed, 5 skipped of 8 — `Expected path: not "dispatcherNote"` | 3 passed, 5 skipped of 8 |

The failing row in the T10 probe is `in_progress` by derivation: it is the only status inside `ACTIVE_DRIVER_RIDE_STATUSES` and outside `RIDER_PHONE_VISIBLE_STATUSES` (4 − 3 = 1), which matches the 1 red. The per-row name was not printed. A first run of this probe went through `pnpm --filter @taxi/api test -- … -t '#303'`, which printed 26 tests: the filter did not apply as intended, so that count is discarded and the run above replaces it. The T11 probe shows the rider path is not blocked structurally: the controller does not strip an unknown key, so the assertion is the guard.

## Validation results

- `pnpm --filter @taxi/shared typecheck && lint && test && build` — green; `grep -c DISPATCHER_NOTE_VISIBLE_STATUSES packages/shared/dist/ride-state-machine.d.ts` = 1
- `pnpm --filter @taxi/api typecheck` — green; `lint` — 0 errors, 16 warnings (all the pre-existing `no-unsafe-argument` on `supertest(app.getHttpServer())` in integration specs; the script has no `--max-warnings 0`)
- `pnpm --filter @taxi/driver typecheck && lint && test` — green, 361/361
- **Full gate** (`observed`, final run, after the AC8 fix): from cleared `dist` and `apps/dispatch/.next`, `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` → exit 0, **22/22 tasks**, api **951/951 tests, 92/92 suites, 0 skipped**, 2m6.6s. Derived: the plan's probe run was 931; +17 unit cases in T9/T10 (1 + 14 + 1 + 1) gave 948/91 on this session's first gate (`observed`, 2m0.6s), and +3 in the new `ride-failure-reason.spec.ts` give 951/92.
- `rides.service.ts`: 497 lines (cap 500, `observed`, `wc -l`).

## Level 4 manual validation (emulator `sakta224`)

`observed` 2026-09-29, 16:07–16:19 host time (BST). EAS `preview` build `131812ce-7210-41f4-8ad8-f67eba3da1c7`, status FINISHED, `gitCommitHash` `82f368b` (the `wip:` commit holding every source change in this report). Built with the uncommitted emulator origin `http://10.0.2.2:3001` in `eas.json` and the project link in `app.json`; both reverted after the build (`git status` clean). API: this worktree's `nest start --watch` on 3001 with `COMPOSE_PROJECT_NAME=taxi`. Dev DB migrated to `0014` first (`dispatcher_note` column present). Driver `+37120000002` (vehicle EMU224), dispatcher `+37120000001`. Bookings went through `POST /dispatch/bookings` with explicit coordinates. The stack has no maps key, so the console form cannot geocode (`driver-15-offers-device-pass.md:365`). Locale `lv-LV`.

| Step | Result | Evidence |
|---|---|---|
| 1 Offer card, note `Ratiņkrēsls, zvanīt pie vārtiem. Инвалидная коляска.` | ✅ no note on the card; the booking's 201 body contains no `Ratiņ` (grep count 0) | screencap `l4-1-offer.png` |
| 2 Accept | ✅ «Dispečera piezīme» block with the full note, under «Pasažieris: Pārbaude», above «Iekāpšana» | `l4-2-accepted.png` |
| 3 280-character LV+RU note | ✅ all 280 characters render, last word cut at the 280 boundary («Ratiņkrē»), no ellipsis; fits without scrolling on 1080×2400; DB `length(dispatcher_note)` = 280 | `l4-3-280.png` |
| 4 TalkBack | ✅ one stop: `TYPE_VIEW_ACCESSIBILITY_FOCUSED \| Dispečera piezīme. Ratiņkrēsls, zvanīt pie vārtiem. Инвалидная коляска.`; the next stop is «Braucu pie pasažiera». Focus moved with `KEYCODE_DPAD_DOWN` (`input swipe` is not a TalkBack gesture, `driver-device-day.md:612`) | `l4-4-talkback.txt` (logcat `Speaking fragment`) |
| 5 Step through | ✅ block present at «Ceļā pie pasažiera», «Esat klāt», «Brauciens notiek» (uiautomator dump); ended view «Brauciens pabeigts» has no note | dumps; `l4-5-in-progress.png`, `l4-5-completed.png` |
| 6 Whitespace-only note `'   '` | ✅ no block, no empty box; DB `dispatcher_note IS NULL` | `l4-6-blank.png` |
| 7 VoiceOver | not performable here (no iOS hardware, owed by #257) | — |

AC8, observed on the device run too: `grep -cE 'Ratiņ|коляска|zvanīt pie'` over the API's whole log for the pass = 0.

Artifacts are in the session scratchpad (`/private/tmp/claude-501/…/scratchpad/l4-*`), not in the repo.

**Run notes.** Two offers for the 280-character note expired unaccepted. The first arrived while the ended view was still up. On the second, a `uiautomator dump` poll stalled during the countdown animation. Both rides were left `requested` with the note, plus one from the first expiry, and all three were cancelled as the dispatcher afterwards (`POST /rides/:id/cancel`, 201 ×3). The third attempt was accepted with a timed tap. None of this is a #303 behaviour. The driver ended offline, and the API and emulator are stopped. The old APK on the AVD had a different signing key and was uninstalled, which dropped its stored driver session.

## Acceptance criteria

- [x] AC1 — `driver-ride.spec` 14-status table + `readDriverRide` case; T11 case 1 (phone booking) and case 4 (blank, app booking)
- [x] AC2 — `toDriverRide` over all 14 statuses; screen gate case at `offered`; T10 mutation probe red
- [x] AC3 — T9 failure case (call order) + T11 audit-failure case
- [x] AC4 — T13 composed-label case; LV/RU/EN keys, `i18n.test.ts` green in the gate
- [x] AC5 — T9 blank case, T11 case 4, T13 null case
- [x] AC6 — T11 case 1 (280 LV+RU, byte for byte through Postgres); T13 280-char case (no `numberOfLines`)
- [x] AC7 — T11 case 1 (offer socket, offer push, rider GET, booking 201); rider-read case shown RED with a planted leak and GREEN without
- [x] AC8 — no new log call in the diff (`git diff origin/main | grep '^+.*logger\.'` is empty); `dispatch.booking.audit_failed` logs `error.name` only; `ride.request.failed` logged `error.message`, which carried the note — fixed, see Deviations. **Half-fixed at `579d434`:** the rethrown `DrizzleQueryError` still reached Nest's default `ExceptionsHandler`, which logs it whole (PR #304 review H1); closed in the review-fix pass by `rideFailureToThrow`, see `pr-304-review-fixes.md`
- [x] AC9 — full gate above
- [x] AC10 — #271 comment linked above
- [x] Level 4 manual pass, steps 1–6 — below; step 7 not performable

## Deviations from the plan

- **Level 4 step 6 used a whitespace-only note (`'   '`), not an empty one.** It is the D4 case and the stricter of the two: an empty note is sent as null by the console and never reaches the trim.
- **Added `services/api/src/features/rides/ride-failure-reason.ts` (+ spec), which the plan did not list ("No new source files").** AC8 found a leak the plan missed: drizzle-orm 0.45.2's `DrizzleQueryError` builds its message as `Failed query: …\nparams: …` (`node_modules/drizzle-orm/errors.js:12-13`, `observed`), and `ride.request.failed` logged `error.message`. A failed `rides` insert would therefore have written the note into the error log. `rideFailureReason` reduces a `DrizzleQueryError` to `query_failed:<SQLSTATE>` and keeps any other error's message. The same params also carry the pickup PIN and tracking token, which leaked the same way before this ticket. This fix cleaned only the `ride.request.failed` line: the rethrown error was still logged whole by Nest's default handler (PR #304 review H1), closed in the review-fix pass by `rideFailureToThrow`. In a separate file because `rides.service.ts` is at the cap (497/500). The spec tests the helper and the premise (drizzle's message contains the note); the one-line wiring in `rides.service.ts` had no dedicated test at `579d434`; the review-fix pass adds one through `POST /dispatch/bookings`.
- **T13 "in_progress still shows it"** is covered by the 280-character case running at `in_progress`, not by a separate case. Same assertion surface, one fewer render.
- **T9 failure case** asserts call order with `invocationCallOrder` and a `?? 0` fallback (fails closed if the audit was never called) rather than only asserting the argument; this makes "before the audit rejected" a checked claim.
- **T9 helper `noteArg`** reads the sixth argument through `unknown[]`: indexing `mock.calls[0][5]` directly tripped `no-unsafe-member-access`.
- **T4 `NOTE_280`** is `'Ratiņkrēsls, коляска. '.repeat(13).slice(0, 280)` (22 × 13 = 286, sliced to 280); a first draft used `padEnd`, which does not truncate and would have built 286 characters. The test's own `toHaveLength(280)` is what would have caught it.

## Issues encountered

- The plan file was untracked in `wt-303`, not in the main checkout; the skill's path resolved against the main checkout first.
- Last migration on this branch: `db/migrations/0014_redundant_mandroid.sql`. Main is at `0013`; a sibling branch that also generates `0014` will conflict on `_journal.json`.
- The shared dev DB is now migrated to `0014` (additive nullable column; sibling sessions on `0013` code are unaffected).
