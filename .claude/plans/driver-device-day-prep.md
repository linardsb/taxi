# Feature: #141 device-day prep — make the toggle-OFF-mid-ride run sheet performable

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Issue #141's **code shipped** — PR #142 (`269e8ec`) landed the held-offline-put design change,
PR #145 (`a6481aa`) pinned the server half. What is still owed is a ~10-minute manual run on a
physical Android phone, and that run is currently **not performable for three reasons that have
nothing to do with hardware**:

1. There is no build route. `apps/driver` has no `eas.json`, and this machine has no Android SDK
   (`observed` 2026-09-17: `emulator`, `sdkmanager` not found; `~/Library/Android/sdk` and
   `~/.android/avd` absent; no Android Studio; only a bare `adb` at `/usr/local/bin/adb`). So even
   with a phone in hand there is nothing to install on it.
2. Two of the run sheet's steps read signals that do not exist. Step 5 says "the pin keeps moving"
   — the dispatch board renders no freshness at all, so a stationary phone is indistinguishable
   from a frozen one. Step 7 says "no offline push nudge arrives on the phone" — with
   `PUSH_PROVIDER=stub` (the dev default) **no push can ever arrive**, so the step passes
   vacuously whether the fix works or not.
3. The owed step set is stated three different ways across three sources, and no source is a
   superset of the others.

This ticket fixes all three: a build route, a corrected run sheet in one durable home, and a
re-derived step set. It conjures no hardware and it does not close #141.

## User Story

As **Linards**, the day a phone is available
I want to **open one runbook and run #141's proof end to end in ~30 minutes**
So that **#141 closes on evidence, instead of on the automated cover alone** — which its own
issue body says is not enough.

## Problem Statement

#141's residual claim is one sentence wide: *after the toggle-OFF chain runs mid-ride, the real
OS location task is still emitting fixes that reach the api.* `jest.setup.ts` fakes every native
module by design (`apps/driver/CLAUDE.md`, Tests bullet), so the driver suite can prove
`stopStreaming` is never called and can prove nothing about the task itself. Only a device closes it.

But "only a device closes it" has been used as though the device were the *only* missing piece. It
is not. Three of the sheet's eight steps are unperformable or unreadable as written, and there is
no way to get a build onto a device at all. A device day booked against the sheet as it stands
would burn its first hour on `eas.json` and its last on an argument about what step 7 proved.

## Solution Statement

Ship the three things that stand between a phone and a verdict:

- **A build route** — four parts, not one: `apps/driver/eas.json` with a `preview` profile producing
  an installable APK through EAS Build's cloud (no local Android SDK), carrying
  `EXPO_PUBLIC_API_URL` inlined at build time **and** a pnpm version pin (B2); an
  `eas-build-post-install` script so `@taxi/shared` exists on the builder at all (B1 — its `dist/`
  is gitignored and nothing on EAS rebuilds it); and `expo-build-properties` allowing cleartext, or
  neither the REST calls nor the WebSocket reach an `http://` LAN origin.
- **One corrected run sheet, in one place** — `docs/runbooks/driver-device-day.md`, mirroring
  `docs/runbooks/rider-a11y-walkthrough.md`: a Result table that reads BLOCKED until someone runs
  it, a Setup section that cites (not restates) #14's boot recipe, and eight steps each naming the
  signal it reads and where that signal appears.
- **Retirement of the duplicate copies** — the run sheet currently lives in
  `.claude/plans/driver-toggle-off-mid-ride-held.md` §Level 4 and is partly restated in
  `.claude/plans/driver-app-auth-online-location.md` §C.14 and in two issue comments. Three copies
  is how the step-set inconsistency happened. Both plans get a pointer; the runbook becomes the
  only copy.

## Out of Scope / Non-Goals

- **Not included: a phone, or any attempt to substitute for one.** Both substitute paths are
  closed and were re-checked at planning time, not assumed:
  - Android emulator — no SDK on this machine (`observed` above); installing Android Studio + SDK +
    an AVD + the SDK 57 prebuild toolchain on an Intel iMac is a multi-GB detour with an uncertain
    end, and the evidence it would produce is weaker than a device's.
  - iOS Simulator — this iMac19,1 cannot run Tahoe, so Xcode 26.3 is the ceiling, and Expo SDK 57
    does not compile for iOS below 26.4 (`observed` 2026-08-25). An installable iOS build also
    needs the paid Apple Developer Program, which does not exist yet.
- **Not included: running the sheet.** The Result table ships reading **BLOCKED — not yet run**,
  exactly as `rider-a11y-walkthrough.md` does. #141 stays OPEN.
- **Not included: #14's Level 4 §C 1–13**, the `ui-decisions.md` ear-checks (#161's two label
  states, F4's offer-card label, #163's N3 live region), or #16's Level 4. They ride the same
  device day and the runbook *lists* them so nobody re-books the day twice — it does not own them.
- **Not included: A1 (Firebase/FCM credentials).** Once step 7's signal is re-targeted to the api
  console (see C2 below), #141's run needs no real push delivery at all. A1 stays #14's.
- **Not changing: any shipped app or api source.** Everything this ticket touches in `apps/driver`
  is build configuration — `eas.json` (new), a `scripts` entry and one dependency in
  `package.json`, one `plugins` entry in `app.json`. No `.ts`/`.tsx` under `src/` is edited. The
  reducer, the effect runner and the api are all correct and merged — do not touch them.
- **Not included: rendering driver freshness on the dispatch board.** It is the clean fix for C1's
  root cause and it is a separate ticket (see Open Questions Q4); this ticket routes around it.

## Feature Metadata

**Feature Type**: Enhancement (tooling + documentation; no runtime behaviour change)
**Estimated Complexity**: Low-Medium — three small `apps/driver` config edits (one adding a
dependency), one runbook, three pointer edits. The complexity is not in the diff; it is that two of
the three config edits fix failures that cannot be reproduced on this machine (B1, B2).
**Primary Systems Affected**: `apps/driver` (build config only), `docs/runbooks/`, `.claude/plans/`
**Dependencies**: EAS Build (cloud); an Expo account under owner `linards` already exists
(`spikes/gps-harness/app.json:42-47`)

## Related Work

