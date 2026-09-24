# Implementation Report — the driver's ride read carries rider identity (#261)

**Plan**: `.claude/plans/driver-ride-rider-identity.md`   **Branch**: `feature/driver-ride-rider-identity-261` (worktree `~/taxi-worktrees/wt-261`)   **Status**: COMPLETE — code, tests, gate and AC8 steps 1–5 on `sakta224`; step 6 (iOS) owed by #257

## Summary

A driver's `GET /rides/:rideId` and `POST /rides/:rideId/complete` now return a `rider` block, `{ displayName, phone }`. Each field is gated server-side by a shared status window: the phone in `accepted`/`arriving`/`arrived`, the name in those plus `in_progress`. The driver app parses the new `driverRideSchema`, shows «Pasažieris: {name}» and a «Zvanīt pasažierim» `tel:` button, and gates both on the same shared sets. This matters because `step_done` moves the status without re-reading the ride. The rider's read is unchanged, and a raw-body assertion pins that.

## Tasks completed

- Status windows + `isInStatusSet`. No generic membership helper existed; `grep` found only `isCancelled` and the payment lock. → `packages/shared/src/ride-state-machine.ts` (UPDATE)
- `driverRideRiderSchema`, `driverRideSchema`, `DriverRide`. → `packages/shared/src/schemas/ride.ts` (UPDATE). `./user` does not import `./ride`, so there is no cycle.
- Catalog keys `driver.ride.rider_name` / `call_rider` / `call_rider_hint` in LV/RU/EN. → `packages/shared/src/i18n/{lv,ru,en}.ts` (UPDATE)
- `findRiderIdentity`. → `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts` (UPDATE)
- `toDriverRide` (pure) and `readDriverRide` (the moved driver read). → `services/api/src/features/rides/lifecycle/driver-ride.ts` (CREATE)
- `findForDriver` delegates to `readDriverRide`, and `complete` returns `{ ride: DriverRide }`. → `ride-lifecycle.service.ts` (UPDATE, 496 → 467 lines)
- Return types: `Promise<Ride | DriverRide>` and `Promise<{ ride: DriverRide }>`. → `rides.controller.ts`, `ride-lifecycle.controller.ts` (UPDATE)
- The state, events and both parsers use `DriverRide` / `driverRideSchema`. → `apps/driver/src/features/active-ride/active-ride-state.ts`, `use-active-ride.tsx` (UPDATE)
- Name line and call button behind the shared sets. → `active-ride-screen.tsx` (UPDATE)
- `callRider`. → `nav-links.ts` (UPDATE)
- Optional `accessibilityHint` pass-through. → `apps/driver/src/components/Button.tsx` (UPDATE)

## Tests added

- `packages/shared/tests/schemas-driver-ride.test.ts`, 3 cases:
  - expected: the full block parses;
  - edge: a null block parses, and both windows are pinned as literal arrays;
  - failure: a missing block throws, and so does a non-E.164 phone.
- `services/api/src/features/rides/lifecycle/driver-ride.spec.ts`:
  - `it.each` over all 14 statuses (`RIDE_STATUSES.length` is asserted as 14);
  - expected: `arrived` gives both fields;
  - edge: `in_progress` gives the name and a null phone;
  - edge: a blank name becomes null, and 130 `a`s padded with spaces come back as 120;
  - failure: an undefined identity gives both null, and so does `completed`;
  - the ride's other fields are untouched.
  - Every output goes through `driverRideSchema.parse`.
- `ride-read.integration.spec.ts`:
  - new test (driver 6, rider 54, `+371300` range): the full block at `accepted`, `arriving` and `arrived`; at `in_progress` the name only; the `complete` reply and a later `GET` both null.
  - R1 extended with `expect(riderRes.body).not.toHaveProperty('rider')` on the RAW body.
- `active-ride-screen.test.tsx`, 4 cases:
  - expected: at `arrived`, the name line, the label with no digits, the hint, and `openURL('tel:+37120000003')`;
  - edge (client gate): at `in_progress` with the phone still in memory, no button and the name kept;
  - failure: with no name, no line and no hint, and a rejecting `openURL` is swallowed;
  - edge: a null phone inside the window gives no button.
- `Button.test.tsx`: the hint passes through, and is absent when not given.
- `nav-links.test.ts`: `callRider` dials `tel:`, and a rejection resolves `undefined`.
- `ride-lifecycle.service.spec.ts`: `findRiderIdentity` added to the `as unknown as` lifecycle mock. Without it, the six `complete` tests would fail at run time with "not a function", and typecheck could not flag it.

**Revert probes (both `observed`, this session):**

- **AC6, rider path.** `RidesService.findForRider` was made to spread a `rider` key into its return. R1 went RED: `expect(received).not.toHaveProperty(path)`, `Expected path: not "rider"`, `Tests: 1 failed, 4 skipped`. After restoring the file (`git status` clean for it), R1 was GREEN: `4 skipped, 1 passed`.
- **Client gate.** The phone gate was forced true (`true || isInStatusSet(...)`). The edge case went RED (`1 failed, 12 passed`). After restoring, it was GREEN (`13 passed`).

