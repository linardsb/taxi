# System Evolution Review — Rider app: auth shell + text-first booking, screen-reader-first (#16)

## Meta Information

- **Plan**: `.claude/plans/rider-app-auth-booking-screen-reader-first.md`
- **Execution report**: `.claude/execution-reports/rider-app-auth-booking-screen-reader-first.md`
- **Implementation report**: `.claude/reports/rider-app-auth-booking-screen-reader-first-report.md`
- **Code reviews**: `.claude/code-reviews/pr-150-review.md` (round 1) · `.claude/code-reviews/pr-150-review-round2.md` (round 2)
- **Shipped**: PR #150 (merged `9e8ccc9`, 2026-09-04) · review reports landed by #151, #152 · **#16 stays OPEN** (AC #6, AC #7, Level 4 owed on hardware)
- **Date**: 2026-09-04
- **Reviewer's standing**: this review, like the execution report it reads, was written by a session that did none of the implementing, reviewing or fixing. Classifications rest on the artifacts, not on recollection.

## Overall Alignment Score: 7/10

Plan adherence was high and the deviation reporting was honest: fourteen deviations documented before review,
each with a reason, and the reviewer credited them rather than flagging them. The risk register worked as
designed — all five risks closed by their own command, and R3 promoted a `derived` spend claim to `observed`.

Three deductions, none of them "the implementer ignored the plan":

1. **The plan's own wrong answer shipped a Critical.** Q4 asked exactly the right question (does the socket
   need to exist before `POST /rides`?) and answered it with the typical case. The implementation followed
   D4 literally and the status screen never received an event. Every gate was green.
2. **Two round-1 fixes moved their defect** (R1, R2), and **one was reported fixed and was not** (L5 → R6).
   The fix pass ran seven repros against unfixed code — the discipline is real — but nothing asked what a
   fix's *mechanism* breaks, and "every one is fixed; nothing was deferred" was written before the closing
   command ran.
3. **Claim inheritance slipped three more times inside the fix pass** (R4, R5, R11), with the rule already in
   `CLAUDE.md` and in `piv-fix-review-findings` §2. The rule exists; nothing makes its output checkable.

The score is not lower because the process caught everything before merge, recorded the blocked work as
blocked, and every figure in the PR body reproduced in both rounds — the first PR on this repo where that
happened.

## Divergence Analysis

Twenty-one divergences in the execution report. Fourteen were the implementer's, documented before review;
seven came out of the review rounds. Grouped by root cause; each block keeps the report's numbering.

### Documented at implementation (1–14)

```yaml
divergence: 1 · previewQuote in a new RideQuoteService
planned: a method on RidesService
actual: services/api/src/features/rides/ride-quote.service.ts
reason: rides.service.ts was 387/500; the method measured ~+100; the split follows a real seam (a preview creates nothing) and makes R4 structural
classification: good ✅
justified: yes
root_cause: plan did not budget the max-lines headroom of the file it was adding to
```

```yaml
divergence: 2 · Places session token rotated on a 404
planned: E9 — token NOT rotated on place_not_found
actual: rotate on 200 or 404; never on 429 or offline
reason: caching-maps.provider.ts bypasses the cache when a token is present, so a 404 means the provider was reached and the billed session is spent
classification: good ✅
justified: yes
root_cause: plan assumption wrong — stated a provider behaviour without reading the provider
```

```yaml
divergence: 3 · rider.status.queued not added
planned: a key with a {position} placeholder
actual: no key
reason: rideStatusEventSchema carries no queue position; a key nothing can fill is dead copy
classification: good ✅
justified: yes
root_cause: plan assumption wrong — the breadboard promised data the contract does not carry
```

```yaml
divergence: 4 · still_searching without a {minutes} placeholder
planned: placeholder present
actual: static copy, fires once at 60 s
reason: a counter rendered once and never updated would lie to a rider who waited five
classification: good ✅
justified: yes
root_cause: plan under-specified the update cadence of a live counter
```

