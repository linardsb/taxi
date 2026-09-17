# Driver device day — issue #141's proof

Issue [#141](https://github.com/linardsb/taxi/issues/141)'s code is merged (PR #142 `269e8ec`,
PR #145 `a6481aa`). One claim is still owed, and it is **one claim wide**: that after the
toggle-OFF chain runs mid-ride, **the real OS background location task is still emitting fixes that
reach the api**. The driver suite proves `stopStreaming` is never called and can prove nothing
about the task itself — `jest.setup.ts` fakes every native module by design
(`apps/driver/CLAUDE.md`, the Tests bullet). Only a phone closes it.

Everything else about the held branch is already pinned by a test. Do not widen this sheet.
~30 minutes with the setup; the eight steps themselves are ~10.

## Result

| Field | Value |
|---|---|
| Run by | **not yet run** |
| Platform | — |
| App / OS version | — |
| Date | — |
| Outcome | **BLOCKED — no Android phone; no paid Apple account** |

Both substitute paths are closed, and were re-checked rather than assumed:

- **Android emulator: no SDK on this machine.** `emulator` and `sdkmanager` are not on `PATH`,
  `~/Library/Android/sdk` and `~/.android/avd` do not exist, and Android Studio is not installed —
  `observed` 2026-09-17. Only a bare `adb` is present (`/usr/local/bin/adb`, from the
  `android-platform-tools` cask), which has nothing to talk to.
- **iOS Simulator: this Mac cannot build it.** iMac19,1 cannot run Tahoe, so Xcode 26.3 is the
  ceiling, and Expo SDK 57 needs 26.4 to compile `expo-modules-jsi` for iOS — `observed`
  2026-08-25. An installable iOS build also needs the paid Apple Developer Program, which does not
  exist yet.

**When a phone exists:** run every step, fill the table above, record each step pass or fail.
Record failures as findings, never as "mostly worked".

## What this day does NOT need

Three prerequisites that the *old* wording of step 7 appeared to require. It does not — step 7's
signal is an absence in the api console, not a notification on the phone (see step 7 and §C2 of
`.claude/plans/driver-device-day-prep.md`).

| Not needed | Why |
|---|---|
| Firebase / FCM credentials (#14's A1) | No push has to be *delivered*. The dev default is `PUSH_PROVIDER=stub`, and `StubPushProvider` logs what it would have sent and delivers nothing — so a "no notification arrived" pass would be vacuous either way. The signal is the **absence of the api-side events** that precede any send. |
| An EAS project id *for a push token* (#14's A2) | No token has to be minted. `register-push-token.ts:26-31` warns and no-ops without `extra.eas.projectId`, which is fine here — step 7 reads an absence in the api console, not a notification. **The cloud build links a project regardless** — `eas-cli init` is in §2. What is off #141's path is the *token*, which needs A1 as well. |
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
value invisibly (`.claude/plans/driver-device-day-prep.md:563-573`). Revisit that if the lease starts
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
npx eas-cli@latest build -p android --profile preview
```

**`init` mutates a tracked file, and the build needs it.** `apps/driver/app.json` carries no
`extra.eas` and no `owner` today (`observed` 2026-09-17). EAS attaches every build to a linked
project, so without `init` the `build` line stops on an interactive create-or-link prompt instead of
running as copy-paste. The in-repo precedent is `spikes/gps-harness/app.json:42-47` — the config
behind PR #115's APK, the only one this repo has built — which commits **both**
`extra.eas.projectId` and `owner: "linards"`. Afterwards either commit those two keys or
`git checkout apps/driver/app.json`; do not leave them dirty in a checkout several sessions share.
`expected`, not `observed`: `eas-cli` cannot run here without Expo credentials, so the prompt's exact
behaviour is inferred from that asymmetry rather than seen.

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
| 1 | Sign in on the driver phone (`+371…`, role driver; read the code from `auth.otp.stub_sent`). Tap the availability toggle ON | phone | Status reads «Tiešsaistē», pill «Tiešraide» — `Online` / `Live` on an EN phone, the app follows the **device** locale (`deviceLanguage()`, `expo-localization`). Grant background location when asked | |
| 2 | **HARD GATE.** Open `/dispatch`, find that driver on the board | api console + `/dispatch` | `driver.location.ping_accepted` for that `driverId` every ~4 s — **time it by the line's `clientAt`, not its `at`** (see the note below) — and the driver visible on the board. **If the driver is not visible and pinging before any ride exists, STOP** — see the verdict rule | |
| 3 | Create a ride for that driver: a dispatcher phone order (`/dispatch` → new booking), then **accept the offer card if it appears**; if it does not, open the ride's row → **Assign** → pick that driver. **Then open `t/<token>` in a tab and leave it open** — you need it on screen before step 5 starts | phone + `/dispatch` + api console | A phone order goes through `RidesService.request()` and lands at `requested`, so `DispatchSweeper` offers it to the best candidate on its next tick (`dispatch.sweeper.ts:112`). With this phone as the only online driver an offer card will very likely arrive first. Force-assign (`POST /dispatch/rides/:rideId/assign`, `dispatch.controller.ts:95`) is the fallback, not the only path. Board row reaches an accepted state. The token is in the api console: `auth.sms.stub_sent` logs the SMS **body in full**, deliberately, and the tracking link is in it (`stub-sms.provider.ts:28-37`, `body` at `:35`) — tokens are minted inside the booking flow, never by the seed | |
| 4 | On the phone, note the time. **Tap the availability toggle OFF** | phone | The toggle **springs back to ON**; a blue info banner «Jūs pašlaik izpildāt braucienu.» appears (`You are on a ride right now.` on an EN phone) | |
| 5 | Watch for **90 s** without touching the phone | **api console (primary)** | `driver.location.ping_accepted` for that `driverId` continues at ~4 s intervals for the whole 90 s, **with no `clientAt` gap > 12 s** (see the two notes below — both the field and the threshold matter). 90 s clears the 60 s `findNearby` freshness window — a stream that only survives 30 s proves nothing. **`/dispatch` is NOT the signal here**: the board renders position and no freshness, so a still pin is **not** a failure — see the note below | |
| 6 | During that same 90 s, watch the `t/<token>` tab you opened at step 3. Record what it showed | `t/<token>` (corroboration) | The «position updated HH:MM:SS» line keeps ticking (`tracking-map.tsx:334-335`). It advances on a **fresh fix**, not on movement, so it reads correctly with the phone flat on a table. This is the only in-product surface that renders freshness, and it is what a person can watch without a terminal | |
| 7 | Complete the ride from `/dispatch` | **api console**, read as an **absence** | For 2 minutes after completion, for that `driverId`: **no** `driver.presence.status_changed` with `reason: 'dark'`, and **no** `driver.push.nudge_*` line at all — `nudge_skipped`, `nudge_sent` or `nudge_failed` (see the note below; **not** `driver.push.stub_sent`, which cannot appear on this setup). `driver.location.ping_accepted` continues throughout — the stream survived the release too, which is what makes a nudge impossible | |
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
(`.claude/plans/driver-app-auth-online-location.md:828`).

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
nudge family is what a broken app actually prints: the `no_token` skip in that guard today, and
`nudge_sent`/`nudge_failed` if the push prerequisites are ever met. Watching `nudge_*` reads the same
absence and stays true either way.

**Why `/dispatch` is not the freshness signal.** `apps/dispatch/src/features/board/board-state.ts:127`
folds `lastSeenAt` into each driver on every `driver:location` event and **nothing in the board
slice reads it back** (`observed` 2026-09-17). So the board shows position and no freshness. The
phone streams a fix every 4 s whether or not it moves — the throttle is time-based
(`fix-throttle.ts:9`, `MIN_FIX_INTERVAL_MS = 4_000`) and `distanceInterval` is `0`
(`location-options.ts:20`), both by design — so a
stationary phone's pin does not move, and a live stream and a dead one look identical there.
Rendering board freshness is the clean fix and is deliberately a separate ticket.

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

**This runbook does not close #141 by itself.** Close #141 when steps 5–8 have been run on a phone
and the Result table above is filled in.

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
