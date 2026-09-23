# Feature: the driver's ride read carries rider identity (#261)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

A driver's read of their own ride (`GET /rides/:rideId` with a driver token, and the `POST /rides/:rideId/complete` reply) gains a `rider` block holding `displayName` and `phone`. Each field is released only inside a stated status window.

- **Phone: pre-pickup only.** It is released in `accepted`, `arriving` and `arrived`, and is null from `in_progress` on.
- **Name: the whole active ride.** It is released in `accepted`, `arriving`, `arrived` and `in_progress`, and is null once the ride ends.

The driver app's active-ride screen shows the name when there is one, and shows a «Zvanīt pasažierim» button (a `tel:` link) while the phone window is open.

## User Story

As a driver on my way to a pickup
I want to see the rider's name and be able to ring them until they are in the car
So that I can greet the right person and recover when I cannot find them

## Problem Statement

`rideSchema` carries `riderId: z.string().uuid()` and nothing else about the rider (`packages/shared/src/schemas/ride.ts:236-241`). A driver who cannot find the passenger has no recovery path in the app. #259 (the blind-rider protocol) needs the rider's name and cannot start until a name reaches the driver.

## Solution Statement

- **Separate contract.** Add a driver-only wire contract, `driverRideSchema = rideSchema.extend({ rider: driverRideRiderSchema })`, next to `rideSchema` in `@taxi/shared`.
- **Windows as data.** Export the two windows as `as const satisfies readonly RideStatus[]` sets. This mirrors `ACTIVE_DRIVER_RIDE_STATUSES` (`ride-state-machine.ts:35-40`).
- **One projection, server side.** The api builds the block with one pure function, `toDriverRide(ride, identity)`, in a new file. It is called from `findForDriver` and `complete`, so the service stays under the 500-line cap.
- **The same sets, client side.** The driver app gates rendering on the same exported sets. This is not decoration. The reducer's `step_done` changes `ride.status` locally without re-reading (`active-ride-state.ts:239-243`), so after «Sākt braucienu» the phone read at `arrived` is still in memory. Only the client gate hides it.

