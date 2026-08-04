# Execution Report — DB foundation: Drizzle schema, PostGIS migrations, Rīga geozone seed

**Feature**: `@taxi/db` workspace package (ticket #6) · **Branch**: `feature/db-foundation-drizzle-postgis` · **PR**: #32 (approved by agentic review)

> Note: written from repo artifacts (implementation report, PR review, git history) after a session clear, not from live implementation context.

## Meta Information

- **Plan file**: `.claude/plans/db-foundation-drizzle-postgis.md`
- **Implementation report**: `.claude/reports/db-foundation-drizzle-postgis-report.md`
- **Code review**: `.claude/code-reviews/pr-32-review.md` (verdict: approve, 0 critical/high, 3 medium, 4 low)
- **Files added** (db slice): `db/` package — `package.json`, `tsconfig*.json`, `vitest.config.ts`, `drizzle.config.ts`, `src/postgis.ts`, `src/client.ts`, `src/index.ts`, 9 schema files under `src/schema/`, seed (`src/seed/riga.ts`, `run.ts`), test infra (`tests/global-setup.ts`, `helpers.ts`) + 3 test files, migrations `0000` (enable postgis), `0001` (generated schema), `0002` (review fixes) + meta snapshots; `services/api/src/db-schema.spec.ts`
- **Files modified**: `pnpm-workspace.yaml` (+`db`), `turbo.json` (+`globalEnv: DATABASE_URL`), `services/api/package.json` (+`@taxi/db`), `.github/workflows` (Postgres TCP healthcheck), `services/api/src/main.ts` (void bootstrap)
- **Lines changed** (db slice across 4 commits, incl. generated migration meta): ~+5,170 −12. Hand-written source is a fraction of that — largest source file is 113 lines; migration `meta/*.json` snapshots are ~2,800 of the insertions.

## Validation Results

- **Syntax & Linting**: ✓ (after `void bootstrap()` fix in `8469db5` cleared the last CI floating-promise warning)
- **Type Checking**: ✓ `pnpm --filter @taxi/db typecheck` + build pass
- **Unit Tests**: ✓ `@taxi/db` vitest 10/10 at merge-candidate, 14/14 after review-fix round (each fix shipped with a test); `@taxi/api` jest 2/2
- **Integration Tests**: ✓ live-PostGIS suite against isolated `taxi_test` DB (migrate + seed in global setup); migrations idempotent from wiped volume; seed idempotent on re-run; `ST_Contains` manually verified in psql
- **Full gate**: ✓ `pnpm check` 15/15 turbo tasks green

## What Went Well

- **Enum derivation from `@taxi/shared` worked first try** — TS 5.7 / drizzle 0.44 accepted the `as const` arrays directly; the planned readonly-tuple fallback was never needed. No value list is retyped anywhere.
- **All three SQL verification greps in the plan passed exactly** (`geometry(Polygon,4326) NOT NULL`, `USING gist ("polygon")`, every `*_cents` column `integer`) — the plan's verification steps were concrete enough to be mechanical.
- **The self-extending money test** (information_schema sweep of `*_cents` columns) was singled out by the review as the standout: a future float money column fails CI with zero test edits.
- **Review round-trip was fast and clean**: 7 findings → 6 fixed in one commit (`f896ef2`), each with a test, 1 explicitly deferred to its owning ticket. The review itself confirmed all four documented deviations rather than discovering undocumented ones.
- **Isolated `taxi_test` DB honoring `DATABASE_URL`** meant this machine's port-conflict workaround (LAN-IP URL) needed zero code changes.

## Challenges Encountered

- **Local port shadowing (machine, not code)**: `localhost:5432`/`6379` are squatted by Homebrew Postgres and an SSH tunnel; all validation ran via `DATABASE_URL=postgres://taxi:taxi@192.168.1.11:5432/taxi`. Still unresolved — flagged as pre-#7 cleanup. (Already captured in auto-memory.)
- **Turbo 2.x strict env mode silently stripped `DATABASE_URL`** from test tasks — tests fell back to the localhost default with no error. Diagnosed and fixed via `globalEnv`; nasty because the failure mode is "tests pass against the wrong database".
- **Drizzle 0.44 wraps pg errors in `DrizzleQueryError`** — the plan's `rejects.toThrow(/invalid input value/)` assertion shape couldn't see the wrapped message; test had to assert on `error.cause`.
- **CI-only failure post-merge-candidate**: Docker's Postgres healthcheck via socket reports healthy mid-`initdb` on a fresh volume; fixed by health-checking over TCP (`055e1b8`). Never reproduced locally because local volumes were warm.

## Divergences from Plan

**1. `pretest` scoped to the db service only**
- Planned: `docker compose up -d --wait` (full stack)
- Actual: `docker compose up -d --wait db`
- Reason: redis `--wait` fails on this machine (tunnel squats 6379) and db tests never touch redis; strictly narrower, identical on clean machines
- Type: Better approach found (forced by environment)

**2. `turbo.json` gained `globalEnv: ["DATABASE_URL"]`**
- Planned: "zero turbo.json changes needed"
- Actual: declared `DATABASE_URL` globally
- Reason: turbo 2.x strict env mode strips undeclared vars from task env; without it, vitest silently used the localhost default under `pnpm check`
- Type: Plan assumption wrong

**3. Enum-rejection test asserts on `error.cause`**
- Planned: `rejects.toThrow(/invalid input value/)`
- Actual: unwrap `DrizzleQueryError` and assert on `cause`
- Reason: drizzle 0.44 wraps driver errors; the message isn't on the thrown error
- Type: Plan assumption wrong (library behavior)

**4. `pgEnum` readonly-tuple fallback unused**
- Planned: fallback path if drizzle rejected `as const` arrays
- Actual: direct usage worked
- Type: Plan assumption conservative (good — cheap insurance, zero cost when unneeded)

**Post-plan additions (not divergences, but unplanned work):** review-fix commit `f896ef2` (migration 0002: `NULLS NOT DISTINCT` ledger index, `$onUpdate` timestamps, composite offer index, `polygonToEwkt` guard), CI healthcheck fix `055e1b8`, lint fix `8469db5`.

## Skipped Items

- **Review finding 5 (unindexed FKs: `ledger_entries.ride_id`, `dispatch_audit_log.driver_id`)** — deliberately deferred to tickets #12/#10, which own those read paths. Logged in the review so it isn't lost.
- Nothing from the plan itself was skipped: 13/13 tasks completed.

## Recommendations

**Plan skill improvements**
- When a plan touches monorepo task-runner config, have `piv-plan-implementation` explicitly check turbo's env passlist (`globalEnv`/task `env`) for any env var the tests read — the `DATABASE_URL` strip was a foreseeable turbo 2.x strict-mode behavior, and its failure mode (tests silently hitting the wrong DB) is the worst kind.
- For plans that add DB constraint/error tests, note the ORM's error-wrapping behavior (drizzle → `DrizzleQueryError.cause`) so assertion shapes are right first time.
- The review found three plan-inherited schema gaps (nullable-unique NULLs, `$onUpdate`, hot-path index). A short "schema checklist" in the plan skill for DB tickets — unique indexes with nullable columns, mutable-row timestamp behavior, indexes for each known hot read — would have caught all three at plan time.

**Execute skill improvements**
- `piv-implement` handled the four deviations well: each was documented in the report with reason and scope, which made the review round trivial. Keep that pattern; no change needed.
- Consider adding a "fresh CI environment" mental check to validation: the healthcheck bug only existed on a cold volume, which local runs rarely exercise. A wiped-volume run was in the plan (and done) — the gap was that CI's *service-container* healthcheck semantics differ from compose's; worth one line in `piv-validate`'s CI-parity notes.

**CLAUDE.md additions**
- None needed. The port-conflict situation is machine-specific and already in auto-memory; the money/enum/config rules already exist and were verified enforced. Adding a schema checklist belongs in the plan skill, not the global rules file.
