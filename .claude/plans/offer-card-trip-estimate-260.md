# Feature: the offer card shows trip duration and €/km (#260)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

Every `file:line` below was read on `origin/main` at `d14759a` (2026-09-26). Re-read before editing; lines drift.

**Reference implementation: `.claude/plans/offer-card-trip-estimate-260.patch`.** Every task below was prototyped in a throwaway worktree at `d14759a` on 2026-09-26, and the full gate was run against it (see "Prototype evidence" below). The patch covers T1–T11 except the generated migration, which T3 regenerates, and the T12 prose. Use it as the answer key: apply it with `git apply --3way .claude/plans/offer-card-trip-estimate-260.patch` (the file stays untracked; copy it into the worktree first), then **still run every task's VALIDATE**, because a patch that applies is not a patch that passes. Before applying, check it: `git apply --check` was clean on `origin/main` at `d14759a` (`observed`). If `main` has moved and `--check` fails, implement from the task text, which matches the patch.

**Work in a worktree off `origin/main`.** The main checkout is on `feature/skip-rider-sms-app-bookings-135` at `f2cc6c4`, a branch whose PR #253 merged on 2026-09-22 (`gh pr view 253 --json headRefOid` = `f2cc6c4`, `observed` 2026-09-26). It is 15 commits behind `origin/main`, so a patch check there fails. Concurrent sessions share that checkout (CLAUDE.md), which is the reason to work in a worktree. **Move** this plan and the patch into the worktree; do not copy them. An untracked copy left in the main checkout blocks `git checkout main` once the branch commits a different version (memory: stale untracked drafts). Run the gate there with `COMPOSE_PROJECT_NAME=taxi`, and give the worktree an env file first (memory: worktree `.env` → Redis hang). The PreToolUse hook refuses any shell command whose text names that file. The prototype got around this with a scratchpad Python script that builds the file from the committed `.example` template, setting `DATABASE_URL` to the LAN IP (`192.168.1.11:5432`, because `localhost:5432` is shadowed by brew pg) and Redis to 6381. That file holds no secrets. If colima's docker socket is dead ("empty value"), run `colima stop && colima start`, then `COMPOSE_PROJECT_NAME=taxi docker compose up -d --wait` from the main checkout. That happened during the prototype.

## Prototype evidence (`observed`, 2026-09-26, throwaway worktree at `d14759a`, since deleted)

