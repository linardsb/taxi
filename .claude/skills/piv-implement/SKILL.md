---
name: piv-implement
description: Executes an implementation plan task-by-task with validation at every step. Use when you have a completed feature plan and want to implement it in one pass.
argument-hint: [path-to-plan]
---

# Execute: Implement from Plan

## Plan to Execute

Read plan file: `$ARGUMENTS`

## Before you start — work on a feature branch

A ticket gets built on its own branch, so it can become one PR. **Ideally you're already on that branch — cut it
before planning — so the plan commit you made is on it and rides into the PR; a plan committed on the base branch
won't be in this branch's PR.** If you're still on base, this step creates the branch now. Detect the base branch
(don't hardcode `main`): `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'`
(fallback `main`).

- **On the base branch, clean** → create one: `git checkout -b feature/<plan-slug>`.
- **Already on a feature branch or in a worktree** → use it.
- **On the base branch with uncommitted changes** → STOP: commit or stash first.
- **Another session live in this checkout** (`git reflog -8` shows branch moves you didn't make, or fresh
  mtimes you didn't create) → don't share it: `git worktree add` and implement there from the start —
  mid-flight branch collisions cost ref surgery. In the worktree, run DB-touching tests and the gate with
  `COMPOSE_PROJECT_NAME=taxi` so compose reuses the shared containers instead of starting a second Postgres
  on an occupied port; remove any stray `<worktree-name>-db-1` containers when done.
  While sessions share one dev DB, keep new migrations additive — nullable columns, no drops or renames — and
  record `ls db/migrations/*.sql | tail -1` in the report's **Issues encountered** so skew is visible: #86
  migrated to 0008 while sibling sessions still carried 0007.

(One branch per ticket is also what makes parallel worktrees clean later.)

## Execution Instructions

### 1. Read and Understand

- Read the ENTIRE plan carefully
- Understand all tasks and their dependencies
- Note the validation commands to run
- Review the testing strategy

### 2. Execute Tasks in Order

For EACH task in "Step by Step Tasks":

#### a. Navigate to the task
- Identify the file and action required
- Read existing related files if modifying

#### b. Implement the task
- Follow the detailed specifications exactly
- Maintain consistency with existing code patterns
- Include proper type hints and documentation
- Add structured logging where appropriate

#### c. Verify as you go
- After each file change, check syntax
- Ensure imports are correct
- Verify types are properly defined

### 3. Implement Testing Strategy

After completing implementation tasks:

- Create all test files specified in the plan
- Implement all test cases mentioned
- Follow the testing approach outlined
- Ensure tests cover edge cases

### 4. Run Validation Commands

Execute ALL validation commands from the plan in order:

```bash
# Run each command exactly as specified in plan
```

If any command fails:
- Fix the issue
- Re-run the command
- Continue only when it passes

### 5. Final Verification

Before completing:

- ✅ All tasks from plan completed
- ✅ All tests created and passing
- ✅ All validation commands pass
- ✅ Code follows project conventions
- ✅ Documentation added/updated as needed

## Output — write an implementation report

Write a short report to `.claude/reports/<plan-slug>-report.md` (and print the summary). This is what the PR body
and the `piv-review-pr` gate read — especially the **deviations** (a documented deviation is an *intentional*
decision the reviewer should not flag):

**Before filling Deviations**: re-read the plan's STEP-BY-STEP TASKS, TESTING STRATEGY, **UX → States** and
**ACCEPTANCE CRITERIA**, and diff every *named* behavior, state and test case against what actually shipped. A
divergence you didn't notice while coding is still a deviation — and the review gate treats an undocumented one
as unintentional.

Tick each declared UX state (loading / empty / error / offline) per surface as you go. **A state you never built
is a divergence even though nothing in the diff shows it** — and that asymmetry is why omissions get reported at
zero while changes get reported at ten. #18 reported ten deviations honestly and missed the one thing it dropped:
the plan's board *Error* state was never implemented, which the PR review then found (M7). Deferring it would
have been a fine call; not writing it down was not.

```markdown
# Implementation Report — <feature>

**Plan**: <path>   **Branch**: <feature/...>   **Status**: COMPLETE | PARTIAL

## Summary
{What was built, 2-4 sentences.}

## Tasks completed
- [task] → `path/to/file` (CREATE/UPDATE)

## Tests added
{Test files + cases + results.}

## Validation results
{Type-check / lint / tests / build — pass/fail with counts.}

## Deviations from the plan
{What changed vs the plan and WHY — or "none". This is the reviewer's signal of intent.}

## Issues encountered
{Anything notable, or "none".}
```

### Ready for the next step
- Confirm all changes are complete and validations pass.
- Commit before you stop, even mid-ticket, so the working tree is never the only copy of the day's work —
  #16's implementation sat uncommitted for a day, then was committed cold by a session with none of its
  context. Check `git status --porcelain` and stage only this ticket's files (review docs and reports for
  other branches must not ride in). `piv-commit` step 1 reads the top commit's subject and folds a `wip:`
  commit into the real one, so the prefix is what makes the handoff work — it is not decoration:
  `git commit -m "wip: <plan-slug>"`
- Next: `piv-commit` the work, then `piv-create-pr` to open the PR (the report fills the PR body), then `piv-review-pr`.

## Notes

- If you encounter issues not addressed in the plan, document them
- If you need to deviate from the plan, explain why
- If tests fail, fix implementation until they pass
- Don't skip validation steps
