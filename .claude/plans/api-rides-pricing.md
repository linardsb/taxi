# Feature: API rides + pricing — request → upfront fixed quote via seams → persisted ride

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

**Closes #9.** Read `gh issue view 9` and `gh issue view 1` before starting — this plan resolves three places where the ticket wording and the shipped contracts disagree, and the resolutions are recorded in **OPEN QUESTIONS / ASSUMPTIONS**. Read that section before Task 1.

## Feature Description

The first slice where a **ride exists and has a price**. A rider POSTs a ride request; the API routes it through the `MapsProvider` seam (aggressively cached, `<€100/mo` guardrail), prices it through the `UpfrontFixed` implementation of the `PricingStrategy` seam, resolves the commission from the `platform_config` row **at quote time** (config, never a constant), persists the ride at its state-machine **entry** status with a normalized fare breakdown, joins the rider's sockets to the ride room, and emits `ride:status`.

Everything downstream depends on this: #10 (dispatch) has nothing to offer until a `requested` ride exists, #11 settles against the quote written here, #16 (rider booking) calls this endpoint, and the driver's fare-transparency card (S2-5 — the whole wedge) is built from the quote plus the commission split this slice teaches the system to compute.

Three seams get their first real implementation here: `MapsProvider` (stub + caching decorator), `PricingStrategy` (upfront fixed), and the `platform_config` read path. Two of them are consumed by #10 within the next ticket, which is why they live in their own slices rather than inside `rides/`.

## User Story

As a **rider** in Rīga
I want to **request a ride and be told the exact price before I commit**
So that **I know what I will pay — no meter anxiety, no surge I cannot see** — and so the driver who takes the job can be shown the same number alongside a 15% commission line they can verify.

## Problem Statement

