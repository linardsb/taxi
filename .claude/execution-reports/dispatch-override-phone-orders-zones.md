# Execution Report — #19 Phase A: dispatch force-assign / reassign / cancel

**As of:** 2026-08-18, written **before** #121 merged. #121 has since merged as `30a0662` (12:19 UTC); every "#121 is open" statement below is as-written, not current. Phase C's own artifacts state the post-merge position correctly.

**Scope of this report:** Phase A only (PR #120, merged `369b953` on 2026-08-18). Phases B (#122, merged `d444c72`) and C (#121, open at `feed712`) appear only where they falsified something Phase A wrote down.

- **Plan file**: `.claude/plans/dispatch-override-phone-orders-zones.md` (Tasks A1–A13)
- **Implementation report**: `.claude/reports/dispatch-override-phone-orders-zones-report.md`
- **Reviews**: `.claude/code-reviews/pr-120-review.md`, `pr-120-review-round2.md` (main checkout, uncommitted by design)
- **Lines changed**: +6073 −79 across 53 files (`observed` — `git diff --stat 30d057b 6f4ebc6`). That total includes the plan and report themselves, which are ~2 400 lines of it.

### Files added (shipped source)

- `services/api/src/features/dispatch/` — `reassign.service.ts`, `roster.service.ts` (+ specs)
- `apps/dispatch/src/features/override/` — `assign-dialog.tsx`, `cancel-dialog.tsx`, `dialog-shell.tsx`, `driver-picker.tsx`, `row-actions.tsx`, `use-assign.ts`, `assign-state.ts`, `index.ts` (+ 5 test files)
- `packages/shared/src/schemas/dispatch.ts` (+ `tests/schemas-dispatch.test.ts`)

### Files modified (selected)

`dispatch.{controller,module,policy,repository,service,sweeper,index}.ts`, `board/board.service.ts`, `rides/rides.repository.ts` (+79), `rides/lifecycle/ride-lifecycle.service.ts`, `drivers/{drivers.repository,drivers.service,index}.ts`, `notifications/ride-notifications.service.ts`, `packages/shared/src/{i18n,index,ride-state-machine,theme}.ts`, `apps/dispatch/src/features/board/ride-queue.tsx`, `CLAUDE.md`, `.claude/references/{realtime-events,ride-state-machine}.md`.

## Validation results

`observed` — `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force`, in the worktree 2026-08-17, at #120's head:

- **Syntax & linting**: ✅ clean, all packages
- **Type checking**: ✅ clean, all packages
- **Unit + integration tests**: ✅ `@taxi/api` 510 passed / 57 suites / 0 skipped · `@taxi/shared` 167 · `@taxi/dispatch` 147 · `@taxi/db` 17
- **Gate**: ✅ 18/18 tasks, 0 cached, 49.964 s
- **CI on the merged head**: ✅ `check` SUCCESS at `6f4ebc6`

Largest shipped source file added: `driver-picker.tsx` at 221 lines against the 500 cap. No `max-lines` disable written.

## What went well

- **The two-transaction split in `ReassignService` was designed before it was written, and the design held.** Release commits, then force-assign runs as its own transaction; the failure path leaves the ride at `requested` with no driver, audited, for the cascade to pick up. Both halves have integration coverage.
- **Phase A pulled its own integration tests forward rather than trusting its unit specs.** `reassign.service.spec.ts` asserts transaction *order* against a fake `db.transaction`; it cannot prove how two conditional UPDATEs interlock across two commits. Four integration tests were written in Phase A instead of waiting for Phase D. That judgement was correct and is the reason C1 was catchable.
- **The review found C1 — a money bug with no failing test and no user-visible symptom.** A reassigned ride carried two `accepted` offer rows and settled at whichever the heap yielded, i.e. the *released* driver's commission rate, with the rider-facing total unchanged so no existing guard fired. The fix (`supersedeAcceptedOffer`) was verified by disabling it and observing two rows at 102c and 406c on one €10.15 ride.
- **`countAttempts`'s `since` was made required rather than optional.** An optional parameter defaulting to "count everything" would have been the old behaviour under a new name; a later caller would have compiled, passed the suite, and silently reinstated H3.
- **Vertical slice discipline held under pressure.** `row-actions.tsx` keeps the override slice owning what a dispatcher can do to a board row, which is what kept `ride-queue.tsx` inside the cap.

## Challenges encountered

- **Colima wedged twice — once in Phase A, once in today's rebase session.** Both times it reported `Running` while the socket was dead; in today's instance `limactl list` showed no instance at all. Symptom is a gate that hangs at the api test task with turbo buffering the output, so it reads as a slow test. Fix both times: `colima stop --force && colima start && docker compose up -d --wait`.
- **The worktree had no env file, and it cost ~25 minutes in Phase A.** The PreToolUse hook blocks the agent from copying it (it matches command *text*, not intent), so a human must. Without it, compose falls back to port 6379 — already held — so the Redis container never starts, and a gate with `REDIS_TEST_URL` set points ioredis at a closed port and hangs indefinitely rather than failing.
- **Phone-number fixture collisions.** New dispatcher fixtures had to move to `p(110)`–`p(112)`; `p(95)`–`p(97)` are already DRIVER phones in `dispatch.integration.spec.ts`, and reusing them broke two unrelated pre-existing tests.
- **Concurrent sessions share one Postgres.** Integration global-setup drops the shared test DB, so a mid-sequence single-test failure that does not reproduce is the expected noise shape, not a signal. Both Phase A and Phase C hit it and both flagged rather than dismissed it.

## Divergences from plan

**Four integration tests written in Phase A, not Phase D**
- Planned: Phase D Task D1 owned integration coverage.
- Actual: reassign end-to-end, `arrived` refusal, roster-lists-offline, roster-dispatcher-only — all in Phase A.
- Reason: the unit specs assert order against a fake db and cannot prove the real conditional UPDATEs interlock.
- Type: Plan assumption wrong. **The plan was never updated to match** — see Recommendations; this was fixed on 2026-08-18 by adding Task D1b.

**`unassignDriver()` added to `RidesRepository`**
- Planned: not in the task list.
- Actual: added, guarded on the outgoing driver id in the WHERE.
- Reason: `assignDriver` guards on `isNull(driverId)`, so the old driver must be cleared first. The guard in the WHERE rather than a read-then-write makes two racing dispatchers produce a 409 instead of both proceeding.
- Type: Plan assumption wrong.

**`dialog-shell.tsx` and `row-actions.tsx` created**
- Planned: neither named.
- Actual: both extracted.
- Reason: shared focus-trap/Escape handling, and slice ownership of row actions.
- Type: Better approach found.

**The failed-submit reset is derived, not an effect**
- Planned: `useEffect(() => setPicked(null), [errorKey])`.
- Actual: `showPicker = picked === null || errorKey !== null`, plus an `onClearError` prop.
- Reason: the repo's eslint config rejects setState-in-effect.
- Type: Better approach found. Identical behaviour, one fewer render.

**`AssignDialog` lost its `rideId` prop; `AuditEntry` gained an optional `payload`; `RosterService` takes `DriverLocationStore` directly; `dispatch-page.test.tsx` mocks `next/navigation`**
- Four small corrections where the plan's shape did not survive contact with the linter, the audit trail's needs, or the app-router runtime. All documented in the implementation report.
- Type: Plan assumption wrong (minor).

## Skipped items

- **The `⌥A` hotkey** (plan task A12). Rows are Tab-reachable and the dialog is zero-mouse, but no global shortcut. Reason: better designed alongside Phase B's `⌥N`.
- **Phases B, C, D** — sequenced deliberately, not skipped.
- **Open question Q2 is live, not resolved**: `accepted|arriving → requested` is shipped in `@taxi/shared`, so a rider watching an accepted ride can see it return to "searching". #15/#16/#17 inherit it.

## The recurring defect — five instances, and what they actually have in common

This is the primary input for the evolution review that follows.

| # | Instance | What was wrong |
|---|---|---|
| 1 | #87 | A best-case interval shipped under a worst-case label. The number was right; the label was wrong. |
| 2 | #107 | `30 = 6 cells × 5 polls` printed under **Observed**, correctly derived, but no run produced it — and it credited #87's ETA grid while every position already sat on the grid, making it an identity function. |
| 3 | #122 review round 1 | Three figures that did not reconcile with each other. |
| 4 | The fix pass for (3) | A `+5` delta pasted next to a 24-file absolute drawn from a different run. |
| 5 | This session | The handoff prompt carried `54.3 s` where the PR body said `55.15 s`. Separately, two claims were false *in kind*, not stale in digit: "GitHub retargets this to `main` automatically" (it does not — this repo has `deleteBranchOnMerge: false`), and `CLAUDE.md:43`'s "a green gate can be N tests short" (the gate is now **red** without `REDIS_TEST_URL` — Phase B shipped ungated Redis-dependent specs, filed as #127). **Superseded** — the *replacement* was itself false, which makes this the sharper instance: `CLAUDE.md:43`'s original sentence holds and was restored in `794d602`, because `test/harness.ts` overrides `KV_STORE` with `InMemoryKeyValueStore` and the mechanism cannot fire. What made 8 integration tests fail is still unknown; #127 is re-scoped to finding it. The retargeting half stands. See `…-phase-c.md` D5. |

**The common mechanism is inheritance, not mislabelling.** In every instance a figure or claim was copied from one surface to the next — plan → implementation → report → PR body → handoff prompt — and re-derived at none of them. Provenance labels were often *present*; they simply named a run that was no longer the current one.

**Instances 1 and 5 defeat a numeral-extraction check outright.** #87's number was correct. Today's retargeting claim contains no numeral at all. A linter that demands every digit carry an `observed`/`derived`/`expected` tag would have passed #87, #107 and today's two false sentences — three of five.

**What discriminates all five is head-relative staleness**: a figure or claim present in a surface, unchanged, while the commit it describes has moved. That is mechanically detectable in a way "is this sentence true" is not.

## Recommendations

1. **The remedy must be executable.** Per `taxi-piv-remedies-need-an-executable-step`: #87 ran both a skill edit and a CLAUDE.md prose addition, and only the skill edit changed later behaviour. Instance 5 confirms it — root `CLAUDE.md` already carries two paragraphs about exactly this defect, and the defect recurred anyway, *inside the file those paragraphs live in*.
2. **Target inheritance, not labelling.** The smallest check with real coverage: at `piv-create-pr` / PR-update time, diff the numerals in the PR body and report against their previous version; for any numeral carried over unchanged while `HEAD` moved, require it be re-derived or explicitly marked head-independent. This catches instances 2, 3, 4 and 5's `54.3 s`. It does **not** catch 1 or 5's false sentences — say so rather than overselling it.
3. **A plan is a surface too, and nobody updates it.** Phase A's divergence from Phase D was recorded in the *report* and in the plan's changelog, but Phase D's task list still read as untouched work four days later. Whatever check runs on the PR body should also fail when a report documents a divergence from a plan task that the plan's own task list does not reflect.
4. **`CLAUDE.md` is not a remedy surface.** Two of its paragraphs are about this defect; one of them *was* the defect this session. Prose there is documentation, not enforcement.
