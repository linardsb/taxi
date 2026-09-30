# PR #309 review, round 2: gate drivers on admin approval, `/admin` driver routes (#20, PR 1 of 4)

**Head** `f22803c` · **Base** main @ `0f0897e` · reviewed 2026-09-30 · base unchanged since round 1 (live `origin/main` = `0f0897e` = round 1's recorded base), so the guarantees pass does not apply

## Summary

All five round-1 findings are closed, and each fix is pinned by a test that goes red when the fix is reverted (observed below, re-run by this review rather than copied from the fixes report). The full gate is green at the head. The fix-mechanism pass found one residual race in L1's new re-read (R1, Low, `observed` by probe; its most likely form predates this PR).

CI ran green on the head. It queued late: no run existed at 13:43 or 13:48 UTC, and run `36724387960` was created at 13:48:45Z, 7m45s after the fix-report commit's timestamp (13:41:00Z; the push time itself was not observed). Nothing to act on.

**Recommendation: approve.** No code change is required. R1 is optional.

## Issues

### Low

**R1: L1's re-read checks approval but not status, so a reject-then-re-approve (or a server offline) inside the gap still returns a stale 200**
- **Where:** `services/api/src/features/drivers/drivers.service.ts:224`.
- **Scenario:**
  1. The driver's go-online `UPDATE` commits (`online`).
  2. Before `markOnline`, something sets the row `offline` and clears Redis: an admin reject followed by a re-approve (re-approving keeps `status: 'offline'`, `admin-drivers.repository.ts:176-181`), or, more plausibly, `markOfflineByServer` on a socket disconnect.
  3. `markOnline` re-adds the Redis member. The re-read sees `approved`, so the handler answers 200 with the `online` profile.
- **Effect:** Redis says online, Postgres says offline. The driver is undispatchable (`candidate-filter` reads Postgres `status`), but ingest keeps acking fixes, so the dark sweep does not correct it until the next toggle or disconnect.
- **Why Low:** needs sub-round-trip timing; the disconnect variant predates #20, and before the fix the approval variant ended in the same state. The fix did not make anything worse.
- **`observed`:** a probe in `admin-drivers.integration.spec.ts`, the L1 test's one-shot `markOnline` spy changed to reject, then re-approve, then call through. `npx jest … -t 'PROBE R1'` logged `PROBE 200 true offline`: the go-online answered 200, `isOnline` was true, and the row was `offline`. The probe was then reverted (`git status` clean).
- **Optional fix:** document the race beside the L1 comment. A code fix is possible but not prescribed here: re-checking `status === 'offline'` needs an answer the driver app handles. `driver_not_approved` would be false for a re-approved driver, and an unmapped code lands in the reducer's generic branch (`presence-state.ts:434-441`), which keeps intent online and re-asserts. Do **not** test `status !== 'online'`: a force-assign landing in the gap legitimately writes `on_ride`, and `markOffline` would then cut a riding driver's tracking feed.
- **Source:** raised by the `code-reviewer` agent, confirmed by this review's read of `setApproval` and by the probe above.

### Considered and not raised

- **The new `find` throwing after `markOnline`** leaves both stores online behind a 500. The reducer's generic branch keeps `intent: 'online'` (the agent's read, not traced further). The same class of failure existed for `markOnline` itself failing after the `UPDATE`; a primary-key read failing right after a write succeeded is rare. Not a finding.
- **`adminVehicleUpdateSchema` defaults:** `.partial()` over `category`/`hasChildSeat` `.default(...)` could, under zod 4 semantics, inject defaults into every patch and reset `category`. Probed: the package runs zod `3.25.76` via `from 'zod'` (v3 API), and `{ make: 'x' }` parses to `{"make":"x"}`. No issue.
- **Dispatch copy for a reassign refusal:** `reassign` (`apps/dispatch/src/features/override/use-assign.ts:159-161`) goes through the shared `post` helper, which maps the error with `assignErrorKey` (`:137`) over `ERROR_KEYS` (`assign-state.ts:86`). That map now has `driver_not_approved`, so M1's new 409 reaches Dina as the right sentence.

## Fix-mechanism pass (round 2)

Round 1 raised no Critical or High, so this pass is not required; it was run on every fix anyway. The fixes report `.claude/reports/pr-309-review-fixes.md` carries the per-finding sweep and red-first outputs `piv-fix-review-findings` requires.

