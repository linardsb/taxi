# Feature: `mint:ride` — make the unquantized counterfactual measurable (sub-cell jitter)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

`services/api/scripts/mint-tracked-ride.ts` is the Level-4 instrument that counts paid `caller:'eta'` route
calls while a driver walks a tracked ride due north, one `TRACKING_ETA_GRID_DECIMALS = 3` cell at a time.
It emits **one position per cell** and polls that byte-identical position `POLLS_PER_CELL` times.

Because every walked position already sits exactly on the 3-decimal grid and never moves inside a cell,
`quantizeForEtaCache` is an **identity function for the entire run**. The zeros the script observes are
produced by `CachingMapsProvider`'s 4-decimal corridor cache (`caching-maps.provider.ts:18,63-70`), which
predates #87's ETA grid. The genuine unquantized cost of the walk as written is **6**, not 30 — #107 shipped
that figure correctly labelled as arithmetic-under-an-absent-condition (option (c) of review finding H1).

This ticket implements option (b): add **deterministic sub-cell jitter** between a cell's polls so that an
unquantized pass genuinely keys `POLLS_PER_CELL` distinct 4-dp corridors per cell, then **actually run** that
unquantized pass and report both counts from observation. After this, the reduction figure sits under
**Observed** with its provenance, and #87's grid — not the corridor cache — is what the comparison isolates.

## User Story

As the engineer who will tune the ETA grid against the first real Google bill
I want `mint:ride` to report the quantized and unquantized cost of the same walk, both measured
So that I am tuning against an observed reduction attributable to the grid, not against arithmetic that
assumes a condition the run never had.

## Problem Statement

The script's headline number ("a 5× reduction") describes a mechanism the run cannot exercise. Two distinct
caches sit in the path — #87's 3-dp ETA grid and the pre-existing 4-dp corridor cache — and the walk holds
nothing constant that separates them. Any figure the script prints for the grid's contribution is therefore
unattributable, and CLAUDE.md's provenance rule forbids printing it as measurement:

> When a figure credits a mechanism, say what was held constant to isolate it; if nothing was, it is not
> evidence for that mechanism.

## Solution Statement

Two changes, one instrument:

