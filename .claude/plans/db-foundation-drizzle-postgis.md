# Feature: DB foundation — Drizzle schema, PostGIS migrations, Rīga geozone seed

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Stand up the persistence layer the scaffold lacks: a new `@taxi/db` workspace package at root `db/` containing the full core-loop Drizzle schema (users, drivers, vehicles, cities, geozones with PostGIS polygons, rides + fare-breakdown lines, ride offers, platform config, ledger accounts/entries, dispatch audit log), one migration set runnable from zero against the dockerized `postgis/postgis:16-3.4` instance, and an idempotent Rīga pilot seed (city, four evidenced hotspot geozones, `platform_config` row with `commissionPct: 15`).

## User Story

As the API service (and ultimately every Sakta Cab surface behind it)
I want a migrated, seeded, type-safe database schema that mirrors the `@taxi/shared` contracts
So that tickets #7–#12 can build the auth/rides/dispatch/payments slices on real tables instead of inventing storage shapes ad hoc.

## Problem Statement

The architecture doc's "Missing pieces" list starts with: "`db/` migrations + Rīga geozone seed (scaffold has none)." The root `db/` directory exists but is empty; `services/api` is a hello-world NestJS app with no database wiring. Every downstream API ticket depends on this layer existing, with the money/status/contract invariants enforced at the storage boundary, not re-decided per slice.

## Solution Statement

Create `@taxi/db` as a root `db/` workspace package (skeleton §4 names root `db/`; we honor it — see NOTES for why not colocating under `services/api`). The Drizzle table definitions **derive their enums from `@taxi/shared` const arrays** (single source of truth — `pgEnum("ride_status", RIDE_STATUSES)`), money columns are all `integer` cents EUR, and geozone polygons are a PostGIS `geometry(Polygon,4326)` custom type. Migrations: migration 0000 enables the postgis extension (custom migration), 0001 is the generated schema. A seed module (pure function + CLI wrapper) upserts Rīga + the four pilot zones + the config row with fixed UUIDs so it is re-runnable. Vitest integration tests run against a dedicated `taxi_test` database created and migrated in global setup; `services/api` gets `@taxi/db` as a dependency plus a smoke spec proving the types are importable.

## Out of Scope / Non-Goals

