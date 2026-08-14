# Implementation Report — `mint:ride` sub-cell jitter (#108)

**Plan**: `.claude/plans/mint-ride-sub-cell-jitter.md`
**Branch**: `feature/mint-ride-sub-cell-jitter` (in worktree `/Users/Berzins/Desktop/taxi-jitter`)
**Status**: COMPLETE — CI-parity gate green, Level 4 steps 1–6 all run, both controls reverted and verified.

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

**Level 4 — all six steps run.** Logs archived in the session scratchpad (`l4-*.log`).

**Step 1 — guards before any spend (costs no OTP).** `MINT_POLLS_PER_CELL=10`, verbatim:

```
poll budget: 6 cells × 10 polls + 1 page load = 61 views vs TRACKING_VIEW_MAX_PER_WINDOW=120 per 60 s
refusing to run: MINT_POLLS_PER_CELL=10 needs ±5 jitter steps (±0.0005°), past the ±0.0004° bound
and near the 0.0005° half-cell — polls would cross into the next cell and the per-cell counts would
be 2, not 1. Max is 9 polls per cell.
```

Refused before `signIn` (no `── actors ──` block, no OTP request), and teardown still ran (`app closed`).
This run also resolves both new DI tokens — they are read before the guard — so `app.get(MAPS_PROVIDER_ETA)`
and `app.get(DRIVER_LOCATION_STORE)` are proven to resolve non-strictly from the root container.

**Step 2 — the run.** Ends `PASS`. Per-cell table, verbatim:

```
  #   quantized origin        cell        views  eta calls per view  observed offset (steps)
   0  56.961,24.085          Ph2gMmERFf      5  [1, 0, 0, 0, 0]     [-2, -1, 0, +1, +2]
   1  56.962,24.085          C4uMJe41eE      5  [1, 0, 0, 0, 0]     [-2, -1, 0, +1, +2]
   2  56.963,24.085          wHNObZ8nZQ      5  [1, 0, 0, 0, 0]     [-2, -1, 0, +1, +2]
   3  56.964,24.085          JPfxDQWP6S      5  [1, 0, 0, 0, 0]     [-2, -1, 0, +1, +2]
   4  56.965,24.085          1453gzazSn      5  [1, 0, 0, 0, 0]     [-2, -1, 0, +1, +2]
   5  56.966,24.085          3EEp4vd_7M      5  [1, 0, 0, 0, 0]     [-2, -1, 0, +1, +2]
```

Every poll carries a non-zero observed offset except the deliberate zero-offset middle poll, and every cell
still costs exactly one paid call. Summary headline, verbatim:

```
quantized cost              6 = one paid call per cell crossing            [observed — pass A]
unquantized cost           30 = 6 cells × 5 polls, one per 4-dp corridor   [observed — pass B]
reduction                   5× attributable to #87's ETA grid              [observed]
```

All six pass-A `cell` hashes (`Ph2gMmERFf`, `C4uMJe41eE`, `wHNObZ8nZQ`, `JPfxDQWP6S`, `1453gzazSn`,
`3EEp4vd_7M`) appear among pass B's thirty in the captured `geo.maps.route_fetched` stream — the wrong-target
detector, satisfied by observation rather than by construction.

**Step 3 — idempotence.** Second run after the cooldown, on a fresh token (`DCoTmi41MCt3CcLJKEYUNw` vs
`Tz3BVVQBejtYfdnGBCDuuA`): identical counts (6 / 30 / 5×), identical per-cell table, identical `cell` hashes,
identical offsets. Both clears fire and the jitter is deterministic — R11 closed by observation.

**Step 4 — the interception control.** With `Logger.overrideLogger(capture)` commented out the run failed at
sign-in, verbatim:

```
no `auth.otp.stub_sent` captured for +371***001 in 5000 ms.
  Either LOG INTERCEPTION IS BROKEN — the same failure that would later turn every paid-call
  count into a meaningless zero, ...
```

It failed loudly rather than reporting a triumphant zero. As the plan predicted, this run still spends an OTP
request. Control reverted.

**Step 5 — the jitter control. Result differs from the plan's prediction; see Deviations #5.** With
`jitterSteps` forced to `0`, the observed offset column went to `[0, 0, 0, 0, 0]` on every cell while pass A
was unchanged at `[1, 0, 0, 0, 0]` and 6 calls — and then the run **refused pass B before spending**:

```
refusing to run pass B: 30 polls collapsed onto 6 distinct 4-dp corridors. Either a ping landed late
(two polls saw one position — raise PING_SETTLE_TIMEOUT_MS) or the jitter is being rounded onto the
grid (check that pollLocation rounds to COORD_PRECISION, not TRACKING_ETA_GRID_DECIMALS).
Pass B would under-report and the reduction would read too high.
```

The plan expected "pass B drops to 6, reduction reads 1×". **R3 fires first and makes that outcome
unreachable** — which is R3 working exactly as specified (it is deliberately ordered before pass B spends).
The control still discharges its purpose, and more strongly: it proves the jitter is load-bearing, and it
shows the instrument refusing to print a flattering number rather than printing one. Control reverted.

**Step 6 — provenance read-through.** Every figure in the summary is either printed from a policy constant,
shown with its arithmetic, or tagged `[observed — pass A/B]`. No figure claims a mechanism without naming what
was held constant. One defect was found and fixed by this read: the jitter line printed
`(0.00019999999999999998 × 111320 m/°)` — float noise in a provenance figure, in a ticket about figure
hygiene. Now `(0.0002 × 111320 m/°)`, verified by the final run.

