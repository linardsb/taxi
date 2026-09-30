# Feature: Admin panel — driver approval + CRUD, platform-config editor, trips list + CSV (#20)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Fill the `/admin` route group in `apps/dispatch` (today a placeholder) with the three surfaces the 2026-08-07 re-slice kept:

1. **Driver approval + CRUD.** A new `drivers.approval_status` (`pending | approved | rejected`) gates going online. The admin reviews each self-registered driver and their vehicles, approves or rejects, edits profile fields (including the per-driver `commissionPctOverride`), and edits or deletes vehicles. Vehicle `category` (standard/vip/limo, which sets the pricing tier) becomes admin-only.
2. **Platform-config editor** over the existing `platform_config` row for `DEFAULT_CITY_ID`: commission %, the two guarantee placeholders, driver debt limit, dispatch mode, offer timeout, unclaimed-alert threshold, dispatch phone. No cache exists, so a saved commission is read by the next `POST /rides`.
3. **Trips list with CSV export**, date-filtered in `Europe/Riga`, keyset-paginated, rider phone masked.

Ships as **four PRs from one plan**. Linards chose one plan with three PRs (2026-09-30) on a ~500-900-lines-per-PR estimate. Re-deriving the size put the approval PR at ~2,400 lines, so it is split at its natural seam (api vs web). No new issues are opened; every PR references #20.

| PR | Branch | Tasks | Depends on | Size, `derived` (diff lines incl. tests; each term a guess from the task list) |
|---|---|---|---|---|
| 1 approval api | `feature/admin-approval-api-20` | A0.1–A0.5, A0.9, A.1–A.11, A.13, A.14 | `origin/main` | shared ~200 + migration ~15 + admin slice ~450 + spec ~400 + accept/filter/force-assign ~60 + fixtures ~60 + driver app ~100 ≈ 1,285 (about half is tests) |
| 2 drivers UI | `feature/admin-drivers-ui-20` | A0.6–A0.8, A.12, A.15 | PR 1 merged | shell ~200 + drivers UI ~600 + tests ~350 ≈ 1,150 |
| 3 config editor | `feature/admin-config-20` | B.1–B.6 | PR 2 merged (admin shell) | ~700 |
| 4 trips + CSV | `feature/admin-trips-20` | C.1–C.8 | PR 2 merged | ~1,000 |

PR 1 is testable on its own through A.11 and curl, and has no web code. PR 3 and PR 4 are independent of each other. Whichever of them merges **last** carries `Closes #20`: add it once the other has merged, or close #20 by hand. The others say "Part of #20 (n of 4)".

## User Story

As the platform admin (Linards, then Atis)
I want to approve drivers before their first shift, change the platform's commercial settings, and pull a list of trips
So that no unvetted driver or self-promoted limo reaches a rider, commission is changed without a deploy, and trip data can be reconciled in a spreadsheet.

## Problem Statement

- Any phone number that signs up as `driver` and adds a car can go online and receive rides today. Nothing reviews them (`drivers.repository.ts:340` comment: "There is no approval flag to filter on yet — driver onboarding review is #20's").
- A driver self-declares `vip`/`limo` and so bills riders at a higher tier (`drivers/index.ts:10-13`).
- `platform_config` has no write path (`platform-config/index.ts:11-12`); changing commission means editing the DB by hand.
- There is no rides list, pagination or CSV anywhere in the api.

## Solution Statement

- **Approval** lives on the `drivers` row and is enforced in four places: inside `setOnlineIfEligible`'s single UPDATE (the gate), in `candidate-filter.ts`, in the offer-accept transaction (an offline driver can still accept an offer already on their screen — `dispatch.service.ts:209-215`), and in force-assign plus the roster picker. Revocation and accept serialise on a `SELECT … FOR UPDATE` of the `drivers` row. Revoking an `online` driver takes them offline; revoking while `on_ride` or holding an active ride is refused (409 `driver_on_ride`), matching `vehicles.service.ts:89-90`.
- **Admin routes** are `@Roles('admin')` only and live in the slice that owns the table, under an `admin/` subfolder, so repositories stay slice-private: `drivers/admin/*` (`/admin/drivers`, `/admin/vehicles`), `platform-config/platform-config.controller.ts` (`/admin/platform-config`), `rides/admin/*` (`/admin/trips`).
- **Web**: `app/admin/{drivers,config,trips}/page.tsx` thin pages over three new slices `features/admin-drivers`, `features/admin-config`, `features/admin-trips`, plus `features/admin-shell` (nav + `adminFetch`).
- **Strings**: new `i18n/{lv,ru,en}-admin.ts` catalog parts spread into each catalog, like `lv-rider.ts` (`lv.ts:1,413`), so no catalog file approaches the 500-line cap.

## Out of Scope / Non-Goals