1. **Per-poll deterministic latitude jitter.** Each of a cell's polls moves the driver by an exact integer
   multiple of `10 ** -COORD_PRECISION` (`1e-4°`, the corridor cache's own precision) around the cell centre.
   At 4 dp every poll is a distinct corridor; at 3 dp every poll is the same cell. Quantized behaviour is
   therefore unchanged (`[1, 0, 0, 0, 0]` per cell still holds and is still asserted), while an unquantized
   pass now has `CELLS × POLLS_PER_CELL` distinct corridors to pay for.

2. **Pass B — the unquantized pass, actually run.** After the walk, clear the raw corridors and replay the
   positions the page actually reported through the **same** `MAPS_PROVIDER_ETA` instance, with
   `quantizeForEtaCache` replaced by identity. Same facade, same Redis, same source, same pickup target, same
   `geo.maps.route_fetched` counter. The substitution of quantize-for-identity is the **only** difference
   between the two counts, which is what makes the reduction attributable to the grid.

Pass B is "the grid stubbed to identity" as the ticket's *Done when* sanctions, implemented without touching
production quantization: the grid lives between the page and the seam, and `roadEta` is exactly
`maps.route(quantizeForEtaCache(from), target)` — pass B is that call minus the wrapper.

## Out of Scope / Non-Goals

- **Not included**: changing `TRACKING_ETA_GRID_DECIMALS`, `COORD_PRECISION`, or any TTL. This ticket
  *measures* the grid; tuning it is the "first Google bill" trigger both constants already carry.
- **Not included**: in-flight coalescing (still open, deferred to #13/#16), the crossing *rate* (heading-
  dependent, explicitly not what this script measures), or a real Google provider.
- **Not included**: 2-D jitter. Jitter moves **latitude only** — the walk's own axis (see NOTES).
- **Not included**: randomised jitter. Deterministic offsets only, or the idempotence control (Level 4
  step 4) stops meaning anything.
- **Not changing**: the existing per-cell invariant `[1, 0, 0, 0, 0]`, the positive control, the
  quote-discrimination assertion, the pre-flight clear, the teardown, or the poll-budget guard.
- **Not rewriting history**: `.claude/reports/mint-tracked-ride-dev-script-report.md`,
  `.claude/execution-reports/mint-tracked-ride-dev-script.md` and `CLAUDE.md:64` accurately describe what
  #107 shipped. They stay. Only the #107 *plan* gets a forward-reference + amendment.

## Feature Metadata

**Feature Type**: Enhancement (dev instrument)
**Estimated Complexity**: Medium
**Primary Systems Affected**: `services/api/scripts/mint-tracked-ride.ts` (all of it), one export in
`services/api/src/features/geo/caching-maps.provider.ts` + its barrel, one spec case in
`services/api/src/features/notifications/notifications.policy.spec.ts`
**Dependencies**: none new. Requires running docker Postgres + Redis and a seeded dev database.

## Related Work

**Implements**: [#108](https://github.com/linardsb/taxi/issues/108) (`Closes #108`) · **Epic**: none — a
standalone follow-up deferred from the PR #107 review.

**Back-references**:

- `.claude/plans/mint-tracked-ride-dev-script.md` — Why: the plan this script was built from. Its walk task
  carries the GOTCHA beginning "sub-cell jitter, if added, must stay within ±0.0004° lat of the centre",
  which sanctions the magnitude (±0.0002°, bound ±0.0004°); the note beginning "the unquantized
  counterfactual is not measured" carries the claim this ticket converts from arithmetic to observation.
  **Cited by text, not by line**: this ticket's own amendment to that file shifts every line below its
  Forward-references block by +2, so a pin written here would be stale the moment it landed.
- `.claude/code-reviews/pr-107-review.md:43-90` — Why: finding **H1**, the full argument and options (a)/(b)/(c).
  This ticket is option (b).
- `.claude/plans/tracking-eta-maps-quantized-cache.md` — Why: #87, the grid being measured.
- `.claude/plans/harden-maps-seam-spend-controls.md` — Why: #94, the `geo.maps.route_fetched` counter and the
  negative cache this run has to clear.

**Forward-references**: (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `services/api/scripts/mint-tracked-ride.ts` — **read the whole file.** Every change lands here.
  - lines 1-35 — the docblock that states what the script does; must be updated for two passes.
  - lines 106-128 — `CELLS`, `POLLS_PER_CELL`, `cellLocation`, `POLL_GAP_MS`. Jitter constants go here.
  - lines 159-162 — `routeFetched(caller)`, the counter. **Cumulative over the whole run** — see GOTCHAs.
  - lines 276-284 — `CellRow`, gains the observed positions.
  - lines 351-394 — poll-budget guard + pre-flight cache clear (pass A's corridors).
  - lines 425-434 — the driver's initial ping at cell 0 centre.
  - lines 508-529 — the walk loop + positive control + `report` + `assertInvariants` call sites.
  - lines 646-707 — `walkCell`, the function being restructured (traps 1 and 2 live here).
  - lines 725-786 — `report`, including the claim text at 758-772 that this ticket retires.
  - lines 788-829 — `assertInvariants`.
- `services/api/src/features/geo/caching-maps.provider.ts` (lines 13-18, 63-103) — Why: `COORD_PRECISION = 4`
  and `renderPoints` are what make the jitter step meaningful; `routeCacheKey`/`routeFailureKey` are already
  exported for exactly this instrument.
- `services/api/src/features/geo/geo.module.ts` (lines 78-90) — Why: `MAPS_PROVIDER_ETA` is a
  `CachingMapsProvider` over the shared source, negative cache ON. Pass B injects this token.
- `services/api/src/features/geo/index.ts` — Why: the barrel; `MAPS_PROVIDER_ETA` is exported here, and
  `COORD_PRECISION` gets re-exported here.
- `services/api/src/features/notifications/notifications.policy.ts` (lines 29-57, 170-180) — Why: the grid's
  docblock makes the "must stay COARSER than `COORD_PRECISION`" claim in prose; `quantizeForEtaCache` is the
  function pass B replaces with identity.
- `services/api/src/features/notifications/tracking/tracking.service.ts` (lines 115-140, 185-195) — Why:
  `positionOf(cityId, driverId)` is how the page reads the position (pass A's settle check mirrors it), and
  `roadEta`'s single line `this.maps.route(quantizeForEtaCache(from), target)` is what pass B reproduces
  minus the wrapper. Note the target is the **pickup** while status is `accepted`.
- `services/api/src/features/drivers/index.ts` + `location/driver-location.store.ts` (lines 25-62) — Why:
  `DRIVER_LOCATION_STORE` and `positionOf` are both exported from the barrel — the settle check needs them.
- `services/api/src/features/drivers/location/driver-location.gateway.ts` (lines 93-139) and
  `driver-location.service.ts` (lines 41-71) — Why: confirms `handleLocation` never acks and never throws,
  and that **no throttle or min-distance filter** sits on the ping path — 30 pings in a few seconds is fine.
- `services/api/src/features/notifications/tracking/tracking.integration.spec.ts` (lines 684-709) — Why: the
  in-memory version of exactly this property; its "~22 m nudge is a cache hit" case is the jitter magnitude
  this ticket uses live.
- `.claude/plans/mint-tracked-ride-dev-script.md` — the walk task's jitter GOTCHA and the "unquantized
  counterfactual is not measured" note. Why: the sanctioned jitter magnitude and the claim text being
  superseded. Cited by text — this ticket's amendment to that file shifts its line numbers.

### New Files to Create

None. This is an edit to an existing script plus one export and one spec case.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `CLAUDE.md` "Hard rules", the numbers/provenance bullets — Why: this ticket exists *because* of them; the
  report text you write is the deliverable being judged.
- `.claude/references/logging-standard.md` — Why: no coordinate ever reaches a log line. The script prints
  coordinates to **stdout via `console.log`**, which is not a log line and is already how the existing table
  works. Do not add coordinates to anything going through `Logger`.
- [Redis GEOADD precision](https://redis.io/docs/latest/commands/geoadd/#what-is-the-precision-of-geohash)
  — Specific section: "the error introduced is ~0.6 m". Why: the settle check's tolerance has to clear it.
- [`Number.prototype.toFixed`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toFixed)
  — Why: both quantizers round (not truncate); cell centres at `.xxx0`, boundaries at `.xxx5`.

### Patterns to Follow

**Deriving a constant rather than restating it** (`mint-tracked-ride.ts:119-122`):

```ts
const cellLocation = (i: number): LatLng => ({
  lat: Number((WALK_BASE_LAT + i * 0.001).toFixed(TRACKING_ETA_GRID_DECIMALS)),
  lng: WALK_LNG,
});
```

The jitter step follows the same discipline — derived from `COORD_PRECISION`, never a literal `1e-4`.

**Refusing to run rather than reporting a wrong number** (`mint-tracked-ride.ts:358-364`):

```ts
if (plannedViews + 1 > TRACKING_VIEW_MAX_PER_WINDOW) {
  throw new Error(
    `refusing to run: ... the run would 429 mid-walk and the zero counts would be the throttle, not the cache.`,
  );
}
```

Every new guard in this ticket takes that shape: name the wrong number the run would otherwise print.

**Named, diagnosing failures** (`mint-tracked-ride.ts:686-689`) — an error message says which mechanism broke
and what to do, not just what was expected.

**Every printed number carries its arithmetic and its case** (`mint-tracked-ride.ts:742-785`) — and after this
ticket, also its provenance keyword.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — make the coupling importable and checked

Export the corridor cache's precision so the jitter step can be derived from it rather than duplicated, and
turn `notifications.policy.ts:34`'s prose claim ("must stay COARSER than `COORD_PRECISION`") into a CI test.

**Tasks:**

- `export const COORD_PRECISION` in `caching-maps.provider.ts`; re-export from the geo barrel.
- One spec case asserting `TRACKING_ETA_GRID_DECIMALS < COORD_PRECISION`.

### Phase 2: Core — jitter geometry and the restructured walk

**Depends on:** Phase 1 (the jitter step is derived from the exported constant).

**Tasks:**

- Jitter constants + `pollLocation(cellIndex, poll)`.
- Boot guards: grid coarser than corridor precision; `POLLS_PER_CELL` inside the ±0.0004° bound.
- Restructure `walkCell` into a per-poll `emit → settle → view` loop; record observed positions.
- Replace the blind pre-view `sleep` with a `positionOf` settle loop (kills the ping race).

### Phase 3: Integration — pass B

**Depends on:** Phase 2 (pass B replays what pass A observed).

**Tasks:**

- **Close pass A before pass B opens**: freeze its count, print its table, run its assertions — all before
  `unquantizedPass` is called. The counter is cumulative, and ordering is what makes that harmless (R1).
- Refuse pass B up front if the observed polls collapsed onto fewer corridors than polls (R3).
- Clear the raw corridors built from the observed positions (+ fail keys), then replay through
  `MAPS_PROVIDER_ETA` and count the delta.

### Phase 4: Report, assertions, and the surfaces that inherit the number

**Depends on:** Phase 3.

**Tasks:**

- Split `report()` into `reportCells` (pass A, early) and `reportSummary` (both counts, after pass B); rewrite
  the claim block at `:758-772` as an observed two-count comparison with provenance.
- Split `assertInvariants()` into a quantized half (early) and an unquantized half, the latter carrying the
  count, corridor-distinctness and wrong-target checks.
- Update the script docblock; amend the #107 plan with a forward reference.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 0. PRE-FLIGHT (not a code change)

- **IMPLEMENT**: `git reflog -8` and `git status`. This checkout currently sits on
  `feature/dev-env-redis-doc` with **two unpushed commits and no PR** — another session's live work. Do not
  commit onto it. `git switch main && git pull --ff-only && git switch -c feature/mint-ride-sub-cell-jitter`,
  or take a `git worktree` (then run everything DB-touching with `COMPOSE_PROJECT_NAME=taxi`).
- **GOTCHA**: `cp .env.example .env` if absent, then `docker compose up -d --wait`. Without `.env` the script
  cannot reach Postgres and the failure looks like a script bug. `REDIS_PORT=6381` on this machine
  (6379 is a shadowed tunnel — a wrong port surfaces as `NOAUTH`).
- **VALIDATE**: `git branch --show-current` prints the new branch; `COMPOSE_PROJECT_NAME=taxi docker compose ps`
  shows postgres and redis healthy.
- **SATISFIES**: prerequisite for AC #9

### UPDATE `services/api/src/features/geo/caching-maps.provider.ts`

- **IMPLEMENT**: add `export` to `const COORD_PRECISION = 4` (line 18). Extend its docblock with one sentence:
  it is now also the unit the `mint:ride` instrument derives its sub-cell jitter step from, so moving it moves
  the jitter with it.
- **PATTERN**: the file already exports implementation detail for exactly this reason —
  `routeCacheKey`/`routeFailureKey` (lines 81-103) with the rationale in their docblocks.
- **IMPORTS**: none.
- **GOTCHA**: do **not** change the value. `4` is the hit-rate/accuracy knob and carries its own
  "revisit when the first Google bill exists" trigger.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/geo/index.ts`

- **IMPLEMENT**: re-export `COORD_PRECISION` from `./caching-maps.provider`, with a one-line comment: the
  tracking grid's coarseness claim (`notifications.policy.ts:34`) depends on this number, so it is a contract
  of the slice rather than a private detail.
- **PATTERN**: the existing `export { MAPS_PROVIDER, MAPS_PROVIDER_ETA, MAPS_PROVIDER_SOURCE }` block.
- **GOTCHA**: the barrel's docblock says "nothing outside imports past this file" — that rule is why this is a
  barrel re-export and not a deep import from the spec.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1

### ADD a grid-coarseness case to `services/api/src/features/notifications/notifications.policy.spec.ts`

- **IMPLEMENT**: inside the existing `describe('quantizeForEtaCache')`, add
  `it('stays coarser than the corridor cache key, or the grid buys nothing', ...)` asserting
  `TRACKING_ETA_GRID_DECIMALS` is strictly less than `COORD_PRECISION`. Comment: this is the prose claim at
  `notifications.policy.ts:34` made checkable — at equal precision the grid is an identity function and
  `mint:ride`'s two passes would report the same count.
- **PATTERN**: the file's existing cases (lines 14-35), plain `expect` on policy constants.
- **IMPORTS**: `import { COORD_PRECISION } from '../geo';`
- **GOTCHA**: import from the **barrel** (`../geo`), not the provider file.
- **VALIDATE**: `pnpm --filter @taxi/api test -- notifications.policy.spec`
- **SATISFIES**: AC #1, AC #8

### ADD jitter geometry to `services/api/scripts/mint-tracked-ride.ts`

- **IMPLEMENT**: below `cellLocation` (line 122), add:

  ```ts
  /**
   * Sub-cell jitter, in DEGREES OF LATITUDE — the walk's own axis, so one
   * geometry describes both the step and the jitter.
   *
   * The step is the CORRIDOR CACHE's own precision (`COORD_PRECISION = 4`), which
   * is the smallest move that mints a distinct 4-dp cache key — and therefore the
   * smallest jitter under which an unquantized pass costs anything. Derived, never
   * a literal `1e-4`: at equal precision the two passes would report the same
   * count and the reduction would silently read 1×.
   *
   * ~11 m per step. With POLLS_PER_CELL = 5 the offsets are −2…+2 steps, so a
   * poll sits at most 0.0002° ≈ 22 m of LATITUDE from the cell centre (the same
   * figure is ~12 m of LONGITUDE at Rīga's ~57°N — this jitter is latitude, so
   * 22 m is the number). Inside the plan's ±0.0004° bound — the GOTCHA in
   * `mint-tracked-ride-dev-script.md`'s walk task, cited by its text because
   * this ticket's own amendment moves that file's line numbers. The bound is
   * itself a margin below the half-cell: the 3-dp grid is 0.001° wide, so the
   * boundary is at ±0.0005°.
   * Real GPS jitter is ±10–20 m (`notifications.policy.ts:49`) — same order.
   */
  const JITTER_STEP_DEG = 10 ** -COORD_PRECISION;
  /** Half a step. Nearest-neighbour: it cannot confuse two jitter positions (1 step apart)
   *  and clears Redis GEO's ~0.6 m (~5.4e-6°) storage error by 9.3× (5e-5 / 5.39e-6). */
  const JITTER_MATCH_TOLERANCE_DEG = JITTER_STEP_DEG / 2;
  /** ±0.0004° — the plan's bound, not the cell edge (0.0005°). */
  const MAX_JITTER_STEPS = 4;

  /** Steps from the cell centre for poll `p`: symmetric, integer, strictly increasing. */
  const jitterSteps = (poll: number): number =>
    poll - Math.floor((POLLS_PER_CELL - 1) / 2);

  /** The cell's centre nudged by poll `p`'s jitter. Latitude only. */
  const pollLocation = (cellIndex: number, poll: number): LatLng => {
    const centre = cellLocation(cellIndex);
    return {
      lat: Number(
        (centre.lat + jitterSteps(poll) * JITTER_STEP_DEG).toFixed(COORD_PRECISION),
      ),
      lng: centre.lng,
    };
  };
  ```

- **PATTERN**: `cellLocation` (lines 119-122) — `Number((...).toFixed(N))` so float text never decides a key.
- **IMPORTS**: add `COORD_PRECISION` to the existing deep import block from
  `'../src/features/geo/caching-maps.provider'` (lines 66-69) — same statement as `routeCacheKey`.
- **GOTCHA**: **integer steps only.** `jitterSteps` uses `Math.floor`, so even `POLLS_PER_CELL` gives e.g.
  `−1, 0, +1, +2` rather than half-steps. Half-steps (`±0.00005`) round unpredictably at 4 dp and would
  collapse two polls onto one corridor — an under-count that reads as a better reduction than reality.
- **GOTCHA**: `toFixed(COORD_PRECISION)`, **not** `toFixed(TRACKING_ETA_GRID_DECIMALS)` — the latter would
  round the jitter straight back onto the grid and the whole ticket would be a no-op that still prints 5×.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #2

### ADD the boot guards to `main()` in `services/api/scripts/mint-tracked-ride.ts`

- **IMPLEMENT**: beside the existing poll-budget guard (lines 351-364), before any spend:

  ```ts
  // The grid must be COARSER than the corridor key, or `quantizeForEtaCache` is an
  // identity function and pass B would report the same count as pass A — a 1×
  // "reduction" printed as if it were a measurement. This is the claim
  // `notifications.policy.ts:34` makes in prose.
  if (TRACKING_ETA_GRID_DECIMALS >= COORD_PRECISION) { throw new Error(...); }

  // Jitter must stay inside the cell, or a poll lands in a NEIGHBOURING cell,
  // pass A pays twice for one cell and `[1, 0, 0, 0, 0]` breaks.
  const maxSteps = Math.max(Math.abs(jitterSteps(0)), Math.abs(jitterSteps(POLLS_PER_CELL - 1)));
  if (maxSteps > MAX_JITTER_STEPS) { throw new Error(
    `refusing to run: MINT_POLLS_PER_CELL=${POLLS_PER_CELL} needs ±${maxSteps} jitter steps ` +
    `(±${(maxSteps * JITTER_STEP_DEG).toFixed(4)}°), past the ±${(MAX_JITTER_STEPS * JITTER_STEP_DEG).toFixed(4)}° ` +
    `bound and near the ${(0.0005).toFixed(4)}° half-cell — polls would cross into the next cell and the ` +
    `per-cell counts would be 2, not 1. Max is ${MAX_JITTER_STEPS * 2 + 1} polls per cell.`); }
  ```

- **PATTERN**: `mint-tracked-ride.ts:358-364` — refuse, and name the wrong number the run would print.
- **GOTCHA**: `maxSteps = ceil((POLLS_PER_CELL − 1) / 2)`, so the ceiling is **9 polls per cell**
  (`ceil(8/2) = 4 ≤ 4`); 10 needs 5 steps and is refused. Check the arithmetic, don't copy the number blindly.
- **GOTCHA**: print the guards' outcome next to the existing poll-budget line so a reader sees the geometry
  the run used: steps per poll, max offset in degrees **and** metres (`× 111_320` for latitude, shown).
- **VALIDATE**: `MINT_POLLS_PER_CELL=10 pnpm --filter @taxi/api mint:ride` refuses before signing in;
  `MINT_POLLS_PER_CELL=9` is accepted.
- **SATISFIES**: AC #2, AC #7

### UPDATE `CellRow` in `services/api/scripts/mint-tracked-ride.ts`

- **IMPLEMENT**: add `observed: LatLng[]` — "the position the page reported for each poll, in order. Pass B
  replays these, not the intended ones: whatever the page saw is what an unquantized page would have keyed."
- **PATTERN**: the existing `perView: number[]` field and its comment (lines 281-282).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3

### REFACTOR `walkCell` in `services/api/scripts/mint-tracked-ride.ts` (lines 646-707)

- **IMPLEMENT**: replace the emit-once / land-loop / pad-loop shape with one loop of `POLLS_PER_CELL`
  iterations, each: `emit pollLocation(index, poll)` → **settle** (below) → `view(token)` counted exactly as
  today (`before`/`after` deltas around the call, `cell` from the freshest event) → push `page.position` onto
  `observed`. Signature gains the store and city id needed by the settle step. Returns the same `CellRow`
  plus `observed`.

  ```ts
  /** Waits for THIS poll's ping to reach Redis. Costs no view, no throttle, no paid call —
   *  it reads the same store `TrackingService` reads (`tracking.service.ts:~120`).
   *  Replaces the old landed-loop, which spent counted views on the confirmation. */
  async function awaitPing(
    locations: DriverLocationStore, cityId: string, driverId: string,
    expected: LatLng, what: string,
  ): Promise<void> {
    const deadline = Date.now() + PING_SETTLE_TIMEOUT_MS;
    for (;;) {
      await sleep(POLL_GAP_MS);
      const recorded = await locations.positionOf(cityId, driverId);
      if (recorded && Math.abs(recorded.location.lat - expected.lat) < JITTER_MATCH_TOLERANCE_DEG) return;
      if (Date.now() > deadline) throw new Error(
        `${what}: the driver's recorded position never reached ${expected.lat} within ${PING_SETTLE_TIMEOUT_MS} ms — ` +
        `the location ping was dropped (Redis unreachable, or the driver left the online set). ` +
        `If this is intermittent, raise PING_SETTLE_TIMEOUT_MS.`);
    }
  }
  ```

  Keep the page-side check as the diagnostic it has always been, now against **this poll's jittered latitude**:
  `Math.abs(page.position.lat - position.lat) < JITTER_MATCH_TOLERANCE_DEG`, throwing a named error otherwise.
- **PATTERN**: the existing error text at `:686-689` (which mechanism broke, and why); `waitFor` at `:170-182`
  for the deadline shape (it takes a **sync** reader, so `awaitPing` is its own loop — do not force
  `positionOf` through it).
- **IMPORTS**: `import { DRIVER_LOCATION_STORE, type DriverLocationStore } from '../src/features/drivers';`
  (barrel — both are exported there). Add `const PING_SETTLE_TIMEOUT_MS = 2_000;` beside the other timeouts.
  Resolve once in `main()`: `const locations = app.get<DriverLocationStore>(DRIVER_LOCATION_STORE);` and pass
  it plus `env.DEFAULT_CITY_ID` and `driver.id` into `walkCell`.
- **GOTCHA — TRAP 1**: `walkCell` emitted the position **once** (`:659`); the landed loop broke early at
  `:675` and the pad loop at `:686-697` polled without moving. Per-poll jitter means both loops go. This is a
  restructure, not an insert.
- **GOTCHA — TRAP 2**: the old landed check compared `page.position.lat` to the **cell centre** with a `5e-5`
  tolerance — smaller than the jitter, so left as-is every cell throws. Compare to **this poll's intended
  jittered latitude** instead. The tolerance stays `5e-5` (= `JITTER_MATCH_TOLERANCE_DEG`, half a step) and
  gets *stronger*: it now proves the page shows *this* poll's position, not merely *this* cell.
- **GOTCHA**: the settle read must come **before** the counted view, or a view can route the previous poll's
  corridor — which is a cache hit in pass A (`[1,0,0,0,0]` still passes) but a *duplicate* corridor in pass B,
  silently reporting fewer than `CELLS × POLLS_PER_CELL`. This is why the race is closed at the store, not
  papered over with a longer sleep.
- **GOTCHA**: the counted view must still be the **first** view of a fresh cell, so the cell's first poll pays
  and the rest are free. `awaitPing` spends no views, which is what preserves that.
- **GOTCHA**: `POLL_GAP_MS` is now the settle-poll interval; make sure it is still referenced exactly once
  (an unused const fails lint).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`, then a full
  `pnpm --filter @taxi/api mint:ride` — the per-cell table still shows `[1, 0, 0, 0, 0]` for every cell.
- **SATISFIES**: AC #2, AC #3

### ADD the pass-A snapshot AND assert pass A *before* pass B runs — `main()`

- **IMPLEMENT**: replace the `report(rows, token); assertInvariants(rows);` pair at `:525-526` with the
  sequence below. Write this call order **first** and let the next three tasks fill in the bodies — the
  ordering is the mitigation, and the function signatures fall out of it.

  ```ts
  // Pass A is CLOSED before pass B opens: its count is frozen, its table is printed
  // and its invariants are checked while no pass-B call exists to contaminate them.
  // Ordering, not discipline, is what keeps the two passes' numbers apart.
  const etaCallsQuantized = routeFetched('eta').length;  // frozen; also pass B's slice index
  reportCells(rows);                                     // table first: a failure still explains itself
  assertQuantizedInvariants(rows, etaCallsQuantized);

  const unquantized = await unquantizedPass(etaMaps, kv, rows);
  const passBEvents = routeFetched('eta').slice(etaCallsQuantized);
  reportSummary(rows, token, { quantized: etaCallsQuantized, unquantized });
  assertUnquantizedInvariants(rows, unquantized, passBEvents);
  console.log('\nPASS — …');
  ```
- **GOTCHA**: print the per-cell table **before** asserting, not after. Today `report()` runs before
  `assertInvariants` (`:525-526`) precisely so a failing run still shows the table that explains why; moving
  the pass-A assert earlier without moving the table earlier too would silently take that away. Hence the
  report splits as well — `reportCells` here, `reportSummary` after pass B (next tasks).
- **GOTCHA — THE MOST LIKELY BUG IN THIS TICKET, AND THE REASON FOR THE ORDERING ABOVE**: `routeFetched`
  filters the **whole capture buffer** (`:159-162`), so it is cumulative. After pass B it returns 36, not 6.
  `report()` (`:727`) and `assertInvariants()` (`:790`, `:793`) both read it as a total today and would
  print/assert 36 as pass A's cost. Asserting pass A before pass B exists makes that impossible rather than
  merely discouraged — a snapshot alone still leaves a live `routeFetched('eta')` call in scope that a later
  edit can reach for. A wrong number in the report is precisely the defect class this ticket exists to close.
- **GOTCHA**: `etaEventsAfterA` is also the split point for pass B's events —
  `routeFetched('eta').slice(etaCallsQuantized)` is exactly pass B's, which is where the distinct-`cell`
  assertion reads its hashes. Take the length once and reuse it; do not re-filter and hope the two agree.
- **GOTCHA**: `walkCell`'s own `before`/`after` deltas around each view keep using `routeFetched('eta')` and
  are fine — they are taken and consumed inside pass A. The call sites to audit are the ones that run **after
  `unquantizedPass`**: there must be none that read the raw total. Pass A's figure comes from
  `etaCallsQuantized`, pass B's from the delta `unquantizedPass` returns, and pass B's *events* from
  `.slice(etaCallsQuantized)`.
- **VALIDATE**: `grep -n "routeFetched(" services/api/scripts/mint-tracked-ride.ts` and read each hit against
  the rule above — every occurrence is either inside `walkCell`, inside `unquantizedPass`, the snapshot, or an
  explicit slice. A bare `routeFetched('eta').length` in `report()` or in the pass-B assertions is the bug.
- **SATISFIES**: AC #4, AC #7

### ADD the unquantized pass (pass B) to `services/api/scripts/mint-tracked-ride.ts`

- **IMPLEMENT**: a new function run after the snapshot and before `report`:

  ```ts
  /**
   * PASS B — the unquantized counterfactual, RUN rather than derived.
   *
   * `TrackingService.roadEta` is exactly `maps.route(quantizeForEtaCache(from), target)`
   * (`tracking.service.ts:192`). This is that call with the wrapper removed, against the
   * SAME `MAPS_PROVIDER_ETA` instance, the same Redis, the same source and the same target,
   * replaying the positions pass A's page actually reported. Substituting identity for
   * `quantizeForEtaCache` is the ONLY difference between the two counts — which is what
   * makes the reduction attributable to #87's grid rather than to the 4-dp corridor cache
   * that predates it.
   *
   * It deliberately does NOT go through `GET /track/:token`: it measures the SEAM's cost,
   * which is where the paid call is, and so spends none of the token's poll budget.
   */
  async function unquantizedPass(
    maps: MapsProvider, kv: KeyValueStore, rows: CellRow[],
  ): Promise<number> {
    const positions = rows.flatMap((row) => row.observed);
    const keys = positions.map((p) => routeCacheKey('eta', p, CENTRE_PICKUP.location));

    // FAIL BEFORE SPENDING, not after. If two polls collapsed onto one corridor (a ping
    // landed late, or the jitter got rounded back onto the grid), pass B costs one call
    // fewer and the reduction reads BETTER than reality — the flattering direction, and
    // the one a reader will not question. Caught here, it names the cause; caught by the
    // count assertion afterwards, it has already been paid for.
    const distinct = new Set(keys);
    if (distinct.size !== positions.length) {
      throw new Error(
        `refusing to run pass B: ${positions.length} polls collapsed onto ${distinct.size} distinct ` +
          `4-dp corridors. Either a ping landed late (two polls saw one position — raise ` +
          `PING_SETTLE_TIMEOUT_MS) or the jitter is being rounded onto the grid (check that ` +
          `pollLocation rounds to COORD_PRECISION, not TRACKING_ETA_GRID_DECIMALS). ` +
          `Pass B would under-report and the reduction would read too high.`,
      );
    }

    // Cold cache, exactly as pass A started from — and NOT optional: the zero-offset poll
    // of every cell renders to the same 4-dp key as pass A's quantized origin, so without
    // this those CELLS corridors are warm and pass B under-reports by one per cell. Run 2
    // of the idempotence check is worse: inside MAPS_ETA_CACHE_TTL_SECONDS every corridor
    // is warm and pass B reports ~0.
    for (const position of positions) {
      await kv.del(routeCacheKey('eta', position, CENTRE_PICKUP.location));
      await kv.del(routeFailureKey('eta', position, CENTRE_PICKUP.location));
    }

    const before = routeFetched('eta').length;
    for (const position of positions) {
      await maps.route(position, CENTRE_PICKUP.location);
    }
    return routeFetched('eta').length - before;
  }
  ```

- **PATTERN**: the pre-flight clear at `:366-394` — same two key builders, same reason, stated per pass.
- **IMPORTS**: `import { MAPS_PROVIDER_ETA } from '../src/features/geo';` and
  `import type { MapsProvider } from '@taxi/shared';` (add to the existing `@taxi/shared` type import).
  Resolve in `main()`: `const etaMaps = app.get<MapsProvider>(MAPS_PROVIDER_ETA);`
- **GOTCHA**: the clear list is built from `row.observed` (what the page reported), **not** from
  `pollLocation` — the two agree here (Redis GEO's ~0.6 m error is ~5.4e-6°, far inside the 5e-5° that a 4-dp
  rendering would need to move), but clearing what you are about to route is the version that cannot drift.
- **GOTCHA**: the target is `CENTRE_PICKUP.location`, because the ride is still `accepted` for the whole walk
  and `roadEta` routes to the **pickup** until `in_progress` (`tracking.service.ts:~130`). If the script ever
  starts the ride mid-walk, this target has to follow or pass B routes corridors the page never keyed.
- **GOTCHA**: `app.get(MAPS_PROVIDER_ETA)` resolves non-strictly (the token is in `GeoModule`'s `exports`).
  If it throws, fall back to `app.select(GeoModule).get(MAPS_PROVIDER_ETA)`.
- **GOTCHA**: pass B costs `CELLS × POLLS_PER_CELL` paid calls where pass A costs `CELLS`. Against
  `StubMapsProvider` that is free; if a real Google provider is ever bound in dev, one run of this script is
  36 route calls, not 6. Say so in the summary — the `<€100/mo` guardrail is the reason this instrument exists.
- **GOTCHA**: `maps.route` is **not** wrapped in a `catch`. A throw here means the source failed or the seam
  timed out, and swallowing it would leave pass B short by one and blame the cache. Let it propagate — the
  `finally` teardown still runs. (`eta` negative-caches, so a swallowed failure would also poison that
  corridor for `MAPS_ETA_FAILURE_TTL_SECONDS` and quietly corrupt the *next* run's pass B.)
- **GOTCHA**: pass B leaves `CELLS × POLLS_PER_CELL` warm corridor entries in Redis for
  `MAPS_ETA_CACHE_TTL_SECONDS`. Confirm this does not break the idempotence control before relying on it: run
  2's pass-A pre-flight clears the quantized cell centres, which is exactly the one key per cell that pass B's
  zero-offset poll shares; the other entries are at 4-dp offsets pass A never keys. So run 2's pass A is cold
  and pass B re-clears its own. Non-obvious, and worth a comment in the code rather than a rediscovery.
- **VALIDATE**: `pnpm --filter @taxi/api mint:ride` — the summary prints pass B = `CELLS × POLLS_PER_CELL`.
- **SATISFIES**: AC #4, AC #5, AC #8

### SPLIT `report()` in `services/api/scripts/mint-tracked-ride.ts` (lines 725-786)

- **IMPLEMENT**: split into `reportCells(rows)` — the per-cell table (`:730-740`), called right after the walk
  and before the pass-A assert — and `reportSummary(rows, token, { quantized, unquantized })` — everything
  from `:742` down, called after `unquantizedPass`. Both take their counts as **arguments**; neither reads
  the cumulative counter. Add an `offset` column to the per-cell table showing, per poll, the **observed**
  offset — `row.observed[p].lat − row.quantized.lat`, in steps or degrees — not the intended one. Same reason
  pass B replays observed positions: the table then shows what happened rather than what was asked for, and a
  stale read would be visible in it rather than hidden behind a correct-looking intent. (In practice
  `awaitPing` throws before such a row can print; the column is what makes that verifiable rather than
  assumed.) In the summary, **replace the whole block at `:758-772`** with:

  ```
  quantized cost              6 = one paid call per cell crossing            [observed — pass A]
  unquantized cost           30 = 6 cells × 5 polls, one per 4-dp corridor   [observed — pass B]
  reduction                   5× attributable to #87's ETA grid              [observed]

  Provenance. Pass B replays the raw positions pass A's page reported, through the SAME
  `MAPS_PROVIDER_ETA` instance, the same Redis, the same `MAPS_PROVIDER_SOURCE` and the same
  pickup target, with `quantizeForEtaCache` replaced by identity. That substitution is the
  ONLY difference between the two counts, which is what attributes the reduction to the grid
  rather than to `CachingMapsProvider`'s 4-dp corridor cache (which predates it). Both passes
  start from a cold cache — the corridors are cleared immediately before each. Pass B does not
  go through `GET /track/:token`: it measures the seam's cost, where the paid call is.

  Jitter: ±2 steps × 0.0001° of LATITUDE = ±0.0002° ≈ ±22 m (0.0002 × 111 320 m/°); the same
  figure would be ~12 m of longitude at Rīga's ~57°N, and this jitter is latitude. Deterministic,
  not random — two runs walk identical coordinates. Inside the ±0.0004° bound and inside the
  0.0005° half-cell, so every poll quantizes to its own cell centre (asserted).

  The reduction scales with polls per cell and is NOT a per-minute spend figure: it is the cost
  of THIS walk under THIS dwell. `notifications.policy.ts:41-46` has the moving-driver case
  (~2× at 12 polls/min over a uniform heading); the stationary driver — the case the grid really
  rescues — is the one this run resembles.
  ```

  Every literal above must be printed from the run's own variables, not hardcoded.
- **PATTERN**: the surviving heading block (`:774-785`) — keep it verbatim in `reportSummary`; it is still
  true and still needed.
- **GOTCHA**: **retire the subject, not the sentence.** Grep `unquantized`, `identity function`, `arithmetic,
  not a measurement` in this file and make sure nothing survives claiming the grid is an identity function for
  this walk — after the jitter it is not, and a leftover caveat is now itself the false statement. Grep the
  same nouns in the PR body before opening it: that surface is the most-read one and the only one not in the
  working tree.
- **GOTCHA**: the reduction is `unquantized / quantized`. Guard the divide (`Math.max(1, quantized)`) as the
  current line already does, and print it with the same `.toFixed(0)` only when it is integral — otherwise
  show a decimal rather than rounding a 4.8× to "5×".
- **GOTCHA**: the `[observed — pass A/B]` tags are the deliverable, not decoration. A figure printed under
  that tag that no pass produced is the exact defect #107 shipped and #108 exists to close — so the two counts
  must come from the arguments, and the *ratio* must be computed from them rather than restated. Nothing in
  this block may be a literal.
- **VALIDATE**: run the script and read the summary top to bottom: every number is either printed from a
  policy constant, shown with its arithmetic, or carries `[observed — pass A/B]`.
- **SATISFIES**: AC #6, AC #7

### SPLIT `assertInvariants()` in `services/api/scripts/mint-tracked-ride.ts` (lines 788-829)

- **IMPLEMENT**: split it into two functions, called at two different points in the run.

  **`assertQuantizedInvariants(rows, etaCallsQuantized)`** — called from `main()` **before**
  `unquantizedPass`. Every existing check moves here unchanged except that it takes the count as an argument
  rather than re-reading the counter: `etaCallsQuantized === rows.length`; distinct pass-A `cell` values
  `=== rows.length` and none `null`; per-cell `[1, 0, …]`; `quote >= 1`. Add two:

  3. **TRAP 3, asserted rather than assumed**: every observed position quantizes to its own cell centre —
     `quantizeForEtaCache(observed).lat === row.quantized.lat && .lng === row.quantized.lng`. This is the
     single check that keeps `[1, 0, 0, 0, 0]` meaningful under jitter, and it is the one that fails if the
     jitter ever grows past the half-cell.
  4. `observed.length === POLLS_PER_CELL` per row, and no `observed` entry is `null` — pass B replays this
     array, so a hole in it silently shrinks pass B.

  **`assertUnquantizedInvariants(rows, unquantized, passBEvents)`** — called after `unquantizedPass`:

  1. `unquantized === rows.length * POLLS_PER_CELL` — on failure name every cause: *fewer* means warm
     corridors (the pass-B clear missed one) or duplicate observed positions (a ping landed late — raise
     `PING_SETTLE_TIMEOUT_MS`); *more* means the target or the key builder drifted from `roadEta`'s.
  2. distinct `cell` hashes among `passBEvents` `=== rows.length * POLLS_PER_CELL` — the corridor-level
     version of (1); it is what proves the jitter actually minted distinct keys rather than pass B paying
     twice for one. `passBEvents` is `routeFetched('eta').slice(etaCallsQuantized)`, so pass A's hashes are
     not counted in. **Read the hashes the provider emitted (`cellOf(key)`,
     `caching-maps.provider.ts:264-271`) — do NOT recompute `routeCacheKey` in the script and count that.** A
     script-side recomputation only proves the script agrees with itself and would pass even if the facade
     keyed something else; the emitted `cell` is an observation of what was actually keyed, which is the
     entire point of this ticket. The script-side key builder stays in use only for the *clear* list and the
     pre-spend distinctness check, where the literal keys are what `kv.del` needs.
  5. **THE WRONG-TARGET DETECTOR** — every pass-A `cell` hash appears among the pass-B hashes. Exactly one
     poll per cell has a zero jitter offset (`jitterSteps(p) = 0` at `p = floor((N−1)/2)`, which is a valid
     index for every `POLLS_PER_CELL ≥ 1`), and that poll's raw position renders to the same 4-dp key text as
     pass A's quantized origin for that cell — so the two passes must share exactly `rows.length` hashes. If
     they share none, pass B is routing a different corridor space than the page did: wrong `to`, wrong
     `caller` namespace, or a key builder that drifted. Without this check pass B can be perfectly
     self-consistent and still measure something the page never keyed — and it would print as `[observed]`.

- **PATTERN**: the existing `problems: string[]` accumulator — collect all failures, throw once (`:826-828`).
  Keep that shape in both halves.
- **GOTCHA**: keep the pass-A distinct-`cell` check (`:799-806`). It proves *one corridor per cell* in pass A
  and is not made redundant by (2), which is about pass B.
- **GOTCHA**: the split is the point. Do **not** keep one function taking both counts and call it once at the
  end — that puts pass A's assertions downstream of pass B again, which is the failure mode this ordering
  exists to make impossible.
- **VALIDATE**: `pnpm --filter @taxi/api mint:ride` ends with `PASS`, and the pass-A block of output appears
  before pass B's first line — proof the ordering is what the plan says.
- **SATISFIES**: AC #3, AC #4, AC #5, AC #8

### UPDATE the script docblock (lines 1-35)

- **IMPLEMENT**: extend the "walks the driver due north" paragraph: each of the five polls per cell now sits
  at its own deterministic sub-cell offset, and the run has **two passes** — the tracked walk (grid on) and a
  replay of the same positions through the same maps facade with quantization removed. State that the two
  counts are what makes the reduction observed rather than derived, and reference `#108`.
- **PATTERN**: the file's existing docblock voice — states what, then why, then what it deliberately is not.
- **GOTCHA**: line 18's "NOT A TEST" paragraph stays true and stays put.
- **VALIDATE**: `pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #6

### UPDATE `.claude/plans/mint-tracked-ride-dev-script.md`

- **IMPLEMENT**: add a **Forward-references** entry pointing at `.claude/plans/mint-ride-sub-cell-jitter.md`
  (#108), and an **AMENDMENTS** entry dated today: the "unquantized counterfactual is not measured, and for
  this walk it is 6" note at line 447-449 described what #107 shipped; #108 added sub-cell jitter and a second
  pass, so the figure is now observed. Do **not** rewrite line 447-449 itself.
- **GOTCHA**: leave `.claude/reports/`, `.claude/execution-reports/` and `CLAUDE.md:64` untouched — they are
  accurate records of #107 and the CLAUDE.md bullet is a live lesson, not a stale claim.
- **VALIDATE**: `grep -n "mint-ride-sub-cell-jitter" .claude/plans/mint-tracked-ride-dev-script.md`
- **SATISFIES**: AC #6

### VALIDATE the whole thing

- **IMPLEMENT**: run the gate, then the manual Level 4 sequence below.
- **VALIDATE**: `pnpm turbo run typecheck lint test build --force`
- **SATISFIES**: AC #9

---

## TESTING STRATEGY

### Unit Tests

One new case in `services/api/src/features/notifications/notifications.policy.spec.ts`:
`TRACKING_ETA_GRID_DECIMALS < COORD_PRECISION`. That is the one invariant in this ticket that lives in
production code and can be checked without a database — and it is the invariant whose violation would make
both passes report the same count.

**Precedent, stated so it is a decision and not an omission**: the script itself ships no jest tests, exactly
as it did in #107. It boots the real `AppModule` against the dev database, is excluded from `dist/` by
`tsconfig.build.json`, and asserts nothing in CI. Its guarantees are held by `typecheck` + `lint` (so it
cannot rot) and by its own in-run assertions. Duplicating the walk under jest would be a second, weaker copy
of `tracking.integration.spec.ts:684-709`, which already covers the quantized property in-memory.

### Integration Tests

None new. `tracking.integration.spec.ts:684-709` already asserts the sub-cell-hit / crossing-costs-one
property (its "~22 m nudge" is the same magnitude this jitter uses) and must stay green — it is the regression
net for anything this ticket accidentally changes in the quantized path.

### Edge Cases

- `MINT_POLLS_PER_CELL=1` — jitter offsets collapse to `[0]`; pass B equals pass A; the reduction is 1×, and
  that is the correct answer for a one-poll cell. It must not throw, and the pre-spend distinctness check
  (R3) must not fire — one poll per cell is one corridor per cell, which is still `C × N`. Note the
  wrong-target detector (R5) is **vacuous** here: both passes key the identical corridor set, so the subset
  check passes carrying no information. A real measurement needs `POLLS_PER_CELL ≥ 2`; N=1 is a smoke run.
- `MINT_POLLS_PER_CELL=9` — accepted, at the ±0.0004° bound exactly.
- `MINT_POLLS_PER_CELL=10` — refused by the jitter guard before any spend (R6).
- `MINT_CELLS × MINT_POLLS_PER_CELL + 1 > 120` — refused by the pre-existing poll-budget guard first.
- Second run within `MAPS_ETA_CACHE_TTL_SECONDS = 300` — both clears must fire; both counts unchanged (R11).
- A ping that lands late — `awaitPing` throws by name (R4); if one ever slipped past it, R3 refuses pass B
  before it spends. It never degrades into a quietly smaller pass-B count.
- A source failure during pass B — propagates, does not get swallowed into a short count (R10).

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/api typecheck
pnpm --filter @taxi/api lint
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/api test -- notifications.policy.spec
```

### Level 3: The gate (CI parity)

```bash
pnpm turbo run typecheck lint test build --force
```

Set `REDIS_TEST_URL` to match `REDIS_PORT` (6381 on this machine) or the Redis-backed suites `describe.skip`
and the gate is silently short — **2 suites / 24 tests** as of this ticket, measured, not inherited.
(`CLAUDE.md:46` still says "five tests short"; that figure is stale and needs its own docs commit.)

### Level 4: Manual Validation — the instrument's own controls

Prerequisite: `.env` present, `COMPOSE_PROJECT_NAME=taxi docker compose up -d --wait`, dev DB seeded.

**OTP budget — count it before you start, this sequence nearly exhausts it.** Every *full* run spends one OTP
request per phone. `OTP_MAX_REQUESTS_PER_HOUR = 5` per phone over a fixed `OTP_RATE_WINDOW_SECONDS = 3600`
window, `OTP_RESEND_COOLDOWN_SECONDS = 60` apart (`otp.policy.ts:7-10`). Steps 2-5 below are four full runs =
**4 of the 5**, leaving exactly one retry inside the hour; a sixth attempt waits the window out. So: wait
≥60 s between runs, and do not burn a run debugging something a re-read would answer. Step 1 costs no OTP —
it is first for that reason.

1. **The guards, before any spend.** `MINT_POLLS_PER_CELL=10 pnpm --filter @taxi/api mint:ride` → refuses
   before sign-in, naming the ±0.0004° bound and costing no OTP request. Then `MINT_POLLS_PER_CELL=9` → the
   guard accepts (interrupt it once the walk starts, or let it run and count it as run 1 below).
2. **The run.** `pnpm --filter @taxi/api mint:ride` → ends `PASS`. Per-cell table shows `[1, 0, 0, 0, 0]`
   with a non-zero jitter offset on every poll; summary prints pass A = 6, pass B = 30, 5×, each tagged
   `[observed]`.
3. **Idempotence.** Wait out the cooldown, run it again → identical counts. (Proves both clears fire and the
   jitter is deterministic; against real Redis a missed clear shows up here and nowhere else.)
4. **The interception control.** Comment out `Logger.overrideLogger(capture)` (`:157`) → the run must fail
   with the "no `geo.maps.route_fetched` captured" message, **not** report a triumphant zero. Restore it.
   Note this run still spends an OTP request: with the override gone `capture.events` stays empty, so the
   code is requested and then `waitFor` (`:566`) times out.
5. **The jitter control — the one this ticket adds.** Temporarily force `jitterSteps` to return `0` → pass B
   drops to `CELLS` (6) and the reduction reads 1×. That is #107's identity-function case reproduced on
   demand, and it is the proof that the jitter, not the run's shape, is what makes pass B cost anything.
   Restore.
6. **Provenance read-through.** Read the printed summary as a reviewer: every figure is `[observed]` with the
   pass that produced it, or shows its arithmetic and names its case. No figure claims a mechanism without
   saying what was held constant. Costs no run.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — `COORD_PRECISION` is exported from `caching-maps.provider.ts` and re-exported from the geo
      barrel; a spec case asserts `TRACKING_ETA_GRID_DECIMALS < COORD_PRECISION`.
- [ ] **AC #2** — Each poll of a cell sits at a distinct, deterministic latitude offset that is an exact
      integer multiple of `10 ** -COORD_PRECISION`, derived from that constant and never a literal. Offsets
      stay within ±0.0004°; `POLLS_PER_CELL` past 9 is refused before any spend, by name.
- [ ] **AC #3** — Quantized behaviour is unchanged and proven so: every cell still costs exactly one paid
      call, `[1, 0, ...]` per cell, and every observed position is asserted to quantize to its own cell
      centre.
- [ ] **AC #4** — An unquantized pass is **run** against the same `MAPS_PROVIDER_ETA` instance with the same
      Redis, source and target, replaying the positions the page reported, and its paid-call count is
      measured from `geo.maps.route_fetched` — not derived.
- [ ] **AC #5** — Pass B costs exactly `CELLS × POLLS_PER_CELL`, over that many distinct corridors — the
      distinctness read from the `cell` hashes the provider emitted, not recomputed script-side. Both passes
      start from a cold cache. Every pass-A `cell` hash appears among pass B's (the wrong-target detector),
      and a corridor collision is refused **before** pass B spends anything.
- [ ] **AC #6** — The script prints both counts under `[observed]` with the pass that produced each, plus a
      provenance sentence naming what was held constant. The old "identity function / arithmetic, not a
      measurement" text is gone from the script (subject retired, not reworded), and the #107 plan carries a
      forward-reference and an amendment.
- [ ] **AC #7** — Pass A's table, count and assertions all run **before** `unquantizedPass` is called, so no
      printed or asserted pass-A figure can read the counter across both passes. The run states its own
      jitter geometry (steps, degrees, metres, axis) and that pass B costs `CELLS × POLLS_PER_CELL` paid calls
      if a real provider is ever bound.
- [ ] **AC #8** — Every risk in the register below is closed by a mechanism in the run, not by care: late
      ping, warm corridor, collapsed corridor, wrong target, out-of-cell jitter, broken interception and
      cross-pass counter contamination each produce a distinct, diagnosing failure — and the two that would
      flatter the result (collapsed corridor, warm corridor) fail **before** pass B spends.
- [ ] **AC #9** — `pnpm turbo run typecheck lint test build --force` green; Level 4 steps 1-6 all pass, with
      step 5's result (pass B = 6, 1×) recorded in the report as the control it is.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration), with `REDIS_TEST_URL` set
- [ ] No linting or type checking errors
- [ ] Level 4 manual sequence run, including controls 4 (interception) and 5 (jitter), with real output
      pasted into the report
- [ ] Acceptance criteria all met
- [ ] Every risk R1-R13 walked once against the finished code: each is closed by the mechanism named, and the
      mechanism is actually present (not merely intended)
- [ ] Every number in the report and the PR body **re-derived from the run's own output**, not copied from
      this plan — this plan's `6 / 30 / 5×` are `expected`, not `observed`, until a run produces them (R13)
- [ ] PR body says `Closes #108`, states both counts with their pass, and keeps the ~2× moving-driver figure
      visibly distinct from this run's reduction — they describe different cases

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions**

1. The ride stays `accepted` for the whole walk, so `roadEta`'s target is the pickup. Verified: the script
   never calls arrive/start; it accepts, walks, then cancels in teardown.
2. Redis GEO storage error (~0.6 m ≈ 5.4e-6° of latitude) is far below half a jitter step (5e-5°), so an
   observed position renders to the same 4-dp corridor key as the intended one. If this ever stopped holding,
   R3's pre-spend distinctness check is what would catch it — before the number is spent, not after.
3. `app.get(MAPS_PROVIDER_ETA)` resolves non-strictly from the root container. Fallback documented.
4. The dev provider is `StubMapsProvider`, so pass B's extra 30 route calls cost nothing. Stated in the
   summary so it stays true rather than assumed.
5. `POLL_GAP_MS = 60` plus a 2 s settle deadline is enough for a localhost ping to land. If it proves
   intermittent the knob is `PING_SETTLE_TIMEOUT_MS`, and the error says so (R4).
6. Nothing else in the process writes this driver's position during the walk. True by construction: the
   phones are fixed, the script owns the only driver socket, and teardown takes the driver offline. A second
   concurrent `mint:ride` against the same dev Redis would break this — one run at a time, like the gate.

**Questions that would change the plan if answered differently**

- *Should pass B run through a second full walk with the grid disabled in production code instead?* No —
  that means making `TRACKING_ETA_GRID_DECIMALS` injectable or monkey-patching a module export, i.e. changing
  production for a dev script. Flagged here rather than silently chosen; see NOTES for the comparison.
- *Should the jitter be longitude instead?* Decided: latitude. Rationale in NOTES.

---

## NOTES (open canvas)

### Why pass B is a facade replay, not a second walk

| Option | Isolates the grid? | Cost | Verdict |
|---|---|---|---|
| **(A) Replay observed positions through `MAPS_PROVIDER_ETA`, unquantized** | Yes — the only difference is `quantizeForEtaCache` → identity | ~30 stub route calls, no views, no throttle | **Chosen** |
| (B) Second full walk with the grid stubbed to identity | Yes, but only by making the policy constant injectable or mutating a module export at runtime | 62 views — inside the 120 budget, but it doubles the walk's wall time and buys a production seam for a dev script | Rejected: production change for an instrument |
| (C) Count distinct 4-dp keys and multiply | No — that is derivation | free | Rejected: this is exactly what #107 shipped |

(A) is also the honest reading of the mechanism: the grid sits between the page and the seam, and the paid
call is the seam's. Measuring the seam with and without the wrapper *is* measuring the grid.

### Why latitude, not longitude

The walk already moves in latitude (0.001° steps), so one axis describes both the step and the jitter — a
reader checks one geometry, not two. The settle check's nearest-neighbour tolerance also has a better margin
in latitude: 5e-5° ≈ 5.6 m against Redis GEO's ~0.6 m error (9.3×, from 5e-5 / 5.39e-6), where the same
tolerance in longitude at 57°N is ~3 m (~5×). The cost is that ±0.0002° is ~22 m rather than ~12 m — slightly above the ±10–20 m the
policy names for real GPS jitter, and worth stating rather than hiding. It is the *minimum* magnitude that
mints a distinct 4-dp corridor at 5 polls, so it is not padding.

### The arithmetic behind the guard

`jitterSteps(p) = p − floor((N−1)/2)`, so the largest magnitude is `ceil((N−1)/2)` steps.

| `POLLS_PER_CELL` | offsets (steps) | max offset | vs ±4-step bound |
|---|---|---|---|
| 1 | 0 | 0 | ok (degenerate: pass B = pass A) |
| 5 | −2…+2 | 0.0002° ≈ 22 m | ok |
| 9 | −4…+4 | 0.0004° ≈ 45 m | ok, at the bound |
| 10 | −4…+5 | 0.0005° ≈ 56 m | **refused** — that is the half-cell itself |

Half-cell = 0.0005° because the 3-dp grid is 0.001° wide and `toFixed(3)` rounds, putting boundaries at
`.xxx5`. The ±0.0004° bound is the plan's margin below it, not the edge.

### RISK REGISTER — every risk, and the mechanism that closes it

The ordering column matters more than it looks. A risk whose only defence is an assertion *after* pass B is
still a risk to the number; a risk that cannot occur because of how the run is sequenced is closed. Where
both were available, the plan takes the sequencing.

**Direction** says which way the error moves the headline figure. `flattering` is the dangerous class: it
makes the reduction read *better* than reality, so nobody questions it. Every flattering risk below is caught
**before** pass B spends, or made impossible by ordering.

| # | Risk | Direction | Closed by | When it fires |
|---|---|---|---|---|
| R1 | Cumulative counter read after pass B → pass A prints 36 | wrong (6× too high) | **Ordering**: `reportCells` + `assertQuantizedInvariants` run before `unquantizedPass` exists to contaminate them; both halves take counts as arguments | before pass B |
| R2 | Pass-B clear misses the zero-offset corridor (shared with pass A's quantized key) | flattering | the clear is built from `row.observed` and covers all `C × N` keys + fail keys; `unquantized === C × N` catches a survivor | at the assert |
| R3 | Two polls collapse onto one corridor (late ping, or jitter rounded to 3 dp) | flattering | pre-spend distinctness check in `unquantizedPass` throws naming both causes; `awaitPing` prevents the late-ping case at source | **before** pass B routes |
| R4 | Ping lands after the view → the page keys the previous poll's corridor | flattering | `awaitPing` polls `positionOf` (no view, no throttle, no paid call) until *this* poll's latitude is recorded; then the page-side check re-confirms | during the walk |
| R5 | Pass B routes a corridor space the page never keyed (wrong `to`, wrong `caller` namespace) | unattributable — self-consistent but meaningless | **the wrong-target detector**: every pass-A `cell` hash must appear among pass B's, via the always-present zero-offset poll. **Does NOT cover a drifted `routeCacheKey`** — both passes would drift together and the check still passes; that case is held by the key builder's own callers, not here. Vacuous at `POLLS_PER_CELL = 1` (both passes key the identical set) | at the assert |
| R6 | Jitter crosses the cell boundary → a cell pays twice | wrong (pass A too high) | boot guard on `POLLS_PER_CELL` (±0.0004° < 0.0005° half-cell) **and** the in-cell quantization assertion on every observed position | boot, then at the assert |
| R7 | Jitter rounded with `TRACKING_ETA_GRID_DECIMALS` instead of `COORD_PRECISION` | pessimistic (reduction reads 1×) | R3's pre-spend check fires first and names this cause explicitly; Level 4 control 5 makes 1× the *expected* output of a deliberate stub, so a real 1× is recognisable rather than mysterious | before pass B routes |
| R8 | Grid and corridor precision become equal → grid is an identity function again | pessimistic | boot guard `TRACKING_ETA_GRID_DECIMALS < COORD_PRECISION`, plus the CI spec case (the only guard that runs without a database) | boot / CI |
| R9 | Log interception broken → every count 0, reads as a triumphant pass | flattering, catastrophically | the existing positive control at `:516-522`, unchanged, still first | during the walk |
| R10 | Pass B swallows a source failure → short by one, blamed on the cache; the corridor is also negative-cached for the next run | flattering, and persistent | `maps.route` is deliberately un-`catch`ed in `unquantizedPass` | at the call |
| R11 | Pass B's 30 warm entries corrupt the next run | flattering on run 2 | run 2's pass-A pre-flight clears the cell centres (the one shared key per cell) and pass B re-clears its own; verified by Level 4 step 3, which is the only place a missed clear surfaces | run 2 |
| R12 | Level 4 exhausts the OTP budget mid-validation; a 429 reads as a script bug | wasted hour, not a wrong number | the sequence is 4 of 5 requests/hour with the no-spend guard checks moved first and the cooldown stated | before validation |
| R13 | The plan's own `6 / 30 / 5×` get copied into the report or PR body as observed | **the exact defect of #87 and #107** | they are labelled `expected` in this plan; the completion checklist requires re-derivation from the run's output; the summary prints nothing as a literal | at review |

### What this still does not measure

The crossing **rate** (heading-dependent — the heading block at `:774-785` says so and stays), in-flight
coalescing (open, #13/#16), and any real-money hit rate (`StubMapsProvider`). The reduction this run observes
is the cost of *this walk at this dwell*, not a per-minute spend figure — `notifications.policy.ts:41-46` has
the moving-driver case and it is ~2×, not 5×. Keep those two numbers visibly distinct in the PR body; they
describe different cases and a reader who conflates them gets the same wrong picture #87 shipped.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. -->

### 2026-08-14 — AC #9's step-5 prediction is retired; R3 supersedes it

AC #9 asks for "step 5's result (pass B = 6, 1×) recorded in the report as the control it is". **Step 5 cannot
produce that result, and this plan is internally inconsistent here.** Forcing `jitterSteps → 0` collapses all
`C × N` polls onto `C` corridors, and R3 — specified by this same plan and deliberately ordered *before* pass B
spends — refuses the pass first. R3 wins by construction, and that is R3 working.

AC #9 is therefore met with this amendment rather than as written: step 5's recorded result is R3's refusal,
which discharges the control's purpose (prove the jitter is load-bearing) at least as well as a 1× would, and
additionally shows the instrument declining to print a flattering number. The `pass B = 6, 1×` figure is real
and is recorded in the report under the run that actually produced it — `MINT_POLLS_PER_CELL=1`, the degenerate
edge case, via a path R3 correctly leaves alone. The figure was right; the control it was attached to was not.

### 2026-08-14 — the Level 3 short-gate figure was inherited, and wrong

The VALIDATION COMMANDS section said "five Redis-backed suites `describe.skip`", copied from `CLAUDE.md:46`
without re-derivation — the inheritance failure this ticket exists to close, committed in this ticket's own
plan. Measured: **2 suites / 24 tests**. Corrected in place. `CLAUDE.md:46` carries the same stale figure and
needs a docs commit of its own.