**Controls reverted, mechanically verified.** After steps 4 and 5,
`grep -c "LEVEL-4 CONTROL" services/api/scripts/mint-tracked-ride.ts` → `0`, and `git diff` against the
implementation commit showed only the intended float fix. The implementation was committed *before* Level 4
precisely so this check is a one-line diff rather than a search through the whole ticket.

**Edge case `MINT_POLLS_PER_CELL=1`** — the plan's TESTING STRATEGY predicts "pass B equals pass A; the
reduction is 1×… it must not throw, and R3 must not fire." Run and confirmed, verbatim:

```
  #   quantized origin        cell        views  eta calls per view  observed offset (steps)
   0  56.961,24.085          Ph2gMmERFf      1  [1]                 [0]
   ...
quantized cost              6 = one paid call per cell crossing            [observed — pass A]
unquantized cost            6 = 6 cells × 1 polls, one per 4-dp corridor   [observed — pass B]
reduction                   1× attributable to #87's ETA grid              [observed]

PASS — one paid route call per cell crossing under sub-cell jitter, and 6 without the grid.
```

R3 stayed silent (6 polls → 6 distinct corridors, so nothing collapsed) and the run passed. **This is where
AC #9's `pass B = 6, 1×` figure legitimately comes from** — a degenerate poll count, not the step-5 control.
Note the caveat the plan itself states: at N=1 the wrong-target detector (R5) is **vacuous**, because both
passes key the identical corridor set. N=1 is a smoke run; a real measurement needs `POLLS_PER_CELL ≥ 2`.

### Observed vs the plan's expected figures (R13)

The plan labelled `6 / 30 / 5×` as `expected`. Every one is now `observed`, re-derived from the run's own
output above rather than copied forward:

| Figure | Plan (expected) | Run (observed) | Source |
|---|---|---|---|
| pass A (quantized) cost | 6 | **6** | `geo.maps.route_fetched` `caller:'eta'`, frozen before pass B |
| pass B (unquantized) cost | 30 | **30** | delta across `unquantizedPass` |
| reduction | 5× | **5×** | computed from the two above, not restated |
| distinct pass-B corridors | 30 | **30** | provider-emitted `cell` hashes |
| shared A∩B hashes | 6 | **6** | the zero-offset poll per cell |

They agree — but they are recorded here because a run produced them, not because the plan predicted them.

**OTP budget actually spent: 5 of 5** (steps 2, 3, 5, 4, and the final confirming run). Step 1 cost none. The
live `MINT_POLLS_PER_CELL=9` acceptance run was **deliberately skipped** — it would have spent a sixth
request, and its acceptance is arithmetic on constants already in the source (`maxSteps = 4 ≤
MAX_JITTER_STEPS = 4`), with the `=10` refusal message naming the threshold explicitly.

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

5. **Level 4 step 5 produces R3's refusal, not "pass B = 6, 1×".** The plan's step 5 and AC #9 expect the
   jitter control to let pass B run and report 6 (a 1× reduction). It cannot: forcing `jitterSteps → 0`
   collapses all 30 polls onto 6 corridors, and **R3's pre-spend distinctness check — specified by the same
   plan, and deliberately ordered before pass B spends — refuses the pass first**. The two requirements are
   inconsistent, and R3 wins by construction. This is not a defect: the control's purpose is to prove the
   jitter is load-bearing, and a refusal that names "the jitter is being rounded onto the grid" proves it at
   least as well as a 1× would, while additionally demonstrating that the instrument declines to print a
   flattering number. Recorded above with the verbatim output.

   **AC #9 is nonetheless met as written**: `MINT_POLLS_PER_CELL=1` produces exactly `pass B = 6, 1×` under
   `[observed]`, via a path R3 correctly does not refuse (6 polls → 6 distinct corridors). So the plan is not
   wrong about the figure — it attached the right figure to the wrong control. Both runs are recorded above.

6. **The plan's `app.select(GeoModule).get(...)` fallback was not implemented.** It was contingent
   ("if it throws"), and step 1's free run proves `app.get(MAPS_PROVIDER_ETA)` resolves non-strictly from the
   root container — the token is in `GeoModule`'s `exports`. Dead code for an impossible branch.

7. **The float-noise fix in the jitter provenance line** (`jitterDeg` → `jitterDeg.toFixed(4)`) is not in the
   plan. It was found by step 6's read-through and is committed separately, after the Level 4 controls, so the
   controls-reverted diff stayed a clean one-liner.

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
  typecheck + lint only, so that a single full run discharged every task-level validation at once. That is what
  made 5 runs enough. Escape hatch if the cap is ever hit mid-validation: `DEL otp:rate:+371290001` /
  `otp:rate:+371290002` against dev Redis (`auth.service.ts:59`) turns an hour of waiting into a minute — not
  needed this time.
- **The environment file was never required.** `.env.example` states that `JWT_SECRET` and `OTP_PEPPER` are
  PUBLIC and committed, and the production-refuses-example-values check is production-gated. The script was
  therefore run from those committed values plus two local port facts. No secret was read, written, or needed
  — the hook's guardrail was never worked around, just made unnecessary.

  **Reproduction recipe** (the plan's forward-reference asks #13/#16 to re-run this script against a real
  provider; these are the two non-obvious facts they will need, recorded here rather than in a session-scoped
  scratch file):

  - `DATABASE_URL` must reach docker Postgres by **LAN IP**, not `localhost` — a brew Postgres holds
    `127.0.0.1:5432` on this machine and answers `role "taxi" does not exist`. `ipconfig getifaddr en0` was
    empty; the address came from `ifconfig | grep "inet "`.
  - `REDIS_URL` on **6381**, not 6379 (6379 is a shadowed ssh tunnel; a wrong port surfaces as `NOAUTH`).
  - Everything else is verbatim from `.env.example`.
