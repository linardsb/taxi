# Feature: #15 close-out — the offers / active-ride / earnings device pass, run on the emulator

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

**#15's code already shipped.** PR #154 (`602d5fb`, merged) built the offer card, the
active-ride flow and the receipt; PR #163 landed the five deferred Lows; #157–#161 closed
the review's spin-offs. `apps/driver/src/features/{offers,active-ride,earnings}` are
populated and tested. PR #154's own body states what is left in one clause:

> Implements #15 (**stays open for the device day**).

The device-day runbook agrees independently — `docs/runbooks/driver-device-day.md:362`
lists "The offers / active-ride device pass" as owed, pointing at
`.claude/plans/driver-offers-active-ride.md:506` §Level 4.

So this ticket is **not a build**. It is the Level 4 pass that was written and never run,
plus the two documented blockers that stop it running, plus three follow-ups a prior plan
promised as "separate tickets" and never filed.

What makes it runnable now: **#224/#233 proved an Android emulator is a working substitute
runtime** for this app (Gates 1–3 passed 2026-09-18 on AVD `sakta224`). The device day no
longer waits on a phone that does not exist.

## User Story

As **Linards**, closing out the driver app's biggest ticket
I want to **run #15's thirteen Level 4 steps on the emulator already on this machine, with every step actually performable**
So that **#15 closes on evidence rather than on "the code is written", and the work it deferred has somewhere to live instead of evaporating a second time**

## Problem Statement

Three problems, in descending order of how much they cost:

1. **#15 is code-complete but cannot close.** Its thirteen Level 4 steps
   (`driver-offers-active-ride.md:506`) were deliberately written for a device day and not
   run. Nothing in the gate covers them: `pnpm turbo run typecheck lint test build --force`
   never renders a screen, never speaks a label, and never watches a countdown expire.

2. **Two documented blockers make three of those steps unperformable as written**, and both
   are recorded in the runbook as agent-run findings rather than fixed:
   - `driver-device-day.md:545` — *"An `adb` tap cannot win the offer countdown."*
     `screencap` → read → `input tap` is a ~4 s round trip; at 20 s the card already read
     «8 s left» when the screenshot came back, the offer expired
     (`dispatch.offer.expired`) and the ride stayed unassigned. **Step 3's accept leg, step
     4's push-tap leg and step 13's payment-change leg all require winning the countdown.**
   - `driver-device-day.md:541` — *"`uiautomator dump` fails on any screen with a running
     countdown"* (`ERROR: could not get idle state.`). The offer card has **two**
     continuous re-render sources, so this is structural, not flaky:
     `FLASH_HALF_PERIOD_MS = 500` (`offer-card.tsx:15`, a `setInterval` toggling the card
     background) and the per-second countdown text (`offer-card.tsx:113`).

3. **Three follow-ups have no ticket.** The prior plan's Non-Goals promised "separate
   tickets" for **PIN pickup** and the **blind-rider protocol**; PR #154's body promised
   two more (**quote carries `distanceMeters`/`durationSeconds`**, **rider identity on the
   driver ride read**). `observed` 2026-09-22: `gh issue list --state all --limit 300`
   matches none of them, open or closed. The blind-rider protocol is a **headline PRD
   claim** — §1 names blind clients as demand Atis raised unprompted (S5-8), §5 gives them
   their own JTBD — and it is currently in nobody's backlog.

## Solution Statement

Ship the means, run the pass, record the evidence, give the orphans a home.

- **Means A — win the countdown without faking the product.** `offer_timeout_seconds` is a
  `platform_config` row (`db/src/schema/platform-config.ts:42`, default 20), and
  `PlatformConfigRepository.forCity()` reads it **fresh per call** — no cache, no restart
  (`platform-config.repository.ts`, verified: the method is a plain `select().limit(1)`
  with no memoisation and no TTL). One `UPDATE` raises the window for the accept legs; the
  expiry leg runs at the seeded 20 s, where no tap is wanted. Both legs stay honest because
  the app reads the deadline off the wire (`remainingFor`, `offer-state.ts:116`) rather
  than hardcoding 20.
- **Means B — an a11y oracle per property, not per instrument.** Split the owed ear-checks
  three ways and say what each closes (see §ACCEPTANCE CRITERIA and the oracle table in
  §NOTES). TalkBack **is on the image already** — `observed` 2026-09-22 below.
- **Run** §Steps 1–13 on `sakta224`, recording each as ✅/❌ with the console line or
  screenshot that shows it.
- **Write the result into the runbook**, which is the only copy of the run sheet, and fix
  its `#16` → `#15` mis-attribution at line 362 on the way past.
- **File the three orphaned follow-ups** and cite their numbers in Non-Goals.

### The fact that unblocks the a11y half

`observed` 2026-09-22, this machine, AVD `sakta224`
(`system-images;android-36;google_apis;x86_64`), booted with
`-no-snapshot -no-boot-anim -gpu swiftshader_indirect`:

```
$ adb -s emulator-5554 shell pm list packages | grep -iE 'talkback|marvin'
package:com.google.android.marvin.talkbackoverlay
package:com.google.android.marvin.talkback

$ adb shell settings put secure enabled_accessibility_services \
    com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService
$ adb shell settings put secure accessibility_enabled 1
$ adb shell "ps -A | grep -i talkback"
u0_a163  2036  472  16604192 129568 0  0 R com.google.android.marvin.talkback

$ adb logcat -d | grep TextToSpeech
I TextToSpeech: Sucessfully bound to com.google.android.tts
I TextToSpeech: Connected to TTS engine
```

TalkBack is installed, starts, and binds to the TTS engine on the **`google_apis`** image —
the runbook's `google_apis`-not-`default` rule (`:390` §Setup step 3) already gives it to
us, and no Play Store image is needed. **The TalkBack half of the owed ear-checks is
therefore not hardware-blocked.** Only VoiceOver is → **#257**.

`uiautomator dump` itself works on a static screen (`observed` same session:
`UI hierchary dumped to: /sdcard/dump.xml`, node XML carrying the `content-desc` attribute
per node). It is only the *countdown screens* it refuses.

`observed` also, and this is what T7 turns on: TalkBack **does** carry utterance text in
`logcat`, but only on its **error** path —

```
E/talkback: SpeechControllerImpl( 2114): TTS is not ready. Attempted to speak before TTS
was initialized. Item: {utteranceId:"", fragments:[{text:TalkBack on, earcons:[], …}]}
```

After TTS initialised, four focus swipes produced **zero** `SpeechController` lines, and
`setprop log.tag.talkback VERBOSE` (plus `log.tag.SpeechControllerImpl`, plus a TalkBack
restart) did not change that — TalkBack's `LogUtils` gates on its own preference, not on
`Log.isLoggable`. That preference lives behind TalkBack's Settings UI and its prefs file
does not exist until the UI writes it (`shared_prefs/` held only `gms_icing_*` and
`primes.xml`). **`adb root` works on this image** (`uid=0(root) … context=u:r:su:s0`), so
once the file exists it is writable and the setting survives.

