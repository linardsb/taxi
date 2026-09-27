# Implementation Report — driver PIN field under TalkBack (#280)

**Plan**: `.claude/plans/driver-pin-field-talkback-280.md`   **Branch**: `fix/driver-pin-field-talkback-280` (worktree `~/taxi-worktrees/wt-280`, off `origin/main` `33024ec`)   **Status**: COMPLETE, apart from the #257 comment, which needs the PR number (see Deviations)

## Summary

- **The pickup-PIN input is uncontrolled, and its state is keyed to the ride (T3).** The per-keystroke «tika aizstāts» chatter is gone on the device, both for injected text and for the Gboard keypad.
- **Every driver `TextField` is labelled by its visible label on Android (T2)**, and carries no `accessibilityLabel` there. A filled field now names itself once: «Rediģēšana, 0042, Rediģēšanas lodziņš — Pasažiera PIN kods». On main the filled field has no name at all.
- **Two stops per field is a logged decision** in `ui-decisions.md`.
- **Follow-ups filed:** #286 and #287. The decision and the device evidence are posted on #280 ([comment](https://github.com/linardsb/taxi/issues/280#issuecomment-5854139222)).

## Tasks completed

- T2 → `apps/driver/src/components/TextField.tsx` (UPDATE):
  - `useId()` gives the label id, set as `nativeID` on the label.
  - The input has `accessibilityLabelledBy` pointing at that id.
  - `accessibilityLabel` is set on iOS only.
  - The doc comment is rewritten.
- T3 → `apps/driver/src/features/active-ride/active-ride-screen.tsx` (UPDATE):
  - `pin` is now `{ rideId, text }`.
  - `typedPin` is declared after the `!ride` guard. Retry, Start and `pinSendable` use it.
  - `value` and the digit strip are removed.
  - The comment is rewritten, including Q2's warning about an early return.
- T3b → `apps/driver/src/features/active-ride/active-ride-screen.test.tsx` (UPDATE).
- T4 → device proof on `sakta224` (below).
- T5 → the gate, green.
- T6a → #286 (rider `TextField` naming). T6b → #287 (controlled inputs chatter, with the OTP auto-submit and clear-on-error constraints). T6c (#257) is pending the PR number.
- AC 3 (repo half) → `.claude/references/ui-decisions.md` (UPDATE): one line for the 2026-09-27 two-stop decision.

## Tests added

`observed`: `pnpm test` in `apps/driver` gives **45 suites, 291 tests passed**.

- `TextField.test.tsx`:
  - `the input is labelled by the visible label, which stays its own stop (expected)`
  - `on Android the input carries no accessibilityLabel, so the name is not read twice (edge — #280)`. It uses `jest.replaceProperty(Platform, 'OS', 'android')`, which jest-expo accepted.
- `active-ride-screen.test.tsx`:
  - `a non-digit paste is not stripped, Start stays off, and nothing is sent (failure — #280)` replaces `keeps digits only (edge)`.
  - `the field is uncontrolled, so the native text is never re-set per keystroke (regression — #280)`
  - `a PIN typed for one ride does not carry to the next (edge — #280)`. It walks ride A at `arrived`, then `opened()`'s shape (`ride: null`, `loading`, spinner shown), then ride B at `arrived`.
  - The wrong-PIN test drops its `.props.value === '9999'` assertion. Its comment now says that Start being off for `9999` and on for `9998` carries the property. Level 4 step 6 (below) shows the field itself keeps `9999`.

**Mutation runs**, each `observed` with `npx jest <file>` and the source restored after each:

| Mutation | Result |
|---|---|
| M1: `value={typedPin}` put back | only `the field is uncontrolled…` red (1 failed, 21 passed) |
| M2: plain `useState('')`, not keyed to the ride | only `…does not carry to the next` red; `uncontrolled` green (1 failed, 21 passed) |
| M3: `accessibilityLabel={label}` on every platform | only the Android `TextField` case red (1 failed, 3 passed) |

## Validation results

