# PR #215 review fixes — round 1

**Review** `.claude/code-reviews/pr-215-review.md` (round 1, approve, 0 Critical / 0 High / 2 Medium /
3 Low). It rides in **PR #216**, off `main` — the same branch this fix pass lands on.

**The PR the findings target is already merged.** PR #215 (`docs/redis-gated-line-214`) merged as `7179cc6`
on 2026-09-15; `origin/docs/redis-gated-line-214` is deleted. So the skill's normal path — commit the fixes
onto the reviewed PR — does not exist here, and the work splits across two surfaces:

| Finding | Surface | Where the fix landed |
|---|---|---|
| F1a | PR #215's **body** | `gh pr edit 215` — amended after merge, marked `[corrected #216]` |
| F1b | `.claude/system-reviews/REMEDY-LEDGER.md` (on `main`) | this branch, `docs/pr-215-review` |
| F2 | PR #215's **body** | `gh pr edit 215` |
| F3 | PR #215's **body** | `gh pr edit 215` |
| F4 | `CLAUDE.md:43,45` (on `main`) | this branch |
| F5 | `CLAUDE.md:45` (on `main`) | this branch |

The review itself anticipated the split (F1: "*Running `piv-fix-review-findings` on this report will try to do
both in one place; it cannot*") and named PR #216 as the slot for the `main`-side half. Amending a merged PR's
body was put to Linards as a decision before any of it ran, and approved: F2's command is the *only* copy of
that claim anywhere — no working-tree grep reaches it — so leaving it means a load-bearing command stays wrong
permanently.

**Ground check**, run at triage before any edit: `git status --porcelain` empty in
`/Users/Berzins/taxi-worktrees/wt-review215`; no
`MERGE_HEAD` / `REBASE_HEAD` / `CHERRY_PICK_HEAD` under `git rev-parse --git-dir`
(`/Users/Berzins/Desktop/taxi/.git/worktrees/wt-review215`, a file-not-directory `.git`, so the plain
`ls .git/MERGE_HEAD` form would have given a false negative). The main checkout sits on
`fix/connect-to-redis-partial-state-211` under another session and was not moved.

**Rebase first, or F4 and F5 have nothing to edit.** The branch was based on `0cdb59c`, *before* #215. At that
base `CLAUDE.md:43` still read `33 skipped, 582 passed, 615 total` at `feed712` and `:45` still read "33,
which still holds" — neither `#214` nor `:454 overrides` existed in the tree yet, so a naive edit here would
have failed its assertion or, worse, re-fixed a line #215 had already replaced. `git rebase origin/main`:
`Successfully rebased`, `3ad7bfb` → `b84bd0a`, clean (the branch touches one file, #215 touched another).

**Triage**: all five **fixed**. Nothing deferred, nothing declined. Every finding was re-run here before being
acted on rather than inherited — all five reproduce, two of them with figures the review had not stated.

---

## F1 · Medium · fixed — an **open** remedy row #215 silently discharged, and the false sentence that made
leaving it look safe

### What was wrong

Two halves, on two surfaces.

**F1b — `.claude/system-reviews/REMEDY-LEDGER.md:47`.** Row **L19**, under `## Open` (`:41`), is this exact
ticket: CLAUDE.md's Redis-skip figure has drifted, `observed` at `c70572b` as
`35 skipped, 660 passed, 695 total`. Its *Status at HEAD* column is `stale — grep -n "33 skipped" CLAUDE.md`.
PR #215 makes that grep return nothing, so an **open** action item — an artifact whose whole purpose is to be
read forward — now points a reader at work already done, with a verification command that returns nothing at
all. A row whose check returns nothing is indistinguishable from a broken row.

**F1a — PR #215's body.** Its *Not done* paragraph justified leaving every stale hit alone:

> The historical hits for `feed712` and `33 skipped, 582 passed` elsewhere in the tree are all under
> `.claude/code-reviews/`, each stamped at its own head

That is false, and it is the sentence that made leaving L19 look safe.

### Re-probed, not inherited

`observed` at `7179cc6`, 2026-09-15 — the review said "five directories"; the two sweeps are distinct and both
were re-run:

```
$ git grep -l "feed712" 7179cc6 -- . | xargs -n1 dirname | sort | uniq -c
   3 .claude/code-reviews      2 .claude/execution-reports
   5 .claude/reports           3 .claude/system-reviews        → 13 files, four directories

$ git grep -lE "33 skipped|582 passed|615 total|64 of 66" 7179cc6 -- . | xargs -n1 dirname | sort | uniq -c
   6 .claude/code-reviews      1 .claude/execution-reports     1 .claude/plans
   8 .claude/reports           1 .claude/system-reviews        → 17 files, five directories
```

3 + 2 + 5 + 3 = 13 and 6 + 1 + 1 + 8 + 1 = 17, both `observed` (the counts were re-run directly, not summed
from the table). `.claude/code-reviews/` is 3 of 13 and 6 of 17 — a minority on both sweeps, not the whole.

### The fix

**F1b** — L19 lifted out of `## Open` into a new `## Closed since the 2026-09-04 loop` section, in the
`| ID | Landed in | Verify at HEAD |` form the ledger's existing Closed table uses, with a verification
command that **returns something**:

| ID | Landed in | Verify at HEAD |
|----|-----------|----------------|
| L19 | PR **#215** (issue #214), merged as `7179cc6` on 2026-09-15 | `grep -n "39 skipped, 694 passed, 733 total" CLAUDE.md` → 43 |

Two things were written into that section deliberately, because closing the row carelessly creates a new false
claim:

- **L19's own figure is not the figure that landed, and that is correct.** The row carries
  `35 skipped, 660 passed, 695 total` at `c70572b` — a *fifth* version of the line, logged but never written
  into `CLAUDE.md`. #215 did not adopt it; it re-ran the command at its own base `0cdb59c` and stamped
  `39 skipped, 694 passed, 733 total`. A closing line reading "discharged by #215" and nothing more would
  leave the ledger asserting 35 and the file asserting 39, with no statement of why they differ — the #87/#107
  inheritance shape. What discharges the row is the *re-observation it asked for*, not a figure match.
- **The "wrong three times" tally stays at three**, with the rule that decides it spelled out: it counts
  defects in the **fixes** (#120's invented cause, #121's ruled-out diagnosis), not staleness events. The
  review agreed with #215's reading; L19 counts it differently ("4th occurrence"), which is why the closing
  note says which rule applies rather than leaving two numbers facing each other.

The header's `**3 open, 15 closed this loop.**` stamp is **not** rewritten — it is an `observed` statement
about the 2026-09-09 run, as is the 22-check blockquote beneath it. A dated amendment line was added instead:

> **Amended 2026-09-15 (PR #216):** L19 is discharged by PR #215 and moved to *Closed since the 2026-09-04
> loop* below, leaving **2 open**. The 2026-09-09 stamp above and the check-count blockquote below describe
> that run and are left as written.

**F1a** — the *Not done* paragraph now states what the sweeps actually return, at a named commit, and points
at the one hit that was not historical. See the verbatim text under *PR #215's body, as amended*.

### Closing command

Run against the fixed tree on 2026-09-15, both halves:

```
$ awk '/^## Open$/{f=1;next} /^## /{f=0} f&&/^\| L/{print $2}' .claude/system-reviews/REMEDY-LEDGER.md
L17
L18                                                        ← L19 gone from Open

$ grep -n "^| L19" .claude/system-reviews/REMEDY-LEDGER.md
56                                                         ← under "## Closed since the 2026-09-04 loop" (:52)

$ grep -n "39 skipped, 694 passed, 733 total" CLAUDE.md    ← L19's new Verify command
43                                                         ← returns a line, not nothing

$ grep -c "33 skipped" .claude/system-reviews/REMEDY-LEDGER.md
0                                                          ← the retired figure left with the row
```

And on the live body, after `gh pr edit 215` (`gh pr view 215 --json body`):

```
$ grep -n "are all under" <body>
100:**[corrected #216 · F1]** This paragraph first justified that by saying the hits "are all under
```

**One hit, and it is the correction quoting the retired claim in order to retire it** — the sentence that
*asserted* it is gone. `grep -c 'corrected #216 · F1]'` → 1.

---

## F2 · Medium · fixed — the quoted grep returns 8 paths, not the 4 the sentence claims

### What was wrong

PR #215's body:

> `grep -rl 'describe.skip\|describeWith\|describeIf\|itIf' services/api apps packages db` returns these four
> files and nothing more.

### Re-probed, not inherited

`observed` 2026-09-15, run as quoted:

```
services/api/node_modules/jest-circus/build/index.js
services/api/node_modules/jest-circus/build/jestAdapterInit.js
services/api/node_modules/jest-each/build/index.js
services/api/node_modules/jest-each/README.md
services/api/src/common/kv/redis-kv.store.spec.ts
services/api/src/features/dispatch/queue/redis-dispatch-queue.store.spec.ts
services/api/src/features/drivers/location/redis-driver-location.store.spec.ts
services/api/src/features/realtime/redis-io.adapter.spec.ts
                                                            → 8 paths
```

Four of the eight are jest's own copies of the patterns. The conclusion is true; the command as quoted does
not demonstrate it — and this grep is the sole support for "nowhere else" (F3), so it is load-bearing, not
decorative.

### The fix

`--exclude-dir=node_modules` added to the command as quoted in the body, with the un-excluded output recorded
beneath it so the correction is checkable rather than silent. Path-only exclusion, not `| grep -v
node_modules`, which eats content lines.

### Closing command

Run against the live body after `gh pr edit 215`, 2026-09-15:

```
$ gh pr view 215 --json body --jq .body | grep -c -- "--exclude-dir=node_modules 'describe.skip"
1
```

And the corrected command itself, run in `wt-review215`:

```
$ grep -rl --exclude-dir=node_modules 'describe.skip\|describeWith\|describeIf\|itIf' services/api apps packages db
services/api/src/features/drivers/location/redis-driver-location.store.spec.ts
services/api/src/features/dispatch/queue/redis-dispatch-queue.store.spec.ts
services/api/src/features/realtime/redis-io.adapter.spec.ts
services/api/src/common/kv/redis-kv.store.spec.ts
                                                            → 4 paths, which is what the sentence claims
```

The fix is checked in both directions: the body now quotes the excluded form, and the excluded form returns
the four files.

---

## F3 · Low · fixed — "nowhere else" credited to the sum instead of the grep

### What was wrong

> 5 + 12 + 16 + 6 = 39, matching the whole-suite run's skipped count exactly — **so all 39 sit in these four
> files and nowhere else**

The arithmetic is right and the total does match. The inference does not follow: equal totals do not establish
set identity. A fifth gated file contributing *n* skipped while one of these four contributed *n* fewer sums to
the same 39. What rules out a fifth file is the repo-wide grep — which is F2, and which as quoted did not
return what it claimed.

This is the #107 shape the numbers pass exists to catch: sound arithmetic, truthfully labelled `observed`,
credited to a mechanism that cannot isolate what it is credited with.

### The fix

The table is now described as what it is — the per-file split of a total already known to be complete — and
"nowhere else" is attributed to the grep, in a paragraph that names the counter-example the sum cannot exclude.

### Closing command

Run against the live body after `gh pr edit 215`, 2026-09-15:

```
$ gh pr view 215 --json body --jq .body | grep -c "exactly — so all 39 sit"
0                                                          ← the retired inference is gone

$ gh pr view 215 --json body --jq .body | grep -c "corrected #216 · F3]"
1                                                          ← the correction is present
```

---

## F4 · Low · fixed — issue number where the sentence's convention is PR numbers

### What was wrong

`CLAUDE.md:43` — "at **#214**'s base `0cdb59c`"; `:45` — "33, correct until **#214** re-observed 39". #214 is
the issue. The same sentence's `#120` and `#121` are PRs (`.claude/code-reviews/pr-120-review.md` and
`pr-121-review.md` both exist), so one sentence mixed both conventions.

### The fix

`#215` in both. `#215` is right on its own evidence, not only by convention: `observed`,
`gh pr view 215 --json baseRefOid` → `0cdb59c84b0b778f380c6abf25d9e5373e369650`, so `0cdb59c` genuinely **is**
#215's base, and the re-observation was the act performed in that PR. The review offered `#214/#215` as an
alternative; it was not taken, because a compound reference reintroduces the mixed form the finding is about,
and #215's own body carries `Closes #214`, so the issue stays one click away.

### Closing command

```
$ grep -c "#214" CLAUDE.md
0                                                          ← 0 matching lines

$ grep -c "#215" CLAUDE.md
2                                                          ← 2 matching lines, :43 and :45, one occurrence each
```

---

## F5 · Low · fixed — a doc comment cited for a verb it does not perform

### What was wrong

`CLAUDE.md:45`: "`test/harness.ts:454` **overrides** `KV_STORE` with `InMemoryKeyValueStore`". `:454` is the
first content line of the doc comment describing the seven-provider swap; a doc comment does not override
anything.

### Re-probed, not inherited

`observed` at this head — `grep -n` in `services/api/test/harness.ts`:

```
454   * The production module graph with exactly seven providers swapped: KV_STORE,   ← the comment (453 is `/**`)
529     const kv = new InMemoryKeyValueStore();                                        ← the construction
541       .overrideProvider(KV_STORE)                                                  ← the override
542       .useValue(kv)
```

### The fix

`test/harness.ts:454,541` — the comment for the mechanism, the call for the verb. `:454` is kept, as #215's
body argued and the review agreed: the sentence's job is to say *why* the harness rules out the Redis reading,
and the doc comment is what carries that ("between them, no ioredis client is ever constructed").

### Closing command

```
$ grep -c "harness.ts:454,541" CLAUDE.md
1                                                          ← 1 matching line, :45
```

---

## Retired-claim sweep — the exact greps and their hits

Run in `wt-review215` at the fixed tree unless stated. Every retired **value** and its **noun**, not just the
strings that were edited.

| # | Retired thing | Command | Hits | Action |
|---|---|---|---|---|
| S1 | `#214` as a PR-shaped reference (F4) | `grep -c "#214" CLAUDE.md` | **0** | — |
| S2 | its replacement is present | `grep -c "#215" CLAUDE.md` | **2 matching lines** (`:43`, `:45`) | — |
| S3 | bare `harness.ts:454` (F5) | `grep -rn --exclude-dir=node_modules --exclude-dir=.git "harness.ts:454" .` | **8 lines in 6 files** | 1 fixed, 7 left — see below |
| S4 | `33 skipped` inside the ledger (F1b) | `grep -c "33 skipped" .claude/system-reviews/REMEDY-LEDGER.md` | **0** | row moved, value went with it |
| S5 | L19 as an **open** row | `awk '/^## Open$/{f=1;next} /^## /{f=0} f&&/^\| L/{print $2}' .claude/system-reviews/REMEDY-LEDGER.md` | **L17, L18** — 2 rows | header amendment states 2 open |
| S6 | the PR-body wording (F2, F3) | `grep -rn --exclude-dir=node_modules --exclude-dir=.git -e "nowhere else, and the two with no ungated" -e "returns these four" .` | **1** | left — see below |
| S7 | the body itself, post-edit | `gh pr view 215 --json body` | banner + 3 `[corrected #216]` markers | — |

**S3 — seven `:454` copies left, deliberately.** `CLAUDE.md` is the one live rule; the rest are stamped
historical records at their own heads and rewriting them would falsify what those runs said:
`.claude/code-reviews/pr-128-review.md` (2 lines), `pr-121-review-round3.md`,
`.claude/execution-reports/dispatch-override-phone-orders-zones-phase-c.md:90`,
`.claude/reports/dispatch-override-phone-orders-zones-phase-c-report.md:34`, and two in
`.claude/code-reviews/pr-215-review.md` — the review's own F5, which quotes both the old form and the fix.

**S6 — the single hit is `.claude/code-reviews/pr-215-review.md:127`**, the blockquote *inside* F2 that
reproduces the defective command in order to report it. Editing it would destroy the finding. Left.

**Units.** `grep -c` counts matching **lines**, not occurrences. S1, S2 and S4 are line counts; here each
matching line carries exactly one occurrence, so the two readings coincide — stated rather than assumed.

**The `17 files / five directories` figure in the amended #215 body is stamped at `7179cc6` and must stay
stamped.** `observed` at this branch's tree, the same sweep returns **18 files across four directories** —
7 code-reviews · 9 reports · 1 execution-reports · 1 plans, and `.claude/system-reviews/` gone. The
arithmetic: +1 code-review (`pr-215-review.md`, on this branch and not on `main`), +1 report (this file),
−1 system-review (F1b takes `33 skipped` out of `REMEDY-LEDGER.md` with the L19 row). 17 + 1 + 1 − 1 = 18,
and five directories become four. The body's figure is not stale because it names the commit it was taken
at; a reviewer re-running the sweep at head should expect 18, not 17.

**Nothing else in the tree carries F2's or F3's wording**, which is the point F1 makes about the PR body: no
working-tree grep reaches it, so if the body is not edited, the claim is not corrected anywhere. S6 returning
1 — and that 1 being the review quoting the defect — is the evidence for that, not a sentence asserting it.

---

## PR #215's body, as amended

No grep reaches a PR body, so the three edits are reproduced here verbatim. A banner was added at the top of
the body so a reader knows it changed after merge:

> **Amended 2026-09-15, after merge.** PR #216's round-1 review found three defects in this body — F1a (a
> false claim about where the historical hits live), F2 (a quoted command that does not return what the
> sentence says) and F3 (a conclusion credited to the wrong mechanism). All three are corrected in place below
> and marked **[corrected #216]**. The shipped diff is unchanged. Fix pass recorded in
> `.claude/reports/pr-215-review-fixes.md`.

**F3 + F2**, replacing the "so all 39 sit in these four files and nowhere else … returns these four files and
nothing more" paragraph:

> 5 + 12 + 16 + 6 = 39, matching the whole-suite run's skipped count exactly — so the table is the per-file
> split of a total already known to be complete, and the two with no ungated case are what produce the 2
> skipped suites.
>
> **[corrected #216 · F3]** An earlier version of this paragraph read the match as proof that "all 39 sit in
> these four files and nowhere else". It is not: equal totals do not establish set identity — a fifth gated
> file contributing *n* skipped while one of these four contributed *n* fewer sums to the same 39. What rules
> out a fifth file is the repo-wide grep below, and nothing else here does.
>
> Four is the count repo-wide, not just in `services/api`:
> `grep -rl --exclude-dir=node_modules 'describe.skip\|describeWith\|describeIf\|itIf' services/api apps packages db`
> returns these four files and nothing more.
>
> **[corrected #216 · F2]** `--exclude-dir=node_modules` was missing from the command as first quoted here.
> `observed` at `7179cc6`, the un-excluded form returns **8** paths, not 4 — the four spec files plus jest's
> own copies of the patterns (`jest-circus/build/index.js`, `jest-circus/build/jestAdapterInit.js`,
> `jest-each/build/index.js`, `jest-each/README.md`, all under `services/api/node_modules/`). The conclusion
> was always true; the command as quoted did not demonstrate it, and this grep is the sole support for
> "nowhere else" above. Path-only exclusion, not a `| grep -v node_modules` filter, which eats content lines.

**F1a**, replacing the *Not done* paragraph's second sentence:

> **Not done:** nothing in the issue's four checkboxes is outstanding. The historical hits for `feed712` and
> `33 skipped, 582 passed` elsewhere in the tree are left as written — they record what was true when
> observed.
>
> **[corrected #216 · F1]** This paragraph first justified that by saying the hits "are all under
> `.claude/code-reviews/`". They are not. `observed` at this PR's merge commit `7179cc6`:
> `git grep -l "feed712" 7179cc6` returns **13** files across **four** directories — `.claude/reports/` 5,
> `.claude/code-reviews/` 3, `.claude/system-reviews/` 3, `.claude/execution-reports/` 2 — and the wider
> `git grep -lE "33 skipped|582 passed|615 total|64 of 66" 7179cc6` returns **17** files across **five**,
> adding `.claude/plans/connect-to-redis-partial-state-cleanup.md` (8 reports · 6 code-reviews · 1 each in
> plans, execution-reports, system-reviews).
>
> Most of those genuinely are historical and correctly left alone. **One was not.**
> `.claude/system-reviews/REMEDY-LEDGER.md:47` at `7179cc6` held row **L19** under `## Open` — this exact
> ticket — with the verification command `grep -n "33 skipped" CLAUDE.md`, which this PR makes return
> nothing. An open remedy row is read forward, not as a stamped record, so it needed closing rather than
> leaving. Discharged in PR #216, which moves L19 into a *Closed since the 2026-09-04 loop* section.

---

## Validation

```
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 \
  pnpm turbo run typecheck lint test build --force
```

`observed` in `/Users/Berzins/taxi-worktrees/wt-review215`, 2026-09-15 19:42:07 → 19:44:16:

| | |
|---|---|
| Tasks | ✅ `Tasks: 22 successful, 22 total` |
| Cache | `Cached: 0 cached, 22 total` — nothing replayed, every task re-run |
| Wall | `Time: 2m7.985s` |
| `@taxi/api` | `Test Suites: 77 passed, 77 total` · `Tests: 733 passed, 733 total` |
| Failure signals in the log | **0** — `grep -cE "^ *Failed:\|ERROR: command finished with error\|Tests:.*failed\|FAIL "` → 0 |

**What that figure is and is not.** 22/22 with no `Failed:` line is turbo's own verdict; the shell capture of
the gate's exit status misfired (`${PIPESTATUS[0]}` is a bash array name, and this shell is zsh), so the exit
code is *not* quoted here — the task summary is. `2m7.985s` is a **cold** figure: this worktree had no
`node_modules` at the start of the pass, so nothing was warm and `--force` meant no cache. It is not
comparable to the `1m24.097s` the review recorded for the same command in `wt-214`, which ran on an installed
tree.

The gate is a no-regression check here, not evidence for anything the fixes claim: the whole diff is markdown
(`CLAUDE.md`, two files under `.claude/`), none of it inside a package, so no turbo task takes it as input.

**Why no sha on this stamp.** Between the run starting and the commit, exactly one file changed —
`.claude/reports/pr-215-review-fixes.md`, this file, outside every package and an input to nothing. No tracked
source moved. The commit sha is recorded in **PR #216's body** instead of here, because stamping it in this
file would move the tree the stamp describes, and the correction would move it again — the shape
`.claude/reports/pr-212-review-fixes.md` walked through three times (+1790 → +1812 → +1826).

---

## Pushed

One commit on `docs/pr-215-review`, subject
`docs(rules): PR #215 review F1-F5 — five claims corrected (#214)`, carrying `CLAUDE.md` (F4, F5),
`.claude/system-reviews/REMEDY-LEDGER.md` (F1b) and this report. The branch was rebased onto `7179cc6`
before any edit, so PR #216's base moves off `0cdb59c` and its `BEHIND` merge state clears with the same push.

**The commit sha and the gate stamped against it are in PR #216's body**, written after the push — not here,
so that this file's content does not move the sha it would be quoting.

**PR #215 is not touched by the push.** It is merged and `origin/docs/redis-gated-line-214` is deleted; its
body was amended directly with `gh pr edit 215`, reproduced verbatim above. Nothing in this pass re-opens,
re-lands or re-merges it.
