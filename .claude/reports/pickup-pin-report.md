# Implementation Report — PIN pickup (#258)

**Plan**: `.claude/plans/pickup-pin.md`   **Branch**: `feature/pickup-pin-258` (worktree `~/taxi-worktrees/wt-258`, cut from `origin/main` `1129710`)   **Status**: COMPLETE — T1–T18 done; gate green, Level 4 steps 1–6 run (step 6 (e) found one TalkBack gap, recorded under T18)

## Summary

A rider can opt in per booking to a 4-digit pickup PIN. The api mints it at creation with `randomInt`, stores it in `rides.pickup_pin`, and returns it only on the rider's own `GET /rides/:id` (`riderRideSchema`). It sits as a sibling field and never goes on `Ride`. `POST /rides/:id/start` on a pinned ride now runs through `RideLifecycleService.start`: a row lock (`SELECT … FOR UPDATE`), a pure verdict, then either a committed failure increment or the transition. It answers 422 `pickup_pin_required` / `pickup_pin_incorrect`, or 409 `pickup_pin_locked` after 5 wrong entries. Phone riders get `sms.driver_arrived_pin`. The rider app has a remembered switch, shows the PIN and speaks it in the arrival banner. The driver app has a number field that gates Start and travels with Retry.

## Tasks completed

