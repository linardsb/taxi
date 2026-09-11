# Conventions — how Sakta Cab ships work

> **This is the one place ship-step conventions live.** `piv-commit` and `piv-create-pr` read this file at
> run time and follow the rules below, so the agent writes this repo's way instead of a generic default.
> The skills stay general and portable; what's specific to this project lives here and travels with the repo.

## commit

**Mechanical (regex-checkable):**
- Subject line uses a conventional tag with an optional scope — imperative, ≤72 chars:
  `feat|fix|docs|refactor|test|chore|ci|style(scope)?:`. `ci` and `style` were shipping on `main` before
  they were in this list (`observed` 2026-09-11: 3 commits each); the branch-prefix rule under **pr**
  mirrors this set, so the two stay in step.
- Scope names what the change is about, in one of two families — `observed` 2026-09-11 over every commit
  on `main`, 26 distinct scopes. **Product:** the surface, package or feature slice touched — `api`,
  `dispatch`, `shared`, `driver`, `rider`, `db`, `auth`, `apps`. `admin` belongs here and has never yet
  been a commit's scope; the surface is real (`apps/dispatch/src/app/admin`), so keep it listed.
  **Everything else:** the toolchain or process artifact touched — `ci`, `deploy`, `deps`, `config`,
  `codeql`, `skills`, `rules`, `plans`, `reports`, `reviews`, `runbooks`, `spikes`, `architecture`,
  `ai-layer`. For an artifact kind take the PLURAL its directory uses: `review`, `report` and `plan`
  are older spellings of `reviews`, `reports` and `plans`, and only the first pair has settled on its
  own (singular last used 2026-08-11, plural still current 2026-09-10). That accounts for 25 of the 26;
  the last is a one-off `fix(test)` (2026-08-05) whose diff is a single `services/api` spec, so it
  should have been `api` — a test's scope is the surface it tests, never `test`.
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
- Base branch is `main`; head is `<prefix>/<kebab-slug>` — never PR from `main` itself. The prefix mirrors
  the commit tag the branch's work carries — `feat` takes `feature/`, every other tag is its own name
  (`fix/`, `docs/`, `chore/`, `test/`, `ci/`, `refactor/`) — plus `spike/` and `probe/` for throwaway
  exploration that lands no product code. `observed` 2026-09-11 across all 99 PRs the repo has ever had:
  `feature` 50, `docs` 23, `fix` 10, `chore` 9, `spike` 2, `probe` 2, `ci` 2, `test` 1. `refactor/` is
  allowed by the mirror rule but has never been used; the other seven are each attested above.
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
