# Append-only enforcement: options in this codebase

`observed` — a read-only scout pass over `main` at `658d052`, 2026-10-04. This is input to `plan-architecture` for the compliance epic. The legal driver is Autopārvadājumu likums 35.² (5): the platform may not delete or correct records of accepted, refused and provided trips, drivers and vehicles. The retention period is at least 5 years, under 35.² (6). The gaps are listed in `compliance-code-gaps.md`.

## 1. Migrations and the database role

- **Migrations.** `db/migrations/0000..0016` are drizzle-kit SQL files. Hand-written SQL is already allowed: `0003_updated_at_trigger.sql` defines a plpgsql function plus a `BEFORE UPDATE` trigger, with statements separated by `--> statement-breakpoint`. A custom file needs a journal entry, which `drizzle-kit generate --custom` creates. Drizzle does not model triggers or grants, so it never drops them on a later generate.
- **Where migrations run.** `db/src/migrate-run.ts` runs before every deploy (`docs/runbooks/hetzner-deploy.md:306,407`).
- **Role.** One role, `taxi`, does everything. It is the superuser and owner in dev (`docker-compose.yml:5-7`), in test (`services/api/test/test-db.ts`) and in prod (`compose.prod.yml:47`). The migrator and the api share one URL (`db.module.ts:35`). A least-privilege api role would need:
  - a second URL in `env.schema` (`:78`), in compose.prod and in the deploy script;
  - the GRANTs themselves, in a migration;
  - a dev/CI init script;
  - test global-setup changes, which today creates the DB and runs migrations as `taxi`.

## 2. UPDATE paths, classified

Classes: L = lifecycle progress (legitimately evolving), C = correction of a fact (should become an append), P = personal-data edit.

| Table | Path | Class |
|---|---|---|
| rides | `ride-transition.service.ts:86` status | L |
| rides | `rides.repository.ts:328` `assignDriver` | L, but a reassignment overwrites the previous driver and vehicle, so it acts as C |
| rides | `rides.repository.ts:379` `unassignDriver` | C |
| rides | `rides.repository.ts:415` `setGeozone` | L (written once) |
| rides | `ride-lifecycle.repository.ts:166` settled split | L (written once) |
| rides | `ride-lifecycle.repository.ts:208` PIN failure counter | L |
| rides | `ride-lifecycle.repository.ts:228` payment method | C (allowed before acceptance) |
| rides | `settlement.repository.ts:84` provider ref | L |
| ride_offers | `dispatch.repository.ts:263,283,298,320,358`, `ride-lifecycle.repository.ts:259` | L |
| drivers | `drivers.repository.ts:156` languages | P |
| drivers | `drivers.repository.ts:187,283,306,320,332` status | L |
| drivers | `ledger.repository.ts:109` balance | L |
| drivers | `admin-drivers.repository.ts:112` profile edit | P/C |
| drivers | `admin-drivers.repository.ts:179` approval | L, unaudited |
| vehicles | `vehicles.repository.ts:90`, `admin-drivers.repository.ts:211` | C |
| vehicles | `vehicles.repository.ts:110` **DELETE** | G1 |
| users | `customers.repository.ts:112`, `riders.repository.ts:34`, `admin-drivers.repository.ts:130`, `auth.repository.ts:101` | P/L |
| customers | `customers.repository.ts:152` | P |

There is no ride DELETE anywhere in `src`.

## 3. Test harness

- **Isolation.** It is per database: `services/api/test/global-setup.ts` drops `taxi_api_test`, then recreates, migrates and seeds it. Triggers added in a migration therefore apply to tests automatically. Nothing in api src or tests runs TRUNCATE or DELETE FROM.
- **Specs that would break.** Integration specs edit fixtures with direct `db.update(rides|drivers|vehicles|users)` calls, for example `rides.integration.spec.ts:95,637-764`, `drivers.integration.spec.ts:143,596,633,657`, `payments.integration.spec.ts:111` and `ride-lifecycle.integration.spec.ts:120`. A column-blind trigger would break these. `drivers.integration.spec.ts:274,704` test vehicle DELETE.
- **Seed.** `db/src/seed/riga.ts` writes only cities, geozones, platform_config and tariffs, so it is unaffected.

## 4. Precedent

`dispatch_audit_log` and `ledger_entries` are insert-only **by convention only**:
- the inserts are at `dispatch.repository.ts:392,419` and `ledger.repository.ts:56,89`;
- there is no DB-level immutability anywhere;
- there is no REVOKE or GRANT in any migration.

The only reusable precedent is 0003, which shows how to write a trigger in a hand-written migration.

## 5. Options

| Id | Option | For | Against |
|---|---|---|---|
| E1 | `BEFORE UPDATE/DELETE` triggers that raise | Same technique as 0003; applies to every role | Must be column- and status-aware to let lifecycle progress through; breaks spec fixtures; a superuser can disable it |
| E2 | REVOKE UPDATE/DELETE from a new api role | Strongest; the only option that stops a compromised api | Largest change (see section 1); needs column-level GRANTs; owner-run tests no longer exercise it, so it needs its own test |
| E3 | App-level only (remove `remove()`, eslint `no-restricted-syntax`) | No migration, no test impact | Protects nothing against ad-hoc SQL or future code; acceptable only as a complement |
| E4 | History tables filled by trigger | Lets correction-of-fact cases (G2, G4, G5) stay editable while every prior version is kept; the repository UPDATEs stay unchanged | One table per entity; does not stop DELETE on its own, so pair it with E1 |
