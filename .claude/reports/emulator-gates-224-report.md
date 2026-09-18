# Implementation Report — #224 round 2: Gates 2 and 3, and §Steps 2–8 on the emulator

Issue [#224](https://github.com/linardsb/taxi/issues/224) · branch `spike/emulator-gates-224` ·
2026-09-18 · worktree off `origin/main` `f7446c3`

## Summary

**Gate 2 ✅, Gate 3 ✅, and §Steps 2–8 all ✅.** The Android emulator is an acceptable runtime for
[#141](https://github.com/linardsb/taxi/issues/141)'s one owed claim, and that claim has now been
run on it: after the toggle-OFF chain fires mid-ride, the real OS background location task keeps
emitting fixes that reach the api.

Round 1 (PR #226) stopped between Gate 1 and Gate 2 because `main` could not build the APK. Two
blockers were behind that, not one — #225, fixed in PR #227, and a second with no ticket, opened here
as [#232](https://github.com/linardsb/taxi/issues/232) and fixed in this branch's first commit. With
both cleared, EAS produced the first successful Android build this repo has ever made.

**This report does not close #141.** `docs/runbooks/driver-device-day.md` §Verdict asks for a phone,
and its §Emulator route says whether emulator evidence closes #141 is Linards' call. What changed is
that the claim now has evidence instead of none.

## What was blocking, and what it cost

`edcc579b-…` (PR #227's verification build) proved #225's fix and then died in the only other task
that failed: `:app:lintVitalRelease`, 6 fatal `ExtraTranslation` errors, after 1182 s.

**Cause (#232).** `app.json`'s `expo.locales` map is an **iOS** mechanism — it supplies the localized
`NSLocation*UsageDescription` strings for each `<lang>.lproj/InfoPlist.strings`. Android's
`withLocales` mod does not know that: `@expo/config-plugins/build/android/Locales.js`'s
`setLocalesAsync` writes **every** key of every locale file into
`android/app/src/main/res/values-b+<lang>/strings.xml` and writes **no default** entry for any of
them. Android Lint reads a string present in a translation and absent from the default as
`ExtraTranslation`, fatal in the vital set. 2 keys × 3 locales = the 6 errors.

Reproduced locally before any fix, `observed` 2026-09-18 via
`npx expo prebuild --platform android --clean` on `f7446c3`: default `values/strings.xml` carries
`app_name` and nothing else, while `values-b+lv/`, `values-b+ru/` and `values-b+en/` each carry both
`NSLocation*` keys.

**Fix.** `getResolvedLocalesAsync` (`@expo/config-plugins/build/utils/locales.js:36-66`) already
scopes by platform: a locale file's top-level keys are shared, and its `ios` / `android` sub-objects
merge in for that platform only. Both keys moved under `"ios"` in all three files. Re-running
prebuild: every `values-b+*/strings.xml` becomes `<resources/>`, and
`getResolvedLocalesAsync(…, 'ios')` still returns both keys for all three locales — scoped, not
deleted.

**Why nothing caught it.** The gate compiles no Android resources and runs no Android Lint.
`expo install --check` inspects dependency versions and this has no dependency-version component.
Nothing in-tree validates `app.json` past `JSON.parse`. That is the same gap #220's
`build-config.test.ts` and #225's `native-module-pins.test.ts` were written for, so the guard goes
next to them: `apps/driver/src/locales-config.test.ts`, 4 cases, proven in both directions — red on
`origin/main`'s locale files (`keys: [NSLocationWhenInUse…]` vs `[]`), green on the fix.

## The build

| Field | Value |
|---|---|
| id | `bcd04c21-d199-43d6-98f0-a3966036cf02` |
| profile | `preview`, commit `f4d37e4` |
| wall | **1199 s** (2026-09-18T20:49:41Z → 21:09:40Z) |
| control | `edcc579b-…`, same tree minus #232's fix, died at `lintVitalRelease` after 1182 s |
| APK | 110 069 070 bytes |

`unzip -l` lists `lib/x86_64/`, `lib/x86/`, `lib/arm64-v8a/` and `lib/armeabi-v7a/`. That retires
the issue body's P2, which was `derived` from `expo-template-bare-minimum`'s
`reactNativeArchitectures` — it is now `observed` on the artifact itself.

**`eas init --id <project-id>` still rewrites `android.permissions`.** The `--id` form is not a way
around the addendum on #224: `observed` 2026-09-18 it appended eight fully-qualified entries, three
new to the app (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, from
the declared `expo-audio`). Those were reverted before the build, so the APK under test declares the
repo's committed eight and nothing else. `extra.eas.projectId` and `owner` were kept for the build
and reverted once the archive had uploaded, per §2.

## Setup, as run

AVD `sakta224` — `-d pixel_7`, `system-images;android-36;google_apis;x86_64`, 1080 × 2400 at 420 dpi,
~80 s to `sys.boot_completed=1`. Stack: `taxi-db-1` / `taxi-redis-1`, migrate, seed, api on 3001,
dispatch on 3000, dispatcher `+37120000001` (Dina), driver `+37120000002` / vehicle `EMU224`.

**Injection is `gps` only.** Round 1's note says to inject into a test provider; it does not say
which. Adding one named `fused` **replaces** the platform fused provider — `dumpsys` then reads
`fused provider [mock]:` — and that is the provider
`LocationServices.getFusedLocationProviderClient` reaches, so Gate 2 would have been a test of the
mock. With `gps` alone the **real** fused provider ingests it.

**Gate 1, re-run on this AVD before anything else:**

```
A:  last location=Location[fused 56.949600,24.105200 hAcc=5.0 et=+3m17s75ms  mock]
B:  last location=Location[fused 56.949600,24.105200 hAcc=5.0 et=+3m41s969ms mock]   (+25 s)
```

`et=` advanced, so a stream and not a stale fix, on the real fused provider.

**NAT proven before the APK existed.** `adb shell am start -a android.intent.action.VIEW -d
"http://10.0.2.2:3001/health"` → `{"status":"ok","service":"api"}`. This removes §4's
transport-fault-vs-#141 ambiguity in advance, at zero cost, and is new to the runbook.

**Permission *and* app-op pre-granted.** `pm grant` sets the permission; `appops` sets the op, and on
Android 10+ the location op can sit at `foreground` with `ACCESS_BACKGROUND_LOCATION` granted —
delivery then stops the instant the app backgrounds, which is byte-for-byte Gate 3's "no delivery
lines at all" signature for a dead route. Recorded state:

```
ACCESS_FINE_LOCATION: granted=true    ACCESS_BACKGROUND_LOCATION: granted=true
COARSE_LOCATION: allow                FINE_LOCATION: allow
```

Both ops read `allow`, so neither gate's verdict is a permission artefact.

## Gate 2 — PASS (foregrounded)

60 s watch on `driver.location.ping_accepted` for driver `9690d4dc…`:

```
14 ping_accepted in 60s
clientAt gaps (s): 4.2 4.2 4.2 4.2 4.2 4.2 4.2 4.3 4.2 4.5 4.2 4.2 4.2
max 4.5s   min 4.2s
```

~4.2 s rather than the 2 s injection rate: the client throttle
(`MIN_FIX_INTERVAL_MS = 4_000`, `fix-throttle.ts:9`) binds, which is exactly what the runbook's
injection note predicts and the reason that note exists.

## Gate 3 — PASS (backgrounded). The premise proper.

`adb shell input keyevent KEYCODE_HOME`, then `dumpsys activity activities` reporting
`ResumedActivity: … nexuslauncher/.NexusLauncherActivity` — the host is paused, so
`LocationTaskConsumer.handleLocationUpdate` is on its `mIsHostPaused` branch (`deferLocations` +
`maybeReportDeferredLocations`), the code Gate 2 never executes.

```
21 ping_accepted in 90s
clientAt gaps (s): 4.2 × 20
max 4.2s   min 4.2s
```

Not one dropped fix, and **steadier** than foregrounded (4.2 exactly, against one 4.5 while
foregrounded). Deferral is the pass-through that `location-options.ts:21-22`'s two zeroed knobs
intend.

Device-side corroboration, from a `logcat` armed before the install:

```
I/ActivityManager: Background started FGS: Allowed [callingPackage: lv.saktacab.driver; …
  intent: Intent { cmp=lv.saktacab.driver/expo.modules.location.services.LocationTaskService } …]
I/NotificationListener: received notification posted event - lv.saktacab.driver#UserHandle{0}
```

The real `expo-location` foreground service is what was delivering.

## §Steps 2–8 — all PASS

Ride `343b46d7-02e4-40b4-99d6-16053bc84610`, tracking token `B1Z9R0wrC2ZvjWOYBaw1GQ`.

| # | Result | Signal read |
|---|---|---|
| 2 | ✅ | driver marker on `/dispatch`'s map at Rīga centre, «Tiešraide» pill, pinging at ~4 s — **before any ride existed** |
| 3 | ✅ | ride created and force-assigned; board reads `343b46d7 accepted 9690d4dc…`; `t/<token>` open before the watch |
| 4 | ✅ | banner **«You are on a ride right now.»**, status still **Online / Live**, button still «Go offline», `Last position 1 s ago · Queued: 0` |
| 5 | ✅ | **22 `ping_accepted` in 90 s, every `clientAt` gap 4.2 s** — max 4.2 s against a 12 s threshold |
| 6 | ✅ | «Atrašanās vieta atjaunota» advanced 22:21 → 22:23 → 22:24 |
| 7 | ✅ | C = 21:26:15Z; in the next 130 s: **31 `ping_accepted`**, `reason: 'dark'` **none**, `driver.push.nudge_*` **none**, `driver.push.stub_sent` **none**, `status_changed` **none** |
| 8 | ✅ | **Offline**, «Go online», **no banner**, `status_changed to=offline reason=(none)`, 0 pings in the tap window and **0 in a further 30 s** |

§Verdict makes 4, 5, 7 and 8 binary. None of the four is ❌.

The offer card also rendered the commission: fare €4.03, «You keep €3.43 (85%)». In integer cents at
the seeded 15% `platform_config` rate, `403 − floor(403 × 0.15) = 403 − 60 = 343`, and `343 / 403 =
85.1%`, which the card shows as `85%`. The arithmetic is stated here because the card is the only
surface a driver sees it on; the rate itself is `resolveCommissionPct()`'s, not a literal.

### Step 4's ordering claim, pinned on both sides

The banner alone is consistent with the fix **and** with the app short-circuiting locally and never
calling the api — which would make step 4 prove something weaker than #141's claim. It is neither
guess:

**The api refuses, `observed` directly.** Probe run after the sheet, on a second ride
(`34708cf9-…`, cancelled afterwards):

```
PUT /drivers/me/status {"status":"offline"} while on a ride
{"message":"driver_on_ride","error":"Conflict","statusCode":409}
```

**The banner is reachable only from that refusal.** `home-screen.tsx:201-202` renders
`driver.error.driver_on_ride` for `banner.kind === 'driver_on_ride'`, and the only writer of that
kind is `presence-state.ts:377`, inside a branch guarded by
`event.code === 'driver_on_ride' && event.status === 'offline' && state.streaming`. `status` is "the
`put_status` this refusal answers" (`:61-63`), so the branch is unreachable without a
`PUT /drivers/me/status offline` that came back refused.

**That branch does not tear down.** Its effects are `persist_intent online` and `kick_uploader` — no
`stop_uploader`, no `TEAR_DOWN`. So the order #141 is about (refusal first, stream intact) is what
ran, and step 5's 22 gaps of 4.2 s are the stream that proves it.

Note that `driver_on_ride` appears **0 times** in the api log. A handled `ConflictException` is not
logged by Nest, so its absence there is not evidence either way — the 409 above is.

## Five runbook defects, each found only by running it

All five are fixed in `docs/runbooks/driver-device-day.md` by this branch. None is a code defect and
no file under `apps/driver/src`, `services/api/src` or `packages/shared` was touched.

**D1 — step 3's primary path cannot run on a dev stack.** `/dispatch`'s new-order form needs address
search, and `StubMapsProvider` has none: «Adrešu meklēšana nedarbojas» in the UI and
`StubMapsProvider has no address search: set GOOGLE_MAPS_API_KEY to bind GooglePlacesProvider (#19)`
in the api. The step presents the phone order as primary and force-assign as fallback; with no maps
key the fallback is the **only** path. `POST /dispatch/bookings` with explicit coordinates bypasses
the geocoder — and its `Idempotency-Key` must be a uuid, since any other string fails as a bare
`Invalid uuid` with an empty `path`.

**D2 — step 7 cannot be done "from `/dispatch`".** `POST /rides/:rideId/complete` is
`@Roles('driver')` (`ride-lifecycle.controller.ts:68-69`), and the console offers **Piešķirt** and
**Atcelt** only. A dispatcher can cancel a ride and never complete one. This run walked
`arriving → arrived → start → complete` with a driver token.

**D3 — step 6's Expect states a format the code does not produce.** It says «position updated
HH:MM:SS», citing `tracking-map.tsx:334-335` — the line that renders the message. The formatter at
`:178-182` is `toLocaleTimeString(…, { hour: '2-digit', minute: '2-digit' })`, so there are **no
seconds**. Across a 90 s watch that line changes once or twice; an operator looking for a ticking
seconds field would call a healthy page frozen. The runbook cell is corrected; the formatter is not
touched, because minute resolution is a deliberate choice next to the `polite` live region.

**D4 — an `adb` tap cannot win the offer countdown.** The card read «8 s left» by the time the
screenshot was parsed, and `screencap` → read → `input tap` is a ~4 s round trip; the offer expired
(`dispatch.offer.expired`). Force-assign is the reliable path for an agent-driven run. A finger on a
real phone is not subject to this, so it is a run-method note and not a product finding.

**D5 — `uiautomator dump` fails on any screen with a running countdown**, with
`ERROR: could not get idle state.` — the OTP resend timer, the offer card, and the toggle
mid-animation all trigger it. `adb exec-out screencap -p` always works.

### Setup corrections in the same file

- `JAVA_HOME` is `~/.local/share/jdk-17/**Contents/Home**`. The Adoptium tarball unpacks a macOS
  bundle; the root the runbook named has no `bin/java`.
- `avdmanager create avd -d pixel_7` **works** and gives 1080 × 2400, despite printing a non-fatal
  `Could not load devices from …/devices.xml`. Round 1 left the 320 × 640 default as an open caveat;
  it is avoidable, and every step here ran on the larger profile.
- The driver's phone must differ from the dispatcher's — `findOrCreate` applies `role` only to a
  brand-new row (`auth.repository.ts:47-50`), so reusing the number signs in as a dispatcher.
- A stock AVD is `en-US`, so every LV Expect cell reads as the EN catalog unless
  `settings put system system_locales lv-LV` is set first.

## Validation

`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`
at commit `f4d37e4` — the commit that carries every source change on this branch; everything after it
is documentation.

```
Tasks:    22 successful, 22 total       Time: 2m3.161s      exit 0
@taxi/api    : Test Suites 77 passed, 77 total   Tests 733 passed, 733 total
@taxi/driver : Test Suites 44 passed, 44 total   Tests 249 passed, 249 total
```

`REDIS_TEST_URL` was set, so the 39 Redis-gated tests ran rather than skipping — 77 of 77 suites, not
75 of 77.

## What is still owed

- **#141 stays open.** §Verdict asks for a phone; this is an emulator. The decision to close on
  emulator evidence is Linards'.
- **No Doze, no OEM process killer, no real radio, no real GPS.** Those bear on background
  *reliability* and remain [#4](https://github.com/linardsb/taxi/issues/4)'s and
  [#14](https://github.com/linardsb/taxi/issues/14)'s question. This run does not retire either.
- **The `RECORD_AUDIO` decision.** `eas init` will re-add it on the next run of §2 unless someone
  decides otherwise first.
- **Board freshness rendering** is still the separate ticket the prep plan named; step 2's note is
  unchanged.
