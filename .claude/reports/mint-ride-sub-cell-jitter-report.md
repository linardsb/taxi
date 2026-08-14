# Implementation Report — `mint:ride` sub-cell jitter (#108)

**Plan**: `.claude/plans/mint-ride-sub-cell-jitter.md`
**Branch**: `feature/mint-ride-sub-cell-jitter` (in worktree `/Users/Berzins/Desktop/taxi-jitter`)
**Status**: PARTIAL — all code complete and the CI-parity gate green; **Level 4 not yet run** (blocked, see below).

## Summary

`mint:ride` now moves the driver to a distinct, deterministic sub-cell offset on **every** poll — an integer
multiple of `COORD_PRECISION`'s `1e-4°` of latitude — so each poll keys its own 4-dp corridor while still
quantizing to the one 3-dp cell centre. On top of that walk the script runs a **second, unquantized pass**:
it replays the positions the page actually reported through the *same* `MAPS_PROVIDER_ETA` instance with
`quantizeForEtaCache` replaced by identity, and counts both passes from `geo.maps.route_fetched`.

That substitution is the only difference between the two counts, which is what attributes the reduction to
#87's ETA grid rather than to the 4-dp corridor cache that predates it. The figures the summary prints are
therefore observations of two passes that ran, not arithmetic under a condition the run never had.

## Tasks completed

- Export the corridor precision → `services/api/src/features/geo/caching-maps.provider.ts` (UPDATE)
- Re-export it from the slice barrel → `services/api/src/features/geo/index.ts` (UPDATE)
- Grid-coarseness spec case → `services/api/src/features/notifications/notifications.policy.spec.ts` (UPDATE)
- Jitter geometry (`JITTER_STEP_DEG`, `jitterSteps`, `pollLocation`, tolerances, bound)
  → `services/api/scripts/mint-tracked-ride.ts` (UPDATE)
- Two boot guards + printed jitter geometry, beside the poll-budget guard → same file (UPDATE)
- `CellRow.observed: LatLng[]` → same file (UPDATE)
- `walkCell` restructured to a per-poll `emit → settle → view` loop; new `awaitPing` → same file (UPDATE)
- Pass A closed (frozen count, table, assertions) before `unquantizedPass` is called → same file (UPDATE)
- `unquantizedPass` (pass B) → same file (UPDATE)
- `report()` split into `reportCells` + `reportSummary`; claim block rewritten → same file (UPDATE)
- `assertInvariants()` split into `assertQuantizedInvariants` + `assertUnquantizedInvariants` → same file (UPDATE)
- Script docblock updated for two passes → same file (UPDATE)
- Forward-reference + dated amendment → `.claude/plans/mint-tracked-ride-dev-script.md` (UPDATE)

## Tests added

`services/api/src/features/notifications/notifications.policy.spec.ts` — one case inside the existing
`describe('quantizeForEtaCache')`:

- `stays coarser than the corridor cache key, or the grid buys nothing (edge)` — asserts
  `TRACKING_ETA_GRID_DECIMALS < COORD_PRECISION`. **PASS.**

This is the one invariant in the ticket that lives in production code and is checkable without a database, and
it is the invariant whose violation would make both passes report the same count. The suite went 6 → 7 cases.

Per the plan's stated precedent, the script itself ships no jest tests: it boots the real `AppModule` against
the dev database, is excluded from `dist/` by `tsconfig.build.json`, and asserts nothing in CI. Its guarantees
are held by `typecheck` + `lint` and by its own in-run assertions.

## Validation results

**Level 1 — syntax & style**: `pnpm --filter @taxi/api typecheck` clean; `lint` 0 errors.
(7 `no-unsafe-argument` warnings remain, all pre-existing in integration specs this ticket does not touch.)

**Level 2 — unit**: `pnpm --filter @taxi/api test -- notifications.policy.spec` → 7 passed, 7 total.

**Level 3 — the gate (CI parity)**, with `REDIS_TEST_URL=redis://127.0.0.1:6381` so no suite silently skips:

```
pnpm turbo run typecheck lint test build --force
Test Suites: 54 passed, 54 total
Tests:       462 passed, 462 total
Tasks:       21 successful, 21 total
```

Run without `REDIS_TEST_URL` first, for comparison: 52 of 54 suites, 24 tests skipped — the documented
short-gate, confirmed and then closed.

**R1 audit** (`grep -n "routeFetched(" services/api/scripts/mint-tracked-ride.ts`) — every occurrence is one of:
the frozen pass-A snapshot (`:657`, `:658`), the explicit pass-B slice (`:665`), inside `walkCell` where the
delta is taken and consumed within pass A (`:872`, `:874`), or inside `unquantizedPass`' own delta (`:995`,
`:1004`). Two further hits are prose in comments. **No bare cumulative read survives in the report or in the
pass-B assertions** — that is the R1 defect, and ordering now makes it unreachable rather than merely
discouraged.

**Subject-retirement grep** — `identity function` survives in exactly three places, all correct: two inside the
boot guard describing the hypothetical it refuses, one in `walkCell`'s docblock in the **past tense**,
describing what #108 changed. Nothing claims the grid is an identity function for the current walk.