- **Loyalty tiers** — no data model exists; #27 owns it and adds its field to this editor (Linards, 2026-09-30).
- **Guarantee-credit mechanics** — the editor sets the two existing nullable `*_guarantee_cents` columns; nothing pays them.
- **Document / photo upload** for driver review. Deferred; add a line to #64 (admin post-pilot backlog) — do not open a new issue. Update the `drivers.photoUrl` comment (`db/src/schema/drivers.ts:29`) so it stops saying "upload pipeline is #20's".
- **Admin-created drivers.** Drivers self-register (`SIGNUP_ROLES`, `packages/shared/src/schemas/auth.ts:10`). "Delete a driver" = reject (rides hold FKs).
- **Stats dashboards** (Metabase later), **support inbox**, **legal pages**, **admin audit log** (all #64).
- **Multi-city.** Every admin config read/write targets `env.DEFAULT_CITY_ID`; the client never sends a city id.
- **Optimistic concurrency on config** (one admin; last write wins). Logged under Open Questions.
- **Addresses in the trips list/CSV** — `rides.request` holds pickup/destination; not exported.
- Not changing: `resolveCommissionPct()`, `PlatformConfigService.forCity` (stays uncached), the settlement path.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (three surfaces, one migration touching the go-online gate)
**Primary Systems Affected**: `db` (schema + 2 migrations), `packages/shared` (enums, schemas, i18n), `services/api` (drivers, dispatch, platform-config, rides), `apps/dispatch` (`/admin`), `apps/driver` (one error code, category no longer sent)
**Dependencies**: none new

## Related Work

**Implements**: #20 · **Epic**: #1 · architecture `docs/epics/sakta-cab.architecture.md` L27 (commission config read at quote time), L30 (`platform_config`), L39 (one web app, role-gated route groups), L41 (admin minimal bespoke)

**Back-references**:

- `.claude/plans/driver-app-auth-online-location.md` — Why: built `setOnlineIfEligible` and the `vehicle_required` banner this plan extends.
- `.claude/plans/dispatch-override-phone-orders-zones.md` — Why: force-assign + roster picker (#19) that gain the approval check.
- `.claude/plans/dispatch-console-live-board.md` — Why: console auth, `RequireRole`, session model reused by `/admin`.

**Forward-references**:

- #27 (loyalty tiers) adds its field to `features/admin-config` and `platformConfigUpdateSchema`.
- #14 (driver onboarding, OPEN): its approval leg completes here. **Do not write a closing keyword next to #14** in any PR body (memory: prose near `#N` has closed issues before).

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

Backend
- `db/src/schema/drivers.ts` (14-44) — table gaining `approval_status`.
- `db/src/schema/enums.ts` (21-22) — how pg enums derive from `@taxi/shared` enums.
- `db/src/schema/rides.ts` (33-141; indexes 133-139) — CSV columns; gains `rides_created_at_id_idx`.
- `db/migrations/0013_concerned_wiccan.sql` + `db/migrations/meta/_journal.json` — latest migration; `--> statement-breakpoint` convention.
- `db/migrations/0003_updated_at_trigger.sql` (26-29) — `platform_config.updated_at` is trigger-owned; do not set it in the UPDATE.
- `db/src/seed/riga.ts` (170-184) — `platform_config` upsert whose conflict `set` re-asserts `commissionPct`/`driverDebtLimitCents`.
- `services/api/src/features/drivers/drivers.repository.ts` — `DriverMatchAttributes` (21-38), `setOnlineIfEligible` (176-212), `claimForRide`/`releaseFromRide` (280-301), `findRosterContacts` (~340-360), `findMatchAttributes` (379-415). 417 lines now.
- `services/api/src/features/drivers/drivers.service.ts` — `setPresence` (155-230), the refusal message pick at 200-212. **470 lines: nothing but the new branch goes here.**
- `services/api/src/features/drivers/vehicles.service.ts` (40-100) — `plate_taken`, `vehicle_not_found`, the `driver_on_ride` refusal and remove-last-vehicle-goes-offline logic that admin delete reuses.
- `services/api/src/features/drivers/vehicles.repository.ts` (43, 67-73, 96) — line 96's `patch.category` branch dies.
- `services/api/src/features/drivers/drivers.controller.ts` (25-33) — comment naming `/admin/drivers` as the home for admin reads.
- `services/api/src/features/drivers/index.ts` (9-13) — KNOWN GAPS entry on category that this plan closes.
- `services/api/src/features/dispatch/strategies/candidate-filter.ts` (14-58).
- `services/api/src/features/dispatch/force-assign.service.ts` (64) — reads `driverAttrs`.
- `services/api/src/features/platform-config/*` — repository (20-34), service (10-11: "do not add a cache"), module (not `@Global`, exports service only).
- `services/api/src/features/pricing/pricing.service.ts` (40, 60, 100-102) — config read per quote.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` (165-205) — settlement uses the **accepted offer's** split, so a config edit never changes an accepted ride.
- `services/api/src/features/customers/customers.controller.ts` (50-90) — controller shape: per-route `@Roles`, `ZodValidationPipe`, `@CurrentUser()`.
- `services/api/src/features/drivers/vehicles.controller.ts` (25, 50) — `:id` validated with `new ZodValidationPipe(z.string().uuid())`.
- `services/api/src/features/auth/guards/roles.guard.ts` (15-39) — `insufficient_role` 403; `auth/phone-mask.ts` — `maskPhone` (exported from `auth/index.ts:13`).
- `services/api/src/app.module.ts` (29-60) — module registration.
- `services/api/scripts/provision-dispatcher.ts` + `services/api/package.json:17`.
- `services/api/scripts/mint-tracked-ride.ts` (565-573, 800) — dev script that must approve its driver.
- Specs: `rides/rides.integration.spec.ts` (114-160: `signIn`, `rider`, `POST /rides`, `split.commissionPct` = 15), `customers/customers.integration.spec.ts` (36-47: `AuthTokenService.issue` tokens), `drivers/drivers.integration.spec.ts` (55 `driver(n)`, 328/342 status PUTs), `test/harness.ts` (496 `createTestApp`, 689 `phoneFor`, 694 `insertUser`).

Shared
- `packages/shared/src/enums.ts` (1 `USER_ROLES`, 44 `DRIVER_STATUSES`).
- `packages/shared/src/schemas/driver.ts` (10 `driverProfileSchema`, 43 update, 58 `driverMeSchema`), `vehicle.ts` (10, 17-20, 26-33), `platform-config.ts` (10-51), `ride.ts` (484 `rideCreatedSchema`), `money.ts` (31 `commissionPctSchema`, 52 `formatEur`).
- `packages/shared/src/i18n.ts` (22-26), `i18n/lv.ts` (1, 413, 421), `i18n/lv-rider.ts`, `tests/i18n.test.ts` (placeholder parity).

Web (`apps/dispatch/src/`)
- `app/admin/layout.tsx` (1-23), `app/admin/page.tsx`, `app/dispatch/layout.tsx` (20-31: focus CSS incl. `textarea`).
- `features/auth/{session.ts,require-role.tsx,api-url.ts,index.ts}`; `features/auth/login-form.tsx:81-89` (always `router.push('/dispatch')`).
- `features/phone-orders/booking-api.ts` (30-98) — `AuthExpiredError`, `ApiError`, `authedFetch` template.
- `features/override/use-assign.ts` (23-32, 106-140) — `Outcome`, `errorCodeOf`, in-flight guard; `features/override/assign-state.ts` (`assignErrorKey`).
- `features/override/dialog-shell.tsx` (53-56 focus restore; first-control selector lacks `select`).
- `features/phone-orders/booking-form.tsx` (140-154: fieldset/legend, `minHeight: 44`).
- Tests: `features/phone-orders/booking-form.test.tsx` (23-40: `vi.hoisted` api mock, `next/navigation` mock), `features/override/use-assign.test.tsx` (8-60: seeded session + `vi.stubGlobal('fetch')`).

Driver app
- `apps/driver/src/features/availability/presence-state.ts` (9, 380-390), `home-screen.tsx` (196-199), `onboarding/vehicle-screen.tsx` (32, 73) + its test (94, 98-128, 172).

### New Files to Create

PR 1 (Phase 0 + A)
- `db/migrations/0014_<generated>.sql` — enum + column + backfill.
- `packages/shared/src/schemas/admin-drivers.ts` — `adminDriverSummarySchema`, `adminDriverDetailSchema`, `adminDriverUpdateSchema`, `driverApprovalUpdateSchema`, `adminVehicleUpdateSchema`.
- `packages/shared/src/i18n/{lv,ru,en}-admin.ts` — admin catalog parts.
- `services/api/src/features/drivers/admin/admin-drivers.controller.ts`, `admin-vehicles.controller.ts`, `admin-drivers.service.ts`, `admin-drivers.repository.ts`, `admin-drivers.service.spec.ts`, `admin-drivers.integration.spec.ts`.
- `services/api/scripts/provision-staff.ts` (git mv of `provision-dispatcher.ts`).
- `apps/dispatch/src/features/admin-shell/{index.ts,admin-api.ts,admin-nav.tsx,admin-api.test.ts}`.
- `apps/dispatch/src/features/admin-drivers/{index.ts,drivers-api.ts,use-drivers.ts,driver-list.tsx,driver-detail.tsx,vehicle-editor.tsx,approval-labels.ts,*.test.tsx}`.
- `apps/dispatch/src/app/admin/drivers/page.tsx`.

PR 2 (Phase B)
- `services/api/src/features/platform-config/platform-config.controller.ts`, `platform-config.integration.spec.ts`.
- `apps/dispatch/src/features/admin-config/{index.ts,config-api.ts,eur-input.ts,eur-input.test.ts,config-form.tsx,use-config-form.ts,config-form.test.tsx}`.
- `apps/dispatch/src/app/admin/config/page.tsx`.

PR 3 (Phase C)
- `db/migrations/0015_<generated>.sql` — `rides_created_at_id_idx`.
- `packages/shared/src/schemas/admin-trips.ts` — query, row, page schemas, `ADMIN_TRIP_CSV_COLUMNS`.
- `services/api/src/features/rides/admin/{admin-trips.controller.ts,admin-trips.service.ts,admin-trips.repository.ts,trips-csv.ts,trips-csv.spec.ts,riga-range.ts,riga-range.spec.ts,admin-trips.integration.spec.ts}`.
- `apps/dispatch/src/features/admin-trips/{index.ts,trips-api.ts,use-trips.ts,trips-table.tsx,download.ts,*.test.tsx}`.
- `apps/dispatch/src/app/admin/trips/page.tsx`.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `apps/dispatch/AGENTS.md`: Next 16.3.4 differs from training data — read `/Users/Berzins/Desktop/taxi/node_modules/next/dist/docs/01-app/` (the path AGENTS.md names under `apps/dispatch` does not exist; docs are at the repo root `node_modules`). Specifically: `useSearchParams` needs a `<Suspense>` boundary in a client page; check the current guidance before using it.
- NestJS `StreamableFile` / `@Header()` — https://docs.nestjs.com/techniques/streaming-files — for the CSV response (`Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment`).
- OWASP CSV Injection — https://owasp.org/www-community/attacks/CSV_Injection — cells beginning `= + - @ \t \r` get a leading `'`.
- RFC 4180 §2 — quoting rules (fields with `,`, `"`, CR/LF quoted; `"` doubled).
- PostgreSQL `AT TIME ZONE` — https://www.postgresql.org/docs/16/functions-datetime.html#FUNCTIONS-DATETIME-ZONECONVERT
- `.claude/references/logging-standard.md` — event names `domain.component.action_state`; never full phones.
- `.claude/references/ride-state-machine.md` — trips list is read-only; no `assertTransition` involvement.

### Patterns to Follow

**Controller** (from `customers.controller.ts:50-90`):

```ts
@Controller('admin/drivers')
export class AdminDriversController {
  constructor(private readonly admin: AdminDriversService) {}

  @Get()
  @Roles('admin')
  list(@Query(new ZodValidationPipe(adminDriverListQuerySchema)) q: AdminDriverListQuery) { … }
}
```
Per-route `@Roles('admin')` on every handler (not class-level) matches the house style; `RolesGuard` uses `getAllAndOverride` so either works — pick per-route for grep-ability.

**Refusal codes**: `ConflictException('snake_case_code')`, `NotFoundException('vehicle_not_found')`; the web reads `.message` via `apiErrorBodySchema`.

**Logging** (`drivers.service.ts:222-228`):
```ts
this.logger.log({ event: 'driver.approval.status_changed', driverId, actorId: user.sub, from, to, at: new Date().toISOString() });
```
Admin config edits: no existing domain fits, so PR 2 adds `admin` to the domain list in `logging-standard.md` (one-line doc edit) and logs `admin.platform_config.updated` with the changed field names and old/new values. `dispatchPhone` is a business number, masked anyway for consistency with the phone rule.

**Web fetch**: lift `booking-api.ts:73-98`'s `authedFetch` shape into `features/admin-shell/admin-api.ts` as `adminFetch(path, init)` + `adminFetchBlob(path)`. Do **not** refactor the existing four hand-rolled copies (surgical rule).

**Strings**: `formatMessage(LANG, key)` with `const LANG: Language = 'lv'` (`app/dispatch/page.tsx:35`). Enum→label maps are compile-pinned `Record<Enum, MessageKey>`.

**Styling**: inline `style={{}}` with `var(--spacing-*)`, `var(--color-*)`, `var(--radius-md)`, `var(--font-size-*)`; `minHeight: 44` on every control; errors `role="alert"`, loading `role="status"`.

---

## IMPLEMENTATION PLAN

### Phase 0: Shared foundation (PR 1: A0.1–A0.5, A0.9 · PR 2: A0.6–A0.8)

Enum, approval schemas, admin catalog parts, admin provisioning (PR 1); `adminFetch`, admin nav, login redirect by role (PR 2).

### Phase A: Driver approval + CRUD (PR 1: A.1–A.11, A.13 · PR 2: A.12)

**Depends on:** Phase 0.
Migration, gate, candidate filter, accept check, force-assign + roster, admin drivers/vehicles API, category admin-only (shared + api + driver app), fixtures, mint script, runbook (PR 1); `/admin/drivers` UI (PR 2).

### Phase B: Platform-config editor (PR 3)

**Depends on:** PR 2 (admin shell, `adminFetch`). **Independent of:** Phase C.

### Phase C: Trips list + CSV (PR 4)

**Depends on:** PR 2. **Independent of:** Phase B.

B and C can run in parallel worktrees after PR 2 merges. Both append to `{lv,ru,en}-admin.ts` and `admin-nav.tsx`, so expect a trivial conflict on whichever merges second (memory: parallel PRs share files). Probe with `git merge-tree --write-tree` before claiming independence.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

Before starting each PR:
1. `git reflog -8` and `ps aux | grep -E "jest|vitest|turbo"`. If another session is live, work in a worktree with `COMPOSE_PROJECT_NAME=taxi` and a copied `.env` (memories: concurrent sessions, worktree `.env` → Redis hang).
2. Branch off `origin/main`, per the PR table above.
3. Rebuild before testing: `pnpm install && pnpm --filter @taxi/shared build && pnpm --filter @taxi/db build`. **Observed 2026-09-30:** skipping this after a pull ran the api against a stale shared `dist` and failed 247 of 928 tests with `readDisplayName is not a function`. That was an environment failure, not a code one.
4. Record the api baseline on the branch point. **Observed baseline** at `0f0897e`, 2026-09-30T12:09Z: `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test` gave `Tests: 1 failed, 976 passed, 977 total` and `Test Suites: 1 failed, 92 passed, 93 total`. The one failure is `payments.integration.spec.ts:614`, and the same spec run alone passed `10 passed, 10 total` twice. That is the known full-run flake (memory: gate hangs/flakes on a red api suite). A later main moves these numbers, so re-observe on your own branch point and compare against that run.

### Phase 0 tasks (PR 1 except A0.6–A0.8, which are PR 2)

#### A0.1 ADD `DRIVER_APPROVAL_STATUSES` to `packages/shared/src/enums.ts`

- **IMPLEMENT**: `export const DRIVER_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const; export type DriverApprovalStatus = (typeof DRIVER_APPROVAL_STATUSES)[number];` next to `DRIVER_STATUSES` (44). Docblock: approval is a vetting state, orthogonal to presence; only `approved` may go online or be offered/assigned.
- **PATTERN**: `enums.ts:44`.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC A2

#### A0.2 UPDATE `packages/shared/src/schemas/driver.ts` — expose approval on the profile

- **IMPLEMENT**: add `approvalStatus: z.enum(DRIVER_APPROVAL_STATUSES)` to `driverProfileSchema` (10). Required, no default — every producer (`toProfile`) must read the column.
- **GOTCHA**: `driverProfileSchema` is consumed by the driver app (`use-me.tsx`). A required field means the driver app's test fixtures building a profile gain it; typecheck finds them. Do not add UI for it in the driver app beyond A.13.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC A2

#### A0.3 UPDATE `packages/shared/src/schemas/vehicle.ts` — category admin-only

- **IMPLEMENT**: `vehicleCreateSchema = vehicleSchema.omit({ id: true, driverId: true, category: true })` (17); `vehicleUpdateSchema` inherits. Rewrite the stale comment at 26-29. `vehicleSchema` (read shape) keeps `category`.
- **GOTCHA**: the schemas are plain `z.object` → an old driver app still sending `category` is **stripped silently**, not rejected (scout, `vehicle.ts`). That is the desired compatibility for already-installed APKs. Do not add `.strict()`.
- **GOTCHA**: `packages/shared/tests/driver.test.ts:153` asserts create parses `category` to `'standard'` — it becomes "create output has no `category` key". `:184` (update leaves `category` undefined, comment at `:180`) stays true and needs only its comment updated. `:196-218` (`vehicle()` helper, `vehicles[1].category === 'vip'`) reads `vehicleSchema` and is unaffected.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC A6

#### A0.4 CREATE `packages/shared/src/schemas/admin-drivers.ts` + export from `schemas` index

- **IMPLEMENT**:
  - `adminDriverListQuerySchema = z.object({ approval: z.enum(DRIVER_APPROVAL_STATUSES).optional() })`.
  - `adminDriverSummarySchema`: `userId`, `displayName: string | null`, `phone` (full — admin-only surface, needed to call the driver), `approvalStatus`, `status` (`DriverStatus`), `createdAt` (from `users.created_at`, `z.coerce.date()`), `vehicles: { plate, category }[]`.
  - `adminDriverDetailSchema = adminDriverSummarySchema.extend({ profile: driverProfileSchema, vehicles: z.array(vehicleSchema) })` (detail has full vehicles).
  - `adminDriverUpdateSchema = driverProfileUpdateFieldsSchema.extend({ displayName: displayNameSchema.optional(), commissionPctOverride: commissionPctSchema.nullable().optional() }).refine(nonEmpty)`. **`driverProfileUpdateSchema` (`driver.ts:43-48`) is already `.refine()`d, i.e. a `ZodEffects` with no `.shape`/`.extend` in zod 3** — so first split it in `driver.ts` into an exported unrefined `driverProfileUpdateFieldsSchema` (`z.object({ spokenLanguages, isFemale })`) and `driverProfileUpdateSchema = driverProfileUpdateFieldsSchema.refine(...)`; update its docblock ("a leaf request schema nothing derives from"). `displayNameSchema` is exported from `schemas/user.ts:29-34` (trim, 1..`DISPLAY_NAME_MAX`, no control characters) — verified 2026-09-30; zod is 3.25.76 (hoisted), where `.refine`/`.superRefine` return `ZodEffects` with no `.extend` (`node_modules/zod/v3/types.d.ts`).
  - `driverApprovalUpdateSchema = z.object({ status: z.enum(DRIVER_APPROVAL_STATUSES) })`.
  - `adminVehicleUpdateSchema = vehicleSchema.omit({ id: true, driverId: true }).partial().refine(nonEmpty)` — includes `category`.
- **PATTERN**: `vehicleUpdateSchema`'s empty-update `.refine` in `vehicle.ts`.
- **GOTCHA**: `commissionPctOverride: null` is meaningful ("clear the override, use platform base") and must be distinguishable from absent — `.nullable().optional()`, and the repository sets the column only when `!== undefined`.
- **VALIDATE**: `pnpm --filter @taxi/shared test` with a new `packages/shared/tests/admin-drivers.test.ts`: empty update rejected (failure), `{commissionPctOverride: null}` accepted and preserved (edge), `{category:'limo'}` on `adminVehicleUpdateSchema` accepted (expected).
- **SATISFIES**: AC A4, A6

#### A0.5 CREATE admin catalog parts `packages/shared/src/i18n/{lv,ru,en}-admin.ts`

- **IMPLEMENT**: `export const lvAdmin = { 'admin.nav.drivers': 'Vadītāji', … } as const;` then `...lvAdmin` in `lv.ts` (like `lvRider` at 1/413); `ruAdmin`/`enAdmin` spread in `ru.ts`/`en.ts`. Keys prefixed `admin.`. PR 1 keys: nav (drivers, config, trips), approval labels (3), approval actions (approve, reject, return to pending), driver list headings/empty/error, detail field labels, vehicle editor labels, `admin.error.driver_on_ride`, `admin.error.plate_taken`, `admin.error.vehicle_not_found`, `admin.error.generic`, `admin.saved`. Also `driver.error.driver_not_approved` (driver app, A.13 and A.4b) and `console.error.driver_not_approved` (force-assign, A.4) go in the **main** catalogs next to their siblings.
- **GOTCHA**: headroom, `derived`: `ru.ts` is 436 lines (observed `wc -l` at `0f0897e`); +1 import +1 spread +2 keys = 440 < 500. Putting ~40 admin keys inline would push `ru.ts` to ~476 by PR 2 and over the cap by PR 4 (derived: 436 + ~40 one-line keys, then PR 3+4 add ~50 more). Hence the split files.
- **GOTCHA**: `tests/i18n.test.ts` checks placeholder parity across languages — every `{name}` in LV must exist in RU/EN.
- **GOTCHA**: RU/EN wording can be plain; log copy questions to `.claude/references/ui-decisions.md`, do not debate them.
- **VALIDATE**: `pnpm --filter @taxi/shared test && pnpm --filter @taxi/shared build`
- **SATISFIES**: hard rule "nothing user-facing hardcoded"

#### A0.6 CREATE `apps/dispatch/src/features/admin-shell/admin-api.ts`

- **IMPLEMENT**: `adminFetch<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T>` and `adminFetchBlob(path): Promise<Blob>`. Shape copied from `booking-api.ts:73-98`: load session, throw `AdminAuthExpiredError` on null/401/403, `AdminApiError(code)` on other non-ok (code via `apiErrorBodySchema`), `cache: 'no-store'`, bearer header, JSON body with `content-type` when `init.body` is set.
- **GOTCHA (CORS, verified 2026-09-30)**: the browser calls the api cross-origin (`NEXT_PUBLIC_API_URL`).
  - `services/api/src/main.ts:12` is `enableCors({ origin: env.CORS_ORIGINS })`. `CORS_ORIGINS` defaults to `http://localhost:3000,http://localhost:3002` (`common/config/env.schema.ts:333`), so the dev console on :3000 is allowed.
  - Installed `cors` 2.8.6 defaults `methods` to `GET,HEAD,PUT,PATCH,POST,DELETE` (`node_modules/cors/lib/index.js:10`), and `content-type` + `authorization` are reflected as allowed headers. PUT, PATCH and DELETE therefore need no config change.
  - No `exposedHeaders` is set, so `Content-Disposition` is unreadable from JS and the caller names the file (C.7).
  - jsdom and supertest never exercise CORS. Level 4 §A step 4 (a PUT from the browser) is the check, and a CORS error there shows in the browser console as "blocked by CORS policy".
- **GOTCHA**: define the two error classes here, do not import from `phone-orders/booking-api.ts` (cross-slice import).
- **GOTCHA**: 403 here means "not an admin" (a dispatcher session). Treat as auth-expired → `clearSession()` + `/login`, same as `use-assign.ts:68-71`.
- **VALIDATE**: `npx vitest run --root apps/dispatch src/features/admin-shell/admin-api.test.ts` — 200 parses (expected), empty body → `null` path (edge), 401 → `AdminAuthExpiredError`, 409 `{message:'plate_taken'}` → `AdminApiError('plate_taken')` (failure).
- **SATISFIES**: AC A3 (UI half)

#### A0.7 CREATE `features/admin-shell/admin-nav.tsx`; UPDATE `app/admin/layout.tsx`, `app/admin/page.tsx`

- **IMPLEMENT**: `<nav aria-label>` with `next/link` links (PR 1: Drivers only; PR 2/3 append Config/Trips) and a logout button (`clearSession()` + `router.replace('/login')`). Layout: add `select` and `textarea` to the focus-visible selector (`layout.tsx:14-15`), render `<AdminNav/>` above `children` inside `<main className="console">`. `app/admin/page.tsx`: `router.replace('/admin/drivers')` in an effect, render `console.loading` meanwhile (no placeholder string). Remove `console.admin_placeholder` from `lv.ts:118`, `ru.ts:93`, `en.ts:89` — its only use is `app/admin/page.tsx:21` (verified 2026-09-30).
- **GOTCHA**: `react-hooks/set-state-in-effect`, `refs`, `purity`, `immutability` are all **error** level (`eslint-plugin-react-hooks` 7.1.1, observed via `npx eslint --print-config`). `router.replace` in an effect is fine; no `setState` in an effect body.
- **GOTCHA**: `aria-current="page"` on the active link via `usePathname()`.
- **VALIDATE**: `pnpm --filter @taxi/dispatch lint typecheck`
- **SATISFIES**: UX

#### A0.8 UPDATE `features/auth/login-form.tsx:89` — land by role

- **IMPLEMENT**: `router.push(session.user.role === 'admin' ? '/admin' : '/dispatch')`. An admin can still open `/dispatch` (its `RequireRole` allows admin, `app/dispatch/layout.tsx:31`).
- **VALIDATE**: `npx vitest run --root apps/dispatch src/features/auth/login-form.test.tsx`. The existing assertion at `:80` (`push` called with `/dispatch`) uses a dispatcher session and must stay green; add a copy with `role: 'admin'` asserting `/admin` (expected). `:129` (`push` not called for a rider) is unchanged.
- **SATISFIES**: friction audit (admin lands on the admin panel: 0 extra taps)

#### A0.9 RENAME `services/api/scripts/provision-dispatcher.ts` → `provision-staff.ts`; UPDATE `services/api/package.json`

- **IMPLEMENT**: first argv is the role: `const [roleArg, phoneArg, nameArg] = process.argv.slice(2)`; `z.enum(['dispatcher','admin']).parse(roleArg)`. Scripts: `"provision:dispatcher": "node -r ts-node/register -r tsconfig-paths/register scripts/provision-staff.ts dispatcher"`, `"provision:admin": "… scripts/provision-staff.ts admin"`. Existing usage `pnpm --filter @taxi/api provision:dispatcher +371… [name]` is unchanged. Upsert sets `role` to the parsed role.
- **GOTCHA**: `git mv` so history follows. Update the usage string and the header comment. Grep `docs/` and `apps/dispatch/CLAUDE.md` for `provision-dispatcher.ts` (file name, not script name) and fix any hit. Add one line to `apps/dispatch/CLAUDE.md`'s auth section: admins are provisioned with `provision:admin`.
- **GOTCHA**: an admin phone that already exists as a `driver` would be silently re-roled by the upsert. Keep the existing behaviour (the dispatcher script already does this) but print the previous role when it changes.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api provision:admin +37120000009 "Admin Test"` against the dev DB → prints masked phone and role `admin`; then `psql … -c "select role from users where phone='+37120000009'"` → `admin`.
- **SATISFIES**: Level 4 prerequisite (admin user must exist)

### Phase A tasks (PR 1 except A.12, which is PR 2)

#### A.1 UPDATE `db/src/schema/enums.ts` + `db/src/schema/drivers.ts`; GENERATE migration 0014

- **IMPLEMENT**: `driverApprovalStatusEnum = pgEnum('driver_approval_status', DRIVER_APPROVAL_STATUSES)`; `approvalStatus: driverApprovalStatusEnum('approval_status').notNull().default('pending')` on `drivers`. Fix the `photoUrl` comment (29): "upload pipeline deferred (#64); null renders a placeholder". Run `pnpm --filter @taxi/db generate`, then **hand-append** to the generated SQL after a `--> statement-breakpoint`:
  ```sql
  -- Every driver that existed before #20 was already driving; stranding them
  -- offline at deploy would be an outage, not a safety gain. New rows default
  -- to 'pending'.
  UPDATE "drivers" SET "approval_status" = 'approved';
  ```
- **GOTCHA**: no prior migration contains a backfill (scout grep, 2026-09-30); the journal entry is written by `generate`, so editing the SQL body after generation is safe — do not touch `_journal.json` or the snapshot.
- **GOTCHA**: DB schema checklist — no unique index, no nullable-unique issue; `drivers` has no `updated_at`; approval queue read (`WHERE approval_status='pending'`) is over a table of tens of rows in the pilot — no index (`derived`: ≤ ~50 drivers at pilot per PRD ≥10-driver target ×5 headroom; seq scan is cheaper than an index there).
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/db migrate && psql "$DATABASE_URL" -c "\d drivers"` shows the column; `pnpm --filter @taxi/db test`.
- **SATISFIES**: AC A2

#### A.2 UPDATE `drivers.repository.ts` — gate, match attributes, roster, profile

- **IMPLEMENT**:
  - `toProfile` (82): add `approvalStatus: row.approvalStatus`.
  - `setOnlineIfEligible` (176-212): add `eq(drivers.approvalStatus, 'approved')` inside the same `and(...)`. Extend the docblock: approval is inside the WHERE for the same L8 reason as the vehicle check.
  - Add `approvalStatus(userId): Promise<DriverApprovalStatus | undefined>` (single-column select) for the refusal message pick.
  - `DriverMatchAttributes` (21-38): add `approvalStatus: DriverApprovalStatus`; populate in `findMatchAttributes` (393-402).
  - `findRosterContacts` (~355): add `.where(eq(drivers.approvalStatus, 'approved'))`; rewrite the "There is no approval flag to filter on yet" sentence.
- **GOTCHA**: file is 417 lines; these add ~20. Stay under 500 — anything admin-specific goes in `admin/admin-drivers.repository.ts` (A.5), not here.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck` (typecheck will list every `DriverMatchAttributes` factory: `candidate-filter.spec.ts:35-44`, `auto-match.strategy.spec.ts:41`, `geozone-queue.strategy.spec.ts:37`, `offer-builder.spec.ts:53`, `force-assign.service.spec.ts:58` — default each to `approvalStatus: 'approved'`, or every candidate test silently goes empty).
- **SATISFIES**: AC A2

#### A.3 UPDATE `drivers.service.ts:200-212` — third refusal code

- **IMPLEMENT**: when `setOnlineIfEligible` returns undefined, pick the message in this priority: active ride → `driver_on_ride`; approval ≠ approved → `driver_not_approved`; else `vehicle_required`. Keep it to ~4 lines (file is 470).
- **GOTCHA**: priority reasoning — an on-ride driver must be sent to the ride (existing #61 comment); an unapproved driver with no car must hear "not approved" first, because adding a car will not help them.
- **GOTCHA (existing test changes meaning)**: `drivers.integration.spec.ts:328` uses a fresh `driver(4)` with **no vehicle** and expects 409 `vehicle_required`. Under this priority, a fresh driver is `pending`, so the answer becomes `driver_not_approved`. Keep that test's intent: call `approveDriver` for `driver(4)` first, so it still proves `vehicle_required`. Add a sibling case where an unapproved driver with no car gets `driver_not_approved`, which pins the priority.
- **VALIDATE**: `pnpm --filter @taxi/api test -- drivers.service.spec` (add a unit case if the spec mocks the repository), then A.11's integration case.
- **SATISFIES**: AC A2

#### A.4 UPDATE `candidate-filter.ts` and `force-assign.service.ts`

- **IMPLEMENT**: candidate filter: `if (a.approvalStatus !== 'approved') continue;` directly after the `status` check (27), comment: defence in depth — unreachable today (go-online gate, and `setApproval` refuses revoking an on-ride driver); guards any path that writes `online` without the gate. (PR #309 L3: the original `releaseFromRide` reason cannot happen.) Force-assign, in two places. Early, after reading `driverAttrs` at `:64`, for a clear message: `if (driverAttrs.approvalStatus !== 'approved') throw new ConflictException('driver_not_approved');`. **And authoritatively inside the transaction** (`:91-139`), immediately before `claimDriver` at `:126`: `if (!(await this.drivers.lockApprovedForAssignment(driverId, tx))) throw new ConflictException('driver_not_approved');`. The `:64` check alone is check-then-act: a revocation committing between `:64` and the transaction would let an unapproved driver be force-assigned. The in-transaction lock uses the same rides→drivers position as A.4b, so it adds no new lock order. `lockApprovedForAssignment` is therefore named for both callers; call it `lockApprovedForAssignment`. Web: add `driver_not_approved` → `console.error.driver_not_approved` in `features/override/assign-state.ts` `assignErrorKey`.
- **GOTCHA**: the mid-ride case is real, not theoretical: A.6 refuses revocation while `on_ride`, but a driver in `on_ride` status is only one path — the filter covers any future path that writes `online` directly.
- **VALIDATE**: `pnpm --filter @taxi/api test -- candidate-filter force-assign` — new cases: pending driver excluded (edge), approved passes (expected); force-assign to pending → 409 at the early check (failure); force-assign where the early read says approved but `lockApprovedForAssignment` returns false (revoked in between) → 409 and `claimDriver` not called (failure — the race). `npx vitest run --root apps/dispatch src/features/override/assign-state.test.ts` for the key mapping.
- **SATISFIES**: AC A2

#### A.4b UPDATE `dispatch/dispatch.service.ts` `accept` (188-230) — refuse an unapproved accept

- **IMPLEMENT**: inside the accept transaction, **immediately before** `claimDriver` (`dispatch.service.ts:215`), i.e. after `assignDriver`: `if (!(await this.drivers.lockApprovedForAssignment(driverId, tx))) throw new ConflictException('driver_not_approved');` (via `DriversService`, the drivers slice's public API). The throw rolls back the whole transaction (offer, transition, assignment), so nothing is emitted: emits run only after the commit (`:219-226`).
- **GOTCHA (lock order, verified 2026-09-30)**: do **not** put the lock first in the transaction. Every existing transaction that writes `drivers` does so **after** `rides`:

  | Transaction | Order |
  |---|---|
  | accept | `acceptOffer` (offers) → `transitionInTx` → `assignDriver` (rides) → `claimDriver` (drivers) |
  | force-assign (`force-assign.service.ts:91-139`) | rides → offers → rides → `claimDriver` (drivers, `:126`) |
  | reassign (`reassign.service.ts:107-150`) | rides → `releaseFromRide` (drivers, `:127`) |
  | complete / cancel (`ride-lifecycle.service.ts:201-210`, `276-299`) | rides → `releaseFromRide` (drivers) |

  Locking `drivers` first in accept would create a drivers→rides vs rides→drivers pair. That deadlocks, for example, an accept by driver A against a force-assign of A. Placed just before `claimDriver`, the lock sits exactly where accept already takes the driver row lock (the claim's UPDATE), so no new ordering is introduced.
- **GOTCHA (why no deadlock with revocation)**: A.5's revocation transaction locks only the `drivers` row, and reads `rides` with a plain SELECT, which never waits on row locks. There is no cycle.
- **Serialisation**, under READ COMMITTED; Postgres re-reads the latest committed row version after a lock wait:
  - Revoke holds the lock first: accept blocks at `lockApprovedForAssignment`, then reads `rejected`, throws, and rolls back → 409 `driver_not_approved`.
  - Accept holds the lock first: revocation blocks on its `FOR UPDATE`. After accept commits, the revocation's fresh active-ride statement sees the assigned ride → 409 `driver_on_ride`.
- **GOTCHA**: why this is needed. `claimForRide` is conditional on `status='online'` and its `false` is "not an error" (`dispatch.service.ts:209-215`, `ride-lifecycle.service.ts:79-81`). Without the check, a driver revoked to `offline` while an offer sits on their screen accepts and drives the ride.
- **Driver app**: no code change. An accept error goes to `offer-state.ts:283-293` as an `'error'` banner, rendered by `offer-banner.ts:24-29` through `errorMessageKey(code)` (`i18n/error-key.ts:7`). That returns `driver.error.<code>` when the key exists, so adding `driver.error.driver_not_approved` (A0.5) is enough. Verified 2026-09-30.
- **VALIDATE**: A.11 case 10, plus a unit case in `dispatch.service.spec.ts` (if it mocks `DriversService`) asserting `lockApprovedForAssignment` → false throws `driver_not_approved` and `claimDriver` is not called.
- **SATISFIES**: AC A2

#### A.5 CREATE `drivers/admin/admin-drivers.repository.ts`

- **IMPLEMENT**:
  - `list(approval?)`: `drivers ⋈ users` left-join vehicles, aggregated to one row per driver (`array_agg` of `{plate, category}` or two queries merged in TS — pick the one that reads clearer), ordered `users.created_at desc`, `.limit(500)` with the `findRosterContacts` comment style explaining the ceiling (`derived`: 10× the PRD's ≥10-driver pilot target ×5).
  - `detail(userId)`: driver + user + vehicles.
  - `update(userId, patch)`: `drivers` columns (`spokenLanguages`, `isFemale`, `commissionPctOverride`) and `users.display_name` in one transaction.
  - `setApproval(userId, to)`: **one transaction, row-locked**:
    1. `select status, approvalStatus from drivers where user_id = $1 FOR UPDATE` (drizzle `.for('update')`) — none → `{ outcome: 'not_found' }`.
    2. If `to !== 'approved'`: `status === 'on_ride'` → `{ outcome: 'on_ride' }`; then a **separate statement** checking for an active ride (`ACTIVE_DRIVER_RIDE_STATUSES`, as `setOnlineIfEligible` uses) → `{ outcome: 'on_ride' }`. A separate statement under READ COMMITTED takes a fresh snapshot after the lock is held, so it sees a ride an accept committed while we waited.
    3. `update drivers set approval_status = $to, status = <new>` — `<new>` computed in TS from the locked read (`online` → `offline` when revoking, else unchanged); no SQL `CASE`.
    Return `{ outcome: 'ok', previousStatus, previousApproval }`. No read outside the lock (a read-then-UPDATE without it races a concurrent claim).
  - `lockApprovedForAssignment(driverId, tx)`: `select approvalStatus from drivers where user_id = $1 FOR UPDATE` inside the caller's tx → boolean. It lives in `drivers.repository.ts` (not the admin repository) because dispatch reaches it through `DriversService`; it adds ~12 lines to each file. Combined with A.3's ~4 lines, `drivers.service.ts` goes 470 + ~12 + ~4 ≈ 486 and `drivers.repository.ts` 417 + ~20 (A.2) + ~12 ≈ 449 (`derived`, guesses per task). Both stay under the 500-line cap, but `drivers.service.ts` has only ~14 lines to spare: keep the pass-through a one-line delegation with a two-line docblock, and let `max-lines` be the check. Drizzle 0.45.2 has `.for('update')` (`node_modules/drizzle-orm/pg-core/query-builders/select.d.ts:586`); the repo precedent is `ride-lifecycle.repository.ts:198`.
  - The `setApproval` transaction reads `rides` with plain SELECTs only and writes nothing but the `drivers` row. It must never lock a `rides` row: that is what keeps it free of cycles with A.4b and the lifecycle transactions.
  - `vehicleOwner(vehicleId)`, `updateVehicle(vehicleId, patch)` (includes `category`; unscoped by owner — admin).
- **GOTCHA**: plate uniqueness is `vehicles_plate_uix` on `upper(plate)` (`vehicles.ts:36`). `isPlateConflict` is already exported from `drivers/vehicles.repository.ts:20` (it walks `.cause` for the pg error). Import it from there.
- **VALIDATE**: covered by A.11.
- **SATISFIES**: AC A4, A5

#### A.6 CREATE `drivers/admin/admin-drivers.service.ts`

- **IMPLEMENT**:
  - `setApproval(actorId, userId, to)`: repository transaction first (it decides); `not_found` → `NotFoundException('driver_not_found')`; `on_ride` → `ConflictException('driver_on_ride')`. On `ok` with `to !== 'approved'`: always `locations.markOffline(DEFAULT_CITY_ID, userId)`. `locations` is the `DRIVER_LOCATION_STORE` injection (`@Inject(DRIVER_LOCATION_STORE) locations: DriverLocationStore`, as `drivers.service.ts:45` does); `markOffline(cityId, driverId)` is on the store interface at `location/driver-location.store.ts:50`, **not** on `DriverLocationService`. The call is idempotent, and it also drops a stale member for an already-offline row, as `markOfflineByServer` does at `drivers.service.ts:266-269`. Log `driver.approval.status_changed` `{driverId, actorId, from, to, forcedOffline: previousStatus === 'online'}`.
  - `update`, `detail`, `list`, `updateVehicle` (translate plate conflict → 409 `plate_taken`; missing → 404 `vehicle_not_found`), `removeVehicle(vehicleId)`: look up owner → delegate to `VehiclesService.remove(ownerId, vehicleId)` so the on-ride refusal and last-vehicle-goes-offline logic is reused, not copied.
- **GOTCHA**: order is **Postgres first, then Redis** — the opposite of `setPresence`'s offline branch. Reason: the conditional UPDATE is what decides whether this driver is `on_ride`; clearing Redis first for an `on_ride` driver would strand the ride's position feed (the exact case `markOfflineByServer` repairs at `drivers.service.ts:283-289`). A failure between the two leaves a Redis member whose Postgres row says `offline` + not approved, and `candidate-filter` rejects it on both counts (A.4) — so the failure still lands undispatchable. Put this reasoning in the docblock.
- **GOTCHA**: do **not** reuse `markOfflineByServer` — it stamps `offline_nudge_due_at` and the driver would get a "you've gone offline, come back" push after being rejected.
- **How the driver's app finds out** (path verified in source 2026-09-30):
  1. The app keeps no two fixes closer than 4 s: `MIN_FIX_INTERVAL_MS = 4_000` is a floor, not a period (`apps/driver/src/features/location/fix-throttle.ts:9`), and `timeInterval: 4000` is an Android floor too (`location-options.ts:18-21`).
  2. The next fix is refused. `DriverLocationService.ingest` returns `{accepted:false, reason:'not_online'}` (`driver-location.service.ts:57-70`) as the socket ack (`driver-location.gateway.ts:142`), because the Redis member is gone.
  3. `uploader.ts:102-105` calls `onServerOffline`, and `use-presence.tsx:250-251` dispatches `ack_not_online`.
  4. `presence-state.ts:315-327`: if the app has **not** re-asserted since going online, it emits `put_status online`. `use-presence.tsx:122-135` sends `PUT /drivers/me/status`, and the 409 flows back as `{type:'error', code}`. With A.13 the result is the `driver_not_approved` banner.
  5. If it **has** already re-asserted this session (`reasserted: true`, reset at `:126`, `:211`, `:376`), it flips offline with the `marked_offline` banner instead. The approval message then appears on the driver's next tap of the online toggle.
  - **Window, `derived`:** up to ~4 s at nominal cadence (the reject lands at a random point in one `MIN_FIX_INTERVAL_MS = 4_000` gap); ~8 s when one OS delivery lands just under that floor and is dropped; 12 s = 3 × 4 s tolerating one dropped delivery (the allowance derived in `docs/runbooks/driver-device-day.md:271-275`); plus the ack round trip and one `PUT` round trip. Not a hard bound: `timeInterval: 4000` is an Android floor and real delivery jitter is unmeasured. Assumes the app is producing fixes and the Redis member was cleared (PR #309 L1 closed the go-online race that could leave it). A phone that is producing no fixes is already undispatchable and finds out when it next goes online.
  - The dark sweep does **not** reach the app here: Postgres already says `offline`, so the sweep only drops the member.
  - No new offers arrive in the window (Postgres `offline` plus approval ≠ approved), and an offer already on screen is refused at accept (A.4b).
- **VALIDATE**: `pnpm --filter @taxi/api test -- admin-drivers.service.spec` — online driver rejected → `markOffline` called once (expected); offline driver rejected → not called (edge); `on_ride` → 409 and `markOffline` not called (failure).
- **SATISFIES**: AC A2, A4

#### A.7 CREATE `admin-drivers.controller.ts` + `admin-vehicles.controller.ts`; register in `drivers.module.ts`

- **IMPLEMENT** (`@Roles('admin')` on every handler):
  - `GET /admin/drivers?approval=` → `AdminDriverSummary[]`
  - `GET /admin/drivers/:id` → `AdminDriverDetail`
  - `PATCH /admin/drivers/:id` body `adminDriverUpdateSchema` → `AdminDriverDetail`
  - `PUT /admin/drivers/:id/approval` body `driverApprovalUpdateSchema` → `AdminDriverDetail`
  - `PATCH /admin/vehicles/:id` body `adminVehicleUpdateSchema` → `Vehicle`
  - `DELETE /admin/vehicles/:id` → `@HttpCode(204)`
  - `:id` via `new ZodValidationPipe(z.string().uuid())` (`vehicles.controller.ts:25`).
- **GOTCHA**: `drivers.module.ts` today (verified 2026-09-30) has imports `RealtimeModule` and `PushModule`; controllers `DriversController` and `VehiclesController`; providers including `VehiclesService`, `DriversService`, `DriverLocationService` and the `DRIVER_LOCATION_STORE` factory; exports `DriversService`, `DriverLocationService` and `DRIVER_LOCATION_STORE`. Add `AdminDriversController`, `AdminVehiclesController`, `AdminDriversService` and `AdminDriversRepository`. No new imports are needed, and `PlatformConfigModule` is not used here.
- **GOTCHA**: Nest matches in registration order. Keep `admin/drivers` on its own controller prefix (`@Controller('admin/drivers')`), so the `drivers.controller.ts:25-33` warning about `:id` shadowing `me` does not apply.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck lint`
- **SATISFIES**: AC A3, A4, A5

#### A.8 UPDATE `drivers/vehicles.repository.ts:96`, `drivers/index.ts:9-13`

- **IMPLEMENT**: remove the dead `patch.category` branch (typecheck flags it once `VehicleUpdate` lacks the key); replace the KNOWN GAPS category bullet with: "category is admin-set (`PATCH /admin/vehicles/:id`, #20); a driver-created vehicle starts `standard`". The column default is `'standard'` (`db/src/schema/vehicles.ts:25`, `.notNull().default('standard')`, verified 2026-09-30), so create's `{...input, driverId}` spread needs no change.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC A6

#### A.9 UPDATE test fixtures — approve drivers before they go online

- **IMPLEMENT**: add `approveDriver(db, userId)` to `services/api/test/harness.ts` next to `insertUser` (694), as an **upsert**: `db.insert(drivers).values({ userId, approvalStatus: 'approved' }).onConflictDoUpdate({ target: drivers.userId, set: { approvalStatus: 'approved' } })`. Because it upserts, it works whether or not the lazy `findOrCreate` row exists yet, so there is no call-order trap. `drivers.user_id` is the PK and FKs `users.id`; the user row exists after OTP sign-in.
- **Call sites** (line numbers verified 2026-09-30 at `0f0897e`). Add one call inside each helper, just before its status PUT:

  | Spec | Helper | Status PUT |
  |---|---|---|
  | `rides/lifecycle/ride-lifecycle.integration.spec.ts` | `onlineDriver` :143 | :162 |
  | `rides/lifecycle/ride-pickup-pin.integration.spec.ts` | `onlineDriver` :130 | :149 |
  | `rides/lifecycle/arrival-announce.integration.spec.ts` | `onlineDriver` :128 | :153 |
  | `rides/lifecycle/ride-read.integration.spec.ts` | `onlineDriver` :122 | :147 |
  | `payments/payments.integration.spec.ts` | `onlineDriver` :133 | :151 |
  | `notifications/tracking/tracking.integration.spec.ts` | `onlineDriver` :116 | :135 |
  | `dispatch/dispatch.integration.spec.ts` | `onlineDriver` :131 | :164 |
  | `drivers/presence/driver-presence.integration.spec.ts` | `driver` :61 | :99 (`setStatus` closure) |
  | `drivers/drivers.integration.spec.ts` | direct PUTs | :342 (`driver(5)` + `addCar`): add the call before the PUT. :328: see A.3's GOTCHA. |

  - The dispatch direct PUTs at 518, 927, 1102 and 1176 all use drivers made by `onlineDriver` (:513, :925, :1094, :1154), which are already approved, so they need no change.
  - `driver-presence.integration.spec.ts:373` uses a `driver()`-helper driver, so it needs no change.
  - An exhaustive grep for `/drivers/me/status` in `services/api` found no other caller, apart from `scripts/mint-tracked-ride.ts` (A.10) and comment-only mentions.
- **IMPLEMENT**: vehicle bodies that relied on `category` must set it in the DB instead, because the body key is now silently stripped:
  - `tracking.integration.spec.ts:520,565` (POST limo), with the direct vehicle POSTs at :513 and :558.
  - `:589` (PATCH standard).
  - `drivers.integration.spec.ts:624` (POST vip, inside the "aggregates across vehicles" test at 615-632).
  - `drivers.integration.spec.ts:279-292` (update test): read it and drop any `category` expectation.
  - After creation, use `ctx.db.update(vehicles).set({ category }).where(eq(vehicles.id, id))`.
- **GOTCHA**: the `driver-location.gateway.spec.ts:148` direct insert and `db/tests/schema-constraints.test.ts:29` are unaffected (no dispatch).
- **VALIDATE**: `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test` — totals must equal a baseline observed on `origin/main` **before the first edit**, with the same env (record command, sha, `Tests:` line), plus the new cases. The CLAUDE.md figure (694/39 at `0cdb59c`, without Redis) is not comparable. If a new integration spec is Redis-gated, re-observe the skipped count without `REDIS_TEST_URL` and update the CLAUDE.md line from that run — re-observe the whole claim, not the digit.
- **SATISFIES**: no regression

#### A.10 UPDATE `services/api/scripts/mint-tracked-ride.ts` and `docs/runbooks/driver-device-day.md`

- **IMPLEMENT**: script: approve the minted driver via `@taxi/db` (the same upsert as `approveDriver`) after `ensureVehicle` (800) and before the online PUT at `:567`. The vehicle body (`:812-821`) sends no `category`, so no change is needed there (verified 2026-09-30). The script entry is `mint:ride` (`services/api/package.json:16`). Runbook: after the driver signs in and adds a car in step 1, add "approve the driver at `/admin/drivers` (or `update drivers set approval_status='approved' where user_id=…`)"; the hand-fix at line ~500 (`update drivers set status='online'`) also needs `approval_status='approved'`.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api mint:ride` prints a tracking link (the script's own success output).
- **SATISFIES**: Level 4 performability

#### A.11 CREATE `drivers/admin/admin-drivers.integration.spec.ts`

- **IMPLEMENT** (mirror `customers.integration.spec.ts:36-47` for tokens, `drivers.integration.spec.ts:55` for a real driver via OTP):
  1. `PUT /drivers/me/status online` by a fresh driver with a car → **409 `driver_not_approved`** (edge, AC A2).
  2. Admin approves → same PUT → 200 (expected).
  3. Admin rejects that now-online driver → `status` in DB is `offline`, `ctx.locations` no longer lists them online (expected, AC A4).
  4. Reject while `on_ride` (set via `ctx.db.update(drivers).set({status:'on_ride'})`) → 409 `driver_on_ride`, approval unchanged (failure).
  5. **Dispatcher** token → `GET /admin/drivers` 403 `insufficient_role`; rider token → 403; no token → 401 (failure, AC A3). Dispatcher is the case that matters — dispatchers have every other console route.
  6. `PATCH /admin/vehicles/:id {category:'limo'}` → 200; the driver's own `PATCH /drivers/me/vehicles/:id {category:'standard', make:'Škoda'}` → 200 with `make` changed and `category` still `limo` (AC A6). `{category:'standard'}` alone → **400** (stripped to `{}`, then `vehicleUpdateSchema`'s empty-update refine rejects it) — assert that too.
  7. `PATCH /admin/drivers/:id {commissionPctOverride: 0}` then `{commissionPctOverride: null}` → column 0 then NULL (edge).
  8. `DELETE /admin/vehicles/:id` of an online driver's only car → driver goes offline (reuse proof).
  9. Unknown id → 404 `driver_not_found` / `vehicle_not_found`.
  10. Offer on screen, then revoke, then accept. An approved driver is online and a ride is dispatched to them: mirror `dispatch.integration.spec.ts:131`'s `onlineDriver` and its first test's offer flow (`sweeper.tick()`, then read the pending offer). Admin rejects: the driver goes `offline` and the offer stays `pending`. The driver then calls `POST /dispatch/offers/:offerId/accept` (`dispatch.controller.ts:68-77`) → **409 `driver_not_approved`**, the ride is still `offered` and `rides.driver_id` is null (failure). **Mutation check (VALIDATE):** comment out A.4b's guard and re-run. Case 10 must go red (accept → 200) while cases 1-9 stay green. Record both results in the PR body.
  - Rides inserted directly (if a case needs one): NOT NULL without default are `orderId`, `status`, `riderId` (FK users), `request` (jsonb), `paymentMethod` and `category` (`db/src/schema/rides.ts:38-61`). The pattern is `ledger/earnings.integration.spec.ts:47`.
- **VALIDATE**: `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- admin-drivers`
- **SATISFIES**: AC A2-A6

#### A.12 CREATE web slice `features/admin-drivers/*`

- **IMPLEMENT**:
  - `approval-labels.ts`: `export const APPROVAL_LABEL: Record<DriverApprovalStatus, MessageKey> = {…}` (compile-pinned).
  - `drivers-api.ts`: typed wrappers over `adminFetch` with the shared schemas.
  - `use-drivers.ts`: list state per approval filter, `approve/reject/reset(id)` with an in-flight ref (`use-assign.ts:106-140` pattern) and an `Outcome` result; refetch the list after a successful action.
  - `driver-list.tsx`: filter as a `fieldset` of three radio buttons (default `pending`), table rows `name · phone · plates+category · registered · [Apstiprināt] [Noraidīt] [Atvērt]`. Loading `role="status"`, error `role="alert"` + retry, empty state per filter.
  - `driver-detail.tsx`: profile form (display name, languages, isFemale, commission override with an explicit "platform base" option), approval control, vehicle list each with `vehicle-editor.tsx` (plate/make/model/year/category select/seats/child seat, save, delete with confirm via `DialogShell`).
  - `app/admin/drivers/page.tsx`: a **server** component (no `'use client'`) that renders `<Suspense fallback={…loading…}><DriversScreen/></Suspense>`. `DriversScreen` (client, in the slice) reads `useSearchParams().get('id')` and renders the list or the detail.
    - A query param rather than an `[id]` segment means no dynamic-route params plumbing, and "back" is the browser back.
  - **Verified 2026-09-30**: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md:181` says a static page calling `useSearchParams` from a Client Component **must** be wrapped in `Suspense`, "otherwise the build fails" (`missing-suspense-with-csr-bailout`). It "may appear to work" in dev, so only `build` catches it. No page in the app uses `useSearchParams` yet; this is the first.
- **GOTCHA**: `DialogShell`'s first-control selector is `'input, button, textarea, [tabindex]:not([tabindex="-1"])'` (`dialog-shell.tsx:68-70`), which lacks `select`. The delete-confirm dialog has only buttons, so it is unaffected. Do not change `DialogShell`.
- **GOTCHA**: `react-hooks/set-state-in-effect` is **error** level (verified, A0.7). Fetch in an effect and set state only in the promise callback (as `use-board.ts` does), or trigger loads from event handlers. `pnpm --filter @taxi/dispatch lint` is the check; run it after the first hook.
- **GOTCHA**: rejecting is reversible (reset to pending/approve) so it needs no confirm dialog; deleting a vehicle is not reversible → confirm.
- **VALIDATE**: `npx vitest run --root apps/dispatch src/features/admin-drivers` — list renders pending rows (expected), empty pending → empty-state text (edge), approve 409 `driver_on_ride` → alert with `admin.error.driver_on_ride` (failure), `APPROVAL_LABEL` covers all statuses (compile), keyboard: Tab reaches Approve and Enter fires it.
- **SATISFIES**: AC A1, A4, A5, A6

#### A.13 UPDATE `apps/driver` — `driver_not_approved` banner; stop sending category

- **IMPLEMENT**:
  - `presence-state.ts`: add `'driver_not_approved'` to the `BannerKind` union (starts at `:5`), and to the flip-offline branch at `:386` (`event.code === 'vehicle_required' || … 'driver_on_ride' || … 'driver_not_approved'`).
  - `home-screen.tsx`: the `switch (b.kind)` at `:170` lists every kind with **no `default` and no `never` check** (verified 2026-09-30), so a missing case is only caught if the return type forbids `undefined`. Add the `driver_not_approved` case next to `vehicle_required` (`:196-199`), rendering `t('driver.error.driver_not_approved')`, and add `default: { const _exhaustive: never = b.kind; return _exhaustive; }` so the next kind cannot be forgotten.
  - LV copy: "Jūsu profils vēl gaida apstiprinājumu. Mēs sazināsimies." Log it to ui-decisions if unsure.
  - `vehicle-screen.tsx:73`: remove `category: editing?.category ?? 'standard',`, and fix the docblock at `:32`.
- **Tests** (lines verified 2026-09-30):
  - `presence-state.test.ts`: add a case mirroring `vehicle_required` at `:72-77`, where error `driver_not_approved` flips offline with that banner kind. Add a second case for the re-assert path: after `ack_not_online` with `reasserted: false`, an error event with `driver_not_approved` ends offline with this banner.
  - `home-screen` test: render with the banner and assert the LV text.
  - `vehicle-screen.test.tsx:75-94` ("submits the parsed body"): the `createVehicle` call no longer has `category`.
  - `vehicle-screen.test.tsx:98-128` (edit keeps `limo`): assert `updateVehicle` was called **without** a `category` key (`expect(call).not.toHaveProperty('category')`). The server keeps the admin's value.
  - `vehicle-screen.test.tsx:172` is fixture data only, so leave it.
- **GOTCHA**: `GUIDANCE_KINDS` (`presence-state.ts:146`) is `['foreground_denied', 'background_denied']`, the permission-guidance kinds only. `vehicle_required` is **not** in it, so `driver_not_approved` stays out too and behaves exactly like `vehicle_required`.
- **GOTCHA**: RNTL 14, so always `await act(async …)` (memory).
- **GOTCHA**: rebuild shared before the driver tests (`pnpm --filter @taxi/shared build`) — apps read `dist` (memory: CI parity).
- **GOTCHA**: an Android build is not exercised by the gate (memory); this change is JS-only with no dep change, so no EAS build is required. Say so in the PR body.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/driver`
- **SATISFIES**: AC A2 (driver-facing), A6

#### A.14 Validate PR 1 and open it

- **VALIDATE**: `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` from cleared `dist` and cleared `apps/dispatch/.next` (memory: stale `.next` race). Then Level 4 §A steps 1-2 and 5-7 via curl; the UI steps are PR 2's.
- PR body: "Part of #20 (1 of 4)", with no closing keyword. Include the A.11 case-10 mutation result and the A.6 bound with its provenance. State that this is a JS-only driver-app change with no dependency change, so no EAS build is needed.
- `gh issue comment 64` with the photo/document-upload deferral line.

#### A.15 Validate PR 2 (admin shell + drivers UI) and open it

- **VALIDATE**: same gate, then Level 4 §A steps 3, 4 and 8 in a real browser. Step 4 is also the CORS check.
- PR body: "Part of #20 (2 of 4)".

### PR 3 — Phase B (platform-config editor)

Branch `feature/admin-config-20` off `origin/main` after PR 2 merges.

#### B.1 ADD `platformConfigUpdateSchema` to `packages/shared/src/schemas/platform-config.ts`

- **IMPLEMENT**:
  ```ts
  const s = platformConfigSchema.shape;
  export const platformConfigUpdateSchema = z.object({
    commissionPct: s.commissionPct,
    hourlyGuaranteeCents: s.hourlyGuaranteeCents.removeDefault(),
    weeklyGuaranteeCents: s.weeklyGuaranteeCents.removeDefault(),
    driverDebtLimitCents: s.driverDebtLimitCents,
    defaultDispatchMode: s.defaultDispatchMode.removeDefault(),
    offerTimeoutSeconds: s.offerTimeoutSeconds.removeDefault(),
    unclaimedAlertSeconds: s.unclaimedAlertSeconds.removeDefault(),
    dispatchPhone: s.dispatchPhone,
  }).strict();
  ```
  Full replacement (PUT), every field required, bounds taken from the read schema so they cannot diverge.
- **GOTCHA**: without `.removeDefault()`, an omitted `hourlyGuaranteeCents` parses to `null` and **silently switches off a guarantee**; an omitted `offerTimeoutSeconds` resets to 20. Test both omissions → 400.
- **GOTCHA**: `.strict()` so a client sending `cityId`/`id` gets 400 rather than a silent strip — the city is the server's `DEFAULT_CITY_ID`.
- **VALIDATE**: `pnpm --filter @taxi/shared test` — full body OK (expected); missing `hourlyGuaranteeCents` → error (failure); `hourlyGuaranteeCents: null` OK (edge); `commissionPct: 100.5` → error.
- **SATISFIES**: AC B1, B3

#### B.2 ADD `update` to platform-config repository/service; CREATE `platform-config.controller.ts`

- **IMPLEMENT**: repository `update(cityId, patch)`: `.update(platformConfig).set(patch).where(eq(cityId)).returning()` → `platformConfigSchema.parse(row)`; missing row → throw (same message as `forCity`). Service `update(actorId, patch)`: read previous, write, log `admin.platform_config.updated` with `{actorId, changed: {field: {from, to}}}` for the fields that differ (mask `dispatchPhone` with `maskPhone`). Controller `@Controller('admin/platform-config')`: `GET` → `PlatformConfig`, `PUT` body `platformConfigUpdateSchema` → `PlatformConfig`, both `@Roles('admin')`. Register the controller in `platform-config.module.ts`. Update `platform-config/index.ts` KNOWN GAPS (the "No controller" bullet goes).
- **GOTCHA**: do not set `updatedAt`; the trigger owns it (`0003_updated_at_trigger.sql:26-29`).
- **GOTCHA**: `PlatformConfigModule` is not in `AppModule`'s imports. It is imported by `dispatch.module.ts:41`, `pricing.module.ts:15` and `notifications.module.ts:6` (verified 2026-09-30), so it is in the module graph and a controller added to it is registered. B.4 case 1's first `GET` returning 200 (not 404) pins that.
- **GOTCHA**: `maskPhone` is exported from the auth slice (`auth/index.ts:13`); import it from `'../auth'`.
- **GOTCHA**: add `admin` to the domain list at `.claude/references/logging-standard.md:5` (today `ride | dispatch | payment | auth | driver | geo | realtime | support`).
- **GOTCHA**: `removeDefault()` exists on `ZodDefault` in the installed zod 3.25.76 (`node_modules/zod/v3/types.d.ts:851`, verified).
- **VALIDATE**: `pnpm --filter @taxi/api test -- platform-config`
- **SATISFIES**: AC B1

#### B.3 UPDATE `db/src/seed/riga.ts:179-184` — stop re-seeding over admin edits

- **IMPLEMENT**: `onConflictDoNothing({ target: platformConfig.cityId })` instead of the `set` re-assert. Update `docs/runbooks/hetzner-deploy.md:341`, which currently says an automated re-seed would stomp an admin's edit.
- **Verified 2026-09-30:** `services/api/test/global-setup.ts:29-49` drops and recreates `taxi_api_test`, migrates, then runs `seedRiga` (`:49`), so the first seed always inserts. No spec mutates `platform_config` (grep of `platformConfig`/`platform_config` in `*.spec.ts` finds only mocks, comments and a schema import), so nothing relies on the re-assert. B.4 is the first spec to mutate the row, and it restores the row in `afterEach`.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/db seed` twice after setting `commission_pct=17` by hand → still 17.
- **SATISFIES**: AC B1 (an edit survives deploy steps)

#### B.4 CREATE `platform-config/platform-config.integration.spec.ts`

- **IMPLEMENT**:
  1. **AC B1, `expected`**:
     - Rider `POST /rides` → `split.commissionPct` 15 (seed).
     - Admin `GET` → 200 (proves the route is registered). Admin `PUT` the returned values with `commissionPct: 20`.
     - The same rider's next `POST /rides` with a new `Idempotency-Key` uuid → `split.commissionPct` 20, and `split.commissionCents + driverNetCents === totalCents`.
     - Mirror `rides.integration.spec.ts:114-160` (`signIn`, `rider`, `IDEMPOTENCY_KEY_HEADER`). Two requests are far inside the per-rider cap `RIDE_REQUEST_MAX_PER_WINDOW = 20` (`rides.policy.ts:14`), and there is no one-active-ride-per-rider guard (grep of `rides/*.ts`, 2026-09-30). The harness overrides the maps source, so no OSRM is needed.
  2. Dispatcher → 403, rider → 403 (failure).
  3. Body with `cityId` → 400; body missing a field → 400 (failure).
  4. `hourlyGuaranteeCents: null` round-trips (edge).
  5. `afterEach` restores the seeded row values.
- **GOTCHA**: the AC is observable on `POST /rides`'s `split` (`rideCreatedSchema`, `ride.ts:484`), **not** on `POST /rides/quote` — `rideQuotePreviewSchema` is `{ quote }` only (`ride.ts:176`). The issue's "next quote" means the next priced request.
- **VALIDATE**: `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- platform-config`
- **SATISFIES**: AC B1, B2

#### B.5 CREATE web slice `features/admin-config/*` + `app/admin/config/page.tsx`

- **IMPLEMENT**:
  - `eur-input.ts`: `parseEurToCents(input: string): number | null` by **string parsing** (`/^\d{1,7}([.,]\d{1,2})?$/` → split on separator, `euros*100 + cents padded`), and `centsToEurInput(cents): string` (`"12.50"`). Never `parseFloat(x) * 100` (`0.29*100 = 28.999…`).
  - `use-config-form.ts`: load config, hold string field state, validate each field, build the full PUT body, in-flight guard, `Outcome`.
  - `config-form.tsx`: one `<form>` with labelled inputs: commission % (number, 0-100, step 0.1), hourly/weekly guarantee (EUR text + "no guarantee" checkbox → `null`), debt limit (EUR), dispatch mode (`select` over `DISPATCH_MODES` with a compile-pinned `Record<DispatchMode, MessageKey>`), offer timeout / unclaimed alert (seconds), dispatch phone. Save button; after save show `admin.saved` in `role="status"` and "applies to the next ride request" hint. Field errors `aria-describedby`. Unsaved-changes guard is out of scope.
  - Add Config link to `admin-nav.tsx`.
- **GOTCHA**: LV decimal separator is `,` — accept both `,` and `.`.
- **VALIDATE**: `npx vitest run --root apps/dispatch src/features/admin-config` — `parseEurToCents('0,29') === 29`, `'12.5' → 1250`, `'1e3' → null`, `'-1' → null` (edge/failure); form submits full body with `hourlyGuaranteeCents: null` when "no guarantee" is ticked (expected); 409/400 → alert (failure).
- **SATISFIES**: AC B1, B3

#### B.6 Validate PR 3

- **VALIDATE**: full gate as A.14, then Level 4 §B. PR body "Part of #20 (3 of 4)" (or `Closes #20` if PR 4 has already merged); notes #27 adds tiers here.

### PR 4 — Phase C (trips list + CSV)

Branch `feature/admin-trips-20` off `origin/main` after PR 2 merges.

#### C.1 GENERATE migration 0015 — `rides_created_at_id_idx`

- **IMPLEMENT**: in `db/src/schema/rides.ts` indexes (133-139): `index('rides_created_at_id_idx').on(t.createdAt.desc(), t.id.desc())`; `pnpm --filter @taxi/db generate`.
- **GOTCHA**: DB checklist — this is the trips list's one hot read (range on `created_at` + keyset). Plain `CREATE INDEX` locks writes on `rides` during build; at pilot size (`derived`: <10k rows ≈ 10 drivers × ~30 rides/day × 30 days = 9,000) it is sub-second. Note it in the migration comment; no `CONCURRENTLY` (drizzle migrations run in a transaction).
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db test`
- **SATISFIES**: AC C1

#### C.2 CREATE `packages/shared/src/schemas/admin-trips.ts`

- **IMPLEMENT**:
  - Imports: `RIDE_STATUSES` from `ride-state-machine.ts:1`, `LANGUAGES` from `enums.ts:4`.
  - `adminTripsFilterSchema = z.object({ from: isoDate, to: isoDate, status: z.enum(RIDE_STATUSES).optional() })` — unrefined base; `isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`; dates are **Rīga calendar days**, inclusive. `adminTripsQuerySchema = adminTripsFilterSchema.extend({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).superRefine(checkRange)`; `adminTripsExportQuerySchema = adminTripsFilterSchema.extend({ lang: z.enum(LANGUAGES).default('lv') }).superRefine(checkRange)`. `checkRange`: `from <= to`, span ≤ 92 days.
  - **GOTCHA**: refine last. In zod 3 `.refine()`/`.superRefine()` return `ZodEffects`, which has no `.extend`/`.omit`/`.shape` — always derive from the unrefined base.
  - `adminTripSchema`: `id, orderId, createdAt, status, bookingChannel, category, paymentMethod, riderName, riderPhoneMasked, driverName, vehiclePlate, totalCents, commissionPct, commissionCents, driverNetCents, distanceMeters, durationSeconds` (nullable where the column is).
  - `adminTripsPageSchema = z.object({ items: z.array(adminTripSchema), nextCursor: z.string().nullable() })`.
  - `ADMIN_TRIP_CSV_COLUMNS` as a `const` tuple of `keyof AdminTrip`, and the CSV header labels as `Record<(typeof ADMIN_TRIP_CSV_COLUMNS)[number], MessageKey>` in the api (C.4).
- **GOTCHA**: 92 days, `derived`: one calendar quarter (max 31+31+30); bounds CSV size at pilot volume to ~27,600 rows (`derived`: 300 rides/day × 92, the C.1 volume assumption).
- **VALIDATE**: `pnpm --filter @taxi/shared test` — `from > to` rejected, 93-day span rejected, `limit` 101 rejected.
- **SATISFIES**: AC C1, C2

#### C.3 CREATE `rides/admin/riga-range.ts`

- **IMPLEMENT**: no JS timezone math — the SQL does it: `created_at >= (${from}::date)::timestamp AT TIME ZONE 'Europe/Riga'` and `created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Riga')`. Export a helper returning the two drizzle `sql` fragments. For CSV/display, format `created_at` in SQL: `to_char(created_at AT TIME ZONE 'Europe/Riga', 'YYYY-MM-DD HH24:MI:SS')`.
- **GOTCHA**: host clock is BST (UTC+1), Rīga is UTC+3 in summer / UTC+2 in winter (memory). Anything using `new Date(from)` in Node would shift the day boundary by the host offset. The spec must insert rides at `2026-09-30T21:30:00Z` (= 00:30 Rīga on 1 Oct) and assert it falls in `from=to=2026-10-01`, not 30 Sep.
- **VALIDATE**: C.6 case 3.
- **SATISFIES**: AC C1

#### C.4 CREATE `rides/admin/trips-csv.ts` + spec

- **IMPLEMENT**: pure functions, guard **by type, not by column**: `type Cell = { text: string } | { num: string } | null`. Every `text` cell starting with `=`, `+`, `-`, `@`, `\t`, `\r` gets a `'` prefix, then RFC 4180 quoting if it contains `,` `"` `\r` `\n` (double `"`). `num` cells are emitted bare and never guarded — money via `centsToDecimal(cents)` → `"12.34"` / `"-1.86"` by integer arithmetic (like `formatEur` without `€`), plus distance, duration and commission %. `toCsv(rows, lang)` → `\uFEFF` BOM + header row from `formatMessage(lang, CSV_HEADER[col])` + rows, `\r\n` line ends.
- **GOTCHA**: user-controlled text includes names **and plates** (driver-entered). The masked phone `+371*****456` starts with `+`, so it is guarded too and shows as `'+371*****456` in a spreadsheet — accepted: unguarded it would be parsed as a formula and show an error. Tests: rider named `=HYPERLINK(...)` → `'=HYPERLINK(...)`; plate `-X1` → `'-X1`; phone → `'+371*****456`; `driverNetCents -186` → `-1.86` bare.
- **GOTCHA**: the BOM is what makes Excel read LV diacritics (ā, š) as UTF-8.
- **VALIDATE**: `pnpm --filter @taxi/api test -- trips-csv` (expected row, comma+quote name → quoted/doubled, formula name → prefixed, null plate → empty, negative money unprefixed).
- **SATISFIES**: AC C2, C3

#### C.5 CREATE `rides/admin/admin-trips.repository.ts`, `.service.ts`, `.controller.ts`; register in `rides.module.ts`

- **IMPLEMENT**:
  - Repository `page(query)`: `rides` ⟕ `users` as rider (`rides.riderId`) ⟕ `users` as driver (`rides.driverId`) ⟕ `vehicles`, Rīga range, optional status, keyset `(created_at, id) < (cursor.createdAt, cursor.id)` order `created_at desc, id desc`, `limit + 1` to know if there is a next page. Also select `created_at::text AS cursor_ts`.
  - Cursor = base64url of `${cursor_ts}|${id}`; decode validates shape → 400 `invalid_cursor`.
  - The CSV route validates `adminTripsExportQuerySchema` (C.2), not the page schema — otherwise `lang` is stripped silently.
  - `all(query)` for CSV: same filter, no cursor, hard cap 50,000 rows (`derived`: ~1.8× the 27,600 C.2 bound) → over the cap 422 `export_too_large`.
  - Service maps rows → `AdminTrip` with `maskPhone(riderPhone)`.
  - Controller `@Controller('admin/trips')`: `GET` → `AdminTripsPage`; `GET 'export.csv'` → `@Header('content-type','text/csv; charset=utf-8')` and a static `@Header('content-disposition','attachment')` (for curl; the browser names the file itself), `lang` from the export query schema. Both `@Roles('admin')`. Log `admin.trips.exported {actorId, from, to, rows}`.
- **GOTCHA**: keyset on `created_at` via a JS `Date` loses microseconds (Postgres stores µs, JS ms) — rows sharing the same millisecond would be skipped or repeated. The cursor carries the Postgres **text** timestamp and compares as `(rides.created_at, rides.id) < (${ts}::timestamptz, ${id}::uuid)`.
- **GOTCHA**: route order — declare `export.csv` before any `:param` route (none planned; state it in a comment like `rides.controller.ts`'s "DECLARED LAST" note).
- **GOTCHA**: `rides.service.ts` is 487 lines and `rides.repository.ts` 419 (observed at `0f0897e`) — keep all of this in `rides/admin/`.
- **GOTCHA**: `rides` has no phone column; the rider phone comes from `users.phone`. `rides.rider_id` is NOT NULL (`rides.ts:40`), so every ride row has a rider by construction. That includes phone orders, which mint or reuse the caller's user row (`bookings.service.ts:53` `findUserByPhone`, `:114` `findOrCreateUser`, re-read at `0f0897e` after #306). So the rider join can be INNER. Driver and vehicle are LEFT (null until assignment; `vehicle_id` is SET NULL).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck lint`
- **SATISFIES**: AC C1, C2, C3

#### C.6 CREATE `rides/admin/admin-trips.integration.spec.ts`

- **IMPLEMENT**: seed rides via direct `ctx.db.insert(rides)` with explicit `createdAt`, following the pattern at `ledger/earnings.integration.spec.ts:47`. Required columns (NOT NULL, no default; `rides.ts:38-61`): `orderId`, `status`, `riderId`, `request` (a valid `rideRequestSchema` object), `paymentMethod`, `category`. Riders via `insertUser` (`harness.ts:694`). Cases:
  1. 3 rides in range → page of 2 + `nextCursor`, second page 1 + `null` (expected, AC C1).
  2. Two rides with identical `created_at` split across the page boundary → both returned exactly once (edge — the µs gotcha).
  3. Rīga day boundary ride (C.3 gotcha) (edge).
  4. CSV: `content-type` text/csv, starts with BOM, header in LV, rider phone cell `'+371*****456` (masked + formula-guarded), money cells bare decimals, row count matches (expected, AC C2).
  5. Dispatcher → 403; `from > to` → 400; bad cursor → 400 (failure, AC C3).
- **VALIDATE**: `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- admin-trips`
- **SATISFIES**: AC C1-C3

#### C.7 CREATE web slice `features/admin-trips/*` + `app/admin/trips/page.tsx`

- **IMPLEMENT**:
  - `use-trips.ts`: from/to (default: last 7 Rīga days — compute "today in Rīga" with `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Riga' })`, never `new Date().toISOString().slice(0,10)` — host/browser clock is not Rīga), optional status, pages accumulated with "Load more".
  - `trips-table.tsx`: `<table>` with `<caption>`, `<th scope="col">`; money via `formatEur`; status label via a new compile-pinned `Record<RideStatus, MessageKey>` over `admin.trips.status.*` keys. The board's `STATUS_KEY` (`features/board/ride-queue.tsx:30-38`) is module-private and covers only `BoardRideStatus` (`requested`…`in_progress`); a trips list also shows `completed`, `settled`, `cancelled` and `scheduled`. Do not import across slices (verified 2026-09-30).
  - `download.ts`: `adminFetchBlob('/admin/trips/export.csv?…')` → `URL.createObjectURL` → temporary `<a download="trips-<from>_<to>.csv">` click → `revokeObjectURL`. Filename built client-side (the header is not CORS-exposed, A0.6).
  - Add Trips link to `admin-nav.tsx`.
- **GOTCHA**: an `<a href>` cannot carry the bearer token (session is in localStorage) — hence the blob path.
- **VALIDATE**: `npx vitest run --root apps/dispatch src/features/admin-trips` — renders rows (expected), empty range → empty state (edge), 400 → alert (failure), Load more appends and hides when `nextCursor` null; `download.ts` calls `createObjectURL` and `revokeObjectURL` (stub both on `URL`).
- **SATISFIES**: AC C1, C2

#### C.8 Validate PR 4

- **VALIDATE**: full gate as A.14, then Level 4 §C.
- PR body: `Closes #20` only if PR 3 has already merged, else "Part of #20 (4 of 4)". Note that tiers are #27's and uploads are on #64.

---

## TESTING STRATEGY

### Unit Tests

- shared (vitest): `admin-drivers.test.ts`, platform-config update schema cases, `admin-trips` query schema cases, i18n parity (existing).
- api (jest, `*.spec.ts`): `candidate-filter.spec.ts`, `force-assign.service.spec.ts`, `admin-drivers.service.spec.ts`, `trips-csv.spec.ts`.
- dispatch (vitest + RTL): `admin-api.test.ts`, `admin-drivers/*.test.tsx`, `eur-input.test.ts`, `config-form.test.tsx`, `admin-trips/*.test.tsx`, login redirect, `assign-state` mapping.
- driver (jest/RNTL 14 — `await act(async …)` always): `presence-state.test.ts`, `vehicle-screen.test.tsx`.

### Integration Tests

- `admin-drivers.integration.spec.ts` (A.11), `platform-config.integration.spec.ts` (B.4), `admin-trips.integration.spec.ts` (C.6), plus every updated spec-local go-online helper (A.9).
- No socket or room-join behaviour is added. The approval revocation clears Redis presence through `DriverLocationStore.markOffline` (`driver-location.store.ts:50`); A.11 case 3 asserts it through the harness's `ctx.locations`.

### Edge Cases

| Edge case | Verified in |
|---|---|
| Pending driver with no car → `driver_not_approved`, not `vehicle_required` | A.3 sibling case in `drivers.integration.spec.ts` (next to `:328`) |
| Approved driver with no car still → `vehicle_required` | `drivers.integration.spec.ts:328`, updated per A.3 |
| Re-assert after a refused fix surfaces the approval banner | A.13 `presence-state.test.ts` second case |
| New banner kind cannot be left out of the home-screen switch | A.13 `never` default (typecheck) |
| Revoke while `on_ride` refused, approval unchanged | A.11 case 4 |
| Revoke an online driver clears Redis | A.11 case 3; A.6 unit |
| Revoked-mid-ride driver released to `online` still gets no offers | A.4 candidate-filter unit |
| Offer on screen, revoked, then accepted → refused | A.11 case 10 |
| Force-assign racing a revocation → refused | A.4 force-assign unit (in-transaction lock returns false) |
| Dispatcher token on every admin route | A.11 case 5, B.4 case 2, C.6 case 5 |
| Old driver app sends `category` → stripped, category unchanged | A.11 case 6 |
| `commissionPctOverride: null` clears the override | A0.4 shared test, A.11 case 7 |
| Omitted guarantee field does not null the guarantee | B.1 shared test |
| `0,29` € → 29 cents | B.5 `eur-input.test.ts` |
| Re-seed keeps an admin's commission edit | B.3 VALIDATE (manual command) + Level 4 §B step 4 |
| Rīga midnight boundary | C.6 case 3 |
| Same-millisecond `created_at` across page boundary | C.6 case 2 |
| Formula-injection name, negative money unprefixed | C.4 spec |
| Existing drivers stay approved after migration | Level 4 §A step 1 |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm turbo run typecheck lint --force
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared build && pnpm --filter @taxi/shared test
pnpm turbo run test --filter @taxi/dispatch --filter @taxi/driver
```

### Level 3: Integration Tests

```bash
REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test
# the gate, from cleared dist + apps/dispatch/.next:
REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
```
The issue's AC says `pnpm check`; the root CLAUDE.md gate supersedes it. A gate hang past ~3 min with no output is the known flake (memory), re-run once before diagnosing.

### Level 4: Manual Validation

Stack: `docker compose up -d --wait`, `pnpm --filter @taxi/db migrate`, `pnpm --filter @taxi/db seed`, `pnpm --filter @taxi/api dev` (stub SMS provider logs OTP codes in full, `stub-sms.provider.ts:17-24`), `pnpm --filter @taxi/dispatch dev` (stop it afterwards and `git checkout apps/dispatch/AGENTS.md` — memory: `next dev` rewrites it).

Prerequisites this ticket ships: `provision:admin` (A0.9); a pending driver = any phone signing in as `driver` via `POST /auth/otp/request {phone, role:'driver'}` + `/auth/otp/verify` (code from the api log) + `POST /drivers/me/vehicles`.

**§A (PR 1: steps 1, 2, 5-7 via curl; PR 2: steps 3, 4, 8 in the browser)**
1. Before migrating on a DB that has drivers: `select approval_status, count(*) from drivers group by 1` after migrate → all `approved`.
2. Create a pending driver (curl above). `PUT /drivers/me/status {status:'online'}` → 409 `driver_not_approved`.
3. `provision:admin +37120000009`, log in at `/login` → lands on `/admin/drivers`, pending filter shows the driver with plate + `standard`.
4. Tab to **Apstiprināt**, Enter → row leaves the pending list; step 2's PUT now → 200. Browser devtools console shows no "blocked by CORS policy" (the PUT is the first non-GET/POST the console makes).
5. Open the driver (`?id=`), set vehicle category `limo`, save; `select category from vehicles` → `limo`.
6. Reject the (online) driver → DB `status='offline'`; the driver's next PUT online → 409 `driver_not_approved`.
7. Log in as a dispatcher phone → `/admin` bounces to `/login`; `curl -H "authorization: Bearer <dispatcher>" :3001/admin/drivers` → 403.
8. Screen reader: VoiceOver on `/admin/drivers` announces the filter legend, the row's name and both action buttons with accessible names.

**§B (PR 3)**
1. `curl POST /rides` as a rider → `split.commissionPct` 15.
2. `/admin/config`: set commission 18, weekly guarantee `500,00`, save → "Saglabāts".
3. `POST /rides` again → `split.commissionPct` 18. `select weekly_guarantee_cents from platform_config` → 50000.
4. `pnpm --filter @taxi/db seed` → commission still 18. Reset to 15 in the UI.

**§C (PR 4)**
1. `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api mint:ride` twice (creates rides for today).
2. `/admin/trips` default range lists them, newest first; status filter narrows.
3. **Lejupielādēt CSV** → file opens in Numbers/Excel with LV diacritics intact, masked rider phone, money as numbers.

### Level 5: Additional Validation (Optional)

`agent-browser` against `localhost:3000/admin/*` for keyboard-only runs (memory: `scrollintoview` before `click`).

---

## ACCEPTANCE CRITERIA

PR 1 (A2-A6 api/driver halves) and PR 2 (A1, UI halves of A4-A6)
- [ ] A1 An admin sees pending drivers with their vehicles and approves or rejects each (≤ 1 tap per decision from `/admin/drivers`).
- [ ] A2 An unapproved driver cannot go online (409 `driver_not_approved`), is never a dispatch candidate, cannot accept an offer already on screen, and cannot be force-assigned, even when a revocation lands mid-assignment; the driver app shows a persistent "awaiting approval" banner.
- [ ] A3 Every `/admin/*` route refuses dispatcher and rider tokens (403) and anonymous (401).
- [ ] A4 Rejecting an online driver takes them offline in Postgres and Redis; rejecting an on-ride driver is refused.
- [ ] A5 Admin edits driver profile fields and `commissionPctOverride` (including clearing it), edits and deletes vehicles.
- [ ] A6 Vehicle category is settable only by an admin; a driver's create/update cannot change it.

PR 3
- [ ] B1 A commission change made in `/admin/config` appears in the next `POST /rides` `split.commissionPct` without a deploy or restart.
- [ ] B2 Non-admin blocked on both config routes.
- [ ] B3 Guarantee fields can be set and cleared; an omitted field is a 400, never a silent reset.

PR 4
- [ ] C1 Trips list filtered by Rīga calendar dates and status, keyset-paginated with no duplicates or gaps.
- [ ] C2 CSV export with BOM, LV headers, masked rider phone, formula-safe cells.
- [ ] C3 Non-admin blocked; malformed range/cursor → 400.

All PRs
- [ ] `pnpm turbo run typecheck lint test build --force` green with `REDIS_TEST_URL` set; api totals = the branch-point baseline (observed 977 at `0f0897e`) + the new cases, 0 unexplained failures (the `payments.integration.spec.ts:614` full-run flake counts only if the spec passes alone, shown in the PR body).
- [ ] Every new screen usable with VoiceOver; 44px targets; visible focus on `a`, `button`, `input`, `select`, `textarea`.
- [ ] No shipped source file over 500 lines.

No AC here needs hardware or credentials this machine lacks.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works
- [ ] Acceptance criteria all met
- [ ] #64 comment added (photo/document upload deferral); #27 notified in a comment that the editor exists
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Q1 (ordering, worst case) — config edit vs an in-flight ride.** Commission is resolved three times: preview at `POST /rides` (platform base, returned, not persisted), per driver at offer (`offer-builder.ts:56`, stored on `ride_offers`), and settled at completion from the **accepted offer's** split (`ride-lifecycle.service.ts:185-199`). Worst case: an admin edit between request and offer makes the offer card show the new rate while the rider's request-time preview showed the old one; riders never see commission (`rideQuotePreviewSchema` has no split), so nothing user-visible disagrees. An edit after acceptance changes nothing for that ride. No action needed.
- **Q2 (ordering, worst case) — revoke vs concurrent accept.** Without A.4b the worst case is an **unapproved driver driving a ride**: `claimForRide` failing is not an error (`dispatch.service.ts:209-215`), so a driver revoked to `offline` could accept an offer already on screen. With A.4b, both paths take `FOR UPDATE` on the `drivers` row. Accept takes it just before `claimDriver`, which keeps every transaction in the existing rides→drivers order; the revocation touches no `rides` row locks. So:
  - Revoke first: accept reads `rejected` → 409 `driver_not_approved`, and the transaction rolls back.
  - Accept first: the revocation waits, then its fresh active-ride statement sees the ride → 409 `driver_on_ride`, and the admin retries after the ride.
  - A.11 case 10 pins the sequential form and its mutation check. The concurrent interleaving is argued from Postgres's READ COMMITTED lock-wait semantics (a row re-read after the wait), not tested by a two-connection race. That kind of test is flaky by construction on this suite (memory: gate flakes).
- **Q3 — driver app is not pushed the revocation.** It learns on its next refused GPS fix → re-assert → 409 (A.6).
  - **Window, `derived`:** up to ~4 s at nominal cadence (the reject lands at a random point in one `MIN_FIX_INTERVAL_MS = 4_000` gap); ~8 s when one OS delivery lands just under that floor and is dropped; 12 s = 3 × 4 s tolerating one dropped delivery (the allowance derived in `docs/runbooks/driver-device-day.md:271-275`); plus the ack round trip and one `PUT` round trip. Not a hard bound: `timeInterval: 4000` is an Android floor and real delivery jitter is unmeasured. Assumes the app is producing fixes and the Redis member was cleared (PR #309 L1 closed the go-online race that could leave it) (see A.6). If the app already re-asserted this session, it shows `marked_offline` first and the approval message on the next toggle.
  - No new offers arrive in the window, and an on-screen offer is refused at accept.
  - Accepted for the pilot; no socket `driver:approval_changed` event.
- **Q3b (worst case) — a revoked driver's pending offer.** Revocation does not touch `ride_offers`, so an offer on the revoked driver's screen stays `pending`. Their accept is refused (A.4b), and the ride waits for that offer to time out before the cascade re-offers. **Worst case:** one `offerTimeoutSeconds` of extra rider wait, which is the live `platform_config` value (schema default 20 s, `platform-config.ts`; `derived`: at most one offer per ride is pending for one driver at a time). Expiring the offer inside the revocation transaction would write `ride_offers` after locking `drivers`, the reverse of the rides/offers→drivers order in A.4b, so it is deliberately not done. Dina's force-assign stays available for an urgent ride.
- **Q4 — config validation bounds.** The schema allows `commissionPct` 0-100 and `offerTimeoutSeconds` ≥ 1. No tighter business bounds are specified; the editor does not add any.
- **Q5 — last-write-wins on config.** Two admins editing at once overwrite each other silently. One admin today; `updatedAt`-based 409 is a later addition if Atis starts editing too.
- **Q6 — backfill assumption.** Every existing `drivers` row is treated as vetted. If production holds test sign-ups that should not drive, reject them in `/admin/drivers` right after PR 1 deploys.

## NOTES (open canvas)

**Why approval on `drivers`, not `users`**: only drivers are vetted; `users.role` already separates dispatcher/admin. A separate `driver_approvals` table would be the place for a review history, which is the audit log #64 defers.

**Why three states, not a boolean**: `rejected` and `pending` read differently in the list (a rejected driver should not sit in the review queue), and the driver-app copy can stay one message for both.

**Why admin routes in owning slices rather than one `admin` api slice**: the repositories are slice-private by the VSA rule (`platform-config/index.ts:1-3`: "The repository is deliberately absent"). An `admin` slice would either reach into three repositories or add pass-through service methods to each. Controllers under `drivers/admin/`, `rides/admin/` and the platform-config slice keep each table's writes in the slice that owns its invariants (the go-online gate, the settled split).

**Friction audit** (taps from `/admin` landing, which login now routes to):
- Approve a pending driver: 1 (Approve on the row). Review needs the plate + category, both on the row.
- Change commission: nav Config (1) → edit field (1) → Save (1) = 3. Minimum possible without inline autosave, which would turn a typo into a live pricing change.
- Export a week of trips: nav Trips (1) → Download (1) = 2 (default range is last 7 days).

**Breadboard**

```
/login ─[admin]→ /admin/drivers
/admin/drivers
  [filter: pending|approved|rejected]
  row → [Apstiprināt] → row leaves list (status) ; 409 → alert
      → [Noraidīt]    → row leaves list
      → [Atvērt]      → /admin/drivers?id=…
/admin/drivers?id=…
  [profile form][Saglabāt] → status "Saglabāts" ; 400/404 → alert
  [approval radio][Saglabāt]
  vehicle × n: [fields][category select][Saglabāt] ; [Dzēst] → confirm dialog → [Dzēst] → list refresh
/admin/config
  [fields…][Saglabāt] → status "Saglabāts — attiecas uz nākamo pasūtījumu"
/admin/trips
  [no][līdz][statuss] → table ; [Ielādēt vairāk] ; [Lejupielādēt CSV] → file
```
States per screen: loading (`role="status"`), empty (per filter/range), error (`role="alert"` + retry), offline (fetch throws → same error + retry; no offline cache on admin, unlike the board).

**Rejected alternatives**
- `[id]` dynamic segment for driver detail: fine in Next 16, but the query-param form avoids a second page file and param typing for one screen. Revisit if detail grows.
- Streaming CSV (cursor over the DB): unnecessary at ≤ 27,600 rows (`derived`, C.2); a 50,000-row cap with 422 bounds memory instead.
- Revocation via `markOfflineByServer`: sends the wrong push (A.6).
- Locking the driver row first in accept: deadlocks against force-assign/reassign/complete/cancel, which all take rides→drivers (A.4b table).

**Verification ledger (2026-09-30, at `0f0897e`)** — every fact the tasks rest on was read from source or observed, not assumed:

| Claim | How known |
|---|---|
| Accept succeeds for an offline driver (the hole A.4b closes) | read `dispatch.service.ts:188-233`, `ride-lifecycle.service.ts:79-84` |
| Every drivers write in a tx comes after rides | read all six transactions (A.4b table) |
| `.for('update')` in drizzle 0.45.2; `removeDefault` in zod 3.25.76 | `.d.ts` lines cited in A.5 / B.2 |
| Refused fix → re-assert → 409 reaches the reducer; 4 s cadence | read `uploader.ts`, `use-presence.tsx`, `presence-state.ts`, `fix-throttle.ts` |
| Offer accept 409 renders `driver.error.<code>` if the key exists | read `offer-state.ts`, `offer-banner.ts`, `error-key.ts` |
| `set-state-in-effect` is error level | observed `eslint --print-config` |
| `useSearchParams` without Suspense fails `build` | Next 16 docs `use-search-params.md:181` |
| CORS allows PUT/PATCH/DELETE from :3000 | `env.schema.ts:333`, `cors/lib/index.js:10` |
| Every go-online test helper and its lines | exhaustive grep of `/drivers/me/status` (A.9 table) |
| Test seed runs per run; no spec mutates config | `global-setup.ts:29-49`, grep |
| Every ride has a rider (phone orders included) | `rides.ts:40` NOT NULL; `bookings.service.ts:53,114` |
| api baseline 977 tests, 1 known flake | observed run, PR-table preamble |
| Dev `POST /rides` works without OSRM | `OSRM_URL` absent binds the stub router outside production (`services/api/CLAUDE.md`, #134) |

**Residual risk, stated rather than hidden:** a plan is verified by execution, not by reading, so no pre-execution score is a guarantee. What remains is what only execution shows: gate flakes (the payments spec above; memory records others), copy wording (logged, not blocking), and the first `build` of a `useSearchParams` page. Each has a named check (baseline comparison, ui-decisions log, A.15 gate).

## AMENDMENTS

- 2026-09-30 — Hardening pass after review:
  - Split into four PRs; approval was ~2,400 lines as one (`derived`).
  - Moved the accept-path lock from first-in-transaction to just before `claimDriver`. First-in-transaction would have deadlocked against force-assign, reassign, complete and cancel.
  - Revocation is now a row-locked transaction with a fresh active-ride read.
  - Replaced the 75 s revocation bound (it credited the wrong mechanism) with the traced fix → ack → `PUT` path. Its "≤ 4 s" was the nominal case written as a bound; PR #309 M2 restated it as nominal / one-late / one-dropped (4 / ~8 / 12 s).
  - `approveDriver` is now an upsert.
  - Recorded that `drivers.integration.spec.ts:328` changes meaning.
  - The `home-screen` switch gets a `never` default.
  - The CSV formula guard now works by cell type (phone and plates included), and the filename is set client-side (header not CORS-exposed).
  - The trips schema is derived from an unrefined base; the observed api baseline is recorded; local main is fast-forwarded to `0f0897e` (five new commits). The line numbers they moved (`ride-read.integration.spec.ts` helper, `rides.ts` indexes, `ride.ts` `rideCreatedSchema`, catalog sizes, `rides.service.ts`/`rides.repository.ts` sizes) were re-read at `0f0897e` and corrected. Method: every backticked path in this plan was intersected with `git diff --name-only da9c933..0f0897e`. The overlap was re-read at `0f0897e`: `ride-read.integration.spec.ts`, `rides.ts`, `ride.ts`, the three catalogs, `rides.service.ts`, `rides.repository.ts`, `rides.policy.ts`, `bookings.service.ts`, `customers.controller.ts`, `customers.integration.spec.ts`, `env.schema.ts`, `auth.ts`, `hetzner-deploy.md`, the architecture doc and `services/api/CLAUDE.md`. Corrections: `env.schema.ts:344→333`, `hetzner-deploy.md L319→341`, and the `bookings.service.ts` rider lines. No cited driver-app file is in the diff (#304 touched `active-ride/`, which the plan does not cite).
- 2026-09-30 — Superseded by PR 1's implementation (`.claude/reports/admin-approval-config-trips-20-report.md` §Deviations):
  - A.1: the migration is `0016_shocking_quasimodo.sql`, not `0014` (main gained 0014/0015 first). C.1's index migration becomes `0017` or later.
  - A.2/A.3: no `DriversRepository.approvalStatus()` read. The refusal message reads `approvalStatus` from the profile `setPresence` already holds; the UPDATE's WHERE still decides.
  - A.4: the web key is `console.assign_error_driver_not_approved` (the existing `assign_error_*` family), not `console.error.driver_not_approved`. It is PR 1's only web change.
  - A.9: `drivers.integration.spec.ts` has 13 status PUTs, not one. Its `driver()` helper approves by default (`{ approved: false }` opts out). `tracking.integration.spec.ts`'s vehicle-less force-assign test also calls `approveDriver`.
  - A.10: the approval line is in `driver-device-day.md` step 1. The "hand-fix at ~500" is a never-set-presence-by-SQL warning and is unchanged.
  - A.11: two cases added — an offline driver holding an accepted ride cannot be rejected, and a pending driver is absent from `GET /dispatch/drivers`.
  - A.13: `BannerKind` moved to `availability/banner-kind.ts` (re-exported), because `presence-state.ts` hit 502 lines.
  - A0.5: nav copy is «Šoferi», not «Vadītāji» (logged in ui-decisions.md).
- 2026-09-30, PR #309 review round 1 (`.claude/code-reviews/pr-309-review.md`):
  - M1: reassign's pre-flight (`reassign.service.ts`) now refuses an unapproved incoming driver with 409 `driver_not_approved` before the release commits. A.4b's table already listed reassign; this is the check it implied.
  - L1: `setPresence`'s go-online branch re-reads approval after `markOnline` and, if it is no longer `approved`, calls `markOffline` and answers 409 `driver_not_approved`. This closes a reject committing between the UPDATE and the Redis write.
  - L2: `AdminDriversRepository.updateVehicle` sets an explicit column allowlist, as `VehiclesRepository.update` does, instead of spreading the patch.
