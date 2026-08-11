# PR #90 Review — feat(api): stamp `rides.vehicle_id` at assignment (#86)

**Verdict: APPROVE** (posted as a comment — solo repo, author ≈ reviewer, GitHub refuses self-approval)

**Review provenance**: the deep pass ran in a clean context via the `code-reviewer` agent against the PR head (`8848b88`) in an isolated worktree; validation was rerun independently. (The orchestrating session is the one that authored the PR — the agent, not it, is the fresh-eyes verdict here.)

## Summary

The PR does what it claims, the way the plan said it would: one correlated subquery inside the already-race-guarded `assignDriver` UPDATE stamps the vehicle atomically with the driver on both dispatch paths (zero dispatch-slice edits, unchanged signature); the notifications read path resolves the plate by the stamped PK and the fleet heuristic is fully excised (no remaining consumer of it or of `NotifiableRide.category`). Migration, journal, and snapshot agree exactly (nullable uuid, `ON DELETE set null`). All documented deviations in the implementation report check out as intentional.

## Verified specifically

- **Subquery correctness & injection safety** — `${driverId}` is a bound parameter; `${rides.category}` renders the correlated column (old-row semantics in an UPDATE, valid Postgres); `ORDER BY (v.category = rides.category) DESC` is correct "matches first" (booleans sort `false < true`; both category columns NOT NULL, so no NULL-ordering surprise); `plate ASC` is deterministic thanks to `vehicles_plate_uix`.
- **Race shape unchanged** — resolution happens inside the same `isNull(rides.driverId)`-guarded statement; the accept-race loser still 409s; no emit/provider call entered a transaction.
- **Tests genuinely pin the change** — all three new cases assert the `rides.vehicle_id` column directly, which did not exist before; phone range `+371280` and `p(n)` values are collision-free across all spec files; cleanup contract followed; the 204 delete assertion matches `@HttpCode(204)`.

## Issues

**Critical: 0 · High: 0 · Medium: 0 · Low: 2** (both non-blocking observations)

1. **Low · correctness (theoretical)** — `services/api/src/features/rides/rides.repository.ts:285-290`: if a vehicle DELETE commits between the assign UPDATE's snapshot and its FK check, the FK re-check raises 23503 and the accept/force-assign 500s instead of stamping NULL. Requires the driver to delete their own car in the same instant they're assigned; the delete path already forces last-car drivers offline. Fix only if it ever fires: catch 23503 at the two call sites and retry once.
2. **Low · testing (optional strengthening)** — `tracking.integration.spec.ts:412-457`: the one rider-visible divergence from the old heuristic — "fleet changed after assignment while other cars remain" — has no plate-level test (the row assertion at `:448` is what discriminates today). Nice-to-have: after `acceptBy`, PATCH the limo's category to `standard` and re-assert the page still shows the limo plate.

## Validation

| Check | Result |
|---|---|
| `pnpm turbo run typecheck lint test build --force` (CI parity, `REDIS_TEST_URL` set) | **20/20 tasks green** |
| api lint | 0 errors (7 pre-existing warnings, untouched files) |
| db vitest | 17/17 |
| New + existing api jest (incl. 143 rides/dispatch regression net) | green |

One intermediate gate run failed with the documented cross-session signature (`terminating connection due to administrator command` / `database "taxi_api_test" does not exist` — another live session's global-setup dropped the shared test DB mid-run); the immediate rerun on identical code was 20/20 green. Not a PR defect.

## What's good

- The resolution rule exists in exactly one place, inside the guarded UPDATE (the L8 house rule, `setOnlineIfEligible` precedent) — race-safety inherited, not re-proven, and future callers cannot forget the stamp.
- `driverCard`'s never-throw contract is preserved and documented at the exact line a future maintainer might "fix" into a throw.
- The SET-NULL failure test walks a full real lifecycle (accept → 4 steps → delete → receipt), so it also pins the `on_ride` delete-guard interaction.
- Migration meta discipline: SQL + journal + snapshot consistent, no drizzle-kit drift.

## Recommendation

Merge. Optionally log the two Low items (or fold #2 into a future fleet-editing ticket) — neither warrants holding the PR.
