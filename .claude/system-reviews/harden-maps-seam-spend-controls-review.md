# System Evolution Review — harden the maps seam with spend controls and a counter (#94)

## Meta Information

- **Plan**: `.claude/plans/harden-maps-seam-spend-controls.md`
- **Implementation report**: `.claude/reports/harden-maps-seam-spend-controls-report.md`
- **Execution report**: `.claude/execution-reports/harden-maps-seam-spend-controls.md`
- **Code review**: `.claude/code-reviews/pr-99-review.md`
- **Shipped**: PR #99 (merged `5b3911e`, 2026-08-11 18:04 UTC) · follow-ups issue #100
- **Predecessor**: #87 (`tracking-eta-maps-quantized-cache-review.md`) — #94 exists *because* of its gaps
- **Date**: 2026-08-11

## Overall Alignment Score: 8/10

The code was correct on the first pass again — no Critical or High findings, and the reviewer credited
four separate design decisions as argued rather than asserted. Every implementation divergence was
documented and read as intentional. The review round's own divergences (R1–R3) were judgment calls in
the right direction, including one where the reviewer's minimal fix was **too small** and the fixer
correctly went past it.

Two points off, both process rather than code:

- **R4** — the fix round's first sweep found 2 of 5 sites carrying a stale figure. It took a second
  commit, and one of the misses was the **PR body**.
- **The Level 4 gap recurred from #87, unaddressed.** That review logged it as "not acted on"; this
  slice hit it again, and this time it swallowed the ticket's own success condition.

**The most important thing this slice proves: #87's CLAUDE.md edit worked.** The claims rule is
visible in the output — every docblock says "bounds", never "closes", and the reviewer said so
explicitly. It did not stop claims from being *wrong* (three still were), because a rule is not a
check. But it changed how they were written, and that is what made the wrong ones findable.

## Divergence Analysis

Implementation-phase divergences (1–8) are recorded in the implementation report; all eight were
justified and the reviewer credited three of them. These are the review round's.

```yaml
divergence: L1 escalated from "add a test" to a code change (safeErrorName)
planned: the review asked for one key-set case for geo.maps.route_failed
actual: the case PLUS a letters-only filter on the provider-controlled error.name
reason: errorName was logged raw while the docblock beside it claimed it could not contain a
        coordinate. `name` is a writable own property, so it could. The test as specified — with
        a benign Error — would have PASSED with the hole open.
classification: good ✅
justified: yes — writing the test as asked would have shipped a passing test of a false claim,
           the exact failure mode #87's CLAUDE.md rule exists to stop
root_cause: unclear review — the finding under-scoped itself. It named the hole ("an adapter
            that sets err.name = 'route 56.9,24.1 failed'") and then prescribed a fix that
            would not have caught it.
```

```yaml
divergence: M2 split — docblock fixed now, client work deferred
planned: the review offered "a 429 branch in both files … either that, or soften the docblock"
actual: took the second option; filed the first as #100
reason: the false docblock claim is inside this PR and is this PR's debt. The client work is
        apps/dispatch — a surface the PR never touched — needing i18n across three catalogs
        plus RTL tests, and nothing is reachable today (the source factory refuses to boot
        under NODE_ENV=production).
classification: good ✅
justified: yes — "a clean small PR beats a sprawling one", and the review itself said M2
           belongs with #13/#16
root_cause: none — triage working as designed
```

```yaml
divergence: L4 declined despite the review calling it optional-and-tiny
planned: .positive() → .nonnegative() on MAPS_ETA_FAILURE_TTL_SECONDS
actual: recorded in #100 with its reasoning, not implemented
reason: the scenario it serves is unreachable while no real provider is bound, and done
        properly it is the schema change PLUS a docblock PLUS an env.schema.spec.ts case, on
        a PR already at +1890
classification: good ✅
justified: yes
root_cause: none — scope discipline
```

