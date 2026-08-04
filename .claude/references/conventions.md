# Conventions — how Sakta Cab ships work

> **This is the one place ship-step conventions live.** `piv-commit` and `piv-create-pr` read this file at
> run time and follow the rules below, so the agent writes this repo's way instead of a generic default.
> The skills stay general and portable; what's specific to this project lives here and travels with the repo.

## commit

**Mechanical (regex-checkable):**
- Subject line uses a conventional tag with an optional scope: `feat|fix|docs|refactor|test|chore(scope)?:` —
  imperative, ≤72 chars. Scopes in use: the surface or package touched (`shared`, `api`, `db`, `rider`,
  `driver`, `dispatch`, `admin`, `spikes`, `skills`).
- Reference the GitHub issue in the subject or body when one exists (`#N`).
- Commits end with the standard trailers (`Co-Authored-By: Claude … <noreply@anthropic.com>` and the
  `Claude-Session:` link) — this repo keeps them; do not strip them.

**Judgment (rubric):** <!-- #commit-quality -->
- The message describes THIS diff — what changed and why — not a generic summary. A reader who sees only the
  message should predict roughly which files changed and not be surprised by the body of the diff.
- Subject says what the change does; body (when present) says why it was needed and names the key touch points.
- One atomic concern per commit — no drive-by refactors folded into a feature commit.

## pr

**Mechanical (regex-checkable):**
- Base branch is `main`; head is a `feature/<kebab-slug>` branch — never PR from `main` itself.
- PR body contains the sections: `## Summary`, `## What changed`, `## Validation`.
- PR body ends with the standard "Generated with Claude Code" footer and session link — keep it.

**Judgment (rubric):** <!-- #pr-quality -->
- The Summary explains WHY this change exists (the intent), not just what it touches.
- Validation states what was actually run/verified — `pnpm check` results, not aspirational claims.
- Documented deviations from the plan (from `.claude/reports/<plan>-report.md`) appear in the body so the
  reviewer knows what was intentional.

## review

**Mechanical (regex-checkable):**
- The report routes every item into one of: AGENT FIXES / HUMAN DECIDES / HUMAN READS / HUMAN TESTS / FYI.
- Every item carries a `file:line` reference. Human buckets hold 3–5 items max.

**Judgment (rubric):** <!-- #review-routing -->
- HUMAN READS points at genuinely load-bearing code for THIS diff (payment-method lock, integer-cent money,
  ride state transitions, `packages/shared` contracts, dispatch logic) — not a random sample of touched files.
- Nothing auth-, money-, or ride-state-adjacent sits in AGENT FIXES.