`services/api` can authenticate people (#7) and knows where drivers are (#8), but there is no way to ask for a ride. Nothing in the codebase turns a pickup/destination pair into money:

- No `MapsProvider` implementation exists — the seam is an interface with no binding, so no route, no distance, no duration.
- No `PricingStrategy` implementation exists — `fareQuoteSchema` describes a quote nobody can produce.
- Nothing reads `platform_config.commissionPct`. The 15% is seeded in the database and consumed by no code, so the "config not constant" architecture decision is currently only aspirational.
- No tariff exists at all — there are no base/per-km/per-minute rates anywhere in the repo. `fareQuoteSchema.breakdown` names `baseCents`/`distanceCents`/`timeCents` and nothing can populate them.
- `rides`, `ride_fare_lines` and `ride_offers` tables exist (#6) with zero writers.

And the budget guardrail bites the moment a real Google Maps key is bound: an uncached Routes call per ride request, per re-quote, per price refresh is exactly how a €100/mo budget becomes a €400 bill.

## Solution Statement

Four small slices, composed by the rides slice:

1. **`features/geo`** — owns the `MapsProvider` binding. A `StubMapsProvider` (haversine × road-winding factor; no SDK, no spend) wrapped in a `CachingMapsProvider` that memoizes `route()` in Redis under a coordinate-rounded key with a TTL. The stub factory **throws at boot under `NODE_ENV=production`**, exactly like `smsProviderFactory` — a silent stub that prices real rides on straight-line distance is worse than no boot. Lives in `geo/` and not in `pricing/` because #10 needs ETAs from the same seam and must not import through the pricing barrel to get them.

2. **`features/platform-config`** — a repository + service that reads the `platform_config` row for a city and parses it through `platformConfigSchema`. Consumed by pricing today; by #10 (`offerTimeoutSeconds`, `defaultDispatchMode`, `unclaimedAlertSeconds`), #18 and #20 next.

3. **`features/pricing`** — the `UpfrontFixedPricingStrategy` bound to `PRICING_STRATEGY`, a `TariffRepository` over a **new `ride_tariffs` table** (one row per city × ride category — config rows, not constants, so #20 can edit them), and a `PricingService` that composes maps → strategy → commission resolution → `splitFare`.

4. **`features/rides`** — the orchestrator and the only HTTP surface: `POST /rides`, rider-role only, rider identity from the JWT and never from the body. Validates, quotes, persists ride + fare lines in one transaction, joins the rider to the ride room, emits `ride:status`.

New contracts land in `@taxi/shared` (`rideTariffSchema`, `rideRequestBodySchema`, `rideCreatedSchema`) and the new table lands in `@taxi/db` with migration `0005` and four seeded Rīga tariff rows anchored on the anketa's real fares (S5-1).

## Out of Scope / Non-Goals

- **Not included: dispatch.** No offers, no matching, no driver selection, no `ride:offer`. A ride created here sits at `requested` until #10 exists. That is the correct end state for this ticket.
- **Not included: the ride lifecycle.** No `applyTransition` helper, no accept/arrive/start/complete, no cancellation route. #11 owns every transition after entry. See OPEN QUESTIONS #1 — this is a deliberate, flagged divergence from the ticket's AC wording.
- **Not included: scheduled-ride behavior (#21).** A request carrying `scheduledFor` is persisted and enters the machine at `scheduled`, and then **nothing happens to it** — no timer promotes it to `requested`. The field exists; the behavior is #21's.
- **Not included: multi-taxi orders (#22).** `vehicleCount > 1` is rejected with `400 multi_taxi_not_supported`. #22 deletes that guard and fans one order into N rides sharing `orderId`.
- **Not included: `GET /rides/:id`, `GET /rides/me`, or a quote-preview endpoint.** `POST /rides` returns the full ride, which is all #16 needs to render a confirmation. Reads are #11/#16's.
- **Not included: geozone resolution.** `rides.geozone_id` stays `null`. Zone-resolution precedence (Vecrīga deliberately overlaps centre) is called out as #10's problem in `db/src/seed/riga.ts:20-23`. Do not add an `ST_Contains` lookup here.
- **Not included: a real Google Maps provider.** The `GOOGLE_MAPS_API_KEY` in `.env.example` stays unused. #13/#16 bind the real one against the same token.
- **Not included: geocoding.** A `RideRequest` already carries `AddressPoint`s (address + lat/lng), so only `route()` is called. `StubMapsProvider.geocode()`/`reverseGeocode()` throw with a message naming the ticket that will need them.
- **Not included: writing `rides.commission_pct` / `commission_source` / `commission_cents` / `driver_net_cents`.** Those four columns carry the **settled** split and are #11's, per their docblock in `db/src/schema/rides.ts:51-55`. This slice computes a platform-base split and returns it in the response; it persists none of it.
- **Not changing:** the ride state machine, `resolveCommissionPct`, `splitFare`, `fareQuoteSchema`, the socket event catalog (**no new events** — see OPEN QUESTIONS #2), the drivers slice, the auth slice, the realtime slice's public API.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (4 new slices, 1 new table + migration, 3 new shared contracts, 2 seam implementations)
**Primary Systems Affected**: `services/api` (`features/{rides,pricing,geo,platform-config}`), `packages/shared` (schemas), `db` (schema + migration + seed)
**Dependencies**: no new npm packages. Uses what is already installed: `zod`, `drizzle-orm`, `@nestjs/*`, `jest`/`supertest`, `vitest` (shared/db).

## Related Work

**Implements**: [#9](https://github.com/linardsb/taxi/issues/9) · **Epic**: [#1](https://github.com/linardsb/taxi/issues/1) (`docs/epics/sakta-cab.architecture.md` — "Key decisions → Commission" and "Boundaries & contracts" are inherited, not re-decided)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/shared-contracts-ride-loop.md` — Why: authored `rideRequestSchema`, `fareQuoteSchema`, `fareSplitSchema`, `resolveCommissionPct`, `splitFare`, `platformConfigSchema` and the `isFareQuoteConsistent`/`assertOfferSplitConsistent` predicate style this slice consumes. **Read its "predicate not `.refine()`" rationale before touching any shared schema.**
- `.claude/plans/db-foundation-drizzle-postgis.md` — Why: authored `rides`, `ride_fare_lines`, `platform_config`, the migration workflow and the idempotent Rīga seed this plan extends with `ride_tariffs`.
- `.claude/plans/api-auth-realtime-gateway.md` — Why: the `SMS_PROVIDER` production-refusal factory this plan mirrors for `MAPS_PROVIDER`; `RealtimeService.joinRideRoom`/`emitToRide`; the global-guard/`@Roles` posture.
- `.claude/plans/api-drivers-slice.md` — Why: the slice shape being mirrored end to end (module/controller/service/repository/`index.ts`), the identity-from-JWT boundary, the port + in-memory-fake test pattern, and the `test/harness.ts` override mechanism.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet) — expected: #10 (consumes `MAPS_PROVIDER`, `PlatformConfigService`, `PricingService.split-per-driver`), #11 (transitions + settled split + fare lines), #16 (calls `POST /rides`), #20 (admin UI over `platform_config` and `ride_tariffs`), #21/#22 (delete the two guards this slice adds).

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**Contracts you consume (read all of these first — they encode decisions you must not re-litigate):**

- `packages/shared/src/schemas/ride.ts` (whole file, 229 lines) — Why: `rideRequestSchema` (the wire input), `fareQuoteSchema` + `isFareQuoteConsistent`/`assertFareQuoteConsistent` (lines 25-69), `rideSchema` (163-182). **Lines 39-53 explain why these are plain `ZodObject`s and must stay so** — `.omit()`/`.extend()` are load-bearing for #6's insert shapes and this ticket's `rideRequestBodySchema`.
- `packages/shared/src/commission.ts` (whole file, 88 lines) — Why: `resolveCommissionPct(driver, config)` and `splitFare(total, resolution)`. Note the structural `CommissionDriverInput` (lines 18-20): `{}` is a legal argument and is exactly what "no driver yet" means at quote time.
- `packages/shared/src/money.ts` (whole file, 42 lines) — Why: reuse `nonNegativeCentsSchema`/`commissionPctSchema`; never re-type `z.number().int()`. `commissionCentsFor` is half-up rounding and the driver net is derived by subtraction.
- `packages/shared/src/ride-state-machine.ts` (lines 1-47, 63-65) — Why: `RIDE_STATUSES`, `ALLOWED_TRANSITIONS`, `assertTransition`. There is **no initial pseudo-state**, which is the whole of OPEN QUESTION #1.
- `packages/shared/src/schemas/platform-config.ts` (whole file, 30 lines) — Why: `commissionPct` deliberately has **no zod default** (lines 12-18) so every caller must read a real row. Your `PlatformConfigService` is that caller.
- `packages/shared/src/seams/maps-provider.ts` (whole file, 26 lines) — Why: the exact `MapsProvider` / `RouteResult` / `GeocodeResult` shapes you implement. "Implementations MUST cache aggressively" is in the docblock.
- `packages/shared/src/seams/pricing-strategy.ts` (whole file, 14 lines) — Why: `quote(request, route)` is the **entire** strategy signature — no config parameter, so the tariff must be injected into the strategy, not passed in.
- `packages/shared/src/realtime-events.ts` (lines 22-31, 64-73, 164-176, 201-230) — Why: `RT.rideStatus` and `rideStatusEventSchema` are what you emit. Line 64: *"Emitted on every state-machine transition — which is why there is no separate `ride:requested`."* Wire timestamps are **ISO strings**, enforced by `RealtimeService.emit`'s `.parse()`.
- `packages/shared/src/enums.ts` (lines 7-17) — Why: `RIDE_CATEGORIES` (the tariff's key), `PRICING_MODELS`, `PAYMENT_METHOD_TYPES`.

**Database (the tables you write, already built by #6):**

- `db/src/schema/rides.ts` (lines 24-90) — Why: the `rides` column set you insert into and **the jsonb-vs-columns rule in its docblock**; `ride_fare_lines` (77-90) is the normalized breakdown. Lines 51-55 reserve the four commission columns for #11 — do not write them.
- `db/src/schema/platform-config.ts` (whole file, 29 lines) — Why: `commissionPct` has **no column default**, on purpose (lines 15-19).
- `db/src/schema/enums.ts` (lines 15-31) — Why: every enum derives from a `@taxi/shared` const array; `fareLineTypeEnum` (line 31) is `["base","distance","time","discount"]` and mirrors `fareQuoteSchema.breakdown`'s keys.
- `db/src/schema/geo.ts` (lines 5-10) — Why: `cities` is what `ride_tariffs.city_id` references.
- `db/src/seed/riga.ts` (whole file, 113 lines) — Why: the idempotent upsert pattern and fixed-UUID convention you extend with tariffs. Lines 104-112 are the "config, not constant" precedent to copy verbatim in spirit.
- `db/src/schema/index.ts`, `db/src/index.ts` — Why: the two barrels a new table must be added to, or `@taxi/api` cannot import it.

**API patterns to mirror (the drivers slice is the reference implementation):**

- `services/api/src/features/drivers/drivers.controller.ts` (whole file, 50 lines) — Why: `@Roles`, `@CurrentUser`, `@Body(new ZodValidationPipe(schema))`, and the rule in its docblock: *"The driver id always comes from the JWT, never a param or a body."* `POST /rides` obeys the same rule for `riderId`.
- `services/api/src/features/drivers/drivers.service.ts` (lines 1-30, 61-114) — Why: constructor injection style, `ConflictException('snake_case_code')` error bodies, and the structured-log shape (`event`, ids, `at` ISO) at lines 106-113.
- `services/api/src/features/drivers/drivers.repository.ts` (lines 1-11, 32-65, 195-238) — Why: `@Inject(DRIZZLE)`, the `requireRow` guard, a row→domain mapper, and "aggregate in JS, it's a ≤10-driver pilot" pragmatism.
- `services/api/src/features/drivers/drivers.module.ts` (whole file, 41 lines) — Why: `useFactory` + `inject: [APP_ENV]` provider style, and the "deliberately not `@Global()`" note.
- `services/api/src/features/drivers/index.ts` (whole file, 22 lines) — Why: the barrel's job — narrow public API + a documented KNOWN GAPS block. Yours needs one too.
- `services/api/src/features/auth/auth.module.ts` (lines 12-27, 44-55) — Why: **`smsProviderFactory` is the exact production-refusal pattern `mapsProviderSourceFactory` copies.** Read the docblock; reuse its reasoning shape.
- `services/api/src/features/auth/auth.module.spec.ts` (whole file, 42 lines) — Why: the three-test shape for a refusing factory, including the `Reflect.getMetadata('providers', Module)` check that proves the module actually binds the factory (lines 26-41). Copy this for `geo.module.spec.ts` — without it the refusal test can pass against a `useClass` registration.
- `services/api/src/features/realtime/realtime.service.ts` (whole file, 76 lines) — Why: `joinRideRoom(userId, rideId)` and `emitToRide` are the two methods you call. `emit` parses through `RT_EVENT_SCHEMAS` — pass ISO strings or it throws.
- `services/api/src/features/drivers/location/driver-location.service.ts` (lines 16-71) — Why: the "server clock, not client clock" boundary and the emit-with-ISO-string call shape.
- `services/api/src/common/kv/kv.store.ts` (whole file, 17 lines) — Why: `KeyValueStore` is the port your cache uses — `get`/`setWithTtl` are all you need. `KvModule` is `@Global()`, so `@Inject(KV_STORE)` works anywhere.
- `services/api/src/common/config/env.schema.ts` (lines 22-55, 95-99) — Why: where `MAPS_ROUTE_CACHE_TTL_SECONDS` goes; `DEFAULT_CITY_ID` is how a single-city pilot resolves a city without a lookup.
- `services/api/src/common/db/db.module.ts` (lines 11, 34-46) — Why: the `DRIZZLE` token.
- `services/api/src/common/zod-validation.pipe.ts` (whole file, 26 lines) — Why: per-parameter usage; a failed parse is `400 {message:'validation_failed', issues:[...]}`.
- `services/api/src/app.module.ts` (whole file, 30 lines) — Why: where `RidesModule` gets registered; global guard order.

**Tests:**

- `services/api/test/harness.ts` (lines 197-262) — Why: `createTestApp()` and its `overrideProvider` list; you add a `MAPS_PROVIDER_SOURCE` override and a `maps` handle to `TestApp`. Lines 80-95 hold the test-only `haversineMeters` — **read the docblock: it is deliberately separate from production code and stays that way.**
- `services/api/src/features/drivers/drivers.integration.spec.ts` (lines 1-120) — Why: the whole integration idiom — `phoneFor` per-file E.164 range, `signIn` helper, `ctx.app.close()` in `afterAll`, parsing every response through its shared schema.
- `services/api/test/global-setup.ts` (whole file, 53 lines) — Why: the suite drops/creates `taxi_api_test`, migrates and seeds on every run, and **hard-fails on a stale `dist`**. Your new `@taxi/db` export must survive that check.
- `packages/shared/tests/platform-config.test.ts` (whole file, 40 lines) — Why: the exact vitest style for a new shared schema, including a test whose stated purpose is to fail if someone reintroduces a constant.
- `services/api/package.json` (lines 69-90) — Why: jest config — `rootDir: src`, `testRegex: .*\.spec\.ts$`, `testTimeout: 20000`.

### New Files to Create

**`packages/shared`**

- `packages/shared/src/schemas/tariff.ts` — `rideTariffSchema` + `RideTariff`: the per-city, per-category rate card.
- `packages/shared/tests/tariff.test.ts` — 1 expected + 1 edge + 1 failure for the new schema.

**`db`**

- `db/src/schema/ride-tariffs.ts` — the `ride_tariffs` table.
- `db/migrations/0005_*.sql` (+ `meta/0005_snapshot.json`, `meta/_journal.json` update) — **generated by `pnpm --filter @taxi/db generate`, never hand-written.**

**`services/api/src/features/geo/`** — the maps seam's home

- `maps.tokens.ts` — `MAPS_PROVIDER`, `MAPS_PROVIDER_SOURCE`.
- `haversine.ts` — great-circle distance for the stub.
- `stub-maps.provider.ts` — `StubMapsProvider`.
- `caching-maps.provider.ts` — `CachingMapsProvider` + `routeCacheKey` + `routeResultSchema`.
- `geo.module.ts` — `mapsProviderSourceFactory` (production refusal) + the caching wrapper binding.
- `index.ts` — barrel: `GeoModule`, `MAPS_PROVIDER`, `MAPS_PROVIDER_SOURCE`.
- `stub-maps.provider.spec.ts`, `caching-maps.provider.spec.ts`, `geo.module.spec.ts` — tests.

**`services/api/src/features/platform-config/`**

- `platform-config.repository.ts`, `platform-config.service.ts`, `platform-config.module.ts`, `index.ts`, `platform-config.service.spec.ts`.

**`services/api/src/features/pricing/`**

- `pricing.tokens.ts` — `PRICING_STRATEGY`.
- `tariff.repository.ts` — reads `ride_tariffs`.
- `upfront-fixed.strategy.ts` — `UpfrontFixedPricingStrategy implements PricingStrategy`.
- `pricing.service.ts` — maps → strategy → commission → split.
- `pricing.module.ts`, `index.ts`.
- `upfront-fixed.strategy.spec.ts`, `pricing.service.spec.ts`.

**`services/api/src/features/rides/`**

- `ride-entry.ts` — `RIDE_ENTRY_STATUSES`, `entryStatusFor`, `assertEntryStatus`.
- `rides.repository.ts` — the transactional insert + row→`Ride` mapper.
- `rides.service.ts` — orchestration.
- `rides.controller.ts` — `POST /rides`.
- `rides.module.ts`, `index.ts`.
- `ride-entry.spec.ts`, `rides.service.spec.ts`, `rides.integration.spec.ts`.

**Files UPDATED (not created):** `packages/shared/src/schemas/ride.ts`, `packages/shared/src/index.ts`, `packages/shared/tests/schemas.test.ts`, `db/src/schema/index.ts`, `db/src/index.ts`, `db/src/seed/riga.ts`, `db/tests/schema-constraints.test.ts`, `services/api/src/common/config/env.schema.ts`, `services/api/src/app.module.ts`, `services/api/test/harness.ts`, `.env.example`, `services/api/CLAUDE.md`, `.claude/references/realtime-events.md`.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

**In-repo (these outrank anything external):**

- `.claude/references/ride-state-machine.md` — Specific section: "Entry". *"instant rides enter at `requested`; scheduled rides enter at `scheduled` and a timer promotes them"* — Why: this is the sentence that resolves OPEN QUESTION #1 in favor of an entry-status policy.
- `.claude/references/realtime-events.md` — Specific section: the `ride:status` row and the Rules list — Why: no new event may be added without going to `RT` first; room names come from helpers; `@SubscribeMessage` handlers live in the owning slice (you add none).
- `.claude/references/logging-standard.md` — Specific section: `domain.component.action_state` — Why: your log events are `ride.request.*` and `ride.pricing.*`; never log an address beyond a geozone name.
- `.claude/references/conventions.md` — Why: commit/PR/review rules the ship steps read at run time.
- `services/api/CLAUDE.md` (whole file) — Why: the seam rule, the `assertTransition` rule, the "dev-only stub must THROW in production" rule, structured logging, VSA layout.
- `packages/shared/CLAUDE.md` (whole file) — Why: shared imports nothing from the workspace; types derive from zod via `z.infer`; every contract change ships with tests **and a check of all consumers**.
- `docs/epics/sakta-cab.architecture.md` — Specific section: "Key decisions → Commission" (line 27) and "Boundaries & contracts" (line 31) — Why: inherited, not re-decided.
- `docs/build-playbook.md` — Specific section: the 2.4 row in Step 4 — Why: the one-line statement of this slice, including "cache aggressively".
- `docs/prd/anketa-findings.md` — Specific section: S5-1 (line 145: `centre → RIX €13 · RIX → Teika €22 · Teika → Ķengarags €21`) and S2-5/S2-4 — Why: the only real fare data that exists; the seeded tariff is fitted to it.

**External:**

- [Drizzle ORM — transactions](https://orm.drizzle.team/docs/transactions)
  - Specific section: `db.transaction(async (tx) => ...)`
  - Why: the ride row and its fare lines must commit together; a ride with no breakdown is unsettleable by #11.
- [Drizzle ORM — drizzle-kit generate](https://orm.drizzle.team/docs/drizzle-kit-generate)
  - Specific section: generating a migration from a schema change
  - Why: migration `0005` and its snapshot are generated, never authored by hand.
- [Drizzle ORM — indexes & constraints](https://orm.drizzle.team/docs/indexes-constraints#unique)
  - Specific section: `uniqueIndex` on multiple columns
  - Why: `ride_tariffs` needs `unique(city_id, category)` so the seed is idempotent and a duplicate rate card is impossible.
- [NestJS — custom providers](https://docs.nestjs.com/fundamentals/custom-providers#factory-providers)
  - Specific section: factory providers with `inject`
  - Why: `MAPS_PROVIDER` composes two providers (`MAPS_PROVIDER_SOURCE` + `KV_STORE`); the source must be its own token so tests can swap it and still exercise the cache.
- [NestJS — testing / overrideProvider](https://docs.nestjs.com/fundamentals/testing#testing-utilities)
  - Specific section: `Test.createTestingModule().overrideProvider(token).useValue(...)`
  - Why: `overrideProvider` resolves by token anywhere in the compiled graph, including providers a module does not export — which is what lets the harness swap `MAPS_PROVIDER_SOURCE`.
- [zod — `.omit()` / `.extend()`](https://zod.dev/?id=omit)
  - Specific section: object methods
  - Why: `rideRequestBodySchema` is `rideRequestSchema.omit({ riderId: true })`; this only works because the source is a plain `ZodObject` (see its docblock).

### Patterns to Follow

**Identity comes from the JWT, never the body** — `drivers.controller.ts:20-23`, `realtime-events.ts:33-39`:

```ts
// The wire body cannot carry riderId. The server re-parses with its own value.
@Post()
create(
  @CurrentUser() user: JwtClaims,
  @Body(new ZodValidationPipe(rideRequestBodySchema)) body: RideRequestBody,
): Promise<RideCreated> {
  return this.rides.request(user.sub, body);
}
```

**A dev-only seam stub refuses to boot in production** — `auth.module.ts:12-27`:

```ts
export function mapsProviderSourceFactory(env: Env): MapsProvider {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'No production MapsProvider is bound: StubMapsProvider prices rides off straight-line distance and returns no polyline. Bind the Google Routes provider before running with NODE_ENV=production.',
    );
  }
  return new StubMapsProvider();
}
```

**Structured logs, `domain.component.action_state`** — `drivers.service.ts:106-113`:

```ts
this.logger.log({
  event: 'ride.request.created',
  rideId: ride.id,
  orderId: ride.orderId,
  riderId,
  status: ride.status,
  totalCents: quote.totalCents,
  commissionPct: split.commissionPct,
  commissionSource: split.commissionSource,
  at: ride.createdAt.toISOString(),
});
// NEVER log pickup/destination addresses (logging-standard.md: "addresses beyond geozone name").
```

**Row → domain mapper, then parse** — `drivers.repository.ts:50-65` + `commission.ts:78-87` (why parsing rather than asserting is worth one pass):

```ts
function toRide(row: RideRow, quote: FareQuote): Ride {
  return rideSchema.parse({
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    riderId: row.riderId,
    driverId: row.driverId,
    geozoneId: row.geozoneId,
    request: row.request,      // jsonb → z.coerce.date() re-hydrates scheduledFor
    quote,
    assignment: null,
    split: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
```

**Emit with ISO strings** — `driver-location.service.ts:61-70`; `RealtimeService.emit` parses through `RT_EVENT_SCHEMAS` and a `Date` throws:

```ts
this.realtime.joinRideRoom(riderId, ride.id);   // server-orchestrated; returns void, do not await
this.realtime.emitToRide(ride.id, RT.rideStatus, {
  rideId: ride.id,
  orderId: ride.orderId,
  status: ride.status,
  previousStatus: null,
  reason: null,
  at: ride.createdAt.toISOString(),
});
```

**Error bodies are snake_case codes** — `drivers.service.ts:84,98`: `throw new ConflictException('driver_on_ride')`. This slice adds `multi_taxi_not_supported` and `scheduled_in_past` as `BadRequestException`s.

**Tests: 1 expected + 1 edge + 1 failure per slice, named in the title** — `drivers.integration.spec.ts:88,116` and `platform-config.test.ts:11,23,27`: every `it()` ends with `(expected)`, `(edge)` or `(failure)`.

---

## IMPLEMENTATION PLAN

### Phase 1: Contracts — `@taxi/shared`

The three new schemas everything else compiles against. Nothing downstream can typecheck until `@taxi/shared` is rebuilt, so this is strictly first.

**Tasks:**

- `rideTariffSchema` in a new `schemas/tariff.ts`, exported from the barrel.
- `rideRequestBodySchema` (the wire input, `riderId` omitted) and `rideCreatedSchema` (the `POST /rides` response) in `schemas/ride.ts`.
- Tests for all three.

### Phase 2: Persistence — `@taxi/db`

**Depends on:** Phase 1 (the table mirrors `rideTariffSchema`).

**Tasks:**

- `ride_tariffs` table + both barrels.
- Generated migration `0005`.
- Four seeded Rīga tariff rows, idempotent, with fixed UUIDs.
- A constraint test for the composite unique.

### Phase 3: The maps seam — `features/geo`

**Depends on:** nothing in Phases 1–2 (it touches no shared schema and no table).
**Independent of:** Phase 4. Both are leaves; either order works.

**Tasks:**

- Haversine + `StubMapsProvider`.
- `CachingMapsProvider` over `KeyValueStore`, with a validated cache read and a versioned, coordinate-rounded key.
- `GeoModule` with the two-token binding and the production refusal.
- `MAPS_ROUTE_CACHE_TTL_SECONDS` in the env schema and `.env.example`.

### Phase 4: Platform config — `features/platform-config`

**Depends on:** nothing (the table and schema already exist).
**Independent of:** Phase 3.

**Tasks:**

- Repository read by `cityId`, parsed through `platformConfigSchema`, loud failure when the row is missing.
- Module + barrel + spec.

### Phase 5: Pricing — `features/pricing`

**Depends on:** Phases 1–4 (tariff table, maps seam, config service).

**Tasks:**

- `TariffRepository`.
- `UpfrontFixedPricingStrategy` — integer cents, minimum-fare top-up on the base line, quote parsed and asserted consistent.
- `PricingService` — route → quote → commission resolution → `splitFare`.

### Phase 6: Rides — `features/rides`

**Depends on:** Phase 5.

**Tasks:**

- Entry-status policy.
- Transactional repository write (ride + fare lines).
- Service orchestration incl. the two scope guards and the realtime emit.
- Controller, module, barrel, app-module registration.

### Phase 7: Tests, docs and the gate

**Depends on:** Phase 6.

**Tasks:**

- Harness extension (`MAPS_PROVIDER_SOURCE` override + call counting).
- Integration spec incl. the cache-hit assertion.
- `services/api/CLAUDE.md` and `.claude/references/realtime-events.md` updates.
- Full validation gate.

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

### CREATE `packages/shared/src/schemas/tariff.ts` — Task 1

- **IMPLEMENT**: `rideTariffSchema` — `id` (uuid), `cityId` (uuid), `category` (`z.enum(RIDE_CATEGORIES)`), `baseCents`, `perKmCents`, `perMinuteCents`, `minimumFareCents` (all `nonNegativeCentsSchema`), `updatedAt` (`z.coerce.date()`). Export `RideTariff = z.infer<...>`. Keep it a plain `ZodObject` — no `.refine()` — so `db/` can derive insert shapes, per the rationale in `schemas/ride.ts:39-53`.
- **PATTERN**: `packages/shared/src/schemas/platform-config.ts:9-30` — same shape, same docblock voice, same "no zod default on a business number" discipline. There is **no default anywhere in this schema**: a tariff is config, and an absent row must fail loudly rather than price a ride at zero.
- **IMPORTS**: `import { z } from "zod";`, `import { RIDE_CATEGORIES } from "../enums";`, `import { nonNegativeCentsSchema } from "../money";`
- **GOTCHA**: `perKmCents`/`perMinuteCents` are **cents per whole km / whole minute**, applied to fractional distances by `Math.round`. Say so in the docblock — a reader who assumes cents-per-metre will be off by 1000×. `minimumFareCents` is the floor the whole fare is topped up to, not an extra line.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #1 (a deterministic quote needs rates that are data, not code), AC #5 (integer cents throughout)

### UPDATE `packages/shared/src/schemas/ride.ts` — Task 2

- **IMPLEMENT**: Append two schemas after `rideRequestSchema` (line 87) and at the end of the file respectively:
  1. `rideRequestBodySchema = rideRequestSchema.omit({ riderId: true })` + `RideRequestBody`. Docblock: the rider identity is taken from the JWT, exactly as `driverLocationPingSchema` refuses to carry `driverId` (`realtime-events.ts:33-39`) — a body-supplied `riderId` would let any authenticated rider book on someone else's account.
  2. `rideCreatedSchema = z.object({ ride: rideSchema, split: fareSplitSchema })` + `RideCreated`. Docblock: **`split` here is the PLATFORM-BASE preview** (`commissionSource: "platform_base"`), computed with no driver because no driver exists at request time. #10 recomputes it per driver (a `commissionPctOverride` changes it) and #11 writes the settled one to `rides.commission_*`. Do not confuse this with `rideSchema.split`, which stays `null` until completion.
- **PATTERN**: `packages/shared/src/realtime-events.ts:89-93` — deriving a second schema from a source of truth with `.omit()`/`.extend()` rather than restating it.
- **IMPORTS**: none new — `fareSplitSchema` is already imported at line 9.
- **GOTCHA**: `.omit()` returns a `ZodObject`, so `rideRequestBodySchema` keeps `.parse()` semantics **including all the defaults** (`stops: []`, `category: 'standard'`, `options`, `vehicleCount: 1`). That is why the service can re-parse `{ ...body, riderId }` through the full `rideRequestSchema` and get an identical, fully-defaulted `RideRequest`.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #3 (invalid request rejected), AC #4 (the quote-time split is a first-class, typed response field)

### UPDATE `packages/shared/src/index.ts` — Task 3

- **IMPLEMENT**: Add `export * from "./schemas/tariff";` after the `./schemas/ride` line (line 12).
- **PATTERN**: the existing barrel ordering — enums/money/state-machine first, then schemas, then seams.
- **IMPORTS**: n/a
- **GOTCHA**: `services/api/test/global-setup.ts:16-27` fails the entire api suite if a named export is missing from the built `dist`. Forgetting this line surfaces as "Stale workspace build" rather than as a missing export.
- **VALIDATE**: `pnpm --filter @taxi/shared build && node -e "const s=require('./packages/shared/dist/index.js'); if(!s.rideTariffSchema||!s.rideRequestBodySchema||!s.rideCreatedSchema) throw new Error('missing export'); console.log('ok')"`
- **SATISFIES**: AC #1, AC #4

### CREATE `packages/shared/tests/tariff.test.ts` + UPDATE `packages/shared/tests/schemas.test.ts` — Task 4

- **IMPLEMENT**:
  - `tariff.test.ts`: **expected** — a full valid tariff parses and `updatedAt` becomes a `Date`; **edge** — `minimumFareCents: 0` is accepted (a zero floor is a real configuration, mirroring `commissionPct: 0` in `platform-config.test.ts:23`); **failure** — a float `perKmCents` (e.g. `80.5`) is rejected, *and* a tariff missing `baseCents` is rejected (there is no default — config, not constant).
  - `schemas.test.ts`: **expected** — `rideRequestBodySchema.parse(bodyWithoutRiderId)` succeeds and applies every default; **failure** — a body carrying `riderId` is *ignored* rather than trusted (assert the parsed object has no `riderId` key — `.omit()` strips unknown keys under zod's default `strip` mode); **expected** — `rideCreatedSchema` parses a `{ ride, split }` pair.
- **PATTERN**: `packages/shared/tests/platform-config.test.ts` — a shared `base` fixture object, `(expected)`/`(edge)`/`(failure)` suffixes, and a test whose comment says out loud what a future regression would mean.
- **IMPORTS**: `import { describe, expect, it } from "vitest";`
- **GOTCHA**: zod strips unknown keys silently by default — so the "ignores a body-supplied riderId" test must assert `!("riderId" in parsed)`, not that parsing throws.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #3, AC #6 (1+1+1 per schema group)

### CREATE `db/src/schema/ride-tariffs.ts` + UPDATE both db barrels — Task 5

- **IMPLEMENT**: `rideTariffs` table mirroring `rideTariffSchema`:
  ```ts
  export const rideTariffs = pgTable(
    "ride_tariffs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      cityId: uuid("city_id").notNull().references(() => cities.id),
      category: rideCategoryEnum("category").notNull(),
      baseCents: integer("base_cents").notNull(),
      perKmCents: integer("per_km_cents").notNull(),
      perMinuteCents: integer("per_minute_cents").notNull(),
      minimumFareCents: integer("minimum_fare_cents").notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("ride_tariffs_city_category_uix").on(t.cityId, t.category)],
  );
  ```
  Then add `export * from "./ride-tariffs";` to `db/src/schema/index.ts` (after `./platform-config`).
- **PATTERN**: `db/src/schema/platform-config.ts` (no column defaults on business numbers — the seed supplies them) + `db/src/schema/geo.ts:30-33` (`uniqueIndex` on a composite natural key).
- **IMPORTS**: `import { integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";`, `import { rideCategoryEnum } from "./enums";`, `import { cities } from "./geo";`
- **GOTCHA**: **No `.default()` on any of the four cent columns** — a defaulted rate is the constant this table exists to abolish. Also: `db/src/index.ts` re-exports `./schema` wholesale, so no change is needed there for the table itself — but the seed constants added in Task 7 **do** need an explicit export line.
- **VALIDATE**: `pnpm --filter @taxi/db typecheck`
- **SATISFIES**: AC #4 (commission and rates both read from config rows)

### GENERATE `db/migrations/0005_*.sql` — Task 6

- **IMPLEMENT**: Run the generator; commit the SQL, the new `meta/0005_snapshot.json` and the updated `meta/_journal.json`. Read the generated SQL and confirm it is exactly one `CREATE TABLE "ride_tariffs"`, one FK to `cities`, and one `CREATE UNIQUE INDEX ride_tariffs_city_category_uix` — nothing else. If it contains a `DROP` or touches another table, the schema drifted; stop and investigate rather than editing the SQL.
- **PATTERN**: `db/migrations/0004_vehicle_plate_unique.sql` and the existing `meta/_journal.json` entries.
- **IMPORTS**: n/a
- **GOTCHA**: Postgres must be reachable. Per the local-environment note in **VALIDATION COMMANDS → Level 0**, `localhost:5432` may be shadowed by a Homebrew postgres — use the docker container's LAN-IP `DATABASE_URL` if `drizzle-kit` reports an unexpectedly empty or foreign schema. Never hand-edit a generated migration or its snapshot.
- **VALIDATE**: `pnpm --filter @taxi/db generate && git status --short db/migrations && cat db/migrations/0005_*.sql`
- **SATISFIES**: AC #4

### UPDATE `db/src/seed/riga.ts` + `db/src/index.ts` — Task 7

- **IMPLEMENT**: Add `RIGA_TARIFF_IDS: Record<RideCategory, string>` with fixed UUIDs (`…0201`–`…0204` for `standard`/`fastest`/`limo`/`vip`), a `TARIFFS` constant, and an idempotent upsert loop inside `seedRiga` keyed on `[rideTariffs.cityId, rideTariffs.category]`. Export `RIGA_TARIFF_IDS` from `db/src/index.ts` next to `RIGA_ZONE_IDS`.

  Seed values (integer cents), fitted to the anketa's only real fares (S5-1: `centre → RIX €13`, `RIX → Teika €22`) and marked as config:
  | category | baseCents | perKmCents | perMinuteCents | minimumFareCents |
  |---|---|---|---|---|
  | standard | 200 | 80 | 15 | 350 |
  | fastest | 250 | 95 | 18 | 400 |
  | limo | 400 | 140 | 25 | 700 |
  | vip | 500 | 175 | 30 | 900 |

  Docblock, in the voice of lines 104-105: these are **placeholder config fitted to S5-1, not researched rates** — €2.00 + €0.80/km + €0.15/min reproduces the €13 centre→RIX fare at ~10.5 km / ~18 min. Only `standard` has evidence behind it; the other three are proportional placeholders awaiting Atis. #20 edits them; nothing in code may hardcode a rate.
- **PATTERN**: `db/src/seed/riga.ts:85-112` — the geozone loop and the `platformConfig` upsert, verbatim in structure.
- **IMPORTS**: add `RIDE_CATEGORIES` and `type RideCategory` to the existing `@taxi/shared` imports; add `rideTariffs` to the `../schema` import.
- **GOTCHA**: iterate `RIDE_CATEGORIES` (the shared const array) rather than `Object.keys(TARIFFS)`, so adding a category to the enum without adding a tariff fails to typecheck instead of silently seeding three rows. The seed's docblock caveat at lines 70-75 applies to these rows too.
- **VALIDATE**: `pnpm --filter @taxi/db test` (global-setup re-seeds; the suite proves the seed is re-runnable)
- **SATISFIES**: AC #4

### UPDATE `db/tests/schema-constraints.test.ts` — Task 8

- **IMPLEMENT**: Two cases: a second `ride_tariffs` row with the same `(city_id, category)` is rejected by `ride_tariffs_city_category_uix` **(failure)**, and the seed produced exactly four Rīga rows, one per `RIDE_CATEGORIES` member **(expected)**.
- **PATTERN**: the `ledger_accounts_owner_uix` case at `db/tests/schema-constraints.test.ts:63-73` — mirror its idiom exactly: `.then(() => null).catch((e: unknown) => e)`, then `expect(String((err as Error).cause)).toMatch(/ride_tariffs_city_category_uix/)`. The Postgres constraint name is on `.cause`, not on `.message`.
- **IMPORTS**: add `rideTariffs` to the schema import; `RIDE_CATEGORIES` from `@taxi/shared`.
- **NOTE — already covered, do not duplicate**: the `*_cents` sweep at `db/tests/schema-constraints.test.ts:48-61` queries `information_schema` for every `%_cents` column in the schema and asserts `integer`. It is self-extending, so **`ride_tariffs`'s four cent columns are automatically covered the moment the migration runs** — that is a large part of AC #5 proven for free. Do not add a per-column integer test.
- **GOTCHA**: the api and db suites use **different** databases (`taxi_api_test` vs the db package's own) precisely so their `DROP DATABASE`s cannot race (`services/api/test/test-db.ts:6-9`). Do not "fix" that by sharing one.
- **VALIDATE**: `pnpm --filter @taxi/db test`
- **SATISFIES**: AC #4

### UPDATE `services/api/src/common/config/env.schema.ts` + `.env.example` — Task 9

- **IMPLEMENT**: Add to `envSchema` (after `DEFAULT_CITY_ID`):
  ```ts
  /**
   * How long a routed leg stays cached. Routes barely change; durations do —
   * and upfront_fixed prices off a flat estimate anyway, so a stale duration
   * costs cents while an uncached Routes call costs money. This is THE knob
   * behind the <€100/mo guardrail.
   */
  MAPS_ROUTE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  ```
  Mirror it in `.env.example` under a new `# --- maps ---` heading, next to the existing `GOOGLE_MAPS_API_KEY` block, with a one-line comment.
- **PATTERN**: `env.schema.ts:43-45` (`API_PORT`, `DEFAULT_CITY_ID`) — `z.coerce` + a default, so nothing new is required to boot.
- **IMPORTS**: none new.
- **GOTCHA**: do **not** add it to `turbo.json`'s `globalEnv` — it has a default and is not read by any task's cache key; adding it would invalidate turbo caches for no reason.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #2 (the cache is configurable, not hardcoded)

### CREATE `services/api/src/features/geo/haversine.ts` + `stub-maps.provider.ts` — Task 10

- **IMPLEMENT**:
  - `haversineMeters(a: LatLng, b: LatLng): number` — standard great-circle, `R = 6_371_000`.
  - `StubMapsProvider implements MapsProvider`:
    - `route(from, to, stops = [])` — sum haversine over `[from, ...stops, to]`, multiply by `ROAD_WINDING_FACTOR = 1.35`, `Math.round` to whole metres; `durationSeconds = Math.round(distanceMeters / 1000 / AVERAGE_SPEED_KMH * 3600)` with `AVERAGE_SPEED_KMH = 40`; `polyline: ''`.
    - `geocode()` / `reverseGeocode()` — `throw new Error('StubMapsProvider has no geocoder: a RideRequest already carries resolved AddressPoints. Bind the Google provider when address search lands (#16).')`
  - Docblock: these two constants are **stub internals, not business config** — they exist so a quote is deterministic and free in dev, and they die with the stub. A real provider returns real numbers; nothing may read them.
- **PATTERN**: `services/api/src/features/auth/sms/stub-sms.provider.ts` — a tiny, loud, obviously-dev implementation of a seam.
- **IMPORTS**: `import type { GeocodeResult, LatLng, Language, MapsProvider, RouteResult } from '@taxi/shared';`
- **GOTCHA**: `services/api/test/harness.ts:80-95` holds its own `haversineMeters`. **Leave it alone** — its docblock says it exists to model Redis's geohash math for the location store, and merging the two would couple the drivers-slice fake to the maps stub. Two copies, two documented reasons.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1 (deterministic quote under stubbed maps)

### CREATE `services/api/src/features/geo/maps.tokens.ts` + `caching-maps.provider.ts` — Task 11

- **IMPLEMENT**:
  - `maps.tokens.ts`: `export const MAPS_PROVIDER = 'MAPS_PROVIDER';` and `export const MAPS_PROVIDER_SOURCE = 'MAPS_PROVIDER_SOURCE';` — with a docblock explaining the split: consumers inject the **cached facade**; the **source** is its own token so a test can swap the underlying implementation and still exercise the cache path (swapping `MAPS_PROVIDER` would bypass the cache entirely and the AC's cache-hit test would prove nothing).
  - `caching-maps.provider.ts`:
    - `COORD_PRECISION = 4` (≈11 m) and `routeCacheKey(from, to, stops)` → `` `maps:route:v1:${[from, ...stops, to].map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|')}` ``. Docblock: the `v1` segment is deliberate — a change to `RouteResult`'s shape bumps it instead of poisoning live cache entries; and precision is the hit-rate/accuracy knob (3 decimals ≈ 111 m would raise hit rate and cost a few cents of fare accuracy).
    - `routeResultSchema = z.object({ distanceMeters: z.number().int().nonnegative(), durationSeconds: z.number().int().nonnegative(), polyline: z.string() })` — cache reads are **parsed, not cast**. A cache entry is untrusted input like any other boundary, and a shape change mid-deploy must fail loudly.
    - `CachingMapsProvider implements MapsProvider`, constructed with `(inner: MapsProvider, kv: KeyValueStore, ttlSeconds: number)`. `route()`: `kv.get(key)` → on hit `routeResultSchema.parse(JSON.parse(hit))`; on miss call `inner.route(...)`, `kv.setWithTtl(key, JSON.stringify(result), ttlSeconds)`, return. `geocode`/`reverseGeocode` delegate straight through, uncached (nothing calls them yet; caching a call that throws is dead code).
- **PATTERN**: `services/api/src/common/kv/kv.store.ts` (the port you consume — `get`/`setWithTtl` are enough) and `realtime.service.ts:59-75` (parse before you trust).
- **IMPORTS**: `import { z } from 'zod';`, `import type { LatLng, MapsProvider, RouteResult } from '@taxi/shared';`, `import type { KeyValueStore } from '../../common/kv/kv.store';`
- **GOTCHA**: `toFixed(4)` on a negative-zero longitude yields `"-0.0000"` and on `24.1` yields `"24.1000"` — both stable, which is all the key needs. Do **not** use `JSON.stringify(latLng)` as a key: key order is stable in practice but the float text is not rounded, so `24.1` and `24.100000000000001` would be different cache entries.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #2 (cache hit on a repeated route)

### CREATE `services/api/src/features/geo/geo.module.ts` + `index.ts` — Task 12

- **IMPLEMENT**:
  - `export function mapsProviderSourceFactory(env: Env): MapsProvider` — throws under `NODE_ENV === 'production'` with the message from **Patterns to Follow**; otherwise returns `new StubMapsProvider()`.
  - `@Module({ providers: [ {provide: MAPS_PROVIDER_SOURCE, useFactory: mapsProviderSourceFactory, inject: [APP_ENV]}, {provide: MAPS_PROVIDER, useFactory: (src: MapsProvider, kv: KeyValueStore, env: Env) => new CachingMapsProvider(src, kv, env.MAPS_ROUTE_CACHE_TTL_SECONDS), inject: [MAPS_PROVIDER_SOURCE, KV_STORE, APP_ENV]} ], exports: [MAPS_PROVIDER] })` — `export class GeoModule {}`.
  - `index.ts`: export `GeoModule`, `MAPS_PROVIDER`, `MAPS_PROVIDER_SOURCE`. Add a KNOWN GAPS block in the `drivers/index.ts:9-14` voice: **no real maps provider is bound** — every quote in dev/test is straight-line × 1.35, and production cannot boot until one exists; and `geocode`/`reverseGeocode` throw, so address search (#16) must bind the Google implementation first.
  - Module docblock: why `MAPS_PROVIDER_SOURCE` is exported despite being an implementation detail (the test harness overrides it; exporting it documents that as sanctioned rather than a reach-through).
- **PATTERN**: `services/api/src/features/auth/auth.module.ts:12-27,44-55` (the factory + its docblock) and `drivers.module.ts:33-39` (`useFactory` + `inject: [APP_ENV]`).
- **IMPORTS**: `import { Module } from '@nestjs/common';`, `import type { MapsProvider } from '@taxi/shared';`, `APP_ENV`/`Env`, `KV_STORE`/`KeyValueStore`, the local files.
- **GOTCHA**: `KvModule` is `@Global()`, so `GeoModule` needs **no `imports`** to reach `KV_STORE`. Do not import `KvModule` — the drivers module doesn't, and a redundant import of a global module is noise.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #2

### CREATE the three geo specs — Task 13

- **IMPLEMENT**:
  - `stub-maps.provider.spec.ts`: **expected** — the Rīga centre `56.9496,24.1052` → RIX `56.9236,23.9711` pair. **Verified against the exact formula in Task 10: straight-line 8 634 m → `distanceMeters` 11 655, `durationSeconds` 1 049 (17.5 min).** Assert a band (11 000–12 500 m) rather than the exact integer so a float-precision change on another platform does not fail the suite, and assert `durationSeconds === Math.round(distanceMeters / 1000 / 40 * 3600)` exactly. **edge** — `route(p, p)` returns `0`/`0` (a zero-length leg must not divide by zero or go negative), and passing `stops` makes the distance strictly greater than without them; **failure** — `geocode()` throws with a message naming #16.
  - `caching-maps.provider.spec.ts` (unit, with `InMemoryKeyValueStore` from the harness and a counting fake inner provider): **expected** — first `route()` delegates once and writes the key; **edge** — a second identical call returns the same value with **no** second delegation, and a call with a different destination **does** delegate again; **failure** — a corrupt cache entry (`kv.setWithTtl(key, '{"distanceMeters":"nope"}', 60)`) makes `route()` throw a zod error rather than return garbage.
  - `geo.module.spec.ts`: the three-test `auth.module.spec.ts` shape — stub outside production **(expected)**, throws in production **(failure)**, and the `Reflect.getMetadata('providers', GeoModule)` check that `MAPS_PROVIDER_SOURCE` is actually bound to `mapsProviderSourceFactory` with `inject: [APP_ENV]` **(edge)**.
- **PATTERN**: `services/api/src/features/auth/auth.module.spec.ts` (all three cases, including the metadata assertion and its comment explaining why it exists).
- **IMPORTS**: `import { InMemoryKeyValueStore } from '../../../test/harness';`
- **GOTCHA**: these are unit specs — do not boot a Nest app. `geo.module.spec.ts` calls the exported factory directly and reads metadata; it never compiles a testing module.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api -- "features/geo"`
- **SATISFIES**: AC #2, AC #6

### CREATE `services/api/src/features/platform-config/` — Task 14

- **IMPLEMENT**:
  - `platform-config.repository.ts`: `@Inject(DRIZZLE)`; `async forCity(cityId: string): Promise<PlatformConfig>` → `select().from(platformConfig).where(eq(platformConfig.cityId, cityId)).limit(1)`; when there is no row, `throw new Error(\`No platform_config row for city ${cityId} — run the @taxi/db seed. Commission is config, not a constant: there is no default to fall back to.\`)`; otherwise `platformConfigSchema.parse(row)`.
  - `platform-config.service.ts`: a thin `PlatformConfigService` with `forCity(cityId)` delegating to the repository. It exists so #10/#20 depend on a service, not a repository, and so a cache can be added in one place later — say that in the docblock, and **do not add the cache now**.
  - `platform-config.module.ts`: providers `[PlatformConfigService, PlatformConfigRepository]`, `exports: [PlatformConfigService]`. Not `@Global()`.
  - `index.ts`: export `PlatformConfigModule` and `PlatformConfigService` only.
  - `platform-config.service.spec.ts`: **expected** — returns the parsed row with `commissionPct` from the fake db; **edge** — a `commissionPct: 0` row round-trips as `0`, not as a falsy-coerced default (this is the S6-7 pilot and the single most dangerous truthiness bug in the money path); **failure** — no row → throws with a message naming the seed.
- **PATTERN**: `drivers.repository.ts:1-11,100-107` (the `DRIZZLE` inject + a plain `select().limit(1)` read) and `requireRow` at lines 38-48 (a loud, actionable message instead of a bare undefined deref).
- **IMPORTS**: `import { platformConfig } from '@taxi/db';`, `import { platformConfigSchema, type PlatformConfig } from '@taxi/shared';`, `import { eq } from 'drizzle-orm';`, `import { DRIZZLE } from '../../common/db/db.module';`
- **GOTCHA**: parse through `platformConfigSchema` rather than returning the raw Drizzle row — the row's `commissionPct` is a `double precision` (JS `number`), and the schema is the only thing asserting it is in 0–100. Also: the repository is **not** exported from `index.ts`; the service is the slice's public API.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api -- "features/platform-config"`
- **SATISFIES**: AC #4 (commission read from `platform_config` at quote time, never a constant), AC #6

### CREATE `services/api/src/features/pricing/tariff.repository.ts` + `pricing.tokens.ts` — Task 15

- **IMPLEMENT**:
  - `pricing.tokens.ts`: `export const PRICING_STRATEGY = 'PRICING_STRATEGY';` with a docblock: one strategy is bound today (`upfront_fixed`); `taximeter`/`rider_bid` (`PRICING_MODELS`) become a keyed multi-binding when a ride actually chooses a model — not before.
  - `tariff.repository.ts`: `async forCategory(cityId: string, category: RideCategory): Promise<RideTariff>` → single-row select on the composite unique; missing row → `throw new Error(\`No ride_tariffs row for city ${cityId} / category ${category} — the @taxi/db seed is incomplete. A rate is config; there is no fallback.\`)`; otherwise `rideTariffSchema.parse(row)`.
- **PATTERN**: identical in shape to Task 14's repository — same inject, same loud-missing-row rule, same parse-on-read.
- **IMPORTS**: `import { rideTariffs } from '@taxi/db';`, `import { rideTariffSchema, type RideCategory, type RideTariff } from '@taxi/shared';`, `import { and, eq } from 'drizzle-orm';`, `DRIZZLE`.
- **GOTCHA**: a missing tariff is a **500, not a 4xx** — the request was valid; the platform is misconfigured. Do not convert it to a `BadRequestException`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #5

### CREATE `services/api/src/features/pricing/upfront-fixed.strategy.ts` — Task 16

- **IMPLEMENT**:
  ```ts
  @Injectable()
  export class UpfrontFixedPricingStrategy implements PricingStrategy {
    readonly model = 'upfront_fixed' as const;

    constructor(
      private readonly tariffs: TariffRepository,
      @Inject(APP_ENV) private readonly env: Env,
    ) {}

    async quote(request: RideRequest, route: RouteResult): Promise<FareQuote> {
      const t = await this.tariffs.forCategory(this.env.DEFAULT_CITY_ID, request.category);
      const distanceCents = Math.round((t.perKmCents * route.distanceMeters) / 1000);
      const timeCents = Math.round((t.perMinuteCents * route.durationSeconds) / 60);
      const beforeMinimum = t.baseCents + distanceCents + timeCents;
      // The minimum-fare top-up lands on the BASE line, not as a fifth line:
      // fareLineTypeEnum has exactly four values, and a total that exceeds its
      // own breakdown fails assertFareQuoteConsistent — which #11 settles and
      // #20 reports against. "The base covers the minimum" is also how a
      // taxi meter reads.
      const baseCents = t.baseCents + Math.max(0, t.minimumFareCents - beforeMinimum);
      return fareQuoteSchema.parse({
        model: this.model,
        currency: 'EUR',
        totalCents: baseCents + distanceCents + timeCents,
        breakdown: { baseCents, distanceCents, timeCents, discountCents: 0 },
      });
    }
  }
  ```
  Docblock: every line is `Math.round`ed **independently** and the total is their **sum**, never a separately-rounded product — that is what keeps `isFareQuoteConsistent` true at any input and is the same no-leak discipline as `splitFare` (`commission.ts:66-77`).
- **PATTERN**: `packages/shared/src/commission.ts:78-87` — derive-then-parse, with the parse justified in the docblock.
- **IMPORTS**: `fareQuoteSchema`, `type FareQuote`, `type PricingStrategy`, `type RideRequest`, `type RouteResult` from `@taxi/shared`; `APP_ENV`/`Env`; `TariffRepository`.
- **GOTCHA**: `readonly model = 'upfront_fixed' as const` — without `as const` TypeScript widens it to `string` and the class stops satisfying `PricingStrategy`. `discountCents` is `nonPositiveCentsSchema` (0 or negative); #23 is the only thing that will ever make it negative.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #5

### CREATE `services/api/src/features/pricing/pricing.service.ts` + module + barrel — Task 17

- **IMPLEMENT**:
  - `PricingService.quote(request: RideRequest): Promise<{ quote: FareQuote; split: FareSplit }>`:
    1. `const route = await this.maps.route(request.pickup.location, request.destination.location, request.stops.map(s => s.location));`
    2. `const quote = await this.strategy.quote(request, route); assertFareQuoteConsistent(quote);`
    3. `const config = await this.platformConfig.forCity(this.env.DEFAULT_CITY_ID);`
    4. ```ts
       // No driver exists at quote time, so the resolution can only be the
       // platform base — `CommissionDriverInput` is structural precisely so
       // "nobody yet" is expressible (commission.ts:12-20). #10 re-resolves
       // per driver once one is picked (a commissionPctOverride changes it),
       // #11 writes the settled split.
       const NO_DRIVER_YET: CommissionDriverInput = {};
       const split = splitFare(quote.totalCents, resolveCommissionPct(NO_DRIVER_YET, config));
       ```
    5. Log `ride.pricing.quote_created` with `category`, `distanceMeters`, `durationSeconds`, `totalCents`, `commissionPct`, `commissionSource`, `at` — **no addresses, no coordinates** (logging-standard.md).
    6. Return `{ quote, split }`.
  - `pricing.module.ts`: `imports: [GeoModule, PlatformConfigModule]`, providers `[PricingService, TariffRepository, { provide: PRICING_STRATEGY, useClass: UpfrontFixedPricingStrategy }]`, `exports: [PricingService]`.
  - `index.ts`: export `PricingModule` and `PricingService`. KNOWN GAPS block: only `upfront_fixed` is bound — `taximeter` and `rider_bid` are enum values with no implementation, so a request never chooses a model; `PricingService` returns a **platform-base** split, and any consumer that knows a driver (#10) must re-resolve rather than reuse it.
- **PATTERN**: `drivers.service.ts:19-29` (constructor injection + `@Inject` for tokens) and `drivers.module.ts:23-40` (imports/providers/exports with a docblock justifying the shape).
- **IMPORTS**: `Inject`, `Injectable`, `Logger` from `@nestjs/common`; `assertFareQuoteConsistent`, `resolveCommissionPct`, `splitFare`, `type CommissionDriverInput`, `type FareQuote`, `type FareSplit`, `type MapsProvider`, `type PricingStrategy`, `type RideRequest` from `@taxi/shared`; **`APP_ENV`, `type Env` from `../../common/config/env.schema`** (the service reads `env.DEFAULT_CITY_ID`); `MAPS_PROVIDER` from `../geo`; `PlatformConfigService` from `../platform-config`; `PRICING_STRATEGY` from `./pricing.tokens`.
- **GOTCHA**: `splitFare` **parses** and will throw on a `pct` outside 0–100 — that is deliberate (`commission.ts:66-77`) and must not be caught here. Also: `request.stops` is `AddressPoint[]`; `MapsProvider.route` takes `LatLng[]` — map `.location`, don't pass the points.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #4, AC #5

### CREATE the two pricing specs — Task 18

- **IMPLEMENT**:
  - `upfront-fixed.strategy.spec.ts` (unit, fake `TariffRepository`): **expected** — the standard tariff over a 10 000 m / 1 200 s route yields exactly `base 200 + distance 800 + time 300 = 1300` and `assertFareQuoteConsistent` passes (the €13 centre→RIX anchor from S5-1 — the test comment should say so); **edge** — a 400 m / 36 s route is topped up to `minimumFareCents` **on the base line**: **verified expected values are `base 309 + distance 32 + time 9 = 350`**, i.e. the total equals `minimumFareCents` exactly and the breakdown still sums to it; **failure** — a missing tariff row propagates the repository's error unchanged.
  - `pricing.service.spec.ts` (unit, fakes for maps/strategy/config): **expected** — `split.commissionPct` equals the config row's value and `split.commissionCents + split.driverNetCents === quote.totalCents`; **edge** — changing the fake config row from `15` to `12` changes the split with **no code change** (the test comment states its purpose: if this ever needs a code edit to pass, someone has turned the commission back into a constant — same intent as `platform-config.test.ts:31-34`); **failure** — an inconsistent quote from a rogue strategy makes `quote()` throw via `assertFareQuoteConsistent`.
- **PATTERN**: `services/api/src/features/drivers/vehicles.service.spec.ts` for a service-with-fakes unit spec; `platform-config.test.ts:29-39` for the "this test exists to catch a regression to a constant" comment style.
- **IMPORTS**: plain object literals cast to the port types — no `@nestjs/testing` module needed for either.
- **GOTCHA**: assert on **cent integers**, never on formatted euros; and never `toBeCloseTo` — a money assertion that tolerates drift is not a money assertion.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api -- "features/pricing"`
- **SATISFIES**: AC #1, AC #4, AC #5, AC #6

### CREATE `services/api/src/features/rides/ride-entry.ts` + spec — Task 19

- **IMPLEMENT**:
  ```ts
  /**
   * The two states a ride may be CREATED in — the state machine's ENTRY, which
   * is not a transition: `assertTransition(from, to)` needs a `from`, and a ride
   * that does not exist has no status. `.claude/references/ride-state-machine.md`
   * says it plainly: "instant rides enter at `requested`; scheduled rides enter
   * at `scheduled`".
   *
   * This is therefore the ONLY place in the slice that names a ride status, and
   * `rides.repository.ts` takes its status from here and nowhere else. Every
   * status change AFTER creation goes through `assertTransition` — #11 owns
   * those, and this slice performs none.
   */
  export const RIDE_ENTRY_STATUSES = ['requested', 'scheduled'] as const satisfies readonly RideStatus[];

  export function entryStatusFor(request: RideRequest): RideStatus {
    return request.scheduledFor ? 'scheduled' : 'requested';
  }

  export function assertEntryStatus(status: RideStatus): void { /* throws unless in RIDE_ENTRY_STATUSES */ }
  ```
  Spec: **expected** — a request with no `scheduledFor` → `'requested'`; **edge** — a request with `scheduledFor` → `'scheduled'`, and every member of `RIDE_ENTRY_STATUSES` is a real `RIDE_STATUSES` member; **failure** — `assertEntryStatus('in_progress')` throws (the guard that stops a future caller from inserting a ride mid-lifecycle).
- **PATTERN**: `services/api/src/features/drivers/location/driver-location.policy.ts` — a tiny, pure, separately-tested policy module beside the service that uses it.
- **IMPORTS**: `import { type RideRequest, type RideStatus } from '@taxi/shared';`
- **GOTCHA**: `as const satisfies readonly RideStatus[]` (not an annotation) — an annotation widens the tuple and loses the literal types, the same trap documented on `DRIVER_PRESENCE_STATUSES` (`enums.ts:22-30`).
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api -- "ride-entry"`
- **SATISFIES**: AC #2 as restated in OPEN QUESTIONS #1, AC #6

### CREATE `services/api/src/features/rides/rides.repository.ts` — Task 20

- **IMPLEMENT**: `create(input: { orderId: string; status: RideStatus; request: RideRequest; quote: FareQuote }): Promise<Ride>`, inside **one** `this.db.transaction(async (tx) => { ... })`:
  1. `assertEntryStatus(input.status)`.
  2. Insert into `rides`: `orderId`, `status`, `riderId: input.request.riderId`, `request: input.request` (jsonb), `scheduledFor: input.request.scheduledFor ?? null`, `paymentMethod`, `category`, `pricingModel: quote.model`, `totalCents: quote.totalCents`. **Leave `driverId`, `geozoneId` and all four `commission_*` columns unset.** `.returning()`.
  3. Insert the fare lines: `base` (sort 0), `distance` (1), `time` (2), and `discount` (3) **only when `discountCents !== 0`** — a zero discount line is noise in #11's settlement read.
  4. Return `toRide(row, quote)` (the mapper from **Patterns to Follow**).
  Docblock: one transaction because a ride without its breakdown is a ride #11 cannot settle and #20 cannot report; and `request` is stored as the wire snapshot (audit: "what was asked"), which is exactly the rule in `db/src/schema/rides.ts:24-28`.
- **PATTERN**: `drivers.repository.ts:50-65` (mapper + `requireRow`) and `db/src/schema/rides.ts:24-28` (the jsonb-vs-columns rule).
- **IMPORTS**: `import { rideFareLines, rides, type Db } from '@taxi/db';`, `rideSchema` + types from `@taxi/shared`, `DRIZZLE`, the local `assertEntryStatus`.
- **GOTCHA**: `request` round-trips through jsonb, so `scheduledFor` comes back as an **ISO string**; `rideSchema.parse` re-hydrates it via `z.coerce.date()` — which is why the mapper parses instead of casting. Do not add `.$onUpdate()` to `updatedAt`: the `rides_set_updated_at` trigger (migration 0003) owns it, and the reason is spelled out at `db/src/schema/rides.ts:57-62`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #2, AC #5

### CREATE `services/api/src/features/rides/rides.service.ts` — Task 21

- **IMPLEMENT**: `async request(riderId: string, body: RideRequestBody): Promise<RideCreated>`:
  1. `const request = rideRequestSchema.parse({ ...body, riderId });` — the server's identity wins; a body-supplied `riderId` was already stripped by `.omit()`.
  2. `if (request.vehicleCount > 1) throw new BadRequestException('multi_taxi_not_supported');` — comment: #22 replaces this with a fan-out into N rides sharing `orderId`.
  3. `if (request.scheduledFor && request.scheduledFor.getTime() <= Date.now()) throw new BadRequestException('scheduled_in_past');` — comment: a past pickup would enter at `scheduled` and sit there forever, because the promoting timer is #21's; rejecting it is cheaper than a support ticket.
  4. `const { quote, split } = await this.pricing.quote(request);`
  5. `const ride = await this.rides.create({ orderId: randomUUID(), status: entryStatusFor(request), request, quote });`
  6. `this.realtime.joinRideRoom(riderId, ride.id);` then `this.realtime.emitToRide(...)` with `RT.rideStatus`, `previousStatus: null`, `reason: null`, `at: ride.createdAt.toISOString()`.
  7. Log `ride.request.created` per **Patterns to Follow**.
  8. `return { ride, split };`
  Class docblock: this slice performs **no** state transition — creation is the machine's entry (see `ride-entry.ts`) — and it emits **`ride:status`, not a `ride:requested` event**, because the catalog has none by design (`realtime-events.ts:64`).
- **PATTERN**: `drivers.service.ts:74-114` — guard, act, log, return; `driver-location.service.ts:61-70` for the emit shape.
- **IMPORTS**: `import { randomUUID } from 'node:crypto';`, `BadRequestException`/`Injectable`/`Logger` from `@nestjs/common`, `RT` + `rideRequestSchema` + types from `@taxi/shared`, `RealtimeService` from `../realtime`, `PricingService` from `../pricing`, local repository + `entryStatusFor`.
- **GOTCHA**: `joinRideRoom` returns `void` and must **not** be awaited (`realtime.service.ts:46-53`). Join **before** emitting or the rider's own sockets miss the first event. If the rider has no live socket, the join is a no-op and the emit reaches nobody — that is correct: the REST response carries the same data.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #2, AC #3, AC #4

### CREATE `rides.controller.ts` + `rides.module.ts` + `index.ts`, UPDATE `app.module.ts` — Task 22

- **IMPLEMENT**:
  - Controller: `@Controller('rides')`, `@Roles('rider')`, one `@Post()` returning `Promise<RideCreated>`, body through `new ZodValidationPipe(rideRequestBodySchema)`, rider id from `@CurrentUser()`. Docblock: mirror `drivers.controller.ts:15-23` — **no `:id` routes here** (a later `@Get(':id')` would shadow nothing today but the reads belong to #11/#16), and the rider id never comes from the body or a param. Note that dispatcher-created phone orders (#19) get their own controller because they book *on behalf of* someone.
  - Module: `imports: [PricingModule, RealtimeModule]`, providers `[RidesService, RidesRepository]`, controllers `[RidesController]`, `exports: [RidesService]` (#10/#11 will consume it).
  - `index.ts`: `RidesModule`, `RidesService`. KNOWN GAPS block: a created ride is **never dispatched** (no #10), **never transitions** (no #11), and a `scheduled` ride is **inert** (no #21); `geozoneId` is always `null`.
  - `app.module.ts`: add `RidesModule` to `imports` after `DriversModule`. (`GeoModule`, `PlatformConfigModule` and `PricingModule` arrive transitively — do **not** also list them.)
- **PATTERN**: `drivers.controller.ts` (whole file) and `app.module.ts:12-20`.
- **IMPORTS**: as per the drivers controller, plus `rideRequestBodySchema`, `type RideCreated`, `type RideRequestBody`.
- **GOTCHA**: `@Roles('rider')` at class level. Guards are global and fail-closed (`services/api/CLAUDE.md`), so an unauthenticated POST is already 401 and a driver token is 403 — both are test cases, not code you write.
- **VALIDATE**: `pnpm --filter @taxi/api build`
- **SATISFIES**: AC #3

### UPDATE `services/api/test/harness.ts` — Task 23

- **IMPLEMENT**: Add `export class CountingMapsProvider implements MapsProvider` — wraps a `StubMapsProvider`, exposes `routeCalls: number` (and optionally the recorded arguments), delegates `geocode`/`reverseGeocode` straight through. Construct one in `createTestApp()`, add `.overrideProvider(MAPS_PROVIDER_SOURCE).useValue(maps)` to the chain, and add `maps: CountingMapsProvider` to `TestApp` and the returned object. Update `createTestApp`'s docblock: the swapped-provider count is now **four**, and note explicitly that the override targets the **source**, leaving `CachingMapsProvider` in the graph so the cache is exercised by the integration suite rather than stubbed away.
- **PATTERN**: `harness.ts:183-195` (`RecordingSmsProvider` — the same "record what the real thing would have done" idea) and `harness.ts:205-242`.
- **IMPORTS**: `import { MAPS_PROVIDER_SOURCE } from '../src/features/geo';`, `import { StubMapsProvider } from '../src/features/geo/stub-maps.provider';`, `import type { MapsProvider } from '@taxi/shared';`
- **GOTCHA**: `overrideProvider` resolves by token across the whole compiled graph, including providers a module does not export — so overriding `MAPS_PROVIDER_SOURCE` works even though `GeoModule` exports only `MAPS_PROVIDER`. Deep-import `StubMapsProvider` from its file (the barrel deliberately does not export it: production code must inject the token, never the class).
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api` (the existing suites must stay green — this file is shared)
- **SATISFIES**: AC #2

### CREATE `services/api/src/features/rides/rides.integration.spec.ts` — Task 24

- **IMPLEMENT**: Use `+371230` as this file's E.164 range (`phoneFor('+371230', n)` — `+371220` is taken by the drivers spec). Sign in with `role: 'rider'`. Cases:
  - **expected** — `POST /rides` with a Rīga centre → RIX pair returns **201**; parse the body through `rideCreatedSchema`; assert `ride.status === 'requested'`, `ride.quote.model === 'upfront_fixed'`, `ride.quote.totalCents > 0`, `isFareQuoteConsistent(ride.quote)`, `ride.driverId === null`, `ride.geozoneId === null`, `ride.split === null`; assert `split.commissionPct === 15` and `split.commissionSource === 'platform_base'` and `split.commissionCents + split.driverNetCents === split.totalCents === ride.quote.totalCents`; then read the DB directly and assert the `rides` row and **exactly three** `ride_fare_lines` (base/distance/time, no discount line).
  - **edge (the AC's cache assertion)** — **use a coordinate pair that appears in NO other case in this file** (e.g. Teika `56.9700,24.1800` → Ķengarags `56.9100,24.1600`, the S5-1 third trip). This matters: `createTestApp()` runs once in `beforeAll`, so the `InMemoryKeyValueStore` — and therefore the route cache — **persists across every `it()` in the file**. Reusing the centre→RIX pair from the expected case would measure a delta of **0** (already cached) and the assertion would pass for the wrong reason, or fail confusingly depending on `it()` order. Snapshot `const before = ctx.maps.routeCalls` **inside** this test, POST the same body twice, assert `ctx.maps.routeCalls - before === 1` and that both responses carry an identical `quote`; then POST a third with a **different** destination (also unique to this test) and assert the counter moved again — without that leg, a cache key that collapses every route to one entry would pass. Comment: this is the `<€100/mo` guardrail under test.
  - **edge** — a request with `scheduledFor` two hours out is created at status `'scheduled'` and `rides.scheduled_for` is set; comment: nothing promotes it (#21).
  - **failure** — `vehicleCount: 3` → **400** `multi_taxi_not_supported`; a `scheduledFor` in the past → **400** `scheduled_in_past`; a malformed body (missing `destination`) → **400** `validation_failed`; a **driver**-role token → **403**; no token → **401**.
  - **edge (identity boundary)** — a body that smuggles `riderId: <another user's id>` still creates the ride for the **authenticated** rider.
  - **No socket case in this file — deliberately.** `createTestApp()` calls `init()`, not `listen()`, and the realtime specs install their WebSocket adapter through the `configure` hook; reproducing that here is real work behind no acceptance criterion (the issue's ACs are quote, cache, rejection, contained status writes, integer cents, green gate — the emit is not one of them). Task 25 proves join-before-emit, the ISO-string `at` and `previousStatus: null` at unit level with a fake `RealtimeService`, which is where those assertions actually belong. Do not add one "while you're here".
- **PATTERN**: `drivers.integration.spec.ts` (whole file) — `createTestApp`, `signIn`, per-file phone range, `afterAll(() => ctx.app.close())`, parse every response through its shared schema.
- **IMPORTS**: `import { rideFareLines, rides } from '@taxi/db';`, `rideCreatedSchema` + `isFareQuoteConsistent` from `@taxi/shared`, `createTestApp`/`phoneFor`/`connectClient`/`closeClients` from `../../../test/harness`.
- **GOTCHA**: the api test DB is **seeded** by `global-setup.ts`, so `platform_config.commissionPct = 15` and the four tariff rows are present — the `commissionPct === 15` assertion is asserting the seed, and its comment should say so. `afterAll` must close the app or Drizzle's pool keeps jest alive (`drivers.integration.spec.ts:34-36`).
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api -- "features/rides"`
- **SATISFIES**: AC #1, AC #2, AC #3, AC #5, AC #6

### CREATE `services/api/src/features/rides/rides.service.spec.ts` — Task 25

- **IMPLEMENT**: Unit spec with fakes for `PricingService`, `RidesRepository` and `RealtimeService`: **expected** — a happy request calls `joinRideRoom` **before** `emitToRide`, and the emitted payload's `at` is an **ISO string** (not a `Date`) with `previousStatus: null`; **edge** — a `scheduledFor` request is created with status `'scheduled'`; **failure** — `vehicleCount: 2` throws `BadRequestException('multi_taxi_not_supported')` and **neither** the pricing service nor the repository is called (an unsupported request must not burn a maps call).
- **PATTERN**: `services/api/src/features/drivers/location/driver-location.service.spec.ts` — fakes as plain objects, ordering asserted via recorded call arrays.
- **IMPORTS**: `import { RT } from '@taxi/shared';`
- **GOTCHA**: assert the **order** of `joinRideRoom` vs `emitToRide` explicitly (one shared `calls: string[]`), not just that both happened — the ordering is the bug this test exists to catch.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api -- "features/rides"`
- **SATISFIES**: AC #2, AC #6

### UPDATE `services/api/CLAUDE.md` and `.claude/references/realtime-events.md` — Task 26

- **IMPLEMENT**:
  - `services/api/CLAUDE.md` — add four bullets, in the file's existing terse voice:
    1. Maps go through `MAPS_PROVIDER` (`features/geo`), which is a `CachingMapsProvider` over `MAPS_PROVIDER_SOURCE`. Tests override the **source** so the cache stays under test. `StubMapsProvider` throws at boot under `NODE_ENV=production`, like `SMS_PROVIDER`.
    2. Fares come from `ride_tariffs` rows (per city × category) and the commission from `platform_config`, both read at quote time — **no rate or percentage is ever a literal in code**.
    3. A ride is **created** at an entry status (`features/rides/ride-entry.ts`); every status change after that goes through `assertTransition` and belongs to #11. Nothing else may name a ride status.
    4. `POST /rides` takes the rider id from the JWT; `rideRequestBodySchema` has no `riderId` field, by construction.
  - `.claude/references/realtime-events.md` — in the `ride:status` row's Notes, name the emitter: *"first emitted by `features/rides` on creation (`previousStatus: null`); #11 emits it on every subsequent transition."* **No new event, no new row** — the catalog is unchanged, which is the point.
- **PATTERN**: the existing bullet style in both files — one rule per bullet, the reason inline.
- **IMPORTS**: n/a
- **GOTCHA**: `realtime-events.ts:16-21` warns that a doc-sync check slices the catalog from the `RT` block. You are adding no event, so `RT` is untouched — do not "helpfully" add a `rideRequested` key.
- **VALIDATE**: `git diff --stat services/api/CLAUDE.md .claude/references/realtime-events.md`
- **SATISFIES**: AC #7 (docs updated in the same slice)

### RUN the full gate — Task 27

- **IMPLEMENT**: Clear stale build output, run the CI-parity gate, and fix anything it surfaces. Then run the live smoke test in **VALIDATION COMMANDS → Level 4** by hand.
- **PATTERN**: `docs/build-playbook.md` — "Done = `pnpm turbo run typecheck lint test build --force` green, never say-so."
- **IMPORTS**: n/a
- **GOTCHA**: `pnpm check` is **not** the gate — it omits `build` and rides a warm `dist`. Only the `--force` turbo run from a cleared `dist` matches CI.
- **VALIDATE**: `pnpm turbo run typecheck lint test build --force`
- **SATISFIES**: AC #7, AC #8

---

## TESTING STRATEGY

Jest (`services/api`, `*.spec.ts` under `src/`, `testTimeout: 20000`) and vitest (`packages/shared`, `db`). Every `it()` title ends with `(expected)`, `(edge)` or `(failure)` — the repo reads that as its 1+1+1 proof.

### Unit Tests

| Unit | expected | edge | failure |
|---|---|---|---|
| `rideTariffSchema` | full tariff parses, `updatedAt` is a `Date` | `minimumFareCents: 0` accepted | float `perKmCents` rejected; missing `baseCents` rejected |
| `rideRequestBodySchema` / `rideCreatedSchema` | defaults applied without `riderId` | — | a smuggled `riderId` key is stripped, not trusted |
| `StubMapsProvider` | a Rīga pair returns a plausible distance/duration | zero-length leg → 0/0; stops increase distance | `geocode()` throws naming #16 |
| `CachingMapsProvider` | first call delegates + writes the key | second identical call does not delegate; a different route does | corrupt cache entry throws a zod error |
| `mapsProviderSourceFactory` | stub outside production | module metadata actually binds the factory | throws under `NODE_ENV=production` |
| `PlatformConfigService` | parsed row returned | `commissionPct: 0` survives as `0` | missing row throws naming the seed |
| `UpfrontFixedPricingStrategy` | 10 km / 20 min → 1300 cents, breakdown consistent | short ride topped up to the minimum on the base line | missing tariff propagates |
| `PricingService` | split derived from the config row | config 15→12 changes the split with no code change | inconsistent quote throws |
| `entryStatusFor` | no `scheduledFor` → `requested` | `scheduledFor` → `scheduled`; entry statuses are real statuses | `assertEntryStatus('in_progress')` throws |
| `RidesService` | `joinRideRoom` before `emitToRide`, ISO `at` | `scheduledFor` → created `scheduled` | `vehicleCount > 1` throws and calls nothing downstream |

Fixtures are plain objects cast to the port interfaces — no `@nestjs/testing` module for any unit spec (matching `driver-location.service.spec.ts`).

### Integration Tests

`rides.integration.spec.ts` boots the real module graph through `createTestApp()` with four providers swapped (`KV_STORE`, `SMS_PROVIDER`, `DRIVER_LOCATION_STORE`, `MAPS_PROVIDER_SOURCE`). Guards, pipes, JWT, Drizzle and **the caching maps decorator** are all real wiring. It covers the full request path end to end, the Postgres rows written (ride + exactly three fare lines), the cache-hit count, both scope guards, the auth/role boundary, and the identity boundary.

### Edge Cases

- **Zero-length route** (pickup == destination): distance 0, duration 0 → the minimum-fare top-up is the only thing keeping the fare positive. Covered in the strategy spec.
- **Minimum-fare top-up and breakdown consistency**: the topped-up base must keep `isFareQuoteConsistent` true — the single most likely arithmetic regression in this slice.
- **`commissionPct: 0`** (the evidenced S6-7 pilot): must survive as `0` through `resolveCommissionPct` (`!= null`, never truthiness) and `splitFare` → `commissionCents: 0`, `driverNetCents === totalCents`.
- **Repeated identical route**: exactly one provider call. Also the *different* route case, or a broken cache key that returns everything from one entry would pass.
- **Corrupt / stale-shape cache entry**: parsed, so it throws rather than returning `NaN` cents.
- **`scheduledFor` in the past** → 400; **`scheduledFor` in the future** → created inert at `scheduled`.
- **`vehicleCount > 1`** → 400 before any maps call.
- **Body-supplied `riderId`** → ignored; the ride belongs to the JWT's subject.
- **Missing `platform_config` row / missing tariff row** → loud 500 naming the seed, never a defaulted percentage or rate.
- **Stops**: a request with intermediate stops routes through them (distance strictly greater) and prices off the full leg.
- **Wrong role / no token** → 403 / 401 from the global guards.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness. Run from the repo root.

### Level 0: Prerequisites (once, before Task 5)

```bash
docker compose up -d --wait   # postgis + redis — needs .env for REDIS_PORT
docker ps                     # both healthy
pnpm install
```

**Local-environment note (this machine):** `localhost:5432` and `localhost:6379` can be shadowed by a Homebrew postgres and other projects' containers. If `drizzle-kit generate` sees an unexpected schema, or the api suite connects to the wrong database, point `DATABASE_URL` at the docker container's LAN IP rather than `localhost`, and set `REDIS_PORT`/`REDIS_URL` to a free port (`.env.example:6-9` documents the redis half). Do not smoke-test against a port you have not confirmed is the compose container.

### Level 1: Syntax & Style

```bash
pnpm turbo run typecheck lint
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm turbo run test --filter @taxi/api -- "features/(geo|pricing|platform-config)|ride-entry"
```

The pattern is passed **positionally**, not as `--testPathPattern`. This repo is on **jest 30.4.1**, where that flag was renamed to `--testPathPatterns` (plural); the positional form has worked in every version and sidesteps the question. Verified with `pnpm --filter @taxi/api exec jest --help | grep testPathPattern`.

### Level 3: Integration Tests

```bash
pnpm --filter @taxi/db test                 # migration + seed + constraints
pnpm turbo run test --filter @taxi/api      # full api suite, deps rebuilt first
```

`pnpm turbo run test --filter @taxi/api`, **not** `pnpm --filter @taxi/api test` — the latter skips `^build` and `global-setup.ts:13-27` will fail the suite against a stale `dist` (which is the guard working, but it costs you a cycle).

### Level 4: Manual Validation

```bash
pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db seed
pnpm --filter @taxi/api dev                 # separate terminal

# 1. sign in as a rider (the stub SMS provider logs the code to the api console)
curl -s localhost:3001/auth/otp/request -H 'content-type: application/json' \
  -d '{"phone":"+37129999999","role":"rider"}'
CODE=<from the api console>
TOKEN=$(curl -s localhost:3001/auth/otp/verify -H 'content-type: application/json' \
  -d "{\"phone\":\"+37129999999\",\"code\":\"$CODE\"}" | jq -r .accessToken)

# 2. request a ride: Rīga centre → RIX
curl -s -X POST localhost:3001/rides -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{
    "pickup":{"location":{"lat":56.9496,"lng":24.1052},"address":"Brīvības iela 1, Rīga"},
    "destination":{"location":{"lat":56.9236,"lng":23.9711},"address":"Lidosta RIX"},
    "paymentMethod":"card"
  }' | jq '{status:.ride.status, model:.ride.quote.model, total:.ride.quote.totalCents,
            breakdown:.ride.quote.breakdown, pct:.split.commissionPct,
            src:.split.commissionSource, commission:.split.commissionCents, net:.split.driverNetCents}'
# expect: status "requested", model "upfront_fixed",
#         total 1394 cents (€13.94) with the seeded standard tariff and the
#         stub's 11 655 m / 1 049 s route — base 200 + distance 932 + time 262.
#         Compare against S5-1's real €13 for this exact trip.
#         pct 15, src "platform_base", commission 209 + net 1185 == total

# 3. the cache: run step 2 again and watch the api log — exactly one
#    ride.pricing.quote_created per request, and NO second stub route computation.
#    Confirm the key exists (adjust host/port to your compose redis):
redis-cli --scan --pattern 'maps:route:v1:*'

# 4. commission is CONFIG, not a constant — change it and re-quote:
psql "$DATABASE_URL" -c "UPDATE platform_config SET commission_pct = 12;"
#    re-run step 2 → split.commissionPct is 12, with no restart and no code change
psql "$DATABASE_URL" -c "UPDATE platform_config SET commission_pct = 15;"

# 5. the two scope guards
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3001/rides \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"pickup":{"location":{"lat":56.95,"lng":24.10},"address":"a"},
       "destination":{"location":{"lat":56.92,"lng":23.97},"address":"b"},
       "paymentMethod":"cash","vehicleCount":3}'          # expect 400

# 6. the production refusal
NODE_ENV=production pnpm --filter @taxi/api start:prod    # expect a boot error naming MapsProvider
```

### Level 5: The gate (CI parity — this is "done")

```bash
rm -rf packages/*/dist db/dist services/api/dist
pnpm turbo run typecheck lint test build --force
```

---

## ACCEPTANCE CRITERIA

Numbered so every task above can point at one. AC #1–#3 restate the issue's three named test cases; #4–#8 restate its remaining bullets.

- [ ] **AC #1 — Deterministic quote under stubbed maps (expected).** `POST /rides` returns an `upfront_fixed` quote whose breakdown sums to its total, computed from a `ride_tariffs` row and a `MapsProvider` route. Identical inputs give identical cents, asserted in both a unit and an integration test.
- [ ] **AC #2 — Cache hit on a repeated route (edge).** A second identical route does not reach the provider; asserted by call count in the integration suite with the real `CachingMapsProvider` in the graph. The TTL is env-configurable.
- [ ] **AC #3 — Invalid request rejected (failure).** Malformed body → 400 `validation_failed`; `vehicleCount > 1` → 400 `multi_taxi_not_supported`; past `scheduledFor` → 400 `scheduled_in_past`; wrong role → 403; no token → 401.
- [ ] **AC #4 — Commission read from `platform_config` at quote time, never a constant.** `resolveCommissionPct` + `splitFare` produce the returned split; changing the config row changes the result with no code change (tested); no percentage or rate literal exists anywhere in the new code; tariffs are seeded rows, not constants.
- [ ] **AC #5 — Integer cents throughout.** Every money value is `z.number().int()`-backed; each fare line is rounded independently and the total is their sum; no float arithmetic on money; no `toBeCloseTo` in a money assertion.
- [ ] **AC #6 — ≥1 expected + 1 edge + 1 failure per slice** (`geo`, `platform-config`, `pricing`, `rides`, plus each new shared schema).
- [ ] **AC #7 — Status writes are contained.** Exactly one place in the slice names a ride status (`ride-entry.ts`), and it is the machine's documented entry; no transition is performed anywhere in this slice; `services/api/CLAUDE.md` records the rule. *(See OPEN QUESTIONS #1 — this is the restated form of the issue's "transitions only via `assertTransition`", and it is a flagged divergence from the literal wording.)*
- [ ] **AC #8 — `pnpm turbo run typecheck lint test build --force` green** from a cleared `dist`, with no regressions in the auth, realtime, drivers, shared or db suites.
- [ ] **AC #9 — No new socket event.** The `RT` catalog is byte-identical; creation emits `ride:status` with `previousStatus: null`; `.claude/references/realtime-events.md` names the new emitter.

---

## COMPLETION CHECKLIST

- [ ] All 27 tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration, all four packages)
- [ ] No linting or type checking errors
- [ ] Manual Level 4 smoke test confirms the quote, the cache, the config-not-constant behavior and the production refusal
- [ ] Acceptance criteria AC #1–#9 all met
- [ ] `services/api/CLAUDE.md` + `.claude/references/realtime-events.md` updated in this same slice
- [ ] Every new file ≤500 lines; each slice's `index.ts` is its only public API
- [ ] Divergences from this plan recorded for the report (`.claude/reports/api-rides-pricing-report.md`) and for the PR body

---

## OPEN QUESTIONS / ASSUMPTIONS

Three of these are **resolutions of a conflict between the ticket text and the shipped contracts**. Read them before Task 1; if Linards disagrees with any, the plan changes before implementation, not after.

**1. "Persist via `assertTransition()` into `requested`" — restated, not implemented literally.**
`assertTransition(from, to)` requires a `from`, and `ALLOWED_TRANSITIONS` has no initial pseudo-state. A ride that does not exist has no status, so **creation is not a transition** — which is exactly what `.claude/references/ride-state-machine.md` says: *"instant rides enter at `requested`; scheduled rides enter at `scheduled`."* Adding an `initial` state to the shared machine to make the call literal would change a #2 contract every surface imports, to satisfy wording rather than a behavior.
**Resolution:** creation writes an entry status through the single, separately-tested `ride-entry.ts` policy, and this slice performs **zero** transitions (there is nothing to transition *to* until #10/#11). AC #7 is the restated form. **If Linards wants the literal call, the change is to `@taxi/shared` (add an initial state to `ALLOWED_TRANSITIONS`) and it should be its own ticket** — say so and this plan drops `ride-entry.ts` in favor of it.

**2. "Emit `ride:requested`" — emitting `ride:status` instead.**
There is no `ride:requested` in `RT`, and `realtime-events.ts:64` says why in as many words: *"Emitted on every state-machine transition — which is why there is no separate `ride:requested`."* Adding one would duplicate the catalog and break the doc-sync convention.
**Resolution:** emit `RT.rideStatus` with `status: 'requested'`, `previousStatus: null`. AC #9. No shared change.

**3. "The quote embeds the commission split via `resolveCommissionPct(config)`" — returned, not persisted.**
The per-driver commission is unknowable at request time (`commissionPctOverride` lives on the driver), and `db/src/schema/rides.ts:51-55` reserves the four `commission_*` columns for #11's **settled** split. Writing a platform-base split into them now would make a preview look like a settlement.
**Resolution:** `POST /rides` returns `{ ride, split }` (new `rideCreatedSchema`), where `split` is the **platform-base preview** — commission read from `platform_config` at quote time, exactly as the ticket asks, materialized as a `FareSplit`, and persisted nowhere. #10 re-resolves per driver for the offer card; #11 writes the settled one. **Assumption to confirm: showing the rider a commission line is acceptable** — Sakta Cab's pitch is transparency and "money stays in Latvia", so this reads as a feature, but it is a product call nobody has made. If it should be driver/dispatch-only, drop `split` from the response and expose it through the pricing barrel for #10 alone (a ~10-line change).

**4. Tariff rates are invented, and marked as such.**
No rate card exists anywhere in the repo or the anketa. The seeded `standard` tariff (€2.00 + €0.80/km + €0.15/min, €3.50 minimum) is **fitted to the only real data that exists** — S5-1's `centre → RIX €13` at ~10.5 km / ~18 min, which it reproduces to within €0.10, and `RIX → Teika €22` to within €2. The other three categories are proportional placeholders with **no evidence at all**. They are config rows so #20 can fix them without a deploy, and this is exactly the treatment root `CLAUDE.md` prescribes ("treat related code as config, not constants"). **Needs Atis's real numbers before any pilot.**

**5. New table + new shared schemas inside an api ticket.**
The ticket's file estimate names only `services/api/src/features/{rides,pricing}/**`. This plan also touches `packages/shared` (3 schemas), `db/` (1 table + migration + seed), and creates two extra api slices (`geo`, `platform-config`). Each is justified above, but the diff will be meaningfully larger than the ticket's ~800–1300-line estimate — call it ~1400–1800 including tests. **Nothing here is optional**: without a tariff there is no quote, without a maps binding there is no route, and without a config read the commission is a constant.

**6. `features/geo` and `features/platform-config` as separate slices — a judgment call.**
Both could have lived inside `pricing/`. They don't, because #10 needs `MAPS_PROVIDER` for ETAs and `PlatformConfigService` for `offerTimeoutSeconds`/`defaultDispatchMode`, and reaching those through the *pricing* barrel would be a lie about ownership that spreads. `geo` is a slice name `services/api/CLAUDE.md` already lists. `platform-config` has no controller yet — #20 adds admin routes to it. The alternative (put `platform-config` under `src/common/` next to the env config) was considered and rejected: `common/` is Nest plumbing, and a table holding the commission percentage is domain data.

**7. Deferred to the tickets that own them, deliberately:** geozone resolution (#10 — overlapping-zone precedence is called out as its problem), the scheduled-ride timer (#21), multi-taxi fan-out (#22), ride reads (#11/#16), the real Google provider (#13/#16), and a rider-facing quote-preview endpoint (#16, if its UX needs a price before commit).

**8. Cache precision and TTL are guesses.** 4 decimal places (≈11 m) and 24 h. Both are one-constant changes and both are documented at their definition. Real hit rates are unmeasurable until there is traffic; revisit when the first Google bill exists.

---

## NOTES (open canvas)

### The dependency picture

```
POST /rides  (rides.controller — @Roles('rider'), rider id from JWT)
      │
      ▼
RidesService ──guards──► vehicleCount > 1 → 400 · past scheduledFor → 400
      │
      ├──► PricingService
      │        ├──► MAPS_PROVIDER  = CachingMapsProvider( MAPS_PROVIDER_SOURCE , KV_STORE , ttl )
      │        │                                          └─ StubMapsProvider (throws in prod)
      │        ├──► PRICING_STRATEGY = UpfrontFixedPricingStrategy ──► TariffRepository ──► ride_tariffs
      │        └──► PlatformConfigService ──► platform_config ──► resolveCommissionPct + splitFare
      │
      ├──► RidesRepository  ── one transaction ──► rides + ride_fare_lines
      │
      └──► RealtimeService  ── joinRideRoom(rider) ──► emitToRide(RT.rideStatus)
```

### Why the maps cache is decorated, not baked in

`CachingMapsProvider` implements the same seam it wraps, so the cache is invisible to every consumer and the real Google provider (#13/#16) drops into `MAPS_PROVIDER_SOURCE` with the caching untouched. The alternative — caching inside a `GoogleMapsProvider` — would mean the stub is uncached (so the AC's cache test proves nothing about production) and the cache is untestable without a real key. The two-token split exists so the integration suite exercises the *real* cache against a *fake* source, which is the only arrangement where "cache hit on a repeated route" is a meaningful assertion.

### Why the minimum fare tops up the base line

`fareLineTypeEnum` has exactly four values, and `isFareQuoteConsistent` requires `base + distance + time + discount === total`. A separate "minimum adjustment" line would need a migration of the enum; a total that silently exceeds its breakdown would fail the predicate #11 settles against and #20 reports off. Folding the top-up into `baseCents` keeps one invariant true, needs no migration, and matches how a taxi meter reads ("the drop covers the first bit"). The alternative considered and rejected: scale all three lines proportionally to reach the minimum — arithmetically fine, but it makes `distanceCents` a number that does not correspond to the distance, which is a lie the driver's transparency card would repeat.

### Rejected: resolving the geozone at request time

`rides.geozone_id` is right there and one `ST_Contains` away. Rejected because the seed's own docblock (`db/src/seed/riga.ts:20-23`) says Vecrīga deliberately overlaps centre and *"zone-resolution precedence is #10's problem"* — resolving it here would mean inventing a precedence rule in the wrong ticket, and #10 would then have to either trust or re-derive it. Leaving it `null` is the honest state: this slice does not know which zone the ride belongs to.

### Rejected: a `ride_tariffs` row per city only, with per-category multipliers

A single tariff plus `{standard: 1.0, fastest: 1.2, limo: 1.8, vip: 2.2}` is fewer rows and fewer seeds — but the multipliers would be **constants in code**, which is the exact thing the architecture's commission decision forbids by analogy. Four rows cost one loop in the seed and make every rate editable from #20 without a deploy.

### Rejected: `POST /rides/quote` (price preview without booking)

Real product need — Bolt shows a price before you confirm — but the ticket's scope is "a ride exists and has a price", and the POST response already carries the quote. A preview endpoint that quotes without persisting is #16's to ask for, and it will want `PricingService.quote()` exactly as this plan exposes it. Adding it now would be a second uncovered route in a slice that is already four folders.

### What #10 gets from this slice, and how

Through barrels only: `MAPS_PROVIDER` (`features/geo`) for driver→pickup ETAs · `PlatformConfigService` (`features/platform-config`) for `offerTimeoutSeconds`, `defaultDispatchMode`, `unclaimedAlertSeconds` · `RidesService` (`features/rides`) to read the ride it is dispatching · and `splitFare(quote.totalCents, resolveCommissionPct(driver, config))` from `@taxi/shared` to build the offer's per-driver split — **not** the platform-base split this slice returns. If #10 reuses this slice's `split`, a driver with a `commissionPctOverride` sees the wrong number on the one card the whole pitch rests on. That sentence belongs in the pricing barrel's KNOWN GAPS block.

### Request/response surface, in one table

| Method | Path | Role | Body | Success | Failures |
|---|---|---|---|---|---|
| POST | `/rides` | `rider` | `rideRequestBodySchema` | `201` `{ ride, split }` (`rideCreatedSchema`) | `400 validation_failed` · `400 multi_taxi_not_supported` · `400 scheduled_in_past` · `401` (no token) · `403` (wrong role) · `500` (no config/tariff row — misconfiguration, loud on purpose) |

### How the top risks were bought down

| Risk | Bought down by |
|---|---|
| A cache that never hits (silent €400 Google bill) | Integration test asserts the provider call **count**, with the real decorator in the graph — plus a *different*-route case so a broken key can't fake it |
| A stub pricing real rides in production | `mapsProviderSourceFactory` throws at boot; a metadata test proves the module binds the factory, not the class |
| Commission quietly becoming a constant | `platformConfigSchema.commissionPct` has no default (already), `PlatformConfigService` throws on a missing row, and a spec asserts a config change moves the split with no code change |
| A cent leaking between quote and split | `splitFare` derives the net by subtraction and parses; `assertFareQuoteConsistent` runs on every quote; the integration test re-asserts both on the wire |
| A ride written mid-lifecycle by a future caller | `assertEntryStatus` inside the repository transaction, plus a failure test |
| Stale `dist` making the suite lie | Already guarded by `global-setup.ts`; the plan's commands use `pnpm turbo run test --filter @taxi/api` everywhere |

### Confidence

**9.5/10** for one-pass success. The codebase is unusually well-documented, every pattern this slice needs already exists in the drivers/auth slices, and the three contract conflicts are resolved in writing before a line is written. The half point is the socket assertion in Task 24 (an area where a first attempt can be flaky) — which is why that task carries an explicit, pre-authorized fallback to a unit-level emit assertion rather than a debugging spiral.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty until this plan has been executed. -->
