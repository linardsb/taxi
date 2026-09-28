# Feature: offer countdown speaks once, on arrival (#279)

This plan has been **executed once as a spike** (2026-09-28, detached worktree off `origin/main` `c08b927`, discarded afterwards). The code in Appendix A is the exact diff that spike ran. It passed typecheck, lint and the driver test suite, and on TalkBack it met #279's acceptance at two speech rates. The implementer applies the same diff on a branch, re-runs the checks, and records the confirmation run. Nothing here is a design decision left open.

Every `file:line` is read from `origin/main` at `c08b927`.

## Feature Description

Under TalkBack, the driver's offer card takes about as long to read as the whole 20 s offer window. The countdown announcements the card sent every 5 s, and then each second for the last 5, queued behind that read, and TalkBack spoke them after the offer had expired. This ticket reduces countdown speech to **one announcement when the card arrives** («Atlikušas 20 s»). It removes the duplicate «Jauns brauciens» announcement, and it hides the visible countdown number from the screen reader, so its per-second text changes stop being spoken as well.

It also records #279's folded-in D2 leg: the earnings link's loading and failed-first-load states under TalkBack.

## User Story

As a driver who uses TalkBack
I want every time-left announcement I hear to be true when I hear it
So that I am never told «Atlikušas 15 s» about an offer that is already gone

## Problem Statement

The evidence is #276's run: 2026-09-24, AVD `sakta224`, debug build of `d6deaa6`. Its raw TalkBack VERBOSE log is at `/private/tmp/claude-501/-Users-Berzins-Desktop-taxi/f01f57d9-4d69-41b1-861c-237e5ee2032e/scratchpad/logcat-final-full.txt` (md5 `8605a4803a5f0ab723e92eb32a77a04f`, 7792 lines). The log establishes three facts:

1. **A queued announcement cannot be cancelled.**
   - Every `TYPE_ANNOUNCEMENT` is queued `queueMode=QUEUE/UNINTERRUPTIBLE/CAN_IGNORE_INTERRUPTS` (`observed`: line 118 «Atlikušas 20 s», line 879 «15 s»).
   - RN 0.86.3 on Android has no queue or priority control. `announceForAccessibilityWithOptions` drops `options` on Android (`node_modules/react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo.js`, its `Platform.OS === 'android'` branch).
   - The route home at expiry did not clear the queue: the backlog drained from 17:16:08 to 17:16:19 (`observed`).
2. **The card name alone fills the window.**
   - The name is 194 characters (`observed`: `len()` of log line 632). It took 19.7 s to speak (`derived`: 17:16:05.098 − 17:15:45.362 + 60 s), against 20 s.
   - It opens with «Jauns brauciens» (`driver.offer.a11y_card`, `packages/shared/src/i18n/lv.ts:345-346`). The separate title announcement therefore repeats it, and it added 1.4 s to the queue ahead of the name (`derived`: 45.362 − 43.966).
3. **Countdown speech had two sources.**
   - «Atlikušas 6 s» (11.995) is `TYPE_WINDOW_CONTENT_CHANGED`, which the throttle `s <= 5 || s % 5 === 0` (`offer-card.tsx:59`) cannot produce.
   - TalkBack speaks text changes of the visible countdown `Text` because its ancestor, the card `Pressable`, has focus. That produced 18 outputs («19 s» … «2 s»), all with `isSelfOrAncestorFocused=true`.
   - All 83 content changes with no focused ancestor were silent (`observed`, awk tally over the log).

**Every stale line in D1 was issued before expiry.** A guard of the form "expired → don't announce" suppresses none of them. That is why task 7 runs the tests red against the old source.

## Solution Statement

The approach is Linards' choice (2026-09-28). It was picked over predicting queue drain and over shortening the spoken name (see NOTES). The change has three parts:

- **One countdown announcement per card, at arrival.** The reducer emits it as `{ type: 'announce', seconds }`. `OfferCard` stops announcing.
- **No «Jauns brauciens» announcement.** The card name that TalkBack reads on focus already opens with it.
- **The visible countdown `Text` is out of the accessibility tree.** It carries `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`, the same pair `apps/rider/src/features/booking/preference-switch.tsx:56-57` uses.

After the arrival line the app sends no countdown speech, so nothing is queued that can go stale. The last-5-seconds haptic taps stay as the non-speech time cue (`use-offer-alerts.ts:8`, `HAPTIC_COUNTDOWN_FROM_S = 5`).

**Cost.** A screen-reader driver no longer hears «5 s left». In D1 they never heard it on time: every tick after the first was spoken 6.4–17.7 s after expiry, and «15 s» was spoken about 21.6 s after it was due (`derived`: 17:16:08.381 − 17:15:46.75, its issue time 5 s after arrival).

## Spike results (2026-09-28): every risk the first draft listed is now observed

**Spike setup:**
- Api from the spike worktree on `:3041`, against the dev DB and Redis on the LAN IP.
- Metro from the spike worktree on `:8082`.
- #276's debug APK on `sakta224`, locale `lv-LV`, TalkBack VERBOSE, one dispatcher phone order per run.
- Host clock BST. The emulator clock ran **0.56–0.60 s behind the host** (`observed`: three `adb shell date +%s.%N` samples against host time, −0.596, −0.563, −0.594 s). Emulator times below are corrected to host time where they are compared with the DB's `expires_at`.

| Risk (first draft) | Result | Evidence |
|---|---|---|
| Fake timers under RNTL 14 with the provider's `waitFor` | **Works as written.** No real-timer fallback needed | `observed`: offers suite 5 suites, 56 passed |
| Q1: does hiding the `Text` silence its content-change speech? | **Yes.** 0 `ttsOutput= {Atlikušas…}` evaluations in either run; D1 had 18 | `observed`: `grep -a -c "ttsOutput= {Atlikušas"` = 0 in `run2.txt` and `run3.txt` |
| Q2: is the arrival line queued before the focus read? | **Yes.** «Atlikušas 20 s» 11:03:13.107, card focus read 11:03:15.223 (emulator clock) | `observed`, run 2 |
| Rate independence | **Holds at a slower rate.** One countdown line and none after expiry at `tts_default_rate 50`. The setting took effect: the card read lasted 27.9 s against 19.5 s at the default rate | `observed`, runs 2 and 3 |
| Tests red on old source | Run A: `7 failed, 49 passed` (the 7 predicted). Run B: `4 failed, 52 passed` (the 4 predicted) | `observed`, task 7 |
| Other driver tests depending on the removed behaviour | None. `@taxi/driver` typecheck + lint + test: `4 successful, 4 total`, `46 passed` suites, `357 passed` tests | `observed`. 357 = #295's 348 + 9 new (`derived`) |

