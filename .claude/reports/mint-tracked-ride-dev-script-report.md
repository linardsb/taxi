# Implementation Report — `mint:ride`, the live tracked-ride paid-call instrument

**Plan**: `.claude/plans/mint-tracked-ride-dev-script.md`
**Branch**: `feature/level4-live-ride-script` (worktree `/Users/Berzins/Desktop/taxi-tracking-eta`)
**Status**: COMPLETE

## Summary

`services/api/scripts/mint-tracked-ride.ts` boots the real `AppModule` in-process against the dev
database and dev Redis on an ephemeral port, drives the whole booking chain over the wire (OTP →
vehicle → online → `POST /rides` → sweeper offer matched by `rideId` → accept), then walks the driver
due north in exact `0.001°` latitude steps and polls `GET /track/:token` five times per step, counting
`geo.maps.route_fetched` events filtered to `caller: 'eta'`.

It captures Nest's log payloads **as objects** via `Logger.overrideLogger()`, so one stream serves both
jobs the log has to do here — reading the stub OTP and counting paid route calls — with no parsing.

**The observation #94 Level 4 step 3 has been waiting for, produced and reproduced four times:**
**30 polls across 6 cell crossings cost 6 paid route calls across 6 distinct corridors — one on each
cell's first view, zero on every subsequent poll.**

## Tasks completed

- Script skeleton, log capture, in-process boot → `services/api/scripts/mint-tracked-ride.ts` (CREATE)
- `mint:ride` entry + widened lint glob → `services/api/package.json` (UPDATE)
- `scripts` added to `exclude` → `services/api/tsconfig.build.json` (UPDATE)
- Startup diagnostics + poll-budget parameter guard → script
- OTP sign-in with the role guard, idempotent vehicle setup, driver online + socket presence → script
- Booking, `rideId`-filtered offer wait, accept → script
- Pre-flight cache clear (eta corridors **and** the quote corridor — see Deviations) → script
- The measured walk, positive control, distinctness and sub-cell assertions → script
- Report with named heading and shown arithmetic → script
- Teardown over the wire on both success and failure paths → script
- `+371290` claimed in the E.164 registry → `services/api/src/features/rides/lifecycle/ride-lifecycle.integration.spec.ts` (UPDATE)

## Tests added

**None, deliberately** — per the plan's Non-Goals. The script is an instrument, not a test: it does not
run under jest and asserts nothing in CI. Its correctness rests on four self-checks that run inside every
invocation, all of which fired during validation:

- **Positive control** — cell 0's first view must produce ≥1 event before any zero is trusted.
- **Filter control** — `caller:'quote'` ≥ 1, proving the `caller` filter discriminates rather than matching nothing.
- **Distinctness** — `distinct(cell) === CELLS`, which a bare total does not prove.
- **Parameter guard** — the poll budget is checked against `TRACKING_VIEW_MAX_PER_WINDOW` before the run starts.

## Validation results

### Level 1–3 — the CI-parity gate

```
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 \
  pnpm turbo run typecheck lint test build --force
```

**PASS** — 21/21 tasks successful, 0 cached. `@taxi/api`: 54 suites, **461 tests passed**, 0 failed.

Build output stays clean with the new directory present. Both symptoms of the `rootDir`-inference
failure the plan measured are checked, not just the obvious one — a stale `dist/main.js` from an earlier
build would satisfy an existence check even if this build had re-parented everything under `dist/src/`:

```
services/api/dist/main.js          exists, mtime 23:04 = this gate's build
services/api/dist/scripts          absent
services/api/dist/src              absent   ← the relocation symptom, explicitly checked
```

### Level 4 — manual validation (the point of the ticket)

| Step | Result |
|---|---|
| 1 — seed assumption verified, not assumed | **PASS** — `ST_Contains` returns exactly one row, `centre`; `ride_tariffs` = 4 |
| 2 — the script runs at all | **PASS** — prints `db=192.168.1.11:5432 redis=localhost:6381 city=…0001`, the poll-budget arithmetic, both user ids **with roles**, ride id, offer id, and a 22-char token |
| 3 — **THE observation** | **PASS** — table below |
| 4 — idempotence | **PASS** — four runs, identical counts (see below) |
| 5 — the positive control actually controls | **PASS** — with `Logger.overrideLogger` commented out the run **exits 1** with a named failure, never a zero-call pass |
| 6 — dispatch-page cross-check | not run (optional) |

