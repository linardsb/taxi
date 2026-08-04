# Implementation Report — DB foundation: Drizzle schema, PostGIS migrations, Rīga geozone seed

**Plan**: `.claude/plans/db-foundation-drizzle-postgis.md`   **Branch**: `feature/db-foundation-drizzle-postgis`   **Status**: COMPLETE

## Summary

Created the `@taxi/db` workspace package at root `db/`: the full core-loop Drizzle schema (11 tables, 13 pg enums all derived from `@taxi/shared` const arrays), a two-migration set (0000 enables postgis, 0001 is the generated schema), and an idempotent Rīga seed (city + 4 pilot geozones + `platform_config` with `commissionPct: 15`, fixed UUIDs). Integration tests run against an isolated `taxi_test` database created/migrated/seeded in vitest global setup; `services/api` now depends on `@taxi/db` with an import smoke spec.

## Tasks completed

- [1] add `- "db"` → `pnpm-workspace.yaml` (UPDATE)
- [2] package scaffold → `db/package.json`, `db/tsconfig.json`, `db/tsconfig.build.json`, `db/vitest.config.ts` (CREATE)
- [3] drizzle config with `extensionsFilters: ["postgis"]` → `db/drizzle.config.ts` (CREATE)
- [4] `geometryPolygon` customType + `polygonToEwkt` → `db/src/postgis.ts`; all pgEnums → `db/src/schema/enums.ts` (CREATE)
- [5] `users`/`drivers`/`vehicles` → `db/src/schema/{users,drivers,vehicles}.ts` (CREATE)
- [6] `cities`/`geozones` (GIST + unique city/slug) + `platform_config` (no commission default) → `db/src/schema/{geo,platform-config}.ts` (CREATE)
- [7] `rides`/`ride_fare_lines`/`ride_offers`, ledger, dispatch audit, schema index, `createDb`, package index → `db/src/schema/{rides,ledger,dispatch-audit,index}.ts`, `db/src/client.ts`, `db/src/index.ts` (CREATE)
- [8] migrations → `db/migrations/0000_enable_postgis.sql` (custom), `db/migrations/0001_worried_grim_reaper.sql` (generated). All three SQL verification greps passed exactly (`geometry(Polygon,4326) NOT NULL`, `USING gist ("polygon")`, every `*_cents` column `integer`) — no fallback needed
- [9] idempotent seed → `db/src/seed/riga.ts`, `db/src/seed/run.ts` (CREATE)
- [10] test infra → `db/tests/global-setup.ts`, `db/tests/helpers.ts` (CREATE)
- [11] tests → `db/tests/{postgis-helpers,postgis-smoke,schema-constraints}.test.ts` (CREATE)
- [12] api wiring → `services/api/package.json` (+`@taxi/db`), `services/api/src/db-schema.spec.ts` (CREATE)
- [13] full gate from wiped volume → green (see Validation)

## Tests added

- `db/tests/postgis-helpers.test.ts` (3, pure/no docker): ring closing (expected), degenerate ring ≥4 vertices (edge), SRID + lng-before-lat order (failure guard).
- `db/tests/postgis-smoke.test.ts` (4): all 4 slugs seeded; Vecrīga point inside `old_town` AND `centre` (deliberate overlap); Jūrmala point in zero zones; GIST index exists via `pg_indexes`.
- `db/tests/schema-constraints.test.ts` (3): user→driver→ride+fare-lines roundtrip with intact totals (expected); `information_schema` sweep — every `*_cents` column is `integer` (self-extending money guard, edge); raw insert of `status='flying'` rejected by the `ride_status` enum (failure).
- `services/api/src/db-schema.spec.ts` (1): `@taxi/db` importability smoke.

All pass: `@taxi/db` 10/10 (vitest), `@taxi/api` 2/2 (jest).

## Validation results

- `pnpm --filter @taxi/db typecheck` + `build` — pass.
- Migrations from wiped volume (`docker compose down -v`): first run applies, second run no-op — pass.
- Seed twice: still exactly 4 geozones, `commission_pct = 15` — pass.
- Manual psql: `ST_Contains` at (24.106, 56.9489) → `centre, old_town` — pass.
- `pnpm check` — **15/15 tasks green, 0 failed**.

## Deviations from the plan

1. **`pretest` scoped to the db service** (`docker compose up -d --wait db`, not the full stack). Reason: this machine has port conflicts on 6379 (an SSH tunnel listens on `*:6379`), so full-stack `--wait` fails on redis, which the db tests never use. Scoping keeps `pnpm check` self-sufficient and is strictly narrower; a clean machine behaves identically for these tests.
2. **`turbo.json`: added `"globalEnv": ["DATABASE_URL"]`** (plan said "zero turbo.json changes needed"). Turbo 2.x strict env mode strips undeclared vars, so `DATABASE_URL` never reached vitest under `pnpm check` — tests silently fell back to the localhost default. Declaring it is required for any non-default DB host and correctly keys the cache.
3. **Enum-rejection test asserts on `error.cause`** — drizzle 0.44 wraps pg errors in `DrizzleQueryError`; the plan's `rejects.toThrow(/invalid input value/)` shape doesn't see the wrapped message.
4. **No `pgEnum` readonly-tuple fallback needed** — shared's `as const` arrays were accepted directly on TS 5.7 / drizzle 0.44.

## Issues encountered

- **This machine, not the code**: `localhost:5432` is shadowed — Homebrew Postgres on `127.0.0.1:5432` and an SSH tunnel (`*:5432`, `*:6379`, same PID). The dockerized taxi DB is reachable via the LAN IP wildcard bind, so all validation ran with `DATABASE_URL=postgres://taxi:taxi@192.168.1.11:5432/taxi`. Anyone (or CI) without those port squatters uses the defaults unchanged. Worth resolving locally (stop the tunnel/brew pg or remap compose ports) before #7 wires the api to the DB.
