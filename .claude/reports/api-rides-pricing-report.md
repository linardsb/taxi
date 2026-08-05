# Implementation Report — API rides + pricing

**Plan**: `.claude/plans/api-rides-pricing.md`   **Branch**: `feature/api-rides-pricing`   **Status**: COMPLETE

## Summary

A ride now exists and has a price. `POST /rides` routes a request through the `MapsProvider` seam (stub + Redis caching decorator), prices it through the `UpfrontFixed` implementation of `PricingStrategy` against `ride_tariffs` rows, resolves the commission from `platform_config` at quote time, persists the ride plus its normalized fare lines in one transaction at the state machine's entry status, joins the rider's sockets to the ride room and emits `ride:status`. Four new slices (`geo`, `platform-config`, `pricing`, `rides`), one new table with migration `0005`, and three new `@taxi/shared` contracts. All 27 plan tasks completed in order.

## Tasks completed

**Phase 1 — contracts (`@taxi/shared`)**
- Task 1 `rideTariffSchema` → `packages/shared/src/schemas/tariff.ts` (CREATE)
- Task 2 `rideRequestBodySchema` + `rideCreatedSchema` → `packages/shared/src/schemas/ride.ts` (UPDATE)
- Task 3 barrel export → `packages/shared/src/index.ts` (UPDATE)
- Task 4 tests → `packages/shared/tests/tariff.test.ts` (CREATE), `tests/schemas.test.ts` (UPDATE)

**Phase 2 — persistence (`@taxi/db`)**
- Task 5 `ride_tariffs` table → `db/src/schema/ride-tariffs.ts` (CREATE) + both barrels (UPDATE)
- Task 6 migration → `db/migrations/0005_redundant_stature.sql` + snapshot + journal (GENERATED)
- Task 7 four seeded Rīga tariffs → `db/src/seed/riga.ts`, `db/src/index.ts` (UPDATE)
- Task 8 constraint tests → `db/tests/schema-constraints.test.ts` (UPDATE)

**Phase 3 — maps seam (`features/geo`)**
- Task 9 `MAPS_ROUTE_CACHE_TTL_SECONDS` → `common/config/env.schema.ts`, `.env.example` (UPDATE)
- Tasks 10–12 → `haversine.ts`, `stub-maps.provider.ts`, `maps.tokens.ts`, `caching-maps.provider.ts`, `geo.module.ts`, `index.ts` (CREATE)
- Task 13 three specs (CREATE)

**Phase 4 — `features/platform-config`** — Task 14: repository, service, module, barrel, spec (CREATE)

**Phase 5 — `features/pricing`** — Tasks 15–18: `pricing.tokens.ts`, `tariff.repository.ts`, `upfront-fixed.strategy.ts`, `pricing.service.ts`, module, barrel, two specs (CREATE)

**Phase 6 — `features/rides`** — Tasks 19–22: `ride-entry.ts`, `rides.repository.ts`, `rides.service.ts`, `rides.controller.ts`, module, barrel (CREATE); `app.module.ts` (UPDATE)

**Phase 7 — tests, docs, gate**
- Task 23 `CountingMapsProvider` + `MAPS_PROVIDER_SOURCE` override → `services/api/test/harness.ts` (UPDATE)
- Tasks 24–25 `rides.integration.spec.ts`, `rides.service.spec.ts` (CREATE)
- Task 26 `services/api/CLAUDE.md`, `.claude/references/realtime-events.md` (UPDATE)
- Task 27 full gate + Level 4 manual smoke test

## Tests added

| Suite | Cases | Result |
|---|---|---|
| `shared/tests/tariff.test.ts` | 5 (expected/edge/3 failure) | pass |
| `shared/tests/schemas.test.ts` (added) | 5 for `rideRequestBodySchema` + `rideCreatedSchema` | pass |
| `db/tests/schema-constraints.test.ts` (added) | 2 (seed produced 4 rows; composite-unique rejection) | pass |
| `geo/stub-maps.provider.spec.ts` | 4 | pass |
| `geo/caching-maps.provider.spec.ts` | 4 (incl. corrupt-entry parse failure) | pass |
| `geo/geo.module.spec.ts` | 3 (incl. the module-metadata binding check) | pass |
| `platform-config/platform-config.service.spec.ts` | 3 (incl. `commissionPct: 0` survives) | pass |
| `pricing/upfront-fixed.strategy.spec.ts` | 4 (incl. minimum-fare top-up, zero-length route) | pass |
| `pricing/pricing.service.spec.ts` | 4 (incl. config 15→12 with no code change) | pass |
| `rides/ride-entry.spec.ts` | 4 | pass |
| `rides/rides.service.spec.ts` | 4 (join-before-emit ordering, ISO `at`, both guards) | pass |
| `rides/rides.integration.spec.ts` | 6 (incl. the cache-call-count assertion) | pass |

