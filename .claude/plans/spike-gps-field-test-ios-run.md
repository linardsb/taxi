# Feature: Spike #4 — iOS field run on Linards's iPhone (build + drive + verdict)

The following plan should be complete, but validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files etc.

## Feature Description

Issue #4 (background-GPS spike gating driver-app ticket #14) has its harness, analyzer and protocol on main; the field drive never happened because the decisive run was Android on Atis's phone and Atis cannot run it. **Linards runs the drive on their own iPhone instead.** That changes three things: the app must be built and installed on an iPhone from this Mac with a free Apple ID (no APK, no paid Apple programme), the protocol gets iOS-specific steps (Always + Precise, the one-shot Always prompt, the force-quit check), and the verdict must be scoped honestly: iOS measured, Android not.

Everything else — `spikes/gps-harness/App.tsx`, `analyze.mjs`, the PASS/FAIL table, the close-out steps — is inherited from `.claude/plans/spike-gps-field-test-close-out.md` (its Tasks 1–4 shipped in `62c6ef0`; this plan replaces its Phases 2–3 with the iOS path).

## User Story

As the solo builder (Linards)
I want to run the #4 field test on my own iPhone, from my own Mac, at zero cost
So that #14's location slice is designed on a measured verdict instead of staying blocked on a phone I can't get hold of.

## Problem Statement