So the utterance oracle is *available but not free*: one UI trip per AVD buys a
machine-readable log of everything TalkBack says. T7 sets it up before it runs anything.

## Out of Scope / Non-Goals

- **Not included: any code change to the offer / active-ride / earnings slices**, unless a
  step of the pass fails. A failure files an issue with the reproduction and is fixed in
  its own loop — this ticket does not carry an open-ended fix budget.
- **Not included: the `#14` device pass** (§C steps 1–13: sign-in, streaming, dead zone,
  process kill, dark sweep, expired token, i18n, background-permission refusal).
  `driver-device-day.md:360` assigns it to #14, which is still open. Different owner, same
  day. Running it is welcome; it does not gate #15.
- **Not included: #141's own gates.** Closed, proven, recorded
  (`driver-device-day.md:558` §"Gates 2 and 3, as run"). Do not re-run them.
- **Not included: the GPS field drive (#4).** Deferred by Linards 2026-08-26; needs a car.
- **Not included: VoiceOver.** Genuinely unreachable here — iMac19,1 cannot run Tahoe so
  Xcode 26.3 is the ceiling, SDK 57 does not compile at it (`observed` 2026-08-25), no
  Apple ID, no paid programme. Filed as **#257**, cited in AC9.
- **Not included: PIN pickup ([#258](https://github.com/linardsb/taxi/issues/258)), the
  blind-rider protocol ([#259](https://github.com/linardsb/taxi/issues/259)),
  `distanceMeters`/`durationSeconds` on the quote
  ([#260](https://github.com/linardsb/taxi/issues/260)), rider identity on the driver ride
  read ([#261](https://github.com/linardsb/taxi/issues/261)).** All four are real and all
  four are deferred — T10 filed **four**, not three: the fourth (rider identity) was the
  "check whether it has a home" item, and it did not. Do not build any of them here.
- **Not changing: `offer_timeout_seconds` in the seed.** T1's raise is a runtime `UPDATE`
  against the dev database and is reverted by T8. The seeded 20 s is the product decision
  (`driver-ux-evidence.md` §"Accept timer 20–30 s") and stays.
- **Not building: a second run sheet.** The runbook's own rule
  (`driver-device-day.md:368`): the emulator section cites §Steps by number rather than
  restating them. This pass follows the same discipline — the steps live in
  `driver-offers-active-ride.md:506`, and the runbook gains a §Result table plus the
  setup deltas, not a copy.

## Feature Metadata

**Feature Type**: Validation (with a small docs + tooling surface)
**Estimated Complexity**: Medium — low code volume, high ordering and evidence discipline
**Primary Systems Affected**: `docs/runbooks/driver-device-day.md`, `apps/driver` (build only), `services/api` (dev DB row only), GitHub backlog
**Dependencies**: Android SDK + AVD `sakta224` (already installed, 5.9 GiB), EAS build for the APK, docker compose stack, a provisioned dispatcher

## Related Work

**Implements**: [#15](https://github.com/linardsb/taxi/issues/15) (the remaining half) · **Epic**: [#1](https://github.com/linardsb/taxi/issues/1) → `docs/epics/sakta-cab.architecture.md`

**Back-references**:

- `.claude/plans/driver-offers-active-ride.md` — Why: **the run sheet this pass executes** (§Level 4, line 506). Its 13 steps are this plan's T5. Read its §Out of Scope too; it is where the three orphaned follow-ups were promised.
- `.claude/plans/driver-device-day-prep.md` + `docs/runbooks/driver-device-day.md` — Why: the emulator route, the setup, and the four agent-run findings that shape T1/T4.
- `.claude/plans/emulator-oracle-141.md` — Why: the precedent — an owed device claim answered by an emulator (#224 → #233).
- `.claude/plans/driver-app-auth-online-location.md` — Why: §Level 4 §C is #14's pass, which shares the day and the APK.

**Forward-references**:

- [#258](https://github.com/linardsb/taxi/issues/258) PIN pickup — Why: #15's re-slice promised it a separate ticket; no schema, column or endpoint exists (`observed` 2026-09-22).
- [#259](https://github.com/linardsb/taxi/issues/259) Blind-rider protocol — Why: a PRD §1/§5 headline claim (S5-8) that was in nobody's backlog. Ordered after #261.
- [#260](https://github.com/linardsb/taxi/issues/260) Quote carries `distanceMeters`/`durationSeconds` — Why: PR #154 promised it; `fareQuoteSchema` carries money, not measurements.
- [#261](https://github.com/linardsb/taxi/issues/261) Rider identity on the driver ride read — Why: PR #154's fourth promised follow-up; `rideSchema` carries `riderId` and no name. Gates #259.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `docs/runbooks/driver-device-day.md` (**whole file**, 660+ lines) — Why: the only copy of the run sheet. §Setup (78), §Steps (233), §Emulator route (367), §"Setup, once" (390), §"Injecting a position" (434), §"Running the steps on an emulator" (519), §"Also on this day" (352). **T2 edits line 362; T9 appends a §Result.**
- `.claude/plans/driver-offers-active-ride.md` lines 495–560 — Why: §Level 4's thirteen steps, verbatim what T5 runs. Do not paraphrase them into the runbook.
- `db/src/schema/platform-config.ts` (line 42) — Why: `offerTimeoutSeconds: integer('offer_timeout_seconds').notNull().default(20)`. T1's `UPDATE` target; the snake_case column name is what SQL needs.
- `services/api/src/features/platform-config/platform-config.repository.ts` — Why: proves the read is uncached (plain `select().limit(1)`, parsed through `platformConfigSchema`, no memo). **This is why T1 needs no API restart** — verify it yourself before relying on it.
- `services/api/src/features/dispatch/offer-builder.ts` (line 61) — Why: `sentAt.getTime() + input.config.offerTimeoutSeconds * 1000` — the only consumer; confirms the raise lands on the wire `expiresAt` the app counts down from.
- `apps/driver/src/features/offers/offer-card.tsx` (lines 15, 17, 45–66, 71–113) — Why: `FLASH_HALF_PERIOD_MS = 500` and the countdown `Text` are the two reasons `uiautomator dump` cannot settle here; `ANNOUNCE_EVERY_S = 5` and the `announceForAccessibility` effect are what step A3 listens for.
- `apps/driver/src/features/offers/offer-card-props.ts` (lines 60–118) — Why: `a11yLabel` is composed from seven segments **including `seconds`**, so the accessible name mutates once a second. T7's observation target.
- `apps/driver/src/features/availability/home-screen.tsx` (lines 96–110) — Why: the earnings link — grouping `Pressable`, explicit `accessibilityLabel`, no `accessibilityHint`. **The same mechanism as the offer card, on a screen with no countdown**, which is what makes it dumpable (T6).
- `apps/driver/src/features/availability/earnings-body.ts` — Why: the three states T6 reads (`null` → spinner, `'—'` → failed first load, the composed string → ready).
- `apps/driver/src/features/availability/earnings-card.tsx` (line ~17) — Why: `accessibilityLiveRegion="polite"` inside the collapsed `Pressable` — review N3's open question, T7.
- `apps/driver/eas.json` — Why: the `preview` profile, `distribution: internal`, `buildType: apk`, and `EXPO_PUBLIC_API_URL` baked at build time (committed value `http://192.168.1.11:3001`; the emulator needs `http://10.0.2.2:3001` as an **uncommitted** edit — `driver-device-day.md:527`).
- `services/api/scripts/provision-dispatcher.ts` — Why: `pnpm --filter @taxi/api provision:dispatcher +371…`, the one means of getting a dispatcher account.
- `.claude/code-reviews/pr-163-review.md` (line 183) — Why: N3, the third ear-check.
- `.claude/references/ui-decisions.md` (2026-09-09 entry, ~line 17) — Why: the cosmetic decisions behind the earnings-label states; do not re-litigate them.

### New Files to Create

- `.claude/reports/driver-15-offers-device-pass-report.md` — the run's evidence: 13 rows, ✅/❌, the console line or screenshot path per row, and every divergence.
- `/private/tmp/.../scratchpad/pass-evidence/` — screenshots (`adb exec-out screencap -p`) and `uiautomator` dumps. **Scratchpad, not the repo** — only the report's citations come back.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [UI Automator dump](https://developer.android.com/tools/uiautomator) — the `content-desc` attribute is the `AccessibilityNodeInfo.contentDescription`, i.e. exactly what React Native's `accessibilityLabel` sets and what TalkBack reads first. Why: this is the whole justification for T6's oracle.
- [React Native Accessibility — `accessible` and label collapse](https://reactnative.dev/docs/accessibility#accessible) — a `View`/`Pressable` with `accessible={true}` groups children into one node; an explicit `accessibilityLabel` **replaces** the concatenated child text. Why: the mechanism F4 and F20 both turn on.
- [TalkBack — enabling from adb](https://developer.android.com/guide/topics/ui/accessibility/testing#talkback) — `settings put secure enabled_accessibility_services`. Why: T7's setup, already verified above.
- [Expo EAS Build — internal distribution](https://docs.expo.dev/build/internal-distribution/) — Why: the `preview` profile produces the installable APK.

### Patterns to Follow

**Runbook prose** — `docs/runbooks/driver-device-day.md` is the house style for this kind of
document: a `Result` table at the top (✅/❌ per gate, never prose), numbered steps in a
three-column table (`What` · `Where` · `Expect`), every environment quirk stated with
`observed <date>` and the exact error text. Match it. It is also the one place in this repo
where ✅/❌ are permitted (the output style's single exception).

**Figure provenance** — every number in the report and the runbook edit carries
`observed` (name the run), `derived` (show the arithmetic **and** its condition) or
`expected`. The repo has shipped this defect twice (#87, #107); a validation report is the
single easiest place to ship it a third time, because every figure in it *looks* observed.

**Evidence, not tick-marks** — a ✅ cites the artifact: an api console line, a screenshot
path, a `content-desc` string. "It worked" is not a result.

**Divergence logging** — the runbook already records `adb`-run divergences honestly
(`:531`: *"an `input tap` at exact centre coordinates proves nothing about the 44 px
touch-target rule a real finger tests"*). Every substitution in this pass gets the same
treatment: what it closes, and what it does not.

---

## IMPLEMENTATION PLAN

### Phase 1: Make every step performable

Close the two blockers and confirm the build, before any step is attempted.

**Tasks:** T1 (countdown lever), T2 (runbook `#16`→`#15`), T3 (APK), T4 (stack + accounts).

### Phase 2: Run the functional pass

**Depends on:** Phase 1.

§Level 4 steps 1–13. **Independent of:** Phase 3 — the a11y legs need the same APK and the
same emulator but no ride state, so they can run first if the stack misbehaves.

**Tasks:** T5.

### Phase 3: The a11y legs

**Depends on:** Phase 1 (T3 only). **Independent of:** Phase 2.

**Tasks:** T6 (machine-readable: `content-desc` on the static screens), T7 (attended:
TalkBack aloud on the offer card).

### Phase 4: Record, restore, hand off

**Depends on:** Phases 2 and 3.

**Tasks:** T8 (restore config), T9 (runbook §Result + report), T10 (file the three
orphans), T11 (close #15 or say exactly what blocks it).

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom.

### UPDATE `platform_config.offer_timeout_seconds` — the countdown lever

- **IMPLEMENT**: Before the accept legs, raise the dev row so an `adb` round trip can win:
  `UPDATE platform_config SET offer_timeout_seconds = 180;` against the **dev** database
  (the one `docker compose` serves, per `.env`'s `DATABASE_URL`). Verify the raise reached
  the wire rather than only the table: book an offer and read `expiresAt - sentAt` off the
  `ride:offer` payload or the card's first countdown frame. **Leave the expiry leg (§Level 4
  step 3, first half) for AFTER T8 restores 20** — or run it first, before this raise; say
  in the report which order you used.
- **PATTERN**: `platform-config.repository.ts` — `forCity()` is a bare
  `select().from(platformConfig).where(eq(cityId)).limit(1)` parsed through
  `platformConfigSchema`. No cache layer, no TTL, no module-level memo.
- **IMPORTS**: none — SQL via `docker compose exec` + `psql`, or `pnpm --filter @taxi/db studio` if it exists.
- **GOTCHA**: The column is snake_case in SQL (`offer_timeout_seconds`) and camelCase in
  Drizzle. — **GOTCHA**: `platformConfigSchema` bounds it with
  `z.number().int().positive()` (`packages/shared/src/schemas/platform-config.ts:40`), so
  180 parses; a zero or negative would throw at read time, not at `UPDATE`. — **GOTCHA**:
  180 s is a *test* window. It changes nothing the app hardcodes (`remainingFor` reads
  `expiresAt` off the wire), but it **does** change what step 3's expiry half measures, and
  it makes `DispatchSweeper`'s cascade slow — a second candidate waits 3 minutes. Run the
  single-driver steps under the raise and anything cascade-shaped under 20.
- **NOT a gotcha, checked**: `unclaimedAlertSeconds` still defaults to 60, so a 180 s offer
  outlives it threefold — but the unclaimed alert does **not** fire while that offer is
  pending. `alertUnclaimed` iterates `findAwaitingDispatch`, whose predicate is
  `and(eq(rides.status, 'requested'), isNull(rides.driverId))`
  (`rides.repository.ts:205`); a ride with a live offer is past `requested`, so it is not in
  the batch. Verify this holds before you read step 3's result as clean — it is the one
  place the raise could manufacture a false ❌.
- **VALIDATE**: `docker compose exec -T db psql -U postgres -d taxi -c "select offer_timeout_seconds from platform_config;"` → `180`, **and** the card's first countdown frame reads near 180, not 20. Both, or the lever did not land.
- **SATISFIES**: unblocks AC2, AC4, AC6 (every step needing a won countdown).

### UPDATE `docs/runbooks/driver-device-day.md` line 362 — the mis-attributed row

- **IMPLEMENT**: `| The offers / active-ride device pass | #16 — ...` cites **#16**, which
  is the *rider* app's auth + booking ticket. The plan it points at
  (`driver-offers-active-ride.md`) is #15's. Change `#16` → `#15`. While there, check line
  360's `#14` and line 363's `#4` are right (they are, at a read on 2026-09-22 — but read,
  do not assume).
- **PATTERN**: the §"Also on this day" table, `driver-device-day.md:352-364`.
- **GOTCHA**: this file is the **only** copy of the run sheet — no duplicate to fall back
  on. Edit surgically; do not reflow the table.
- **VALIDATE**: `grep -n 'offers / active-ride device pass' docs/runbooks/driver-device-day.md` → the row names `#15`; `git diff --stat` shows exactly one file, one changed line.
- **SATISFIES**: AC8.

### BUILD the driver APK — `preview` profile, emulator origin

- **IMPLEMENT**: Point the build at the emulator's host alias, build, install.
  1. Uncommitted edit: `apps/driver/eas.json` `preview.env.EXPO_PUBLIC_API_URL` →
     `http://10.0.2.2:3001` (keep the port from `API_PORT`).
  2. `eas init --id 976c4e03-9ef1-46aa-b383-bc72138890a4` first — `extra.eas.projectId` is
     deliberately out of git, so every `eas` subcommand otherwise refuses in a TTY-less
     shell. **Never `--account`**: it creates a second project.
  3. Build the `preview` profile, install the APK on `sakta224`.
- **PATTERN**: `driver-device-day.md:128` §2 "Build and install the APK", and `:527` for
  the `10.0.2.2` rule and why it is a property of the emulator rather than of a DHCP lease.
- **GOTCHA**: **`10.0.2.2` must never reach a phone build.** Keep the edit uncommitted.
- **GOTCHA**: **a green gate says nothing about whether the Android build works.** Two
  blockers (#225 deps, #232 `expo.locales` lint) each needed a real ~20 min EAS build to
  surface. Budget one build *and one failure*. `apps/driver` last changed at `414bada`
  (2026-09-20); `packages/shared` has moved since (#245 `5e45d49`, #135 `001d1c7`) and is
  bundled into the app, so **do not reuse an older APK** without checking its commit.
- **GOTCHA**: run `npx expo install --check` before the build. `driver-device-day.md` §D3
  records 9 packages of pre-existing drift; decide and record, do not silently bump.
- **VALIDATE**: `adb -s emulator-5554 shell pm list packages | grep sakta` → the package is present; cold-launch it and reach the sign-in screen without a crash; `adb logcat -d | grep -i 'cleartext\|ECONNREFUSED'` is empty once the api is up.
- **SATISFIES**: prerequisite for every AC.

### START the stack and the accounts

- **IMPLEMENT**: `docker compose up -d --wait`; api on `API_PORT`; provision a dispatcher
  (`pnpm --filter @taxi/api provision:dispatcher +37120000001`); sign the driver in on the
  emulator with a **different** number (`+37120000002`). Boot the AVD and poll
  `sys.boot_completed` (~80 s, `observed` 2026-09-18). Set the locale if you want the LV
  strings the run sheet quotes: `adb shell settings put system system_locales lv-LV`.
- **PATTERN**: `driver-device-day.md:111` §1, `:390` §"Setup, once" step 5, `:548` (the
  phone-number and locale findings).
- **GOTCHA**: **the driver phone must not be the dispatcher's.** `findOrCreate` applies
  `role` only to a brand-new row (`auth.repository.ts:47-50`), so reusing the dispatcher's
  number signs in as a dispatcher and the driver app never leaves onboarding.
- **GOTCHA**: **`adb wait-for-device` returns at `adbd`, not at boot** — poll
  `sys.boot_completed` or everything after it races the boot.
- **GOTCHA**: on a stack with no `GOOGLE_MAPS_API_KEY`, the console's new-order form cannot
  geocode at all — use `POST /dispatch/bookings` with explicit coordinates, and its
  `Idempotency-Key` header **must be a uuid** (any other string fails as a bare
  `Invalid uuid` with an empty `path`). `driver-device-day.md:245`.
- **GOTCHA**: `pretest`/gate runs are mutually destructive across sessions (global-setup
  drops the shared test DB). Do not run the gate while the pass is live.
- **ALSO PROVISION: a rider session.** §Level 4 step 13 needs the rider to switch the
  payment method while the driver's card is up, and a phone-booked customer has a **row,
  not a session**. Get one the same way the driver did: `POST` an OTP request for that
  customer's number, read the code from the api console — `auth.sms.stub_sent` logs the
  SMS **body in full**, deliberately (`stub-sms.provider.ts:28-37`) — and exchange it for a
  token. Drive `PATCH` of the payment method with that bearer. **Third distinct phone
  number**: `findOrCreate` applies `role` only to a brand-new row
  (`auth.repository.ts:46-52`), so reusing the driver's or the dispatcher's number gets you
  their role, not a rider. Use `+37120000003`.
  - **Budget the OTP ceiling**: `OTP_MAX_REQUESTS_PER_HOUR` is per phone. A re-run inside
    the hour needs a fourth number or a wait.
  - Without this, step 13 is unrun and **AC4 loses its payment-change leg** — say so rather
    than letting AC4 read ✅ on three legs out of four.
- **VALIDATE**: `adb shell getprop sys.boot_completed` → `1`; the driver app shows the online pill; `docker compose ps` shows db and redis healthy; the api console logs `driver.location.ping_accepted`; the rider token returns 200 on a `GET` of its own ride.
- **SATISFIES**: prerequisite for AC1–AC7.

### RUN §Level 4 steps 1–13 — the functional pass

- **IMPLEMENT**: Execute `.claude/plans/driver-offers-active-ride.md:506` §Level 4 steps
  1–13 **as written**, on `sakta224`. Record each as a row: step, ✅/❌, and the artifact
  (api console line, screenshot path, board state). Known substitutions, each logged as a
  divergence with what it does and does not close:
  - **Step 9 (glance mode above 10 km/h)**: no car. `GLANCE_SPEED_MPS = 10/3.6`
    (`offer-card-props.ts:12`) reads `state.speedMps`, which comes from the location fix.
    Inject motion with the test-provider recipe at `driver-device-day.md:434` — a real
    `speed` on synthetic fixes. **Closes**: the card collapses at the threshold.
    **Does not close**: readability at speed, which is the point of the feature.
  - **Steps 3/4/13 (accept legs)**: rely on T1's raise. **Closes**: the transition, the
    payload, the banner. **Does not close**: that a driver can win 20 s — that is a human
    finger on a phone and stays owed.
  - **Any tap**: `input tap` at exact centre coordinates proves nothing about the 44 px
    touch-target rule (`driver-device-day.md:531`).
  - **Step 12 (two devices in a zone)**: needs a second AVD (`sakta141` exists). If you
    run only one, say so — the queue line is then unverified on device, and AC5 is partial.
- **PATTERN**: `driver-device-day.md:519` §"Running the steps on an emulator" — cite steps
  by number, do not restate them.
- **GOTCHA**: `uiautomator dump` **will fail on the offer card** with
  `ERROR: could not get idle state.` — two causes, both continuous:
  `FLASH_HALF_PERIOD_MS = 500` and the per-second countdown. Drive that screen from
  `adb exec-out screencap -p` + fixed coordinates. `screencap` always works.
- **GOTCHA**: a failing step is a **finding, not a fix**. File it with the reproduction and
  keep going; do not start debugging the slice mid-pass.
- **VALIDATE**: 13 rows in the report, each with an artifact; the api console shows `dispatch.offer.expired` for the expiry leg and a `ride` reaching `completed` for the walk; the receipt's three figures satisfy `commission + net === total` against the ride's `split` row read from the database.
- **SATISFIES**: AC1–AC7.

### READ the accessible names off the static screens — `content-desc`

- **IMPLEMENT**: For each of the three earnings-link states, `adb shell uiautomator dump`
  the **home** screen and read the link node's `content-desc`:
  1. **loading** — cold launch, before the first `GET /drivers/me/earnings/today` returns
     (a spinner). Expect the name to be «Ieņēmumi» **alone**.
  2. **failed first load** — expect «Ieņēmumi. —» (`NO_EARNINGS` is the literal em dash
     `'—'`, `earnings-body.ts`). **This state needs a route-selective fault — read the
     GOTCHA below before attempting it.**
  3. **ready** — expect «Ieņēmumi. Šodien: €X · Braucieni: N».

  Then assert the **collapse**: exactly **one** node carries the composed name, and the
  `EarningsCard`'s child `Text` is **not** separately exposed. That is the mechanism F4 and
  F20 both rest on.
- **PATTERN**: `driver-device-day.md:535` already uses `uiautomator dump` → read `bounds` →
  `input tap`; this reads `content-desc` from the same dump.
- **IMPORTS**: none. `adb shell uiautomator dump /sdcard/dump.xml && adb shell cat /sdcard/dump.xml`.
- **GOTCHA**: the home screen has **no countdown**, so the dump settles — `observed`
  2026-09-22 on a static screen: `UI hierchary dumped to: /sdcard/dump.xml`. But the
  presence pill and the toggle animate; dump while nothing is mid-transition.
- **GOTCHA**: `content-desc` is the `AccessibilityNodeInfo.contentDescription`, which is
  **what TalkBack reads first** — so this closes the *name* leg. It does **not** close
  whether the hint is spoken, or in what order, or whether a live region interrupts. Say so.
- **GOTCHA — case 2 is NOT reachable by stopping the api or by airplane mode.** Session
  restore is local (`readSession` from `session-store`, no network — `use-session.tsx:13`),
  so a cold launch offline gets past the session check; but `GateScreen` then blocks on
  `useMe`: `if (status === 'error')` renders the offline banner and **returns before the
  redirect**, so home never mounts (`gate-screen.tsx`). With the api down you get the
  banner, not a dashed earnings link. The state needs `GET /drivers/me` to **succeed** and
  `GET /drivers/me/earnings/today` to **fail**, which is route-selective.
  Three ways, pick one and record it:
  1. **A ~20-line forwarding proxy in the scratchpad** on the port the APK was built
     against, relaying everything to the api except `/drivers/me/earnings/today`, which it
     answers 500. Not repo code — a scratchpad script, cited by path from the report.
  2. **Break the aggregate's data** rather than the route, if a fixture exists that does it
     without also breaking `/drivers/me`. Check before assuming one does.
  3. **Declare the leg owed.** The *string* is already pinned by the unit suite; what is
     owed is only how TalkBack renders a lone em dash — plausibly as **silence**, which
     would make the failed state sound identical to the loading state. That is a real and
     narrow gap and a genuine finding candidate, which is why it is worth option 1.

  Cases 1 and 3 together do close the **composition and collapse mechanism**; case 2 is the
  ready shape with one segment replaced. Do not let that argument silently stand in for
  case 2's own result — if you skip it, AC9 says "unrun", not ✅.
- **VALIDATE**: three dumps saved to the scratchpad; the report quotes the exact `content-desc` string for each, or names case 2 unrun with the reason; the "one node" assertion is shown by the dump excerpt, not asserted in prose.
- **SATISFIES**: AC9 (TalkBack name leg, earnings link).

### LISTEN — TalkBack aloud on the offer card and the live region

- **IMPLEMENT**: Enable TalkBack (recipe verified above), then with sound on:
  1. **Offer card (F4)** — raise an offer under T1's window and swipe focus onto the card.
     Confirm **the fare and «you keep» figures are actually spoken**, and that the composed
     order holds: fare+net+seconds → payment method → pickup → destination → ETA → queue →
     «Pieskarieties, lai pieņemtu.» The payment method must land **before** the accept
     instruction (`offer-card-props.ts:98-106` is explicit that nobody is told to tap
     before hearing whether the fare is cash).
  2. **Countdown announcements** — `ANNOUNCE_EVERY_S = 5`: every 5 s, then each of the last
     5. Count them.
  3. **The open question this pass should answer**: `a11yLabel` embeds `seconds`
     (`offer-card-props.ts:99`), so the accessible **name mutates once a second** while
     focus may be on that node — independently of the deliberate
     `announceForAccessibility` calls. Observe whether TalkBack re-announces the whole
     label on each mutation. If it does, that is the "20 announcements per card is noise"
     problem arriving by a second route, and it is a **finding to file**, not something to
     fix here.
  4. **N3** (`pr-163-review.md:183`) — is `earnings-card.tsx`'s
     `accessibilityLiveRegion="polite"` still announced inside the collapsed `Pressable`?
     Let the earnings number arrive while home is open and listen.
  5. **No double «Ieņēmumi»** — the `accessibilityHint` was removed; confirm by ear.
- **PATTERN**: the enable/restore recipe in §"The fact that unblocks the a11y half" above.
- **GOTCHA — establish the oracle BEFORE running the steps.** This task's whole result
  rests on one channel; do not discover at step 3 that the channel is dead. Three things
  were tested at planning time, `observed` 2026-09-22 on `sakta224`:
  1. **TalkBack logs utterance text only on its ERROR path.** One line carried the full
     item — `E/talkback: SpeechControllerImpl: TTS is not ready. Attempted to speak before
     TTS was initialized. Item: {utteranceId:"", fragments:[{text:TalkBack on, …}]}` — but
     after TTS initialised, four focus swipes produced **zero** `SpeechController` lines.
     So the default log is not an oracle for successful speech.
  2. **`setprop log.tag.talkback VERBOSE` does not raise it** (tried, with
     `log.tag.SpeechControllerImpl` too, and a TalkBack restart: still zero lines).
     TalkBack's `LogUtils` gates on its own preference, not `Log.isLoggable`.
  3. **That preference is set through TalkBack's own UI** — Settings → Advanced/Developer →
     log output level → VERBOSE. Its prefs file does not exist until then: at planning time
     `/data/data/com.google.android.marvin.talkback/shared_prefs/` held only `gms_icing_*`
     and `primes.xml`, no TalkBack preferences file at all. **`adb root` works on this
     image** (`restarting adbd as root`, `uid=0(root) … context=u:r:su:s0`), so once the
     file exists it can be written directly and the setting reused across runs.

  **Do this first**: set the log level through the UI, swipe focus once, and confirm
  `SpeechControllerImpl` lines with `fragments:[{text:…}]` appear. If they do, T7 is
  **machine-readable** and every claim below gets a quoted log line instead of a
  recollection — strictly better evidence, and repeatable.
- **GOTCHA — if the log route fails, the fallback is an ear, and the ear needs audio that
  reaches the host, which is UNVERIFIED.** At planning time `dumpsys media.audio_flinger`
  showed the output threads present but `Standby: yes` (nothing was playing at the sample),
  and no audio flag was passed to the emulator. **Confirm you can actually hear TalkBack
  before running the steps.** If the host is silent, the log route is not a nicety, it is
  the only oracle — and if both fail, say the leg is unrun rather than reporting from a
  channel that was never proven.
- **GOTCHA**: **restore TalkBack afterwards**, or the next run's taps go through explore-by-touch:
  `adb shell settings delete secure enabled_accessibility_services` (an empty-string `put`
  fails with `Bad arguments` — `observed`), then
  `adb shell settings put secure accessibility_enabled 0`.
- **GOTCHA**: this is TalkBack only. **VoiceOver differs on exactly these two mechanisms**
  (whether a hint is spoken, how a grouped node collapses), so a TalkBack pass does not
  transfer. #257 stays open.
- **VALIDATE**: the report records, per sub-step, what was heard in the driver's own words; the countdown announcement count is stated as `observed` with the window it was counted over; item 3's answer is yes/no with the behaviour described.
- **SATISFIES**: AC9 (TalkBack utterance leg).

### RESTORE the dev config

- **IMPLEMENT**: `UPDATE platform_config SET offer_timeout_seconds = 20;` — back to the
  seeded product value. Restore TalkBack off. Revert the `eas.json` origin edit (it was
  never committed; confirm with `git diff`).
- **GOTCHA**: 180 left in the dev row silently changes every later dispatch experiment on
  this machine, and nothing will tell you.
- **VALIDATE**: `docker compose exec -T db psql -U postgres -d taxi -c "select offer_timeout_seconds from platform_config;"` → `20`; `git status --short` shows no `eas.json`; `adb shell settings get secure accessibility_enabled` → `0`.
- **SATISFIES**: hygiene; prevents a false #15 result leaking into the next ticket.

### APPEND a §Result to the runbook and write the report

- **IMPLEMENT**: Two artifacts, different audiences.
  - **`docs/runbooks/driver-device-day.md`** — a §Result-style table for the offers pass,
    under or beside §"Also on this day", plus **the setup deltas this pass discovered** (the
    `offer_timeout_seconds` lever, the TalkBack enable/restore recipe, the `uiautomator`
    limits). This is the durable half: the next person needs the recipe, not the outcome.
  - **`.claude/reports/driver-15-offers-device-pass-report.md`** — the run: 13 functional
    rows + the a11y legs, each with its artifact, every divergence, every finding filed.
- **PATTERN**: the existing §Result table (`driver-device-day.md:19`) and
  `.claude/reports/emulator-gates-224-report.md`.
- **GOTCHA**: **do not restate §Level 4's steps in the runbook.** Cite them by number, as
  the emulator section already does for §Steps (`:368`).
- **GOTCHA**: figures in the report are **not** inherited from this plan. Re-derive
  anything you copy. A report that quotes a PR body's size table is stale by construction.
- **VALIDATE**: `grep -c '✅\|❌' docs/runbooks/driver-device-day.md` rises by the number of rows added; the report has no figure lacking a provenance word; `pnpm turbo run typecheck lint test build --force` green (docs-only changes, but the runbook edit sits beside code in the same commit).
- **SATISFIES**: AC8, AC10.

### CREATE the three orphaned follow-up issues

- **IMPLEMENT**: `gh issue create` for each, with the evidence that justifies it and the
  reason it is not #15's:
  1. **PIN pickup** — driver enters the rider's 4-digit PIN to unlock
     `arrived → in_progress` via `assertTransition()`. Named in #15's re-slice; **no
     schema, no endpoint, no ride flag exists** (`observed` 2026-09-22: no `pinCode` in
     `packages/shared/src/schemas/ride.ts`). Touches shared, api, driver, rider.
  2. **Blind-rider protocol** — a ride flag, an arrival prompt («get out, announce Sakta +
     rider name»), an incoming honk/announce request event. **PRD §1 and §5 name blind
     riders as unserved demand Atis raised unprompted (S5-8)**; this is a headline claim
     with no ticket.
  3. **Quote carries `distanceMeters` / `durationSeconds`** — so the offer card can show
     trip duration and €/km. The prior plan verified `fareQuoteSchema`
     (`packages/shared/src/schemas/ride.ts:28-39`) carries neither, and that
     `driver-ux-evidence.md:26`'s "all fields are already in Sakta's data model" is **wrong**
     for these. Pricing slice + persisted quote + card.

  Also check whether **rider identity on the driver ride read** (PR #154's fourth promised
  follow-up) has a home; file it if not.
- **GOTCHA**: `gh issue create` bodies go via `--body-file` from the scratchpad — the
  PreToolUse hook matches command **text**, and an inline body discussing env vars is
  blocked outright.
- **GOTCHA**: keep closing keywords away from `#N` — a stray "Closes #15" in a body closes
  it. Write "part of #15's deferred scope", not "closes".
- **VALIDATE**: `gh issue list --state open --limit 300 --json number,title -q '.[] | select(.title|test("(?i)pin|blind|distance"))'` returns the new numbers; each new issue body cites the file:line evidence above.
- **SATISFIES**: AC11.

### DECIDE #15 — close it, or state exactly what blocks it

- **IMPLEMENT**: If AC1–AC9 are met (AC9 in its TalkBack half, with #257 carrying
  VoiceOver), close #15 with a comment linking the report, the runbook §Result, and #257.
  If any functional step failed, **do not close** — comment with the failing step, the
  issue it was filed as, and what remains.
- **GOTCHA**: #15 is an epic child. Tick its box in #1's task list in the same pass, or the
  epic misreports.
- **GOTCHA**: this loop ends at a green, ready PR — **Linards merges.** Issue close is
  allowed; PR merge is not.
- **VALIDATE**: `gh issue view 15 --json state` reflects the decision; `gh issue view 1 --json body | grep '#15'` shows the box matching.
- **SATISFIES**: AC12.

---

## TESTING STRATEGY

This ticket's "tests" are the pass itself — there is no new shipped source to unit-test.
What the automated suites owe here is **regression protection only**: they must stay green
across T2/T9's docs edits and any fix a failing step triggers.

### Unit Tests

None added. The slices' existing suites already pin the logic this pass exercises at the
device level — `offer-card-props.test.ts` (198 lines) covers the composed `a11yLabel`,
`offer-state.test.ts` (351) the countdown reducer, `active-ride-state.test.ts` the step
machine, `earnings-screen.test.tsx` the three earnings states. **Do not add a test that
duplicates a device step**; the device step exists precisely because the unit test cannot
see it.

### Integration Tests

None added. If a step of the pass fails, its fix ships in its own loop with the regression
test that pins it — and that test must **reproduce the device failure**, not the unit-level
approximation of it. Name the file and the case in the issue you file.

### Edge Cases

Every one names where it is verified. Three of these land in a surface with no test
framework (a rendered screen), and they are assigned manual steps by number rather than
left to nobody:

| Edge case | Verified where |
|---|---|
| Offer expires untouched; the cascade continues | T5, §Level 4 step 3 first half (at 20 s, **not** under T1's raise) |
| Accept on an already-taken offer → recoverable banner | `offer-state.test.ts` (`revoked_taken`) + T5 step 3 if it arises naturally |
| Force-assign opens the ride with **no** card first | T5, §Level 4 step 7 |
| Reassignment mid-`arriving` → banner + home | T5, §Level 4 step 8 |
| Cold start mid-ride lands on `/active-ride` | T5, §Level 4 step 11 |
| Payment method changed between card and acceptance | T5, §Level 4 step 13 (needs the rider app on a second runtime — if unavailable, say so and leave AC4 partial) |
| Glance mode above 10 km/h | T5 step 9, via the test-provider `speed` — closes the threshold, **not** legibility at speed |
| Earnings link accessible name, loading state | T6 case 1 |
| Earnings link accessible name, failed first load | T6 case 2 — **needs route-selective fault injection**; unreachable by stopping the api (the `GateScreen` blocks on `useMe` first) |
| Live region announced inside a collapsed `Pressable` (N3) | T7 item 4 |
| Accessible name mutating once a second on the offer card | T7 item 3 — **an open question, answered by this pass** |
| VoiceOver, all of the above | **#257** — not verified here, not written off |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm turbo run lint --force
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/driver test
```

### Level 3: Integration Tests

```bash
pnpm turbo run typecheck lint test build --force   # the gate (CI parity)
```

Redis-gated suites are opt-in: without `REDIS_TEST_URL` a green run is 39 tests short
across 4 gated spec files, 2 of which report as skipped suites. Set it to match your
`REDIS_PORT` (6381 on this machine). Run the gate **before or after** the pass, never
during — global-setup drops the shared test DB, and one gate at a time across sessions.

### Level 4: Manual Validation

**This ticket is Level 4.** The steps are T5, T6 and T7 above; the run sheet is
`.claude/plans/driver-offers-active-ride.md:506` §Level 4, steps 1–13.

Every step is performable with what this plan ships:

| Step needs | Produced by |
|---|---|
| A driver account, online, streaming | T4 (`provision:dispatcher` + OTP from the api console's stub SMS) |
| A ride to offer | T4's `POST /dispatch/bookings` with explicit coordinates (the console form cannot geocode without `GOOGLE_MAPS_API_KEY`) |
| An offer window an `adb` tap can win | **T1** — the `offer_timeout_seconds` raise |
| An offer that expires untouched | the seeded 20 s, before T1 or after T8 |
| A second driver for the queue line | AVD `sakta141` (exists) — or declare AC5 partial |
| Motion above 10 km/h | the test-provider recipe, `driver-device-day.md:434` |
| TalkBack | already on the image — `observed` 2026-09-22 |
| The accessible name, machine-readable | `uiautomator dump` → `content-desc`, static screens only |
| A running app | **T3** — an EAS `preview` APK built with `EXPO_PUBLIC_API_URL=http://10.0.2.2:3001` |

### Level 5: Additional Validation

`adb exec-out screencap -p > shot.png` for every visual claim; `adb logcat -d` for crash
absence. Both into the scratchpad, cited by path from the report.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1** §Level 4 steps 1–13 are each recorded ✅ or ❌ with a citable artifact. A ❌ is an acceptable outcome **only** if it is filed as an issue with a reproduction.
- [ ] **AC2** *(expected)* Accept within the countdown lands the active-ride screen at `accepted`, with the payment pill and the «Arriving» button — `observed` on device under T1's window.
- [ ] **AC3** *(edge)* An untouched offer expires at 0, the card clears, the banner shows, and the api logs `dispatch.offer.expired` — run at the seeded 20 s.
- [ ] **AC4** *(failure)* A stale or cancelled offer/ride surfaces a recoverable banner and never a crash — reached via step 8's reassignment, step 13's payment change, or a deliberate 409.
- [ ] **AC5** The card shows fare, «you keep €X (85%)», pickup + destination, ETA + km, payment method, countdown, and the queue line when a second driver is in the zone. **Partial is acceptable if the second AVD is not run — say which half.**
- [ ] **AC6** The active ride walks `arriving → arrived → start → complete`; the board mirrors each status; the maps hand-off opens Google Maps at the pickup, then the destination from `arrived`.
- [ ] **AC7** The receipt's `total → commission (pct) → net` matches the ride's `split` row **to the cent**, with `commission + net === total`, and today's earnings total includes the ride.
- [ ] **AC8** `driver-device-day.md:362` names #15, and the runbook carries the pass's §Result plus the setup deltas (the config lever, the TalkBack recipe, the `uiautomator` limits).
- [ ] **AC9** The owed ear-checks are closed **per leg, with the leg named**:
  - TalkBack, accessible **name**, earnings link → `content-desc` via `uiautomator dump` (T6). **Loading and ready states ✅; the failed-first-load state is ✅ only if a route-selective fault was injected** — otherwise it reads "unrun, mechanism inferred", never ✅. Closes the name; does not close speech order or interruption.
  - TalkBack, **spoken**, offer card + N3's live region + the no-double-«Ieņēmumi» check → T7, quoting `SpeechControllerImpl` log lines. If neither the log nor host audio worked, the leg is **unrun** and says so.
  - **VoiceOver → #257.** Owed, not written off: no Tahoe on iMac19,1 → Xcode 26.3 ceiling → SDK 57 does not compile (`observed` 2026-08-25), no Apple ID, no paid programme.
- [ ] **AC10** `.claude/reports/driver-15-offers-device-pass-report.md` exists, and **no figure in it lacks `observed` / `derived` / `expected`**.
- [ ] **AC11** PIN pickup, the blind-rider protocol and the quote's `distanceMeters`/`durationSeconds` each have an open issue; the plan's Non-Goals cite the numbers.
- [ ] **AC12** `offer_timeout_seconds` is back to 20, TalkBack is off, `eas.json` is unmodified in git, and `pnpm turbo run typecheck lint test build --force` is green.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full gate green (`typecheck lint test build --force`), run outside the pass window
- [ ] No linting or type checking errors
- [ ] The device pass is recorded with artifacts, not tick-marks
- [ ] Acceptance criteria all met, or the unmet ones named with their owning issue
- [ ] Dev config and emulator restored

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Q1 — Is the second AVD worth booting for step 12?** `sakta141` exists. Two emulators on
  an Intel iMac with 5.9 GiB of SDK and swiftshader rendering may not both stay responsive.
  **Assumption**: run one, declare AC5's queue half partial, and note what it costs. If two
  boot cleanly, run it. *This changes only AC5's scope.*
- **Q2 — RESOLVED into T4.** Step 13 needs the payment method switched while the driver's
  card is up. The rider app has no emulator route recorded, so the switch is driven by a
  **rider bearer token** (third phone number, OTP read from the api console's stub SMS),
  not by a second app. That closes the server-side change and the driver app's one-time
  banner; it does **not** close the rider's own UI, which is #17's ground and not owed
  here. Log it as a divergence.
- **Q3 — Which order for the expiry and accept legs?** Both are step 3. **Assumption**:
  expiry first at the seeded 20, then T1's raise, then accept — so the raise is live for
  the shortest span and the expiry leg is measured against the product value. State the
  order used.
- **Q4 — What if a functional step fails?** **Assumption**: file and continue; the fix is
  its own loop. A pass that stops at the first ❌ tells you about one step and nothing about
  twelve. *Timing worst case, not typical*: a failure at step 3 would otherwise leave
  steps 4–13 unrun and #15 no closer than before.
- **Q5 — Does the a11y name mutating once a second cause TalkBack to re-announce?** Unknown
  at planning time, and it is the one genuinely new thing this pass can learn
  (`offer-card-props.ts:99` embeds `seconds` in the label; `offer-card.tsx:56-66`
  separately throttles announcements to every 5 s + the last 5). **Worst case**: TalkBack
  re-reads the whole seven-segment label 20 times per card, which is precisely the noise
  the throttle was written to prevent — a blind driver would hear the fare and both
  addresses repeated on every tick. Answer it in T7, file it if positive; **do not fix it
  here.**
- **A1 — `platform_config` is uncached.** Read off `platform-config.repository.ts`: a bare
  `select().limit(1)` with no memo. If a cache is added between planning and execution,
  T1 needs an api restart and its VALIDATE step will catch it (the card's first frame
  would still read 20).
- **A2 — The existing APK cannot be reused.** `packages/shared` moved after the last driver
  build. T3 rebuilds. Budget ~20 minutes and one failure.

---

## NOTES (open canvas)

### Why this is a validation ticket and not a build ticket

The temptation is to read #15's re-slice section — PIN pickup, blind-rider protocol,
queue transparency, €/km, rider rating — and plan those. Don't. Every one of them was
explicitly ruled out of #15's implementation by the plan that shipped it, with a reason
per item (`driver-offers-active-ride.md` §Out of Scope), and **the code that #15 does
own is merged.** The ticket's own PR says what keeps it open: the device day.

The real defect is not missing features. It is that the ticket's success condition — does
the offer card work in a driver's hands — has never been executed once, and the two things
stopping it are both recorded in a runbook as curiosities rather than as blockers with
owners.

### The oracle table

The point of T6/T7's split is to stop saying "blocked on hardware" about things that are
not. Property first, instrument second:

| Property owed | Cheapest oracle | Closes | Does not close |
|---|---|---|---|
| The earnings link's accessible **name**, 3 states | `uiautomator dump` → `content-desc` | the exact string, and that the grouping collapses to one node | speech order, interruption, whether a hint is appended |
| The offer card's **label content** | `offer-card-props.test.ts` (already green) | the composition | that the platform speaks it |
| The offer card **spoken** | TalkBack's `SpeechControllerImpl` log at VERBOSE (one UI trip to enable); an ear only if that fails | what Android says, in what order, quotably | VoiceOver, which differs on exactly this |
| N3's live region inside a collapsed `Pressable` | same log | Android's behaviour | iOS's |
| No double «Ieņēmumi» | same log | Android | iOS |
| All of the above on **VoiceOver** | none available here | — | **#257** |

`content-desc` is the honest machine oracle because it *is* the
`AccessibilityNodeInfo.contentDescription` that React Native's `accessibilityLabel` sets
and TalkBack reads first. It is not a proxy for the label — it is the label, after the
platform has applied the grouping rules that F4 and F20 both turn on. What it cannot tell
you is anything about *speech*: order, interruption, rate, or whether a hint is appended.
Hence two tasks, not one.

### Why `uiautomator dump` cannot be made to work on the offer card

Not flakiness, and not fixable by retrying. `UiAutomation.waitForIdle` needs a quiet window,
and the card has two independent continuous sources:

- `FLASH_HALF_PERIOD_MS = 500` — a `setInterval` toggling `flashOn`, which drives the card's
  background colour (`offer-card.tsx:15, 45-53`). Runs until `card.accepting`.
- The countdown `Text` at `offer-card.tsx:113`, re-rendered every second.

Raising `offer_timeout_seconds` lengthens the window but does not quiet it — the flash is
independent of the timeout entirely. So the offer card is `screencap`-and-ear territory by
construction, and that is worth writing into the runbook rather than rediscovering.

### What the emulator genuinely cannot answer

Say these in the report rather than letting a ✅ imply them:

- **The 44 px touch-target rule.** `input tap` hits exact centres. Only a finger tests it.
- **Whether a driver can win a 20 s countdown.** T1 raises the window precisely because the
  agent cannot. A human on a phone is not subject to the 4 s round trip, so this is a
  harness limit, not a product finding — but it is also therefore *unverified*.
- **Legibility at speed.** Step 9 verifies the threshold fires, not that the collapsed card
  is readable from a driver's seat at 50 km/h.
- **Audio in a car.** The tone's audibility over road noise is a road test.
- **VoiceOver.** #257.

### Sequencing risk

Phase 2 and Phase 3 share one emulator and one APK but nothing else. If the stack fights
back (a shared-test-DB collision, a colima death, a 20-minute EAS failure), run Phase 3
first: it needs only the app, the home screen and TalkBack, and it closes the half of #15
that has been owed longest. Phase 2 without Phase 3 leaves the ear-checks owed for a fourth
month; Phase 3 without Phase 2 still closes something real.

### Concurrency

Check `git reflog -8` before any branch move — this checkout is shared. At planning time it
sat on `feature/skip-rider-sms-app-bookings-135`. **Work in a `git worktree`**, and run
anything DB-touching there with `COMPOSE_PROJECT_NAME=taxi`, or compose starts a second
Postgres against the occupied 5432. Copy `.env` into the worktree first: without it a
`REDIS_TEST_URL` gate hangs silently on a dead 6381 with the output buffered.

---

## AMENDMENTS

<!-- newest at the bottom -->
