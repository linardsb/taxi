# PR #215 review — round 1

**Head** `f188264` · **Base** `main` @ `0cdb59c`
**PR** docs(rules): re-observe the Redis-gated test line at 0cdb59c (#214) · `docs/redis-gated-line-214` · +2/−2, 1 file
**Verdict** ✅ **Approve** — no Critical, no High. Two Mediums and three Lows, all in the PR body or its
surrounding bookkeeping; the shipped diff itself is correct.

## Summary

Every figure this PR ships or cites was re-run here, not read. **All of them reproduce exactly.** The stamp,
the four-file table, the per-file split, the gate and the reconciliation are all `observed` and all correct.
That is the substance of the review, because a two-line markdown diff has no code to review.

The five findings are in the *supporting* claims: one open remedy row this PR silently discharges without
closing, one quoted command whose real output is not what the body says it is, and three Lows.

**Two procedural notes, stated so round 2 is triggerable:**

- **The guarantees pass was skipped** — no prior `.claude/code-reviews/pr-215-review*.md` exists, so this is
  round 1. For the record, the base's live tip (`git rev-parse origin/main` after `git fetch origin`) is
  `0cdb59c`, equal to `baseRefOid`; `mergeStateStatus` is `CLEAN`. Nothing moved under this PR.
- **The `code-reviewer` agent was not dispatched.** Its brief is code against Sakta Cab's standards — strict
  TS, shared contracts, the state machine, integer cents, VSA, logging, i18n/a11y. The diff is two lines of
  markdown and compiles nothing, so there is no surface for it. The numbers pass *is* the review here, and it
  was run by hand against live runs rather than delegated.

## Validation

All runs made in `/Users/Berzins/taxi-worktrees/wt-214` at head `f188264`. `f188264`'s parent is `0cdb59c`
and its only diff is `CLAUDE.md`, so the tree under test is byte-identical to the base the stamp names — the
runs below measure exactly what the PR claims to have measured.

| Check | Result |
|---|---|
| Gate — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` | ✅ exit 0 · `Tasks: 22 successful, 22 total` · `Cached: 0 cached, 22 total` · `1m24.097s` |
| The stamp — `env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test` | ✅ exit 0 · `Test Suites: 2 skipped, 75 passed, 75 of 77 total` · `Tests: 39 skipped, 694 passed, 733 total` |
| The four-path run — same command, four gated specs only | ✅ exit 0 · `Test Suites: 2 skipped, 2 passed, 2 of 4 total` · `Tests: 39 skipped, 9 passed, 48 total` |
| CI checks (`gh pr checks 215`) | ✅ 5/5 — `CodeQL`, `audit-diff`, `check` (3m7s), `codeql`, `ready` |

**The stamp reproduces to the digit.** Both output lines the PR writes into `CLAUDE.md:43` are exactly what
the command printed here, independently of the author's run.

**The gated-run half reconciles too**, which is the cross-check the PR body claims: the gate's `@taxi/api`
task printed `Test Suites: 77 passed, 77 total` · `Tests: 733 passed, 733 total`, and 39 + 694 = 733,
75 + 2 = 77.

**The per-file table was re-derived from this run's own `--json`**, not copied:

| gated spec file | skipped | passed | suite |
|---|---|---|---|
| `src/common/kv/redis-kv.store.spec.ts` | 5 | 0 | skipped |
| `src/features/dispatch/queue/redis-dispatch-queue.store.spec.ts` | 12 | 0 | skipped |
| `src/features/drivers/location/redis-driver-location.store.spec.ts` | 16 | 3 | ran |
| `src/features/realtime/redis-io.adapter.spec.ts` | 6 | 6 | ran |

Identical to the PR body's, row for row.

**The structural digits hold, and I checked their actual basis rather than the totals.** "2 of which hold
nothing else" is a claim about file contents, not run output, so it was read:
`redis-kv.store.spec.ts` has only `describeWithRedis` blocks (`:14`, `:58`) and
`redis-dispatch-queue.store.spec.ts` only one (`:22`) — no ungated top-level `describe` in either. The other
two carry ungated blocks (`redis-driver-location.store.spec.ts:18`,
`redis-io.adapter.spec.ts:129,406`), which is why they report as *ran*. ✅

**The diagnosis paragraph's mechanism was re-verified**, since the PR edits that line:
`test/harness.ts:529` is `const kv = new InMemoryKeyValueStore()` and `:541–542` is
`.overrideProvider(KV_STORE).useValue(kv)`. `CLAUDE.md`'s claim that the harness rules out the Redis reading
is true, and issue #214's fourth checkbox ("leave it alone unless a run contradicts it") is correctly
honoured. ✅

**`ci.yml:44`** still reads `REDIS_TEST_URL: redis://localhost:6379`. The trailing "CI sets it" clause is
re-observed, unchanged. ✅

## Findings

### F1 · Medium · `.claude/system-reviews/REMEDY-LEDGER.md:47` — an **open** remedy row this PR discharges without closing

Ledger row **L19**, under `## Open` (`:41`, above `## Closed this loop` at `:49`), is exactly this ticket:

> CLAUDE.md's Redis-skip figure has drifted again. It states `33 skipped, 582 passed, 615 total` /
> `2 skipped, 64 passed, 64 of 66 total` at `feed712` … logged rather than edited in passing

Its verification column is `stale — grep -n "33 skipped" CLAUDE.md`. After this PR that grep returns nothing,
so the row's own evidence command no longer describes reality, and a forward reader of the ledger is told to
do work that is already done.

The PR body's *Not done* asserts the opposite:

> The historical hits for `feed712` and `33 skipped, 582 passed` elsewhere in the tree are all under
> `.claude/code-reviews/`, each stamped at its own head, and are left as written.

`observed` — that is not where they are. `grep -rn "feed712" --exclude-dir=node_modules --exclude-dir=.git .`
returns hits in **five** directories, `.claude/code-reviews/` being a minority of them:

```
.claude/code-reviews/     (3 files)   .claude/reports/          (5 files)
.claude/execution-reports/(2 files)   .claude/system-reviews/   (3 files)
```

and the `33 skipped|582 passed|615 total|64 of 66` sweep adds `.claude/plans/connect-to-redis-partial-state-cleanup.md`.

Most of those genuinely are historical and correctly left alone — the plan hit at `:573` records what #211
inherited, the review and report hits are stamped at their own heads. **L19 is not.** It is an open action
item with a live verification command, in an artifact whose whole purpose is to be read forward.

**Fix — and note it has two halves on two different branches**, because `REMEDY-LEDGER.md` lives on `main`
and is not in this PR's diff:

1. **On `docs/redis-gated-line-214`** — correct the *Not done* sentence. "All under
   `.claude/code-reviews/`" is the justification that made leaving L19 look safe, and it is false.
2. **On `main`** — move L19 into a *Closed* section citing PR #215, or leave it under `## Open` with a status
   line saying it is discharged there. This review's own PR (#216) is already branched off `main` and has an
   obvious slot for that line, if you would rather not open a third branch for one row.

Running `piv-fix-review-findings` on this report will try to do both in one place; it cannot.

**Worth noting for F4's sake:** L19 already called this the "4th occurrence of this specific line drifting",
and carries a *fifth* version of the figure (`35 skipped, 660 passed, 695 total` at `c70572b`, 2026-09-04)
that the PR body does not mention exists. That does not change the tally decision — see *Documented
deviations* — but whoever closes L19 should read it before writing the closing line.

### F2 · Medium · PR body — the quoted repo-wide grep does not return what the body says it returns

The body writes:

> Four is the count repo-wide, not just in `services/api`:
> `grep -rl 'describe.skip\|describeWith\|describeIf\|itIf' services/api apps packages db` returns these four
> files and nothing more.

`observed` here at `f188264`, that exact command returns **8** paths, not 4 — the four spec files plus jest's
own copies:

```
services/api/node_modules/jest-circus/build/jestAdapterInit.js
services/api/node_modules/jest-circus/build/index.js
services/api/node_modules/jest-each/README.md
services/api/node_modules/jest-each/build/index.js
```

The **conclusion is true** — with `--exclude-dir=node_modules` appended, the same command returns precisely
the four spec files. But this grep is the *only* thing that establishes "nowhere else" (see F3), so it is
load-bearing, not decorative: a reader who runs the command as written to check the claim gets output that
contradicts the sentence quoting it.

**Fix:** add `--exclude-dir=node_modules` to the command as quoted in the PR body. Path-only exclusion, not
`| grep -v node_modules`, which eats content lines.

### F3 · Low · PR body — the count match is credited to the wrong mechanism

> 5 + 12 + 16 + 6 = 39, matching the whole-suite run's skipped count exactly — **so all 39 sit in these four
> files and nowhere else**, and the two with no ungated case are what produce the 2 skipped suites.

The arithmetic is right and the totals do match (re-derived above). The inference does not follow: equal
counts do not establish that the two sets are the same set. A fifth gated file contributing *n* skipped tests
while one of these four contributed *n* fewer would produce the identical total. What actually rules out a
fifth file is the repo-wide grep — which is F2.

This is the #107 shape the numbers pass exists to catch: sound arithmetic, truthfully labelled `observed`,
credited to a mechanism that cannot isolate what it is credited with. It is Low rather than Medium only
because the conclusion happens to be true and the correct support is already in the same paragraph.

**Fix:** attribute "nowhere else" to the grep and let the table stand as what it is — the per-file split of a
total already known to be complete.

### F4 · Low · `CLAUDE.md:43,45` — issue number where the sentence's convention is PR numbers

Both inserted references name **#214**, which is the issue:

- `:43` — "at #214's base `0cdb59c`" (a base belongs to a branch or a PR, not to an issue)
- `:45` — "33, correct until #214 re-observed 39" (the re-observation happened in PR #215)

The surrounding sentence's other references are PRs: `.claude/code-reviews/pr-120-review.md` and
`pr-121-review.md` both exist, so #120 and #121 are PR numbers. One sentence now mixes both conventions.

Navigable either way — #214 links to #215 — so this is polish, not a defect. **Fix:** `#215` in both, or
`#214/#215` if the issue is worth keeping visible.

### F5 · Low · `CLAUDE.md:45` — the `:454` citation and the verb "overrides"

The sentence reads "`test/harness.ts:454` **overrides** `KV_STORE` with `InMemoryKeyValueStore`". `:454` is
the first line of the doc comment describing the seven-provider swap; the override itself is `:541–542`, and
the `InMemoryKeyValueStore` construction is `:529`.

The PR body pre-empts this at length and the reasoning is sound — the sentence's job is to say *why* the
harness rules out the Redis reading, and the doc comment is what carries that ("between them, no ioredis
client is ever constructed"). I would keep `:454` too. The only thing that grates is the verb: a doc comment
does not override anything.

**Fix (preference, not a defect):** `test/harness.ts:454,541` — the comment for the mechanism, the call for
the verb. One token, and it survives the next reader who checks `:454` and finds prose.

## Documented deviations — not findings

Per the skill's Phase 2, these are decisions, and they are recorded in the PR body with reasoning:

- **The "wrong three times" tally is left at three.** The body states the decision, gives the rule it applies
  (the tally counts *defects in the fixes*, not staleness events), and explicitly invites an overrule. Issue
  #214's fourth checkbox supports leaving the paragraph alone. Correct handling; I agree with the reading —
  drift from suite growth across many tickets is not the same failure as #120's invented cause or #121's
  ruled-out diagnosis. Noted only because L19 counts it differently (F1).
- **`:454` kept over `:541`.** Drafted, reverted, and the reversal explained. See F5 for the one token I would
  still change.

## What's good

Several things here are the standard `CLAUDE.md` asks for and rarely gets:

- **The whole claim was re-observed, not the digits.** The two output lines, both structural digits, the stamp
  head, and the trailing `ci.yml` clause each got their own run or read. That is the instruction in the
  paragraph being edited, followed literally.
- **The `derived` deltas name their non-run source.** "+6 skipped, +112 passed, +118 total, +11 suites ·
  `derived` — subtraction of the two stamps; the retired one is the file's own prior text, not a run made
  here." Re-derived and correct (39−33, 694−582, 733−615, and 75−64 = 77−66 = 11). Exactly the provenance
  discipline the rules ask for, including the part most reports skip — saying which half was never run.
- **The stamp's condition is stated.** "The condition that figure assumes: a **built** workspace", with the
  actual `Cannot find module '…/@taxi/db/dist/index.js'` failure from the first attempt, and the observation
  that #121's stamp carried the same prerequisite unstated. A `derived`/`observed` figure that states what it
  assumes is the rule; this one also fixes a predecessor's omission.
- **The gate and the stamp are explicitly declared non-interchangeable**, then reconciled anyway
  (39 + 694 = 733, 75 + 2 = 77). Building a cross-check *between* two runs that measure different things, and
  saying so in the same breath, is better evidence hygiene than either run alone.
- **The issue's quoted figures were not pasted in.** The body says so and it is true — issue #214 explicitly
  asked for re-observation rather than a copy, and the numbers agree because the intervening commit is
  docs-only. That is the #87/#107 inheritance failure mode being refused on purpose.
- **`CLAUDE.md:45` was fixed because a run contradicted it.** Without it the file would assert 39 and 33 in
  adjacent paragraphs. Correctly scoped: the clause changed, the diagnosis did not.

## Recommendation

**Approve.** The shipped diff is correct and independently verified; validation is green on every surface. F2
and F1's first half are worth a follow-up commit **on this branch** before merge — F2 leaves a command in the
most-read surface that returns something other than what the sentence says, and F1's *Not done* sentence is
false as written. F1's second half (the L19 row) cannot land here at all; it is on `main`. Neither blocks:
F2's conclusion is true and the ledger row is bookkeeping outside this diff.

F3–F5 are optional polish. If only one thing lands, make it F1 — the ledger is read forward, and a stale
*open* row is the failure mode this whole paragraph exists to prevent.

---

*Round 1. Head `f188264`, base `main` @ `0cdb59c`. Guarantees pass skipped (no prior round; live tip equals
`baseRefOid`). Fix-mechanism pass not applicable (round 1).*