- `pnpm --filter @taxi/driver typecheck`: clean (`observed`).
- `pnpm --filter @taxi/driver lint`: clean after `prettier --write` (`observed`).
- `pnpm --filter @taxi/driver test`: 291/291 (`observed`).
- **Gate: green, `observed` 2026-09-27.**
  - Command: `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force`, in the worktree, after clearing every `dist` and `apps/dispatch/.next`.
  - Exit 0: `Tasks: 22 successful, 22 total`, `Cached: 0 cached`, 2m37s.
  - Tests passed: shared 279, db 17, dispatch 272, driver 291, rider 176, api 829. The api also had **39 skipped**.
  - `REDIS_TEST_URL` was not set in this shell, so the 39 skipped are the Redis-backed suites CLAUDE.md describes. This is not CI parity for those suites. The api is untouched by this diff.

### Level 4, `observed` 2026-09-27 on AVD `sakta224`

Setup: lv-LV, TalkBack VERBOSE, the branch's JS served by the worktree's Metro on :8082, and the api on :3031 (dev DB).

The api runs from `wt-a11y-276` at `d6deaa6`, not this branch's base `33024ec`. `git diff --stat d6deaa6 33024ec -- services/api packages/shared/src` gives 19 files, +283/−100 (observed). The changes are #260's offer trip estimate (`offer-builder`, `pricing`, one new string in each catalog), a `ride-row.ts` extraction from `rides.repository.ts`, and small edits to `dispatch.service`, `force-assign.service` and `rides.service`. None of them is the PIN check. This diff touches no api code, so what the device run tested is the driver JS. The ride was dispatched to the driver by the real sweeper and accepted in the app, then taken through «Braucu pie pasažiera» and «Esmu klāt» to `arrived`.

**Step 1: chatter, injection.** `adb shell input text` one character per 2.5 s.

- TalkBack fragments:
  - `0` (`TYPE_VIEW_TEXT_CHANGED`)
  - `Rediģēšana, 0, Rediģēšanas lodziņš — Pasažiera PIN kods` (focus)
  - `0`
  - `4`
  - `2, Sasniegts maksimālais garums`
- **0 «tika aizstāts».**
- `uiautomator events`, TalkBack off, `0042`:
  ```
  Text: [0]    BeforeText:      FromIndex: 0  AddedCount: 1  RemovedCount: 0
  Text: [00]   BeforeText: 0    FromIndex: 1  AddedCount: 1  RemovedCount: 0
  Text: [004]  BeforeText: 00   FromIndex: 2  AddedCount: 1  RemovedCount: 0
  Text: [0042] BeforeText: 004  FromIndex: 3  AddedCount: 1  RemovedCount: 0
  ```
  **0 events with `RemovedCount > 0`.** Main gave one same-text whole replace per character (spike S3).

**Step 2: the field names itself, empty and filled.** Explore the label, then swipe "next".

- PIN field, empty: `Pasažiera PIN kods`, then `Rediģēšanas lodziņš — Pasažiera PIN kods`.
- PIN field, filled: `Pasažiera PIN kods`, then `Rediģēšana, 0042, Rediģēšanas lodziņš — Pasažiera PIN kods`.
- **Other `TextField`s** (vehicle screen, in place of the login phone field; see Deviations):
  - `Numura zīme`, then `Rediģēšanas lodziņš — Numura zīme` (empty).
  - `Pasažieru vietas`, then `4, Rediģēšanas lodziņš — Pasažieru vietas` (filled).
- **Which reading covers which case.** The filled PIN read carries «Rediģēšana,», so that field was still in edit mode, not read "from outside the field" as the plan asked. The **seats field** («4, Rediģēšanas lodziņš — Pasažieru vietas») is the unfocused, filled case.
- The name is read once per field in every case. The `useId()` value works as an Android `nativeID` / `labelFor` target, so the plan's module-counter fallback is not needed.

**Step 3: chatter, soft keyboard.** TalkBack off. Tap the field, `KEYCODE_ALT_LEFT KEYCODE_K` for Gboard's floating number keypad, then `input tap` on the keys for `4821`, 1.5 s apart:

```
Text: [4]    BeforeText:      FromIndex: 0  AddedCount: 1  RemovedCount: 0
Text: [48]   BeforeText: 4    FromIndex: 1  AddedCount: 1  RemovedCount: 0
Text: [482]  BeforeText: 48   FromIndex: 2  AddedCount: 1  RemovedCount: 0
Text: [4821] BeforeText: 482  FromIndex: 3  AddedCount: 1  RemovedCount: 0
```

**0 events with `RemovedCount > 0`.** The keypad worked on the first try.

**Step 4: the listen.** Done at planning time (S7). Not re-run.

**Step 5: non-digit paste.**

