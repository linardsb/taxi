# PR #309 review fixes, round 1

Review: `.claude/code-reviews/pr-309-review.md` (head `8456efe`). Triage (Linards, 2026-09-30): fix all five, M1, M2, L1, L2 and L3. Nothing deferred, nothing filed.

Fix commit `dbbb14a` (code, and the plan/report prose). A docs-only follow-up commit adds this file and one report line, and touches nothing outside `.claude/`.

## Fixed

| Code | What was wrong | Fix | Test, red on the unfixed code |
|---|---|---|---|
| M1 | Reassign's pre-flight checked only that the incoming driver exists. For an unapproved driver, `forceAssign`'s 409 came after the release had committed, so the ride lost its car | `reassign.service.ts`: `if (incoming.approvalStatus !== 'approved') throw new ConflictException('driver_not_approved')` in the pre-flight. The default spec fixture gained `approvalStatus: 'approved'` | `reassign.service.spec.ts` "409s an unapproved INCOMING driver before the release commits". This is the review's probe verbatim (`approvalStatus: 'pending'`, `forceAssignError: ConflictException('driver_not_approved')`, `events` = `[]`). **Unfixed, `observed`:** `1 failed, 17 passed, 18 total`, with `events` = `tx:begin, unassign, supersede, tx:commit, emit:status, leave:room, forceAssign`, the review's list exactly. **Fixed:** `18 passed, 18 total` |
| M2 | "≤ 4 s" was the nominal case written as a bound | The plan (`:401`, `:406`, `:841`, AMENDMENTS `:914`) and the report (`:14`) now state the window as a derivation (below). The PR body does too | Prose. The sweep is below |
| L1 | A reject committing between go-online's `UPDATE` and its `markOnline` left the rejected driver in the Redis online set | `drivers.service.ts` go-online branch: after `markOnline`, re-read approval (`drivers.find`); if not `approved`, `markOffline` and 409 `driver_not_approved` | `admin-drivers.integration.spec.ts` "a reject landing between go-online's commit and its Redis write still ends offline". A one-shot spy on `ctx.locations.markOnline` runs the admin reject over HTTP before calling through, which forces the review's interleaving (step 1 commit, step 2 whole `setApproval`, step 3 `markOnline`). **Unfixed, `observed`:** `expected 409 "Conflict", got 200 "OK"`. **Fixed:** passes, and asserts `isOnline` false and row `offline` |
| L2 | `updateVehicle` used `.set(patch)` | `admin-drivers.repository.ts`: an explicit allowlist of all 7 editable `vehicleSchema` fields, `category` included, the same as `VehiclesRepository.update` | Admin integration spec "an admin vehicle patch cannot re-parent the car, even past the schema". It calls the repository with `{ make, driverId: <other driver>, id: <random uuid> }`, which simulates the schema losing its `.omit()`. **Unfixed, `observed`:** the car's `id` was rewritten (`Expected: "b7033009-…" Received: "cf810b5f-…"`). **Fixed:** passes |
| L3 | The candidate-filter comment claimed `releaseFromRide` returns a revoked driver to `online`, but `setApproval` refuses revoking an on-ride driver | `candidate-filter.ts` and its spec comment now say the check is unreachable today, and that it guards a path that writes `online` without the gate (for example SQL). The same false reason in the plan's `:348` IMPLEMENT line was corrected. The PR body's candidate-filter bullet is corrected too | Comment only; no behaviour change |

**Mechanism check (L1).** L1 is Low, so this check is not required; it is recorded anyway. The fix adds one Postgres read to every go-online, and a new 409 path after `markOnline`. That path clears Redis before throwing, so it cannot leave a member behind. A reject that commits *after* the re-read runs its own `markOffline` after our `markOnline`, because our write precedes our read. So both orders end offline.

## M2's replacement figure, re-derived rather than copied

- **Nominal cadence:** up to ~4 s. The reject lands at a random point in one `MIN_FIX_INTERVAL_MS = 4_000` gap (`fix-throttle.ts:9`).
- **One delivery under the floor:** ~8 s. `selectFixes` measures from the last *kept* fix and drops anything under 4000 ms, so a delivery at 3999 ms is dropped and the next kept fix is ~8 s out (`docs/runbooks/driver-device-day.md:271-275`).
- **One delivery dropped:** 12 s = 3 × 4 s. This is the runbook's allowance.
- **In every case:** plus the ack round trip and one `PUT` round trip.
- **Not a hard bound:** `timeInterval: 4000` is an Android floor (`location-options.ts:19`), and real jitter is unmeasured.
- **Assumes:** the app is producing fixes, and the Redis member was cleared (which L1 now guarantees on the go-online race).

## Sweep of retired claims, `observed` after the edits

The commands ran from `wt-20`. `P` = `.claude/plans/admin-approval-config-trips-20.md`, `R` = `.claude/reports/admin-approval-config-trips-20-report.md`, `B` = the PR body as fetched before the edit.

| `grep -n` pattern | Plan | Report | PR body (before → after the edit) |
|---|---|---|---|
| `≤ 4` | `:914` only: the AMENDMENTS history line, which now names the correction | none | `:29` → rewritten |
| `within ≤` | none | none | `:29` → rewritten |
| `finds out` | `:400` (heading), `:406` (new wording) | `:14` (new wording) | `:29` heading kept, wording rewritten |
| `revoked mid-ride` | none (was `:348`) | none | candidate-filter bullet → rewritten |
| `five places` | — | — | `:10` → "six places", reassign added |
| `996` | — | `:62` (gate at `4d4eb5d`, historical) + new `:63` line (999 = 996 + 3) | gate block and `:64` arithmetic → replaced with the run below |

The PR body's `<details>` claim-check log is line-indexed output of #302's script against the round-0 body. It is left as that record and labelled as such.

## Validation

`observed`: `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi record-gate.sh --clean` at `dbbb14a`, exit 0. It printed:

```
Tasks:    23 successful, 23 total
Cached:   0 cached, 23 total
Time:     2m2.517s
```

- **@taxi/api:** 999 passed, 95 suites. That is 996 + 3 new (`derived`: 1 reassign unit, 2 admin integration).
- **@taxi/shared:** 317.
- **@taxi/dispatch:** 303.
- **@taxi/driver:** 364.
- **@taxi/rider:** 231.
- **@taxi/db:** 17.

**A red run came before it.** The first gate, at the pre-amend `748dd77`, went red on `@taxi/api#lint`: `no-unnecessary-type-assertion` at the L2 test's cast (`admin-drivers.integration.spec.ts:339`). That was my code, not the environment. The cast was removed, the commit amended to `dbbb14a`, and the gate re-run as above.

## Manual look

None required. L1's concurrent interleaving is forced deterministically by the spy, not raced across two connections.
