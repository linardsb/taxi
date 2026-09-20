# Driver device day — issue #141's proof

Issue [#141](https://github.com/linardsb/taxi/issues/141)'s code is merged (PR #142 `269e8ec`,
PR #145 `a6481aa`) and **its one owed claim is now answered** — on an Android emulator, not a phone
(§Result, §Emulator route). The claim was **one claim wide**: that after the toggle-OFF chain runs
mid-ride, **the real OS background location task is still emitting fixes that reach the api**. The
driver suite proves `stopStreaming` is never called and can prove nothing about the task itself —
`jest.setup.ts` fakes every native module by design (`apps/driver/CLAUDE.md`, the Tests bullet), so
only a real runtime could answer it. #224's emulator run is that runtime, and Linards took the call
on 2026-09-20 that its evidence grade carries #141.

**The sheet is not retired.** It stays the run sheet for the phone leg #4 and #14 still want, for
the other passes in §Also on this day, and for anyone re-proving the chain after a change —
§Verdict's binary rule applies unchanged whoever runs it.

Everything else about the held branch is already pinned by a test. Do not widen this sheet.
~30 minutes with the setup; the eight steps themselves are ~10.

## Result

| Field | Value |
|---|---|
| Run by | Claude (agent-driven, `adb`), #224 |
| Platform | **Android emulator** (API 36 `google_apis` x86_64, AVD `sakta224`, Pixel 7 profile 1080×2400) — **no phone** |
| App / OS version | `preview` APK from EAS build `bcd04c21-d199-43d6-98f0-a3966036cf02` on commit `4e6ffb68`; Android 16 (API 36) |
| Date | 2026-09-18 |
| Outcome | **All eight steps ✅ on an emulator**, step 1 with its prompts pre-granted (see the divergence below). Steps 4, 5, 7 and 8 — the four the §Verdict rule makes binary — all pass. See §Emulator route for what that grade does and does not carry |

| # | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| | ✅* | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**\* One divergence, on step 1.** Location and notification permissions were pre-granted with
`pm grant` + `appops set` before the app was first launched, rather than granted through the dialogs
when asked — deliberately, so that a Gate 3 ❌ could not be an Android 11+ background-location denial
wearing the same signature (§Emulator route § *Gates 2 and 3, as run*). Step 1 therefore says nothing
about the permission *prompts*; #14's §C.13 owns that check and still owes it. Steps 1–3 are setup
and prove nothing about #141 either way, per §Verdict.

**This run is what closed #141**, on 2026-09-20 — Linards' call, taken on emulator evidence rather
than on a phone. The evidence grade it rests on is stated in §Emulator route § *What an emulator can
and cannot prove here*, and the run's command-level record is in
`.claude/reports/emulator-gates-224-report.md`.

Two things the run settled:

- **Android emulator: usable, and used.** The earlier "no SDK on this machine" reading is retired,
  and so is the prep plan's rejection of the route on cost — all three gates pass and the eight
  steps ran on it (#224). A mock fix reaches Play services' **real** fused provider, the real
  `expo-location` foreground service delivers to the background task consumer, and the api saw a
  4.2 s ping stream throughout.
- **iOS Simulator: this Mac still cannot build it.** iMac19,1 cannot run Tahoe, so Xcode 26.3 is the
  ceiling, and Expo SDK 57 needs 26.4 to compile `expo-modules-jsi` for iOS — `observed`
  2026-08-25. An installable iOS build also needs the paid Apple Developer Program, which does not
  exist yet.

**When a phone exists:** run every step again, record each step pass or fail, and replace the
Platform row rather than adding a second table. Record failures as findings, never as "mostly
worked". The emulator run does not make a phone run redundant — it makes it cheaper, because every
setup fault is already flushed out.

## What this day does NOT need

Three prerequisites that the *old* wording of step 7 appeared to require. It does not — step 7's
signal is an absence in the api console, not a notification on the phone (see step 7 and §C2 of
`.claude/plans/driver-device-day-prep.md`).

| Not needed | Why |
|---|---|
| Firebase / FCM credentials (#14's A1) | No push has to be *delivered*. The dev default is `PUSH_PROVIDER=stub`, and `StubPushProvider` logs what it would have sent and delivers nothing — so a "no notification arrived" pass would be vacuous either way. The signal is the **absence of the api-side events** that precede any send. |
| An EAS project id *for a push token* (#14's A2) | No token has to be minted. Step 7 reads an absence in the api console, not a notification, and **both branches of `registerPushToken` end with a null `drivers.push_token`**. Skip §2's `eas-cli init` and it warns and no-ops at `register-push-token.ts:26-31` (`'no_project'`). **On the path this sheet prescribes it does not take that branch** — `init` writes `extra.eas.projectId`, so the guard passes and the live return is `:43-53` (`'unavailable'`), because `getExpoPushTokenAsync` still needs the FCM credentials A1 would supply. That is also why a notification-permission prompt appears at step 1 — see its Expect cell. What is off #141's path is the *token*, which needs A1 as well. |
| An Android SDK (#14's A3) | The APK is built in EAS Build's cloud. Nothing is compiled on this machine. |

The prerequisites are not retired — they belong to
[#14](https://github.com/linardsb/taxi/issues/14), for the day someone wants to prove real
delivery. They are simply not on #141's critical path.

## Setup

### 0 — Pre-flight: does the APK's baked origin still point at this machine?

`EXPO_PUBLIC_API_URL` is inlined by Metro at **bundle** time, so the APK carries the origin it was
built with. If the Mac's DHCP lease moved since the build, the app looks dead and nothing after
this point is diagnosable.

```bash
ipconfig getifaddr "$(route -n get default | awk '/interface:/{print $2}')"
```

Interface-agnostic on purpose: this machine's active interface is `en1` (`observed` 2026-09-17,
`192.168.1.11`) and `en0` answers nothing, so the common `getifaddr en0` recipe prints an empty
string and the check passes silently.

Compare the answer with the `env` block in `apps/driver/eas.json`. **Edit it only if it moved** — a
wrong value fails at the first request on the phone, not at build time. A DHCP reservation on the
router stops it moving at all.

**That edit stays uncommitted.** `eas.json:9-11` carries this machine's current lease, which is a
build convenience and not a repo fact: `git checkout apps/driver/eas.json` once the build is
queued, so the next `piv-commit` in this shared checkout cannot sweep a home LAN address into an
unrelated PR. An EAS-side project variable
(`npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_API_URL --value http://<ip>:3001`,
then drop the `env` block) is the other place the value could live; the plan weighed it and kept the
committed block deliberately — one place to look, reviewable in a diff, no way to pick up a stale
value invisibly (`.claude/plans/driver-device-day-prep.md:566-577`). Revisit that if the lease starts
moving often, not on the day. A shell variable
is **not** a substitute: the build runs in EAS's cloud and is not handed the invoking shell's
environment, and `apiUrl()` throws in a non-`__DEV__` build when the origin is absent
(`apps/driver/src/config.ts:16-18`).

### 1 — Boot the stack

Use #14's recipe: `.claude/plans/driver-app-auth-online-location.md` §Level 4 §B. Do not restate it
here — two copies of a procedure is the failure this runbook exists to clean up. In short: compose
up, migrate, seed, `pnpm --filter @taxi/api dev`.

Then the one thing §B leaves optional but this day requires — a dispatcher login for the console:

```bash
pnpm --filter @taxi/api provision:dispatcher +371XXXXXXXX Dina
```

Phone first, display name second, and **no `--` separator** (pnpm 10 forwards it literally as an
argument). Run it from a shell that has `DATABASE_URL` in its environment — the script reads it
directly and throws by name if it is missing. This is the only dispatcher-creation path: signup
cannot claim the role and the seed creates no users.

### 2 — Build and install the APK

```bash
cd apps/driver
npx expo install --check
npx eas-cli@latest init    # links the project — WRITES extra.eas.projectId into app.json
npx eas-cli@latest config -p android -e preview --non-interactive   # resolves both configs; must exit 0
npx eas-cli@latest build -p android --profile preview
```

**The `config` line is the cheap failure.** Nothing in this repo can reject a bad `eas.json` key —
its only in-tree validation is `node -e "JSON.parse(…)"`, which proves the file is JSON and nothing
about the schema. `config` resolves `app.json` + `eas.json` against the real schema, so a typo
surfaces in seconds instead of at the `build` line, after the travel and the setup. Both failure
shapes are `observed` 2026-09-17, run in `apps/driver` on `eas-cli@24.7.0`:

| Tree | `config` prints | Exit |
|---|---|---|
| `eas.json` with a key EAS does not define | `eas.json is not valid.` / `- "build.preview.<key>" is not allowed` | 1 |
| Valid `eas.json`, `init` not yet run | `EAS project not configured. …` then the two `eas init` forms | 1 |

Schema first, project link second — the invalid-key run never reaches the project check. That
second row is also why the line sits *after* `init`: before it, `config` fails on the missing
`extra.eas.projectId` for every tree, valid or not. And it retires round 1's one unverified item —
`"pnpm"` **is** a real profile key, since the current `eas.json` clears validation and stops on the
project link instead (`observed`, same run).

**`init` mutates a tracked file, and the build needs it.** `apps/driver/app.json` carries no
`extra.eas` and no `owner` today (`observed` 2026-09-17). EAS attaches every build to a linked
project, so without `init` the `build` line stops on an interactive create-or-link prompt instead of
running as copy-paste. The in-repo precedent is `spikes/gps-harness/app.json:42-47` — the config
behind PR #115's APK, the only one this repo has built — which commits **both**
`extra.eas.projectId` and `owner: "linards"`. **Once the build is queued** — not between `init` and
`build`, which would discard the projectId and put the `build` line back on the interactive prompt —
either commit those two keys or `git checkout apps/driver/app.json`; do not leave them dirty in a
checkout several sessions share. Check `git diff` first: `git checkout <file>` discards *anything*
else uncommitted in it, including a concurrent session's.

The **prompt** is `expected`, not `observed` — its interactive branch has never been exercised here.
The premise behind that label has changed, though, and the `config` run above is what changed it: a
signed-in Expo session **does** exist on this machine (`observed` 2026-09-17 — `config` reached
Expo's side and reported `Accounts you can create projects in: linards`). What is still unseen is
the create-or-link prompt itself, because every run here passed `--non-interactive`, which reports
the missing link and refuses to create it.

**It is `eas-cli`, not `eas`.** `npx eas` fetches an unrelated npm package that happens to hold
that name at version `0.1.0` — the Expo CLI is `eas-cli` (`24.7.0` at the time of writing), and it
is not a dependency of this repo (`observed` 2026-09-17), so it comes from `npx` or a global
install either way. A bare `eas build` works only if you have installed it globally.

**`expo install --check` is NOT clean today, and that predates this runbook.** `observed`
2026-09-17: 14 packages sit one or two patch versions below what SDK 57 expects (`expo` itself,
`expo-location`, `expo-router`, `expo-notifications`, `expo-task-manager` among them) and
`expo-doctor` fails two checks — that one, plus "overridden dependencies", which is the workspace's
deliberate `pnpm.overrides` block. Every one of those 14 is pinned identically on `main`, so none of
it came from the build route. What matters for the build is the narrower fact that
`expo-build-properties` *is* at its expected version and no package is on a **different SDK major** —
a cross-major mix is the #4 kit's known startup crash, patch drift within SDK 57 is not. Do not
`--fix` them on the day: a 14-package bump minutes before a build is how a device day loses its
first hour, and `typescript` is excluded from that check on purpose
(`expo.install.exclude`) — never `--fix` that pin away.

Run EAS commands from `apps/driver`, never the repo root — `eas.json` lives in the app directory in
a monorepo. Build in place; do **not** copy the app outside the repo (that step in the #115 harness
kit was an artefact of `spikes/` not being a `pnpm-workspace.yaml` member — `apps/driver` is one).

**The cloud build is `expected`, not `observed`.** It has never run: it needs Linards's Expo
credentials and a build credit. What *is* `observed` (2026-09-17) is that the three failures which
would otherwise have broken it are each closed and proven in both directions against the exact tree
EAS receives (`git archive` of the working tree): `@taxi/shared` resolving via the
`eas-build-post-install` hook, `expo prebuild` finishing after the notification-icon repair, and
`android:usesCleartextTraffic="true"` reaching the manifest the release variant inherits. Budget one
failed build anyway, and diagnose it rather than reaching for the harness kit's old workarounds.

Install the APK from the EAS build page on the phone. Both the phone and the Mac must be on the
same Wi-Fi.

### 3 — Where each surface is opened

The phone and the laptop reach the api at **different origins**, and only the phone's is baked into
a build.

**Open `/dispatch` and `t/<token>` in the build machine's own browser, on `localhost:3000`** — where
the committed `CORS_ORIGINS` and `PUBLIC_TRACKING_BASE_URL` defaults already work. Opening them from
any other device means editing all three of `CORS_ORIGINS`, `NEXT_PUBLIC_API_URL` and
`PUBLIC_TRACKING_BASE_URL`, and the tracking link printed in the SMS log carries whatever
`PUBLIC_TRACKING_BASE_URL` was at boot — so it will point at `localhost` and silently fail to open
on the phone. That is a five-minute trap; this paragraph is the whole prevention.

### 4 — Telling a transport fault from #141's claim

Their end states look identical — no `ping_accepted`, a frozen pin — so read them by **where they
happen**:

> **Cannot sign in at step 1** → cleartext blocked, wrong origin, or wrong network. **Not a #141
> result.**
> **Signed in and streaming at step 2, then frozen after the toggle at step 4** → that is #141's
> claim, and it is the only reading of a frozen stream this sheet accepts.
> **Tiebreaker**: `adb logcat` over USB (`adb` is at `/usr/local/bin/adb`).

This works because Android enforces cleartext policy in OkHttp, which backs React Native's `fetch`
as well as its WebSocket — and `socket.ts:29-30` dials with `transports: ['websocket']` and no
polling fallback. A cleartext block therefore takes the REST calls down too, and **steps 1, 2 and 3
are all REST**: the operator cannot reach step 4 with cleartext blocked.

## Steps

Each step names the signal it reads and **where that signal appears**. The api console is
`pnpm --filter @taxi/api dev`'s output; `driver.location.ping_accepted` is `logger.debug` and does
print there (`observed` 2026-09-17: `main.ts` calls `NestFactory.create(AppModule)` with no options
and nothing in `services/api/src` calls `setLogLevels`, so Nest's `DEFAULT_LOG_LEVELS` applies and
it includes `debug`).

| # | Do | Signal | Expect | ✅/❌ |
|---|---|---|---|---|
| 1 | Sign in on the driver phone (`+371…`, role driver; read the code from `auth.otp.stub_sent`). Tap the availability toggle ON | phone | Status reads «Tiešsaistē», pill «Tiešraide» — `Online` / `Live` on an EN phone, the app follows the **device** locale (`deviceLanguage()`, `expo-localization`). Grant background location when asked. **A notification-permission prompt appears too** — §2's `init` writes `extra.eas.projectId`, so `registerPushToken` clears the `:26-31` guard and reaches `requestPermissionsAsync` (`register-push-token.ts:41`); `POST_NOTIFICATIONS` is declared (`apps/driver/app.json:40`), so on Android 13+ that is a real dialog. Grant or deny — no token is minted without FCM either way (`:43-53`), which is what step 7 depends on | |
| 2 | **HARD GATE.** Open `/dispatch`, find that driver on the board | api console + `/dispatch` | `driver.location.ping_accepted` for that `driverId` every ~4 s — **time it by the line's `clientAt`, not its `at`** (see the note below) — and the driver visible on the board. **If the driver is not visible and pinging before any ride exists, STOP** — see the verdict rule | |
| 3 | Create a ride for that driver: a dispatcher phone order (`/dispatch` → new booking), then **accept the offer card if it appears**; if it does not, open the ride's row → **Assign** → pick that driver. **On a stack with no `GOOGLE_MAPS_API_KEY`, force-assign is the ONLY path** — the new-order form's address boxes read «Adrešu meklēšana nedarbojas» and the api answers `StubMapsProvider has no address search: set GOOGLE_MAPS_API_KEY to bind GooglePlacesProvider (#19)`, so no phone order can be placed through the form at all (`observed` 2026-09-18). `POST /dispatch/bookings` with explicit pickup/destination coordinates bypasses the geocoder and is what #224's run used; its `Idempotency-Key` header must be a **uuid**, and any other string fails as a bare `Invalid uuid` with an empty `path`. **Then open `t/<token>` in a tab and leave it open** — you need it on screen before step 5 starts | phone + `/dispatch` + api console | A phone order goes through `RidesService.request()` and lands at `requested`, so `DispatchSweeper` offers it to the best candidate on its next tick (`dispatch.sweeper.ts:112`). With this phone as the only online driver an offer card will very likely arrive first. Force-assign (`POST /dispatch/rides/:rideId/assign`, `dispatch.controller.ts:95`) is the fallback, not the only path. Board row reaches an accepted state. The token is in the api console: `auth.sms.stub_sent` logs the SMS **body in full**, deliberately, and the tracking link is in it (`stub-sms.provider.ts:28-37`, `body` at `:35`) — tokens are minted inside the booking flow, never by the seed | |
| 4 | On the phone, note the time. **Tap the availability toggle OFF** | phone | The toggle **springs back to ON**; a blue info banner «Jūs pašlaik izpildāt braucienu.» appears (`You are on a ride right now.` on an EN phone) | |
| 5 | Watch for **90 s** without touching the phone | **api console (primary)** | **The stream does not stop**: `driver.location.ping_accepted` for that `driverId` still arriving at t+90 s, with no sustained `clientAt` silence — **one gap just over the 12 s threshold is a re-read, not a ❌; the ❌ is a stream that goes quiet and stays quiet** (see the two notes below — both the field and the threshold matter, and the note carries the arithmetic behind 12 s). 90 s clears the 60 s `findNearby` freshness window — a stream that only survives 30 s proves nothing. **`/dispatch` is NOT the signal here**: the board renders position and no freshness, so a still pin is **not** a failure — see the note below | |
| 6 | During that same 90 s, watch the `t/<token>` tab you opened at step 3. Record what it showed | `t/<token>` (corroboration) | The «position updated HH:MM» line keeps ticking (`tracking-map.tsx:334-335`). **Minutes, not seconds** — `timeOf` at `:178-182` is `toLocaleTimeString(…, { hour: '2-digit', minute: '2-digit' })`, so across a 90 s watch this line changes once or twice and a reader looking for a seconds field will call a healthy page frozen (`observed` 2026-09-18, #224: it advanced 22:21 → 22:23 → 22:24). It advances on a **fresh fix**, not on movement, so it reads correctly with the phone flat on a table. This is the only in-product surface that renders freshness, and it is what a person can watch without a terminal | |
| 7 | Complete the ride. **Not from `/dispatch`** — `POST /rides/:rideId/complete` is `@Roles('driver')` (`ride-lifecycle.controller.ts:68-69`) and the console offers **Piešķirt** and **Atcelt** only, so a dispatcher can cancel a ride and never complete one (`observed` 2026-09-18). Complete it from the driver's own active-ride screen, or drive `arriving → arrived → start → complete` with a driver token as #224's run did | **api console**, read as an **absence** | For 2 minutes after completion, for that `driverId`: **no** `driver.presence.status_changed` with `reason: 'dark'`, and **no** `driver.push.nudge_*` line at all — `nudge_skipped`, `nudge_sent` or `nudge_failed` (see the note below; **not** `driver.push.stub_sent`, which cannot appear on this setup). `driver.location.ping_accepted` continues throughout — the stream survived the release too, which is what makes a nudge impossible | |
| 8 | Now tap the toggle OFF again | phone + api console | It goes OFF normally, **no banner** — the hold was ride-scoped, not sticky. `status_changed to=offline` with no reason; pings stop | |

**Numbering is deliberately unchanged** from the retired sheet
(`.claude/plans/driver-toggle-off-mid-ride-held.md` §Level 4), so the issue comments and PR reviews
that cite step numbers still resolve. The one instruction the old sheet lacked is folded into step 3
rather than renumbered in: open `t/<token>` **before** the 90-second watch, so step 6 records what
was already on screen instead of sending the operator off to find a token mid-watch.

**Which timestamp, and why 12 s.** `driver.location.ping_accepted` carries two
(`driver-location.service.ts:76-82`): `clientAt` is the fix's own time from the phone, `at` is the
server clock at ingest (`:54`). Fixes are queued durably (`fix-queue.ts`) and drained in batches
(`uploader.ts:70`), so one socket blip inside the unattended 90 s replays the queue as a burst — the
server `at`s bunch up after a visible hole while the `clientAt`s stay ~4 s apart throughout. Reading
`at` marks ❌ on a healthy stream, and step 5 is one of the four the verdict rule makes binary. #14's
sheet states the field for the same reason
(`.claude/plans/driver-app-auth-online-location.md:828`). The same property costs it one thing, so
read both ends: a `clientAt` gap check cannot tell a live stream from a backlog draining, because
replayed fixes stay ~4 s apart in that field too — **the newest `clientAt` should also track the
wall clock**. Step 2's hard gate makes that near-unreachable here (nothing is queued to replay once
the socket is proven up), but it is one glance.

The 12 s is `derived`, **not** a measurement: 3 × `MIN_FIX_INTERVAL_MS` (4 s), which tolerates one
dropped OS delivery. `selectFixes` measures `delta` from the last **kept** fix
(`fix-throttle.ts:64-79`, `last = raw.timestamp` is assigned only on a keep) and drops anything under
4000 ms, while `timeInterval: 4000` is an Android *floor* (`location-options.ts:19`) — so a delivery
arriving at 3999 ms is dropped and the next kept fix lands ~8 s out. A threshold of exactly 8 s
therefore sits on the boundary the throttle itself produces, with a binary verdict behind it. Real
Android delivery jitter has not been measured here and cannot be without the phone; what the step is
actually about is that the stream must not **stop**, so treat one gap just over 12 s as a re-read;
the ❌ is a stream that goes quiet and stays quiet.

**Why `driver.push.stub_sent` is not the event to watch.** It is unreachable on the setup this sheet
prescribes, whether or not the fix landed. A push token needs **both** halves — `extra.eas.projectId`
(§2's `init` supplies it) *and* FCM credentials, which this day does not set up. So
`getExpoPushTokenAsync` throws, `registerPushToken` returns `'unavailable'`
(`register-push-token.ts:43-53`), and `drivers.push_token` stays null; skip `init` and it is
`'no_project'` at `:26-31` instead — either way the column is null. `findDueNudges` selects that
column
(`driver-presence.repository.ts:52-56`) and `sendDueNudges` `continue`s on it at
`drivers.service.ts:353-360` — **before** the `push.send` at `:362`, which is the only caller of
`StubPushProvider.send` and so the only writer of `stub_sent` (`stub-push.provider.ts:25`). The
nudge family is what a broken app actually prints, and it has **four** members: the `no_token` skip
in that guard today; a second `nudge_skipped` with `reason: 'back_online'` at `:342-351`, when
`claimNudge` loses the race because the driver came back online — that one sits *before* the
`no_token` guard; and `nudge_sent`/`nudge_failed` if the push prerequisites are ever met. Step 7
watches `driver.push.nudge_*`, so it reads the same absence whichever fires, and stays true either
way — read the family by its prefix, not by this list.

**Why `/dispatch` is not the freshness signal.** `apps/dispatch/src/features/board/board-state.ts:127`
folds `lastSeenAt` into each driver on every `driver:location` event and **nothing in the board
slice reads it back** (`observed` 2026-09-17). So the board shows position and no freshness. The
phone streams a fix every 4 s whether or not it moves — the throttle is time-based
(`fix-throttle.ts:9`, `MIN_FIX_INTERVAL_MS = 4_000`) and `distanceInterval` is `0`
(`location-options.ts:20`), both by design — so a
stationary phone's pin does not move, and a live stream and a dead one look identical there.
Rendering board freshness is the clean fix and is deliberately a separate ticket —
[#234](https://github.com/linardsb/taxi/issues/234), filed 2026-09-20 when this deferral was found
to name no ticket at all.

**Why step 7's window is 2 minutes.** Let C be ride completion. Worst case to an observable nudge
in the **broken** app is **C + 60 s**: ≤15 s to the marking tick + 30 s nudge delay + ≤15 s to the
sending tick — `derived` from `PRESENCE_SWEEP_INTERVAL_MS = 15_000` and
`OFFLINE_NUDGE_DELAY_SECONDS = 30` (`driver-location.policy.ts:36,42`), and assuming the dark
condition is already true at C, which it is whenever the ride ran longer than
`PRESENCE_DARK_AFTER_SECONDS = DRIVER_LOCATION_TTL_SECONDS = 60` (`:15,30`). Two minutes is that
worst case plus margin.

## Verdict

**Any ❌ on 4, 5, 7 or 8 means the fix did not land.** Step 6 is corroborating — it reads the same
claim as step 5 on a second surface and adds no independent #141 evidence. Steps 1–3 are setup:
they prove nothing about #141, and a failure there is a setup fault, not a result.

That set is re-derived per step from what each one tests, in
`.claude/plans/driver-device-day-prep.md` § *The step-set re-derivation* — which also reconciles the
three earlier, mutually inconsistent statements of it. Cite that section rather than restating the
list anywhere new.

**The step 2 hard gate.** If the driver is not visible and pinging on `/dispatch` **before any ride
exists**, stop and fix the setup. Nothing after that point means anything: a blocked-cleartext
socket produces the same signature as #141 unfixed, and step 2 is the only place the ambiguity can
be resolved, because at that point no ride and no toggle-OFF has happened yet.

**#141 was closed on the run in §Result**, not on a phone. The eight steps ran on an Android
emulator on 2026-09-18, the four this rule makes binary all passed, and Linards took the call on
2026-09-20 that the emulator's evidence grade carries the claim — §Emulator route § *What an
emulator can and cannot prove here* states what that grade does and does not include. The phone leg
was never run; it is not owed by #141, and the background-reliability axis an emulator cannot reach
was never #141's question — it stays with #4 and #14.

**The rule above still governs any later run of this sheet.** A ❌ on 4, 5, 7 or 8 on a phone would
be new evidence against a closed issue, and should reopen it rather than be filed elsewhere.

---

## Also on this day

Other work waits on the same phone. **This runbook does not own any of it**, nothing here is
checkboxed, and the Result table above records **#141's outcome only** — a ❌ on someone else's
check is not expressible as #141 failing, and the day can legitimately stop at the verdict above.

| What | Owner |
|---|---|
| The full driver device pass, §C steps 1–13 (sign-in, streaming, dead zone, process kill, dark sweep, expired token, earnings, i18n, TalkBack banner, background-permission refusal) | #14 — `.claude/plans/driver-app-auth-online-location.md:812` §Level 4 §C |
| Three ear-checks: #161's two earnings-label states, F4's offer-card label, and N3 — whether `earnings-card.tsx:17`'s `polite` live region is still announced inside a collapsed `Pressable` | `.claude/references/ui-decisions.md:17`; N3 from `.claude/code-reviews/pr-163-review.md:183` |
| The offers / active-ride device pass | #16 — `.claude/plans/driver-offers-active-ride.md:506` §Level 4 |
| The GPS field drive (#4, deferred 2026-08-26) | `docs/spikes/04-gps-field-test.md` §Field protocol |

---

## Emulator route

An Android emulator was tested as a substitute runtime for this day ([#224](https://github.com/linardsb/taxi/issues/224)).
It is **not a second run sheet**: the steps stay in §Steps above and this section cites them by number.
What it adds is the setup, the three gates that decide whether the route is usable at all, and the
evidence grade the route carries.

**Status, `observed` 2026-09-18**: **all three gates pass**, and §Steps 2–8 have been run on the
emulator end to end. The route the prep plan rejected on cost is live. The one thing it does not
carry is the evidence grade a phone would — that is the next subsection, and it has not changed.

### What an emulator can and cannot prove here

It runs the real Android framework, the real Play-services fused location provider, a real foreground
service and the real `expo-location` task consumer. The only synthetic part is the GPS source, and
#141's claim is about **task lifecycle**, not GPS quality — so the axis this day tests is one an
emulator can reach in principle.

It reproduces **no Doze, no OEM process killer, no real radio and no real GPS**. Those bear on
background *reliability*, which is [#4](https://github.com/linardsb/taxi/issues/4)'s and
[#14](https://github.com/linardsb/taxi/issues/14)'s question. Emulator evidence does not retire
either. It did close #141: Linards took that call on 2026-09-20, on exactly this grade.

### Setup, once

`observed` 2026-09-18 on this iMac19,1 (macOS 15.7, Intel).

1. **JDK 17 from the Adoptium tarball**, into `$HOME`. Not `brew install openjdk@17`: Homebrew has
   dropped bottles for macOS Intel x86_64, so a **formula** install silently falls back to building
   from source and never finishes. Not the `temurin@17` cask either — it installs a `.pkg` and prompts
   for sudo, which hangs an unattended run. System Java here is 14, which `sdkmanager` rejects without
   naming the JDK, so `JAVA_HOME` must be exported explicitly in every shell. **It is the bundle's `Contents/Home`, not the tarball root** — `~/.local/share/jdk-17` holds only `Contents/`, and `JAVA_HOME=~/.local/share/jdk-17` fails with no `bin/java`. `export JAVA_HOME="$HOME/.local/share/jdk-17/Contents/Home"`.
2. **`brew install --cask android-commandlinetools`.** Casks download prebuilt binaries, so the bottle
   drop above does not touch them. SDK root lands at `/usr/local/share/android-commandlinetools`
   (Intel Homebrew).
3. `yes | sdkmanager --licenses`, then install `emulator`, `platform-tools`, `platforms;android-36`
   and `system-images;android-36;google_apis;x86_64`.
   - **`google_apis`, never `default`.** `expo-location`'s background consumer reaches for
     `LocationServices.getFusedLocationProviderClient`
     (`node_modules/expo-location/.../taskConsumers/LocationTaskConsumer.kt:48`, and the hard dependency
     at `node_modules/expo-location/android/build.gradle:19`). An AOSP image has no Play services and
     the gate below fails for a reason that has nothing to do with #141.
   - **API 36** because `expo-modules-core` defaults `targetSdkVersion` to 36. Take plain `android-36`,
     not the `36.1` / `-ext18` / `-ext19` variants.
   - **`platform-tools` is required inside the SDK root** even though the `android-platform-tools` cask
     already supplies `adb`. Without it the emulator dies at `FATAL | Cannot find AVD system path`.
     Export `ANDROID_SDK_ROOT` as well as `ANDROID_HOME` — the emulator reads the former.
   - **Cost: 5.9 GiB on disk** at the SDK root, `observed` via `du -sh` after the install, plus 172 MB
     for the JDK tarball. Free space needed before starting: ≥6 GiB.
4. `echo no | avdmanager create avd -n sakta224 -d pixel_7 -k "system-images;android-36;google_apis;x86_64"`.
   The `echo no` answers the custom-hardware-profile prompt, which otherwise blocks with no output.
   - **Pass `-d pixel_7`.** The default profile is **320 × 640**, too small for the driver app's
     screens; `pixel_7` gives 1080 × 2400 at 420 dpi, which every step below was run on. Check
     `avdmanager list device` rather than guessing an id.
   - **`-d` prints a non-fatal error and works anyway.** `observed` 2026-09-18:
     `Error: Could not load devices from …/system-images/android-36/google_apis/x86_64/devices.xml`,
     twice, while `config.ini` still comes out with `hw.device.name=pixel_7` and
     `hw.lcd.width=1080`. Verify the profile in `~/.android/avd/<name>.avd/config.ini`; do not read
     that error as a failed create.
5. Boot it, then **poll `sys.boot_completed`** — `adb wait-for-device` returns at `adbd`, not at boot,
   and everything after it races the boot otherwise. **~80 s** to `sys.boot_completed=1` on this
   host (`observed` 2026-09-18, `sakta224`, `-no-snapshot -no-boot-anim -gpu swiftshader_indirect`).

Hardware acceleration works on this Intel host (`emulator -accel-check` → `accel: 0`,
Hypervisor.Framework). Do not accept a software-CPU fallback: it is too slow to judge a 4-second
ping cadence.

### Injecting a position

**`adb emu geo fix` alone does nothing, and it fails silently with `OK`.** With no app requesting
location the emulator's GPS HAL sits at `ProviderRequest[OFF]`, `mStarted=false`, so the fix is
accepted and dropped. Use a test provider, which needs no client:

```bash
adb shell appops set com.android.shell android:mock_location allow
adb shell cmd location providers add-test-provider gps
adb shell cmd location providers set-test-provider-enabled gps true
adb shell cmd location providers set-test-provider-location gps --location 56.9496,24.1052
```

- **Inject into `gps` ONLY — never add a test provider named `fused`.** A test provider takes the
  name it is given, so `add-test-provider fused` *replaces* the platform's fused provider (`dumpsys`
  then reads `fused provider [mock]:` instead of `fused provider:`). That is the provider
  `LocationServices.getFusedLocationProviderClient` reaches, so mocking it turns Gate 2 into a test
  of the mock rather than of Play services ingesting a fix. With `gps` alone the **real** fused
  provider ingests it — `observed` 2026-09-18, and both Gate 2 and Gate 3 were run that way.
- **The two mechanisms take coordinates in opposite orders.** `adb emu geo fix` is
  `<longitude> <latitude>`; `set-test-provider-location` is `--location <LATITUDE>,<LONGITUDE>`.
  Rīga is `geo fix 24.1052 56.9496` **and** `--location 56.9496,24.1052`. Swapping either puts the
  driver in open ocean, which looks exactly like "injection does not work".
- **The fix must land inside a seeded zone** or `findNearby` matches nothing. `56.9496,24.1052` is
  inside «Rīgas centrs» (`db/src/seed/riga.ts:36-43`, 56.936–56.966 lat, 24.075–24.135 lng).
- **Run the injection as a repeating loop, not once.** `observed` 2026-09-18: one
  `set-test-provider-location` on a freshly booted emulator left the **fused** provider at
  `last location=null` / `ProviderRequest[OFF]` while the `gps` provider already carried the fix; the
  fused provider only populated after a repeating injection (8 calls over 16 s). A single-shot read
  of the fused provider on a cold boot is a false negative.
- A 2 s loop is `derived` as half of `timeInterval: 4000`
  (`apps/driver/src/features/location/location-options.ts:19`), so the OS floor stays the binding
  constraint. **It does not predict 2 s pings**: the client throttle drops anything under
  `MIN_FIX_INTERVAL_MS = 4_000` (`fix-throttle.ts:9`), so the wire cadence stays ~4 s however fast you
  inject. Reading 2 s and marking a healthy stream ❌ is the mistake this sentence prevents.
- Grep the injected **coordinate**, never a `dumpsys` heading — headings move between API levels.
- Mock fixes carry a `mock` flag. Nothing in shipped driver source reads it (`observed` 2026-09-18),
  so the route is not blocked there today. Re-check if a fix-validation guard is ever added.

### The three gates

Cheapest first, and each ❌ names what it kills.

| Gate | What it asks | Costs | Status |
|---|---|---|---|
| 1 | Does a synthetic fix reach the **fused** provider, and keep arriving? | the 5.9 GiB SDK; no account, no build | ✅ `observed` 2026-09-18 |
| 2 | Does the driver APK receive it, foregrounded — `driver.location.ping_accepted` at ~4 s? | one EAS build + the local stack | ✅ `observed` 2026-09-18 |
| 3 | Do those pings continue with the app **backgrounded**? | nothing further | ✅ `observed` 2026-09-18 |

**Gate 1, as run.** After the repeating injection, `adb shell dumpsys location` reported

```
fused provider:
  service: ProviderRequest[OFF]
  last location=Location[fused 56.949600,24.105200 hAcc=100.0 et=+1m12s716ms mock]
```

and, on a second capture 14 s later, `et=+1m27s295ms` — the elapsed-time field advanced, so this is a
stream and not one stale fix. A `diff` of two captures ≥10 s apart that reports no change is Gate 1's
❌ even when the first read passed.

**`ProviderRequest[OFF]` in that block is expected, and is not the failure signature above.** That one
is the **`gps`** provider with nothing requesting updates, which is why `adb emu geo fix` is dropped;
this is the **`fused`** provider, and `observed` 2026-09-18 it carried an advancing `last location=`
while `service:` read `[OFF]` — so on this line a test provider's writes do not depend on anything
requesting. **The pass criterion is the advancing `et=`, never the `service:` line.**

**Read Gate 1's limit precisely.** What is `observed` is `dumpsys` reporting a fused last-location.
It is **not** observed that `FusedLocationProviderClient.requestLocationUpdates` delivers to a
registered consumer — same provider, different code path, and that difference is exactly what Gate 2
exists to test. Gate 1 must never be quoted as "delivery works".

**Gate 3 is the premise proper**, and its ❌ splits two ways that look identical from the api console.
`LocationTaskConsumer.handleLocationUpdate` branches on `mIsHostPaused`: foregrounded it reports
immediately, backgrounded it goes through `deferLocations` + `maybeReportDeferredLocations`.
`location-options.ts:21-22` sets both deferral knobs to `0`, so deferral *should* be a pass-through —
but that branch is code Gate 2 never executes. Separate the two failures with
`adb logcat -s ExpoLocation:* TaskManager:*`:

- **deliveries appear, reports do not** → deferral swallowed it. This does **not** kill the route and
  does not bear on #141; it is a finding about the deferral path and a separate ticket.
- **no delivery lines at all** → the mock provider does not feed background FLP. **That kills the route.**

"Gate 3 failed" on its own is not a usable result.

### Running the steps on an emulator

Past Gate 3, run §Steps rows **2 through 8** exactly as written above — including step 3's "open
`t/<token>` before the watch starts", and step 2's board-visibility half, which a ping-only gate does
not cover. §Verdict applies unchanged. All eight steps passed on 2026-09-18 — step 1 by the emulator
setup above, 2 through 8 this way; the evidence is in `.claude/reports/emulator-gates-224-report.md`.

Two setup differences, and only two:

- **§0's pre-flight is skipped, and only for an emulator run.** Build the `preview` profile with
  `EXPO_PUBLIC_API_URL=http://10.0.2.2:3001` — `10.0.2.2` is the emulator's fixed NAT alias for the
  host's loopback, so it is a property of the emulator rather than of any network and cannot go stale
  the way a DHCP lease can. Keep the port from the committed value (`API_PORT`, 3001 today) and change
  only the host. The edit stays uncommitted exactly as §0 requires, and **`10.0.2.2` must never reach a
  phone build**, where it means nothing.
- **Taps are `adb`, not a finger.** Steps 4 and 8 are taps: dump the hierarchy with
  `adb shell uiautomator dump`, read the toggle's `bounds`, `adb shell input tap` its centre, and
  capture `adb exec-out screencap -p` as evidence. Record it as a divergence — an `input tap` at exact
  centre coordinates proves nothing about the 44 px touch-target rule a real finger tests.

Four things an agent-driven run needs that a human one does not:

- **`uiautomator dump` fails on any screen with a running countdown**, with
  `ERROR: could not get idle state.` — the OTP resend timer and the offer card both trigger it, and
  so does the toggle mid-animation. `adb exec-out screencap -p` always works. Drive those screens
  from a screenshot and fixed coordinates.
- **An `adb` tap cannot win the offer countdown.** `screencap` → read → `input tap` is a ~4 s round
  trip and the card showed «8 s left» by the time it was read; the offer expired
  (`dispatch.offer.expired`) and the ride stayed unassigned. Use step 3's force-assign path for an
  agent run. A finger on a real phone is not subject to this, so it is not a product finding.
- **The driver phone must not be the dispatcher's.** `findOrCreate` applies `role` only to a
  brand-new row (`auth.repository.ts:47-50`), so reusing the provisioned dispatcher's number signs
  in as a dispatcher and the driver app never leaves onboarding. #224's run used `+37120000001` for
  Dina and `+37120000002` for the driver.
- **The app follows the device locale**, and a stock AVD is `en-US`. Every §Steps expectation cell
  that quotes LV («Tiešsaistē», «Jūs pašlaik izpildāt braucienu.») reads as the EN catalog instead
  (`Online`, `You are on a ride right now.`). Set `adb shell settings put system system_locales lv-LV`
  first if you want the LV strings the cells name.

### Gates 2 and 3, as run

Both on AVD `sakta224`, with the `preview` APK from EAS build
`bcd04c21-d199-43d6-98f0-a3966036cf02` (commit `4e6ffb68`; see §The build blocker for why not `f4d37e4`).

**Gate 2 — foregrounded.** 60 s watch: **14 `driver.location.ping_accepted`, `clientAt` gaps
4.2 s–4.5 s**. The cadence is ~4.2 s and not the 2 s injection rate, because the client throttle
(`MIN_FIX_INTERVAL_MS = 4_000`, `fix-throttle.ts:9`) binds — exactly as §Injecting a position
predicts, and the reason that paragraph exists.

**Gate 3 — backgrounded, the premise proper.** `adb shell input keyevent KEYCODE_HOME`, confirmed
with `dumpsys activity activities` reporting
`ResumedActivity: … nexuslauncher/.NexusLauncherActivity`, so the host is paused and
`LocationTaskConsumer.handleLocationUpdate` is on its `mIsHostPaused` branch. 90 s watch: **21
pings, every `clientAt` gap 4.2 s, not one dropped fix** — steadier than foregrounded, where one gap
read 4.5 s. Deferral is the pass-through `location-options.ts:21-22`'s two zeroed knobs intend.

Device-side corroboration, from a `logcat` armed **before** the install:

```
I/ActivityManager: Background started FGS: Allowed [callingPackage: lv.saktacab.driver; …
  intent: Intent { cmp=lv.saktacab.driver/expo.modules.location.services.LocationTaskService } …]
```

So the real `expo-location` foreground service is what was delivering, not a JS timer.

**Pre-grant both the permission and the app-op, before Gate 2.** This is the one setup mistake that
produces a false **route dead**: on Android 10+ the location app-op can sit at `foreground` with
`ACCESS_BACKGROUND_LOCATION` granted, and delivery then stops the instant the app backgrounds —
byte-for-byte Gate 3's "no delivery lines at all" signature.

```bash
for p in ACCESS_COARSE_LOCATION ACCESS_FINE_LOCATION ACCESS_BACKGROUND_LOCATION POST_NOTIFICATIONS; do
  adb shell pm grant lv.saktacab.driver android.permission.$p
done
adb shell appops set lv.saktacab.driver COARSE_LOCATION allow
adb shell appops set lv.saktacab.driver FINE_LOCATION allow
adb shell appops get lv.saktacab.driver | grep -i LOCATION    # must read `allow`, not `foreground`
```

Record that `appops get` output beside the `dumpsys package … granted=` lines. A route-dead verdict
reached without it is not publishable.

### Prove the NAT before you install

One command separates §4's "transport fault" from #141's claim **before** an APK exists, and it
costs nothing:

```bash
adb shell am start -a android.intent.action.VIEW -d "http://10.0.2.2:3001/health"
```

`observed` 2026-09-18: `{"status":"ok","service":"api"}`. Chrome's first-run screen is in the way on
a fresh image — dismiss it with *Use without an account* then *No thanks*. This tests the alias and
the port only; Chrome has its own cleartext policy, so it says nothing about the app's.

### The build blocker — cleared

`main` could not produce an Android native build at all until 2026-09-18, and the day cost two
builds to find both causes:

- **[#225](https://github.com/linardsb/taxi/issues/225)** — `react-native-worklets` 0.12.1 outside
  `expo-modules-core`'s peer range, failing `expo-modules-core:buildCMakeRelWithDebInfo`. Fixed by
  PR #227's root `pnpm.overrides` pins.
- **[#232](https://github.com/linardsb/taxi/issues/232)** — `expo.locales` writing iOS-only
  `NSLocation*` strings into Android `values-b+<lang>/strings.xml` with no default entry, so
  `:app:lintVitalRelease` failed with 6 fatal `ExtraTranslation` errors (2 keys × 3 locales). Fixed
  by scoping the keys under `"ios"` in `apps/driver/locales/*.json` **and** in
  `apps/rider/locales/*.json`, which carried the same unscoped shape (1 key × 3 locales) and would
  have failed the same way on its first release build; `locales-config.test.ts` guards each app.

Neither is reachable from `pnpm turbo run typecheck lint test build --force` — nothing in the
workspace compiles Android C++ or merges Android resources — and neither is reachable from
`expo install --check`. **Budget one failed build anyway**, and read the failed Gradle task name
before re-queueing: a second lint failure is a different lint id and is diagnosable from the log
without another credit.

`observed` 2026-09-18: the first green build is `bcd04c21-d199-43d6-98f0-a3966036cf02`, **1199 s**
(20:49:41Z → 21:09:40Z), against `edcc579b-…` which died at `lintVitalRelease` after 1182 s. Both
wall times are `completedAt − createdAt` from EAS's own record, not the build-phase `buildDuration`
(1189 s and 1077 s). The two are **not** the same tree: `edcc579b` was built from `ade96c7c`, the
head of PR #227's branch, and `bcd04c21` from `4e6ffb68` off `f7446c3`. What makes the pairing worth
stating anyway is that `git diff ade96c7c 4e6ffb68` touches 12 paths of which **only the three
`apps/driver/locales/*.json` files are build inputs** — the other nine are `.claude/` documents and
two jest tests nothing in the app imports. So the builds differ by #232's fix in everything Gradle
reads, which is the comparison being made; "same tree" was the wrong word for it.

`4e6ffb68` rather than `f4d37e4` is not a typo: they are sibling commits off the same parent, seven
minutes apart, and `git diff 4e6ffb68 f4d37e4` is `apps/driver/src/locales-config.test.ts` and
nothing else. The APK's inputs are identical either way; `4e6ffb68` is the sha EAS recorded.

The APK is 110 069 070 bytes and carries
`lib/x86_64/`, `lib/x86/`, `lib/arm64-v8a/`, `lib/armeabi-v7a/` — universal, so it installs on an
Intel-Mac emulator (this retires the `derived` reading of that in #224's issue body).

**`eas init --id <project-id>` still rewrites `android.permissions`**, so the `--id` form is not a
way around the addendum below. `observed` 2026-09-18: it appends eight fully-qualified entries, three
of them new to the app — `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` and
`FOREGROUND_SERVICE_MEDIA_PLAYBACK`, resolved from the declared `expo-audio` dependency. #224's run
restored the committed eight before building, so the APK under test declares what the repo declares.
A driver app declaring `RECORD_AUDIO` deserves a decision rather than a side effect — take it before
the first build that reaches a real user, not on the day.

### Evidence recorded

- `.claude/reports/emulator-oracle-141-report.md` — the **Gate 1** pass (#224 round 1), its three
  plan defects, and the two build blockers as first seen.
- `.claude/reports/emulator-gates-224-report.md` — **Gates 2 and 3 and §Steps 2–8** (#224 round 2),
  with every ping count, the step-4 refusal probe, and the five runbook defects this file now
  carries.