- `adb shell input text 12ab` lands as typed: EditText `text="12ab"`. The number-pad input does not drop letters, so the refusal is the JS one.
- Start: `enabled="false"`.
- TalkBack: `Rediģēšana, 12ab, Rediģēšanas lodziņš — Pasažiera PIN kods`, then `Sākt braucienu`, `Poga, atspējots`.

**Step 6: survives a 422.**

- Enter `9999` and press Start. The banner reads «Nepareizs PIN kods.».
- The field still holds `text="9999"`, Start is `enabled="false"`, and no Retry is offered.
- Change the last digit to `9998`: Start is `enabled="true"`.
- DB: `pickup_pin_failures` went to 1, then 2 (step 6 ran twice; see Issues).
- The correct PIN `4821` then moved the ride to `in_progress`, and «Pabeigt braucienu» moved it to `completed`.

## Deviations from the plan

- **M3 was added.** It is a third mutation run, beyond the plan's two, and it pins T2's Android branch.
- **`jest.replaceProperty` worked.** The plan's fallback was not needed.
- **The APK was not rebuilt.** The plan says to use a debug build via `expo run:android`. The diff is JS-only, and native drift is already shown empty (plan §Spike evidence), so the installed #276 debug APK ran the branch's bundle from the worktree's Metro.
- **The PIN ride was reached by seeding, not by booking in the rider app.**
  - The api on :3031 has no Google Maps key. `StubMapsProvider.searchAddress` throws, so the rider app's destination typeahead shows «Kaut kas nogāja greizi» (`observed`).
  - Instead, I copied the spike's leftover pinned ride `5035c41d…` in the dev DB into a new row `c280c280-…`. The copy has `pickup_pin = '4821'`, a fresh `created_at`, no tracking token, and its three `ride_fare_lines`.
  - From there the path is real: the sweeper offered the ride to the driver, and the driver accepted it in the app.
  - The original ride could not be reused, because this driver already held an expired offer on it, and `findTriedDriverIds` skips a driver who has already been offered the ride.
- **Step 2's "other `TextField`" check ran on the vehicle screen, not the login phone field.** Both use the same component. The vehicle screen needed no sign-out and OTP, and it gave an empty field and a filled one on the same screen.
- **The 422 banner string differs from the plan.** The plan quotes «PIN kods nav pareizs»; the app shows «Nepareizs PIN kods.» (`driver.error.pickup_pin_incorrect`, observed). The PR body should use the app's string.
- **Step 1's event capture cleared the field with `KEYCODE_DEL`.** The deletes happened before the capture started, so the capture holds only the typing.
- **T6c (the #257 comment) is not posted yet.** It should cite the PR, which does not exist yet. Post it after `piv-create-pr`: iOS keeps `accessibilityLabel`, so expect the label and field stops as before, and the PIN field is uncontrolled, so expect no per-keystroke re-read. The #280 decision comment is posted.

## For the PR body

- Keep `Closes`/`Fixes` away from #286, #287 and #257.
- **Whether this PR closes #280 is Linards' call.** AC 1–4 are met here, and AC 5 (iOS/VoiceOver) is owed by #257.
- Checked, no change needed: no driver `TextField` caller passes its own `accessibilityLabel`. The seven hits in `apps/driver/src` are on a `Switch`, a `Pressable`, `Button` and the offer card. So no caller gets both the label and the link on Android, which would read the name twice (S8 variant E).

## Issues encountered

- **The hook blocked the `.env` copy into the worktree** ("access to secrets is not allowed"), and it also blocks checking whether the file exists. Linards copied it in by hand.
- **A stray `KEYCODE_BACK` closed the driver app during step 6.** No keyboard was open, so Back left the app. The relaunch came up with the field empty, no stale digits, and Start off, which is the fresh-mount state. Step 6 was re-run from there, which cost a second PIN attempt (2 of 5).
- **Unrelated, not caused by this diff:** after going offline, home showed «Pievienot auto» and earnings «—», though the `vehicles` row `EMU224` is intact (`observed`). This looks like a failed home read. It is not investigated here.
- `expo start` rewrote `apps/driver/tsconfig.json#include`. This was reverted and not committed.
- **Dev DB changes left behind:** ride `c280c280-2800-4280-8280-280280280280` (completed) and its fare lines and offer.
- Latest migration in this worktree: `db/migrations/0013_concerned_wiccan.sql`. This ticket adds none.
