# Execution Report — #19 Phase C: zone/queue grid, cascade visibility, explainability

**Scope of this report:** Phase C only (Tasks C1–C7, PR #121, merged `30a0662` on 2026-08-18), **including the rebase onto the merged base and the round-3 review fixes** (`794d602`, `59b3feb`). Phase A has its own report (`dispatch-override-phone-orders-zones.md`) and system review; Phase B is covered there only where it falsified something. Phase D remains open.

> **Independence caveat, stated up front.** This report was written by the session that made the round-3 fixes (F1/F2/F3). It is a self-report on that work, not an outside audit. Everything labelled `observed` is a run this session performed and can name; the *judgement* about what those runs mean is not independent and should be weighted as such. The findings it reports on came from `.claude/code-reviews/pr-121-review-round3.md`, which was likewise authored in the PR's own session lineage.

- **Plan file**: `.claude/plans/dispatch-override-phone-orders-zones.md` (Tasks C1–C7)
- **Implementation report**: `.claude/reports/dispatch-override-phone-orders-zones-phase-c-report.md`
- **Reviews**: `.claude/code-reviews/pr-121-review.md`, `pr-121-review-round2.md`, `pr-121-review-round3.md`
- **Lines changed**: **46 files, +3130 −275** (`observed` — `git diff --stat d444c72 59b3feb`). That total includes the plan, the implementation report and three review rounds' worth of prose edits; shipped source is a minority of it.
- **Round-3 fixes alone**: 4 files, +41 −27 (`observed` — `git diff --stat feed712 59b3feb`).

### Files added (shipped source)

- `services/api/src/features/dispatch/board/` — `zone-rows.ts`, `cascade.ts` (+ specs)
- `services/api/src/features/rides/board-ride.ts` — the projection extracted under the 500-line cap (unplanned; see D4)
- `packages/shared/src/dispatch-explanation.ts` (+ `tests/dispatch-explanation.test.ts`)
- `apps/dispatch/src/features/zones/` — `zone-grid.tsx`, `cascade-strip.tsx`, `index.ts` (+ 2 tests)

### Files removed

- `apps/dispatch/src/features/board/zones-panel.tsx` + its test — retired by C5 as planned.

### Files modified (selected)

`dispatch.{policy,repository}.ts`, `board/board.service.ts`, `queue/{dispatch-queue.store,in-memory-dispatch-queue.store,redis-dispatch-queue.store}.ts`, `geozones/{geozones.repository,geozones.service}.ts`, `rides/{rides.repository,index}.ts`, `packages/shared/src/{realtime-events,index,i18n}.ts` + `i18n/{lv,ru,en}.ts`, `apps/dispatch/src/features/board/{ride-queue,index}.tsx`, `apps/dispatch/src/app/dispatch/page.tsx`, `services/api/test/dispatch-queue-store.contract.ts`, `CLAUDE.md`.

## Validation results

`observed` — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`, run in a worktree at the final head `59b3feb`: **18/18 tasks, 0 cached, exit 0, 1m2.128s**.

- **Syntax & Linting**: ✓ — 0 errors. The 9 `no-unsafe-argument` warnings are all in pre-existing integration specs this phase does not touch.
- **Type Checking**: ✓ — clean across all packages.
- **Unit + Integration Tests**: ✓ — `@taxi/api` 615 passed / 66 suites / 0 skipped; `@taxi/shared` 195 passed / 21 files; `@taxi/dispatch` 222 passed / 27 files; `@taxi/db` 17 passed / 3 files.
- **Build**: ✓.

**CI green on GitHub's runner at both round-3 heads** (`observed` — `gh run list`): run **32128678759** at `feed712` and run **32134374058** at `794d602`, both `pull_request`, both conclusion **success**. `59b3feb` is a markdown-only commit on top of `794d602`.

**Mutation evidence** (`observed`, each reverting only the source its fix touched with tests held at head): api **4 failed** / 611 passed / 615 total; shared **1 failed** / 194 passed / 195; dispatch **3 failed** / 219 passed / 222. The api row was **5** before the round-3 fixes and is **4** after — see D2; it was re-derived rather than carried, which is the point of recording it.

## What went well

- **The batching GOTCHA in Task C4 was obeyed at the cost of the plan's own API sketch.** C4 named the queries to join *and* forbade a per-ride fan-out; those two instructions conflict, and the implementation followed the constraint rather than the sketch (D1). That is the right precedence.
- **The 500-line cap was resolved by extraction, not by raising it or disabling the rule.** `rides.repository.ts` hit 504 lines because two branches added to it; the pure board projection moved to a sibling with one consumer, and the move was disclosed as verbatim so review did not have to read it as new untested source.
- **The rebase onto the merged base was landed as a reviewable event.** Every pre-rebase figure was re-run rather than edited, and superseded numbers were left in place beside their replacements instead of being quietly overwritten.
- **The i18n split absorbed Phase C cleanly.** 80 lines of new strings landed in three dictionaries with byte-identical key sets; `packages/shared/src/i18n.ts` dropped 454 → 47 lines, which solved the cap problem there rather than deferring it.
- **Review round 3 caught two Highs that rounds 1 and 2 could not have.** Both were created by the rebase, not by Phase C's own work — which is an argument for reviewing the rebase commit as its own event, and it worked.

## Challenges encountered

- **A sibling PR merging first changed the meaning of a function this phase depends on.** #120's H3 redefined `countAttempts` from "rows for this ride" to "rows since the last dispatcher release". Phase C's board had already been written against the old meaning. Nothing failed; the two simply stopped answering the same question (D2).
- **The divergence was undetectable by test.** `buildCascades` is pure over its inputs, and a released ride and an un-released one are *indistinguishable in those inputs* — so the defect could not be expressed as a `cascade.spec.ts` case at all. Rounds 1 and 2 each found tests passing on fixtures the runtime cannot produce; this is the mirror image, a runtime state no fixture can reach.
- **A real test failure was attributed to the wrong cause and written into the file every session loads.** 8 integration tests failed during the rebase; the diagnosis ("Phase B's specs need Redis and are not gated") went into root `CLAUDE.md`, the implementation report, the PR body and a new GitHub issue before anyone checked it against the harness (D5).
- **Conflict resolution folded the whole i18n end-state into the first rebased commit**, so later commits' messages describe hunks that are now empty. The tree is correct at every step; the per-commit attribution is not. Disclosed rather than fixed by history rewriting.

## Divergences from plan

**D1 — `cascade.ts` reads one batched query, not the three the plan named**

- **Planned**: C4 — *"`cascade.ts` joins `findPendingForRide` / `countAttempts` / `findTriedDriverIds` to names"*.
- **Actual**: one batched `findOffersForRides(rideIds)` returning every offer row for the frame's rides; pending, tried set and attempt count are all derived from it in JS.
- **Reason**: C4's own GOTCHA forbids a per-ride fan-out on a surface that rebuilds every 2 s. Three per-ride reads × up to 100 rides × 30 frames/min is exactly what that GOTCHA exists to prevent.
- **Type**: Plan assumption wrong — the task's IMPLEMENT line and its GOTCHA contradicted each other.

**D2 — the board's attempt cap was removed after the rebase (round-3 F2/F3)**

- **Planned**: not in the plan at all. The cap comparison entered in review round 1 as the fix for H2 ("«Nākamais» must not name a driver once the cascade has given up").
- **Actual**: removed in `794d602`. `nextInQueue` no longer compares against `MAX_OFFER_ATTEMPTS`; the docblock states the divergence instead.
- **Reason**: #120's H3 made the engine's budget release-scoped (`findLastReleasedAt` → `countAttempts`), while the board's `attempts` is cumulative since booking. After a dispatcher release the engine restarts at 0 and the board's count does not, so the strip stopped naming «Nākamais» for a ride whose cascade the engine had just restarted with a full budget — inverting the phase's headline promise. The frame carries no release timestamp to reconcile the two, and a per-ride audit read per frame is the cost `board.service.ts` already declines to pay for `unclaimedSeconds`.
- **Type**: Plan assumption wrong — invalidated by a sibling PR merging first, in a file whose own comment (`cascade.ts:180-181`) had named the exact invalidating condition in advance.

**D3 — Phase C's strings landed in per-language files, not `i18n.ts`**

- **Planned**: C7 — *"ADD the LV strings for Phase C to `packages/shared/src/i18n.ts`"*.
- **Actual**: into #122's `packages/shared/src/i18n/{lv,ru,en}.ts`, with `i18n.ts` reduced to assembly + `isMessageKey`.
- **Reason**: #122 split the catalog while Phase C was in flight; the conflict resolution adopted the new shape rather than reinstating the old one.
- **Type**: Better approach found (by a sibling phase).

**D4 — `board-ride.ts` extracted from `rides.repository.ts` (unplanned)**

- **Planned**: nothing. C4 modifies `board.service.ts`; the repository was expected to absorb a 12-line `geozoneId` projection.
- **Actual**: `rides.repository.ts` hit **504** lines — a `max-lines` error — once Phase C's field landed on #120's `unassignDriver` guard. `boardPickupSchema`, `BOARD_STATUS_SET`, `isBoardStatus` and `BoardRide` moved verbatim to a sibling; the file is **464** after, and `features/rides/index.ts` re-exports `BoardRide` so no consumer changed.
- **Reason**: two branches adding to one file, each individually under the cap.
- **Type**: Other — a cap collision only visible after the merge.

**D5 — a false claim was written into `CLAUDE.md` during the rebase and retired in round 3 (F1)**

- **Planned**: M5 recorded a figure correction only — the gated-skip count 24 → 33.
- **Actual**: the rebase kept the corrected digit and rewrote the *sentence* around it, asserting the api suite is RED without `REDIS_TEST_URL` because Phase B's `bookings`/`customers` integration specs need Redis and are not gated. Reverted in `794d602`.
- **Reason**: 8 integration tests genuinely failed twice during the rebase; the cause was inferred rather than checked. The harness rules it out — `test/harness.ts:454` overrides `KV_STORE` with `InMemoryKeyValueStore`, both specs build through `createTestApp`, and `rides.service.ts:120` reaches `setIfAbsent` only through that injected token. `observed` at `feed712`: the exact command from the claim is **exit 0**, `33 skipped, 582 passed, 615 total`; the two specs run alone are 2 suites / 13 tests / exit 0.
- **Type**: Plan assumption wrong — and specifically, a *correct* digit correction taken as licence to rewrite the sentence around it. Issue #127 was re-scoped from "gate these specs" to "find what actually made them fail"; the shared-test-DB collision `CLAUDE.md` documents one paragraph later is the leading hypothesis.

## Skipped items

None. Tasks C1–C7 all shipped. Phase D (acceptance closure) was out of scope for this PR and remains open; its task list was reconciled during the rebase so it does not re-scope four integration tests Phase A already shipped.

## Recommendations

Ordered by expected effect. Per `CLAUDE.md` the outer loop acts on **1–2**, and per the AI-layer's own history a remedy that edits a **skill** fires later while one that adds prose to `CLAUDE.md` does not (#87 ran both; only the skill edit survived).

1. **`piv-review-pr` / `piv-fix-review-findings`: sweep stated guarantees, not just figures, when a branch is rebased onto a merged base.** The rebase addendum swept every *number* thoroughly and the sweep held. It did not sweep *guarantees* — and D2 is a guarantee invalidated in a file that carried a comment naming the exact condition that would invalidate it. The executable form is a step in the review skill: for a PR whose base moved, grep the diff's own conditional comments ("if X changes, this needs re-deriving") and any "returns null when / always / never" claim in a docblock or PR body, and re-derive each against the merged base. **This is the one to implement.**

2. **`piv-plan-implementation`: a task whose IMPLEMENT line names specific functions and whose GOTCHA forbids the shape those functions imply should say which wins.** D1 resolved correctly, but by the implementer noticing the contradiction, not because the plan said so. The cheap fix is a rule in the plan skill's task template: when a task carries both, the GOTCHA is binding and the IMPLEMENT line is a sketch.

3. *(Not recommended for action this round, recorded for the next plan touch.)* Task C4's IMPLEMENT line is still stale on `main` — it names `countAttempts`, the very coupling D2 removed — and four VALIDATE lines still `cd` to the retired `taxi-dispatch-override` worktree. This is the **same finding Phase A's system review deducted two points for**: the plan was not updated to match what shipped. Recurring twice makes it a process defect rather than an oversight, which is why the remedy belongs in a skill step rather than in another reminder.