## Validation results

**Gate — `pnpm turbo run typecheck lint test build --force` from a cleared `dist`: GREEN (18/18 tasks).**

- api jest: 152 passed, 11 skipped, 163 total, 25/26 suites (the skipped suite is pre-existing)
- shared vitest: 111 passed
- db vitest: 16 passed
- lint: 0 errors, 3 warnings (all pre-existing `no-unsafe-argument` on `getHttpServer()`)
- No regressions in the auth, realtime, drivers, shared or db suites

**Level 4 manual smoke test — all six steps confirmed against the live app:**

1. Quote — centre → RIX returned `requested` / `upfront_fixed` / **1394 cents**, breakdown `base 200 + distance 932 + time 262`, exactly the plan's predicted figure and within €0.94 of S5-1's real €13 fare.
2. Split — `pct 15`, `platform_base`, `commission 209 + net 1185 = 1394`.
3. Cache — `maps:route:v1:56.9496,24.1052|56.9236,23.9711` present in Redis after the first request.
4. Config not constant — `UPDATE platform_config SET commission_pct = 12` moved the split to `167/1227` **with no restart and no code change**; restored to 15.
5. Guard — `vehicleCount: 3` → HTTP 400.
6. Production refusal — `NODE_ENV=production` fails at boot with *"No production MapsProvider is bound…"*.

## Deviations from the plan

1. **OPEN QUESTION #3 resolved by Linards: `split` STAYS in the response.** `POST /rides` returns `{ ride, split }` as planned — the rider sees the commission line. Chosen deliberately as the transparency pitch; the alternative (driver/dispatch-only) was declined.

2. **Integration spec E.164 range is `+371240`, not the plan's `+371230`.** `+371230` is already used by `driver-location.gateway.spec.ts:143`, which the plan did not account for (it only noted `+371220`). The collision reused another file's user *and its role*, surfacing as an unexplained 403 that appeared only in the full parallel run, never in an isolated `-- "features/rides"` run. The chosen range and the reasoning are recorded in the spec's docblock.

3. **`StubMapsProvider.geocode`/`reverseGeocode` take no parameters.** The plan's signature used `_query`/`_language`, but this repo's eslint has no `argsIgnorePattern`, so underscore-prefixed unused args are still errors. A narrower signature still satisfies the `MapsProvider` interface. `CountingMapsProvider` in the harness matches. Changing the repo-wide lint config for one file was rejected as out of scope.

4. **`ride-entry.ts` exports a `RideEntryStatus` type and `assertEntryStatus` is a TS assertion function** (`asserts status is RideEntryStatus`) — slightly beyond the plan's sketch, and it makes the repository's status narrowing structural rather than commented.

5. **Fare lines are typed via `Omit<typeof rideFareLines.$inferInsert, 'rideId'>`.** The plan's array literal inferred a union of the first three line types and rejected the conditional `discount` push.

6. **`drizzle-kit generate` needed no database.** The plan's Task 6 gotcha anticipated a Postgres-reachability problem; `generate` works offline from the migration snapshots. The reachability issue is real for `migrate`/tests, and it did bite — see below.

## Issues encountered

- **`localhost:5432` is a Homebrew postgres, not the compose container** (confirmed via `lsof`: brew `postgres` on 127.0.0.1/::1, plus an ssh tunnel on `*:5432`). Every db-touching command in this slice ran with `DATABASE_URL=postgres://taxi:taxi@192.168.1.11:5432/taxi` (the docker container's LAN IP). The compose Redis is on **6381**, not 6379, so the Level 4 `redis-cli` step ran via `docker exec taxi-redis-1`. Anyone re-running these commands needs both.
- The two failures above (E.164 collision, lint signatures) appeared **only in the full gate**, not in per-slice runs — the argument for running the real gate rather than `pnpm check`.
- Migration `0005` was reviewed before applying: exactly one `CREATE TABLE`, one FK to `cities`, one unique index. No drift.

## Not done (deliberate, per plan scope)

No dispatch (#10), no transitions or cancellation (#11), scheduled rides are inert (#21), `vehicleCount > 1` rejected (#22), no ride reads (#11/#16), `geozoneId` always null (#10), no real Google provider (#13/#16), no geocoding. Each is recorded in the owning slice's KNOWN GAPS block.

**Carry-forward:** the seeded tariff rates are placeholders fitted to S5-1's single real fare — only `standard` has any evidence, the other three are proportional guesses. They need Atis's real numbers before any pilot. Cache precision (4dp ≈ 11 m) and TTL (24 h) are guesses documented at their definitions; revisit when the first Google bill exists.
