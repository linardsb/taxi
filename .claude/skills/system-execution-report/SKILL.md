---
name: system-execution-report
description: Generates a structured implementation report reflecting on a just-completed feature — what was done, divergences, challenges. Use right after finishing an implementation, as the input to a system review.
argument-hint: "[plan-file] (optional — defaults to this session's context)"
arguments: [plan]
---

# Execution Report

Review and deeply analyze the implementation you just completed.

## Inputs

**Plan file: $plan** — may be empty. If it is, use the plan this session worked from.

**Test `$plan`'s shape before you read anything.** `arguments: [plan]` binds by position, so a free-form
sentence is word-split and `$plan` silently receives its **first word** — `observed` 2026-09-18 (#229):
invoked with `the #225 → #227 worklets pin loop, reconstructed from …`, this skill rendered
`Plan file: the` and discarded the rest. It is the hazard ledger row L18 logged for this exact file, and
the fix pattern is `opportunity-scan:27` — read the invocation as **prose**, not as slots.

- **`$plan` ends in `.md`** → a real path. Use it.
- **`$plan` is present but does not end in `.md`** → a word-split sentence. Do **not** ask, and do not
  treat the first word as a path: read the whole sentence you were invoked with as the scope, and find
  the loop's artifacts from it (`.claude/plans/`, `.claude/reports/`, `gh pr view`).
- **`$plan` is empty** → the case below.

**A well-formed path to a file that does not exist is its own case, and the answer is not to stop.**
A plan path can be well-formed and absent because the loop never had a plan — which is exactly the loop
most worth reporting on. Say so in the report's Meta Information (`Plan file: none`), name the de-facto
plan the implementation actually worked from (usually the GitHub issue body), and measure divergences
against that. Do not invent a plan file to fill the slot.

If it is empty AND this session did not do the implementation, **say so and stop** rather than
writing a report from the diff alone: this skill reflects on *why* things diverged, and a cold
session can see what changed but not why. Ask for the plan path, or re-run in the implementing
session.

Also read, when they exist — they carry the divergences and the review's verdict, and a report
that contradicts them is worse than no report:

- `.claude/reports/<feature>-report.md` — the implementation report from `piv-implement`
- `.claude/code-reviews/pr-<N>-review.md` — any review that ran on this work

## Context

You have just finished implementing a feature. Before moving on, reflect on:

- What you implemented
- How it aligns with the plan
- What challenges you encountered
- What diverged and why

## Generate Report

Save to: `.claude/execution-reports/[feature-name].md`

### Meta Information

- Plan file: [path to plan that guided this implementation]
- Files added: [list with paths]
- Files modified: [list with paths]
- Lines changed: +X -Y

### Validation Results

- Syntax & Linting: ✓/✗ [details if failed]
- Type Checking: ✓/✗ [details if failed]
- Unit Tests: ✓/✗ [X passed, Y failed]
- Integration Tests: ✓/✗ [X passed, Y failed]

### What Went Well

List specific things that worked smoothly:

- [concrete examples]

### Challenges Encountered

List specific difficulties:

- [what was difficult and why]

### Divergences from Plan

For each divergence, document:

**[Divergence Title]**

- Planned: [what the plan specified]
- Actual: [what was implemented instead]
- Reason: [why this divergence occurred]
- Type: [Better approach found | Plan assumption wrong | Security concern | Performance issue | Other]

### Skipped Items

List anything from the plan that was not implemented:

- [what was skipped]
- Reason: [why it was skipped]

### Recommendations

Based on this implementation, what should change for next time?

- Plan skill improvements: [suggestions]
- Execute skill improvements: [suggestions]
- CLAUDE.md additions: [suggestions]
