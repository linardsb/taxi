# Implementation Report — Spike #4, iOS field run (build + drive + verdict)

**Plan**: `.claude/plans/spike-gps-field-test-ios-run.md`   **Branch**: `feature/spike-gps-ios-run` (worktree `../taxi-gps-ios`, from `origin/main` `302ee37`)   **Status**: PARTIAL — Phase 0 executed; Phases 1–2 not executed and Phase 3 run in deferral form, decided by Linards on 2026-08-26.

## Summary

Phase 0 proved the plan's R1 risk real: SDK 57 does not compile on this Mac's Xcode 26.3 (two distinct `expo-modules-jsi` compile errors on 26.3; per the package changelog one is a source bug 57.0.5 fixes, the other a construct 57.0.5 added for Xcode 27 — neither is observed to need 26.4), and the Task 0.5 fallback (SDK 55 in the out-of-repo copy) builds and launches a Release build on the iOS 26.2 simulator. Before Phase 1, Linards ruled out both device routes — no paid Apple Developer Program before the app exists (so no link install), and no cable install — and chose to defer the field test. The close-out therefore records a **deferral, not a verdict**: the spike doc's status line says so, #14 is unblocked on the plan's Q1 mounted-phone default for both platforms, #4 stays open, and the owed Android/iOS legs are written into #4 and #14.

## Tasks completed

- 0.0 rsync the harness to `~/gps-harness-ios/` (outside the repo) → validated: file list identical, no `.git`
- 0.1 `pnpm install --ignore-workspace` + `expo install --check` tripwire → `same-generation-only` (patch drift inside `~57.0.x`)
- 0.2 Release simulator build, SDK 57 → **failed twice** (see Issues); R1 confirmed
- 0.5 SDK 55 downgrade of the copy (`npx expo install expo@~55.0.0 --fix`, clean reinstall) → `--check` "Dependencies are up to date", `tsc --noEmit` exit 0; then 0.2 again → `› Build Succeeded`, `GPSSpike.app` with embedded `main.jsbundle` (1,753,194 bytes), harness screen on the iPhone 17 Pro (iOS 26.2) simulator (screenshot observed 22:29, 2026-08-25)
- 3.0 worktree `../taxi-gps-ios` on `feature/spike-gps-ios-run` from `origin/main`; plan files copied in
- 3.1 `docs/spikes/04-gps-field-test.md` → UPDATE: iOS build findings + simulator pre-flight under "Build & run"; iOS specifics replace protocol step 4; `ios-forcequit.jsonl` / `ios-plugged.jsonl` in the naming list
- 3.2 (deferral form) same doc → UPDATE: three "Field results" subsections read "Not run" with the reason and the owed leg
- 3.3 (deferral form) status line → "deferred, #14 proceeds on the mounted-phone default"; AMENDMENTS appended to `.claude/plans/spike-gps-field-test-close-out.md` and `.claude/plans/spike-gps-field-test-ios-run.md`
- 3.5 (deferral form) `gh issue comment 4` (`issuecomment-5422896664`) and `gh issue comment 14` (`issuecomment-5422896854`); #4 left OPEN on purpose

## Tasks not done

- 0.3 / 0.4 simulator route + analyzer on its export — the "Go online" tap needs macOS accessibility (`osascript`: "not allowed assistive access"); Linards chose not to spend the tap. The doc labels the simulator result "plumbing launched, route not run".
- 1.1–1.4, 2.1–2.4 (device build, permissions, drive) — dropped by decision.
- 3.4 commit, 3.6 gate + PR — left for `piv-commit` / `piv-create-pr` from the worktree.

## Tests added

None (docs + data plan; none specified). `node spikes/gps-harness/analyze.mjs --selftest` → "selftest OK — 5 scenarios" (observed).

## Validation results

