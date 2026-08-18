# PR #120 review — round 2 (the review-fix pass)

**Head at review time** `34633a4` · **Base** `main` · round-2 diff `ced2d30..34633a4`, 36 files, +1002/−92
**Head now** `6f4ebc6` — this review's own findings were fixed during it (see *Disposition*).
**Reviews** the commits answering [round 1](https://github.com/linardsb/taxi/pull/120#issuecomment-5320202713).

> **Reviewer independence is weaker than round 1, and that governs how to read this.** The fixes were written by the same session that ran this review. The deep passes were delegated to two agents in clean contexts — a `code-reviewer` on the diff and an adversarial verifier on round-1 closure — and every finding either agent raised was reproduced by hand before being acted on. But a human should treat "no further findings" here as much weaker evidence than round 1's.

## Validation

| Run | Result |
|---|---|
| CI, run 32073129552, `head_sha 34633a4` | **success** (`observed`) |
| Local gate at `6f4ebc6` — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` | **exit 0, 18/18 tasks** (`observed`, gate4.log) |
| `@taxi/api` | 524 passed, 57 suites, 0 skipped |
| `@taxi/shared` · `@taxi/dispatch` · `@taxi/db` | 167 (19 files) · 157 (20 files) · 17 (3 files) |

One earlier local gate failed 21 tests, all `dispatch.integration.spec.ts` dying in `beforeAll`, then hung on open handles. It did not reproduce and matches root `CLAUDE.md`'s "integration runs are mutually destructive across sessions" — the Phase B and C worktrees were both committing at the time. Recorded rather than dropped.

## Round-1 closure

All 19 findings closed. **C1, H1, H2, H4, M1, M3, M6, M7, L4, L5** each have a test that fails on reversion; C1 and H1 were confirmed by actually disabling the fix (C1: two accepted rows at 102c vs 406c commission on one €10.15 ride; H1: focus on `<body>`). Two declared deviations, both correct:

- **L2** — the review's literal `['accepted','arriving']` predicate would 409 **every** release, because `ReassignService` transitions to `requested` before calling `unassignDriver` in the same transaction. Shipped as `['requested','accepted','arriving']`.
- **H3** — used the `sent_at`-since-release cutoff rather than excluding `source='dispatcher'`; only the former also covers a ride that genuinely cascaded to the cap before acceptance.

## Findings

### High · The `offerNext` half of the H3 fix was invisible to the suite — **FIXED in `6f4ebc6`**

`dispatch.service.ts:61-62`. H3's whole point is that `offerNext` gates on `countAttempts` and therefore refuses to re-offer a released ride. **Verified, not taken on the agent's word:** changing that line to `countAttempts(ride.id, null)` — reverting H3 in the one function H3 is about — left **all 521 api tests passing**. The three artifacts all missed it: the sweeper spec stubs `DispatchService` whole, the integration test calls the repository directly, and `dispatch.service.spec.ts` never invoked `offerNext`.

This is the round-1 review's central argument reappearing inside the fix for the finding that made it. Three cases added; the same sabotage now fails 2.

### Low · Three claims the fix commits made false — **FIXED in `6f4ebc6`**

- `board/board.service.ts:111` — "Same arithmetic as the sweeper's `isStale`" stopped being true when M3 re-based the sweeper's clock and left the board frame on time-since-booking.
- `dispatch.repository.ts` — "covers the predicate" overstates `dispatch_audit_log_ride_idx`, which covers the `ride_id` half only.
- `dispatch.integration.spec.ts` — a comment describing the cascade offering the ride, an outcome no run in that file produces. The #107 shape, committed while fixing #107's shape.

### Low · Focus restore was a silent no-op on a detached opener — **FIXED in `6f4ebc6`**

`dialog-shell.tsx` — a 2 s board frame that drops the ride unmounts the captured row button; `.focus()` on a detached node does nothing and focus lands on `<body>`, the exact WCAG 2.4.3 failure the effect exists to prevent. Now falls back to the page `<h1>`, with a test.

### Medium · Two false claims the fix pass **introduced** — **FIXED in `2565d8e`**

Found by the verification agent, reproduced by hand, and the most instructive findings here because both are the very defect being fixed:

1. **A fabricated cause.** `CLAUDE.md:43` was corrected from 24 → 28 skipped tests, then given a cause nobody checked: *"#19 took it 24 → 28 by adding gated tests."* **#19 adds no gated tests** — `git diff origin/main...HEAD` over all four gated specs and both store contracts is empty, so main skips 28 too, and `git log` puts the last change to `test/driver-location-store.contract.ts` in `2859446` (#18). The attribution came from round 1's own claims audit and was inherited rather than audited.
2. **A fabricated provenance.** "33 `console.*` keys (`observed`: 99 added lines ÷ 3 catalogs)" — 99 was back-derived from 33 × 3. `git diff --numstat` reports **131** added lines. The 33 is right; the label was not.

Both corrected in `CLAUDE.md`, the implementation report, the plan (which still carried a bare "24 short"), and the PR body.

### Medium · M2's integration companion was dropped undeclared — **FIXED in `2565d8e`**

Round 1 asked for an integration case reassigning onto a non-existent driver. The fix pass added the pre-flight and unit cases and quietly skipped it. Now present: a 404 that also asserts the ride keeps its driver, vehicle stamp and `on_ride` status, and that no release audit row was written.

### Informational

`rides.repository.ts` is at **492/500** (`observed`, `wc -l`), up from 461 — the L2 predicate and its docblock cost 31 lines. Not a violation; 8 lines of headroom with Phases B and C still to land on this file.

### Out of scope (pre-existing at `ced2d30`)

`dispatch/index.ts` — *"BALANCE ELIGIBILITY IS `>= 0` … a strict `> 0` would match nobody"* contradicts `strategies/candidate-filter.ts:45`, which implements a debt **limit**, not a zero floor. Not this PR's doing; worth a ticket.

## What is good

- **The C1 regression test discriminates rather than merely passing.** Two drivers at 10% and 40%, *neither* the platform base, so a stale row fails whichever the heap yields — and it asserts the settled commission is explicitly **not** the released driver's number.
- **Two required parameters instead of two optional ones.** `countAttempts(rideId, since)` and `raiseUnclaimed(ride, attempts, pooledSince)` both refuse a default, because a default of "count everything" is the old behaviour under a new name. That hardening is what made the High above findable at all.
- **H2 was fixed at the source.** The obvious fix rewrites the returned `Outcome`; round 1 had already shown `page.tsx` discards it. Threading `fallback` into `post` puts the verb where the state write happens, and the test asserts `errorKey` — so it would catch the wrong fix too.
- **`reassign.service.spec.ts`'s ordering ledger** pins the two-transaction design, the supersede's position inside the transaction and the room-leave's outside it, in one assertion asserted identically on the happy and throwing paths.
- **`realtime-events.md` now warns that `ride:status` can move backward** and tells a consumer what to do about it — written for the person it will save.

## Recommendation

**Approve, with one caveat about who is saying so.**

No Critical or High remains open, the gate is green from a cleared build, and every round-1 finding is closed with a reversion-failing test where one is possible. The findings this round raised were fixed during the review rather than deferred, which is why nothing is outstanding — and also why this verdict is weaker evidence than round 1's: the reviewer and the author are the same session.

**Before merge, a human should look hardest at** the two false-claim findings above. Twice now — #87, #107, and this branch twice more — a number has been corrected while a *sentence* around it stayed wrong, and the fix pass reproduced that exact failure while fixing an instance of it. The code is in good shape; the prose around it is where this repo keeps bleeding.

**Also needs a decision, not a fix:** Phase B (`feature/dispatch-phone-orders`) and Phase C (`feature/dispatch-zones-cascade`) both branch from `ced2d30` and contain none of this. They carry the C1 money defect, the unguarded `unassignDriver`, and the false figures. They need `6f4ebc6` merged before their PRs open.