**Run 2 (default rate), speech in emulator time, offer `sent_at 10:03:13.561Z`, `expires_at 10:03:33.561Z`:**

```
11:03:13.107 TYPE_ANNOUNCEMENT             Atlikušas 20 s
11:03:15.223 TYPE_VIEW_ACCESSIBILITY_FOCUSED  Jauns brauciens. Cena €3.65, … (card name)
11:03:34.734 TYPE_VIEW_ACCESSIBILITY_FOCUSED  Poga
11:03:35.498 TYPE_ANNOUNCEMENT             Piedāvājuma laiks beidzās
```

- Expiry is 11:03:33.561 in host time, which is ≈ 11:03:32.98 on the emulator clock (`derived`: −0.58 s offset).
- The only countdown line is at 13.107, 19.9 s before expiry.
- «Piedāvājuma laiks beidzās» follows expiry by 2.5 s (`derived`: 35.498 − 32.98).
- No standalone «Jauns brauciens» was spoken.

**Run 3 (`tts_default_rate 50`, confirmed with `settings get` → `50`), offer `expires_at 10:08:20.859Z`:**
- «Atlikušas 20 s» 11:08:01.139.
- Card read 11:08:03.817 → «Poga» 11:08:31.742, which is 27.9 s.
- «Piedāvājuma laiks beidzās» 11:08:36.154.
- One countdown line, none after expiry.
- The 27.9 s read against 19.5 s at the default rate is a ratio of 1.43, not the 2.0 the first draft assumed (`derived`). A rate setting does not scale speech linearly, so the pass rule below compares the read against the default run's instead of predicting a figure.

**Observed, outside this ticket's acceptance:**
- The card name itself runs past expiry: by 1.8 s at the default rate and 11.5 s at rate 50 (`derived` from the emulator times above and the corrected expiry).
- The expiry banner waits behind it.
- No countdown line is involved in either delay. Shortening the name was the rejected option, and this is its measured cost. Recorded in task 10's `ui-decisions.md` entry. No new issue.

**D2 (earnings link), same spike build, through the proxy in Level 4:**

| State | How reached | TalkBack focus read (`observed`) |
|---|---|---|
| Loading (spinner) | proxy `hang`, cold launch, explore-touch at (540, 664) 0.1 s after the proxy logged the request | `Ieņēmumi` → `Poga` → `Lai aktivizētu, Dubultskāriens` |
| Failed first load («—») | proxy `hang`, left past the app's 8 s client timeout; the card showed «—» | `Ieņēmumi. —` → `Poga` → `Lai aktivizētu, Dubultskāriens` |

«Ieņēmumi» was spoken once in each state. This matches `.claude/references/ui-decisions.md:17`.

## Out of Scope / Non-Goals

- **Not shortening the card's accessible name.** `offer-card-props.ts:128-147` stays byte-identical.
- **Not predicting TalkBack's queue.** No speech-duration model.
- **Not VoiceOver.** Owed on #257, which gets a one-line comment (AC9).
- **Not #295's post-merge F2–F7.** The #279 reopen comment excludes them.
- **Not the offer window, tone, flash or haptics.**
- **No catalog changes.** `driver.offer.countdown` exists. `driver.offer.title` stays in use as the visible title (`offer-card.tsx:86`).
- **No follow-up issues** for the observations above (memory: no follow-up sprawl).

## Feature Metadata

**Feature Type**: Bug Fix
**Estimated Complexity**: Low. The diff is 4 source files and 3 test files, `7 files changed, 165 insertions(+), 33 deletions(-)` (`observed`, spike `git diff --stat`).
**Primary Systems Affected**: `apps/driver` `offers` slice. Docs: `docs/runbooks/driver-device-day.md` and `.claude/references/ui-decisions.md`.
**Dependencies**: none.

## Related Work

**Implements**: #279 (primary acceptance + D2) · **Epic**: driver app (#14/#15 line).

