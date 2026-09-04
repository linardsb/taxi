---
name: piv-fix-review-findings
description: Triage code-review findings (manual or AI), fix the ones you choose one at a time with tests, defer/log the rest, then validate — and if the work is on a PR, commit and push so the PR reflects the fixes. Use after a review has produced a list of issues or a review file.
argument-hint: "[code-review-file-or-issues] [scope / what to fix now vs defer]"
arguments: [review, scope]
---

# Fix Review Findings

A review produced findings — but a review is **input, not a work order.** You decide what happens to each one.

Code-review (file or description of issues): $review

Direction / scope (what to fix now vs defer): $scope

If the Code-review is a file, **read the entire file first** so you understand every finding before triaging.

## 0. Check the ground before you start

Two things that are cheap to check now and expensive to discover at push time.

**Is the PR still open?** Find it (`gh pr list --head "$(git branch --show-current)"`) and read its state:

- **OPEN** → normal path; the fixes land on this PR at step 4.
- **MERGED / CLOSED** → say so **now**. The fixes need their own branch and PR, or a direct commit if the
  project allows one — settle which with the human before fixing, not after pushing. `piv-review-pr` guards
  this too, but this skill runs *after* it, and a solo repo can merge in between.

**Is the worktree actually yours?** `git status --porcelain`, plus a probe for an interrupted operation:

```bash
GD=$(git rev-parse --git-dir); ls "$GD"/MERGE_HEAD "$GD"/REBASE_HEAD "$GD"/CHERRY_PICK_HEAD 2>/dev/null
```

Use `git rev-parse --git-dir` — **in a worktree `.git` is a file, not a directory**, so `ls .git/MERGE_HEAD`
gives a false negative. If another session left a half-finished merge or staged work in the index, resolve
who owns it before committing; otherwise their work rides into your commit.

## 1. Triage first (the human's call)

Sort the findings before touching code. Honor any direction in the scope argument; if it's unclear, surface the
findings grouped and **ask** rather than fixing everything by default:

- **Fix now (this PR)** — real, in-scope, belongs with this change.
- **Defer / log as an issue** — real but later; don't bloat this PR. **Create a tracker issue** (or note it) instead
  of fixing it here.
- **Needs a human look / manual test** — anything you should inspect or test by hand before trusting it. Flag it,
  don't silently auto-fix.
- **Noise / won't-fix** — say why, then drop it.

Don't let the reviewer dictate scope — "real, but later" is a valid and common call; a clean small PR beats a
sprawling one.

## 2. Fix the "fix now" set — one at a time

For each:
1. Explain what was wrong.
2. Make the fix.
3. Create and run a test that proves it. Where you can, **run the new test against the unfixed
   code and watch it fail** — that is the only thing separating a regression test from a passing
   decoration.
4. For a **Critical or High**, answer in one line: **what new failure mode does this fix's
   mechanism have?** — a swallowed `catch`, a promise chain with no terminal `catch`, a flag set
   before the thing it claims, a read moved before the write it depends on — and add the test for
   *that* before moving on. The repro from step 3 proves the old failure is gone; it says nothing
   about the one the mechanism introduced. Both of PR #150's round-2 Highs were round-1 fixes
   that passed their repros.

### When a fix changes a NUMBER or a GUARANTEE, chase its copies

A figure gets written once and quoted four times. Fixing the original and stopping leaves the
copies stating the old, now-false claim — and the repo rule ("a number or a guarantee in a
comment, plan or PR body is a claim, not decoration") is broken by the copies just as much.

Grep for the **value**, not the topic word. The stale copy usually does not contain the word you
fixed — correcting a "429" claim leaves a stale *viewer count* and a stale *test total*, neither
of which contains "429". Check:

- the docblocks and constants around the fix
- `.claude/plans/<feature>.md` — including its task list, ACs and manual-validation steps, not
  just the one paragraph you already found
- `.claude/reports/<feature>-report.md` — gate figures go stale the moment a test is added
- **the PR body** — no working-tree grep can reach it, and it is the first thing the next
  reviewer reads and the number they will re-run the gate against

Chase the **subject** as well as the value: a retired claim survives as a verb ("the cache this
script *measures*") long after its number is gone — grep the noun (`quantiz`, `grid`, the issue
number) too. And make the sweep **checkable**: list in `.claude/reports/pr-{N}-review-fixes.md`
the exact `grep -n` you ran per retired value/noun and its hits in the plan, the report and the
PR body, so the reviewer diffs a list instead of trusting a sentence. On PR #150 this rule was written in two files, was
followed for the digits, and still missed the sentence three times (R4, R5, R11) — because its
output was a feeling, not a list.

## 3. Validate

Run the `piv-validate` skill to finalize the fixes.

## 4. If operating on a PR — commit and push

**Before committing: run every finding's closing command NOW, against the fixed tree, before writing
its closing sentence.** "Every one is fixed; nothing was deferred" is a claim like any other — PR
#150's L5 quoted an `expo config` run that predated its own fix, and the fix did not work (round 2,
R6). A finding's closing line in `.claude/reports/pr-{N}-review-fixes.md` quotes the command, when it
ran, and its output — or says "not run" honestly.

If these fixes are on a PR branch, **commit them (use `piv-commit`) and push** so the PR reflects the fixes and the
review can re-run on the updated PR. If nothing was fixed (everything deferred), there's nothing to push — just make
sure the deferred items are logged as issues.

## Output

A short report: what was **fixed** (with its test), what was **deferred/logged** (with issue refs), what needs a
**manual look/test** — and, if on a PR, the **pushed commit** + confirmation the PR is updated.

Write it to `.claude/reports/pr-{N}-review-fixes.md` (round number in the name when there is more
than one). `piv-review-pr` round ≥ 2 reads this file: a report that exists only in this session's
transcript cannot be cross-checked by the reviewer it is written for.