## Validation results

- **Level 1–2.** Each package was typechecked, linted and tested per task:
  - shared: `29 files, 258 passed`;
  - driver: `45 suites, 260 passed`;
  - `driver-ride.spec.ts` plus `ride-lifecycle.service.spec.ts`: `43 passed`.
- **Integration.** `COMPOSE_PROJECT_NAME=taxi … jest ride-read.integration.spec.ts` gave `Tests: 5 passed, 5 total`. That is the 4 existing tests plus the new one; each was also run alone with `-t`.
- **Gate** (`observed`, this worktree, after clearing `apps/dispatch/.next`): `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force` exited 0.
  - `Tasks: 22 successful, 22 total`, `Time: 2m25.878s`.
  - `@taxi/api`: `Test Suites: 84 passed, 84 total`, `Tests: 833 passed, 833 total`. No test reported as skipped: the only `skipped` strings in the log are three log-event names.
  - `@taxi/driver`: `260 passed`. `@taxi/shared`: `258 passed`.
- **Gate re-run after the rebase** (`observed`, 2026-09-23, same command, this worktree, on `eff8b83` plus the uncommitted docs edits of the next commit, so the same code as `ae7d17e`): exit 0, `Tasks: 22 successful, 22 total`, `Time: 1m34.699s`. `@taxi/api` `84 passed` suites and `833 passed, 833 total` tests; driver `260 passed`; shared `258 passed`; rider `162 passed`; dispatch `272 passed`; db `17 passed`.
- **Lint.** `@taxi/api lint` prints 13 `no-unsafe-argument` warnings, all in `*.integration.spec.ts` files. They are pre-existing, and none is in a line this diff adds.
- **AC9.** `git diff origin/main -- services/api | grep logger` shows only the `Logger` dependency and the moved `ride.read.join_failed` warn, which carries `rideId`, `driverId`, `reason` and `at`, unchanged. No new log field, and no phone or name.

| AC | Status |
|---|---|
| AC1 | ✅ integration: driver `GET` + `complete` parse as `driverRideSchema`; rider raw body has no `rider` |
| AC2 | ✅ `driver-ride.spec.ts` over 14 statuses |
| AC3 | ✅ blank / missing / 130-char names |
| AC4 | ✅ in unit tests (LV strings asserted; RU/EN keys exist because the catalogs share one typed key set) |
| AC5 | ✅ client-gate test, revert-probed |
| AC6 | ✅ revert probe RED → GREEN |
| AC7 | ✅ gate above |
| AC8 | ✅ steps 1–5 on `sakta224` (D8); step 6 owed by #257 |
| AC9 | ✅ |

**UX states (active-ride screen):**

- ✅ **Loading**: unchanged.
- ✅ **Empty, no name**: no line and no placeholder (tested).
- ✅ **Empty, no phone**: no button (tested).
- ✅ **Error, no dialler**: swallowed silently (tested).
- **Offline**: no code path of its own. The number is read from memory and `tel:` needs no data, so nothing was built for it and nothing tests it on a device (AC8).

**Accessibility:**

- ✅ The number is never in the label (asserted).
- ✅ The hint is present only when a name exists.
- ✅ 44 px and the focus ring come from `Button` `size="md"`.

## Deviations from the plan

- **D1: `findForDriver` moved whole into `driver-ride.ts` as `readDriverRide`, the plan's own fallback.**
  - Why the fallback was needed (`derived`, prettier width 80, from the observed 496 lines):
    - `type DriverRide` import: +1
    - `./driver-ride` import: +1
    - `complete`'s signature with `{ ride: DriverRide }` reaches 83 characters and wraps to 4 lines: +3
    - identity lookup in `findForDriver`: at least +1
    - That is at least 502 lines, over the cap of 500.
  - `ride-lifecycle.service.ts` is now **467** lines (`observed`, `wc -l`).
  - The service keeps a one-statement `findForDriver` delegate, so `rides.controller.ts` and the reference at `rides/index.ts:30` are unchanged.
  - The docblock moved verbatim. `this.logger` is passed in, so `ride.read.join_failed` keeps the `RideLifecycleService` log context.
  - `toDriverRide` stays pure. `DriverRideReadDeps` is exported as the type of that dependency bag.
- **D2: `complete` does the identity lookup.** This follows the plan's "likewise", even though the window nulls both fields at `completed`. A lookup keeps `toDriverRide`'s `undefined = no users row` meaning honest. The cost is one indexed primary-key read per completion.
- **D3: the `readDriverRide` identity read comes after the second `findWithQuote`.** It takes the rider id from the snapshot the body carries. Worst-case race: as in the plan's A2.
- **D4: `earnings-screen.test.tsx` changed.** It was not named in the plan: its `as unknown as Ride` fixture became `DriverRide`, because `ended.completed.ride` is now `DriverRide`.
- **D5: fixed a pre-existing test leak, outside the plan's file list.** In `active-ride-screen.test.tsx:172`, `screen.unmount()` becomes `await screen.unmount()`; RNTL 14.0.1 types it as `() => Promise<void>`.
  - The un-awaited call left the NEXT test with an empty tree (`< />`) and an "overlapping act() calls" warning.
  - It was invisible while that test was the last one in the file. The new `describe` block surfaced it: 3 failures in the full file, all passing alone and passing with that test skipped (`observed`).
  - The same `await` is used at the new `Button.test.tsx` call.
