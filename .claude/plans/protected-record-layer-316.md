# Feature: Protected record layer — ride events, offer guard, reasons, no-delete test (#316)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

All `file:line` citations below were read on `main` at `b890929` (2026-11-26). The issue and the architecture doc cite `658d052`; where the two disagree, this plan's citation wins and the difference is called out.

## Verification status (spikes run while planning, 2026-11-26)

Everything below is `observed` on a detached worktree of `b890929`. The worktree had `pnpm@10.33.2 install --frozen-lockfile`, a clean install in 20.4 s. The planning machine has no Docker, so no api integration spec has run yet; the implementer's gate is the first run of those.

| Id | Claim the plan depends on | Result |
|---|---|---|
| S1 | Task 7's trigger SQL, run verbatim, allows the 8 legal moves and raises `P0001` with the `protected_record:` prefix on all 17 forbidden cases. Forbidden cases include a pending→pending no-op, an `expires_at` or `sent_at` edit, a second `responded_at` write, `TRUNCATE … CASCADE`, and deleting a vehicle that a ride references, where the trigger fires before the FK. | **Pass.** Run on PGlite 0.6.0, which reports PostgreSQL 19 (the target is Postgres 16; every feature used exists in 16: identity ≥10, statement TRUNCATE triggers ≥8.4, `jsonb - text` ≥9.5). |
| S2 | Inside a transaction, a savepoint per raising attempt followed by a final ROLLBACK restores the rows and any trigger dropped inside that transaction. | **Pass** — Task 9's rollback wrapper works |
| S3 | A partial plate index lets a retired plate be registered again, while a second ACTIVE duplicate still raises `23505`. | **Pass** |
| S4 | `clock_timestamp()` gives distinct `occurred_at` values within one transaction, where `now()` repeats one value. `seq` is monotonic. | **Pass** |
| S5 | `drizzle-kit generate` emits, with no prompts: three `CREATE TYPE`; the identity `seq`; the `CHECK`s; both FKs dropped and re-added under the same names (`rides_vehicle_id_vehicles_id_fk`, `ride_fare_lines_ride_id_rides_id_fk`) as `no action`; the partial `vehicles_plate_uix`. `generate --custom --name protected_records` writes an empty 0018 plus snapshot and journal entry. A plain re-run of generate prints "No schema changes". | **Pass** |
| S6 | `check` is exported from `drizzle-orm/pg-core`. `bigint(...).generatedAlwaysAsIdentity()` compiles. Task 1's `as const satisfies` and `z.enum(CANCEL_REASON_CODES).refine` compile. `import type { MessageKey } from './i18n/lv'` in `reasons.ts` adds no import cycle. A bad key in `Record<RideReasonCode, MessageKey>` raises TS2322. | **Pass** |
| S7 | The eslint selector flags `db.delete(rideEvents)` and leaves `Map.delete` alone. The one existing hit is `vehicles.repository.ts:109`, which Task 16 removes. The api lint baseline is 17 `no-unsafe-argument` **warnings** in integration specs; they are warnings and not new. | **Pass** — Task 19 must land after Task 16 |
| S8 | A bodiless POST with no content-type, which is exactly what the driver app sends for decline (`apps/driver/src/features/auth/api-client.ts:74` sets content-type only when there is a body), reaches `ZodValidationPipe` as **`undefined`**, not `{}`. Versions: express 5.2.1, body-parser 2.3.0, `@nestjs/platform-express` 11.1.27. | **Bug avoided.** A plain `z.object` would answer 400 and break the driver app's decline. Task 3 wraps the schemas in `z.preprocess(v => v ?? {}, …)`. |
| S9 | Jest 30 `useFakeTimers({ doNotFake: [every timer API], now })` fakes only `Date`: `new Date()` returns the past time while real `setTimeout`/`setImmediate` still fire, and `useRealTimers()` restores the clock. | **Pass** for the Jest mechanism. That the sweeper produces the same offer under the shifted clock is `derived`, not observed; see Task 18. |
| S10 | `@taxi/shared` and `@taxi/db` are consumed through `dist` (package `exports`). A package-level `typecheck`/`lint` after editing either needs those built first. | Use the `turbo` form in VALIDATE lines (turbo.json: `typecheck`/`lint`/`test` `dependsOn: ["^build"]`) |

## Decisions (Linards, 2026-11-26)

- **D1** Reason list: the proposed 14 cancel and 5 decline codes (Task 1), verbatim.
- **D2** A `*_other` code requires a note, enforced in the shared schema.
- **D3** Retired plates can be registered again (partial unique index). This rewords the api `CLAUDE.md` plate rule.
- **D4** Keep the free-text note, capped at 280 characters and never logged. The placeholder warns against names and phone numbers. Flagged for #320 and lawyer E1.

## Feature Description

Autopārvadājumu likums 35.² (5) forbids the platform to delete or correct records of accepted, refused and provided trips, drivers and vehicles. Today nothing stops either: ride history is overwritten in place, cancel reasons are emitted on the socket and dropped, offer declines carry no reason, and a driver can hard-delete a car (which blanks `rides.vehicle_id` on every past ride through `ON DELETE SET NULL`).

This ticket adds the **compliance record layer** decided in architecture K1 + K2 (AP1, option E1 + E3):

1. **`ride_events`** — one append-only row per ride status transition, plus one per ride creation, driver assignment and driver release, written in the same transaction as the change, carrying actor kind/id and an optional reason.
2. **`ride_offers` guard** — a trigger that allows only the status moves the code makes today, with new write-once columns `responded_at` and `decline_reason`.
3. **DELETE blocked** on `rides`, `drivers`, `vehicles`; `ride_events` blocks UPDATE and DELETE. Vehicle removal becomes retirement (`vehicles.retired_at`); `rides.vehicle_id` FK becomes `NO ACTION`.
4. **Reason enums** in `@taxi/shared` (`CANCEL_REASONS` per actor, `DECLINE_REASONS`) with LV/RU/EN strings; the cancel and decline endpoints accept `{ reasonCode, reasonText? }`. The dispatch console cancel dialog gets a required reason picker; the API requires a code from dispatcher/admin cancels.
5. **eslint guard** banning `.delete(<protected table>)` in `services/api/src`.
6. **The K1 no-delete test** — table-driven over exported `PROTECTED_TABLES` / `DELETE_BLOCKED_TABLES`, plus a `pg_trigger` drift check.

## User Story

As the platform operator (Linards, answering to ATD and VID)
I want every ride's history, offers, refusals and the cars and drivers behind them to be impossible for application code to delete or overwrite
So that an inspection under 35.² (5) finds a complete record, and VID's start/end times can be read from rows nobody could have edited.

Secondary: as Dina (dispatcher), when I cancel a ride I pick why from a list, so the reason is stored with the ride.

## Problem Statement

- G3: cancel reason only emitted/logged (`ride-lifecycle.service.ts:221-223`), never stored; `ride_offers` has no decline reason or response time (`db/src/schema/rides.ts:163-192`).
- G4: no ride history — `transitionInTx` overwrites `rides.status` (`ride-transition.service.ts:85-89`); `assignDriver`/`unassignDriver` overwrite driver/vehicle (`rides.repository.ts:322-345`, `:373-390`).
- G1/G2: `DELETE /drivers/me/vehicles/:id` (`vehicles.controller.ts:56-63`) and `DELETE /admin/vehicles/:id` (`admin-vehicles.controller.ts:36-43`) hard-delete (`vehicles.repository.ts:108-114`); `rides.vehicle_id` is `onDelete: 'set null'` (`rides.ts:52-54`, migration `0008`).
- G9: `ride_fare_lines.ride_id` is `onDelete: 'cascade'` (`rides.ts:~150`, `0001:156`).
- No DB-level immutability anywhere; the only triggers are 0003's `set_updated_at` (scout grep, `observed`).

## Solution Statement

- **One write point per kind of event.** `RideTransitionService.transitionInTx` is the only writer of `rides.status` (api `CLAUDE.md`; scout grep confirmed no other `set({status})` in `src`). It gains a **required** `actor: RideEventActor` argument and inserts the event row after a successful UPDATE, in the caller's tx. Making it required turns the "every writer is hooked" check into a typecheck: every caller (12 sites, table in CONTEXT) fails to compile until it passes an actor. `RidesRepository.create`, `assignDriver`, `unassignDriver` write their own `created` / `assigned` / `released` events in the tx they already run in.
- **Event kind is a column** (`ride_event_kind`: `created | status | assigned | released`), so "exactly one `status` event per edge" is a query, not a convention. Accept writes `status` (offered→accepted) + `assigned`; reassign writes `status` (accepted|arriving→requested) + `released`.
- **Ordering** — events in one transaction (force-assign writes requested→offered, offered→accepted and assigned in one tx) would share `now()`. `occurred_at` defaults to `clock_timestamp()` (wall-clock per statement) and a `seq bigint GENERATED ALWAYS AS IDENTITY` column is the authoritative order; index `(ride_id, seq)`.
- **Triggers** in a hand-written migration (0003 pattern): `ride_events` raises on UPDATE/DELETE/TRUNCATE; `ride_offers` column-aware guard; `rides`/`drivers`/`vehicles` raise on DELETE/TRUNCATE. All raise `SQLSTATE P0001` with message prefix `protected_record:` so tests and logs can tell them from FK errors.
- **Vehicles retire, never delete.** Both DELETE routes are replaced by `POST …/:id/retire` (204), which keeps `remove`'s two behaviours (409 `driver_on_ride`; driver goes offline when no active car remains). Every vehicle read that meant "the driver's cars" filters `retired_at IS NULL`. The plate unique index becomes partial (`WHERE retired_at IS NULL`) so a retired car's plate can be registered again (Q3).
- **Reasons** live in a new `packages/shared/src/reasons.ts` (codes + per-actor tuples + `Record<RideReasonCode, MessageKey>` label map) and `schemas/reasons.ts` (request bodies); strings in new `i18n/{lv,ru,en}-reasons.ts` spread into the catalogs (the `lv-admin` pattern, `lv.ts:1,418`).

## Out of Scope / Non-Goals