- **Not included:** `return_offer_windows` table — its own migration lands in #26 (ticket says so explicitly).
- **Not included:** demand signals — Redis-only by architecture decision, never Postgres.
- **Not included:** a `fleets` table. `drivers.fleet_id` is a plain nullable `uuid` column (the owned-fleet extension point) with **no FK target yet** — the fleet entity arrives if/when owned-fleet ops become real.
- **Not included:** the NestJS `DrizzleModule` / injection wiring inside `services/api` — that is #7 (auth + realtime gateway). This ticket only proves importability.
- **Not included:** any repository/query layer, ledger posting logic (#12), dispatch writes (#10). Tables are shape-level per the architecture.
- **Not changing:** anything in `packages/shared` (contracts are done, #2 closed) or `docker-compose.yml` (postgis image is already correct).
- **Not included:** Redis, queue state, `geozone_queues` persistence — live queue state is Redis lists (#8/#10); `geozoneQueueSchema` is a wire shape only.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium
**Primary Systems Affected**: new `db/` workspace package, `pnpm-workspace.yaml`, `services/api` (dependency + smoke spec only)
**Dependencies**: `drizzle-orm` (^0.44), `drizzle-kit` (^0.31), `pg` (^8.16) + `@types/pg`, `tsx` (seed/CLI runner); dockerized postgis + the existing `@taxi/shared` contracts

## Related Work

**Implements**: GitHub issue #6 (PR must say `Closes #6`)   ·   **Epic**: #1 — `docs/epics/sakta-cab.architecture.md` (decisions inherited: root `db/` in skeleton §4, data-model additions, integer cents, config-not-constant commission, one ledger with cash netting §5.3)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/shared-contracts-ride-loop.md` — Why: #2 built the zod contracts this schema mirrors; its code comments explicitly anticipate #6 (`rideOfferSchema` kept a plain `ZodObject` "so #6 can derive a ride_offers insert shape", `ride.driverId` is "the denormalized field #6 indexes", `platform_config` "the seed lives in #6").

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet — #7 auth/gateway will add the api-side DrizzleModule; #26 adds `return_offer_windows`)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `packages/shared/src/enums.ts` (all 45 lines) - Why: every pgEnum derives from these const arrays — `USER_ROLES`, `RIDE_CATEGORIES`, `PAYMENT_METHOD_TYPES`, `DISPATCH_MODES`, `PRICING_MODELS`, `DRIVER_STATUSES`, `OFFER_STATUSES`, `ASSIGNMENT_SOURCES`, `COMMISSION_SOURCES`. Note `RIGA_PILOT_DISTRICTS` is the seed's slug set but `geozone.slug` stays free-form text (Dina adds zones without code changes).
- `packages/shared/src/ride-state-machine.ts` (lines 1–18) - Why: `RIDE_STATUSES` is the `ride_status` pgEnum source. Statuses live here, NOT in enums.ts.
- `packages/shared/src/schemas/ride.ts` (lines 34–49, 75–99, 126–145) - Why: `rideRequestSchema` → `rides.request` jsonb + denormalized columns; `rideOfferSchema` → `ride_offers` columns one-for-one; `rideSchema` → `rides` columns (`orderId`, nullable `driverId`/`geozoneId`, quote/split nullability).
- `packages/shared/src/schemas/geo.ts` (lines 16–41) - Why: `citySchema` → `cities`; `geozoneSchema` → `geozones` (slug free-form, `queueModeEnabled` default false, polygon ring semantics: "first and last vertex need not repeat" — the EWKT helper must close the ring).
- `packages/shared/src/schemas/platform-config.ts` (all) - Why: `platform_config` columns and the seed values' meaning (`commissionPct` has NO default anywhere — the seed supplies 15 explicitly; guarantees seed as NULL).
- `packages/shared/src/schemas/driver.ts` + `user.ts` + `vehicle.ts` (all, short) - Why: `drivers`/`users`/`vehicles` columns. Note: `isFemale` lives on the DRIVER (the female-driver preference filter target), `hasChildSeat` on the VEHICLE — the ticket text says "vehicles (attributes incl. female-driver preference + child seat)" but the shared contract is authoritative; follow it.
- `packages/shared/src/money.ts` (all) - Why: the integer-cents rule this schema enforces in DDL; `commissionPctSchema` is 0–100 possibly fractional → `double precision`, not integer.
- `packages/shared/src/commission.ts` (lines 51–64) - Why: `fareSplitSchema` fields → the settled-split columns on `rides` (`commission_pct`, `commission_source`, `commission_cents`, `driver_net_cents`).
- `packages/shared/package.json` + `tsconfig.json` + `tsconfig.build.json` + `vitest.config.ts` - Why: `@taxi/db` mirrors this package shape exactly (dist main/types export, `@taxi/config` preset, vitest `tests/**/*.test.ts`).
- `packages/shared/tests/platform-config.test.ts` - Why: the 1+1+1 test pattern (expected/edge/failure with the reason in the test name) to mirror.
- `pnpm-workspace.yaml` - Why: must add `- "db"` — `db/` matches none of the current globs, so without this the package silently doesn't exist to pnpm/turbo.
- `services/api/package.json` - Why: add `"@taxi/db": "workspace:*"` next to `@taxi/shared`; jest config has `rootDir: src`, `testRegex .*\.spec\.ts$` — the smoke spec goes in `src/`.
- `docker-compose.yml` - Why: connection facts — `postgres://taxi:taxi@localhost:5432/taxi`, image `postgis/postgis:16-3.4-alpine` (extension available, not enabled per-db until migration 0000).
- `docs/epics/sakta-cab.architecture.md` (lines 23–42) - Why: inherited decisions — data-model additions list, boundaries, "Missing pieces".
- `docs/skeleton-proposal.md` (§4 lines 78–113, §5.3) - Why: root `db/` placement; "one ledger (double-entry-ish rides/commissions/top-ups); cash rides debit driver commission owed".

### New Files to Create

```
db/
├── package.json                      # @taxi/db — scripts: build, typecheck, test, generate, migrate, seed
├── tsconfig.json                     # mirror shared; include src, tests, drizzle.config.ts
├── tsconfig.build.json               # rootDir src → dist
├── vitest.config.ts                  # mirror shared + globalSetup ./tests/global-setup.ts
├── drizzle.config.ts                 # dialect postgresql, schema ./src/schema/index.ts, out ./migrations, extensionsFilters ["postgis"]
├── migrations/                       # 0000_enable_postgis.sql (custom) + 0001_* (generated) + meta/
├── src/
│   ├── index.ts                      # public API: schema re-exports + createDb + seedRiga + postgis helpers
│   ├── client.ts                     # createDb(connectionString): pg Pool + drizzle({schema})
│   ├── postgis.ts                    # polygonToEwkt(ring) pure helper + geometryPolygon customType
│   ├── schema/
│   │   ├── index.ts                  # re-export all tables/enums (drizzle.config schema entry)
│   │   ├── enums.ts                  # every pgEnum, derived from @taxi/shared const arrays
│   │   ├── users.ts                  # users
│   │   ├── drivers.ts                # drivers (PK = user_id)
│   │   ├── vehicles.ts               # vehicles
│   │   ├── geo.ts                    # cities, geozones (+ GIST index, unique (city_id, slug))
│   │   ├── platform-config.ts        # platform_config (unique city_id)
│   │   ├── rides.ts                  # rides, ride_fare_lines, ride_offers
│   │   ├── ledger.ts                 # ledger_accounts, ledger_entries
│   │   └── dispatch-audit.ts         # dispatch_audit_log
│   └── seed/
│       ├── riga.ts                   # fixed UUIDs + polygon rings + seedRiga(db) upsert function
│       └── run.ts                    # CLI wrapper: createDb(env) → seedRiga → exit
└── tests/
    ├── global-setup.ts               # drop/create taxi_test, run migrator, seed once
    ├── helpers.ts                    # test Pool/db handles, connection-refused → "docker compose up -d" message
    ├── postgis-smoke.test.ts         # ST_Contains finds the seeded zones
    ├── schema-constraints.test.ts    # 1+1+1: valid ride roundtrip / money columns integer-only / unknown status rejected
    └── postgis-helpers.test.ts       # pure unit tests for polygonToEwkt (no DB needed)
services/api/src/db-schema.spec.ts    # smoke: import tables from @taxi/db, expect defined
```

Modified: `pnpm-workspace.yaml` (add `- "db"`), `services/api/package.json` (add dep).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Drizzle PostgreSQL column types](https://orm.drizzle.team/docs/column-types/pg) — `pgEnum`, `integer`, `doublePrecision`, `jsonb`, `timestamp({ withTimezone: true })`, `uuid`, `customType`.
- [Drizzle PostgreSQL extensions / PostGIS](https://orm.drizzle.team/docs/extensions/pg) — built-in `geometry` supports **point only**; polygons need `customType`. Also documents `extensionsFilters: ["postgis"]` so drizzle-kit ignores `spatial_ref_sys` when diffing.
- [Drizzle Kit generate](https://orm.drizzle.team/docs/drizzle-kit-generate) — `drizzle-kit generate --custom --name=enable_postgis` produces the empty migration 0000 we fill with `CREATE EXTENSION IF NOT EXISTS postgis;`.
- [Drizzle Kit migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate) + [node-postgres migrator](https://orm.drizzle.team/docs/get-started-postgresql) — CLI migrate for the package script; programmatic `migrate()` from `drizzle-orm/node-postgres/migrator` for test global-setup.
- [Drizzle indexes](https://orm.drizzle.team/docs/indexes-constraints) — `.using("gist", table.polygon)` for the geozone spatial index; `uniqueIndex` for `(city_id, slug)`.
- [PostGIS ST_Contains](https://postgis.net/docs/ST_Contains.html) + [ST_GeomFromEWKT](https://postgis.net/docs/ST_GeomFromEWKT.html) — smoke-test query and seed geometry input format.

### Patterns to Follow

**Enum single-sourcing (the load-bearing pattern of this ticket):**

```ts
// db/src/schema/enums.ts — values come FROM shared, never retyped
import { USER_ROLES, DRIVER_STATUSES /* … */ } from "@taxi/shared";
import { RIDE_STATUSES } from "@taxi/shared"; // exported via shared index
import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", USER_ROLES);
export const rideStatusEnum = pgEnum("ride_status", RIDE_STATUSES);
```

`pgEnum` accepts the readonly `as const` tuples shared exports directly. If TS complains about the readonly tuple type on some enum, use this exact fallback (loses no type safety — the literal union survives):

```ts
export const rideStatusEnum = pgEnum(
  "ride_status",
  RIDE_STATUSES as unknown as [RideStatus, ...RideStatus[]],
);
```

**Polygon custom type + EWKT helper** (`db/src/postgis.ts`):

```ts
import { customType } from "drizzle-orm/pg-core";
import type { LatLng } from "@taxi/shared";

/** EWKT in (Postgres parses it into geometry), raw WKB hex out (opaque — read via ST_AsGeoJSON in SQL). */
export const geometryPolygon = customType<{ data: string }>({
  dataType: () => "geometry(Polygon,4326)",
});

/** Closes the ring (shared geozoneSchema: "first and last vertex need not repeat"). WKT order is lng lat. */
export function polygonToEwkt(ring: LatLng[]): string {
  const closed = [...ring, ring[0]!];
  const coords = closed.map((p) => `${p.lng} ${p.lat}`).join(", ");
  return `SRID=4326;POLYGON((${coords}))`;
}
```

**Money columns:** every money column is named `*_cents` and typed `integer(...)`. NEVER `numeric` (node-postgres returns numerics as strings) and never float. Percentages (`commission_pct`, `commission_pct_override`) and `rating` are `doublePrecision` — they are not money.

**Package shape:** copy `packages/shared`'s `package.json` structure (private, `main`/`types` → dist, exports map, `build`/`typecheck`/`test` scripts) and both tsconfigs verbatim, adjusting `include` to `["src", "tests", "drizzle.config.ts"]` in `tsconfig.json`.

**Test naming:** `it("… (expected)")` / `(edge)` / `(failure)` with the domain reason in the name, per `packages/shared/tests/*`.

**Comment style:** comments state constraints and evidence refs (S-numbers, ticket numbers), not mechanics — mirror shared's density.

---

## IMPLEMENTATION PLAN

### Phase 1: Package scaffold

Workspace registration, package.json, tsconfigs, drizzle config. Verify: `pnpm install` resolves `@taxi/db`.

### Phase 2: Schema

**Depends on:** Phase 1

All table files + enums + postgis custom type. Verify: `pnpm --filter @taxi/db typecheck`.

### Phase 3: Migrations + seed

**Depends on:** Phase 2

Custom postgis migration, generated schema migration, seed data + runner. Verify: fresh docker → migrate → seed succeeds twice in a row.

### Phase 4: Tests + api wiring

**Depends on:** Phase 3 (tests run migrations/seed against `taxi_test`)
**Independent of each other:** the api smoke spec (Task 12) only needs Phase 2's build — it can land any time after it.

Integration tests, api dependency + smoke spec, full `pnpm check`.

---

## STEP-BY-STEP TASKS

### Task 1 — UPDATE `pnpm-workspace.yaml`

- **IMPLEMENT**: add `- "db"` to the `packages:` list.
- **GOTCHA**: without this the package is invisible to pnpm AND turbo; everything downstream fails confusingly.
- **VALIDATE**: after Task 2, `pnpm install` lists `@taxi/db` (`pnpm ls -r --depth -1 | grep @taxi/db`)
- **SATISFIES**: AC "wired into the workspace / pnpm check green"

### Task 2 — CREATE `db/package.json`, `db/tsconfig.json`, `db/tsconfig.build.json`, `db/vitest.config.ts`

- **IMPLEMENT**: `@taxi/db`, private, main/types → dist, exports map — MIRROR `packages/shared/package.json`. Scripts: `build` (`tsc -p tsconfig.build.json`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `pretest` (`docker compose -f ../docker-compose.yml up -d --wait`), `generate` (`drizzle-kit generate`), `migrate` (`drizzle-kit migrate`), `seed` (`tsx src/seed/run.ts`). The `pretest` hook makes `pnpm check` self-sufficient: `--wait` blocks on the compose healthchecks (both services define them), so tests never race a cold Postgres and a stopped Docker daemon is the ONLY remaining failure mode (surfaced by pretest with Docker's own clear error, before any test runs). Deps: `drizzle-orm ^0.44.0`, `pg ^8.16.0`, `@taxi/shared workspace:*`. DevDeps: `drizzle-kit ^0.31.0`, `tsx ^4`, `@types/pg`, `typescript ^5.7.0`, `vitest ^3.0.0`, `@taxi/config workspace:*`. tsconfigs mirror shared (tsconfig.json include adds `drizzle.config.ts`). vitest.config mirrors shared + `globalSetup: ["./tests/global-setup.ts"]`.
- **PATTERN**: `packages/shared/package.json`, `packages/shared/tsconfig*.json`, `packages/shared/vitest.config.ts`
- **VALIDATE**: `pnpm install` succeeds
- **SATISFIES**: AC "runnable via package scripts"

### Task 3 — CREATE `db/drizzle.config.ts`

- **IMPLEMENT**: `defineConfig({ dialect: "postgresql", schema: "./src/schema/index.ts", out: "./migrations", dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://taxi:taxi@localhost:5432/taxi" }, extensionsFilters: ["postgis"] })`.
- **GOTCHA**: `extensionsFilters: ["postgis"]` is required or drizzle-kit tries to manage `spatial_ref_sys`.
- **VALIDATE**: `pnpm --filter @taxi/db exec drizzle-kit generate --custom --name=noop_check` then delete the artifact (proves config parses) — or defer to Task 8.
- **SATISFIES**: AC "wired into services/api drizzle config" (see NOTES: config lives with the migrations in `@taxi/db`; the api consumes the package)

### Task 4 — CREATE `db/src/postgis.ts` + `db/src/schema/enums.ts`

- **IMPLEMENT**: `geometryPolygon` customType + `polygonToEwkt` (see Patterns). All pgEnums: `user_role`, `driver_status`, `ride_status`, `ride_category`, `payment_method_type`, `dispatch_mode`, `pricing_model`, `offer_status`, `assignment_source`, `commission_source`, plus db-local `fare_line_type` (`["base","distance","time","discount"]` — mirrors `fareQuoteSchema.breakdown` keys), `ledger_owner_type` (`["platform","driver","rider"]`), `ledger_entry_type` (`["ride_fare","commission","cash_settlement","payout","adjustment"]` — shape-level, #12 owns semantics).
- **IMPORTS**: enums from `@taxi/shared` (check `packages/shared/src/index.ts` export names first); `pgEnum`, `customType` from `drizzle-orm/pg-core`.
- **GOTCHA**: `RIDE_STATUSES` comes from `ride-state-machine.ts`, exported through shared's index — do not redefine any value list locally except the three db-local ones above.
- **VALIDATE**: `pnpm --filter @taxi/db typecheck`
- **SATISFIES**: AC "unknown status rejected" (the pgEnum is the mechanism)

### Task 5 — CREATE `db/src/schema/users.ts`, `drivers.ts`, `vehicles.ts`

- **IMPLEMENT**:
  - `users`: `id` uuid PK `defaultRandom()`, `phone` text notNull unique, `email` text, `role` userRoleEnum notNull, `language` text notNull default `'lv'`, `display_name` text, `created_at` timestamptz notNull defaultNow.
  - `drivers`: `user_id` uuid PK references `users.id`, `status` driverStatusEnum notNull default `'offline'`, `spoken_languages` `text().array()` notNull default `['lv']`, `is_female` boolean (nullable), `fleet_id` uuid (nullable, NO FK — owned-fleet extension point, no fleets table yet), `rating` doublePrecision, `balance_cents` integer notNull default 0 (signed — cash commission nets against card earnings, skeleton §5.3), `commission_pct_override` doublePrecision (nullable — S6-7 0%-pilot lives here; `resolveCommissionPct` reads it).
  - `vehicles`: `id` uuid PK defaultRandom, `driver_id` uuid notNull references `drivers.user_id`, `plate` text notNull, `make`/`model` text notNull, `year` integer notNull, `category` rideCategoryEnum notNull default `'standard'`, `passenger_seats` integer notNull, `has_child_seat` boolean notNull default false.
- **PATTERN**: mirror `driverProfileSchema`/`userSchema`/`vehicleSchema` field-for-field; column names snake_case.
- **VALIDATE**: `pnpm --filter @taxi/db typecheck`
- **SATISFIES**: AC schema scope (users/drivers/vehicles incl. female-driver pref + child seat)

### Task 6 — CREATE `db/src/schema/geo.ts` + `platform-config.ts`

- **IMPLEMENT**:
  - `cities`: `id` uuid PK defaultRandom, `name` text notNull unique, `country_code` text notNull default `'LV'`, `timezone` text notNull default `'Europe/Riga'`.
  - `geozones`: `id` uuid PK defaultRandom, `city_id` uuid notNull references `cities.id`, `slug` text notNull (free-form — Dina adds zones without code changes), `name` text notNull, `polygon` `geometryPolygon("polygon")` notNull, `queue_mode_enabled` boolean notNull default false. Indexes: `uniqueIndex` on `(city_id, slug)`; `index(...).using("gist", t.polygon)`.
  - `platform_config`: `id` uuid PK defaultRandom, `city_id` uuid notNull unique references `cities.id`, `commission_pct` doublePrecision notNull (NO column default — config not constant; the SEED supplies 15), `hourly_guarantee_cents` integer (nullable), `weekly_guarantee_cents` integer (nullable), `default_dispatch_mode` dispatchModeEnum notNull default `'auto_match'`, `offer_timeout_seconds` integer notNull default 20, `unclaimed_alert_seconds` integer notNull default 60, `updated_at` timestamptz notNull defaultNow.
- **GOTCHA**: resist giving `commission_pct` a DB default of 15 — that recreates the constant the architecture forbids. The seed row carries 15.
- **VALIDATE**: `pnpm --filter @taxi/db typecheck`
- **SATISFIES**: AC geozones + platform_config seed shape

### Task 7 — CREATE `db/src/schema/rides.ts`, `ledger.ts`, `dispatch-audit.ts`, `index.ts`, plus `db/src/client.ts` and `db/src/index.ts`

- **IMPLEMENT**:
  - `rides` (mirrors `rideSchema`): `id` uuid PK defaultRandom, `order_id` uuid notNull (groups multi-taxi orders), `status` rideStatusEnum notNull, `rider_id` uuid notNull references `users.id`, `driver_id` uuid references `drivers.user_id` (nullable — "the denormalized field #6 indexes"), `geozone_id` uuid references `geozones.id` (nullable), `request` jsonb notNull (full `RideRequest`), `scheduled_for` timestamptz (nullable), `payment_method` paymentMethodTypeEnum notNull, `category` rideCategoryEnum notNull, `pricing_model` pricingModelEnum (nullable until quoted), `total_cents` integer (nullable — quote total), `commission_pct` doublePrecision, `commission_source` commissionSourceEnum, `commission_cents` integer, `driver_net_cents` integer (all four nullable — written at completion, #11), `created_at`/`updated_at` timestamptz notNull defaultNow. Indexes: `rider_id`, `driver_id`, `status`, `order_id`.
  - `ride_fare_lines` (the ticket's fare-breakdown lines, normalized from `fareQuoteSchema.breakdown`): `id` uuid PK defaultRandom, `ride_id` uuid notNull references `rides.id` `onDelete: "cascade"`, `line_type` fareLineTypeEnum notNull, `amount_cents` integer notNull (signed — discount lines are negative), `sort` integer notNull default 0. Index on `ride_id`.
  - `ride_offers` (insert shape derived from `rideOfferSchema`, as its docblock anticipates): `id` uuid PK defaultRandom, `ride_id` uuid notNull references `rides.id`, `driver_id` uuid notNull references `drivers.user_id`, `status` offerStatusEnum notNull, `source` assignmentSourceEnum notNull, `sent_at`/`expires_at` timestamptz notNull, `eta_seconds` integer notNull, `pickup`/`destination`/`quote`/`split` jsonb notNull, `queue_position` integer (nullable). Index on `ride_id`.
  - `ledger_accounts`: `id` uuid PK defaultRandom, `owner_type` ledgerOwnerTypeEnum notNull, `owner_id` uuid (nullable — the platform account has none), `currency` text notNull default `'EUR'`, `created_at` timestamptz notNull defaultNow; `uniqueIndex` on `(owner_type, owner_id)`.
  - `ledger_entries`: `id` uuid PK defaultRandom, `transaction_id` uuid notNull (double-entry pairing key), `account_id` uuid notNull references `ledger_accounts.id`, `ride_id` uuid references `rides.id` (nullable), `entry_type` ledgerEntryTypeEnum notNull, `amount_cents` integer notNull (signed), `created_at` timestamptz notNull defaultNow. Indexes: `account_id`, `transaction_id`.
  - `dispatch_audit_log` (mirrors `rideAssignmentSchema` + room for #10's events): `id` uuid PK defaultRandom, `ride_id` uuid notNull references `rides.id`, `driver_id` uuid references `drivers.user_id` (nullable), `source` assignmentSourceEnum notNull, `dispatcher_id` uuid references `users.id` (nullable — required-when-dispatcher is app-level, enforced by the zod refine), `reason` text (nullable, max length app-level), `payload` jsonb (nullable), `created_at` timestamptz notNull defaultNow. Index on `ride_id`.
  - `schema/index.ts` re-exports everything; `client.ts`: `createDb(connectionString)` → `new Pool({ connectionString })` + `drizzle(pool, { schema })`, returning `{ db, pool }`; `src/index.ts` re-exports schema, `createDb`, `polygonToEwkt`, `seedRiga`.
- **GOTCHA**: self-referencing/circular FKs aren't needed here — keep table files import-acyclic (rides imports users/drivers/geo; ledger imports rides; audit imports rides).
- **VALIDATE**: `pnpm --filter @taxi/db typecheck && pnpm --filter @taxi/db build`
- **SATISFIES**: AC schema scope (rides + fare lines, ledger, dispatch audit); "Drizzle types compile"

### Task 8 — CREATE migrations

- **IMPLEMENT**: `pnpm --filter @taxi/db exec drizzle-kit generate --custom --name=enable_postgis` → edit the generated 0000 file to exactly `CREATE EXTENSION IF NOT EXISTS postgis;`. Then `pnpm --filter @taxi/db generate` → 0001 with all tables/enums/indexes.
- **VERIFY THE GENERATED SQL** (this is where drizzle-kit could mishandle the custom type — check before running, with exact expectations):
  1. `grep 'geometry(Polygon,4326)' migrations/0001_*.sql` → the polygon column line must read `"polygon" geometry(Polygon,4326) NOT NULL` (customType `dataType` strings are emitted verbatim by generate — this is the documented contract).
  2. `grep -i 'USING gist' migrations/0001_*.sql` → expect `CREATE INDEX ... ON "geozones" USING gist ("polygon");`.
  3. `grep -icE '"[a-z_]+_cents" (integer|real|double|numeric)' migrations/0001_*.sql` sanity pass → every `*_cents` line says `integer`, none say real/double/numeric.
- **FALLBACK (deterministic, no debugging spiral)**: if check 2 fails (drizzle-kit drops or mangles the GIST index), remove the `.using("gist", ...)` index from the TS schema, regenerate 0001 clean, and add it as a second custom migration instead: `drizzle-kit generate --custom --name=geozones_gist` containing `CREATE INDEX IF NOT EXISTS geozones_polygon_gix ON geozones USING gist (polygon);` — then have the tests' `pg_indexes` assertion (Task 11) prove it exists. If check 1 fails, the customType `dataType` return string is wrong — fix the string, not the migration. Never hand-edit generated SQL or `meta/_journal.json`.
- **GOTCHA**: order matters — the extension migration must sort before the schema migration (drizzle-kit numbers sequentially; create the custom one first). `drizzle-kit generate` never connects to a DB (pure schema diff), so the postgis `geometry` type not existing at generate time is irrelevant; it only must exist at *migrate* time, which migration 0000 guarantees.
- **VALIDATE**: `docker compose up -d --wait && pnpm --filter @taxi/db migrate` (twice — second run is a no-op, proving journal idempotency)
- **SATISFIES**: AC "fresh docker compose up → migrate"; "migrations re-runnable from zero"

### Task 9 — CREATE `db/src/seed/riga.ts` + `db/src/seed/run.ts`

- **IMPLEMENT**: fixed UUIDs (hardcoded constants — deterministic, re-runnable) for Rīga city, 4 geozones, 1 platform_config row. `seedRiga(db)` upserts via `.onConflictDoUpdate` keyed on `cities.name`, `(city_id, slug)`, `platform_config.city_id`. Zones (approximate is fine — they're config, editable later via #20; ring order lng-lat handled by `polygonToEwkt`):
  - `centre` — "Rīgas centrs": ring (lat,lng) (56.936, 24.075), (56.936, 24.135), (56.966, 24.135), (56.966, 24.075); `queueModeEnabled: false`
  - `rix` — "Lidosta RIX": (56.908, 23.950), (56.908, 23.995), (56.935, 23.995), (56.935, 23.950); `queueModeEnabled: true` (airport rank — S7-2 queue culture)
  - `autoosta` — "Rīgas autoosta": (56.941, 24.108), (56.941, 24.122), (56.949, 24.122), (56.949, 24.108); `queueModeEnabled: true` (Dina's autoosta queue — S7-2)
  - `old_town` — "Vecrīga": (56.943, 24.095), (56.943, 24.115), (56.953, 24.115), (56.953, 24.095); `queueModeEnabled: false`. (Overlaps `centre` deliberately — zone-resolution precedence is #10's problem, noted there.)
  - `platform_config`: `commissionPct: 15` (the launch decision, 2026-08-03), guarantees `null`, other columns defaults.
  - `run.ts`: read `DATABASE_URL` (default the docker URL), `createDb`, `seedRiga`, log seeded slugs, `pool.end()`.
- **GOTCHA**: slugs must be exactly the `RIGA_PILOT_DISTRICTS` members (`centre`, `rix`, `autoosta`, `old_town`) — import the const and derive, don't retype. Polygon insert value is `polygonToEwkt(ring)` (a string; the customType passes it through and Postgres parses EWKT).
- **VALIDATE**: `pnpm --filter @taxi/db seed` twice — second run succeeds without duplicate rows (`SELECT count(*) FROM geozones` = 4)
- **SATISFIES**: AC "seed → zones exist"; seeded `commissionPct: 15`

### Task 10 — CREATE `db/tests/global-setup.ts` + `db/tests/helpers.ts`

- **IMPLEMENT**: global-setup connects to the admin DB (`postgres://taxi:taxi@localhost:5432/taxi`, overridable via `DATABASE_URL`), `DROP DATABASE IF EXISTS taxi_test WITH (FORCE)` + `CREATE DATABASE taxi_test`, then against `taxi_test`: programmatic `migrate(db, { migrationsFolder: "./migrations" })` (from `drizzle-orm/node-postgres/migrator`) + `seedRiga(db)`. On `ECONNREFUSED`, throw `"Postgres is not up — run: docker compose up -d"`. `helpers.ts` exports `getTestDb()` returning a lazily-created client to `taxi_test` and a `closeTestDb()` for afterAll.
- **GOTCHA**: `WITH (FORCE)` needs PG 13+ — the compose image is PG 16, fine. Vitest globalSetup runs in a separate process: no state sharing with tests, hence helpers create their own pool. Readiness is already guaranteed by the `pretest` hook (`docker compose up -d --wait` blocks on the pg healthcheck), so the `ECONNREFUSED` message is a belt-and-braces guard for direct `vitest` invocations that bypass the pnpm script.
- **VALIDATE**: `pnpm --filter @taxi/db test` (with docker up) reaches the test files
- **SATISFIES**: AC "fresh … → migrate → seed → tests" against an isolated DB

### Task 11 — CREATE the three test files

- **IMPLEMENT**:
  - `postgis-helpers.test.ts` (pure, no DB): `polygonToEwkt` closes the ring (expected); single repeated point still emits ≥4 vertices (edge); output starts `SRID=4326;POLYGON((` and orders lng-before-lat (assert on a known pair) (failure-ish guard).
  - `postgis-smoke.test.ts`: `ST_Contains` with a point inside Vecrīga (lng 24.106, lat 56.9489) returns `old_town` AND `centre` (overlap is real) (expected); a point in Jūrmala (~23.77, 56.97) matches zero zones (edge); the GIST index exists (`pg_indexes` query) and all 4 seeded slugs present (expected). Query shape: `sql\`SELECT slug FROM geozones WHERE ST_Contains(polygon, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))\``.
  - `schema-constraints.test.ts`: insert user→driver→ride with valid enum + fare lines, read back, totals intact (expected); `information_schema.columns` — every column named `%_cents` across the schema has `data_type = 'integer'` (edge — the money rule as a self-extending guard: a future float money column fails this test automatically); raw-SQL insert of ride `status = 'flying'` rejects with enum error, and insert of `amount_cents = 10.5` does NOT create a fractional cent (assert stored value is integer / or assert the zod boundary is the guard — see GOTCHA) (failure).
- **GOTCHA**: Postgres silently **rounds** numeric→integer on insert (`10.5` → `10` or `11`), it does not error — so the "integer-only" claim is proven by the `information_schema` column-type assertion + the enum rejection, not by expecting an insert error on a float. Don't write a test expecting Postgres to reject `10.5`.
- **VALIDATE**: `pnpm --filter @taxi/db test` — all green
- **SATISFIES**: AC "1+1+1 tests on schema constraints (money integer-only, unknown status rejected)"; "ST_Contains smoke test finds the zones"

### Task 12 — UPDATE `services/api/package.json` + CREATE `services/api/src/db-schema.spec.ts`

- **IMPLEMENT**: add `"@taxi/db": "workspace:*"` to api dependencies; `pnpm install`. Spec imports `{ rides, geozones, platformConfig, createDb }` from `@taxi/db` and asserts they're defined (compile-time importability is the real assertion; jest `rootDir: src` + `testRegex .*\.spec\.ts$` picks it up).
- **GOTCHA**: turbo `test`/`typecheck` `dependsOn: ["^build"]` — `@taxi/db` dist exists before api tests run; nothing extra needed. Do NOT wire a NestJS module — that's #7.
- **VALIDATE**: `pnpm --filter @taxi/api test`
- **SATISFIES**: AC "Drizzle types … importable by the api"

### Task 13 — Full gate

- **IMPLEMENT**: `docker compose down -v && docker compose up -d --wait`, then `pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db seed && pnpm check`.
- **VALIDATE**: everything green from a wiped volume — the literal AC sentence.
- **SATISFIES**: AC "fresh docker compose up → migrate → seed → smoke test"; "pnpm check green"

---

## TESTING STRATEGY

### Unit Tests

`postgis-helpers.test.ts` — pure `polygonToEwkt` logic, runs without Docker. Vitest, mirroring `packages/shared/tests` naming.

### Integration Tests

`postgis-smoke.test.ts` + `schema-constraints.test.ts` run against a real dockerized PostGIS (`taxi_test` DB, created/migrated/seeded in vitest globalSetup). This is deliberate: the ticket's ACs (ST_Contains, enum rejection, integer columns) are *database* behaviors — mocking would test nothing. Requires `docker compose up -d`; the setup fails fast with an actionable message if Postgres is down (same operating assumption as the rest of the repo's command flow).

### Edge Cases

- Seed re-run (idempotency — upserts, fixed UUIDs, still exactly 4 zones).
- Migration re-run (journal no-op).
- Overlapping polygons (Vecrīga ⊂ centre) — both returned; precedence explicitly deferred to #10.
- Point outside all zones → empty result (Jūrmala point).
- `%_cents` column sweep via `information_schema` — catches future float money columns without editing the test.
- Signed money columns (`balance_cents`, `ledger_entries.amount_cents`, discount fare lines) accept negatives; that is by design (skeleton §5.3 netting), not a bug.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/db typecheck && pnpm --filter @taxi/db build
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/db exec vitest run tests/postgis-helpers.test.ts   # no docker needed
```

### Level 3: Integration Tests

```bash
pnpm --filter @taxi/db test     # pretest hook boots + health-waits docker itself
pnpm --filter @taxi/api test
```

### Level 4: Manual Validation

```bash
docker compose down -v && docker compose up -d --wait   # wiped volume — "from zero", blocks until healthy
pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db migrate   # second = no-op
pnpm --filter @taxi/db seed && pnpm --filter @taxi/db seed         # second = still 4 zones
docker compose exec db psql -U taxi -c "SELECT slug FROM geozones WHERE ST_Contains(polygon, ST_SetSRID(ST_MakePoint(24.106, 56.9489), 4326));"
# expect: old_town, centre
docker compose exec db psql -U taxi -c "SELECT commission_pct FROM platform_config;"   # expect: 15
pnpm check
```

---

## ACCEPTANCE CRITERIA

- [ ] Fresh `docker compose up` → migrate → seed → `ST_Contains` smoke test finds the zones (AC #1)
- [ ] Drizzle types compile and are importable by the api (`services/api/src/db-schema.spec.ts` green); `pnpm check` green (AC #2)
- [ ] Migrations re-runnable from zero; 1+1+1 schema-constraint tests: money columns integer-only, unknown status rejected (AC #3)
- [ ] Seeded `platform_config.commission_pct = 15`; guarantees NULL; no DB-level default on `commission_pct`
- [ ] All enums derive from `@taxi/shared` const arrays — no value list duplicated
- [ ] `return_offer_windows` and demand signals nowhere in the schema
- [ ] Every file ≤500 lines; comments match shared's evidence-citing style

## COMPLETION CHECKLIST

- [ ] All 13 tasks completed in order
- [ ] Each task's VALIDATE command passed immediately
- [ ] `pnpm check` green from a wiped docker volume
- [ ] No linting or type errors anywhere in the workspace
- [ ] Manual psql smoke queries return expected zones and commission
- [ ] Branch + PR with `Closes #6`

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Placement decided here: root `db/` as `@taxi/db`** (the ticket delegates the call to this plan). Rationale: skeleton §4 names root `db/`, the empty directory already exists, and a workspace package gives the api a clean `import from "@taxi/db"` while keeping migrations/seed independently runnable. "Wired into services/api drizzle config" is satisfied by the api depending on the package — the drizzle config itself lives beside the migrations it manages. Not an epic-decision break; the ticket explicitly allowed either.
- **Resolved (was a risk):** integration tests need Postgres — the `pretest` hook (`docker compose up -d --wait`) boots and health-waits the stack itself, so `pnpm check` is self-sufficient whenever the Docker daemon is running. A stopped daemon fails fast in pretest with Docker's own actionable error, before any test executes.
- **Assumption:** `int4` cents suffice (max ≈ €21.4M per value) — orders of magnitude above any taxi fare, guarantee, or pilot-era balance.
- **Assumption:** queue mode seeds `true` for `rix` + `autoosta` (evidenced rank/queue culture, S7-2), `false` for `centre`/`old_town`. It's a seed value, not code — Dina flips it in #20.
- **Assumption:** polygons are hand-drawn rectangles. Explicitly sanctioned by the ticket ("approximate is fine for pilot; they're config, editable later via #20"); exact pilot zones are an open architecture question owned by "decide with Dina".
- **Assumption:** `dispatch_audit_log` stays event-shaped (one row per assignment-relevant event with jsonb payload) rather than a strict `ride_assignments` mirror — #10 writes it; shape-level is what the architecture asks of #6.

## NOTES (open canvas)

**Why a package, not loose files:** turbo only sees workspace packages; making `db/` a package means `typecheck`/`test`/`build` join `pnpm check` for free, and `dependsOn: ["^build"]` guarantees `@taxi/db/dist` exists before api tests import it — zero turbo.json changes needed.

**Why EWKT strings instead of a GeoJSON-parsing custom type:** drizzle's built-in `geometry` is point-only; a full read-side polygon type means parsing WKB hex in `fromDriver` — real complexity with no consumer in this ticket (nothing reads polygons into JS; dispatch does zone lookups in SQL via ST_Contains, per the dispatch-strategies reference). Write-side EWKT is one pure helper. If #10/#19 later need polygons client-side, add `ST_AsGeoJSON` reads then. Rejected alternative: storing polygons as jsonb and skipping PostGIS — kills ST_Contains and the whole point of the postgis image.

**Fare breakdown normalization:** `fareQuoteSchema.breakdown` is a fixed 4-key object, but the ticket asks for "fare-breakdown *lines*" — a table. The lines table wins for #11/#12 (per-line ledger references, extensible for #23's knock-down and future surcharges) at the cost of one join. `rides.request`/offer `quote`/`split` stay jsonb because they are wire-shape snapshots (audit "what was shown"), while the *settled* money lands in typed integer columns + lines — queryable for Dina's stats (S7-2) and the driver-earnings views.

**jsonb vs columns rule of thumb used throughout:** snapshot-of-a-contract → jsonb (validated by zod at the boundary); anything queried/aggregated/summed → typed columns. That's why `rides` has both `request` jsonb and denormalized `status`/`driver_id`/`total_cents` columns.

**Numeric gotcha worth remembering:** node-postgres returns `numeric` as string — hence `doublePrecision` for percentages and `integer` for cents; `numeric` appears nowhere.

**Risk register (all closed at plan time):**

| Risk | Mitigation | Where |
|---|---|---|
| drizzle-kit mangles the polygon customType or GIST index in generated SQL | Pre-run grep verification of 0001 with exact expected lines, plus a deterministic fallback (index moves to a custom migration; `pg_indexes` test proves it landed either way). customType `dataType` strings are emitted verbatim per drizzle's documented contract, and `generate` never touches the DB, so the extension's absence at generate time is a non-issue. | Task 8, Task 11 |
| `pnpm check` fails when Docker is cold/down | `pretest: docker compose up -d --wait` — self-boots and blocks on the existing healthchecks; only a stopped Docker daemon still fails, loudly and before tests. | Task 2, Task 10 |
| Float-money test written wrong (Postgres rounds numeric→integer instead of erroring) | The integer-only AC is proven by the `information_schema` column-type sweep + enum-rejection failure test, never by expecting an insert error on `10.5`; the sweep is self-extending to future `*_cents` columns. | Task 11 GOTCHA |
| `pgEnum` rejects shared's readonly tuples on some TS/drizzle combo | Exact typed-assertion fallback snippet in Patterns — mechanical, no research needed at implement time. | Patterns |
| `@taxi/db` invisible to pnpm/turbo | `- "db"` in `pnpm-workspace.yaml` is Task 1, validated by `pnpm ls -r`; turbo's `^build` then guarantees dist exists before the api spec imports it. | Tasks 1, 12 |

**Sequencing note:** #7 (auth + realtime gateway) is the direct consumer — it will add the NestJS Drizzle provider, connection lifecycle, and env config. Nothing in this ticket should anticipate it beyond `createDb`.

## AMENDMENTS

<!-- append-only; newest at bottom -->
