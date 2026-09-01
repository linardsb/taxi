# PR #138 review — docs: defer the #4 GPS field test, record iOS build findings

**Head** `32ce0e2` · **Base** `main` @ `302ee373be1e9da146848c241b52053dada67fb5` · reviewed 2026-08-30 · round 1 (no prior report; guarantees pass not triggered)

## Summary

Docs-only PR (5 files, +693 −7). It records a **deferral, not a verdict** for spike #4, adds Phase 0's iOS build findings to the spike doc, and lands the iOS-run plan, its HTML brief and the implementation report. The evidence discipline is the best I have reviewed on this repo: every figure I could chase re-observes (table below), the three "Field results" sections say "Not run" with the owed leg, and the report's five deviations are the PR body's five. What remains is prose that now contradicts the decision the PR makes — in two epic docs it does not touch, in the HTML brief it does, and in the spike doc's own unchanged decision line. Six Medium, eleven Low, none blocking. Counts: **Critical 0 · High 0 · Medium 6 · Low 11.**

The `code-reviewer` agent rated F6 High; I hold it at Medium — the status line does state the design #14 ships, so a #14 planner who reads line 3 gets one answer; the defect is that line 60 still reads as a live rule.

## Issues

### Medium

**F1** `docs/epics/mvp-traceability.md:39` and `docs/epics/sakta-cab.architecture.md:131,138` (neither touched by this PR). The traceability row still reads `Driver app foundation (gated by spike #4) | #14 | open (field drive scheduled)`; the architecture doc still says the three spikes are "All three mandated (Linards, 2026-08-03), each before its dependent phase" with the rule "lossy → escalate … *before* building the driver app on sand". This PR reverses both (#14 not gated, no drive scheduled, the mandate knowingly relaxed) and updates the spike doc, both plans and both issues — but not the two docs `CLAUDE.md` points to for "Product intent" and "Architecture & decisions". Neither the report nor the plan's Q4 (which does flag the sibling `docs/ux-metrics-ledger.md:29` drift) names them. Undocumented divergence.
Fix: one row edit — `Driver app foundation | #14 | open (spike #4 deferred 2026-08-26 → mounted-phone superset; field legs owed as early #14 tasks) | none` — and one clause at architecture :131 ("#4's run deferred 2026-08-26 by Linards; #14 ships the superset design, see `docs/spikes/04-gps-field-test.md`"). Both files carry uncommitted #13 edits in the main checkout on other lines (observed: hunks at :90, :101, :125; :39 is a context line), so expect a trivial merge either way.

**F2** PR body, "What changed": *"the iOS run plan + HTML brief (landed with an AMENDMENTS line saying only Phase 0 ran)"* — true of the `.md`, false of the `.html`. `.claude/plans/spike-gps-field-test-ios-run.html` has no amendment (observed: grep `amend|only phase 0|deferred` hits only the code listing at :123). It still says the plan "gates #14" (:36), "by default it compiles every module from source … So the build should work" (:67–70 — the report's deviation 4 retracts exactly this: the SDK 57 template Podfile defaults `EXPO_USE_PRECOMPILED_MODULES` to `'1'`), "Release build from source on Xcode 26.3 · scripted Rīga route · app backgrounded · analyzer runs" (:86 — only the fallback built; none of the rest ran), "status line becomes a Verdict → #4 closed" (:89), the JSONL evidence list (:119–122 — none exists), "Your steps, in order" (:129–134 — none happened), and "AC7 Full gate green; PR with `Closes #4`" (:143). It is the one artifact in the PR written to be read in five minutes by someone who will not open the report, and its central technical claim is now known wrong.
Fix (either): a one-paragraph banner under :35 — *Superseded 2026-08-26: only Phase 0 ran; field test deferred, #4 stays open; the "source by default" premise in §3 was wrong (SDK 57's Podfile defaults precompiled modules on — export `EXPO_USE_PRECOMPILED_MODULES=0`); see AMENDMENTS in the `.md` plan* — or drop the HTML from the PR (a pre-run brief has no post-run value; the report carries the record) and say so in the body. The PR body must match the file; today it does not.

**F6** `docs/spikes/04-gps-field-test.md:60` (unchanged) vs `:3` (new) — two decision rules. `:60`: "PASS → #14 proceeds as designed with these exact options. FAIL → #14 is designed around the free mounted-phone pattern instead" — two exclusive designs. `:3`: "#14's design is therefore the superset … a later PASS changes nothing" — one design, unconditional. The plan's Q1 (`:435`) is a third reading: Android defaults to mounted-phone "**until an Android drive passes**". The #14 comment ratifies the superset, so the doc's :3 is the operative one; :60 and :11 ("the real answer comes from this field test") still read as live, and :3 does not say whose call the superset is or what a later run does decide.
Fix: one clause after :60 — *Superseded 2026-08-26 (status line): #14 ships the superset regardless of outcome; a later run decides only whether keep-awake can be relaxed after the pilot* — and "(Linards, 2026-08-26; #4/#14 comments)" in :3.

**F7** `.claude/reports/spike-gps-field-test-ios-run-report.md:35` — *"simulator Release build **green on SDK 55** (`EXIT=0`, 2026-08-25 22:30 BST)"* under **Validation results**, while the report's own Issues section (:49) says *"the `EXIT=` sentinel in the build script only fires on failure; the success was found by reading the log (`› Build Succeeded` at 22:17:18)"*. A success cannot have produced `EXIT=0` from that sentinel, a kill would not yield 0, and 22:30 is neither the build (22:17) nor the screenshot (22:29). The build did succeed — `main.jsbundle` in DerivedData is stamped 22:17 (observed) — so this is the #107 pattern in miniature: a correct conclusion carrying a figure no run produced, under a Validation heading. Zero downstream use, but exactly the class the evidence rule exists for.
Fix: cite `› Build Succeeded` 22:17:18 and the bundle mtime; drop `EXIT=0` or say which command returned it.

**F8** `docs/spikes/04-gps-field-test.md:30` — *"the fix counter **must** have grown while backgrounded"*, a hard pass condition for a check nobody has run, while the plan's own R7 (`:69` "Simulator may not deliver location to a backgrounded app") and Task 0.3 GOTCHA (`:207` "background delivery in the simulator is not documented by Apple … note it as a simulator limitation and proceed") say a non-growing count may mean nothing. The next person to run the pre-flight will read a flat counter as broken plumbing.
Fix: *"should have grown while backgrounded — Apple does not document simulator background delivery; if it grows only in the foreground, note it as a simulator limit and rely on the device check"*.

**F9** `docs/spikes/04-gps-field-test.md:21–23` vs `:28`. The unchanged code block is an in-place build (`cd spikes/gps-harness … npx expo run:android # or: npx expo run:ios`); the new paragraph five lines later says "the PR #115 Android recipe — **never** build in place", and on this Mac the block's `run:ios` line is exactly the SDK 57 build :28 says fails.
Fix: a comment on the block (`# generic Expo recipe; on this Mac build from an out-of-repo copy — see below`) or soften "never" to "not in the monorepo checkout".

### Low (one line each)

**F3** GitHub issue #14 body (line ~34) still says *"still gated by spike #4 verdict (field drive scheduled)"*; the decision lives only in `issuecomment-5422896854`. `gh issue edit 14`.
**F4** `docs/research/ui-surface-consolidation.md:103` "spike #4 (field drive scheduled/imminent)" — dated research note; mention only.
**F5** `04-gps-field-test.md:28` (and the same sentence in the PR body, report, plan AMENDMENTS, #4 comment): *"both need Xcode 26.4's compiler"* — the failures are observed, the cause is inferred, and `expo-modules-jsi@57.0.5`'s changelog points elsewhere: the `abs(_:)` ambiguity is a *source* bug fixed in 57.0.5 that fires "under newer toolchains", and `SWIFT_RETURNS_RETAINED` on the `RuntimeScheduler` constructors was added for **Xcode 27**. No build on 26.4 ran. The same parenthesis labels "the last Xcode this machine can run" as observed; it is derived (26.4 needs macOS 26; iMac19,1 cannot run it). Zero cost here — nothing on this Mac can try 26.4 — and the actionable sentence ("SDK 55 builds; do not downgrade the committed harness") is already right. Fix: *both fail on 26.3's compiler; the second is a construct 57.0.5 added for Xcode 27 (its changelog), untested on 26.4*.
**F10** `:28` *"SDK 57 does **not** compile here"* names a broader case than the run: only the source path (`EXPO_USE_PRECOMPILED_MODULES=0`) was tried; the default precompiled path is *expected* to fail (R1's `.swiftinterface` argument), not observed. Add "from source (the precompiled default was not tried)".
**F11** report `:3` "Phases 1–3 replaced by a deferral" and plan `:463` "Phases 1–3 dropped" — Phase 3 ran in deferral form (report lists 3.0–3.3, 3.5 as completed). The close-out amendment's "Phases 2–3 not executed as planned" is the accurate wording.
**F12** plan `:349`/`:419` still instruct "`Closes #4`" and AMENDMENTS `:463` never withdraws it; this repo has closed an issue by prose adjacency before (#132). Append "Task 3.6/AC7's closing keyword withdrawn — #4 stays open".
**F13** report `:41` "Net cost one ~3 min build" — no provenance label. "(observed, log timestamps)" or drop the number.
**F14** `:18` heading "Build & run (real phone required)" now hosts the simulator pre-flight paragraph. Drop the parenthetical.
**F15** `:28` "needs the paid Apple Developer Program **and EAS internal distribution**" — the programme is the requirement; EAS is one route, TestFlight (which :3 itself defers to) is another.
**F16** close-out plan `:276` gives one reason (no paid programme) for a plan whose premise was the free cable path; report and doc give two. Append "and declined the cable install".
**F17** `:68` "Not run — Atis unavailable (2026-08-25)" is the plan's pre-written template text (`:319`) with its date inherited; the deferral is dated 2026-08-26 at :3 and :76. Re-derive or keep and say it is the premise date.

## Numbers pass — every figure in the PR body, the report and the new spike-doc paragraphs

| Claim | Provenance in PR | Re-observed (this review, 2026-08-30) |
|---|---|---|
| `1 + 167 + 463 + 51 + 11 = 693` insertions, 7 deletions, 5 files | observed | `git diff --numstat 302ee37..32ce0e2` identical; 7 deletions all in the spike doc ✅ |
| `spikes/gps-harness/` untouched | observed | `git diff --name-only` lists no path under it ✅ |
| `grep -c ios-forcequit.jsonl` = 2; `EXPO_USE_PRECOMPILED_MODULES` present; status line starts `**Status: deferred`; no "Pending field drive" | observed | 2 / 1 / line 3 / 0 ✅ |
| macOS 15.7.3, Xcode 26.3, iMac19,1 | observed 2026-08-25 | `sw_vers` 15.7.3; `xcodebuild -version` 26.3 (17C529) ✅ |
| `expo-modules-jsi@57.0.4` Swift `abs()` ambiguity at `JavaScriptCodable+Date.swift:53` | observed | npm tarball 57.0.4, that line: `abs(milliseconds) <= maxJavaScriptDateMilliseconds` ✅; 57.0.5 changes exactly that line to `.magnitude` — matches the report's "changes exactly that line" ✅ |
| `57.0.5` `SWIFT_RETURNS_RETAINED` on a constructor at `RuntimeScheduler.h:61` | observed | npm tarball 57.0.5, `apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h:61`: `SWIFT_RETURNS_RETAINED RuntimeScheduler() {}`; absent in 57.0.4 ✅ |
| "both need Xcode 26.4's compiler" | stated as observed | **not observed** — see F5 |
| SDK 57 Podfile defaults `RCT_USE_PREBUILT_RNCORE` and `EXPO_USE_PRECOMPILED_MODULES` to 1; SDK 55's has only the first | observed | `expo-template-bare-minimum@sdk-57` `ios/Podfile:17,22` both `\|\|= '1'` ✅; `~/gps-harness-ios/ios/Podfile` has only `RCT_USE_PREBUILT_RNCORE` ✅ |
| SDK 55, RN 0.83.10; `--fix` adds `expo-sharing` to the copy's plugins | observed | copy `package.json`: expo `~55.0.30`, RN `0.83.10`, `expo-sharing ~55.0.24`; `app.json` plugins :41 ✅ |
| iOS floor 15.1 (`ExpoModulesCore.podspec:82`) | observed | `expo-modules-core@55.0.25` podspec :82 `:ios => '15.1'` ✅ |
| `main.jsbundle` 1,753,194 bytes; `› Build Succeeded` 22:17; products in DerivedData, not `ios/build` | observed | `DerivedData/GPSSpike-bnma…/…/GPSSpike.app/main.jsbundle` 1753194 bytes, mtime 25 Aug 22:17 ✅; `ios/build` holds codegen only, no `.app` ✅ |
| `EXIT=0`, 22:30 BST | observed | **contradicted by the report's own :49** — see F7 |
| `analyze.mjs --selftest` → 5 scenarios | observed 2026-08-25 | re-run: `selftest OK — 5 scenarios` ✅ |
| `npx tsc --noEmit` in the copy → exit 0 (SDK 57 and 55) | observed | re-run today on the SDK 55 copy: exit 0 ✅; the SDK 57 pass is no longer re-observable (copy downgraded), nothing depends on it |
| `xcrun simctl privacy … location-always` / `location … --speed` exist; iOS 26.2 sim; iPhone 17 Pro | observed | both in `simctl help`; runtime iOS 26.2 present; iPhone 17 Pro listed ✅ |
| `issuecomment-5422896664` (#4), `issuecomment-5422896854` (#14) carry the decision | observed | both exist (2026-08-26T08:51Z), bodies match the PR summary ✅; #4 OPEN, #14 OPEN, #15 OPEN ✅ |
| Bundle id `lv.saktacab.gpsspike`; `distanceInterval: 10`; `showsBackgroundLocationIndicator: true` | — | `spikes/gps-harness/app.json:12,22`, `App.tsx:78,83` ✅ |
| "22:30 BST" | observed | the Mac's zone is BST (`date +%Z`); the label is the machine's, not Rīga's ✅ |
| PR #115 "Android recipe" | — | #115 MERGED, "align deps with SDK 57" ✅ |
| Nothing auto-closes | — | `closingIssuesReferences` empty; no closing keyword next to `#N` in the body ✅ |

**Failure-and-cause check** (the #121 lesson): two compiler errors are observed; the named cause ("needs 26.4") is not, and the package's own changelog names a different one for each — F5. The practical conclusion (SDK 57 does not build on this Mac from source; SDK 55 does) is observed and unaffected.

## Validation

| Check | Result | Provenance |
|---|---|---|
| CI `check` on `32ce0e2` | ✅ pass, 4m19s | observed: run 33308488423 |
| Full local gate `pnpm turbo run typecheck lint test build --force` | not run by the author (stated in the PR body) nor by me | the diff has no compiled source; the main checkout carries another session's uncommitted #13 work and the gate's global-setup drops the shared test DB (`CLAUDE.md`) — CI is the gate here, and it ran |
| `node spikes/gps-harness/analyze.mjs --selftest` | ✅ 5 scenarios | observed today |
| `npx tsc --noEmit` in `~/gps-harness-ios` (SDK 55) | ✅ exit 0 | observed today |
| The PR body's four doc greps | ✅ | observed today |
| Implementation report present; deviations documented | ✅ 5/5 match the PR body | read |
| `code-reviewer` agent pass | 16 items, all line-cited; every Medium+ citation re-read by me | folded into F1–F17 above |

## What's good

- A deferral written as a deferral: "Not run" ×3 with the reason and the owed leg; the status line names who decided and when; #4 left open on purpose against the plan's AC5/AC7 — and the report says so rather than calling it done.
- The plan's AMENDMENTS line retires its own wrong claims by subject (`rncore.rb:79` "unset by default", `ios/build`, the R1 trigger strings) and every correction re-observes from the published tarballs.
- The simulator result is fenced as "plumbing check, not evidence" and "route not run" consistently across doc, report and plan.
- The iOS paragraph is written for the next build, not this one: `CI=1` + `--device`, the one-shot Always prompt, export-before-Clear, and why the committed harness must stay SDK 57.
- The PR body derives its own size figure and names the command — the first body on this repo where every number in it survived re-derivation.

## Recommendation

**Approve** (posted as a comment — `gh pr review --approve` cannot act on the author's own PR in this repo). Land **F1, F2, F6, F7** on this branch first: each is ≤5 lines, and F1/F6 are the surfaces a #14 planner reads before anything else. The Lows can ride along or wait. After merge: the main checkout holds untracked, stale copies of `.claude/plans/spike-gps-field-test-ios-run.{md,html}` (the `.md` lacks the AMENDMENTS line) — delete them there before `git pull`, or the pull refuses to overwrite them.
