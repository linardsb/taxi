# System Evolution Review — Maps-based ETA for the tracking page, quantized cache (#87)

## Meta Information

- **Plan**: `.claude/plans/tracking-eta-maps-quantized-cache.md`
- **Execution report**: `.claude/reports/tracking-eta-maps-quantized-cache-report.md`
- **Code review**: `.claude/code-reviews/pr-93-review.md`
- **Shipped**: PR #93 (merged `eb1fa3f`) · review fixes PR #95 (merged `d45ad17`) · follow-ups issue #94
- **Date**: 2026-08-11

## Overall Alignment Score: 9/10

The code was correct on the first pass. Every divergence in the report is justified, documented, and was
read as intentional by the reviewer — the deviations section did its job. The gate was green at real CI
parity, and the implementer volunteered a mutation check the plan never asked for.

The deduction is not for a divergence. It is for the one thing that **went wrong by following the plan
faithfully**: the plan asserted two quantitative claims that were false, the implementation copied them
verbatim into docblocks, and nothing between planning and merge could catch them. See "The defect that
adhered to the plan" below — it is the most important finding here and the only one that reached `main`.

## Divergence Analysis

```yaml
divergence: built in a git worktree, not the shared checkout
planned: no location specified
actual: /Users/Berzins/Desktop/taxi-tracking-eta
reason: two other sessions live in ~/Desktop/taxi; Twilio held uncommitted edits to
        notifications.module.ts, which this ticket also edits
classification: good ✅
justified: yes
root_cause: missing context — no skill tells the agent to check for concurrent sessions
```

```yaml
divergence: branch repair — #86's vehicle-stamp commit landed on this branch
planned: n/a
actual: moved to feature/api-ride-vehicle-stamp (fast-forward), this branch reset to main
reason: cutting the branch in the shared checkout put HEAD on it seconds before another
        session committed
classification: good ✅ (the recovery) / ❌ (the cause)
justified: recovery yes; the situation should not have arisen
root_cause: missing context — same as above, one step earlier
```

```yaml
divergence: fallback-warn assertion shape
planned: toHaveBeenCalledWith({… message: expect.any(String)})
actual: sorted Object.keys() equality + toMatchObject
reason: expect.any() is any-typed and trips no-unsafe-assignment inside an object literal —
        a lint ERROR in this repo
classification: good ✅
justified: yes — and the substitute is strictly stronger (it proves no coordinate can hide
           in the payload, which objectContaining cannot)
root_cause: unclear plan — the plan specified an assertion it never lint-checked
```

```yaml
divergence: two spec helpers the plan did not list (acceptedRide, moveDriver)
planned: three integration cases, helpers unspecified
actual: shared setup helper + moveDriver asserting locations.record() returned true
reason: the in-memory store answers false for a driver it believes offline and silently keeps
        the OLD position — surfacing three assertions later as an unexplainable ETA
classification: good ✅
justified: yes — the reviewer singled this out as instinct the plan lacked
root_cause: none — this is the implementer improving on the plan
```

```yaml
divergence: module imports kept alphabetical
planned: append GeoModule at the end
actual: [DriversModule, GeoModule, PlatformConfigModule]
classification: good ✅
justified: yes — matches the file as it already was
root_cause: unclear plan — literal instruction over local convention
```

### The defect that adhered to the plan

Neither review pass found a code defect. Both found the same thing independently: **two comments and the
plan asserted quantitative guarantees the code does not provide.**

- *"a hostile poller adds none at all"* — false by two mechanisms in `CachingMapsProvider` the claim never
  considered: no in-flight coalescing, and failures are never cached.
- *"~15 s at the speed above"* — the due-N/S **best** case presented as the worst, because the arithmetic
  divided only by the 111 m latitude axis and ignored the 61 m longitude axis the same docblock stated
  three lines earlier. True worst ~7.7 s; a ~2× reduction, not the ~3× implied.

Both originated in the **plan** (`:23`, `:336`), written before any code existed. The implementation
propagated them into docblocks correctly — that is what faithful execution does with a wrong premise.

This is not cosmetic. Plan `:30` de-scoped rate limiting on `GET /track/:token` **on the strength of the
false claim**. A documented decision rested on incorrect information, and the artifact that documented it
made it look settled.

```yaml
divergence: none — the code matched the plan exactly
planned: quantize the origin; claim the properties above
actual: quantized the origin; repeated the claims
classification: bad ❌ (the claims, not the code)
justified: no
root_cause: MISSING VALIDATION — no gate anywhere in the loop checks a prose claim against
            the code it describes. typecheck/lint/test cannot see a comment.
```

### Process incidents (post-report — the report was written 14:34, these followed)

```yaml
incident: two concurrent sessions on one branch, mid-merge state left behind
detail: Session A ran `git merge origin/main`, resolved the tracking spec conflict by hand,
        then stopped WITHOUT staging or committing — leaving 27 staged files and an unmerged
        index. Session B (piv-fix-review-findings) spent ~6 tool calls diagnosing it, then was
        mid-`git add`/`commit` when Session A committed first at 15:30:32.
outcome: no work lost. Session A's commit was better — it caught a fixture-index collision
        (onlineDriver(n) POSTs a new vehicle per call, rider(n)/p(n) are fixed phones), moving
        #87's cases to drivers 6/7/8, riders 58/59/60.
root_cause: missing validation — piv-implement says "already on a feature branch or in a
            worktree → use it" and neither it nor piv-fix-review-findings checks whether the
            worktree is mid-merge, mid-rebase, or dirty before starting.
note: memory taxi-concurrent-sessions.md PREDICTED this class. Prediction in memory did not
      prevent it, because nothing in the skills reads it as a precondition.
```

