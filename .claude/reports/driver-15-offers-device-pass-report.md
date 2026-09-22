# Implementation Report — #15 close-out: the offers / active-ride / earnings device pass

**Plan**: `.claude/plans/driver-15-offers-device-pass.md`
**Branch**: `docs/plan-15-device-pass`
**Status**: IN PROGRESS

> Every row starts at **unrun** and is flipped only by an artifact. A row that was never
> reached still reads unrun at the end — that is the honest default, not an omission.
> Every figure carries `observed` / `derived` / `expected`.

## Run environment

| Field | Value |
|---|---|
| Host | iMac19,1, macOS 15.7 (Darwin 24.6.0), Intel x86_64 |
| AVD | `sakta224`, `system-images;android-36;google_apis;x86_64`, pixel_7 profile |
| Emulator flags | `-no-snapshot -no-boot-anim -gpu swiftshader_indirect` |
| Worktree | `/Users/Berzins/taxi-worktrees/wt-15` on `docs/plan-15-device-pass` |
| Base | `origin/main` at `d6207be` + the plan commit `047edcf` (`observed` 2026-09-22) |
| APK | EAS build `e1afc69a-95db-417c-97ee-69a1a9fd5d8c`, `preview` profile |
| api | `services/api` dev on `API_PORT=3001`; db+redis from `COMPOSE_PROJECT_NAME=taxi` |

## §Level 4 functional pass — steps 1–13

| # | Step | Result | Artifact |
|---|---|---|---|
| 1 | Driver signed in, online, streaming | unrun | — |
| 2 | Book within ~2 km; full card inside ~2 s | unrun | — |
| 3a | Let the offer expire untouched (at the seeded 20 s) | unrun | — |
| 3b | Book again; accept on the card | unrun | — |
| 4 | Background / force-stop; push opens the card | unrun | — |
| 5 | Walk arriving → arrived → start → complete | unrun | — |
| 6 | Receipt to the cent; today's earnings include the ride | unrun | — |
| 7 | Force-assign opens the ride with no card first | unrun | — |
| 8 | Reassign mid-`arriving` → banner + home | unrun | — |
| 9 | Glance mode above 10 km/h | unrun | — |
| 10 | Kill ~75 s; offline push; reopen re-asserts online | unrun | — |
| 11 | Kill mid-ride, reopen → active-ride at the right status | unrun | — |
| 12 | Two devices in a zone → «N. of 2 in rix» | unrun | — |
| 13 | Payment method switched between card and acceptance | unrun | — |

## A11y legs

| Leg | Result | Artifact |
|---|---|---|
| T6 case 1 — earnings link, loading | unrun | — |
| T6 case 2 — earnings link, failed first load | unrun | — |
| T6 case 3 — earnings link, ready | unrun | — |
| T6 — collapse: exactly one node carries the name | unrun | — |
| T7.1 — offer card spoken, composed order | unrun | — |
| T7.2 — countdown announcements, `ANNOUNCE_EVERY_S = 5` | unrun | — |
| T7.3 — does the once-a-second name mutation re-announce? (Q5) | unrun | — |
| T7.4 — N3 live region inside the collapsed `Pressable` | unrun | — |
| T7.5 — no double «Ieņēmumi» | unrun | — |
| VoiceOver | not run — **#257** (owed, not written off) | — |

## Tasks completed

