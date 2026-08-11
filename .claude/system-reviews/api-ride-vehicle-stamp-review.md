# System Evolution Review — Record the vehicle on the ride at acceptance (#86)

## Meta Information

- Plan reviewed: `.claude/plans/api-ride-vehicle-stamp.md`
- Execution report: `.claude/reports/api-ride-vehicle-stamp-report.md`
- Additional inputs: `.claude/code-reviews/pr-90-review.md` (APPROVE — 0 Critical/High/Medium, 2 Low),
  the findings-triage comment on PR #90 (both Lows deferred per the review's own recommendation → issues #91, #92)
- Shipped: PR #90, merged `69cc5e3` (2026-08-11)
- Date: 2026-08-11

## Overall Alignment Score: 9.5/10

One-pass COMPLETE; the plan's 9.5/10 confidence delivered almost exactly. Every code-level divergence was
micro, documented, and confirmed intentional by the fresh-context PR review ("all documented deviations check
out"). Zero undocumented deviations, zero planned-but-not-landed items — both failure classes the previous
system review (#63) found and patched the skills against. The half-point deduction: two factual imprecisions
in the plan about *existing* code (a route's status code; an unnecessary cast in a snippet). The real findings
of this loop are environmental, not plan-shaped — three concurrent sessions sharing one checkout produced
every issue the report logs.

## Divergence Analysis

```yaml
divergence: DELETE /drivers/me/vehicles/:id asserted as 204, not the plan's 200
planned: "DELETE … → 200" (Step-by-step task, integration case 3)
actual: controller has @HttpCode(204); test asserts 204
reason: plan was imprecise about the existing route's response code
classification: good ✅
justified: yes
root_cause: plan stated a checkable fact about existing code without reading it (the decorator).
  SECOND instance of this class — #63's review logged "uniqueness claims verified by grep, not
  comments" with the condition "codify if it recurs". It recurred.
```

```yaml
divergence: `as RideRequestBody` cast dropped from the limo booking body
planned: pattern snippet included the cast
actual: eslint flagged it unnecessary; removed (+2 mechanical formatting fixes, same source)
reason: lint gate
classification: good ✅
justified: yes
root_cause: same class as above, trivially absorbed by the pipeline — no action beyond the plan-skill line
```

```yaml
divergence: two commits instead of one
planned: (implicit) one implementation commit
actual: mid-implementation checkpoint of Phases 1-3, then Phase 4
reason: a concurrent session switched the shared checkout's branch under this session; a commit
  transiently landed on feature/tracking-eta-maps-quantized-cache and needed compare-and-swap ref
  repair; work then moved to a worktree
classification: good ✅ (the response), environmental (the cause — see Process Incidents)
justified: yes
root_cause: no repo asset told the session to take a worktree from the START when other sessions are live
```

Non-divergence worth recording: the plan's one named residual risk (drizzle's `${vehicles} as v` aliasing,
the 0.5 in its confidence score) did not materialize — and the plan had pre-specified the fallback anyway.
That's the right way to carry a known unknown.

## Process Incidents (environmental — the meat of this review)

None of these are plan or implementation defects; all four trace to **multi-session mode having no repo-level
codification** (it lived only in the assistant's private memory, invisible to other sessions and to the skills):

1. **Branch collision + ref surgery** — the shared checkout's branch changed under the session twice; one
   commit landed on the wrong branch and was repaired with compare-and-swap ref updates. Highest-risk event
   of the whole slice: a botched repair loses another session's work.
2. **Worktree compose pothole (recurring)** — `@taxi/db`'s `pretest` runs `docker compose up` with the
   project named after the worktree directory → second Postgres fights for the occupied 5432. Fixed with
   `COMPOSE_PROJECT_NAME=taxi`; a stale `taxi-46-idempotency-db-1` container from an *earlier* session's
   worktree proves ≥2 occurrences. The report itself flags this as "worth a system-review note".
3. **Cross-session test-DB drop mid-gate** — one gate run failed with another session's global-setup
   `DROP DATABASE … WITH (FORCE)` signature; the identical rerun was 20/20 green (logged in the PR review's
   validation section as "not a PR defect").
4. **Dev-DB migration skew** — this session migrated to 0008 while sibling checkouts carried 0007. Harmless
   here because the column is additive/nullable; a class to watch, not yet codify (one instance).

## Verification of the previous loop's fixes (#63 review)

- **piv-implement "diff the plan before writing Deviations"** → worked. Three deviations documented,
  PR review found zero undocumented ones (vs #63's one). The step demonstrably surfaces what recall missed.
- **piv-plan-implementation "every edge case names its verifier"** → worked. This plan's Edge Cases section
  maps each case to a numbered integration test or names its implicit coverage; nothing evaporated.
- **"Test runner for apps/dispatch before #18" (recommended, not applied then)** → in flight:
  `.claude/plans/dispatch-test-runner-vitest-rtl.md` exists. The recommend-then-act loop is functioning.

## Pattern Compliance

- [x] Followed codebase architecture — single-writer invariant *extended* rather than bypassed (`assignDriver`
  stamps both assignment columns); zero dispatch-slice edits exactly as planned; VSA respected
- [x] Used documented patterns — L8 "checks inside the UPDATE" (`setOnlineIfEligible` precedent), never-throw
  `driverCard` contract preserved and re-documented, `paymentProviderRef` precedent for keeping the column
  off `rideSchema`
- [x] Applied testing patterns — (expected)/(edge)/(failure) with AC refs, E.164 range discipline, cleanup
  contract, 143-test free regression net predicted by the plan and confirmed by the review
- [x] Met validation requirements — full `--force` gate with `REDIS_TEST_URL`, 20/20; review re-ran it
  independently in an isolated worktree

## System Improvement Actions

**Applied now (the "act on 1–2" of this loop) — both codify multi-session mode into repo assets:**

1. **Update root `CLAUDE.md` (Commands section)** — concurrent-sessions paragraph: check `git reflog -8`
   before branch moves; another live session → worktree from the start; worktree gate needs
   `COMPOSE_PROJECT_NAME=taxi`; integration runs are mutually destructive across sessions. This is the only
   asset every session loads — widest reach for the rule that would have prevented incidents 1–3.
2. **Update `piv-implement` SKILL.md ("Before you start")** — a fourth branch-state case: another session
   live in the checkout → `git worktree add` and implement there from the start, with the
   `COMPOSE_PROJECT_NAME=taxi` gate note and stray-container cleanup. This is the exact decision point where
   this slice chose "share the checkout" and paid for it.

**Recommended, not applied (fold into the next loop):**

- **`piv-plan-implementation` SKILL.md**: add to Phase 2 — "when a task asserts a fact about existing code
  (a route's status code, a uniqueness/registry claim, an env allowlist), verify it by reading the code —
  decorators included — not from a comment, a sibling plan, or memory." The #63 review's "codify if it
  recurs" condition has now fired (E.164 registry comment then, `@HttpCode(204)` now). First candidate for
  the next loop's apply slot.
- **Migration discipline in multi-session mode**: while several sessions share one dev DB, prefer
  additive/nullable migrations and note skew in the report (as this slice did). One instance, harmless —
  watch, don't codify yet.

## Key Learnings

**What worked well:**

- The plan's ★-starred Open Questions format ("the plan proceeds on this resolution; override before
  execution if wrong") let a genuinely contestable call — `assignDriver` over the ticket's literal
  `claimDriver` wording — ship one-pass with no user round-trip, and gave the reviewer the rationale
  pre-written. Same for the SET-NULL-vs-RESTRICT-vs-denormalize decision.
- Extending an existing invariant beat adding a mechanism: putting the stamp inside the already-race-guarded
  single-writer UPDATE meant race-safety was *inherited, not re-proven* (the review's words), and the
  signature freeze made "zero dispatch edits, zero fake edits" a checkable plan promise.
- The "free regression net" prediction (existing 143 rides/dispatch tests exercise the new subquery because
  every fixture driver owns one vehicle) held — cheap, plan-time reasoning that bought real coverage.
- The review → triage loop stayed proportionate: two Lows, both deferred with issues (#91, #92) per the
  review's own recommendation — no churn, no gold-plating.

**What needs improvement:**

- Multi-session discipline lived in private assistant memory, not in any asset other sessions read — every
  incident this slice logged follows from that gap. (Fixed this loop.)
- Plans still occasionally state facts about existing code from adjacent context instead of the source —
  twice now; the pipeline absorbs it cheaply, but the plan-skill line is one sentence. (Queued.)

**For next implementation:**

- Take the worktree at the *start* when `git reflog` shows another live session — watch whether the
  collision class disappears.
- Apply the plan-skill verify-facts line if its slot is free next loop.