```yaml
divergence: a second commit was required for stale figures
planned: n/a — the fix round should have been one commit
actual: 822bdcb corrected the plan's task spec (line 282), the implementation report's gate
        figures, and the PR body — after 1ce2548 had already "fixed" the same claim
reason: the first sweep grepped for "429" and the exact phrasing. The stale values were a
        VIEWER COUNT and a TEST TOTAL; neither contains the string "429".
classification: bad ❌
justified: no
root_cause: MISSING VALIDATION — nothing in piv-fix-review-findings says that correcting a
            number means finding its copies, and no grep over the working tree can reach the
            PR body at all.
```

### The recurrence: Level 4 steps that cannot be performed

This is the finding that matters most, because it is the **second slice in a row**.

#87's review wrote, under *not acted on (logged)*:

> Level 4 manual steps must be *performable with what this ticket ships*. A step that reads server
> logs requires the ticket to emit one; otherwise the step is a validation that silently never happens.

#94's plan then specified four Level 4 steps (2, 3, 6, 7) that could not be performed — this time not
for a missing log line but for a **missing tracking token**: tokens are minted by the booking flow,
never by the seed, so any step needing a live ride requires the full OTP → book → dispatch → accept →
GPS-ping chain against a running server.

The cost is precise and it is not hypothetical. **Step 3 is #94's own success condition** — confirm a
single `geo.maps.route_fetched` per cell crossing rather than one per poll. It is the check #87 could
not perform *at all* because the counter did not exist; #94 built the counter specifically so it could
be performed; and it still has not been. The slice merged with its headline claim test-verified but
never field-verified.

```yaml
divergence: none — the plan was followed
planned: Level 4 steps requiring an active ride with a tracking token
actual: steps 4 and 5 performed live; 2, 3, 6, 7 not performed, honestly reported
classification: bad ❌ (the plan, not the execution)
justified: the decision not to fake it was correct; the plan specifying it was not
root_cause: MISSING VALIDATION, recurring — nothing checks that a manual step's preconditions
            can be produced by the system as it exists. Logged after #87, not acted on, fired
            again in #94.
```

## Pattern Compliance

- [x] **Followed codebase architecture** — seam discipline exact. Two facades over one source, both
      bound in `geo.module.ts`, nothing imported past `features/geo/index.ts`. `packages/shared` took
      a docblock change and **no type change**, which is why caller attribution cost zero cross-surface
      churn.
- [x] **Used documented patterns** — the throttle mirrors `rides.service.ts`'s INCR-then-check exactly,
      including the `Math.max(1, ttl)` and the 429 body shape; no endpoint in this codebase sets
      `Retry-After`, and this one doesn't either.
- [x] **Applied testing patterns correctly** — ≥1 expected + 1 edge + 1 failure per feature. Both review
      fixes were verified **by flipping**: the three new cases run against the pre-fix provider fail
      3/14; L3's assertion without its `advance(61)` fails 7-vs-8. Proof, not self-agreement.
- [x] **Met validation requirements** — 21/21 turbo tasks at real CI parity with `REDIS_TEST_URL` set,
      so no suite silently `describe.skip`ped.
- [ ] **Manual validation (Level 4) incomplete for the second consecutive slice** — see above.
- [x] **Slice boundaries respected under pressure** — the L3 fix wanted `routeFailureKey` in the
      notifications integration spec; that is past `features/geo`'s public API, so the assertion was
      rewritten to use existing helpers instead. The boundary held when it was inconvenient, which is
      the only time it counts.

## System Improvement Actions

> **Nothing below is applied.** Per the repo's own rule, act on **1–2**, not all — and this session
> makes no edit to any rules or skills file without your approval.

**Update CLAUDE.md: NOTHING PROPOSED — deliberately.**

The rule that governs this slice's worst moment already exists, in bold, and #87 put it there:
*"A number or a guarantee in a comment, plan or PR body is a claim, not decoration."* It did not fail
for being unwritten. It failed for being applied to one file and not the other four. Adding text here
would grow the rules file without changing the outcome — and `rules-check-drift` exists precisely to
keep that file true rather than longer.

**① Update `piv-fix-review-findings` — sweep by VALUE, not by keyword.** ← recommended

The single cheapest, highest-value change available. Suggested text for step 2:

> **When a fix changes a number or a guarantee, find its copies before you commit.** Grep for the
> *value* (`455`, `10 concurrent`), not the topic word — the stale copy usually does not contain the
> word you fixed. Check the plan, the implementation report, the docblocks, and — separately, because
> no working-tree grep can reach it — **the PR body**, which is the first thing the next reviewer
> reads and the number they will re-run the gate against.

Evidence: 3 of 5 sites, including the PR body, survived the first pass in this slice.

**② Update `piv-plan-implementation` — Level 4 steps must be performable.** ← recommended (carried from #87)

Not a new idea; #87 logged it and it was not acted on, and the cost went up. Suggested text:

> Every Level 4 manual step must be performable **with what this ticket ships and what the seed
> provides**. If a step needs live state the seed cannot produce (a tracking token, an accepted ride,
> a driver position), the ticket must either ship the means to produce it — a script, a seed row, a
> dev route — or the step must be rewritten against state that exists. A step nobody can run is a
> validation that silently never happens.

**③ Create a skill or dev script: mint a live tracking ride.** — logged, not recommended for now

The concrete unblocker for #94 step 3 and for #63/#87/#17 after it: drive OTP → book → dispatch →
accept → GPS pings → poll, and print the token. The integration harness already does exactly this, so
the logic exists and is proven. Worth building the first time a *third* ticket needs it; two is not
yet a pattern.

**④ `piv-validate`: distinguish environment failure from test failure.** — logged

Three stalls this slice were environment: the worktree compose-project collision on 5432, the Redis
6379 shadowing, and colima dying mid-gate. The last produced a red `@taxi/db#test` whose actual message
was `Cannot connect to the Docker daemon` — turbo then killed every sibling task, so the output looked
like a broad code failure. Memory `taxi-stop-hook-checks-main-repo.md` already predicts this exact
class; nothing in the loop reads it.

## Key Learnings

**What worked well:**

- **#87's CLAUDE.md rule visibly changed the writing.** Every claim about the throttle says *bounds*,
  never *closes*, and the reviewer named that as the thing keeping the PR honest. One-line rule, two
  slices later, measurable effect.
- **#87's PR-state guard is load-bearing and nearly fired.** Step 0 found #99 OPEN; it merged shortly
  after the fixes were pushed. In #87 that same race cost a second PR. The guard is now the reason it
  didn't.
- **Triage kept the PR clean under pressure to widen it.** Two of six findings were deferred with
  stated reasoning rather than fixed reflexively, and the deferred ones went to a real issue (#100)
  with the failure scenario written down, not a TODO.
- **Flip-verification is now habitual.** Both fixes were run against the code they fix and shown to
  fail. That is the only evidence that separates a real regression test from a passing decoration.

**What needs improvement:**

- **A correction is not finished when the code is.** Numbers propagate into plans, reports, docblocks
  and the PR body, and this loop has no step that follows them. The claims rule tells you not to write
  a false number; nothing tells you to chase the copies when you fix one.
- **Logged-but-not-acted findings decay into recurrences.** #87 produced five improvement items and
  acted on two, which is exactly what CLAUDE.md prescribes. But the Level 4 item then fired again at
  higher cost. The 1–2 rule is right; what is missing is a re-read of the *previous* review's unacted
  list when the next slice in the same area starts.
- **The one check only a human can run is the one that keeps not happening.** Step 3 has now been
  open across two tickets. It is not a documentation gap — the reports flag it clearly each time — it
  is that nothing makes producing the preconditions cheap.

**For next implementation (#100, or #13/#16):**

- Read this review's unacted list *first*. That is the concrete answer to the decay problem above,
  and it costs one file read.
- #100 carries M2's client work and L4; both are gated on the same trigger as #13/#16, so folding them
  into that ticket is likely cheaper than a standalone pass.
- If #13/#16 binds the real Google provider: `geo/index.ts`'s KNOWN GAPS names **in-flight coalescing**
  as the remaining spend gap, and it is real — the throttle bounds that path and closes nothing.
  Measure the concurrency shape against a real bill before choosing a design.