```yaml
divergence: 5 · [Save this address] on the booking screen
planned: inside /book/address
actual: under the filled dropoff row on /book
reason: the sheet navigates away the instant a resolve lands; an affordance there costs a step and breaks the 3-tap path the friction audit budgets
classification: good ✅
justified: yes
root_cause: breadboard drawn before the sheet's navigation timing was decided
```

```yaml
divergence: 6 · expo-crypto added
planned: A4 — verify crypto.randomUUID() in Hermes, fall back to expo-crypto
actual: expo-crypto
reason: Hermes ships no WebCrypto global
classification: good ✅
justified: yes
root_cause: none — the plan pre-authorised this fallback
```

```yaml
divergence: 7 · STILL_SEARCHING_MS = 60 s, below the 100 s cascade
planned: Q3 — sit ABOVE the offer window
actual: 60 s = three whole 20 s offer windows; cascade worst case 5 × 20 = 100 s
reason: the message does not claim failure, and 100 s of silence is worse for a rider with no spinner
classification: good ✅
justified: yes
root_cause: plan asked for the arithmetic at implementation time; it was done and the conclusion reversed the plan's lean
```

```yaml
divergence: 8 · findNodeHandle faked in jest.setup.ts
planned: not anticipated
actual: a Proxy fakes one function, passes the rest through
reason: the renderer returns null even for an attached ref, so "focus lands on the header" was unassertable
classification: good ✅
justified: yes
root_cause: missing context — the driver app never asserted focus, so no prior plan had hit this
```

```yaml
divergence: 9 · useQuote has no cancelled cleanup flag
planned: implied by the plan's pattern references
actual: reducer request id is the staleness guard
reason: shouldQuote flips false on dispatch, so an effect-scoped cancel drops every quote; caught by the hook's own test
classification: good ✅
justified: yes
root_cause: none — test-driven correction
```

```yaml
divergence: 10 · current-position.ts extracted into features/places
planned: reverse-geocode inline in booking-screen.tsx
actual: its own module, reused by the search sheet
reason: keeps the screen composition-only under the 500-line rule
classification: good ✅
justified: yes
root_cause: plan placed logic in a screen file
```

```yaml
divergence: 11 · gate screen inside features/auth
planned: (a slice implied by the breadboard)
actual: features/auth/gate-screen.tsx
reason: a pure session decision; no onboarding in this app
classification: good ✅
justified: yes
root_cause: none
```

```yaml
divergence: 12 · no new repository method
planned: "check whether findWithQuote already suffices before adding one"
actual: it did
classification: good ✅
justified: yes
root_cause: none — the plan's own instruction
```

```yaml
divergence: 13 · no-console: 'error' plain
planned: "the plan asked for exactly this call"
actual: stricter than the driver app
classification: good ✅
justified: yes
root_cause: none
```

```yaml
divergence: 14 · cross-cutting accessibility.test.tsx
planned: a11y assertions written with each screen
actual: plus one file for the four app-wide properties
reason: properties of the app, not of a screen, need one home so a later screen cannot break them
classification: good ✅
justified: yes
root_cause: plan's Testing Strategy had no slot for cross-cutting properties
```

### Found by review round 1 (15, 17–19)

```yaml
divergence: 15 · the read is also the join (C1)
planned: D4 — GET /rides/:rideId re-reads state on reconnect; the socket connects on /book/status mount; Q4 answered "a stale first frame"
actual: findForRider joins the caller's sockets after the ownership check; the app reads on every connect, first included
reason: the join is one-shot; a socket created after POST /rides was never in the ride room and missed every later event
classification: bad ❌ — the implementer followed the plan faithfully INTO the defect
justified: the divergence is; the plan was not
root_cause: plan answered an ordering question with the typical case, not the worst case; Testing Strategy had no delivery-level test in the app's real connection order
```

