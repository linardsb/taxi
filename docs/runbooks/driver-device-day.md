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
| `eas init` / an EAS project id (#14's A2) | Only needed for a push *token*. `register-push-token.ts:26-31` warns and no-ops without it, which is fine here. |
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
npx eas-cli@latest build -p android --profile preview
```

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
| 1 | Sign in on the driver phone (`+371…`, role driver; read the code from `auth.otp.stub_sent`). Tap the availability toggle ON | phone | Status reads «Tiešsaistē», pill «Tiešraide». Grant background location when asked | |
| 2 | **HARD GATE.** Open `/dispatch`, find that driver on the board | api console + `/dispatch` | `driver.location.ping_accepted` for that `driverId` every ~4 s, and the driver visible on the board. **If the driver is not visible and pinging before any ride exists, STOP** — see the verdict rule | |
| 3 | Create a ride for that driver: a dispatcher phone order (`/dispatch` → new booking), then **accept the offer card if it appears**; if it does not, open the ride's row → **Assign** → pick that driver. **Then open `t/<token>` in a tab and leave it open** — you need it on screen before step 5 starts | phone + `/dispatch` + api console | A phone order goes through `RidesService.request()` and lands at `requested`, so `DispatchSweeper` offers it to the best candidate on its next tick (`dispatch.sweeper.ts:112`). With this phone as the only online driver an offer card will very likely arrive first. Force-assign (`POST /dispatch/rides/:rideId/assign`, `dispatch.controller.ts:95`) is the fallback, not the only path. Board row reaches an accepted state. The token is in the api console: `auth.sms.stub_sent` logs the SMS **body in full**, deliberately, and the tracking link is in it (`stub-sms.provider.ts:28-33`) — tokens are minted inside the booking flow, never by the seed | |
| 4 | On the phone, note the time. **Tap the availability toggle OFF** | phone | The toggle **springs back to ON**; a blue info banner «Jūs pašlaik izpildāt braucienu.» appears | |
| 5 | Watch for **90 s** without touching the phone | **api console (primary)** | `driver.location.ping_accepted` for that `driverId` continues at ~4 s intervals for the whole 90 s, **with no gap > 8 s**. 90 s clears the 60 s `findNearby` freshness window — a stream that only survives 30 s proves nothing. **`/dispatch` is NOT the signal here**: the board renders position and no freshness, so a still pin is **not** a failure — see the note below | |
| 6 | During that same 90 s, watch the `t/<token>` tab you opened at step 3. Record what it showed | `t/<token>` (corroboration) | The «position updated HH:MM:SS» line keeps ticking (`tracking-map.tsx:334-335`). It advances on a **fresh fix**, not on movement, so it reads correctly with the phone flat on a table. This is the only in-product surface that renders freshness, and it is what a person can watch without a terminal | |
| 7 | Complete the ride from `/dispatch` | **api console**, read as an **absence** | For 2 minutes after completion, for that `driverId`: **no** `driver.presence.status_changed` with `reason: 'dark'`, and **no** `driver.push.stub_sent`. `driver.location.ping_accepted` continues throughout — the stream survived the release too, which is what makes a nudge impossible | |
| 8 | Now tap the toggle OFF again | phone + api console | It goes OFF normally, **no banner** — the hold was ride-scoped, not sticky. `status_changed to=offline` with no reason; pings stop | |

**Numbering is deliberately unchanged** from the retired sheet
(`.claude/plans/driver-toggle-off-mid-ride-held.md` §Level 4), so the issue comments and PR reviews
that cite step numbers still resolve. The one instruction the old sheet lacked is folded into step 3
rather than renumbered in: open `t/<token>` **before** the 90-second watch, so step 6 records what
was already on screen instead of sending the operator off to find a token mid-watch.

**Why `/dispatch` is not the freshness signal.** `apps/dispatch/src/features/board/board-state.ts:127`
folds `lastSeenAt` into each driver on every `driver:location` event and **nothing in the board
slice reads it back** (`observed` 2026-09-17). So the board shows position and no freshness. The
phone streams a fix every 4 s whether or not it moves — the throttle is time-based with
`distanceInterval: 0` by design (`fix-throttle.ts:9`, `MIN_FIX_INTERVAL_MS = 4_000`) — so a
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
