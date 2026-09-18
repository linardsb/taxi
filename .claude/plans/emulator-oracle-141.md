# Feature: Android emulator as a substitute oracle for #141's device day

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Issue [#141](https://github.com/linardsb/taxi/issues/141) is `blocked:hardware`. Its code is merged
(PR #142 `269e8ec`, PR #145 `a6481aa`) and its prep is merged (PR #218), leaving exactly one owed
claim: **after the toggle-OFF chain runs mid-ride, the real OS background location task is still
emitting fixes that reach the api.** `apps/driver`'s jest setup fakes every native module by design,
so no test can answer it — only an Android runtime can.

This ticket tests whether an **Android emulator** is an acceptable runtime for that one claim, and
if it is, runs `docs/runbooks/driver-device-day.md`'s owed steps on it.

The route is gated, not committed to. Three gates decide it, cheapest first, and each ❌ names which
route it kills. Nothing beyond the Android SDK is installed before Gate 1 answers.

## User Story

As **Linards**, who owns no Android phone and no paid Apple account
I want to **know whether an emulator can answer #141's one owed claim, before spending a multi-GB SDK install on it**
So that **#141 either closes on emulator evidence or stays honestly blocked — instead of staying blocked on an untested assumption**

## Problem Statement

`.claude/plans/driver-device-day-prep.md:72-74` rejected the emulator on cost:

> Android emulator — no SDK on this machine (`observed` above); installing Android Studio + SDK +
> an AVD + the SDK 57 prebuild toolchain on an Intel iMac is a multi-GB detour with an uncertain
> end, and the evidence it would produce is weaker than a device's.

Both halves are defensible, and neither was tested. The "uncertain end" is one specific uncertainty:
**does an emulator's injected location reach `expo-location`'s *background* task consumer, or only
its foreground module?** If it does not, the detour proves nothing about #141 and should never be
paid for. If it does, #141 stops being hardware-blocked — and the same runtime unblocks the parts of
#14's and #16's device days that are about software rather than radios.

The premise is cheap to test relative to the payoff, and it has never been tested.

## Solution Statement

Stage the work behind three gates, each producing a recorded verdict:

- **Gate 1** — the emulator's mock provider feeds Google Play services' fused location at all, and
  under a repeating injection it produces a *stream*, not one stale fix. Costs the SDK install and
  nothing else. ❌ here kills the route before any build credit is spent.
- **Gate 2** — the driver APK, foregrounded, produces `driver.location.ping_accepted` at ~4 s.
  Pings only; board visibility is a second failure surface and stays in the run sheet's own step 2.
- **Gate 3** — the same pings continue with the app backgrounded. This is the premise proper: the
  `mIsHostPaused` branch of `LocationTaskConsumer.handleLocationUpdate`.

Past Gate 3, run `docs/runbooks/driver-device-day.md` steps 2–8 **verbatim** on the emulator, fill
its existing Result table with `Platform: Android emulator …`, and append one `## Emulator route`
section to that runbook which *cites* the steps and restates none of them.

## Out of Scope / Non-Goals

- **Not included: a second copy of the run sheet.** `docs/runbooks/driver-device-day.md` is the only
  copy, deliberately — PR #218 exists because three copies produced three different owed-step sets.
  This plan adds a setup section to that file and cites steps 2–8 by number. **If you find yourself
  writing an Expect cell, stop.**
- **Not included: retiring [#4](https://github.com/linardsb/taxi/issues/4) or
  [#14](https://github.com/linardsb/taxi/issues/14)'s device day.** An emulator runs the real Android
  framework, the real fused location provider and a real foreground service — which is what #141's
  teardown claim needs. It reproduces no Doze, no OEM process killer, no real radio and no real GPS.
  Those remain owed to hardware.
- **Not included: iOS.** Unchanged and closed — this iMac19,1 cannot run Tahoe, Xcode 26.3 is the
  ceiling, and Expo SDK 57 needs 26.4 to compile `expo-modules-jsi` (`observed` 2026-08-25).
- **Not included: a local `expo run:android` build.** The EAS `preview` APK is the artifact the phone
  day would use, so evidence transfers. The local route is the fallback only, with its cost, in NOTES.
- **Not included: fixing anything Gate 3 exposes.** If deferral swallows background fixes, that is a
  finding and a new ticket, not a config edit inside this one.
- **Not included: rendering driver freshness on the dispatch board.** Still the separate ticket the
  prep plan named (its Q4). The run sheet already routes around it.
- **Not changing: any file under `apps/driver/src`, `services/api/src` or `packages/shared`.** The
  reducer, the effect runner and the api are correct and merged. This ticket ships documentation and
  a recorded verdict. If a source edit looks necessary, it belongs to a different issue.

## Feature Metadata

**Feature Type**: Spike (with a conditional validation run attached)
**Estimated Complexity**: Medium — low intellectual complexity, high environment risk; the gates exist to bound it
**Primary Systems Affected**: none in-tree. `docs/runbooks/driver-device-day.md` gains a section; `apps/driver`'s build output is consumed, not changed
**Dependencies**: Android SDK command-line tools, a `google_apis` x86_64 system image, JDK 17, EAS Build (cloud)

## Related Work

**Implements**: [#224](https://github.com/linardsb/taxi/issues/224) · **Unblocks**: [#141](https://github.com/linardsb/taxi/issues/141) · **Epic**: [#14](https://github.com/linardsb/taxi/issues/14) → [#1](https://github.com/linardsb/taxi/issues/1)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/driver-device-day-prep.md` — Why: the ticket that produced the runbook, the corrected
  step set (C1/C2) and the build route. **This plan deliberately reopens one of its Out of Scope
  decisions** (the emulator rejection at `:72-74`) on the grounds that the rejection never tested the
  premise it turns on. Everything else in it is inherited unchanged.
- `.claude/plans/driver-toggle-off-mid-ride-held.md` — Why: the fix itself (#142) and the retired run
  sheet the step numbers come from. Read for the claim, not for the steps.
- `.claude/plans/driver-app-auth-online-location.md` — Why: §Level 4 §B is the stack boot recipe the
  runbook cites; `:828` is where the same `clientAt`-not-`at` reading is stated — *"a burst of
  `ping_accepted` whose `clientAt` values are ~4 s apart and span the outage"*.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet — but see Q4: if the emulator turns out to be agent-drivable, #14's and #16's device days
  each want a follow-up, and neither is this ticket's to open)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `docs/runbooks/driver-device-day.md` (whole file, ~322 lines) — Why: **the** artifact. Its §0
  pre-flight, §1 boot, §2 build, §3 surfaces, §4 fault-vs-claim and §Steps table are all reused as
  written. This plan adds to it and restates none of it.
- `apps/driver/src/features/location/location-options.ts` (lines 17-33) — Why: the exact task options
  the background consumer receives. `timeInterval: 4000`, `distanceInterval: 0`,
  `deferredUpdatesInterval: 0`, `deferredUpdatesDistance: 0`. Lines 21-22 are why Gate 3 should pass
  if the mock provider feeds background FLP at all.
- `apps/driver/src/features/location/permissions.ts` (lines 32-47) — Why: `startStreaming` /
  `stopStreaming` / `isStreaming` are the three calls whose *absence* after the toggle is the claim.
- `node_modules/expo-location/android/src/main/java/expo/modules/location/taskConsumers/LocationTaskConsumer.kt`
  (lines 46-48, 101-113) — Why: `:47-48` is P1 (`LocationServices.getFusedLocationProviderClient`, so
  Play services); `:101-113` is `handleLocationUpdate`, whose `if (!mIsHostPaused)` at `:105` is
  exactly the branch Gate 3 separates from Gate 2 — `:112` is the deferred path it takes instead.
- `node_modules/expo-location/android/build.gradle` (line 19) — Why: `api
  'com.google.android.gms:play-services-location:21.0.1'` — the hard reason the AVD needs a
  `google_apis` image and not an AOSP one.
- `apps/driver/eas.json` — Why: the `preview` profile. `distribution: internal`, `buildType: apk`,
  and the baked origin block §0 pre-flights.
- `apps/driver/src/build-config.test.ts` — Why: shipped by #222; it fails if any `eas.json` profile
  resolving to anything but `internal` distribution has cleartext on. **If you touch `eas.json` or
  `app.json`, this test is the one that will tell you.**
- `db/src/seed/riga.ts` (lines 36-52) — Why: the seeded zone polygons. The injected fix must land
  inside the centre zone (56.936–56.966 lat, 24.075–24.135 lng) or `findNearby` matches nothing.
- `apps/driver/app.json` (lines 33-42, 69-76) — Why: the declared Android permissions
  (`ACCESS_BACKGROUND_LOCATION` at `:36`, `POST_NOTIFICATIONS` at `:40`) and the
  `expo-build-properties` cleartext entry (`usesCleartextTraffic` at `:73`). Read; do not edit.

### New Files to Create

- **none.** This ticket adds a section to an existing runbook and an execution report. If a new file
  appears in the diff, justify it against Out of Scope first.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Android Emulator — command-line startup](https://developer.android.com/studio/run/emulator-commandline)
  - Specific section: `-avd`, `-no-snapshot-load`, `-gpu`
  - Why: the AVD is booted headlessly from a script, not from Android Studio
- [Emulator console & `adb emu`](https://developer.android.com/studio/run/emulator-console#geo)
  - Specific section: `geo fix`
  - Why: **argument order is `geo fix <longitude> <latitude>`** — the single most likely silent failure
- [`sdkmanager`](https://developer.android.com/tools/sdkmanager) and [`avdmanager`](https://developer.android.com/tools/avdmanager)
  - Specific section: `--install`, `--licenses`; `create avd -k`
  - Why: the package IDs and the licence-acceptance step, which blocks unattended installs
- [Expo — `expo-location` background location](https://docs.expo.dev/versions/latest/sdk/location/#background-location)
  - Specific section: Background location permissions and the foreground-service requirement
  - Why: confirms the `ACCESS_BACKGROUND_LOCATION` + foreground-service pairing the app already declares
- [EAS Build — internal distribution](https://docs.expo.dev/build/internal-distribution/)
  - Specific section: installing an internal-distribution APK
  - Why: the `preview` profile's output and how it is fetched

### Patterns to Follow

**Runbook prose — cite, never restate.** The house rule this ticket exists downstream of:

```markdown
Use #14's recipe: `.claude/plans/driver-app-auth-online-location.md` §Level 4 §B. Do not restate it
here — two copies of a procedure is the failure this runbook exists to clean up.
```
— `docs/runbooks/driver-device-day.md:86-88`. The new section follows the same rule against §Steps.

**Every figure carries its provenance.** `observed` (name the run), `derived` (show the arithmetic
*and* the condition), or `expected`. The runbook models it at
`docs/runbooks/driver-device-day.md:246` (*"The 12 s is `derived`, **not** a measurement: 3 ×
`MIN_FIX_INTERVAL_MS`…"*) and `:282` (*"Why step 7's window is 2 minutes"*). A download size nobody
has measured is `expected`, not a fact.

**A ❌ names which route it kills.** The runbook's verdict rule makes four steps binary; this plan's
gates extend that shape — each gate's failure branch says whether the emulator route is dead, or
something else is.

**Result recording.** `docs/runbooks/driver-device-day.md:13-22`'s Result table is *filled*, not
duplicated. `rider-a11y-walkthrough.md` is the precedent for a runbook that ships reading "not yet
run" and is later filled in place.

---

## IMPLEMENTATION PLAN

### Phase A: Re-verify the premises that were checked at planning time

Four claims (P1–P4) were established while writing this plan. They are cheap to re-check and the
whole plan rests on them, so re-check them rather than inherit them.

**Tasks:**

- Re-read the two `expo-location` Android sources for the fused-provider dependency
- Re-read the Expo template's `gradle.properties` for the ABI list
- Confirm the seed's zone polygon bounds still bracket the fix you intend to inject

### Phase B: Android SDK and an AVD — Gate 1

**Depends on:** Phase A (P1 decides `google_apis` vs AOSP; getting this wrong wastes the whole install)

The only unattended phase, and the only one that costs disk. It ends at Gate 1.

**Tasks:**

- Install JDK 17 and the Android command-line tools
- Install `platform-tools`, `emulator` and the `google_apis` x86_64 system image for API 36
- Create and boot an AVD
- Inject a Rīga fix, confirm the fused provider sees it, then confirm a *stream*

### Phase C: The driver APK on the emulator — Gate 2

**Depends on:** Phase B (Gate 1 green) **and on a human** — see the Prerequisite below

**Tasks:**

- Build the `preview` APK on EAS, install it on the emulator
- Sign in, go online, confirm pings at ~4 s foregrounded

### Phase D: Background the app — Gate 3

**Depends on:** Phase C (Gate 2 green)

The premise proper, and the only phase whose result is genuinely unknown.

**Tasks:**

- Send the app to the background, keep injecting, watch for continued pings
- On ❌, split the verdict two ways before recording it

### Phase E: Run the owed steps

**Depends on:** Phase D (Gate 3 green)

**Tasks:**

- Run `docs/runbooks/driver-device-day.md` steps 2–8 verbatim
- Record each step pass or fail; a failure is a finding, never "mostly worked"

### Phase F: Record

**Depends on:** whichever phase terminated — **this phase runs on every path, including a ❌ at Gate 1**

**Tasks:**

- Append `## Emulator route` to the runbook
- Fill or annotate the Result table
- Comment the verdict on #224 and #141

---

## BLOCKING PREREQUISITE — read before starting Phase C

**Half of this was retired at planning time. Read the current state before planning around it.**

**No EAS build has ever run for `apps/driver`** — `.claude/reports/driver-device-day-prep-report.md`
marks the cloud build `expected`, not `observed`. Phase C needs two things:

1. ~~An interactive `npx eas-cli@latest login`~~ — **already satisfied.** `observed` 2026-09-18:
   `npx -y eas-cli@latest whoami` returns `linards` / `linardsberzins@gmail.com`, exit 0. A live
   session exists on this machine, so **no interactive login is needed** and Phases C–E are not
   blocked on one.
2. **One Android build credit / a free-tier build slot** — still unverified, and the only human-side
   unknown left. It surfaces at the `eas-cli build` line in T7, not before.

**T0 still runs the `whoami` check**, because a session can expire between now and the implement pass
and the check costs ten seconds. What T0 must no longer do is *assume* a login is missing.

**Phases A and B run unattended. C, D and E now also run unattended up to the point where EAS either
grants a build or refuses one.** If the build is refused, this pass ends with Gate 1's verdict
recorded — a complete and useful outcome, because Gate 1 is the decisive gate.

---

## HOST STATE — what is already done, as of 2026-09-18

Parts of Phase B were executed **during planning**, to de-risk the plan rather than to implement the
ticket. An implement pass will find these already satisfied; re-check rather than re-run.

| Thing | State | Evidence |
|---|---|---|
| JDK 17 | **done** — Temurin `17.0.20.1` at `~/.local/share/jdk-17/Contents/Home` | `java -version` → `openjdk version "17.0.20.1" 2026-08-18` |
| Android command-line tools | **done** — cask installed, SDK root `/usr/local/share/android-commandlinetools` | `sdkmanager --version` → `22.0`; `avdmanager list target` runs |
| `emulator`, `platforms;android-36`, `platform-tools`, the `google_apis` x86_64 image | **done**, exit 0 | `sdkmanager --list_installed`: `emulator 37.1.11`, `platforms;android-36 2`, `system-images;android-36;google_apis;x86_64 7`. SDK root **5.9 GiB on disk** (`du -sh`) |
| Hardware acceleration | **available** | `emulator -accel-check` → `accel: 0`, `Hypervisor.Framework OS X Version 15.7` |
| AVD `sakta141` (T4) | **created and booted** — API 36, `x86_64`, boot in ~90 s | `adb devices` → `emulator-5554 device`; `getprop ro.build.version.sdk` → `36` |
| Play services on the image (T5) | **present** | `pm list packages` → `com.google.android.gms` |
| **Gate 1 (T6)** | **PASSED** — a synthetic fix reaches the **fused** provider | `dumpsys location` → `fused provider: last location=Location[fused 56.949600,24.105200 … mock] enabled=true` |
| Emulator process | **shut down**, test provider removed, mock-location op reset to `default` | the AVD itself persists at `~/.android/avd/sakta141.avd` — re-boot it with T4's `emulator -avd sakta141 …` line; **nothing is left running on this machine** |
| EAS login (T0) | **live** — `linards` / `linardsberzins@gmail.com` | `npx -y eas-cli@latest whoami`, exit 0 |

**Nothing in the repo was changed by any of the above** — it is all host tooling outside the working
tree. The plan's tasks are still the authority; this table only says which ones will be quick.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task Format Guidelines

Use information-dense keywords for clarity:

- **CREATE**: New files or components
- **UPDATE**: Modify existing files
- **ADD**: Insert new functionality into existing code
- **REMOVE**: Delete deprecated code
- **REFACTOR**: Restructure without changing behavior
- **MIRROR**: Copy pattern from elsewhere in codebase

---

### T0 — ESTABLISH the branch, and learn how far this pass can get, before spending anything

- **IMPLEMENT**: Two checks and one worktree, all inside a minute. They decide whether this pass ends
  at Gate 1 or runs to Gate 3, and doing them last is how a pass burns 2.3 GiB and then stalls.
  1. **Branch.** The main checkout may be on a dead branch — at planning time it sat on
     `feature/driver-device-day-prep`, `gone` on origin and strictly behind `main`. Work in a
     worktree off `origin/main`.
  2. **Expo session.** `~/.expo/state.json` exists on this machine (`observed` 2026-09-18), which
     means the Expo CLI has run here before — it does **not** mean a live login. `whoami` answers it
     without reading the file.
  3. **Docker/api reachability** is not needed until T8; do not boot the stack yet.
  ```bash
  git -C /Users/Berzins/Desktop/taxi fetch origin --prune
  git -C /Users/Berzins/Desktop/taxi worktree add /Users/Berzins/taxi-worktrees/wt-224 -b spike/emulator-oracle-224 origin/main
  npx -y eas-cli@latest whoami     # `observed` 2026-09-18: returns `linards` / linardsberzins@gmail.com, exit 0
  ```
- **PATTERN**: `CLAUDE.md` §Concurrent Claude sessions — check `git reflog -8`, and work in a worktree
  from the start rather than moving a shared branch mid-flight.
- **IMPORTS**: none.
- **GOTCHA**: do **not** `cat ~/.expo/state.json`. It is a credential store; `whoami` is the supported
  read and the only one needed.
- **GOTCHA**: copy `.env` into the worktree and run anything DB-touching with
  `COMPOSE_PROJECT_NAME=taxi` — a worktree without `.env` makes a Redis-gated run hang silently
  rather than fail, and compose otherwise starts a second Postgres against the occupied 5432.
- **GOTCHA**: `.claude/code-reviews/pr-221-review.md` is untracked in the main checkout and is **not
  this ticket's**. Do not let a commit here sweep it up.
- **VALIDATE**: `git -C /Users/Berzins/taxi-worktrees/wt-224 status -sb` shows the new branch on
  `origin/main`; the `whoami` result is recorded in the report either way
- **SATISFIES**: AC #1

---

### T1 — VERIFY the four premises at the implementing sha

- **IMPLEMENT**: Re-derive P1–P4 rather than inheriting them from this plan. P1: `expo-location`'s
  background consumer uses the fused provider, so the image must be `google_apis`. P2: the template's
  ABI list contains `x86_64`. P3: host still has ≥5 GiB free and `adb` on `PATH`. P4: the fix you will
  inject lies inside the seeded centre zone.
- **PATTERN**: `docs/runbooks/driver-device-day.md:37-52`'s "re-checked rather than assumed" table.
- **IMPORTS**: none.
- **GOTCHA**: `apps/driver/android/` is gitignored and absent, so `gradle.properties` cannot be read
  from the tree — read the template from npm, and record which template version answered.
- **VALIDATE**:
  ```bash
  grep -n "getFusedLocationProviderClient" node_modules/expo-location/android/src/main/java/expo/modules/location/taskConsumers/LocationTaskConsumer.kt
  grep -n "play-services-location" node_modules/expo-location/android/build.gradle
  curl -sL "$(npm view expo-template-bare-minimum@57 dist.tarball | tail -1 | tr -d "'")" \
    | tar -xzO package/android/gradle.properties | grep -E "reactNativeArchitectures|SeparateBuildPerCPU"
  sed -n '36,52p' db/src/seed/riga.ts
  df -h / | tail -1
  ```
- **SATISFIES**: AC #1

---

### T2 — INSTALL JDK 17 and the Android command-line tools

- **IMPLEMENT**: **`observed` 2026-09-18 — this task has been run; the commands below are the ones
  that worked, not the ones that were planned.** See the GOTCHA on Homebrew formulae for why.
  ```bash
  # JDK 17 — direct from Adoptium. No brew formula, no sudo.
  curl -fsSL "https://api.adoptium.net/v3/binary/latest/17/ga/mac/x64/jdk/hotspot/normal/eclipse" \
    -o /tmp/jdk17.tar.gz
  mkdir -p "$HOME/.local/share/jdk-17"
  tar -xzf /tmp/jdk17.tar.gz -C "$HOME/.local/share/jdk-17" --strip-components=1

  # Android command-line tools — a CASK, so unaffected by the bottle drop below.
  brew install --cask android-commandlinetools
  ```
  Then, for every later task in this plan:
  ```bash
  export JAVA_HOME="$HOME/.local/share/jdk-17/Contents/Home"
  export ANDROID_HOME=/usr/local/share/android-commandlinetools
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$PATH"
  ```
- **PATTERN**: none in-repo — this is host setup, not repo work. Keep it out of the repo: **no
  `.env`, no `settings.local.json` entry, no committed path.** It belongs in the runbook's new
  section as prose.
- **IMPORTS**: none.
- **GOTCHA — `brew install <formula>` NO LONGER WORKS ON THIS MACHINE, and it fails by taking hours
  rather than by erroring.** Homebrew has dropped bottles for macOS Intel x86_64 (announced August
  2025, effective September 2026), so a formula install falls back to **building from source**.
  `observed` 2026-09-18: `brew install openjdk@17` printed *"Homebrew no longer builds bottles for
  this configuration"* and was, minutes later, pulling GNU source tarballs from `savannah.gnu.org`.
  Building a JDK from source is not a viable step in this plan. **The Adoptium tarball above is the
  route.** `observed`: `OpenJDK17U-jdk_x64_mac_hotspot_17.0.20.1_1.tar.gz`, 172 MB, unpacked to
  `~/.local/share/jdk-17`, no sudo, and `sdkmanager` then reports version **22.0** under it.
  **This applies to every future `brew install` of a formula in this repo, not just this task.**
- **GOTCHA — casks still work, and that is why the SDK tools still come from brew.** A cask downloads
  a prebuilt upstream binary rather than building anything, so the bottle drop does not touch it.
  `observed` 2026-09-18: `brew install --cask android-commandlinetools` printed *"This is a Tier 3
  configuration"* and then *"🍺 android-commandlinetools was successfully installed!"*, and its own
  caveat confirms *"Default Android SDK root is /usr/local/share/android-commandlinetools"* — the
  exact path this plan exports as `ANDROID_HOME`.
- **GOTCHA — do not use the `temurin@17` cask either.** It is a cask, so the bottle drop does not
  affect it, but it installs a `.pkg` into `/Library/Java/JavaVirtualMachines` and therefore
  **prompts for sudo**, which hangs an otherwise unattended Phase B with no visible error. The
  Adoptium tarball avoids both problems at once.
- **GOTCHA**: system Java is **14** (`observed` 2026-09-18: `/usr/libexec/java_home -V` lists only
  `14.0.1` and a 1.8 applet plug-in — there is no JDK 17 on this machine by default). `sdkmanager`
  requires 17 and fails under 14 in a way that does not name the JDK. Nothing above puts the new JDK
  on `PATH`, so `/usr/bin/java` stays 14 and **`JAVA_HOME` is the only thing redirecting
  `sdkmanager`.** Set it explicitly in every shell.
- **GOTCHA**: `brew` here is Intel Homebrew at `/usr/local/bin/brew`, so both land under
  `/usr/local/`, never `/opt/homebrew/`. The cask's artifact paths are fixed and `observed`
  2026-09-18 from `brew info --cask android-commandlinetools` (cask version `15859902`): it provides
  `sdkmanager` and `avdmanager` at `/usr/local/share/android-commandlinetools/cmdline-tools/latest/bin/`.
  **That directory's grandparent is also the SDK root** `sdkmanager` installs into by default, which
  is why `ANDROID_HOME` is set to it rather than to `~/Library/Android/sdk`.
- **GOTCHA — `adb` already exists and must not be duplicated into a second version.** The
  `android-platform-tools` cask is **already installed** (`observed` 2026-09-18), symlinking
  `/usr/local/bin/adb` → `Caskroom/android-platform-tools/37.0.1/platform-tools/adb`. Google's index
  publishes `platform-tools` at the **same** revision, `37.0.1` (`observed` in
  `repository2-3.xml`), so there is no version skew either way — but keep exactly one on `PATH` and
  record which. The `PATH` line above deliberately does not add `$ANDROID_HOME/platform-tools`.
- **VALIDATE**:
  ```bash
  "$JAVA_HOME/bin/java" -version 2>&1 | head -1   # must read 17
  sdkmanager --version && avdmanager list target >/dev/null && echo "cmdline-tools OK"
  adb version | head -1                            # record which adb won the PATH
  ```
- **SATISFIES**: AC #2

---

### T3 — INSTALL platform-tools, emulator and the API 36 `google_apis` x86_64 system image

- **IMPLEMENT**:
  ```bash
  yes | sdkmanager --licenses      # the Android SDK licence; blocks every install until accepted
  sdkmanager --install "emulator" "platform-tools" "platforms;android-36" \
    "system-images;android-36;google_apis;x86_64"
  ```
- **PATTERN**: none in-repo.
- **IMPORTS**: none.
- **EVERY ROW HERE IS `observed` FROM THE COMPLETED INSTALL**, 2026-09-18, exit 0 — read back with
  `sdkmanager --list_installed`, not from a published index:

  | Package | Installed revision |
  |---|---|
  | `emulator` | **37.1.11** (build_id 15917651) |
  | `platform-tools` | 37.0.1 |
  | `platforms;android-36` | 2 |
  | `system-images;android-36;google_apis;x86_64` | **7** — "Google APIs Intel x86_64 Atom System Image" |

  **Size: 5.9 GiB on disk** at `$ANDROID_HOME` (`observed`, `du -sh` after the install). The download
  is smaller and cannot be fully derived: the image archive `x86_64-36_r07.zip` is 1.77 GiB
  (1 895 447 397 B, `observed` in Google's `sys-img2-4.xml`, and the archive name matched what
  actually downloaded), `platforms;android-36` is 62.8 MiB and `platform-tools` 15.4 MiB — but
  `sdkmanager` resolved **emulator 37.1.11**, not the 37.2.10/466.1 MiB row the index listed, so that
  archive's size is `expected`, not known. **Quote the 5.9 GiB, which was measured.**

- **GOTCHA**: **`google_apis`, never `default`.** An AOSP image has no Google Play services, and
  `LocationTaskConsumer.kt:47-48` reaches for `LocationServices.getFusedLocationProviderClient` —
  on an AOSP image the background task gets nothing and Gate 1 fails for a reason that has nothing
  to do with #141. `google_apis_playstore` also works but is unnecessary and cannot be rooted.
- **GOTCHA**: API **36** because `expo-modules-core/android/ExpoModulesCorePlugin.gradle:69` defaults
  `targetSdkVersion` to `36` (`observed` 2026-09-18). Google also publishes `android-36.1`,
  `android-36-ext18` and `android-36-ext19` variants — **take the plain `android-36`**; the others are
  extension-level variants and none of them is what the app targets.
- **GOTCHA — the Intel host is supported, and this was the risk most likely to end the route on
  arrival.** Google publishes the emulator per host arch, and for macOS both exist: `x64`
  (466.1 MiB) and `aarch64` (396.8 MiB). `sdkmanager` picks by host, so an Intel iMac gets the `x64`
  archive. The system image's own dependency is `emulator` ≥ **35.4.9**; the published 37.2.10
  satisfies it.
- **GOTCHA — `platform-tools` IS required in the SDK root, despite the cask already supplying `adb`.**
  The emulator validates its SDK root by looking for a `platform-tools` subdirectory, and without one
  it dies at `FATAL | Cannot find AVD system path. Please define ANDROID_SDK_ROOT` — `observed`
  2026-09-18 on the first boot attempt. Install it (`sdkmanager --install "platform-tools"`) **and**
  export `ANDROID_SDK_ROOT` alongside `ANDROID_HOME`; the emulator reads the former and only guesses
  from the latter. Put `$ANDROID_HOME/platform-tools` first on `PATH` so exactly one `adb` is in play
  — both copies are 37.0.1, so there is no skew either way.
- **GOTCHA**: `sdkmanager --licenses` is interactive. `yes |` is the non-interactive form; what is
  being accepted is the standard `android-sdk-license`, which every package above declares via
  `<uses-license ref="android-sdk-license"/>`.
- **VALIDATE**:
  ```bash
  sdkmanager --list_installed | grep -E "emulator|platforms;android-36|system-images;android-36"
  du -sh "$ANDROID_HOME"   # observed 2026-09-18: 5.9G
  ```
- **SATISFIES**: AC #2

---

### T4 — CREATE and boot the AVD

- **IMPLEMENT**:
  ```bash
  echo no | avdmanager create avd -n sakta141 -k "system-images;android-36;google_apis;x86_64"
  emulator -avd sakta141 -no-snapshot-load -no-boot-anim -no-audio -gpu swiftshader_indirect &
  adb wait-for-device
  # wait-for-device returns at adbd, NOT at boot — poll the property or everything after races it
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 2; done
  ```
- **PATTERN**: none in-repo.
- **IMPORTS**: none.
- **GOTCHA — no `-d` device profile, deliberately.** `-d pixel_6` would have to name an id that this
  SDK's `avdmanager list device` actually prints, and a wrong one fails the create. Omitting `-d`
  takes the default profile, which is sufficient: nothing in this run depends on a particular screen
  size. Add `-d` only if the default turns out to be unusable, and check `avdmanager list device`
  first rather than guessing a name.
- **GOTCHA**: `avdmanager create` asks *"Do you wish to create a custom hardware profile?"* on stdin
  and waits. `echo no |` answers it; without that the task hangs with no output.
- **GOTCHA**: run it **windowed**, not `-no-window` — but that is a fallback, not the plan. Steps 4
  and 8 are driven by `adb shell input tap` and read by `adb exec-out screencap` (see T10), neither
  of which needs the window. Keep the window so a human can watch, and because a headless emulator
  makes a failed run much harder to diagnose.
- **GOTCHA**: on an Intel Mac the emulator uses Hypervisor.framework; HAXM is retired. If
  acceleration fails, `emulator -accel-check` names the reason — do not silently fall back to
  software CPU emulation, which is too slow to judge a 4-second ping cadence.
- **VALIDATE**:
  ```bash
  adb devices                                   # one line: emulator-5554  device
  adb shell getprop ro.build.version.sdk        # 36
  adb shell getprop ro.product.cpu.abi          # x86_64
  ```
- **SATISFIES**: AC #2

---

### T5 — VERIFY Google Play services is present on the image

- **IMPLEMENT**: Confirm the running image actually carries the fused provider before blaming anything
  else for a missing fix.
- **PATTERN**: the runbook's §4 discipline — separate a transport/setup fault from the claim under test.
- **IMPORTS**: none.
- **GOTCHA**: this is the cheap pre-check for T6. If it fails, T6's ❌ would be misread as "the
  emulator cannot feed FLP" when the truth is "you installed the wrong image".
- **VALIDATE**: `adb shell pm list packages | grep com.google.android.gms` prints a package
- **SATISFIES**: AC #1

---

### T6 — GATE 1: a fix reaches the **fused** provider, and keeps arriving

**`observed` 2026-09-18 — this gate has been RUN and it PASSES.** What follows is the mechanism that
worked, not the one originally planned. The original design was invalid and is kept below as a
warning, because it would have produced a false ❌.

- **IMPLEMENT**: Grant the shell mock-location, register a test provider, write a fix, read it back
  from the **fused** provider — the one `LocationTaskConsumer.kt:47-48` reads.
  ```bash
  adb shell appops set com.android.shell android:mock_location allow
  adb shell cmd location providers add-test-provider gps
  adb shell cmd location providers set-test-provider-enabled gps true
  adb shell cmd location providers set-test-provider-location gps --location 56.9496,24.1052
  adb shell dumpsys location | grep -A3 "fused provider:"
  ```
  For 6b, the stream, loop the `set-test-provider-location` line every 2 s and confirm the `et=`
  (elapsed time) field on the fused `last location` keeps advancing.
- **PATTERN**: `docs/runbooks/driver-device-day.md:246` — state the arithmetic behind an interval
  and the condition it assumes. Here: 2 s is half of `timeInterval: 4000`
  (`location-options.ts:19`), `derived`, so the OS floor stays the binding constraint rather than the
  injection cadence. **A 2 s injection loop does not predict 2 s pings**: the client throttle drops
  anything under `MIN_FIX_INTERVAL_MS = 4_000` (`fix-throttle.ts:9`), so the wire cadence Gates 2 and
  3 read stays ~4 s however fast you inject. Reading 2 s and marking a healthy stream ❌ is the
  failure this sentence exists to prevent.
- **IMPORTS**: none.
- **THE RESULT, `observed` 2026-09-18** — with no app installed and no build spent:
  ```
  fused provider:
    last location=Location[fused 56.949600,24.105200 hAcc=100.0 et=+1m51s290ms mock]
    enabled=true
  ```
  The fused provider went `enabled=false, connected=false, last location=null` → `enabled=true` with
  a fix at the injected coordinates. **Synthetic fixes reach the fused provider — the provider the
  app's consumer reads from.**
  **Read the limit of this precisely.** What is `observed` is `dumpsys` reporting a fused
  last-location. It is *not* observed that `FusedLocationProviderClient.requestLocationUpdates`
  delivers to a registered consumer: same provider, different code path, and the difference is
  exactly what Gate 2 exists to test. Do not let this result be quoted as "delivery works".
- **GOTCHA — `adb emu geo fix` ALONE DOES NOT WORK, and it fails silently with `OK`.** `observed`
  2026-09-18: `adb emu geo fix 24.1052 56.9496` returns `OK`, exit 0, and **nothing appears in
  `dumpsys location`**. The reason is in the dump: with no app requesting location the `gps provider`
  sits at `ProviderRequest[OFF]`, `mStarted=false`, `last location=null` — the emulator's GPS HAL
  only reports when a client has an active request. **The original Gate 1 therefore had no valid
  reading**: it would have returned ❌ for a working emulator and killed the route on a false
  negative. `emu geo fix` may still be the better mechanism once the APK *is* installed and
  requesting — try it then, and fall back to the test provider.
- **GOTCHA — the two mechanisms take coordinates in OPPOSITE ORDERS.** `adb emu geo fix` is
  `<longitude> <latitude>`; `cmd location ... set-test-provider-location` is
  `--location <LATITUDE>,<LONGITUDE>`. Rīga is `geo fix 24.1052 56.9496` **and**
  `--location 56.9496,24.1052`. Swapping either puts the driver in open ocean, which looks exactly
  like "injection does not work".
- **GOTCHA**: `appops set` takes the **package name**, not a uid — `adb shell appops set
  com.android.shell android:mock_location allow`. Passing an empty uid makes it parse the op as the
  package and fail with the misleading `Error: Unknown operation string: allow`. Verify with
  `adb shell appops get com.android.shell android:mock_location` → `MOCK_LOCATION: allow`.
- **GOTCHA**: a mock fix is flagged `mock` in `dumpsys` and in `Location.isMock()`. **Nothing in
  shipped driver source reads that flag** — `observed` 2026-09-18: `grep -rn
  "isMock|mocked|isFromMockProvider" apps/driver/src` returns only jest `mocked()` calls in `.test`
  files. So the route is not blocked here today. Re-check it if a fix-validation guard is ever added,
  because such a guard would kill this route at the app rather than at the OS.
- **GOTCHA**: `dumpsys location`'s headings move between API levels, so **do not grep for a heading**
  where you can grep for the injected value. `grep -E "56\.9|24\.1"` survives an API bump.
- **VALIDATE**:
  ```bash
  adb shell dumpsys location | grep -A3 "fused provider:"          # 6a: a fused fix at 56.9496/24.1052
  # 6b, with the loop running — capture twice, ≥10 s apart, and compare the et= field:
  adb shell dumpsys location | grep -A2 "fused provider:" > /tmp/geo.1; sleep 12
  adb shell dumpsys location | grep -A2 "fused provider:" > /tmp/geo.2
  diff /tmp/geo.1 /tmp/geo.2 && echo "IDENTICAL — a stale fix, not a stream" || echo "ADVANCING — a stream"
  ```
  A `diff` that reports no change is Gate 1's 6b ❌ even when 6a passed.
- **❌ MEANS**: no synthetic fix can reach the fused provider on this emulator. **The route is dead.**
  Stop, go to T13, record it with the SDK size actually spent. **This branch is now unreachable —
  6a passed on 2026-09-18.**
- **SATISFIES**: AC #3
---

### T7 — BUILD the `preview` APK and install it

- **IMPLEMENT**: Follow `docs/runbooks/driver-device-day.md` §2 for the build commands, with **one
  deliberate deviation**: set the `preview` profile's baked origin to **`10.0.2.2`** rather than this
  machine's LAN address — **host part only, keeping the port already committed in `eas.json`**
  (`3001` today, and it tracks `API_PORT`). Then `adb install -r <downloaded apk>`.
  **`observed` 2026-09-18 — the sequence that ran unattended end to end** (the build itself then
  errored; see AMENDMENTS A1):
  ```bash
  cd apps/driver
  npx -y eas-cli@latest init --account linards --non-interactive   # no create-or-link prompt
  # edit eas.json's env.EXPO_PUBLIC_API_URL host -> 10.0.2.2, port unchanged
  npx -y eas-cli@latest config -p android -e preview --non-interactive   # must exit 0
  npx -y eas-cli@latest build -p android --profile preview --non-interactive --no-wait
  git checkout apps/driver/eas.json apps/driver/app.json
  ```
- **PATTERN**: §2's `eas-cli config -p android -e preview --non-interactive` cheap-failure check
  before the `build` line. It costs seconds and catches a bad `eas.json` before a build credit.
- **IMPORTS**: none.
- **GOTCHA**: **needs the human login and a build credit** — see BLOCKING PREREQUISITE, and T0, which
  tells you in ten seconds whether the login is already live. **Both are now answered**, `observed`
  2026-09-18: the session was live and EAS granted a build slot on the free tier (queued 5 s, ran
  468 s). Res2 is retired; no interactive step stands between a pass and the build.
- **GOTCHA — `eas init` mutates MORE than §2 says**, and §2's "WRITES `extra.eas.projectId`" is an
  understatement. `observed` 2026-09-18: it also writes `owner: "linards"` and `extra.router: {}`, and
  expands `android.permissions` with eight fully-qualified entries, three of them new to the app —
  `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, resolved from the
  declared `expo-audio` dependency. Build with it (any §2 run produces it), commit none of it, and read
  the note now carried in the runbook's `## Emulator route`.
- **GOTCHA — reverting `app.json` costs `eas-cli` its ability to address the project.** `build:view`
  and `build:list` need `extra.eas.projectId`. Re-link with
  `eas init --id <project-id> --non-interactive --force` while you need them, and revert again before
  committing. In a dedicated worktree, leaving it dirty for the duration is safe; in the shared
  checkout it is not.
- **GOTCHA — EAS build logs are brotli, not gzip and not text.** `build:view --json` gives
  `logFiles[0]`; fetch it and run `zlib.brotliDecompressSync` (node) over the bytes. A naive text fetch
  returns mojibake and reads as a corrupt download rather than as an encoding you have not handled.
- **GOTCHA — why `10.0.2.2` and why this is not a divergence.** `10.0.2.2` is the emulator's fixed
  alias for the host's loopback: it is a property of the emulator's NAT, not of any network, so it
  **cannot go stale**. The LAN address can — a DHCP lease move is exactly what runbook §0 exists to
  pre-flight, and on top of that a LAN round trip can meet the macOS application firewall. Using
  `10.0.2.2` retires both risks for the price of a value that this runbook **already treats as a
  per-session build convenience**: §0 says edit it when the lease moves and `git checkout` it
  afterwards. So this is the same edit §0 prescribes, with a value that never needs re-checking.
  **§0's pre-flight is therefore skipped for an emulator run, and only for an emulator run.** Record
  the deviation; `10.0.2.2` must never reach a phone build, where it means nothing.
- **GOTCHA**: the origin edit **stays uncommitted** — `git checkout apps/driver/eas.json` once the
  build is queued, exactly as §0 requires, so a `piv-commit` in this shared checkout cannot sweep it
  into an unrelated PR.
- **GOTCHA**: `usesCleartextTraffic` is on (`app.json:73`), so `http://10.0.2.2:3001` is permitted —
  this deviation does not need a manifest change, and must not be made an excuse for one.
- **GOTCHA**: if `adb install` fails with `INSTALL_FAILED_NO_MATCHING_ABIS`, P2 is wrong for this
  build — record it rather than working around it. It is **unlikely twice over**: the template's ABI
  list contains `x86_64`, *and* the chosen system image declares `translatedAbis: arm64-v8a`
  (`observed` 2026-09-18 in Google's index, image rev 7), so it runs arm64 libraries under
  translation even if the universal APK were somehow split.
- **GOTCHA**: do not edit `eas.json`'s `distribution` or `app.json`'s cleartext entry.
  `apps/driver/src/build-config.test.ts` (#222) binds them and will go red.
- **VALIDATE**: `adb shell pm list packages | grep lv.saktacab.driver`
- **SATISFIES**: AC #4

---

### T8 — GATE 2: pings at ~4 s, app foregrounded

- **IMPLEMENT**: Boot the stack per the runbook §1 (which cites #14's §Level 4 §B — do not restate
  it). Sign in on the emulator as a driver, grant location "Allow all the time" through the in-app
  flow, tap the availability toggle ON. Watch the api console.
- **PATTERN**: the runbook's step 1 and step 2 Expect cells — read them; do not copy them here.
- **IMPORTS**: none.
- **GOTCHA**: **pings only.** The runbook's step 2 is a hard gate that *also* requires the driver
  visible on `/dispatch`. Board visibility adds the socket and the board slice as failure surfaces to
  a gate whose only job is "does injection reach the app". Keep them separate: board visibility is
  judged in Phase E, as step 2 proper.
- **GOTCHA**: the injection loop from T6 must be running before the toggle goes ON, or the app's first
  fix is Mountain View and `findNearby` matches nothing for the rest of the session.
- **GOTCHA**: `adb shell pm grant lv.saktacab.driver android.permission.ACCESS_BACKGROUND_LOCATION`
  is a **fallback only**. Granting by `adb` skips the in-app permission flow that step 1's Expect cell
  describes, so it changes what step 1 proves. Use the in-app flow; fall back only if it is
  unreachable, and record the divergence.
- **GOTCHA**: read `clientAt`, not `at`, when timing the cadence —
  `services/api/src/features/drivers/location/driver-location.service.ts:77-79` is where both are
  logged, and the runbook's note at `:233` (*Which timestamp, and why 12 s*) explains why the server
  clock bunches into a burst after a socket blip while `clientAt` stays ~4 s apart.
- **GOTCHA — make the api console readable, or this gate is judged by eye.** Start the api with its
  output teed to a file, and read the file. Scrolling terminal output is not evidence and cannot be
  attached to the report:
  ```bash
  COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api dev 2>&1 | tee /tmp/api-224.log
  ```
- **VALIDATE**:
  ```bash
  # 60 s window; expect ~15 accepted pings (derived: 60 s / 4 s wire cadence)
  grep -c "driver.location.ping_accepted" /tmp/api-224.log
  grep "driver.location.ping_accepted" /tmp/api-224.log | tail -20   # read clientAt, not at
  ```
  A count near 15 over 60 s is the pass. **Fewer than ~8 is not automatically a ❌** — count from the
  first ping, not from when you started watching.
- **❌ MEANS**: the app is not receiving the injected fixes while foregrounded. Not yet a verdict on
  the route — first rule out sign-in, origin and permission faults using the runbook's §4 rules.
- **SATISFIES**: AC #3

---

### T9 — GATE 3: pings continue, app backgrounded

- **IMPLEMENT**: With the injection loop still running and the toggle ON, send the app to the
  background (`adb shell input keyevent KEYCODE_HOME`). Do not touch it for 60 s. Watch the api
  console for `ping_accepted` throughout.
- **PATTERN**: the runbook's step 5 reading rules apply verbatim — the field, the 12 s threshold, and
  "the ❌ is a stream that goes quiet and stays quiet" (the step 5 row at `:222`, and its note at
  `:233`). **Cite them; the run sheet owns them.**
- **IMPORTS**: none.
- **GOTCHA**: this is the one phase whose outcome is genuinely unknown, and it is the whole ticket.
  `LocationTaskConsumer.handleLocationUpdate` branches on `mIsHostPaused`: foregrounded it reports
  immediately, backgrounded it goes through `deferLocations` + `maybeReportDeferredLocations`.
  `location-options.ts:21-22` sets `deferredUpdatesInterval: 0` and `deferredUpdatesDistance: 0`, so
  deferral should be a pass-through — but the background branch is code the foreground gate never
  executes, so Gate 2 passing tells you nothing about it.
- **GOTCHA — split the ❌ before recording it.** Two different failures look identical:
  - **(a) deferral swallowed it** — the OS is still delivering to the consumer but nothing is
    reported onward. Distinguish it with `adb logcat -s ExpoLocation:* TaskManager:*`: deliveries
    appear, reports do not. **This does not kill the route and does not bear on #141** — it is a
    finding about the deferral path, and a separate ticket.
  - **(b) the mock provider does not feed background FLP** — deliveries stop at the OS boundary; no
    delivery lines at all in the same logcat window. **This kills the route.**
  Record which one, with the logcat evidence that separated them. "Gate 3 failed" alone is not a
  usable result.
- **VALIDATE**: `ping_accepted` still arriving at t+60 s with no sustained `clientAt` silence;
  `adb logcat -d -s ExpoLocation:*` captured for the window either way
- **SATISFIES**: AC #3, AC #5

---

### T10 — RUN the runbook's steps 2–8 on the emulator

- **IMPLEMENT**: Open `docs/runbooks/driver-device-day.md` §Steps and run rows **2 through 8** exactly
  as written, including step 3's "open `t/<token>` before the watch starts". Record each row pass or
  fail in the Result table's own terms.
  - **Row 2 is entered here for its board-visibility half only** — T8 covered its ping half and
    deliberately narrowed away the board. Without this sub-step step 2's hard gate is never fully
    judged, because rows "3 through 8" do not contain it. Judge it, and say which half T8 supplied.
- **PATTERN**: the runbook's §Verdict rule: steps 4, 5, 7, 8 are load-bearing and binary; 6 is
  corroborating; 1–3 are setup. **Do not re-derive that set — it was re-derived once, deliberately,
  and the issue comment history turns on it.**
- **IMPORTS**: none.
- **GOTCHA**: steps 1 and 2 are already covered by T8 with one deliberate narrowing (pings only).
  Step 2's board-visibility half is still owed — judge it here, and say so, rather than marking step 2
  green on T8's evidence.
- **GOTCHA**: a failure is a finding. "Mostly worked" is not a result — the runbook says so at `:35`.
- **GOTCHA — steps 4 and 8 are taps, and they are deterministic; do not guess pixel coordinates.**
  Dump the view hierarchy, read the toggle's `bounds`, tap its centre:
  ```bash
  adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml /tmp/ui.xml
  grep -o 'content-desc="[^"]*"[^>]*bounds="[^"]*"' /tmp/ui.xml   # find the toggle, read [x1,y1][x2,y2]
  adb shell input tap <cx> <cy>
  adb exec-out screencap -p > /tmp/after-tap.png                  # the visual Expect cell, as evidence
  ```
  Re-dump after the tap: step 4's Expect is *the toggle springs back to ON plus a banner*, and both
  are assertable from the hierarchy (the banner's text) rather than from looking at a screenshot.
- **GOTCHA**: record that the taps were `adb input` and not a finger. It is a real divergence from
  what a phone run proves about the touch target — the 44px minimum is a UX rule elsewhere in this
  repo, and an `input tap` at exact centre coordinates proves nothing about it.
- **VALIDATE**: every row of the Result table filled; steps 4, 5, 7, 8 each ✅ or ❌ with the signal
  that produced it
- **SATISFIES**: AC #4

---

### T11 — UPDATE `docs/runbooks/driver-device-day.md` with an `## Emulator route` section

- **IMPLEMENT**: One new section covering: the three gates and their pass/fail meaning; the SDK/AVD
  setup (T2–T4) with the actual measured size; the injection loop; the `google_apis` and
  longitude-first gotchas; and the evidence-grade caveat — what an emulator run does and does not
  prove. Update the Result table's `Platform` row rather than adding a second table.
- **PATTERN**: `:86-88` — cite, do not restate. The section refers to steps 2–8 **by number**.
- **IMPORTS**: none.
- **GOTCHA**: **if you write an Expect cell, you have created the fourth copy of the run sheet.** This
  is the exact defect PR #218 shipped to close. The section describes *setup and gates*; the steps
  stay where they are.
- **GOTCHA**: the file is 322 lines of prose with dense internal line references. Adding a section
  anywhere but the end shifts line numbers that other artifacts cite — **append after `:322`, at the
  very end of the file. Insert nothing above `:290` (§Verdict) and nothing inside §Also on this day
  (`:311`).** Every reference this plan makes into the file (`:13`, `:35`, `:37`, `:86`, `:222`,
  `:233`, `:246`, `:282`) is above `:290` and survives a pure append; "below §Verdict" must not be
  read as "inside §Verdict". The one exception is the Result table at `:13-22`, which is **edited in
  place, not moved** — a value changes, no line is added. PR #218's review round 1 spent three
  findings on shifted line refs.
  **The same licence extends to any claim this ticket falsifies**, and it had to: §Result's
  "Android emulator: no SDK on this machine" bullet (`:25-28`) and its "Both substitute paths are
  closed" line (`:23`) both became false the moment the SDK installed. Rewrite such a claim **at a
  constant line count** — 4 lines stay 4 lines — then re-read `:35`, `:37`, `:86`, `:222`, `:233`,
  `:246`, `:282`, `:290`, `:311` and confirm each still resolves to its original text. Leaving a
  falsified claim standing because "the plan said append only" is the worse defect.
- **VALIDATE**:
  ```bash
  grep -c "Expect" docs/runbooks/driver-device-day.md    # must not grow
  grep -rn "driver-device-day.md:" .claude/ docs/ | wc -l  # then spot-check the refs still resolve
  ```
- **SATISFIES**: AC #6

---

### T12 — VALIDATE no regression

- **IMPLEMENT**: Run the full gate. This ticket changes no shipped source, so a red gate means
  something unrelated moved — see the environment notes in NOTES before diagnosing code.
- **PATTERN**: `CLAUDE.md` §Commands — the gate is `pnpm turbo run typecheck lint test build --force`,
  and `pnpm check` is not it.
- **IMPORTS**: none.
- **GOTCHA**: run it with `COMPOSE_PROJECT_NAME=taxi`, and one gate at a time across sessions — the
  test DB is shared and integration runs are mutually destructive.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` exits 0
- **SATISFIES**: AC #7

---

### T13 — RECORD the verdict on #224 and #141

- **IMPLEMENT**: Comment the outcome on both issues. On #224: which gate terminated the run, the
  evidence line, and the measured SDK cost. On #141: whether its four load-bearing steps now have a
  verdict, and on what grade of evidence — **do not close #141 without Linards' answer to Q1.**
- **PATTERN**: #141's existing comments — each states what is done, what is not, and what unblocks it.
- **IMPORTS**: none.
- **GOTCHA**: keep closing keywords away from `#N` unless you mean them. A backticked `Closes #N` has
  merged without closing, and prose mentioning a number has closed an issue nobody meant to close.
- **GOTCHA**: this task runs on **every** path, including a Gate 1 ❌. A negative result that is never
  written down means the next person pays the install again to learn the same thing.
- **VALIDATE**: `gh issue view 224 --comments` and `gh issue view 141 --comments` show the verdict
- **SATISFIES**: AC #5, AC #8

---

## TESTING STRATEGY

### Unit Tests

**None, and that is a deliberate statement rather than an omission.** This ticket changes no file
under any `src/`, so there is no slice to mirror and the "≥1 expected + 1 edge + 1 failure case" rule
has no surface to apply to. The two things that *could* have been tested here are already tested
elsewhere: the reducer's held branch by `presence-state.test.ts` (#142), and the api's sweep/nudge
behaviour by `driver-presence.integration.spec.ts` (#145). The residual claim is precisely the one
jest cannot reach — which is why this ticket exists.

If implementation finds itself adding a test, that means it has changed source, which is Out of Scope.

### Integration Tests

None added. `apps/driver`'s jest setup fakes every native module by design, so no integration test in
this repo can observe the OS background task; that is the premise of the whole runbook.

The socket/realtime rule (an integration test must connect in the order the app actually does) does
not apply: nothing here touches `features/realtime`, and the emulator run *is* the app's real order.

### Edge Cases

Every case names where it is verified. This ticket's surface has no test framework, so most are owned
by a numbered task above — which is the explicit assignment the plan template requires, not a gap.

| # | Edge case | Verified by |
|---|---|---|
| E1 | Emulator boots in Mountain View; a Californian fix matches no seeded zone | T6 (inject before T8's toggle) + T8's second GOTCHA |
| E2 | `geo fix` arguments reversed — a plausible fix that never matches | T6 GOTCHA; caught by `dumpsys` reading ~56.95 / ~24.10 |
| E3 | One injected fix ≠ a stream | T6b — the last-known timestamp must advance across two reads ≥10 s apart |
| E4 | AOSP image has no Play services, so the fused provider is absent | T3 (`google_apis` pin) + T5 (`pm list packages` pre-check) |
| E5 | APK has no `x86_64` slice | T7 — covered twice over (universal template ABI list, plus the image's `translatedAbis: arm64-v8a`); if it still happens, `adb install` fails `INSTALL_FAILED_NO_MATCHING_ABIS` and that is recorded, not worked around |
| E6 | Gate 3 fails via deferral rather than via the mock provider | T9's split verdict, separated by `adb logcat -s ExpoLocation:*` |
| E7 | Host DHCP lease moved since the APK was built, or the host firewall drops the LAN round trip | T7 — **removed rather than checked**: the emulator build bakes `10.0.2.2`, the NAT's fixed alias for the host loopback, so neither can apply. §0's pre-flight is skipped for emulator runs only |
| E11 | The JDK install prompts for sudo and hangs the unattended phase | T2 — `openjdk@17` formula, not the `temurin@17` cask |
| E12 | `avdmanager` or `sdkmanager` blocks on an interactive prompt | T3 (`yes \|` for licences), T4 (`echo no \|` for the hardware profile) |
| E13 | The EAS login is missing and is discovered only after the download | T0 — `whoami` in the first minute |
| E8 | JDK 14 breaks `sdkmanager` in a way that does not name the JDK | T2 — explicit `JAVA_HOME`, validated by `java -version` reading 17 |
| E9 | Emulator falls back to software rendering, too slow to judge a 4 s cadence | T4 GOTCHA — `emulator -accel-check` |
| E10 | A new section shifts every line number cited into the runbook | T11 GOTCHA — append below §Verdict, then re-check refs |

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint --force
```

Nothing under any `src/` changes, so this is a no-regression check, not a check of this ticket's work.

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/driver test
```

Expected unchanged from `main`. If the driver suite moves, this ticket touched source it should not have.

### Level 3: Integration Tests

```bash
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test
```

Also a no-regression check. Note the Redis-gated suites: without `REDIS_TEST_URL` the run is 39 tests
and 2 suites short of the full count.

### Level 4: Manual Validation

**Every step below is performable with what exists today, except where a Prerequisite says otherwise.**

1. **Gate 1** — T6. Performable after T2–T4 with no account, no credential and no build. This is the
   step that decides the ticket, and it is the cheapest one.
2. **Gate 2** — T8. Needs the EAS login and a build credit (BLOCKING PREREQUISITE), plus the local
   stack booted per the runbook §1 and a dispatcher provisioned per its §1 tail.
3. **Gate 3** — T9. Same prerequisites as Gate 2.
4. **Steps 2–8** — T10, against `docs/runbooks/driver-device-day.md` §Steps. The state each step needs
   — an accepted ride, a tracking token — is produced by the run itself, per the runbook's step 3;
   the seed produces none of it, which is why step 3 books a ride rather than assuming one.

### Level 5: Additional Validation (Optional)

`adb logcat -s ExpoLocation:* TaskManager:* LocationManagerService:*` captured across the Gate 3
window, saved to the scratchpad. It is the only artifact that separates T9's two failure modes, and it
is worth capturing on a pass too, as the positive control for the next person.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1** — P1–P4 are re-derived at the implementing sha, not inherited from this plan, and each
      carries the command that produced it (T1, T5)
- [ ] **AC2** — The Android SDK, an API 36 `google_apis` x86_64 system image and a bootable AVD exist
      on this machine, with the **measured** install size recorded (T2–T4)
- [ ] **AC3** — Gates 1, 2 and 3 each have a recorded verdict with the evidence line that produced it;
      a ❌ names which route it kills, and Gate 3's ❌ names which of its two modes occurred (T6, T8, T9)
- [ ] **AC4** — *Conditional on Gate 3 green*: `docs/runbooks/driver-device-day.md` steps 2–8 are run
      on the emulator and its Result table is filled (T10)
- [ ] **AC5** — The evidence-grade caveat is stated explicitly wherever the result is recorded: what an
      emulator run proves about #141's teardown claim, and what it does not prove about Doze, OEM
      process killers or real radios (T9, T11, T13)
- [ ] **AC6** — The runbook gains exactly one `## Emulator route` section, which cites steps 2–8 by
      number and restates none of them; its `Expect` count does not grow (T11)
- [ ] **AC7** — `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` exits 0 (T12)
- [ ] **AC8** — #224 and #141 each carry the verdict, on every path including a Gate 1 ❌ (T13)
- [ ] **AC9** — **Owed by Linards, not by this ticket**: whether emulator evidence is accepted as
      closing #141 (Q1). This plan does not decide it and the implementation must not either.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

**Q1 — Does emulator evidence close #141, or only de-risk the phone day?** *(owed to Linards; this
plan states its assumption and does not act on it)*

**Assumed**: Gates 1–3 green plus steps 4, 5, 7 and 8 green on the emulator **closes #141**, while #4
and #14's device day stand unchanged.

The reasoning, stated so it can be rejected: #141's claim is about **task lifecycle** — was the
background task torn down before the api answered? An emulator runs the real Android framework, the
real Play-services fused provider, the real foreground service and the real `expo-location` consumer.
The only synthetic element is the GPS source, and the claim is not about GPS quality. What an
emulator does not reproduce — Doze, OEM process killers, real radios, battery — bears on background
*reliability*, which is #4's and #14's question, not #141's.

Against it: `.claude/plans/driver-device-day-prep.md:72-74` rejected the emulator partly on "the
evidence it would produce is weaker than a device's". That is true in general and, this plan argues,
not true on the specific axis #141 tests. **#141 is Linards' issue to close — T13 records the verdict
and asks; it does not close.**

**Q2 — The EAS login and build credit.** Blocking for Phases C–E, not for A–B. See BLOCKING
PREREQUISITE. An implement pass should deliver Gate 1's verdict and stop rather than stall.

**Q3 — If Gate 3 fails through deferral (T9 mode (a)), is a config change in scope?** **No.** It would
be a change to `location-options.ts`, which is Out of Scope, and it would be a fix to a path #141 does
not test. File it; do not fix it here.

**Q4 — Can an agent drive the emulator end to end?** The *mechanism* is now specified rather than
assumed — T10 dumps the view hierarchy with `uiautomator dump`, reads the toggle's `bounds`, taps its
centre with `adb shell input tap`, and captures `adb exec-out screencap -p`. None of that needs the
accessibility permission that closes the iOS Simulator to an agent on this machine. What is still
`expected` is only that it works on this image, which T10 settles by doing it.

**If it holds, it is larger than this ticket.** Every manual device step in #14's and #16's run sheets
becomes agent-performable, and the "owed to a human" column shrinks across several issues. Still not
in scope here: open that follow-up once Gate 3 has actually passed, because until then it is a
consequence of a route that may be dead. Record in the report whether the taps worked, so the
follow-up starts from evidence.

**Q5 — Worst-case ordering inside Gate 3.** The question "does the stream survive backgrounding" has a
typical case (pings continue, visibly) and a worst case that must be the one recorded: the stream
continues for ~30 s on a drained deferral buffer and *then* stops. A 60 s watch with a 12 s
quiet-threshold covers it; a 20 s glance does not. T9's window is 60 s for that reason, and the
runbook's step 5 uses 90 s for the stronger claim, which is why T10 does not simply reuse T9's result.

**Assumption A1** — The emulator reaches the host's LAN address through its NAT, so the baked origin
works unchanged. `expected`. If it does not, `10.0.2.2` is the host-loopback alias, but switching to
it costs a rebuild because the origin is inlined at bundle time — so try the baked value first (T7).

**Assumption A2** — `expo-template-bare-minimum@57.0.25`'s ABI list is what `expo prebuild` will use
for `expo@~57.0.18`. `observed` for 57.0.25 itself; the version resolution is `expected`. T7's install
step is where a wrong assumption surfaces, cheaply.

**Assumption A3 — retired by measurement.** The SDK is **5.9 GiB on disk**, `observed` via `du -sh`
after a completed install (exit 0, 2026-09-18), plus 172 MB for the Adoptium JDK tarball. The planning
estimate of ~3 GiB was low, and the `derived` 2.29 GiB download figure it rested on turned out not to
describe this install at all — `sdkmanager` resolved a different emulator revision than the index row
that figure summed. **Quote the measured on-disk number.** This is the whole reason the rule says to
re-derive rather than inherit.

---

## NOTES (open canvas)

### Why not a trivial probe harness

The first shape of this plan built a minimal Expo app to test the premise in isolation. It was
dropped: a separate project needs its own EAS build, which is the same credit and the same wait as
the real APK, and it would test a *different artifact* than the one #141's evidence has to come from.
Reusing the `preview` APK costs nothing extra, because Phase C needs it regardless — and Gate 2
doubles as the isolation step the harness was meant to provide.

The isolation the harness *did* offer is preserved more cheaply by T5 (`pm list packages` for Play
services) and T6 (`dumpsys location` before any app is involved). Both are zero-build.

### Why not a local `expo run:android` build

Considered, because the SDK will be installed anyway and a local build would remove the EAS login,
the build credit and the origin-baking problem all at once (a local build inherits the invoking
shell's environment; `10.0.2.2` would work without a rebuild).

Rejected on **evidence transfer**: the phone day installs the EAS `preview` APK, and if the emulator
run uses a different artifact, a green emulator run says less about the phone run than it appears to.
A debug-variant local build diverges further still — different signing, Metro-served JS, different
cleartext defaults.

Kept as the fallback for one case only: the EAS login is unavailable and Gate 1 has already passed.
Its cost is JDK 17 (already installed by T2) plus the NDK and a first Gradle build — roughly 2 GiB
more download (`expected`) and a long first compile on an i9. If it is used, record it as a divergence,
because it changes what the run proves.

### What the three gates cost, in order

| Gate | Costs | Answers |
|---|---|---|
| 1 | **5.9 GiB on disk** (`observed` — see T3), ~45 min unattended, no account | Does the emulator feed the fused provider a *stream*? — **PASSED 2026-09-18** |
| 2 | one EAS build credit + a human login + the local stack | Does the app receive it, foregrounded? |
| 3 | nothing further | Does the **background** consumer receive it? — the premise |

### Risk register

Every risk that could stall a one-pass execution, and what happened to it. **Retired** means an
`observed` fact or a plan change removed it, not that it was judged unlikely.

| # | Risk | Status | What retired it |
|---|---|---|---|
| R1 | No Android emulator build for Intel macOS | **retired** | `emulator` 37.2.10 publishes `emulator-darwin_x64-16349944.zip`, 466.1 MiB, host-arch `x64` (`observed`, `repository2-3.xml`) |
| R2 | `system-images;android-36;google_apis;x86_64` is not a real package | **retired** | published at rev 7, 1 895 447 397 B (`observed`, `sys-img2-4.xml`) |
| R3 | Emulator too old for the image | **retired** | the image declares `dependency emulator ≥ 35.4.9`; published is 37.2.10 |
| R4 | Wrong brew cask name or install path | **retired** | `android-commandlinetools` 15859902 → `/usr/local/share/android-commandlinetools/cmdline-tools/latest/bin/{sdkmanager,avdmanager}` (`observed`, `brew info --cask`) |
| R5 | The JDK install prompts for sudo and hangs an unattended phase | **retired** | neither brew route is used: the Adoptium tarball unpacks into `$HOME`, no sudo (`observed`, T2) |
| R5b | **`brew install <formula>` builds from source on this Intel Mac and never finishes** | **retired — and only a real run could have found it** | Homebrew dropped Intel x86_64 bottles (Sept 2026). `observed` 2026-09-18: the planned `brew install openjdk@17` began compiling from GNU source tarballs. Replaced by the Adoptium tarball; the cask route was separately confirmed to still work |
| R6 | Two `adb`s at different revisions | **retired** | the installed cask is 37.0.1 and Google's `platform-tools` is 37.0.1; `platform-tools` dropped from the install list, one `adb` on `PATH` |
| R7 | APK has no ABI the emulator can run | **retired twice** | the template's universal ABI list includes `x86_64`, *and* the image declares `translatedAbis: arm64-v8a` |
| R8 | Baked LAN origin stale or blocked by the host firewall | **retired** | build with `10.0.2.2`, a property of the emulator's NAT that cannot go stale (T7) |
| R9 | `avdmanager create` blocks on its custom-profile prompt | **retired** | `echo no \|` |
| R10 | A wrong `-d` device id fails the create | **retired** | `-d` dropped; the default profile is sufficient |
| R11 | `adb wait-for-device` returns before boot and everything after races it | **retired** | poll `sys.boot_completed` |
| R12 | `sdkmanager --licenses` blocks unattended | **retired** | `yes \|`, with the licence named |
| R13 | A `dumpsys` heading change breaks Gate 1's grep | **retired** | grep the injected coordinate, never a heading |
| R14 | One stale fix read as a live stream | **retired** | Gate 1's 6b diff over two captures ≥10 s apart |
| R15 | `geo fix` longitude/latitude reversed | **retired** | stated as a GOTCHA, and the coordinate grep catches it |
| R16 | A 2 s injection loop misread as predicting 2 s pings, marking a healthy stream ❌ | **retired** | the throttle sentence in T6's PATTERN |
| R17 | Steps 4 and 8 need a human finger | **retired** | `uiautomator dump` → `bounds` → `input tap` → `screencap`, with the divergence recorded |
| R18 | The api console is judged by eye and cannot be attached as evidence | **retired** | tee to `/tmp/api-224.log`, assert with `grep -c` |
| R19 | Step 2's board half falls through the "rows 3 through 8" range | **retired** | T10's explicit row-2 sub-step |
| R20 | Editing the runbook shifts line numbers other artifacts cite | **retired** | append after `:322` only; nothing inserted above `:290` |
| R21 | Work committed to a dead branch, or sweeping up an orphan review file | **retired** | T0's worktree off `origin/main`, and the orphan named |
| R22 | The EAS login turns out to be missing 40 minutes into the run | **retired, and the answer is known** | `observed` 2026-09-18: `whoami` → `linards`, exit 0. A live session exists; no interactive login is needed. T0 re-checks only because a session can expire |
| R23 | The wrong API 36 variant (`36.1`, `-ext18`, `-ext19`) installed | **retired** | plain `android-36` pinned, with the variants named |
| R24 | The emulator falls back to software rendering, too slow to judge a 4 s cadence | **retired** | `observed`: `accel-check` → `accel: 0`, Hypervisor.Framework on macOS 15.7; the AVD booted in ~90 s |
| R25 | **The emulator refuses to start without `platform-tools` inside the SDK root** | **retired — found only by running it** | `observed`: the first boot died with `FATAL \| Cannot find AVD system path`, after four `platform-tools subdirectory is missing` warnings. T2's original "skip platform-tools, the cask supplies adb" GOTCHA was wrong. Install it into the SDK root **and** export `ANDROID_SDK_ROOT` |
| R26 | **Gate 1 as designed was unfalsifiable and would have killed the route on a false negative** | **retired — found only by running it** | `observed`: `adb emu geo fix` returns `OK` yet writes nothing, because with no client requesting location the `gps provider` is `ProviderRequest[OFF]`, `mStarted=false`. Gate 1 rebuilt on `cmd location` test providers, which need no client |
| R27 | A driver-side guard rejects mock-flagged fixes | **retired** | `observed`: no `isMock`/`isFromMockProvider` read anywhere in `apps/driver/src` shipped source |

**Residual, and none of it is a plan defect:**

- **Res1 — the spike's own answer.** Whether background FLP receives mock fixes is *the question*,
  not a risk to the plan. Both branches are specified, and both produce a usable verdict.
- ~~**Res2 — one EAS build credit.**~~ **Retired 2026-09-18 by running T7.** EAS granted a build on
  the free tier — queued 5 s, ran 468 s — so neither the login nor the credit was ever the constraint.
  **What replaced it is worse and was not on this register at all**: the build *errored*, in native
  compilation, on `main`'s own head. See AMENDMENTS A1 and
  [#225](https://github.com/linardsb/taxi/issues/225). The register asked "will EAS let us build?" and
  never asked "does this tree compile for Android?" — nothing in the repo's gate answers the second,
  because nothing in the workspace compiles Android C++.
- ~~**Res3 — this host's actual emulator runtime.**~~ **Retired 2026-09-18 by executing Phase B.**
  The SDK installs, the AVD boots in ~90 s under Hypervisor.Framework, the image carries Play
  services, and a synthetic fix reaches the fused provider. Three defects in this plan were found in
  the process (R5b, R25, R26), each of which would have stopped an implement pass.

Gate 1 is the cheapest and the most decisive, which is the whole reason for the ordering: the
expensive prerequisites are only paid for after the free answer comes back positive. **It came back
positive on 2026-09-18**, so the ordering has already paid for itself — and it cost three plan
defects found (R5b, R25, R26) that an implement pass would otherwise have hit one at a time.

### The branch situation, before anything is committed

At planning time the main checkout sat on `feature/driver-device-day-prep`, which is `gone` on origin
and strictly **behind** `main` (a two-dot diff `main → HEAD` is deletions only). Anything committed
there lands on a dead branch. **Branch from `origin/main`** — and in a worktree, since sessions share
this checkout, with `COMPOSE_PROJECT_NAME=taxi` for anything DB-touching.

One loose file is in the same checkout and is not this ticket's: `.claude/code-reviews/pr-221-review.md`
is untracked while `main` already carries `pr-221-review-fixes.md`. It is the orphan shape the review
convention warns about, and a `piv-commit` here could sweep it into an unrelated PR. Do not let it
ride along.

### If Gate 1 fails

That is a good outcome, not a wasted one. It converts "a multi-GB detour with an uncertain end" into a
measured fact with a number attached, and it retires the emulator question permanently rather than
leaving it to be re-litigated the next time #141 comes up. T13 runs anyway — write it down, with the
size, so nobody pays twice for the same answer.

## AMENDMENTS

<!-- append-only; newest at the bottom -->

### A1 — 2026-09-18, implement pass (`spike/emulator-oracle-224`)

**T6a's single-shot read is a false negative on a cold-booted emulator.** The task injects one fix
and reads the fused provider. `observed` this pass: one `set-test-provider-location` on a freshly
booted AVD left the **fused** provider at `last location=null` / `ProviderRequest[OFF]` while the
`gps` provider already carried the fix. The fused provider only populated after a **repeating**
injection (8 calls over 16 s). The planning run did not hit this because its emulator had been
running longer, so the HOST STATE table's Gate 1 row records a true result reached by a mechanism
the task as written does not reproduce. **Start the injection loop first, then read.**

This also narrows T6's `❌ MEANS`. "This branch is now unreachable — 6a passed on 2026-09-18" is
still true of the *verdict*, but a future pass must not read it as "6a cannot fail here": run
6a against a loop, not a single call, or it can fail on mechanism rather than on the premise.

**Gates 2 and 3 were NOT RUN**, and are not ❌. T7's EAS build errored on a native compile failure
that exists on `origin/main` — filed as [#225](https://github.com/linardsb/taxi/issues/225). A
future pass resumes at T7 once #225 lands; T0–T6 need no repeating beyond re-booting the AVD.

**Also folded into the tasks themselves**, rather than left here, because they change how a resuming
pass executes rather than what it concludes: T7 now carries the exact unattended command sequence
(`init --account … --non-interactive`, the host-only origin edit that keeps the committed port, and
`build … --no-wait`), what `eas init` really mutates, how to re-link for `build:view`, and the fact
that EAS build logs are brotli. T11 now says a claim this ticket *falsifies* may be rewritten above
`:290` at a constant line count — which it had to be, since §Result's "no SDK on this machine" bullet
stopped being true.

**Phase order ran T7 before re-running T4–T6.** Gate 1's cost was already paid at planning time and
the cloud queue was the only unbounded wait left; no dependency was violated, since T7 depends on
Gate 1 and Gate 1 had passed. A resuming pass should do the same.

**T8, T9 and T10 did not run at all.** T10's Result-table fill and its row-2 board half are still
entirely owed.

Full evidence, deviations D1–D14 and the acceptance-criteria state:
`.claude/reports/emulator-oracle-141-report.md`.

### A2 — 2026-09-18, PR #226 review round 1 (M1, M2, L1–L3)

**The step range is 2–8, not 3–8, everywhere in this plan.** T10's IMPLEMENT (`:766`) always said
"rows 2 through 8"; its own title and seven other places in this plan said 3–8, and the shipped
runbook section followed the IMPLEMENT. Row 2 is a **HARD GATE** whose second half is "the driver
visible on the board", and nothing in Gates 1–3 covers the board — Gate 2 asks only
`driver.location.ping_accepted`. The widening closes a real hole, so the plan is reconciled to the
wider set rather than the section narrowed to the plan. Eight lines changed: `:55`, `:63`, `:244`,
T10's title, T11's PATTERN, the Level-4 validation list, AC4 and AC6. Recorded as D14 in the report.

**A1's deviation range above was `D1–D12` and is corrected in place to `D1–D14`.** D13 already
existed when A1 was written and the PR body discussed it by number in the same breath; D14 is this
amendment's own entry. Correcting a stale count is not a rewrite of A1's substance.