**Level 4 — NOT YET RUN. This is the gap.**

## Blocked

Level 4 needs the script to boot the real `AppModule` against the dev database, which needs the environment
file in the worktree. The repo's `PreToolUse` hook blocks me from reading or copying it — correctly, and I did
not work around it. One command from you unblocks it:

```
cp /Users/Berzins/Desktop/taxi/.env /Users/Berzins/Desktop/taxi-jitter/.env
```

Until then the following are **`expected`, not `observed`**, and must not be copied anywhere as measurements
(this is R13, and the exact defect #87 and #107 shipped):

| Figure | Value | Provenance |
|---|---|---|
| pass A (quantized) cost | 6 | **expected** — `CELLS`, one paid call per cell crossing |
| pass B (unquantized) cost | 30 | **expected** — `CELLS × POLLS_PER_CELL` |
| reduction | 5× | **expected** — the ratio of the two above |

The script computes and prints all three from its own run variables; none is a literal in the source. When
Level 4 runs, these get replaced here by the run's actual output.

### Level 4 sequence still owed (OTP budget: 5/hour/phone)

1. Guards before any spend — `MINT_POLLS_PER_CELL=10` refuses, `=9` accepted. **Costs no OTP.**
2. The run — `PASS`, `[1, 0, 0, 0, 0]` per cell with a non-zero observed offset on every poll.
3. Idempotence — second run, identical counts.
4. Interception control — comment out `Logger.overrideLogger(capture)`; must fail loudly, not report zero.
5. **Jitter control** — force `jitterSteps` to return `0`; pass B must drop to `CELLS` and the reduction read
   1×. This is #107's identity-function case reproduced on demand, and the proof that the jitter is what makes
   pass B cost anything.
6. Provenance read-through — costs no run.

After steps 4 and 5, `git diff services/api/scripts/mint-tracked-ride.ts` must show neither control surviving.
A committed `jitterSteps → 0` would make the whole ticket a no-op that still prints a number.

## Deviations from the plan

1. **`quoteCalls` is threaded as an argument, not read inline.** The plan's report-split task says "neither
   reads the cumulative counter", but its worked example only threads the two `eta` counts. Reading
   `routeFetched('quote')` after pass B would in fact still be correct — pass B emits only `caller:'eta'` — but
   passing it alongside the eta snapshot removes the need for a reader to verify that argument at all, and
   makes the "no function downstream of pass B reads the counter" rule true without exception. Strictly safer;
   no behaviour change.

2. **`walkCell` throws on a null page position before pushing to `observed`.** The plan's quantized assertion 4
   checks "no `observed` entry is null", but `CellRow.observed` is typed `LatLng[]` — non-nullable — so that
   check could never fire. Throwing at the source keeps the type honest and degrades assertion 4 to the length
   check, which is the part that can actually fail (and the part pass B depends on).

3. **`METERS_PER_DEGREE_LAT` is a named constant** rather than the inline `× 111_320` the plan sketches. It is
   used in three printed figures; naming it keeps the three from drifting apart.

4. **Ran the gate twice, deliberately** — once without `REDIS_TEST_URL` and once with. The first run is not
   waste: it demonstrates the documented short-gate (24 tests skipped) rather than asserting it, which is the
   same provenance discipline this ticket is about.

## Issues encountered

- **The shared Docker daemon was down.** Colima's VM was up but its runtime was dead, so no session could reach
  Postgres or Redis. Repaired with `colima restart` — a repair rather than a disruption, since the daemon was
  already non-functional for every session. Volumes live on the VM disk and survived.
- **Compose in a worktree tore down the shared redis.** With no environment file present, `docker compose up`
  in the worktree defaulted `REDIS_PORT` to 6379 — the port shadowed by an ssh tunnel on this machine — and in
  failing to bind it, recreated and stopped the working `taxi-redis-1`. Restored by running compose from the
  main checkout, which has the file. Redis is healthy again on 6381.
  **Lesson worth keeping: never run `docker compose` from a worktree that lacks the environment file.**
- **`COMPOSE_PROJECT_NAME=taxi` is mandatory in the worktree**, as CLAUDE.md says: without it the api package's
  `pretest` named its project `taxi-jitter` and tried to bind a second Postgres to the occupied 5432. The stray
  project was cleaned up with `docker compose down -v` under that name.
- Two other `claude` sessions are live in this checkout (separate parent processes), and the shared tree sat on
  `feature/dev-env-redis-doc` with two unpushed commits. That is why this ticket was built in a worktree rather
  than by moving the shared checkout's branch.
- **OTP budget shapes the validation order.** The plan's per-task validations ask for ~4 full runs *before*
  Level 4's own 4, against a cap of 5 per phone per hour. Phases 2–4 were therefore implemented against
  typecheck + lint only, so that a single full run can discharge every task-level validation at once. Escape
  hatch if the cap is hit mid-validation: `DEL otp:rate:+371290001` / `otp:rate:+371290002` against dev Redis
  turns an hour of waiting into a minute.