- T1 → `packages/shared/src/schemas/ride.ts` (UPDATE): `rideOptionsSchema.pickupPin`, `pickupPinSchema`, `rideStartSchema` (`.default({})`), `riderRideSchema`
- T2 → `packages/shared/src/i18n/{lv,ru,en}.ts` (UPDATE, 8 keys each); `packages/shared/tests/{schemas-ride-request,schemas-customer,schemas-ride-record,sms-budget}.test.ts` (UPDATE)
- T3 → `db/src/schema/rides.ts` (UPDATE); `db/migrations/0012_futuristic_centennial.sql` + `meta/0012_snapshot.json` + `_journal.json` (generated: exactly two `ADD COLUMN`); forced literals in `apps/dispatch/.../use-booking-form.ts` (with a #275 comment), `bookings.service.spec.ts`, `candidate-filter.spec.ts` (×2); `packages/shared/src/ride-state-machine.ts` (UPDATE: Q6's note on the `arrived` row)
- T4 → `services/api/src/features/rides/pickup-pin.ts` + `.spec.ts` (CREATE); `rides.repository.ts`, `rides.service.ts` (UPDATE: mint beside `trackingToken`)
- T5 → `rides.repository.ts` `findWithQuote` sibling `pickupPin`; `rider-visible-ride.ts`; `rides.service.ts` `findForRider` and its "WHAT ACTUALLY CROSSES THE WIRE" paragraph; `rides.controller.ts` return type (UPDATE)
- T6 → `services/api/src/features/rides/lifecycle/ride-lifecycle.logging.ts` (CREATE); `ride-lifecycle.service.ts` (UPDATE)
- T7 → `ride-lifecycle.policy.ts`, `ride-lifecycle.repository.ts`, `ride-lifecycle.service.ts`, `ride-lifecycle.controller.ts` (UPDATE)
- T8 → `ride-lifecycle.policy.spec.ts` (CREATE); `ride-lifecycle.service.spec.ts` (UPDATE)
- T9 → `notifications.repository.ts` `pickupPin()`, `ride-notifications.service.ts`, `ride-notifications.service.spec.ts` (UPDATE)
- T10 → `ride-pickup-pin.integration.spec.ts` (CREATE)
- T11 → `apps/rider/src/features/booking/pickup-pin-preference.ts` + `.test.tsx` (CREATE)
- T12 → `booking-screen.tsx`, `use-book-ride.ts` + both tests (UPDATE)
- T13 → `use-ride-status.tsx`, `status-screen.tsx` + both tests (UPDATE)
- T14 → `apps/driver/src/features/active-ride/active-ride-state.ts`, `use-active-ride.tsx` + tests (UPDATE)
- T15 → `active-ride-screen.tsx` + test (UPDATE)
- T16 → `docs/ux-metrics-ledger.md`, `.claude/references/ride-state-machine.md`, `.claude/references/ui-decisions.md`, `docs/runbooks/rider-a11y-walkthrough.md` step 13 (UPDATE)
- T17 → gate (below)
- T18 → EAS preview APK + emulator run (below)

## Tests added

- shared: `rideOptionsSchema.pickupPin` default + legacy row; `pickupPinSchema` accept/reject table; `rideStartSchema` absent body / leading zero / short PIN; `riderRideSchema` `'0042'` / null / `rideSchema` strips it; PIN arrival SMS one segment per language at exact lengths lv 47 / ru 43 / en 45 (`derived` in the test's docblock: fixed 33/29/31 + plate 10 + PIN 4; pinned by the test, which passes).
- api unit: `pickup-pin.spec.ts` (3); `ride-lifecycle.policy.spec.ts` (7-row verdict table + the cap); `ride-lifecycle.service.spec.ts` start: right PIN (transition, then emit after commit), wrong PIN (increment inside a committed tx, 422 after), missing PIN (no attempt), locked (409 on the right PIN, nothing written), un-pinned, logs carry the cause and never either PIN; `ride-notifications.service.spec.ts`: PIN SMS, plain SMS without PIN, app channel reads no PIN.
- api integration, `ride-pickup-pin.integration.spec.ts`, 8 cases:
  - the named socket test in the app's order (book → connect → GET → accept → arriving → arrived → start);
  - leak checks on the driver read, tracking, complete, settle and the dispatcher booking;
  - wrong PIN;
  - bodiless pinned start;
  - lockout then rider cancel;
  - forced-overlap concurrency;
  - un-pinned regression;
  - phone SMS with and without a PIN.
- **T10 case 6, both ways (`observed`, this worktree, 2026-09-23)**:
  - With `.for('update')`: 5× `422 pickup_pin_incorrect` + 3× `409 pickup_pin_locked`, column = 5. The whole file passed 3 runs of 3.
  - With `.for('update')` deleted: red. `Received: ["422 pickup_pin_incorrect" ×8]`, expected 5 of them. Restored afterwards and verified: `grep -c "for('update')"` = 1.
  - 8 attempts; the poll did not starve the pool, so no drop to 7.
- rider: `pickup-pin-preference.test.tsx` (5); `use-book-ride.test.tsx` (+1, and the existing body assertion now carries `options: { pickupPin: false }`); `booking-screen.test.tsx` (+2: labelled switch with hint, 44 px row, toggle persists `'1'`; Book disabled until the stored value loads, with a live quote); `use-ride-status.test.tsx` (+2: E1 race, null PIN); `status-screen.test.tsx` (+4).
  - **E1 mutation check (`observed`)**: moving the PIN write behind the staleness guard turns "keeps the PIN when a ride:status event lands before the read resolves" red (1 failed). Restored.
- driver: `active-ride-state.test.ts` (+6: `needsPin`, pinned start carries PIN, 2 digits posts nothing, un-pinned sends no PIN, `pickup_pin_incorrect`/`locked` do not reconcile); `active-ride-screen.test.tsx` (+6); `use-active-ride.test.tsx` (+2: POST body `{ pin }`, un-pinned POST passes `undefined`).

## Validation results

- **Gate** `REDIS_PORT=6381 COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`, run from cleared `dist` and `apps/dispatch/.next`. Result: **22 successful, 22 total**, exit 0, 1m34s (`observed`, run 2). Per package:

  | Package | Result |
  |---|---|
  | shared | 273/273 |
  | db | 17/17 |
  | dispatch | 272/272 |
  | rider | 176/176 |
  | driver | 268/268 |
  | api | 840/840 in 86 suites, none skipped |

- Run 1 was red on `@taxi/api#test` (`driver-presence.integration.spec.ts`, 9 × 409 on vehicle create). That was my bug, not a flake; see Issues.
- `ride-lifecycle.service.spec.ts`: 23 passed before T6, 23 after T6 (no behaviour change). After T8, the filter `ride-lifecycle.policy ride-lifecycle.service.spec` ran 37: service 29 (23 + 6) and policy 8 (`observed`).
- Capped files, `wc -l` at HEAD (`observed`):

  | File | Lines |
  |---|---|
  | `lv.ts` | 491 |
  | `rides.service.ts` | 484 |
  | `rides.repository.ts` | 473 |
  | `ride-lifecycle.service.ts` | **497** |
  | `booking-screen.tsx` | 267 |
  | `use-ride-status.tsx` | 262 |
  | `active-ride-state.ts` | 399 |
  | `active-ride-screen.tsx` | 248 |
  | `ride-notifications.service.ts` | 399 |

  All are ≤ 500.
- **AC2 beyond the five tested surfaces** (`observed` by grep of non-spec `services/api/src`): the new column comes back on every full-row read of `rides`. There are **6** such reads, and each is projected before it leaves the api:
  - `RidesRepository.create` `.returning()` → `toRide`
  - `findAwaitingDispatch` → `toAwaiting`
  - `findWithQuote` → `toRide`, plus the sibling field
  - `RideTransitionService.transitionInTx` `.returning()` → `toTransitioned`
  - `NotificationsRepository.rideById` and `rideByToken` → `toNotifiable`

  None of the projections copies `pickupPin`. Every other `rides` read (customers, drivers, settlement, lifecycle) selects named columns only.

## Level 4 manual validation, steps 1–5 (`observed`, 2026-09-24)

This branch's api was booted from `services/api/dist` on port 3021 (3001 is another session's) once Linards copied the root env file into the worktree. The requests were scripted in the session scratchpad (`level4.py`) against the migrated dev DB, and the evidence comes from the api's own log.

| Step | Result |
|---|---|
| 1 | Rider `+37129260001` and driver `+37129260002` signed in over OTP. The driver posted a vehicle (`LV260PN`), which is what creates the `drivers` row; force-assign 404s `driver_not_found` without it. Dispatcher: the existing `+37120000001` (#224's Dina). OTP refuses `role: dispatcher` (400 `validation_failed`), and an existing row keeps its role. |
| 2 | App ride booked with `options.pickupPin: true` and force-assigned. The rider `GET` has a 4-digit `pickupPin`; the driver `GET` is 200 with no `pickupPin` key. |
| 3 | `arriving` → `arrived` → wrong PIN **422 `pickup_pin_incorrect`** → no body **422 `pickup_pin_required`** → right PIN **201**. The rider `GET` then shows `in_progress`. |
| 4 | Fresh ride: five wrong PINs give five 422 `pickup_pin_incorrect`; the sixth, with the right PIN, gives **409 `pickup_pin_locked`**; rider cancel 201. The api log holds exactly 5 `transition_rejected` with `cause: 'pickup_pin_incorrect'` and 1 with `pickup_pin_locked` for that ride. **0** log entries contain that ride's PIN (`2647`). |
| 5 | Dispatcher `POST /dispatch/bookings` with `options.pickupPin: true`; its response `ride` has no `pickupPin` key. After assign → arriving → arrived, the stub SMS line reads `body: 'Jūsu taksometrs (LV260PN) ir klāt. PIN: 6125'`, and `rides.pickup_pin` for that ride is `6125`. That `auth.sms.stub_sent` line is the only one in the log containing `6125`, which is the dev-only exception the plan allows. |

- **Cleanup**: the phone ride was cancelled by the dispatcher. A ride left `requested` by an earlier aborted run (before the vehicle fix) was cancelled through its rider's `POST /cancel`. No `rides` row for the test phones is left open. The api was stopped.

## T18 — driver PIN flow on the Android emulator (`observed`, 2026-09-24)

- **Build**: EAS `0df8edea-932a-475a-a3f8-952d8f8c5d06`, profile `preview`, from commit `a961c20`. **FINISHED** on the first attempt: `createdAt` 08:05:15Z → `completedAt` 08:18:42Z = **807 s** (EAS's own record). APK 110 074 498 bytes. `expo install --check` reported 16 outdated packages beforehand (pre-existing on `main`, no dependency changes in this ticket); the build succeeded regardless.
- **Build-only edits, all reverted after queueing** (`git status` clean afterwards): `eas init --id 976c4e03-…` wrote `extra.eas.projectId` + `owner` and also appended eight `android.permissions`, including `RECORD_AUDIO`. The committed permission list was restored before the build, so the APK declares what the repo declares. `eas.json`'s `EXPO_PUBLIC_API_URL` was pointed at `http://192.168.1.11:3021`, because 3001 is #261's api (PID 981, per `taxi-f7`).
- **Runtime**: AVD `sakta224` (booted by this session after `taxi-f7` confirmed it was free, and shut down after), this branch's api on 3021, test driver `+37129260002` (car `LV260PN`), a pinned ride force-assigned via the api.

| Point | Result |
|---|---|
| (a) | At `arrived` the PIN field is visible and Start is disabled. ✅ |
| (b) | `uiautomator` dump (scratchpad `ui-arrived.xml`): `<node resource-id="pickup-pin-input" class="android.widget.EditText" content-desc="Pasažiera PIN kods" enabled="true" …/>` and `<node resource-id="ride-step" class="android.widget.Button" content-desc="Sākt braucienu" enabled="false" …>`. ✅ |
| (c) | Typed `1111` → Start `enabled="true"` → tap → banner «Nepareizs PIN kods.» with Retry; the field keeps `1111`. ✅ |
| (d) | Replaced with the right PIN (`5412`) and pressed **Retry** (not Start), so this also proves AC9's "Retry resends the PIN" on device → title «Brauciens notiek». The api log for that ride: `transition_applied` ×2 (`arriving`, `arrived`), `transition_rejected` `pickup_pin_incorrect` ×1, `transition_applied` `in_progress`; **0** log entries contain `5412`. ✅ |
| (e) | TalkBack **is** on this `google_apis` image and was driven from `adb` (verbose utterance log, focus moved by `DPAD`). The field reads «Pasažiera PIN kods», «Rediģēšana» / «Rediģēšanas lodziņš». **Finding:** linear focus navigation skips the **disabled** Start button in both directions (field ↔ «Atvērt Google Maps»), so a TalkBack driver never hears that Start exists or why it is unavailable. It is not a regression (the plan wants Start disabled until 4 digits), but it is an a11y gap on a screen that must be fully usable by screen reader. Logged for #276 rather than fixed here. ⚠️ |

- **Friction met on the way (not this ticket's code):**
  - A force-assign does not open the ride in an already-open app until a relaunch. This is #15's known step-7 finding, reproduced.
  - «Iziet» did not return to sign-in: push token cleared, screen unchanged. Worked around with `pm clear`.
  - `adb shell input text` typed the phone out of order; per-digit `keyevent`s did not.
  - `uiautomator dump` needs animations off («could not get idle state»); they were restored afterwards.
  - The dispatcher `+37120000001` hit the OTP rate limit (`429 too_many_requests`) after repeated script sign-ins, so the last assign used the dev dispatcher `+37120000099`.
- **Cleanup**: all three emulator rides ended (2 `completed` through the app, 1 `cancelled_by_dispatcher`). The driver was left `offline`, TalkBack disabled and its log pref removed, animations restored, the emulator killed and the api stopped.

## Deviations from the plan

- **T2a**: the `riderRideSchema` cases live in `schemas-ride-record.test.ts`, not `schemas-ride-request.test.ts`. That file already builds a full ride fixture.
- **T6**: the service line count after extraction was 449 (`observed`), not ~435. The plan's −61 did not count the two private wrappers kept to preserve call-site shape. Calling the functions directly was tried and came out longer (463) once prettier wrapped the calls. After T7 the file is **497/500**. The next edit to it will need another extraction.
- **T7**: I folded the plan's "remove a docblock line" into the start docblock to stay under the cap. The `if (verdict === 'incorrect')` body is unbraced for the same reason. Behaviour is as specified.
- **T9**: the PIN branch is a private `arrivalBody(rideId, language, plate)` helper instead of an inline `await` in the ternary. It does the same read and gives the same bodies.
- **T10 leak checks**: instead of `JSON.stringify(body)` not containing the PIN, the check walks the body and fails on any string value equal to the PIN (or containing `PIN: <pin>`) and on any non-boolean `pickupPin` value. There are two reasons:
  - A 4-digit PIN such as `2026` is a substring of every timestamp in a body.
  - `request.options.pickupPin` (the boolean opt-in) is a legitimate key on every ride.
  - The top-level `not.toHaveProperty('pickupPin')` assertions are kept as specified.
- **T10**: the spec's phone range is `+371320`, and its plates use the `PK` prefix. The first gate showed that `PN` belongs to `driver-presence`.
- **T12**: `accessibility.test.tsx` is unchanged. The switch's role, label, hint and 44 px row are asserted in `booking-screen.test.tsx` instead: rendering `BookingScreen` in the sweep file needs the session, router and places mocks that file does not carry. The row has `testID="pickup-pin-row"` for that assertion.
- **T11**: the "unmount before the read resolves" test cannot fail on a missing `cancelled` guard. React 18+ no longer warns on a set-state after unmount, so the test asserts only that nothing logs an error. The guard is in the code, but no test proves it.
- **T14**: the 4-digit check uses `pickupPinSchema.safeParse` rather than a local regex, so there is one definition.
- **T15**: two extra tests: non-digits stripped, and no field before `arrived` on a pinned ride.
- **T16**: added walkthrough step 13 (the plan's Level 4 step 6 asks for the #276 rows in `rider-a11y-walkthrough.md`; the T16 list omitted it).
- **UX states**:
  - Booking switch: loading (switch and Book disabled until read), error (read throws → off, loaded), offline (n/a) — all built.
  - Rider PIN block: loading (hidden until a read), empty (null → no block, plain arrival line), error/offline (existing banner, unchanged) — all built.
  - Driver PIN field: empty (un-pinned → no field), error (422/409 banner with catalog copy), offline (Retry resends the typed PIN) — all built.

## Issues encountered

- **Worktree without `.env`**: the PreToolUse hook blocks copying it (it refuses any command that touches the file). Every DB and Redis run passed `REDIS_PORT=6381 COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381` explicitly. After both gates, `taxi-redis-1` still maps 6381 (`observed`).
- **Migration skew**: `db/migrations/0012_futuristic_centennial.sql` (additive: nullable `pickup_pin`, `pickup_pin_failures` default 0) was applied to the shared dev DB. `ls db/migrations/*.sql | tail -1` = `0012_futuristic_centennial.sql`.
- **Gate run 1 red**, caused by me: my spec's plate prefix `PN` collided with `driver-presence.integration.spec.ts`'s. Its vehicle creates got 409 once my drivers held `PN0001`–`PN0009` in the shared test DB. Fixed by switching to `PK`. Run 2 was green.
- **Pre-existing test noise**: `active-ride-screen.test.tsx` prints 2 "overlapping act() calls" warnings on the base test file with base code too (`observed` with this ticket's driver changes stashed). It is not from this ticket.
- **T18 prechecks (`observed`)**:
  - `npx expo install --check` in `apps/driver` does **not** print nothing: it lists 16 packages behind their expected versions (e.g. `expo-task-manager` 57.0.14 vs ~57.0.19). This ticket changes no `package.json` and no lockfile (`git diff origin/main` on both is empty), so the drift is on `origin/main` and must be settled before any EAS build.
  - The 3 qemu-looking processes were colima's `limactl usernet` (the Docker VM), not an emulator, per `taxi-f7`, which also confirmed `sakta224` was free before this session booted it.
