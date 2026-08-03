# Feature: Ride-loop contracts, socket event catalog, geozone/queue types, money + platform config (`@taxi/shared`)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **Implements GitHub issue [#2](https://github.com/linardsb/taxi/issues/2)** — the PR must say `Closes #2`.

## Feature Description

Phase 1 of the Sakta Cab build is the **contract layer**: the zod schemas, socket event catalog, geozone/queue
types, money helpers, and platform-config + commission resolver that every other surface (api, driver app,
rider app, dispatch console, admin) imports from `@taxi/shared`. Nothing downstream can be planned honestly
until these shapes exist, which is why #2 has no dependencies and gates 22 of the epic's 26 remaining tickets.

Concretely this ticket takes `packages/shared` from "5 skeleton schemas + a ride state machine" to "the full
MVP ride-loop contract surface", adding: the **offer** and **assignment** contracts (dispatch), the **fare
split** contract (the driver-transparency wedge — full fare + explicit commission line), the **platform
config** + `resolveCommissionPct()` resolver (15% flat, *config not constant*), **geozone queue** types
(district fairness), and a **zod-validated socket event catalog** covering ride lifecycle, driver location,
dispatch offers, and dispatcher overrides.

## User Story

As **the builder of every downstream Sakta Cab slice** (api, driver, rider, dispatch, admin)
I want **one typed, tested, documented contract surface in `@taxi/shared` covering the whole MVP ride loop**
So that **each surface imports the same shapes instead of re-deriving them, the commission stays configurable
rather than hardcoded, and the driver's "you keep 85%" transparency wedge is enforced by the type system
instead of by discipline**.

Downstream, the value lands on the actual users: the driver (Atis) sees the full fare and the exact commission
line on every offer because `rideOfferSchema` carries `quote` **and** `split`; the dispatcher (Dina) gets
force-assign with an audit trail because `rideAssignmentSchema` requires `dispatcherId` when the source is
`dispatcher`; and the platform can run Atis's evidenced "0% + hourly guarantee" pilot (S6-7) without a code
change because `commissionPct` is a required config field with no default.

## Problem Statement