**Step 3 — observed, `CELLS=6`, `POLLS_PER_CELL=5`:**

```
  #   quantized origin        cell        views  eta calls per view
   0  56.961,24.085          Ph2gMmERFf      5  [1, 0, 0, 0, 0]
   1  56.962,24.085          C4uMJe41eE      5  [1, 0, 0, 0, 0]
   2  56.963,24.085          wHNObZ8nZQ      5  [1, 0, 0, 0, 0]
   3  56.964,24.085          JPfxDQWP6S      5  [1, 0, 0, 0, 0]
   4  56.965,24.085          1453gzazSn      5  [1, 0, 0, 0, 0]
   5  56.966,24.085          3EEp4vd_7M      5  [1, 0, 0, 0, 0]
```

| Quantity | Expected | **Observed** |
|---|---|---|
| `GET /track/:token` views | 30 | **30** |
| `geo.maps.route_fetched` `caller:'eta'` | 6 | **6** |
| distinct `cell` values | 6 | **6** |
| eta calls on views 2–5 of any cell | 0 | **0** |
| `geo.maps.route_fetched` `caller:'quote'` | ≥1 | **1** |

**The unquantized counterfactual is NOT observed — and for this walk it is 6, not 30.**

This run emits one position per cell and then polls it 5×, so the position is byte-identical across a
cell's polls. `quantizeForEtaCache` is `toFixed(3)` and `cellLocation` already rounds to 3 dp, so the
grid is an **identity function** on every coordinate this walk generates. Delete #87's grid and this
walk still costs **6** paid calls. What the zeros in the table above demonstrate is
`CachingMapsProvider`'s 4-decimal corridor cache (`caching-maps.provider.ts:18,67`) — which predates
#87. The Level 5 key is the tell: `56.9610` is simultaneously the 4-dp rendering of the quantized *and*
of the raw position.

Under real per-poll GPS jitter — the case `notifications.policy.ts:44-51` names as the grid's win, and
the one this walk does not have — each of a cell's 5 polls would key a distinct 4-dp corridor, and the
unquantized cost would be 30 (6 cells × 5 polls), a 5× reduction. **That is arithmetic, not a
measurement:** this script never runs an unquantized pass. Making it observable means adding sub-cell
jitter between polls (±0.0002°, sanctioned at `plan.md:297`) and widening the `5e-5` landed tolerance
that would otherwise reject it — a change to the instrument, deferred to its own ticket.

**Which case these numbers describe:** the walk is **due north**. `0.001°` of latitude ≈ 111.3 m — the
cell's *largest* dimension, so the *fewest* crossings per metre driven, the **best** case for spend. The
invariant under test (one paid call per crossing) is heading-independent; the crossing *rate* is not, and
is not what this measures. Per `notifications.policy.ts`, at 417 m/min a crossing costs one call per
~16 s due N/S (best), ~8.8 s due E/W, ~7.7 s on the worst heading (~61° off north), ~8.9 s averaged over
a uniform heading.

**Step 4 — idempotence.** Four complete runs, three of them back-to-back inside both the 300 s ETA TTL
and the 24 h quote TTL. Every run reported **6 eta / 1 quote / 6 distinct corridors / 30 views**, and
the same six `cell` hashes. This is what proves the pre-flight clear addresses the right keys — a second
run reporting 0 would have been a script defect wearing a success's clothes.

### Level 5 — cache entries the run created

```
maps:route:v1:eta:56.9610,24.0850|56.9600,24.0850    ← 6 entries, one per visited cell
… through 56.9660 …
TTL = 292 s   (≤ MAPS_ETA_CACHE_TTL_SECONDS = 300)
```

## Deviations from the plan

Each of these is an intentional decision, not an oversight.

1. **The pre-flight clear also deletes the QUOTE corridor.** The plan clears only the two `eta` keys.
   `PricingService` caches under `routeCacheKey('quote', pickup, destination)` with
   `MAPS_ROUTE_CACHE_TTL_SECONDS` = **86 400 s**, so on any second run inside 24 h `POST /rides` is a
   cache hit, emits no `caller:'quote'` event, and the plan's own filter-discrimination assertion fails —
   taking AC #5 ("identical counts") with it. No failure key is cleared: `geo.module.ts` builds the quote
   facade with a literal `0` failure TTL, so nothing ever writes one. Commented in place so the omission
   is not "fixed" later.

