# PR #309 review fixes, round 2

Review: PR comment `5912709045` (round 2, head `f22803c`, recommendation approve). One finding, R1 (Low, optional). No direction was given with the review; triage by this session: take the review's own optional fix, a comment, now. Nothing deferred, nothing filed.

## Fixed

| Code | What was wrong | Fix | Test |
|---|---|---|---|
| R1 | L1's re-read after `markOnline` checks `approvalStatus`, not `status`. A reject-then-re-approve, or `markOfflineByServer` (socket disconnect), landing between go-online's `UPDATE` and `markOnline` still answers 200 with Redis online and Postgres offline | Comment only, as the review prescribes: `drivers.service.ts` go-online branch, 5 lines under the L1 comment, naming the race, its effect (undispatchable until the next toggle; `candidate-filter.ts:30` reads Postgres `status`), and why the check is not `status !== 'online'` (a force-assign in the gap writes a legitimate `on_ride`, and `markOffline` would cut that ride's tracking feed) | None. A comment has no behaviour to pin. The review's own probe (`PROBE 200 true offline`) remains the evidence the race exists; it was not re-run, because nothing in the mechanism changed |

No code fix: the review names why one is not prescribed (no error code the driver app handles for a re-approved driver; `driver_not_approved` would be false, and an unmapped code keeps intent online and re-asserts). Accepted as stated; not re-traced in `presence-state.ts`.

## Numbers

The change retires no figure and adds none. `drivers.service.ts` goes 487 → 492 lines (`wc -l`, `observed`), under the 500-line `max-lines` cap, which counts comments (`packages/config/eslint/base.mjs:36`, `skipComments: false`). The PR body's gate block and test totals are unchanged by a comment; the gate below reproduces them.

## Validation, `observed`

`REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi bash .claude/skills/piv-create-pr/scripts/record-gate.sh --clean` in `wt-20`, on `f22803c` plus the uncommitted comment, 2026-09-30, exit 0:

| Check | Result |
|---|---|
| Full gate (`pnpm turbo run typecheck lint test build --force`) | 23 successful, 23 total · 0 cached · 1m54.5s |
| @taxi/api | 999 passed, 95 suites (Redis suites ran) |
| @taxi/shared | 317 passed |
| @taxi/dispatch | 303 passed |
| @taxi/driver | 364 passed |
| @taxi/rider | 231 passed |
| @taxi/db | 17 passed |

Every count matches round 2's validation table.