```yaml
divergence: 17 · AC #9 via android.blockedPermissions
planned: android.permissions ["ACCESS_COARSE_LOCATION"] "and nothing else"
actual: FINE blocked with tools:node="remove"; the plugin still adds it to permissions
reason: expo-location's config plugin and library manifest both add ACCESS_FINE_LOCATION
classification: bad ❌ (at round 1 — closed at round 2)
justified: the final shape is; the round-1 "fixed" claim was not
root_cause: plan stated an absolute about a build output without a command that observes it; the fix pass wrote the closing sentence before running expo config
```

```yaml
divergence: 18 · one announcer per status line (M9)
planned: accessibility property 6 announced status_changed on the screen while Banner announced the same line
actual: Banner is the single announcer; the key deleted
classification: bad ❌ (plan-level)
justified: yes
root_cause: plan specified two mechanisms for one announcement without noticing they overlap on iOS
```

```yaml
divergence: 19 · SessionGuard added (H3)
planned: nothing — the breadboard's only auth-aware surface was the gate at /
actual: a render-nothing guard in _layout.tsx bouncing signedOut riders to /login with session_expired
reason: an expired token cleared the session with no route back; the copy existed with zero references
classification: good ✅ (review-driven)
justified: yes
root_cause: plan's UX States table had a row for "session unreadable" at the gate and none for "session expires mid-flow" on the authed screens
```

### Found by review round 2 (16) and the sweep (20, 21)

```yaml
divergence: 16 · retry with backoff, joined ≠ connected, snapshot after the join (R1, R7)
planned: (the round-1 fix) join on read, read on every connect
actual: failed reads retried 1 s → 30 s; joined tracked apart from connected; a second read after the join
reason: the round-1 mechanism made delivery depend on a request whose failure was swallowed, and its snapshot preceded the join
classification: bad ❌ (of the round-1 fix, not the plan)
justified: yes
root_cause: fix pass verified the finding closed and did not ask what the fix's mechanism could newly break
```

```yaml
divergence: 20 · POST /rides/quote answers 200
planned: unstated; Nest's POST default is 201
actual: @HttpCode(HttpStatus.OK)
classification: good ✅ (review-driven, L2)
justified: yes
root_cause: plan silent on status code for a non-creating POST
```

```yaml
divergence: 21 · catalog at 59 keys, not ~50
planned: ~50 keys, D5 split trigger at 460 lines
actual: 54 → 59 across the rounds; five dead keys removed by the sweep; lv.ts 386, no split
classification: good ✅
justified: yes
root_cause: none — D5 was measured exactly as designed
```

### The defect that adhered to the plan

C1 is the finding to learn from, because nobody deviated. The plan named the mechanism correctly in three
places — `roomsOnConnect` returns no ride room; `joinRideRoom` moves only sockets alive when it runs — and then
D4 applied it to the *reconnect* case only, and Q4 concluded the first-connect case costs "a stale first frame".
The implementer transcribed that; the docblock in `use-ride-status.tsx` repeated the plan's sentence; the
unit test pinned the wiring the plan described. Nothing between the plan and the reviewer could see that the
screen would never update, because the plan's Testing Strategy listed fourteen edge cases and not one of them
connected a client in the order the app does. The reviewer wrote that test as a repro, in the api's own
harness, in twenty lines.

The pattern is not "the plan was wrong". It is: **an ordering question was answered with the typical case,
and the test strategy tested the answer rather than the question.** #17 (live tracking) is the next rider
ticket and is socket-first end to end. This fires again unless the plan template changes.

### The fix that moved the defect

Round 2's two Highs were both round-1 fixes. R1: a swallowed `catch` on the request that now carried
delivery's precondition. R2: a promise chain with no terminal `catch`, reachable with a 41-character label.
The fix pass had reproduced seven findings against unfixed code — the skill's "watch it fail" rule fired —
and neither of these is visible that way, because the test proves the *old* failure is gone and says nothing
about the *new* one the mechanism introduced.

### Process incidents outside the code

