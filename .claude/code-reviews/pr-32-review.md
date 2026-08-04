# Code Review — PR #32 `feat(db): @taxi/db — Drizzle schema, PostGIS migrations, Rīga geozone seed`

**Verdict: ✅ Approve** — no Critical/High issues, validation fully green, implementation matches the plan with all four deviations documented in the report. Three Medium issues are cheap to fix now (before real data exists) and should go through a fix pass — they don't block merge.

Reviewed with fresh eyes by a dedicated review agent: every changed file read in full, db enums cross-checked against `packages/shared` sources, migration SQL diffed against the schema TS, seed idempotency and test raw-SQL inspected.

## Validation

| Gate | Result |
|---|---|
| `pnpm check` (turbo: typecheck · lint · build · test) | ✅ 15/15 tasks green |
| `@taxi/db` vitest (forced uncached, live PostGIS) | ✅ 10/10 |
| `@taxi/api` jest (incl. `@taxi/db` import smoke) | ✅ 2/2 |

## Issues

### Medium

1. **`ledger_accounts_owner_uix` doesn't dedupe the platform account** — `db/src/schema/ledger.ts:22`. `owner_id` is nullable for the platform account, and Postgres unique indexes treat NULLs as distinct — so unlimited `('platform', NULL)` rows insert cleanly; the one row the index exists to dedupe is the one it misses. A double-created platform account silently splits the ledger once #12 posts entries. **Fix:** `.nullsNotDistinct()` on the index (supported by drizzle 0.44 and PG 16), or a partial unique index `ON (owner_type) WHERE owner_id IS NULL`. (Plan-inherited shape, but fix it while migration 0001 is young.)

2. **`updated_at` never updates** — `db/src/schema/rides.ts:59`, `db/src/schema/platform-config.ts:27`. Both have `defaultNow()` but no `.$onUpdate()` and no trigger, so every UPDATE (ride status transitions; commission edits in #20) leaves the timestamp frozen at insert. For `platform_config`, "when was the commission last changed" silently lying is worse than absent. **Fix:** `.$onUpdate(() => new Date())` on both.

3. **No index on `ride_offers.driver_id`** — `db/src/schema/rides.ts:110`. Only `ride_id` is indexed, but the dispatch loop's other hot read is driver-side ("does driver X have a pending offer" on every offer send; driver app fetching its current offer), and offer-cascade re-offers make this table grow faster than `rides`. **Fix:** `index("ride_offers_driver_idx").on(t.driverId)` — consider composite `(driver_id, status)` since the query is always status-filtered.

### Low

4. **`polygonToEwkt` emits invalid EWKT on an empty ring** — `db/src/postgis.ts:16`. `ring[0]!` on `[]` produces `POLYGON((undefined undefined))`, failing later inside Postgres with an opaque parse error; the function is public API, so callers may not have run zod's `min(3)` first. Throw on `ring.length < 3` and make that the failure-case test.

5. **Unindexed FKs on future query paths** — `ledger_entries.ride_id` (`db/src/schema/ledger.ts:33`, reconciliation reads) and `dispatch_audit_log.driver_id` (`db/src/schema/dispatch-audit.ts:21`, per-driver history). Fine to defer to #12/#10, which own those read paths — logging so it isn't forgotten.

6. **Money-guard LIKE loses its escape** — `db/tests/schema-constraints.test.ts:52`. `'%\_cents'` in a JS template literal reaches Postgres as `%_cents` (single-char wildcard `_`). Accidentally safe (the broader pattern over-matches, the right direction for a guard), but the intended escape is `'%\\_cents'`.

7. **Seed idempotency holds only for seed-owned rows** — `db/src/seed/riga.ts:78-96`. If a same-slug zone or same-name city pre-exists under a different id (future admin-panel creations), the fixed-UUID exports (`RIGA_ZONE_IDS`, `RIGA_CITY_ID`) diverge from reality or FK inserts fail. Acceptable for a pilot seed — add a one-line docblock caveat.

## Standards compliance — verified clean

- **Money**: every `*_cents` column is `integer` in both schema TS and migration SQL; the only doubles are percentages/ratings, not money.
- **Enums derive from shared**: confirmed against `packages/shared/src` — no value list retyped; `assignment_source` correctly composes `DISPATCH_MODES + "dispatcher"` from shared.
- **Commission is config**: no column default; 15 exists only in the seed.
- **State machine**: db encodes only the status value set; no transition assumptions conflicting with `assertTransition()`.
- **VSA / file size**: largest file 113 lines; colocated tests; public API via `db/src/index.ts`. No undocumented deviations from the plan.

## Done well

- The **self-extending money test** (information_schema sweep of `*_cents` columns) — a future float money column fails CI with zero test edits. Exactly how to enforce a project-wide invariant at the schema layer.
- **Enum derivation done properly** — the "dispatcher is not a strategy" decision lives once, in shared; the db just consumes it.
- **Isolated `taxi_test` DB** in vitest globalSetup with a friendly connection-failure message, honoring `DATABASE_URL` so nonstandard hosts work unchanged.
- The **lng/lat axis-order failure guard** — the most common PostGIS bug, explicitly tested ("swapping puts Rīga in the Indian Ocean").
- **Decision-encoding comments** (`CONFIG, NOT CONSTANT`; "Vecrīga deliberately overlaps centre; precedence is #10's problem") — the schema documents why, not just what.

## Recommendation

Approve. Run `piv-fix-review-findings` on issues 1–3 (plus 4 and 6 as one-liners if convenient) before building #7 on top; 5 and 7 can ride with their owning tickets.

---
*Agentic review gate — a human makes the final merge call.*