`@taxi/shared` today (504 lines total) covers a ride *request* and a ride *record*, but not the middle of the
loop. There is no contract for an **offer** (what a driver is shown before accepting), an **assignment** (who
matched the ride and by what authority), a **fare split** (the transparency wedge that is the entire driver
pitch), a **platform config** (commission is spoken of as 15% but exists nowhere in code), a **queue position**
(district fairness — Dina's #1 carry-over, S7-2), or the **six socket events** the MVP needs beyond the four
already listed.

Without them, the five downstream surfaces each face a choice between blocking or inventing local shapes —
which is exactly what the repo's hard rule ("every cross-surface contract lives in `packages/shared`") exists
to prevent. Worse, the commission would land as a literal `0.15` in the first pricing code that needs it,
silently violating the architecture's "config not constant" decision and pre-breaking the loyalty
differentiator (#27) that must extend the *same* resolver.

## Solution Statement

Extend `packages/shared/src` along a clean, cycle-free dependency order, keeping every file well under the
500-line rule:

```
enums.ts  →  money.ts  →  schemas/platform-config.ts  →  commission.ts  →  schemas/ride.ts
                                                                              ↓
                       schemas/{geo,driver}.ts  →            realtime-events.ts  →  index.ts
```

- **money.ts** (new) — integer-cent primitives every schema reuses instead of re-typing `z.number().int()`.
- **schemas/platform-config.ts** (new) — `platformConfigSchema` with `commissionPct` as a **required field with
  no zod default**, plus guarantee placeholders and the dispatch timings the offer/unclaimed contracts need.
- **commission.ts** (new) — `resolveCommissionPct(driver, config)` returning `{ pct, source }`, and
  `splitFare(totalCents, resolution)` returning a `FareSplit` whose schema *refines* that
  `commissionCents + driverNetCents === totalCents` (no cent may leak, at any boundary, ever). This one file is
  what #27 (loyalty) later extends — not a new subsystem.
- **schemas/ride.ts** (extend) — `rideOfferSchema`, `rideAssignmentSchema`, and a richer `rideSchema`.
- **schemas/geo.ts** (extend) — geozone `slug`, `queueEntrySchema`, `geozoneQueueSchema`.
- **enums.ts** (extend) — `RIGA_PILOT_DISTRICTS`, `OFFER_STATUSES`, `ASSIGNMENT_SOURCES`, `COMMISSION_SOURCES`.
- **realtime-events.ts** (extend) — 8 events with **zod payload schemas** (not bare interfaces), typed
  direction maps for the Socket.IO generics, and room-name helpers.
- **`.claude/references/realtime-events.md`** — regenerated table, verified by an executable sync check.

## Out of Scope / Non-Goals

- **Not included: any persistence.** No Drizzle schema, no migrations, no `db/` seed — that is #6. This ticket
  defines shapes; #6 maps them to tables. Where a schema has an `id: uuid`, #6 owns the column.
- **Not included: any API, gateway, or engine code.** No NestJS module, no Socket.IO server, no dispatch
  algorithm. `services/api` and `apps/*` are **not touched at all** by this ticket.
- **Not included: `demand:wave` / `DemandSignalProvider`.** The demand-wave radar seam is #25 (post-demo, and
  gated on spike #3). Do not add it, even though the architecture doc names it.
- **Not included: a `ride:requested` socket event.** The build playbook §2.4 mentions one in prose, but
  `ride:status` fires on *every* state-machine transition (per `.claude/references/realtime-events.md`), which
  subsumes it. Adding both would be a redundant event two surfaces have to keep in sync.
- **Not included: loyalty tier shapes.** #27 adds tenure/quality inputs to `CommissionDriverInput` and a
  `"loyalty_tier"` member to `COMMISSION_SOURCES`. Both are additive. Do not model tiers now.
- **Not included: accept/decline as socket events.** Offer accept/decline is a REST call in #10 (needs
  idempotency, auth, retry semantics). The socket catalog carries offer *delivery* and *revocation* only.
- **Not included: payments/ledger contracts.** `PaymentMethodType` already exists in `enums.ts`; the ledger
  entry shape belongs to #12 (and is gated on spike #5).
- **Not changing: the ride state machine.** `RIDE_STATUSES` and `ALLOWED_TRANSITIONS` stay exactly as they are.
  No new statuses. If you find yourself wanting one, stop — it is a sign a contract is modelled wrong.
- **Not changing: existing exported identifiers.** `rideSchema`/`Ride`, `fareQuoteSchema`/`FareQuote`,
  `DriverLocationEvent`, `RideStatusEvent`, `RideOfferEvent` keep their names (see "Contract vocabulary" below).
- **Not changing: `packages/shared/package.json` dependencies.** Everything here is zod + TypeScript. Do not
  add `@types/node`, a date library, or a branded-type helper library.

## Feature Metadata

**Feature Type**: New Capability (contract layer)
**Estimated Complexity**: Medium — no algorithms, but high blast radius: 22 downstream tickets read these shapes
**Primary Systems Affected**: `packages/shared` only (+ one reference doc). No app or service code changes.
**Dependencies**: none (epic wave 1). External libs: `zod ^3.24` (resolved 3.25.76) and `vitest 3.2.7`, both
already installed. No new dependencies.

## Related Work

**Implements**: [#2](https://github.com/linardsb/taxi/issues/2) · **Epic**: [#1](https://github.com/linardsb/taxi/issues/1) → `docs/epics/sakta-cab.architecture.md`

**Back-references** (plans this builds on or inherits decisions from):

- `docs/epics/sakta-cab.architecture.md` — **inherited, not re-decided**: stack, hosting (Railway), commission
  as config-with-a-pure-resolver, boundaries (seams, `assertTransition`, integer cents, contracts only in
  `@taxi/shared`). This plan makes no architecture decisions; it implements those.
- `docs/skeleton-proposal.md` §5 — the six core seams and the ride state machine path list.
- `docs/build-playbook.md` §Step 3 — slices 1.1–1.4, which this ticket collapses into one loop.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- #6 DB foundation — maps every `*Schema` here to a Drizzle table; seeds `commissionPct = 15` and the four
  `RIGA_PILOT_DISTRICTS` geozones.
- #7 auth + realtime gateway — consumes `RT`, `SERVER_TO_CLIENT_EVENTS`, `CLIENT_TO_SERVER_EVENTS`, room helpers.
- #10 dispatch engine — consumes `rideOfferSchema`, `rideAssignmentSchema`, `queueEntrySchema`, `offerTimeoutSeconds`.
- #11 ride lifecycle — consumes `splitFare()`; the fare-transparency wedge is born there from this contract.
- #20 admin — edits `platformConfigSchema` fields through a UI.
- #27 loyalty commission — extends `commission.ts` (same resolver) and `COMMISSION_SOURCES`.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `packages/shared/src/enums.ts` (all 20 lines) — Why: the exact `as const` array + derived-type idiom every new
  enum must mirror. `export const X = [...] as const; export type Y = (typeof X)[number];`
- `packages/shared/src/schemas/ride.ts` (all 56 lines) — Why: the file you extend most. Note the JSDoc style
  (each non-obvious field carries a one-line comment citing the source: outline §, anketa code, or decision date).
- `packages/shared/src/schemas/geo.ts` (all 33 lines) — Why: `latLngSchema` / `addressPointSchema` / `geozoneSchema`
  are the building blocks for queue + event payloads. Do not redefine coordinates anywhere.
- `packages/shared/src/schemas/driver.ts` (all 20 lines) — Why: gets one new field; shows the
  `.nullable().default(null)` idiom used for optional-but-modelled columns (`fleetId`).
- `packages/shared/src/realtime-events.ts` (all 34 lines) — Why: current `RT` const + the three payload
  interfaces you are converting to zod. Keep the exported type names.
- `packages/shared/src/ride-state-machine.ts` (lines 1–47 for `RIDE_STATUSES`/`ALLOWED_TRANSITIONS`, 75–89 for
  `isPaymentMethodLocked`) — Why: read-only here. Confirms no new statuses are needed for offers/assignments.
- `packages/shared/src/index.ts` (all 12 lines) — Why: flat `export *` barrel; every new module needs a line,
  ordered to match the dependency order.
- `packages/shared/tests/schemas.test.ts` (all 62 lines) — Why: **the** test idiom to mirror — `describe` per
  schema, `it` labelled `(expected)` / `(edge)` / `(failure)`, `safeParse(...).success` assertions, and the
  shared `const riga = { lat: 56.9496, lng: 24.1052 }` fixture.
- `packages/shared/tests/ride-state-machine.test.ts` (lines 25–27 especially) — Why: shows the
  `happyPath[i]!` non-null-assertion idiom required under `noUncheckedIndexedAccess`.
- `packages/shared/tsconfig.build.json` + `packages/shared/tsconfig.json` — Why: `build` compiles `src` only
  with `rootDir: "src"`. **Every new source file must live under `src/`, and nothing in `src/` may import from
  `tests/`** or the published build breaks.
- `packages/config/tsconfig/base.json` — Why: `strict: true` **and `noUncheckedIndexedAccess: true`**, plus
  `module: "commonjs"` (⇒ `import.meta` is a typecheck error — see GOTCHA in Task 12).
- `CLAUDE.md` (root) — Why: the hard rules this ticket is the physical embodiment of.
- `services/api/CLAUDE.md` — Why: "Socket event names/payloads come from `RT` in `@taxi/shared` — never string
  literals." The catalog you write is what makes that rule satisfiable.

### New Files to Create

- `packages/shared/src/money.ts` — integer-cent primitives (`centsSchema`, `nonNegativeCentsSchema`,
  `eurCurrencySchema`, `commissionCentsFor`).
- `packages/shared/src/schemas/platform-config.ts` — `platformConfigSchema` / `PlatformConfig`.
- `packages/shared/src/commission.ts` — `CommissionDriverInput`, `CommissionResolution`,
  `resolveCommissionPct`, `fareSplitSchema` / `FareSplit`, `splitFare`.
- `packages/shared/tests/money.test.ts` — cent primitives.
- `packages/shared/tests/commission.test.ts` — resolver + split + rounding sweep.
- `packages/shared/tests/platform-config.test.ts` — the executable "config not constant" gate.
- `packages/shared/tests/realtime-events.test.ts` — payload parsing + room helpers + catalog completeness.

### Files to Modify

- `packages/shared/src/enums.ts` — 4 new const arrays.
- `packages/shared/src/schemas/geo.ts` — geozone `slug`; queue types.
- `packages/shared/src/schemas/driver.ts` — `commissionPctOverride`.
- `packages/shared/src/schemas/ride.ts` — offer, assignment, richer ride record.
- `packages/shared/src/realtime-events.ts` — full zod catalog.
- `packages/shared/src/index.ts` — barrel exports.
- `packages/shared/tests/schemas.test.ts` — new describes for offer/assignment/ride/queue.
- `.claude/references/realtime-events.md` — regenerated event table (AC — do not skip).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `.claude/references/realtime-events.md` (15 lines, in-repo)
  - The whole file: current table + the room and auth rules.
  - Why: it is both an input (rooms `ride:<id>` / `dispatch:<cityId>` / `driver:<id>`) and an output (AC
    requires it updated in this same slice).
- `.claude/references/dispatch-strategies.md` (15 lines, in-repo)
  - `auto_match` and `geozone_queue` sections.
  - Why: defines what an offer cascade and a queue actually do — `rideOfferSchema.queuePosition` and
    `ASSIGNMENT_SOURCES` come straight from here. Also the line "Dispatcher override is NOT a strategy" is why
    `dispatcher` is an *assignment source*, not a `DispatchMode`.
- `.claude/references/ride-state-machine.md` (16 lines, in-repo)
  - Why: confirms offer decline/timeout maps to the existing `offered → requested` transition — no new statuses.
- `docs/epics/sakta-cab.architecture.md` §"Key decisions" (line 27, commission) and §"Data model additions"
  (line 30)
  - Why: the two lines this ticket implements verbatim. `commissionPct` naming and the pure-resolver shape are
    **decided** — inherit, do not re-open.
- `docs/prd/anketa-findings.md` lines 31 (€15/h), 44–46 (district queue, phone dispatch, hybrid override), 114
  (S2-9: 15% flat preferred, 16% ceiling), 164 (S6-7: 0% + guarantee)
  - Why: the evidence behind `hourlyGuaranteeCents`, `weeklyGuaranteeCents`, `commissionPct.min(0)` and the
    dispatcher audit trail. Cite these codes in JSDoc, matching the existing file style.
- [Zod v3 docs — objects & refinements](https://zod.dev/?id=objects)
  - Sections: `.refine`, `.superRefine`, `.default`, `.nullable`.
  - Why: the fare-split invariant and the dispatcher-audit rule are `.refine` on the object, and refinement
    placement relative to `.default()` matters.
- [Zod v3 docs — `z.enum`](https://zod.dev/?id=zod-enums)
  - Why: `z.enum()` needs a non-empty **tuple**; this is why every enum stays `as const`.
- [Socket.IO — TypeScript typed events](https://socket.io/docs/v4/typescript/)
  - Section: "Types for the server" (`Server<ClientToServerEvents, ServerToClientEvents>`).
  - Why: the exact shape `CLIENT_TO_SERVER_EVENTS` / `SERVER_TO_CLIENT_EVENTS` must have so #7 can plug them
    into the NestJS gateway generics without re-mapping.

### Patterns to Follow

**Contract vocabulary — issue #2's five names map to these identifiers** (the ticket names *concepts*; these
are the identifiers. Do **not** rename existing exports — `fareQuoteSchema` is already load-bearing in
`seams/pricing-strategy.ts`, and renaming some-but-not-all is worse than renaming none):

| Ticket / playbook name | Identifier in code | File |
|---|---|---|
| `RideRequest` | `rideRequestSchema` / `RideRequest` | `schemas/ride.ts` (exists) |
| `Quote` | `fareQuoteSchema` / `FareQuote` | `schemas/ride.ts` (exists) |
| `Offer` | `rideOfferSchema` / `RideOffer` | `schemas/ride.ts` (**new**) |
| `Assignment` | `rideAssignmentSchema` / `RideAssignment` | `schemas/ride.ts` (**new**) |
| `RideRecord` | `rideSchema` / `Ride` | `schemas/ride.ts` (exists, extended) |

**Enum idiom** (`src/enums.ts` lines 1–2) — const tuple + derived type, never a TS `enum`:

```ts
export const USER_ROLES = ["rider", "driver", "dispatcher", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];
```

**Schema idiom** (`src/schemas/vehicle.ts`) — `xSchema` camelCase const, `X` PascalCase type via `z.infer`,
exported adjacent to each other:

```ts
export const vehicleSchema = z.object({ /* ... */ });
export type Vehicle = z.infer<typeof vehicleSchema>;
```

**Evidence-citing JSDoc** (`src/schemas/ride.ts` lines 29, 35, 37) — every non-obvious field explains itself and
cites its source (outline §, anketa code `S9-4`, or a decision date). Mirror this exactly; it is how the repo
keeps product intent attached to contracts:

```ts
/** Set for "izsaukumi uz laiku" — scheduled rides enter the machine as `scheduled`. */
scheduledFor: z.coerce.date().optional(),
```

**Dates: domain vs wire** — persisted/domain schemas use `z.coerce.date()` (see `rideSchema.createdAt`); socket
payloads use ISO strings `z.string().datetime()` (see the current `at: string; // ISO timestamp`). Keep the two
worlds separate; do not "unify" them.

**`noUncheckedIndexedAccess` idiom** (`tests/ride-state-machine.test.ts` line 26) — index access yields
`T | undefined`; use a non-null assertion at the call site rather than loosening the tsconfig:

```ts
expect(canTransition(happyPath[i]!, happyPath[i + 1]!)).toBe(true);
```

**Test idiom** (`tests/schemas.test.ts`) — one `describe` per schema, `it` titles suffixed `(expected)` /
`(edge)` / `(failure)`, a `base` object spread for variants, `safeParse(...).success` for failures and
`.parse()` for happy paths:

```ts
it("rejects an unknown payment method (failure)", () => {
  expect(rideRequestSchema.safeParse({ ...base, paymentMethod: "crypto" }).success).toBe(false);
});
```

**Barrel order** (`src/index.ts`) — flat `export *`, ordered so a reader can follow dependencies top-to-bottom.

---

## IMPLEMENTATION PLAN

Phases run top to bottom; each depends on the one above (the module dependency order *is* the phase order, so
there is no parallelism to unlock inside this ticket — it is one package, one session, per the playbook's
"never two execute sessions in the same package" rule).

### Phase 1: Primitives

Enums and money. Nothing imports anything but `zod`, so this phase can't be wrong in an interesting way — but
everything above it inherits these names.

**Tasks:** extend `enums.ts` with the four new const tuples; create `money.ts`.

### Phase 2: Config & commission

**Depends on:** Phase 1 (`COMMISSION_SOURCES`, cent primitives).

The economic core of the ticket: the config row shape, the resolver, the split, and the no-cent-leak invariant.

**Tasks:** create `schemas/platform-config.ts`; create `commission.ts`; add `commissionPctOverride` to
`schemas/driver.ts`.

### Phase 3: Ride-loop & geo contracts

**Depends on:** Phase 2 (`fareSplitSchema`).

**Tasks:** extend `schemas/geo.ts` (slug + queue); extend `schemas/ride.ts` (offer, assignment, ride record).

### Phase 4: Socket event catalog

**Depends on:** Phase 3 (payloads embed offer/assignment/queue shapes).

**Tasks:** rewrite `realtime-events.ts` as a zod catalog with direction maps and room helpers; wire `index.ts`.

### Phase 5: Tests, docs & gates

**Depends on:** Phases 1–4.

**Independent of:** nothing — but note the doc update (Task 12) is an **acceptance criterion**, not a nicety.
Do it before you run the final gates, and verify it with the sync command rather than by eye.

**Tasks:** four new test files + extensions to `tests/schemas.test.ts`; regenerate the realtime-events
reference table; run all five validation levels.

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

### 1. UPDATE `packages/shared/src/enums.ts`

- **IMPLEMENT**: Append four const tuples + derived types, each with a one-line JSDoc citing its source:
  - `RIGA_PILOT_DISTRICTS = ["centre", "rix", "autoosta", "old_town"] as const` / `RigaPilotDistrict`.
    JSDoc: the four evidenced pilot hotspots (S5-2, S7-2); geozones themselves are **data** (#6 seeds them) —
    this tuple is the stable slug set for the pilot, not a closed universe of zones.
  - `OFFER_STATUSES = ["pending", "accepted", "declined", "expired", "revoked"] as const` / `OfferStatus`.
  - `ASSIGNMENT_SOURCES = [...DISPATCH_MODES, "dispatcher"] as const` / `AssignmentSource`.
  - `COMMISSION_SOURCES = ["platform_base", "driver_override"] as const` / `CommissionSource`.
- **PATTERN**: `packages/shared/src/enums.ts:1-2` (const tuple + `(typeof X)[number]`).
- **IMPORTS**: none (`DISPATCH_MODES` is already in this file — reference it directly, do not re-list its members).
- **GOTCHA**: spell it `centre` (British) — the ticket, the PRD and the architecture doc all use "centre";
  `docs/build-playbook.md` line 81 says "center" and is the outlier. Pick `centre` and stay consistent.
- **GOTCHA**: if `z.enum(ASSIGNMENT_SOURCES)` fails to typecheck because the spread widened the tuple, write
  the three members out literally rather than casting — but try the spread first, it preserves tupleness in
  TS 5.7 and prevents `DISPATCH_MODES` drift.
- **GOTCHA**: `COMMISSION_SOURCES` is a const array (not an inline union) specifically so #27 adds
  `"loyalty_tier"` in exactly one place.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #3 (geozone/district types), AC #4 (commission resolver plumbing)

### 2. CREATE `packages/shared/src/money.ts`

- **IMPLEMENT**: The integer-cent primitives, with a file-level JSDoc restating the hard rule ("All money is
  integer cents, EUR. Never floats." — root `CLAUDE.md`):
  - `export const eurCurrencySchema = z.literal("EUR");`
  - `export const centsSchema = z.number().int();` — signed; the ledger (#12) and `driver.balanceCents` go negative.
  - `export const nonNegativeCentsSchema = z.number().int().nonnegative();`
  - `export const nonPositiveCentsSchema = z.number().int().nonpositive();` — discounts only (the shared-ride
    knock-down, #23). Exists so `fareQuoteSchema.breakdown.discountCents` can use a primitive like every other
    cent field (Task 6a).
  - `export const commissionPctSchema = z.number().min(0).max(100);` — a **percent**, not basis points, per
    the architecture decision. `0` is valid and load-bearing (S6-7: Atis would drive at 0% + guarantee).
  - `export function commissionCentsFor(totalCents: number, pct: number): number` →
    `Math.round((totalCents * pct) / 100)`. JSDoc must state the rounding rule *and* that the driver's net is
    always derived by **subtraction**, never by an independent `Math.round`, so the two halves always sum to
    the total.
- **PATTERN**: file-level JSDoc style of `packages/shared/src/seams/maps-provider.ts:17-21`.
- **IMPORTS**: `import { z } from "zod";`
- **GOTCHA**: do not add a branded `Cents` type. `noUncheckedIndexedAccess`-strict TS plus `z.number().int()`
  at every boundary is the project's chosen level of rigour; a brand would force casts through five surfaces.
- **GOTCHA**: no `formatCents` here — money *rendering* is i18n/locale work owned by the apps.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #4

### 3. CREATE `packages/shared/src/schemas/platform-config.ts`

- **IMPLEMENT**: `platformConfigSchema` / `PlatformConfig`:
  ```ts
  export const platformConfigSchema = z.object({
    id: z.string().uuid(),
    cityId: z.string().uuid(),
    /**
     * Launch value 15 (flat, everyone, no intro promo — Linards 2026-08-03). CONFIG, NOT CONSTANT:
     * deliberately has no zod default so every caller must read a real row. The seed lives in #6.
     */
    commissionPct: commissionPctSchema,
    /** Pilot guarantee placeholders — €15/h (S2-9d) and €500/week (S2-10). null = no guarantee in force. */
    hourlyGuaranteeCents: nonNegativeCentsSchema.nullable().default(null),
    weeklyGuaranteeCents: nonNegativeCentsSchema.nullable().default(null),
    /** Fallback when a geozone does not set `queueModeEnabled` (dispatch-strategies.md). */
    defaultDispatchMode: z.enum(DISPATCH_MODES).default("auto_match"),
    /** How long a driver has to accept before the cascade re-offers (`offered → requested`). */
    offerTimeoutSeconds: z.number().int().positive().default(20),
    /** Unclaimed-order alert threshold to Dina's board (S9-4). */
    unclaimedAlertSeconds: z.number().int().positive().default(60),
    updatedAt: z.coerce.date(),
  });
  ```
- **PATTERN**: `packages/shared/src/schemas/driver.ts` (nullable-with-default idiom, evidence-citing JSDoc).
- **IMPORTS**: `z`, `DISPATCH_MODES` from `../enums`, `commissionPctSchema` + `nonNegativeCentsSchema` from `../money`.
- **GOTCHA**: **do not export a `DEFAULT_PLATFORM_CONFIG` / `PLATFORM_CONFIG_DEFAULTS` object.** Any such export
  gets imported into pricing code within two tickets and quietly re-becomes a constant. The number 15 must not
  appear anywhere in `packages/shared`.
- **GOTCHA**: `commissionPct` gets **no** `.default(15)`. That omission is an acceptance criterion, tested in Task 11.
- **NOTE**: `offerTimeoutSeconds` / `unclaimedAlertSeconds` / `defaultDispatchMode` go slightly beyond the
  ticket's literal wording. They are here because contracts written *in this same ticket* (`rideOfferSchema
  .expiresAt`, the `dispatch:unclaimed` event) are meaningless without them, and the alternative is #10
  hardcoding them or amending shared from an api session. Flagged in Open Questions — if vetoed, delete these
  three fields and nothing else changes.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #4

### 4. CREATE `packages/shared/src/commission.ts`

- **IMPLEMENT**: the resolver, the split shape, and the split function — the file #27 later extends:
  ```ts
  /**
   * Structural input, deliberately NOT `DriverProfile`: the resolver reads only what it needs, so the
   * loyalty differentiator (#27) widens THIS interface with tenure/quality inputs rather than adding a
   * second subsystem (architecture, 2026-08-03). `DriverProfile` satisfies it structurally.
   */
  export interface CommissionDriverInput {
    commissionPctOverride?: number | null;
  }

  export interface CommissionResolution {
    pct: number;
    source: CommissionSource;
  }

  export function resolveCommissionPct(
    driver: CommissionDriverInput,
    config: PlatformConfig,
  ): CommissionResolution;

  export const fareSplitSchema = z.object({
    currency: eurCurrencySchema,
    /** What the rider pays — shown to the driver in full. THE transparency wedge (S2-5). */
    totalCents: nonNegativeCentsSchema,
    commissionPct: commissionPctSchema,
    commissionSource: z.enum(COMMISSION_SOURCES),
    commissionCents: nonNegativeCentsSchema,
    driverNetCents: nonNegativeCentsSchema,
  }).refine(
    (s) => s.commissionCents + s.driverNetCents === s.totalCents,
    { message: "fare split must sum to totalCents (integer cents, no leak)" },
  );

  export function splitFare(totalCents: number, resolution: CommissionResolution): FareSplit;
  ```
  - `resolveCommissionPct`: return `{ pct: driver.commissionPctOverride, source: "driver_override" }` when the
    override is a number (**including `0`** — test `!= null`, never truthiness), else
    `{ pct: config.commissionPct, source: "platform_base" }`. Pure: no I/O, no `Date`, no defaults invented here.
  - `splitFare`: `commissionCents = commissionCentsFor(totalCents, resolution.pct)`,
    `driverNetCents = totalCents - commissionCents`, returns the object (already satisfying the refinement).
- **PATTERN**: pure-function + explicit-error style of `packages/shared/src/ride-state-machine.ts:49-65`.
- **IMPORTS**: `z`; `COMMISSION_SOURCES`, `CommissionSource` from `./enums`; `commissionCentsFor`,
  `commissionPctSchema`, `eurCurrencySchema`, `nonNegativeCentsSchema` from `./money`; `PlatformConfig` (type
  only) from `./schemas/platform-config`.
- **GOTCHA**: `if (driver.commissionPctOverride)` is a **bug** — a 0% override (the evidenced S6-7 pilot
  scenario) would fall through to the platform base. Use `!= null`.
- **GOTCHA**: `.refine()` returns a `ZodEffects`, which has no `.extend()`/`.omit()`/`.partial()`. If a later
  task needs to compose off the split, compose from the *inner* object. Keep the refinement last.
- **GOTCHA**: this file must not import `./schemas/ride` — `schemas/ride.ts` imports *from here* (Task 6).
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #4

### 5. UPDATE `packages/shared/src/schemas/driver.ts` and `packages/shared/src/schemas/geo.ts`

- **IMPLEMENT** (`driver.ts`): add one field to `driverProfileSchema`:
  ```ts
  /**
   * Per-driver commission override set by admin (#20) — e.g. Atis's evidenced "0% + hourly guarantee"
   * pilot (S6-7). null = use the platform base. Read by `resolveCommissionPct`.
   */
  commissionPctOverride: commissionPctSchema.nullable().default(null),
  ```
  Also swap `balanceCents: z.number().int().default(0)` to `centsSchema.default(0)` — same type, now sourced
  from the money module (this is the "extend existing integer-cents helpers" part of the ticket).
- **IMPLEMENT** (`geo.ts`):
  - Add `slug: z.string().min(1)` to `geozoneSchema` with JSDoc: stable human key (`RIGA_PILOT_DISTRICTS`
    members for the pilot zones); UUIDs are for joins, slugs for seeds and config. Deliberately a free-form
    string, not `z.enum(RIGA_PILOT_DISTRICTS)`, because "first pilot geozones — decide with Dina" is an open
    architecture question and Dina must be able to add a zone without a code change.
  - Add `queueEntrySchema` / `QueueEntry`: `{ driverId: uuid, geozoneId: uuid, position: z.number().int().min(1),
    joinedAt: z.coerce.date() }` — JSDoc citing "izsaukumi rindas kārtībā" / S7-2 / S8-1.
  - Add `geozoneQueueSchema` / `GeozoneQueue`: `{ geozoneId: uuid, updatedAt: z.coerce.date(),
    entries: z.array(queueEntrySchema).default([]) }`. JSDoc: live state lives in Redis lists (#8/#10); this is
    the wire/read shape.
- **PATTERN**: `packages/shared/src/schemas/driver.ts:11-15` for nullable-with-default + JSDoc.
- **IMPORTS**: `driver.ts` adds `import { centsSchema, commissionPctSchema } from "../money";`.
- **GOTCHA**: `position` is 1-based (queue *position*, not array index) — `.min(1)`. #10's Redis list index is
  0-based; the conversion is #10's problem, and saying so in the JSDoc prevents an off-by-one across surfaces.
- **GOTCHA**: adding a **required** `slug` to `geozoneSchema` changes existing parse behaviour. The only
  existing consumer is `tests/schemas.test.ts`'s geozone failure case, which stays failing (good). Check no
  other file constructs a geozone.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck && pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #3, AC #4

### 6. UPDATE `packages/shared/src/schemas/ride.ts` — offer + assignment

- **IMPLEMENT (6a, first)**: swap `fareQuoteSchema`'s inline cent/currency types for the `money.ts` primitives,
  so `ride.ts` has **one** cents idiom rather than two after this ticket:
  `currency: z.literal("EUR")` → `eurCurrencySchema`; `totalCents`, `breakdown.baseCents`, `distanceCents`,
  `timeCents` → `nonNegativeCentsSchema`; `discountCents: z.number().int().nonpositive().default(0)` →
  `nonPositiveCentsSchema.default(0)`. These are type-identical substitutions — no behaviour change, no test
  change. Leave every other line of `fareQuoteSchema` (including its JSDoc) alone.
- **IMPLEMENT (6b)**: append two schemas (keep the existing four untouched above them):
  ```ts
  export const rideAssignmentSchema = z.object({
    rideId: z.string().uuid(),
    driverId: z.string().uuid(),
    source: z.enum(ASSIGNMENT_SOURCES),
    /** Required when source === "dispatcher": the force-assign audit trail (S9-2, S9-4). */
    dispatcherId: z.string().uuid().nullable().default(null),
    /** Free-text reason a dispatcher overrode the algorithm — shown in the admin audit view. */
    reason: z.string().max(280).nullable().default(null),
    assignedAt: z.coerce.date(),
  }).refine(
    (a) => a.source !== "dispatcher" || a.dispatcherId !== null,
    { message: "dispatcher assignments require dispatcherId (audit trail)", path: ["dispatcherId"] },
  );

  export const rideOfferSchema = z.object({
    id: z.string().uuid(),
    rideId: z.string().uuid(),
    driverId: z.string().uuid(),
    status: z.enum(OFFER_STATUSES),
    source: z.enum(ASSIGNMENT_SOURCES),
    sentAt: z.coerce.date(),
    /** Cascade deadline; on expiry the ride goes `offered → requested` and re-offers. */
    expiresAt: z.coerce.date(),
    etaSeconds: z.number().int().nonnegative(),
    pickup: addressPointSchema,
    destination: addressPointSchema,
    /** The full fare the RIDER pays — the driver sees it before accepting (S2-5 is the whole wedge). */
    quote: fareQuoteSchema,
    /** What the driver keeps, with the commission line explicit ("you keep 85%"). */
    split: fareSplitSchema,
    /** 1-based position when this offer came from a geozone queue (S7-2). */
    queuePosition: z.number().int().min(1).optional(),
  });
  ```
- **PATTERN**: `packages/shared/src/schemas/ride.ts:26-42` (`rideRequestSchema`) for field-comment density.
- **IMPORTS**: add `ASSIGNMENT_SOURCES`, `OFFER_STATUSES` to the existing `../enums` import; add
  `import { fareSplitSchema } from "../commission";` and
  `import { eurCurrencySchema, nonNegativeCentsSchema, nonPositiveCentsSchema } from "../money";`.
- **GOTCHA**: `OFFER_STATUSES` is a **flat enum with no transition table by design.** Offer outcomes already
  map onto guarded ride transitions (`offered → accepted`, `offered → requested`). Put that sentence in a code
  comment above the `status` field. Do **not** build a second `assertTransition`-style machine — the repo has
  exactly one guarded state machine and it stays that way.
- **GOTCHA**: `.refine()` on `rideAssignmentSchema` makes it a `ZodEffects`. **Verified against zod 3.25.76 while
  writing this plan**: `refined.omit({ … })` fails with
  `TS2339: Property 'omit' does not exist on type 'ZodEffects<…>'`. Nesting a `ZodEffects` inside another
  `z.object()` and chaining `.nullable().default(null)` onto it both work fine — so `rideSchema` can *contain*
  it (Task 7), it just cannot `.extend()`/`.omit()`/`.pick()` **from** it. That is acceptable here:
  `rideAssignmentSchema` has no `id`/timestamp fields a #6 insert shape would need to strip. It is **not**
  acceptable for `rideSchema` — see Task 7.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #1, AC #4

### 7. UPDATE `packages/shared/src/schemas/ride.ts` — the ride record

- **IMPLEMENT**: extend the existing `rideSchema` (do **not** rename it — see the vocabulary table) with:
  - `geozoneId: z.string().uuid().nullable().default(null)` — pickup zone, drives queue mode + district stats.
  - `assignment: rideAssignmentSchema.nullable().default(null)` — how this ride got its driver.
  - `split: fareSplitSchema.nullable().default(null)` — written at completion (#11); null until then.
  - a JSDoc line above `rideSchema` naming it as the ticket's "RideRecord" so a future session searching for
    that word lands here.
- **IMPLEMENT**: `rideSchema` **stays a plain `z.object`** — no `.refine()`. Express the driver-consistency rule
  as an exported predicate + assert pair instead, mirroring `canTransition`/`assertTransition`
  (`ride-state-machine.ts:49-65`):
  ```ts
  /**
   * `ride.driverId` is the denormalized field #6 indexes; `assignment.driverId` is the audit record.
   * They must not drift. Deliberately a predicate rather than a `.refine()` on `rideSchema`: a refined
   * schema is a `ZodEffects` and loses `.omit()`/`.pick()`/`.extend()`, which #6 needs for Drizzle
   * insert shapes and #9/#11 need for partial reads. Call this at write boundaries (#11).
   */
  export function isRideAssignmentConsistent(ride: Ride): boolean;
  export function assertRideAssignmentConsistent(ride: Ride): void; // throws on false
  ```
- **PATTERN**: `packages/shared/src/schemas/ride.ts:44-56` for the schema;
  `packages/shared/src/ride-state-machine.ts:49-65` for the predicate/assert pair.
- **IMPORTS**: none beyond Task 6's.
- **GOTCHA**: this is the **one** place in the ticket where an invariant is *not* a `.refine()`, and the reason
  is composability, verified empirically (see Task 6's gotcha). Do not "improve" it into a refine later —
  `rideSchema` is the most composed-against schema in the package.
- **GOTCHA**: `assertRideAssignmentConsistent` throws a plain `Error` with a clear message. Do **not** add a new
  error class; `InvalidRideTransitionError` exists for the state machine specifically, and one error class is
  the right number for this package.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #1

### 8. UPDATE `packages/shared/src/realtime-events.ts` — the event catalog

- **IMPLEMENT**: rewrite the file as a zod catalog. Keep the existing file-level JSDoc (updated) and keep the
  three existing exported type names alive as `z.infer` types. **Pin exactly these 8 events** — the list is
  closed for this ticket (see Non-Goals for what was deliberately excluded and why):

  | `RT` key | Event name | Direction | Payload schema |
  |---|---|---|---|
  | `driverLocation` | `driver:location` | driver→server **and** server→dispatch/rider | `driverLocationPingSchema` (in) / `driverLocationEventSchema` (out) |
  | `driverQueue` | `driver:queue` | server→driver | `driverQueueEventSchema` |
  | `rideStatus` | `ride:status` | server→ride room | `rideStatusEventSchema` |
  | `rideOffer` | `ride:offer` | server→driver | `rideOfferEventSchema` |
  | `rideOfferRevoked` | `ride:offer_revoked` | server→driver | `rideOfferRevokedEventSchema` |
  | `rideAssigned` | `ride:assigned` | server→ride room + driver | `rideAssignedEventSchema` |
  | `dispatchBoard` | `dispatch:board` | server→dispatch room | `dispatchBoardEventSchema` |
  | `dispatchUnclaimed` | `dispatch:unclaimed` | server→dispatch room | `dispatchUnclaimedEventSchema` |

  Payloads (all timestamps are ISO strings via `z.string().datetime()` — wire format, not `z.coerce.date()`):
  - `driverLocationPingSchema` — **inbound, untrusted**: `{ location: latLngSchema, heading: z.number().min(0).lt(360).optional(), at: z.string().datetime() }`. **No `driverId`** — the server takes it from the JWT.
  - `driverLocationEventSchema` — outbound: `driverLocationPingSchema.extend({ driverId: z.string().uuid() })`. Its inferred type keeps the existing name `DriverLocationEvent`.
  - `driverQueueEventSchema` — `{ driverId, geozoneId, geozoneSlug: z.string().min(1), position: int ≥1, size: int ≥0, at }`.
  - `rideStatusEventSchema` — `{ rideId, orderId, status: z.enum(RIDE_STATUSES), previousStatus: z.enum(RIDE_STATUSES).nullable().default(null), reason: z.string().max(280).nullable().default(null), at }`. Type name stays `RideStatusEvent`.
  - `rideOfferEventSchema` — **is** `rideOfferSchema` (`export const rideOfferEventSchema = rideOfferSchema;`), type `RideOfferEvent`. One shape, no duplication: the offer contract *is* the wire payload. Note in JSDoc that `sentAt`/`expiresAt` serialize as ISO strings and `z.coerce.date()` re-hydrates them on receipt.
  - `rideOfferRevokedEventSchema` — `{ offerId, rideId, reason: z.enum(["expired","taken","cancelled"]), at }`. Clears the driver's offer card (#15).
  - `rideAssignedEventSchema` — `{ rideId, driverId, source: z.enum(ASSIGNMENT_SOURCES), dispatcherId: uuid.nullable().default(null), at }`.
  - `dispatchUnclaimedEventSchema` — `{ rideId, pickup: addressPointSchema, requestedAt, unclaimedSeconds: int ≥0, offerAttempts: int ≥0 }` — Dina's flash alert (S9-4).
  - `dispatchBoardEventSchema` — thin, deliberately: `{ cityId, at, rides: z.array(z.object({ rideId, status, pickup: addressPointSchema, driverId: uuid.nullable(), unclaimedSeconds: int ≥0 })), drivers: z.array(z.object({ driverId, location: latLngSchema, status: z.enum(DRIVER_STATUSES) })) }`. JSDoc: **#18 owns the board's real shape and will widen this** — it is a snapshot placeholder so the gateway (#7) has something typed to emit.
- **ALSO IMPLEMENT**: room helpers and direction maps:
  ```ts
  /** Room names per .claude/references/realtime-events.md — never build these strings by hand. */
  export const rideRoom = (rideId: string) => `ride:${rideId}` as const;
  export const driverRoom = (driverId: string) => `driver:${driverId}` as const;
  export const dispatchRoom = (cityId: string) => `dispatch:${cityId}` as const;

  /** For Socket.IO generics in #7: `Server<ClientToServerEvents, ServerToClientEvents>`. */
  export interface ClientToServerEvents { [RT.driverLocation]: (p: DriverLocationPing) => void }
  export interface ServerToClientEvents { /* the 7 outbound events */ }
  ```
- **PATTERN**: existing `RT` const object at `realtime-events.ts:9-14` — keep the `as const` object, just add keys.
- **IMPORTS**: `z`; `RIDE_STATUSES` from `./ride-state-machine`; `ASSIGNMENT_SOURCES`, `DRIVER_STATUSES` from
  `./enums`; `addressPointSchema`, `latLngSchema` from `./schemas/geo`; `rideOfferSchema` from `./schemas/ride`.
- **GOTCHA**: the inbound/outbound split on `driver:location` is a **security boundary**, not tidiness. If the
  inbound schema carried `driverId`, any authenticated driver could spoof another driver's position on Dina's
  board. Comment it as such so #8 doesn't "simplify" the two schemas back into one.
- **GOTCHA**: a computed key in an interface (`[RT.driverLocation]: ...`) requires the value to be a literal
  type — the `as const` on `RT` provides that. If TS complains about the computed property, use the literal
  string `"driver:location"` in the interface and keep `RT` as the emit-site source of truth.
- **GOTCHA**: keep the file under 500 lines (root `CLAUDE.md`). Estimate is ~230; if it overruns, split
  payload schemas into `src/events/` rather than trimming JSDoc.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #2

### 9. UPDATE `packages/shared/src/index.ts`

- **IMPLEMENT**: add the three new modules in dependency order, keeping the flat `export *` style:
  ```ts
  export * from "./enums";
  export * from "./money";
  export * from "./ride-state-machine";
  export * from "./schemas/platform-config";
  export * from "./commission";
  export * from "./realtime-events";
  export * from "./schemas/geo";
  /* …existing lines… */
  ```
- **PATTERN**: `packages/shared/src/index.ts` as it stands.
- **GOTCHA**: `export *` collides silently at build time if two modules export the same name. Nothing here
  should collide — but if the build reports a duplicate, rename in the *new* module, never the existing one.
- **VALIDATE**: `pnpm --filter @taxi/shared build` (this is the first task that proves the whole graph compiles)
- **SATISFIES**: AC #2, AC #4

### 10. CREATE `packages/shared/tests/money.test.ts`

- **IMPLEMENT**: `describe("cent primitives")` with 1 expected + 1 edge + 1 failure:
  - expected: `nonNegativeCentsSchema.parse(1250)` → 1250; `centsSchema.parse(-500)` → -500 (ledger case).
  - edge: `commissionCentsFor(0, 15) === 0` and `commissionCentsFor(1000, 0) === 0`.
  - failure: `nonNegativeCentsSchema.safeParse(-1).success === false`; `centsSchema.safeParse(12.5).success === false`
    (**floats are the rule this file exists to enforce**); `commissionPctSchema.safeParse(101).success === false`.
- **PATTERN**: `packages/shared/tests/schemas.test.ts:8-18`.
- **IMPORTS**: `describe, expect, it` from `"vitest"`; the module under test from `"../src/money"`.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #1, AC #4

### 11. CREATE `packages/shared/tests/platform-config.test.ts` and `packages/shared/tests/commission.test.ts`

- **IMPLEMENT** (`platform-config.test.ts`) — this file is where "config not constant" becomes executable:
  - failure: `platformConfigSchema.safeParse({}).success === false`.
  - failure (**the AC**): parsing a config object with `id`/`cityId`/`updatedAt` present but `commissionPct`
    omitted must fail, and the issue path must include `commissionPct` — i.e. there is **no default**. Add a
    comment: "if this test ever needs changing, someone has turned the commission back into a constant."
  - expected: a full valid config parses and `hourlyGuaranteeCents`/`weeklyGuaranteeCents` default to `null`,
    `defaultDispatchMode` to `"auto_match"`.
  - edge: `commissionPct: 0` parses (S6-7 pilot scenario).
- **IMPLEMENT** (`commission.test.ts`):
  - expected: base resolution — `resolveCommissionPct({ commissionPctOverride: null }, config15)` →
    `{ pct: 15, source: "platform_base" }`; `splitFare(2000, …)` → `{ commissionCents: 300, driverNetCents: 1700 }`.
  - edge: **a `0` override wins over a 15 base** — `resolveCommissionPct({ commissionPctOverride: 0 }, config15)`
    → `{ pct: 0, source: "driver_override" }` and `splitFare(2000, …).driverNetCents === 2000`. This is the
    regression test for the `!= null` gotcha.
  - edge (rounding): `splitFare(333, { pct: 15, … }).commissionCents === 50` (49.95 → 50).
  - edge (**the invariant sweep**): for every `total` in `[0, 1, 7, 333, 1299, 2000, 19999, 1_000_000]` × every
    `pct` in `[0, 12.5, 15, 16, 100]`, assert `commissionCents + driverNetCents === totalCents` and that both
    are non-negative integers. This is what catches a future refactor computing the net independently.
  - failure: `fareSplitSchema.safeParse({ …, totalCents: 1000, commissionCents: 150, driverNetCents: 800 })`
    → `false` (sum ≠ total — a leaked cent is rejected at the schema boundary).
- **PATTERN**: `packages/shared/tests/ride-state-machine.test.ts:43-49` for the loop-over-cases style, using
  the `arr[i]!` idiom under `noUncheckedIndexedAccess`.
- **IMPORTS**: `"../src/commission"`, `"../src/schemas/platform-config"`.
- **GOTCHA**: build the test config from `platformConfigSchema.parse({...})` rather than hand-typing an object
  literal, so the test breaks loudly if a required field is added later.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #4, AC #5

### 12. CREATE `packages/shared/tests/realtime-events.test.ts` and UPDATE `packages/shared/tests/schemas.test.ts`

- **IMPLEMENT** (`realtime-events.test.ts`):
  - expected: `driverLocationEventSchema.parse({ driverId, location: riga, at: "2026-08-03T10:00:00.000Z" })`.
  - expected: `rideStatusEventSchema.parse({ … status: "accepted", previousStatus: "offered" … })`.
  - edge: `driverLocationPingSchema` **strips/ignores a client-supplied `driverId`** — parse a ping object that
    includes `driverId` and assert the parsed result has no `driverId` key (zod objects are non-strict by
    default, so unknown keys are dropped; this is the spoofing guard).
  - edge: room helpers — `rideRoom("abc") === "ride:abc"` etc.
  - failure: `driverLocationPingSchema.safeParse({ location: { lat: 91, lng: 0 }, at: "not-a-date" })` → false.
  - completeness: assert `Object.values(RT).length === 8` and that every value matches `/^[a-z]+:[a-z_]+$/`, and
    that every `RT` value appears as a key in either `SERVER_TO_CLIENT_EVENTS`-typed usage or the client map —
    keep this assertion simple (a hand-listed array compared with `Object.values(RT)`) so it fails loudly when
    someone adds a 9th event without wiring it.
- **IMPLEMENT** (`schemas.test.ts` extensions) — new `describe` blocks, mirroring the existing style and reusing
  the file's `riga` fixture:
  - `rideOfferSchema`: expected (full offer parses, `split` sums), edge (`queuePosition: 1` accepted for a
    queue-sourced offer), failure (`queuePosition: 0` rejected).
  - `rideAssignmentSchema`: expected (`auto_match`, no dispatcherId), edge (`dispatcher` + dispatcherId +
    reason parses), failure (`source: "dispatcher"` **without** `dispatcherId` rejected — the audit rule).
  - `rideSchema`: expected (ride with null assignment/split parses), edge (`isRideAssignmentConsistent` is
    `true` when `assignment` is null), failure (`assertRideAssignmentConsistent` **throws** when
    `assignment.driverId` ≠ `ride.driverId`). Add one composability test that locks in the Task 7 decision:
    `expect(() => rideSchema.omit({ id: true })).not.toThrow()` — or simply reference `rideSchema.omit`,
    which fails at *typecheck* if someone turns it into a `ZodEffects`.
  - `geozoneSchema` / `queueEntrySchema`: expected (a `centre` zone with `slug`), edge (`queueModeEnabled: true`
    + a queue with two entries), failure (`position: 0` rejected). Keep the existing <3-vertex failure test.
- **PATTERN**: `packages/shared/tests/schemas.test.ts` wholesale.
- **GOTCHA**: **do not** write a test that reads `.claude/references/realtime-events.md` from disk. `tsconfig`
  sets `module: "commonjs"`, so `import.meta.url` is a typecheck error, and `@types/node` is not a dependency
  of this package (so `__dirname`/`fs` typings are unreliable). The doc-sync check is a shell command in Task 13
  and in Validation Level 4 instead.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #2, AC #5

### 13. UPDATE `.claude/references/realtime-events.md`

- **IMPLEMENT**: regenerate the event table so it lists **all 8** events with direction, payload type name, and
  notes. Keep the existing "Source of truth" line, the Rooms/auth rules, and the "Add an event = add it to `RT`
  + payload type in shared FIRST, then this table" rule. Add two short lines:
  - room helpers `rideRoom()` / `driverRoom()` / `dispatchRoom()` exist in shared — never hand-build room strings;
  - `driver:location` has **two** schemas (inbound ping without `driverId`, outbound event with it) and why.
- **PATTERN**: the existing markdown table in that file — same columns, same tone.
- **GOTCHA**: this is **acceptance criterion #3 of the issue**, and it is the single most likely thing to get
  dropped at the end of a long implementation. Do it now, not in the completion checklist. Verify with the
  command below rather than by eye.
- **VALIDATE** (run from the repo root — prints `undocumented: [...]` and exits 1 on drift):
  ```bash
  node -e '
  const fs=require("fs");
  const src=fs.readFileSync("packages/shared/src/realtime-events.ts","utf8");
  const doc=fs.readFileSync(".claude/references/realtime-events.md","utf8");
  const block=src.slice(src.indexOf("export const RT"), src.indexOf("} as const"));
  const names=[...block.matchAll(/"([a-z]+:[a-z_]+)"/g)].map(m=>m[1]);
  const missing=names.filter(n=>!doc.includes("`"+n+"`"));
  if(!names.length){console.error("no RT events parsed — check the regex");process.exit(1)}
  if(missing.length){console.error("undocumented:",missing);process.exit(1)}
  console.log("OK:",names.length,"events documented");'
  ```
- **SATISFIES**: AC #3

### 14. VALIDATE the whole slice

- **IMPLEMENT**: run every level in the Validation Commands section below, in order, and paste the real output
  into the PR body. Do not report done on any level you did not run.
- **GOTCHA**: `pnpm check` runs `typecheck lint test` — **CI additionally runs `build`** (`.github/workflows/ci.yml`).
  Run the CI command too or you can pass locally and fail in CI.
- **VALIDATE**: `pnpm check && pnpm turbo run build`
- **SATISFIES**: AC #6, AC #7

---

## TESTING STRATEGY

Framework: **vitest 3.2.7**, `environment: node`, `include: ["tests/**/*.test.ts"]`
(`packages/shared/vitest.config.ts`). Tests live in `packages/shared/tests/`, never in `src/` (the build
compiles `src` only). Every test file imports explicitly from `"vitest"` — `globals` is not enabled.

### Unit Tests

Everything in this ticket is a pure function or a schema, so every test is a unit test. Per the repo hard rule,
**each schema group ships ≥1 expected + 1 edge + 1 failure case**, with the case class named in the `it` title
(`(expected)` / `(edge)` / `(failure)`) exactly as the existing files do.

Groups and their files:

| Group | File | Expected / Edge / Failure |
|---|---|---|
| cent primitives | `tests/money.test.ts` | valid cents / zero + negative ledger / float + negative-where-nonneg |
| platform config | `tests/platform-config.test.ts` | full config parses / `commissionPct: 0` / `{}` and missing-commission both rejected |
| commission + split | `tests/commission.test.ts` | base 15% split / `0` override wins + rounding + invariant sweep / non-summing split rejected |
| offer | `tests/schemas.test.ts` | full offer / queue-sourced offer / `queuePosition: 0` |
| assignment | `tests/schemas.test.ts` | auto-match / dispatcher + audit fields / dispatcher without `dispatcherId` |
| ride record | `tests/schemas.test.ts` | null assignment+split parses / consistent when assignment is null, and `.omit()` still available / `assertRideAssignmentConsistent` throws on mismatched `driverId` |
| geozone + queue | `tests/schemas.test.ts` | `centre` zone with slug / queue with 2 entries / `position: 0`, <3 vertices |
| socket payloads | `tests/realtime-events.test.ts` | location + status events / ping strips `driverId`, room helpers / bad lat + bad timestamp |

### Integration Tests

None in this ticket — there is no runtime to integrate with yet (no API, no DB, no socket server). The
*integration* proof for this contract layer is that `pnpm turbo run build` succeeds and downstream packages
typecheck against the built `dist/` — which `pnpm check` already exercises via turbo's `^build` dependency.

The genuine end-to-end proof arrives in #7 (gateway consumes `RT` + direction maps) and #11 (lifecycle consumes
`splitFare`); this plan's job is to make those consumptions type-safe, not to simulate them.

### Edge Cases

Explicitly required, all listed as tasks above:

1. **`commissionPctOverride: 0`** must beat a 15% base (the `!= null` vs truthiness bug). Evidenced scenario: S6-7.
2. **Rounding at the half-cent** — `splitFare(333, 15%)` → 50 + 283 = 333, not 49 + 284 or 50 + 284.
3. **The sum invariant across a sweep** of totals × percentages, including `pct: 0` and `pct: 100`.
4. **`totalCents: 0`** (a fully discounted / guarantee-covered ride) splits to 0 + 0 without dividing by zero.
5. **Client-supplied `driverId` on an inbound location ping** is dropped, not trusted.
6. **`source: "dispatcher"` without `dispatcherId`** is rejected — the force-assign audit trail cannot be optional.
7. **`assignment.driverId` ≠ `ride.driverId`** makes `assertRideAssignmentConsistent` throw — the denormalized
   field cannot silently drift (checked by predicate, not `.refine()`, so `rideSchema` stays composable).
8. **`queuePosition` / `position` of `0`** rejected (queue positions are 1-based).
9. **A float in a cents field** rejected — the single most important rule in the repo.
10. **`RT` has exactly 8 entries** and each matches `domain:action` — a 9th event added without doc + wiring fails.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness. Run from the repo root.
**Baseline before this ticket: 12/12 turbo tasks green** — anything less at the end is a regression you caused.

Every Level-1/2/3 command and every Level-4/5 shell check below was **run against the pre-implementation tree
while writing this plan** and behaves as described (4a printed `OK: 4 events documented` against today's
4-event catalog; 4b/4c/5 printed their OK branches). They are copy-pasteable, not aspirational. Only 4d and 4e
could not be pre-run — they need `dist/`, which requires the implementation.

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/shared typecheck        # tsc --noEmit, strict + noUncheckedIndexedAccess
pnpm turbo run lint                          # @taxi/shared has no lint script — this must stay green for the others
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test              # vitest run — the ticket's own AC
```

### Level 3: Integration / Build

```bash
pnpm turbo run build                         # proves src/ compiles standalone with rootDir: "src"
pnpm check                                   # typecheck + lint + test across all 6 packages
pnpm turbo run typecheck lint test build     # exactly what .github/workflows/ci.yml runs
```

### Level 4: Manual Validation

**a. Doc/catalog sync (AC #3)** — the Task 13 command; must print `OK: 8 events documented`.

**b. Phase gate — "no app imports anything ride-shaped from anywhere but `@taxi/shared`"** (AC #2). The
enforceable form is *no local re-declaration* of a shared contract outside the package:

```bash
grep -rEn '^(export )?(interface|type|enum|const) +(Ride|Offer|Assignment|Fare|Queue|Platform|RIDE_|OFFER_|ASSIGNMENT_|COMMISSION_)' \
  apps services --include='*.ts' --include='*.tsx' 2>/dev/null \
  && echo 'GATE FAILED: contract declared outside @taxi/shared' || echo 'GATE OK'
```

Today this passes trivially (no app has feature code yet) — that is the point: the gate starts green and every
later ticket keeps it green.

**c. Commission is config, not a constant** — the literal launch value must not appear in *code* (the
JSDoc in Task 3 legitimately mentions 15, so comment lines are filtered out):

```bash
grep -rn '\b15\b' packages/shared/src | grep -vE ':[0-9]+: *(\*|//|/\*)' \
  && echo 'CHECK: possible hardcoded commission' || echo 'OK: no bare 15 in shared src code'
```

**d. Public surface smoke test** — everything a downstream ticket needs is actually exported from the barrel:

```bash
pnpm turbo run build >/dev/null && node -e '
const s=require("./packages/shared/dist/index.js");
const need=["rideOfferSchema","rideAssignmentSchema","fareSplitSchema","splitFare","resolveCommissionPct",
            "platformConfigSchema","queueEntrySchema","geozoneQueueSchema","RT","rideRoom","driverRoom",
            "dispatchRoom","RIGA_PILOT_DISTRICTS","OFFER_STATUSES","ASSIGNMENT_SOURCES","COMMISSION_SOURCES",
            "centsSchema","nonNegativeCentsSchema","nonPositiveCentsSchema","commissionCentsFor",
            "isRideAssignmentConsistent","assertRideAssignmentConsistent"];
const missing=need.filter(k=>!(k in s));
if(missing.length){console.error("NOT EXPORTED:",missing);process.exit(1)}
console.log("OK: all",need.length,"contracts exported");'
```

**e. Sanity-read the split** — the driver pitch, on one line:

```bash
node -e '
const {splitFare,resolveCommissionPct}=require("./packages/shared/dist/index.js");
const cfg={commissionPct:15};
console.log(splitFare(2000, resolveCommissionPct({commissionPctOverride:null}, cfg)));
// expect { currency: "EUR", totalCents: 2000, commissionPct: 15, commissionSource: "platform_base",
//          commissionCents: 300, driverNetCents: 1700 }  →  "you keep €17.00 of €20.00"'
```

### Level 5: Additional Validation (Optional)

```bash
# file-size rule (≤500 lines/file, root CLAUDE.md)
find packages/shared/src -name '*.ts' -exec wc -l {} + | grep -v ' total$' | sort -rn | head -5

# no src → tests import (would break the published build)
grep -rn 'from "\.\./tests\|from "\./\.\./tests' packages/shared/src && echo 'BAD' || echo 'OK'
```

---

## ACCEPTANCE CRITERIA

Numbered to match the issue's own list, plus the standing repo gates.

- [ ] **AC #1** — `rideOfferSchema`, `rideAssignmentSchema` exist and `rideSchema` carries `assignment`,
      `split`, `geozoneId`; `rideSchema` is still a plain `z.object` (`.omit()` typechecks) with the
      driver-consistency rule exported as `isRideAssignmentConsistent` / `assertRideAssignmentConsistent`;
      `rideRequestSchema` unchanged and `fareQuoteSchema` semantically unchanged (cent/currency primitives
      swapped for `money.ts` equivalents — identical types). `RIDE_STATUSES` / `ALLOWED_TRANSITIONS` untouched.
- [ ] **AC #2** — the 8-event catalog exists with zod payload schemas, room helpers, and direction maps; no app
      or service declares a ride-shaped contract locally (Level 4b prints `GATE OK`).
- [ ] **AC #3** — geozone `slug` + `queueEntrySchema`/`geozoneQueueSchema` + `RIGA_PILOT_DISTRICTS` exist, and
      `.claude/references/realtime-events.md` documents every `RT` event (Level 4a prints `OK: 8 events documented`).
- [ ] **AC #4** — `platformConfigSchema.commissionPct` is required with **no default**; `resolveCommissionPct`
      and `splitFare` are pure and exported; integer-cent primitives live in `money.ts` and are reused by
      `driver.balanceCents`.
- [ ] **AC #5** — ≥1 expected + 1 edge + 1 failure test per schema group (8 groups, table above); commission
      rounding and the sum invariant covered by the sweep.
- [ ] **AC #6** — `pnpm --filter @taxi/shared test` green.
- [ ] **AC #7** — `pnpm check` green (12/12 turbo tasks, no regression) **and** `pnpm turbo run build` green.
- [ ] No file in `packages/shared/src` exceeds 500 lines.
- [ ] No new runtime dependency added to `packages/shared/package.json`.
- [ ] Every new field with non-obvious intent carries a JSDoc line citing its source (outline §, `S#-#`, or decision date).

---

## COMPLETION CHECKLIST

- [ ] All 14 tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully (Levels 1–4; Level 5 optional)
- [ ] Full test suite passes
- [ ] No linting or type checking errors
- [ ] Level 4d/4e manual checks produce the expected output (pasted into the PR body)
- [ ] Acceptance criteria all met
- [ ] `.claude/references/realtime-events.md` updated **in this same slice** (not deferred)
- [ ] Branch + PR opened with `Closes #2` in the body
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes** (each is a judgement call; none blocks execution):

1. **`Ride`/`FareQuote` keep their names** rather than being renamed to the issue's `RideRecord`/`Quote`.
   Rationale: `fareQuoteSchema` is already referenced by `seams/pricing-strategy.ts`, and renaming some names
   but not all is worse than renaming none. Mitigated by the vocabulary table in Patterns. If you'd rather have
   literal fidelity to the ticket's nouns, say so and it's a 10-minute change (zero external consumers today).
2. **`offerTimeoutSeconds`, `unclaimedAlertSeconds`, `defaultDispatchMode` are in `platformConfigSchema`** even
   though the issue only names `commissionPct` + guarantees. Rationale: contracts written in this same ticket
   (`rideOfferSchema.expiresAt`, `dispatch:unclaimed`) are meaningless without them, and the alternative is #10
   hardcoding them or amending `@taxi/shared` from an api session. Delete the three fields if you disagree —
   nothing else depends on them.
3. **`loyaltyTiers` is deferred to #27**, even though `docs/epics/sakta-cab.architecture.md` line 30 lists it as
   part of `platform_config` at shape level. Rationale: adding an optional field later is purely additive, and
   modelling tiers now means guessing #27's design. `COMMISSION_SOURCES` being a const array is the seam that
   makes the later addition one-line.
4. **`geozone.slug` is a free-form string, not `z.enum(RIGA_PILOT_DISTRICTS)`.** Rationale: "first pilot
   geozones — decide with Dina" is an open architecture question; Dina must be able to add a zone without a
   code change. The enum stays as the typed seed set for #6 and config.
5. **`dispatchBoardEventSchema` is a thin placeholder.** #18 owns the board and will widen it. The alternative
   — guessing Dina's console layout now, before her S9-1 drawing arrives — is worse.
6. **Offer accept/decline stays REST (#10), not a socket event.** Neither the architecture nor the playbook
   pins this; REST wins on idempotency/auth/retry. Recorded here so #10 doesn't re-litigate silently.
7. **`fareQuoteSchema`'s cent/currency fields get swapped for the `money.ts` primitives** (Task 6a) rather than
   left inline. Rationale: the ticket says "integer-cents helpers (extend existing)", and leaving two cents
   idioms inside one file defeats the point of having a money module. The substitutions are type-identical, so
   no test or behaviour changes. The stricter surgical-changes reading — leave `fareQuoteSchema` untouched — is
   also defensible; if you prefer it, skip 6a and drop `nonPositiveCentsSchema` from Task 2.
8. **The plan file lives in `.claude/plans/`** per the `piv-plan-implementation` skill, whereas root `CLAUDE.md`
   and `docs/build-playbook.md` §Step 2 point sessions at `.agent/plans/`. Divergence noted so the artifact
   isn't lost; worth reconciling in the next `system-review`.

**Questions that would change the plan if answered differently** — none is blocking:

- Assumption 1 (naming) is the only one with cross-ticket ripple, and only cosmetically.
- Assumption 2 is the only scope question. Default: keep the three fields.

---

## NOTES (open canvas)

### Why the dependency order is the whole design

The one structural decision in this ticket is where `fareSplitSchema` lives, because it is the only shape
touched by both the money layer and the ride layer. Three options were weighed:

| Option | Consequence |
|---|---|
| `fareSplitSchema` in `schemas/ride.ts`, `splitFare()` in `money.ts` | `money.ts` → `schemas/ride.ts` → … → back toward money. Cycle risk the moment ride schemas want cent primitives. Rejected. |
| Everything money-ish in `money.ts` including the split | `money.ts` would need `CommissionSource` and `PlatformConfig`, dragging config knowledge into the primitives layer. Rejected. |
| **`money.ts` = primitives only; `commission.ts` = resolution + split; `schemas/ride.ts` imports from it** | Strictly layered, no cycles, and `commission.ts` is exactly the file #27 extends. **Chosen.** |

Resulting order — read `index.ts` top-to-bottom and you're reading the dependency graph:
`enums → money → schemas/platform-config → commission → schemas/{geo,driver,ride} → realtime-events`.

### The three invariants, and why one of them is not a `.refine()`

Most of this ticket is shape declaration. Three things are *rules*, cheap to enforce once and expensive to
enforce in five separate services:

1. `commissionCents + driverNetCents === totalCents` — a leaked cent is a driver-trust bug, and driver trust is
   the entire product thesis. Enforced in `fareSplitSchema.refine()`, so every parse anywhere (API response,
   socket payload, DB read in #6) re-checks it for free.
2. `source === "dispatcher" ⇒ dispatcherId !== null` — Dina's override is the anketa's most-cited human-in-the-
   loop feature (S9-2, S9-4), and an override without an actor is an unauditable one. Also a `.refine()`.
3. `assignment.driverId === ride.driverId` — the denormalized-field drift guard. **Not** a `.refine()`, and the
   asymmetry is deliberate.

A `.refine()` returns a `ZodEffects`, which drops `.omit()` / `.pick()` / `.extend()` — verified here against
zod 3.25.76:

```
TS2339: Property 'omit' does not exist on type 'ZodEffects<ZodObject<…>>'
```

For (1) and (2) that costs nothing: `fareSplitSchema` and `rideAssignmentSchema` are leaf shapes with no `id`
or timestamps, so no downstream ticket needs to strip fields off them. `rideSchema` is the opposite — #6 will
want an insert shape (`rideSchema.omit({ id: true, createdAt: true, updatedAt: true })`) for Drizzle, and
#9/#11 may want `.pick()`. Refining it would close that door permanently and #6's agent would discover it
mid-implementation with no guidance. So (3) becomes an exported predicate + assert pair mirroring the
`canTransition`/`assertTransition` idiom already in the package, called at write boundaries in #11.

The general rule this implies, worth carrying into later tickets: **refine leaf schemas, keep composed entity
schemas plain.**

### The transparency wedge, concretely

The reason `rideOfferSchema` carries **both** `quote` and `split` — rather than just a driver payout number — is
that Atis's single most-cited grievance is that he *cannot see what the passenger pays* (S2-5), evidenced by the
€200 → €130 ride (S2-4). If the offer payload only carried `driverNetCents`, the driver app could not show
"€20.00 fare · €3.00 commission · **you keep €17.00**" without a second round-trip, and the first sprint under
deadline pressure would ship the payout number alone. Putting both on the wire at contract time makes the
transparent version the path of least resistance for #15.

### What this ticket deliberately leaves easy to change

- Adding a 9th socket event: one `RT` key + one schema + one doc row, and the Level-4a check tells you if you
  forgot the doc.
- Adding a loyalty tier: widen `CommissionDriverInput`, add `"loyalty_tier"` to `COMMISSION_SOURCES`, add a
  branch in `resolveCommissionPct`. No caller changes, because callers already read `{ pct, source }`.
- Adding a geozone: a DB row with a new slug. No code change.
- Changing the commission: a config row. No code change, no deploy — which is the point of the whole ticket.

### Confidence

**9.5/10** for one-pass success. The work is declarative, the package is 504 lines and fully read, the test
idiom is established, the baseline is 12/12 green, and every Level-1→4 shell command was run against the
pre-implementation tree. The third risk — `.refine()` closing composition on `rideSchema` — was found and
resolved *before* writing the plan by probing zod 3.25.76 directly (Task 7), rather than left for the
executing agent to hit.

The residual 0.5 is two spots, both with a stated fallback in the task itself:
the `z.enum([...DISPATCH_MODES, "dispatcher"])` tuple spread (Task 1 — fallback: write the three members
literally), and the computed-key interface in the Socket.IO direction maps (Task 8 — fallback: use the literal
event string in the interface, keep `RT` as the emit-site source of truth). Neither can silently produce wrong
behaviour; both fail loudly at `typecheck`, which is Level 1.

---

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty until this plan has been executed and something changes. -->
