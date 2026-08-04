# Spike #4 — Expo background GPS field test

**Status: harness + protocol ready — field drive pending (Linards).** Issue [#4](https://github.com/linardsb/taxi/issues/4), gates #14/#15.

## Research verdict

`expo-location` + `expo-task-manager` background tracking is current, supported API on Expo SDK 57 — but it **requires a development build** (Expo Go dropped background location on both platforms; Android needs a foreground service, which Expo Go can't run). Key facts:

- **iOS**: `UIBackgroundModes: location` + "Always" permission keeps the app alive indefinitely while tracking — no background time limit. Must set `pausesUpdatesAutomatically: false` and `activityType: AutomotiveNavigation`. Force-quit stops tracking until next manual launch ([expo docs](https://docs.expo.dev/versions/latest/sdk/location/), [expo#3503](https://github.com/expo/expo/issues/3503)).
- **Android**: needs a persistent foreground-service notification (`FOREGROUND_SERVICE_LOCATION`, Android 14+). Doze + OEM battery killers (Samsung/Xiaomi — see [dontkillmyapp.com](https://dontkillmyapp.com)) can batch fixes into rare multi-minute deliveries despite zeroed intervals ([expo#13700](https://github.com/expo/expo/issues/13700), [expo#14076](https://github.com/expo/expo/issues/14076), [expo#9200](https://github.com/expo/expo/issues/9200)). Tracking must be started while the app is foregrounded (Android 12+ FGS rule, [expo#32545](https://github.com/expo/expo/issues/32545)).
- **Expectations**: 1 fix/4–5s achievable on iOS and stock-ish Android; ~5–8%/hr battery for continuous tracking (fine — driver phone is on a charger). Community issues on background gaps are chronic, so the real answer comes from this field test on the actual pilot phones (Atis's phone especially).
- **Fallback if lossy**: [react-native-background-geolocation](https://github.com/transistorsoft/react-native-background-geolocation) (Transistorsoft) — one-time $399–999 license, Expo-prebuild-compatible, built-in persistence + OEM hardening.

## Harness

`spikes/gps-harness/` — throwaway Expo app (outside the pnpm workspace; `pnpm check` never sees it). Online/offline toggle → background location task (`BestForNavigation`, `timeInterval` 4s, `distanceInterval` 10 m, no deferred batching, iOS automotive activity type, Android foreground service). Every fix is appended to `fixes.jsonl` (GPS timestamp, task-receive timestamp for batching detection, coords, accuracy, speed, battery level) and shown in an on-screen log that flags gaps >15 s in red. Export button shares the JSONL for analysis.

### Build & run (real phone required)

```bash
cd spikes/gps-harness
pnpm install --ignore-workspace   # standalone install, not part of the monorepo
npx expo run:android              # or: npx expo run:ios (device plugged in)
```

`expo run:*` prebuilds a dev client with the background-location entitlements from `app.json`. When prompted, grant location **"Allow all the time"** (Android) / **"Always"** (iOS) — the harness requests foreground then background permission on first "Go online".

## Field protocol

Per platform (Android on Atis's actual phone is the one that matters):

1. Charge phone to a known level, note the %. Go online **while the app is open**.
2. Drive ~30–45 min through central Rīga (mix of Vecrīga narrow streets, bridges, open boulevards). App backgrounded, **screen locked** the whole drive.
3. Android second run: repeat with battery-optimization exemption granted for the harness (Settings → Battery → Unrestricted) to compare.
4. iOS extra: force-quit mid-route once, relaunch, confirm tracking resumes after tapping "Go online" again.
5. Back home: export `fixes.jsonl`, note the battery %.

**Record:** fix-gap distribution (median/p95/p99/max, from consecutive `ts` deltas), batch sizes (fixes sharing one `recvTs`), battery %/hr.

**Pass/fail:**

| Metric | PASS | FAIL |
|---|---|---|
| Gap while moving, screen locked | median ≤5 s, p95 ≤15 s, p99 ≤30 s, none >60 s | any gap >120 s, or task dies until relaunch |
| Batch size | p95 ≤3 fixes per delivery | sustained multi-minute batches (Doze) |
| Battery | ≤8%/hr | >12%/hr |

FAIL → escalate to the Transistorsoft library (still Expo-compatible) before building #14 on sand. PASS → #14 proceeds as designed with these exact `startLocationUpdatesAsync` options.