- [ ] T1 countdown lever
- [x] T2 runbook `#16` → `#15` (line 362)
- [~] T3 APK — EAS build `e1afc69a-95db-417c-97ee-69a1a9fd5d8c` submitted, **in queue**
- [x] T4 stack + accounts
- [ ] T5 functional pass
- [ ] T6 `content-desc`
- [ ] T7 TalkBack aloud
- [ ] T8 restore
- [ ] T9 runbook §Result + this report
- [x] T10 the orphaned issues — **four** filed, not three (#258, #259, #260, #261)
- [ ] T11 #15 decision

## Established before the run

### T7's oracle works, and headlessly — better than the plan expected

The plan required **one UI trip per AVD** to raise TalkBack's log level, because its prefs
file "does not exist until the UI writes it". It does not need the UI. `adb root` works on
this image, so the file can simply be created:

```
/data/data/com.google.android.marvin.talkback/shared_prefs/
  com.google.android.marvin.talkback_preferences.xml
  -> <string name="pref_log_level">2</string>   (2 = VERBOSE)
```

chowned to the package uid, then TalkBack force-stopped and re-enabled. The key name
`pref_log_level` is `observed` in the APK's own string table
(`adb pull /product/app/talkback/talkback.apk`, `strings | grep -iE '^pref.*log'`).

`observed` 2026-09-22 after four focus swipes — **20** `SpeechControllerImpl` lines where
the plan recorded zero:

```
V talkback: SpeechControllerImpl: Speaking fragment text="At a glance", utteranceId=talkback_2,
  TtsSpan=null, locale=en_US, event=type:EVENT_TYPE_ACCESSIBILITY
  subtype:TYPE_VIEW_ACCESSIBILITY_FOCUSED displayId:0 time:297522
```

Each line carries the spoken text, the utterance id, the locale and the triggering
accessibility event — which is what makes T7.3 (does the once-a-second name mutation
re-announce?) answerable by **counting log lines against event subtypes** rather than by ear.
This belongs in the runbook: it removes the only attended step in the a11y half.

### Step 9's speed cannot come from the runbook's recipe — but `geo fix` carries it

The plan routes step 9 (glance mode above 10 km/h) through the runbook's test-provider
recipe (`driver-device-day.md:434`). That recipe cannot set a speed. `observed` 2026-09-22
on `sakta224`:

```
$ adb shell cmd location help
    set-test-provider-location <PROVIDER> --location <LATITUDE>,<LONGITUDE>
      [--accuracy <ACCURACY>] [--time <TIME>]
```

`--location`, `--accuracy`, `--time` and nothing else. (`add-test-provider` has a
`--supportsSpeed` **capability** flag, which advertises the property without ever setting a
value.) That matters because the app takes the speed straight off the fix rather than
deriving it from successive positions — `location-task.ts:43-52`, `speedMps` is
`raw.coords.speed`, nulled only when absent, non-finite or negative. Moving the mock
position faster therefore produces **no** speed at all, and `glance` is
`state.speedMps !== null && state.speedMps > GLANCE_SPEED_MPS`
(`offer-card-props.ts:88`) — null fails it.

The emulator console command does carry one. `observed` same session:

```
$ adb emu help geo fix
'geo fix <longitude> <latitude> [<altitude> [<satellites> [<velocity>]]]'
  <velocity>    optional velocity in knots
```

`derived`: `GLANCE_SPEED_MPS = 10 / 3.6 = 2.778 m/s` (`offer-card-props.ts:12`), i.e.
10 km/h; at 1 knot = 1.852 km/h that threshold is 10 / 1.852 = **5.40 knots**. A fix sent at
**20 knots = 37.0 km/h = 10.29 m/s** clears it by 3.7x, which leaves room for the fix to be
rounded or re-projected without landing under the threshold.

The condition this assumes: `geo fix` is only delivered once something is requesting
location. The runbook's «`adb emu geo fix` alone does nothing» finding (`:434`) was made
with **no app requesting**, leaving the HAL at `ProviderRequest[OFF]`. With the driver app
online and streaming that precondition no longer holds, so `geo fix` is expected to land —
**`expected`, not observed**, and the run either confirms it or step 9 is unrun.

### The push legs cannot be observed on the device, and this was not in the plan

`PUSH_PROVIDER` is unset in the local runtime config, so `pushProviderFactory`
(`services/api/src/features/push/push.module.ts:16-27`) binds `StubPushProvider` outside
production. The stub **logs and delivers nothing**
(`stub-push.provider.ts:23-31`, `event: 'driver.push.stub_sent'` with `title` and `body`).

Consequence for the run, stated before it starts so no ✅ implies more than it should:

- **Observable**: that the api composes and sends the push, with the fare in the body
  (step 4) and the offline nudge (step 10) — from the `driver.push.stub_sent` line.
- **Not observable**: that a notification arrives on the device, that tapping it opens the
  card, and that a cold-start tap hydrates the card from the payload. Those are the halves
  of steps 4 and 10 that the device is supposed to answer, and they stay **unrun**.

Binding the real Expo provider would not rescue it either, and this is the stronger half:
**the app cannot obtain a push token at all on this build.** `observed` 2026-09-22 in
`logcat`, on first launch:

```
W ReactNativeJS: 'push: registration failed', 'Unable to get Firebase Messaging instance.
Did you configure `googleServicesFile` path in app config? ... Default FirebaseApp is not
initialized in this process lv.saktacab.driver.'
```

`app.json` declares no `googleServicesFile` and the repo carries no `google-services.json`,
so there is no FCM sender and no token to register. The push legs are therefore blocked on
**two independent counts** — the api binds a stub that delivers nothing, and the device has
no push token to deliver to. Either alone would be enough. Setting up FCM credentials is
#14's ground (it owns the offline nudge), not #15's.

This was found on #224's APK while the #15 build was still queued, so it is a property of
the app configuration rather than of either build.

### The harness was validated on #224's APK while the build queued

`observed` 2026-09-22: #224's `preview` APK (`bcd04c21`, artifact still live) carries
`http://10.0.2.2:3001` and was installed on `sakta224` to prove the route end to end before
the #15 build landed. It launched, restored its session from #224's run, and rendered home
with «Today: €0.00 · Rides: 0».

That string is itself the proof the api was reached: `earningsBody()` returns `null` (a
spinner) while loading and the em dash `'—'` on a failed first load, so a **composed**
string means `GET /drivers/me/earnings/today` returned a body.

**No #15 step result is taken from this APK.** It predates `packages/shared`'s moves
(#245 `5e45d49`, #135 `001d1c7`) and is here only to de-risk the harness — that the
emulator reaches the api, that the session survives, and that the app starts without a
crash. Screenshots: `pass-evidence-harness-01.png` (splash), `-02.png` (home).

### Two setup corrections the runbook owes its next reader

**1. The locale line needs a reboot.** `driver-device-day.md:548` says to run
`adb shell settings put system system_locales lv-LV` "first if you want the LV strings".
`observed` 2026-09-22: that alone is **not** sufficient. With `system_locales=lv-LV` and
`persist.sys.locale=lv-LV` both set and the app force-stopped and relaunched, the dump still
read EN:

```
'Go online'   'Earnings. Today: €0.00 · Rides: 0'   'Vehicle: EMU224'   'Sign out'
```

After `adb reboot` (booted in 9 s from the already-warm VM), the same dump read LV:

```
'Iet tiešsaistē'   'Ieņēmumi. Šodien: €0.00 · Braucieni: 0'   'Auto: EMU224'   'Iziet'
```

`ro.product.locale` stays `en-US` throughout and is not the lever. Restarting the app is not
enough because `persist.sys.locale` only propagates on boot.

**2. The `content-desc` collapse is partial, and the dump alone cannot settle it.** The
plan's T6 asks to assert that "exactly one node carries the composed name, and the
`EarningsCard`'s child `Text` is **not** separately exposed". `observed` on the home dump,
the two halves come apart:

```
class=android.widget.Button   text=''                          desc='Ieņēmumi. Šodien: €0.00 · Braucieni: 0'
class=android.widget.TextView text='Šodien: €0.00 · Braucieni: 0'  desc=''
```

Exactly one node carries the **composed name** — that half holds. But the child `TextView`
**is still present in the accessibility tree** with its own text, so "not separately
exposed" is not established by the dump. Whether TalkBack gives it its own focus stop is a
question about focus order, which `content-desc` cannot answer and T7's log can. Recorded
here so the ✅ on the name leg is not read as covering the focus leg.

## Deviations from the plan

| # | Deviation | Why |
|---|---|---|
| D1 | The plan's `psql -U postgres -d taxi` is wrong; the compose user is `taxi` (`docker-compose.yml:5`). Used `-U taxi -d taxi`. | The command as written fails with `role "postgres" does not exist`. |
| D2 | T10 filed **four** issues, not three. | The plan's own T10 says to "check whether rider identity has a home; file it if not". It did not (`observed`: 111 issues, no match), so it was filed as #261. |
| D3 | TalkBack's log level was set by writing the prefs file as root, not through the Settings UI. | See above — strictly better evidence and repeatable, and it removes the plan's one attended setup step. |
| D4 | `expo install --check` reports **15** outdated packages, not the runbook §D3's 9. Not bumped. | The plan forbids code changes to the slices, and #225/#232 each proved a dep change needs its own ~20 min build to validate. Recorded, not silently fixed. |

## Issues encountered

| # | Issue | Resolution |
|---|---|---|
| I1 | The dev DB was one migration behind the code: `users.push_token` did not exist, so **every** `POST /auth/otp/verify` returned 500 from `AuthRepository.findOrCreate`. | Applied `db/migrations/0011_small_polaris.sql` (`pnpm --filter @taxi/db migrate`). Latest migration is now `0011_small_polaris.sql`. |
| I2 | Five stale `requested` rides from 2026-08 (one 22-char tracking token, four NULL) failed **every** `DispatchSweeper` pass once per second — `expected 16-char base64url tracking token`. They predate #136's token format. | Retired them to `cancelled_by_system` by direct `UPDATE` on the dev DB. Sweeper quiet from 14:16:48Z (`observed`). **This deliberately bypassed `assertTransition()`** — it is dev-data surgery on rows the current schema can no longer parse, not a product path, and no shipped code was changed to do it. The repo's no-direct-status-writes rule is about the application, and these rows cannot be moved through it: the read that would load them is the one that throws. |
| I3 | `eas init --id` re-added 8 fully-qualified `android.permissions`, 3 of them new (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`) — #224's addendum reproduced exactly. | Reverted to the committed 8 before the build; kept `extra.eas.projectId` and `owner`, both to be reverted by T8. |
| I4 | `OTP /auth/otp/request` rejects `role: "dispatcher"` — `SIGNUP_ROLES` is `rider \| driver`. | Requested with `role: "rider"`; an existing user's stored role wins (`auth.schemas` docblock), so the dispatcher token came back with dispatcher rights (`POST /dispatch/bookings` → 201, `observed`). |