| Fix | What the mechanism newly permits | Verdict |
|---|---|---|
| M1 pre-flight 409 | A pending driver must reach the check: `findMatchAttributes` is a left join with no approval filter and returns `approvalStatus`, so it yields 409, not 404 | Sound |
| L1 re-read after `markOnline` | One extra read per go-online; a new 409 path that clears Redis first; the reject-after-read ordering holds because `setApproval`'s `markOffline` runs after its commit | Sound, R1 residual |
| L1's 409 in the app | `presence-state.ts:379-386` flips intent offline, so no re-assert loop | Sound |
| L2 allowlist | Covers all 7 fields left after `.omit({ id, driverId })`; `category` included | Sound |

**Mutation checks, `observed` by this review** in `wt-20` at `f22803c`, each fix removed, the spec run, then `git checkout` restoring the file (`git status` clean after each):

| Fix removed | Command | Result |
|---|---|---|
| M1 `approvalStatus !== 'approved'` pre-flight | `npx jest src/features/dispatch/reassign.service.spec.ts` | `1 failed, 17 passed, 18 total` |
| L1 re-read block | `npx jest src/features/drivers/admin/admin-drivers.integration.spec.ts` | `1 failed, 12 passed, 13 total`, `expected 409 "Conflict", got 200 "OK"` |
| L2 allowlist → `.set(patch)` | same spec, `-t 're-parent'` | `1 failed, 12 skipped, 13 total`, car `id` rewritten |

These match the fixes report's red-first claims (M1 `1 failed, 17 passed, 18 total`; L1 `expected 409 … got 200`; L2 `id` rewritten).

## Validation

`observed`: `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi record-gate.sh --clean` in `wt-20` at `f22803c`, exit 0.

| Check | Result |
|---|---|
| Full gate (`pnpm turbo run typecheck lint test build --force`) | 23 successful, 23 total · 0 cached · 1m58.6s |
| @taxi/api | 999 passed, 95 suites (Redis suites ran) |
| @taxi/shared | 317 passed |
| @taxi/dispatch | 303 passed |
| @taxi/driver | 364 passed |
| @taxi/rider | 231 passed |
| @taxi/db | 17 passed |
| CI on the PR, run `36724387960` at `f22803c` | check, codeql, CodeQL, audit-diff, ready all pass |

Every count matches the PR body's gate block (run at `dbbb14a`; `git diff --stat dbbb14a f22803c` touches only the two `.claude/reports/` files, as the body says).

## Numbers pass

- **Re-derived and correct:**
  - **Tests:** 999 = 977 + 22; 22 = 5 + 3 + 11 + 3. Counted at head: `reassign.service.spec.ts` 18 `it`s, `admin-drivers.integration.spec.ts` 13, `admin-drivers.service.spec.ts` 3. 95 suites = 93 + 2.
  - **"Six places":** go-online, candidate filter, offer accept, force-assign, reassign pre-flight, roster. Six.
  - **L2 "all 7 fields":** plate, make, model, year, category, passengerSeats, hasChildSeat.
- **M2 retired correctly:** the PR body, report `:14` and plan `:406`, `:841` now give 4 / ~8 / 12 s, each `derived`, with the condition it assumes and a "not a hard bound" line. `fix-throttle.ts:9`, `location-options.ts:19` and `driver-device-day.md:271-275` say what they are cited for. `grep "≤ 4"` leaves only the plan's AMENDMENTS history line `:914`, which names the correction. Plan `:895` ("4 s cadence") describes the nominal cadence in a verification table, not a bound.
- **Provenance labels:** the mutation table's totals are explicitly attributed to `8456efe`, and the body explains why they differ from the head's 13. Correct as labelled.

### Claim-check comparison

- **Flags confirmed: 0.**
- **Flags rejected: 1.** The body's block is still the round-0 run (labelled so in its summary line): L74's "Manual, dev DB" heading, rejected in round 1 for the same reason.
- **Figure findings the check missed: 0** this round. The block was not re-run on the round-1 body, so it could not see the rewritten window figures; they are correct anyway.

## What is done well

- **Every fix came with a red-first test**, and each one reproduces: three for three when this review reverted them.
- **M2 was retired by subject, not by digit:** the report, plan and body all carry the same derivation with its assumptions, and the sweep table names each grep.
- **L1's ordering argument is written down in the code** (`drivers.service.ts:219-223`) and it holds.
- **L2 repeats the driver repository's allowlist and its warning comment**, so the two vehicle writers now read the same way.

## Recommendation

**Approve.** No Critical, High or Medium. R1 is optional: a comment beside the L1 re-read naming the race. A human reviews and merges.