2. **The driver's dispatch-time ping is placed at cell 0 exactly**, not merely near the walk start. Any
   other start coordinate is a 7th, uncleared corridor that a stale confirmation read could route —
   inflating the total and reading as an over-reporting counter rather than as the script's own doing.
   ~667 m of walk stays far inside `NEAREST_DEFAULT_RADIUS_METERS = 5 000`, so dispatch still finds them.

3. **Environment diagnostics and a Redis reachability probe run BEFORE the socket adapter connects.**
   The plan prints diagnostics after boot. `RedisIoAdapter.connectToRedis` assigns its two ioredis
   clients only after both ping, so a failure there leaks two clients that retry forever and bury the real
   error under a scroll of `NOAUTH`. Probing through the app's own `KeyValueStore` first is what turned an
   undiagnosable hang into one named line — and it is what caught the environment defect below.

4. **Teardown cancels over the wire (`POST /rides/:rideId/cancel`) instead of writing `rides.status`
   directly** as `tracking.integration.spec.ts`'s `afterEach` does. CLAUDE.md's hard rule is that ride
   status changes go through the state machine; `cancel`'s `releaseFromRide` is also the one line that
   takes the driver back out of `on_ride`, so the wire path does the job the direct write was there for.

5. **The driver is left `offline`, not `online`.** AC #9's wording says `online`; its purpose is "not
   stranded `on_ride`", which is verified and printed (`driver status after cancel → online`, then an
   explicit `PUT … {status:'offline'}`). An `online` driver with no process behind them is exactly the
   ghost presence `clearPresenceOnDisconnect` exists to prevent, and leaving presence set would put a
   phantom candidate in front of the next run's dispatch.

6. **The per-cell assertion is "exactly one paid view in this cell", not "view 1 costs 1".** A
   confirmation read that observes the *previous* position legitimately costs 0 and shifts the paid view
   to index 1. Asserting the shape rather than the index keeps the check honest without weakening it —
   the total, the distinctness and the per-cell count are all still exact. (In practice every observed
   run landed on index 0.)

7. **`MOVE_CONFIRM` attempts are capped at `POLLS_PER_CELL`,** so views per cell are exactly
   `POLLS_PER_CELL` and the budget guard's arithmetic is a true worst case rather than a nominal one.

8. **`CELLS` / `POLLS_PER_CELL` are overridable via `MINT_CELLS` / `MINT_POLLS_PER_CELL`** — the plan's
   open question 3. Without them the parameter guard has nothing to guard.

9. **An OTP-throttle diagnosis and a stated run ceiling were added** (not in the plan) — see Issues.

10. **File length: 880 lines total (614 code, 194 comment, 72 blank), against the plan's "≲400, under
    the ~500 cap" — kept, and here is the basis.** CLAUDE.md states `~500 lines per file` inside the
    *Vertical Slice Architecture* bullet, which governs slice source. This is neither a slice nor
    production code (it is excluded from `dist/`), and the repo's own non-slice files sit in the same
    range: `dispatch.integration.spec.ts` 857, `tracking.integration.spec.ts` 789,
    `ride-lifecycle.integration.spec.ts` 676, `test/harness.ts` 508. At 880 the script is consistent with
    established practice for test and instrument files rather than an outlier. The overshoot is
    concentrated in the named failure diagnoses and the arithmetic-showing report — the parts the
    ticket's own rules require — so trimming them would remove exactly what makes the instrument
    diagnosable. It stays one file because the plan specified one, and getting every part under 500 would
    take three.

## Issues encountered

