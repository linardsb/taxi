# Implementation Report — Android emulator as a substitute oracle for #141's device day

**Plan**: `.claude/plans/emulator-oracle-141.md`   **Branch**: `spike/emulator-oracle-224`   **Status**: PARTIAL

## Summary

Gate 1 passed on this pass, re-observed rather than inherited: a synthetic fix reaches the emulator's
**fused** location provider and keeps arriving. Gates 2 and 3 are **not run** — the driver APK cannot
be built. The EAS build errored on a native compile failure that exists on `origin/main` and has
nothing to do with #141 or the emulator: `expo-modules-core`'s C++ compiles against
`react-native-worklets` ≤0.10 while the tree resolves 0.12.1. #141 therefore stays blocked, now for a
second and independent reason ([#225](https://github.com/linardsb/taxi/issues/225)), and the emulator
premise stays **untested past the OS boundary** — which is not the same as a ❌.

`docs/runbooks/driver-device-day.md` gained the `## Emulator route` section the ticket owed, including
the setup, the gate definitions, the injection mechanism that actually works, and the build blocker.

## Tasks completed

- T0 — worktree off `origin/main`, plan copied in, EAS session checked → `.claude/plans/emulator-oracle-141.md` (CREATE, copied)
- T1 — P1–P4 re-derived at the implementing sha (see *Premises*)
- T2–T4 — already satisfied from the planning pass; re-verified, not re-run (see *Host state*)
- T5 — Play services present on the running image
- T6 — **Gate 1 ✅**, re-observed this pass
- T7 — EAS build queued and **errored**; root cause diagnosed (see *Deviations* D7)
- T8, T9, T10 — **not run**, blocked by T7
- T11 — `## Emulator route` appended → `docs/runbooks/driver-device-day.md` (UPDATE)
- T12 — full gate green
- T13 — verdict commented on #224 and #141; build blocker filed as #225

## Premises (T1), re-derived at `1c87592`

| # | Claim | Command | Result |
|---|---|---|---|
| P1 | The background consumer uses the **fused** provider, so the image must be `google_apis` | `grep -n getFusedLocationProviderClient node_modules/expo-location/.../LocationTaskConsumer.kt` | `:48` ✅; hard dep at `android/build.gradle:19` (`play-services-location:21.0.1`) ✅ |
| P2 | The template's ABI list contains `x86_64` | template tarball `package/android/gradle.properties` | `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64` ✅ — answered by `expo-template-bare-minimum@57.0.25` |
| P3 | ≥5 GiB free, `adb` on `PATH` | `df -h /System/Volumes/Data`; `which -a adb` | 84 GiB free ✅; two `adb`s both at 37.0.1, SDK-root copy first on `PATH` ✅ |
| P4 | The injected fix lies inside a seeded zone | `sed -n '36,52p' db/src/seed/riga.ts` | «Rīgas centrs» 56.936–56.966 lat / 24.075–24.135 lng; injected `56.9496,24.1052` is inside ✅ |

Also re-read at this sha: `location-options.ts:19-22` — `timeInterval: 4000`, `distanceInterval: 0`,
`deferredUpdatesInterval: 0`, `deferredUpdatesDistance: 0`.

## Host state (T2–T4), re-verified not re-run

`sdkmanager --list_installed`: `emulator 37.1.11`, `platform-tools 37.0.1`, `platforms;android-36 2`,
`system-images;android-36;google_apis;x86_64 7`. `du -sh $ANDROID_HOME` → **5.9 GiB**, `observed` again
this pass. JDK `openjdk 17.0.20.1`. AVD `sakta141` booted, `ro.build.version.sdk=36`,
`ro.product.cpu.abi=x86_64`, `sys.boot_completed=1`.

**T5** — `adb shell pm list packages | grep com.google.android.gms` → `com.google.android.gms` ✅.

## Gate results

| Gate | Verdict | Evidence |
|---|---|---|
| 1 | **✅ PASS** (`observed` 2026-09-18, this pass) | see below |
| 2 | **NOT RUN** — blocked, not failed | no APK exists |
| 3 | **NOT RUN** — blocked, not failed | depends on Gate 2 |

**Gate 1, 6a.** After a repeating injection, `adb shell dumpsys location`:

```
fused provider:
  service: ProviderRequest[OFF]
  last location=Location[fused 56.949600,24.105200 hAcc=100.0 et=+1m12s716ms mock]
```

**Gate 1, 6b — the stream.** Two captures 14 s apart: `et=+1m12s716ms` → `et=+1m27s295ms`. The
elapsed-time field advanced by 14.6 s across a 14 s wall gap, so this is a stream and not one stale
fix. `observed`.

**What Gate 1 does NOT establish**, stated because the planning artifact warns against exactly this
misquote: `dumpsys` reporting a fused last-location is not evidence that
`FusedLocationProviderClient.requestLocationUpdates` delivers to a registered consumer. Same provider,
different code path — and that difference is what Gate 2 exists to test. Gate 1 must never be quoted
as "delivery works".

## Q4 — can an agent drive the emulator? **Yes**, `observed`

Tested against the stock Settings app, so it cost no build. All four mechanisms T9/T10 depend on work
on this image:

| Mechanism | Result |
|---|---|
| `adb shell uiautomator dump` | 19 994-byte hierarchy with `text=` and `bounds=` attributes |
| parse `bounds` → `adb shell input tap <cx> <cy>` | tap at a parsed centre changed screen (Settings → Internet) |
| `adb exec-out screencap -p` | valid PNG, 320 × 640 RGBA, 29 258 B |
| `adb shell input keyevent KEYCODE_HOME` | focus moved to `NexusLauncherActivity` — Gate 3's backgrounding action |

Caveat recorded in the runbook: the default AVD profile is **320 × 640**, which may be too small for
a real app screen; `avdmanager create avd -d <id>` with a larger profile is the remedy, after reading
`avdmanager list device` rather than guessing an id.

The plan says the follow-up this unlocks (#14's and #16's device days becoming agent-performable)
is not this ticket's to open, and it was not opened — Gate 3 has not passed.

## Tests added

**None, deliberately.** No file under any `src/` changed, so there is no slice to mirror. The plan's
Testing Strategy states this and the reasoning is unchanged: the residual claim is precisely the one
jest cannot reach, which is why the ticket exists.

## Validation results

`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`
from cleared `.next`/`dist` — **exit 0**, `observed` 2026-09-18:

- **Tasks: 22 successful, 22 total**, 0 cached, 2 m 16.6 s
- `@taxi/api`: **Test Suites 77 passed / 77 total, Tests 733 passed / 733 total** — the full count, with
  `REDIS_TEST_URL` set, so the 39 Redis-gated tests ran rather than skipping
- `apps/driver/src/build-config.test.ts` (#222) re-run separately after reverting the `eas.json` edit:
  **11 passed / 11**

## Deviations from the plan

**D1 — the baked origin.** `eas.json`'s `preview` env set to `http://10.0.2.2:3001`, host part only;
the port `3001` was kept from the committed value rather than taken from the plan's literal. Planned
in T7. Runbook §0's LAN pre-flight was skipped, for an emulator run only. Reverted with
`git checkout` once the build was queued.

**D2 — `eas init` mutates more than the runbook says.** §2 states it "WRITES `extra.eas.projectId`
into `app.json`". `observed` 2026-09-18: it also wrote `owner: "linards"` and `extra.router: {}`, and
**expanded `android.permissions` with eight fully-qualified entries**, three of which are new to the
app — `android.permission.RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` and
`FOREGROUND_SERVICE_MEDIA_PLAYBACK` (resolved from the `expo-audio` plugin). The APK was built with
that expansion, because any run of §2 produces it; nothing was committed. A driver app declaring
`RECORD_AUDIO` is worth a decision rather than a side effect, and §2 does not currently mention it.

**D3 — the interactive `init` prompt is avoidable.** The runbook marks the create-or-link prompt
`expected` and never exercised. `eas init --account linards --non-interactive` creates the project with
no prompt at all (`observed`; project `@linards/sakta-cab-driver`, id
`976c4e03-9ef1-46aa-b383-bc72138890a4`). An unattended run does not need that prompt.

**D4 — phase order.** T7's build was queued **before** re-running T4–T6, rather than strictly
top-to-bottom. Gate 1's cost was already paid at planning time and the cloud queue was the only
unbounded wait left. No dependency was violated: T7 depends on Gate 1, which had already passed.

**D5 — Gate 1's single-shot read is a false negative on a cold boot.** The plan's T6a injects once and
reads the fused provider. `observed` this pass: one `set-test-provider-location` left the **fused**
provider at `last location=null` / `ProviderRequest[OFF]` while the **gps** provider already carried
the fix. The fused provider only populated after a repeating injection (8 calls over 16 s). The
planning run did not hit this because its emulator had been running longer. Recorded in the runbook;
the plan's T6a as written would have returned ❌ for a working emulator.

**D6 — `app.json` was re-linked and left dirty for the duration.** `eas-cli build:view` needs
`extra.eas.projectId` to address the project, so after the post-queue revert it had to be re-linked to
read the build's status and logs. Reverted again before the gate and the commit; the tree carries no
`app.json` change.

**D7 — THE BLOCKER: the EAS build errored, and the cause is on `main`.**
Build `a47b0b19-e9d1-4c44-b2ea-e473246fb50c`, `errorCode: EAS_BUILD_UNKNOWN_GRADLE_ERROR`,
`buildDuration` 468 217 ms, commit `1c875929` (= `origin/main` HEAD). From the `RUN_GRADLEW` log:

```
expo-modules-core/android/src/main/cpp/worklets/WorkletJSCallInvoker.cpp:27:21:
  error: no member named 'executeSync' in 'worklets::WorkletRuntime'
> Task :expo-modules-core:buildCMakeRelWithDebInfo[arm64-v8a] FAILED
```

Mechanism, each step `observed`:

1. `expo-router` declares `react-native-reanimated` as an **optional** peer at `"*"`
   (`peerDependenciesMeta`), so pnpm's auto-install-peers resolves it to the newest — `4.6.0`.
2. `react-native-reanimated@4.6.0` declares `peerDependencies.react-native-worklets: "0.12.x"`, so the
   tree carries `react-native-worklets@0.12.1`.
3. `expo-modules-core@57.0.14` declares
   `react-native-worklets: "^0.7.4 || ^0.8.0 || ^0.9.0 || ^0.10.0"` and its C++ compiles against ≤0.10.
   `0.12.1` satisfies none of those ranges; pnpm does not fail on a peer violation.
4. Expo SDK 57's own `bundledNativeModules.json` pins `react-native-reanimated: 4.5.1` and
   `react-native-worklets: 0.10.1`.
5. Bumping `expo` does not help: `expo-modules-core@57.0.18` (what `expo@57.0.23` pins) carries the
   **same** peer range.

**It is on `main`, not caused by this pass**: the build's commit is `origin/main`'s head, and
`git diff origin/main -- pnpm-lock.yaml package.json apps/driver/package.json` is empty.

**It is not the `expo install --check` drift** the runbook discusses at `:153-163`. Neither
`react-native-reanimated` nor `react-native-worklets` is a declared dependency of `apps/driver`, and
`--check` only inspects declared ones — so it is blind to this pair by construction. The 14-package
patch drift `--check` does report is a separate, still-open matter and is not the cause here.

**Not fixed here**, per the plan's Out of Scope ("If a source edit looks necessary, it belongs to a
different issue"). A root `pnpm.overrides` pin would change resolution for every app in the workspace
and its owner is `apps/driver`'s toolchain, not a documentation spike. Filed as [#225](https://github.com/linardsb/taxi/issues/225)
with three candidate fixes named and none chosen.

**D8 — Gates 2 and 3 are NOT RUN, not ❌.** The distinction is load-bearing: a ❌ at Gate 2 or 3 would
be a verdict about the emulator route, and this pass has none. The emulator premise — does a mock fix
reach the **background** consumer — remains exactly as untested as it was before the ticket, past the
OS boundary. What did change is that everything up to that boundary is now proven and costed.

**D9 — T10 not run.** Runbook steps 2–8 depend on Gate 3.

**D10 — the runbook edits went slightly beyond "append after `:322`".** T11's GOTCHA allows editing
the Result table in place. Two further in-place edits were made above `:290`, both **line-count
neutral** so every cited reference still resolves: the stale "Android emulator: no SDK on this
machine" bullet (`:25-28`, 4 lines → 4 lines), which this pass falsified, and the one-line
"Both substitute paths are closed" claim at `:23`, which is no longer true of the emulator path.
Verified after the edits: `:35`, `:37`, `:86`, `:222`, `:246`, `:282`, `:290`, `:311` all resolve to
their original content, and the `Expect` count is unchanged at 2.

**D11 — `RECORD_AUDIO` given an owner.** D2's parenthetical had none: #225 owns the build, #224 the
gates, #141 the claim. One paragraph was added to the runbook's `## Emulator route` saying the
`eas init` permission expansion lands in every future build and deserves a decision before the first
build that reaches a real user. No third issue was opened.

**D12 — the plan was brought up to date, in two places.** It is committed on this branch and is what
a future pass reads to resume, so a stale plan is a live defect rather than a historical note.
`## AMENDMENTS` gained A1 (D5's false-negative mechanism, the not-run gates, the phase order, and the
still-owed T8–T10); `Res2` was retired **at its own bullet** rather than only in A1, because the
register asked "will EAS grant a build?" and never asked "does this tree compile for Android?".
Three deviations were folded into the **task text** instead, since they change how a resuming pass
executes rather than what it concludes: T7 now carries the unattended command sequence, what
`eas init` really mutates, the `build:view` re-link, and the brotli log encoding; T11 now permits a
line-count-neutral rewrite above `:290` of a claim this ticket falsified.

**D13 — the prep plan's rejection retired at its own source.** `.claude/plans/driver-device-day-prep.md`
still asserted "Android emulator — no SDK on this machine" at `:72-74`, which this pass falsified. A
dated entry was appended to its `## AMENDMENTS`, stating what is now measured, what narrowed, and what
still stands. Retiring the digits without retiring the subject is the failure mode the root `CLAUDE.md`
names. **Amended by the PR #226 review (L3):** the append alone left `:72-74` asserting the falsified
version with no marker, 1389 lines from its retirement, so `:70-74` now carries an in-place pointer to
that entry — **line-count neutral**, so `:72-74`, `:558-560` and every other cited line still resolve.

**D14 — the shipped section widened §Steps' range from 3–8 to 2–8.** The plan said 3–8 in eight
places, including AC4, AC6 and T10's own title — but T10's IMPLEMENT (`:766`) said "rows **2 through
8**", and the shipped `## Emulator route` section followed the IMPLEMENT. The widening is
deliberate and correct: §Steps row 2 is a **HARD GATE** whose second half is "the driver visible on
the board", and nothing in Gates 1–3 covers the board — Gate 2 asks only
`driver.location.ping_accepted` at ~4 s. Including row 2 closes a hole the gates leave open. What
was wrong is that nothing recorded it, so AC6's ✅ was ticked against a criterion the section
deliberately exceeds. Found by the PR #226 review (M2). The plan is reconciled to 2–8 at all eight
places (plan `## AMENDMENTS` A2); this report's AC4 and AC6 rows now read 2–8.

## Acceptance criteria

| AC | State | Note |
|---|---|---|
| AC1 — P1–P4 re-derived at the implementing sha | ✅ | table above, each with its command |
| AC2 — SDK, image, AVD exist, measured size recorded | ✅ | 5.9 GiB, `du -sh`, re-measured this pass |
| AC3 — Gates 1/2/3 each have a recorded verdict | **partial** | Gate 1 ✅ with evidence; Gates 2 and 3 have no verdict because they did not run |
| AC4 — steps 2–8 run, Result table filled | ❌ unmet | conditional on Gate 3 green |
| AC5 — evidence-grade caveat stated wherever recorded | **partial** | stated in the runbook section and in both issue comments; the part that depends on a Gate 3 result cannot be stated |
| AC6 — exactly one `## Emulator route` section, cites steps by number, `Expect` count does not grow | ✅, **widened to 2–8** — see D14 | one section; `grep -c Expect` = 2, unchanged. The plan's AC6 worded the range as 3–8; the section cites **2–8** and the plan is reconciled to it |
| AC7 — full gate exits 0 | ✅ | 22/22 tasks, 733/733 tests |
| AC8 — #224 and #141 carry the verdict | ✅ | T13 |
| AC9 — owed by Linards (Q1) | open | untouched by this pass, and now moot until the build is fixed |

## Issues encountered

- **The build blocker** — D7. It is the reason this pass is PARTIAL.
- **`@taxi/shared` had no `dist` in the fresh worktree**, so `pnpm --filter @taxi/api dev` started with
  181 TS errors (`Cannot find module '@taxi/shared'`). Build the workspace packages before starting a
  dev server in a new worktree.
- **EAS build logs are brotli-encoded**, not gzip and not plain text. `zlib.brotliDecompressSync` on
  the `logFiles[0]` URL from `eas build:view --json` is what reads them; a naive text fetch returns
  mojibake and looks like a corrupt download.
- **Migration skew**: `ls db/migrations/*.sql | tail -1` → `0010_smooth_white_queen.sql`. The shared dev
  DB was at 10 applied and one pending; `pnpm --filter @taxi/db migrate` applied it. No new migration
  was authored by this ticket. Seed data was already present (4 geozones) and was not re-run.
- **The dispatch dev server rewrites `apps/dispatch/AGENTS.md`** on boot. Reverted before the commit.
- Host state left clean: emulator killed, test provider removed, `mock_location` op reset to
  `default`, injection loop stopped, api and dispatch dev servers stopped. The AVD persists at
  `~/.android/avd/sakta141.avd`.

## What #141 needs now

1. The build blocker fixed (its own issue), so an APK exists at all.
2. Then Gates 2 and 3 on the emulator — the work this ticket staged and cannot finish.
3. Then, if Gate 3 passes, runbook steps 2–8, and Linards' answer to Q1: whether emulator evidence
   closes #141 or only de-risks the phone day. That call is unchanged and still owed.
