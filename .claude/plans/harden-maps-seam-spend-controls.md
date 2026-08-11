# Feature: harden the maps seam before a real provider is bound (#94)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Six deferred findings from the [PR #93 review](https://github.com/linardsb/taxi/pull/93), all on the `MapsProvider` seam (`services/api/src/features/geo/`), shipped as one slice because they are the same job: the #87 docblocks justified themselves with the `<€100/mo` guardrail, but the running system **cannot measure paid-call volume at all**. The spend controls and the instrumentation that would prove they work are inseparable.

Nothing here is at risk today — `StubMapsProvider` is the only bound source and `mapsProviderSourceFactory` throws under `NODE_ENV=production`. All of it goes live the moment Google Routes is bound (#13/#16), which is what this ticket blocks.

The work splits into three groups plus one optional rename:

**Spend controls** — a token-scoped throttle on `GET /track/:token`, and a negative cache on the seam so a provider outage stops costing a paid call per poll per viewer.

**Observability** — a miss-path structured log (`geo.maps.route_fetched`) so paid calls are countable in production, attributed to a caller. Today the only counter that exists is `CountingMapsProvider` in `test/harness.ts`, which never runs in production.

**Seam robustness** — a timeout (so a hung Routes call cannot hang a request on a public, no-login page), sanitized error logging (so a provider message can never echo coordinates into a log line), and a duration-appropriate TTL for the tracking consumer.

## User Story

As the operator of Sakta Cab
I want the maps seam to bound its own spend, log what it spends, and fail fast rather than hang
So that binding a real (paid) Google Routes provider cannot quietly turn a €100/mo budget into a €400 bill, or degrade every ETA on the platform with no signal that it happened.

## Problem Statement

`CachingMapsProvider` is the only thing standing between the platform and a metered Google Routes bill, and it has five gaps that are invisible while the stub is bound:

1. **No in-flight coalescing.** `route()` is get → miss → `inner.route()` → `setWithTtl`. Every request arriving before the first `setWithTtl` lands also misses and also reaches the source. Quantization does not close this — both key ends are server-side, so a caller cannot *aim* spend, but it can still *cause* it.
2. **Failures are never cached.** `caching-maps.provider.ts:99` writes nothing when `inner.route()` rejects, so during a provider outage *every* 5 s poll from *every* viewer of *every* active ride reaches the source. A throttle does **not** close this: those calls come from legitimate viewers each polling within their own limit, so N viewers still produce N×12 upstream calls per minute.
3. **No instrumentation.** `features/geo/` has no `Logger`, no counter, no metric. The #87 plan's Level 4 manual validation ("poll twice within 5 s — server logs must show no second route call") **cannot be performed as written**, and every spend problem above is invisible in production rather than merely undocumented.
4. **No timeout.** `roadEta`'s `catch` covers a *rejected* promise only. A hung Routes call hangs a request on `GET /track/:token` — public, no-login, and polled every 5 s. It compounds gap 1: a hang yields no fallback *and* no rate limit.
5. **Raw provider messages reach log lines.** `tracking.service.ts:185` logs `error.message` verbatim. A real provider could echo origin coordinates into a line `.claude/references/logging-standard.md:14` forbids. The existing key-set assertion in `tracking.integration.spec.ts:698-704` **cannot** catch this, because the coordinate would be *inside* `message`.

Plus one live contract mismatch, which is the sharpest case in the whole ticket:

6. **`RouteResult.durationSeconds` is a plain `number`** (`packages/shared/src/seams/maps-provider.ts:12`) but `routeResultSchema` requires `.int()` (`caching-maps.provider.ts:47`). A real Routes adapter returning `1187.4` would type-check, throw at the cache's write-path `parse()` on **every** call, be swallowed by `roadEta`'s catch, and silently degrade **every ETA on the platform to haversine permanently** — while the page kept answering 200. The only signal would be a warn that nothing counts.

And one TTL whose meaning changed under it:

7. **`MAPS_ROUTE_CACHE_TTL_SECONDS=86400` was inherited from pricing**, which consumes `distanceMeters` (near time-invariant). The tracking page consumes `durationSeconds` (`notifications.policy.ts:127`) — exactly the field traffic moves — so an 08:30 rush-hour page can be served from an 02:00 off-peak route on the same key.

## Solution Statement

**Bind two `CachingMapsProvider` instances instead of one**, each with its own token, caller label, key namespace and TTL:

| Token | Caller label | Key namespace | TTL | Consumer |
|---|---|---|---|---|
| `MAPS_PROVIDER` (existing) | `quote` | `maps:route:v1:quote:…` | `MAPS_ROUTE_CACHE_TTL_SECONDS` (86400) | `PricingService` |
| `MAPS_PROVIDER_ETA` (new) | `eta` | `maps:route:v1:eta:…` | `MAPS_ETA_CACHE_TTL_SECONDS` (300) | `TrackingService` |

This one change carries four of the seven findings at once, and it is **~15 lines in `geo.module.ts` plus a one-line import swap in `tracking.service.ts`**:

- The miss-path log gets its `caller` field with **zero cross-surface contract churn** — no optional 4th param on `MapsProvider.route()` in `packages/shared`, no consumer audit.
- The TTL split becomes **structural** rather than probabilistic. A shared key namespace would let a pricing write pin a tracking read to 24 h staleness; separate namespaces make that impossible.
- `caller` is construction-time configuration, not per-call data — both consumers have exactly one call site each (`pricing.service.ts:42`, `tracking.service.ts:176`) and neither needs runtime variation. Verified, not assumed.
- Namespace splitting loses no real hits: pricing routes a raw 4-decimal pickup→destination; tracking routes a 3-decimal-snapped origin→pickup/destination. They coincide only by accident.

On top of that, inside `CachingMapsProvider`:

- **Negative cache** under a sibling key (`maps:route:fail:v1:<caller>:<points>`), **for the `eta` caller only** — `MAPS_ETA_FAILURE_TTL_SECONDS` (60 s), while `quote` passes `0` and does not negative-cache at all. Poll amplification is the tracking page's problem; on the booking path a cached failure would block real bookings for a minute after one transient blip, and spend there is already capped by `RIDE_REQUEST_MAX_PER_WINDOW`. Reasoned in full in NOTES. When enabled, the fail key is read together with the hit in one `Promise.all`, so the miss path costs one round trip, not two. A cached *success* always wins over a cached failure.
- **Timeout** via `Promise.race` against `MAPS_ROUTE_TIMEOUT_MS` (3000, `.max(30_000)` in the schema). This bounds **latency, not spend** — the upstream HTTP call keeps running and still bills. It belongs to seam robustness, not spend control.
- **Round on the write path** before `parse()`, closing finding 6 structurally. A fractional `1187.4` becomes `1187` and the platform degrades nothing; `parse()` still rejects NaN, negatives, missing fields and wrong types. `packages/shared`'s seam docblock is tightened to say whole units, but its **types do not change** (TypeScript cannot express an integer anyway).
- **Structured logs** `geo.maps.route_fetched` / `geo.maps.route_failed`, carrying `caller`, a `cell` correlation hash of the key, and a closed-enum `reason` — **never** a provider's free-text message, anywhere. That is structurally impossible to regress, unlike a regex scrubber.

And in the notifications slice: a token-scoped throttle mirroring `rides.service.ts:288-311`, applied *after* shape validation and *before* the database read.

## Out of Scope / Non-Goals

- **Not included: in-flight request coalescing.** The throttle *bounds* the concurrent-burst path; it does not *close* it. Closing it needs a single-flight map or a Redis lock. Say "bounds", never "closes" — this repo just shipped `docs(api): correct the paid-call claims the #87 docblocks overstate` and must not recreate that overstatement. Defer to the ticket that binds the real provider (#13/#16), where the true concurrency shape is measurable.
- **Not included: a real Google Routes provider.** This ticket is the hardening that *precedes* #13/#16. `StubMapsProvider` stays bound; `mapsProviderSourceFactory` keeps throwing in production.
- **Not included: 404-spam protection.** An attacker can mint unlimited shape-valid 22-char tokens, so a token-scoped throttle bounds polling of a *known* ride only. The docblock must not claim it protects the database read.
- **Not included: the assigned-SMS ETA** (`etaToPickup` in `ride-notifications.service.ts`). Still haversine, one-shot per ride, not polled — the #87 plan's open thread, and still open.
- **Not included: a metrics backend / Prometheus counter.** The log line is the counter for the pilot; a scrape target is a separate concern.
- **Not changing:** `quantizeForEtaCache` and the ~100 m grid, `COORD_PRECISION = 4`, the fallback-to-haversine behavior, the tracking view schema, or any rider-facing wire shape.

## Feature Metadata

**Feature Type**: Enhancement (hardening / observability)
**Estimated Complexity**: Medium
**Primary Systems Affected**: `services/api/src/features/geo` (the seam), `services/api/src/features/notifications/tracking` (the consumer + throttle), `services/api/src/common/config/env.schema.ts` (3 new vars), `packages/shared/src/seams/maps-provider.ts` (docblock only)
**Dependencies**: None new. Uses existing `KeyValueStore` (`incrWithTtl`, `ttl`, `setWithTtl`, `get`), `@nestjs/common` `Logger`/`HttpException`, `node:crypto`.

## Related Work

**Implements**: [#94](https://github.com/linardsb/taxi/issues/94) — `Closes #94` on the PR.   ·   **Epic**: none — #94 is a standalone follow-up set, not part of an epic. No inherited engineering plan.

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/tracking-eta-maps-quantized-cache.md` (#87) — Why: this ticket is that plan's deferred remainder. Its AC #3 pins the string `ride.notifications.track_eta_fallback`, renamed here (see AMENDMENTS task). Its Open Questions already named the TTL-staleness thread this closes.
- `.claude/plans/rider-comms-sms-tracking-page.md` (#63) — Why: created `GET /track/:token`, the `@Public()` no-login route this throttles.
- `.claude/plans/api-rides-idempotency.md` — Why: the `incrWithTtl` throttle pattern (`rides.service.ts:288-311`) mirrored here, and `RIDE_IDEMPOTENCY_PENDING_TTL_SECONDS`, whose docblock this ticket makes true.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- #13/#16 (bind the real Google Routes provider) — this ticket is its stated blocker. Two threads land there: in-flight coalescing, and the provider adapter owning its own sanitized error detail (HTTP status etc.), which this plan deliberately does not invent.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `services/api/src/features/geo/caching-maps.provider.ts` (whole file, 119 lines) — Why: the file most of this ticket edits. Note `routeCacheKey` at 26-38 (exported, used by the spec), the write-path `parse()` at 102, and the un-cached rejection at 99.
- `services/api/src/features/geo/geo.module.ts` (whole file) — Why: where the second instance is bound. `mapsProviderSourceFactory` at 17-24 stays untouched.
- `services/api/src/features/geo/maps.tokens.ts` (whole file) — Why: token declarations + the docblocks explaining why the SOURCE has its own token.
- `services/api/src/features/geo/index.ts` — Why: the slice's public API. The new token is exported here or nothing outside can inject it.
- `services/api/src/features/notifications/tracking/tracking.service.ts` (lines 63-89 for the `view()` guard order, 150-192 for `roadEta` + the docblock that becomes false, 194-203 for the `denied()` log shape to mirror) — Why: the throttle's insertion point and the log to sanitize.
- `services/api/src/features/rides/rides.service.ts` (lines 285-311, `assertWithinRateLimit`) — Why: **the exact pattern to mirror.** INCR-then-check (a GET-then-INCR would let a burst all read the same count), `Math.max(1, await this.kv.ttl(key))`, `HttpException({ message, retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS)`.
- `services/api/src/features/rides/rides.policy.ts` (whole file) — Why: the policy-constants-not-env-vars precedent (lines 1-18), **and** lines 30-51, whose "NOTHING ENFORCES THAT CEILING YET" paragraph this ticket makes false and must rewrite.
- `services/api/src/common/kv/kv.store.ts` (whole file, 24 lines) — Why: the five methods available. `incrWithTtl` sets the expiry only when the key has none; `ttl` returns 0 when the key is gone.
- `services/api/src/common/config/env.schema.ts` (lines 46-56 for the `MAPS_ROUTE_CACHE_TTL_SECONDS` shape to copy) — Why: three new vars go here, same `z.coerce.number().int().positive().default(…)` idiom.
- `services/api/src/features/pricing/pricing.service.ts` (lines 33-50) — Why: the OTHER consumer. It does **not** catch route failures — a rejection fails the quote and the ride request. Confirm the negative cache's effect there is understood (it fails faster and cheaper, never worse) and leave the file untouched.
- `services/api/test/harness.ts` (lines 41-108 `InMemoryKeyValueStore` incl. `advance()`; 244-289 `CountingMapsProvider`; 374-455 `createTestApp`) — Why: `advance()` is how the negative cache's expiry is asserted without sleeping. `MAPS_PROVIDER_SOURCE` is overridden once and shared by **both** cache instances, so `ctx.maps.routeCalls` still counts everything — no harness change needed.
- `services/api/src/features/geo/caching-maps.provider.spec.ts` (whole file) — Why: the unit suite to extend. **Lines 99-118 assert the current reject-and-don't-cache behavior for a fractional result and must be deliberately rewritten** (see Task 4).
- `services/api/src/features/notifications/tracking/tracking.integration.spec.ts` (lines 596-707) — Why: the #87 cases. **Line 695 pins the event name and 698-704 pin the exact key set including `'message'`** — both change.
- `services/api/src/features/geo/geo.module.spec.ts` (whole file) — Why: the `Reflect.getMetadata('providers', GeoModule)` pattern for asserting what the module actually binds. Extends naturally to the second instance.
- `services/api/src/features/notifications/notifications.policy.ts` (lines 15-57) — Why: where the throttle constants belong, alongside the existing `TRACKING_*` constants.
- `.claude/references/logging-standard.md` (whole file, 16 lines) — Why: `domain.component.action_state`; `geo` is a valid domain; line 14 is the never-log rule this ticket enforces structurally.
- `services/api/CLAUDE.md` — Why: the maps bullet ("Maps go through `MAPS_PROVIDER`…") becomes incomplete with two tokens.

### New Files to Create

- `services/api/src/features/notifications/tracking/tracking.service.spec.ts` — Unit spec owning the 429 assertion. **Deliberately not in the integration spec**: that file shares one `InMemoryKeyValueStore` across every case (documented at its lines 596-599), and 121 sequential HTTP polls would both pollute it and drag the suite.

No other new files. Everything else is an edit — the geo slice is 8 files and stays 8.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Google Routes API — Compute Routes pricing](https://developers.google.com/maps/documentation/routes/usage-and-billing#routes-compute)
  - Specific section: "Routes: Compute Routes" SKU tiers
  - Why: the per-call cost this whole ticket bounds; grounds the `<€100/mo` arithmetic in the policy docblocks.
- [Google Routes API — `Route.duration`](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RouteMatrix#Route)
  - Specific section: `duration` is a protobuf `Duration` string like `"1187.400s"` — **fractional seconds are the documented shape, not an edge case**
  - Why: this is the primary evidence for finding 6. The rounding fix is not defensive coding against a hypothetical.
- [MDN — `Promise.race()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/race#description)
  - Specific section: "Description" — the losing promise is **not** cancelled
  - Why: the timeout bounds latency, not spend. Say so in the docblock.
- [NestJS — Custom providers: `useFactory`](https://docs.nestjs.com/fundamentals/custom-providers#factory-providers)
  - Specific section: factory providers with `inject`
  - Why: the two-instance binding. Two `useFactory` entries on distinct string tokens is the sanctioned shape.
- [Zod — `.max()` on numbers](https://zod.dev/api?id=numbers)
  - Why: the `MAPS_ROUTE_TIMEOUT_MS` ceiling that keeps a misconfiguration from re-opening #46.

### Patterns to Follow

**Structured logging** — payload object, never a format string. From `tracking.service.ts:196-202`:

```ts
this.logger.warn({
  event: 'ride.notifications.track_view_denied',
  tokenPrefix: token.slice(0, 4),
  reason,
  at: new Date().toISOString(),
});
```

Every payload carries `event` and `at`, plus the ids known at that point (`.claude/references/logging-standard.md:13`). New events in this ticket: `geo.maps.route_fetched` (log), `geo.maps.route_failed` (warn/error), `ride.notifications.track_view_throttled` (warn), `ride.notifications.track_eta_failed` (warn, renamed).

**Throttle** — INCR-then-check, verbatim shape from `rides.service.ts:285-311` (docblock included — it states *why* INCR-then-check):

```ts
const attempts = await this.kv.incrWithTtl(key, WINDOW_SECONDS);
if (attempts <= MAX_PER_WINDOW) return;
// The key can expire between the INCR and this read, and a
// retryAfterSeconds of 0 would read as "retry now" on a rejection.
const retryAfterSeconds = Math.max(1, await this.kv.ttl(key));
this.logger.warn({ event: '…_throttled', …, at: new Date().toISOString() });
throw new HttpException(
  { message: 'too_many_requests', retryAfterSeconds },
  HttpStatus.TOO_MANY_REQUESTS,
);
```

**Policy constants** — a `*.policy.ts` per slice, constants + key builders, each with a docblock stating *why that number*. From `rides.policy.ts:14-18`:

```ts
export const RIDE_REQUEST_MAX_PER_WINDOW = 20;
export const RIDE_REQUEST_WINDOW_SECONDS = 600; // 10 min
export const rideRequestRateKey = (riderId: string): string =>
  `rides:rate:${riderId}`;
```

**Test naming** — every `it()` is tagged `(expected)` / `(edge)` / `(failure)`, cross-referenced to an AC where one applies: `it('… (edge — AC #2, the budget guardrail)')`.

**Anti-patterns to avoid:**

- Do **not** add a parameter to `MapsProvider.route()` in `packages/shared`. The two-instance binding gives the same attribution with no cross-surface change. `packages/shared` gets a docblock edit and nothing else.
- Do **not** log a provider's `error.message` anywhere. Closed-enum `reason` + `error.name` only.
- Do **not** claim the throttle "closes" the burst path or protects the database read.
- Do **not** use `setTimeout` without `clearTimeout` — see the GOTCHA in Task 3.
- Do **not** reset or `advance()` the shared `InMemoryKeyValueStore` from inside `tracking.integration.spec.ts`; it is one instance for the whole file.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — config and policy constants

Everything downstream reads these. No behavior change on its own.

**Tasks:** three new env vars with bounds and docblocks; `.env.example`; the tracking throttle constants and key builder.

### Phase 2: The seam — `CachingMapsProvider` and its two bindings

**Depends on:** Phase 1 (needs the env vars and their defaults).

The core of the ticket: caller namespacing, negative cache, timeout, write-path rounding, structured logs, and the second bound instance.

**Tasks:** rewrite `caching-maps.provider.ts`'s `route()` path; add `MAPS_PROVIDER_ETA`; bind it in `geo.module.ts`; export it from the barrel.

### Phase 3: The consumer — throttle and sanitized logging

**Depends on:** Phase 1 (constants) and Phase 2 (the `MAPS_PROVIDER_ETA` token must exist to inject).

**Tasks:** inject `KV_STORE` + `MAPS_PROVIDER_ETA` into `TrackingService`; add `assertWithinRateLimit`; rename the fallback event and drop the free-text `message`.

### Phase 4: Tests

**Depends on:** Phases 2 and 3.

**Tasks:** extend the geo unit specs, add the tracking service unit spec, update the two integration assertions the rename touches.

### Phase 5: Documentation truth-up

**Independent of:** Phase 4 — the docs can be written in parallel with the tests; both depend only on Phases 1-3 being settled.

Several docblocks become false the moment Phases 2-3 land. This phase is not optional garnish: `rides.policy.ts` and `tracking.service.ts` both currently assert the *absence* of things this ticket adds.

**Tasks:** rewrite the `rides.policy.ts` timeout paragraph, the `roadEta` docblock, the `services/api/CLAUDE.md` maps bullet, the shared seam docblock, and append an AMENDMENTS entry to the #87 plan.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task Format Guidelines

Use information-dense keywords for clarity:

- **CREATE**: New files or components
- **UPDATE**: Modify existing files
- **ADD**: Insert new functionality into existing code
- **REMOVE**: Delete deprecated code
- **REFACTOR**: Restructure without changing behavior
- **MIRROR**: Copy pattern from elsewhere in codebase

---

### UPDATE `services/api/src/common/config/env.schema.ts`

- **IMPLEMENT**: Three new vars directly after `MAPS_ROUTE_CACHE_TTL_SECONDS` (line 56):
  - `MAPS_ETA_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300)` — docblock: the tracking page consumes `durationSeconds`, exactly the field traffic moves, so it cannot inherit the pricing TTL. 5 min is roughly the interval over which a Rīga corridor's travel time meaningfully changes; 24 h would serve an 08:30 rush-hour page from an 02:00 route.
  - `MAPS_ETA_FAILURE_TTL_SECONDS: z.coerce.number().int().positive().default(60)` — docblock: how long a failed route is remembered, **for the `eta` caller only**. Long enough that an outage costs one call per corridor per minute instead of one per poll per viewer; short enough that a transient blip self-heals inside a rider's patience. Named `ETA`, not `ROUTE`, precisely because the `quote` caller does **not** negative-cache — see the `geo.module.ts` task and the NOTES section for why.
  - `MAPS_ROUTE_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(3_000)` — docblock: MUST stay well under `RIDE_IDEMPOTENCY_PENDING_TTL_SECONDS` (120 s), which is why the `.max()` exists rather than a comment. Bounds LATENCY, not spend — the upstream call keeps running and still bills.
- **PATTERN**: `env.schema.ts:46-56` — same `z.coerce.number().int().positive().default(…)` chain and docblock density.
- **IMPORTS**: none new.
- **GOTCHA**: These go **inside** the `z.object({…})`, above the closing `})` at line 134 — not in the `.superRefine`. Do not add production-only refinements: these are operational knobs with safe defaults in every environment, unlike a secret.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #5, AC #6 (foundation for both)

### UPDATE `.env.example`

- **IMPLEMENT**: Add the three vars beneath `MAPS_ROUTE_CACHE_TTL_SECONDS=86400` (line 35), with their defaults: `MAPS_ETA_CACHE_TTL_SECONDS=300`, `MAPS_ETA_FAILURE_TTL_SECONDS=60`, `MAPS_ROUTE_TIMEOUT_MS=3000`. One short `#` comment above the group.
- **PATTERN**: the existing maps block at `.env.example:33-35`.
- **GOTCHA**: values here are the committed defaults and must match the schema defaults exactly — a drift makes `cp .env.example .env` behave differently from an unset environment.
- **VALIDATE**: `grep -c '^MAPS_' .env.example` → must print `4`. Anchor the `^` — `GOOGLE_MAPS_API_KEY` at line 33 also contains `MAPS_` and an unanchored count red-flags a correct implementation.
- **SATISFIES**: AC #5, AC #6

### ADD throttle constants to `services/api/src/features/notifications/notifications.policy.ts`

- **IMPLEMENT**: Append after `TRACKING_ETA_GRID_DECIMALS` (line 57):
  ```ts
  export const TRACKING_VIEW_MAX_PER_WINDOW = 120;
  export const TRACKING_VIEW_WINDOW_SECONDS = 60;
  export const trackingViewRateKey = (token: string): string =>
    `tracking:rate:${token}`;
  ```
  Docblock must carry the arithmetic: the page polls every 5 s = **12 requests/min for one viewer**; #17's share-trip reuses one token across viewers, so the budget is shared — 120/min is **9 concurrent viewers** (corrected post-review, see ASSUMPTIONS: a page load spends one extra request via the SSR fetch, and the fixed window passes ~240 in a ~60 s span), comfortably above a family watching one ride and far below what a script can spend. And the honest limits: it **bounds** the concurrent-burst path, it does not **close** it (that needs in-flight coalescing, deferred to #13/#16), and it does **not** protect the database read — an attacker can mint unlimited shape-valid 22-char tokens, each hitting `rideByToken` once. Constants not env vars, matching `rides.policy.ts:1-13`, because this is the budget guardrail in code. Tune when the first Google bill exists — the same trigger `COORD_PRECISION` carries.
- **PATTERN**: `rides.policy.ts:14-18` for the constant + key-builder shape; `notifications.policy.ts:29-57` for docblock density.
- **IMPORTS**: none new.
- **GOTCHA**: key on the token, not the ride id — the service throttles before it knows whether a ride exists.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/geo/caching-maps.provider.ts` — the seam rewrite

This is the largest task. It stays comfortably under the ~500-line ceiling.

- **IMPLEMENT**, in this order:

  1. **Caller type + namespaced keys.**
     ```ts
     export type MapsCaller = 'quote' | 'eta';
     ```
     Change `routeCacheKey(caller, from, to, stops = [])` → `maps:route:v1:${caller}:${points}`, and add a sibling `routeFailureKey(caller, from, to, stops = [])` → `maps:route:fail:v1:${caller}:${points}`. Factor the `points` rendering into a private helper so the two keys cannot drift. Keep `v1`: the shape of `RouteResult` is unchanged, and inserting the namespace segment already makes every pre-existing key unreachable — they simply age out, which is the outcome the existing `v1` docblock describes.

  2. **Constructor** takes `caller: MapsCaller`, `failureTtlSeconds: number`, `timeoutMs: number` alongside the existing three. Add `private readonly logger = new Logger(CachingMapsProvider.name);` — two instances share the context string, and the `caller` field on every payload disambiguates them.

  3. **Read path.** The negative cache is **opt-in per caller**: `failureTtlSeconds === 0` disables it entirely (see the `geo.module.ts` task — `quote` passes `0`). Derive `private readonly negativeCache = failureTtlSeconds > 0;` in the constructor and skip **both** the fail-key read and the fail-key write when it is off, so a disabled caller pays no extra round trip.

     When enabled, read both keys in one round trip:
     ```ts
     const [hit, failed] = this.negativeCache
       ? await Promise.all([this.kv.get(key), this.kv.get(failKey)])
       : [await this.kv.get(key), null];
     ```
     Then: valid hit → return it (a cached **success always wins** over a cached failure). Corrupt hit → `del(key)` and fall through, exactly as today. Then `failed !== null` → throw `new Error('maps_route_unavailable')` **without** calling the source, and log `geo.maps.route_failed` with `reason: 'negative_cached'`.

  4. **Fetch with timeout.** A private `fetchWithTimeout()` racing `this.inner.route(...)` against a rejecting timer.

  5. **Round, then parse.** Before `routeResultSchema.parse`:
     ```ts
     const validated = routeResultSchema.parse({
       ...result,
       distanceMeters: Math.round(result.distanceMeters),
       durationSeconds: Math.round(result.durationSeconds),
     });
     ```
     Docblock the *why*: Google's Routes API documents `duration` as a fractional-seconds string (`"1187.400s"`), so fractional is the **documented shape, not an edge case**. Left unrounded it threw on every call, was swallowed by `roadEta`'s catch, and degraded every ETA on the platform to haversine permanently while the page kept answering 200. Rounding costs sub-metre and sub-second accuracy — nothing. `parse()` still rejects NaN, negatives, missing fields and wrong types, which is what it was actually for.

  6. **Success log.** `this.logger.log({ event: 'geo.maps.route_fetched', caller, cell, distanceMeters, durationSeconds, at })`. This is the paid-call counter — one line per call that would have cost money.

  7. **Failure path.** Wrap fetch+round+parse in one `try`. On throw: `setWithTtl(failKey, reason, this.failureTtlSeconds)` **when `negativeCache` is on**, log either way, rethrow always. Classify into a closed enum:
     - `'timeout'` — the race timer won
     - `'contract_violation'` — the zod parse rejected after rounding, i.e. genuinely broken data. Log at **`error`**, not `warn`: it means a systematically broken adapter, and it is the failure mode that silently degrades the whole platform.
     - `'source_rejected'` — everything else
     Negative-cache **all three**. A contract violation will fail identically next time and each retry costs money.

  8. **`cell` correlation id.**
     ```ts
     const cell = createHash('sha256').update(key).digest('base64url').slice(0, 10);
     ```
     Stable per corridor, so "this cell keeps failing" is answerable, and structurally free of coordinates.

- **PATTERN**: existing docblock density in this same file (lines 11-25, 40-49, 65-74); log payload shape from `tracking.service.ts:196-202`.
- **IMPORTS**: add `import { Logger } from '@nestjs/common';` and `import { createHash } from 'node:crypto';`. `node:crypto` is fine here — this is `services/api`, not `packages/shared` (see `tracking.service.ts:17` and its docblock at 38-40 for the precedent and the reason).
- **GOTCHA — the timeout timer.** `Promise.race` does **not** cancel the loser. `clearTimeout` in a `finally`, or Jest hangs on an open handle and every stub-backed test pays a 3 s dangling timer. `StubMapsProvider` resolves synchronously, so this fires on **every** test in the suite:
  ```ts
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      this.inner.route(from, to, stops),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('maps_route_timeout')),
          this.timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  ```
- **GOTCHA — no free text.** The negative-cache **value** and every log `reason` is a member of the closed enum. A provider's `error.message` never reaches a log line or a Redis value. `error.name` is the only thing taken off the error object, and only for the `source_rejected` case. This is what makes finding 5 structurally impossible to regress rather than regex-dependent.
- **GOTCHA — thrown message.** The error the negative cache throws must itself be coordinate-free (`'maps_route_unavailable'`), since `TrackingService` and `PricingService` are both downstream of it.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api test -- caching-maps` (the existing suite will fail on the changed `routeCacheKey` signature and the rounding — Task "UPDATE caching-maps.provider.spec.ts" fixes it. Confirm the failures are *exactly* those and not others.)
- **SATISFIES**: AC #2, AC #3, AC #4, AC #6, AC #7

### ADD `MAPS_PROVIDER_ETA` to `services/api/src/features/geo/maps.tokens.ts`

- **IMPLEMENT**: New exported token beside the existing two. Docblock: the tracking page's cached facade — its own instance of `CachingMapsProvider`, with the `eta` key namespace and the shorter `MAPS_ETA_CACHE_TTL_SECONDS`. Separate from `MAPS_PROVIDER` because the two consumers read **different fields**: pricing reads `distanceMeters` (near time-invariant, 24 h is fine), tracking reads `durationSeconds` (exactly what traffic moves). A shared namespace would let a pricing write pin a tracking read to 24 h staleness; separate namespaces make that impossible rather than unlikely. It is also what gives `geo.maps.route_fetched` its `caller` field without a `packages/shared` contract change — and what lets the negative cache be **on for `eta` and off for `quote`**, because poll amplification is the tracking page's problem alone.
- **PATTERN**: `maps.tokens.ts:7-16` — the docblock explains why the token exists at all, not what it is.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3, AC #6

### UPDATE `services/api/src/features/geo/geo.module.ts` — bind both instances

- **IMPLEMENT**: Keep the `MAPS_PROVIDER_SOURCE` provider untouched. Extend the `MAPS_PROVIDER` factory to pass `'quote'`, `env.MAPS_ROUTE_CACHE_TTL_SECONDS`, **`0` (negative cache OFF)**, `env.MAPS_ROUTE_TIMEOUT_MS`. Add a parallel `MAPS_PROVIDER_ETA` provider with the same `inject` array, passing `'eta'`, `env.MAPS_ETA_CACHE_TTL_SECONDS`, `env.MAPS_ETA_FAILURE_TTL_SECONDS`, the same timeout. Add both to `exports`.
- **IMPLEMENT — the `0` needs a docblock, it is the plan's least obvious line.** The negative cache exists to break **poll amplification**, and only the tracking page polls. On the quote path it would buy almost nothing and cost real bookings: `PricingService` does not catch route failures (`pricing.service.ts:42`), so a rejection fails `POST /rides`; a rider's retry mints a fresh `Idempotency-Key` (`rides.policy.ts:20-28`) and re-enters the quote, where it would meet the cached failure. One transient Routes 5xx would then block that exact pickup→destination pair for the whole failure TTL — strictly worse than today, on the one path that earns money. Spend on the quote path is already bounded from the other end by `RIDE_REQUEST_MAX_PER_WINDOW = 20` per 10 min per rider. Turn it on for `quote` only if a real bill ever shows quote-path failure spend, and then with a TTL in seconds, not a minute.
- **IMPLEMENT**: Update the module docblock — both instances decorate **one** source, which is what keeps the harness's single `MAPS_PROVIDER_SOURCE` override counting every paid call across both.
- **PATTERN**: the existing `MAPS_PROVIDER` `useFactory` entry at `geo.module.ts:42-47`.
- **GOTCHA**: identical `inject: [MAPS_PROVIDER_SOURCE, KV_STORE, APP_ENV]` on both — a second `MAPS_PROVIDER_SOURCE` provider would defeat the shared-counter property the integration suite depends on.
- **GOTCHA**: the two instances differ in **three** arguments (caller, success TTL, failure TTL) and share only the timeout. A copy-paste that leaves `quote` with the eta failure TTL reintroduces exactly the blocked-booking bug above, and no existing test would catch it — which is why the geo.module spec below asserts it.
- **VALIDATE**: `pnpm --filter @taxi/api test -- geo.module`
- **SATISFIES**: AC #3, AC #6

### UPDATE `services/api/src/features/geo/index.ts`

- **IMPLEMENT**: Export `MAPS_PROVIDER_ETA` from the barrel. Update the KNOWN GAPS docblock: the seam now carries a timeout, a negative cache and a miss-path counter; note that **in-flight coalescing is still absent** and is the remaining spend gap, deferred to #13/#16.
- **PATTERN**: `index.ts:20-21`.
- **GOTCHA**: the barrel is the slice's public API — a token not exported here cannot be injected by `NotificationsModule`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3

### UPDATE `services/api/src/features/notifications/tracking/tracking.service.ts`

- **IMPLEMENT**:
  1. Inject `@Inject(KV_STORE) private readonly kv: KeyValueStore` and swap `@Inject(MAPS_PROVIDER)` → `@Inject(MAPS_PROVIDER_ETA)`.
  2. Add `private async assertWithinRateLimit(token: string): Promise<void>` mirroring `rides.service.ts:285-311`, logging `ride.notifications.track_view_throttled` with `tokenPrefix: token.slice(0, 4)` (mirroring `denied()` at 194-203 — never the full token) and `attempts`.
  3. Call it in `view()` **after** the `trackingTokenSchema.safeParse` guard (line 67-70) and **before** `this.repository.rideByToken` (line 72). Order matters: shape-first means arbitrary junk cannot mint unbounded Redis keys; before-the-read means a throttled request costs no database round trip and no paid route call.
  4. Rename `ride.notifications.track_eta_fallback` → `ride.notifications.track_eta_failed` and **drop the `message` field entirely**. Final payload: `{ event, rideId, driverId, at }`.
  5. Rewrite the `roadEta` docblock (lines 150-169). The paragraph at 158-163 currently says the throttle and negative cache "are follow-ups on this seam, due before a real provider is bound" — they have landed. Replace with what is true: origin quantization rides the cache; the seam owns the timeout and negative cache; the page owns the throttle; **in-flight coalescing remains open**. State that the provider's error detail deliberately does not appear here — `geo.maps.route_failed` owns it, keyed by `cell`, and correlates by time — because a provider message could echo coordinates into a line `logging-standard.md:14` forbids, and no key-set assertion can catch a coordinate hiding *inside* a free-text field.
- **PATTERN**: `rides.service.ts:285-311` for the throttle; `tracking.service.ts:194-203` for the log shape.
- **IMPORTS**: add `HttpException`, `HttpStatus` from `@nestjs/common`; `KV_STORE`, `type KeyValueStore` from `../../../common/kv/kv.store`; `MAPS_PROVIDER_ETA` from `../../geo`; the two throttle constants + `trackingViewRateKey` from `../notifications.policy`. **Remove `MAPS_PROVIDER`** from the geo import — it becomes unused, and leaving it is a lint error.
- **GOTCHA**: `KvModule` is `@Global()` (see `geo.module.ts:33`), so `NotificationsModule` needs **no** new `imports` entry for `KV_STORE`. It already imports `GeoModule`, which now exports the new token — also no change.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #1, AC #4, AC #8

### UPDATE `services/api/src/features/geo/caching-maps.provider.spec.ts`

- **IMPLEMENT**: Update `build()` for the new constructor arity (default it to `caller: 'quote'`, a short failure TTL, a generous timeout, and let each test override). Fix every `routeCacheKey(...)` call for the new first argument. Then:
  - **REWRITE lines 99-118.** The existing `'refuses to cache a result that breaks the seam contract (failure)'` case asserts precisely the behavior finding 6 says is wrong. It becomes `'rounds a fractional provider result instead of degrading every ETA (failure — AC #7)'`: the same `{10234.5, 1187.4}` provider now resolves to `{10234, 1187}`, is cached, and **no** failure key is written. The comment must record *why the assertion flipped* — Google documents fractional durations, so the old behavior would have thrown on every call, been swallowed by `roadEta`, and pinned the platform to haversine.
  - **ADD** `'still refuses a genuinely broken result (failure)'`: `NaN`/negative/missing-`polyline` → rejects, nothing cached under the route key, **and** a failure key written. Proves rounding narrowed the guard without removing it.
  - **ADD** `'an outage is cached: the second call never reaches the source (edge — AC #2)'`.
  - **ADD** `'the negative cache expires and the corridor recovers (edge — AC #2)'` using `kv.advance(FAILURE_TTL + 1)`.
  - **ADD** `'a cached success outranks a cached failure (edge)'` — seed both keys, assert the hit is served and no source call happens.
  - **ADD** `'a hung provider rejects on the timeout and is negative-cached (failure — AC #4)'` — a provider returning a never-settling promise, a 20 ms timeout.
  - **ADD** `'quote and eta callers do not share cache entries (edge — AC #6)'` — two instances over one counting source, same coordinates, **two** source calls.
  - **ADD** `'a caller with the negative cache off retries the source instead of blocking (edge — AC #2)'` — an instance built with `failureTtlSeconds: 0`, a source that fails once then succeeds: the second call **reaches the source** and returns a route. This is the booking path; the case exists so a future "simplification" that makes the negative cache unconditional fails loudly here rather than in production.
  - **ADD** `'the miss-path log carries the caller and cell but no coordinates (expected — AC #3)'` — `jest.spyOn(Logger.prototype, 'log')`, pin the **exact key set** (mirroring `tracking.integration.spec.ts:698-704`) and assert no value stringifies to contain any coordinate fragment.
- **PATTERN**: existing cases in this file; the exact-key-set assertion idiom at `tracking.integration.spec.ts:688-704`.
- **IMPORTS**: `Logger` from `@nestjs/common`.
- **GOTCHA**: the timeout case must **not** use real 3 s waits — pass a 20 ms `timeoutMs` to that instance's constructor. And `InMemoryKeyValueStore.advance()` shifts one global offset for that store, so construct a fresh `build()` per test (the existing `build()` already does).
- **VALIDATE**: `pnpm --filter @taxi/api test -- caching-maps`
- **SATISFIES**: AC #9

### UPDATE `services/api/src/features/geo/geo.module.spec.ts`

- **IMPLEMENT**: Add two cases mirroring the existing `'is what the module actually binds…'` metadata assertion (lines 28-43): read `Reflect.getMetadata('providers', GeoModule)`, find both `MAPS_PROVIDER` and `MAPS_PROVIDER_ETA`, assert both are `useFactory` with `inject: [MAPS_PROVIDER_SOURCE, KV_STORE, APP_ENV]`, and:
  - `'the two facades do not share cache entries (edge — AC #6)'` — invoking the two factories with one fake env yields instances whose **cache keys differ for identical coordinates**. Without this leg the two bindings could both pass `'quote'` and the TTL split would be silently dead.
  - `'the quote facade does not negative-cache (edge — AC #2)'` — build both from the factories, fail the shared source once for each, then succeed: the `eta` facade blocks on its cached failure while the `quote` facade reaches the source. **This is the case that guards the booking path**, and the only place the `0` argument in `geo.module.ts` is enforced rather than merely written down.
- **PATTERN**: `geo.module.spec.ts:28-43`.
- **GOTCHA**: assert *observable* behavior, not private fields. Namespace separation is proven by two source calls for identical coordinates; the negative-cache split by whether the second call reaches the source.
- **VALIDATE**: `pnpm --filter @taxi/api test -- geo.module`
- **SATISFIES**: AC #6, AC #9

### CREATE `services/api/src/features/notifications/tracking/tracking.service.spec.ts`

- **IMPLEMENT**: Construct `TrackingService` directly with plain-object fakes for its five deps (`NotificationsRepository`, `PlatformConfigService`, `DriverLocationStore`, `MapsProvider`, `Env`) plus a real `InMemoryKeyValueStore`. Cases:
  - `'a normal poll sequence is never throttled (expected — AC #1)'` — `TRACKING_VIEW_MAX_PER_WINDOW` views succeed. Guards the off-by-one that would break the live page.
  - `'the request past the limit answers 429 with a positive retryAfterSeconds (failure — AC #1)'` — assert `HttpStatus.TOO_MANY_REQUESTS` and `retryAfterSeconds >= 1`.
  - `'the throttle spends no database read and no paid route call (edge — AC #1)'` — the repository and maps fakes record **zero** calls for the throttled request. This is the assertion that makes the throttle a *spend* control rather than a politeness feature.
  - `'the window expires and the token is served again (edge)'` — `kv.advance(TRACKING_VIEW_WINDOW_SECONDS + 1)`.
  - `'a malformed token is rejected before it can mint a rate key (edge)'` — assert 404 **and** that the store holds no `tracking:rate:` key. Pins the shape-then-throttle ordering.
- **PATTERN**: `caching-maps.provider.spec.ts` for hand-built fakes over a real `InMemoryKeyValueStore`; `rides` specs for the `HttpException` assertion shape.
- **IMPORTS**: `InMemoryKeyValueStore` from `../../../../test/harness` (four levels — this file is one deeper than `notifications.policy.spec.ts`; cross-check against `tracking.integration.spec.ts:21`).
- **GOTCHA — "plain-object fakes" is not as trivial as it sounds.** Each of the 120 successful views traverses the whole of `view()`: `rideByToken` → `TRACKING_STATE_BY_STATUS` → `platformConfig.forCity` → `trackingViewSchema.parse`. The fixture must therefore satisfy the **wire schema** — `dispatchPhone` matching `/^\+/`, a valid `RideStatus`, a real `Date` for `updatedAt`. Simplest shape by far: a ride with **`driverId: null`**, which skips `driverCard`, `positionOf` and `maps.route` entirely and still exercises every line of the throttle.
- **GOTCHA**: this is **deliberately not** an integration case. `tracking.integration.spec.ts` shares one `InMemoryKeyValueStore` across the whole file (its own comment at 596-599), so 121 sequential supertest polls would both pollute that store and drag the suite for no extra coverage.
- **VALIDATE**: `pnpm --filter @taxi/api test -- tracking.service`
- **SATISFIES**: AC #1, AC #9

### UPDATE `services/api/src/features/notifications/tracking/tracking.integration.spec.ts`

- **IMPLEMENT**: In `'a maps outage degrades to the straight-line estimate…'` (lines 657-707): change the event name at line 695 to `ride.notifications.track_eta_failed`, and change the key-set assertion at 698-704 from `['at','driverId','event','message','rideId']` to `['at','driverId','event','rideId']`. Add a comment recording that the new assertion is **stronger**: it pins the *absence* of any free-text field, so a provider message that embedded coordinates could not slip through a payload this shape — the exact hole finding 5 named.
- **IMPLEMENT**: Add a comment to that case recording a new **ordering dependency** it acquires. `failNext()` now leaves a live negative-cache entry in the file's shared `InMemoryKeyValueStore`, which this file never resets and never `advance()`s — so the key lives 60 real seconds. It is safe today only because this is the **last** case in the file. Any case appended after it that routes the same `eta` corridor gets a negative-cached throw instead of a source call, and its `routeCalls` delta assertion fails for a reason that looks nothing like the cause.
- **PATTERN**: the existing assertion block at 688-704; keep the "whole key set, not `objectContaining`" reasoning intact. The ordering comment belongs beside the file's existing shared-store note at 596-599 in spirit — same class of trap.
- **GOTCHA**: Leave the rest of the file alone. The `routeCalls` delta assertions at 613-654 must **still pass unchanged** — pricing quotes now use the `quote` namespace and ETAs the `eta` namespace, but both decorate one shared source, so the counter is unaffected. If any of those cases fail, the two instances are wrongly sharing a source or wrongly splitting one; do not "fix" the assertion, fix the binding.
- **VALIDATE**: `REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test -- tracking.integration`
- **SATISFIES**: AC #8, AC #9

### UPDATE `packages/shared/src/seams/maps-provider.ts` — docblock only

- **IMPLEMENT**: On `RouteResult` (lines 10-15), document that `distanceMeters` and `durationSeconds` are **whole units**; that Google's Routes API returns fractional seconds (`"1187.400s"`) so an adapter must not assume otherwise; and that `CachingMapsProvider` rounds on the write path, so a fractional adapter degrades nothing. **No type changes** — TypeScript cannot express an integer, which is exactly why the invariant has to live in prose and be enforced at the cache boundary.
- **PATTERN**: the existing `MapsProvider` docblock at 17-21.
- **GOTCHA**: docblock only. A type or field change here is a cross-surface contract change requiring a full consumer audit (`packages/shared/CLAUDE.md`) — and it is not needed.
- **VALIDATE**: `pnpm --filter @taxi/shared test && pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #7

### UPDATE `services/api/src/features/rides/rides.policy.ts` — the paragraph that becomes false

- **IMPLEMENT**: Rewrite lines 38-41 of the `RIDE_IDEMPOTENCY_PENDING_TTL_SECONDS` docblock. "NOTHING ENFORCES THAT CEILING YET: no maps call carries a timeout, so a hang past this window would reopen #46 by a new door" is false once `MAPS_ROUTE_TIMEOUT_MS` lands. Replace with: the ceiling is now enforced — `MAPS_ROUTE_TIMEOUT_MS` defaults to 3 s and the env schema's `.max(30_000)` is what keeps a misconfiguration from re-opening #46, rather than a comment asking someone to remember.
- **PATTERN**: the file's existing docblock voice — state the constraint and what enforces it.
- **GOTCHA**: this is the one place in the repo that *names* the timeout constraint. Leaving it stale means the next reader believes there is no timeout. Do not skip as cosmetic.
- **VALIDATE**: `grep -c 'NOTHING ENFORCES THAT CEILING YET' services/api/src/features/rides/rides.policy.ts` → must print `0`
- **SATISFIES**: AC #4, AC #10

### UPDATE `services/api/CLAUDE.md` — the maps bullet

- **IMPLEMENT**: Extend the existing bullet ("Maps go through `MAPS_PROVIDER` (`features/geo`), a `CachingMapsProvider` over `MAPS_PROVIDER_SOURCE`…"): there are now **two** cached facades over **one** source — `MAPS_PROVIDER` (`quote`, long TTL, pricing) and `MAPS_PROVIDER_ETA` (`eta`, short TTL, tracking) — because the two consumers read different fields with different staleness tolerances, and separate namespaces make the TTL split structural. Tests still override the **source**, so both stay under test and one counter sees every paid call. Add: a provider's free-text `error.message` never reaches a log line; `geo.maps.route_failed` carries a closed-enum `reason` and a `cell` hash instead.
- **PATTERN**: the surrounding bullets — one dense sentence stating the rule and its reason.
- **GOTCHA**: surgical. Edit that bullet and add at most one; do not restructure the file.
- **VALIDATE**: `grep -c 'MAPS_PROVIDER_ETA' services/api/CLAUDE.md` → must print `1` or more
- **SATISFIES**: AC #10

### UPDATE `.claude/plans/tracking-eta-maps-quantized-cache.md` — AMENDMENTS

- **IMPLEMENT**: Append under `## AMENDMENTS`: `2026-08-11 — #94 renamed the log event AC #3 pins: 'ride.notifications.track_eta_fallback' → 'ride.notifications.track_eta_failed' (logging-standard.md:8 defines action_state as verb + state; "fallback" is a noun describing the handling). The same AC's payload no longer carries the provider's 'message' — geo.maps.route_failed owns provider-error detail, so no free text can echo a coordinate into a log line. #94 also closed this plan's open TTL-staleness thread via MAPS_ETA_CACHE_TTL_SECONDS.`
- **PATTERN**: the `## AMENDMENTS` section format at the foot of that plan (append-only, newest last, ISO date).
- **GOTCHA**: append only — never edit AC #3 in place. The AC records what was true when #87 shipped.
- **VALIDATE**: `grep -c 'track_eta_failed' .claude/plans/tracking-eta-maps-quantized-cache.md` → must print `1` or more
- **SATISFIES**: AC #8, AC #10

### VALIDATE the whole slice

- **IMPLEMENT**: Run the full CI-parity gate and the Level 4 manual check below.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`
- **SATISFIES**: AC #9, AC #11

---

## TESTING STRATEGY

Jest, `maxWorkers: 1` (serial — every suite shares one Postgres). Tests mirror slices; each feature ships ≥1 expected + 1 edge + 1 failure case.

### Unit Tests

- **`caching-maps.provider.spec.ts`** carries the weight: negative cache write/serve/expire, timeout, caller namespacing, write-path rounding, and the log's coordinate-freedom. Hand-built fakes over a real `InMemoryKeyValueStore`, which is how the existing cases already work.
- **`geo.module.spec.ts`** proves the *wiring* — that two distinct instances with distinct namespaces are actually bound, not just declared.
- **`tracking.service.spec.ts`** (new) owns the throttle, including the assertion that a throttled request spends no database read and no route call.

### Integration Tests

`tracking.integration.spec.ts` needs **no new cases** — it needs two assertions corrected. That is deliberate: the throttle limit is expensive to exercise over HTTP and cheap to exercise at the service level, and the file's shared `InMemoryKeyValueStore` makes 121 polls actively harmful. Its real job here is a **regression check**: the `routeCalls` delta assertions at 613-654 must pass untouched, which is what proves the namespace split did not break the shared-source counter.

### Edge Cases

- Cached success and cached failure both present → success wins.
- Negative-cache entry expires mid-outage → the corridor recovers without a deploy.
- Fractional provider result → rounded and cached (previously: rejected, and every ETA on the platform silently degraded).
- Genuinely broken result (NaN / negative / missing `polyline`) → still rejected, **and** negative-cached so retries cost nothing.
- Provider hangs forever → rejects at `MAPS_ROUTE_TIMEOUT_MS`, negative-cached, timer cleared (no open handle).
- Identical coordinates from both callers → two source calls, two entries, two TTLs.
- Exactly `TRACKING_VIEW_MAX_PER_WINDOW` views → all served; the next → 429 with `retryAfterSeconds >= 1`.
- Malformed token → 404, and **no** rate key minted.
- Throttle window expires → the token is served again.
- Corrupt cache entry → still deleted and re-fetched (existing behavior, must not regress).

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/api typecheck
pnpm --filter @taxi/api lint
pnpm --filter @taxi/shared typecheck
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/api test -- caching-maps
pnpm --filter @taxi/api test -- geo.module
pnpm --filter @taxi/api test -- tracking.service
pnpm --filter @taxi/shared test
```

### Level 3: Integration Tests

```bash
docker compose up -d --wait
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 \
  pnpm --filter @taxi/api test -- tracking.integration
```

Then the CI-parity gate — **this is the gate, `pnpm check` is not** (it omits `build` and rides warm `dist`):

```bash
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 \
  pnpm turbo run typecheck lint test build --force
```

> Redis-backed suites `describe.skip` without `REDIS_TEST_URL`, so a green gate can be five tests short. `COMPOSE_PROJECT_NAME=taxi` is required in a worktree or the db pretest port-conflicts on 5432.

### Level 4: Manual Validation

**This is the check #87's plan specified and could not perform** — its whole point was that the log did not exist. It is now performable, which is the ticket's own success condition.

```bash
pnpm --filter @taxi/api dev
```

1. Book a ride and accept it (or reuse a seeded active ride) to get a tracking token.
2. `curl -s localhost:3001/track/<token> | jq .etaMinutes` — twice within 5 s.
3. **Server logs must show exactly ONE `geo.maps.route_fetched` with `"caller":"eta"`** across both requests. That single line is the paid-call counter this ticket exists to create.
4. Confirm no log line in the run contains a coordinate: `... | grep -E '5[67]\.[0-9]{3}|2[34]\.[0-9]{3}'` → no matches.
5. Throttle: `for i in $(seq 1 130); do curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/track/<token>; done | sort | uniq -c` → ~120× `200`, the rest `429`.
6. Negative cache + timeout, together. **Order matters** — `MAPS_ROUTE_TIMEOUT_MS` is shared by both callers, so a 1 ms timeout also fails the pricing quote and you could no longer book the ride step 1 needs. So: book and accept at the default timeout **first**, then set `MAPS_ROUTE_TIMEOUT_MS=1`, restart the server, and only then poll `/track/:token` twice. First poll → `geo.maps.route_failed` with `"reason":"timeout"`; second → `"reason":"negative_cached"` **with no second source attempt**. The page answers `200` with a haversine ETA both times.
7. Confirm the asymmetry is live: with `MAPS_ROUTE_TIMEOUT_MS=1` still set, attempt a booking. It fails (expected — the quote cannot route), but a **second** attempt must still reach the source, i.e. produce a fresh `geo.maps.route_failed` with `"caller":"quote"` and **never** `"reason":"negative_cached"`. That is the blocked-booking bug this plan exists to avoid, checked by hand.

### Level 5: Additional Validation (Optional)

```bash
redis-cli -p 6381 --scan --pattern 'maps:route:*' | head
```

Expect `maps:route:v1:quote:…` and `maps:route:v1:eta:…` as distinct namespaces, and `maps:route:fail:v1:…` only after a forced failure.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1 — Token-scoped throttle.** `GET /track/:token` answers 429 with `{ message: 'too_many_requests', retryAfterSeconds }` past `TRACKING_VIEW_MAX_PER_WINDOW` per `TRACKING_VIEW_WINDOW_SECONDS`. Applied after shape validation, before the database read, so a throttled request spends neither a query nor a paid route call. Asserted at service level, not over HTTP.
- [ ] **AC #2 — Negative cache, on the `eta` caller only.** For `MAPS_PROVIDER_ETA`: a failed `route()` is cached under its own key for `MAPS_ETA_FAILURE_TTL_SECONDS`, the next call for that corridor throws without reaching the source, and it recovers when the entry expires. A cached success always outranks a cached failure. For `MAPS_PROVIDER` (`quote`): the negative cache is **off** (`failureTtlSeconds: 0`), asserted by a test, so one transient provider blip cannot block bookings on a corridor for a minute.
- [ ] **AC #3 — Miss-path counter.** Every source call emits `geo.maps.route_fetched` with `caller`, a `cell` correlation hash, and the routed values — no coordinates, key set pinned by a test.
- [ ] **AC #4 — Timeout.** A route call rejects at `MAPS_ROUTE_TIMEOUT_MS` (default 3 s, schema-capped at 30 s so it cannot exceed `RIDE_IDEMPOTENCY_PENDING_TTL_SECONDS`), is negative-cached, and leaves no dangling timer. Documented as bounding **latency, not spend**.
- [ ] **AC #5 — Config.** Three env vars added with bounds and docblocks; `.env.example` values match the schema defaults exactly.
- [ ] **AC #6 — Duration-appropriate TTL.** `MAPS_PROVIDER_ETA` is bound as a second `CachingMapsProvider` over the same source, with the `eta` key namespace and `MAPS_ETA_CACHE_TTL_SECONDS` (300). Namespace separation is asserted, so a pricing write cannot pin a tracking read to the 24 h TTL.
- [ ] **AC #7 — Fractional durations survive.** A provider returning `{10234.5, 1187.4}` is rounded and cached rather than rejected. Genuinely broken values still reject. `packages/shared` gets a docblock only — no type or field change.
- [ ] **AC #8 — Sanitized failure logging.** `track_eta_fallback` → `track_eta_failed`, and its payload carries no free-text provider message; the integration key-set assertion pins that absence. No provider `error.message` reaches any log line or Redis value.
- [ ] **AC #9 — Tests.** ≥1 expected + 1 edge + 1 failure at unit level for the seam and the throttle; the existing tracking integration suite passes with only the two rename-driven assertion changes — in particular the `routeCalls` deltas at 613-654 pass untouched.
- [ ] **AC #10 — Docs true.** `rides.policy.ts`'s "NOTHING ENFORCES THAT CEILING YET" paragraph, `roadEta`'s "follow-ups on this seam" paragraph, and `services/api/CLAUDE.md`'s maps bullet all reflect what shipped; the #87 plan carries an AMENDMENTS entry.
- [ ] **AC #11 — Gate green.** `pnpm turbo run typecheck lint test build --force` passes with `REDIS_TEST_URL` set. No regression in pricing, dispatch or the ride lifecycle.
- [ ] **AC #12 — No overstatement.** No docblock or comment claims the throttle "closes" the concurrent-burst path, that the timeout bounds spend, or that the throttle protects the database read. Each is stated as a bound with its residual gap named. **And every mention of the negative cache names which caller it applies to** — "the negative cache bounds outage spend" is true for `eta` and false for `quote`, and an unqualified claim is the precise form the next reader will get wrong. This is the same failure mode `docs(api): correct the paid-call claims the #87 docblocks overstate` was written to fix.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works — **especially Level 4 step 3**, the check #87 could not perform
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability
- [ ] PR body carries `Closes #94` and ticks the six issue checkboxes

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes** (each is a number chosen with reasoning, not a fact — all are tunable the moment a real Google bill exists, the same trigger `COORD_PRECISION` carries):

- **`TRACKING_VIEW_MAX_PER_WINDOW = 120` per 60 s.** One viewer polling every 5 s is 12/min, plus one more per page *load* (the SSR fetch). #17's share-trip reuses the token, so the budget is genuinely shared across viewers — a family of three is 39/min on load and 36/min after, well inside it. **Corrected post-review (#99):** the ceiling that always holds is **9** concurrent viewers, not 10 — ten opening the link inside one window is 10 + 120 = 130. Ten holds only once every page is open and nobody reloads. And because the window is *fixed*, not sliding, two boundary-adjacent windows pass **~240 requests in a ~60 s span** — that is the figure to size spend against. It does **not** break visibly: no client renders a 429, so what a rider sees is the "connection lost" screen (tracked as #100).
- **`MAPS_ETA_CACHE_TTL_SECONDS = 300`.** Roughly how long a Rīga corridor's travel time stays meaningfully accurate. No traffic data exists to calibrate against.
- **`MAPS_ETA_FAILURE_TTL_SECONDS = 60`, and the negative cache off entirely for `quote`.** Long enough that an outage costs one call per corridor per minute rather than one per poll per viewer; short enough that a transient blip self-heals inside a rider's patience. The asymmetry is the reasoned part, not the number — see NOTES.
- **`MAPS_ROUTE_TIMEOUT_MS = 3000`.** Google Routes p99 is well under a second; 3 s is generous headroom while still far under `RIDE_IDEMPOTENCY_PENDING_TTL_SECONDS`.
- **Rounding, not rejecting, is the right answer to the contract mismatch.** Rejecting keeps the platform "honest" but pins every ETA to haversine and — because pricing does **not** catch route failures (`pricing.service.ts:42`) — would fail every quote, i.e. block every booking. Rounding costs sub-metre accuracy. Not close.

**Questions that would change the plan if answered differently** — none are blocking; each has a defensible default already chosen:

- **Should the negative cache also cover `contract_violation`, or only provider rejections?** The issue's wording scopes it to `inner.route()` rejecting. This plan caches all three failure kinds **on the `eta` caller**, because a contract violation fails identically on retry and each retry costs money. The cost: a single malformed response suppresses that corridor for 60 s. Accepted — an `error`-level log makes it loud, and the page degrades to haversine rather than breaking.
- **Should `quote` ever negative-cache?** Not at these numbers — see NOTES. The plan's design keeps this a one-argument decision (`failureTtlSeconds` is already a constructor parameter), so turning it on later is a literal change plus a test, not a redesign. Revisit only if a real Google bill shows quote-path *failure* spend, and then in seconds rather than a minute.
- **Should `MAPS_PROVIDER` be renamed to `MAPS_PROVIDER_QUOTE` for symmetry?** Deliberately not: it touches `pricing.service.ts`, the harness comments, `payments.tokens.ts` and `services/api/CLAUDE.md` for zero behavior change. Adding a token beats renaming one.
- **Is `CachingMapsProvider` still the right home for the timeout once a real adapter exists?** A Google client has its own timeout option, and a per-provider timeout is arguably better placed there. Keeping it at the seam means *every* future provider inherits it, including one that forgets. Revisit in #13/#16; the seam-level timeout is the safe default until then.

---

## NOTES (open canvas)

### Why the second bound instance beats a `caller` parameter on the seam

The first instinct is to add `caller?: string` to `MapsProvider.route()` so the log can attribute spend. That is a cross-surface contract change — `packages/shared/CLAUDE.md` requires every one of them to ship with tests and a consumer audit — and it is solving the wrong problem. `caller` is **construction-time configuration**, not per-call data: there are exactly two call sites (`pricing.service.ts:42`, `tracking.service.ts:176`) and neither varies its caller at runtime. Verified before committing to the approach, not assumed.

Binding a second instance costs ~15 lines in `geo.module.ts` and one import swap, and it pays for four findings at once:

| Finding | What the second instance gives |
|---|---|
| #3 miss-path log | `caller` on every payload, zero `packages/shared` churn |
| #6 duration TTL | a TTL split that is **structural** — separate namespaces, so a pricing write *cannot* pin a tracking read |
| #2 negative cache | the ability to run it **on for `eta`, off for `quote`** — without which the feature is net-negative (below) |
| — | a natural seam for a future per-consumer budget cap |

The one thing it costs is a shared cache hit between pricing and tracking. Near-zero in practice: pricing routes a raw 4-decimal pickup→destination, tracking routes a 3-decimal-snapped origin→pickup. They coincide only by accident.

### Why the negative cache is ON for `eta` and OFF for `quote`

The obvious implementation caches failures for every caller. That is the version to *not* build, and the reasoning is worth keeping because the naive read ("a negative cache fails faster and cheaper, never worse") is wrong on the booking path.

Trace a single transient Routes 5xx with a uniform negative cache:

1. `PricingService.quote()` calls `route()` — it rejects.
2. `pricing.service.ts:42` does **not** catch. The quote fails, so `POST /rides` fails.
3. The rider taps *Book* again. The client mints a **fresh** `Idempotency-Key` per attempt (`rides.policy.ts:20-28`), so this is a new attempt, not a replay — and the previous attempt created no ride, so its reservation was released. Either way the request re-enters the quote path.
4. It meets the cached failure and fails **without the provider ever being asked again** — for the full TTL.

So one blip blocks that exact pickup→destination pair for 60 s, on the single path that earns money. Today the rider simply retries and books.

Now check what the negative cache was actually *for*. The issue's own arithmetic — *"N viewers still produce N×12 upstream calls per minute"* — describes **poll amplification**, and only the tracking page polls. Pricing makes one route call per booking attempt, already capped at `RIDE_REQUEST_MAX_PER_WINDOW = 20` per 10 min per rider (`rides.policy.ts:14-15`). There is no amplification to break. The feature is close to pure cost there.

| | `eta` (tracking page) | `quote` (booking) |
|---|---|---|
| Calls per unit of demand | 12/min per viewer, indefinitely | 1 per booking attempt |
| Existing spend bound | none before this ticket | `RIDE_REQUEST_MAX_PER_WINDOW = 20`/10 min |
| Cost of a cached failure | none — page degrades to haversine, still 200 | **the booking fails** |
| Negative cache verdict | **on**, 60 s | **off** |

This is exactly the kind of asymmetry the two-instance design was already built to express, which is why it costs one argument rather than a redesign. It is also why `MAPS_ETA_FAILURE_TTL_SECONDS` is named for its caller: a var named `MAPS_ROUTE_*` invites someone to wire it into both.

### The failure taxonomy, and why no free text ever escapes

```
inner.route()
  ├─ timer wins            → reason: 'timeout'             warn   negative-cached
  ├─ promise rejects       → reason: 'source_rejected'     warn   negative-cached  (+ error.name)
  ├─ parse rejects (post-round)
  │                        → reason: 'contract_violation'  ERROR  negative-cached
  └─ resolves              → geo.maps.route_fetched        log
```

`reason` is a closed enum. `error.name` is a class name. Neither can contain a coordinate. That is the whole design: finding 5 is fixed *structurally*, not by a regex scrubber that a future provider's message format could slip past. The `cell` hash gives correlation ("this corridor keeps failing") without ever rendering a coordinate.

What is genuinely lost: the provider's own message, which is the first thing you'd want when Routes starts failing. That detail belongs in the Google adapter (#13/#16), which is the only code that knows its own error shapes and can sanitize them knowingly — an HTTP status and a Google error code, not a free-text blob. Deliberate deferral, recorded here so it is a decision rather than an omission.

### Spend arithmetic — what actually changes

One active ride, one viewer, page polling every 5 s (12/min):

| Scenario | Source calls/min before | after |
|---|---|---|
| Driver moving, provider healthy | ~6.8 (cell crossings) | ~6.8 — **unchanged**, quantization already handled this |
| Driver parked at the kerb | ~0 (cached cell) | ~0 — unchanged |
| **Provider outage, 1 viewer** | **12** | **~1** (negative cache) |
| **Provider outage, 10 viewers on one token** | **120** | **~1** (shared corridor, shared failure key) |
| Hostile poll, 1 token | unbounded requests | ≤120 requests/min |
| Concurrent burst, cold cell | N (no coalescing) | N, but **bounded by the throttle** — still not closed |
| Provider outage, booking path | 1 per attempt (≤20/10 min) | 1 per attempt — **deliberately unchanged** |

The outage row is the one that matters. It is where the current design fails worst and where the negative cache is worth an order of magnitude — and it is precisely the row a throttle alone does **not** fix, because those calls come from legitimate viewers each polling within their own limit.

The last row is the one that is deliberately *not* optimized: shaving ≤20 calls per rider per 10 minutes is not worth a minute of blocked bookings.

### The residual gap, stated plainly

**In-flight coalescing is still absent** after this ticket. The throttle *bounds* the concurrent-burst path; it does not *close* it. This distinction is exactly what `docs(api): correct the paid-call claims the #87 docblocks overstate` was written to fix, and every docblock this ticket touches must respect it — hence AC #12. Coalescing needs either a single-flight promise map (per-process, so it under-delivers on a multi-instance deploy) or a Redis lock (correct, more moving parts). Neither is worth building against `StubMapsProvider`, where the real concurrency shape is unmeasurable. It belongs to #13/#16, alongside the first real bill.

### Sequencing risk

Task order is dependency-honest, with one trap: **`caching-maps.provider.spec.ts` goes red between the seam rewrite and its own update.** That is expected and named in the seam task's VALIDATE step. Confirm the failures are exactly the changed `routeCacheKey` arity and the rounding assertion — any *other* failure means the rewrite broke something the plan did not intend, and is worth stopping for.

The second trap is the timer. `StubMapsProvider` resolves synchronously, so an un-cleared `setTimeout` fires on every single test in the API suite. Symptom: Jest reports open handles or hangs after the last test. `clearTimeout` in a `finally`, and if a run hangs, look there first.

## AMENDMENTS

<!-- Append-only. Newest entry at the bottom. Leave empty until this plan has been executed. -->