- iOS can't sideload an APK-style kit; the only free install path is a local Xcode build signed with a personal team (7-day profile, Developer Mode, trust prompt).
- This Mac is an **iMac19,1 on macOS 15.7.3 with Xcode 26.3** (observed: `sysctl hw.model`, `sw_vers`, `xcodebuild -version`). Expo SDK 57's reference page says Xcode 26.4+, and 26.4 needs macOS Tahoe, which the iMac 2019 cannot run. The installed tooling only links Expo's prebuilt frameworks when `EXPO_USE_PRECOMPILED_MODULES=1` (observed: `enabled?` in the harness's `expo-modules-autolinking@57.0.9/scripts/ios/precompiled_modules.rb:114`), and ExpoModulesJSI builds its own xcframework locally (`apple/ExpoModulesJSI.podspec:60-66`) — so the default path compiles from source and *should* work on 26.3. Nobody has observed that yet: it must be proven on the simulator before the phone is involved.
- The Always prompt on iOS is one-shot: pick "Keep Only While Using" once and the run is dead until Settings is fixed by hand.
- An iOS-only PASS does not answer the ticket's Android/Doze question; the write-up must not pretend it does.
- The build is driven by an agent whose shell hangs on interactive prompts, keeps `cd` state between calls, and is policed by two hooks (a PreToolUse text filter and a Stop-time `pnpm check`). The Android kit already learned to build from a copy outside the repo (PR #115); iOS does the same.

## Solution Statement

Four phases, two of them human. **Phase 0** copies the harness out of the repo (as the Android recipe does), then proves the toolchain and the iOS background-task plumbing on the simulator with a scripted Rīga route (no phone). **Phase 1** builds a Release binary onto the iPhone with a personal team, and pre-flights permissions. **Phase 2** is the drive: one decisive 30–45 min run (`ios.jsonl`) and one short force-quit check (`ios-forcequit.jsonl`). **Phase 3** opens a worktree, runs the analyzer, fills the doc, flips the status line to a Verdict scoped to iOS with the Android default stated, closes #4 and links #14.

The repo's harness folder is never built in place: the copy absorbs `ios/`, `.expo/`, the CLI-written `ios.appleTeamId`, and (if needed) the SDK 55 downgrade. The repo diff is docs + two JSONL files (three if the plugged-in run of R13 happens).

## Out of Scope / Non-Goals

- Not changing `App.tsx`, `analyze.mjs`, `app.json` deps or the PASS/FAIL table in the repo. `expo install --check` shows patch-level drift only, all inside `~57.0.x` (observed 2026-08-25) — not the cross-generation mix that crashed the Android build; leave it.
- Not running the Android leg. The APK kit at gps-spike.linardsberzins.workers.dev stays live for a later Atis run; the Android result subsections get an explicit "not run" line, not a deletion.
- Not touching `spikes/gps-harness/site/` (the LV Android kit page already says the file doesn't work on iPhone).
- Not building via EAS: iOS ad-hoc/internal distribution needs a paid Apple Developer Program membership ([docs](https://docs.expo.dev/build/internal-distribution/)); see Q2.
- Not upgrading macOS or Xcode; not downgrading the committed harness to SDK 55 (the fallback, if needed, happens in the out-of-repo copy — Phase 0 decides).
- Not changing the PASS/FAIL thresholds, even where Q6 shows they bind awkwardly on iOS.
- Not building any of #14.

## Feature Metadata

**Feature Type**: Spike close-out (docs + data + a human field run; zero production code)
**Estimated Complexity**: Medium — the agent work is small (doc edits, two committed JSONL files, issue comments); the risk sits in the first-ever local iOS build on this Mac and in the human steps around signing and permissions.
**Primary Systems Affected**: `~/gps-harness-ios/` (throwaway copy, all build outputs), `docs/spikes/04-gps-field-test.md`, `spikes/gps-harness/data/`, `.claude/plans/spike-gps-field-test-close-out.md` (amendment), GitHub #4/#14
**Dependencies**: Xcode 26.3 + iOS 26.2 SDK, CocoaPods 1.16.2 (system Ruby 2.6.10 satisfies it), Node 20.20.2 (≥ RN 0.86's 20.19.4 floor), a free Apple ID, Linards's iPhone on **iOS ≥ 16.4** (Q3), a USB cable. No new packages.

**Platform support of the harness build** (observed in the installed SDK 57 tooling, 2026-08-25):

| Platform | Minimum OS | Where it is set | Status in this plan |
|---|---|---|---|
| iOS | **16.4** (iPhone 8 / X and newer can run it) | `expo-modules-core@57.0.10/ExpoModulesCore.podspec:54` `:ios => '16.4'`; RN 0.86 alone would allow 15.1 (`helpers.rb:83`) but Expo's floor wins | Built and run here. A phone below 16.4 cannot install the build — Task 1.1 checks Settings → About first. If Task 0.5 downgrades to SDK 55, re-read the podspec in the copy and record the new floor in the doc. |
| Android | **7.0 (API 24)** | `expo-modules-core` gradle plugin default `minSdkVersion 24`; the live APK (EAS build `0dfb88c3`, SDK 57) carries it | **Not run in this plan.** The APK kit stays live and unchanged; the Android leg is deferred to an early #14 task on Atis's phone (Q1). |

## RISKS & MITIGATIONS

Codes are stable; tasks cite them. Likelihood is a judgement, not a measurement. R1–R8 are the risks of the job; R9–R14 are the ones the mitigations and the agent-driven setup add.

| # | Risk | Likelihood / cost if it bites | Mitigation built into the plan | Trigger → fallback |
|---|---|---|---|---|
| **R1** | **Toolchain:** SDK 57 documents Xcode 26.4+; this iMac19,1 tops out at 26.3 (Tahoe unsupported). Prebuilt Expo frameworks are compiled with 26.4.1 and their `.swiftinterface` files won't parse on 26.3. | Medium / one wasted 15–30 min build. Zero drive time lost — it fires before the phone is touched. | Task 0.2 forces source builds (`EXPO_USE_PRECOMPILED_MODULES=0`; RN core also builds from source because `RCT_USE_PREBUILT_RNCORE` is unset — observed in `rncore.rb:79`) and runs **first**. Task 0.5 is an executable SDK 55 downgrade of the copy, so the implementer never stalls on a decision. | pod install / xcodebuild fails on `.swiftinterface`, "compiled with a newer version of the Swift compiler", or `SWIFT_VERSION` → **Task 0.5**. If 0.5 also fails → stop, report; the remaining door is a paid Apple membership + EAS (Q2). |
| **R2** | **Signing:** Xcode has no Apple ID and the keychain has zero code-signing identities (observed). `expo run:ios --device` hard-fails without an identity; personal-team profiles expire after 7 days. | High that the first attempt fails / 5 min to fix, 20 min if discovered only after the device build starts. | Task 1.1 (human) adds the Apple ID; **Task 1.1b verifies an `Apple Development` identity exists before the long device build** and hands the `xed` team-pick to Linards if not. Phase 1 and Phase 2 are scheduled ≤7 days apart, same day preferred; the doc records the build date. | `security find-identity` shows 0 identities after 1.1 → `xed ~/gps-harness-ios/ios` → Signing & Capabilities → Personal Team (human click) → re-check. Build older than 7 days on drive day → re-run Task 1.2 only. |
| **R3** | **One-shot Always prompt:** iOS asks "Change to Always Allow?" exactly once. "Keep Only While Using" or "Allow Once" silently produces a run with zero background fixes. | Medium / a wasted 45 min drive if undetected. | Task 1.3 scripts the two taps and checks Settings afterwards; Task 1.4's kill-and-relaunch and Task 2.1's **blue-pill check before locking** catch a wrong grant before the car moves. Recovery: fix it in Settings (iOS allows the upgrade there), or delete the app and re-run Task 1.2 — deleting resets the permission state. | Settings reads "While Using" → change it there, or delete + reinstall. No blue pill after backgrounding → do not drive; back to Task 1.3. **Delete only before any drive data exists (R14).** |
| R4 | iOS 16.4+ suspends distance-filtered background updates unless the indicator is on (Apple DTS). | Low — config already correct. | `showsBackgroundLocationIndicator: true` is in `App.tsx:83`; the copy is an untouched rsync of the repo harness. | — |
| R5 | Low Power Mode / Background App Refresh off throttle or stop background location (no authoritative modern rule). | Low / silent gaps. | Task 1.3 step 4 turns both to the known-good state before the drive. | Analyzer shows gaps and LPM was on → rerun, not a verdict. |
| R6 | Export path: the share sheet may not offer a sensible target for `.jsonl`. | Low / 5 min. | Task 2.1 names AirDrop or Save to Files first and a deterministic cable fallback (`devicectl … copy from`). | — |
| R7 | Simulator may not deliver location to a backgrounded app. | Medium / none — the real check is on-device. | Task 0.3 GOTCHA: note it, proceed; Task 1.4 repeats the check on the phone. | — |
| R8 | Fresh-install task never fires until restart (expo/expo#35362, SDK 52, unverified on 57). | Low / a dead first drive. | Task 1.4 kills and relaunches once before Clear. | — |
| **R9** | **Interactive prompts hang the agent:** `expo run:ios --device` without an argument opens a device picker; Expo CLI asks other questions on a TTY. The agent's Bash tool cannot answer. | High if unmitigated / a stuck build, invisible until the timeout. | Every Expo command runs with `CI=1` (Expo CLI's non-interactive switch) and an explicit `--device <name-or-udid>`; the iPhone's UDID comes from `xcrun xctrace list devices` (Task 1.1 VALIDATE). Human-only GUI steps (`xed`, Xcode Accounts) are labelled ⛔ HUMAN and never run by the agent. | A command sits silent >2 min with no compiler output → kill it, re-run with `CI=1` and the `--device` value spelled out. |
| **R10** | **Hooks and cwd drift:** the Bash tool keeps `cd` state across calls; the Stop hook then runs `pnpm check` from the wrong directory and blocks with `Command "check" not found` (observed this session). The PreToolUse hook blocks any command *text* naming the local env file (observed this session, twice). | High / a false red at every stop, a blocked write. | Every command that must run elsewhere is a subshell — `( cd ~/gps-harness-ios && … )` — so the tool's cwd stays at the repo root. Env-file copying for the worktree is done with the Read/Write tools, never Bash. `gh` bodies go through `--body-file` from the scratchpad. | Stop hook red with "Command not found" → `cd /Users/Berzins/Desktop/taxi` and re-run `pnpm check`; that is environment, not the change. |
| **R11** | **Metro/pod resolution into the monorepo:** built in place, the harness sits under a pnpm workspace root; Expo's Metro config adds the workspace root to `watchFolders`/`nodeModulesPaths`, and `require.resolve('@expo/cli')` from the harness already walks up to the root `node_modules` (observed). Two copies of `expo`/`react` in scope is the class of bug PR #115 chased on Android. | Medium / a build that works on the sim but ships a mixed bundle, or a confusing failure. | **Build from `~/gps-harness-ios/`, an rsync copy outside any repo** (Task 0.0) — the established Android recipe. Nothing in `spikes/gps-harness/` is built in place; `ios/`, `.expo/`, `ios.appleTeamId` and the SDK 55 downgrade all land in the copy. | — |
| **R12** | **Task 0.5's downgrade is itself untested:** `expo install expo@~55 --fix` moves `react`, `react-native` (0.83 line), `typescript` and every `expo-*`; `App.tsx` imports `expo-file-system/legacy`, which exists from SDK 54. | Low–medium / 10 min. | Task 0.5 runs `expo install --check` and `tsc --noEmit` in the copy before rebuilding, and re-validates Task 0.2 from the copy. The doc records which SDK built (Task 3.1). | `--fix` leaves a package on the wrong major → pin it by hand in the copy's `package.json` and re-run `pnpm install --ignore-workspace`; `tsc` fails on a removed API → stop, report (the harness is 200 lines; a fix is a human call). |
| **R13** | **Battery-only verdicts:** Apple advises `BestForNavigation` only while plugged in; the protocol runs unplugged because battery is gated. A run with clean gaps can come back INCONCLUSIVE (8–12 %/hr) or FAIL (>12 %/hr) on battery alone. | Medium on iPhone / a verdict stall or a wrong FAIL. | Q6 pre-agrees the reading: gaps PASS + battery in (8, 12] → recommend PASS with a battery note (both #14 designs assume a charger); gaps PASS + battery >12 %/hr → **not** a FAIL call — a 15 min plugged-in confirmation run (Task 2.4, conditional) shows whether continuity holds with the battery variable removed, and Linards decides. The thresholds themselves are not edited. | Analyzer FAIL/INCONCLUSIVE reasons name only `battery` → Task 2.4; anything gap-related → the table stands. |
| **R14** | **Recovery wipes evidence:** the R3 "delete the app" recovery also deletes `fixes.jsonl`; the Task 1.4 Clear and the between-run Clear do too. | Low / a lost drive. | Order of operations: every Export precedes every Clear/Go offline/delete; Task 2.1's export is confirmed on the Mac (`wc -l`) before the phone is touched again. Delete-to-reset is only allowed in Phase 1. | Export missing after a Clear → the file is gone; the run repeats. Say so in the report, do not reconstruct. |

## Related Work

**Implements**: [#4 — Spike: Expo background GPS field test](https://github.com/linardsb/taxi/issues/4) · **Epic**: #1, `docs/epics/sakta-cab.architecture.md` § "Spikes & experiments" item 2 (decision rule inherited: reliable → #14 as designed; lossy → free mounted-phone pattern, per the 2026-08-04 ruling in #4's comments)

**Back-references**:

- `.claude/plans/spike-gps-field-test-close-out.md` — the parent plan; its Tasks 1–4 are done, its Phase 2 (drive) and Phase 3 (verdict) are executed here in iOS form. Its Open Question 2 ("if only Linards's phone is available") is now the actual situation.
- #4 comment 2026-08-14 (PR #115) — the Android rebuild recipe: copy the harness outside the repo, build there. This plan's Task 0.0 is the same move for iOS, and its `expo install --check` tripwire is re-run in Task 0.1.

**Forward-references**:

- The future #14 plan consumes the verdict. If Q1 lands as assumed, #14 also inherits "run the Android leg on Atis's phone early" as a task.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `docs/spikes/04-gps-field-test.md` (all 78 lines) — Why: the deliverable target. Lines 5–12 research verdict (already states force-quit stops tracking); 14–35 harness + build + analysis; 37–55 protocol + PASS/FAIL table; 57–78 the empty "Field results" scaffold with `### iOS` at line 76.
- `spikes/gps-harness/App.tsx` (lines 68–91) — Why: `goOnline()` requests foreground then background permission (so iOS shows two prompts back to back), then `startLocationUpdatesAsync` with `distanceInterval: 10`, `pausesUpdatesAutomatically: false`, `showsBackgroundLocationIndicator: true`. Lines 97–110: on launch it reloads `fixes.jsonl` and reads `hasStartedLocationUpdatesAsync` to restore the button state — that is how the force-quit check is judged. Lines 127–137: export = `Sharing.shareAsync` (`mimeType` is ignored on iOS; the share sheet gets the raw `.jsonl`); **Clear deletes the file** (R14).
- `spikes/gps-harness/app.json` — Why: iOS side is already complete (`UIBackgroundModes: ["location"]`, both `NSLocation*` strings, the `expo-location` plugin with `isIosBackgroundLocationEnabled`). Observed via `npx expo config --type prebuild`. The copy's `app.json` will gain `ios.appleTeamId`; the repo's never does.
- `spikes/gps-harness/analyze.mjs` (lines 105–125 battery gating; 147–176 `verdictOf`) — Why: a force-quit run produces a >120 s moving gap and will print **FAIL**; that file is judged on resumption, not on the table. Battery is only gated when it fell monotonically (`status: 'gated'`); its reasons are the strings that decide R13/Q6.
- `spikes/gps-harness/.gitignore` — Why: `ios/`, `.expo/`, `node_modules/` are ignored — the rsync in Task 0.0 excludes them anyway.
- `docs/spikes/03-arrivals-data.md` (lines 1–4) — Why: the sibling `**Verdict: … → #N …**` line to mirror.
- `.claude/plans/spike-gps-field-test-close-out.md` (Tasks 6–9, Open Questions 1–4) — Why: the close-out mechanics this plan reuses verbatim; append an AMENDMENTS line there.

### New Files to Create

- `~/gps-harness-ios/` — throwaway rsync copy of the harness (outside the repo, never committed; R11)
- `spikes/gps-harness/data/ios.jsonl` — the decisive run's export (committed evidence)
- `spikes/gps-harness/data/ios-forcequit.jsonl` — the force-quit check's export (committed evidence)
- `spikes/gps-harness/data/ios-plugged.jsonl` — only if Task 2.4 ran (R13)
- `.claude/plans/spike-gps-field-test-ios-run.md` (this file) + `.html` build brief

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Expo CLI — `run:ios` flags](https://docs.expo.dev/more/expo-cli/#compiling) — `--device`, `--configuration Release`, `--no-bundler`. Release bundles the JS eagerly (`runIosAsync.ts`: `if (options.configuration === 'Release') exportEagerAsync`), so the phone runs disconnected from the Mac. `CI=1` makes the CLI non-interactive (R9).
- [expo/fyi — setup-xcode-signing](https://github.com/expo/fyi/blob/main/setup-xcode-signing.md) — Why: with zero identities the CLI throws "No code signing certificates are available"; the remedy is `xed ios` → Signing & Capabilities → Automatically manage signing → pick the Personal Team (Xcode creates the cert). Once per Mac.
- [Expo — iOS Developer Mode](https://docs.expo.dev/guides/ios-developer-mode/) and [Apple — Enabling Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device) — Why: required on iOS 16+; the Settings entry appears only after the phone has been connected to Xcode once.
- [Apple — Xcode Personal Team limits](https://developer.apple.com/support/compare-memberships/) — 7-day profiles, 3 devices, 10 App IDs/week. Build ≤7 days before the drive.
- [Apple — `requestAlwaysAuthorization`](https://developer.apple.com/documentation/corelocation/cllocationmanager/requestalwaysauthorization()) — Why: after While-Using is granted, the Always request prompts *immediately* ("Keep Only While Using" / "Change to Always Allow") and can be made once. The harness's two back-to-back requests produce exactly this.
- [expo-location SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/location/#background-location) — "Background location will stop if the user terminates the app. Background location resumes if the user restarts the app." `timeInterval` is Android-only; on iOS `distanceInterval` is the filter.
- [Apple DTS — iOS 16.4+ background suspension](https://developer.apple.com/forums/thread/726945) — Why: with a distance filter set, the app keeps its background entitlement only if `showsBackgroundLocationIndicator` is true (it is) — leave that option alone.
- [Apple — `kCLLocationAccuracyBestForNavigation`](https://developer.apple.com/documentation/corelocation/kcllocationaccuracybestfornavigation) — needs Precise Location on; Apple advises it "only while plugged in". The protocol runs unplugged on purpose (battery is a gated metric); R13/Q6 say what to do when that is the only thing that fails.
- [Expo — prebuilt Expo modules](https://docs.expo.dev/guides/prebuilt-expo-modules/) — the opt-out switch `EXPO_USE_PRECOMPILED_MODULES=0` / `expo-build-properties` `ios.usePrecompiledModules: false`. In the installed 57.0.9 autolinking the switch is opt-**in** (`enabled?` requires `=1`), so the default build is already from source; the env var is belt-and-braces.
- [Expo SDK 55 changelog](https://expo.dev/changelog/sdk-55) — minimum Xcode 26.0; the R1 fallback target.
- `xcrun simctl help location` / `xcrun simctl help privacy` (observed on this Mac): `location <udid> start [--speed=<m/s>] [--interval=<s>] lat,lon lat,lon…` and `privacy <udid> grant location-always <bundleId>` both exist.

### Patterns to Follow

**Sibling verdict line** (`docs/spikes/03-arrivals-data.md:3`):

```markdown
**Verdict: <one-line call> → #14 <consequence>.** <one-sentence nuance>. Issue [#4](https://github.com/linardsb/taxi/issues/4), gates #14.
```

**Provenance on every figure** (CLAUDE.md hard rule): every number pasted into "Field results" is `observed` and names its run (`ios.jsonl`, phone model, iOS version, date); a figure the analyzer did not print is not written.

**Build from a copy, never in place** (PR #115 recipe, memory): `rsync` the harness to `~/gps-harness-ios/` minus `node_modules`, `ios`, `.expo`, `site`, `data`; install with `pnpm install --ignore-workspace` there; every build command is a subshell `( cd ~/gps-harness-ios && CI=1 … )` (R9, R10, R11).

**Throwaway register** (`App.tsx:1–2`): the harness is exempt from the monorepo rules; no i18n/theme work. Nothing in it changes in this plan anyway.

**Commit style** (`git log -- spikes/gps-harness`): `docs(spikes): …` / `chore(spikes): …` with `(#4)`; branch `feature/<kebab>` from fresh `origin/main` (`.claude/references/conventions.md:26`).

**Concurrent-session rule** (CLAUDE.md): the main checkout currently carries the Hetzner loop's uncommitted work (observed `git status`, 2026-08-25). The worktree is created only when there is something to commit (Task 3.0), from `origin/main` at that moment; anything DB-touching in it runs with `COMPOSE_PROJECT_NAME=taxi`; the local env file is copied in with Read/Write, not Bash (R10; memory: a worktree without it hangs a `REDIS_TEST_URL` gate).

---

## IMPLEMENTATION PLAN

### Phase 0: Copy out, then toolchain + iOS plumbing pre-flight on the simulator (agent, no phone)

**Independent of:** the phone, the Apple ID. Blocks Phase 1.

Proves on this Mac that (a) SDK 57 compiles from source on Xcode 26.3 in Release, (b) `expo-task-manager` delivers fixes to the JS task while the app is backgrounded on iOS, (c) the JSONL lands where the export reads it, (d) `analyze.mjs` accepts iOS-shaped data. If (a) fails on the R1 trigger strings, Task 0.5 downgrades the copy to SDK 55 and repeats; only both failing stops the plan.

### Phase 1: Device build + permission pre-flight (agent + HUMAN steps)

**Depends on:** Phase 0 green (Task 0.2 or its 0.5 fallback). Must run ≤7 days before Phase 2 (R2) — **same day as the drive if at all possible**; write the build date into the doc's iOS results line.

The Apple ID goes into Xcode by hand (Linards); the agent checks the identity exists (R2) before spending 20 min on the device build; the CLI does the rest, non-interactively (R9). Ends with the app on the phone, Always + Precise confirmed in Settings (R3), one kill-and-relaunch survived (R8), log cleared.

### Phase 2: Field drive (HUMAN GATE — Linards)

**Depends on:** Phase 1. Blocks Phase 3. Two exports (three if R13 fires) must land in `~/gps-harness-ios/data/` and be confirmed on the Mac before any Clear (R14).

### Phase 3: Worktree, analysis, verdict, close-out (agent)

**Depends on:** Phase 2 files exist. Opens the worktree now (fresh base), copies the data in, reuses close-out plan Tasks 6–9 with the iOS-scoped verdict (Q1).

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable. Every command that needs another directory is a subshell; the Bash tool's cwd stays `/Users/Berzins/Desktop/taxi` throughout (R10).

### 0.0 COPY the harness out of the repo (R11)

- **IMPLEMENT**: `rsync -a --delete --exclude node_modules --exclude ios --exclude .expo --exclude site --exclude data spikes/gps-harness/ ~/gps-harness-ios/ && mkdir -p ~/gps-harness-ios/data`
- **PATTERN**: the PR #115 Android recipe (memory `taxi-gps-spike-kit`): "do not build from inside the repo".
- **GOTCHA**: `--delete` makes re-running this task a clean resync; it also means the copy is disposable — nothing hand-edited there survives a re-run except `data/` and `ios/` (excluded, so untouched).
- **VALIDATE**: `diff <(cd spikes/gps-harness && ls App.tsx app.json package.json pnpm-lock.yaml analyze.mjs index.ts tsconfig.json) <(cd ~/gps-harness-ios && ls App.tsx app.json package.json pnpm-lock.yaml analyze.mjs index.ts tsconfig.json)` prints nothing; `test ! -e ~/gps-harness-ios/.git`
- **SATISFIES**: AC1, AC6

### 0.1 INSTALL deps in the copy + tripwire

- **IMPLEMENT**: `( cd ~/gps-harness-ios && pnpm install --ignore-workspace && CI=1 npx expo install --check )`
- **GOTCHA**: `--check` will list `~57.0.x` patch bumps; that is drift *within* SDK 57 and is not the PR #115 crash class. Do **not** run `--fix` here (it would make the copy diverge from what the Android APK was built from). Any package still on a non-57 major is a stop.
- **VALIDATE**: `( cd ~/gps-harness-ios && CI=1 npx expo install --check 2>&1 | grep -vE '~57\.0\.' | grep -q '@[0-9]' && echo CROSS-GEN-MIX || echo same-generation-only )`
- **SATISFIES**: AC1

### 0.2 BUILD Release for the simulator (R1, R9)

- **IMPLEMENT**: `SIM=$(xcrun simctl list devices available | grep -A12 "iOS 26.2" | grep -m1 -oE '[0-9A-F-]{36}')` then `( cd ~/gps-harness-ios && CI=1 EXPO_USE_PRECOMPILED_MODULES=0 npx expo run:ios --configuration Release --device "$SIM" )`. First run: prebuild → pod install → xcodebuild from source. Expected 15–30 min on this i9-9900K (expected, not observed). Run it in the background with a 40 min timeout and monitor the log, not a foreground wait.
- **GOTCHA** (R1): if pod install or xcodebuild dies on `.swiftinterface`, "compiled with a newer version of the Swift compiler", or a `SWIFT_VERSION` complaint, that is the Xcode 26.3-vs-26.4 gap materialising. Do **not** patch podspecs or pin Swift flags — go straight to **Task 0.5** and continue from there. Any *other* build error (pod repo, missing simulator runtime, Node) is environment, fix in place.
- **GOTCHA** (R9): no `--device` value → the CLI opens a picker and the agent hangs. `$SIM` must be non-empty before the build starts; fall back to the iOS 18.0 sim UDID `2C0258F6-7331-4701-A408-626582144288` (observed) if no 26.2 device is listed.
- **VALIDATE**: `ls ~/gps-harness-ios/ios/build/Build/Products/Release-iphonesimulator/*.app` exists and the simulator shows the "GPS spike harness" screen
- **SATISFIES**: AC1

### 0.3 RUN the scripted Rīga route with the app backgrounded (R7)

- **IMPLEMENT** (all against the booted sim; `B=booted`):
  1. `xcrun simctl privacy $B grant location-always lv.saktacab.gpsspike`
  2. In the sim, tap **Go online** (grant any residual prompt with Always).
  3. `xcrun simctl location $B start --speed=14 --interval=1 56.9515,24.1132 56.9468,24.1210 56.9440,24.1150 56.9470,24.1050 56.9410,24.0950 56.9545,24.0960 56.9515,24.1132` — ~14 m/s (≈50 km/h) loop Brīvības piemineklis → station → Centrāltirgus → Akmens tilts → Pārdaugava → Vanšu tilts → back.
  4. Background the harness: `xcrun simctl launch $B com.apple.Preferences` (Settings comes to the front; the harness is now backgrounded). Wait ≥120 s (a Monitor/until-loop, not a foreground sleep).
  5. Foreground it again: `xcrun simctl launch $B lv.saktacab.gpsspike`. The fix counter must have grown during the backgrounded window and no row should be red.
  6. `xcrun simctl location $B clear`
- **GOTCHA**: background delivery in the simulator is not documented by Apple; the Freeway-Drive forum evidence says it works. If the count did not grow while backgrounded but grows in the foreground, note it as a simulator limitation and proceed — Task 1.4 repeats the check on the real phone.
- **VALIDATE**: `D=$(xcrun simctl get_app_container booted lv.saktacab.gpsspike data) && wc -l "$D/Documents/fixes.jsonl"` ≥ 100 lines
- **SATISFIES**: AC1

### 0.4 RUN the analyzer on the simulator export

- **IMPLEMENT**: `D=$(xcrun simctl get_app_container booted lv.saktacab.gpsspike data) && node spikes/gps-harness/analyze.mjs "$D/Documents/fixes.jsonl"` — expect a PASS (1 s cadence) or an INCONCLUSIVE naming only stationary/battery reasons (sim battery is fake). Do **not** commit this file and do not paste it into the doc — it is a plumbing check, not evidence.
- **VALIDATE**: exit code 0 and a `**Verdict:` line printed
- **SATISFIES**: AC1

### 0.5 CONDITIONAL (R1 fallback) — downgrade the copy to SDK 55 (R12)

Runs **only** if Task 0.2 failed on the R1 trigger strings. Skip otherwise and say so in the report.

- **IMPLEMENT**: `( cd ~/gps-harness-ios && rm -rf ios .expo pnpm-lock.yaml node_modules && CI=1 npx expo install expo@~55.0.0 --fix && pnpm install --ignore-workspace && CI=1 npx expo install --check && npx tsc --noEmit )` — then re-run Tasks 0.2–0.4 from the copy (SDK 55's minimum is Xcode 26.0). `expo-file-system/legacy` exists from SDK 54, so `App.tsx` needs no edit. From here on the copy is SDK 55; Task 3.1 records that and the recipe in the doc.
- **GOTCHA** (R12): if `--check` still lists a package on the wrong major after `--fix`, pin it by hand in the copy's `package.json` to the SDK 55 line and re-run `pnpm install --ignore-workspace`. If `tsc` fails on a removed API, stop and report — a source edit to the harness is a human call, not a fallback.
- **GOTCHA**: the copy is outside any git repo on purpose; the committed harness stays SDK 57 so the Android APK and the iOS build don't fork in the repo.
- **VALIDATE**: `( cd ~/gps-harness-ios && CI=1 npx expo install --check )` prints no outdated packages, `npx tsc --noEmit` exits 0, and Task 0.2's VALIDATE passes from the copy
- **SATISFIES**: AC1 (via fallback — the doc must say which SDK built)

### 1.1 ⛔ HUMAN — Apple ID into Xcode, Developer Mode on the phone (R2)

- **IMPLEMENT** (Linards): first Settings → General → About → **iOS Version must be 16.4 or newer** (SDK 57's deployment target; an older phone cannot install the build — stop and say so, Q3). Then Xcode → Settings → Accounts → **+** → Apple ID (free; it becomes "<Name> (Personal Team)"). Plug the iPhone in, tap **Trust** on the phone, then Settings → Privacy & Security → **Developer Mode** → on → restart → confirm. Leave the phone plugged in and unlocked.
- **GOTCHA**: the Developer Mode entry only appears after the phone has been seen by Xcode once — open Xcode → Window → Devices and Simulators if it's missing.
- **VALIDATE** (agent): `xcrun xctrace list devices 2>/dev/null | grep -i iphone | grep -v Simulator` shows the phone with its UDID in parentheses — **record that UDID as `$PHONE` for Task 1.2** (R9)
- **SATISFIES**: AC2

### 1.1b CHECK a signing identity exists before the long build (R2; agent check, HUMAN fix)

- **IMPLEMENT**: `security find-identity -v -p codesigning | grep -c "Apple Development"`. Adding an Apple ID in Xcode's Accounts pane does **not** by itself mint a certificate; the first automatic-signing pick does. If the count is 0: `( cd ~/gps-harness-ios && test -d ios || CI=1 npx expo prebuild -p ios --no-install )`, then **⛔ HUMAN**: `xed ~/gps-harness-ios/ios` → target `GPSSpike` → Signing & Capabilities → tick *Automatically manage signing* → Team = *<Name> (Personal Team)*. Xcode creates the Apple Development certificate on the spot. Quit Xcode; the agent re-runs the check.
- **GOTCHA**: this is a 2-minute step that otherwise surfaces as a hard `CommandError` 15 minutes into Task 1.2. Do it every time Phase 1 runs, not only the first.
- **VALIDATE**: `security find-identity -v -p codesigning | grep -q "Apple Development"` exits 0
- **SATISFIES**: AC2

### 1.2 BUILD Release onto the device (R2, R9)

- **IMPLEMENT**: `( cd ~/gps-harness-ios && CI=1 EXPO_USE_PRECOMPILED_MODULES=0 npx expo run:ios --device "$PHONE" --configuration Release --no-bundler )` with `$PHONE` the UDID from Task 1.1. Expected 15–25 min (device arch compiles separately from the sim build; expected). Background + monitor, as in 0.2.
- **GOTCHA 1** (R2): "No code signing certificates are available" means Task 1.1b was skipped — do it now, re-run. Once per Mac.
- **GOTCHA 2**: the CLI writes `ios.appleTeamId` into the **copy's** `app.json` — expected, stays there, never reaches the repo (R11).
- **GOTCHA 3**: on the phone, first launch may say "Untrusted Developer": Settings → General → VPN & Device Management → the Apple ID → **Trust**.
- **GOTCHA 4** (R2): note the build date. The profile dies 7 days later; if the drive slips past that, only this task repeats.
- **VALIDATE**: `git status --short -- spikes/gps-harness` is empty (repo untouched) and the app launches on the phone with the Mac's Metro **not** running (unplug the cable and relaunch — still opens)
- **SATISFIES**: AC2, AC6

### 1.3 ⛔ HUMAN — permission pre-flight on the phone (R3, R4, R5)

- **IMPLEMENT** (Linards, app open, phone still at the desk):
  1. Tap **Go online**. Prompt 1 → **Allow While Using App** (not "Allow Once"). Prompt 2 appears immediately → **Change to Always Allow**.
  2. Rows with coordinates start appearing (indoors may be slow/inaccurate — any row counts).
  3. Settings → Privacy & Security → Location Services → **GPS Spike**: must read **Always** and **Precise Location: On**. If it reads "While Using", fix it here — the app cannot ask again.
  4. Settings → Battery → **Low Power Mode off**. Settings → General → Background App Refresh → **On** (global toggle) (R5).
  5. Press Home with the app online: a **blue location pill / arrow** appears in the status bar (that is `showsBackgroundLocationIndicator` — R4; on a Dynamic Island phone it sits beside the island). No pill = no background updates; go back to step 3.
- **GOTCHA** (R3): "Allow Once" or "Keep Only While Using" is not recoverable from inside the app (one-shot prompt). Two recoveries, both fine *at this stage*: change it under Settings → Location Services → GPS Spike (iOS allows the upgrade there), or **delete the app and re-run Task 1.2** — deleting resets the permission state and the two prompts come back. Deleting also wipes `fixes.jsonl` (R14) — harmless now, forbidden after Phase 2 starts.
- **VALIDATE**: a screenshot of the GPS Spike location-settings page showing Always + Precise, kept locally (not committed); the blue pill seen in step 5
- **SATISFIES**: AC2

### 1.4 ⛔ HUMAN — kill-and-relaunch once, then Clear (R8)

- **IMPLEMENT**: with the button showing **Go offline** (i.e. online), swipe the app away, reopen it. The button must still read **Go offline** (task restored from persisted state via `hasStartedLocationUpdatesAsync`) and rows keep coming. Then tap **Clear**. Leave it online.
- **GOTCHA**: this sidesteps the fresh-install "task registered but never fires until restart" report (expo/expo#35362, SDK 52, fix status unverified) — cheap insurance.
- **VALIDATE**: fix counter reads `0 fixes` after Clear and the button is red
- **SATISFIES**: AC2

### 2.1 ⛔ HUMAN GATE — decisive run → `ios.jsonl` (R3, R6, R14)

- **IMPLEMENT** (Linards): charge to ≥60 %, note the %. **Unplug**. App in foreground → confirm one fresh row → press Home → **blue pill visible** (if not, stop and redo Task 1.3) → lock the screen, phone in pocket or mount. Drive 30–45 min through central Rīga (Vecrīga, a bridge, an open boulevard). Do not open the phone. Back: open the app → **Export** → AirDrop to the Mac (or Save to Files → iCloud) → move it to `~/gps-harness-ios/data/ios.jsonl` → **confirm on the Mac** (`wc -l`) **before touching the phone again** (R14). Note the battery %. Only then **Go offline**, **Clear**.
- **GOTCHA** (R6): if the share sheet won't hand over the `.jsonl`, the cable fallback is deterministic: `xcrun devicectl device copy from --device "$PHONE" --domain-type appDataContainer --domain-identifier lv.saktacab.gpsspike --source Documents/fixes.jsonl --destination ~/gps-harness-ios/data/ios.jsonl`.
- **GOTCHA** (R2): if today is more than 7 days after the Task 1.2 build, the app won't launch ("Unable to Verify App") — re-run Task 1.2 first; nothing else in Phase 1 repeats.
- **VALIDATE**: `wc -l ~/gps-harness-ios/data/ios.jsonl` ≥ 300 (30 min × ≥1 fix / 6 s while moving is the floor; expected)
- **SATISFIES**: AC3

### 2.2 ⛔ HUMAN GATE — force-quit check → `ios-forcequit.jsonl`

- **IMPLEMENT** (Linards): **Go online** (app open), lock, drive ~5 min. Pull over: swipe the app away (force-quit). Drive 2–3 min more. Pull over: reopen the app — the button will read **Go online** (iOS stopped tracking; expected) — tap it, lock, drive ~5 min. Back: **Export** → `~/gps-harness-ios/data/ios-forcequit.jsonl` → confirm on the Mac → **Go offline**, **Clear**.
- **GOTCHA**: this file will print **FAIL** in the analyzer (a >120 s moving gap). That is expected and is *not* the ticket's FAIL — it's judged on one boolean: **fixes resumed after relaunch + Go online**.
- **VALIDATE**: file present; `node spikes/gps-harness/analyze.mjs ~/gps-harness-ios/data/ios-forcequit.jsonl` shows fixes both before and after the gap
- **SATISFIES**: AC4

### 2.3 ⛔ HUMAN — record the phone

- **IMPLEMENT**: Settings → General → About → **Model Name** and **iOS Version**; hand both to the agent together with the start/end battery % and the Task 1.2 build date.
- **SATISFIES**: AC3

### 2.4 CONDITIONAL ⛔ HUMAN — plugged-in confirmation run → `ios-plugged.jsonl` (R13)

Runs **only** if the agent's first pass over `ios.jsonl` (Task 3.2) reports a FAIL or INCONCLUSIVE whose *only* reasons name `battery`. The agent asks for it; do not pre-empt it.

- **IMPLEMENT** (Linards): phone on the car charger, otherwise Task 2.1 verbatim, 15 min. Export → `~/gps-harness-ios/data/ios-plugged.jsonl` → confirm → Go offline, Clear.
- **GOTCHA**: this run's battery figure is meaningless (charging → analyzer reports `charging`, ungated); its purpose is to show the gap distribution with the battery variable removed. The verdict call stays with Linards (Q6).
- **VALIDATE**: `node spikes/gps-harness/analyze.mjs ~/gps-harness-ios/data/ios-plugged.jsonl` prints `charging` for battery and a gap-only verdict
- **SATISFIES**: AC3 (nuance line), AC5

### 3.0 CREATE worktree + branch, bring the data in (R10)

- **IMPLEMENT**: `git fetch origin && git worktree add ../taxi-gps-ios -b feature/spike-gps-ios-run origin/main && cp ~/gps-harness-ios/data/ios*.jsonl ../taxi-gps-ios/spikes/gps-harness/data/`. Copy the local env file from the main checkout into the worktree **with the Read/Write tools** (the Bash hook blocks its name in command text).
- **GOTCHA**: never branch from the main checkout's current branch (`feature/deploy-hetzner-environment`, another loop, dirty). `git reflog -8` first. All later git/gh commands use `git -C ../taxi-gps-ios …` — no `cd`.
- **VALIDATE**: `git -C ../taxi-gps-ios status --short` lists only the new `data/ios*.jsonl` files as untracked; `git -C ../taxi-gps-ios log --oneline -1` equals `origin/main`
- **SATISFIES**: AC6

### 3.1 UPDATE `docs/spikes/04-gps-field-test.md` — build, protocol, data naming

- **IMPLEMENT**, surgical additions in the doc's voice (edit the worktree's copy):
  - Under "### Build & run": an **iOS device (Linards's iPhone)** paragraph: rsync the harness to `~/gps-harness-ios/` first (same reason as the Android EAS recipe), the Task 1.2 command with `CI=1` and `--device <udid>`, the one-time signing step (`xed` → Personal Team) and the `security find-identity` check, Developer Mode + trust, 7-day profile expiry, `EXPO_USE_PRECOMPILED_MODULES=0` with a one-line why (Xcode 26.3 vs SDK 57's prebuilt frameworks). **Which SDK built** — 57 from source, or the Task 0.5 SDK 55 downgrade (with its recipe) — stated as observed, with the build date.
  - Under "### Build & run": a **Simulator pre-flight** paragraph with the Task 0.3 commands (waypoints included) — the repeatable plumbing check for the next person.
  - Under "## Field protocol": replace step 4 ("iOS extra: force-quit …") with an **iOS specifics** list: the two prompts and what to pick; Settings check (Always + Precise); Low Power Mode off, Background App Refresh on; blue pill before locking; export-before-Clear; the force-quit run is its own export judged on resumption, not on the gap table; phone unplugged despite Apple's BestForNavigation advice, because battery is gated — and the plugged-in confirmation run when battery is the only failing metric.
  - Under "### Analyzing a run": add `ios-forcequit.jsonl` "(resumption check — analyzer FAIL expected, not gated)" and `ios-plugged.jsonl` "(only when battery was the sole failing metric)" to the naming list.
- **PATTERN**: existing headings and tone; no rewrite of Android content.
- **VALIDATE**: `grep -c "ios-forcequit.jsonl" ../taxi-gps-ios/docs/spikes/04-gps-field-test.md` ≥ 2 and `grep -q "EXPO_USE_PRECOMPILED_MODULES" ../taxi-gps-ios/docs/spikes/04-gps-field-test.md`
- **SATISFIES**: AC5, deliverable "field protocol per platform"

### 3.2 UPDATE `docs/spikes/04-gps-field-test.md` — fill Field results (R13)

- **IMPLEMENT**: `node spikes/gps-harness/analyze.mjs ../taxi-gps-ios/spikes/gps-harness/data/ios.jsonl` → paste the markdown block under `### iOS`, prefixed with one line: `Observed <date>, <Model Name>, iOS <version>, build <date> (SDK <57|55>), <start %→end %> battery, unplugged, screen locked, <N> min central Rīga.` Add `### iOS — force-quit check` with: the pre-gap fix count, the gap length, the post-relaunch fix count, and the boolean `Resumed after relaunch + Go online: yes/no`. Under both Android subsections replace `_Pending field drive._` with `_Not run — Atis unavailable (2026-08-25). The APK kit stays live; run it when a pilot Android phone is in hand (#14 task)._`
- **GOTCHA** (R13/Q6): if the verdict's reasons name **only** battery → request Task 2.4, then add `### iOS — plugged-in confirmation` with its block and hand Linards the call. Any INCONCLUSIVE → present the numbers and ask (close-out plan Task 6 GOTCHA) — do not decide unilaterally. Every figure in the doc must appear verbatim in the analyzer output.
- **VALIDATE**: `node spikes/gps-harness/analyze.mjs ../taxi-gps-ios/spikes/gps-harness/data/ios.jsonl | grep '^\*\*Verdict:'` matches the verdict word written under `### iOS`
- **SATISFIES**: AC3, AC4, deliverable "measured gap distribution"

### 3.3 UPDATE status line → Verdict; amend parent plan

- **IMPLEMENT**:
  - Line 3 of the doc → sibling format, scoped (Q1 assumption): PASS → `**Verdict: background streaming holds on iOS (Linards's iPhone) → #14's iOS location slice proceeds as designed with the harness's exact startLocationUpdatesAsync options; Android is unmeasured (Atis unavailable) → #14 designs Android to the free mounted-phone pattern until an Android drive passes.** Force-quit stops tracking until relaunch, as documented — #14's dark-detection + nudge is the recovery. Issue [#4](…), gates #14.` FAIL → the mounted-phone verdict for both platforms, iOS measured, Android by default. Battery-only outcomes read per Q6 with Linards's call named as such.
  - Append to `.claude/plans/spike-gps-field-test-close-out.md` § AMENDMENTS: `- 2026-08-25 — Phases 2–3 executed via .claude/plans/spike-gps-field-test-ios-run.md: Linards ran the drive on iOS; Android leg not run (Atis unavailable).`
- **PATTERN**: `docs/spikes/03-arrivals-data.md:3`
- **VALIDATE**: `head -3 ../taxi-gps-ios/docs/spikes/04-gps-field-test.md | grep -q '^\*\*Verdict:'`
- **SATISFIES**: AC5

### 3.4 COMMIT data + docs

- **IMPLEMENT**: `git -C ../taxi-gps-ios add spikes/gps-harness/data/ios*.jsonl docs/spikes/04-gps-field-test.md .claude/plans/spike-gps-field-test-close-out.md .claude/plans/spike-gps-field-test-ios-run.md .claude/plans/spike-gps-field-test-ios-run.html` → piv-commit: `docs(spikes): record the #4 iOS field run and its verdict (#4)`.
- **GOTCHA**: the JSONL files ≈ 100–200 KB total (expected) — evidence, committed on purpose (close-out plan Notes). `app.json`, `App.tsx`, `package.json`, `pnpm-lock.yaml` must not appear — they were never touched in the repo (R11).
- **VALIDATE**: `git -C ../taxi-gps-ios diff origin/main --stat` lists only those paths
- **SATISFIES**: AC6

### 3.5 GitHub close-out (R10)

- **IMPLEMENT**: write both bodies to the scratchpad, then `gh issue comment 4 --body-file <file>` with the verdict line, the doc link, the iOS numbers (median/p95/max, battery %/hr) and the explicit "Android not run" sentence; `gh issue close 4`. Then `gh issue comment 14 --body-file <file>`: verdict + consequence for the location slice + "Android leg still owed: run the APK kit on Atis's phone early in #14".
- **GOTCHA**: bodies only via `--body-file` (the PreToolUse hook filters command text). Keep `Closes`/`Fixes` keywords away from `#14`.
- **VALIDATE**: `gh issue view 4 --json state -q .state` → `CLOSED`; `gh issue view 14 --json comments -q '.comments[-1].body' | grep -q 'Spike #4'`
- **SATISFIES**: AC5

### 3.6 Gate + PR (R10)

- **IMPLEMENT**: `( cd ../taxi-gps-ios && COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force )` (docs-only diff; the gate proves `spikes/` stayed invisible to the workspace), then piv-create-pr from the worktree with `Closes #4` in plain prose (a backticked `Closes #4` does not close — memory). Confirm `taxi-redis-1` is Up before the gate (memory: dead Redis + `REDIS_TEST_URL` = silent hang).
- **VALIDATE**: gate exit 0; PR URL returned; PR body Validation section names the gate run
- **SATISFIES**: AC7

---

## TESTING STRATEGY

### Unit Tests

None new — `analyze.mjs --selftest` (5 scenarios, shipped) is the unit story and is re-run in Level 2.

### Integration Tests

Phase 0 is the integration test of the iOS build + task plumbing with synthetic movement; Phase 2 is the real one. Both feed the same analyzer.

### Edge Cases

- Simulator delivers nothing while backgrounded → note as sim limitation, rely on Task 1.4/2.1 (real device) (R7).
- Share sheet refuses the `.jsonl` → `devicectl … copy from` fallback (R6).
- Battery rose mid-run (phone touched a charger) → analyzer reports `mixed`, battery not gated; say so in the doc.
- Verdict INCONCLUSIVE on gaps (max in (60, 120] s) → human call, recorded as such.
- Verdict FAIL/INCONCLUSIVE on battery only → Task 2.4, then Q6 (R13).
- Force-quit file prints FAIL → expected; judged on resumption.
- Xcode 26.3 refuses the source build on the R1 trigger strings → Task 0.5 runs automatically; both failing → stop, report (Q2 is the only door left).
- `expo install --fix` leaves a wrong major behind in Task 0.5 → pin by hand; `tsc` fails → stop (R12).
- Wrong tap on the Always prompt → Settings fix, or delete + re-run Task 1.2 — Phase 1 only (R3, R14).
- Drive day is >7 days after the build → re-run Task 1.2 only (R2).
- CLI sits silent with no compiler output → picker/prompt; kill, add `CI=1` + `--device <udid>` (R9).
- Stop hook red with `Command "check" not found` → cwd drift, not the change; re-run from the repo root (R10).

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
node --check spikes/gps-harness/analyze.mjs
( cd ~/gps-harness-ios && npx tsc --noEmit )
```

### Level 2: Unit Tests

```bash
node spikes/gps-harness/analyze.mjs --selftest
```

### Level 3: Integration Tests

```bash
# Phase 0
D=$(xcrun simctl get_app_container booted lv.saktacab.gpsspike data) && node spikes/gps-harness/analyze.mjs "$D/Documents/fixes.jsonl"
# Phase 3
node spikes/gps-harness/analyze.mjs ../taxi-gps-ios/spikes/gps-harness/data/ios*.jsonl
( cd ../taxi-gps-ios && COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force )
```

### Level 4: Manual Validation

Tasks 1.3, 1.4, 2.1–2.4 as written; plus: eyeball one >15 s gap the analyzer reports against the raw lines around it before trusting the verdict (close-out plan Level 4).

---

## ACCEPTANCE CRITERIA

- [ ] **AC1** Phase 0: Release build compiles on Xcode 26.3 from source (or the Task 0.5 SDK 55 downgrade builds, and the doc says so); ≥100 fixes captured on the simulator route, some while backgrounded (or the sim limitation is noted); analyzer runs on the file.
- [ ] **AC2** Release build installs on Linards's iPhone under a free Personal Team; runs with the Mac disconnected; Settings shows Always + Precise; blue pill seen; survives one kill-and-relaunch still online.
- [ ] **AC3** `data/ios.jsonl` committed from a ≥30 min screen-locked drive; analyzer block pasted under `### iOS` with date, model, iOS version, build date + SDK, battery start→end, all figures `observed`; `ios-plugged.jsonl` and its block present iff Task 2.4 ran.
- [ ] **AC4** `data/ios-forcequit.jsonl` committed; resumption boolean recorded.
- [ ] **AC5** Status line is a sibling-format Verdict scoped to iOS with the Android default stated (battery-only outcomes per Q6, with Linards's call named); #4 closed with the verdict comment; #14 carries the link, consequence and the owed Android leg.
- [ ] **AC6** `git diff origin/main --stat` touches only `docs/spikes/04-gps-field-test.md`, `spikes/gps-harness/data/ios*.jsonl`, the two plan files; `app.json`, `App.tsx`, `package.json`, `pnpm-lock.yaml` unchanged; `~/gps-harness-ios/` never enters the repo.
- [ ] **AC7** Full gate green from the worktree; PR open against `main` with `Closes #4`.

## COMPLETION CHECKLIST

- [ ] Tasks 0.0–0.4 done, each VALIDATE passed immediately; Task 0.5 run or explicitly skipped with the reason
- [ ] Task 1.1b passed before Task 1.2 started; every Expo command carried `CI=1` and a `--device` value
- [ ] Human steps 1.1, 1.3, 1.4, 2.1–2.3 (2.4 if asked) honoured — no fabricated results; Phase 3 only runs on real exports
- [ ] Every Export confirmed on the Mac before the matching Clear
- [ ] Tasks 3.0–3.6 done
- [ ] Validation levels 1–4 executed
- [ ] PR handed off for review

---

## OPEN QUESTIONS / ASSUMPTIONS

1. **Q1 — What does an iOS-only result decide?** *Assumption:* close #4 on the iOS verdict; #14's iOS half follows it; Android defaults to the free mounted-phone pattern (`expo-keep-awake` while online, battery-exemption prompt, server-side gap tolerance) until an Android drive passes, and the Android leg becomes an early #14 task on Atis's phone. Alternative: leave #4 open until Android runs — that keeps Wave 5 blocked on a phone nobody has. Say if you want the alternative.
2. **Q2 — Is there a paid Apple Developer Program membership?** Xcode has no accounts today (observed `DVTDeveloperAccountManagerAppleIDLists` empty). If one exists, EAS iOS internal distribution becomes possible (cloud Xcode 26.4, no local toolchain risk) at the cost of the ~20 min queue and UDID registration. *Assumption:* no membership → free Personal Team path.
3. **Q3 — iPhone model and iOS version?** Unknown; checked in Task 1.1, recorded in Task 2.3. *Requirement, not assumption:* iOS ≥ 16.4 — SDK 57's deployment target (observed `ExpoModulesCore.podspec:54`); Developer Mode and the DTS keep-alive rule both exist from 16.x. Any iPhone 8 / X or newer on a current iOS qualifies. Below 16.4 the plan stops before the build.
4. **Q4 — Ledger drift (not fixed here):** `docs/ux-metrics-ledger.md:29` states #4's pass criteria as "moving gaps p95 ≤ 30 s, max ≤ 120 s"; the spike table says p95 ≤ 15 s / p99 ≤ 30 s / none > 60 s, FAIL > 120 s. The ledger quotes the INCONCLUSIVE ceiling as the pass bar. The spike table (and `analyze.mjs`) is the source of truth; the ledger row wants a one-line fix in its own commit.
5. **Q5 — Phase 0 outcome is genuinely unknown.** Building SDK 57 from source on Xcode 26.3 has not been observed by anyone I could find. It is the first thing the plan does, with an executable fallback (Task 0.5), so the cost of being wrong is one wasted build, not a wasted drive. See R1, R12.
6. **Q6 — Battery-only outcomes on iOS.** *Assumption:* gaps PASS + battery in (8, 12] %/hr → PASS with a battery note (both #14 designs put the phone on a charger); gaps PASS + battery >12 %/hr → not called FAIL on that alone; Task 2.4's plugged-in run is added as the nuance line and Linards makes the call, named as a human call in the doc. The table's thresholds are not edited by this plan. Say if you'd rather the table bind literally.

## NOTES (open canvas)

**Why local `expo run:ios --device` and not EAS** — free Apple ID rules out ad-hoc distribution; the Mac, Xcode and the phone are all in one room; Release embeds the bundle so the phone is standalone. Rejected: EAS (Q2), macOS upgrade (iMac19,1 cannot run Tahoe — observed `hw.model`), SDK 55 downgrade of the committed harness (would fork the Android and iOS harnesses).

**Why a copy outside the repo (R11), even though it costs one rsync** — it is the recipe that already works for Android; it removes the `ios.appleTeamId` revert, the `git status` noise in a checkout another session is using, the Metro/pnpm workspace-root question, and half of R10 (no `cd` into the repo's harness). The copy's `data/` is the drop zone until Phase 3 opens the worktree, so the worktree is created from the freshest `origin/main` rather than sitting idle for days.

**O3 fallback if Phase 0 fails on Swift-interface errors** — now Task 0.5, executable without a decision: the copy is downgraded to SDK 55 in place (SDK 55 minimum Xcode is 26.0). Only fires if `EXPO_USE_PRECOMPILED_MODULES=0` didn't already avoid the problem — which, given the installed autolinking treats prebuilt as opt-in, it should. Rejected as *primary*: it forks the harness for no gain if the source build works.

**Why no harness code change** — `showsBackgroundLocationIndicator: true` already satisfies Apple's iOS 16.4+ keep-alive condition for distance-filtered updates; `distanceInterval: 10` keeps the stationary-gap semantics the analyzer was built for; `expo-dev-client` pods are Debug-only (`expo-module.config.json` `debugOnly: true`), so Release is a plain app. `fontFamily: 'monospace'` is not an iOS font and falls back silently in Release — cosmetic, ignored.

**Unplugged vs Apple's "BestForNavigation only while plugged in"** — deliberate: battery %/hr is a gated metric in the protocol, and a driver's phone on a charger is the mounted-phone pattern's own assumption, so the unplugged number is the conservative one. R13/Q6 exist because that conservatism can produce a battery-only failure that says nothing about continuity, which is what #14 actually needs to know.

**Why `CI=1` everywhere** — Expo CLI treats it as "no prompts"; combined with an explicit `--device`, every build command is deterministic for an agent that cannot type into a picker. It costs nothing on a human-run shell.

**Simulator route** — waypoints are approximate central-Rīga coordinates; the point is speed (14 m/s) and cadence (1 s), not geography.

**Time budget (expected, not observed)** — Phase 0: 20–40 min (first from-source build) + 5 min route; Phase 1: 20–30 min build + 10 min human; Phase 2: 60–75 min driving (+15 if Task 2.4); Phase 3: 30 min. About half a day, most of it compile time that runs unattended.

## AMENDMENTS

<!-- append-only after first approval; newest at the bottom -->
- 2026-08-26 — Executed Phase 0 only. Task 0.2 failed twice on SDK 57 (R1 in a form the trigger strings did not name: `expo-modules-jsi@57.0.4` Swift `abs()` ambiguity at `JavaScriptCodable+Date.swift:53`; `57.0.5` `SWIFT_RETURNS_RETAINED` on a constructor at `RuntimeScheduler.h:61` — both need Xcode 26.4's compiler). Task 0.5 SDK 55 fallback built and launched on the iOS 26.2 simulator (Release, bundle embedded). Task 0.3 not run: the Simulator tap needs macOS accessibility the agent lacks. Phases 1–3 dropped by decision: no paid Apple account before the app exists (so no link install), cable install declined. Close-out replaced by a deferral: status line → deferred, #4 open, #14 unblocked on the Q1 default. Plan-claim corrections: the SDK 57 Podfile defaults `RCT_USE_PREBUILT_RNCORE` and `EXPO_USE_PRECOMPILED_MODULES` to 1 (R1 assumed source builds by default); build products land in DerivedData, not `ios/build`; `expo install expo@~55 --fix` also adds `expo-sharing` to the copy's `app.json` plugins.