- Not included: driver decline reason **picker** (driver app) — #322; rider cancel picker — #326. Those apps keep sending no reason; the API accepts a missing reason from rider and driver.
- Not included: `ride_snapshots`, `*_versions`, `approval_decisions`, `carriers` — #319/#327 add those and append themselves to `PROTECTED_TABLES` / `DELETE_BLOCKED_TABLES`.
- Not included: option E2 (least-privilege DB role). Tests run as superuser `taxi`; the test proves no *application* path can delete or overwrite, not that a superuser cannot.
- Not included: history/read endpoints over `ride_events` (driver 90-day history #322, carrier export #323).
- Not included: pushing decline reasons to the rider (K2: per-ride, not per-offer; D1 default "kept, not pushed").
- Not changing: `rides` stays mutable for lifecycle (AP1); `dispatch_audit_log` stays as is (convention-only insert-only — not in this ticket's protected list).
- Not changing: the `ride:status` socket payload shape. `reason` on it keeps carrying free text (now `reasonText`).
- Not changing: specs that set `rides.status` directly for fixtures (50 sites) — AP1 keeps them valid; those rides simply have no events.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**: `db` (schema, 2 migrations, tests), `services/api` (rides, rides/lifecycle, dispatch, drivers/vehicles, drivers/admin, eslint), `packages/shared` (reasons, schemas, i18n), `apps/dispatch` (cancel dialog, dialog shell, admin vehicle retire)
**Dependencies**: none new. drizzle-orm `^0.45.2`, drizzle-kit `^0.31.0` (`db/package.json:27,33`), Postgres 16 (`docker-compose.yml:3` `postgis/postgis:16-3.4-alpine` — so **no `RETURNING OLD`**, that is PG 18).

## Related Work

**Implements**: #316 · **Epic**: #315, architecture `docs/epics/sakta-cab-compliance.architecture.md` K1, K2 · PRD `docs/epics/sakta-cab-compliance.prd.md` §7 metric 4

**Back-references**:

- `docs/research/append-only-enforcement-options.md` — options E1–E4, §3 spec fixtures
- `docs/research/compliance-code-gaps.md` — G1–G4, G9
- `.claude/plans/api-ride-vehicle-stamp.md` — why `assignDriver` stamps `vehicle_id` (#86)
- `.claude/plans/dispatch-override-phone-orders-zones.md` — force-assign / reassign / cancel dialog (#19)
- `.claude/plans/mint-tracked-ride-dev-script.md` — dev script that produces an accepted ride (Level 4)

**Forward-references**:

- #319 adds `carriers` to `DELETE_BLOCKED_TABLES`, `*_versions` and `approval_decisions` to `PROTECTED_TABLES`
- #322 flips driver decline/cancel reason to required (driver picker)
- #326 flips rider cancel reason to required (rider picker)
- #327 adds `ride_snapshots` to `PROTECTED_TABLES`; reads `ride_events` for VID times
- #320 erasure must never touch `ride_events.reason_text` (see Q4)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

DB
- `db/src/schema/rides.ts` (34-120 `rides`; 52-54 vehicle FK `set null`; ~148-160 `ride_fare_lines` cascade; 163-192 `ride_offers`, no `responded_at`) — tables to change
- `db/src/schema/vehicles.ts` (12-41) — add `retired_at`; plate index `uniqueIndex('vehicles_plate_uix').on(sql\`upper(${t.plate})\`)`
- `db/src/schema/enums.ts` (1-36) — `pgEnum(name, TUPLE_FROM_SHARED)` pattern, e.g. `offerStatusEnum`
- `db/src/schema/dispatch-audit.ts` (17-39) — insert-only table shape to mirror
- `db/src/schema/index.ts` — barrel; add `./ride-events`
- `db/src/index.ts` — `export * from './schema'`; add `./protected-tables`
- `db/migrations/0003_updated_at_trigger.sql` — hand-written trigger pattern, `--> statement-breakpoint`
- `db/migrations/meta/_journal.json` — next idx is 17 (last is `0016_shocking_quasimodo`)
- `db/tests/schema-constraints.test.ts` (147-155 `pg_indexes` query; 89, 210-212 `String(err.cause)` assertion on DrizzleQueryError) — pattern for the drift check and constraint assertions
- `db/tests/global-setup.ts` — test DB `taxi_test`, migrate + seed

API
- `services/api/src/features/rides/ride-transition.service.ts` (77-92 `transitionInTx`, 140-151 `transition`) — the one status writer
- `services/api/src/features/rides/rides.repository.ts` (81-127 `create` tx + insert at 86; 322-345 `assignDriver`; 373-390 `unassignDriver`) — 419 lines, little headroom
- `services/api/src/features/rides/rides.service.ts` (134-142 dispatcher booking passes `dispatcherId`; 326-343 `rides.create` call) — plumb creator actor
- `services/api/src/features/rides/lifecycle/ride-lifecycle.controller.ts` (89-111 cancel; 102-103 `admin → dispatcher` collapse)
- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` (109 driverStep, 131-145 start, 192-224 cancel, 202 complete) — 472 lines
- `services/api/src/features/rides/lifecycle/ride-lifecycle.policy.ts` (23 `LifecycleActor`, 30-40 `cancelledStatusFor`, 33 `CANCELLED_STATUS_BY_ACTOR`)
- `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts` (259 `revokePendingOffers` pending→revoked)
- `services/api/src/features/dispatch/dispatch.repository.ts` (80 `insertOffer`; 263 accept; 283 decline; 298 expire; 320 revoke pending; 358 supersede accepted→revoked; 205-225 `countAttempts`) — 432 lines
- `services/api/src/features/dispatch/dispatch.service.ts` (139-151 offerNext; 189-207 accept; 280-290 decline; 423 expire) — 433 lines
- `services/api/src/features/dispatch/dispatch.controller.ts` (79-87 decline, no body; 103, 124 `dispatcherId = user.sub`)
- `services/api/src/features/dispatch/force-assign.service.ts` (96-123), `reassign.service.ts` (111-123)
- `services/api/src/features/payments/settlement.service.ts` (107), `settlement.controller.ts` (57-76 `SETTLEMENT_ACTORS[user.role]`)
- `services/api/src/features/drivers/vehicles.controller.ts` (56-63), `vehicles.service.ts` (83-114 `remove`), `vehicles.repository.ts` (59-65 list, 108-114 delete, 116-122 count)
- `services/api/src/features/drivers/admin/admin-vehicles.controller.ts` (36-43), `admin-drivers.service.ts` (125-130 `removeVehicle`), `admin-drivers.repository.ts` (74, 193, 205+)
- `services/api/src/features/drivers/drivers.repository.ts` (198 `exists(vehicles)` in `setOnlineIfEligible`; 391, 413 roster joins)
- `services/api/src/features/notifications/notifications.repository.ts` (172 plate by id — must NOT filter retired: a past ride's car)
- `services/api/src/common/zod-validation.pipe.ts` (11-26) — `safeParse(value)`; a bodiless POST arrives as `{}` from express' json parser (verify, Task 13)
- `services/api/src/common/db/db.module.ts` (19 `DbTx`)
- `services/api/eslint.config.mjs`, `packages/config/eslint/base.mjs` — no `no-restricted-syntax` anywhere today (scout grep)
- `services/api/test/harness.ts` (496 `createTestApp`, 694 `insertUser`, 710 `approveDriver`)

Tests that break and must be rewritten (scout-located, re-verify lines):
- `dispatch/dispatch.integration.spec.ts:411`, `:1229` (UPDATE `expiresAt` on pending offer), `:795` (UPDATE `sentAt` on every offer of a ride incl. the accepted one). `:352` (pending→revoked) stays — allowed move.
- vehicle DELETE: `drivers/drivers.integration.spec.ts:274,704,727,746,765`; `drivers/admin/admin-drivers.integration.spec.ts:289,370`; `notifications/tracking/tracking.integration.spec.ts:~683` (asserts SET NULL fired — invert it); `drivers/vehicles.service.spec.ts:72,81,93`.

Shared
- `packages/shared/src/ride-state-machine.ts` (1, 12-15, 20, 97-98 `ALLOWED_TRANSITIONS`, 189 `assertTransition`)
- `packages/shared/src/enums.ts` (81-89 `OFFER_STATUSES` as-const + type pattern; ~20-37 "write the literal tuple" rule) — 133 lines
- `packages/shared/src/schemas/ride.ts` (425-435 `rideCancelSchema`) — 488 lines, **do not grow it**
- `packages/shared/src/i18n/lv.ts` (1 import, 173-178 console cancel keys, 418 `...lvAdmin`, 426 `MessageKey`), `ru.ts` (138-143), `en.ts` (134-139), `lv-admin.ts` (split pattern); `i18n.ts` (23-26 parity `satisfies`); `tests/i18n.test.ts`
- `packages/shared/src/index.ts` — flat barrel

Dispatch app
- `apps/dispatch/src/features/override/cancel-dialog.tsx` (19-31 props; textarea; ~104 `onConfirm`)
- `apps/dispatch/src/features/override/dialog-shell.tsx` (66-68 initial-focus selector, ~85 tab-trap selector — **both omit `select`**; ~158 `dialogButtonStyle` minHeight 44)
- `apps/dispatch/src/features/override/cancel-dialog.test.tsx` (uses `getByRole('textbox')`)
- `apps/dispatch/src/features/override/use-assign.ts` (166-170 `cancel` posts `{ reason }`), `assign-state.ts` (86 `ERROR_KEYS`)
- `apps/dispatch/src/app/dispatch/page.tsx` (85 offline `disabledReasonKey`, 361-372 dialog wiring)
- `apps/dispatch/src/features/admin-drivers/vehicle-editor.tsx` (~139-149 `<select>` pattern), `form-styles.ts` (3-13 `inputStyle` minHeight 44)
- `apps/dispatch/src/features/admin-drivers/drivers-api.ts` (74-78 `deleteVehicle`), `use-drivers.ts` (151, 210-212 `removeVehicle`), `driver-detail.tsx` (163)

### Transition callers (every site must pass an actor — compile-enforced)

| Site | Edge | `actor.kind` | `actor.id` |
|---|---|---|---|
| `ride-lifecycle.service.ts:109` driverStep | accepted→arriving, arriving→arrived | driver | `driverId` |
| `ride-lifecycle.service.ts:145` start | arrived→in_progress | driver | `driverId` |
| `ride-lifecycle.service.ts:202` complete | in_progress→completed | driver | `driverId` |
| `ride-lifecycle.service.ts:277` cancel | →`cancelled_by_*` | **role from JWT** (rider/driver/dispatcher/admin) — not the collapsed lifecycle actor | `actorId` |
| `settlement.service.ts:107` | completed→settled | from `user.role` (rider/driver/dispatcher/admin) | `actorId` |
| `dispatch.service.ts:148` offerNext | requested→offered, requested→queued→offered | system | null |
| `dispatch.service.ts:199` accept | offered→accepted | driver | `driverId` |
| `dispatch.service.ts:290` decline | offered→requested | driver (+ reason) | `driverId` |
| `dispatch.service.ts:423` expireOffer | offered→requested | system | null |
| `force-assign.service.ts:102,113` | requested→offered, offered→accepted | dispatcher or admin (role from controller) | `dispatcherId` |
| `reassign.service.ts:112` | accepted/arriving→requested | dispatcher or admin | `dispatcherId` |

Verify this table against source before Task 9 — it is a scout's reading, and the compiler will show any site it missed.

### New Files to Create

- `packages/shared/src/reasons.ts` — `RIDE_EVENT_ACTORS`, `RIDE_EVENT_KINDS`, `CANCEL_REASONS`, `DECLINE_REASONS`, `RIDE_REASON_CODES`, `cancelReasonsFor(actor)`, `REASON_LABEL_KEYS`
- `packages/shared/src/schemas/reasons.ts` — `rideCancelSchema` (moved from `ride.ts`, reshaped), `offerDeclineSchema`
- `packages/shared/src/i18n/{lv,ru,en}-reasons.ts` — strings
- `packages/shared/tests/reasons.test.ts`
- `db/src/schema/ride-events.ts` — `rideEvents` table
- `db/src/protected-tables.ts` — `PROTECTED_TABLES`, `DELETE_BLOCKED_TABLES`
- `db/migrations/0017_*.sql` (generated), `db/migrations/0018_protected_records.sql` (custom)
- `db/tests/protected-tables.test.ts` — the K1 table-driven no-delete test + drift check + offer-guard matrix
- `services/api/src/features/rides/ride-events.repository.ts` — `insertRideEvent(tx, event)` and `RideEventActor` type
- `services/api/src/features/rides/ride-events.integration.spec.ts` — edge walk + per-caller actor assertions
- `services/api/src/features/drivers/vehicles-retire.integration.spec.ts` (or extend the existing spec if under 500 is irrelevant — spec files are uncapped; extend `drivers.integration.spec.ts` instead, preferred)

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [PostgreSQL 16 — CREATE TRIGGER](https://www.postgresql.org/docs/16/sql-createtrigger.html) — `BEFORE UPDATE OR DELETE … FOR EACH ROW`; `BEFORE TRUNCATE … FOR EACH STATEMENT` (row triggers do not fire on TRUNCATE)
- [PostgreSQL 16 — PL/pgSQL trigger functions](https://www.postgresql.org/docs/16/plpgsql-trigger.html) — `TG_OP`, `TG_TABLE_NAME`, returning `OLD` for DELETE
- [PostgreSQL 16 — RAISE](https://www.postgresql.org/docs/16/plpgsql-errors-and-messages.html) — default SQLSTATE `P0001`
- [PostgreSQL 16 — pg_trigger catalog](https://www.postgresql.org/docs/16/catalog-pg-trigger.html) — `tgrelid`, `tgname`, `tgenabled` (`'D'` = disabled), `tgisinternal`
- [PostgreSQL 16 — identity columns](https://www.postgresql.org/docs/16/sql-createtable.html#SQL-CREATETABLE-PARMS-GENERATED-IDENTITY)
- [drizzle-kit generate --custom](https://orm.drizzle.team/docs/kit-custom-migrations) — empty SQL file + journal entry + snapshot
- [ESLint no-restricted-syntax](https://eslint.org/docs/latest/rules/no-restricted-syntax) and [selectors](https://eslint.org/docs/latest/extend/selectors) — attribute regex `[arguments.0.name=/^(...)$/]`

### Patterns to Follow

**Enum tuple (shared)** — `packages/shared/src/enums.ts:81-89`:
```ts
export const OFFER_STATUSES = ['pending','accepted','declined','expired','revoked'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
```
Write literal tuples; never `.filter()` a union into a subset (`enums.ts:~20-37`), because `pgEnum` needs a literal tuple.

**pgEnum from shared** — `db/src/schema/enums.ts:36`: `export const offerStatusEnum = pgEnum('offer_status', OFFER_STATUSES);`

**Enum → label map, compile-pinned** — `apps/dispatch/src/features/board/driver-list.tsx:23`: `Record<DriverStatus, MessageKey>`. Here: `REASON_LABEL_KEYS: Record<RideReasonCode, MessageKey>` in shared, so a missing string is a compile error.

**Hand-written trigger migration** — `0003_updated_at_trigger.sql`: function, `DROP TRIGGER IF EXISTS`, `CREATE TRIGGER`, `--> statement-breakpoint` between every statement.

**Constraint-rejection assertion** — `db/tests/schema-constraints.test.ts:210-212`: drizzle 0.44+ wraps driver errors in `DrizzleQueryError`; assert `String((err as Error).cause)` matches. For raw `pool.query`, the pg error is thrown directly — assert `.code === 'P0001'` and `.message` matches `/^protected_record:/`.

**Logging** — Nest Logger with an object: `this.logger.log({ event: 'ride.lifecycle.transition_applied', …, at: new Date().toISOString() })` (`ride-lifecycle.logging.ts`). Reason TEXT is never logged — only `hasReason`/`reasonCode` (closed enum, safe). The event insert itself logs nothing new (it is part of the tx; failure fails the tx).

**Error codes** — snake-case `ConflictException('offer_not_pending')` / `UnprocessableEntityException('pickup_pin_required')` style. New: 422 `cancel_reason_required`, 422 `cancel_reason_not_allowed`.

**Dialog** — `DialogShell` + `dialogButtonStyle('danger')`; inline styles with CSS vars from the theme (`--spacing-*`, `--radius-md`, `--color-*`); `<p role="alert">` banners.

---

## IMPLEMENTATION PLAN

### Phase A: Shared contracts (reasons, schemas, strings)
Codes, per-actor subsets, label map, request schemas, LV/RU/EN strings. Everything downstream imports these.

### Phase B: DB schema + migrations + DB-level tests
**Depends on:** Phase A (pgEnums read shared tuples).
`ride_events` table, offer columns, `retired_at`, FK changes, partial plate index → generated 0017; triggers → custom 0018; `PROTECTED_TABLES`; the K1 no-delete test, drift check and offer-guard matrix in `db/tests`.

### Phase C: API writers (events, reasons)
**Depends on:** Phase B.
`insertRideEvent`; required actor on `transitionInTx`/`transition`; created/assigned/released events; cancel + decline bodies; dispatcher/admin cancel requires a code; offer `responded_at`/`decline_reason`.

### Phase D: API vehicles retire
**Depends on:** Phase B and Task 13 (both edit `rides.repository.ts` — Task 16's `assignDriver` subselect filter lands on Task 13's rewritten method). Not parallel with Phase C.
Retire routes replace DELETE; `retired_at IS NULL` filters; rewrite vehicle-delete specs.

### Phase E: Spec fixture rewrites + lint rule
**Depends on:** Phase B (the trigger must be in place so the dispatch fixtures fail first: run them red, then fix) and Task 16 (the lint rule's one existing hit is the vehicle delete, S7).

### Phase F: Dispatch console (cancel picker, admin retire)
**Depends on:** Phase A (strings, codes), Phase C (API shape), Phase D (retire route).

### Phase G: Docs + full gate

---

## STEP-BY-STEP TASKS

**Before Task 1:**
- Work in a git worktree; concurrent sessions share this checkout (root `CLAUDE.md`).
- Bring Docker up with `docker compose up -d --wait`, and set `COMPOSE_PROJECT_NAME=taxi` inside a worktree.
- `@taxi/shared` and `@taxi/db` are consumed through `dist` (S10). After editing either, a bare `pnpm --filter @taxi/api typecheck` reads stale types. Use the turbo form, which builds dependencies first: `pnpm turbo run typecheck --filter=@taxi/api`. Wherever a VALIDATE line below says `pnpm --filter X typecheck|lint`, read it as `pnpm turbo run typecheck|lint --filter=X`.
- Every jest run in `services/api`, unit specs included, goes through `test/global-setup.ts`, which needs Postgres (`observed` while planning). There is no DB-free jest loop.

### Task 1 — CREATE `packages/shared/src/reasons.ts`

- **IMPLEMENT**:
  ```ts
  export const RIDE_EVENT_KINDS = ['created', 'status', 'assigned', 'released'] as const;
  export type RideEventKind = (typeof RIDE_EVENT_KINDS)[number];
  export const RIDE_EVENT_ACTORS = ['rider', 'driver', 'dispatcher', 'admin', 'system'] as const;
  export type RideEventActorKind = (typeof RIDE_EVENT_ACTORS)[number];

  // One flat literal tuple — the pgEnum source. Per-actor tuples below are ALSO literals.
  export const RIDE_REASON_CODES = [
    'rider_changed_plans', 'rider_wait_too_long', 'rider_booked_by_mistake', 'rider_other',
    'driver_rider_no_show', 'driver_vehicle_problem', 'driver_safety_concern', 'driver_other',
    'dispatcher_rider_request', 'dispatcher_duplicate_booking', 'dispatcher_no_driver_available',
    'dispatcher_rider_no_show', 'dispatcher_other',
    'system_no_driver_found',
    'decline_too_far', 'decline_unwanted_destination', 'decline_vehicle_unsuitable',
    'decline_on_break', 'decline_other',
  ] as const;
  export type RideReasonCode = (typeof RIDE_REASON_CODES)[number];

  export const CANCEL_REASONS = {
    rider: ['rider_changed_plans', 'rider_wait_too_long', 'rider_booked_by_mistake', 'rider_other'],
    driver: ['driver_rider_no_show', 'driver_vehicle_problem', 'driver_safety_concern', 'driver_other'],
    dispatcher: ['dispatcher_rider_request', 'dispatcher_duplicate_booking', 'dispatcher_no_driver_available', 'dispatcher_rider_no_show', 'dispatcher_other'],
    system: ['system_no_driver_found'],
  } as const satisfies Record<'rider' | 'driver' | 'dispatcher' | 'system', readonly RideReasonCode[]>;
  export type CancelReasonCode = (typeof CANCEL_REASONS)[keyof typeof CANCEL_REASONS][number];

  export const DECLINE_REASONS = ['decline_too_far', 'decline_unwanted_destination', 'decline_vehicle_unsuitable', 'decline_on_break', 'decline_other'] as const satisfies readonly RideReasonCode[];
  export type DeclineReasonCode = (typeof DECLINE_REASONS)[number];

  export const CANCEL_REASON_CODES = [...] // literal tuple of the 14 cancel codes, for z.enum
  export function isCancelReasonFor(actor: keyof typeof CANCEL_REASONS, code: CancelReasonCode): boolean;
  /** `*_other` needs free text — a stored "other" with nothing said is no reason. */
  export function reasonNeedsText(code: RideReasonCode): boolean; // code.endsWith('_other')

  export const REASON_LABEL_KEYS: Record<RideReasonCode, MessageKey> = { rider_changed_plans: 'reason.rider_changed_plans', … };
  ```
  Admin cancels use the `dispatcher` list (admin maps to dispatcher for status, `ride-lifecycle.controller.ts:102`).
- **PATTERN**: `enums.ts:81-89`; `Record<Enum, MessageKey>` per `driver-list.tsx:23`.
- **IMPORTS**: `type MessageKey` from `./i18n` (check the actual export site, `i18n/lv.ts:426` / `i18n.ts`) — beware a circular import: `i18n/*-reasons.ts` must NOT import from `reasons.ts`.
- **GOTCHA**: The reason list is a product choice (Q1). Build to this list; Linards edits codes in one file before merge if needed — but codes become a pg enum and protected data, so a later rename is a migration plus an `ALTER TYPE`, never a rewrite of stored rows.
- **GOTCHA**: `CANCEL_REASON_CODES` must be a written-out literal tuple (z.enum needs it), pinned to the union by a type test: `const _check: readonly CancelReasonCode[] = CANCEL_REASON_CODES` plus the reverse via `satisfies`. A unit test asserts `new Set(CANCEL_REASON_CODES)` equals the flattened `CANCEL_REASONS` values and `RIDE_REASON_CODES` equals cancel ∪ decline (Task 4).
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC 2, AC 5 (codes exist per actor)

### Task 2 — CREATE `packages/shared/src/i18n/{lv,ru,en}-reasons.ts`; UPDATE `lv.ts`, `ru.ts`, `en.ts`

- **IMPLEMENT**: `export const lvReasons = { 'reason.rider_changed_plans': 'Mainījās plāni', … }` — 19 reason keys plus console keys: `console.cancel_reason_code` ("Iemesls"), `console.cancel_reason_placeholder` ("Izvēlieties iemeslu"), `console.cancel_reason_required` ("Izvēlieties atcelšanas iemeslu"), `console.cancel_note_required` ("Iemeslam 'cits' vajag piezīmi"), `console.cancel_note_placeholder` ("Bez vārdiem vai tālruņa numuriem", D4), `console.assign_error_cancel_reason_required`, `console.assign_error_cancel_reason_not_allowed` (Task 22's `ERROR_KEYS`), and change `console.cancel_reason` value to "Piezīme (nav obligāta)" / RU "Примечание (необязательно)" / EN "Note (optional)" (the key stays — fewer touch points). Spread `...lvReasons` into `lv` next to `...lvAdmin` (`lv.ts:418`), same in ru/en. Error keys for the API codes if `assignErrorKey` maps them (`assign-state.ts:86`): `console.error.cancel_reason_required`, `console.error.cancel_reason_not_allowed` — check `ERROR_KEYS` naming first.
- **PATTERN**: `lv-admin.ts` header comment + spread at `lv.ts:1,418`.
- **GOTCHA**: `MessageKey = keyof typeof lv` — RU/EN must carry identical keys (`i18n.ts:23-26` `satisfies`); `tests/i18n.test.ts` pins placeholder parity. LV/RU wording to be checked by Linards (cosmetic — log in `.claude/references/ui-decisions.md`, not debated).
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck && pnpm --filter @taxi/shared test -- i18n`
- **SATISFIES**: AC 2, UX strings

### Task 3 — CREATE `packages/shared/src/schemas/reasons.ts`; REMOVE `rideCancelSchema` from `schemas/ride.ts`; UPDATE `index.ts`

- **IMPLEMENT**:
  ```ts
  const reasonText = z.string().trim().max(280).nullable().default(null)
    .transform((v) => (v === '' ? null : v));
  const needsText = (b: { reasonCode: RideReasonCode | null; reasonText: string | null }) =>
    !(b.reasonCode && reasonNeedsText(b.reasonCode)) || b.reasonText !== null;
  // A bodiless POST reaches the pipe as `undefined` (S8) — treat it as `{}`.
  const bodyOrEmpty = (v: unknown) => v ?? {};
  export const rideCancelSchema = z.preprocess(bodyOrEmpty, z.object({
    reasonCode: z.enum(CANCEL_REASON_CODES).nullable().default(null),
    reasonText,
  }).refine(needsText, { path: ['reasonText'], message: 'reason_text_required' }));
  export type RideCancel = z.infer<typeof rideCancelSchema>;
  export const offerDeclineSchema = z.preprocess(bodyOrEmpty, z.object({
    reasonCode: z.enum(DECLINE_REASONS).nullable().default(null),
    reasonText,
  }).refine(needsText, { path: ['reasonText'], message: 'reason_text_required' }));
  export type OfferDecline = z.infer<typeof offerDeclineSchema>;
  ```
  `z.preprocess` returns a `ZodEffects` whose *input* type is `unknown`. `new ZodValidationPipe(rideCancelSchema)` may therefore infer `T` loosely; the controller's `body: RideCancel` annotation is what carries the type at the handler. It compiles either way. `rideCancelSchema.parse({})` in the rider app returns the output type. Not spiked; Task 3's VALIDATE typechecks the api and rider app.
  Move the doc comment from `ride.ts:425-431` (actor comes from the JWT). Add `export * from './reasons'` and `export * from './schemas/reasons'` to `index.ts`.
- **GOTCHA**: The old body field `reason` disappears; zod strips unknown keys, so an old client sending `{ reason: "…" }` silently loses the text. Only the dispatch app sends it (`use-assign.ts:166-170`) — updated in Task 20. The rider app sends `rideCancelSchema.parse({})` (`status-screen.tsx:141`) — still valid; typecheck of `apps/rider` confirms.
- **GOTCHA**: `.trim()` runs before `.max`, and the `.transform` turns `''` into null, so `_other` + `"  "` fails the refine (D2).
- **GOTCHA**: The rider app's `rideCancelSchema.parse({})` (`status-screen.tsx:141`) now runs through `preprocess`. Its output `{ reasonCode: null, reasonText: null }` is valid and there is no behaviour change for riders.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck && pnpm turbo run typecheck --filter=@taxi/rider --filter=@taxi/driver`
- **SATISFIES**: AC 2

### Task 4 — CREATE `packages/shared/tests/reasons.test.ts`

- **IMPLEMENT**: expected — `rideCancelSchema.parse({})` → `{ reasonCode: null, reasonText: null }`; a valid dispatcher code passes. Edge — `*_other` without text fails with path `reasonText`; whitespace-only text fails the same way; tuple-set equalities from Task 1; every `RIDE_REASON_CODES` value has a `REASON_LABEL_KEYS` entry that exists in all three catalogs. Failure — unknown code rejected; 281-char text rejected; `isCancelReasonFor('rider', 'dispatcher_other')` false.
- **PATTERN**: `packages/shared/tests/schemas-*.test.ts`
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC 2, AC 5

### Task 5 — CREATE `db/src/schema/ride-events.ts`; UPDATE `enums.ts`, `index.ts`

- **IMPLEMENT**: enums `rideEventKindEnum = pgEnum('ride_event_kind', RIDE_EVENT_KINDS)`, `rideEventActorEnum = pgEnum('ride_event_actor', RIDE_EVENT_ACTORS)`, `rideReasonCodeEnum = pgEnum('ride_reason_code', RIDE_REASON_CODES)`. Table `ride_events`:
  - `id uuid pk defaultRandom`
  - `seq bigint generated always as identity` (drizzle: `bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity()`), unique
  - `rideId uuid notNull → rides.id` (no action)
  - `kind ride_event_kind notNull`
  - `fromStatus ride_status` nullable (null for `created`, `assigned`, `released`)
  - `toStatus ride_status notNull` (for `assigned`/`released`: the ride's status at that moment)
  - `actorKind ride_event_actor notNull`, `actorId uuid → users.id` nullable
  - `reasonCode ride_reason_code` nullable, `reasonText text` nullable
  - `driverId uuid → drivers.userId` nullable, `vehicleId uuid → vehicles.id` nullable
  - `occurredAt timestamptz notNull default sql\`clock_timestamp()\``
  - indexes: `ride_events_ride_seq_idx (ride_id, seq)`; `ride_events_driver_idx (driver_id, occurred_at)` (K12 systems check names `(driver_id, occurred_at)` as a 5-year read path — #322 reads it)
  - checks: `ride_events_actor_id_ck`: `(actor_kind = 'system') = (actor_id IS NULL)`; `ride_events_status_kind_ck`: `(kind = 'status') = (from_status IS NOT NULL)`; `ride_events_driver_kind_ck`: `kind NOT IN ('assigned','released') OR driver_id IS NOT NULL`; `ride_events_reason_text_ck`: `reason_text IS NULL OR char_length(reason_text) <= 280`
- **PATTERN**: `dispatch-audit.ts:17-39`; check constraints — grep `check(` in `db/src/schema` for an existing usage, else drizzle `check('name', sql\`…\`)` in the table's third arg.
- **GOTCHA**: `released` event: `vehicleId` is the OUTGOING vehicle, which may be null on rides accepted before #86's stamp — the check therefore requires only `driver_id`.
- **GOTCHA**: `actorId` FK to `users.id` — the force-assign `dispatcherId` and every JWT `sub` are `users.id` (`auth.ts:59-65`), so this holds; #320 erasure pseudonymises users, never deletes (K10), so the FK never blocks it.
- **VALIDATE**: `pnpm --filter @taxi/db typecheck`
- **SATISFIES**: AC 1

### Task 6 — UPDATE `db/src/schema/rides.ts`, `vehicles.ts`; generate migration 0017

- **IMPLEMENT**:
  - `rides.vehicleId` FK: `onDelete: 'set null'` → remove (default no action). Rewrite the comment at `rides.ts:46-51` (vehicles are retired, never deleted).
  - `ride_fare_lines.rideId`: `onDelete: 'cascade'` → no action (G9 reviewed: the cascade can never fire under the rides DELETE block, and if a superuser disabled the trigger it would silently take the fare with the ride; NO ACTION makes such a delete fail on the fare lines too).
  - `ride_offers`: add `respondedAt timestamptz` nullable, `declineReason ride_reason_code` nullable.
  - `vehicles`: add `retiredAt timestamptz` nullable; plate index → `uniqueIndex('vehicles_plate_uix').on(sql\`upper(${t.plate})\`).where(sql\`${t.retiredAt} IS NULL\`)` (Q3).
  - Then `pnpm --filter @taxi/db generate` → `0017_<random>.sql`. Read the SQL: expect `CREATE TYPE` ×3, `CREATE TABLE ride_events`, FK drop/re-add for `rides_vehicle_id_vehicles_id_fk` and `ride_fare_lines_ride_id_rides_id_fk`, two `ADD COLUMN` on `ride_offers`, one on `vehicles`, `DROP INDEX vehicles_plate_uix` + recreate partial.
- **GOTCHA**: `declineReason` uses the shared reason enum (any code), but only decline codes are valid there — add check `ride_offers_decline_reason_ck`: `decline_reason IS NULL OR decline_reason::text LIKE 'decline\_%'` (cheap, and the trigger in 0018 separately enforces "only when status = declined").
- **GOTCHA**: api `CLAUDE.md` says plates are unique platform-wide — update that line in Task 26.
- **VALIDATE**: `pnpm --filter @taxi/db generate` produces exactly one new file; `cat db/migrations/0017_*.sql`; `git diff db/migrations/meta/_journal.json` shows one entry idx 17
- **SATISFIES**: AC 1, AC 3, AC 5 (G2, G9)

### Task 7 — CREATE custom migration `0018_protected_records.sql`

- **IMPLEMENT**: `pnpm --filter @taxi/db exec drizzle-kit generate --custom --name protected_records` (creates empty SQL, snapshot, journal idx 18). Then write, each statement separated by `--> statement-breakpoint`:
  ```sql
  -- 35.² (5): records of trips, drivers and vehicles may not be deleted or corrected.
  -- Superuser `taxi` can still DISABLE TRIGGER; option E2 (least-privilege role) is deferred (K1).
  CREATE OR REPLACE FUNCTION protected_record_refuse() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'protected_record: % on % is not allowed', TG_OP, TG_TABLE_NAME;
  END; $$ LANGUAGE plpgsql;

  -- ride_events: append-only
  CREATE TRIGGER ride_events_protect BEFORE UPDATE OR DELETE ON ride_events FOR EACH ROW EXECUTE FUNCTION protected_record_refuse();
  CREATE TRIGGER ride_events_protect_truncate BEFORE TRUNCATE ON ride_events FOR EACH STATEMENT EXECUTE FUNCTION protected_record_refuse();

  -- delete-blocked: rides, drivers, vehicles
  CREATE TRIGGER rides_no_delete BEFORE DELETE ON rides FOR EACH ROW EXECUTE FUNCTION protected_record_refuse();
  CREATE TRIGGER rides_no_truncate BEFORE TRUNCATE ON rides FOR EACH STATEMENT EXECUTE FUNCTION protected_record_refuse();
  -- … same pair for drivers, vehicles

  -- ride_offers: only the moves the code makes
  CREATE OR REPLACE FUNCTION ride_offers_guard() RETURNS trigger AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'protected_record: DELETE on ride_offers is not allowed';
    END IF;
    -- every column except the three mutable ones is frozen; new columns are frozen automatically
    IF (to_jsonb(NEW) - 'status' - 'responded_at' - 'decline_reason')
       IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'responded_at' - 'decline_reason') THEN
      RAISE EXCEPTION 'protected_record: ride_offers % may only change status, responded_at, decline_reason', OLD.id;
    END IF;
    IF NOT ((OLD.status = 'pending' AND NEW.status IN ('accepted','declined','expired','revoked'))
         OR (OLD.status = 'accepted' AND NEW.status = 'revoked')) THEN
      RAISE EXCEPTION 'protected_record: ride_offers % % -> % is not allowed', OLD.id, OLD.status, NEW.status;
    END IF;
    IF OLD.responded_at IS NOT NULL AND NEW.responded_at IS DISTINCT FROM OLD.responded_at THEN
      RAISE EXCEPTION 'protected_record: ride_offers.responded_at is written once';
    END IF;
    IF OLD.decline_reason IS NOT NULL AND NEW.decline_reason IS DISTINCT FROM OLD.decline_reason THEN
      RAISE EXCEPTION 'protected_record: ride_offers.decline_reason is written once';
    END IF;
    IF NEW.decline_reason IS NOT NULL AND NEW.status <> 'declined' THEN
      RAISE EXCEPTION 'protected_record: decline_reason only on a declined offer';
    END IF;
    RETURN NEW;
  END; $$ LANGUAGE plpgsql;
  CREATE TRIGGER ride_offers_guard BEFORE UPDATE OR DELETE ON ride_offers FOR EACH ROW EXECUTE FUNCTION ride_offers_guard();
  CREATE TRIGGER ride_offers_protect_truncate BEFORE TRUNCATE ON ride_offers FOR EACH STATEMENT EXECUTE FUNCTION protected_record_refuse();
  ```
  Precede each `CREATE TRIGGER` with `DROP TRIGGER IF EXISTS` (0003 pattern).
- **GOTCHA**: A same-status UPDATE (pending→pending, any no-op) raises by the status rule. That is intended — the K1 contract is "only these moves". It is exactly what breaks `dispatch.integration.spec.ts:411,1229,795` (Task 18).
- **GOTCHA**: Trigger names must match `PROTECTED_TABLES` / `DELETE_BLOCKED_TABLES` metadata in Task 8 — the drift check reads them.
- **GOTCHA**: `drizzle-kit generate --custom` writes a snapshot identical to 0017's; confirm a later plain `pnpm --filter @taxi/db generate` reports "No schema changes" (drizzle does not model triggers, so it never drops them — `append-only-enforcement-options.md` §1).
- **Verified while planning**: this SQL, run verbatim, passed all 25 cases in S1 (8 allowed, 17 raising). Copy it as written; changes to it are not covered by S1.
- **VALIDATE**: `docker compose up -d --wait && pnpm --filter @taxi/db exec drizzle-kit migrate` (dev DB) exits 0; `pnpm --filter @taxi/db generate` → "No schema changes" (S5 `observed` on the spike)
- **SATISFIES**: AC 3, AC 4, AC 5

### Task 8 — CREATE `db/src/protected-tables.ts`; UPDATE `db/src/index.ts`

- **IMPLEMENT**:
  ```ts
  /** K1. Later tickets ADD their tables here as an AC of their own (#319, #327). */
  export const PROTECTED_TABLES = [
    { table: 'ride_events', triggers: ['ride_events_protect', 'ride_events_protect_truncate'] },
    { table: 'ride_offers', triggers: ['ride_offers_guard', 'ride_offers_protect_truncate'] },
  ] as const;
  export const DELETE_BLOCKED_TABLES = [
    { table: 'rides', triggers: ['rides_no_delete', 'rides_no_truncate'] },
    { table: 'drivers', triggers: ['drivers_no_delete', 'drivers_no_truncate'] },
    { table: 'vehicles', triggers: ['vehicles_no_delete', 'vehicles_no_truncate'] },
  ] as const;
  ```
- **GOTCHA**: names are SQL table names (strings), not drizzle objects — the test runs raw SQL against them and maps to drizzle tables via a `Record<name, PgTable>` in the test, so adding a name without a drizzle mapping is a compile error there.
- **VALIDATE**: `pnpm --filter @taxi/db typecheck`
- **SATISFIES**: AC 4

### Task 9 — CREATE `db/tests/protected-tables.test.ts` (the K1 test)

- **IMPLEMENT** (vitest; `getTestDb()` and its `pool` from `db/tests/helpers.ts:13` for raw SQL):
  - Fixture: insert one user (rider), one user + driver, one vehicle, one ride (status `requested`), one offer (`pending`), one `ride_events` row (`created`, actor rider). All via drizzle insert — inserts are allowed.
  - **Table-driven over `PROTECTED_TABLES`**: for each table, (a) drizzle `db.update(table).set({...harmless column...})` rejects with `cause` matching `/protected_record/`; (b) drizzle `db.delete(table)` rejects; (c) raw `pool.query('UPDATE <t> SET … WHERE id = $1')` and `DELETE FROM <t> WHERE id = $1` reject with `code === 'P0001'`; (d) `TRUNCATE <t> CASCADE` rejects. For `ride_offers`, the UPDATE case is a forbidden move (`pending → pending` no-op and a `sent_at` change) — the allowed moves are tested separately below.
  - **Table-driven over `DELETE_BLOCKED_TABLES`**: drizzle delete and raw `DELETE` reject; `TRUNCATE … CASCADE` rejects; an ordinary UPDATE succeeds (AP1 — operational rows stay mutable).
  - **Drift check**: `SELECT c.relname, t.tgname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal` — for every listed table, every listed trigger exists and `tgenabled <> 'D'`. Also `SELECT confdeltype FROM pg_constraint WHERE conname = 'rides_vehicle_id_vehicles_id_fk'` → `'a'` (no action) and same for `ride_fare_lines_ride_id_rides_id_fk`. Both names `observed` in `0008_lying_power_man.sql:2` and `0001_*.sql:156`; Task 6's drop/re-add keeps drizzle's naming — confirm in the generated 0017.
  - **Every destructive attempt runs inside a transaction that always rolls back** (`await db.transaction(async (tx) => { await expect(…).rejects…; tx.rollback() })` or `BEGIN … ROLLBACK` on a pool client). TRUNCATE and DELETE are transactional in Postgres. Without this, a regressed trigger lets `TRUNCATE … CASCADE` / `DELETE` succeed and wipes rows other files in `taxi_test` rely on, turning one red test into many unrelated ones. A rejected statement aborts the tx — use a savepoint per attempt, or one tx per attempt.
  - **Offer guard matrix** (edge AC): allowed `pending→accepted` (with `responded_at` set), `pending→declined` (with `decline_reason`), `pending→expired`, `pending→revoked`, `accepted→revoked` (responded_at unchanged) all succeed; `declined→accepted`, `expired→pending`, `revoked→accepted`, changing `responded_at` twice, `decline_reason` on an `expired` move, `expires_at` change on a pending row all raise.
  - **Vehicle referenced by a ride**: set `rides.vehicle_id`, then raw `DELETE FROM vehicles` raises (`P0001` from the trigger, which fires before the FK).
- **GOTCHA**: The test runs as superuser `taxi` — put the K1 sentence ("proves no application code path can delete or overwrite, not that a superuser cannot — option E2 deferred") in the file's top comment.
- **GOTCHA**: The api eslint rule (Task 19) does not cover `db/tests` — no disable comment needed here.
- **VALIDATE**: `pnpm --filter @taxi/db test` green. Then mutation check, BOTH halves: comment out `CREATE TRIGGER rides_no_delete` in 0018, re-run (global-setup re-migrates) → the drizzle-delete case AND the drift check for `rides` go red, while the `drivers`/`vehicles` cases stay green and no other `db/tests` file goes red (proves the rollback wrapping). Record both results. Restore.
- **SATISFIES**: AC 3 (edge), AC 4 (K1 failure), AC 5 (SQL vehicle delete)

### Task 10 — CREATE `services/api/src/features/rides/ride-events.repository.ts`; export from rides barrel

- **IMPLEMENT**:
  ```ts
  export interface RideEventActor { kind: RideEventActorKind; id: string | null; reasonCode?: RideReasonCode | null; reasonText?: string | null }
  export const SYSTEM_ACTOR: RideEventActor = { kind: 'system', id: null };
  export async function insertRideEvent(tx: DbTx, e: { rideId: string; kind: RideEventKind; fromStatus: RideStatus | null; toStatus: RideStatus; actor: RideEventActor; driverId?: string | null; vehicleId?: string | null }): Promise<void>
  ```
  A plain function (no DI) — every caller already holds a `tx`. Also `export function actorKindFromRole(role: UserRole): RideEventActorKind` (identity map today, but typed `Record<UserRole, RideEventActorKind>` so a new role is a compile error).
- **GOTCHA**: `tx` is required — an event written outside the change's transaction is the bug this ticket exists to prevent.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC 1

### Task 11 — UPDATE `ride-transition.service.ts`

- **IMPLEMENT**: `transitionInTx(tx, rideId, from, to, actor: RideEventActor)` — after a matched UPDATE, `await insertRideEvent(tx, { rideId, kind: 'status', fromStatus: from, toStatus: to, actor })`. No row matched → no event. `transition(rideId, from, to, actor, reason = null)` — `reason` keeps feeding `emitStatus` only. Update the class docblock: "The ONE guarded writer of `rides.status` and of status events".
- **GOTCHA**: Argument order: `actor` before the optional `reason` on `transition`, so every caller is forced to touch the call.
- **UPDATE** `ride-transition.service.spec.ts`: its fake Drizzle (`:22-61`) exposes only `update().set().where().returning()` and `transaction`. `insertRideEvent` calls `tx.insert(rideEvents).values(…)`, so add `insert: () => ({ values: () => Promise.resolve() })` to the chain, or every case throws `TypeError`. Add one case that the matched UPDATE inserts an event with `(rideId, 'status', from, to, actor)`, and one that an unmatched UPDATE inserts none.
- **VALIDATE**: `pnpm turbo run typecheck --filter=@taxi/api` — EXPECTED RED, listing every caller. The 12 production sites were re-grepped while planning (`observed`): `ride-lifecycle.service.ts:109,145,202,277`; `settlement.service.ts:107`; `dispatch.service.ts:148,199,290,423`; `force-assign.service.ts:102,113`; `reassign.service.ts:112`. A site in the compiler's list and not this one is a finding to resolve before Task 12.
- **SATISFIES**: AC 1

### Task 12 — UPDATE every transition caller (table in CONTEXT)

- **IMPLEMENT**: pass the actor per the table. Specifics:
  - `force-assign.service.ts` / `reassign.service.ts`: their inputs carry only `dispatcherId`; add `actorKind: 'dispatcher' | 'admin'`, filled by `dispatch.controller.ts` (`:103`, `:124`) from `user.role`.
  - `ride-lifecycle.controller.ts:102`: keep `actor = role === 'admin' ? 'dispatcher' : role` for the cancelled status; additionally pass `eventActor: actorKindFromRole(user.role)` and the reason fields into `lifecycle.cancel`.
  - `settlement.service.ts:107`: actor from `input.actor` → map `SettlementActor` to `RideEventActorKind` (read `settlement.controller.ts:57-76`; if `SETTLEMENT_ACTORS` already collapses admin, carry the role through like cancel).
  - `dispatch.service.ts:148` and `:423`: `SYSTEM_ACTOR`.
  - `settlement.service.ts:107`: `SettlementActor` is already `'driver' | 'dispatcher' | 'admin'` (`:30`). It maps 1:1 onto `RideEventActorKind`, so pass `{ kind: input.actor, id: input.actorId }`.
  - `reassign.service.ts`: its tx2 calls `forceAssignService.forceAssign({...})` (`:203`). Forward `actorKind` there too.
- **GOTCHA (file budget, `derived`)**: `ride-lifecycle.service.ts` is 472 lines (`wc -l`, `observed`). Edits: an actor object at 4 sites (+1 to +3 lines each after prettier, so +4 to +12); a cancel input with `eventActor`, `reasonCode`, `reasonText` replacing `reason` (+2); one `assertCancelReason` call (+1). That is +7 to +15, giving **479–487**, under 500. The condition: validation logic lives in `ride-lifecycle.policy.ts` (80 lines, plenty of room), never in the service. If `wc -l` passes 495, move the `cancel` input type into the policy file.
- **GOTCHA**: `dispatch.service.ts` is 433 lines: +3 actor objects and the decline body, roughly +10 → ~443. `force-assign.service.ts` and `reassign.service.ts` are well under.
- **UPDATE unit specs that pin the old call shapes**. These fail at RUNTIME, not compile time, because `toHaveBeenCalledWith` with one argument fewer is still valid TypeScript. Counts are from a grep while planning (`observed`), so re-grep before editing:
  - `ride-lifecycle.service.spec.ts`: 5 `transitionInTx`/`transition` `toHaveBeenCalledWith` assertions (e.g. `:224`, `:269-274`, `:340-345`, `:507`, `:619`). Append the expected actor, e.g. `{ kind: 'driver', id: DRIVER_ID }`.
  - `dispatch.service.spec.ts`: 1 transition and 1 `assignDriver` assertion (`:247`).
  - `force-assign.service.spec.ts`: 2 transition and 1 `assignDriver` assertion (`:280`).
  - `reassign.service.spec.ts`: 2 transition and 1 `unassignDriver` assertion (`:169`, today `(RIDE_ID, OLD_DRIVER, {})`).
  - `settlement.service.spec.ts`: 0.
- **VALIDATE**: `pnpm turbo run typecheck lint --filter=@taxi/api && pnpm --filter @taxi/api exec jest src/features/rides/lifecycle/ride-lifecycle.service.spec.ts src/features/dispatch/dispatch.service.spec.ts src/features/dispatch/force-assign.service.spec.ts src/features/dispatch/reassign.service.spec.ts src/features/payments/settlement.service.spec.ts src/features/rides/ride-transition.service.spec.ts`. Unit specs need no DB, but jest's `globalSetup` does. That was `observed` while planning: a jest run in the spike worktree with the repo config failed in `runGlobalHook` with no Postgres up. Run them with Docker up, or as part of Level 3.
- **SATISFIES**: AC 1

### Task 13 — UPDATE `rides.repository.ts` (`create`, `assignDriver`, `unassignDriver`) and callers

- **IMPLEMENT**:
  - `create(input)`: `CreateRideInput` gains `createdBy: RideEventActor`; after the insert at `:86`, `insertRideEvent(tx, { kind: 'created', fromStatus: null, toStatus: input.status, actor: input.createdBy })`. `rides.service.ts:338` passes `{ kind: 'rider', id: riderId }` on the app path and `{ kind: 'dispatcher' | 'admin', id: dispatcherId }` on the phone path (`:134-142` already has `dispatcherId`; carry the role the same way as Task 12).
  - `assignDriver(rideId, driverId, tx: DbTx, actor: RideEventActor): Promise<boolean>`. `tx` becomes required: both callers already pass it (`dispatch.service.ts:207`, `force-assign.service.ts:123`). The actor goes LAST so the existing positional args do not move. Change `.returning({ id: rides.id })` to `.returning({ vehicleId: rides.vehicleId, status: rides.status })`, and on a matched row call `insertRideEvent(tx, { kind: 'assigned', fromStatus: null, toStatus: row.status, driverId, vehicleId: row.vehicleId, actor })`. **The return type stays `boolean`**: the event is written inside, so no caller needs the vehicle id, and the unit-spec mocks returning `true`/`false` (`dispatch.service.spec.ts:128-129`, `force-assign.service.spec.ts:134-135`) stay valid.
  - `unassignDriver(rideId, driverId, tx: DbTx, actor: RideEventActor): Promise<boolean>`. Postgres 16 has no `RETURNING OLD` (that arrives in PG 18), so read the outgoing vehicle first: `const [prev] = await tx.select({ vehicleId: rides.vehicleId }).from(rides).where(eq(rides.id, rideId))`. This is safe without `FOR UPDATE`: the only caller (`reassign.service.ts:123`) runs it after `transitionInTx` updated the same row in the same transaction, so this transaction already holds the row lock. Write that reason in a comment. Then run the existing conditional UPDATE, and on a match call `insertRideEvent(tx, { kind: 'released', fromStatus: null, toStatus: row.status, driverId, vehicleId: prev?.vehicleId ?? null, actor })`.
- **GOTCHA (file budget, `derived`)**: `rides.repository.ts` is 419 lines (`observed`). Edits: `create` +6, `assignDriver` +6, `unassignDriver` +10, and imports +2, about **+24 → ~443**. No extraction needed; the condition is that the event-row construction lives in `insertRideEvent`, not inline.
- **GOTCHA**: Do NOT filter retired vehicles here yet — that is Task 16 (`assignDriver`'s vehicle subselect, `:335-340`).
- **VALIDATE**: `pnpm turbo run typecheck --filter=@taxi/api`. The behaviour itself is proven by the integration cases in Task 20 (accept → `assigned`, reassign → `released` with the outgoing ids).
- **SATISFIES**: AC 1 (assignment and release each write their own event)

### Task 14 — Cancel: reasons stored, dispatcher/admin code required

- **IMPLEMENT**:
  - `ride-lifecycle.controller.ts`: body now `rideCancelSchema` from `schemas/reasons`; pass `reasonCode`, `reasonText`, `eventActor`.
  - `ride-lifecycle.policy.ts`: `assertCancelReason(eventActor, reasonCode)` — dispatcher/admin with `reasonCode === null` → `UnprocessableEntityException('cancel_reason_required')`; a code not in `CANCEL_REASONS[lifecycleActor]` → 422 `cancel_reason_not_allowed`. Rider/driver with null → allowed (flips in #322/#326).
  - `ride-lifecycle.service.ts` cancel: the actor passed to `transitionInTx` carries `reasonCode`/`reasonText`; `emitStatus(moved, from, input.reasonText)` (unchanged payload shape); `logApplied` keeps `hasReason` and adds `reasonCode` (closed enum, no PII).
- **GOTCHA**: Validate BEFORE opening the tx so a 422 writes nothing.
- **GOTCHA**: `reason_text` is free text in an undeletable row (Q4) — never log it.
- **VALIDATE**: `pnpm --filter @taxi/api test -- ride-lifecycle`
- **SATISFIES**: AC 2

### Task 15 — Decline: body, `responded_at`, `decline_reason`

- **IMPLEMENT**:
  - `dispatch.controller.ts:79-87`: `@Body(new ZodValidationPipe(offerDeclineSchema)) body: OfferDecline`; `dispatch.decline(user.sub, offerId, body)`.
  - `dispatch.repository.ts`: `acceptOffer` sets `respondedAt: sql\`now()\``; `declineOffer(offerId, driverId, reasonCode, tx?)` sets `respondedAt: sql\`now()\`, declineReason: reasonCode`. `expireOffer`, `revokePendingForRide`, `supersedeAcceptedOffer`, `revokePendingOffers` (`ride-lifecycle.repository.ts:259`) set ONLY `status` — no driver response happened (Q5); `supersedeAcceptedOffer` must not touch `responded_at` or the trigger raises.
  - `dispatch.service.ts:280-290`: the `transition(rideId, 'offered', 'requested', { kind: 'driver', id: driverId, reasonCode, reasonText }, null)` — so the reason text lands on the ride event; the offer row keeps the code.
- **GOTCHA**: A bodiless POST (the driver app today, `use-offers.tsx:129-133`) must still 201. It reaches the pipe as `undefined` (S8, `observed`), and the `z.preprocess` in Task 3 handles that. Pin it with a supertest call that sends NO body and NO content-type (omit `.send()` entirely), not `.send({})`. `{}` takes a different parser path and would pass even without the preprocess.
- **GOTCHA**: `declineOffer` and the transition are two transactions today (`dispatch.service.ts:280-290`). Leave that split — merging them is out of scope; the offer row and the ride event each carry the code.
- **GOTCHA**: `dispatch.repository.ts` is 432 lines, `dispatch.service.ts` 433 — check `wc -l` after.
- **VALIDATE**: `pnpm --filter @taxi/api test -- dispatch`
- **SATISFIES**: AC 1, AC 3

### Task 16 — Vehicles: retire replaces DELETE

**Depends on:** Task 6 and Task 13 (same file, `rides.repository.ts`).

- **IMPLEMENT**:
  - `vehicles.repository.ts`: REMOVE the delete (`:108-114`); ADD `retire(vehicleId, driverId)` = `update(vehicles).set({ retiredAt: sql\`now()\` }).where(id, driverId, isNull(retiredAt)).returning({ id })`. Add `isNull(vehicles.retiredAt)` to `listForDriver` (`:59-65`) and `countForDriver` (`:116-122`).
  - `vehicles.service.ts:83-114`: rename `remove` → `retire`; keep the `driver_on_ride` 409 and the "no active car → `markOffline` + `setOfflineIfOnline`" behaviour exactly.
  - `vehicles.controller.ts:56-63`: `@Delete(':id')` → `@Post(':id/retire') @HttpCode(204)`. `admin-vehicles.controller.ts:36-43` likewise; `admin-drivers.service.ts:125-130` `removeVehicle` → `retireVehicle`.
  - Filter `retired_at IS NULL` at: `drivers.repository.ts:198` (`setOnlineIfEligible` exists-check), `:391`, `:413` (roster plate + match attributes), `admin-drivers.repository.ts:74` (detail list), `:193` (`vehicleOwner` — retired car is not editable: treat as not found), `rides.repository.ts:335-340` (`assignDriver` subselect). NOT at `notifications.repository.ts:172` (plate of a past ride's car — must still resolve) — add a one-line comment saying so.
  - `admin-drivers.repository.ts:205+ updateVehicle`: add `isNull(retiredAt)` to its WHERE.
- **GOTCHA**: Plate re-registration after retirement relies on the partial index (Task 6). A `plate_taken` 409 must still fire against an ACTIVE car with the same plate.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC 5 (route gone)

### Task 17 — UPDATE vehicle specs (delete → retire)

- **IMPLEMENT**: rewrite `drivers.integration.spec.ts:274,704,727,746,765`, `admin-drivers.integration.spec.ts:289,370`, `vehicles.service.spec.ts:72,81,93` to `POST …/retire` (204). ADD: expected — retired car disappears from `GET /drivers/me/vehicles` and from the admin detail; edge — retiring the last car takes an online driver offline; a retired car is never stamped by `assignDriver` (driver with one retired + one active car → ride's `vehicle_id` is the active one); `setOnlineIfEligible` refuses a driver whose only car is retired; re-adding a retired car's plate → 201; failure — `DELETE /drivers/me/vehicles/:id` → 404 and `DELETE /admin/vehicles/:id` → 404; retire while `on_ride` → 409 `driver_on_ride`; retire someone else's car → 404.
  - `tracking.integration.spec.ts:~683`: invert — after retire, `rides.vehicle_id` is still set and the receipt still shows the plate (this is G2's proof).
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- drivers admin-drivers vehicles tracking`
- **SATISFIES**: AC 5, AC 8

### Task 18 — UPDATE `dispatch.integration.spec.ts` fixtures broken by the offer guard

- **IMPLEMENT**: first run the spec with the 0018 trigger in place and record the failures (expected: the tests around `:411`, `:795`, `:1229`). Then:
  **Approach: the real sweeper writes the offer with an old clock**, so it is overdue at birth and nothing is updated afterwards. `buildOffer` takes `sentAt = input.now ?? new Date()` and `expiresAt = sentAt + offerTimeoutSeconds·1000` (`offer-builder.ts:61-64`), and `dispatch.service.ts:125` passes no `now`, so faking `Date` for one `sweeper.tick()` moves both.

Provenance:
- `observed` (S9): Jest can fake `Date` alone while real timers keep firing.
- `derived`, not run: that this one tick picks the same driver and writes the same single offer. The derivation rests on reading every clock comparison on the sweeper's path, grepped while planning:
  - `driver-location.service.ts:106`, `freshSinceMs: Date.now() − TTL`. A lower bound only: an earlier clock lowers it, so positions written at real time stay fresh.
  - `test/harness.ts:63-70`, in-memory KV `live()` expires when `expiresAt <= now()`. An earlier clock expires nothing.
  - `dispatch.sweeper.ts:132` and `dispatch.service.ts:356`, the unclaimed age `Date.now() − createdAt`. An earlier clock gives a negative age, so nothing is stale and no alert fires on that tick. The original first tick raises none either, because the ride leaves `requested`.
  - The condition: every clock comparison on that path is one-sided in this way. Re-grep `Date.now()\|new Date()` under `features/dispatch`, `features/drivers/location` and `features/drivers/presence` before editing, and check each new hit the same way.

Fallback, if step (1) of VALIDATE after the edit shows a different driver, no offer, or an early unclaimed alert: run the first tick for real, read the row it wrote, then mark it revoked (pending→revoked, allowed) and insert one copy with `{ ...row, id: randomUUID(), status: 'pending', expiresAt: <past> }`. Re-point the `[0]` assertion to `find(o => o.id === copy.id)` and the attempt count to +1 with a comment. Prefer `tickAsOf`; the fallback changes what two assertions measure.

  Rejected alternatives:
  - **Revoke-and-copy** leaves two rows. `afterExpiry[0]` (`:419`, ordered by `sentAt` at `:204-209`) becomes ambiguous, and `alert.offerAttempts` (`:424`, expects 1) counts 2, because `countAttempts` counts every row (`dispatch.repository.ts:205-215`).
  - **Shrinking `offerTimeoutSeconds`** fails twice: the schema is `.int().positive()` (`platform-config.ts:40`), and `platform_config` is one global row shared by parallel spec files.
  - **A fixture insert built by hand** has to reproduce four jsonb snapshots.

  Add once at the top of the spec:
  ```ts
  /** Fakes ONLY `Date` (S9): real timers, sockets and pg keep running. */
  const ALL_TIMERS_BUT_DATE = ['hrtime','nextTick','performance','queueMicrotask','requestAnimationFrame','cancelAnimationFrame','requestIdleCallback','cancelIdleCallback','setImmediate','clearImmediate','setInterval','clearInterval','setTimeout','clearTimeout'] as const;
  /** Runs one sweeper pass as if it were `ageMs` ago, so the offers it writes carry that `sent_at`/`expires_at`. #316's offer guard forbids editing them afterwards. */
  async function tickAsOf(ageMs: number): Promise<void> {
    jest.useFakeTimers({ doNotFake: [...ALL_TIMERS_BUT_DATE], now: Date.now() - ageMs });
    try { await sweeper.tick(); } finally { jest.useRealTimers(); }
  }
  ```
  - `:390-413` (AC #3 expiry): replace the first `await sweeper.tick()` (`:391`) with `await tickAsOf(30_000)`, and delete the `update(rideOffers).set({ expiresAt })` block (`:409-413`) together with its comment. Derived: with the default timeout of 20 s (`platform-config.ts:40`; the seed sets no override, `grep` of `db/src/seed` `observed`), `expires_at` = now − 30 s + 20 s = now − 10 s, so it is overdue by the DB clock. Docker skew is ~65 ms per `0003`'s header, far inside 10 s. The offset is the smallest that keeps a wide margin, so the clock moves as little as possible. The second `sweeper.tick()` (`:415`) stays real. Keep the comment that time is driven by the DB clock, reworded to "an offer born with a past deadline".
  - `:1222-1231` (409 on an expired accept): same change. `tickAsOf(30_000)` replaces the tick at `:1224`, and the UPDATE at `:1228-1231` goes.
  - `:780-797` (release resets the attempt budget): replace the tick at `:784` with `await tickAsOf(10_000)` and delete the `sentAt` UPDATE (`:794-797`). The `10_000` must be **below** the 20 s timeout, or the accept at `:786-789` returns 409. Derived: `expires_at` = now − 10 s + 20 s = now + 10 s, so the accept still succeeds and `sent_at` sits 10 s before the release, far beyond any skew. The padding INSERTs (`:798-806`) keep `sentAt: Date.now() − 600_000`, and inserts are allowed. `scoped` still counts only the override's own offer.
  - `:352` stays as is (pending→revoked is an allowed move).
  - Line numbers are as of `b890929`; re-read the four blocks before editing.
- **VALIDATE**: (1) before the edit, with 0018 applied, run `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api exec jest src/features/dispatch/dispatch.integration.spec.ts` and record exactly 3 failing tests, each with a `protected_record:` error. A different count means the fixture list is wrong, so stop and re-grep. (2) After the edit, the same command is green with an unchanged test count. Record both in the execution report.
- **SATISFIES**: AC 8

### Task 19 — UPDATE `services/api/eslint.config.mjs` (option E3)

- **IMPLEMENT**: a block scoped to `files: ['src/**/*.ts']`:
  ```js
  'no-restricted-syntax': ['error', {
    selector: "CallExpression[callee.property.name='delete'][arguments.0.name=/^(rides|drivers|vehicles|rideEvents|rideOffers)$/]",
    message: 'Protected record (#316, K1): rides/drivers/vehicles are never deleted; ride_events/ride_offers are append-only. Retire or append instead.',
  }]
  ```
  Comment: the list mirrors `PROTECTED_TABLES` + `DELETE_BLOCKED_TABLES` in `@taxi/db` — a table added there is added here.
- **GOTCHA**: `no-restricted-syntax` is not set anywhere today (scout grep), so it cannot conflict with the base config. Spec files under `src/` are covered too. No spec should delete these tables now; if one does, it is a trigger test and belongs in `db/tests`.
- **GOTCHA (config shape)**: in the spike, appending the block needed the file rewritten to stay valid. Read how `services/api/eslint.config.mjs` builds and exports its array (it spreads `@taxi/config/eslint/base.mjs`), then add the block as one more array element after the base entries, so it overrides nothing above it.
- **GOTCHA (ordering, S7 `observed`)**: the rule's one existing hit is `vehicles.repository.ts:109` (`this.db.delete(vehicles)`), which Task 16 removes. Land this task after Task 16, or lint goes red.
- **GOTCHA (baseline, S7 `observed`)**: `@taxi/api` lint shows 17 `no-unsafe-argument` warnings in integration specs before this ticket. They are warnings and exit 0. Do not try to fix them here.
- **VALIDATE** (both halves): a typed probe, because `db: any` would raise `no-unsafe-call`/`no-unsafe-return` (errors under `recommendedTypeChecked`) and make the exit code meaningless. `services/api/tsconfig.json` has no `include`, so `src/__lint_probe.ts` is inside the project service.
  ```bash
  cd services/api
  printf "import { rideEvents, type Db } from '@taxi/db';\nexport const x = (db: Db) => db.delete(rideEvents);\n" > src/__lint_probe.ts
  pnpm exec eslint src/__lint_probe.ts | grep -c "no-restricted-syntax"   # expect 1
  printf "export const m = new Map<string, number>();\nexport const rides = 'k';\nm.delete('x');\n" > src/__lint_probe.ts
  pnpm exec eslint src/__lint_probe.ts | grep -c "no-restricted-syntax"   # expect 0
  rm src/__lint_probe.ts
  ```
  Assert on the rule name in the output, not on the exit code. Then `pnpm --filter @taxi/api lint` clean.
- **SATISFIES**: AC 6

### Task 20 — CREATE `services/api/src/features/rides/ride-events.integration.spec.ts`

- **IMPLEMENT**:
  - **Edge walk (completeness)**: `for (const [from, tos] of Object.entries(ALLOWED_TRANSITIONS)) for (const to of tos)` — built at runtime so a new edge is covered automatically. Use **one** fixture ride booked once in `beforeAll` (one HTTP booking — booking per edge would need an `Idempotency-Key` each and hit the per-rider cap in `rides.policy.ts`). For each edge: `ctx.db.update(rides).set({ status: from })` (allowed under AP1), count `kind='status'` rows for that ride, call `RideTransitionService.transitionInTx` inside `ctx.db.transaction` with a test actor, assert the count rose by exactly one and the newest row (max `seq`) is `(from, to, actor_kind, actor_id)`. Also assert a lost race (wrong `from`) adds zero rows.
  - **Per-caller actor (one assertion per caller group)**: rider booking → `created`/rider; phone booking via `/dispatch/bookings` → `created`/dispatcher; sweeper offer → `status` requested→offered/system; driver accept → `status` offered→accepted/driver + `assigned` with driver and vehicle ids, ordered by `seq` (status before assigned); force-assign as admin → `actor_kind = 'admin'`; reassign → `released` with the OUTGOING driver and vehicle; driver decline with `{ reasonCode: 'decline_too_far' }` → offer row `decline_reason`, `responded_at` set, ride event `reason_code`; decline with NO body → 201, nulls; expiry → `status`/system; driver steps + complete + settle → driver/… actors; rider cancel with no body → event with null reason.
  - **Console cancel (expected)**: dispatcher `POST /rides/:id/cancel { reasonCode: 'dispatcher_rider_request' }` → event `to_status = 'cancelled_by_dispatcher'`, `reason_code` stored. **Failure**: dispatcher with `{}` → 422 `cancel_reason_required`, ride status unchanged, zero cancel events; rider sending `dispatcher_other` → 422 `cancel_reason_not_allowed`; `dispatcher_other` with no text → 400 `validation_failed`.
  - **Rollback**: a transition whose surrounding tx throws after the event insert leaves no event (proves same-transaction).
- **PATTERN**: `ride-lifecycle.integration.spec.ts:1-120` (`createTestApp`, `phoneFor`, `onlineDriver`, `signIn`); claim a fresh `phoneFor` prefix.
- **GOTCHA**: Read events ordered by `seq`, never by `occurred_at`.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- ride-events`. Mutation, both halves: remove the `insertRideEvent` call from `transitionInTx` → the edge walk goes red AND the `created`/`assigned`/`released` assertions stay green (they are written elsewhere); record both. Restore.
- **SATISFIES**: AC 1, AC 2, AC 3

### Task 21 — UPDATE `apps/dispatch/src/features/override/dialog-shell.tsx`

- **IMPLEMENT**: add `select` to the initial-focus selector (`:66-68`) and `select:not([disabled])` to the Tab-trap selector (`:~85`).
- **VALIDATE**: `pnpm --filter @taxi/dispatch test -- dialog-shell` (add one test: Tab from the last button wraps to a `<select>` when it is first)
- **SATISFIES**: UX a11y

### Task 22 — UPDATE `cancel-dialog.tsx` + `use-assign.ts` + `page.tsx`

- **IMPLEMENT**:
  - Props: `onConfirm: (body: { reasonCode: CancelReasonCode; reasonText: string | null }) => void`.
  - Above the note: `<label htmlFor="cancel-reason-code">{t('console.cancel_reason_code')}</label><select id="cancel-reason-code" required aria-required="true" aria-invalid={showRequired} aria-describedby={showRequired ? 'cancel-reason-error' : undefined}>` with a first `<option value="" disabled>{placeholder}</option>` (nothing preselected — a preselected reason records a reason nobody gave) and one `<option>` per `CANCEL_REASONS.dispatcher` labelled via `REASON_LABEL_KEYS`. Style = the vehicle-editor select (`inputStyle`, minHeight 44) — copy the style object locally into the override slice rather than importing across slices.
  - Confirm stays enabled (unless submitting/offline); pressing it with no code sets `showRequired`, renders `<p id="cancel-reason-error" role="alert">{console.cancel_reason_required}</p>` and focuses the select. With a `*_other` code and an empty note → same pattern on the textarea with `console.cancel_note_required`.
  - Loading: while `submitting`, confirm `disabled` + `aria-busy="true"`. Error: existing `errorKey` banner. Offline: existing `disabledReasonKey` banner.
  - Visible focus (`observed`): `apps/dispatch/src/app/dispatch/layout.tsx:25-29` sets `.console a/button/input/textarea:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px }`, but **`select` is missing**. `textarea` was added there for the same reason in #19 (comment at `:20-23`). Add `.console select:focus-visible` to that selector. `apps/dispatch/src/app/admin/layout.tsx:22-27` already lists `select`, so this brings `/dispatch` in line with it. No new CSS variable and no hex.
  - `use-assign.ts:166-170`: `cancel(rideId, body)` posts `{ reasonCode, reasonText }`. Add `cancel_reason_required: 'console.assign_error_cancel_reason_required'` and `cancel_reason_not_allowed: 'console.assign_error_cancel_reason_not_allowed'` to `ERROR_KEYS` (`assign-state.ts:86-98`, `observed` naming pattern `console.assign_error_<code>`), and add both keys to the Task 2 catalogs. Also add `validation_failed`? No: `ZodValidationPipe` answers 400 `{ message: 'validation_failed', issues }` (`zod-validation.pipe.ts:17-24`), and the dialog's own client-side checks make that unreachable from the UI. It falls back to `console.cancel_failed`.
  - `page.tsx:361-372`: pass the body through.
- **GOTCHA**: the existing tests' `getByRole('textbox')` still resolves (the select is a `combobox`), but update any test that confirms without choosing a reason.
- **VALIDATE**: `pnpm --filter @taxi/dispatch typecheck && pnpm --filter @taxi/dispatch lint`
- **SATISFIES**: AC 2 (dialog cannot submit without a reason), AC 7

### Task 23 — UPDATE `cancel-dialog.test.tsx`, `use-assign.test.tsx`

- **IMPLEMENT**: expected — choose a reason, confirm → `onConfirm({ reasonCode, reasonText: null })`; with a note → trimmed text. Empty (no reason) — confirm does not call `onConfirm`, alert shown, select has `aria-invalid="true"` and focus. Edge — `dispatcher_other` without note blocked; placeholder option is selected initially and disabled. Loading — `submitting` disables confirm with `aria-busy`. Error — `errorKey` renders `role="alert"`. Offline — `disabledReasonKey` disables confirm and shows the banner. A11y — select reachable by `getByRole('combobox', { name: <label> })`; every option has text from the catalog. Hook: `cancel` sends `{ reasonCode, reasonText }`; a 422 `cancel_reason_required` maps to its key.
- **VALIDATE**: `pnpm --filter @taxi/dispatch test`
- **SATISFIES**: AC 2, AC 7

### Task 24 — Admin vehicle retire (dispatch app)

- **IMPLEMENT**: `drivers-api.ts:74-78` `deleteVehicle` → `retireVehicle` (`POST /admin/vehicles/:id/retire`, `z.null()` on 204 as today); `use-drivers.ts:151,210-212` `removeVehicle` → `retireVehicle`; `driver-detail.tsx:163` caller. Button label: check the current key; if it reads "Dzēst" (delete), change its value to "Noņemt no lietošanas" / RU / EN (cosmetic — log in ui-decisions).
- **VALIDATE**: `pnpm --filter @taxi/dispatch test -- admin-drivers` (update any test mocking `DELETE`)
- **SATISFIES**: AC 5 (no client calls a removed route)

### Task 25 — Grep for leftovers

- **VALIDATE**: `grep -rn "rideCancelSchema\|reason:" apps/dispatch/src/features/override packages/shared/src/schemas/ride.ts`; `grep -rn "\.delete(\`/drivers/me/vehicles\|'DELETE'.*vehicles\|deleteVehicle" apps services/api/src` → no hits; `grep -rn "set null\|onDelete: 'cascade'" db/src/schema/rides.ts` → no hits.
- **SATISFIES**: hygiene

### Task 26 — Docs

- **UPDATE** `.claude/references/ride-state-machine.md`: one bullet — every status change writes a `ride_events` row (kind `status`) in the same transaction; creation/assignment/release write `created`/`assigned`/`released`; readers of history read events, not the row.
- **UPDATE** `services/api/CLAUDE.md`: (a) the `RideTransitionService` bullet — "and the one writer of status events; `actor` is required"; (b) the plate bullet — "unique among ACTIVE vehicles (`retired_at IS NULL`)"; (c) new bullet — vehicles are retired, never deleted; `rides`/`drivers`/`vehicles` DELETE and `ride_events` UPDATE/DELETE raise (migration 0018); `ride_offers` moves are trigger-guarded; a new protected table goes into `@taxi/db` `PROTECTED_TABLES` + the eslint list.
- **UPDATE** `.claude/references/ui-decisions.md`: reason wording, retire label.
- **SATISFIES**: documentation

### Task 27 — Full gate

- **VALIDATE**: see Validation Commands, Level 1–3, with `REDIS_TEST_URL` set.

---

## TESTING STRATEGY

### Unit Tests

- `packages/shared/tests/reasons.test.ts` (Task 4) — schemas, tuple equalities, label coverage.
- api unit specs that stub `assignDriver`/`transitionInTx` (`dispatch.service.spec.ts`, force-assign/reassign specs, `vehicles.service.spec.ts`) updated for new signatures and return types.
- `apps/dispatch` vitest: `cancel-dialog.test.tsx`, `dialog-shell.test.tsx`, `use-assign.test.tsx`, admin-drivers tests.

### Integration Tests

- `db/tests/protected-tables.test.ts` — the K1 test, raw SQL + drizzle, drift check, offer guard matrix.
- `services/api/src/features/rides/ride-events.integration.spec.ts` — edge walk + caller actors + cancel reasons + rollback.
- Vehicle retire cases in `drivers.integration.spec.ts`, `admin-drivers.integration.spec.ts`, `tracking.integration.spec.ts`.
- Existing integration suites that edit `rides`/`drivers` fixtures must pass unchanged (AP1).

No socket/room change in this ticket; `ride:status` payload is unchanged, so no new delivery test is required. The existing lifecycle integration specs that assert `ride:status` arrival keep running.

### Edge Cases

| Edge case | Verified in |
|---|---|
| Two transitions + assignment in one tx order correctly | `ride-events.integration.spec.ts` force-assign case (by `seq`) |
| Lost race writes no event | edge walk, wrong-`from` case |
| Tx rollback leaves no event | `ride-events.integration.spec.ts` rollback case |
| `accepted → revoked` passes, `declined → accepted` raises | `db/tests/protected-tables.test.ts` offer matrix; reassign case in `ride-events.integration.spec.ts` exercises the real `supersedeAcceptedOffer` |
| `supersedeAcceptedOffer` keeps `responded_at` | reassign case (trigger would raise otherwise) |
| Decline with no HTTP body | `ride-events.integration.spec.ts` |
| `*_other` without text | `reasons.test.ts`, `ride-events.integration.spec.ts`, `cancel-dialog.test.tsx` |
| Rider sends a dispatcher code | `ride-events.integration.spec.ts` |
| Release of a ride with no stamped vehicle | `ride-events.integration.spec.ts` — reassign on a ride whose `vehicle_id` was nulled by fixture; event has `vehicle_id` null, no check violation |
| Retired car not stamped / not counted for going online / plate reusable | `drivers.integration.spec.ts` |
| Past ride keeps its retired car's plate | `tracking.integration.spec.ts` |
| TRUNCATE on protected tables | `db/tests/protected-tables.test.ts` |
| Disabled trigger | drift check (`tgenabled <> 'D'`) |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm turbo run typecheck lint --force
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm --filter @taxi/dispatch test
```

### Level 3: Integration Tests + the gate

```bash
cp -n .env.example .env; docker compose up -d --wait
set -a; . ./.env; set +a   # load REDIS_PORT (6381 on some machines)
REDIS_TEST_URL=redis://localhost:${REDIS_PORT:-6379} COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
```
One gate at a time across sessions (shared test DB — root `CLAUDE.md`). Record the api `Tests:` line; expected count = previous `694 passed` + this ticket's additions − none skipped beyond the 39 Redis-gated (`expected`; re-observe, do not copy).

### Level 4: Manual Validation

State needed: a live ride on the console board. The seed has none, but the console's own phone-booking form creates one (`/dispatch` booking form → `requested`, no driver needed), and `pnpm --filter @taxi/api mint:ride` produces an accepted one. Dispatcher login: `pnpm --filter @taxi/api provision:dispatcher`.

1. `docker compose up -d --wait && pnpm --filter @taxi/db migrate:run && pnpm dev`. Sign in to `/dispatch` as the provisioned dispatcher.
2. Book a phone ride through the console form. Board row appears.
3. Row → [Cancel] → dialog. Keyboard only: Tab reaches the reason select, the note, both buttons, and wraps (focus trap). Each has a visible focus ring. VoiceOver (macOS, Cmd+F5): the select announces its label and "required".
4. [Confirm cancel] with no reason → alert "Izvēlieties atcelšanas iemeslu", focus on the select, ride still on the board.
5. Pick "Pasažiera lūgums" → [Confirm cancel] → dialog closes, row leaves the board (the board shows live rides only — `BOARD_LIVE_RIDE_STATUSES`; the issue's "row shows `cancelled_by_dispatcher`" does not match this app, see Notes).
6. `docker compose exec postgres psql -U taxi -d taxi -c "select kind, from_status, to_status, actor_kind, reason_code from ride_events where ride_id = '<id>' order by seq"` → `created … dispatcher`, then `status requested→cancelled_by_dispatcher dispatcher dispatcher_rider_request` (plus `offered` rows if the sweeper offered it first).
7. Same DB: `delete from rides where id = '<id>';` → `ERROR: protected_record: DELETE on rides is not allowed`. (Run by Linards; local dev DB only.)
8. DevTools → Network offline → open the dialog → the offline banner shows and confirm is disabled.
9. `/admin` → a driver with two cars → retire one → it disappears from the list; the ride history row for an earlier ride with that car (from `mint:ride`) still shows the plate on its tracking receipt.

---

## ACCEPTANCE CRITERIA

- [ ] **AC 1 (expected)** Walking every `ALLOWED_TRANSITIONS` edge writes exactly one `kind='status'` `ride_events` row per edge with the correct actor; assignment and release each write their own event — Tasks 11–13, 20.
- [ ] **AC 2 (expected)** A console cancel with a reason stores `reason_code` on the cancel event; the console dialog cannot submit without one; the API refuses a dispatcher/admin cancel without one (422) — Tasks 14, 20, 22, 23.
- [ ] **AC 3 (edge)** `accepted → revoked` passes the offer trigger; `declined → accepted` raises — Tasks 7, 9.
- [ ] **AC 4 (failure, K1, PRD metric 4)** `PROTECTED_TABLES` + `DELETE_BLOCKED_TABLES` drive a table-driven test attempting UPDATE+DELETE (protected) and DELETE (delete-blocked) via drizzle and raw SQL, each raising; drift check over `pg_trigger` fails on a missing or disabled trigger. Runs as superuser `taxi` — proves no application path, not superuser (E2 deferred) — Tasks 8, 9.
- [ ] **AC 5 (failure)** `DELETE /drivers/me/vehicles/:id` and `DELETE /admin/vehicles/:id` → 404; deleting a ride-referenced vehicle via SQL raises — Tasks 6, 9, 16, 17.
- [ ] **AC 6** A `.delete(rideEvents)` line in `services/api/src` fails `pnpm lint` — Task 19.
- [ ] **AC 7** Console cancel picker UX: ≥44 px targets, visible focus, accessible names/roles, LV/RU/EN strings, theme tokens; loading/empty/error/offline each designed and tested — Tasks 21–23.
- [ ] **AC 8** Existing integration specs that edit `rides`/`drivers` fixtures pass unchanged; the three offer fixtures and the vehicle-delete specs are rewritten (they edit `ride_offers`/delete `vehicles`, outside the issue's "unchanged" set) — Tasks 17, 18.
- [ ] **AC 9** `REDIS_TEST_URL=… pnpm turbo run typecheck lint test build --force` green.

No AC needs hardware or credentials absent here.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately (mutation checks in Tasks 9, 19, 20 recorded with both halves)
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration, Redis-gated included)
- [ ] No linting or type checking errors; no shipped file over 500 lines (`wc -l` on the files flagged in Tasks 12, 13, 15)
- [ ] Manual testing confirms feature works
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Q1–Q4: resolved** by Linards on 2026-11-26 as D1–D4 (top of the plan). Two consequences remain:
  - A code cannot be removed from the pg enum once stored rows use it, so any trim happens before merge. Lawyer document G6 may extend the driver list; #322 adds codes, which is cheap.
  - **D4** leaves free text in an undeletable row. #320 (erasure) cannot reach it, and lawyer E1 must know it exists. Add one line to #320's issue when this PR opens. The dialog placeholder reads "Bez vārdiem vai tālruņa numuriem" (no names or phone numbers); key `console.cancel_note_placeholder`, added in Task 2.
- **Q5 — `responded_at` only on driver responses.** Set on accept and decline; NOT on expiry or revoke (no driver response happened; `sent_at`/`expires_at` already date an expiry). Says "response", so this reading is literal.
- **Q6 — admin on events.** Events record `admin` distinctly (K2's actor list) while the cancelled status stays `cancelled_by_dispatcher` (no `cancelled_by_admin` status exists). Assumed correct.
- **Assumption — "through the repositories".** No repository has (or will have) a delete/update method for these tables. Read as: through drizzle's query builder (the API's data path) and as raw SQL. Stated in the test's header.
- **Assumption — ordering/timing worst case.** Events written inside the change's tx: worst case a crash between UPDATE and event insert rolls both back — no status without its event and no event without its status. The decline path runs two transactions (`declineOffer` commits, then `transition`, `dispatch.service.ts:280-290`). If the process dies between them, the offer is declined (with its reason and `responded_at`) and the ride stays `offered` with no pending offer. `findOverdue` only reads pending offers (`dispatch.repository.ts:218-229`), so nothing recovers it automatically and the rider waits until a dispatcher acts. This is **pre-existing and unchanged** by this ticket; the code comment at `:284-288` names the same stranding risk. It is out of scope here: merging the two transactions changes dispatch behaviour that #316 does not own. The protected record is still correct in that case: the decline is on the offer row, and no status event exists for a status change that never happened.

## NOTES (open canvas)

**Why the actor is a required argument, not a context/ALS lookup.** An AsyncLocalStorage "current actor" would hook the sweeper (system) and HTTP requests without touching 12 call sites, but a missing actor would be a runtime null in a protected, uneditable row. The required argument makes a missing actor a compile error. Cost: ~15 signature edits.

**Why `kind` and nullable `from_status` instead of `from = to` for assignment.** VID reads start/end from `status` rows; a reader filtering `kind = 'status'` never sees assignment noise, and the checks make each kind's shape structural.

**Why `seq` plus `clock_timestamp()`.** `now()` is constant within a transaction (force-assign writes three events in one). `clock_timestamp()` makes `occurred_at` distinct and truthful; `seq` makes the order exact regardless of clock resolution. Index `(ride_id, seq)` serves per-ride history; `(driver_id, occurred_at)` serves #322's 90-day history.

**Why the offer guard compares JSONB minus three keys.** Listing frozen columns would let a column added later (#319, #327) be silently mutable. Subtracting the three mutable keys freezes everything else by default.

**Why TRUNCATE triggers too.** Row triggers do not fire on TRUNCATE; without the statement trigger, `TRUNCATE ride_events` would clear the log through an "application path" (e.g. a future test helper). Cheap to add.

**Why the K1 test lives in `db/tests`.** It is about the database, needs raw SQL and drizzle only, and `db/tests` has its own migrated DB (`taxi_test`). Placing it in `services/api/src` would also trip the eslint rule it is meant to complement. The api spec (Task 20) covers the application writers.

**Breadboard (console cancel)**
`board row` → [Cancel] → `cancel dialog` → [reason select (required, no default)] [note (optional; required for "other")] → [Confirm cancel] → `board` (row removed — cancelled rides leave the live board).
Friction: 2 → 3 actions (Cancel → pick reason → Confirm). The added step is the legal requirement (K2); no preselect because a default would store a reason nobody gave. Alternatives rejected: reason as radio buttons (5 options × 44 px = taller dialog, same tap count); reason inside the row menu (adds a level and hides the note).
States: loading (confirm disabled, `aria-busy`), empty (no reason chosen → inline alert, focus to select), error (API failure banner), offline (banner, confirm disabled).

**Divergences from the issue text, deliberate:**
- `ride_offers.responded_at` does not exist today (issue implies it does); this ticket adds it.
- The issue's breadboard ends with "board row shows `cancelled_by_dispatcher`"; the board shows live rides only, so the row leaves the board. Level 4 step 6 reads the event row instead.
- `DELETE /vehicles/:id` is two routes (`/drivers/me/vehicles/:id`, `/admin/vehicles/:id`); both go, both get a retire route, and the admin UI shipped in #312 switches to it.
- The issue's "existing specs keep passing" covers `rides`/`drivers` fixtures. Three `ride_offers` fixtures and nine vehicle-delete specs must be rewritten — those edits are what the ticket forbids.

**Parallel-ticket risk.** #317 (cash removal) is in the same wave and also adds a migration; whichever merges second regenerates its migration (epic #315 note). Do not hand-renumber. If #317 merges first: delete this branch's 0017/0018 SQL, snapshots and journal entries, re-run `pnpm --filter @taxi/db generate` for the schema migration, then `drizzle-kit generate --custom --name protected_records` and paste the 0018 SQL back in — drizzle cannot regenerate a hand-written file.

**#317 status (`observed` 2026-11-26):** `gh pr list --state open` returns none and there is no remote branch for #317, so no competing migration exists yet. Before Task 6, run `git fetch && ls db/migrations` on the latest `main`. If the latest index is no longer 0016, the migration indices shift and nothing else changes.

**Risk register: what is left after the spikes**

| Id | Risk | Why it is not zero | Control in this plan |
|---|---|---|---|
| R1 | api integration specs (Tasks 17, 18, 20) have never run against this design | The planning machine has no Docker | Task 18 step (1) predicts exactly 3 red tests before the fix, and a different count stops the run. Mutation checks in Tasks 9 and 20 prove the tests can fail. |
| R2 | Postgres 16 behaves differently from PGlite's Postgres 19 | S1 ran on 19 | Every feature used exists in 16 (listed in S1). Task 9 re-runs the whole matrix on the real 16 image in the gate. |
| R3 | A unit-spec assertion pinning an old call shape is missed | Runtime failure, invisible to typecheck | Task 12 lists them by file with counts. The gate catches any remainder; it cannot slip through silently. |
| R4 | A shipped file passes 500 lines | prettier expansion is estimated | Derived budgets in Tasks 12 and 13 (worst case 487 and ~443), plus a named fallback extraction. `max-lines` fails lint if it happens. |
| R5 | Fake `Date` in Task 18 leaks into the second tick | `jest.useRealTimers()` missed on a throw | `tickAsOf` restores in `finally`. |
| R6 | A sweeper pass under a 30 s / 10 s earlier clock behaves differently | Derived from a grep of the clock comparisons, not run | The smallest offsets with margin; a re-grep step; a named revoke-and-copy fallback (Task 18). |

**Breakage scope check (`observed`, 2026-11-26).** Raw-SQL breakers: `grep -rniE "update ride_offers|delete from (rides|drivers|vehicles|ride_offers)|truncate"` over `services/api/test`, `services/api/scripts`, `db/tests`, `db/src` → no hits. Drizzle-builder breakers in `services/api/src`: the three `dispatch.integration.spec.ts` sites and the nine vehicle-delete specs listed in CONTEXT. Re-run both greps before Task 18 in case the base moved.

## AMENDMENTS

- 2026-11-26 — Second planning pass, run because Linards asked for the plan's risks to be addressed.
  - Ran spikes S1–S10 (worktree install, drizzle generate, eslint, PGlite triggers, express body parsing, Jest fake `Date`) and recorded the results at the top.
  - Recorded decisions D1–D4.
  - Fixed a planned bug: a bodiless decline would have answered 400 (S8), so the reason schemas now use `z.preprocess`.
  - Kept the `assignDriver` return type as `boolean`, which avoids mock churn.
  - Replaced the dispatch fixture rewrite with `tickAsOf`, so every assertion stays unchanged.
  - Listed the runtime-only unit-spec breakages.
  - Added the `select` focus-visible rule and the `ERROR_KEYS` entries.
  - Derived the file budgets.
  - Corrected the decline-crash claim: the sweeper does not recover that ride.
- 2026-11-26 — Implementation divergences (from `.claude/reports/protected-record-layer-316-report.md`), superseding the task text where they differ:
  - Task 12: `driverActor(id)` helper in `ride-events.repository.ts` collapses the driver actor literals; `CancelInput` lives in `ride-lifecycle.policy.ts`. A `system` cancel records `actor_id` null (`ride_events_actor_id_ck`).
  - Task 12/13: the creator actor reaches `rides.create` through `BookingsService.book(…, creatorKind)` and a `createdBy` field on the phone-path `caller`/`RideRider`; `RidesService.request` is unchanged and derives `{ kind: 'rider' }`.
  - Task 14: `logTransitionApplied` takes `{ reasonCode, reasonText }` (`TransitionReason`); `hasReason` reads the text only.
  - Task 16: the driver-path `VehiclesRepository.update` also filters `retired_at IS NULL`; `scripts/mint-tracked-ride.ts` comment reworded (plate unique among active cars).
  - Task 17: the "retired car never stamped" case lives in `ride-events.integration.spec.ts`, not `drivers.integration.spec.ts`; `ride-lifecycle.integration.spec.ts` cancel bodies reshaped (dispatcher sends `reasonCode`).
  - Task 20: the edge walk runs each edge in a rolled-back transaction (parallel sweeper isolation).
  - Task 24: admin label VALUES reworded to retire; keys keep `admin.vehicle.delete*`.
  - Validation: no DB-backed check has run yet (no Docker on the implementing machine) — see the report's run order.

- 2026-11-26 — PR #331 review fixes (`.claude/reports/pr-331-review-fixes.md`), superseding the task text where they differ:
  - Task 12 (controller line 512): the controller no longer computes `actor = role === 'admin' ? 'dispatcher' : role`. `CancelInput` has no `actor`; `lifecycleActorFor(eventActor)` in `ride-lifecycle.policy.ts` derives it (L4).
  - Task 12/13: `BookingsService.book`'s `creatorKind` is `ConsoleActorKind` (`'dispatcher' | 'admin'`), from `consoleActor` in the new `features/dispatch/console-actor.ts`, shared with `dispatch.controller.ts` (L3).
  - Task 22: the cancel dialog's note label uses the new key `console.cancel_note_required_label` and sets `aria-required` when a `*_other` code is picked (L2).
