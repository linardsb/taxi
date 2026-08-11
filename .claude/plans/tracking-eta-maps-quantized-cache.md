# Feature: Maps-based ETA for the tracking page (quantized cache)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

The no-login live-tracking page (#63) currently shows a documented v1 ETA: straight-line haversine metres ÷ 417 m/min, computed in `notifications.policy.ts`. This ticket routes that ETA through the `MAPS_PROVIDER` seam so it reflects real road routing — with the driver's position **quantized to a ~100 m grid before the route call**, so the 5 s page poll keeps hitting the `CachingMapsProvider` cache instead of producing a paid Google call per poll. The haversine estimate stays as the fallback when the maps call fails.

## User Story

As a rider (or family member / sighted assistant) watching the tracking page
I want the ETA to reflect actual road routing, not straight-line distance
So that "arriving in ~4 min" matches when the car actually pulls up

## Problem Statement

The v1 ETA is deliberately crude (a city-speed constant over straight-line distance) because a paid route call per 5 s poll would destroy the <€100/mo budget guardrail. Crude ETAs over Rīga's river/rail barriers can be badly wrong (Daugava crossings: 500 m straight-line can be a 3 km drive). The upgrade path was sketched in the policy file's own comment: maps seam + quantized-coordinate cache.

## Solution Statement

In `TrackingService.view()`, replace the direct `estimateEtaMinutes()` call with a maps-seam route call whose **origin is the driver's position rounded to 3 decimal places** (~111 m lat × ~61 m lng at Rīga's latitude — the "~100 m grid"). `routeCacheKey` renders coordinates at 4 decimals (`toFixed(4)`), so every raw position inside a grid cell produces the *identical* cache key — a moving driver triggers a paid call only when they cross into a new cell (~8.9 s apart on average at city speed — the cell is anisotropic, ~16 s due N/S but ~7.7 s on the worst heading — against a 5 s poll, so ~2×). A hostile rapid poller cannot **aim** spend, because both ends of the key are server-side; it can still **cause** spend, because the cache has no in-flight coalescing and never caches failures. The route's `durationSeconds` becomes the ETA (`max(1, ceil(s/60))` — the "never ~0 min" policy survives). On any maps failure, fall back to the existing haversine estimate and log a structured warn. The page's displayed `position` stays the **raw** recorded position — quantization is for the cache key only, the map must show the real car.

## Out of Scope / Non-Goals