- Level 1: `node --check analyze.mjs` ok; `npx tsc --noEmit` in the copy exit 0 (SDK 57 and again after the SDK 55 downgrade) — observed.
- Level 2: analyzer selftest 5/5 — observed.
- Level 3: simulator Release build **green on SDK 55** (`› Build Succeeded` in the build log at 22:17:18 BST, 2026-08-25, and `main.jsbundle` in DerivedData stamped 22:17 — the script's `EXIT=` sentinel never fires on success, see Issues; harness-screen screenshot 22:29); the analyzer run on a simulator export did not happen (no route). The full monorepo gate was **not run**: the diff is docs + plan files only, the worktree has no local env file, and a concurrent session holds the main checkout (shared-test-DB collision risk). `piv-create-pr`'s `record-gate.sh` will require it before the PR.
- Doc checks (plan 3.1/3.3 VALIDATE): `ios-forcequit.jsonl` ×2, `EXPO_USE_PRECOMPILED_MODULES` present, status line starts `**Status: deferred`, no "Pending field drive" left — observed.
- Repo hygiene: `git status --short -- spikes/gps-harness` empty in the worktree; `~/gps-harness-ios/` never entered the repo.

## Deviations from the plan

1. **Task 0.2 retry with a dependency override before Task 0.5.** The first failure (`abs()` ambiguity, `expo-modules-jsi@57.0.4`) was not one of R1's three trigger strings, and `57.0.5` — the latest patch, same SDK — changes exactly that line. I overrode the transitive dep in the copy (`pnpm.overrides`) and rebuilt. It then failed on a *second* construct that 57.0.5 introduced for Xcode 27 (`SWIFT_RETURNS_RETAINED` on a constructor; changelog expo/expo#49120). Net cost one extra build (duration not recorded); the override was removed before Task 0.5. No podspec or Swift flag was patched.
2. **Task 0.5 ran without `rm -rf`** (the PreToolUse hook blocks it): `ios/`, `.expo/`, `node_modules/`, `pnpm-lock.yaml` were moved into the scratchpad instead. One extra build was started on a stale SDK 57 `ios/` by mistake and killed within a minute.
3. **Phases 1–2 not executed; Phase 3 run in deferral form** at Linards's decision (2026-08-26): "continue without testing and trust it works", no Apple Developer Program purchase before the app exists. Recorded as *deferred*, not PASS — a verdict no run produced would breach the evidence rule. #4 stays open (the plan closed it); #14 unblocked via the plan's Q1 default applied to both platforms.
4. **Plan-claim corrections** (also in the plan's AMENDMENTS): the SDK 57 Podfile defaults `RCT_USE_PREBUILT_RNCORE` and `EXPO_USE_PRECOMPILED_MODULES` to 1 — the plan's R1 text assumed source builds by default; the exported `EXPO_USE_PRECOMPILED_MODULES=0` is what forced Expo modules from source. Build products land in DerivedData, not `ios/build` (the plan's 0.2 VALIDATE path). SDK 55's `expo install --fix` adds `expo-sharing` to the copy's `app.json` plugins. SDK 55 lowers the iOS floor to 15.1 (`ExpoModulesCore.podspec:82`).
5. **Task 3.4's staged set** now includes this report and no JSONL (none exists).

## Issues encountered

- `expo run:ios` never exits after a successful build (it tails Metro), so the `EXIT=` sentinel in the build script only fires on failure; the success was found by reading the log (`› Build Succeeded` at 22:17:18) after nine minutes of an unchanged heartbeat. Next time: `--no-bundler`, or watch for `Build Succeeded` as a terminal line.
- `osascript` has no assistive access from this terminal, so the agent cannot tap the Simulator; any future simulator route needs one human tap or an Accessibility grant to the terminal app.
- The SDK 55 copy in `~/gps-harness-ios/` and the build in `~/Library/Developer/Xcode/DerivedData/GPSSpike-*` are left in place for reuse; attempts 1–2 (`ios-attempt1/2`, `node_modules-57`, `pnpm-lock-57.yaml`) sit in the session scratchpad and can be discarded.

## Review round 1 (2026-08-31, `.claude/code-reviews/pr-138-review.md`)

Fixed on the branch: F1 (traceability row + architecture spike entry now record the deferral), F2 (HTML brief carries a "Superseded 2026-08-26" banner), F5 (the "needs Xcode 26.4" cause retired everywhere — doc, this report, plan AMENDMENTS, PR body, #4 comment — for the changelog-backed reading: a source bug 57.0.5 fixes and an Xcode 27 construct), F6 (spike doc :60 and :3 carry the superset rule and whose call it is), F7 (Level 3 above now cites the log line and bundle mtime, not `EXIT=0`), F8–F17 as one-line edits, F3 (#14 body). Won't-fix: F4 (dated research note). Proof: 26 grep assertions, one per finding, all failing at `32ce0e2` and all passing after (observed; script in the session scratchpad, greps listed in the PR body).