```yaml
incident: PR merged while its review findings were being fixed
detail: PR #93 merged 15:39 — after the review was read and fixing had begun, before the push.
        The fixes could not land on #93 and needed a second PR (#95).
root_cause: missing validation — piv-fix-review-findings step 4 says "commit them and push so
            the PR reflects the fixes and the review can re-run on the updated PR". It ASSUMES
            the PR is open and never checks. piv-review-pr already has exactly this guard
            (SKILL.md:27 — "State guard: MERGED/CLOSED → stop"); the sibling skill lacks it.
```

```yaml
incident: the review recommended a fix that violated the PR's own acceptance criteria
detail: finding M2 prescribed adding a miss-path log to CachingMapsProvider. AC #5 of the same
        plan reads "no changes to packages/shared, CachingMapsProvider, or the SMS ETA path",
        and the plan's context list says "do NOT modify this file" for that exact path.
root_cause: unclear skill — piv-review-pr:32 reads the plan, but only to treat documented
            deviations as intentional. Nothing tells it to check its own PROPOSED FIXES against
            the plan's stated constraints.
caught_by: triage in piv-fix-review-findings ("a review is input, not a work order")
```

## Pattern Compliance

- [x] **Followed codebase architecture** — seam discipline exact: `MAPS_PROVIDER` injected from the geo
      barrel, not a deep path, no SDK import. Both sides of the new dependency documented (module docblock
      + the geo barrel's injector inventory), honouring that file's own "a lie about ownership" rule.
- [x] **Used documented patterns** — `CountingMapsProvider.failNext()` mirrors `RecordingPaymentsProvider`;
      the fallback warn mirrors `denied()`; no money, no status writes, no payment-method surface touched.
- [x] **Applied testing patterns correctly** — ≥1 expected + 1 edge + 1 failure at both unit and
      integration level, per the root rule. Tests verified load-bearing by mutation, not assumed.
- [x] **Met validation requirements** — 20/20 turbo tasks with `REDIS_TEST_URL` set, so both Redis suites
      ran rather than `describe.skip`. Genuine CI parity, and the report says so explicitly.
- [ ] **Manual validation (Level 4) could not be performed as written** — "poll twice within 5 s, server
      logs must show no second route call". `features/geo/` has no `Logger`, no counter, no metric, so
      there is no such line. The report honestly marked it not-run; nothing in the loop noticed the plan
      had specified an *unperformable* step.

## System Improvement Actions

**Update CLAUDE.md:** ✅ **ACTED ON**

- [x] Add a hard rule that a quantitative claim in a comment, plan, or PR body is a checkable assertion —
      show the derivation, and name which case a figure describes. This is the root cause of both
      substantive review findings and the only defect that reached `main`.

**Update `piv-fix-review-findings`:** ✅ **ACTED ON**

- [x] Add a PR-state guard before the fix loop, mirroring `piv-review-pr:27`. If the PR is `MERGED`/`CLOSED`,
      say so up front and confirm the landing route (follow-up PR vs. direct) instead of discovering it at
      push time.

**Update `piv-review-pr`:** — not acted on (logged)

- [ ] When proposing a fix, check it against the plan's ACCEPTANCE CRITERIA and CONTEXT REFERENCES for a
      "do NOT modify" constraint. A fix that breaks the PR's own AC should be filed as a follow-up, not
      recommended inline.

**Update `piv-plan-implementation`:** — not acted on (logged)

- [ ] Level 4 manual steps must be *performable with what this ticket ships*. A step that reads server logs
      requires the ticket to emit one; otherwise the step is a validation that silently never happens.

**Update `piv-implement` + `piv-fix-review-findings`:** — not acted on (logged)

- [ ] Precondition check: refuse to start when the worktree is mid-merge/mid-rebase or the index holds
      another session's staged work. `git status --porcelain` + a `MERGE_HEAD`/`REBASE_HEAD` probe via
      `git rev-parse --git-dir` (**not** `.git/` — in a worktree `.git` is a *file*, which gives a false
      negative and cost real time this session).

## Key Learnings

**What worked well:**

- **Two independent review passes converged on the same finding.** Agreement between a fresh-context pass
  and the `code-reviewer` agent is the signal that made H1 credible enough to act on.
- **Triage as a first-class step paid for itself.** "A review is input, not a work order" is what caught
  that the reviewer's own M2 fix would have broken the PR's AC #5. A skill that fixed findings obediently
  would have shipped that.
- **Deviation reporting worked.** All five divergences were documented, and the reviewer explicitly
  credited two of them rather than flagging them.
- **Worktree isolation worked** — once adopted. Deviations 1–2 are the cost of not having it from the start.

**What needs improvement:**

- **Prose is the only unguarded artifact in the loop.** typecheck, lint, test and build all pass while a
  docblock asserts something the code contradicts. In a codebase whose house style is dense, reason-giving
  comments, that is a large and permanently unverified surface — the more the comments explain, the more
  they can be wrong about.
- **A plan's numbers are inherited, not audited.** The implementer copied `~15 s` from the plan; the
  reviewer re-derived it and found it wrong. Nothing between those two points would have.
- **Memory predicts what skills don't prevent.** `taxi-concurrent-sessions.md` described this exact
  collision class before it happened. It fired anyway, because nothing turns a memory into a precondition.

**For next implementation (#88 or #13):**

- Carry the two edits made here; watch whether the PR-state guard ever fires again.
- #94 is a hard prerequisite of binding Google, which happens in #13/#16 — the cross-links are posted on
  both issues, since `geo.module.ts:12-13` points there and nothing pointed back.
- If #13: the maps-seam work in #94 lands *before* a real provider is bound, not after.
