# PR #253 — review round 1 fixes

**Review**: https://github.com/linardsb/taxi/pull/253#issuecomment-5774376790 (`piv-review-pr`, round 1)
**Branch**: `feature/skip-rider-sms-app-bookings-135` · **Base** `main` @ `fabd615`
**Fixed** 2026-09-22 · `piv-fix-review-findings`

**All eight findings fixed. Nothing deferred, nothing dropped as noise.** Every finding was
re-run against the tree before it was triaged — the review's own claims are inherited otherwise,
and this repo has been burned by that twice (#142 R4, #147 round 2 N3).

One scope decision was Linards's and is recorded in F1: the review offered a *cheap remedy*
(adding `rider.status.arrived`) as optional, and Linards chose to take it. That widens the PR
into `apps/rider` and `packages/shared`, and it changes what F1's corrected text should say.

---

## Triage

| # | Sev | Verified before fixing? | Disposition |
|---|---|---|---|
| F1 | High | ✅ primary source | Fixed — code remedy **plus** text, 11 sites (review named 6) |
| F2 | Medium | ✅ primary source | Fixed — comment clause + 2 plan citations withdrawn |
| F3 | Medium | ✅ primary source | Fixed — honest comment, barrier reordered. **Not** called deterministic |
| F4 | Low | ✅ primary source | Fixed — 2 assertions, probed against the named mutation |
| F5 | Low | ✅ `gh issue view 135 --comments` | Fixed — item struck |
| F6 | Low | ✅ primary source | Fixed — dated clause. **Deviates from a documented decision**, see below |
| F7 | Low | ✅ counted | Fixed — unit corrected **and count re-derived at final HEAD** |
| F8 | Low | ✅ primary source | Fixed — both lines dated |

---

## F1 (High) — "an app rider sees both moments in-app" was false at HEAD

**What was wrong.** The comment justifying the whole change claimed an app rider sees the arrival
moment in the app. They did not, in any app state. `statusKey()`
(`apps/rider/src/features/ride-status/status-screen.tsx`) returned `rider.status.matched` for
`accepted`, `arriving`, `arrived` and `in_progress` alike, and no `rider.status.arrived` key
existed in any catalog. A rider at the kerb with the app **open** saw «Auto ir atrasts» — the same
line shown since acceptance — and after this PR would get no SMS either.

**The review's fix list was incomplete, and its own F8 proved it.** F1 enumerated six sites; F8
quoted a seventh (`hosting-sms-cost-research.md:258`, "App riders see both events in-app") and
proposed only to *date* it, which would have left the false claim standing four lines below a
corrected one. Grepping the **subject** rather than the review's strings found **11**.

**Fix — code (Linards's call, chosen over text-only).**

| File | Change |
|---|---|
| `packages/shared/src/i18n/lv.ts` | `'rider.status.arrived': 'Auto ir klāt'` |
| `packages/shared/src/i18n/ru.ts` | `'Машина подъехала'` |
| `packages/shared/src/i18n/en.ts` | `'Your car is here'` |
| `apps/rider/.../status-screen.tsx` | `if (status === 'arrived') return 'rider.status.arrived';` + docblock |

`MessageKey` derives from `lv` and `i18n.ts:26` is
`satisfies Record<Language, Record<MessageKey, string>>`, so the two other catalogs are forced by
typecheck — catalog parity is structural here, not a convention I had to remember.

`Banner` already speaks the status line (Android live region + iOS announce), so no a11y wiring was
needed; the new test asserts the announce, which is the half that matters for a rider with the
phone in their pocket.

**Scope note.** `apps/rider/CLAUDE.md` lists push notifications and ride tracking as "not built
here (yet) — all #17 or later". This change is neither: it is a status string on a screen that
already renders ride status, with no position, plate, ETA or push. Recorded because it sits next
to #17's territory.

**Test + probe (the finding's own mutation, verbatim).**
`status-screen.test.tsx` gains two tests: `arrived` renders and *speaks* «Auto ir klāt» and is not
`matched`; `arriving` still reads `matched` (only `arrived` was carved out).

```
observed — with the branch present:
  pnpm --filter @taxi/rider test -- status-screen  → Tests: 14 passed, 14 total (7.084 s)
observed — branch line removed (the exact collapse F1 names), same command:
  → Tests: 1 failed, 13 passed, 14 total (2.054 s)
     ✕ says the car is HERE at arrived, and speaks it
       at status-screen.test.tsx:114 — getByText(t('rider.status.arrived'))
```

Restored and re-verified byte-identical after the probe.

**Fix — text, all 11 sites.** After the code remedy the accurate claim is: **foreground covered,
backgrounded not** — so "backgrounded" in the docs, which F1 correctly called an *understatement*
at review HEAD, becomes exactly right at this HEAD. Sites 7 and 9–11 are this PR's own artifacts.

| # | Site | Now says |
|---|---|---|
| 1 | `ride-notifications.service.ts:30-35` (docblock) | "…both moments on the ride-status screen WHILE THE APP IS OPEN. Backgrounded, they see neither: rider push is #17" |
| 2 | `ride-notifications.service.ts:114+` (guard) | names both screens' strings + AC #5; also carries F2's clause |
| 3 | `tracking.integration.spec.ts` (app case) | "`/book/status` shows it while the app is open" |
| 4 | `hosting-sms-cost-research.md:258` | "…*while the app is open*; backgrounded they see neither" ← **found by the sweep, not by the review** |
| 5 | `hosting-sms-cost-research.md:292` | adds that the foreground case is now covered, so the residual is exactly the backgrounded one |
| 6 | `rider-ux-evidence.md:74` | names `rider.status.arrived` + «Auto ir klāt»; "**backgrounded**" bolded as the residual |
| 7 | plan — Feature Description | AMENDED block: the in-app half was not true when the plan was written |
| 8 | plan — quoted guard comment | matches the shipped comment |
| 9 | plan — quoted test comment | matches the shipped comment, names the heuristic |
| 10 | plan — **AC #5** | AMENDED: "the gate got SMALLER, not bigger" — understated at review HEAD, now exactly the backgrounded case |
| 11 | plan R1 + report merge-gate section | foreground covered as of this round; backgrounded is the residual |

Plus the **PR body** (sites 12–13: the ⚠️ header and "watches the driver arrive on screen"), which
no tree grep reaches — updated after the push, see **PR body** below.

**Deliberately NOT changed:** `plan:141` quotes `origin/main`'s *`driver_assigned`* comment ("an
app rider sees the same moment in-app"). That one is **true** — `requested → accepted` does move
the screen from «Meklējam auto…» to «Auto ir atrasts». Correcting it would have been the sweep
overreaching.

---

## F2 (Medium) — a fail-open policy the slice does not have, on a backwards citation

**What was wrong.** Two things, and only the second is a defect in the tree.

1. The guard's comment asserted a slice-wide "unknown channel → fail open" policy. Forty lines up,
   `onRideCreated:72` fails **closed** for the same unknown channel: a hypothetical `web` rider
   gets `booking_confirmed` with **no** tracking link, then `driver_assigned` **with** one. The
   link is withheld at booking and handed over at assignment.
2. The plan justified D1 by citing `ride-quote.service.ts:40` as "explicitly contemplating" a third
   channel. `observed`, that line says the opposite:
   > *"Adding a third `bookingChannel` value would be the same mistake by another door: a preview
   > is not a booking channel."*

**Fix.** The guard comment now names `onRideCreated:72`'s opposite polarity and says whoever adds a
third channel has to settle both. Both plan citations (D1's GOTCHA and Q2) withdraw the
`ride-quote.service.ts:40` reference and say why; the no-op argument stands on its other half — the
closed two-value enum and the `NOT NULL DEFAULT 'app'` column — which I re-verified.

**No lookup table.** A `Record<BookingChannel, …>` would make a third channel fail typecheck here,
but it is a one-caller indirection over a two-value enum. The review reached the same conclusion.

**Test.** None added, and none is possible: the only way to construct an unknown channel is to lie
to the type system, which the plan already rules out. This is a comment-accuracy fix.

---

## F3 (Medium) — the absence assertion's only barrier was 100 ms against a detached send

**What was wrong.** `RideTransitionService.emitStatus:131` dispatches the notification path with
`void`, so `POST /rides/{id}/arrived` returns 201 without awaiting the SMS. A loaded runner that
took longer than 100 ms over the three Postgres round trips would read a not-yet-delivered second
SMS as an absence — green on exactly the regression the test exists to catch, and it cannot go red
spuriously, so the exposure is one-directional and silent.

**Fix — and what I did NOT claim.** The review offered a "deterministic" option (drive a
phone-channel control ride and wait on its arrival SMS). I did not take it, because it is not
deterministic either: two independent async chains through the same pool are ordered by queue, not
by guarantee, and shipping it under the word "deterministic" would be a new false claim in place of
the one being fixed. Per the advisor's test — *can you state the new barrier's guarantee in one
true sentence?* — the honest answer was no.

So the comment now says what is true:

- the 100 ms is a **heuristic, not a fence**, and names why nothing here can make it one (the
  `void` dispatch at `:131`);
- the **real** guard is `ride-notifications.service.spec.ts:296-303`, where `onStatus` is awaited
  against an in-memory provider and the absence is deterministic;
- the existing `await view(ride.trackingToken!)` round trip is **moved ahead of the count** (it was
  after it) — a real request through the same app settles strictly more than 100 ms of idle, and it
  still asserts what it always did.

Net: one statement reordered, no new machinery, and an unargued bound replaced by an argued one.

---

## F4 (Low) — a stated placement requirement with nothing asserting it

**What was wrong.** Task 1 requires the guard sit after the `details` read and before
`riderContact`, "so an app ride still costs no extra queries". Both app tests asserted only
`expect(sent).toHaveLength(0)`, which passes just as well with the guard below `driverCard`.

**Fix.** `expect(calls).toEqual(['repo.rideById'])` on both tests. `'repo.rideById'` is the exact
label the builder pushes (`spec:117`) — checked, not guessed; `driverCard` records with an
argument, so a guessed label would have been wrong.

**Probe — the finding's own mutation.** Guard moved below `driverCard` by script, nothing else
touched:

```
observed — guard in the required position:
  pnpm --filter @taxi/api test -- ride-notifications.service.spec → 19 passed, 19 total (0.94 s)
observed — guard moved below driverCard:
  → Tests: 2 failed, 17 passed, 19 total
     Expected - 0 / Received + 2   (the two extra repository reads)
```

Both new assertions caught it; `sent` stayed green throughout, which is the point. Restored and
`diff`-verified identical.

---

## F5 (Low) — the report named a closed AC as still open

`gh issue view 135 --comments` returns the correction, posted **2026-09-22T09:14:25Z** by
`linardsb` — `observed`, run against the fixed tree before this line was written. The report header
now carries one open item (Level 4 manual validation), with a parenthetical recording that the
second was already discharged and when.

---

## F6 (Low) — a shipped plan still stating the old budget as policy

`.claude/plans/rider-comms-sms-tracking-page.md:368` now appends
`— **SUPERSEDED for the app channel by #135 (2026-09-22): 1 SMS/ride app channel (confirmed only);
the arrival moment moved in-app. Phone stays at 3.**` — dated clause appended, figure not edited,
so the subject is retired rather than the digits quietly changed.

**This deviates from a documented decision.** The #135 plan (`:70`) and report (`:118`) both decided
to leave shipped plans alone. The review argued the cost is that the tree's most AC-shaped statement
of the old budget is the one left uncorrected, and I agree — but it is a deviation, not a gap, and
is recorded as one.

---

## F7 (Low) — "Six documents" was the wrong unit

Six **sites** was right; six documents was not — the list spans five files, two of which are code,
and `hosting-sms-cost-research.md` supplies two on its own.

**The unit was only half of it.** Correcting the unit and inheriting the digit would have been
`taxi-report-restating-pr-body-figures` again: this round's own commit adds corrected sites, so the
count moves under its own fix. The PR body figure was therefore **re-derived at final HEAD after
the push**, not before — see **PR body**.

---

## F8 (Low) — an undated projection row above a correction block

`hosting-sms-cost-research.md:255` → `**+ Lever 1** (projected 2026-08-14; SHIPPED as #135 — see
the correction below)`, matching the marker the `As shipped` row above already had. The paragraph
heading is marked `−45%, SUPERSEDED`. `745` and `−45%` stay visible under the dated correction
rather than being deleted, which is the house rule.

---

## The sweep, as a checkable list

Per CLAUDE.md a retired claim is chased by **subject**, not by string, and the sweep has to be a
list a reviewer can diff — not a sentence saying it was done. Every command below was run from the
repo root against the fixed tree; `code-reviews/` is excluded because the review file itself
legitimately quotes the old wording.

```bash
# F1 — the claim, by subject not string. Found 11 sites; the review named 6.
grep -rn "both moments\|both events\|backgrounded" \
  --include='*.ts' --include='*.tsx' --include='*.md' . | grep -v '/node_modules/'
grep -rn "watches the driver arrive\|sees both\|see both\|shows that moment\|app shows it\|in-app" \
  --include='*.ts' --include='*.tsx' --include='*.md' . | grep -v '/node_modules/'
```

Residual hits after the fixes, and why each is correct:

| Hit | Verdict |
|---|---|
| `plan:141` "sees the same moment in-app" | **TRUE** — quotes `origin/main`'s `driver_assigned` comment; assignment *is* visible |
| `rider-ux-evidence.md:74` | qualified: "while the app is open" + "**backgrounded**" as the residual |
| `hosting-sms-cost-research.md:259` | qualified: "*while the app is open*; backgrounded they see neither" |
| every other `backgrounded` hit | unrelated — GPS spike, driver app, session expiry, dispatch cascade |

```bash
# F2 — the retired citation, by noun.
grep -rn "ride-quote.service.ts:40" --include='*.md' . | grep -v '/node_modules/'
#   → 2 hits, both inside the corrections that withdraw it (plan D1, plan Q2). Correct.

# F6 — the retired budget figure.
grep -rn "2 SMS/ride" --include='*.md' . | grep -v '/node_modules/'
#   → rider-comms-sms-tracking-page.md:368, now carrying the dated SUPERSEDED clause.

# Shipped-source line cap (500) — the two files that grew.
wc -l services/api/src/features/notifications/ride-notifications.service.ts   # 294
wc -l apps/rider/src/features/ride-status/status-screen.tsx                   # 150
```

`docs/ux-metrics-ledger.md:50` was checked and **not** changed: it describes the event population
(`no kind=driver_arrived, channel=app row is ever written again`), which is unaffected by the
foreground remedy. It makes no claim about what the rider sees.

---

## Validation

`observed`, from the main checkout at the fixed tree, **after** every edit above:

```
COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
→ Tasks: 22 successful, 22 total · Cached: 0 cached, 22 total · Time: 1m17.893s
```

| Package | Result | vs the review's round-1 table |
|---|---|---|
| `@taxi/api` | 2 skipped, 79 passed, 79 of 81 suites · **39 skipped, 761 passed, 800 total** | unchanged — F4 added assertions to existing tests, F3 reordered a statement |
| `@taxi/rider` | 30 suites passed · **147 passed, 147 total** | **+2** — exactly F1's two new tests (145 → 147) |
| `@taxi/shared` | 27 files · **255 passed** | unchanged — catalog parity is enforced by `satisfies`, not by a test |

`REDIS_TEST_URL` was not exported, so the 39 gated Redis tests skipped; that is the documented
opt-in behaviour and matches the review's own run exactly.

**First gate attempt was RED** and is reported rather than hidden: `@taxi/rider#lint`, one
`prettier/prettier` error on an escaped apostrophe in a new test title
(`'…#17\'s…'` → `"…#17's…"`). Fixed and re-run; the figures above are the second run.

---

## PR body

Not reachable by any working-tree grep, and the surface the next reviewer reads first. Updated
**after** the push so its figures describe the final head rather than a commit that no longer
exists — the ordering `taxi-report-restating-pr-body-figures` exists to enforce.

Changes: the ⚠️ merge-gate header and the "watches the driver arrive on screen" line restated per
F1 (foreground covered, backgrounded the residual), F7's unit and count corrected against the final
head, and a round-1 section listing what moved.

---

## Not deferred, not dropped

Nothing. All eight were in scope, all eight are fixed, and the one item that could reasonably have
been deferred (F1's code remedy, which widens the PR into two more packages) was put to Linards and
taken deliberately.

## Still needing a human

**AC #5 remains a merge gate, and it is now smaller than the review found it.** A **backgrounded**
app rider is told nothing when the driver arrives, until #17 ships push. The foreground case is
covered as of this round. That residual is what €9.36/mo buys against a <€100/mo guardrail —
Linards's call, not the review's and not this pass's.