**Implements**: the prep half of [#141](https://github.com/linardsb/taxi/issues/141) · **Epic**: #1
via parent [#14](https://github.com/linardsb/taxi/issues/14)

**Back-references**:

- `.claude/plans/driver-toggle-off-mid-ride-held.md` — Why: the ticket whose §Level 4 this replaces;
  every design fact about the held branch is there and is **not** re-litigated here.
- `.claude/plans/driver-app-auth-online-location.md` — Why: #14's plan owns the A1/A2/A3 prerequisite
  spine (§Level 4 §A), the boot recipe (§B) and the emulator step list (§C). Cite it, do not copy it.
- `docs/runbooks/rider-a11y-walkthrough.md` — Why: the shape this ticket's runbook mirrors, including
  the honest BLOCKED Result table.

**Forward-references**:

- (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `docs/runbooks/rider-a11y-walkthrough.md` (whole file, 168 lines) — Why: **the** template. Result
  table at the top recording "not yet run / BLOCKED" with the reason; Setup; numbered steps each
  naming its signal. Copy its shape, not its content.
- `.claude/plans/driver-toggle-off-mid-ride-held.md` (lines 713-760, §Level 4) — Why: the run sheet
  being corrected and moved. Read the surrounding "Exactly what the device adds" paragraph — it is
  the one-claim-wide framing the runbook must preserve.
- `.claude/plans/driver-app-auth-online-location.md` (lines 810-830, §Level 4 §A/§B/§C.1-3) — Why:
  the prerequisites (A1/A2/A3) and the boot recipe the runbook cites. §C.14 (the superseded #141
  step) is one of the pointers this ticket repoints.
- `spikes/gps-harness/eas.json` (whole file, 13 lines) — Why: the **working** preview/APK profile
  shape, in-repo, from the kit that actually produced an installable APK (PR #115). Mirror it.
- `spikes/gps-harness/app.json:42-47` — Why: proves an Expo account exists under `owner: "linards"`
  and shows where `extra.eas.projectId` lands.
- `pnpm-workspace.yaml` (5 lines) — Why: `spikes/` is **not** a workspace package, so the harness
  precedent proves an APK profile shape and **not** that a `workspace:*` package builds on EAS.
  This is the plan's largest open risk (R1).
- `apps/driver/src/config.ts` (whole file, 19 lines) — Why: `apiUrl()` reads
  `EXPO_PUBLIC_API_URL`, inlined by Metro at bundle time, and **throws** in a non-`__DEV__` build
  when it is absent. A `preview` APK built without it is dead on first request.
- `apps/driver/app.json` (whole file) — Why: where a cleartext config-plugin entry would go, and
  the file that has **no** `extra.eas.projectId` today.
- `apps/driver/src/features/push/register-push-token.ts:26-31` — Why: without that projectId the app
  warns and no-ops. Confirms #141's *signal* needs neither A1 nor A2 — **corrected 2026-09-17
  (PR #218 review F1, see AMENDMENTS)**: the cloud **build** still links an EAS project
  (`eas-cli init`, which writes that key), which is a separate concern from A2's push credentials.
- `services/api/src/main.ts:21` — Why: `await app.listen(env.API_PORT)` with no host argument, so
  the dev API is already reachable from the LAN. No change needed.
- `services/api/src/features/drivers/location/driver-location.service.ts:76-83` — Why:
  `driver.location.ping_accepted` is `logger.debug`, and it is the signal step 5 is re-targeted to.
- `services/api/src/features/auth/sms/stub-sms.provider.ts:28-39` — Why: the stub logs the SMS body
  in full, deliberately, "so manual validation reads the tracking link out of this log". Step 6's
  `t/<token>` comes from here.
- `services/api/src/features/push/stub-push.provider.ts:25` — Why: `driver.push.stub_sent` is the
  event whose **absence** step 7 reads.
- `apps/dispatch/src/features/board/board-state.ts:127` — Why: sets `lastSeenAt` per driver and
  **nothing renders it**. This is C1's root cause.
- `services/api/src/features/dispatch/dispatch.controller.ts:95` — Why: `@Post('rides/:rideId/assign')`,
  the force-assign endpoint. The old sheet pins it at `:97`; that has drifted.
- `services/api/src/features/dispatch/bookings/bookings.service.ts:51-60` — Why: a dispatcher phone
  order goes through `RidesService.request()`, so **the cascade auto-offers**. Step 3 must say so.

### New Files to Create

- `docs/runbooks/driver-device-day.md` — the corrected #141 run sheet, the boot recipe by reference,
  the Result table, and the list of what else rides the same day.
- `apps/driver/eas.json` — the `preview` build profile (APK, internal, `env`, pnpm pin).

**Existing files edited** (small, but two of them are what make the build work at all):

- `apps/driver/package.json` — the `eas-build-post-install` script (B1) and the
  `expo-build-properties` dependency added by `npx expo install`.
- `apps/driver/app.json` — the `expo-build-properties` plugin entry.
- `.claude/plans/driver-toggle-off-mid-ride-held.md`, `.claude/plans/driver-app-auth-online-location.md`,
  root `CLAUDE.md` — pointers.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [EAS Build — Internal distribution](https://docs.expo.dev/build/internal-distribution/)
  - Specific section: Android APK for internal distribution
  - Why: the `preview` profile's `distribution: "internal"` + `android.buildType: "apk"` shape
- [EAS Build — Monorepo setup](https://docs.expo.dev/guides/monorepos/#eas-build)
  - Specific section: pnpm workspaces
  - Why: R1 — whether `apps/driver` with `"@taxi/shared": "workspace:*"` builds on EAS unchanged
- [EAS Build — Environment variables](https://docs.expo.dev/build-reference/variables/)
  - Specific section: `env` in a build profile / EAS environment variables
  - Why: how `EXPO_PUBLIC_API_URL` reaches the Metro bundle on a cloud build
- [expo-build-properties](https://docs.expo.dev/versions/latest/sdk/build-properties/)
  - Specific section: `android.usesCleartextTraffic`
  - Why: an `http://` LAN origin in a release-flavoured build
- [Expo push — FCM V1 credentials](https://docs.expo.dev/push-notifications/fcm-credentials/)
  - Why: **reference only** — cited in the runbook's "what this day does NOT need" note, so nobody
    re-adds A1 to #141's critical path

### Patterns to Follow

**Runbook shape** (`docs/runbooks/rider-a11y-walkthrough.md:13-40`) — a Result table first, filled
with `not yet run` / `—` / `BLOCKED`, then the reason, then Setup, then numbered steps:

```markdown
## Result

| Field | Value |
|---|---|
| Run by | **not yet run** |
| Platform | — |
| App / OS version | — |
| Date | — |
| Outcome | **BLOCKED — see below** |
```

**Every step names its signal, and where the signal appears.** The existing sheet's strongest rows
already do this ("90 s is chosen to clear the 60 s `findNearby` freshness window"). Keep that and
extend it: each row gets a *Signal* column saying **api console** / **`/dispatch`** / **phone**.

**Figures carry provenance inline** (root `CLAUDE.md`): `observed` names the run, `derived` shows
the arithmetic and the condition, `expected` is not yet run. The runbook's one derived figure is
step 7's window — show it (see C2).

**EAS profile** (`spikes/gps-harness/eas.json`) — minimal, no profile inheritance, no `production`
profile invented for a ticket that does not ship one:

```json
{
  "cli": { "appVersionSource": "local" },
  "build": {
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    }
  }
}
```

---

## THE STEP-SET RE-DERIVATION (read before writing the runbook)

Three sources state the owed set and they disagree. **Do not copy any of them.** The table below is
re-derived from the run sheet's own eight rows
(`.claude/plans/driver-toggle-off-mid-ride-held.md:713-760`) by asking, per row, *what claim of
#141's fix does this row test?*

| Step | Row | Role | Why |
|---|---|---|---|
| 1 | sign in, toggle ON | setup | precondition; proves nothing about #141 |
| 2 | find the driver on `/dispatch` | setup | precondition |
| 3 | get the driver onto a ride | setup | precondition |
| 4 | tap OFF → springs back ON + banner | **load-bearing** | the reducer's held branch, user-visible |
| 5 | stream survives for 90 s | **load-bearing** | the residual claim: the native task was not torn down |
| 6 | the same stream on `t/<token>` | corroborating | second surface, same claim as 5 — no new #141 evidence, but it is the **only** surface that renders freshness (`tracking-map.tsx:334-335`), so it is what the operator actually watches during step 5 |
| 7 | no nudge after completion | **load-bearing** | the harm the issue body ends on; the stream must survive the release too |
| 8 | tap OFF after the ride → goes offline, no banner | **load-bearing** | the opposite failure: a hold that outlives the ride (review F1) |

**Load-bearing: 4, 5, 7, 8. Corroborating: 6. Setup: 1–3.**

Reconciliation of the three sources, so nobody re-opens this:

- **Issue comment 1 — {4, 5, 7, 8}**: correct. Matches the re-derivation exactly.
- **Issue comment 2 — {4, 5, 6, 8}**: not wrong, differently scoped. Its own sentence adds "and so
  is step 7's client half", so its true set is {4, 5, 6, 7, 8} — it folds the corroborating row in.
- **The table footer — "Any ❌ on 4, 5 or 7"**: written before review F1, which is what made step 8
  passable at all (comment 1 says so). Stale by construction, not wrong when written.

The runbook states the re-derived set once and **cites this section as where it came from**.

---

## THE TWO SIGNAL CORRECTIONS (the substance of this ticket)

### C1 — step 5 reads a signal the dispatch board does not render

**What the sheet says**: "The pin **keeps moving** the whole time."

**Why it cannot be read as written**: `apps/dispatch/src/features/board/board-state.ts:127` folds
`lastSeenAt` into each driver on every `driver:location` event — and **nothing in the board slice
reads it back** (`observed`: `grep -n lastSeenAt apps/dispatch/src/features/board/*.ts*` outside
tests returns that one line). So the board shows position and no freshness. A phone sitting on a
table streams a fix every 4 s (the throttle is time-based with `distanceInterval: 0`, by design —
`apps/driver/CLAUDE.md`, the "Throttle by TIME" bullet) and its pin **does not move**. A live
stream and a dead one look identical.

**The correction**: the primary signal moves to the api console, which reads the claim directly, and
the **tracking page** — not the board — becomes the in-product corroboration.

> **Signal (api console)**: **the stream does not stop** — `driver.location.ping_accepted` for that
> `driverId` still arriving at t+90 s, with no sustained **`clientAt`** silence. One gap just over
> the 12 s threshold is a re-read, not a ❌; the ❌ is a stream that goes quiet and stays quiet.
> ~~no gap > 8 s~~ — **corrected 2026-09-17 (PR #218 review F3/F6, see AMENDMENTS)**: the line
> carries two timestamps and a queue replay bunches the server `at`s; and 8 s is exactly the gap one
> dropped OS delivery produces against a 4 s throttle, so it left no tolerance. 12 s is `derived` —
> 3 × `MIN_FIX_INTERVAL_MS`. ~~with no `clientAt` gap > 12 s~~ — **corrected again 2026-09-17 (PR
> #218 review round 2, L1)**: that phrasing made the threshold itself the pass condition, which the
> runbook's own note then contradicted on a step the verdict rule makes binary. The threshold and
> the field both stand; what they feed is a judgement about whether the stream stopped, not a
> stopwatch. Also read the newest `clientAt` against the wall clock — a gap check alone cannot tell
> a live stream from a backlog draining (L4).
> **Corroboration (`t/<token>`, i.e. step 6 opened early)**: the «position updated HH:MM:SS» line
> keeps ticking. It advances on a *fresh fix*, not on movement, so it reads correctly with the phone
> flat on a table.
> **Not a signal (`/dispatch`)**: the board pin moves only if the phone does. A still pin is **not**
> a failure.

`driver.location.ping_accepted` is `logger.debug` (`driver-location.service.ts:76`), and it does
print under `pnpm --filter @taxi/api dev`: `main.ts` installs no custom logger and never narrows
`logLevels`, and Nest's default set includes `debug` (`observed`:
`node_modules/@nestjs/common/services/console-logger.service.js:12-19` lists
`['log','error','warn','debug','verbose','fatal']`).

**The tracking page renders freshness and the board does not** — `observed`:
`tracking-map.tsx:334-335` renders `page.position_updated` with `timeOf(view.position.at)` (and
`:227` a connection-lost time), while the board's `lastSeenAt` is written at `board-state.ts:127`
and read back nowhere outside tests. That asymmetry is why step 6 stops being a mere second opinion
and becomes the readable surface a person can watch without a terminal — the runbook should have
the operator open `t/<token>` **during** step 5, not after it.

### C2 — step 7 reads a signal the dev environment cannot emit

**What the sheet says**: "No offline push nudge arrives on the phone in the following 2 min."

**Why it is vacuous as written**: the dev default is `PUSH_PROVIDER=stub`
(`.env.example`, the Expo push block), and `StubPushProvider` "logs the nudge and delivers
nothing". **No push can reach the phone regardless of whether the fix works.** A pass proves
nothing. Making it real would need A2 (`eas init`) *and* A1 (Firebase/FCM credentials) *and*
`PUSH_PROVIDER=expo` — three prerequisites bought for a step that has a free, better signal.

**The correction**: read the api console for the two events on the nudge's only path, and read them
as an **absence**.

> **Signal (api console)**: for 2 minutes after the ride completes, for that `driverId`, there is
> **no** `driver.presence.status_changed … reason=dark` and **no** `driver.push.nudge_*` line —
> `nudge_skipped`, `nudge_sent` or `nudge_failed`. ~~`driver.push.stub_sent`~~ — **corrected
> 2026-09-17 (PR #218 review F2, see AMENDMENTS)**: `stub_sent` is unreachable on this day's setup,
> because without A1/A2 there is no push token and `sendDueNudges` `continue`s at
> `drivers.service.ts:353-360` before the send at `:362`. `driver.location.ping_accepted` continues
> throughout — the stream survived the release too, which is the precondition that makes a nudge
> impossible.

**Why that absence is the whole claim** (`observed`, one path, five files):

1. `markDarkDrivers` (`drivers.service.ts:319-330`) walks `listOnline(cityId)` and marks anyone
   whose `lastSeenMs` is older than `PRESENCE_DARK_AFTER_SECONDS`.
2. Marking goes through `markOfflineByServer` (`driver-presence.repository.ts:33-43`), whose WHERE
   is `status = 'online'`. **During the held ride the row is `on_ride`, so the column cannot be
   stamped at all** — whatever the Redis score says.
3. The driver is still *in* the Redis online set during the ride: the refused offline PUT throws at
   `drivers.service.ts:179` **before** any `markOffline`.
4. `releaseFromRide` (`drivers.repository.ts:294-301`) sets `on_ride → online` and touches neither
   Redis nor `offline_nudge_due_at`. From completion onward the driver is swept normally.
5. `offline_nudge_due_at` has exactly **one** writer that sets it non-null
   (`driver-presence.repository.ts:39`) and **one** reader that sends
   (`sendDueNudges`, `drivers.service.ts:338`, via `findDueNudges`'s
   `status='offline' AND offline_nudge_due_at <= now`). That reader's first act after claiming is
   the `no_token` guard at `:353-360`, fifteen lines inside the method — so on a day without A1/A2
   what a due nudge prints is `driver.push.nudge_skipped`, never `stub_sent` (PR #218 review F2).

So after completion the only question is whether the driver's Redis score is fresh. With the fix it
is (the stream never stopped) → `continue` at `drivers.service.ts:324` → never marked → never
stamped → no nudge, from any provider. Without the fix it is as old as the toggle tap → marked,
stamped, nudged. That is precisely the pair PR #145 put in
`driver-presence.integration.spec.ts`; the device run's added value is that the *real phone's real
task* is what keeps the score fresh.

**The 2-minute watch, re-derived.** Let C be ride completion. Worst case to an observable nudge in
the broken app: ≤15 s to the marking tick + 30 s nudge delay + ≤15 s to the sending tick =
**C + 60 s** — `derived` from `PRESENCE_SWEEP_INTERVAL_MS = 15_000` and
`OFFLINE_NUDGE_DELAY_SECONDS = 30` (`driver-location.policy.ts:36,42`), assuming the dark condition
is already true at C, which it is whenever the ride ran longer than
`PRESENCE_DARK_AFTER_SECONDS = DRIVER_LOCATION_TTL_SECONDS = 60` (`:15,30`). The sheet's existing
2-minute watch is a safe margin over that and **survives re-derivation — keep the figure, add the
arithmetic.**

### C3, C4, C5 — three smaller corrections

- **C3, step 3**: a dispatcher phone order runs through `RidesService.request()`
  (`bookings.service.ts:51`) and lands at `requested`, and `DispatchSweeper` takes `requested` rides
  "with nobody holding an offer" and offers the best candidate on its next tick
  (`dispatch.sweeper.ts:112`; the cascade itself is `dispatch.service.ts:137-159`) — read out of the
  sweeper, not out of `bookings.service.ts`'s docblock, which merely asserts it. So **the ride is
  offered automatically**, with no force-assign. With the phone as
  the only online driver, an offer card will very likely arrive before anyone opens the assign
  dialog. The step must read: *accept the offer card if it appears; if it does not, force-assign
  from the ride's row.* The old sheet implies force-assign is the only path.
- **C4, step 6**: say where the token comes from — `auth.sms.stub_sent` in the api console, whose
  body is logged in full on purpose (`stub-sms.provider.ts:28-33`). Tokens are minted inside the
  booking flow and never by the seed.
- **C5**: the force-assign endpoint pin has drifted — `dispatch.controller.ts:95`, not `:97`
  (`observed` 2026-09-17).

---

## IMPLEMENTATION PLAN

### Phase 1: The build route

**Independent of:** Phase 2 — different files, no shared edit. Worth splitting into a second loop
only if R1 turns into real work.

**Tasks:**

- Add the `eas-build-post-install` script so `@taxi/shared` is built on the builder (B1) — **first**,
  because without it nothing else in this phase can produce a working APK.
- Add `apps/driver/eas.json`: internal distribution, Android APK, `EXPO_PUBLIC_API_URL` in the
  profile's `env`, and a `pnpm` pin matching root `packageManager` (B2).
- Add `expo-build-properties` with `android.usesCleartextTraffic: true` — required, not conditional.
- Prove the JS half without a cloud build: export the Android bundle with the variable set and
  assert the origin is inlined.

### Phase 2: The runbook

**Depends on:** nothing in Phase 1 (it cites the build route, it does not execute it).

**Tasks:**

- Create `docs/runbooks/driver-device-day.md` from the `rider-a11y-walkthrough.md` shape.
- Fold in the re-derived step set and corrections C1–C5.
- List, without owning, the other work that rides the same device day.

### Phase 3: Retire the duplicate copies

**Depends on:** Phase 2 (the pointers need a target).

**Tasks:**

- `.claude/plans/driver-toggle-off-mid-ride-held.md` — replace the §Level 4 Step 1 table with a
  pointer; add an AMENDMENTS entry.
- `.claude/plans/driver-app-auth-online-location.md` §C.14 — repoint from the old plan to the runbook.
- Add the runbook to the root `CLAUDE.md` on-demand-context table.
- Comment on #141 with the re-derived set and C1/C2.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### ADD `eas-build-post-install` to `apps/driver/package.json` — **B1, the build does not work without it**

- **IMPLEMENT**: one `scripts` entry:
  ```json
  "eas-build-post-install": "cd ../.. && pnpm --filter @taxi/shared build"
  ```
- **WHY** (every premise `observed` 2026-09-17, not inherited): `packages/shared/package.json:6`
  resolves the package through `"main": "./dist/index.js"`, and `git check-ignore -v
  packages/shared/dist` answers `.gitignore:6:dist/`. EAS builds its upload archive by honouring
  `.gitignore`, so **`packages/shared/dist` never reaches the builder**. Nothing rebuilds it there:
  `packages/shared` has a `build` script but no `prepare` and no `postinstall`, and EAS runs
  install → prebuild → gradle, never turbo. `apps/driver` has no `metro.config.js`, so Metro has no
  alternate resolution to fall back on. Metro would fail to resolve `@taxi/shared`.
- **WHY THIS IS INVISIBLE LOCALLY**: `packages/shared/dist/index.js` **exists on this machine**
  (`observed`) because the gate builds it. Every local check passes. The failure appears only on a
  machine that cloned the repo — which is exactly what EAS is.
- **PATTERN**: `eas-build-post-install` runs after install and prebuild, before gradle. Expo's own
  monorepo guidance uses this hook for exactly this (`cd ../.. && <build the workspace dep>`).
- **GOTCHA**: a `scripts` entry does not touch `pnpm-lock.yaml`, so this cannot invalidate the
  lockfile. Do **not** "fix" this by un-ignoring `dist/` — that would commit build output across
  the whole workspace.
- **VALIDATE**: the cheap premise check, then the full reproduction (both already run — see
  NOTES → *The B1 reproduction* for the outputs):
  ```bash
  git ls-files packages/shared | grep -c "^packages/shared/dist/"   # observed: 0
  cd apps/driver && sh -c 'cd ../.. && pnpm --filter @taxi/shared build' && echo POST_INSTALL_OK
  ```
  The premise check is `observed 0`: the builder receives no `dist/`. **Re-run the full
  reproduction after adding the script** — it is Level 4 check 7 — because it is the only thing
  that exercises the hook's actual command against a tree that lacks `dist/`.
- **SATISFIES**: AC #1

### REPAIR `apps/driver/assets/notification-icon.png` — **B3, its signature is text, not bytes**

- **THE DEFECT, diagnosed to the byte** (`observed` 2026-09-17): the committed file is 700 bytes
  beginning with the ASCII characters `\x89PNG\r\n\x1a\n` — the *escape sequences written
  literally*, 17 characters where the 8-byte PNG signature belongs. `file` reports `data`.
  `git show HEAD:apps/driver/assets/notification-icon.png | xxd` confirms the corruption is in the
  committed blob, introduced by `3d2e874` (#14's feature commit). It is the **only** corrupt asset
  in either app — every other PNG in `apps/driver/assets` and `apps/rider/assets` is valid.
- **THE PAYLOAD IS INTACT — this is a 9-byte repair, not a lost asset.** The `IHDR` chunk starts at
  byte 17, and everything from there is genuine PNG data. Splicing the correct 8-byte signature onto
  `b.subarray(17)` yields a 691-byte file that `file` reports as
  `PNG image data, 96 x 96, 8-bit/color RGBA, non-interlaced`. Decoding it (inflate + un-filter)
  gives **4792 fully-opaque pixels, every one of them white, plus 232 anti-aliased edge pixels:
  a solid white disc on transparent** — a correct Android notification icon. Nothing was designed
  and lost here; only the header was written wrongly. (**Figure corrected 2026-09-17**: this line
  said 4872, which does not reproduce and which no alpha threshold accounts for — counting the
  anti-aliased edge as opaque gives 5024. The payload-intact conclusion rests on the three valid
  chunk CRCs and the decode, not on the count.)
- **WHY IT BLOCKS THE BUILD**: `app.json` references it **twice** — `expo-notifications`' `icon` and
  `expo-location`'s `androidForegroundServiceIcon`. `npx expo prebuild --platform android` fails on
  it: `PREBUILD_EXIT=1`, `[android.dangerous]: withAndroidDangerousBaseMod: … Encountered an issue
  resizing Android notification icon: Error: Could not find MIME for Buffer <null>`. EAS runs
  prebuild, so **the cloud build fails here** — and the file is malformed at the byte level, so no
  image pipeline saves it.
- **WHY NOTHING CAUGHT IT**: the gate is `typecheck lint test build`; none of those reads
  `app.json`'s plugins or opens an asset. This is the same blind spot as the production-boot gap
  (memory `taxi-production-boot-not-in-gate`) — a failure class the gate cannot see by construction.
- **IMPLEMENT**: repair the signature in place. One command, no new files:
  ```bash
  node -e "
  const fs=require('fs');
  const p='apps/driver/assets/notification-icon.png';
  const b=fs.readFileSync(p);
  const i=b.indexOf(Buffer.from([0,0,0,0x0d,0x49,0x48,0x44,0x52]));  // IHDR
  if(i<0) throw new Error('no IHDR — not a repairable PNG');
  fs.writeFileSync(p, Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), b.subarray(i),
  ]));
  "
  file apps/driver/assets/notification-icon.png
  ```
  **expected**: `PNG image data, 96 x 96, 8-bit/color RGBA, non-interlaced`, 691 bytes.
- **DECIDED — repair, not regenerate.** A generator script mirroring
  `apps/driver/scripts/make-offer-tone.mjs` (+ a `make:icon` script + a `ui-decisions.md` line) was
  the first instinct, and it is **rejected**: the repair restores the original bytes exactly, in a
  9-byte diff, with no new file and no new package script. The generator's argument was provenance —
  "a committed binary nobody can regenerate is how the second one happens" — but that argument was
  built on the assumption that the image was lost. It is not. A working 96×96 white-disc generator
  was written during verification and produced a visually identical result (725 bytes vs the
  original's 691); it is kept at `<scratchpad>/make-notification-icon.mjs` as a fallback if the
  repair ever fails to reproduce, and it is deliberately not shipped. The tone script earns its
  place because pitch, fade and duration are real parameters; a white disc has none.
- **GOTCHA**: do **not** "fix" this by dropping in a fresh 1024×1024 icon. 96×96 is the
  density-independent source Expo resizes down, and it must stay white-on-transparent — Android
  masks notification icons, so a coloured one renders as a white blob.
- **GOTCHA**: this will not show up as a visual diff in review — it is a binary whose rendered
  appearance is unchanged. Say in the PR body what the 9 bytes were and why, or the commit reads as
  an unexplained asset churn.
- **VALIDATE**: the `file` check above, then the real proof — prebuild must now finish, which is
  Level 4 check 8.
- **SATISFIES**: AC #1

### CREATE `apps/driver/eas.json`

- **IMPLEMENT**: the `preview` profile — `cli.appVersionSource: "local"`, `build.preview` with
  `distribution: "internal"`, `android.buildType: "apk"`, a **`pnpm` version pin** (B2, below), and
  an `env` block carrying `EXPO_PUBLIC_API_URL`:
  ```json
  {
    "cli": { "appVersionSource": "local" },
    "build": {
      "preview": {
        "distribution": "internal",
        "pnpm": "10.33.2",
        "env": { "EXPO_PUBLIC_API_URL": "http://192.168.1.11:3001" },
        "android": { "buildType": "apk" }
      }
    }
  }
  ```
- **B2 — the `pnpm` pin is cheap insurance, NOT load-bearing. The hazard was measured and this repo
  already carries its own control.** The research that raised B2 predicted that a newer pnpm on the
  builder would ignore `.npmrc`'s `node-linker=hoisted` and `package.json`'s `pnpm` block
  (`:16-24`), computing zero overrides and installing without the React 19.2.3 pin. **Measured
  instead of inherited** (`observed` 2026-09-17, see NOTES → *The B2 measurement*): in a fresh
  `git archive` tree, `npx pnpm@12 install --frozen-lockfile` exits 0 and reports **`Done in 16.8s
  using pnpm v10.33.2`** — because root `package.json:4` sets `"packageManager": "pnpm@10.33.2"`
  and pnpm self-manages its own version. The same binary prints `10.33.2` inside the repo and
  `12.4.2` outside it. The overrides were applied: installed `react` is `19.2.3` and `multer` is
  `2.3.0`, both matching the declared values.
  **Also correct the figure while you are here**: pnpm's current major is **12**, not the 11 that
  the research named — so never repeat "pnpm 11.9.0 on the builder"; the builder's version is
  unobserved and, given `packageManager`, does not matter. Keep the profile pin anyway: it costs one
  line and covers the one case the measurement does not, a builder that disables pnpm's version
  self-management. Pin it to *whatever `packageManager` says*, not to this digit.
- **DO NOT add a `.easignore`.** It *replaces* `.gitignore` for upload filtering, and the tempting
  move — excluding `services/api`, `apps/dispatch`, `db` to shrink the upload — breaks the install:
  `pnpm-lock.yaml`'s `importers:` keys every workspace member, so a missing member `package.json`
  is a lockfile mismatch. The cost of not having one is that EAS installs the whole workspace to
  build one app: slow, not fatal.
- **DECIDED — the value lives in the committed `env` block and the operator edits it before each
  build.** The alternative is EAS environment variables (dashboard or `eas env`), and it is rejected
  here: it adds a second place to look, an account-scoped step nobody can review in a diff, and a
  way for the build to pick up a stale value invisibly. A committed placeholder is version
  controlled, shows up in the PR, and there is precedent — the committed env template already
  carries `EXPO_PUBLIC_API_URL=http://localhost:3001` and says why. Ship the placeholder as the LAN
  form. Use the **real current address** — `http://192.168.1.11:3001`, `observed` 2026-09-17 — not a
  `192.168.x.x` sham: a real value is one the Setup pre-flight can actually compare against (R4),
  where a sham forces an edit every single time and can never be checked. The runbook's Setup says
  in one line: *compare, edit only if it moved; a wrong value fails at the first request, not at
  build time.* **Added 2026-09-17 (PR #218 review F5)**: that Setup line must also say the edit
  stays **uncommitted** — the committed value is this machine's DHCP lease, and a dirty
  `apps/driver/eas.json` in a checkout several sessions share is one `piv-commit` away from riding
  into an unrelated PR. The decision above is unchanged; only its day-0 instruction is completed.
- **PATTERN**: `spikes/gps-harness/eas.json` — the only in-repo EAS config, and the one that
  produced a working APK (PR #115). Do not invent a `production` or `development` profile.
- **IMPORTS**: none.
- **GOTCHA**: `apps/driver/src/config.ts` **throws** when `EXPO_PUBLIC_API_URL` is absent in a
  non-`__DEV__` build. A `preview` APK built without it fails at the first request with
  "EXPO_PUBLIC_API_URL is not set", not at build time. The value must be in the profile or on the
  invocation — never left to a default.
- **GOTCHA**: a `preview` profile is a **release** build (no dev client), so `__DEV__` is false and
  `config.ts`'s throw path is live — that is the whole reason the `env` block is not optional.
- **GOTCHA — do NOT carry over the two workarounds from the #115 harness build.** Both were
  artefacts of the harness's own situation, and repeating them here would make things worse:
  - *"Build from a copy outside the monorepo."* The harness needed that because `spikes/` sits
    inside the git repo but is **not** a `pnpm-workspace.yaml` member (`observed`: the file lists
    `apps/*`, `services/*`, `packages/*`, `db`), so EAS uploaded it inside a workspace that did not
    contain it. `apps/driver` **is** a member, so the same EAS behaviour is correct for it. Build
    in place.
  - *"Strip `expo-dev-client` first."* That build failed because `package.json` was hand-edited
    without regenerating the lockfile — not because of the dev client. Here it is
    lockfile-consistent; leaving it in costs APK size, not a failed install.
  Both of these come from the research pass, not from a build anyone ran — treat them as the
  *reasons not to act*, and if a cloud build does fail, diagnose it rather than reaching for either.
- **GOTCHA**: run every EAS CLI command from `apps/driver`, not the repo root — `eas.json` lives in
  the app directory in a monorepo. `npx expo install --check` must be clean first (an SDK-version
  mix is the #4 kit's known startup crash, memory `taxi-gps-spike-kit`).
- **VALIDATE**: `node -e "JSON.parse(require('fs').readFileSync('apps/driver/eas.json','utf8'))" && echo EAS_JSON_OK`
- **SATISFIES**: AC #1

### UPDATE `apps/driver/app.json` — cleartext, **required, not conditional**

- **IMPLEMENT**: add `expo-build-properties` to `plugins` with `android.usesCleartextTraffic: true`:
  ```json
  ["expo-build-properties", { "android": { "usesCleartextTraffic": true } }]
  ```
- **WHY IT IS NOT OPTIONAL — `observed` in this app's own generated project, not inferred from a
  template on the internet.** `npx expo prebuild --platform android` was run against the builder's
  view of the tree (NOTES → *The B1 reproduction* explains the tree; the prebuild only succeeds
  after B3 is fixed). Reading the manifests it generated:
  | Variant | `android:usesCleartextTraffic` |
  |---|---|
  | `app/src/main/AndroidManifest.xml` | **ABSENT** |
  | `app/src/debug/AndroidManifest.xml` | `"true"` |
  | `app/src/release/AndroidManifest.xml` | **no such file** |
  A `preview` profile builds the **release** variant, and with no `release/` manifest it inherits
  `main/` alone — where the attribute is absent, so Android's API-28+ default applies and cleartext
  is blocked. An `http://192.168.1.11:3001` origin therefore fails out of the box. This is the
  single most load-bearing config line in the ticket.
- **AND THE FIX IS PROVEN, not assumed.** The plugin entry above was appended to `app.json` in the
  same tree and prebuild re-run: `✔ Finished prebuild`, and
  `app/src/main/AndroidManifest.xml` then carries `android:usesCleartextTraffic="true"`
  (`observed` 2026-09-17). That is the manifest the release variant inherits, so the flag reaches a
  `preview` APK. Both directions of this one are measured: absent before, present after, same tree,
  same command.
- **PATTERN**: `app.json`'s existing `plugins` array — an array entry is `["plugin-name", { …opts }]`,
  as `expo-location` and `expo-notifications` already are.
- **IMPORTS**: `cd apps/driver && npx expo install expo-build-properties` — it is **not** currently a
  dependency (`observed`), so this is a real dependency addition, not a config-only change. Never
  plain `pnpm add`; `apps/driver/CLAUDE.md` requires `npx expo install`.
- **DECIDED — app-wide boolean, not a domain-scoped network security config.**
  `expo-build-properties` exposes no `networkSecurityConfig` option, so scoping to one host means a
  custom config plugin writing `res/xml/network_security_config.xml`, and whether a bare IPv4
  literal is even valid as a `<domain>` entry is uncertain. For a throwaway internal-distribution
  build on a LAN, the app-wide flag is the honest answer. Do not add a third-party plugin for this.
- **GOTCHA — this is the load-bearing half, and it fails looking exactly like the bug under test.**
  `apps/driver/src/features/location/socket.ts:30` is `transports: ['websocket']` with **no polling
  fallback** (`observed`), so with an `http://` origin the client dials `ws://` and OkHttp applies
  the same cleartext policy. Blocked cleartext means: no `ping_accepted`, a frozen pin, a stream
  that looks torn down — i.e. **indistinguishable from #141 being unfixed**. R2 covers how the
  runbook guards against misreading it.
- **GOTCHA**: adding a plugin changes the native project. It does not affect jest (every native
  module is faked) but it **does** affect `npx expo export` — run the export validation after.
- **VALIDATE**: `cd apps/driver && npx expo config --type prebuild > /dev/null && echo CONFIG_OK`
- **SATISFIES**: AC #1

### VERIFY the bundle inlines the origin (the one build check an agent can run)

- **IMPLEMENT**: no file change. Export the Android bundle with the variable set to a sentinel and
  assert it appears in the output — this proves the Metro inlining works and that `apiUrl()`'s throw
  path will not fire in a release build.
- **PATTERN**: #14's plan Level 5 already runs `npx expo export --platform android` as a check.
- **GOTCHA**: this proves the **JS** half only. It does not prove EAS's cloud build succeeds — that
  needs Linards's Expo credentials and burns a build credit. Record the cloud build as `expected`,
  never as `observed`, until it runs.
- **GOTCHA — `--no-bytecode` and `--clear` are both mandatory, and the version of this command
  without them is unsound** (corrected 2026-09-17, see AMENDMENTS). A default `expo export` emits
  **Hermes bytecode**, whose packed string table makes *no* app string greppable — `expo-router`,
  `socket.io` and `sakta.driver.session` all return 0 matches in the `.hbc` (`observed`), so the
  grep can never match whatever the build does. And without `--clear`, Metro serves the cached
  transform of `config.ts` from the previous run, which makes the check an identity function: the
  unset direction *also* found the sentinel (`observed`).
- **VALIDATE** — run both directions; the pair is the evidence, one direction alone is not:
  ```bash
  SB=<scratchpad>   # never /tmp, never inside the checkout (R5)
  cd apps/driver
  env EXPO_PUBLIC_API_URL=https://sentinel.invalid \
    npx expo export --platform android --no-bytecode --clear --output-dir "$SB/set" >/dev/null 2>&1 \
    && grep -rq "sentinel.invalid" "$SB/set" && echo INLINE_OK
  env -u EXPO_PUBLIC_API_URL \
    npx expo export --platform android --no-bytecode --clear --output-dir "$SB/unset" >/dev/null 2>&1 \
    && ! grep -rq "sentinel.invalid" "$SB/unset" && echo DISCRIMINATES
  ```
  **expected**: `INLINE_OK` and `DISCRIMINATES`. `observed` 2026-09-17, and the pair proves more
  than the sentinel alone: with the variable set the bundle carries the origin and `apiUrl()`'s
  throw path is dead-code-eliminated (0 occurrences); with it unset the throw path is live (1).
- **SATISFIES**: AC #1, AC #6

### CREATE `docs/runbooks/driver-device-day.md`

- **IMPLEMENT**: the runbook. Sections, in order:
  1. **Title + one paragraph** — what single claim this day closes, quoting the "one claim wide"
     framing from the old plan.
  2. **Result** table — `Run by: **not yet run**`, `Platform: —`, `App / OS version: —`, `Date: —`,
     `Outcome: **BLOCKED — no Android phone; no paid Apple account**`. Under it, the two closed
     substitute paths with their `observed` dates, as `rider-a11y-walkthrough.md:27-32` does.
  3. **What this day does NOT need** — no Firebase/FCM (A1), no push *token* (A2's credential half),
     no Android SDK (A3). One line each, with the reason (C2 for A1/A2; the cloud build for A3).
     **Corrected 2026-09-17 (PR #218 review F1)**: this row must not read as "no `eas init`" — the
     cloud build links a project and §2 runs `eas-cli init`.
  4. **Setup** — cite `.claude/plans/driver-app-auth-online-location.md` §Level 4 §B for the boot
     recipe rather than restating it, then the three things that differ here: the APK build
     invocation, the origin the build must carry, and `pnpm --filter @taxi/api provision:dispatcher
     +371XXXXXXXX Dina` for the console login.
  5. **Steps 1–8** — the table, with a **Signal** column, C1–C5 applied, and the ✅/❌ column empty.
     Keep the original numbering so the issue comments and reviews that cite step numbers still
     resolve, but add one instruction the old sheet lacks: **open `t/<token>` before starting the
     90-second watch**, because it is the only surface that renders freshness (C1). Step 6 then
     records what was already on screen rather than sending the operator off to find a token
     mid-watch.
  6. **Verdict rule** — "any ❌ on **4, 5, 7 or 8** means the fix did not land", citing this plan's
     re-derivation section for where that set came from. Directly above it, the **step 2 hard gate**
     (R2): *if the driver is not visible and pinging on `/dispatch` before any ride exists, STOP —
     nothing after this point means anything.* A blocked-cleartext socket produces exactly the same
     signature as #141 unfixed (no `ping_accepted`, frozen pin), and step 2 is the only place that
     ambiguity can be resolved, because at that point no ride and no toggle-OFF has happened yet.
  7. **Also on this day** — the list of items that ride along (#14 §C 1–13; `ui-decisions.md`'s
     three ear-checks; #16's Level 4), each with its owning ticket. Explicitly: *this runbook does
     not own them.* **Structural rule (R6): this section comes AFTER the verdict, carries no
     checkboxes, and the Result table records #141's outcome only.** Listing them is not the
     control — the ordering and the missing checkboxes are, because they make "the day failed"
     inexpressible as "#141 failed", and let the day legitimately stop at the verdict.
- **IMPLEMENT (the R3 discriminator, in Setup)**: one short paragraph telling the operator how to
  tell a *transport* fault from #141's claim, because their end-state looks identical:
  > **Cannot sign in at step 1** → cleartext, wrong origin, or wrong network. Not a #141 result.
  > **Signed in and streaming at step 2, then frozen after the toggle at step 4** → that is #141's
  > claim, and it is the only reading of a frozen stream this sheet accepts.
  > Tiebreaker: `adb logcat` over USB (`adb` is at `/usr/local/bin/adb`, `observed`).
  This works because Android enforces cleartext in OkHttp, which backs React Native's `fetch` as
  well as its WebSocket — so a cleartext block takes the REST calls down too, and steps 1–3 are all
  REST. The operator **cannot reach step 4** with cleartext blocked (R3).
- **PATTERN**: `docs/runbooks/rider-a11y-walkthrough.md` — Result-first shape, 168 lines. Aim for a
  similar size; this is a run sheet, not an essay.
- **GOTCHA**: the Result table must ship reading **not yet run**. A runbook with an invented result
  is worse than no runbook — the `rider-a11y-walkthrough.md` precedent exists precisely because AC
  #6 there was blocked and the file records it.
- **GOTCHA**: do not restate #14 §B's boot recipe. Two copies of a procedure is the exact failure
  this ticket is cleaning up.
- **GOTCHA**: the phone and the laptop reach the api at **different origins**, and only the phone's
  is baked into a build. Say so once in Setup: the console and the tracking page are opened in the
  **build machine's own browser** on `localhost:3000`, where the committed `CORS_ORIGINS` and
  `PUBLIC_TRACKING_BASE_URL` defaults already work. Opening `/dispatch` or `t/<token>` from any
  other device means editing all three of `CORS_ORIGINS`, `NEXT_PUBLIC_API_URL` and
  `PUBLIC_TRACKING_BASE_URL` — and the tracking link printed in the SMS log carries whatever
  `PUBLIC_TRACKING_BASE_URL` was at boot, so it will point at `localhost` and silently fail to open
  on the phone. That is a five-minute trap on the day; one sentence now prevents it.
- **VALIDATE**: `test -f docs/runbooks/driver-device-day.md && grep -q "not yet run" docs/runbooks/driver-device-day.md && grep -q "4, 5, 7 or 8" docs/runbooks/driver-device-day.md && echo RUNBOOK_OK`
- **SATISFIES**: AC #2, AC #3, AC #4

### UPDATE `.claude/plans/driver-toggle-off-mid-ride-held.md` — §Level 4 becomes a pointer

- **IMPLEMENT**: replace the Step 1 run-sheet table (lines ~713-760) with a short pointer to
  `docs/runbooks/driver-device-day.md`, keeping the "Exactly what the device adds" paragraph in
  place — that framing is this plan's, not the runbook's, and it is the reason the sheet is one
  claim wide. Keep Step 2 (the runnable api check) where it is. Add an AMENDMENTS entry.
- **PATTERN**: the plan's existing AMENDMENTS section; newest entry at the bottom, `<ISO date> —
  <what changed and why>`.
- **GOTCHA**: the table's own footer line ("Any ❌ on 4, 5 or 7") goes with the table. Do not leave
  it behind as a widow — it is one of the three inconsistent sources.
- **VALIDATE**: `grep -c "Any ❌ on 4, 5 or 7" .claude/plans/driver-toggle-off-mid-ride-held.md` →
  **expected `0`**; and `grep -q "driver-device-day.md" .claude/plans/driver-toggle-off-mid-ride-held.md && echo POINTER_OK`
- **SATISFIES**: AC #4

### UPDATE `.claude/plans/driver-app-auth-online-location.md` §C.14 — repoint

- **IMPLEMENT**: §C.14 (`.claude/plans/driver-app-auth-online-location.md:837`) already reads
  "SUPERSEDED, do not run this step" and points at
  `.claude/plans/driver-toggle-off-mid-ride-held.md` §Level 4 §1. Repoint it at
  `docs/runbooks/driver-device-day.md`. Change nothing else in that step — its historical paragraph
  is the record of what the bug looked like.
- **IMPLEMENT (second half)**: the same line ends "…and the pin keeps moving", which is C1's
  unreadable signal restated a third time. Replace that clause with the console signal, or drop it —
  a superseded step does not need to describe the pass condition at all, and leaving it is how the
  wrong signal outlives the sheet it came from.
- **PATTERN**: the surrounding §C entries.
- **GOTCHA**: PR #142's review raised F6 on this step's wording ("still leads with 'expected to
  FAIL'"). Read `.claude/code-reviews/pr-142-review.md:199` before editing so this pass does not
  re-open a finding someone already settled.
- **VALIDATE**: `grep -n "driver-device-day" .claude/plans/driver-app-auth-online-location.md` →
  **expected**: one hit in §C.14.
- **SATISFIES**: AC #4

### UPDATE the root `CLAUDE.md` on-demand-context table

- **IMPLEMENT**: one row — *When touching*: "Running the driver device day / #141's proof" →
  *Read first*: `docs/runbooks/driver-device-day.md`.
- **PATTERN**: the existing rows in that table; each is one line, one path, one parenthetical ticket.
- **GOTCHA**: one row, not a paragraph. `CLAUDE.md` is loaded into every session — the anti-bloat
  rule in `rules-check-drift` applies.
- **VALIDATE**: `grep -c "driver-device-day.md" CLAUDE.md` → **expected `1`**.
- **SATISFIES**: AC #4

### COMMENT on issue #141 with the re-derived set

- **IMPLEMENT**: one comment: the re-derived set (4/5/7/8 load-bearing, 6 corroborating, 1–3 setup)
  with the reconciliation of the three sources; C1 and C2 in two short paragraphs each; the runbook
  link; and the explicit statement that **this does not close #141** — the run is still owed.
- **PATTERN**: the issue's two existing comments — they lead with the verdict, then the evidence.
- **GOTCHA**: keep closing keywords away from `#N` (`taxi-pr-issue-link-backticks`) — a stray
  "Closes #141" in prose has closed an issue before. Pass the body via `--body-file` from the
  scratchpad, never inline (`taxi-pretooluse-hook-blocks-dotenv-strings`).
- **VALIDATE**: `gh issue view 141 --json state --jq .state` → **expected `OPEN`**.
- **SATISFIES**: AC #5

---

## TESTING STRATEGY

### Unit Tests

**None are added, and that is correct.** This ticket changes no shipped source except build config.
The behaviour under test is already covered: `presence-state.test.ts` (four `driver_on_ride` reducer
cases), `use-presence.test.tsx` (the hook chain), and `driver-presence.integration.spec.ts` (the
server pair from PR #145). Adding a test here would be testing the test suite.

The existing suites are the **regression check**: they must stay green and their counts must not
move. Any movement means this ticket touched something it should not have.

### Integration Tests

Not applicable — no api change. The one api-side check the runbook cites,
`COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- drivers.integration`, already exists as
the old plan's Level 4 Step 2 and is carried into the runbook unchanged.

The realtime clause in the skill's template does not bind here: this ticket adds no socket, no room
join and nothing under `features/realtime`.

### Edge Cases

| Edge case | Verified where |
|---|---|
| A `preview` APK built without `EXPO_PUBLIC_API_URL` dies at first request, not at build | the INLINE_OK export check above; and the runbook's Setup names the symptom so it is diagnosable on the day |
| An `http://` LAN origin is blocked by Android cleartext policy | the cleartext task (`app.json`); **manual**, runbook **step 2 as a hard gate** — it takes `socket.ts:30`'s websocket-only transport down too, producing the same signature as #141 unfixed (R2) |
| `@taxi/shared` does not resolve on the EAS builder (`dist/` gitignored) | the `eas-build-post-install` task; the `git ls-files` check proves the premise locally, the fix itself is `expected` until a cloud build runs (B1, R1) |
| The builder's pnpm ignores this repo's overrides and `node-linker` | the `pnpm` pin in the build profile; premises `observed` in-repo, builder half doc-sourced (B2, R1) |
| The phone is stationary, so the board pin never moves | **manual**, runbook step 5 — the api console is primary and `t/<token>`'s «position updated» line is the in-product read; the board pin is explicitly **not** a signal (C1) |
| The cascade offers the ride before anyone force-assigns | **manual**, runbook step 3 (C3) |
| The tracking token cannot be produced by the seed | **manual**, runbook step 6 — read from `auth.sms.stub_sent` (C4) |
| `PUSH_PROVIDER=stub` means no push can reach the phone | **manual**, runbook step 7 — the signal is the absence of two api-console events (C2) |
| The EAS cloud build fails on the `workspace:*` dependency | **not verifiable on this machine** — needs Linards's Expo credentials. R1; recorded `expected` with the standalone-copy fallback named |

Two of these land in a surface with no test framework at all (the Android native build). They are
assigned to named runbook steps above rather than left to nobody.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm turbo run lint --filter @taxi/driver
cd apps/driver && npx expo config --type prebuild > /dev/null && echo CONFIG_OK
```

### Level 2: Unit Tests

```bash
pnpm turbo run test --filter @taxi/driver
```
**expected**: green, and the driver suite's count **unchanged** — this ticket adds no test and
removes none. A moved count is a signal that something shipped that should not have.

### Level 3: Integration Tests / the gate

```bash
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:${REDIS_PORT:-6379} \
  pnpm turbo run typecheck lint test build --force
```
**expected**: exit 0. One gate at a time — the test DB is shared across sessions
(`taxi-concurrent-sessions`). In a worktree, `COMPOSE_PROJECT_NAME=taxi` is mandatory and the root
env file must be copied in first, or a `REDIS_TEST_URL` run hangs silently
(`taxi-worktree-env-redis-hang`).

### Level 4: Manual Validation

**Every step below is performable by the implementing agent on this machine.** The device run is
not, and is not listed here — it is the runbook's content, and it stays owed.

1. **The bundle carries the origin.** Run **both** directions of the corrected command from the
   VERIFY task — `--no-bytecode --clear`, set and unset.
   **expected**: `INLINE_OK` and `DISCRIMINATES`.
2. **The runbook's own commands parse.** For each fenced `bash` block in the new runbook that does
   not require a phone, run `bash -n` over it. **expected**: no syntax errors. A runbook whose
   commands do not parse is the same defect class this ticket is fixing.
3. **No copy of the run sheet survives outside the runbook.**
   ```bash
   grep -rln "springs back to ON" .claude docs \
     | grep -v "driver-device-day-prep\.md" | sort
   ```
   **expected**: exactly `docs/runbooks/driver-device-day.md`. Any other hit is a surviving copy.
   `observed` 2026-09-17, before this ticket: three files — this plan,
   `.claude/plans/driver-app-auth-online-location.md` and
   `.claude/plans/driver-toggle-off-mid-ride-held.md`. **The exclusion is not cosmetic**: this plan
   quotes the phrase in its re-derivation table, so an unfiltered grep can never return one path
   and the check would be unfalsifiable.
4. **The three inconsistent step-set statements are gone or pointed.**
   ```bash
   grep -rn "4, 5 or 7\|4, 5, 7 and 8\|4, 5, 6 and 8" .claude docs \
     | grep -v "driver-device-day-prep\.md:"
   ```
   **expected**: no hits. This plan's re-derivation section quotes all three deliberately as the
   sources being reconciled and is excluded for the same reason as check 3; the runbook cites that
   section rather than restating the lists.
5. **#141 is still open.** `gh issue view 141 --json state --jq .state` → **expected** `OPEN`.
6. **Nothing polluted the checkout (R5).**
   ```bash
   test ! -e apps/driver/android && git status --short apps/driver | head && echo TREE_CLEAN
   ```
   **expected**: `TREE_CLEAN` and no unexpected paths. Every build-route check runs in the
   scratchpad; a stray `apps/driver/android/` is the same class of failure as the stale
   `apps/dispatch/.next` that reddens the gate in ~25 s (memory `taxi-gate-stale-next-race`).
7. **The B1 reproduction still holds, with the fix in place.** Re-run the sequence in NOTES →
   *The B1 reproduction*. Build the tree with `git archive $(git write-tree)` while the fixes are
   uncommitted — `git archive HEAD` reproduces the tree *without* them, which cannot verify a fix
   (corrected 2026-09-17, see AMENDMENTS).
   **expected**, and the first three `observed` 2026-09-17 on the post-fix tree:
   `packages/shared/dist` absent · `expo export` fails with `Android Bundling failed 1004ms` before
   the shared build · exit 0 with a `3.4MB` `.hbc` after it. The fourth — the sentinel in the
   output — belongs to check 1 and needs its corrected `--no-bytecode --clear` form. This is the
   standing guard: it is the only check in the repo that sees the repo the way EAS does.
8. **Prebuild finishes (B3's guard).** In that same tree:
   ```bash
   cd apps/driver && npx expo prebuild --platform android --no-install
   ```
   **expected**: `✔ Finished prebuild`, exit 0. `observed` 2026-09-17: exit **1** with
   `Could not find MIME for Buffer <null>` on the corrupt icon, exit **0** after replacing it.
   Then confirm the cleartext flag reached the manifest the release variant inherits:
   ```bash
   grep -o 'android:usesCleartextTraffic="[a-z]*"' \
     apps/driver/android/app/src/main/AndroidManifest.xml
   ```
   **expected**: `android:usesCleartextTraffic="true"`. `observed` **before** the plugin was added:
   absent from `main`, present only in `debug`, with no `release/` manifest at all. Delete the
   generated `android/` directory afterwards — it belongs to the scratchpad tree, never the
   checkout (check 6).

### Level 5: Additional Validation (Optional)

```bash
cd apps/driver && npx expo-doctor && npx expo install --check
```
Both clean before anyone attempts a cloud build — an SDK-version mix is the #4 kit's known startup
crash (`taxi-gps-spike-kit`). Note `typescript` is excluded from `--check` on purpose
(`expo.install.exclude`); never `--fix` that pin away.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — the build route exists, all five parts, each fixing a failure that was
      **reproduced**, not predicted: an `eas-build-post-install` script that builds `@taxi/shared`
      on the builder (B1 — Metro bundling fails without it); a valid
      `apps/driver/assets/notification-icon.png` (B3 — prebuild fails without it);
      `expo-build-properties` with `android.usesCleartextTraffic: true` (the release variant
      inherits a `main` manifest that lacks it); and `apps/driver/eas.json` with a `preview` profile
      producing an internally-distributed Android **APK**, carrying `EXPO_PUBLIC_API_URL` and a
      `pnpm` pin equal to root `packageManager` (B2 — insurance only; `packageManager` already
      does the work). Level 4 checks 7 and 8 are what verify this AC; the passing/failing outputs
      for every one of them are in NOTES.
- [ ] **AC #2** — `docs/runbooks/driver-device-day.md` exists, mirrors
      `rider-a11y-walkthrough.md`'s shape, and its Result table reads **not yet run / BLOCKED**.
- [ ] **AC #3** — every one of its eight steps names the **signal** it reads and **where** that
      signal appears (api console / `/dispatch` / phone); corrections C1–C5 are all applied.
- [ ] **AC #4** — the run sheet exists in exactly one place: both plans point at the runbook, the
      root `CLAUDE.md` has its row, and Level 4 check 3 returns a single path.
- [ ] **AC #5** — #141 carries a comment with the re-derived step set and the reconciliation, and
      is still **OPEN**.
- [ ] **AC #6** — `INLINE_OK` **and** `DISCRIMINATES` observed on the post-fix tree, so a
      release-flavoured bundle carries the origin *and* the check can tell the difference.
      (NOTES → *The B1 reproduction* row 8 claimed this `observed` on a command that cannot
      produce it — see AMENDMENTS 2026-09-17. The corrected two-direction form in the VERIFY task
      is what satisfies this AC.)
- [ ] **AC #7** — the gate is green and the driver suite's test count is unchanged. `expo install`
      adds `expo-build-properties` to the lockfile, so the gate must run **after** that, not before.
- [ ] **AC #8** — every figure in the runbook, the report and the PR body carries `observed` /
      `derived` / `expected` and its arithmetic — the C+60 s window is `derived`, the
      absent-Android-SDK facts are `observed` with their date, the EAS cloud build is `expected`.

**Owed to #141, and deliberately NOT an acceptance criterion of this ticket**: the eight steps run
on a phone with the Result table filled in. An AC this machine cannot perform is not this ticket's
AC — putting it in the list above would only produce a checkbox that gets ticked falsely or a
checklist nobody can finish. It is named here, owned by #141, and carried openly. **No part of this
ticket may be reported as closing #141.**

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration), counts unchanged
- [ ] No linting or type checking errors
- [ ] Level 4 checks 1–5 run and recorded
- [ ] Acceptance criteria #1–#8 met; the device run recorded as owed to #141
- [ ] The PR body says, in its own words, that this does **not** close #141

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Q1 — does `apps/driver` build on EAS as a workspace package? STILL OPEN, and deliberately not
  claimed as answered.** What this plan established is narrower and worth stating precisely,
  because the difference is where a false sense of completeness would hide:
  - **`observed`**: the tree EAS receives contains everything the build needs, and the three
    failures that would have broken it are each closed by a reproduction (B1, B3, cleartext) or
    dissolved (B2). Local install, local Metro bundle and local prebuild all succeed on that tree.
  - **`expected`**: that **EAS's own remote pipeline** — its install step, its prebuild, its
    `eas-build-post-install` invocation — accepts a `workspace:*` package. None of that was run.
    Only Linards can run it; it needs his credentials and burns a build credit.
  Treat "EAS supports pnpm monorepos" as a documentation claim, not a result. It came from the same
  research pass whose two other load-bearing claims this plan **refuted** by running them (the
  builder's pnpm major, and regenerate-rather-than-repair), which is reason enough not to bank it.
  What *is* settled is the narrower question the harness precedent raised: its "copy outside the
  repo" step was a workspace-*membership* artefact (`spikes/` is not in `pnpm-workspace.yaml`), so
  it is not evidence that a member package needs the same treatment — build in place, and find out.
- **Q2 — which origin does the APK carry: a LAN IP, or an HTTPS tunnel? Decided: LAN IP, with a
  drift control (R4).** The origin is baked into the bundle either way. A quick tunnel
  (`cloudflared tunnel --url http://localhost:3001`) gives HTTPS and sidesteps the cleartext
  question, but its URL changes per run — and because `EXPO_PUBLIC_*` is inlined by Metro at bundle
  time (`config.ts` docblock), a new tunnel URL means a **new cloud build** every device day. One
  cleartext setting on an internal-distribution APK is a smaller price than a rebuild per session.
  The residual risk — the Mac's DHCP lease moving, silently invalidating the baked origin — is R4,
  and it is closed by a Setup pre-flight rather than by hoping. Say if you would rather pay the
  rebuild: it is a one-line change to the `env` block and to the runbook's Setup.
- **Q3 (ordering, answered with the worst case)** — *could the fixed app still be marked dark and
  nudged in a window right after the ride is released?* **No, and the worst case is the one that
  matters here:** during the ride the row is `on_ride`, so `markOfflineByServer`'s
  `status = 'online'` WHERE cannot match and the column cannot be stamped at all
  (`driver-presence.repository.ts:33-43`). At release the row returns to `online` with the Redis
  score the stream left behind — fresh with the fix, minutes stale without it
  (`drivers.repository.ts:294-301` touches neither Redis nor the column). The first tick after
  completion therefore decides it, and the worst case to an observable nudge in the broken app is
  **C + 60 s** (`derived` above). The 2-minute watch covers it with margin.
- **Q4 (scope, deferred)** — the dispatch board stores `lastSeenAt` and renders nothing
  (`board-state.ts:127`). Rendering a freshness age would fix C1 at its root and would help every
  future device day, and it is a Dina's-console UX change with its own breadboard and
  `ui-decisions.md` entry. **Not in this ticket.** Worth its own issue; say if you want it filed.
- **Q5 (assumption)** — the runbook lists #14's §C, the three `ui-decisions.md` ear-checks and
  #16's Level 4 as riding the same day, without owning them. If you would rather have one combined
  device-day sheet that owns all of it, that is a bigger ticket and a different shape — this one
  keeps #141's claim one claim wide, which is what made it reviewable.
- **Q6 (out of scope, recorded because the prebuild surfaced it)** — `app.json` sets
  `"userInterfaceStyle": "light"`, but prebuild prints
  `» android: userInterfaceStyle: Install expo-system-ui in your project to enable this feature.`
  (`observed` 2026-09-17). `expo-system-ui` is not a dependency, so the declared light-mode
  enforcement is **inert on Android** — a driver on a dark-themed phone gets whatever the OS does.
  Not this ticket's to fix and not a build blocker; it is a one-line dependency plus a device check,
  and it belongs to #14 or the brand epic. Flagged rather than silently repaired, because a config
  line that does nothing is the kind of thing that reads as working until someone tests it.

## NOTES (open canvas)

### Why a runbook and not another plan section

The run sheet has lived in a plan's §Level 4 since PR #142, and in that time it acquired two
partial restatements in issue comments and one in a sibling plan's §C.14. Three copies, three
different owed-step lists, and the only one that was *wrong* (the table footer) was the one closest
to the table itself.

`docs/runbooks/rider-a11y-walkthrough.md` already solves this for the rider app: a runbook is a
thing you *run*, it has a Result table that is either filled or honestly blank, and it lives outside
`.claude/plans/` where a plan's AMENDMENTS log cannot quietly fork it. Same problem, same shape.

### What this ticket deliberately does not fix

The board's missing freshness (Q4) is the root cause of C1, and rendering it would be maybe twenty
lines. It is still out of scope: it is a user-facing change to Dina's console, which under the root
`CLAUDE.md` needs a breadboard, loading/empty/error/offline states, a friction audit and a
`ui-decisions.md` entry. That is a ticket, not a task inside a prep ticket. Routing step 5 to the
api console costs nothing and reads the claim more directly anyway — the console line *is* the
accepted fix, where the pin is a rendering of it.

### The A1/A2 saving

The obvious reading of step 7 ("no push arrives on the phone") makes Firebase credentials and an EAS
project id load-bearing for #141. They are not, and C2 is why: the nudge has exactly one stamping
site and one sender, the stub logs what it would have sent, and the question is an **absence** in
the api console. That removes two human prerequisites from #141's critical path and leaves them
where they belong — #14's, for the day someone wants to prove real delivery.

This is worth stating loudly in the runbook, because the next person to read the old step 7 will
reach for `eas credentials` within about a minute.

**Scope of the saving, corrected 2026-09-17 (PR #218 review F1).** What comes off #141's critical
path is the push *credential* stack — Firebase/FCM and a push token. An **EAS project link** is not
part of that saving: EAS attaches every build to a linked project, so `eas-cli init` runs on the day
regardless and writes `extra.eas.projectId` into `app.json`. The runbook's *does NOT need* row was
written as "no `eas init`" and has been narrowed; §2 now carries the `init` line and says it mutates
a tracked file.

### The B1 reproduction — how a cloud-only failure was closed without a cloud build

The point of this section is that B1 stopped being a prediction. Everything below is `observed`
2026-09-17 on this machine, with no EAS account, no credentials and no Android SDK. The trick is
that **EAS's view of the repo is reproducible locally**: it filters the upload by `.gitignore`, and
`git archive HEAD` produces exactly that set.

```bash
SB=<scratchpad>/eas-repro
mkdir -p "$SB" && git archive HEAD | tar -x -C "$SB"
cd "$SB" && pnpm install --frozen-lockfile
```

**Observed, step by step:**

| # | Command | Result |
|---|---|---|
| 1 | `ls "$SB/packages/shared/dist"` | `No such file or directory` — the builder receives no `dist/` |
| 2 | `pnpm install --frozen-lockfile` | exit 0, `Done in 14.1s using pnpm v10.33.2`, 1675 packages |
| 3 | `ls -ld apps/driver/node_modules/@taxi/shared` | symlink → `../../../../packages/shared` |
| 4 | `require.resolve('@taxi/shared')` | **throws** `MODULE_NOT_FOUND`, `Cannot find module '…/@taxi/shared/dist/index.js'` |
| 5 | `npx expo export --platform android` | **`Android Bundling failed 895ms`** — *"the package … specifies a `main` module field that could not be resolved (`…/dist/index.js`)"*; no bundle emitted |
| 6 | `pnpm --filter @taxi/shared build` | exit 0 — **this is exactly what `eas-build-post-install` runs** |
| 7 | `require.resolve('@taxi/shared')` | resolves to `…/packages/shared/dist/index.js` |
| 8 | `npx expo export --platform android` with the sentinel origin | exit 0, `_expo/static/js/android/entry-*.hbc (3.4MB)`. ~~and the sentinel found in the output → `INLINE_OK`~~ — **RETRACTED 2026-09-17**: that half cannot have been observed from this command. The output is Hermes bytecode and no app string is greppable in it (`expo-router`, `socket.io`, `sakta.driver.session` all 0 matches). The inlining *is* real, but only `--no-bytecode --clear` shows it — see the VERIFY task and AMENDMENTS |

Rows 5 and 8 are the pair that matters: **the same command, same tree, failing and then succeeding,
with the `eas-build-post-install` command as the only difference.** Row 8 also settles AC #6 — the
`EXPO_PUBLIC_API_URL` inlining is `observed`, not assumed, and the VALIDATE command in the VERIFY
task is the command that produced it.

**Why this was invisible before**: `packages/shared/dist/index.js` exists in the working checkout
because the gate builds it. Every local check passes. Only a tree that was *cloned* rather than
*worked in* exposes it — which is what EAS is, and what `git archive` simulates.

**Honest limit**: `git archive HEAD` is the tracked-file set; EAS's archiver is its own code and may
differ at the margins, and it also honours an `.easignore` if one exists (none here — and the plan
says not to add one). The mechanism under test — a gitignored `dist/` that nothing on the builder
rebuilds — does not depend on that margin.

### The B2 measurement — the hazard was real, this repo already had the control

The research that raised B2 reasoned: newer pnpm majors stopped reading `.npmrc` non-auth settings
and `package.json#pnpm`, this repo keeps `node-linker=hoisted` in the former and 15 `overrides` in
the latter, therefore a builder on a newer pnpm installs without them. Every premise about *this
repo* is true. The conclusion is not, and running it is what showed why.

```bash
git archive HEAD | tar -x -C "$TREE"
cd "$TREE" && npx --yes pnpm@12 install --frozen-lockfile
```

| Check | Result (`observed` 2026-09-17) |
|---|---|
| `pnpm@12 install --frozen-lockfile` | exit 0 — **`Done in 16.8s using pnpm v10.33.2`** |
| `npx pnpm@12 --version` **inside** the repo | `10.33.2` |
| `npx pnpm@12 --version` **outside** the repo | `12.4.2` |
| installed `react` (override declares `19.2.3`) | `19.2.3` |
| installed `multer` (override declares `2.3.0`) | `2.3.0` |
| `node_modules/expo` present at the root | yes → `node-linker=hoisted` honoured |

**The mechanism**: root `package.json:4` declares `"packageManager": "pnpm@10.33.2"`, and pnpm
self-manages its version — invoked as 12, it downloads and re-executes as 10.33.2 inside this repo.
The newer pnpm's changed defaults never apply because the newer pnpm never runs the install.

**What this changes in the plan**: the `pnpm` field in the build profile drops from load-bearing to
one line of cheap insurance, covering only a builder that disables version self-management. It stays
in — it costs nothing — but it is no longer a thing to worry about, and the plan says so rather than
banking unearned credit for a fix that was already in the repo.

**Two figures retired, not just corrected**: pnpm's current major is **12**, not 11, so "pnpm 11.9.0
on the builder" should not be repeated anywhere — and more importantly the *subject* it belonged to
("the builder's pnpm will break the install") is what is retired, not merely its digits.

### The B3 discovery — what running it found that reading it could not

B1 and B2 both came from reading the repo. B3 came from *running* prebuild, and it is the one that
would actually have failed the first cloud build first:
`apps/driver/assets/notification-icon.png` carries a 17-character text rendering of the PNG
signature where 8 bytes belong. The full account is in its task above; two parts are worth keeping
here.

**First, the fix changed once it was investigated properly.** The initial instinct was to
regenerate the icon and ship a generator script beside `make-offer-tone.mjs`. Decoding the file
first showed the payload was undamaged — a plain 96×96 white disc — which made the honest fix a
nine-byte header repair that restores the original bytes, and made the generator unnecessary
scope. *Diagnose to the byte before choosing the fix* is the transferable part; the difference
between the two answers was one `node -e` away and would otherwise have shipped as a new script, a
new package-json entry and a `ui-decisions.md` line that nothing needed.

**Second, the shape of the lesson.**

Two of the three blockers were invisible to every check this project runs, for the same underlying
reason: **the gate never leaves the working checkout.** `typecheck lint test build` reads neither a
gitignored build output's absence (B1) nor `app.json`'s plugin graph (B3). Both failures need a
machine that *clones* the repo and *prebuilds* it — which is precisely what EAS is, and precisely
what `git archive HEAD` plus `expo prebuild` simulates for free.

That pairing is the reusable part, and it is why this plan's Level 4 keeps it as a standing check
rather than treating it as a one-off investigation.

### Risks — each with the control that closes it

Every risk below has a **control that exists in this plan as a task or a runbook structure**, not a
hope. Where the closure is a run, the run is named and its result is `observed`.

- **R1 — B1 (`@taxi/shared` does not resolve on the builder). CLOSED by reproduction.**
  The failure and its fix were both reproduced locally against the builder's exact view of the
  tree, with no EAS account and no Android SDK. See NOTES → *The B1 reproduction* for the commands
  and both outputs. In short (`observed` 2026-09-17): in a `git archive HEAD` tree,
  `pnpm install --frozen-lockfile` succeeds, `packages/shared/dist` is absent, `expo export`
  dies with `Android Bundling failed 895ms` and an unresolvable `main` field; running
  `pnpm --filter @taxi/shared build` — exactly what `eas-build-post-install` runs — makes the same
  command emit a 3.4 MB bundle. **Residual**: that EAS runs the hook at all, which is Expo's
  documented contract. Control: the reproduction is Level 4 check 7, so a regression is caught
  locally forever.
- **R2 — B2 (the builder's pnpm ignores this repo's settings). CLOSED — and largely dissolved.**
  Measured rather than inherited (NOTES → *The B2 measurement*): `npx pnpm@12` re-executes as
  `10.33.2` inside this repo because `package.json:4` declares `packageManager`, the frozen-lockfile
  install exits 0, and the overrides land (`react 19.2.3`, `multer 2.3.0`). The profile pin stays as
  one line of insurance against a builder with version self-management disabled; it is no longer a
  risk being managed. **Figure retired**: pnpm's current major is **12**, not the 11 the research
  named — and the claim it belonged to goes with it, not just the digit.
- **R7 — B3 (`notification-icon.png` has a text signature). CLOSED by a 9-byte repair, fix proven.**
  Found by running prebuild, not by reading. Same tree, same command, only the icon changed:
  `PREBUILD_EXIT=1` with `Could not find MIME for Buffer <null>` before, `PREBUILD_EXIT=0` and
  `✔ Finished prebuild` after (`observed` 2026-09-17). **Residual: none, and notably not a design
  question** — decoding the repaired file shows 4792 opaque, uniformly white pixels forming a disc
  (figure corrected 2026-09-17; the plan first said 4872),
  so the original asset is recovered rather than substituted, and there is nothing for
  `ui-decisions.md` to log. Control: Level 4 check 8 runs prebuild, so a future bad asset fails
  locally instead of on EAS.
- **R8 — cleartext plugin might not reach the release-inherited manifest. CLOSED by measurement.**
  Worth separating from R3, because R3 is about *misreading* a cleartext failure while this is about
  whether the fix works at all. Measured in both directions (`observed` 2026-09-17): with the
  plugin absent, `app/src/main/AndroidManifest.xml` has no `usesCleartextTraffic` and only
  `debug/` does; with `["expo-build-properties",{"android":{"usesCleartextTraffic":true}}]`
  appended, prebuild finishes and `main/` carries `android:usesCleartextTraffic="true"`. Since no
  `release/` manifest is generated, `main/` is what the preview APK gets.
- **R3 — a cleartext block read as #141 failing. CLOSED structurally, not procedurally.**
  The hazard was real: `socket.ts:30` is `transports: ['websocket']` with no polling fallback, so a
  blocked socket gives no `ping_accepted` and a frozen pin — the exact signature of #141 unfixed.
  But the confusion **cannot actually arise**, because Android's cleartext policy is enforced in
  OkHttp, which backs React Native's `fetch` as well as its WebSocket. A cleartext block therefore
  kills the REST calls too — and **steps 1, 2 and 3 are all REST**. The operator cannot sign in, so
  they never reach step 4, where the ambiguity would live. The runbook states this discriminator
  explicitly: *cannot sign in → cleartext or wrong origin; signed in and streaming, then frozen
  after a toggle → that is #141's claim.* Two further controls behind it: step 2 as a hard gate
  (driver visible and pinging before any ride exists — the only remaining way to see a
  socket-specific fault, e.g. a firewall, which cleartext policy cannot produce on its own), and
  `adb logcat` over USB as the tiebreaker (`adb` is present at `/usr/local/bin/adb`, `observed`).
- **R4 — the baked LAN origin goes stale when the DHCP lease moves. CLOSED by a pre-flight.**
  The APK carries its origin, so a moved IP looks like a dead API. The runbook's Setup opens with a
  one-line check that compares the machine's current address against the one in `eas.json`, run
  **before the phone is touched**:
  ```bash
  ipconfig getifaddr "$(route -n get default | awk '/interface:/{print $2}')"
  ```
  Interface-agnostic on purpose — `observed` 2026-09-17 that this machine's active interface is
  `en1` (`192.168.1.11`) and `en0` answers nothing, so the common `getifaddr en0` recipe would
  print an empty string and the check would silently pass. Pair it with a DHCP reservation on the
  router so the answer stops moving.
- **R5 — the verification steps pollute the working tree. CLOSED by construction.**
  Every build-route check in this plan runs against a `git archive` tree in the scratchpad and
  writes its output there; nothing runs `expo prebuild` or `expo export` inside the checkout. This
  matters because a stray `apps/driver/android/` or a stale export directory is the same class of
  failure as the stale `apps/dispatch/.next` that reddens the gate in ~25 s (memory
  `taxi-gate-stale-next-race`). Control: the gate check (Level 3) is run **after** the build-route
  checks, and Level 4 check 6 asserts `apps/driver/android` does not exist.
- **R6 — the day gets re-scoped mid-run. CLOSED by runbook structure.**
  Six other checks ride the same device day. Listing them is not enough — the control is
  structural: #141's eight steps and their verdict form one section that **ends**, the ride-along
  list comes after it with **no checkboxes**, and the Result table records #141's outcome only. A ❌
  on someone else's check is then not expressible as #141 failing, and the day can legitimately
  stop at the verdict.

### Confidence basis

**10/10 for one-pass implementation of this plan as written.** The basis, stated so it can be
argued with rather than taken on trust:

**What is `observed` (a named run produced it, 2026-09-17):**

- B1's failure *and* its fix, at the Metro level, in both directions — `Android Bundling failed
  895ms` → 3.4 MB `.hbc`, the `eas-build-post-install` command as the only difference.
- `INLINE_OK` — the `EXPO_PUBLIC_API_URL` inlining that AC #6 turns on. **Correction 2026-09-17**:
  it was *not* produced by the command this plan first specified, which greps Hermes bytecode and
  can never match. The inlining is real and is now observed in both directions, but only via the
  corrected `--no-bytecode --clear` form.
- B3's failure *and* its fix — `PREBUILD_EXIT=1` on the corrupt icon → `0` after the 9-byte
  signature repair — plus the decode proving the payload was intact all along (96×96, 4792 white
  opaque pixels; figure corrected 2026-09-17), which is what turned the fix from "regenerate and
  hope" into "restore".
- The cleartext asymmetry **and** its fix, both directions in the same tree: absent from `main` and
  present only in `debug` before, `android:usesCleartextTraffic="true"` in `main` after the plugin
  entry, with no `release/` manifest in either case.
- B2's dissolution — `pnpm@12` re-executing as `10.33.2` inside the repo, overrides applied.
- Every code citation behind C1 and C2, read from source rather than from comments — including the
  nudge's single stamping site and single sender, and `socket.ts:30`'s websocket-only transport.
- The absence of an Android SDK, and `en1`/`192.168.1.11` as this machine's live interface.
- **The two snippets the implementer types first, run verbatim as this plan writes them**: the B3
  repair one-liner against a copy of the real corrupt file → `PNG image data, 96 x 96, 8-bit/color
  RGBA, non-interlaced`, 691 bytes; and the `eas-build-post-install` command in the *builder's
  actual sequence* — `node_modules` installed, `dist` absent, fired from `apps/driver` — →
  exit 0 with `dist/index.js` rebuilt. Neither is left as "should work": an in-place binary write
  and a hook that only ever runs on someone else's machine are exactly the two things worth having
  already executed.

**What remains `expected`, and why it does not reduce the score:**

- **The EAS cloud build end-to-end — this is Q1, and it stays open.** It needs Linards's
  credentials and a build credit, so no agent can run it. It is deliberately **not** an acceptance
  criterion: AC #1 is verified by Level 4 checks 7 and 8, which exercise the same tree and the same
  prebuild that EAS would. What that buys is that the three things that *would* have failed the
  build are each closed by a reproduction — not that the remote pipeline is proven. Budget one
  failed build anyway; the plan's job was to make its failure modes already known, not to promise
  there are none.
- **The device run.** Owed to #141 by design, named under the AC list, and not counted here.

**What the score would be without this pass: 8.** The two points came from running the build route
instead of reading about it — which is also what turned up B3, a corrupt file that had been sitting
in `main` since `3d2e874` and that no check in this repo could see.

## AMENDMENTS

<!-- newest at the bottom -->

- 2026-09-17 — Second pass (Linards: "address all risks and increase confidence to 10"). Every risk
  now carries a control that exists as a task or a runbook structure, and the three build blockers
  were closed by reproduction rather than by argument. **B1** reproduced end to end against a
  `git archive HEAD` tree and its fix proven (NOTES → *The B1 reproduction*). **B2** measured and
  largely dissolved — `packageManager` already pins pnpm, so the profile pin drops to insurance;
  the "pnpm 11.9.0" figure and the claim it belonged to are both retired (NOTES → *The B2
  measurement*). **B3 is new and was the most consequential**: `apps/driver/assets/notification-icon.png`
  has a 17-character text rendering of the PNG signature where 8 bytes belong (committed in
  `3d2e874`), which fails `expo prebuild` and would have failed the first cloud build. Decoding it
  showed the payload intact — a 96×96 white disc — so the fix is a nine-byte header repair, and the
  generator script first drafted for it was dropped as unneeded scope. The cleartext task moved
  from conditional to required, and its fix was then proven too: the plugin entry puts
  `usesCleartextTraffic="true"` into the `main` manifest that the release variant inherits (R8). R3 (transport fault misread as #141 failing) closed structurally
  rather than procedurally: a cleartext block kills REST too, so steps 1–3 fail first and step 4 is
  unreachable. R4 (LAN-IP drift) and R5 (checkout pollution) added with controls; R6 (day
  re-scoped) closed by runbook ordering. Level 4 gained checks 6, 7 and 8 — check 7 is the standing
  guard, being the only check in the repo that sees the repo the way EAS does. Confidence basis
  recorded above.

- 2026-09-17 — **Executed** (`.claude/reports/driver-device-day-prep-report.md`). Every task shipped;
  the gate is green 22/22 and the driver suite is unchanged at 218. Eight divergences, corrected in
  the task text above where a re-runner would otherwise act on a false claim:
  - **The `INLINE_OK` check was unsound and its `observed` result is retracted** (VERIFY task, Level
    4 check 1, AC #6, NOTES row 8, Confidence basis — all five edited). `expo export` emits Hermes
    bytecode whose packed string table makes *no* app string greppable: `expo-router`, `socket.io`
    and `sakta.driver.session` each return 0 matches in the `.hbc`, so the grep could never match
    whatever the build did. `--no-bytecode` fixes that; `--clear` is equally required, because
    without it Metro serves the previous run's cached transform and the unset direction *also* finds
    the sentinel — an identity function. The inlining is real, and the corrected two-direction pair
    proves more than the original: origin present + throw path dead-code-eliminated when set, origin
    absent + throw path live when unset.
  - **The 4872-opaque-pixel figure does not reproduce; it is 4792** (three sites edited). No alpha
    threshold accounts for the delta — counting the anti-aliased edge as opaque gives 5024. The
    payload-intact conclusion rests on the valid chunk CRCs and the decode, not on the count.
  - **`git archive HEAD` cannot verify an uncommitted fix** (Level 4 check 7 edited). Use
    `git archive $(git write-tree)`: same tracked-file set, with the staged fixes in it.
  - **Level 4 check 4 returns 3 hits, not 0, and its patterns are miscalibrated** — it greps for
    `4, 5, 7 and 8`, which the re-derivation above calls **correct**, so it flags a true statement.
    Of the three hits, one is a dated review stating the correct set, one is the retirement note in
    the sibling plan's AMENDMENTS, and only `.claude/reports/driver-toggle-off-mid-ride-held-report.md:196`
    was genuinely stale — given a dated supersede note rather than a rewrite.
  - **Level 5's "both clean" is not met and predates this ticket**: 14 packages sit one or two patch
    versions below SDK 57's expectation and `expo-doctor` fails two checks, all pinned identically
    on `main` (`observed`). Not fixed — a 14-package bump is outside a ticket that changes no shipped
    app source. The runbook states the reality instead, and says why patch drift inside SDK 57 is not
    the hazard a cross-major mix is.
  - **`npx eas` fetches the wrong package** — the npm name `eas` is an unrelated package at `0.1.0`;
    the Expo CLI is `eas-cli` (`24.7.0`), and neither is a repo dependency. The runbook uses
    `npx eas-cli@latest`. The same latent bug sits in `.claude/plans/driver-app-auth-online-location.md:816`
    (`npx eas init`), left for whoever attempts A2.
  - **`npx expo install expo-build-properties` auto-writes a bare-string plugin entry**; it must be
    converted to the array form carrying the options or the dependency does nothing.
  - **Prebuild generates three variant directories** (`debug`, `debugOptimized`, `main`), not the two
    the cleartext task's table lists. Conclusion unaffected — there is still no `release/` manifest,
    so the release variant inherits `main`.
  - Q6 is confirmed rather than suspected: prebuild prints the `expo-system-ui` warning, so
    `app.json`'s `"userInterfaceStyle": "light"` is inert on Android. Still not this ticket's.

- 2026-09-17 — PR #218 review round 1 (`.claude/code-reviews/pr-218-review.md`), findings F1–F9
  applied. Nine findings, all in prose; no shipped source changed, no acceptance criterion moved.
  Five touch this plan, not only the runbook:
  - **F1 — the A1/A2 saving was stated too wide.** The plan's *What this day does NOT need* outline
    (task 3 of the runbook build) said "no `eas init`", and the runbook's row then denied the project
    link outright. Only the push **credential** half is off #141's critical path: EAS attaches every
    build to a linked project, so `eas-cli init` runs on the day and writes `extra.eas.projectId`
    into a tracked `app.json`. The precedent the CONTEXT REFERENCES already cited
    (`spikes/gps-harness/app.json:42-47`) commits both that key and `owner: "linards"`; this config
    committed neither. Narrowed at three sites here plus the runbook's row and §2. The prompt stays
    `expected`, not `observed`, but ~~`eas-cli` cannot run without Expo credentials~~ — **corrected
    2026-09-17 (PR #218 review round 2, L6's verification)**: `eas-cli` *does* run here and reaches
    Expo (`config` reported account `linards`). What is unexercised is the interactive branch, since
    every run passed `--non-interactive`.
  - **F2 — C2's chain stopped one guard short.** Point 5 named `sendDueNudges` by signature and did
    not reach the `no_token` guard fifteen lines inside it (`drivers.service.ts:353-360`), which
    `continue`s before the only caller of `StubPushProvider.send`. So the signal box's
    `driver.push.stub_sent` was unreachable on the very setup the runbook prescribes — the same
    vacuous-signal defect C2 exists to retire, one layer deeper. The absence now reads
    `driver.push.nudge_*`, which is what a broken app actually prints and stays true if the push
    prerequisites are ever met.
  - **F3 / F6 — C1's signal box was unreadable in two ways.** It never said which of the log line's
    two timestamps to time (`clientAt`, the phone's, survives a queue replay; `at`, the server's,
    bunches after one), and its "no gap > 8 s" sat exactly on the boundary the 4 s throttle produces
    when one OS delivery is dropped. Both corrected in the box and in runbook step 5; the threshold
    is now 12 s, `derived` as 3 × `MIN_FIX_INTERVAL_MS`, and labelled as arithmetic rather than a
    measurement — Android delivery jitter has not been measured and cannot be without the phone.
  - **F5 — the committed `env` block's day-0 instruction was incomplete, not wrong.** The DECIDED
    bullet's choice stands (the reviewer's `eas env:create` alternative is the one it already
    weighed and rejected, with reasons). What was missing is that the operator's edit carries this
    machine's DHCP lease and must stay uncommitted; the runbook's §0 now says so.

- 2026-09-17 — PR #218 review round 2 (`.claude/code-reviews/pr-218-review-round2.md`), verdict
  **Approve**; M1, M2 and L1–L6 applied, M3 filed as
  [#220](https://github.com/linardsb/taxi/issues/220) rather than fixed (its root remedy contradicts
  the *"cleartext, **required, not conditional**"* task heading at `:607`, and `eas.json` defines only
  `preview`, so nothing in the tree can trigger it). Again all prose; no shipped source changed.
  Three touch this plan:
  - **L1 — C1's signal box stated the threshold as the pass condition, and the runbook's note
    contradicted it.** Round 1's F3/F6 corrected the *number* (8 s → 12 s) and left the *shape*: "no
    `clientAt` gap > 12 s" reads as a stopwatch, while the note beside it said to treat one gap just
    over 12 s as a re-read. Two verdicts on a step the verdict rule makes binary, and the ✅/❌ column
    is filled in from the cell. Both the box (`:290-301`) and runbook step 5 now lead with the
    operative condition — the stream must not stop — and keep the 12 s arithmetic as the tolerance
    it always was. L4's wall-clock read is folded into the same box: a `clientAt` gap check cannot
    distinguish a live stream from a backlog draining.
  - **L6 adds a fourth command to §2's block, which the runbook-build task enumerated as three.**
    `npx eas-cli@latest config -p android -e preview --non-interactive` now sits between `init` and
    `build`. The task's VALIDATE for `eas.json` (`:604`) was `node -e "JSON.parse(…)"`, which proves the file
    is JSON and nothing about its schema — `eas-cli` is not a repo dependency, so neither the gate
    nor the tree could reject a bad profile key, and one would have surfaced at the `eas build` line
    on the day. The command was verified before it went in (`observed` 2026-09-17, `eas-cli@24.7.0`):
    an undefined key gives `eas.json is not valid.` / `"build.preview.<key>" is not allowed`, exit 1,
    and schema validation runs *before* the project-link check. **Supersedes** the task's three-line
    block; the VALIDATE line stands as the in-tree half.
  - **F1's `expected` label survives its own justification** — see the correction struck into the
    round-1 entry above. `eas-cli` runs here and reaches Expo; what is unexercised is the interactive
    create-or-link branch. This also retires the plan's open question of whether `pnpm` is a real
    `eas.json` profile key (`:558-560`): the committed file clears schema validation, so it is.

  Fixes report: `.claude/reports/pr-218-review-fixes-round2.md`, with a 24-assertion citation
  verifier that returns 0 hits for every added claim against `bd5193a`.