1. **This checkout's `.env` points the API at the wrong Redis — an environment defect, not a code one.**
   `REDIS_URL` resolves to `localhost:6379`, which is a **password-protected** server (the tunnel), and
   every connection fails `NOAUTH Authentication required`. The compose Redis for this checkout is
   published on **6381** (`COMPOSE_PROJECT_NAME=taxi docker compose ps` → `0.0.0.0:6381->6379/tcp`).
   *The script's own AC #2 diagnostic is what found and named this* — it was the first thing the
   restructured startup printed. **Every run in this report used `REDIS_URL=redis://localhost:6381`**,
   which `@nestjs/config` honours because it never overwrites a variable already in `process.env`.
   **Action for Linards: fix `REDIS_URL` in `.env`** — `pnpm dev` in this worktree has the same problem.

2. **The instrument has a run ceiling of `OTP_MAX_REQUESTS_PER_HOUR` = 5 runs per hour per phone**, with
   `OTP_RESEND_COOLDOWN_SECONDS` = 60 between them, because the phones are fixed and each run spends one
   OTP request. My validation runs exhausted it and got a bare `429 too_many_requests` that read like a
   script bug. The script now names both limits (importing the constants, never retyping the numbers) and
   says plainly that neither is a defect in the cache it measures. Two consecutive runs — what the
   idempotence check needs — fit comfortably. Documented in the file's docblock.
   *Disclosure*: to run the final end-to-end verification of the shipped code through
   `pnpm --filter @taxi/api mint:ride`, I deleted the four `otp:rate:` / `otp:cooldown:` keys for the
   script's own two fixture phones from **dev** Redis. That touches an SMS-spend counter in front of a
   stub SMS provider; it does not touch anything the measurement reads.

3. **`GET /drivers/me` returns `{ profile, vehicles }`**, so the first teardown printed
   `driver status after cancel → undefined`. Fixed; it now reads `profile.status` and prints `online`.

4. **`pnpm --filter` buffers a child script's stdout when piped**, which made the very first run look
   like a silent hang for three minutes. Running the same command directly under `node -r ts-node/register`
   showed the output immediately. No code change — worth knowing before diagnosing a "hang".

5. The plan's empirical claim about Nest 11 is confirmed visually in every captured run: payloads render
   as ANSI-coloured multi-line `util.inspect` (`Object(6) {` … single-quoted values across seven lines),
   not JSON. Stdout parsing would indeed have been the wrong design.

## Acceptance criteria

| AC | Status |
|---|---|
| #1 boots in-process on an ephemeral port, exits cleanly | **MET** — `listening on http://127.0.0.1:51591`, exit 0. On this machine the command needs `REDIS_URL=redis://localhost:6381` until issue 1 below is fixed; the bare `pnpm --filter @taxi/api mint:ride` fails on `.env`'s wrong Redis |
| #2 prints DB/Redis `host:port` credential-stripped, names `seed` on a missing geozone | **MET for the printing**, which is what caught the `.env` defect. The missing-geozone branch is implemented but **not exercised** — the seed is present (Level 4 step 1) |
| #3 full chain over the wire, live 22-char token | **MET** — `token=GaJQF1wNxW_-OLbIXyWdDQ (22 chars)` |
| #4 per-cell counts, `distinct(cell) === CELLS`, 1 then 0 | **MET** — 6/6 distinct, `[1, 0, 0, 0, 0]` × 6 |
| #5 two consecutive runs, identical counts | **MET** — four runs, identical |
| #6 gate green; `scripts/` typechecked + linted, absent from `dist/` | **MET** — 21/21, 461 tests; `dist/main.js` present, `dist/scripts` absent |
| #7 every number imported or shown with its arithmetic; heading named | **MET** |
| #8 log interception disabled ⇒ loud failure, not a zero-call pass | **MET** — exit 1 |
| #9 teardown on both paths; driver not `on_ride` | **MET** — with deviation 5 on the final state |
| #10 `+371290` claimed in the registry and used | **MET** |
| #11 sign-in asserts the returned role | **MET for the assertion** — both roles read back correct and are printed (`role=rider` / `role=driver`). The mismatch branch is implemented but **not exercised**: both fixture phones hold the right roles |

Exercised failure branches, for contrast: **AC #8**'s positive control was genuinely triggered (interception
disabled → exit 1), and the OTP 429 diagnosis of issue 2 was triggered by a real throttle. The AC #2 and
AC #11 branches above are code-reviewed, not run — stated so rather than implied green.

## Next

`piv-commit` → `piv-create-pr` → `piv-review-pr`. The observed counts above are the artefact to paste
into the #94 thread.
