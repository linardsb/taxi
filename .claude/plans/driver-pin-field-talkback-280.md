# Feature: driver PIN field under TalkBack — no keystroke chatter, a named field, a heard re-read (#280)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

Every repo `file:line` below was read on `origin/main` at `33024ec` (2026-09-26). React Native `file:line`s are from the installed `react-native@0.86.3` (`node_modules/react-native/…`, which is the driver's version per `apps/driver/package.json`). Re-read before editing, because lines drift. **Implement in a worktree off `origin/main`.** The main checkout is on `feature/skip-rider-sms-app-bookings-135`, and other sessions share it (CLAUDE.md, "Concurrent Claude sessions"). This plan file is untracked in that main checkout. Copy it into the worktree, commit it with the first commit, then delete the main-checkout copy, so it cannot block a later `git checkout main` (memory `taxi-main-checkout-stale-untracked-drafts`).

## Feature Description

#276's TalkBack pass (D4) found three problems with the driver's pickup-PIN field on the active-ride screen:

1. A filled field is re-read as `0042`, not as four spoken digits.
2. Every keystroke adds «Teksts “004” tika aizstāts ar tekstu “004”» ("text replaced with text").
3. Swiping visits the label twice: once on the visible `Text`, once on the field.

This ticket fixes item 2 in the PIN field. For item 3 it keeps two stops by a logged decision (Linards, 2026-09-27), and makes the field's own stop carry its name even when filled. **Item 1 needs no code:** the listen closed it at planning time. All three were settled on `sakta224` on 2026-09-26, before any code was written. See §Spike evidence.

## User Story

As a driver using TalkBack
I want the PIN field to read once, stay quiet while I type, and read the PIN back as digits
So that I can check the rider's code by ear before I start the trip

## Problem Statement

- **Item 2, the chatter.** The mechanism below was read from the RN 0.86.3 source and then **`observed`** in the spike (§Spike evidence, runs S1–S4). The app causes it, not the injection method.
  - The field is controlled: `value={pin}` with `onChangeText={(v) => setPin(v.replace(/\D/g, ''))}` (`apps/driver/src/features/active-ride/active-ride-screen.tsx:216-217`).
  - Each keystroke changes `value`. That changes the Fabric shadow node's `reactTreeAttributedString`, so `updateStateIfNeeded` pushes new state to Java with the props' event count (`AndroidTextInputShadowNode.cpp:124-160`).
  - `updateExtraData` then calls `maybeSetTextFromState` (`ReactTextInputManager.kt:201-216`). `maybeSetText` skips identical text **only for secure fields** (`ReactEditText.kt:651`). Otherwise it runs `text.replace(0, length(), …)` (`ReactEditText.kt:689`), even when the new text equals what is already there.
  - A whole-range replace emits `TYPE_VIEW_TEXT_CHANGED` with removed = added = length. TalkBack speaks that as "X replaced with X", which matches the logged «“004” … ar tekstu “004”».
  - The injected key, and equally a Gboard keypad tap, produces only the insert (removed 0). The replace that follows is RN's re-set. An uncontrolled field shows the inserts and no replace (S2, S4).
- **Item 3, the double label.** `TextField` renders a visible `<Text>{label}</Text>` (`apps/driver/src/components/TextField.tsx:29`) and also sets `accessibilityLabel={label}` on the input (`:32`). TalkBack stops on both: `observed` in S5, two stops per field. **Once the field has text, the field's own stop drops the name** (S8: «4821, Rediģēšanas lodziņš»). On main today, the separate label stop is the only place a filled field is named. S8 tested every JS route: hiding the label gives one stop but a nameless filled field. `accessibilityLabelledBy` keeps the name but not one stop. A hint is never read as a name. So one stop and a named filled field cannot both be had on this TalkBack. The same `TextField` backs login (`login-screen.tsx:71`), verify (`verify-screen.tsx:101`) and vehicle (`vehicle-screen.tsx:123,131,137,143,151`), so all of them have it too (`derived` from the shared component).
- **Item 1, the unspaced re-read. Closed with no code.** TalkBack hands `4821` and `0042` to the lv voice unspaced (S7), and **Linards heard four digits for both** (S7, 2026-09-26). The analysis below explains why no JS-only fix exists; it stays in case the voice changes:
  - `accessibilityValue.text` and `accessibilityLabel` both land in `contentDescription` (`BaseViewManager.java:419-446`). S6 **observed** that TalkBack ignores this: a filled field with `accessibilityValue` «4 8 2 1» still sends `4821`.
  - RN's own delegate says "EditText's prioritize their own text content over a contentDescription" (`ReactAccessibilityDelegate.kt:964-965`).
  - #276 heard the label on the empty field («Pasažiera PIN kods, Rediģēšanas lodziņš») and not on the filled re-read («Rediģēšana. 0042»).
  - Writing `0 0 4 2` into the field needs a controlled re-format, and by the item-2 mechanism that brings the replace chatter back. The item-2 fix therefore rules out spaced display text.

## Solution Statement

- **Item 2: make the PIN input uncontrolled.** Drop `value`. `onChangeText` stores the raw text, with no filter, so the JS tree never changes the native text and nothing is re-set.
  - Non-digits are not stripped any more. They are refused: `pinSendable` already requires `pickupPinSchema` (`/^\d{4}$/`, `active-ride-state.ts:121-127`). A pasted `12ab` stays visible, TalkBack reads it back exactly, and Start stays off.
  - This is the only design that never writes to the native text. Every strip or re-set route (`clear()`, `setNativeProps`, a changing `defaultValue`, which RN passes through as the native `text` prop at `TextInput.js:384-389`) re-introduces a native replace.
- **Pin state keyed to the ride.** An uncontrolled field that remounts comes back empty.
  - The screen can outlive a ride change. Dina's force-assign of a different ride while one is open runs `assigned` → `opened()` (which nulls `ride`, `active-ride-state.ts:48-55,400-412`) → `route_ride` → `router.replace('/active-ride')` (`use-active-ride.tsx:154-156`), and that replace targets the route already shown. Whether expo-router remounts the screen for that is **not verified**.
  - If the screen does not remount, a bare `useState('')` holds the old digits behind an empty field, and Start is enabled over it. The existing comment at `:61-62` ("a new ride remounts the screen and clears it") is then already false for today's controlled field, which shows the old digits.
  - Because the remount is unproven, the state becomes `{ rideId, text }`, and the PIN in force is `pin.rideId === ride.id ? pin.text : ''`. It costs 3 lines and does not depend on router behaviour.
- **Item 3: two stops, and the field names itself.** This is a logged decision under #280's "or a logged decision to keep two", chosen by Linards on 2026-09-27 from S8's evidence.
  - The visible label `Text` stays a normal stop.
  - On Android, the input points at it with `accessibilityLabelledBy` (Android's `labelFor`) and carries **no** `accessibilityLabel`. On iOS it keeps `accessibilityLabel={label}`, because `accessibilityLabelledBy` is Android-only.
  - S8, variant I: empty reads «Rediģēšanas lodziņš — Lauks I», filled reads «4821, Rediģēšanas lodziņš — Lauks I». The name is read once in both cases.
  - Keeping `accessibilityLabel` on Android as well (variant E) reads it twice when empty: «Lauks E, Rediģēšanas lodziņš — Lauks E».
  - This applies to every driver `TextField`, which is intended: each one is nameless when filled today.
- **Item 1: closed by the listen (S7).** Linards heard four digits for both `4821` and `0042`. That is one listen, on one voice (`lv-lv-x-imr-lstm-embedded` per #276), and it claims nothing about other voices. The implementer changes nothing for item 1 and quotes S7 in the PR body and on #280.

## Out of Scope / Non-Goals

- **Not included: spacing the field's text, four cells, or a native TtsSpan module.** The listen made them unnecessary (S7), and S6 showed the JS-only `accessibilityValue` route does nothing.
- **Not included: the rider `TextField`** (`apps/rider/src/components/TextField.tsx`), which has the same double label (`derived`, not observed). It is filed as a follow-up in T6.
- **Not included: other controlled inputs** (driver login phone, driver/rider OTP verify, vehicle form). The mechanism is observed (S1–S4), so they chatter too (`derived`: same controlled-`value` shape). That is filed as a follow-up in T6. Converting them is a separate ticket, because the OTP screens auto-submit on the 6th digit and clear on error (`apps/rider/src/features/auth/verify-screen.tsx:80-94`). Both are controlled-value behaviours.
- **Not changing:**
  - The api contract, `pinSendable` and `decide` in `active-ride-state.ts`. Start's gating and the no-resend-after-422 rule stay as they are.
  - `maxLength={4}`, `keyboardType="number-pad"`, and no `autoFocus` (`active-ride-screen.tsx:211-219`).
- **Not addressed: D1** (the offer countdown queueing) and **the hardware Back** note in #276. Both are other tickets.

## Feature Metadata

**Feature Type**: Bug Fix
**Estimated Complexity**: Low in code (2 source files, 2 test files). Medium overall, because two of the three ACs are proved only on the AVD under TalkBack.
**Primary Systems Affected**: `apps/driver` (`components/TextField.tsx`, `features/active-ride/active-ride-screen.tsx`)
**Dependencies**: none new

## Related Work

**Implements**: [#280](https://github.com/linardsb/taxi/issues/280) · **Evidence**: [#276 D4](https://github.com/linardsb/taxi/issues/276#issuecomment-5820940274) · **Epic**: #1 (pickup PIN is #258's slice)

**Back-references**:

- `.claude/plans/pickup-pin.md` (on `origin/main`; the main checkout also holds an untracked copy). The #258 plan introduced the field, `needsPin` and `pinSendable`. Its no-Retry-on-PIN-verdict and "digits survive the 422" rules are kept.
- `docs/runbooks/driver-device-day.md` §TalkBack VERBOSE logging and the raw-touch recipe (`:490-545`). T1 and Level 4 use it verbatim.

**Forward-references**: the T6 follow-ups (rider double label; other controlled inputs; item 1 fallback if the listen fails).

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

- `apps/driver/src/components/TextField.tsx` (whole file, 76 lines): `:29` is the visible label, `:30-49` the input. The doc comment at `:18-24` states the label/hint contract. Update it.
- `apps/driver/src/components/TextField.test.tsx` (31 lines): the mirror test. Add the hidden-label case here.
- `apps/driver/src/features/active-ride/active-ride-screen.tsx`:
  - `:61-63`: the `pin` state and its comment.
  - `:176-185`: Retry resends `pin`.
  - `:211-232`: the field and Start.
  - File length 284 lines (observed, `wc -l`), under the 500 cap.
- `apps/driver/src/features/active-ride/active-ride-screen.test.tsx` `:136-271`: the `the pickup PIN (#258)` block.
  - `:173-180` "keeps digits only" asserts the strip, and is **replaced**.
  - `:221` asserts `.props.value === '9999'`, which is undefined once uncontrolled, so it is **rewritten**.
- `apps/driver/src/features/active-ride/active-ride-state.ts`:
  - `:112-127`: `needsPin` and `pinSendable`, unchanged. `pickupPinSchema` does the digit check.
  - `:48-55,182-195`: `initialActiveRide` and `opened()`, where `ride` goes null on a new ride.
- `packages/shared/src/schemas/ride.ts:402-403`: `pickupPinSchema` (`/^\d{4}$/`).
- `docs/runbooks/driver-device-day.md:490-545`: the TalkBack VERBOSE pref file, `Speaking fragment text=` lines, reading `subtype`, and the `touch.sh` explore/swipe recipe (1080×2400, `/dev/input/event2`).

### RN source behind the mechanism (read-only, cite; do not patch)

- `node_modules/react-native/ReactCommon/react/renderer/components/textinput/platform/android/react/renderer/components/androidtextinput/AndroidTextInputShadowNode.cpp:124-160`: a state push on a tree-string change.
- `node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/views/textinput/ReactTextInputManager.kt:201-216`: `updateExtraData` → `maybeSetTextFromState`.
- `node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/views/textinput/ReactEditText.kt:650-697`: `maybeSetText`. `:651` is the secure-only identical-text skip; `:689` is the whole-range replace.
- `node_modules/react-native/Libraries/Components/TextInput/TextInput.js:384-389`: `defaultValue` feeds the same native `text` prop as `value`.
- `node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/BaseViewManager.java:419-446` and `ReactAccessibilityDelegate.kt:964-965`: why `accessibilityValue` cannot re-voice a filled EditText.

### New Files to Create

None.

### Relevant Documentation

- [Android `AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED`](https://developer.android.com/reference/android/view/accessibility/AccessibilityEvent#TYPE_VIEW_TEXT_CHANGED): the removed/added counts TalkBack turns into "replaced".
- [RN `TextInput` `defaultValue`](https://reactnative.dev/docs/textinput#defaultvalue): "useful for use-cases where you do not want to deal with listening to events and updating the value prop to keep the controlled state in sync".
- [RN accessibility `accessibilityLabelledBy` (Android)](https://reactnative.dev/docs/accessibility#accessibilitylabelledby-android): links an input to the `nativeID` of its visible label.
- RNTL 14 resolves `accessibilityLabelledBy` in `getByLabelText`, and the driver's jest runs as `Platform.OS === 'ios'`. Both are `observed` with a probe test in the spike worktree: `queryByLabelText('Plate')` found a `TextInput` whose only name was `accessibilityLabelledBy`, and `PLATFORM ios` was printed.

### Patterns to Follow

- **Tests use `await render` / `await fireEvent`** (RNTL 14, async by default): `active-ride-screen.test.tsx:156,164`. Use `await act(async …)` where needed. Memory `taxi-driver-rntl14-gotchas`: an un-awaited act leaks into later tests.
- **Test names carry the case tag** `(expected)`, `(edge)` or `(failure)`, e.g. `:154,173,197`.
- **Copy** comes from `t('driver.…')`. This ticket adds no strings.
- **Comments state the why, with the ticket**, e.g. `// … (#258)`. Match the density at `:61-62` and `:211-212`.

---

## Spike evidence (2026-09-26, planning session, `sakta224`)

**Setup.** A detached worktree at `origin/main` `33024ec` (since removed), with the driver's Metro on :8082 via `adb reverse`. It ran on the debug APK already installed from #276 (`lastUpdateTime` 2026-09-24): there is no native drift, because `git diff --stat d6deaa6 origin/main` over `apps/driver/package.json`, `app.json`, `eas.json` and `pnpm-lock.yaml` is empty. The app was opened at a throwaway route, `src/app/spike.tsx`, which was never committed. Its fields copy the PIN field's props (`keyboardType="number-pad"`, `maxLength={4}`):

- **A**: controlled, `value={a}` with the digit strip. This is main's shape.
- **B**: uncontrolled, `onChangeText={setB}`. This is T3's shape.
- **C**: B plus a visible label with `importantForAccessibility="no"` and `accessibilityElementsHidden`. This was T2's first shape, rejected by S8.
- **D**: B plus `accessibilityValue={{ text: d.split('').join(' ') }}`. This answers Q3.

**Oracles.** Two, both `observed`:

- TalkBack VERBOSE `Speaking fragment text=` lines (runbook `:490-510`).
- `adb shell uiautomator events`, run with TalkBack off, which prints each `TYPE_VIEW_TEXT_CHANGED` with `BeforeText`, `FromIndex`, `AddedCount` and `RemovedCount`. TalkBack's «Teksts “X” tika aizstāts ar tekstu “X”» is the event with `RemovedCount > 0` and `AddedCount > 0`. S1 and S3 calibrate that mapping against the same field.

| Run | Field | Input | Result |
|---|---|---|---|
| S1 | A | `adb input text`, one char per 2.5 s, TalkBack on, ×2 runs | 4 of 4 keystrokes followed by «tika aizstāts» (both runs; 7–8 fragments each) |
| S2 | B | same, ×2 runs | 0 replaces; fragments `0`,`0`,`4`,`2` only (both runs) |
| S3 | A | `adb input text` → events | each char: insert (`added 1, removed 0`), then `BeforeText 004 → Text 004, from 0, added 3, removed 3` — identical-text replace, 4 of 4 |
| S3k | A | **Gboard number keypad**, `input tap` on keys, TalkBack off → events | **identical to S3**: insert, then same-text whole replace, 4 of 4 |
| S4 | B | `adb input text` → events | 4 inserts, 0 replaces |
| S5 | A–D (empty) | TalkBack swipe "next" from the top | A: «Lauks A» then «Lauks A, Rediģēšanas lodziņš» (**2 stops**); B: 2; **C: 1** («Lauks C, Rediģēšanas lodziņš»); D: 2 |
| S6 | B, D | filled `4821`, explore each | both send `text="4821"` + «Rediģēšanas lodziņš»; D's `accessibilityValue` «4 8 2 1» is **not** spoken. Note the filled field drops its label entirely |
| S8 | variants | Round 2 (2026-09-27), empty and filled `4821`, swipe "next". **A** (main): 2 stops; filled → «4821, Rediģēšanas lodziņš» (no name). **C** (label hidden): 1 stop; filled → no name. **E** (`labelledBy` + `accessibilityLabel`): 2 stops; empty «Lauks E, Rediģēšanas lodziņš — Lauks E»; filled «4821, Rediģēšanas lodziņš — Lauks E». **F** (`labelledBy` + hidden label): 1 stop; filled → no name. **G** (hidden label + `accessibilityHint={label}`): 1 stop; filled → no name, even after a 10 s wait (TalkBack reads only its usage hint). **H** (`labelledBy`, label `accessible={false}`): 2 stops, like E. **I** (`labelledBy`, no `accessibilityLabel`): 2 stops; empty «Rediģēšanas lodziņš — Lauks I»; filled «4821, Rediģēšanas lodziņš — Lauks I» |
| S7 | B, A | filled `4821` / `0042`, explore; **Linards listened** | TTS input `4821`, `0042`, `locale=lv_LV`; **heard: four digits, both** |

S3k is the soft-keyboard leg #280 asks for: the keypad's own commit is a plain insert, and the replace comes from RN. **Keyboard on B was not run.** Gboard's floating keypad stopped accepting taps after S3k (see Level 4 step 3). Its result is `derived` from S3k plus S4: the commit is an insert and B never re-sets. Linards chose not to hand-type it (2026-09-26). T4 re-checks it on the real field.

---

## IMPLEMENTATION PLAN

### Phase A: Prove the mechanism — DONE at planning time

T1 ran during planning (§Spike evidence). Verdict: row 1 of its table. The chatter is real on the keyboard (S3k), the controlled `value` causes it (S3 vs S4), and T3 goes ahead as written.

### Phase B: Code

T2 (`TextField`) and T3 (the PIN field) are independent of each other.

### Phase C: Device proof, and the tickets it spawns

T4–T6. They depend on B.

---

## STEP-BY-STEP TASKS

### T1 — A/B the chatter on `sakta224` — **DONE 2026-09-26, do not re-run** (results in §Spike evidence; kept for the record)

- **IMPLEMENT**:
  - Reach a pinned `arrived` ride the way #276 did. Book in the rider app with «PIN kods iekāpšanai» on. The driver accepts, then presses arriving and arrived. The api runs on :3031 against the dev DB.
  - Enable TalkBack VERBOSE per runbook `:490-500`.
  - **Build A** is `origin/main`. **Build B** is `origin/main` plus the one-line T3 change (remove `value={pin}`; `onChangeText={setPin}`). Both are debug builds via `expo run:android`.
  - In each build: explore to the field (`touch.sh explore`), activate it (TalkBack off, `input tap`, TalkBack on, per the runbook `:543-544`), then `adb shell input text 0042`.
  - Capture `adb logcat -d | grep 'Speaking fragment'`.
- **Also, in every branch: the soft-keyboard pass on build A** (Level 4 step 3's recipe, run against `origin/main`). #280 says to confirm with the soft keyboard *before* fixing. The two tests answer different questions:
  - The soft keyboard on A answers whether the chatter is **real** for a driver.
  - The adb A/B answers what **causes** it.
- **DECISION RULE** (record all three counts: adb-A, adb-B, keyboard-A):

  | adb A | adb B | keyboard A | Verdict | T3 |
  |---|---|---|---|---|
  | chatter | quiet | chatter | Real, and caused by the controlled value (`observed`) | As written |
  | chatter | quiet | quiet | The controlled value causes it under key events, but a real driver does not hear it. Item 2 is refuted for real use | Optional. Ship it only if Linards wants the adb path quiet; log the decision either way |
  | chatter | chatter | chatter | Real, but the mechanism is wrong | Stop. Re-plan item 2 (Q1) |
  | chatter | chatter | quiet | An injection artefact | Drop T3's uncontrolled change and the ride keying; log the refutation on #280 |
  | quiet | — | quiet | D4 not reproduced | As the row above |
  | quiet | — | chatter | Real, and the adb route cannot show it | Run keyboard-B. Quiet → T3 as written; chatter → stop and re-plan |
- **GOTCHA**: `input tap` under TalkBack activates rather than focuses (runbook `:517`). Focus the field by `explore`, activate with TalkBack off. `uiautomator dump` may refuse while the driver is online (runbook `:560-570`, the online-HOME case), so take coordinates from `screencap`.
- **VALIDATE**: three log excerpts (adb-A, adb-B, keyboard-A), each with its count of «tika aizstāts» fragments, saved to the scratchpad and quoted in the report. If lift-to-type does not commit on the AVD, the keyboard-A leg is not done: say so on #280 and do not tick AC 2's soft-keyboard half.
- **SATISFIES**: AC 2 (confirm or refute)

### T2 — UPDATE `apps/driver/src/components/TextField.tsx`: the field names itself (two stops kept, logged)

- **IMPLEMENT**:
  - `import { useId, useState, type Ref } from 'react'`, and add `Platform` to the `react-native` import.
  - In the body: `const labelId = useId();`.
  - The label `<Text>` at `:29` gets `nativeID={labelId}`. It stays visible to screen readers, so do **not** hide it.
  - On the `TextInput`, replace `accessibilityLabel={label}` (`:32`) with:
    - `accessibilityLabel={Platform.OS === 'ios' ? label : undefined}`
    - `accessibilityLabelledBy={labelId}`
  - Keep both **before** `{...rest}`, as `accessibilityLabel` is today, so a caller can still override.
  - Rewrite the doc comment at `:18-24`. It should say the label is the accessible name. On Android the input is labelled *by* the visible label (`labelFor`), because an Android EditText with text drops its own label (#280, S8), and adding `accessibilityLabel` there reads the name twice. On iOS `accessibilityLabelledBy` does not exist, so the input carries the label.
- **PATTERN**: the `accessibilityLiveRegion` prop on the error `Text` (`:51`) is the file's existing platform-specific a11y prop. The comment at `:20-21` already names an Android-only behaviour.
- **GOTCHA**:
  - **Do not hide the label** (`importantForAccessibility="no"`), neither alone nor alongside `labelledBy`. S8 variants C and F lose the name on a filled field.
  - `useId()` returns strings like `«r0»` or `:r0:` depending on the React version. The spike used plain ids (`"le"`). Level 4 step 2 is what proves a `useId` value works as an Android `nativeID`. If it does not, use a module counter (`let n = 0; … useState(() => `tf-${++n}`)`) and log the divergence.
  - Jest runs as iOS (observed), so `accessibilityLabel` is still set in tests and every existing `getByLabelText(label)` keeps passing. The Android branch needs `jest.replaceProperty(Platform, 'OS', 'android')` in its own test. If jest-expo's `Platform` refuses the replacement, assert the Android shape through Level 4 step 2 only, and say so in the report.
- **VALIDATE**: `pnpm --filter @taxi/driver test -- TextField`. New cases go in `TextField.test.tsx`:
  - `(expected) the input is labelled by the visible label`: `getByText('Plate')` is truthy (still a stop), and `getByLabelText('Plate').props.accessibilityLabelledBy === getByText('Plate').props.nativeID`.
  - `(edge — #280) on Android the input carries no accessibilityLabel, so the name is not read twice`: under `Platform.OS = 'android'`, `props.accessibilityLabel` is `undefined` and `getByLabelText('Plate')` still resolves (through `labelledBy`).
  - The existing error-hint cases stay green unchanged.
- **SATISFIES**: AC 3

### T3 — UPDATE `apps/driver/src/features/active-ride/active-ride-screen.tsx`: uncontrolled PIN, keyed to the ride

- **IMPLEMENT**:
  - `:63`: `const [pin, setPin] = useState({ rideId: '', text: '' });`
  - After `ride` is known non-null (after the `if (!ride)` return at `:124-139`): `const typedPin = pin.rideId === ride.id ? pin.text : '';`. Use `typedPin` at `:183` (Retry), `:227` (Start) and `:228` (`pinSendable`).
  - `:214-221`: remove `value={pin}`. Use `onChangeText={(text) => setPin({ rideId: ride.id, text })}`, with no digit filter.
  - Rewrite the comment at `:61-62`, dropping its "a new ride remounts the screen" claim. The new comment says three things:
    - The field is uncontrolled because a changing `value` makes RN re-set the native text on every keystroke, which TalkBack speaks as "replaced" (#280).
    - Non-digits are left visible and refused by `pinSendable`.
    - The state is keyed to the ride because Dina's force-assign can swap the ride under a mounted screen (`assigned` → `route_ride`), and a remounted uncontrolled field comes back empty.
- **GOTCHA**:
  - **No `defaultValue={…}` fed from state.** `TextInput.js:384-389` passes it as the same native `text` prop as `value`, so the chatter would return.
  - **No `setPin` inside a `useEffect` to reset on ride change.** The driver's `eslint-config-expo` 57 ships `react-hooks` 7, whose `react-hooks/set-state-in-effect` flags it (memory `taxi-expo-app-toolchain-pins`). The ride-keyed state is the replacement. Confirm the rule name with `pnpm --filter @taxi/driver lint` if you try it.
  - Every `pin` use (`:183`, `:216-217`, `:227-228`) sits after the `if (!ride)` return, so declare `typedPin` right after that guard. Hooks stay above every early return (`:63` already is).
  - Keep the file under 500 lines: +~4 net (`derived`: 284 + 1 declaration + ~3 comment lines).
- **VALIDATE**: `pnpm --filter @taxi/driver typecheck && pnpm --filter @taxi/driver lint && pnpm --filter @taxi/driver test -- active-ride-screen`
- **SATISFIES**: AC 2 (fix), AC 4 (tests, via T3b)

### T3b — UPDATE `active-ride-screen.test.tsx`: the PIN block

- **IMPLEMENT** (inside `describe('the pickup PIN (#258)')`):
  - **Replace** `'keeps digits only (edge)'` (`:173-180`) with `'a non-digit paste is not stripped, Start stays off, and nothing is sent (failure — #280)'`:
    - `changeText(field, '12ab')` → `ride-step` disabled.
    - Press it → `mockStep` not called.
    - Then `changeText(field, '1234')` → enabled → press → `toHaveBeenCalledWith('1234')`.
  - **Add** `'the field is uncontrolled, so the native text is never re-set per keystroke (regression — #280)'`: after `changeText(field, '0042')`, `expect(field.props.value).toBeUndefined()` and `expect(field.props.defaultValue).toBeUndefined()`. This pins the mechanism, not TalkBack.
  - **Edit** `:221`: drop `.props.value === '9999'`. The "digits survive the 422" property is now carried by the next line, `ride-step` disabled for the refused `9999`, and by the existing `9998` press. Update the comment at `:220` to say so.
  - **Add** `'a PIN typed for one ride does not carry to the next (edge — #280)'`. The test walks the real transition, not a direct A→B swap:
    - Render `pinnedAt('arrived')` and type `0042`.
    - Rerender with the state `opened()` produces: `rideId` set to a second UUID, `ride: null`, `loading: true`. The spinner shows.
    - Rerender with that ride loaded, pinned and at `arrived`.
    - Expect `ride-step` disabled, and pressing it does not call `mockStep`.
  - The expected case (`:154-171`) already covers the leading-zero PIN `0042` → `mockStep('0042')`. Keep it as the AC 4 "expected + edge" case and do not duplicate it.
- **GOTCHA**:
  - `mockStep` (`:57`) is cleared by `jest.clearAllMocks()` in the outer `beforeEach` (`:82-85`), so `not.toHaveBeenCalled()` is safe per test.
  - The ride-change test needs `pinnedAt`'s ride with a different id. Build it with `ride({ id: OTHER_ID, status: 'arrived' })` plus the same options spread, and set `rideId: OTHER_ID` on the state. For the middle step, spread `initialActiveRide` with `rideId: OTHER_ID, loading: true`.
  - **Two-sided check.** Revert T3, meaning put `value={pin}` back and keep the rest. The `uncontrolled` test must go **red** (`observed` or not done). Then revert only the ride keying (plain `useState('')`). The `does not carry` test must go **red**, and the `uncontrolled` test must stay **green**. Record both runs.
- **VALIDATE**: `pnpm --filter @taxi/driver test -- active-ride-screen`, green, plus the two mutation runs above with their results.
- **SATISFIES**: AC 4

### T4 — Device proof on `sakta224` (Level 4 steps 1, 2, 3, 5, 6)

- **IMPLEMENT**: run the Level 4 steps on a debug build of the branch, and quote the `Speaking fragment` lines and `uiautomator events` excerpts in the report. Step 4 (the listen) is already done.
- **VALIDATE**: each step's expected string, or its absence, is in the saved excerpt.
- **SATISFIES**: AC 2, AC 3 (on the real screens; the spike proved the shapes)

### T5 — `pnpm turbo run typecheck lint test build --force` from cleared dist

- **VALIDATE**: 22/22 green. The task count comes from memory `taxi-pr-figures-gate-scripts` (`derived` from `turbo --dry=json`); re-derive it if it differs. Run with `COMPOSE_PROJECT_NAME=taxi` and `.env` copied into the worktree (memory `taxi-worktree-env-redis-hang`).

### T6 — File the follow-ups (`gh issue create`)

- **IMPLEMENT**:
  - (a) Rider `TextField`: the same nameless-when-filled shape (`derived`, same code). Same fix as T2, and it needs its own TalkBack check.
  - (b) Other controlled inputs chatter per keystroke (mechanism observed, S1–S4). List driver `login-screen.tsx:71`, driver `verify-screen.tsx:101`, rider `verify-screen.tsx:125` and `vehicle-screen.tsx` ×5. Note the OTP auto-submit and clear-on-error constraints.
  - (c) **Not an issue, a comment on #257** (VoiceOver ear-checks owed, no iOS runtime on this machine): add this ticket's two iOS-facing changes to its list. They are the `TextField` naming (iOS keeps `accessibilityLabel`; expect label and field stops as before) and the uncontrolled PIN field (expect no per-keystroke re-read). Cite the PR.
  - Put the numbers in the PR body. Keep `Closes`/`Fixes` keywords away from them (memory `taxi-pr-issue-link-backticks`).
- **VALIDATE**: `gh issue view <N>` for each one filed.
- **SATISFIES**: AC 5 (iOS owed by #257), scope hygiene

---

## TESTING STRATEGY

### Unit tests (jest + RNTL 14, `apps/driver`)

- `TextField.test.tsx`: the labelled-by cases, iOS and Android (T2).
- `active-ride-screen.test.tsx`, which tests the component (T3b):
  - expected: `0042` sends `0042` (existing `:154-171`)
  - failure: `12ab` is refused and nothing is sent
  - regression: the field is uncontrolled
  - edge: the PIN does not carry across rides
  - failure: the existing wrong-PIN and locked cases, adjusted at `:221`
- `active-ride-state.test.ts` is unchanged. `pinSendable` is untouched.

### Integration tests

None. The ticket touches no socket, room join or `features/realtime` code. The api is unchanged.

### Edge cases

| Edge | Where verified |
|---|---|
| Leading-zero PIN `0042` is sent intact | `active-ride-screen.test.tsx:154-171` (existing) |
| Non-digit paste `12ab`: visible, read back, Start off | T3b failure test (Start and send); Level 4 step 5 (what TalkBack reads) |
| PIN typed for ride A does not enable Start on ride B | T3b edge test |
| Refused PIN `9999` stays in the field after the 422 | Level 4 step 6. RNTL cannot see an uncontrolled field's native text |
| Other `TextField`s (login, verify, vehicle) keep their name after T2, empty and filled | Full driver suite (`getByLabelText` queries) plus Level 4 step 2 on the login phone field |

---

## VALIDATION COMMANDS

### Level 1: Syntax & style

```bash
pnpm --filter @taxi/driver typecheck
pnpm --filter @taxi/driver lint
```

### Level 2: Unit tests

```bash
pnpm --filter @taxi/driver test
```

### Level 3: The gate

```bash
COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
```

### Level 4: Manual validation (`sakta224`, lv-LV, TalkBack VERBOSE, debug build of the branch)

Setup:

- The api on :3031 against the dev DB.
- Rider and driver debug builds (`expo run:android`).
- `touch.sh` pushed per runbook `:519-545`.
- The emulator **not** started with `-no-audio` (only needed if step 4 is re-run).
- **Gotchas `observed` in the spike:**
  - `adb root` restarts adbd and **drops every `adb reverse`**, so re-add them afterwards. The dev bundle dials `localhost:3001` (`src/config.ts:15`), so reverse `tcp:3001` to the api port.
  - A fresh worktree needs `pnpm --filter @taxi/shared build` before Metro resolves `@taxi/shared`.
  - The TalkBack VERBOSE pref file lives at `/data/user_de/0/com.google.android.marvin.talkback/shared_prefs/…`, not `/data/data/…`.

State: book a pinned ride in the rider app (switch «PIN kods iekāpšanai» on), then accept, arriving and arrived in the driver app. This is #276's route, and it needs no dev script. `mint-tracked-ride.ts` cannot set `pickupPin` (observed: no `pin` hit in its source), and it is not needed.

1. **Chatter, injection.** Focus and activate the field, `adb shell input text 0042`. Expect four digit echoes and **zero** «tika aizstāts» fragments.
2. **Named field, empty and filled.**
   - Swipe (`touch.sh swipe 200 1600 900 1600`) from the ride details to the field.
   - Empty: expect the label stop «Pasažiera PIN kods», then the field «Rediģēšanas lodziņš — Pasažiera PIN kods», with the name once.
   - Filled with `4821`, from outside the field: expect «4821, Rediģēšanas lodziņš — Pasažiera PIN kods». Main today gives «4821, Rediģēšanas lodziņš».
   - Repeat both on the login screen's phone field after signing out. That is the check on other `TextField`s.
3. **Chatter, soft keyboard** (AC 2 names it). The spike showed that TalkBack on and Gboard typing cannot be combined by automation here:
   - A raw `touch.sh explore` focuses a key and its lift does not type.
   - A raw double-tap does not type.
   - Gboard ignores `input tap` while TalkBack is on.
   - The emulator's permanent «AT Translated Set 2 keyboard» device, plus any `input keyevent`, drops Gboard into its compact toolbar.
   
   The recipe that worked (S3k) reads the event stream instead of speech, with TalkBack **off**:
   - Reopen the screen so the field is empty (a remount), and **do not** clear it with `keyevent`s.
   - Tap the field, then `adb shell input keycombination KEYCODE_ALT_LEFT KEYCODE_K` once. It toggles, so `screencap` to confirm the floating number keypad is showing.
   - Start `adb shell uiautomator events > ev.txt &`, `input tap` the keys for `4821` from the `screencap` coordinates (1.5 s apart), then stop it.
   - Expect four `TYPE_VIEW_TEXT_CHANGED` inserts (`RemovedCount: 0`) and **no** event with `RemovedCount > 0`.
   - The keypad went unresponsive after one or two runs in the spike. If it does, re-launch the app and repeat once. If it still fails, record it and rely on step 1 (S3k already proved the keyboard's commit is an insert).
4. **The listen — DONE (S7).** Four digits were heard for `4821` and `0042`. It needs no re-run: the change doesn't touch the text TTS receives, which S6 and S7 show is the field's raw text, and the uncontrolled field holds the same text.
5. **Non-digit paste.**
   - `adb shell input text 12ab`. Before relying on it, check whether it lands: `DigitsKeyListener` may drop letters on a `number` input, which would itself be the refusal.
   - Expect Start «atspējots», and the re-read reads what is in the field.
   - If letters cannot be entered at all, record that as the platform's refusal. The JS path is covered by T3b.
6. **Survives a 422.** Enter `9999`, press Start (TalkBack off, `input tap`), and get «PIN kods nav pareizs». Expect the field still to read `9999` and Start «atspējots». Change one digit and expect Start enabled.

### Level 5

None.

---

## ACCEPTANCE CRITERIA

- [x] **AC 1.** The re-read of a filled PIN field is heard as four digits: Linards' listen, S7, 2026-09-26 (`4821` and `0042`, lv_LV). No code.
- [ ] **AC 2.** Item 2 was confirmed before the fix (S1, S3, S3k: done). It is fixed when steps 1 and 3 on the branch show zero «tika aizstāts» and zero replace events.
- [ ] **AC 3.** A logged decision to keep two stops (Linards, 2026-09-27, evidence S8), with the field naming itself when filled: T2 and Level 4 step 2. Log the decision in `.claude/references/ui-decisions.md` (CLAUDE.md: cosmetic and UX calls are logged there) and on #280.
- [ ] **AC 4.** Tests: expected (`0042` sent), edge (the leading-zero PIN, and the cross-ride carry), failure (the `12ab` paste). The T3b mutation runs are recorded.
- [ ] The gate is green (T5).
- [ ] Follow-ups filed (T6a, T6b); iOS added to #257 (T6c).
- [ ] **AC 5.** iOS/VoiceOver: owed by #257. There is no iOS runtime on this machine (memory `taxi-mac-xcode-ceiling-expo-ios`: SDK 57 does not compile on Xcode 26.3).

---

## COMPLETION CHECKLIST

- [x] T1's counts recorded before T3 is written (§Spike evidence)
- [ ] T2, T3 and T3b are green at each VALIDATE
- [ ] Both mutation runs recorded (T3b)
- [ ] Level 4 steps 1, 2, 3, 5, 6 run, with log excerpts in the report
- [ ] Gate green
- [ ] Follow-ups filed and cited in the PR body

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Q1: CLOSED.** The mechanism is observed (S1–S4, S3k).
- **Q2: a remount losing the typed PIN.** Worst case: the field unmounts and remounts on the **same** ride, for example if a later change adds an early return while `arrived`. The native text would then be empty while `pin.text` still holds digits, and Start would be enabled over an empty-looking field.
  - Today the field unmounts only in three cases: `ride` is null (the `!ride` branch), the status leaves `arrived` (on `in_progress` Start is gone anyway), or the screen remounts. Neither of the first two keeps the same ride at `arrived`.
  - A `reload_pressed` keeps `ride` (`active-ride-state.ts:424-428`).
  - The T3 comment must say this, so a future early return is added knowingly.
- **Q3: CLOSED.** `accessibilityValue` does not change a filled EditText's reading (S6), and item 1 needs no fix (S7).
- **Q4: the iOS side is owed by #257** (T6c, AC 5). T2's iOS branch (`accessibilityLabel` kept) is unchanged from today on VoiceOver, and that is `expected` only; this machine has no iOS runtime for SDK 57.
- **Q5: the remount under a force-assign** (Solution Statement) is still unverified. It is neutralised by the ride-keyed state and pinned by T3b's cross-ride test, so its answer no longer changes the code.

## NOTES

- **Why not strip non-digits any more.** Stripping forces a native write. That write is the `clear()`/`setNativeProps`/`value` path, which is item 2's replace, now on the rare path. With stripping, a 3-digit field could also hold a pasted letter the driver cannot see is gone. Leaving the text as typed means the field shows what will be judged, TalkBack reads it back, and `pinSendable` is the single gate: the state file already says "one rule for both" (`active-ride-state.ts:118-119`).
- **Friction audit.** The action count from "rider tells PIN" to "Start pressed" is unchanged: 6 actions, `derived` as 1 focus + 4 digits + 1 press. It assumes the driver types without correction. Swipe stops are unchanged, since both stops are kept. For a pasted non-digit, the driver deletes it by hand where it used to vanish silently. That is +1 action on a path that `derived`-ly needs a clipboard, which a driver hearing the PIN aloud does not use.
- **Rejected: four cells.** They cost 3 extra swipe stops and focus choreography, and the listen (S7) showed the problem does not exist.

## AMENDMENTS

- 2026-09-26: the planning session ran T1 and the item-1 listen on `sakta224` (§Spike evidence).
  - Item 2's mechanism is observed, including on the Gboard keypad. Item 3 is observed.
  - Item 1 is closed by Linards' listen with no code. The `accessibilityValue` lever is observed not to work.
  - Level 4 step 3 is rewritten to the recipe that works; the recipe as first written is observed unperformable.
  - iOS is re-homed to #257, not a new issue.
  - T6c is now a comment on #257. Q1 and Q3 are closed.
- 2026-09-27: the advisor review caught that S6 showed a filled field drops its name, so hiding the label (T2 as first written) would leave filled fields nameless. Round 2 of the spike (S8) tested seven variants. Linards chose two stops plus a self-naming field (`accessibilityLabelledBy` on Android). T2, Level 4 step 2 and AC 3 are rewritten. The S7 wording is reduced to what one listen shows.