- **Not changing the assigned-SMS ETA** (`ride-notifications.service.ts:139` `etaToPickup`) — it keeps the haversine estimate. It is one-shot per ride (not polled), the ticket names only the tracking page, and touching it would widen the SMS templates' blast radius. Flagged in Open Questions as a possible follow-up.
- **Not changing `CachingMapsProvider`, `routeCacheKey`, or `COORD_PRECISION`** — quantization happens at the call site, because the cache is shared with pricing, where degrading input precision costs fare accuracy (the `COORD_PRECISION` docblock's explicit trade-off).
- **Not binding a real Google provider** — that stays #13/#16. Dev/test still run `StubMapsProvider` through the real cache.
- **Not adding rate limiting to `GET /track/:token`** — deferred to the maps-seam hardening follow-up (with the negative cache), due before a real provider is bound. The original rationale here — "quantization already bounds paid spend structurally" — was wrong and is corrected in Solution: quantization bounds the ordinary moving-driver case, not the hostile one. Nothing is at risk while `StubMapsProvider` is the only bound source, which is what makes deferring it safe rather than merely cheap.
- **Not touching `packages/shared`** — `TrackingView.etaMinutes` is unchanged on the wire; no contract moves.

## Feature Metadata

**Feature Type**: Enhancement
**Estimated Complexity**: Low–Medium
**Primary Systems Affected**: `services/api` — notifications slice (tracking sub-slice), test harness
**Dependencies**: none new — existing `MAPS_PROVIDER` seam, `GeoModule`, `CachingMapsProvider`

## Related Work

**Implements**: GitHub issue #87 (`Closes #87` on the PR) · **Epic**: follow-up from #63 (Part of epic #1); inherits #63's constraints (budget guardrail, no-PII page, poll-based v1) and the architecture's maps-seam decision (`docs/epics/sakta-cab.architecture.md`)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/rider-comms-sms-tracking-page.md` — Why: created the tracking slice, the ETA policy, and the "upgrade path" comment this ticket executes
- `.claude/plans/api-rides-pricing.md` — Why: created the `MAPS_PROVIDER`/`MAPS_PROVIDER_SOURCE` split and `CachingMapsProvider`, whose cache-key precision this design leans on

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `services/api/src/features/notifications/notifications.policy.ts` — Why: the file being extended; lines 12–18 (the speed constant + upgrade-path comment to rewrite), 45–72 (slice-local haversine + `estimateEtaMinutes`, which stays as the fallback)
- `services/api/src/features/notifications/tracking/tracking.service.ts` — Why: the one call site; lines 88–123 (driver card + position + ETA block), 141–150 (`denied()` — the slice's structured-warn pattern to mirror for the fallback log)
- `services/api/src/features/notifications/notifications.module.ts` — Why: module to wire `GeoModule` into; its docblock documents each import's reason — follow that convention for the new one
- `services/api/src/features/geo/caching-maps.provider.ts` — Why: lines 11–38 — `COORD_PRECISION = 4` and `routeCacheKey`'s `toFixed(4)` rendering are what make 3-decimal quantization cache-stable; do NOT modify this file
- `services/api/src/features/geo/geo.module.ts` + `maps.tokens.ts` + `index.ts` — Why: `MAPS_PROVIDER` is the cached facade token to inject; the barrel is the only sanctioned import path (`import { MAPS_PROVIDER } from '../../geo'`)
- `services/api/src/features/pricing/pricing.service.ts` (lines 26–46) — Why: the existing consumer pattern — `@Inject(MAPS_PROVIDER) private readonly maps: MapsProvider` with `MapsProvider` type from `@taxi/shared`
- `services/api/src/features/geo/stub-maps.provider.ts` — Why: dev/test route maths (haversine × 1.35 detour at 40 km/h) — tests compute expected ETAs from these constants
- `services/api/test/harness.ts` (lines 242–268 `CountingMapsProvider`, 276–316 `RecordingPaymentsProvider`) — Why: the counting fake to extend; `RecordingPaymentsProvider.failNext()` is the exact failure-injection pattern to mirror
- `services/api/src/features/notifications/tracking/tracking.integration.spec.ts` — Why: the spec to extend — phone range registry (`+371280`), `onlineDriver`/`bookByPhone`/`acceptBy`/`view` helpers, `ctx.locations.record` for moving the driver
- `services/api/src/features/notifications/notifications.repository.ts` (lines 17–27) — Why: `NotifiableRide` has `id` and `driverId` — available for the fallback log
- `packages/shared/src/seams/maps-provider.ts` — Why: `RouteResult` shape (`durationSeconds`) the new policy helper consumes
- `.claude/references/logging-standard.md` — Why: event naming `domain.component.action_state`; **never log coordinates** ("addresses beyond geozone name")

### New Files to Create

- `services/api/src/features/notifications/notifications.policy.spec.ts` — unit tests for the two new pure policy functions (the slice currently has no policy spec; tests-mirror-slices says it sits next to the policy file, like `ride-notifications.service.spec.ts` does)

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `services/api/CLAUDE.md` — the maps-seam rules: consumers inject `MAPS_PROVIDER`, tests override the **source** so the cache stays under test; "the count assertion is the <€100/mo guardrail"
- No external docs needed — no new libraries, no real provider.

### Patterns to Follow

**Consumer injection** (from `pricing.service.ts:26–31`):

```ts
constructor(
  @Inject(MAPS_PROVIDER) private readonly maps: MapsProvider,
  ...
)
```

**Structured warn in this slice** (from `tracking.service.ts:141–150`):

```ts
this.logger.warn({
  event: 'ride.notifications.track_view_denied',
  tokenPrefix: token.slice(0, 4),
  reason,
  at: new Date().toISOString(),
});
```

**Failure injection on a harness fake** (from `RecordingPaymentsProvider`): `failNext()` arms exactly one failure, self-clearing, with a `reset()`-style comment explaining why self-clearing matters (a leaked armed failure fails the *next* test, one case late).

**Policy docblocks**: every constant in `notifications.policy.ts` carries a paragraph saying *why the number is what it is* — the new grid constant must too (the ~111 m × ~61 m arithmetic, and why 3 decimals given `COORD_PRECISION = 4`).

---

## IMPLEMENTATION PLAN

Sequential — each phase builds on the previous; no parallel phases worth annotating at this size.

### Phase 1: Policy helpers (pure functions)

Add quantization + route→minutes conversion to `notifications.policy.ts`; retire the "upgrade path: later ticket" wording (this IS that ticket) and re-document the speed constant as the fallback.

### Phase 2: Service + module wiring

Inject `MAPS_PROVIDER` into `TrackingService`, route the ETA through it with try/catch fallback, import `GeoModule` in `NotificationsModule`.

### Phase 3: Test harness failure injection

`CountingMapsProvider.failNext()` so the integration spec can force the fallback path.

### Phase 4: Tests & validation

Unit tests for the pure helpers; three integration cases (maps-derived ETA, cache-hit-through-quantization guardrail, failure fallback); full gate.

---

## STEP-BY-STEP TASKS

### UPDATE `services/api/src/features/notifications/notifications.policy.ts`

- **IMPLEMENT**: three additions + one docblock rewrite:
  1. `export const TRACKING_ETA_GRID_DECIMALS = 3;` — docblock: ~111 m lat × ~61 m lng at Rīga's ~57°N ≈ the ticket's "~100 m grid"; must stay **coarser** than `CachingMapsProvider`'s `COORD_PRECISION = 4` (`toFixed(4)` renders a 3-decimal input as identical key text, so every raw position in a cell shares one cache entry — that is the entire point).
  2. `export function quantizeForEtaCache(point: LatLng): LatLng` — `{ lat: Number(point.lat.toFixed(TRACKING_ETA_GRID_DECIMALS)), lng: Number(point.lng.toFixed(TRACKING_ETA_GRID_DECIMALS)) }`.
  3. `export function etaMinutesFromRoute(route: RouteResult): number` — `Math.max(1, Math.ceil(route.durationSeconds / 60))`; docblock: same "never 0 min" policy as `estimateEtaMinutes` (line 66).
  4. Rewrite the `TRACKING_ETA_SPEED_METERS_PER_MINUTE` docblock (lines 12–17): it is no longer "deliberately NOT a maps call … upgrade path … later ticket" — it is now the **fallback** (maps call failed on the page) and the assigned-SMS estimate (`etaToPickup`, out of scope here). Keep `estimateEtaMinutes` and the slice-local haversine untouched.
- **IMPORTS**: add `type RouteResult` to the existing `@taxi/shared` type import.
- **GOTCHA**: do NOT import from `features/geo` here — the policy file stays dependency-free (its haversine docblock explains the slice-local discipline).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, #2

### CREATE `services/api/src/features/notifications/notifications.policy.spec.ts`

- **IMPLEMENT**: pure unit tests, no Nest boot:
  - `quantizeForEtaCache`: expected — `{lat: 56.9612349, lng: 24.0857}` → `{lat: 56.961, lng: 24.086}`; edge — a 3-decimal-exact point maps to itself; edge — two points ~20 m apart (`56.96121` vs `56.96139`) quantize identically (the cache-stability property itself).
  - `etaMinutesFromRoute`: expected — `{durationSeconds: 300}` → 5; edge — `90` → 2 (ceil); failure-shape — `0` → 1 (never-zero policy).
- **PATTERN**: plain describe/it like other api unit specs; construct `RouteResult` literals (`polyline: ''`, `distanceMeters: 0` where irrelevant).
- **VALIDATE**: `pnpm --filter @taxi/api test notifications.policy` (no Docker needed — pure functions)
- **SATISFIES**: AC #4 (≥1 expected + 1 edge + 1 failure at unit level)

### UPDATE `services/api/test/harness.ts`

- **IMPLEMENT**: add failure injection to `CountingMapsProvider` (mirror `RecordingPaymentsProvider.failNext`, lines 280–283):
  ```ts
  private nextFailure: Error | null = null;

  /** Fails the NEXT route() only, then reverts — a leaked armed failure
   *  would fail the next test's call one case late. Counted anyway: a real
   *  failed Routes call is still an attempted paid call. */
  failNext(error = new Error('test maps outage')): void {
    this.nextFailure = error;
  }
  ```
  In `route()`, after incrementing `routeCalls` and pushing to `routed`: if `nextFailure` is set, clear it and `return Promise.reject(error)`.
- **GOTCHA**: `CachingMapsProvider` sits ABOVE this fake — an armed failure only fires on a cache **miss**. Tests must move the driver to a never-routed grid cell before arming, or the cache answers and the armed failure leaks into the next call. Say this in the docblock.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3 (testability)

### UPDATE `services/api/src/features/notifications/tracking/tracking.service.ts`

- **IMPLEMENT**:
  1. Inject the seam: `@Inject(MAPS_PROVIDER) private readonly maps: MapsProvider` in the constructor.
  2. Replace line 120 (`etaMinutes = estimateEtaMinutes(recorded.location, target);`) with a call to a new private method, e.g. `etaMinutes = await this.roadEta(ride, recorded.location, target);`
  3. New private method:
     ```ts
     /** Road ETA through the maps seam. The origin is quantized to the
      *  ~100 m grid (policy) so the 5 s poll hits the route cache — a paid
      *  call happens only when the driver crosses a cell, never per poll.
      *  The displayed position stays raw; only the route origin is snapped. */
     private async roadEta(ride: NotifiableRide, from: LatLng, target: LatLng): Promise<number> {
       try {
         const route = await this.maps.route(quantizeForEtaCache(from), target);
         return etaMinutesFromRoute(route);
       } catch (error) {
         this.logger.warn({
           event: 'ride.notifications.track_eta_fallback',
           rideId: ride.id,
           driverId: ride.driverId,
           message: error instanceof Error ? error.message : String(error),
           at: new Date().toISOString(),
         });
         return estimateEtaMinutes(from, target);
       }
     }
     ```
- **PATTERN**: injection — `pricing.service.ts:27`; warn shape — `denied()` in this same file.
- **IMPORTS**: `MAPS_PROVIDER` from `'../../geo'` (the barrel, never a deep path); `type MapsProvider`, `type LatLng` from `'@taxi/shared'`; `quantizeForEtaCache`, `etaMinutesFromRoute` added to the existing `'../notifications.policy'` import; `type NotifiableRide` from `'../notifications.repository'`.
- **GOTCHA (logging)**: no coordinates in the log — `logging-standard.md` forbids anything finer than a geozone name. `rideId`/`driverId`/`message` only.
- **GOTCHA (fallback input)**: the fallback uses the **raw** position (accuracy costs nothing there — no cache in that path).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #1, #2, #3

### UPDATE `services/api/src/features/notifications/notifications.module.ts`

- **IMPLEMENT**: add `GeoModule` to `imports: [DriversModule, PlatformConfigModule, GeoModule]`; extend the docblock's import inventory with one line — `GeoModule` supplies `MAPS_PROVIDER` for the tracking page's road ETA (#87).
- **IMPORTS**: `import { GeoModule } from '../geo';`
- **GOTCHA**: nothing else — `GeoModule` needs no forwardRef (no cycle: geo imports nothing from notifications), and `KV_STORE` resolves via the global `KvModule`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/geo/index.ts`

- **IMPLEMENT**: one-line docblock touch — the injector inventory ("#10 injects `MAPS_PROVIDER` for driver→pickup ETAs and #5 (pricing) for route legs") now also names the tracking page's road ETA (#87). Keep the KNOWN GAPS block as-is.
- **VALIDATE**: `pnpm --filter @taxi/api lint`
- **SATISFIES**: doc honesty (module's own "lie about ownership" rule)

### UPDATE `services/api/src/features/notifications/tracking/tracking.integration.spec.ts`

- **IMPLEMENT**: three new `it` blocks (helpers `onlineDriver`, `bookByPhone`, `acceptBy`, `view`, and `ctx.locations.record` / `ctx.maps` already exist). Rider/driver numbers continue the `+371280` range past the ones in use (next free: driver 3+, rider 55+).

  1. **Expected — ETA is maps-derived and the route origin is quantized**: book + accept with the driver near pickup (the dispatch radius needs that), then `ctx.locations.record` the driver at a far, non-3-decimal-exact point, e.g. `{lat: CENTRE_PICKUP.location.lat + 0.0504, lng: CENTRE_PICKUP.location.lng + 0.0007}` (~5.6 km out). `view(token)` and assert:
     - `ctx.maps.routed.at(-1)!.from` deep-equals the 3-decimal quantized point (proves seam call + quantization), and `.to` equals the exact pickup;
     - `etaMinutes` equals the value computed inline from the stub's documented maths (haversine × 1.35 detour at 40 km/h, `Math.round` at each step per `stub-maps.provider.ts:41–44`, then `max(1, ceil(s/60))`) — at ~5.6 km this is **distinct from** the haversine÷417 fallback value, so the assertion can't pass for the wrong reason (at short range both formulas give 1).
  2. **Edge — the guardrail: a sub-cell move is a cache hit, a cell crossing is one paid call**: from the state above, snapshot `const calls = ctx.maps.routeCalls`; move the driver ~+0.0002 lat (~22 m, same cell); `view()` → assert `ctx.maps.routeCalls === calls` (cache absorbed the poll) AND the returned `position.lat` reflects the **new raw** coordinate (`toBeCloseTo(..., 4)` — display is not quantized); move +0.001 lat (next cell); `view()` → assert `ctx.maps.routeCalls === calls + 1`.
  3. **Failure — maps outage falls back to the haversine estimate**: move the driver to a fresh cell (never routed in this suite — the in-memory KV persists across tests in the file), `ctx.maps.failNext()`, `view()` → expect 200, `state` intact, and `etaMinutes` equal to `Math.max(1, Math.ceil(haversineMetres / 417))` computed inline for that geometry (at ~5.6 km ≈ 14, again distinct from the maps value).
- **GOTCHA (counts)**: `routeCalls` is **never asserted absolutely** — every booking's pricing quote also routes through the same counter. Deltas only.
- **GOTCHA (shared cache)**: one `InMemoryKeyValueStore` serves the whole spec file; every test that needs a cache **miss** must use coordinates no earlier test's quantized cell produced.
- **VALIDATE**: `docker compose up -d --wait && pnpm --filter @taxi/api test tracking.integration`
- **SATISFIES**: AC #1, #2, #3, #4

### Full gate

- **VALIDATE**: `pnpm turbo run typecheck lint test build --force`
- **GOTCHA**: set `REDIS_TEST_URL` (port 6381 locally) or the Redis-backed suites `describe.skip` and the gate is five tests short of CI parity. Run from the repo root.
- **SATISFIES**: AC #5

---

## TESTING STRATEGY

### Unit Tests

`notifications.policy.spec.ts` — the two new pure functions, no Nest/DB. Grid rounding (including the two-points-one-cell property that IS the design), ceil/never-zero minutes.

### Integration Tests

Extend `tracking.integration.spec.ts` (real Nest graph, real `CachingMapsProvider` over the harness's `CountingMapsProvider` source — the sanctioned arrangement per `geo.module.ts`'s docblock). The three cases above map exactly to the repo's ≥1 expected + 1 edge + 1 failure rule; the cache-hit delta assertion is this ticket's <€100/mo guardrail in code.

### Edge Cases

- Sub-cell driver movement between polls → zero new source calls (the headline property).
- Cell-boundary crossing → exactly one new source call.
- `durationSeconds` < 60 or = 0 → ETA clamps to 1 (kerb-adjacent driver).
- Maps outage → page still 200, haversine ETA, structured warn, no coordinates in the log.
- Displayed `position` is raw even while the route origin is quantized.
- Existing suite (searching / terminal / expired / 404 paths) must stay green — those paths never reach the maps call (position gate at `tracking.service.ts:99` unchanged).

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/api typecheck
pnpm --filter @taxi/api lint
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/api test notifications.policy
```

### Level 3: Integration Tests

```bash
docker compose up -d --wait
pnpm --filter @taxi/api test tracking.integration
```

### Level 4: Manual Validation

```bash
pnpm --filter @taxi/api dev
# book a phone ride via the service path or reuse an existing dev ride's token, then:
curl -s localhost:3000/track/<token> | jq '.etaMinutes, .position'
# poll twice within 5 s — server logs must show no second route call (cache hit)
```

### Level 5: Full gate (CI parity)

```bash
REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force
```

---

## ACCEPTANCE CRITERIA

- [ ] AC #1 — Tracking-page ETA comes from `MAPS_PROVIDER.route()` via the real `CachingMapsProvider`, with the driver origin quantized to the ~100 m grid; target (pickup pre-start, destination in-progress) unchanged.
- [ ] AC #2 — A driver moving within one grid cell across polls produces **zero** additional source route calls (delta-asserted in the integration spec); displayed position stays raw.
- [ ] AC #3 — A maps-call failure degrades to the haversine estimate: page answers 200, ETA present, `ride.notifications.track_eta_fallback` warn logged without coordinates.
- [ ] AC #4 — ≥1 expected + 1 edge + 1 failure test at both unit (policy) and integration (page) level; existing tracking suite untouched and green.
- [ ] AC #5 — `pnpm turbo run typecheck lint test build --force` green with `REDIS_TEST_URL` set; no changes to `packages/shared`, `CachingMapsProvider`, or the SMS ETA path.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Assumption: 3 decimal places = the ticket's "~100 m grid".** At Rīga (~57°N) a 3-decimal cell is ~111 m × ~61 m. The next options are strictly worse: 4 decimals (~11 m) is the cache key's own precision (no extra hits gained), 2 decimals (~1.1 km × 0.6 km) makes the ETA visibly wrong near the kerb.
- **Assumption: only the route origin is quantized.** The target is the ride's fixed pickup/destination — identical on every poll already, so quantizing it buys nothing and costs accuracy.
- **Open (non-blocking): the assigned-SMS ETA** (`etaToPickup`) still uses the haversine. One maps call per acceptance would be near-free (the page polls warm the same corridor) — left out because the ticket scopes to the tracking page; candidate follow-up ticket.
- **Open (non-blocking): TTL staleness.** A cached corridor's `durationSeconds` can be up to `MAPS_ROUTE_CACHE_TTL_SECONDS` (24 h in `.env.example`) old, so rush-hour ETAs ride on off-peak routes. Inherited pricing-cache policy; revisit when a real provider and a real bill exist.

## NOTES (open canvas)

**Why quantize at the call site instead of inside `CachingMapsProvider`:** the cache is shared with pricing, and pricing's `COORD_PRECISION = 4` docblock explicitly prices the precision/hit-rate trade-off in cents of fare accuracy. A cache-level ~100 m snap would silently degrade quotes. Call-site quantization keeps the blast radius exactly one consumer.

**Spend arithmetic (why this satisfies the guardrail):** page polls every 5 s (12/min); at the policy's own 25 km/h city average (417 m/min) a driver crosses a ~100 m cell at a rate that depends on heading, because the cell is ~111 m of latitude × ~61 m of longitude at 57°N:

| Heading | Crossings/min | One per |
|---|---|---|
| Due N/S | 417/111 = 3.8 | ~16 s |
| Due E/W | 417/61 = 6.8 | ~8.8 s |
| Worst (~61° off N) | √(3.8² + 6.8²) = 7.8 | **~7.7 s** |
| Mean over uniform heading | (2/π)(3.8 + 6.8) = **6.8** | ~8.9 s |

So ~6.8 paid calls/min/active ride against 12/min unquantized — a **~2× reduction for a moving driver**, not the ~3× an unqualified "~15 s" implies (that is the due-N/S best case). Each cell's result is still shared by every watcher of that ride (share-trip #17) and by the SMS corridor.

The bigger win is not in this table: a **stationary or slow** driver — at the kerb, in `arrived`, in traffic — otherwise mints a fresh 4-decimal key on nearly every poll indefinitely, because raw GPS jitter of ±10–20 m moves the 4th decimal. Quantization collapses that to the 1–4 cells the jitter spans, all cached after first visit. That case is unbounded without this change and bounded with it, which is a stronger argument than the moving-driver ratio.

**Hostile polling is *not* bounded to zero** (corrected — the original claim here was wrong). Both ends of the key are server-side, so a caller cannot *aim* spend at a key of its choosing. It can still *cause* spend: `CachingMapsProvider.route()` is get → miss → `inner.route()` → `setWithTtl` with no in-flight coalescing, so a concurrent burst into an un-warmed cell costs one source call per request; and a rejected `inner.route()` writes nothing, so during a provider outage every poll from every viewer reaches the source. The controls are a token-scoped throttle and a negative cache, deferred to the seam-hardening follow-up — see the rate-limiting note in NOT DOING. `StubMapsProvider` is the only bound source until then, so no money is at risk in the interim.

**Rejected: skipping the maps call when the fallback would say the same thing** (e.g. <300 m). Cute, saves pennies, adds a branch whose threshold is a new magic number — KISS says no.

**Rejected: a per-ride ETA memo (token → eta, short TTL) in front of the seam.** Double-caching; the quantized route cache already collapses the poll storm, and a second cache adds a second staleness knob.

**Test-number bookkeeping:** the spec file's phone range is `+371280` (registered in the range comment at `ride-lifecycle.integration.spec.ts`); drivers 1–2 and riders 50–54 are taken — new tests start at driver 3 / rider 55.

## AMENDMENTS

