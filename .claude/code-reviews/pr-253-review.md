# PR #253 review — round 1

**Head** `73bf626` · **Base** `main` @ `fabd615`
**Title**: feat(api): skip the arrival SMS for app-booked rides (#135)
**Reviewed** 2026-09-22 · `piv-review-pr`, fresh context + `code-reviewer` agent

**Recommendation: REQUEST CHANGES — narrowly. No line of shipped logic needs to move.**

One **High**, two **Medium**, five **Low**. Validation re-run independently and green (22/22, exit 0).
The High is a false claim, not a bug: the comment that justifies the whole change says an app rider
"sees both moments in-app", and at HEAD the rider app shows **nothing** at arrival — in the
foreground as well as backgrounded. That claim is also the input to the AC #5 merge decision this PR
correctly defers to a human, so it should be true before the human reads it.

Round 1, so the guarantees pass and the fix-mechanism pass do not apply. The base has not moved:
`origin/main` live tip `fabd615` == the PR's `baseRefOid`.

---

## Summary

One guard in `RideNotificationsService.onStatus` widens the existing `driver_assigned` channel
filter to cover `driver_arrived` too, so an app-booked rider's SMS budget becomes the booking
confirmation and nothing else. A phone-booked rider (#63) is untouched. Ten of the 1,015 added
lines are shipped source; the rest is the PIV plan, the report, and five documentation sites that
recorded the old policy as current fact.

The rewrite from `kind === 'driver_assigned' && bookingChannel !== 'phone'` to
`bookingChannel === 'app'` is the one thing here that could have been a silent behaviour change,
and it is not — see **Not findings**, item 1. The code is right. The prose around it is where the
work is left.

---

## Issues

### F1 — High · "an app rider sees both moments in-app" is false at HEAD, in every app state

`services/api/src/features/notifications/ride-notifications.service.ts:114-118` (the guard's
comment) and `:30-33` (the class docblock), plus `docs/research/rider-ux-evidence.md:74`,
`docs/research/hosting-sms-cost-research.md:291-292`, the plan's AC #5 and the PR body.

The comment that justifies the change reads:

```ts
// An app rider sees both moments in-app, so neither message is theirs
```

Half of that is true. The **assignment** moment is visible: `requested` → `accepted` moves the
rider screen from «Meklējam auto…» to «Auto ir atrasts». The **arrival** moment is not visible at
all, and the rider app says so itself:

- `apps/rider/src/features/ride-status/status-screen.tsx:22-34` — `statusKey()` returns
  `rider.status.matched` for every status past `requested` that is not cancelled or over. So
  `accepted`, `arriving`, `arrived` and `in_progress` all render the same string. The function's own
  docblock at `:16-21` states the intent: *"this screen ends at matched — the arriving / arrived /
  in-progress detail is #17's, and claiming it here would be a lie about what the app knows."*
- There is no `rider.status.arrived` key. `packages/shared/src/i18n/lv.ts:426-439` holds
  `searching`, `still_searching`, `matched`, `cancelled`, `completed` — and since `MessageKey` is one
  shared union, a key absent from `lv` is absent everywhere.
- `use-ride-status.tsx` does receive `RT.rideStatus` with `status: 'arrived'` and applies it — and
  then renders text byte-identical to the `accepted` frame, so the live region has nothing new to
  announce either.
- There is no tracking-page fallback: `grep -rn "trackingToken\|trackingLink\|/t/" apps/rider/src/`
  returns **0** (`observed`), and the app-channel confirmation deliberately carries no link
  (`ride-notifications.service.ts:72`, pinned at `tracking.integration.spec.ts:371,387`).

**Failure scenario.** An app rider stands at the kerb with the app **open and in the foreground**.
The driver taps *arrived*. The screen still reads «Auto ir atrasts» — the same line it has shown
since acceptance — and no SMS arrives. After this merges, an app rider has **zero** arrival signal
in any app state. Not just the backgrounded one.

**Why this is High rather than a wording nit.** CLAUDE.md makes a guarantee in a comment a claim,
not decoration, and this claim is the sole stated rationale for the change. It also understates the
regression everywhere it is priced: AC #5 (`plan:485-490`), `rider-ux-evidence.md:74` and
`hosting-sms-cost-research.md:291-292` all say "**backgrounded**". The human being asked to accept
this trade is being shown a smaller regression than the one that ships. The €9.36/mo does not buy
"a backgrounded rider misses the arrival"; it buys "no app rider is told the driver arrived".

**Fix — three text edits, no logic change.**
1. `ride-notifications.service.ts:114-118` and `:30-33` — say what is true: the app rider sees the
   *assignment* moment in-app; the arrival moment is #17's and is not shown until it lands.
2. `rider-ux-evidence.md:74` and `hosting-sms-cost-research.md:291-292` — drop "backgrounded".
3. Restate AC #5 on the PR body in those terms, since it is the merge decision's input.

If the merge is wanted **before** #17, the cheap remedy is separate and small: add
`rider.status.arrived` to the three catalogs and one branch in `statusKey()`. `Banner` already
announces the change, so that alone would make the comment true for the foreground case.

### F2 — Medium · the guard's comment states a fail-open policy the slice does not have, on a miscited source

`services/api/src/features/notifications/ride-notifications.service.ts:116-118` vs `:72`; plan
`:205` and `:529`.

The guard argues for `=== 'app'` over `!== 'phone'` because "a channel we cannot vouch for gets the
SMS (fail open)". Forty lines up, the same slice fails **closed** for the same unknown channel:

```ts
// :72 — onRideCreated
ride.bookingChannel === 'phone' && link !== null ? 'sms.booking_confirmed_phone' : 'sms.booking_confirmed'
```

With a hypothetical `BOOKING_CHANNELS = ['app','phone','web']`, a `web` rider gets
`booking_confirmed` with **no** tracking link at `:72`, then `driver_assigned` **with** a link at
`:137-143`. The link is withheld at booking and handed over at assignment. The slice has no single
unknown-channel policy, and the comment asserts one.

That third-channel case is also the one place the rewrite is **not** a no-op: the old condition
suppressed `driver_assigned` for `web`; `=== 'app'` sends it. The plan says exactly this and
accepts it — but it rests the decision on a citation that says the opposite of what it is quoted
for. Plan `:205` and `:529`: *"They diverge only if a third channel is ever added, which
`ride-quote.service.ts:40` explicitly contemplates."* The actual line (`observed`):

> *"Adding a third `bookingChannel` value would be the same mistake by another door: a preview is
> not a booking channel."*

It argues **against** a third channel. D1 is a binding GOTCHA, and half its reasoning is built on a
source that does not support it. The other half — the closed two-value enum — is independently true
and I verified it, so no code defect follows. The artifact is still wrong.

**Nothing in the tree would catch a third channel.** No `Record<BookingChannel, …>`, no `satisfies`,
no exhaustive `switch`; `===`/`!==` against a widened union stays type-valid, and every
notifications spec hardcodes `'app'`/`'phone'`. Adding `web` needs a `db` migration, so the build
breaks there — pointing at `db`, not at this line.

**Failure scenario.** Someone adds a `web` channel. `driver_assigned` silently starts going to web
riders (a behaviour change from pre-PR), carrying a tracking link those riders were denied in their
confirmation an hour earlier. Nothing fails; nobody is told.

**Fix — one line, plus the plan.** Amend the comment to name the other half: that
`onRideCreated:72` fails the opposite way, so whoever adds a channel has both decisions in front of
them. Correct the plan's two `ride-quote.service.ts:40` citations while you are there. Nothing more
— a lookup table keyed on `BookingChannel` would make a third channel fail typecheck here, but it is
a one-caller indirection over a two-value enum and KISS wins today.

### F3 — Medium · the app-rider absence assertion's only barrier is 100 ms against a fire-and-forget send

`services/api/src/features/notifications/tracking/tracking.integration.spec.ts:381-386`

The test correctly drops `await waitForSms(p(51), 2)` — that helper polls for *at least* N and
cannot express an absence. What replaces it is a fixed `setTimeout(100)` before the count, and that
is now the **only** barrier. `RideTransitionService.emitStatus` dispatches the notification path
detached:

```ts
// services/api/src/features/rides/ride-transition.service.ts:131
void this.notifications.onStatus(ride, from);
```

So `POST /rides/{id}/arrived` returns 201 without awaiting the SMS path. Nothing orders the send
before the count.

**Failure scenario.** Someone weakens or reverts the guard. On a loaded CI runner,
`onStatus`'s three Postgres round trips — `rideById`, `riderContact`, `driverCard` — plus the
provider call take 120 ms. `smsTo(p(51))` reads `1` because the second SMS has not landed yet, not
because it was suppressed. `toHaveLength(1)` passes, and the test renamed specifically to assert
*no `driver_arrived`* reports green on the regression it exists to catch. It cannot go red
spuriously — `waitForSms(p(51), 1)` at `:370` already pinned the confirmation — so the exposure is
one-directional and silent.

**Three things cap this at Medium, stated so you can downgrade it if you disagree:**
1. The same absence is asserted deterministically in the unit spec
   (`ride-notifications.service.spec.ts:296-303`): `onStatus` awaited, provider in-memory. A real
   revert goes red there regardless.
2. The `setTimeout(100)` + count shape is **inherited, not invented here** — the phone case at
   `:350-351` is byte-identical at `origin/main` (`observed`).
3. No deterministic fence exists in the file today: `RecordingSmsProvider`
   (`services/api/test/harness.ts:257-281`) is a plain array with no completion signal.

**What distinguishes this case from the inherited one**, and why it is not simply "more of the
same": the phone case's 100 ms sits *behind* `await waitForSms(p(50), 3)` at `:329`, so its three
expected messages are already fenced with a 3 s budget and the settle only guards against *extra*
ones. The app case has no such fence for the events it asserts about — `waitForSms(p(51), 1)` at
`:370` fences the confirmation, which lands at ride **creation**, before the accept/arriving/arrived
hops begin. Same shape, different guarantee.

**Fix — deterministic.** Order the count behind a positive downstream signal instead of wall clock.
The app rider has no surviving post-creation SMS to wait on (both status messages are suppressed by
design), so the barrier must come from another ride: drive a phone-channel control's `arrived` in
the same test and `await waitForSms(<control phone>, 3)` before counting `p(51)`. Once the control's
arrival SMS has landed, the app ride's earlier transition has certainly drained.

**Fix — cheap, using only what the file already has.** Move the existing
`await view(ride.trackingToken!)` round trip (currently `:393`) ahead of the count: strictly more
settling than 100 ms of idle, no new machinery. And say in the comment what 100 ms is — a heuristic,
not a fence, with the real guard pinned by the unit test — because per CLAUDE.md an unargued bound
in a comment is a claim.

### F4 — Low · the guard's placement is a stated Task 1 requirement with nothing asserting it

`services/api/src/features/notifications/ride-notifications.service.spec.ts:286-304`

Task 1's IMPLEMENT makes placement explicit: *"Placed exactly where the old guard was — after the
`details`/`driverId` read, before `riderContact`, so an app ride still costs no extra queries"*
(`plan:195-196`). Both app-channel tests assert only `expect(sent).toHaveLength(0)`, which passes
just as well with the guard moved below `driverCard`.

The builder already records `calls` (`:107-129`) and the sibling case at `:319-328` establishes the
precedent with `expect(calls).toEqual([])`.

**Failure scenario.** A later refactor moves the guard below the two repository reads. Behaviour is
identical, every test stays green, and an app ride quietly costs two extra queries per transition —
the thing the requirement exists to prevent.

**Fix.** Add `expect(calls).toEqual(['repo.rideById'])` to the tests at `:286` and `:296`. One line
each, pinning a stated requirement rather than adding a defensive extra.

### F5 — Low · the implementation report's header names a closed AC as still open

`.claude/reports/skip-rider-sms-app-bookings-135-report.md:8-10`

The Status block says the report is complete "with **two items deliberately left open**", item 2
being "**Task 5 / AC #7's issue half is owed** — the comment correcting #135's `1,347 → 745 / −45%`
is due at PR time".

It is not owed. `gh issue view 135 --comments` returns it (`observed`), carrying the same two-fault
analysis and the same 1,089 → 788 table. The PR body states this correctly ("The same correction is
posted on #135"), so the body and the committed report now disagree about whether an AC is
discharged.

**Failure scenario.** A later session reads the report — the artifact the PIV loop treats as the
record of what shipped — believes AC #7 is half-done, and either re-posts the comment or files it
as outstanding. The report outlives the PR body.

**Fix.** Strike item 2, leave Level 4 as the single open item, and record in Task 5 that the comment
was posted at PR time as planned.

### F6 — Low · a shipped plan's unticked checklist still states the old SMS budget as policy

`.claude/plans/rider-comms-sms-tracking-page.md:368`

> `- [ ] SMS budget policy: 2 SMS/ride app channel (confirmed + arrived), 3 phone channel (+ driver-assigned with link) — asserted in specs`

AC #6 of this PR's plan says no document or comment in the tree may still state "2 SMS/ride app
channel" as current fact. This line does — present tense, no date, inside a list of 13 boxes of
which **zero** are ticked, so it reads as a live acceptance criterion rather than a dated record.

**This is a documented decision, not a slip.** The #135 plan names this exact hit at `:70` and
decides to leave shipped plans alone; the report classifies it at `:118` under "shipped plans; the
plan says leave them". The convention is defensible. The cost is that the tree's most AC-shaped
statement of the old budget is the one left uncorrected.

**Fix (optional, one line).** Append a dated clause rather than editing the figure —
`— SUPERSEDED for the app channel by #135 (2026-09-22): 1 SMS/ride app channel` — which retires the
subject, not just the digits.

### F7 — Low · "Six documents" is the wrong unit for the count that follows it

PR body, **What changed**, third paragraph.

> "**Six documents** recorded the old policy as current fact and were corrected: the service's
> send-policy header, `hosting-sms-cost-research.md` §4.2 and §4.3, `rider-ux-evidence.md` §3.3,
> `ux-metrics-ledger.md`, and one comment in the phone-channel integration case."

Six *sites* is right. Six documents is not: the list spans **five files**, of which two are code
rather than documents (`ride-notifications.service.ts`'s docblock and
`tracking.integration.spec.ts:328`'s comment), and `hosting-sms-cost-research.md` supplies two of
the six on its own.

This is the defect class the report's own V1 diagnoses — "`inherited-figures.sh` binds no unit word
to a bare count" — landing in the PR body, which CLAUDE.md names as the most-read surface and the
only one not in the working tree.

**Fix.** "Six sites across five files".

### F8 — Low · the lever-1 projection row is not dated, while the row directly above it is

`docs/research/hosting-sms-cost-research.md:255` and `:258`

The `As shipped` row was relabelled `As shipped 2026-08-14 (pre-#136, pre-#135)` — exactly right.
The two lines immediately below were not:

```
| **+ Lever 1** — skip SMS for app riders | 745 | €23.17 | $53.27 |
**Lever 1 — skip SMS for app riders (−45%).** App riders see both events in-app.
```

Both still read as a live projection, and `745` and `−45%` are precisely the two figures the
CORRECTION block beneath exists to retire. A reader scanning the table meets them first. (That
paragraph also repeats F1's false claim verbatim.)

**Failure scenario.** The `−45%` gets quoted forward — the exact thing the correction block was
written to stop. This doc is a planning input; #13 and #17 both read it.

**Fix.** Prefix both with the marker the row above got —
`+ Lever 1 (projected 2026-08-14; SHIPPED as #135 — see the correction below)` — and mark the
paragraph heading `−45%, superseded`.

---

## Not findings — checked and cleared

Each of these is somewhere a reviewer would reasonably expect a finding. The answer took work, so
it is recorded rather than left silent.

1. **The `!== 'phone'` → `=== 'app'` rewrite is a no-op for `driver_assigned` at HEAD,
   structurally.** `BOOKING_CHANNELS = ['app', 'phone'] as const`
   (`packages/shared/src/enums.ts:99`); the column is `booking_channel` `pgEnum('app','phone')`
   **NOT NULL DEFAULT 'app'** (`db/migrations/0007_uneven_mulholland_black.sql:1,9`;
   `db/src/schema/rides.ts:84-86`), typed non-nullable as `BookingChannel` on `NotifiableRide`
   (`notifications.repository.ts:23`). Over a closed two-value set with no null, the two predicates
   are identical. The PR body proves this with one test run; the enum and the `NOT NULL` are the
   reason it holds. (F2 covers the third-channel case, which is the one place it does not.)
2. **No existing `onStatus` test was silently neutered by the wider guard.** `notifiable()`'s
   default is `bookingChannel: 'phone'` (`spec:60`), so every test calling `build()` bare — including
   the failure case at `:338`, the ETA clamp at `:355` and the multi-segment warn at `:377` — still
   reaches `sendSms`. All seven checked.
3. **The plan's one frozen constraint held.** `ride-notifications.service.spec.ts:286-294` is
   byte-identical to `origin/main` (`observed`, `git show origin/main:<path> | sed -n '280,300p'`
   against the working copy).
4. **Nothing but the SMS and its log row is lost for `app` + `arrived`.** Reading `onStatus` through
   to `:282`: `etaToPickup` is on the `driver_assigned` branch only (`:134`), so no ETA read and no
   maps call disappears; the only `realtime.emitToDispatch` in the file is inside `logSendFailed`
   (`:264`), which has nothing to fire about when no send is attempted. The single observable loss
   is the `ride.notifications.sms_sent` row, and `docs/ux-metrics-ledger.md:50` now documents that
   step-down as expected rather than a regression.
5. **Test-shape rule met.** Expected (`:296`, `:306`), edge (`:286`, `:319`), failure (`:338`) over
   the changed path, per CLAUDE.md.
6. **AC #4's "channel unknown → send" edge has no test, by design.** The plan discharges it "by the
   condition's shape … **not** by a fabricated cast", because the only way to build an unknown
   channel is to lie to the type system. Recorded so the absence reads as a decision, not a gap.
7. **No hard-rule surface touched.** No status write outside `assertTransition`, no money, no
   contract duplicated outside `packages/shared`, no seam bypass, no new log event, no `any` / cast
   / `@ts-expect-error`; file at 282 of 500 lines, no `max-lines` disable.

---

## Numbers pass

Every figure in the PR body, re-derived. `re-observed` means I ran a command that produced it.

| Figure | Claimed | Verdict |
|---|---|---|
| €9.36/mo saving | `derived`, 301 × €0.0311 | ✅ 9.3611 → €9.36 |
| `1,347 − 745 = 602 = 301 × 2` | `derived` | ✅ both sides 602 |
| Before #135: `301×2 + 129×3 + 100 = 1,089`, €33.87 | `derived` | ✅ 1,089; ×0.0311 = 33.8679 |
| At HEAD: `301×1 + 129×3 + 100 = 788`, €24.51 | `derived` | ✅ 788; ×0.0311 = 24.5068 |
| Saving 301, **−27.6%** = `301 / 1,089` | `derived` | ✅ 0.27640 |
| Ride-SMS-only 30.4% | `derived` | ✅ 301 / 989 = 0.30435 |
| 129 phone / 301 app from 430 @ 30% | `derived` | ✅ 129 + 301 = 430 |
| numstat 930 / 52 / 33 = **1,015**; 0 / 11 / 16 = **27** | `observed` | ✅ `re-observed` — `git diff --numstat` and `--shortstat` reproduce every cell |
| service file **282 lines** vs the 500 cap | `observed` | ✅ `re-observed` |
| `apps/rider` has **0** `expo-notifications` | `observed` | ✅ `re-observed` |
| unit spec **19 passed, 19 total** at HEAD | `observed` | ✅ `re-observed`, 0.652 s |
| `18 total` intermediate run | flagged irreproducible **by the body itself** | ✅ correctly labelled; the body gives the revert recipe instead of asserting it |
| `logSent` 1 caller `sendSms:226`; `sendSms` 2 callers `:78`, `:147` | `observed` | ✅ `re-observed`, exactly those lines |
| the "10 hits in the tree proper" grep | `observed` at `9d61d0c` | ✅ holds at `73bf626` **on the report's stated pattern and unit** — hosting 8 **lines**, rider-ux 1, service 1. Note for the next reader: it is a per-**line** count under `every channel\|2 SMS/ride\|app rider = 2 segments\|1,347\|745\|45%`, not a per-match count under the narrower pattern. Both happen to equal 10, so neither confirms the other |
| gate `22 successful, 22 total` | `observed` | ✅ `re-observed` — see Validation |
| api `+1` test delta vs `fabd615` | `observed`, 760 → 761 | ✅ HEAD side `re-observed` at 761; the diff adds exactly one `it()` and renames two, so +1 is the only arithmetic it permits. The `fabd615` baseline row I did **not** re-run — that means checking out the base and dropping the shared test DB |
| "Six documents corrected" | — | ❌ **F7** — six sites, five files |
| "an app rider sees both moments in-app" | stated as fact | ❌ **F1** — false for the arrival moment in every app state |

The body's honesty about the irreproducible `18 total`, and its refusal to inherit CLAUDE.md's test
count (measuring both sides with the same command instead), are the two places it does what #87,
#107 and #121 each failed to do.

---

## Validation — re-run independently, not inherited

`observed` by this review, at `73bf626`, from the main checkout:

```
COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
→ exit 0 · Tasks: 22 successful, 22 total · Time: 1m29.134s
```

| Package | Result |
|---|---|
| `@taxi/api` | Test Suites: 2 skipped, 79 passed, **79 of 81 total** · Tests: 39 skipped, **761 passed, 800 total** |
| `@taxi/shared` | Test Files 27 passed (27) · Tests **255 passed** (255) |
| `@taxi/dispatch` | Test Files 30 passed (30) · Tests **272 passed** (272) |
| `@taxi/driver` | Test Suites 44 passed, 44 total · Tests **250 passed**, 250 total |
| `@taxi/rider` | Test Suites 30 passed, 30 total · Tests **145 passed**, 145 total |
| `@taxi/db` | Test Files 3 passed (3) · Tests **17 passed** (17) |
| CI on the PR | CodeQL ✅ · audit-diff ✅ · check ✅ (3m31s) · codeql ✅ · ready ✅ — 5/5 |

My run did **not** export `REDIS_TEST_URL`, so the 39 gated Redis tests skipped where the PR body's
run ran them. That is the whole difference between my `39 skipped, 761 passed, 800 total` and the
body's `800 passed, 800 total`, and the body predicts it in advance ("Same 800 total either way").
Both rows describe the same tree. Every other package count matches mine exactly — 255, 272, 250,
145, 17 — so the body's validation block is `re-observed`, not merely restated.

---

## What is good

1. **The one risky line was checked the right way.** Widening a guard from
   `kind === X && channel !== Y` to `channel === Z` is where a "no-op" claim usually hides a
   behaviour change for the third value. The body proves it executably, the plan argues it, and the
   diff leaves the proving test byte-identical rather than editing it into agreement.
2. **The integration assertion was strengthened beyond the plan.** `toHaveLength(1)` alone cannot
   say *which* message survived — an inverted guard dropping the confirmation would pass it.
   `expect(bodies[0]).not.toContain(d.plate)` pins the survivor as the confirmation, since only the
   two driver-details templates carry a plate. That is the deviation worth having.
3. **The retired figures were retired by subject, not by digit.** §4.3 keeps `1,347` and `745`
   visible under a dated CORRECTION naming *both* faults, and the same correction is on the issue.
   The implementer identified the plan's own VALIDATE as unsatisfiable rather than complying with
   it and deleting the digits — which is the failure CLAUDE.md names.
4. **`docs/ux-metrics-ledger.md:50` pre-empts a false alarm.** The `SMS spend €/week` row now warns
   that a week-over-week step down across 2026-09-22 is this change landing. Nobody will debug it.
5. **The report's V1 is unusually good self-correction** — it records a figure that was wrong twice,
   explains why the *measured* second attempt was also wrong (the artifact is one of the files the
   grep counts, so committing the fix moved it 48 → 49), and lands on a head-independent count.
   That reasoning is reusable; it is #212's failure mode caught in flight.
6. **AC #5 is stated as a merge gate on the PR, the plan and the issue, with the trade priced.**
   Shipping a known regression behind an explicit human decision is the correct shape. F1 is about
   the size of the regression being understated, not about the gate being wrong.

---

## Recommendation

**Request changes — narrowly. Nothing in the shipped logic moves.**

**Order matters here: fix F1 before Linards reads the merge gate.** AC #5 as currently written
describes a smaller regression than the one that ships, so a decision taken on today's wording is a
decision taken on the wrong facts. Correct the claim, then put the gate in front of the human.

The work is:

- **F1 (High)** — correct two comments and two doc lines, and restate AC #5 on the PR body. This one
  should land before the human reads the merge gate, because it *is* the merge gate's input.
- **F2 (Medium)** — one clause on the guard's comment naming `onRideCreated:72`'s opposite polarity;
  fix the plan's two backwards `ride-quote.service.ts:40` citations.
- **F3 (Medium)** — harden the app-rider absence assertion, or write down honestly that 100 ms is a
  heuristic and the unit test is the real guard.
- **F4–F8 (Low)** — one-line edits each; take them while the branch is open or defer them.

**Then still do not merge until AC #5 is answered.** Rider push (#17) has not shipped — `observed`,
0 `expo-notifications` in `apps/rider/package.json`, no push slice under `apps/rider/src/features/`,
and per F1 no in-app arrival state either. On merge, no app rider is told the driver arrived, in any
app state. That costs one rider experience and buys €9.36/mo against a <€100/mo guardrail. Either
land #17 first, add the `rider.status.arrived` string as F1's cheap remedy, or accept the regression
explicitly — Linards's call, not the review's.
</content>
</invoke>
