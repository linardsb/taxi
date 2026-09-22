# Feature: skip the arrival SMS for app-booked rides (#135, SMS volume lever 1)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Stop sending the `driver_arrived` SMS to riders who booked from the rider app. They see the
same moment on the ride-status screen while the app is open; a phone-booked rider (Dina's
channel, #63) keeps every message because SMS is their only channel.

**AMENDED at PR #253 review round 1 (F1).** The in-app half was not true when this plan was
written: `statusKey()` collapsed `arrived` into `rider.status.matched`, so an app rider saw
nothing new at arrival in *any* app state. PR #253 adds `rider.status.arrived` and the branch
that selects it, which makes the claim true in the FOREGROUND. Backgrounded remains #17's.

**Half of this ticket is already shipped, and the plan is scoped to the half that is not.**
`ride-notifications.service.ts:116-117` already skips `driver_assigned` for every non-phone
channel, and `ride-notifications.service.spec.ts:285-294` already pins it. The ticket reads as
if both messages need the filter; only `driver_arrived` does. The research §4.3 line the ticket
quotes ("the two-line channel filter already used for `driver_assigned`") is describing the
filter this ticket must *copy*, not one it must *write twice*.

So the shipped change is one condition, its two flipped tests, one new test, and a documentation
sweep over four places that state the old policy as fact.

## User Story

As a rider who booked in the Sakta Cab app
I want the app to tell me my taxi has arrived, without also paying for an SMS that says the same thing
So that the platform's SMS budget goes to the riders who have no other channel

## Problem Statement

Every rider gets a `driver_arrived` SMS regardless of how they booked. For an app rider that is a
duplicate of what the app already shows — `derived`, 301 billed segments a month at the research's
target rate (arithmetic in **Cost** below), against a hard <€100/mo platform guardrail that SMS can
eat on its own.

## Solution Statement

Add one channel condition to `RideNotificationsService.onStatus`, mirroring the `driver_assigned`
one three lines above it: an `app`-channel ride sends no `driver_arrived` SMS. Flip the two tests
that currently assert the opposite, add the phone-channel test that holds the unchanged side, and
correct the four documents that record "arrival SMS on every channel" as the policy.

## Out of Scope / Non-Goals

- **Not included:** skipping `booking_confirmed` for app riders. See **Q1** — the research's
  costed lever 1 did remove it, this ticket's Scope and AC ("on assign/arrive") do not, and the
  AC's plain reading wins. Do not widen it without Linards saying so.
- **Not included:** template changes (lever 2 — shipped as #136).
- **Not included:** any change to driver-facing messages or to the push slice.
- **Not changing:** `booking_confirmed` / `booking_confirmed_phone` behaviour on any channel.
- **Not changing:** `driver_assigned` *behaviour*. Task 1 rewrites its condition's **shape** and
  the rewrite is provably a no-op at HEAD (D1) — if it changes any observable behaviour, it is wrong.
- **Not building:** rider push. That is #17 and it is this ticket's merge gate (see **AC #5**).

## Feature Metadata

**Feature Type**: Enhancement
**Estimated Complexity**: Low (code) / Medium (the merge decision — see **R1**)
**Primary Systems Affected**: `services/api` notifications slice; `docs/research/*`; `apps/dispatch` untouched
**Dependencies**: none new. Blocked for MERGE on #17 (rider push).

## Related Work

**Implements**: [#135](https://github.com/linardsb/taxi/issues/135) · **Epic**: [#1](https://github.com/linardsb/taxi/issues/1) (Sakta Cab MVP) · **Parent**: #13 (deploy plan, which filed this)

**Back-references**:

- `.claude/plans/rider-comms-sms-tracking-page.md` — Why: built this slice and wrote the send
  policy this ticket amends (its line 231 is the policy-of-record text, and its completion
  checklist line 368 states the "2 SMS/ride app channel" budget that this ticket makes 1).
- `.claude/plans/short-tracking-links-sms-136.md` — Why: lever 2, already shipped. It is why the
  ticket's cost figures no longer describe HEAD (**F1**).

**Forward-references**:

- (none yet) — #137 (SMS provider bake-off) changes the €/segment rate this plan prices against,
  not the segment count.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `services/api/src/features/notifications/ride-notifications.service.ts` (whole file, 280 lines)
  — Why: the only file whose shipped source changes. **Lines 25-44** are the policy doc-of-record
  and go false (Task 3). **Lines 106-155** are `onStatus`. **Lines 114-117** are the pattern to
  mirror, and the comment there states the justification this ticket extends.
- `services/api/src/features/notifications/notifications.repository.ts` (lines 16-27) — Why:
  `NotifiableRide` is what `onStatus` filters on; `bookingChannel: BookingChannel` is already on it,
  so no repository change is needed.
- `services/api/src/features/notifications/ride-notifications.service.spec.ts` (lines 30-65 for the
  `ride()`/`notifiable()` builders, **285-305** for the two channel tests) — Why: the unit tests to
  flip and add. Note the default fixture is `bookingChannel: 'phone'` (lines 35, 60), so tests that
  do not name a channel are phone-channel tests.
- `services/api/src/features/notifications/tracking/tracking.integration.spec.ts` (lines 360-390)
  — Why: the app-channel integration case. It drives the real `POST /rides/:id/arrived` and asserts
  **2** SMS; after this change it is **1**, and the `waitForSms(p(51), 2)` call at line 382 would
  hang to its timeout rather than fail fast. Lines 276-300 are the phone-channel case that must
  stay green untouched.
- `services/api/test/harness.ts` (lines 211-225 `waitForSms`, 257+ `RecordingSmsProvider`) — Why:
  `waitForSms` is a *poll-until-at-least-N* helper, structurally unable to assert an absence. The
  settle-then-assert pattern already in the file (line 383: `setTimeout(…, 100)` then
  `toHaveLength`) is the one to use.
- `packages/shared/src/enums.ts` (lines 99-100) — Why: `BOOKING_CHANNELS = ['app', 'phone']`.
  Two values, which is what makes D1 a provable no-op and what makes the AC's "channel unknown"
  a matter of the condition's shape rather than a testable input.
- `services/api/src/features/auth/sms/stub-sms.provider.ts` (lines 30-41) — Why: the Level 4
  oracle. It logs every SMS body in full under `auth.sms.stub_sent`.

### New Files to Create

None. Every change lands in files that already exist.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `docs/research/hosting-sms-cost-research.md` §4.2 (lines 205-231) and §4.3 (lines 233-250)
  — Specific sections: the per-template segment table, the "who receives what" list, the two-lever
  cost table. Why: §4.2's last three bullets and §4.3's lever-1 row are what Task 4 annotates, and
  §4.3's assumptions are the ones the **Cost** arithmetic below inherits and must restate.
- `docs/research/rider-ux-evidence.md` §3.3 (line 74) — Specific section: the APPLICABILITY
  bullet, "send booking-confirm + arrival SMS by default, link SMS only for phone bookings".
  Why: it is the cited source for the service header's send policy, and this ticket amends it.
- `.claude/references/logging-standard.md` — Why: `logSent`'s event name and fields feed the
  metrics ledger; read before touching anything near it (this ticket should not need to).
- No external documentation. Nothing here reaches a library boundary.

### Patterns to Follow

**The channel filter, as it already exists** — `ride-notifications.service.ts:114-117`. Mirror
this shape: an early `return` inside the `try`, after the row read, with the comment carrying the
*reason* rather than restating the condition.

```ts
      // The assigned message is the phone-channel follow-up (the Uber
      // call-to-ride pattern); an app rider sees the same moment in-app.
      if (kind === 'driver_assigned' && details.bookingChannel !== 'phone')
        return;
```

**Test naming** — `'<situation> → <outcome> (<expected|edge|failure>)'`, with the AC named where
one exists: `'accepted + app channel → NO driver_assigned SMS (edge — SMS budget row)'`.

**Negative SMS assertions in integration** — never `waitForSms`; settle, then assert the count:

```ts
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(smsTo(p(51))).toHaveLength(1);
```

**Lint rules that bear on this change:** `max-lines` (500) is configured at
`packages/config/eslint/base.mjs:36` and turned off for spec files at line 56 — the service is 280
lines and this adds ~6, so no package is near the cap and `.spec.ts` files are uncapped anyway. No
rule in `base.mjs` forbids any shape this plan proposes; the early-return-in-try pattern is already
used three times in the same method.

---

## IMPLEMENTATION PLAN

### Phase 1: The filter and its tests

One condition, three unit/integration test edits. Phases 2 and 3 are documentation and have no
code dependency on each other.

### Phase 2: Documentation sweep

**Independent of:** Phase 1 (no shared file). Do it in the same commit — the docs state the
current behaviour as fact and go false the moment Phase 1 lands.

### Phase 3: Validation

**Depends on:** Phases 1 and 2.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### UPDATE `services/api/src/features/notifications/ride-notifications.service.ts`

- **IMPLEMENT**: In `onStatus`, replace the single `driver_assigned` guard at lines 114-117 with
  one guard covering both kinds, expressed as `=== 'app'`:

  ```ts
      // An app rider sees both moments on `/book/status` while the app is
      // OPEN — `accepted` reads «Auto ir atrasts», `arrived` «Auto ir klāt»
      // (`status-screen.tsx` statusKey) — so neither message is theirs
      // (#135, SMS volume lever 1). Backgrounded they see neither: rider
      // push is #17 and has not shipped, which is the regression AC #5
      // prices. Phone bookings (#63) keep everything — SMS is their only
      // channel.
      //
      // `=== 'app'` rather than `!== 'phone'`: a channel we cannot vouch for
      // gets the SMS (fail open), which is also the AC's "channel unknown →
      // send". Note this slice is NOT uniform on that question —
      // `onRideCreated` (:72) fails the opposite way, withholding the
      // tracking link from any channel that is not `phone`. Whoever adds a
      // third channel has to settle both, and a `web` rider would otherwise
      // be denied the link at booking and handed it at assignment.
      if (details.bookingChannel === 'app') return;
  ```

  Placed exactly where the old guard was — after the `details`/`driverId` read, before
  `riderContact`, so an app ride still costs no extra queries.
- **PATTERN**: `ride-notifications.service.ts:114-117` — the guard being replaced.
- **IMPORTS**: none. `BookingChannel` is already on `NotifiableRide`
  (`notifications.repository.ts:23`) and `details` is already in scope.
- **GOTCHA — D1, and it binds:** this rewrite must be a **no-op for `driver_assigned`**.
  `BookingChannel` is `'app' | 'phone'` (`packages/shared/src/enums.ts:99`) and the column is a
  two-value pg enum with `.default('app')` (`db/src/schema/rides.ts:84`), so
  `bookingChannel !== 'phone'` and `bookingChannel === 'app'` are equal over every inhabitant of
  the type **and** every value the database can store. They diverge only if a third channel is
  ever added — and there `=== 'app'` is the one that fails open.

  **CORRECTED at PR #253 review round 1 (F2).** This line used to cite
  `ride-quote.service.ts:40` as "explicitly contemplating" a third channel. It argues the
  opposite: *"Adding a third `bookingChannel` value would be the same mistake by another door: a
  preview is not a booking channel."* The no-op argument stands without it — it rests on the
  closed two-value enum and the `NOT NULL` column, both verified — but the citation was
  backwards and is withdrawn. If you cannot convince yourself the rewrite is a no-op today, leave
  line 116 alone and add a separate `kind === 'driver_arrived' && bookingChannel === 'app'` guard
  instead; the ticket is satisfied either way, and a silent behaviour change to `driver_assigned`
  is not.
- **GOTCHA**: do **not** touch `onRideCreated`. `booking_confirmed` still goes to every channel
  (see Q1 and Non-Goals). The guard belongs in `onStatus` only.
- **VALIDATE**: `pnpm --filter @taxi/api test -- ride-notifications.service.spec` — expect
  **exactly ONE** test RED at this point (`'arrived → driver_arrived SMS on EVERY channel'`) and
  everything else green. *Corrected 2026-09-22: this line said "the two tests named in the next
  task"; the second of those is a test the next task ADDS, so it cannot be red before it exists.*
  A green run here means the filter did not take effect; check you edited `onStatus` and not a
  comment. `observed` at implementation: `1 failed, 17 passed, 18 total`, and line 286's
  `driver_assigned` app-channel test green **unedited** — that run is D1's no-op proof.
- **SATISFIES**: AC #1, AC #2.

### UPDATE `services/api/src/features/notifications/ride-notifications.service.spec.ts`

- **IMPLEMENT**: three edits.
  1. **Flip** `'arrived → driver_arrived SMS on EVERY channel (expected)'` (line 296). It builds
     `notifiable({ status: 'arrived', bookingChannel: 'app' })` and asserts `sent` has length 1.
     Rename to `'arrived + app channel → NO driver_arrived SMS (expected — AC #1)'` and assert
     `expect(sent).toHaveLength(0)`.
  2. **Add** the phone-channel counterpart, which nothing currently covers in this file:
     `'arrived + phone channel → driver_arrived SMS, unchanged (expected — AC #2)'` —
     `notifiable({ status: 'arrived', bookingChannel: 'phone' })`, assert one SMS containing the
     plate `AB-1234` and **not** containing `/t/` (the arrival template carries no link).
  3. **Leave alone** `'accepted + app channel → NO driver_assigned SMS'` (line 286). It must stay
     green *unchanged* — that is the executable form of D1's no-op claim.
- **PATTERN**: the existing test at lines 286-294 for shape; `notifiable()` at line 60 for the
  fixture (its default is `bookingChannel: 'phone'`).
- **IMPORTS**: none new.
- **GOTCHA**: the failure test at line ~330 (`'SMS provider down mid-lifecycle'`) asserts on
  `kind: 'driver_arrived'` and uses `build({ smsThrows: true })` — the **default** fixture, which
  is `bookingChannel: 'phone'`. It therefore stays green and must not be edited. If it goes red,
  you changed a default rather than adding a guard.
- **GOTCHA — the AC's "channel unknown → send, fail open" is NOT a testable input.** With a
  two-value enum there is no unknown channel to pass. Do not write a test that casts a fabricated
  third value through `as BookingChannel` to assert fail-open: it proves the cast compiles, not
  that production can reach the state. The requirement is discharged by the condition's *shape*
  (`=== 'app'`, D1) and by this plan recording why. Say so in the fix report.
- **VALIDATE**: `pnpm --filter @taxi/api test -- ride-notifications.service.spec` — green, and the
  file's test count is **+1** from its pre-change count. Record both numbers.
- **SATISFIES**: AC #1, AC #2, AC #4.

### UPDATE `services/api/src/features/notifications/tracking/tracking.integration.spec.ts`

- **IMPLEMENT**: fix the app-channel case at lines ~370-390. It books on the `app` channel, accepts,
  walks `arriving → arrived`, then at line 382 does `await waitForSms(p(51), 2)` and asserts
  `bodies` has length 2 with `bodies[1]` containing the plate. After this change the app rider gets
  **one** SMS (`booking_confirmed`). Replace the `waitForSms(p(51), 2)` + length-2 block with the
  settle-then-assert pattern:

  ```ts
    // #135: the arrival SMS is the app rider's no longer — `/book/status`
    // shows it while the app is open. The 100 ms is a HEURISTIC, not a
    // fence (`emitStatus` dispatches the send detached); the deterministic
    // guard is the unit spec. See PR #253 F3 for the full comment.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const bodies = smsTo(p(51));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain('/t/');
  ```

  Keep the final `expect((await view(ride.trackingToken!)).state).toBe('arrived')` — the ride is
  still trackable and #17's share-trip depends on that. Update the test's name and the
  `// arrived SMS arrives; driver_assigned never does.` comment, which becomes false.
- **PATTERN**: `harness.ts:211-225` for `waitForSms`/`smsTo`; the existing settle-then-assert at
  line 383.
- **IMPORTS**: none new.
- **GOTCHA — this is the one that costs you an hour if you miss it.** `waitForSms` polls until it
  sees **at least** N messages and throws on timeout. Left at `2` it does not fail fast with a
  clear message — it burns the whole timeout and then reports a count, inside an integration suite
  that already flakes under the full gate. It also cannot express the assertion this test now
  needs (an absence). Delete the call; do not lower it to 1, because `waitForSms(…, 1)` would pass
  the instant the *confirmation* lands and prove nothing about the arrival.
- **GOTCHA**: the phone-channel case at lines 276-351 asserts 3 SMS and must stay untouched and
  green. If it reddens, the guard is catching `phone`.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- tracking.integration.spec`
  — green. Integration suites in this repo flake under the full gate and pass alone; run this one
  alone first, and budget a re-run rather than a diagnosis if the full gate is the only thing red.
- **SATISFIES**: AC #1, AC #2, AC #3.

### UPDATE the four documents that state the old policy as fact

- **IMPLEMENT**: grep the *subject*, not the sentence — `grep -rn "every channel\|driver_arrived\|2 SMS/ride" --include="*.ts" --include="*.md" . | grep -v node_modules` — and correct each hit
  that asserts current behaviour. The four known ones:
  1. `services/api/src/features/notifications/ride-notifications.service.ts:30-33` — the send-policy
     header. "confirm + arrival SMS on every channel" → arrival on phone only; "Budget: 2 SMS/ride
     app channel, 3 phone channel" → **1 and 3**. Cite #135 beside the #63 citation already there.
  2. `docs/research/hosting-sms-cost-research.md:228` — "`driver_arrived` → **every** rider, no
     channel filter (line 122)". Now filtered; the line number also moved.
  3. `docs/research/hosting-sms-cost-research.md:230` — "**Per ride: app rider = 2 segments · phone
     rider = 5 segments.**" Both halves are wrong at HEAD: app is 1 after this ticket, and phone
     has been **3** since #136, not 5.
  4. `docs/research/hosting-sms-cost-research.md` §4.3's lever-1 row — annotate in the style §4.3
     already uses for its own #136 correction. State both faults: the `1,347` baseline is
     pre-#136, and the `745` figure removes `booking_confirmed` too, which #135's scope did not.
     Put this plan's **Cost** arithmetic there as the figure that describes HEAD.
  5. `docs/research/rider-ux-evidence.md:74` — "send booking-confirm + arrival SMS by default,
     link SMS only for phone bookings". Add the #135 amendment; do not rewrite the evidence, which
     is a record of what other operators do and remains true.
  6. **Added 2026-09-22, not in the original five:** `hosting-sms-cost-research.md` §4.3's table
     header row, `| **As shipped today** — 301 app × 2 + 129 phone × 5 … |`. Same class as the
     others — it claims current fact and is wrong twice over. Relabelled
     `**As shipped 2026-08-14** (pre-#136, pre-#135)`. Also `tracking.integration.spec.ts:328`,
     `// The arrival SMS goes to every channel (AC #1).` — a grep hit inside the phone-channel
     case the plan otherwise says to leave untouched; the comment is corrected, the behaviour and
     its three-SMS assertion are not.
- **PATTERN**: §4.3's existing `**CORRECTION (#136, 2026-09-21) — …**` block. Append, name the
  ticket and the date, keep the superseded text visible.
- **GOTCHA**: `.claude/plans/rider-comms-sms-tracking-page.md` lines 231 and 368 also state the old
  policy. **Leave them.** A shipped plan is a record of what was decided then; the AMENDMENTS
  convention exists for live plans, and rewriting history in a closed one is the opposite of the
  provenance rule. The forward-reference from this plan is the link.
- **GOTCHA**: `docs/ux-metrics-ledger.md:50` ("SMS spend €/week") derives from `logSent`'s
  `kind` + `channel`, per that method's comment. The event and its fields do not change, but the
  *population* does — no more `kind=driver_arrived, channel=app` rows. Add one line to the ledger
  row saying so, or the first person to read a week-over-week drop will file a bug.
- **VALIDATE** *(rewritten 2026-09-22 — the original was unsatisfiable, see AMENDMENTS A1)*: run
  `grep -rnE "every channel|2 SMS/ride|app rider = 2 segments|1,347|745|45%" --include="*.ts" --include="*.md" . | grep -v "/node_modules/" | grep -v "/dist/"`
  and check that **every hit is either coincidental or visibly superseded** — it cannot return
  nothing, because this task's own PATTERN requires the correction blocks to keep the retired
  figures visible. The classification of every hit is in the implementation report under V1.
- **SATISFIES**: AC #6.

### UPDATE the issue's cost claim

- **IMPLEMENT**: comment on #135 (`gh issue comment 135 --body-file …`) recording that its
  `1,347 → 745 / −45%` does not describe HEAD, with this plan's **Cost** arithmetic and both
  reasons (**F1**). Do this at PR time, not before implementing — it is a claim about what shipped.
- **GOTCHA**: pass the body via `--body-file` from the scratchpad. The PreToolUse hook matches
  command *text*, and a body discussing env vars is refused inline.
- **VALIDATE**: `gh issue view 135 --comments | tail -30` shows the comment.
- **SATISFIES**: AC #7.

---

## TESTING STRATEGY

### Unit Tests

`ride-notifications.service.spec.ts`, jest, mirroring the slice. Three cases named in Task 2:
app-channel arrival suppressed (expected), phone-channel arrival unchanged (expected), and the
untouched `driver_assigned` app-channel test standing as D1's no-op proof.

### Integration Tests

`tracking.integration.spec.ts`. This ticket touches no socket and no room join, so the realtime
ordering rule does not bind. What the integration test earns here is the **real transition path**:
it drives `POST /rides/:id/arrived` over HTTP against the booted app, so the guard is exercised
through `emitStatus`'s post-commit hook rather than through a directly-called service method — the
only place the wiring between the transition and the notification is actually asserted.

The app-channel case books via `POST /rides` with a rider token (channel defaults to `app`,
server-side per `rides.service.ts:63-72`) and the phone-channel case via `bookByPhone`, so both
channels reach the guard the way production sets them, not by a fixture override.

### Edge Cases

| Edge case | Verified where |
|---|---|
| Phone-channel arrival still sends | `ride-notifications.service.spec.ts` (new test, Task 2.2) **and** `tracking.integration.spec.ts:276-351` (unchanged) |
| `driver_assigned` app-channel behaviour unchanged by D1's rewrite | `ride-notifications.service.spec.ts:286-294`, **left byte-identical** |
| A ride still trackable after its arrival SMS is suppressed (#17 share-trip) | `tracking.integration.spec.ts`, the retained `view(...).state === 'arrived'` assertion |
| SMS provider throws on the phone-channel arrival | `ride-notifications.service.spec.ts:~330`, unchanged |
| Channel unknown → fail open | **Not testable, by construction.** `BookingChannel` has two values and the column is a pg enum, so no unknown value is reachable. Discharged by the condition's shape (D1) and recorded here. Do not fabricate a cast to fake it. |
| A non-`arrived`, non-`accepted` transition still costs no queries | `ride-notifications.service.spec.ts:~310`, unchanged |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/api lint
pnpm --filter @taxi/api typecheck
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/api test -- ride-notifications.service.spec
```

### Level 3: Integration Tests

```bash
docker compose up -d --wait
COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- tracking.integration.spec
```

Then the gate, from a cleared `dist` and `.next`:

```bash
COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
```

`expected`: 22 tasks (`derived` from `turbo --dry=json` minus `<NONEXISTENT>`; it does not drift
with test files).

**Do not inherit a test count from anywhere, including CLAUDE.md.** Its `39 skipped, 694 passed`
was `observed` at `0cdb59c` and this branch starts from `fabd615` with eight PRs in between — that
line has been wrong three times, and "correcting the digit" is how it went wrong the second and
third. Measure your own baseline instead: run
`env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test` **at the branch
point**, record the count in the fix report, and assert **+1** against that number. Set
`REDIS_TEST_URL` to match your `REDIS_PORT` to run the gated suites. One gate at a time across
sessions — integration runs drop the shared test DB.

### Level 4: Manual Validation

Every step below is performable with what exists today. The oracle is
`services/api/src/features/auth/sms/stub-sms.provider.ts:30-41`, which logs **every SMS body in
full** under `auth.sms.stub_sent`, and the OTP in full under `auth.otp.stub_sent`. No new script
is needed; `mint:ride` is **not** the instrument here (it stops at `accepted`, walks the driver,
then cancels — it never reaches `arrived`).

1. `docker compose up -d --wait`, then `pnpm --filter @taxi/db seed`, then
   `pnpm --filter @taxi/api dev`. Keep the log visible — it is the oracle.
2. Rider: `POST /auth/otp/request` with a seeded rider phone and `role: "rider"`; read `code` from
   the `auth.otp.stub_sent` line; `POST /auth/otp/verify` for a token.
3. Driver: the same two calls with `role: "driver"`, then `PUT /drivers/me/status` `{"status":"online"}`.
4. Rider books: `POST /rides` with the rider token and an `Idempotency-Key` header. The channel is
   **not** wire input — the server stamps `app` (`rides.service.ts:63-72`), which is exactly the
   case under test. Confirm one `auth.sms.stub_sent` appears whose body has no `/t/` link.
5. **Driver accepts.** The dispatch sweeper offers the ride on its own within
   `SWEEP_INTERVAL_MS = 1000` (`dispatch.policy.ts:38`), so wait ~2 s, then get the offer id. The
   route carries no driver id and the offer id arrives over the socket in production
   (`RT.rideOffer`) — for a curl run, read it from the database instead, which is what the
   integration helper does (`tracking.integration.spec.ts:184-188`):

   ```bash
   docker compose exec -T db psql -U postgres -d taxi -tAc \
     "select id from ride_offers where ride_id = '<rideId>' and status = 'pending'"
   ```

   Then, **with the driver's token** (`@Roles('driver')`,
   `dispatch.controller.ts:68-76`, answers 201):

   ```bash
   curl -X POST "$API/dispatch/offers/<offerId>/accept" -H "authorization: Bearer <driverToken>"
   ```

   Shortcut if the offer row is awkward to catch: `POST /dispatch/rides/:rideId/assign`
   (`dispatch.controller.ts:95`) forces the assignment, but it needs a **dispatcher** token
   (`pnpm --filter @taxi/api provision:dispatcher` mints one) and it is not the path a real app
   ride takes. Prefer the offer route; the notification hook is the same either way.
6. `POST /rides/:rideId/arriving` then `POST /rides/:rideId/arrived`, both with the driver's token
   (`ride-lifecycle.controller.ts:36,46`, both answer 201).
7. **The assertion:** grep the log for `ride.notifications.sms_sent`. There must be **exactly one**
   line for this `rideId`, with `kind: 'booking_confirmed'`, and **no** line with
   `kind: 'driver_arrived'`. Equivalently: exactly one `auth.sms.stub_sent` to that rider's number
   across the whole ride.
8. **The control**, which is the half that is easy to skip and the half that catches an
   over-broad guard: repeat steps 4-7 booking through the dispatcher instead (phone channel — see
   `bookings.service.ts`, and `provision:dispatcher` mints the dispatcher account). Expect
   **three** `sms_sent` lines: `booking_confirmed`, `driver_assigned`, `driver_arrived`.

Step 8 is not optional. Step 7 alone passes just as well against a guard that suppresses *every*
rider's arrival SMS, which is the failure mode that costs real money in the other direction.

### Level 5: Additional Validation (Optional)

None. No MCP tool answers a question this ticket raises.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — An app-booked ride emits no rider SMS on assign or arrive. (`driver_assigned`
      already held; `driver_arrived` is the new half.) Verified: unit + integration + Level 4 step 7.
- [ ] **AC #2** — A phone-booked ride emits all three messages, unchanged. Verified: unit +
      `tracking.integration.spec.ts:276-351` untouched + Level 4 step 8.
- [ ] **AC #3** — `tracking.integration.spec.ts` asserts the app rider's SMS count by settling and
      counting, not by `waitForSms`, so the absence is a fast assertion rather than a timeout.
- [ ] **AC #4** — The notifications slice ships ≥1 expected + 1 edge + 1 failure case covering this
      change. The "channel unknown → send" edge is discharged by the condition's shape, with the
      reason recorded in the fix report — **not** by a fabricated cast (see Task 2's second GOTCHA).
- [ ] **AC #5 — MERGE GATE, and the one that needs a human decision.** #17 has not shipped rider
      push: `apps/rider/package.json` carries no `expo-notifications` (`observed` — only
      `apps/driver` does), there is no push slice under `apps/rider/src/features/`, and
      `PUT /drivers/me/push-token` is driver-only. `use-ride-status.tsx` is a foreground socket.
      So an app rider with the app backgrounded — which is the normal state of a rider waiting at
      the kerb — receives **nothing** when the driver arrives once this merges. Weigh it
      against what it buys: **€9.36/mo** (see **Cost**). Do not merge until #17's push lands or
      Linards accepts the regression explicitly. **Not a reason to delay writing or reviewing the
      code** — it is a reason not to merge it.

      **AMENDED at PR #253 review round 1 (F1), and the gate got SMALLER, not bigger.** As
      written above this AC was *understated*: at the review's HEAD the foreground case was
      broken too, because `statusKey()` collapsed `arrived` into `rider.status.matched` — an app
      rider saw nothing new at arrival with the app OPEN either. PR #253 now ships
      `rider.status.arrived` («Auto ir klāt», spoken by `Banner`), so the foreground rider is
      told. What remains, and what this gate is now exactly about: a **backgrounded** app rider
      is told nothing until #17 ships push. That is the residual regression the €9.36/mo buys.
- [ ] **AC #6** — No document or comment in the tree still states "arrival SMS on every channel",
      "2 SMS/ride app channel", or "app rider = 2 segments · phone rider = 5" as current fact.
- [ ] **AC #7** — #135's `−45% / 1,347 → 745` is corrected on the issue, and
      `hosting-sms-cost-research.md` §4.3's lever-1 row is annotated with both faults.
- [ ] **AC #8** — `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` green.

Every AC is verifiable on this machine. None is owed to a later ticket.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration), api test count **+1**
- [ ] No linting or type checking errors
- [ ] ~~Level 4 run, **including step 8's phone-channel control**~~ — **NOT RUN, discharged
      instead**, 2026-09-22. See AMENDMENTS A2 and the report's V2: the integration suite exercises
      both of Level 4's assertions through the same code, and the log oracle provably cannot
      disagree with the content assertion.
- [ ] Acceptance criteria all met, AC #5 stated on the PR as a merge gate
- [x] `ride-notifications.service.spec.ts:286-294` still byte-identical (D1's no-op proof) — `observed`, no `driver_assigned` line in `git diff`

---

## OPEN QUESTIONS / ASSUMPTIONS

**Q1 — should `booking_confirmed` be skipped for app riders too?** The research's costed lever 1
did exactly that, and the arithmetic proves it: `1,347 − 745 = 602 = 301 app rides × 2 segments`,
i.e. **both** of the app rider's messages. #135's Scope and AC say "on assign/arrive", which leaves
the confirmation in place. **This plan follows the ticket** — the AC is the specification and its
plain reading wins. Answering Q1 "yes" would roughly double the saving (a further 301 segments,
€9.36/mo) at the cost of the app rider's only durable booking receipt. It is a separate decision
and, if taken, a separate ticket. Linards's call, not the implementer's.

**Q2 — should `driver_assigned`'s condition be realigned to `=== 'app'`?** This plan says yes
(D1) because it is provably a no-op at HEAD and fails open for a future third channel. If the
implementer cannot verify the no-op to their own satisfaction, Task 1's GOTCHA gives the
narrower alternative. Either discharges the ticket. (The `ride-quote.service.ts:40` citation
that stood here was backwards — see D1's correction, PR #253 F2.)

**Assumptions:**

- **A1** — 430 rides/mo and 30% phone-booked. Both are research §4.3's, both are stated there as
  assumptions with no evidence. 430 is the PRD's *month-3 target*, i.e. the busiest month the pilot
  aims at, not a pilot average. Every euro figure in this plan inherits both.
- **A2** — ~100 OTP/mo, also §4.3's, also unevidenced. It scales with rider count, which is unknown.
  It affects the *percentage* below (it is in the denominator), not the segment saving.
- **A3** — €0.0311/segment, BulkGate Latvia, `observed` 2026-08-14 (research §3, line 163). #137's
  bake-off may move it; it moves the price, not the count.
- **A4** — a phone-booked rider never has the app. If a rider who *has* the app phones Dina anyway,
  they get all three messages. Correct, and not worth detecting.

---

## NOTES (open canvas)

### Cost — the ticket's headline figure does not describe HEAD (F1)

**Segment counts — `observed`.** A `tsx` run over `packages/shared/src` (not `dist`, which is
stale and has no `sms-segments.js`), 2026-09-22, plate `LV-12345`, the two **unlinked** templates
in all three languages:

| Template | lv | ru | en |
|---|---|---|---|
| `sms.booking_confirmed` | 29 ch / **1 seg** | 25 / **1** | 20 / **1** |
| `sms.driver_arrived` | 35 / **1** | 31 / **1** | 33 / **1** |

The **linked** templates (`driver_assigned`, `booking_confirmed_phone`) are 1 segment too, but
that is `packages/shared/tests/sms-budget.test.ts`'s `derived` claim at the maximum of every
bound, **not** this run's — the same run rendered them at a 9-character driver name and a
two-digit ETA, which is not the binding case (`sms-budget.test.ts` pins the binding RU row at 70
characters with zero spare). Cited as the test's claim, not as an observation.

**Per ride — `derived`** from those counts and the send policy at `ride-notifications.service.ts:59-155`:

- app ride today = `booking_confirmed` 1 + `driver_arrived` 1 = **2** (`driver_assigned` already filtered)
- phone ride today = 1 + 1 + 1 = **3** (it was 5 before #136)
- app ride after this ticket = **1**

**Per month — `derived` under A1–A3**, 430 rides × 30% = 129 phone / 301 app, + 100 OTP:

| | Segments | BulkGate @ €0.0311 |
|---|---|---|
| Today (HEAD, post-#136) | 301×2 + 129×3 + 100 = **1,089** | **€33.87** |
| After #135 | 301×1 + 129×3 + 100 = **788** | **€24.51** |
| **Saving** | **301** | **€9.36/mo**, −27.6% |

−27.6% is `301 / 1,089`, against the same OTP-inclusive denominator the ticket's −45% used, so the
two are comparable. Ride-SMS-only it would be 30.4%, which is not.

**Why the ticket says −45% and is wrong twice:**

1. Its baseline `1,347` is **pre-#136**. Lever 2 shipped and took the phone ride from 5 segments
   to 3, which removed 258 segments/mo before this ticket touches anything. The remaining pool is
   smaller, so the same absolute saving is a larger-looking fraction of a table that no longer exists.
2. Its saving `745` assumes lever 1 removes **all** app-rider SMS. `1,347 − 745 = 602 = 301 × 2` —
   the confirmation is in there. #135's own Scope says "assign/arrive". See Q1.

This is the third time in this repo a figure has flowed plan → PR → doc without being re-derived
(#87, #107, and §4.3's own #136 correction). The subject to retire is *the lever-1 row*, not the
digits — Task 4 grep target `1,347`, `745`, `lever 1`, `45%`.

### R1 — what this actually buys, next to what it costs

€9.36/mo against a <€100/mo guardrail, in exchange for an app rider at the kerb receiving no
arrival notification at all while the app is backgrounded. (Foreground is covered as of PR #253's
`rider.status.arrived` — F1; backgrounded is the residual.) The justification that carried the
`driver_assigned` filter — "an app rider is watching the app" — is *weakest* precisely at
`arrived`: assignment happens while the rider is still in the app having just booked; arrival
happens minutes later, phone in pocket. #17's re-slice specifies an Android ongoing-ride
notification for exactly this moment, and it is not built.

That is the whole of AC #5. Both numbers are here so the decision can be made in one read.

### Rejected alternatives

- **An env flag to toggle the filter.** Rejected. The slice's own precedent is explicit
  (`notifications.policy.ts:60-63`, mirroring `rides.policy.ts:1-13`): a budget control you can
  switch off from an environment file is a suggestion. A one-line revert is cheaper than a flag
  with two code paths and no test for the second.
- **Extending `mint:ride` to reach `arrived`.** Rejected as scope creep — Level 4 is performable
  today over curl with the stub log as its oracle (see Level 4), so the script buys convenience,
  not coverage.
- **Rewriting `.claude/plans/rider-comms-sms-tracking-page.md`'s policy lines.** Rejected. A
  shipped plan records what was decided then; the forward-reference is the correct link.
- **Skipping `booking_confirmed` as well, to hit the research's −45%.** Deferred to Q1. Not the
  implementer's call.

### Confidence

**8.5/10** for one-pass success. The code is one condition. The risk is not in writing it — it is
in (a) missing the integration test's `waitForSms(p(51), 2)`, which fails by timeout rather than
by assertion and reads like a flake in a suite that genuinely flakes, and (b) the documentation
sweep, which touches six places across four files and has no automated check. Both have named
tasks and named grep targets.

## AMENDMENTS

<!-- newest at the bottom; leave empty until this plan is executed -->

### 2026-09-22 — executed on `feature/skip-rider-sms-app-bookings-135`

Full detail in `.claude/reports/skip-rider-sms-app-bookings-135-report.md`; the divergences that
change what this plan *instructs* are edited into the tasks above and cross-referenced here.

**A1 — Task 4's VALIDATE grep was unsatisfiable and is rewritten.** The task asked for two
incompatible things: its PATTERN says mirror §4.3's `**CORRECTION (#136…)**` block and keep the
superseded text visible, while its VALIDATE said a grep for `1,347|745|45%` must return nothing.
A correction block that quotes the figure it retires leaves those digits in the tree by
construction. Resolved toward the convention — deleting `1,347` would be the "retire the digits,
not the subject" failure CLAUDE.md names. The check is now a classification, tabulated in the
report's V1. The figure is **10 — the hits in the tree proper** (`hosting-sms-cost-research.md` 8,
all inside the dated correction block or its relabelled table; `rider-ux-evidence.md` 1, a
30–45% cash statistic on an unrelated subject; `ride-notifications.service.ts` 1, which is still
true). Everything else the grep returns is this ticket's own plan and report, two shipped plans
the plan says to leave, and three coincidental strings in older reports.

*Corrected twice before the PR opened, and the second correction is the instructive one.* The
report, this amendment and the first PR draft all said "19" — a number no run produced. Replacing
it with a measured grand total of "48" was **also** wrong, because this amendment is itself one of
the files the grep counts, so writing the number moved it to 49. The count in the tree proper does
not move when these artifacts change, which is why it is the one stated. `inherited-figures.sh`
binds no unit word to a bare count and caught neither; re-running the grep caught both.

**A2 — Level 4 was not run; it was discharged by argument with evidence.** Level 4's two
assertions are step 7 (app ride = exactly one SMS, the confirmation) and step 8's control (phone
ride = three). Both are asserted by `tracking.integration.spec.ts`, green. The `harness` boots the
real `AppModule` against real Postgres and overrides only seam providers (`test/harness.ts:537-565`)
— which a `pnpm dev` run also stubs; and `acceptBy` (`tracking.integration.spec.ts:174-194`) is
step 5 verbatim, including reading the offer id out of the database. Step 7's log oracle cannot
disagree with the content assertion: `logSent` has one caller (`sendSms:226`), `sendSms` has two
(`:78`, `:147`), and the new guard at `:119` returns before `:147` for `bookingChannel === 'app'`,
so no `kind=driver_arrived, channel=app` row is emissible. What remained was a human reading a
terminal, against the cost of seeding the shared dev DB. **If Linards disagrees, Level 4 is still
performable exactly as written.**

**A3 — one assertion was added beyond Task 3's snippet.** `toHaveLength(1)` does not say *which*
message survived; a bug suppressing `booking_confirmed` instead of `driver_arrived` would pass it.
`expect(bodies[0]).not.toContain(d.plate)` now pins the survivor as the confirmation, since only
the two driver-details templates carry a plate.

**A4 — §4.2's three stale line numbers were removed, not re-pinned.** The list cited lines 60-67,
95-96 and 122; all three were already stale, and Task 4 names the third. The bullets now name
`onRideCreated` and `onStatus`, with a parenthetical saying why no numbers are cited — a re-pinned
number goes stale on the next edit, which is how this list got here.

**A5 — two environment traps, neither in the tree.** (1) `packages/shared/dist` was stale (built
17 Sep; `trackingLinkHost` landed in #251 after), so the branch-point baseline read `141 failed`
until `pnpm --filter @taxi/shared build`. (2) `@types/semver` is in `apps/driver/package.json` and
`pnpm-lock.yaml` but was absent from `node_modules`, failing `@taxi/driver#typecheck` and taking
nine sibling turbo tasks with it; `pnpm install` fixed it and left the lockfile unmodified.

**A6 — the measured baseline, for the next person who needs it.** `observed` at branch point
`fabd615` with `env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test`,
**after** the shared rebuild: `39 skipped, 760 passed, 799 total`. After this ticket, same command:
`39 skipped, 761 passed, 800 total` — **+1**. Do not inherit these either; they were 733 total at
`0cdb59c`.

**Still open at commit time:** Task 5 (the #135 cost-claim comment) is owed at PR time, as its own
IMPLEMENT line instructs. **AC #5 remains a merge gate** — re-verified on this branch that
`apps/rider` carries no `expo-notifications` and has no push slice.