- **The implementation was never committed by its author.** It lived as working-tree state for a day and
  was committed cold by a second session. The loop's own design ("fresh session per phase") makes this
  ordinary; nothing in it protects the tree between phases.
- **The post-merge step ran in a job whose `CLAUDE_PROJECT_DIR` was a removed worktree.** Every hooked tool
  was refused (`Failed to spawn`) until the hook path was recreated by hand through an unhooked tool. The
  hook script fails open by design; the *spawn* does not. Memory: `taxi-hooks-dead-project-dir.md`.
- **No follow-up issue exists** for the three hardware-owed ACs or for D3's server-backed saved places,
  although both the plan (A3, R5) and the report say one should. #16 is the carrier by default.

## Pattern Compliance

- [x] **Followed codebase architecture** — `apps/rider` is a near-transcription of `apps/driver` as the plan
      required; slices own routes/service/tests; route files are one-line re-exports; contracts came from
      `packages/shared`; two extractions kept `rides.service.ts` under the cap (481/500).
- [x] **Used documented patterns** — integer cents end to end; commission via `resolveCommissionPct` and
      stripped at the schema layer; no direct status writes; `@Roles` widening with separate caps and key
      namespaces; theme tokens only; catalog strings only (round 2's hard-rule sweep: clean).
- [x] **Applied testing patterns correctly** — ≥1 expected + edge + failure per slice; 143 rider tests in a
      package that had none; E13 with a control corridor; E14 with two distinct riders; every focus and
      announce pinned by a spy. **Gap**: no delivery-level realtime test until the reviewer wrote one.
- [x] **Met validation requirements** — 22/22 turbo tasks with `REDIS_TEST_URL` set, `@taxi/rider:lint`
      and `:test` now in the task list (R2), CI green at the merged head.
- [ ] **Manual validation (Level 4) did not run** — hardware, known at plan time (A3, R5), recorded as
      blocked at every surface. Honest, and still a validation that never happened on the ticket's own
      success condition.
- [ ] **Claim accuracy inside the fix pass** — R4, R5, R11 and the L5 "fixed" sentence. The rule is written
      in two places and produced no checkable output.

## System Improvement Actions

**Update `.claude/settings.json` (hooks):** ✅ **ACTED ON** (this review)

- [x] Both hook commands resolve the script from `$CLAUDE_PROJECT_DIR` with no fallback. Add one: if the
      project-dir copy is absent, use `git rev-parse --show-toplevel` (the session's own worktree), then
      `pwd`. A missing script must not brick a session whose hook is written to fail open.

**Update `piv-plan-implementation`:** ✅ **ACTED ON** (this review) — one edit, two template spots

- [x] TESTING STRATEGY → Integration Tests: when the ticket touches a socket, a room join or any
      `realtime` surface, require **one delivery test in the api integration harness that connects the
      client in the order the app actually does** (book first, connect after, if that is the app's order)
      and asserts an event arrives. Tests that replace the socket with a handler map pin wiring, not
      delivery; C1 was green on all of them.
- [x] OPEN QUESTIONS: any question about *ordering or timing* (who connects first, what fires before what,
      what a late response overwrites) must state the **worst case**, not the typical one. Q4's "a stale
      first frame" was the typical case; the worst was "never updates again".

**Update `piv-plan-implementation`:** — not acted on (logged)

- [ ] ACCEPTANCE CRITERIA: when an AC's verification needs hardware, credentials or a device the planning
      session has *confirmed absent* (A3 knew on 2026-09-02), create the follow-up issue during planning and
      reference its number in the AC. Then the PR can close its issue and the owed work has an owner.
      Proposed text, under the ACCEPTANCE CRITERIA template comment:
      *"An AC whose verification this machine cannot perform is not this ticket's AC. Open the follow-up
      issue now (`gh issue create`), put its number in the AC, and mark the AC 'owed by #N'."*

**Update `piv-fix-review-findings`:** — not acted on (logged)

- [ ] §2, after "watch it fail": *"For a Critical or High, write one line answering **what new failure mode
      does this mechanism have?** — a swallowed `catch`, a chain with no terminal `catch`, a flag set before
      the thing it claims — and add the test for that before moving on."* (R1, R2.)
- [ ] §2 "chase its copies": make the output checkable. *"List, in the fix report, the `grep -n` you ran per
      retired noun and its hits in the plan, the report and the PR body."* The rule was followed for the
      digits and missed for the sentence three times (R4, R5, R11); a list the reviewer can diff is what
      turns a rule into a gate.
- [ ] §4, before committing: *"Run every finding's closing command before writing the closing sentence.
      'Every one is fixed; nothing was deferred' is a claim."* (L5.)

**Update `piv-review-pr`:** — not acted on (logged)

- [ ] Phase 4, for round ≥ 2: *"For each round-1 fix to a High or Critical, ask what its mechanism newly
      permits, not only whether the original repro passes."* Round 2 did this by instinct and found both
      Highs; write it down so round 2 of the next PR does not depend on instinct.

**Update `piv-implement`:** — not acted on (logged; a workflow call for Linards)

- [ ] End the run with a WIP commit on the feature branch so the working tree is never the only copy of a
      day's implementation. The loop's "fresh session per phase" is what leaves the tree uncommitted between
      implement and commit; a `wip:` commit that `piv-commit` amends costs nothing and would have removed the
      one real risk in this ticket's handoff.

**Update CLAUDE.md:** — nothing to add

- The claim rules already cover R4/R5/R11; a third paragraph would not fire where two did not (memory:
  `taxi-piv-remedies-need-an-executable-step.md`). The remedy is the checkable list in the fix skill above.

**Create New Skill:** — none

- No manual process repeated three times without a skill. The follow-up-issue creation is a one-liner inside
  the plan skill, not a skill.

## Key Learnings

**What worked well:**

- **The risk register with closing commands.** Five risks, five commands, five closures recorded — including
  R2, where the gate had been *blind* (turbo omitted a package with no scripts) and the task count moving
  20 → 22 is the receipt. This is the first ticket where the register was written that way; keep it.
- **Deviation reporting as the reviewer's signal.** Fourteen deviations documented up front; the reviewer
  credited them and spent its findings on what was *undocumented*.
- **Repro discipline on both sides of the review.** Reviewer: seven findings reproduced in the project's own
  harnesses with controls. Fixer: ten findings run against unfixed code across two rounds, and R8's stated
  payoff verified rather than asserted. The numbers pass reproduced every figure, twice.
- **Blocked work recorded as blocked at every surface** — runbook, ledger, PR body, `closingIssuesReferences`,
  and #16 still open after merge.
- **The C1 fix was better than either option the review offered**, and the docblock says why.

**What needs improvement:**

- **Plans answer ordering questions with the typical case.** Q4 is the fourth example of a plan-level claim
  that shipped verbatim into a docblock (after #87's `~15 s`, #107's cache count, and #121's Redis
  diagnosis), and the first where the claim was about *ordering* rather than a number. The numbers pass now
  catches figures; nothing catches a wrong worst case.
- **A fix is verified against its finding, never against itself.** R1 and R2 are the shape; the skill's
  "watch it fail" rule cannot see it.
- **Claim rules produce no checkable output.** Three misses in one fix pass with the rule in two places.
- **Nothing owns work the plan already knew it could not do.** Three ACs are owed with no issue.

**For next implementation (#17 — live tracking, socket-first):**

- The delivery-test rule added to the plan skill applies to every event #17 subscribes to. Write those tests
  in the app's real connection order before writing the hooks that consume them.
- `rides.service.ts` is at 481/500. #17 extends `GET /rides/:rideId`; the extension starts with an
  extraction, not an addition.
- Create the hardware follow-up issue before planning #17, and decide whether #17's own manual steps go on
  it too — they will have the same blocker.