| Check | Result |
|---|---|
| Full gate `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`, from cleared `dist` + `.next` | exit 0, **22 successful, 22 total** |
| Test counts in that run | shared 279 · db 17 · dispatch 272 · driver 284 · rider 176 · api **868 passed, 868 total** (Redis set, nothing skipped) |
| `git apply --check` of the patch on a fresh `origin/main` worktree | clean |
| Line counts (`wc -l` on a fresh `origin/main` worktree with the post-prettier patch applied) | `rides.repository.ts` **408** after T5's `ride-row.ts` move (second prototype; it was 498 with `toTrip` inline and 489 with a one-function `ride-trip.ts`) · new `ride-row.ts` 114 · `rides.service.ts` 485 · `dispatch.service.ts` 426 · `lv.ts` 495 · `ride.ts` 451 |
| Second prototype (R1's `ride-row.ts` move added), same gate command and base `d14759a`, 2026-09-26 | exit 0, **22 successful, 22 total**; driver 284 · rider 176 · api **868 passed, 868 total**, 87 suites; the regenerated patch passes `git apply --cached --check` against `origin/main` |
| Migration `pnpm --filter @taxi/db generate` | `0013_cute_prima.sql`: exactly two `ADD COLUMN … integer` lines |
| T7/T9 mutation: drop `trip: input.trip` | typecheck **red** (TS1360, `satisfies RideOffer`); jest **3 red**: `buildOffer › carries the ride's trip…`, `dispatch (integration) › sends the offer over the socket…`, `…› pushes every offer…`; legacy-null test **green** (1 passed, alone via `-t`) |
| Worst-case offer JSON with `trip` (all numbers at max width, 1-char addresses) | **848 B**, leaving **1 200 B** for the two addresses under the 2 048 B cap |

What the prototype changed in this plan, all folded into the tasks below:
1. **`satisfies RideOffer` in `buildOffer`** (T7) turns a forgotten `trip` into a compile error. That removes the silent-default risk D3 introduced.
2. **The row projections move to `rides/ride-row.ts`** (T5). With `toTrip` inline, `rides.repository.ts` reached 498/500 after prettier. A one-function `ride-trip.ts` left it at 489, 11 lines short of the cap, so the next ticket to touch the file would have had to split it anyway (R1). Moving `toRide`, `toAwaiting`, `AwaitingRide` and `toTrip` together takes it to 408.
3. **Two more fixtures break than first listed** (T1b): `offer-builder.spec.ts`'s `base` object (`BuildOfferInput` requires `trip`, 7 errors) and the three annotated literals.
4. **`pendingFor` must default `trip` to `null`** (T10). With the stub trip as default, the #263 test's `not.toMatch(/18/)` goes red, because 1 049 s renders as "18 min".
5. **The driver app tests run on jest (`jest-expo`), not vitest.** Commands are corrected below.
6. **`services/api` jest needs Postgres even for unit specs** (`test/global-setup.ts:36` refuses without it). Start compose before T4.

## Feature Description

The driver's offer card shows fare, what the driver keeps, payment method, addresses and pickup ETA. It does not show how long the trip is or what it pays per km, because no contract carries the trip's distance or duration. `PricingService.quote` already has both (`RouteResult` from the maps seam). It logs them and then drops them (`pricing.service.ts:42-75`).

This ticket keeps them. They are stored on the ride, carried on the offer, and rendered on the card as one line: `Brauciens ~18 min · 11.7 km · €0.90/km`.

## User Story

As a driver deciding whether to accept an offer
I want to see the trip's duration and what I earn per km before the countdown runs out
So that I do not have to work out whether a ride pays in my head, which the evidence says drivers do when the card leaves it out (`docs/research/driver-ux-evidence.md` §1.3)

## Problem Statement

- `fareQuoteSchema` (`packages/shared/src/schemas/ride.ts:35-47`) holds money only. `breakdown.distanceCents` and `timeCents` are amounts, not measurements. The issue cites `:28-39`; #258 moved it.
- `rideOfferSchema` (`ride.ts:194-217`) has `etaSeconds`, but that is the **pickup** ETA, not the trip.
- The issue says "the persisted quote (`rides.quote`)". **No such column exists.** A ride's quote is `rides.pricing_model` + `rides.total_cents` (`db/src/schema/rides.ts:63-64`) plus `ride_fare_lines` rows (`:133-146`). `ride_offers.quote` (`:168`) is a jsonb audit snapshot that is written and never read back as a `FareQuote` (`dispatch.repository.ts:80-94` writes it; the only `rideOffers` read of a jsonb column is `split`, `ride-lifecycle.repository.ts:87`).
- `docs/research/driver-ux-evidence.md:26` says "All fields are already in Sakta's data model". For duration and €/km that is false.

## Solution Statement

**D1 — the figures belong to the route, not the quote.** The issue asks the plan to decide this. They go on a new `tripEstimateSchema = { distanceMeters, durationSeconds }` carried as `rideOfferSchema.trip`. They do **not** go on `FareQuote`. Reasons, each readable in source:

1. `FareQuote` is rebuilt from columns in two readers: `RidesRepository.findWithQuote` (`rides.repository.ts:315-359`) and settlement (`settlement.repository.ts:15-16`). Both would have to carry measurements that have nothing to do with money.
2. Every `PricingStrategy` returns a `FareQuote` (`seams/pricing-strategy.ts:11-14`). A future `rider_bid` or `taximeter` strategy would have to echo back a measurement it never computed, and nothing would stop one from echoing it wrong.
3. The preview (`rideQuotePreviewSchema`, `ride.ts:168`) and the rider's ride read both carry `FareQuote`. Neither needs a route, and D1 leaves them unchanged.

The seam the issue points at (`seams/maps-provider.ts:22-27`, `RouteResult`) is already where these numbers come from. D1 carries them through; it does not add a seam.

**D2 — storage: two nullable integer columns on `rides`**, `trip_distance_meters` and `trip_duration_seconds`. They are nullable because existing rows never had them. `findWithQuote` projects `trip` only when both are non-null. `ride_offers` is not changed, because the trip lives on an immutable ride row. So "what was shown" for audit is the ride's columns joined to the offer. There is no per-offer snapshot to diverge from.

**D3 — `rideOfferSchema.trip: tripEstimateSchema.nullable().default(null)`.** The field is nullable for legacy rides. It has a default, unlike `paymentMethod` (`realtime-events.md:10`), so that deploy order does not matter. A new driver binary that `parse`s an old api's `ride:offer` gets `trip: null` and shows the card without the line. It does not drop the offer.

The default has a cost: on its own, it would let a forgotten `trip:` key on the api side parse silently to `null`. Two compile-time guards close that. `BuildOfferInput.trip` is required, which covers the callers. `buildOffer`'s literal is `satisfies RideOffer`, which covers its inside: dropping the key is TS1360 (`observed`). The runtime tests are the second guard; under the same mutation, 3 named tests go red (T7 and T9 mutation steps).

**D4 — €/km = the driver's net ÷ trip km** (user decision, 2026-09-26). The rate is computed on the client, as the evidence doc (§1.3) and #15's re-slice both specify. It is integer cents per km:

- Formula: `Math.round(split.driverNetCents * 1000 / trip.distanceMeters)`, formatted with `formatEur`.
- Example (`derived`): net 1054 c over 11 655 m gives 90.43, which rounds to 90 c, shown as `€0.90/km`.

**D5 — the line is omitted when there is nothing true to show:** `trip === null` (legacy ride or old api), or `distanceMeters < 50` (pickup equals destination, which the stub can return — `api-rides-pricing.md:566` pins `route(p, p)` → `0/0` — or a route so short that `toFixed(1)` prints "0.0 km" beside a rate divided by the real metres; amended after PR #284 review F1). The rest of the card is unchanged in both cases.

Card rendering:

- The line goes inside `offer-details`, which glance mode hides (§5.2).
- In the one-node a11y label it sits after the destination.
- Minutes use `Math.ceil`, matching the pickup ETA (`offer-card-props.ts:73`). Km use `toFixed(1)`, matching `:74`.

## Out of Scope / Non-Goals

- **Not changing `FareQuote`**, the pricing strategies, the preview response, the rider app, or settlement (D1).
- **Not adding a trip snapshot to `ride_offers`** (D2).
- **Not putting `trip` on `rideSchema` / `driverRideSchema`.** The active-ride screen does not show it. If it ever should, that is a separate ticket, and the columns are already there.
- **Not adding pickup km to the rate** (D4). Pickup km stays the straight-line figure it is today (`offer-card-props.ts:34`).
- **Not adding rider rating** to the card. That is the third field `driver-offers-active-ride.md:51` deferred, and it has no contract either.
- **Not backfilling legacy rides.** A null trip is a supported state (D5).
- **Not fixing the stub's accuracy.** Until #134 binds OSRM, trip figures are haversine × 1.35 at a flat 40 km/h (`stub-maps.provider.ts:20-21`), the same basis the fare already uses. See Q1.

## Feature Metadata

**Feature Type**: Enhancement
**Estimated Complexity**: Medium (four surfaces, all changes additive, one migration)
**Primary Systems Affected**: `packages/shared` (schema, i18n), `db` (2 columns), `services/api` (pricing, rides, dispatch), `apps/driver` (offer card)
**Dependencies**: none new

## Related Work

**Implements**: [#260](https://github.com/linardsb/taxi/issues/260) · **Epic**: [#15](https://github.com/linardsb/taxi/issues/15) (2026-08-07 re-slice: "destination + trip duration … €/km (client-computed)"); architecture `docs/epics/sakta-cab.architecture.md` (maps stub until #134, lines 108-116)

**Back-references**:

- `.claude/plans/driver-offers-active-ride.md:51,604`: deferred these fields and rejected a haversine €/km ("straight-line overstates the rate; wait for the quote to carry the routed distance"). This ticket is that wait ending.
- `.claude/plans/driver-15-offers-device-pass.md:189,568-571`: filed this ticket and flagged the evidence-doc error.
- `.claude/plans/api-rides-pricing.md:527,566`: the stub's formula and its `0/0` edge.
- `.claude/plans/pickup-pin.md` (#258): the precedent for a sibling field on `findWithQuote`.

**Forward-references**: (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `packages/shared/src/seams/maps-provider.ts:11-27`: `RouteResult`. The whole-units invariant lives in prose here.
- `services/api/src/features/geo/caching-maps.provider.ts:119-121,266-269`: `routeResultSchema` is `.int().nonnegative()`, and the write path `Math.round`s. `geo.module.ts:125-126` binds `MAPS_PROVIDER` (the provider `PricingService` injects) to `CachingMapsProvider`. **This is what makes the new `integer` columns safe.** A fractional value would otherwise fail the insert.
- `services/api/src/features/geo/stub-maps.provider.ts:47-60`: the dev/pilot route, with `Math.round` on both figures.
- `services/api/src/features/pricing/pricing.service.ts:33-76`: `quote()` holds `route` and drops it after logging.
- `services/api/src/features/rides/ride-quote.service.ts:76-78`: the preview destructures `{ quote }` only, so it is unaffected by a wider return.
- `services/api/src/features/rides/rides.service.ts:255-293`: `createRide`, the single write path for app and phone bookings.
- `services/api/src/features/rides/rides.repository.ts:65-82` (`CreateRideInput`), `:151-199` (`create`), `:293-359` (`findWithQuote`, and the `pickupPin` sibling precedent at `:311-318`, `:358`).
- `db/src/schema/rides.ts:87-104`: the column-docblock style (`trackingToken`, `pickupPin`) to mirror.
- `packages/shared/src/schemas/ride.ts:193-218`: `rideOfferSchema`; `:245-283`: `rideSchema` (not changed).
- `packages/shared/src/realtime-events.ts:103-133`: `rideOfferEventSchema = rideOfferSchema.extend(...)`, which picks up `trip` automatically.
- `packages/shared/src/schemas/offer-push.ts:34-55`: `OFFER_PUSH_PAYLOAD_MAX_BYTES`. See Notes for the byte cost.
- `services/api/src/features/dispatch/offer-builder.ts:17-89`: `BuildOfferInput` and `buildOffer`.
- `services/api/src/features/dispatch/dispatch.service.ts:74,125-134` and `force-assign.service.ts:58,72-85`: the only two `buildOffer` callers (`git grep -n buildOffer`).
- `services/api/src/features/dispatch/dispatch.repository.ts:80-94`: the `ride_offers` insert maps columns explicitly, so a new `trip` key on `RideOffer` is ignored there (D2).
- `apps/driver/src/features/offers/offer-card-props.ts:14-124` and `offer-card.tsx:97-110`: the view model and the details block.
- `apps/driver/src/features/offers/offer-card-props.test.ts:36-60`: the fixture pattern (`rideOfferSchema.parse`, a `platform_config` row, `formatMessage('lv', …)`).
- `services/api/src/features/dispatch/dispatch.integration.spec.ts:961-979` ("sends the offer over the socket …") and `:994-1025` (push).
- `services/api/src/features/rides/rides.integration.spec.ts:129` ("quotes and persists a ride with its fare breakdown").
- `services/api/test/harness.ts:285-292`: `CountingMapsProvider` wraps `StubMapsProvider` as `MAPS_PROVIDER_SOURCE`, with the real `CachingMapsProvider` above it. The stub's figures are therefore the expected values in integration tests.
- `packages/shared/src/i18n/lv.ts:324-343`, `en.ts:257-273`, `ru.ts:268` (`driver.offer.eta`): the `driver.offer.*` keys.

### New Files to Create

- `db/migrations/0013_<generated>.sql` (and its `meta/` snapshot): generated, never hand-written.
- `services/api/src/features/rides/ride-row.ts` (T5): the pure projections off a `rides` row (`RideRow`, `AwaitingRide`, `toAwaiting`, `toRide`, and the new `toTrip`). 114 lines after prettier (`observed`, second prototype). It is the only new source file in the patch.
- No new test files. T1 extends `packages/shared/tests/schemas-fare.test.ts`.

### Relevant Documentation

- `docs/research/driver-ux-evidence.md` §1.3 (lines 23-26): what belongs on the card, and the sentence this ticket corrects.
- `.claude/references/realtime-events.md:10`: the `ride:offer` row, which gets one clause about `trip`.
- `.claude/references/logging-standard.md`: no new log events. `ride.pricing.quote_created` already logs both figures (`pricing.service.ts:64-73`).
- No external docs are needed. No library is added or upgraded.

### Patterns to Follow

**A sibling field on `findWithQuote`, not a field on `Ride`** (`rides.repository.ts:311-318`, `:358`):

```ts
return { ride: toRide(row, quote), quote, pickupPin: row.pickupPin };
```

**Integer money math with an independent `Math.round`** (`upfront-fixed.strategy.ts:39-44`):

```ts
const distanceCents = Math.round((tariff.perKmCents * route.distanceMeters) / 1000);
```

**Nullable-with-default wire field for legacy tolerance**: `geozoneId: z.string().uuid().nullable().default(null)` (`ride.ts:254`).

**The card label is ONE a11y node.** Segments get terminated, not joined with `'. '` (`offer-card-props.ts:104-121`).

**Test labels**: every `it(...)` title ends with `(expected)` / `(edge)` / `(failure)` and, where relevant, the ticket (`(#260, edge)`), as the existing specs do.

---

## IMPLEMENTATION PLAN

### Phase A: contract (`packages/shared`)

T1 schema and T2 catalog keys. Everything else imports these from `dist`, so rebuild shared after this phase (memory: CI parity gate). A targeted vitest run in the driver app reads the stale `dist` otherwise.

### Phase B: storage and api

**Depends on:** Phase A.
T3 migration → T4 pricing → T5 repository → T6 rides service → T7 offer builder → T8 the two callers → T9 integration tests.

### Phase C: driver app

**Depends on:** Phase A only. **Independent of:** Phase B. The card reads `offer.trip` off the schema, and its tests build offers with `rideOfferSchema.parse`.

T10, T11.

### Phase D: docs

**Independent of:** B and C. T12.

---

## STEP-BY-STEP TASKS

### T1 UPDATE `packages/shared/src/schemas/ride.ts`

- **IMPLEMENT**: Directly above `rideOfferSchema`, add:
  ```ts
  /**
   * The routed trip, pickup → stops → destination, as the maps seam measured
   * it when the ride was priced (#260). A property of the ROUTE the price was
   * derived from, not of the quote: `FareQuote` stays money-only, so no
   * pricing strategy has to echo a measurement it did not make.
   *
   * Whole units, as `RouteResult` promises and `CachingMapsProvider` enforces.
   */
  export const tripEstimateSchema = z.object({
    distanceMeters: z.number().int().nonnegative(),
    durationSeconds: z.number().int().nonnegative(),
  });
  export type TripEstimate = z.infer<typeof tripEstimateSchema>;
  ```
  In `rideOfferSchema`, after `split`, add:
  ```ts
  /**
   * The trip the card turns into duration and €/km (#260). Null for a ride
   * priced before the columns existed. Defaulted, unlike the wire-only
   * `paymentMethod`, so a new driver binary reading an older api still draws
   * the card (without the line) instead of dropping the offer.
   */
  trip: tripEstimateSchema.nullable().default(null),
  ```
- **PATTERN**: `ride.ts:254` (`geozoneId` nullable default).
- **IMPORTS**: none new. `packages/shared/src/index.ts:19` is `export * from './schemas/ride'`, so both names export automatically.
- **GOTCHA**: Keep `rideOfferSchema` a plain `ZodObject`. No `.refine()` (`ride.ts:228-231`). `ride.ts` is 430 lines and ends near 450.
- **VALIDATE**: add to `packages/shared/tests/schemas-fare.test.ts`, or create `tests/schemas-trip.test.ts` if that file is off-topic:
  - (expected) an offer with `trip: {distanceMeters: 11655, durationSeconds: 1049}` parses and keeps both values;
  - (edge) an offer with no `trip` key parses to `trip: null`, which is the old-api payload;
  - (failure) `distanceMeters: 1.5` and `durationSeconds: -1` are each rejected.

  Run: `pnpm --filter @taxi/shared test && pnpm --filter @taxi/shared build`
- **SATISFIES**: AC1, AC5

### T1b UPDATE the three type-annotated offer fixtures

- **IMPLEMENT**: add `trip: null` to each annotated literal below (before `paymentMethod`/`...over`), and add `trip` to `offer-builder.spec.ts`'s `base` object in T7. `.default(null)` makes `trip` optional on the schema's **input** side only. `RideOffer` / `RideOfferEvent` are `z.infer` output types, where `trip` is a required key, so a literal annotated with those types fails typecheck the moment T1 lands. `observed` via `git grep -nE "(: |satisfies |as )(RideOffer|RideOfferEvent)…"` on `d14759a`, which found exactly three:
  - `apps/driver/src/features/offers/use-offers.test.tsx:69-72` (`wire(): RideOfferEvent`)
  - `apps/driver/src/features/push/push-registrar.test.tsx:64` (`wire(): RideOfferEvent`)
  - `services/api/src/features/dispatch/dispatch-notifier.spec.ts:22` (`offer(): RideOffer`)

  `offer-builder.spec.ts:66-75`'s `base` is not annotated, but it is passed as `BuildOfferInput`, so T7 breaks it (7 × TS2345, `observed`). T7 fixes it.
- **GOTCHA**: Production code is unaffected. `dispatch-notifier.ts:47-51` builds the wire event by spreading `...offer`, and `buildOffer` goes through `rideOfferSchema.parse`. Fixtures that go through `rideOfferSchema.parse(...)` (e.g. `offer-card-props.test.ts:41`) pick up the default and need no change.
- **VALIDATE**: `pnpm --filter @taxi/shared build && pnpm turbo run typecheck --filter @taxi/driver --filter @taxi/api`
- **SATISFIES**: AC7

### T2 UPDATE `packages/shared/src/i18n/{lv,en,ru}.ts`

- **IMPLEMENT**: After `driver.offer.eta` in each catalog, add `driver.offer.trip`:
  - LV `'Brauciens ~{minutes} min · {km} km · {rate}/km'`
  - EN `'Trip ~{minutes} min · {km} km · {rate}/km'`
  - RU `'Поездка ~{minutes} мин · {km} км · {rate}/км'`
- **PATTERN**: `lv.ts:329` (`driver.offer.eta`), with the same separator and the same `~`.
- **GOTCHA**: `lv.ts` is **494** lines (`observed`, `wc -l` on `origin/main`) and the cap is 500. Add a single-line entry only. `en.ts` is 381 and `ru.ts` is 388. RU/EN are pinned to LV by `satisfies`, and placeholder parity is checked by `packages/shared/tests/i18n.test.ts`.
- **VALIDATE**: `pnpm --filter @taxi/shared test && pnpm --filter @taxi/shared build && wc -l packages/shared/src/i18n/lv.ts`
- **SATISFIES**: AC4

### T3 UPDATE `db/src/schema/rides.ts` + generate migration

- **IMPLEMENT**: After `pickupPinFailures`, add:
  ```ts
  /**
   * The routed trip the ride was priced off (#260), whole metres and seconds
   * from the maps seam. NULL on rows priced before this column — read back as
   * "no trip" (`findWithQuote` projects it only when BOTH are set). Written
   * once at creation, never updated.
   */
  tripDistanceMeters: integer('trip_distance_meters'),
  tripDurationSeconds: integer('trip_duration_seconds'),
  ```
  Then run `pnpm --filter @taxi/db generate` (observed output: `0013_cute_prima.sql`; the name is random). The migration should be two `ALTER TABLE "rides" ADD COLUMN … integer;` lines with no default and no NOT NULL.
- **GOTCHA**:
  - No CHECK constraint for "both or neither". `db/src/schema` has no `check(` precedent (`git grep`), and the read side enforces it (T5).
  - Do not add `.default(0)`. A zero would read as a real zero-km trip and hide the rate (D5).
  - Run `generate` with the worktree's `.env` present.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db typecheck && cat db/migrations/0013_*.sql`
- **SATISFIES**: AC2

### T4 UPDATE `services/api/src/features/pricing/pricing.service.ts`

- **IMPLEMENT**:
  - Return type becomes `Promise<{ quote: FareQuote; split: FareSplit; trip: TripEstimate }>`.
  - Return `{ quote, split, trip: { distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds } }`. The polyline is deliberately dropped: nothing persists it.
  - Add one docblock line: the trip is returned so the ride stores the route its price came from, and so the offer card never needs a second paid route call.
  - `previewSplit` is unchanged.
- **IMPORTS**: `type TripEstimate` from `@taxi/shared`.
- **GOTCHA**: `ride-quote.service.ts:78` destructures `{ quote }` and needs no change. Do not `tripEstimateSchema.parse` here: `CachingMapsProvider` already validated `.int()` on the same numbers (`caching-maps.provider.ts:266-269`), and the insert is the backstop.
- **VALIDATE**: in `pricing.service.spec.ts`, add (expected) "returns the route's distance and duration as the trip, without the polyline (#260)". The fake route is already `10_000` m / `1_200` s (`:47-55`), so assert `trip` `toEqual({ distanceMeters: 10_000, durationSeconds: 1_200 })`. Run: `pnpm --filter @taxi/api test -- pricing.service`
- **SATISFIES**: AC2

### T5 UPDATE `services/api/src/features/rides/rides.repository.ts`

- **IMPLEMENT**:
  - `CreateRideInput` gets `/** From `PricingService.quote` (#260) — the route the price came from. */ trip: TripEstimate;`.
  - `create()` `.values` gets `tripDistanceMeters: input.trip.distanceMeters, tripDurationSeconds: input.trip.durationSeconds`.
  - `findWithQuote` return type gains `trip: TripEstimate | null`. Project it as:
    ```ts
    trip:
      row.tripDistanceMeters === null || row.tripDurationSeconds === null
        ? null
        : { distanceMeters: row.tripDistanceMeters, durationSeconds: row.tripDurationSeconds },
    ```
  - Extend the `findWithQuote` docblock with one sentence: `trip` (#260) is a sibling for the same reason as `pickupPin`, because `Ride` does not carry it, and a half-written pair reads as `null` rather than as a zero.
- **PATTERN**: `:311-318`, `:358` (the `pickupPin` sibling).
- **IMPLEMENT (decided, not a fallback)**: CREATE `services/api/src/features/rides/ride-row.ts` and MOVE the pure row projections into it, unchanged apart from `export`:
  - `type RideRow` (now exported), the `AwaitingRide` interface with its docblock, `toAwaiting`, and `toRide` with its docblock;
  - the new `toTrip(row: Pick<RideRow, 'tripDistanceMeters' | 'tripDurationSeconds'>): TripEstimate | null`, projected as above.

  Its file docblock mirrors `board-ride.ts:10-18`: these are projections, not queries, and they were split out when #260's columns took the repository from 473 to 498 of 500 with the projection inline. In the repository:
  - drop `rideRequestSchema` and `rideSchema` from the `@taxi/shared` import, since nothing left there uses them;
  - add `import { toAwaiting, toRide, toTrip, type AwaitingRide } from './ride-row';`;
  - return `trip: toTrip(row)` from `findWithQuote`.

  `UNASSIGNABLE_RIDE_STATUSES` stays in the repository, because `unassignDriver`'s query uses it. UPDATE `rides/index.ts:100` to `export type { AwaitingRide } from './ride-row';`. The public API is unchanged: `dispatch.sweeper.ts:10` and `dispatch.sweeper.spec.ts:4` import `AwaitingRide` from `'../rides'`. The patch has the exact files.
- **PATTERN**: `board-ride.ts` (split out of this repository under the same cap for #19 Phase C).
- **GOTCHA**: The repository is **473** lines on `origin/main`. Prettier line counts from the two prototypes (all `observed`): 498 with the projection inline, 489 with a one-function `ride-trip.ts`, and **408** with `ride-row.ts`, which is 114 lines. Run `wc -l` after prettier, not before, because prettier expands the `findWithQuote` return type to 7 lines. Any spec that stubs `findWithQuote` with a cast (`as unknown as RidesRepository`) still compiles. Nothing outside `rides.repository.ts` referenced `toRide` or `toAwaiting` by import (`git grep` on `d14759a`: the other hits are comments), so the move breaks no callers.
- **VALIDATE**: `pnpm turbo run typecheck lint --filter @taxi/api --force && wc -l services/api/src/features/rides/rides.repository.ts services/api/src/features/rides/ride-row.ts`. Second prototype: 4/4 tasks, 0 errors. The 14 lint warnings are all `no-unsafe-argument` in `*.integration.spec.ts` files, one per file, and none comes from this change.
- **SATISFIES**: AC2

### T6 UPDATE `services/api/src/features/rides/rides.service.ts`

- **IMPLEMENT**: In `createRide`, `const { quote, split, trip } = await this.pricing.quote(request);` and pass `trip` to `this.rides.create({...})`.
- **GOTCHA**: The file is **484** lines (`observed`). This adds 1. No log change: `ride.pricing.quote_created` already logs both figures.
- **VALIDATE**: in `rides.service.spec.ts`, add a module-level `TRIP` constant, make the `pricing.quote` fake (`:85-92`) return `{ quote, split, trip: TRIP }`, widen the `create` fake's `input` type and `created` with `trip?: unknown`, and expose `createdTrip: () => created?.trip` beside `createdStatus`. Add (expected) "stores the priced route's trip on the ride (#260)", asserting the argument `rides.create` received carries that `trip`. Run: `pnpm --filter @taxi/api test -- rides.service`
- **SATISFIES**: AC2

### T7 UPDATE `services/api/src/features/dispatch/offer-builder.ts`

- **IMPLEMENT**:
  - `BuildOfferInput` gets `/** The ride's stored trip (#260); null for rides priced before it was stored. */ trip: TripEstimate | null;` (required key, nullable value).
  - Pass `trip: input.trip` into `rideOfferSchema.parse`, and close the literal with `} satisfies RideOffer);`, commented as the compile-time guard against `trip`'s `.default(null)`. The prototype typechecked clean with it: `queuePosition`'s conditional spread and `Date` timestamps all satisfy the output type.
  - In `offer-builder.spec.ts`, add `const trip = { distanceMeters: 11_655, durationSeconds: 1_049 }` and `trip` to `base`.
- **GOTCHA**: Without `satisfies`, D3's default means **dropping `trip: input.trip` still compiles and parses**, to `null`. With it, typecheck fails (TS1360, `observed`). ts-jest does not stop on that type error: the suite still runs, and the runtime assertions are what fail (3 red, `observed`). So typecheck and tests each catch the mutation on their own.
- **VALIDATE**: in `offer-builder.spec.ts` add:
  - (expected) "carries the ride's trip onto the card (#260)";
  - (edge) "a legacy ride with no trip builds an offer with `trip: null` (#260)".

  Run `pnpm --filter @taxi/api test -- offer-builder`.

  **Mutation, half (a):** delete `trip: input.trip` from the parse call. `pnpm --filter @taxi/api typecheck` must go red (TS1360), and `offer-builder.spec` "carries the ride's trip" must go **red**. Restore it. Half (b) runs in T9, once the integration assertion exists.
- **SATISFIES**: AC3

### T8 UPDATE `dispatch.service.ts` and `force-assign.service.ts`

- **IMPLEMENT**: Add `trip: found.trip` to both `buildOffer({...})` calls (`dispatch.service.ts:125`, `force-assign.service.ts:72`). The compiler forces this after T7.
- **GOTCHA**:
  - `force-assign.service.spec.ts:86` types its `found` stub explicitly as `{ ride; quote }`. Add `trip: TripEstimate | null` to that type and give the default fixture a trip, so the spec pins the pass-through.
  - ~~`dispatch.service.spec.ts` has one `findWithQuote` stub. Add a `trip` to it and assert the emitted offer carries it.~~ Superseded 2026-09-26 (implementation): that stub resolves `undefined` and no test there builds an offer; the cascade pass-through is pinned by the required `BuildOfferInput.trip` and T9's socket and push tests.
  - `reassign.service.ts:74` uses `findWithQuote` but does not build an offer, so leave it alone.
  - `dispatch.service.ts` is 425 lines.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api test -- dispatch.service force-assign`
- **SATISFIES**: AC3

### T9 ADD integration tests (`services/api`)

- **IMPLEMENT**:
  1. `rides.integration.spec.ts` (import `StubMapsProvider` from `'../geo/stub-maps.provider'`), inside "quotes and persists a ride with its fare breakdown (expected)" (`:129`), or as a sibling test right after it: read the `rides` row and assert `tripDistanceMeters` / `tripDurationSeconds` equal `await new StubMapsProvider().route(CENTRE.location, RIX.location)`'s figures. The harness wraps the stub (`test/harness.ts:285-292`), and the stub is deterministic. Assert both are `> 0`, so an equal pair of nulls cannot pass.
  2. `dispatch.integration.spec.ts` "sends the offer over the socket with ISO timestamps (expected)" (`:961`): add a local helper `storedTrip(rideId)` that selects `{ distanceMeters: rides.tripDistanceMeters, durationSeconds: rides.tripDurationSeconds }` for the ride (`rides` is already imported at `:6`), then add an assertion that `event.trip` equals the booked ride's `rides` row pair (`{ distanceMeters: row.tripDistanceMeters, durationSeconds: row.tripDurationSeconds }`) and that `event.trip!.distanceMeters > 0`.
     - **Connect order: driver socket first, then the rider books, then `sweeper.tick()`** (`:962-967`). That is the app's order: a driver is online with a live socket before any offer can reach them.
  Phone indices: `onlineDriver`/`bookRide` take a phone number `n`, and every index from 1 to 116 that is in use is taken (listed in the prototype). Use **120 and 121** for the new test. Reusing 51/52 collides with the push test.
  3. New (edge) in `dispatch.integration.spec.ts`: "a ride priced before trips were stored still dispatches, with `trip: null` (#260, edge)". Same order as (2). After `bookRide`, run `ctx.db.update(rides).set({ tripDistanceMeters: null, tripDurationSeconds: null })` for that ride, then `tick()`, then assert that the offer **arrives** and that `event.trip` is `null`.
  4. In the push test (`:994-1025`), assert `carried.trip` equals `event`'s trip from the same ride, so the push payload carries it too.
- **GOTCHA**: Redis-backed suites `describe.skip` without `REDIS_TEST_URL`. Run these with it set, or they report green and short.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test -- rides.integration dispatch.integration` (use the port from `.env`'s `REDIS_PORT`).

  **Mutation, half (b), finishing T7's:** delete `trip: input.trip` from `offer-builder.ts` again and rerun `dispatch.integration`. The socket test (2) and the push test (4) must both go **red**. Test (3), the legacy-null one, must stay **green**, because it expects `null` either way. That is the half that shows (3) cannot tell the mutation apart. Record these three results with T7's two (typecheck TS1360 red; `offer-builder.spec` "carries the ride's trip" red) in the execution report, five in all, then restore.
- **SATISFIES**: AC2, AC3, AC5

### T10 UPDATE `apps/driver/src/features/offers/offer-card-props.ts`

- **IMPLEMENT**:
  - Add `trip: string | null;` to `OfferCardProps`.
  - Add an exported pure helper:
    ```ts
    /**
     * «Brauciens ~18 min · 11.7 km · €0.90/km» (#260), or null when there is
     * nothing true to show: no stored trip, or one under 50 m (PR #284 F1).
     * €/km is the driver's NET per routed trip km — user decision 2026-09-26;
     * the pickup leg is excluded because its km is straight-line and absent
     * without a fix. Integer cents, rounded once.
     */
    export function tripLabel(offer: RideOffer, t: T): string | null {
      const trip = offer.trip;
      if (!trip || trip.distanceMeters < 50) return null;
      return t('driver.offer.trip', {
        minutes: Math.ceil(trip.durationSeconds / 60),
        km: (trip.distanceMeters / 1000).toFixed(1),
        rate: formatEur(Math.round((offer.split.driverNetCents * 1000) / trip.distanceMeters)),
      });
    }
    ```
  - In `offerCardProps`: `const trip = tripLabel(offer, t);`, return `trip`, and insert `trip` in the `a11yLabel` array **between `destination` and `eta`**. The existing `.filter(Boolean)` drops a null.
- **PATTERN**: `youKeepLabel` (`:44-50`) for the helper shape. The `eta` math (`:72-75`) for `ceil` and `toFixed(1)`.
- **GOTCHA**: `formatEur` truncates (`money.ts:52-57`), so round before calling it, never after. The file is 139 lines.
- **VALIDATE**: in `offer-card-props.test.ts`, add a module-level `TRIP = { distanceMeters: 11_655, durationSeconds: 1_049 }` and give `pendingFor` a third parameter `trip … = null`, **defaulting to `null`, not `TRIP`**. With `TRIP` as the default, the #263 test "the accessible name does not change as the countdown ticks" goes red on `not.toMatch(/18/)`, because the trip line says "18 min" (`observed`). New tests pass `TRIP` explicitly. The fixture's split is 1240 @ 15%, so net is 1054 (`derived`: 1240 − round(186) = 1054). Add:
  - (expected) `card.trip` is exactly `'Brauciens ~18 min · 11.7 km · €0.90/km'`. The figures are `derived`: ceil(1049/60) = 18; 11655/1000 → `11.7`; round(1054·1000/11655) = round(90.43) = 90 → `€0.90`. The a11y label contains that string, with the destination before it and the ETA after it.
  - (edge) `trip: null` → `card.trip` is `null`, and the a11y label has no `Brauciens`.
  - (edge) `distanceMeters: 0` → `card.trip` is `null`, with no division by zero and no `€Infinity`.
  - (edge) a 0% override (net = fare) gives a rate from the full fare. This pins that the rate reads `split.driverNetCents`, not `quote.totalCents`.

  Also, in the 0% override test, round(1240·1000/11655) = round(106.39) = 106 → `€1.06/km` (`derived`, checked with node).

  Run: `cd apps/driver && npx jest src/features/offers` (the driver app is **jest**, `jest-expo`). Rebuild shared first if T1/T2 changed since the last build.
- **SATISFIES**: AC4

### T11 UPDATE `apps/driver/src/features/offers/offer-card.tsx`

- **IMPLEMENT**: Inside `offer-details`, after the destination `<Text>` (`:100-102`), add `{card.trip ? <Text style={[styles.detail, { color: muted }]} testID="offer-trip">{card.trip}</Text> : null}`.
- **GOTCHA**: The line must stay inside the glance-collapsible block. The Pressable's label already carries the text for screen readers (T10), so this `<Text>` gets no a11y props of its own.
- **VALIDATE**: in `offer-card.test.tsx` add:
  - (expected) `offer-trip` is rendered with `card().trip`;
  - (edge) glance mode → `queryByTestId('offer-trip')` is null, extending the existing glance test at `:60`;
  - (edge) `trip: null` → no `offer-trip`.

  The `card()` fixture needs `trip: t('driver.offer.trip', { minutes: 18, km: '11.7', rate: '€0.90' })`. Run `cd apps/driver && npx jest src/features/offers src/features/push`. Prototype: 45 suites, 284 tests, all green.
- **SATISFIES**: AC4

### T12 UPDATE docs

- **IMPLEMENT**:
  1. `docs/research/driver-ux-evidence.md:26`: replace "All fields are already in Sakta's data model." with: "Payout, pickup ETA/distance and destination were in Sakta's data model at the time of writing. Trip duration and distance were not: `fareQuoteSchema` holds money only. #260 added them as `rideOfferSchema.trip`. Rider rating still has no contract: the only `rating` in shared is the driver's own." Keep the rest of the line. Then grep the subject, not the sentence: `git grep -n "already in Sakta\|rides\.quote" -- docs .claude/references`. Plans are history, so leave `.claude/plans/*` alone.
  2. `.claude/references/realtime-events.md:10`: after the `paymentMethod` clause, add: "and **`trip`** (#260): the ride's routed `{distanceMeters, durationSeconds}`, **nullable with a default** (unlike `paymentMethod`), so a new binary reading an older api draws the card without the duration/€/km line instead of dropping the offer."
  3. `.claude/references/ui-decisions.md`: append `2026-09-26 · driver · offer card trip line «Brauciens ~18 min · 11.7 km · €0.90/km» sits under the destination in the collapsible details, muted like the ETA; €/km is net ÷ routed trip km (user decision); dot decimal and «€» first follow `formatEur`, and the line is omitted, not dashed, when there is no trip (#260).`
  4. **After #260 merges** (not before; the columns must exist on `main`), comment on #134: `gh issue comment 134 --body-file <scratchpad file>` with: "#260 added acceptance criterion: a ride booked on a real Rīga corridor stores `trip_distance_meters` / `trip_duration_seconds` equal to the OSRM route's figures for it (the driver's offer card turns these into duration and €/km). Check with the `mint:ride` + `psql` step in `.claude/plans/offer-card-trip-estimate-260.md` Level 4 step 1, with OSRM's figures in place of the stub formula." Use a body file (memory: the PreToolUse hook matches command text). If the implementer's session ends at a green PR before the merge, record this step as owed in the execution report so the next session runs it.
- **VALIDATE**: `git grep -n "already in Sakta" -- docs` returns nothing. After step 4: `gh issue view 134 --comments | grep -c "#260"` ≥ 1.
- **SATISFIES**: AC6

---

## TESTING STRATEGY

### Unit Tests

jest in `services/api` (T4, T6, T7, T8; needs Postgres up even for unit specs) and in `apps/driver` (T10, T11, `jest-expo`), and vitest in `packages/shared` (T1, T2). Each slice gets expected, edge and failure cases as listed per task.

### Integration Tests

- **Realtime rule.** `dispatch.integration.spec.ts` "sends the offer over the socket …" connects in the app's order: **driver socket → rider `POST /rides` → `sweeper.tick()`**. It asserts that `trip` **arrives** on `ride:offer`. The new legacy-null test uses the same order and asserts that the offer arrives with `trip: null`.
- `rides.integration.spec.ts` asserts the stored columns equal the stub's route for the booked corridor.

### Edge Cases

| Edge case | Verified in |
|---|---|
| Legacy ride, both columns NULL → offer still dispatched, `trip: null` | T9 (3) integration; T7 unit |
| Old api payload with no `trip` key → driver app parses, `trip: null` | T1 shared test |
| `distanceMeters < 50` (0, 40, 49 m) → line omitted, no division, no "0.0 km"; 50 m draws "0.1 km" | T10 unit |
| `trip === null` → line omitted from view and a11y label | T10, T11 unit |
| Glance mode hides the line | T11 unit |
| Fractional or negative figures refused by the contract | T1 shared test |
| 0% commission override → rate from net = fare | T10 unit |
| Push payload carries `trip` | T9 (4) integration |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`pnpm turbo run typecheck lint --filter @taxi/shared --filter @taxi/db --filter @taxi/api --filter @taxi/driver`

### Level 2: Unit Tests

```bash
COMPOSE_PROJECT_NAME=taxi docker compose up -d --wait   # api jest's global-setup refuses without Postgres
pnpm --filter @taxi/shared test && pnpm --filter @taxi/shared build
pnpm --filter @taxi/driver test
cd services/api && COMPOSE_PROJECT_NAME=taxi npx jest src/features/pricing src/features/rides/rides.service.spec.ts src/features/dispatch/offer-builder.spec.ts src/features/dispatch/dispatch-notifier.spec.ts src/features/dispatch/dispatch.service.spec.ts src/features/dispatch/force-assign.service.spec.ts
```
Prototype: 8 suites, 76 tests, green (`observed`).

### Level 3: Integration Tests + the gate

```bash
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:<REDIS_PORT> pnpm --filter @taxi/api test -- rides.integration dispatch.integration
# the gate, from a cleared dist and .next (memory: stale .next race):
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:<REDIS_PORT> pnpm turbo run typecheck lint test build --force
```

The line cap is part of lint. Also run `wc -l` on `rides.repository.ts`, `rides.service.ts` and `lv.ts` and quote the figures in the report.

### Level 4: Manual Validation

All three steps use what the repo ships today.

1. **Stored trip on a real booking.** Run `pnpm --filter @taxi/api mint:ride` against the dev DB after `pnpm --filter @taxi/db migrate`. It drives OTP → `POST /rides` → sweeper offer → accept (`services/api/scripts/mint-tracked-ride.ts:1-20`). Then run `docker compose exec postgres psql -U <user> -d <db> -c "select trip_distance_meters, trip_duration_seconds from rides order by created_at desc limit 1"`. Both must be non-null and satisfy `duration = round(distance/1000/40*3600)`, the stub formula (`stub-maps.provider.ts:55-57`). Mind the run ceiling in the script's docblock (OTP per hour).
2. **Legacy rows are untouched.** Run `select count(*) from rides where trip_distance_meters is null` before step 1. Every dev row that existed before the migration counts, and step 1 must not have changed that count except for its own new row. That the dispatch path handles such rows is proved by T9 (3), not here.
3. **Card on screen (optional; the RNTL tests in T11 cover rendering).** On the Android emulator, per `docs/runbooks/driver-device-day.md`, take an offer from a phone booking in the dispatch console. The card shows the trip line under the destination. TalkBack reads it between the destination and the ETA. A 10 km/h+ drive (emulated location) hides it. If the emulator run is skipped, say so in the report. Do not claim it.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1** `@taxi/shared` exports `tripEstimateSchema` / `TripEstimate`. `rideOfferSchema.trip` is `TripEstimate | null`, defaulting to `null`. `fareQuoteSchema` is **unchanged** (D1).
- [ ] **AC2** Every ride created from this ticket on stores `trip_distance_meters` / `trip_duration_seconds` from the route its price was computed from. `findWithQuote` returns `trip`, null unless both columns are set.
- [ ] **AC3** Every cascade `ride:offer`, socket or push, carries the ride's `trip`. (Force-assign passes `trip` to `buildOffer`, but that offer only feeds the `ride_offers` audit insert and the driver gets `ride:assigned`, so no card shows it; amended 2026-09-26.) A legacy ride still dispatches with `trip: null`.
- [ ] **AC4** The offer card shows `~{minutes} min · {km} km · {rate}/km`, with the rate = net ÷ routed km in integer cents, in the details block, and in the a11y label after the destination. It is omitted for a null trip or a zero distance, and hidden in glance mode.
- [ ] **AC5** Tests: expected, edge and failure cases per slice as listed. The integration test asserts `trip` **arrives** over the socket in the app's connect order. The T7 and T9 mutation halves were run, and all five results were recorded: T7 typecheck red, T7 "carries" spec red, T9 socket test red, T9 push test red, T9 legacy-null test green.
- [ ] **AC6** `driver-ux-evidence.md:26` is corrected, `realtime-events.md` documents `trip` and its default, and `ui-decisions.md` has the entry. After merge, #134 carries the stored-trip acceptance criterion (T12 step 4), or the execution report records it as owed.
- [ ] **AC8** `rides.repository.ts` stays at or below 420 lines after prettier (second prototype: 408, `observed`). The pure projections live in `ride-row.ts` and the public `AwaitingRide` export is unchanged (R1).
- [ ] **AC7** `pnpm turbo run typecheck lint test build --force` is green with `REDIS_TEST_URL` set. Quote the run's task and test counts.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration, Redis suites included)
- [ ] No linting or type checking errors; line caps checked
- [ ] Manual steps 1–2 run; step 3 run or reported as skipped
- [ ] Acceptance criteria all met

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Q1 (not blocking): the stub's figures.** Until #134 binds OSRM, the trip is haversine × 1.35 at a flat 40 km/h. The card's "~N min" is therefore a flat-speed estimate, the same one the fare's time line is already priced on. In congestion the card under-reports duration. The €/km uses a geometric distance rather than a road distance, and no bound on that error has been measured. It is the same distance the rider is charged for, so the card and the fare stay consistent with each other. #134 fixes both at once.
  - **How long the error lasts (R2):** only until #134 deploys. An offer is built from the ride row within seconds of pricing, so no stub-priced trip is still being offered once OSRM is live. Rows already priced keep their stub figures; nothing reads them after the ride ends. No backfill is needed.
  - **Ownership (R2):** #134's acceptance criteria check that "a quote … prices off road distance", not that the stored trip does. T12 step 4 adds that criterion to #134, so the card's figures are checked when OSRM lands. It is not posted before #260 merges, because the columns it names do not exist yet.
- **Q2 (verified, not open): phone bookings** go through `services/api/src/features/dispatch/bookings/bookings.service.ts:51` → `RidesService.request` → `createRide`. So do customer-slice bookings (`customers/index.ts:6`, which delegates to `RidesService`). `rides.repository.ts` `create()` has one caller (`rides.service.ts:264`). All booking paths therefore store a trip through T6. `CreateRideInput.trip` being required means the compiler flags any future second caller.
- **Q3 (ordering, worst case): old app against new api.** The api emits a `trip` key the old binary does not know. Its non-strict `z.object` strips it, and the card renders as today. New app against old api: `trip` is absent, defaults to `null`, and the line is omitted. **Neither order drops an offer** (D3).
- **Q4 (assumption): the re-offer after a release** (`reassign.service.ts`) goes back through the cascade (`dispatch.service.ts`), so it carries `trip` via T8. Nothing else builds an offer (`git grep -n buildOffer`: 2 callers).

## NOTES (open canvas)

**Push payload headroom, resolved.** `observed` (2026-09-26, node against the built shared `dist`): a worst-case `ride:offer` wire event, with every number at maximum width (`totalCents` 9 999 999, a 7-digit negative discount, 999 999 m, 99 999 s, queue position 99) and 1-character addresses, is **848 B**. That leaves **1 200 B** for the two addresses under the 2 048 B cap. The fallback to ids-only needs addresses far longer than any street address.

**Push payload cost.** `observed` (node, `Buffer.byteLength`, 2026-09-26): `trip` adds **57 B** to the offer JSON at a worst case of 999 999 m / 99 999 s, and **12 B** when null (`,"trip":null`). Against the 2 048 B `OFFER_PUSH_PAYLOAD_MAX_BYTES` sub-cap, that is 57 B less room for the two addresses before an offer falls back to ids-only. The docblock's 4 096 − 103 − 124 − 2 048 = 1 821 B arithmetic is about the envelope and stays true unchanged. The tap-still-routes fallback is unchanged. No change to the cap.

**Rejected: `trip` inside `FareQuote`, optional.** Every D1 cost would still apply, plus a third state: a quote that has money but no measurement. The `ride_offers.quote` jsonb snapshot would also start carrying it inconsistently for old and new rows.

**Rejected: storing the trip on `ride_offers`.** The ride row already holds it and never changes. A per-offer copy only duplicates it.

**Rejected: computing €/km on the api.** The evidence (§1.3) and #15 both say client-computed. `split.driverNetCents` is already on the offer, so a server-side rate would be a third money field to keep consistent with two others.

**Rejected: showing the trip in glance mode.** §5.2 collapses everything beyond fare · keep · payment · accept/decline above 10 km/h, and duration or €/km is not a driving-safe read.

## AMENDMENTS

- 2026-09-26: prototype pass (user asked for every risk to be addressed). T1–T11 were implemented in a throwaway worktree, the full gate went green (22/22), and the results were recorded under "Prototype evidence". Changes: `satisfies RideOffer` in `buildOffer`; `ride-trip.ts` is now required, not a fallback; the `offer-builder.spec` `base` fixture was added to T1b/T7; `pendingFor` defaults `trip` to `null` (#263 collision); driver test commands corrected to jest; phone indices 120/121; `api` jest needs Postgres; push headroom measured. Reference patch saved beside the plan.
- 2026-09-26: re-verification before implementation. `origin/main` is still `d14759a` (`git fetch`, `observed`). The patch applies cleanly to it (`git apply --cached --check` against a temporary index read from `origin/main`, exit 0, `observed`). No open PRs. Every local branch that touches the patch's files is already merged (#236, #274, #277, #255, #245, #253, #194, #268, #163). `db/migrations` ends at `0012`, so `0013` is still next. Corrections: the setup note said the main checkout held unpushed #135 commits, but that branch merged as #253; "New Files to Create" now lists `ride-trip.ts`; AC5 and T9 now name the five mutation results instead of "four"/"three".
- 2026-09-26: risks addressed (user request).
  - **R1:** `rides.repository.ts` at 489/500 left the next ticket that touches it without room. T5 now moves every pure row projection into `ride-row.ts`, following the `board-ride.ts` precedent. That replaces the one-function `ride-trip.ts` (so the previous entry's "New Files" line is superseded), and the repository ends at 408. The move was prototyped in a second throwaway worktree at `d14759a`: typecheck + lint 4/4, 0 errors, and the full gate result is under "Prototype evidence". The reference patch was regenerated from that worktree. AC8 added.
  - **R2:** the stub-accuracy risk is bounded to the period before #134 deploys (Q1). Its ownership moves to #134 through T12 step 4, which runs after merge.
- 2026-09-26: implementation (report `.claude/reports/offer-card-trip-estimate-260-report.md`). Superseded or changed vs the tasks above:
  - **T8:** the reference patch omitted `force-assign.service.spec.ts`; it was done by hand (`found` type gains `trip`, default fixture carries it, the expected test's `insertOffer` assertion requires it). It pins `buildOffer`'s input only. `dispatch.service.spec.ts` was left unchanged (see T8 GOTCHA).
  - **AC3:** force-assign's `trip` reaches no driver or column (`insertOffer` maps columns explicitly; the driver receives `ride:assigned`). AC3 reworded to the cascade paths.
  - **T3:** the generated migration is `0013_concerned_wiccan.sql` (random name; same two `ADD COLUMN … integer` lines).
  - **T5:** `ride-row.ts`'s docblock figure corrected from the unshipped variant's 489 to "473 to 498 of its 500 lines after prettier" (inline projection).
  - **T7/T9 mutations:** run as one mutation spanning both halves, not restored in between; the five results are as the tasks predicted.
- 2026-09-26: PR #284 review round 1 (`.claude/reports/pr-284-review-fixes.md`). **D5/T10:** the line is also omitted under 50 m, the first length `toFixed(1)` prints as "0.1 km" (F1). **T5:** docblock sentence above corrected from 489 to 473 → 498 (F3).