- **D6: extra tests beyond the plan's cases.**
  - A fourth screen case (null phone inside the window).
  - A `callRider` case in `nav-links.test.ts`.
  - A case pinning that the projection leaves the other ride fields untouched.
- **D7: the AC6 probe injected a literal `rider` key** into `findForRider`'s return rather than calling `toDriverRide(...)`. The assertion is on key presence, so the two are equivalent for what it pins.
- **D8: AC8 ran in a second session, on 2026-09-23 (times UTC).**
  - **APK.** EAS `preview` build of `342d3fa`, finished 10:54:58Z. Its bundle carries `http://10.0.2.2:3001` and the «Zvanīt pasažierim» string (`strings` on `assets/index.android.bundle`, `observed`). Installed on `sakta224` at 17:35:20Z. After the rebase (D9), `git diff --stat 342d3fa HEAD` is empty, so the APK is the code under review.
  - **api.** `wt-261`'s `dist/main.js` on port 3001, started 10:40:55Z, after the 10:37Z commit.
  - **Setup, not product paths.** Step 1's `display_name` was already set on `+37120000003`. The rider session came from the stub OTP. The driver row was stuck at `status = 'on_ride'` with no active ride, left over from #15's pass (its last ride was retired at 15:37Z on 2026-09-22), so dispatch had no candidate (`dispatch.ride.unclaimed`, `offerAttempts: 0`). It was reset to `online` by direct `UPDATE` on the dev DB. That ride's status, `cancelled_by_system`, has no production writer (`services/api/src/features/rides/index.ts:36`, and `grep -rn cancelled_by_system services/api/src` finds only the policy map, the notifications map and two docblocks), so it was set outside the app, like #15's I2 retirements at 14:16Z. A write that bypasses the lifecycle also bypasses its `on_ride` release, which is why this is dev-data residue and not a #261 or lifecycle finding.
  - **Ride** `28e3a4d1-3876-460f-898b-beef27a72ca0`, booked with `POST /rides` as the rider, each tap checked against `rides.status`:

    | Step | Result | Artifact (`observed`) |
    |---|---|---|
    | 1 | ✅ | `users.display_name = 'Anna Bērziņa'` for `+37120000003` |
    | 2 | ✅ | at `accepted`: «Pasažieris: Anna Bērziņa» and «Zvanīt pasažierim», screencap `ac8-step2-accepted.png` |
    | 3 | ✅ | tap → `com.google.android.dialer` resumed with `dat=tel:+37120000003`, number prefilled, screencap `ac8-step3-dialler.png` |
    | 4 | ✅ | `arriving` → `arrived` → `in_progress` by tap, no relaunch; at `in_progress` the dump has «Pasažieris: Anna Bērziņa» and no «Zvanīt pasažierim» node |
    | 5 | ✅ | at `arriving`, TalkBack focus on the button: `Speaking fragment text="Zvanīt pasažierim"`, then `text="Poga. Zvana Anna Bērziņa"` (`TYPE_VIEW_ACCESSIBILITY_FOCUSED`); no digits spoken. The dump's `content-desc` is «Zvanīt pasažierim» |
    | 6 | owed | iOS `tel:` prompt and VoiceOver, by #257's hardware blocker |

  - Artifacts sit in that session's scratchpad and are not committed.
  - Still unverified on a device: offline, and the iOS second tap.
  - The ride was then completed from the app, reaching `completed` with the driver back at `online`.
- **D9: branch shape.** The branch was cut from `origin/main` at `0401cd7` with the plan cherry-picked. #270 then merged the same plan (byte-identical to the cherry-pick), so the branch was rebased with `git rebase --onto origin/main 1f3b7b9`, dropping the duplicate.
- **D10: the set-membership pins live in `schemas-driver-ride.test.ts`**, not in `ride-state-machine.test.ts`. The plan allowed either.

## Issues encountered

- **Main moved after the plan.** It went from `bfca835` to `0401cd7` (#268, `apps/driver` offers and earnings). `git diff --stat bfca835 origin/main -- apps/driver` touches none of the active-ride files or `Button.tsx`, so every cited line range still held.
- **Fresh worktree.** `@taxi/api typecheck` failed with `TS2307 '@taxi/db'` until `pnpm --filter @taxi/db build`.
- **Environment file.** The PreToolUse hook blocks any command naming the environment file. The integration spec and the gate both ran in the worktree; whether that file is present was not inspected.
- **Migrations.** No migration was added. `ls db/migrations/*.sql | tail -1` gives `0011_small_polaris.sql`.
- **Stale docblock fixed.** `services/api/src/features/rides/index.ts` said "Still absent for the driver: rider identity (name, phone) — a separate ticket". It now names the `rider` block and where it is built.
- **Day-one behaviour.** As the plan says, `displayName` is null for every real rider until #269 lands, so only the phone half is visible at merge.