**Back-references**: `.claude/plans/driver-offers-active-ride.md` (#15's throttled countdown, retired here). #263's name-without-seconds comment (`offer-card-props.ts:123-127`, updated). PR #295 / `.claude/code-reviews/pr-295-review.md` F1 (why #279 was reopened). #259 T0 (the driver `Banner` announces on Android, so the expiry banner is spoken).

**Forward-references**: (none yet)

---

## CONTEXT REFERENCES

### Files (read before implementing)

- `apps/driver/src/features/offers/offer-card.tsx` (1-17, 39-65, 119-124)
- `apps/driver/src/features/offers/offer-state.ts` (1-6, 98-106, 199-230)
- `apps/driver/src/features/offers/use-offers.tsx` (153-155)
- `apps/driver/src/features/offers/offer-card-props.ts` (87, 123-127)
- `apps/driver/src/features/offers/offer-state.test.ts` (1-60 fixtures). `use-offers.test.tsx` (1-165 harness). `offer-card.test.tsx` (97-117)
- `apps/driver/src/features/auth/verify-screen.test.tsx` (86-107): the fake-timer pattern the provider tests use
- `apps/rider/src/features/booking/preference-switch.tsx` (52-66), `booking-screen.test.tsx` (138-146): the hide pair and `includeHiddenElements`
- `docs/runbooks/driver-device-day.md` (420-430 #276 results, 441-446 presence via the app, 457-465 offer window, 468-471 locale reboot, 476-545 TalkBack from `adb`)
- `.claude/references/ui-decisions.md` (17, 23)

### Documentation

- [RN AccessibilityInfo](https://reactnative.dev/docs/accessibilityinfo#announceforaccessibilitywithoptions): `queue` is iOS-only.
- [RN importantForAccessibility](https://reactnative.dev/docs/accessibility#importantforaccessibility-android), [accessibilityElementsHidden](https://reactnative.dev/docs/accessibility#accessibilityelementshidden-ios).
- [RNTL includeHiddenElements](https://callstack.github.io/react-native-testing-library/docs/api/queries#includehiddenelements-option): default `false` here (`node_modules/@testing-library/react-native/dist/config.js:16`).

### Patterns

- **An effect carrying data, turned into text by the runner:** `active-ride-state.ts:113-118` → `use-active-ride.tsx:173-184`.
- **Announcement tests assert the whole `mock.calls` array** (#295's suites), so an extra or duplicate line fails.
- **Test names** end `(#279, expected|edge|failure)`.

---

## IMPLEMENTATION PLAN

### Phase 0: Worktree

1. Check `git reflog -8` in the main checkout. Then create the worktree: `git worktree add ~/taxi-worktrees/wt-279-countdown -b fix/offer-countdown-opening-tick-279 origin/main`.
2. Copy the repo-root dotenv file into it (memory: a worktree without it hangs the gate on Redis). The PreToolUse hook blocks any command whose text contains the dotenv filename. Do the copy from a script file written with the Write tool and run it by path, or have Linards run it with `!`.
3. Run `pnpm install` and `pnpm --filter @taxi/shared build` in the worktree.
4. Move this plan into the worktree's `.claude/plans/` and delete the untracked copy in the main checkout (memory: stale untracked drafts block `git checkout main`).

### Phase 1: Source (tasks 1–4) → Phase 2: tests (5–6) → Phase 3: red-on-old proof (7) → Phase 4: gate (8) → Phase 5: TalkBack confirmation, runbook, ui-decisions, #257 (9–11)

Phase 5 is independent of Phase 4 once Phase 2 is green, so the two can run in either order. The gate is one run at a time across sessions.

---

## STEP-BY-STEP TASKS

Tasks 1–6 are exactly Appendix A. The fastest faithful route: write Appendix A to a file and run `git apply --check` then `git apply`. Then read each task below to confirm what you applied.

### 1. UPDATE `offer-state.ts`

- **IMPLEMENT**:
  - Drop `MessageKey` from the import; it is used only on line 106.
  - `OfferEffect`'s announce member becomes `{ type: 'announce'; seconds: number }`, with the doc comment in Appendix A.
  - `offer_received` emits `{ type: 'announce', seconds: Math.ceil(incoming.durationMs / 1000) }`. That is the same rounding as `offer-card-props.ts:87`, so speech and the first frame agree.
- **GOTCHA**: `tick` must not gain an `announce`. Task 5's edge case pins that.
- **VALIDATE**: after task 2, `pnpm --filter @taxi/driver exec tsc --noEmit` → exit 0 (`observed` in the spike).
- **SATISFIES**: AC1, AC2.

### 2. UPDATE `use-offers.tsx`

- **IMPLEMENT**: the `announce` case speaks `tRef.current('driver.offer.countdown', { seconds: effect.seconds })`.
- **VALIDATE**: as task 1.
- **SATISFIES**: AC1.

### 3. UPDATE `offer-card.tsx`

- **IMPLEMENT**:
  - Delete `ANNOUNCE_EVERY_S`, the `announced` ref and the announce effect.
  - Remove the imports that orphans: `AccessibilityInfo` and `useRef`. Prettier then collapses the `react-native` import to one line.
  - Hide the countdown `Text` with the pair and the 3-line JSX comment from Appendix A.
- **GOTCHA**: do not touch the `Pressable`, its label or `accessibilityState`.
- **VALIDATE**: `pnpm --filter @taxi/driver exec eslint src/features/offers` → 0 problems (`observed`).
- **SATISFIES**: AC2, AC3.

### 4. UPDATE `offer-card-props.ts` (comment only)

- **IMPLEMENT**: the two-line rewrite in Appendix A.
- **VALIDATE**:
  - `git grep -n -i -E "ANNOUNCE_EVERY|throttled countdown|every 5 s" -- apps/driver/src` → no hits.
  - `git grep -n -i "countdown announc" -- apps/driver docs .claude/references` → only the runbook rows that task 9 rewrites.
- **SATISFIES**: AC5.

### 5. ADD reducer tests (`offer-state.test.ts`, Appendix A)

- **IMPLEMENT**: four cases:
  - expected: `seconds: 20` once;
  - edge: 7.3 s → `seconds: 8`;
  - edge: ticks at 5/10/15/19 s return `[]`;
  - failure: expiry → `['alert_stop', 'route_home']`.
- **GOTCHA**: existing `types(effects)` assertions (lines 65, 90, 186-191) still read `'announce'`. Leave them.
- **SATISFIES**: AC1, AC4.

### 6. ADD provider and card tests (`use-offers.test.tsx`, `offer-card.test.tsx`, Appendix A)

- **Provider:** three cases under fake timers (`doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask']`), set in `beforeEach` before `wire()` reads `Date.now()`, restored in `afterEach`:
  - expected: calls are exactly `[[«Atlikušas 20 s»]]` at arrival;
  - edge: still that after `advanceTimersByTime(15_000)`, phase `pending`;
  - failure: still that after `advanceTimersByTime(21_000)`, phase `idle`, banner `expired`.
- **Card:**
  - the countdown node carries the pair and is absent from default queries;
  - rerendering at 15/10/5/1 s never announces;
  - the existing accepting test queries `offer-countdown` with `{ includeHiddenElements: true }`. Without the option it throws once the node is hidden.
- **VALIDATE**: `pnpm --filter @taxi/driver exec jest src/features/offers` → `Tests: 56 passed, 56 total` (`observed` in the spike: 47 existing + 9 new).
- **SATISFIES**: AC1, AC3, AC4.

### 7. VALIDATE red on the old source, both directions

- **Run A:**
  - Command: `git stash push -- apps/driver/src/features/offers/{offer-state.ts,use-offers.tsx,offer-card.tsx,offer-card-props.ts}`, then `pnpm --filter @taxi/driver exec jest src/features/offers --verbose`, then `git stash pop`.
  - Expected (`observed` in the spike): `Tests: 7 failed, 49 passed, 56 total`.
  - Red: all 3 provider cases, both card cases, and the reducer "announces the whole window once" and "rounds a part-second window up".
  - Green on old source, by design: the reducer "no tick announces" and "expiry clears the card with no announcement". The old reducer never announced on `tick`; the bug lived in the card. They are regression pins.
  - jest-expo transpiles with babel and does not typecheck, so this runs despite the type mismatch. That is intended.
- **Run B:** re-insert only the old card effect into the fixed `offer-card.tsx`, as below, then run the same command. Restore the file afterwards from a copy taken first.
  - What to insert: `useRef` and `AccessibilityInfo` imports, `const announced = useRef<number | null>(null);`, and the `origin/main` lines 57-65 effect with `ANNOUNCE_EVERY_S` written as `5`.
  - Expected (`observed`): `Tests: 4 failed, 52 passed, 56 total`. Red: the card "never announces" case and all 3 provider cases. The expected case is red too, because card and reducer both send «20 s», giving 2 calls. All reducer tests stay green.
  - **GOTCHA** (`observed` in the spike): prettier leaves `import { Pressable, StyleSheet, Text, View } from 'react-native';` on one line. A mutation script that looks for the old multi-line import silently fails to re-add `AccessibilityInfo`. That gives a `ReferenceError` in 5 unrelated provider tests (9 failed instead of 4). If the count is not 4, check the import before reading anything into it.
- Record both lines and the named tests in the PR body.
- **SATISFIES**: AC4.

### 8. Full gate

- **VALIDATE**:
  1. Clear `dist` dirs and `apps/dispatch/.next` first (memory: stale `.next` race).
  2. Run `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` in the worktree.
  3. Expected: `Tasks: 22 successful, 22 total`. This is `expected`, not re-observed for this diff; the spike ran only the driver-scoped `typecheck lint test`, `4 successful, 4 total`.
  4. Record the observed line.
  5. An `@taxi/api` integration flake is environmental (memory). Re-run once before diagnosing.
- **SATISFIES**: AC6.

### 9. Level 4 confirmation run on the branch head, then UPDATE `docs/runbooks/driver-device-day.md`

Run Level 4 below against the committed head, not the spike. Then:
- In #276's results table (line 427 area), link the countdown row to the new block.
- Add a block «#279 re-run (date, sha)» with runs 2/3-style excerpts (the four lines, `expires_at`, the clock offset) and the D2 table.
- Add the setup deltas this spike discovered to §"Driving TalkBack from `adb`" and §"Setup deltas":
  - the release APK on `sakta224` ignores Metro, so install the debug APK;
  - the TalkBack notification prompt steals focus, so `pm grant … POST_NOTIFICATIONS` first;
  - measure the emulator clock offset before comparing with DB times;
  - the D2 proxy recipe, and don't truncate its log while it runs.
- **SATISFIES**: AC7, AC8.

### 10. ADD an entry to `.claude/references/ui-decisions.md`

- **IMPLEMENT**: one dated line in the file's format (precedent: line 23). It records:
  - the decision: the driver offer countdown is spoken once, at arrival, by Linards' decision on #279 (2026-09-28);
  - what was dropped: the 5-second and last-5 ticks, the «Jauns brauciens» announcement, and the visible number from the accessibility tree;
  - why: TalkBack queues announcements uninterruptibly, and the 194-character name fills the 20 s window;
  - what remains: the last-5-seconds haptics;
  - the rejected alternative: shortening the name;
  - its measured cost: the name outlives the offer by 1.8 s at the default rate and 11.5 s at rate 50, so the expiry banner waits;
  - revisit if the name is shortened or the window grows.
- **VALIDATE**: `git diff --stat -- .claude/references/ui-decisions.md` → additions only.
- **SATISFIES**: AC5.

### 11. Comment on #257

- **IMPLEMENT**: `gh issue comment 257` with one paragraph, passing the body with `--body-file` from the scratchpad (memory: the hook matches command text). The paragraph says the offer countdown is now one announcement at arrival (#279), so VoiceOver's leg should check that that line is not cut off by VoiceOver's own focus read of the new screen.
- **SATISFIES**: AC9.

---

## TESTING STRATEGY

### Unit

`offer-state.test.ts`: reducer cases (task 5). `offer-card.test.tsx`: the card never announces, and the countdown node is hidden (task 6).

### Integration

`use-offers.test.tsx`: the real `<OffersProvider><OfferScreen/>` composition, in the app's order (subscribe → socket handed over → `ride:offer` → clock runs). Socket wiring is unchanged by this ticket, and delivery is proven on the emulator (Level 4).

### Edge cases

| Edge case | Verified in |
|---|---|
| Tick due while the card name is still being read | provider edge; reducer edge; Level 4 (a) |
| Offer expires mid-read, so no stale tick | provider failure; reducer failure; Level 4 (c) |
| Part-second window rounds up like the card (7.3 → 8) | reducer edge |
| Visible countdown text changes are not spoken | card expected (prop level); Level 4 (b), 0 evaluations `observed` |
| Duplicate socket and push delivery → one announcement | existing `offer-state.test.ts:68-76` (duplicate → `effects: []`) |
| Accepting: «Pieņem…» hidden, `busy` exposed | `offer-card.test.tsx:97-117` (updated query) |
| Slow speech rate | Level 4 step 4, second run (`observed` in the spike) |
| iOS VoiceOver | #257 (task 11) |

---

## VALIDATION COMMANDS

### Level 1

```bash
pnpm --filter @taxi/driver exec tsc --noEmit
pnpm --filter @taxi/driver exec eslint src/features/offers
```

### Level 2

```bash
pnpm --filter @taxi/driver exec jest src/features/offers        # 56 passed
pnpm turbo run typecheck lint test --filter=@taxi/driver --force  # 4 successful; 46 suites, 357 tests
```

### Level 3

```bash
COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
```

### Level 4: TalkBack confirmation on `sakta224` (the spike's recipe, every step `observed` working)

**Setup:**

1. **Api.** Run `pnpm turbo run build --filter=@taxi/api...` in the worktree. Start `node services/api/dist/main.js` on a free port (the spike used `API_PORT=3041`), with:
   - `DATABASE_URL` and `REDIS_URL` on the LAN IP (`ipconfig getifaddr en0`; memory: localhost 5432/6379 are shadowed; Redis is `:6381`);
   - `ALLOW_STUB_MAPS_PROVIDER=true`, `SMS_PROVIDER=stub`, `PUSH_PROVIDER=stub`, `NODE_ENV=development`.

   Other sessions' apis may be listening on 3001 and 3031. Leave them alone. Check `select offer_timeout_seconds from platform_config` is `20` (runbook line 457).
2. **Emulator.** `/usr/local/share/android-commandlinetools/emulator/emulator -avd sakta224 -no-window -no-audio -no-boot-anim`. For LV: `adb root`, then `setprop persist.sys.locale lv-LV; settings put system system_locales lv-LV`, then `adb reboot`.
3. **App.** `sakta224` now has #276's **debug** APK installed; the spike replaced a 2026-09-18 release build, which ignores Metro. If `adb shell pm dump lv.saktacab.driver | grep versionName` shows a release build again, `adb uninstall lv.saktacab.driver` and install `~/taxi-worktrees/wt-a11y-276/apps/driver/android/app/build/outputs/apk/debug/app-debug.apk`. Native deps are unchanged since `d6deaa6`: `git diff --quiet d6deaa6 origin/main -- apps/driver/package.json apps/driver/app.json pnpm-lock.yaml` exits 0 (`observed`). Grant `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `POST_NOTIFICATIONS` with `pm grant`.
4. **Metro.** From the worktree's `apps/driver`: `EXPO_PUBLIC_API_URL=http://10.0.2.2:<API_PORT> CI=1 npx expo start --port 8082 --dev-client`. Port 8082 because a stale Metro may hold 8081. It rewrites `apps/driver/tsconfig.json`'s `include`, so `git checkout -- apps/driver/tsconfig.json` before committing. Open the app on it with `adb shell am start -a android.intent.action.VIEW -d "saktacabdriver://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8082" lv.saktacab.driver`. The Metro log must show `Android Bundled`. If it doesn't, the app is running some other bundle.
5. **Sign in** as the `EMU224` driver, `+37120000002`. The code is in the api log's `auth.otp.stub_sent`. Go online **in the app** (runbook line 441). Keep fixes flowing with a background loop of `adb emu geo fix 24.1052 56.9496 10 8` every 3 s. Confirm `driver.location.ping_accepted` in the api log.
6. **Dispatcher token.** `POST /auth/otp/request {"phone":"+37120000001","role":"rider"}`; the stored role `dispatcher` wins. Then `POST /auth/otp/verify` with the stub code.
7. **TalkBack.** Enable it with VERBOSE per the runbook (lines 476-505). **Then `adb shell pm grant com.google.android.marvin.talkback android.permission.POST_NOTIFICATIONS`**, and `KEYCODE_BACK` if its «Vai atļaut … sūtīt jums paziņojumus?» dialog is up. In the spike's first run that dialog held focus, the card was never focused, and the run did not count. Check with `uiautomator dump` that only `lv.saktacab.driver` nodes are on screen.
8. **Clock offset.** Run three samples of `adb shell date +%s.%N` against host `time.time()`, and record the mean (spike: −0.58 s).

**Step 4, the acceptance (run twice: default rate, then `settings put secure tts_default_rate 50`):**

1. `adb logcat -c`, then `adb logcat -v time > run.txt` in the background.
2. `POST /dispatch/bookings`: dispatcher bearer, `idempotency-key` a fresh lowercase uuid. Body: `{"callerPhone":"+37129990279","pickup":{"location":{"lat":56.9496,"lng":24.1052},"address":"Brīvības iela 30, Rīga"},"stops":[],"destination":{"location":{"lat":56.956,"lng":24.121},"address":"Tallinas iela 5, Rīga"},"category":"standard","options":{"childSeat":false,"femaleDriver":false,"pickupPin":false},"paymentMethod":"cash"}`. Touch nothing.
3. Wait with an until-loop on `select count(*) from ride_offers where ride_id='<id>' and status<>'pending'`, then a fixed 45 s for the queue to drain. Do not wait on the log file's mtime: logcat never stops writing.
4. Read `select sent_at, expires_at from ride_offers where ride_id='<id>'` (UTC). Convert to BST (+1 h), then to emulator time with the measured offset, and write the arithmetic into the runbook.
5. `grep -a 'Speaking fragment text="' run.txt`, split by `subtype`.

**Pass requires:**
- (a) exactly one `TYPE_ANNOUNCEMENT` «Atlikušas 20 s»;
- (b) `grep -a -c "ttsOutput= {Atlikušas"` = 0;
- (c) no «Atlikušas» fragment after the converted `expires_at`;
- (d) no standalone «Jauns brauciens» announcement;
- (e) for the slow run only, `settings get secure tts_default_rate` = `50`, **and** the card read (name fragment → «Poga») is longer than the default run's. Spike: 27.9 s vs 19.5 s. If it isn't, the setting did not reach TTS and AC7 holds at the default rate only; say so.

Record the «Piedāvājuma laiks beidzās» time relative to expiry. Restore with `settings delete secure tts_default_rate`.

**Step 5, D2 through the proxy** (spike `observed` both states):

1. Write `d2-proxy.mjs` (Appendix B) to the scratchpad and run `node d2-proxy.mjs <API_PORT+1> <API_PORT>`.
2. Restart Metro with `--clear` and `EXPO_PUBLIC_API_URL=http://10.0.2.2:<API_PORT+1>`. `EXPO_PUBLIC_*` is inlined at bundle time, and a cached transform keeps the old URL.
3. Do a warm-up launch in `pass` mode, so the bundle is cached before the timed run.
4. **Loading:**
   1. `echo hang > d2-mode`, then force-stop the app and launch it.
   2. Wait with `until [ $(grep -a -c "earnings hang" proxy.log) -gt $N ]`. `-a` is required: truncating the log while node writes it leaves NUL bytes, and plain `grep` then never matches. Better, never truncate; compare counts instead.
   3. Immediately run `adb shell sh /data/local/tmp/touch.sh explore 540 664`; the runbook's `touch.sh` must be pushed first. The earnings card is at y≈664 while the socket status line shows. The 8 s client timeout is the deadline.
   4. Pass: the focus read is «Ieņēmumi» alone.
5. **Failed first load:** leave the request hanging past 8 s. The card turns «—». Explore-touch it at y≈634; the card sits higher once the status line changes. Pass: «Ieņēmumi. —».
6. The proxy's WebSocket pass-through is unreliable (`observed`: live on one launch, «Nav savienojuma» on another). D2 does not need the socket, and step 4 always runs directly against the api.

**Teardown:**
- TalkBack off (`settings delete secure enabled_accessibility_services`, `accessibility_enabled 0`).
- `echo pass > d2-mode`.
- Take the driver offline in the app.
- Kill the geo loop, logcat, proxy, Metro, api and emulator (`adb emu kill`).
- Check nothing is left listening on your ports.

### Level 5: none

---

## ACCEPTANCE CRITERIA

- [ ] **AC1** One countdown announcement per card, at arrival, with the card's first-frame seconds.
- [ ] **AC2** `OfferCard` never announces. No standalone «Jauns brauciens» announcement.
- [ ] **AC3** The countdown `Text` is out of the accessibility tree (test). TalkBack evaluates none of its text changes (Level 4 (b)).
- [ ] **AC4** #279's three tests exist at provider level. Task 7 records Run A `7 failed` and Run B `4 failed`, with the green-by-design reducer pins named.
- [ ] **AC5** No comment, runbook row or reference still presents the 5-second throttle as current behaviour. `ui-decisions.md` records the decision.
- [ ] **AC6** Full gate green, with the observed task line recorded.
- [ ] **AC7** **Primary:** on TalkBack (`sakta224`), no countdown line after `expires_at`, at the default and a confirmed-slower rate, on the branch head.
- [ ] **AC8** D2: both states' focus reads recorded verbatim, «Ieņēmumi» once, and written into the runbook.
- [ ] **AC9** #257 has the one-line VoiceOver note.

`Closes #279` in the PR body **only when AC7 and AC8 are recorded in it from the branch-head run**; otherwise `Refs #279`. #295 closed this issue early.

---

## COMPLETION CHECKLIST

- [ ] Tasks 1–11 in order, each VALIDATE result noted
- [ ] Task 7's two lines match 7/4 failed, or the difference is explained
- [ ] Gate green (observed line)
- [ ] Level 4 steps 4 (×2) and 5 recorded with the UTC → BST → emulator arithmetic
- [ ] Runbook, `ui-decisions.md`, #257 comment done
- [ ] `apps/driver/tsconfig.json` not in the diff; main-checkout plan copy deleted

---

## OPEN QUESTIONS / ASSUMPTIONS

None open for this ticket. The first draft's Q1 (the hide pair) and Q2 (ordering at arrival) are answered by the spike (see "Spike results").

- **Assumption, `observed` on Android only:** the arrival line is queued before the focus read. The worst case, the order inverting on some other device or TalkBack version, is caught by Level 4 (c) on this AVD only. iOS ordering is #257's (AC9).
- **Assumption:** the branch-head run reproduces the spike, because the diff is identical to Appendix A. If `git apply` needs manual resolution because `origin/main` moved, re-run task 7 before trusting the tests.

## NOTES

**Alternatives (asked 2026-09-28):**

| Option | Guarantee | Cost |
|---|---|---|
| Opening tick only (**chosen**) | Nothing stale is ever queued; `observed` at two rates | No «5 s left» speech; haptics remain |
| Predict queue drain | Only at the calibrated rate (≈100 ms/char, `derived`: 19 736 ms ÷ 194) | Timing model; same as chosen at today's name and window |
| Shorten the spoken name | Later ticks audible; the name would stop outliving the offer | Product change to #15's one-node card |

**Rejected without asking:**
- Flush at expiry by moving focus: the ticks are `UNINTERRUPTIBLE`, and the route home already failed to evict them.
- A JS expiry guard: every stale tick was issued before expiry.

**Why the reducer:** `decide` owns arrival, `tick` and expiry, and already emitted `announce`. #279's three cases become pure tests, and the card stays presentational.

## AMENDMENTS

- 2026-09-28: spike executed and all first-draft risks resolved by observation. Tasks now point at the validated diff (Appendix A). Task 7 predictions replaced by observed counts, plus the mutation-import gotcha. The slow-rate criterion changed from "≈39 s" (wrong: observed ratio 1.43, not 2.0) to "longer than the default run". Added the Level 4 setup deltas the spike found: debug APK, TalkBack notification prompt, clock offset, `grep -a` on the proxy log, unreliable WS pass-through. D2 observed.
- 2026-09-28 (implementation): the branch-head re-run's figures are in the runbook's «#279 re-run» block. They differ from this plan's spike figures: clock offset −0.93 s vs −0.58 s; name overrun 2.00 s / 18.63 s vs 1.8 s / 11.5 s, with a 232-character name at rate 50. For branch-head behaviour, cite the runbook, not the figures above.
- 2026-09-28 (implementation), superseding parts of tasks 4, 9 and Level 4:
  - Task 4's first grep was not empty. It hit `offer-card-props.test.ts:231` («throttled countdown announcements»), and a wider sweep also hit `docs/spikes/04-gps-field-test.md:82` (step 14 expected «every 5 s then each of the last 5»). Both files were reworded for AC5. They are outside Appendix A.
  - Level 4 pass rule (e): measured by the utterance-completed lines, not «name fragment → «Poga»». «Poga» was not spoken after the name on the branch head, and a `Speaking fragment` line can come before the item ahead of it has finished. The rate is proven on identical text: «Atlikušas 20 s» took 2.91 s vs 2.18 s.
  - Level 4 step 5: the loading-state explore-touch landed 2.98 s after the proxied request, not 0.1 s, because of `adb` spawn time. That is still inside the 8 s timeout.
  - Task 9 added three setup deltas beyond the four listed:
    - TalkBack's preferences file is under `/data/user_de/0/`;
    - the earnings card's y position shifts with the battery-optimisation banner;
    - fragment lines are not always speech time.

---

## Appendix A: the validated diff (spike, 2026-09-28, against `c08b927`)

```diff
diff --git a/apps/driver/src/features/offers/offer-card-props.ts b/apps/driver/src/features/offers/offer-card-props.ts
index 148805d..aff632e 100644
--- a/apps/driver/src/features/offers/offer-card-props.ts
+++ b/apps/driver/src/features/offers/offer-card-props.ts
@@ -123,8 +123,8 @@ export function offerCardProps(
     // No `seconds` in here (#263): a name that changes every tick fires a
     // content-changed event every tick, and TalkBack re-reads all seven
     // segments on each one — which saturated the speech queue and starved the
-    // throttled countdown announcements in `OfferCard`. Time left reaches the
-    // audio channel through those announcements only.
+    // per-tick countdown announcements `OfferCard` made then. Time left reaches
+    // the audio channel through one announcement at arrival (#279).
     a11yLabel: [
       t('driver.offer.a11y_card', { amount: fare, net }),
       payment,
diff --git a/apps/driver/src/features/offers/offer-card.test.tsx b/apps/driver/src/features/offers/offer-card.test.tsx
index 0c80357..8886200 100644
--- a/apps/driver/src/features/offers/offer-card.test.tsx
+++ b/apps/driver/src/features/offers/offer-card.test.tsx
@@ -1,5 +1,10 @@
 import { fireEvent, render, screen } from '@testing-library/react-native';
-import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
+import {
+  AccessibilityInfo,
+  StyleSheet,
+  type StyleProp,
+  type ViewStyle,
+} from 'react-native';
 import { formatMessage } from '@taxi/shared';
 import { OfferCard } from './offer-card';
 import type { OfferCardProps } from './offer-card-props';
@@ -111,8 +116,48 @@ describe('OfferCard (#15)', () => {
       disabled: true,
       busy: true,
     });
-    expect(screen.getByTestId('offer-countdown').props.children).toBe(
-      t('driver.offer.accepting'),
+    expect(
+      screen.getByTestId('offer-countdown', { includeHiddenElements: true })
+        .props.children,
+    ).toBe(t('driver.offer.accepting'));
+  });
+});
+
+describe('OfferCard says nothing about time (#279)', () => {
+  it('the visible countdown is out of the accessibility tree (#279, expected)', async () => {
+    await render(
+      <OfferCard card={card()} onAccept={jest.fn()} onDecline={jest.fn()} />,
+    );
+    const countdown = screen.getByTestId('offer-countdown', {
+      includeHiddenElements: true,
+    });
+    expect(countdown.props.importantForAccessibility).toBe(
+      'no-hide-descendants',
+    );
+    expect(countdown.props.accessibilityElementsHidden).toBe(true);
+    expect(screen.queryByTestId('offer-countdown')).toBeNull();
+  });
+
+  it('never announces as the seconds run down (#279, edge)', async () => {
+    const announce = jest
+      .spyOn(AccessibilityInfo, 'announceForAccessibility')
+      .mockImplementation(() => undefined);
+    const view = await render(
+      <OfferCard card={card()} onAccept={jest.fn()} onDecline={jest.fn()} />,
     );
+    for (const seconds of [15, 10, 5, 1]) {
+      await view.rerender(
+        <OfferCard
+          card={card({
+            seconds,
+            countdown: t('driver.offer.countdown', { seconds }),
+          })}
+          onAccept={jest.fn()}
+          onDecline={jest.fn()}
+        />,
+      );
+    }
+    expect(announce).not.toHaveBeenCalled();
+    announce.mockRestore();
   });
 });
diff --git a/apps/driver/src/features/offers/offer-card.tsx b/apps/driver/src/features/offers/offer-card.tsx
index 68e4056..586b20d 100644
--- a/apps/driver/src/features/offers/offer-card.tsx
+++ b/apps/driver/src/features/offers/offer-card.tsx
@@ -1,20 +1,12 @@
 import { colors, fontSize, radius, spacing } from '@taxi/shared';
-import { useEffect, useRef, useState } from 'react';
-import {
-  AccessibilityInfo,
-  Pressable,
-  StyleSheet,
-  Text,
-  View,
-} from 'react-native';
+import { useEffect, useState } from 'react';
+import { Pressable, StyleSheet, Text, View } from 'react-native';
 import { Button, Screen } from '@/components';
 import { useT } from '@/features/i18n';
 import type { OfferCardProps } from './offer-card-props';
 
 /** Half-period of the flash: 500 ms on / 500 ms off = 1 Hz, well under the 3 Hz photosensitivity line. */
 export const FLASH_HALF_PERIOD_MS = 500;
-/** A screen reader hears the countdown every 5 s, then every second for the last 5. */
-export const ANNOUNCE_EVERY_S = 5;
 
 /**
  * The full-screen offer card (#15; evidence §1.3, §5.3). The WHOLE card is the
@@ -38,7 +30,6 @@ export function OfferCard({
 }) {
   const t = useT();
   const [flashOn, setFlashOn] = useState(false);
-  const announced = useRef<number | null>(null);
 
   // No flash while an answer is in flight: derived at render (`lit`), so the
   // effect only ever owns the interval.
@@ -52,18 +43,6 @@ export function OfferCard({
     return () => clearInterval(timer);
   }, [card.accepting]);
 
-  // Not a live region on the visible number: 20 announcements per card is
-  // noise. Every 5 s, then each of the last 5, on both platforms.
-  useEffect(() => {
-    const s = card.seconds;
-    const due = s <= ANNOUNCE_EVERY_S || s % ANNOUNCE_EVERY_S === 0;
-    if (!due || announced.current === s || s <= 0) return;
-    announced.current = s;
-    AccessibilityInfo.announceForAccessibility(
-      t('driver.offer.countdown', { seconds: s }),
-    );
-  }, [card.seconds, t]);
-
   const fg = lit ? colors.accentFg : colors.fg;
   const muted = lit ? colors.accentFg : colors.fgMuted;
 
@@ -116,9 +95,14 @@ export function OfferCard({
             ) : null}
           </View>
         )}
+        {/* Out of the tree (#279): TalkBack speaks text changes under the
+            focused card, one per second, queued behind its name. Time left is
+            spoken once, at arrival, by the offer reducer. */}
         <Text
           style={[styles.countdown, { color: fg }]}
           testID="offer-countdown"
+          accessibilityElementsHidden
+          importantForAccessibility="no-hide-descendants"
         >
           {card.accepting ? t('driver.offer.accepting') : card.countdown}
         </Text>
diff --git a/apps/driver/src/features/offers/offer-state.test.ts b/apps/driver/src/features/offers/offer-state.test.ts
index d8201af..926754b 100644
--- a/apps/driver/src/features/offers/offer-state.test.ts
+++ b/apps/driver/src/features/offers/offer-state.test.ts
@@ -349,3 +349,35 @@ describe('decide — revocation and the rest', () => {
     expect(dismissed.effects).toEqual([]);
   });
 });
+
+describe('decide — what the countdown says (#279)', () => {
+  const announces = (effects: OfferEffect[]) =>
+    effects.filter((e) => e.type === 'announce');
+
+  it('announces the whole window once, at arrival (#279, expected)', () => {
+    expect(announces(received(pending({}, T0)).effects)).toEqual([
+      { type: 'announce', seconds: 20 },
+    ]);
+  });
+
+  it('rounds a part-second window up, as the card draws it (#279, edge)', () => {
+    expect(
+      announces(received(pending({ durationMs: 7_300 }, T0)).effects),
+    ).toEqual([{ type: 'announce', seconds: 8 }]);
+  });
+
+  it('no tick announces, whenever it falls (#279, edge)', () => {
+    let state = received(pending({}, T0)).state;
+    for (const at of [5_000, 10_000, 15_000, 19_000]) {
+      const next = decide(state, { type: 'tick', nowMs: T0 + at });
+      expect(next.effects).toEqual([]);
+      state = next.state;
+    }
+  });
+
+  it('expiry clears the card with no announcement (#279, failure)', () => {
+    const shown = received(pending({}, T0)).state;
+    const done = decide(shown, { type: 'tick', nowMs: T0 + 20_000 });
+    expect(types(done.effects)).toEqual(['alert_stop', 'route_home']);
+  });
+});
diff --git a/apps/driver/src/features/offers/offer-state.ts b/apps/driver/src/features/offers/offer-state.ts
index b10fac5..b883e89 100644
--- a/apps/driver/src/features/offers/offer-state.ts
+++ b/apps/driver/src/features/offers/offer-state.ts
@@ -1,6 +1,5 @@
 import type {
   DriverQueueEvent,
-  MessageKey,
   PaymentMethodType,
   RideOffer,
 } from '@taxi/shared';
@@ -103,7 +102,12 @@ export type OfferEffect =
   | { type: 'route_home' }
   | { type: 'alert_start' }
   | { type: 'alert_stop' }
-  | { type: 'announce'; key: MessageKey };
+  /**
+   * Time left, spoken ONCE, at arrival (#279). TalkBack queues every
+   * announcement as uninterruptible behind the ~20 s card read, so any later
+   * tick was spoken after the offer had expired (#276 D1).
+   */
+  | { type: 'announce'; seconds: number };
 
 export interface OfferDecision {
   state: OfferState;
@@ -208,7 +212,10 @@ export function decide(state: OfferState, event: OfferEvent): OfferDecision {
         effects: [
           { type: 'alert_start' },
           { type: 'route_offer' },
-          { type: 'announce', key: 'driver.offer.title' },
+          {
+            type: 'announce',
+            seconds: Math.ceil(incoming.durationMs / 1000),
+          },
         ],
       };
     }
diff --git a/apps/driver/src/features/offers/use-offers.test.tsx b/apps/driver/src/features/offers/use-offers.test.tsx
index a21c517..6e6e596 100644
--- a/apps/driver/src/features/offers/use-offers.test.tsx
+++ b/apps/driver/src/features/offers/use-offers.test.tsx
@@ -6,7 +6,7 @@ import {
   waitFor,
 } from '@testing-library/react-native';
 import { useEffect } from 'react';
-import { Text } from 'react-native';
+import { AccessibilityInfo, Text } from 'react-native';
 import { formatMessage, splitFare, type RideOfferEvent } from '@taxi/shared';
 import { ApiError } from '@/features/auth';
 import type { RuntimeListener } from '@/features/location';
@@ -272,3 +272,65 @@ describe('OffersProvider (#15)', () => {
     warn.mockRestore();
   });
 });
+
+/**
+ * #279: TalkBack queues every announcement as uninterruptible behind the
+ * ~20 s card read (#276 D1), so any countdown line after the first was
+ * spoken after the offer had expired. One line, at arrival, is all it gets.
+ */
+describe('what TalkBack is told about time (#279)', () => {
+  const COUNTDOWN_20 = t('driver.offer.countdown', { seconds: 20 });
+
+  beforeEach(() => {
+    jest.clearAllMocks();
+    mockListeners.length = 0;
+    ctx = null;
+    jest.useFakeTimers({
+      doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'],
+    });
+  });
+  afterEach(() => {
+    jest.useRealTimers();
+  });
+
+  async function arrive() {
+    const announce = jest
+      .spyOn(AccessibilityInfo, 'announceForAccessibility')
+      .mockImplementation(() => undefined);
+    const handlers = await mountWithSocket();
+    // `wire()` reads `Date.now()`: built after the clock is faked.
+    await act(async () => handlers['ride:offer']!(wire()));
+    return announce;
+  }
+
+  it('time left is announced once, on arrival (#279, expected)', async () => {
+    const announce = await arrive();
+    expect(screen.getByTestId('phase')).toHaveTextContent('pending');
+    expect(announce.mock.calls).toEqual([[COUNTDOWN_20]]);
+    announce.mockRestore();
+  });
+
+  it('no tick is announced while the card is still being read (#279, edge)', async () => {
+    const announce = await arrive();
+    // Crosses the old 15, 10 and 5 s announcements.
+    await act(async () => {
+      jest.advanceTimersByTime(15_000);
+    });
+    expect(screen.getByTestId('phase')).toHaveTextContent('pending');
+    expect(announce.mock.calls).toEqual([[COUNTDOWN_20]]);
+    announce.mockRestore();
+  });
+
+  it('an offer that expires mid-read leaves no countdown line behind (#279, failure)', async () => {
+    const announce = await arrive();
+    await act(async () => {
+      jest.advanceTimersByTime(21_000);
+    });
+    expect(screen.getByTestId('phase')).toHaveTextContent('idle');
+    expect(screen.getByTestId('offer-banner-kind')).toHaveTextContent(
+      'expired',
+    );
+    expect(announce.mock.calls).toEqual([[COUNTDOWN_20]]);
+    announce.mockRestore();
+  });
+});
diff --git a/apps/driver/src/features/offers/use-offers.tsx b/apps/driver/src/features/offers/use-offers.tsx
index 9e728e5..a5fbe7e 100644
--- a/apps/driver/src/features/offers/use-offers.tsx
+++ b/apps/driver/src/features/offers/use-offers.tsx
@@ -151,7 +151,9 @@ export function OffersProvider({ children }: { children: ReactNode }) {
         alertsRef.current.stop();
         return;
       case 'announce':
-        AccessibilityInfo.announceForAccessibility(tRef.current(effect.key));
+        AccessibilityInfo.announceForAccessibility(
+          tRef.current('driver.offer.countdown', { seconds: effect.seconds }),
+        );
         return;
     }
   };
```

## Appendix B: `d2-proxy.mjs` (spike, `observed` working for both D2 states)

```js
// node d2-proxy.mjs <listenPort> <apiPort>; mode from ./d2-mode (pass | hang | fail)
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';

const [listen, api] = process.argv.slice(2).map(Number);
const mode = () => {
  try {
    return fs.readFileSync(new URL('./d2-mode', import.meta.url), 'utf8').trim();
  } catch {
    return 'pass';
  }
};
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/drivers/me/earnings/today')) {
    const m = mode();
    console.log(new Date().toISOString(), 'earnings', m);
    if (m === 'hang') return; // held open: the app shows its spinner until its 8 s client timeout
    if (m === 'fail') {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end('{"code":"unavailable"}');
    }
  }
  const up = http.request(
    { host: '127.0.0.1', port: api, path: req.url, method: req.method, headers: req.headers },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    },
  );
  up.on('error', () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(up);
});
server.on('upgrade', (req, sock, head) => {
  const up = net.connect(api, '127.0.0.1', () => {
    up.write(
      `${req.method} ${req.url} HTTP/1.1\r\n` +
        Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
        '\r\n\r\n',
    );
    up.write(head);
    sock.pipe(up);
    up.pipe(sock);
  });
  up.on('error', () => sock.destroy());
  sock.on('error', () => up.destroy());
});
server.listen(listen, '0.0.0.0');
```
