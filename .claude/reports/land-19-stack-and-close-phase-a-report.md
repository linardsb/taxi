# Implementation Report — Land the #19 stack, close the outer loop on Phase A

**As of**: 2026-08-18, written **before** #121 merged. #121 has since merged as `30a0662` (12:19 UTC); the "not merged" line under **Not done** is as-written, not current.
**Plan**: handoff prompt (`next-session-prompt.md`, scratchpad — not a repo artifact)
**Branches**: `feature/dispatch-zones-cascade` (#121, rebased) · merges onto `main`
**Status**: COMPLETE

## Summary

Merged the #19 stack in order (#120 → #122), rebased #121 onto the merged `main` and got it green, filed the two contradictions the handoff named plus one it did not, reconciled Phase D's task list with what Phases A and B actually shipped, and closed the outer loop with two executable remedies rather than prose. Every figure carried by the handoff prompt was re-derived before use; three of its claims turned out to be false rather than stale.

## Tasks completed

- **Merge-order comments** → #121, #122 (`gh pr comment`), each claim verified against `gh pr view` and `git merge-base --is-ancestor` before writing
- **#120 merged** → `369b953`
- **#121/#122 retargeted to `main`** → by hand; GitHub did **not** auto-retarget
- **#122 merged** → `d444c72`, after a fresh gate at its head
- **#121 rebased** `ced2d30` → `d444c72` → `0a7c519`, `feed712` (UPDATE, force-pushed)
- **i18n conflict** → 59 lines of catalog strings into `packages/shared/src/i18n/{lv,ru,en}.ts` (UPDATE, `+17/+25/+17`), `isMessageKey` kept in `i18n.ts` (UPDATE, `+21` assembly and type lines — 80 is the four-file total, not the string count). `observed` — `git diff --numstat d444c72 59b3feb -- packages/shared/src/i18n/ packages/shared/src/i18n.ts`
- **500-line cap** → `services/api/src/features/rides/board-ride.ts` (CREATE), `rides.repository.ts` 504 → 464 (UPDATE), `rides/index.ts` re-export (UPDATE)
- **`CLAUDE.md` Redis paragraph** → rewritten, sentence and all (UPDATE)
- **Phase D reconciliation** → `.claude/plans/dispatch-override-phone-orders-zones.md` (UPDATE), new Task D1b
- **Phase C report addendum** → `.claude/reports/…-phase-c-report.md` (UPDATE)
- **PR #121 body** → fully re-derived (UPDATE)
- **Issues filed** → **#126** (balance eligibility), **#127** (filed as "ungated Redis specs" — that diagnosis was false; the issue was re-scoped on 2026-08-18 to finding what actually made 8 integration tests fail, with Redis ruled out)
- **Outer loop** → `.claude/execution-reports/dispatch-override-phone-orders-zones.md` (CREATE), `.claude/system-reviews/dispatch-override-phone-orders-zones-review.md` (CREATE)
- **Remedies** → `~/.claude/skills/piv-create-pr/scripts/{record-gate.sh,inherited-figures.sh}` (CREATE), `piv-create-pr/SKILL.md` Phase 2.5 (UPDATE)

## Tests added

None — no new behaviour. One test import was repaired: `packages/shared/tests/dispatch-explanation.test.ts` still imported `formatMessage` from `../src/i18n`, which #122 moved to `../src/format-message`; it went red on the first post-rebase gate.

## Validation results

`observed` — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`, at `feed712`, exit 0:

- Tasks 18 successful / 18 total, 0 cached, 1m0.577s
- `@taxi/api` 615 passed / 66 suites / 0 skipped · `@taxi/shared` 195 / 21 files · `@taxi/dispatch` 222 / 27 files · `@taxi/db` 17 / 3 files
- **CI on #121**: `check` pass (4m12s). `MERGEABLE/CLEAN` against `main`.

Mutation evidence re-derived at the rebased pre-fix commit `67e5697`: api 5 failed / 610 passed / 615; shared 1 failed / 194 / 195; dispatch 3 failed / 219 / 222 — same red counts as pre-rebase.

## Deviations from the plan

1. **Steps were not run in the handoff's order.** #126 (step 5) and the Phase D analysis (step 6) ran while the merge authorisation was outstanding, since neither depends on a merge. Placement of the plan edit did depend on it, and was asked.
2. **The plan edit landed on #121's rebase branch**, not as its own PR — user's choice when asked. Editing it in #120's worktree would have invalidated that PR's green CI.
3. **Two extra fixes were forced by the merge and are not in the handoff**: the 500-line cap breach in `rides.repository.ts` (a lint **error**, not a warning) and the stale `formatMessage` import. Both are described in the PR body.
4. **A third issue was filed beyond the two the handoff named** — #127. Phase B's `bookings`/`customers` integration specs need Redis and are not gated, so without `REDIS_TEST_URL` the api suite is red rather than short. Found while re-deriving `CLAUDE.md:43`'s skip figure. **Superseded** — that diagnosis is false and was reverted in `794d602`. `test/harness.ts` overrides `KV_STORE` with `InMemoryKeyValueStore` and both specs build through `createTestApp`, so the mechanism cannot fire; the suite is short, not red. #127 is re-scoped to finding the real cause. See `…-phase-c.md` D5.
5. **The L10 mutation figure was re-run, not retired.** The handoff allowed either. The SHAs its original runs named no longer exist after the rebase, so all three runs were repeated against `67e5697`.
6. **The outer-loop remedy is two scripts, not one.** `record-gate.sh` removes the opportunity for the gate line to drift; `inherited-figures.sh` audits everything else. Neither catches a right-number-wrong-label (#87) or a numeral-free false claim, and the skill says so rather than implying coverage it does not have.
7. **Conflict resolution folded the whole catalog end-state into the first rebased commit**, so later commits' i18n hunks are empty while their messages still describe those edits. Recorded in the commit body, the PR body and the report addendum.

## Issues encountered

- **Three claims in the handoff prompt were wrong.** Its gate line said `54.3 s`; the PR body said `55.15 s`. It stated GitHub retargets stacked PRs automatically when the base merges — false here (`deleteBranchOnMerge: false`), so both PRs were retargeted by hand. And it framed `CLAUDE.md:43` as a digit conflict (28 vs 33) when the surrounding sentence had itself stopped being true. **Superseded** — the surrounding sentence had *not* stopped being true; only the digit was wrong, so the handoff's framing was right and this entry was not. The rewrite that replaced it asserted a red gate on a mechanism `test/harness.ts` excludes, and was reverted in `794d602`. See `…-phase-c.md` D5.
- **Colima wedged mid-gate.** It reported `Running` while the socket was dead and `limactl list` showed no instance. The gate hung at the api test task with turbo buffering output, reading as a slow test. Recovered with `colima stop --force && colima start && docker compose up -d --wait`; the container volumes survived. Asked before restarting, since other sessions share the machine.
- **One `@taxi/dispatch` flake**: `LoginForm > moves focus to the code field on step 2 (edge)`, in a file #121 does not touch. Green in isolation and on both subsequent gates. Flagged in the PR body, not dismissed.
- **A no-Redis run at #122's head reported 1 failure where #121's head reported 8, twice.** Not chased; #127 states the discrepancy rather than presenting the eight as cleaner evidence than it is.

## Not done

- **#121 is not merged.** It is green, clean and rebased, awaiting the review gate and a human. Merging is the user's call and only #120/#122 were authorised.
- **Phase D itself** — reconciled, not executed.