**Decisions (the user's, 2026-09-23):**

- **D1.** Direct number, pre-pickup only: `accepted`, `arriving` and `arrived`. The rider is in the car after that. There is no masked relay: it needs a telephony provider and per-minute cost against the €100/mo budget.
- **D2.** The name is nullable now. The follow-up is **#269** (a rider-app name field, and a name on phone bookings).
- **D3.** The name comes from `users.display_name` only. It never falls back to `customers.label`. That column is Dina's private annotation ("Anna B. (regulārā)"), and its docblock says nothing there is outward-facing (`db/src/schema/customers.ts:14-20`).

**What the driver will actually see on day one.** `displayName` is null for every rider. `users.display_name` has one writer, `CustomersRepository.findOrCreateUser` (`customers.repository.ts:69-79`), and its only caller passes `undefined` (`customers.service.ts:94`). The rider app has no name screen. This is `observed` 2026-09-23 on `origin/main` at `bfca835` by grep. So the phone half is useful at merge, and the name half is contract plus UI that lights up when #269 lands.

## Out of Scope / Non-Goals

- **Not included:** any way to SET a rider name (#269).
- **Not included:** a masked or proxy number (D1). If it is ever wanted, it enters through a new seam under `packages/shared/src/seams/`, as its own ticket.
- **Not included:** rider identity on `ride:offer`. A driver who has not accepted gets nothing, and neither does a declining driver.
- **Not included:** rider identity on any socket event. `ride:status` and `ride:assigned` carry no ride object (`realtime-events.ts:92-99,158-165`), and that stays true.
- **Not changing:** the rider path of `GET /rides/:rideId` (`rides.controller.ts:111-113`, `RidesService.findForRider`). Its body must not gain a `rider` key.
- **Not changing:** the dispatcher/admin refusal on that route (`@Roles('rider', 'driver')`, `rides.controller.ts:106`).
- **Not included:** the blind-rider arrival announcement (#259).
- **Not included:** an "I can't find the passenger" flow beyond the call button, such as a no-show cancel or a wait timer.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium (four surfaces, no migration: `users.phone` and `users.display_name` already exist)
**Primary Systems Affected**: `packages/shared` (contract), `services/api` rides lifecycle slice, `apps/driver` active-ride slice
**Dependencies**: none new. `tel:` goes through React Native's `Linking`, which is already used by `nav-links.ts`.

## Related Work

**Implements**: #261 · **Epic**: #15's deferred scope (`docs/epics/sakta-cab.prd.md` §5; architecture `docs/epics/sakta-cab.architecture.md`, with no decision on rider PII, so D1–D3 are ticket-level)

**Back-references:**

- `.claude/plans/driver-offers-active-ride.md` §Out of Scope: where this was deferred from #15.
- `services/api/src/features/rides/rider-visible-ride.ts`: the precedent for a role-specific projection of `Ride`, where the type makes the guarantee structural.

**Forward-references:**

- #269: riders get a name (it fills `rider.displayName`).
- #259: the blind-rider protocol (reads `rider.displayName` at `arrived`).

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `packages/shared/src/schemas/ride.ts` (lines 235-274): `rideSchema` is a plain `z.object`, so `.extend()` works. The docblock at 268-274 explains why it must never become a `ZodEffects`.
- `packages/shared/src/schemas/user.ts` (lines 4-7, 15): `phoneSchema` (E.164) and the `displayName` bounds (1–120).
- `packages/shared/src/ride-state-machine.ts` (lines 26-40): `ACTIVE_DRIVER_RIDE_STATUSES` is the pattern for an exported status set.
- `services/api/src/features/rides/rides.controller.ts` (lines 90-114): the role-branching read. Its return type must name both projections.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` (lines 130-165, `complete`; lines 350-380, `findForDriver`): the two driver reads. The file is **496 lines** (`observed`, `wc -l`), against a **500-line cap**.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts` (158 lines): where the identity query goes. The `Db` injection is at line 33.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.controller.ts` (lines 66-75): the `complete` route's `Promise<{ ride: Ride }>`.
- `services/api/src/features/rides/rider-visible-ride.ts`: the projection-type precedent to mirror.
- `services/api/src/features/rides/lifecycle/ride-read.integration.spec.ts` (lines 148-160 helpers, 202 `bookAndAccept`, 328-368 the rider-vs-driver projection test): the spec to extend. Its E.164 range is `+371300`.
- `services/api/test/harness.ts` (lines 689-703): `phoneFor` and `insertUser`.
- `apps/driver/src/features/active-ride/active-ride-state.ts` (lines 8-61 types, 156-170 `loaded`, 239-250 `step_done`, 275-288 `completed`): every place `Ride` is the state type.
- `apps/driver/src/features/active-ride/use-active-ride.tsx` (lines 46-51 `completeResponse`, 105-116 `fetch_ride`): both parse with `rideSchema` today.
- `apps/driver/src/features/active-ride/active-ride-screen.tsx` (lines 136-212): where the name line and the call button go.
- `apps/driver/src/features/active-ride/nav-links.ts` (lines 44-50): `openNavigation`, the `Linking.openURL` + catch pattern.
- `apps/driver/src/features/active-ride/active-ride-screen.test.tsx` (lines 1-60): the `ride()` fixture to extend.
- `.claude/references/logging-standard.md:14`: never log a full phone number (mask to last 3 digits).
- `.claude/references/ride-state-machine.md`: read before touching anything status-shaped.

### New Files to Create

- `services/api/src/features/rides/lifecycle/driver-ride.ts`: the pure `toDriverRide(ride, identity)` projection. The windows are applied here and nowhere else server-side.
- `services/api/src/features/rides/lifecycle/driver-ride.spec.ts`: unit cases for the windows, all 14 statuses.
- `packages/shared/tests/schemas-driver-ride.test.ts`: the contract and the two sets. Shared tests live in `packages/shared/tests/`, not beside the source; the schema files follow the `schemas-*.test.ts` naming (`schemas-ride-record.test.ts` is the closest sibling), all `observed` by `ls`. The set-membership pins can go in the existing `tests/ride-state-machine.test.ts` instead.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [React Native `Linking.openURL`](https://reactnative.dev/docs/linking#openurl): `tel:` needs no `canOpenURL` pre-check, and no Android `<queries>` entry when it is only opened. It rejects on a simulator with no dialler, so catch it the way `openNavigation` does.
- [Zod `.extend`](https://zod.dev/api#extend): valid on `ZodObject` only, which is why `rideSchema` must stay unrefined.

### Patterns to Follow

**Exported status set (shared):**

```ts
export const ACTIVE_DRIVER_RIDE_STATUSES = [
  'accepted', 'arriving', 'arrived', 'in_progress',
] as const satisfies readonly RideStatus[];
```

**Projection type making a guarantee structural** (`rider-visible-ride.ts`):

```ts
export type RiderVisibleRide = Omit<Ride, 'split'> & { split: null };
```

**Linking with a swallowed rejection** (`nav-links.ts:44-50`): `await Linking.openURL(url)` in a `try`, `.catch(() => undefined)` on the fallback.

**Logging:** the api's structured logger with `event`, ids and `at`, as at `ride-lifecycle.service.ts:359-365`. **Never put the phone or the name in a log line.** This ticket adds no log line; if you add one, it carries `rideId` and `driverId` only.

---

## UX (driver app, active-ride screen)

**Breadboard** (place → [affordance] → place):

```
Active ride (accepted | arriving | arrived)
  title · payment pill · [rider name line, when named] · pickup · destination · fare
  [step button]   [Zvanīt pasažierim]  → OS dialler (tel:+371…)  → back to Active ride
  [Google Maps] [Waze]

Active ride (in_progress)
  title · payment pill · [rider name line, when named] · pickup · destination · fare
  [step button]   (no call button)
```

- **Placement.** The call button sits directly under the step button, `variant="secondary"`, `size="md"` (44 px minimum, which the `Button` component already enforces). It keeps the primary step button the largest target.
- **Name line.** `driver.ride.rider_name`, «Pasažieris: {name}». It is a plain `Text` above the pickup line and is rendered only when `displayName` is non-null and the status is in the name window.

**States:**

- **Loading.** Unchanged (`ride-loading` spinner). There is no rider block before the ride loads.
- **Empty.**
  - `displayName` null: no name line, and no placeholder text. The screen reads as it does today.
  - `phone` null inside the window: no call button. This cannot happen for a real rider, because `users.phone` is `NOT NULL` (`users.ts:7`). It is still handled, because the contract is nullable.
- **Error.** `Linking.openURL` rejecting (no dialler: tablet, simulator) is swallowed silently, as the nav links do. Nothing to show: the OS gave no dialler, and a banner cannot fix that.
- **Offline.** The call button still works. The number was read while online, and a phone call needs no data connection. This is the one affordance on the screen that works offline.

**Accessibility:**

- The button label is «Zvanīt pasažierim», with `accessibilityHint` = the name when present (driver.ride.call_rider_hint «Zvana {name}»). With no name, there is no hint.
- The number is never in the label. A screen reader reading nine digits aloud is noise, and the dialler reads it anyway.
- The visible focus state comes from `Button`'s existing focus ring (ui-decisions 2026-08-31).

**Friction audit** (intent "ring the rider" → done). **1 tap, 1 decision**: tap «Zvanīt pasažierim», and the OS dialler places the call.

- A confirmation step ("Call Anna?") is rejected. A mis-tap costs one hang-up, and a confirmation costs every intended call a second tap while driving.
- The OS dialler's own confirmation on iOS (the `tel:` prompt) is outside our control and counts as tap 2 on iOS only. That is `expected`, and the Level 4 step records it.

---

## IMPLEMENTATION PLAN

### Phase 1: Contract (`packages/shared`)

Add `RIDER_PHONE_VISIBLE_STATUSES`, `RIDER_NAME_VISIBLE_STATUSES`, `driverRideRiderSchema`, `driverRideSchema`, `DriverRide`, and six catalog entries (two keys × LV/RU/EN). Rebuild `dist`: the apps import shared from `dist`.

### Phase 2: api projection and wiring

**Depends on:** Phase 1

- `findRiderIdentity(riderId)` in the lifecycle repository.
- `toDriverRide` in a new file.
- `findForDriver` and `complete` return `DriverRide`, and the controller types follow.

### Phase 3: Driver app

**Depends on:** Phase 1 · **Independent of:** Phase 2 (tests use fixtures; the two meet only in Level 4)

- The state type becomes `DriverRide`.
- Both parsers use `driverRideSchema`.
- The screen renders the name line and the call button behind the shared sets.

### Phase 4: Testing & Validation

Unit (shared, api, driver) + integration (`ride-read.integration.spec.ts`) + the gate + Level 4 on the emulator.

---

## STEP-BY-STEP TASKS

### ADD status windows to `packages/shared/src/ride-state-machine.ts`

- **IMPLEMENT**: directly under `ACTIVE_DRIVER_RIDE_STATUSES`:

  ```ts
  /**
   * When a driver may see the rider's phone (#261, D1): from acceptance until
   * the rider is in the car. Pre-pickup only — once `in_progress` the number
   * has no job left, and the api returns null. The driver app gates on this
   * SAME set, because its reducer moves `ride.status` locally without a re-read.
   */
  export const RIDER_PHONE_VISIBLE_STATUSES = [
    'accepted', 'arriving', 'arrived',
  ] as const satisfies readonly RideStatus[];

  /** When a driver may see the rider's name: the whole active ride (#261). */
  export const RIDER_NAME_VISIBLE_STATUSES = ACTIVE_DRIVER_RIDE_STATUSES;

  export function isInStatusSet(
    set: readonly RideStatus[],
    status: RideStatus,
  ): boolean {
    return set.includes(status);
  }
  ```

  Check first whether an equivalent membership helper already exists: `grep -n "includes(status\|\.includes(" packages/shared/src/ride-state-machine.ts`. Reuse it if so, and drop `isInStatusSet`.
- **PATTERN**: `ride-state-machine.ts:35-40`.
- **GOTCHA**: `readonly ['accepted', …].includes(x: RideStatus)` fails typecheck because the tuple's element type is narrower than `RideStatus`. That is why the helper takes `readonly RideStatus[]`.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC2, AC5

### ADD `driverRideRiderSchema` / `driverRideSchema` to `packages/shared/src/schemas/ride.ts`

- **IMPLEMENT**: after `rideSchema` / `type Ride`:

  ```ts
  /**
   * What a DRIVER's read of their own ride adds (#261). Both fields are
   * nullable and window-gated server-side (`RIDER_*_VISIBLE_STATUSES`), never
   * merely absent: a null says "not now", and the parse fails loudly if the
   * block is missing. The rider's own read never carries it.
   */
  export const driverRideRiderSchema = z.object({
    displayName: z.string().min(1).max(120).nullable(),
    phone: phoneSchema.nullable(),
  });
  export const driverRideSchema = rideSchema.extend({
    rider: driverRideRiderSchema,
  });
  export type DriverRide = z.infer<typeof driverRideSchema>;
  ```

  Import `phoneSchema` from `./user`. Check that `./user` does not import `./ride` (a cycle): `grep -n "from './ride'" packages/shared/src/schemas/user.ts`.
- **PATTERN**: `ride.ts:235-273`. Bounds come from `user.ts:15`.
- **GOTCHA**: no `.default()` on `rider`. A default would let a rider-path body (no `rider` key) parse as a driver ride with an empty block, which is precisely the regression the integration test must catch.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck && pnpm --filter @taxi/shared lint`
- **SATISFIES**: AC1

### ADD catalog keys: `packages/shared/src/i18n/{lv,ru,en}.ts`

- **IMPLEMENT**: after `'driver.ride.reload'`:

  | key | lv | ru | en |
  |---|---|---|---|
  | `driver.ride.rider_name` | `Pasažieris: {name}` | `Пассажир: {name}` | `Rider: {name}` |
  | `driver.ride.call_rider` | `Zvanīt pasažierim` | `Позвонить пассажиру` | `Call rider` |
  | `driver.ride.call_rider_hint` | `Zvana {name}` | `Звонок: {name}` | `Calls {name}` |

- **GOTCHA**: the catalogs are typed against one key set. Adding to one file only fails typecheck, which is the intended check.
- **VALIDATE**: `pnpm --filter @taxi/shared build && grep -c "call_rider" packages/shared/dist/i18n/lv.js` → `2`
- **SATISFIES**: AC4

### CREATE shared tests for the contract

- **IMPLEMENT**: a vitest file with three cases:
  - **expected**: a full body with `rider: { displayName: 'Anna', phone: '+37120000003' }` parses.
  - **edge**: `rider: { displayName: null, phone: null }` parses. Also pin both set memberships as literal arrays, so a later edit that widens the phone window fails here.
  - **failure**: a body with no `rider` key throws, and a non-E.164 phone throws.
- **PATTERN**: `packages/shared/tests/schemas-ride-record.test.ts`.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC1, AC2

### ADD `findRiderIdentity` to `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts`

- **IMPLEMENT**:

  ```ts
  /** The rider's phone and display name, for `toDriverRide` (#261). */
  async findRiderIdentity(
    riderId: string,
  ): Promise<{ phone: string; displayName: string | null } | undefined> {
    const [row] = await this.db
      .select({ phone: users.phone, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, riderId))
      .limit(1);
    return row;
  }
  ```

  Import `users` from `@taxi/db`.
- **GOTCHA**: a separate query rather than a join inside `findWithQuote`. `findWithQuote` is shared with the rider path and `readRide`, so widening it would send identity data through code the rider path runs.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC1

### CREATE `services/api/src/features/rides/lifecycle/driver-ride.ts`

- **IMPLEMENT**:

  ```ts
  import {
    isInStatusSet, RIDER_NAME_VISIBLE_STATUSES, RIDER_PHONE_VISIBLE_STATUSES,
    type DriverRide, type Ride,
  } from '@taxi/shared';

  /**
   * The driver's projection of a ride (#261). The windows are applied HERE
   * and nowhere else server-side, keyed on the SNAPSHOT's own status, so the
   * block is always consistent with the `status` it travels with.
   *
   * `identity` undefined = no users row, which `rides.rider_id`'s FK forbids;
   * nulls rather than a throw, because the ride is still the driver's to finish.
   */
  export function toDriverRide(
    ride: Ride,
    identity: { phone: string; displayName: string | null } | undefined,
  ): DriverRide {
    return {
      ...ride,
      rider: {
        displayName: isInStatusSet(RIDER_NAME_VISIBLE_STATUSES, ride.status)
          ? (identity?.displayName ?? null) : null,
        phone: isInStatusSet(RIDER_PHONE_VISIBLE_STATUSES, ride.status)
          ? (identity?.phone ?? null) : null,
      },
    };
  }
  ```

- **GOTCHA**: `users.display_name` is unconstrained `text`, while the contract caps it at 120 and requires at least 1. An empty string or an over-long name makes the app's parse fail the WHOLE ride read. So normalise here:
  - `trim()`, and an empty result becomes `null`;
  - over 120, `slice(0, 120)`.

  Do not rely on the writer (#269) to validate.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC2, AC3

### CREATE `services/api/src/features/rides/lifecycle/driver-ride.spec.ts`

- **IMPLEMENT**: one `it.each(RIDE_STATUSES)` table asserting `{ displayName, phone }` presence per status, plus three cases:
  - **expected**: `arrived` gives both.
  - **edge**: `in_progress` gives the name and a null phone. Also: a whitespace-only name becomes null, and a 130-character name comes back at 120.
  - **failure**: identity undefined gives both null, and `completed` gives both null.
- **GOTCHA**: build the `Ride` fixture with `rideSchema.parse`, never a cast. Parse bodies with `driverRideSchema.parse(result)`, so the projection's output is checked against the contract.
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/rides/lifecycle/driver-ride.spec.ts`
- **SATISFIES**: AC2, AC3

### UPDATE `ride-lifecycle.service.ts`: `findForDriver` and `complete` return `DriverRide`

- **IMPLEMENT**:
  - `findForDriver`: `return toDriverRide(found.ride, await this.lifecycle.findRiderIdentity(found.ride.riderId));`.
  - `complete`: its `{ ride }`, likewise.

  Return types become `Promise<DriverRide>` and `Promise<{ ride: DriverRide }>`. First confirm that `this.lifecycle` is the `RideLifecycleRepository` field name: `grep -n "private readonly" ride-lifecycle.service.ts`.
- **GOTCHA**: **the 500-line cap.** The file is 496 lines (`observed`), and `max-lines` counts every line including comments. Keep the net change under +4. Put the explanation in `driver-ride.ts`'s docblock, not here. If it goes over, move `findForDriver` whole into `driver-ride.ts` as a function taking its dependencies, rather than trimming unrelated comments. Check with `wc -l` before lint does.
- **GOTCHA**: `complete` returns a ride at `completed`, so both fields are null by the window. It still goes through `toDriverRide`, because the app's `completeResponse` parses `driverRideSchema` and requires the block.
- **VALIDATE**: `wc -l services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` → ≤ 500; `pnpm --filter @taxi/api lint`
- **SATISFIES**: AC1, AC3

### UPDATE controller return types

- **IMPLEMENT**:
  - `rides.controller.ts:110`: `Promise<Ride | DriverRide>`.
  - `ride-lifecycle.controller.ts:73`: `Promise<{ ride: DriverRide }>`.

  Rename nothing else.
- **GOTCHA**: `DriverRide` is assignable to `Ride`, so leaving `Promise<Ride>` would typecheck and silently document the wrong contract. Change it anyway.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC1

### UPDATE `services/api/src/features/rides/lifecycle/ride-read.integration.spec.ts`

- **IMPLEMENT**: set the rider's name via `ctx.db.update(users).set({ displayName: 'Anna Bērziņa' }).where(eq(users.id, r.id))` (the harness has no name setter, and #269 owns the real writer). Then add:
  - **expected**: book and accept, then `GET` as the driver. `driverRideSchema.parse(body).rider` equals `{ displayName: 'Anna Bērziņa', phone: p(n) }`. Step `arriving` and `arrived`, and the same holds.
  - **edge**: step `start`, then `GET` as the driver. The name is present and the phone is null. Step `complete`: the `complete` reply's `ride.rider` is both null, and so is a `GET` after it.
  - **failure (rider path unchanged)**: extend the existing R1 test (lines 328-368) with `expect(riderRes.body).not.toHaveProperty('rider')` on the RAW body. `rideSchema.parse` strips unknown keys, so asserting on the parsed object would pass against a leak.
- **PATTERN**: the helpers at lines 148-202; phones from `p(n)` within the file's `+371300` range. Pick unused `n`s: `grep -n "rider(\|onlineDriver(" ride-read.integration.spec.ts`.
- **GOTCHA**: a revert probe is owed. Temporarily make `findForRider` return `toDriverRide(...)` and confirm the failure case goes RED. Then restore. Record both runs in the report.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api exec jest src/features/rides/lifecycle/ride-read.integration.spec.ts`
- **SATISFIES**: AC1, AC3, AC6

### UPDATE `apps/driver/src/features/active-ride/active-ride-state.ts` and `use-active-ride.tsx`

- **IMPLEMENT**:
  - `Ride` becomes `DriverRide` in the state (`ride`, `ended.completed.ride`) and in the `loaded`/`completed` events.
  - `use-active-ride.tsx:110`: `schema: driverRideSchema`.
  - `completeResponse` parses `driverRideSchema`.
- **GOTCHA**: do NOT clear `rider.phone` in `step_done`. The render gate owns the window client-side, and one owner is the rule. A reducer that also nulls it creates two sources that can disagree.
- **VALIDATE**: `pnpm --filter @taxi/driver typecheck`
- **SATISFIES**: AC5

### UPDATE `apps/driver/src/features/active-ride/active-ride-screen.tsx`

- **IMPLEMENT**:
  - A name line `t('driver.ride.rider_name', { name })` above the pickup line, when `ride.rider.displayName` is set and `isInStatusSet(RIDER_NAME_VISIBLE_STATUSES, ride.status)` holds.
  - A `Button variant="secondary" label={t('driver.ride.call_rider')} testID="call-rider"`, when `ride.rider.phone` is set and `isInStatusSet(RIDER_PHONE_VISIBLE_STATUSES, ride.status)` holds. It carries `accessibilityHint={name ? t('driver.ride.call_rider_hint', { name }) : undefined}`, and `onPress={() => void callRider(phone)}`.
  - Add `callRider` to `nav-links.ts`: `Linking.openURL(\`tel:${phone}\`).catch(() => undefined)`. `Button` does NOT accept `accessibilityHint` today: `ButtonProps` at `apps/driver/src/components/Button.tsx:13-26` has `label`, `onPress`, `variant`, `disabled`, `loading`, `accessibilityRole`, `accessibilityState`, `size` and `testID` (`observed`). Add an optional `accessibilityHint?: string` pass-through to the underlying `Pressable`, and a case in `Button.test.tsx`.
- **PATTERN**: the nav buttons at `active-ride-screen.tsx:192-210`; `openNavigation` at `nav-links.ts:44-50`.
- **GOTCHA**: the file is 231 lines; stay well under 500.
- **VALIDATE**: `pnpm --filter @taxi/driver typecheck && pnpm --filter @taxi/driver lint`
- **SATISFIES**: AC4, AC5

### UPDATE `apps/driver/src/features/active-ride/active-ride-screen.test.tsx` (and the state/hook tests' fixtures)

- **IMPLEMENT**: the fixture becomes `driverRideSchema.parse({ …, rider: { displayName: 'Anna', phone: '+37120000003' } })`. Add three cases:
  - **expected**: at `arrived` the name line and the `call-rider` button render. Pressing it calls `Linking.openURL('tel:+37120000003')`, spied with `mockImplementation`.
  - **edge (the stale-phone case)**: the fixture carries a phone but the status is `in_progress`. There is no `call-rider` button, and the name line is present. This is the test that pins the client gate.
  - **failure**: `displayName: null` gives no name line and no hint on the button. `openURL` rejecting is swallowed: no throw, and nothing rendered.
- **GOTCHA**: RNTL 14 needs `await render`, `await fireEvent.press` and `await act(async …)` always, because un-awaited `act` leaks state into later tests. Also: `grep -rln "rideSchema" apps/driver/src` finds every fixture that must become `driverRideSchema`. `use-active-ride.test.tsx` and `active-ride-state.test.ts` both build `Ride`s.
- **VALIDATE**: `pnpm --filter @taxi/driver test`
- **SATISFIES**: AC4, AC5

---

## TESTING STRATEGY

### Unit Tests

- `@taxi/shared` (vitest): the contract parses and fails as specified, and the sets are pinned literally.
- `@taxi/api` (jest): `toDriverRide` across all 14 statuses (`RIDE_STATUSES.length` = 14, `ride-state-machine.ts:1-16`, counted), with normalisation.
- `@taxi/driver` (jest + RNTL 14): rendering and gating on the screen, and the `tel:` call.

### Integration Tests

`ride-read.integration.spec.ts` drives the real HTTP order the app uses: the rider books, the driver accepts through `POST /dispatch/offers/:id/accept`, then the driver `GET`s, steps, and `GET`s again. That is `bookAndAccept` (line 202), already the app's order. This ticket touches no socket or room join, so no delivery test is owed.

### Edge Cases

| Edge case | Verified in |
|---|---|
| phone withheld at `in_progress` (server) | `driver-ride.spec.ts` + integration edge case |
| phone kept in memory after a local `step_done`, hidden by the client gate | `active-ride-screen.test.tsx` edge case |
| rider path gains no `rider` key | integration failure case, on the RAW body |
| no display name (every rider today) | `driver-ride.spec.ts`, `active-ride-screen.test.tsx` failure |
| blank or over-long `display_name` in the DB | `driver-ride.spec.ts` edge |
| no dialler on the device | `active-ride-screen.test.tsx` failure (rejected `openURL`) |
| `complete` reply at `completed` | integration edge case |
| iOS `tel:` confirmation prompt | Level 4 step 6 (`expected`, not reachable here, owed by #257's hardware) |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`pnpm --filter @taxi/shared build && pnpm check`

### Level 2: Unit Tests

`pnpm --filter @taxi/shared test && pnpm --filter @taxi/driver test && pnpm --filter @taxi/api exec jest src/features/rides/lifecycle/driver-ride.spec.ts`

### Level 3: Integration Tests + the gate

Clear stale output first:

```bash
node -e "for (const d of ['apps/dispatch/.next']) require('fs').rmSync(d,{recursive:true,force:true})"
```

Then the gate:

```bash
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force
```

This needs a `.env` in the worktree. The PreToolUse hook blocks the agent from copying it, so ask the user to run the copy with `!`.

### Level 4: Manual Validation (emulator `sakta224`)

State comes from the #15 device-pass recipe, `.claude/plans/driver-15-offers-device-pass.md` §"START the stack and the accounts". The dispatcher is `+37120000001`, the driver `+37120000002`, and the rider session `+37120000003`.

1. Give the rider a name. No product path sets one (#269):
   ```bash
   docker exec taxi-db-1 psql -U postgres -d taxi -c "update users set display_name='Anna Bērziņa' where phone='+37120000003'"
   ```
   Check the db and user names against `.env.example` first.
2. Book as that rider (`POST /rides` with the rider bearer) and accept on the emulator.
   - **Expect:** «Pasažieris: Anna Bērziņa» and a «Zvanīt pasažierim» button.
3. Tap «Zvanīt pasažierim».
   - **Expect:** the emulator dialler opens with `+37120000003`.
   - **Artifact:** `adb shell dumpsys activity activities | grep -i dial`, or a screencap.
4. Tap «Esmu klāt», then «Sākt braucienu».
   - **Expect:** the button disappears at `in_progress` with no reload, and the name stays.
   - **Artifact:** a screencap after each tap.
5. With TalkBack on, focus the button.
   - **Expect:** «Zvanīt pasažierim», then the hint «Zvana Anna Bērziņa». No digits are spoken (`Speaking fragment` in logcat).
6. **Not performable here:** the iOS `tel:` confirmation prompt, and VoiceOver. Both are owed by #257's hardware blocker. Say so in the report; do not mark them passed.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1**: A driver's `GET /rides/:rideId` and `POST /rides/:rideId/complete` bodies parse as `driverRideSchema` with a `rider` block. The rider's `GET` body has no `rider` key (raw-body assertion).
- [ ] **AC2**: The phone is non-null only in `accepted`, `arriving` and `arrived`, and the name only in those plus `in_progress`, enforced by `toDriverRide` over all 14 statuses.
- [ ] **AC3**: A blank, missing or over-long stored name never fails the driver's ride read.
- [ ] **AC4**: The active-ride screen shows «Pasažieris: {name}» and a 44 px «Zvanīt pasažierim» `tel:` button, with the number absent from the accessible name, in LV/RU/EN.
- [ ] **AC5**: The call button disappears at `in_progress` without a re-read (client gate on the shared set).
- [ ] **AC6**: The rider path of `GET /rides/:rideId` is unchanged, shown by the revert probe (RED with the leak, GREEN without).
- [ ] **AC7**: The gate is green: `pnpm turbo run typecheck lint test build --force` with `REDIS_TEST_URL`.
- [ ] **AC8**: Level 4 steps 1–5 are run on `sakta224` with artifacts; step 6 is recorded as owed by #257.
- [ ] **AC9**: No log line carries a rider phone or name: `git diff origin/main -- services/api | grep -n "logger" ` shows no new field beyond ids.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works
- [ ] Acceptance criteria all met
- [ ] `ride-lifecycle.service.ts` ≤ 500 lines

---

## OPEN QUESTIONS / ASSUMPTIONS

- **A1.** The `tel:` number is the rider's `users.phone`, which is the number they signed in with (app) or rang from (phone booking).
  - **Worst case: a phone booking made on a venue landline.** The driver rings the hotel desk, not the guest. That is still the right party to ring for a venue pickup, and it is no worse than Dina calling back.
- **A2.** **Worst case of the snapshot race.** `findForDriver` reads the ride and then the identity, and the status can move between the two reads. The window is keyed on the snapshot's own status, so the body is self-consistent. The worst case is a phone arriving with a snapshot at `arrived` while the ride is already `in_progress`. The next `ride:status` event updates `state.ride.status`, and the client gate hides the button. A lost event leaves it visible until the next read.
  - **Worst case: the button stays up for the rest of the ride.** Exposure is bounded by the ride the driver is already on, with a number they were entitled to a moment earlier. Accepted; not worth a transaction.
- **A3.** The name window includes `in_progress` so #259 and the greeting can use it through pickup. Revisit only if #269's product copy says otherwise.
- **Q1 (not blocking).** Should Dina's board see the rider name? No. The board already shows `customers.label` for phone bookings, and that is #269's concern.

## NOTES (open canvas)

**Why a separate `driverRideSchema` and not an optional field on `rideSchema`.** The rider app (`apps/rider/src/features/ride-status/use-ride-status.tsx`) and the api both parse `rideSchema`; the dispatch app does not (`observed`, `grep -rln rideSchema apps/dispatch/src apps/rider/src`). An optional `rider` there would make "a rider body carrying rider contact" a *legal* value everywhere. That is the same trap `rider-visible-ride.ts` documents for `split`. A driver-only extension makes the leak a type error on the rider side and a missing key on the driver side.

**Why the window lives in shared.** The client needs the set anyway (`step_done` does not re-read). Two copies of `['accepted','arriving','arrived']` would drift, and the drift would fail open: the button would stay visible.

**Rejected: re-read on every `step_done`.** It would let the server alone own the window, but it adds a request per step to a flow that deliberately treats REST as authoritative for the step just taken (`active-ride-state.ts:240-241`). It also still leaves the in-memory copy until the read lands.

**Rejected: masked relay now.** It is the better privacy answer and it is worth a spike later. The PRD's budget guardrail (<€100/mo) and the absence of a telephony seam make it a ticket of its own (D1).

## AMENDMENTS
