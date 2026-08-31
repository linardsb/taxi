# Spike #4 — Expo background GPS field test

**Status: deferred (2026-08-26) — no field run; #14 proceeds on the mounted-phone default and is no longer blocked.** The decisive Android run needs Atis's phone (unavailable; the APK kit stays live for any pilot Android phone). The iOS run needs either a cable install from the Mac or, for a link install like the Android kit, the paid Apple Developer Program (Apple's ad-hoc rule) — deferred to the driver app's first TestFlight build, which carries the same location code, as an early #14 QA drive. #14's design is therefore the superset (Linards, 2026-08-26; the #4 and #14 comments): the harness's exact `startLocationUpdatesAsync` options **plus** keep-awake while online, background best-effort, server-side gap tolerance — a later PASS changes nothing. Issue [#4](https://github.com/linardsb/taxi/issues/4) stays open until one leg runs; #15 unaffected.

## Research verdict

`expo-location` + `expo-task-manager` background tracking is current, supported API on Expo SDK 57 — but it **requires a development build** (Expo Go dropped background location on both platforms; Android needs a foreground service, which Expo Go can't run). Key facts:

- **iOS**: `UIBackgroundModes: location` + "Always" permission keeps the app alive indefinitely while tracking — no background time limit. Must set `pausesUpdatesAutomatically: false` and `activityType: AutomotiveNavigation`. Force-quit stops tracking until next manual launch ([expo docs](https://docs.expo.dev/versions/latest/sdk/location/), [expo#3503](https://github.com/expo/expo/issues/3503)).
- **Android**: needs a persistent foreground-service notification (`FOREGROUND_SERVICE_LOCATION`, Android 14+). Doze + OEM battery killers (Samsung/Xiaomi — see [dontkillmyapp.com](https://dontkillmyapp.com)) can batch fixes into rare multi-minute deliveries despite zeroed intervals ([expo#13700](https://github.com/expo/expo/issues/13700), [expo#14076](https://github.com/expo/expo/issues/14076), [expo#9200](https://github.com/expo/expo/issues/9200)). Tracking must be started while the app is foregrounded (Android 12+ FGS rule, [expo#32545](https://github.com/expo/expo/issues/32545)).
- **Expectations**: 1 fix/4–5s achievable on iOS and stock-ish Android; ~5–8%/hr battery for continuous tracking (fine — driver phone is on a charger). Community issues on background gaps are chronic, so the real answer comes from this field test on the actual pilot phones (Atis's phone especially) — not yet run, see the status line.
- **Fallback if lossy (decided 2026-08-04: free option only, no paid library)**: treat background streaming as best-effort and design #14 around a **mounted, foregrounded phone** — hold the screen awake while online (`expo-keep-awake`, free), prompt for the Android battery-optimization exemption, and make the server tolerate short gaps. This is how working drivers operate anyway. [react-native-background-geolocation](https://github.com/transistorsoft/react-native-background-geolocation) (Transistorsoft, one-time $399+) noted for completeness but **rejected for now** — revisit post-pilot only if the mounted-phone pattern proves insufficient in real use. Free community forks (e.g. `@mauron85/react-native-background-geolocation`) are abandoned and not an option.

## Harness

`spikes/gps-harness/` — throwaway Expo app (outside the pnpm workspace; `pnpm check` never sees it). Online/offline toggle → background location task (`BestForNavigation`, `timeInterval` 4s, `distanceInterval` 10 m, no deferred batching, iOS automotive activity type, Android foreground service). Every fix is appended to `fixes.jsonl` (GPS timestamp, task-receive timestamp for batching detection, coords, accuracy, speed, battery level) and shown in an on-screen log that flags gaps >15 s in red. Export button shares the JSONL for analysis.

### Build & run

```bash
cd spikes/gps-harness
pnpm install --ignore-workspace   # standalone install, not part of the monorepo
npx expo run:android              # or: npx expo run:ios (device plugged in)
# generic Expo recipe; on this Mac build iOS from an out-of-repo copy — see "iOS from this Mac" below
```

`expo run:*` prebuilds a dev client with the background-location entitlements from `app.json`. When prompted, grant location **"Allow all the time"** (Android) / **"Always"** (iOS) — the harness requests foreground then background permission on first "Go online".

**iOS from this Mac** (observed 2026-08-25: iMac19,1, macOS 15.7.3, Xcode 26.3; derived: 26.4 needs macOS 26, which iMac19,1 cannot run, so 26.3 is this machine's ceiling). SDK 57 does **not** compile here from source (`EXPO_USE_PRECOMPILED_MODULES=0`; the precompiled default was not tried — expected to fail on the newer-compiler `.swiftinterface` check, not observed): `expo-modules-jsi@57.0.4` fails on a Swift `abs()` ambiguity (`JavaScriptCodable+Date.swift:53`) and `57.0.5` on `SWIFT_RETURNS_RETAINED` applied to a constructor (`RuntimeScheduler.h:61`); both fail on 26.3's compiler; the first is a source bug 57.0.5 fixes (its changelog: `abs(_:)` ambiguous "under newer toolchains", replaced by `.magnitude`, expo/expo#49039), the second a construct 57.0.5 added for Xcode 27 (changelog, expo/expo#49120) — untested on 26.4. What builds: an `rsync` copy of the harness outside the repo (the PR #115 Android recipe — not in the monorepo checkout), downgraded with `npx expo install expo@~55.0.0 --fix` (SDK 55, RN 0.83.10, iOS floor 15.1; `--fix` also adds `expo-sharing` to the copy's `app.json` plugins), then `CI=1 npx expo run:ios --configuration Release --device <udid>` — `CI=1` and an explicit `--device` keep the CLI from opening a picker. Release embeds `main.jsbundle`, so the phone runs without Metro; products land in `~/Library/Developer/Xcode/DerivedData/GPSSpike-*/Build/Products/`, not `ios/build`. The SDK 57 Podfile defaults `RCT_USE_PREBUILT_RNCORE` and `EXPO_USE_PRECOMPILED_MODULES` to 1; export `EXPO_USE_PRECOMPILED_MODULES=0` to force Expo modules from source (SDK 55's Podfile has only the first switch). Do not downgrade the committed harness — the Android APK was built from SDK 57. A device install additionally needs an Apple ID in Xcode (free Personal Team: `xed ios` → Signing & Capabilities → pick the team; `security find-identity -v -p codesigning` must then list an `Apple Development` identity), Developer Mode on the phone, a cable, and it expires after 7 days. A link install (the Android-kit experience) needs the paid Apple Developer Program (then EAS internal distribution or TestFlight).

**Simulator pre-flight** (plumbing check, not evidence — SDK 55 build launched 2026-08-25, route not yet run): `xcrun simctl privacy booted grant location-always lv.saktacab.gpsspike`, tap Go online, then `xcrun simctl location booted start --speed=14 --interval=1 56.9515,24.1132 56.9468,24.1210 56.9440,24.1150 56.9470,24.1050 56.9410,24.0950 56.9545,24.0960 56.9515,24.1132`, background the app (`xcrun simctl launch booted com.apple.Preferences`), wait ≥120 s, foreground it (`xcrun simctl launch booted lv.saktacab.gpsspike`) — the fix counter should have grown while backgrounded — Apple does not document simulator background delivery; if it grows only in the foreground, note it as a simulator limit and rely on the device check; `xcrun simctl location booted clear`. Read the file with `xcrun simctl get_app_container booted lv.saktacab.gpsspike data` → `Documents/fixes.jsonl`.

### Analyzing a run

```bash
node spikes/gps-harness/analyze.mjs spikes/gps-harness/data/<run>.jsonl
```

Drop exported `fixes.jsonl` files into `spikes/gps-harness/data/`, named per run: `android-default.jsonl`, `android-unrestricted.jsonl`, `ios.jsonl`, `ios-forcequit.jsonl` (resumption check — analyzer FAIL expected, not gated), `ios-plugged.jsonl` (only when battery was the sole failing metric). The script is zero-dependency (bare Node ≥18, `--selftest` built in): it splits sessions at >10 min `ts` jumps (forgotten "Clear"), separates moving from stationary gaps (`distanceInterval: 10` means a stopped phone legitimately goes quiet — only moving gaps are gated), and prints a ready-to-paste markdown block per session with a PASS / FAIL / INCONCLUSIVE verdict against the table below. Borderline zones (max gap 60–120 s, battery 8–12 %/hr) come out INCONCLUSIVE deliberately — that call is human.

## Field protocol

Per platform (Android on Atis's actual phone is the one that matters):

1. Charge phone to a known level, note the %. Go online **while the app is open**.
2. Drive ~30–45 min through central Rīga (mix of Vecrīga narrow streets, bridges, open boulevards). App backgrounded, **screen locked** the whole drive.
3. Android second run: repeat with battery-optimization exemption granted for the harness (Settings → Battery → Unrestricted) to compare.
4. iOS specifics: first "Go online" shows two prompts back to back — **Allow While Using App**, then **Change to Always Allow**. The second is one-shot: "Keep Only While Using" or "Allow Once" gives a run with zero background fixes and the app cannot ask again — fix it in Settings → Privacy & Security → Location Services → GPS Spike (must read **Always**, **Precise Location: On**), or delete and reinstall (this also deletes `fixes.jsonl`). Low Power Mode off, Background App Refresh on. Before locking, press Home and confirm the **blue location pill** in the status bar (`showsBackgroundLocationIndicator`; no pill = no background updates). Run unplugged despite Apple's "BestForNavigation only while plugged in" — battery is a gated metric; if battery is the *only* failing metric, add a 15 min plugged-in run (`ios-plugged.jsonl`) to show continuity with the battery variable removed. The force-quit check is its own short run (`ios-forcequit.jsonl`): online, drive ~5 min, force-quit, drive 2–3 min, relaunch, tap "Go online" again, drive ~5 min — the analyzer prints FAIL on the gap by design; judge it on one boolean, fixes resumed after relaunch.
5. Back home: **Export before every Clear** (Clear deletes the file); confirm the export landed on the Mac (`wc -l`) before touching the phone again; note the battery %.

**Record:** fix-gap distribution (median/p95/p99/max, from consecutive `ts` deltas), batch sizes (fixes sharing one `recvTs`), battery %/hr.

**Pass/fail:**

| Metric | PASS | FAIL |
|---|---|---|
| Gap while moving, screen locked | median ≤5 s, p95 ≤15 s, p99 ≤30 s, none >60 s | any gap >120 s, or task dies until relaunch |
| Batch size | p95 ≤3 fixes per delivery | sustained multi-minute batches (Doze) |
| Battery | ≤8%/hr | >12%/hr |

PASS → #14 proceeds as designed with these exact `startLocationUpdatesAsync` options. FAIL → #14 is designed around the free mounted-phone pattern instead: screen kept awake while online (`expo-keep-awake`), background streaming best-effort, server-side gap tolerance. No paid library for the pilot. *Superseded 2026-08-26 (status line): #14 ships the superset regardless of outcome; a later run decides only whether keep-awake can be relaxed after the pilot.*

## Field results

<!-- Paste analyze.mjs output per run. Note phone model + OEM + OS version — OEM battery policy is the known risk. -->

### Android — default settings (decisive run)

_Not run — Atis's phone unavailable (the iOS plan's premise, 2026-08-25; deferral decided 2026-08-26). The APK kit at gps-spike.linardsberzins.workers.dev stays live; run it when a pilot Android phone is in hand (early #14 task)._

### Android — battery-optimization exemption (Unrestricted)

_Not run — same as above._

### iOS

_Not run — a link install needs the paid Apple Developer Program, deferred to the driver app's first TestFlight build (early #14 QA drive); cable install declined (2026-08-26). Simulator: SDK 55 Release build launches on the iOS 26.2 simulator (observed 2026-08-25); the scripted background route was not run._
