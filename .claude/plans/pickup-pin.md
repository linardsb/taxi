# Feature: PIN pickup — the rider's 4-digit code gates `arrived → in_progress` (#258)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

Every `file:line` below was read on `origin/main` at `1129710` (2026-09-23). Re-read before editing; lines drift.

## Feature Description

A rider can opt in, per booking, to a pickup PIN. When they do, the api mints a random 4-digit PIN at ride creation. The rider sees it on the status screen, hears it in the arrival announcement and, for phone bookings, gets it in the arrival SMS. The driver must type it into the active-ride screen before `POST /rides/:rideId/start` is accepted. Five wrong entries lock the start; after that the only way out is a cancellation, which exists today. The PIN never reaches the driver, the dispatcher or the tracking page.

This is a from-scratch slice across four surfaces: `packages/shared` (contract), `db` (two columns), `services/api` (mint, rider read, start gate, SMS) and the two mobile apps. `apps/dispatch` changes by one literal only (see T3).

## User Story

As a rider who wants to be sure they are getting into the right car
I want to opt in to a 4-digit PIN that the driver must enter before the trip starts
So that a car that is not mine cannot start my ride, and I can check it without looking at anything (the PIN is spoken)

## Problem Statement

`arrived → in_progress` is asserted by the driver alone (`ride-lifecycle.controller.ts:56-64` → `driverStep('start')`). Nothing checks that the person who got in is the rider who booked. `docs/research/rider-ux-evidence.md` §6.1 ranks PIN verification #3 in its top-10: Uber's model, non-visual by design. `docs/ux-metrics-ledger.md:16` already carries a "Wrong-car starts (PIN mismatch events)" row with no producer.

## Solution Statement

- **Contract** (`@taxi/shared`): `rideOptionsSchema.pickupPin: boolean` (default `false`); `pickupPinSchema` (`/^\d{4}$/`); `rideStartSchema` (`{ pin?: PickupPin }`, a missing body defaulting to `{}`); `riderRideSchema = rideSchema.extend({ pickupPin })`. **`rideSchema` itself never carries the PIN.** Driver, dispatcher and settlement responses therefore exclude it by construction (fail closed).
- **Storage** (`db`): `rides.pickup_pin text NULL` (NULL = no PIN, which covers every legacy row) and `rides.pickup_pin_failures integer NOT NULL DEFAULT 0`.
- **Mint**: `RidesService.createRide` sets `pickupPin: request.options.pickupPin ? mintPickupPin() : null`. `mintPickupPin` uses `crypto.randomInt`, the same generator as the OTP (`auth.service.ts:174-175`). The rider path and the phone path both pass through here (`bookings.service.ts:51` calls `RidesService.request`).
- **Rider read**: `findWithQuote` returns the PIN as a **sibling** of `ride`, never inside it. `findForRider` copies it onto the rider projection.
- **Start gate**: a new `RideLifecycleService.start(driverId, rideId, pin)` runs inside one transaction. It takes a row lock (`SELECT … FOR UPDATE`), applies a pure verdict (`open | required | incorrect | locked`) and then either commits a failure increment or `transitionInTx(arrived → in_progress)`. It emits after the commit. The row lock is what makes "5 attempts" true under parallel requests.
- **SMS**: a phone booking's `driver_arrived` SMS becomes `sms.driver_arrived_pin` when the ride has a PIN. The PIN comes from a new narrow read, not from `NotifiableRide`, which the tracking page reads.
- **Apps**:
  - Rider: a persisted booking-screen switch sends `options.pickupPin`. The status screen shows the PIN and the arrival banner speaks it.
  - Driver: on a pinned ride at `arrived`, a numeric field appears and Start stays disabled until 4 digits are entered. The PIN travels with every attempt, retries included.

## Out of Scope / Non-Goals

- **Not included: Dina's phone-order checkbox** — filed as [#275](https://github.com/linardsb/taxi/issues/275). This ticket ships the api side of the phone path (mint, gate, PIN arrival SMS) and tests it through `POST /dispatch/bookings`. Dina's form changes by the one type-forced literal `pickupPin: false` (T3), never a checkbox.
- **Not included: a stored rider preference, a settings screen, or night-only mode.** The opt-in is per booking and remembered on the device (user decision, 2026-09-23).
- **Not included: a dispatcher "start without PIN" override.** After the lock the ways out are the existing cancel routes: the rider's cancel button, and Dina's `CancelDialog` (`apps/dispatch/src/features/override/cancel-dialog.tsx`). The driver app has no cancel UI today (verified: no `/cancel` under `apps/driver/src`), and this ticket does not add one.
- **Not included: the blind-rider arrival protocol** — its own ticket, per #258's body.
- **Not changing:**
  - Rides without the option: `POST /start` with no body stays 201.
  - `sms.driver_arrived` for phone rides without a PIN.
  - The app rider's arrival push (`ride-notifications.service.ts:200`), whose body carries no PIN.
  - The tracking page, the offer card and the dispatch board, none of which show a PIN.
- **Not showing "attempts remaining"** to the driver. `apiErrorBodySchema` has no field for it, and adding one is a contract change nobody asked for.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (5 packages, a migration, a concurrency-sensitive gate, two line caps at the edge)
**Primary Systems Affected**: `packages/shared`, `db`, `services/api` (rides, rides/lifecycle, notifications), `apps/rider` (booking, ride-status), `apps/driver` (active-ride), `apps/dispatch` (one literal)
**Dependencies**: none new. `node:crypto` `randomInt`, drizzle `.for('update')`, and the rider app's existing `@react-native-async-storage/async-storage` 2.2.0.

## Related Work

**Implements**: [#258](https://github.com/linardsb/taxi/issues/258) · **Epic**: #1 via #15's re-slice (2026-08-07); `docs/epics/sakta-cab.architecture.md:42` names PIN pickup among the binding UX-evidence items.

**Back-references**:

- `.claude/plans/driver-offers-active-ride.md` — Why: #15. Owns `DRIVER_STEPS`, the active-ride reducer and the driver ride read this ticket extends. It ruled PIN pickup out (`:52`).
- `.claude/plans/driver-15-offers-device-pass.md` — Why: filed #258 (`:560`).
- #63 / #135 / #136 — Why: the SMS send policy, app-vs-phone channel split and one-segment budget proof the new template has to join.

**Forward-references**:

- [#275](https://github.com/linardsb/taxi/issues/275) — the dispatch form checkbox.
- [#276](https://github.com/linardsb/taxi/issues/276) — screen-reader checks owed: iOS VoiceOver, a rider device build, TalkBack speech.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

Shared:
- `packages/shared/src/schemas/ride.ts` 22-26 (`rideOptionsSchema`), 81 (the `options` default literal), 234-273 (`rideSchema`), 324-353 (sibling body schemas `ridePaymentMethodUpdateSchema` / `rideCancelSchema`: the shape to mirror for `rideStartSchema`)
- `packages/shared/src/schemas/customer.ts:113-119` — `dispatcherBookingBodySchema = rideRequestBodySchema.extend(...)`, so the phone body inherits `options.pickupPin` with no change here
- `packages/shared/src/ride-state-machine.ts` — `DRIVER_STEPS.start` (`arrived → in_progress`) and the `arrived` row of `ALLOWED_TRANSITIONS` (no `requested`: an arrived ride cannot be released, so the failure counter never has to reset for a new driver)
- `packages/shared/src/i18n/lv.ts` (483 lines, **17 to the cap**), `ru.ts` (377), `en.ts` (370); `packages/shared/src/i18n.ts:26` the `satisfies` parity; `packages/shared/tests/i18n.test.ts`
- `packages/shared/tests/sms-budget.test.ts` 60-63 (`PLATE_MAX_CHARS` derived from `vehicleSchema.shape.plate`, `.max(10)` at `schemas/vehicle.ts:7`), 74-115 (the budget table pattern)
- `packages/shared/tests/schemas-ride-request.test.ts`, `schemas-customer.test.ts` — literals/`toEqual`s that the new default breaks

DB:
- `db/src/schema/rides.ts` 33-113 (the `rides` table; `updated_at` is trigger-maintained, `:95-99`: do NOT add `$onUpdate`)
- `db/migrations/0011_small_polaris.sql` (latest; the new one is `0012_*`), `db/package.json:20` (`generate`)

API:
- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` (**496 lines**): 38-48 `RejectionCause`/`LoggableRide`, 94-115 `driverStep`, 130-181 `complete` (**the pattern for start**: guard → `db.transaction` → `transitionInTx` → post-commit `emitStatus` + log), 313-331 `guardDriverStep`, 435-495 `logApplied`/`logRejected` (the code T6 extracts)
- `services/api/src/features/rides/lifecycle/ride-lifecycle.controller.ts:56-64` (`start`), 83-99 (the `@Body(new ZodValidationPipe(...))` pattern)
- `services/api/src/features/rides/lifecycle/ride-lifecycle.policy.ts` (53, "pure status knowledge, no I/O"; the verdict lives here)
- `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts` 35-49 (`findForAction`), 89-103 (a write inside the caller's `tx`)
- `services/api/src/features/rides/ride-transition.service.ts:77-92` (`transitionInTx`), 103-132 (`emitStatus`, post-commit only; it also fires the SMS hook)
- `services/api/src/features/rides/rides.repository.ts` (**464**): 65-80 `CreateRideInput`, 93-129 `toRide`, 149-195 `create`, 308-350 `findWithQuote`
- `services/api/src/features/rides/rides.service.ts` (**481**): 215-246 `findForRider`, 253-304 `createRide` (`:268` `mintTrackingToken()`, which the mint mirrors)
- `services/api/src/features/rides/rider-visible-ride.ts` (the whole file: the forced-null projection type to extend)
- `services/api/src/features/rides/rides.controller.ts:105-114` (`read` branches rider/driver)
- `services/api/src/features/notifications/ride-notifications.service.ts:111-184` (`onStatus`; the phone-only branch at 148-180)
- `services/api/src/features/notifications/notifications.repository.ts:15-48` (`NotifiableRide`, **also read by the tracking view**, so the PIN must not be added to it)
- `services/api/src/features/auth/auth.service.ts:174-175` (`randomInt`, never `Math.random`)
- `services/api/src/common/zod-validation.pipe.ts` (parses `value` as-is; see T4 for an absent body)
- `services/api/test/harness.ts:257-282` (`RecordingSmsProvider.messagesFor`), 496 (`createTestApp`)
- `services/api/src/features/rides/lifecycle/ride-lifecycle.integration.spec.ts` 66-130 (setup/teardown), the helpers `onlineDriver`/`rider`/`dispatcher`/`book`/`offerTo`/`pendingOffer`/`bookAndAccept` (~213-318), `waitForEvent` (~285): **copy them** into the new spec
- `.claude/references/logging-standard.md` — the PIN is a secret: never log the stored PIN or the entered one

Rider app:
- `apps/rider/src/features/ride-status/use-ride-status.tsx:149-173` (`refetch`; **`:162` is the staleness guard the PIN must be set BEFORE**), 153 (`rideSchema`, which strips unknown keys)
- `apps/rider/src/features/ride-status/status-screen.tsx:27-40` (`statusKey`), 114-145 (render; `Banner` is the single announcement)
- `apps/rider/src/features/booking/booking-screen.tsx:192-228` (where the switch goes), `use-book-ride.ts:49-81` (the body), `booking-draft.ts:58-78` (rule 2: payment changes neither quote nor key; the PIN switch follows the same rule)
- `apps/rider/src/features/places/saved-places-store.ts:1-8` (AsyncStorage key convention `sakta.rider.*`), `apps/rider/jest.setup.ts:38` (AsyncStorage mock)
- `apps/rider/src/features/i18n/error-key.ts` (`rider.error.<code>`)

Driver app:
- `apps/driver/src/features/active-ride/active-ride-state.ts` 50-76 (events/effects), 224-237 (`step_pressed`), 251-273 (`step_failed`; `pickup_pin_*` codes must NOT start with `ride_not_`, or they would trigger a reconcile)
- `apps/driver/src/features/active-ride/use-active-ride.tsx` 32-42 (context API), 121-129 (`post_step` sends no body today)
- `apps/driver/src/features/active-ride/active-ride-screen.tsx` 158-166 (error Banner: **its Retry calls `step` with no PIN**), 184-192 (primary button)
- `apps/driver/src/features/onboarding/vehicle-screen.tsx` 153-158 (a `TextField` with `keyboardType="number-pad"` + `maxLength`), 159-167 (a `Switch` row with `accessibilityLabel`)
- `apps/driver/src/features/i18n/error-key.ts` (`driver.error.<code>`)

Dispatch app:
- `apps/dispatch/src/features/phone-orders/use-booking-form.ts:305-316` (`body: DispatcherBookingBody`; `:313` is the options literal)

### New Files to Create

- `db/migrations/0012_<generated>.sql` (+ `meta/0012_snapshot.json`, `_journal.json`) — generated, never hand-written
- `services/api/src/features/rides/pickup-pin.ts` — `mintPickupPin()`
- `services/api/src/features/rides/pickup-pin.spec.ts`
- `services/api/src/features/rides/lifecycle/ride-lifecycle.logging.ts` — the extracted log helpers (T6)
- `services/api/src/features/rides/lifecycle/ride-pickup-pin.integration.spec.ts`
- `apps/rider/src/features/booking/pickup-pin-preference.ts` — the AsyncStorage-backed hook
- `apps/rider/src/features/booking/pickup-pin-preference.test.tsx`

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Drizzle — row-locking `.for()`](https://orm.drizzle.team/docs/select#select-for-update) — `db.select().from(t).where(...).for('update')`; the first `FOR UPDATE` in this codebase (no existing use under `services/api/src`)
- [PostgreSQL — `SELECT … FOR UPDATE`](https://www.postgresql.org/docs/16/sql-select.html#SQL-FOR-UPDATE-SHARE) — why concurrent attempts serialise on the row
- [Node — `crypto.randomInt`](https://nodejs.org/api/crypto.html#cryptorandomintmin-max-callback) — max is exclusive
- [NestJS — pipes / `@Body()`](https://docs.nestjs.com/pipes) — `observed` 2026-09-23 in the installed tree: express **5.2.1** and body-parser **2.3.0**, whose `lib/read.js:47` sets `req.body = undefined` before parsing. A request with no JSON body therefore reaches `@Body()` as `undefined`, and `ZodValidationPipe` parses `undefined`. T1's `.default({})` is required, not defensive. The existing bodiless `start` in AC #1 of the lifecycle spec is the oracle.
- drizzle-orm **0.45.2** installed (`observed`); `PgSelectBase.for(strength, config)` exists at `node_modules/drizzle-orm/pg-core/query-builders/select.js:722`.
- pg-pool default `max` is **10** (`observed`: `node_modules/pg-pool/index.js:89`). `createDb` passes no `max` (`db/src/client.ts:9`), and the harness's `ctx.db` is the app's own `DRIZZLE` (`test/harness.ts:657`), so tests and app share one 10-connection pool. T10 case 6 is sized to this.
- [React Native `Switch`](https://reactnative.dev/docs/switch), [accessibility props](https://reactnative.dev/docs/accessibility)
- `docs/research/rider-ux-evidence.md` §6.1 — opt-in, 5 attempts, non-visual

### Patterns to Follow

**Error codes**: the message is the snake_case code. `ConflictException('ride_not_arrived')` → `{ message: 'ride_not_arrived' }` (`api-error.ts:5-10`). New codes:
- `pickup_pin_required` → 422 (`UnprocessableEntityException`; no attempt spent)
- `pickup_pin_incorrect` → 422 (one attempt spent)
- `pickup_pin_locked` → 409 (`ConflictException`: the ride is in a state that refuses the action)

This is the first 422 in the api (no `UnprocessableEntityException` under `services/api/src` today). It is chosen because the body is well-formed but wrong, and the apps key on the code, not the status.

**Mint**: mirror `mintTrackingToken` (`tracking.service.ts:59-61`), a bare exported function the rides slice calls at creation.

**Post-commit emits**: `complete()` at `ride-lifecycle.service.ts:150-164`: transaction returns, THEN `emitStatus`, THEN log.

**Forced projections**: `RiderVisibleRide` (`rider-visible-ride.ts:17`) says the guarantee in the type. The PIN goes the opposite way: it is ADDED to the rider type, and absent from `Ride` by construction.

**App reducers**: pure `decide(state, event) → { state, effects }`, tested exhaustively (`active-ride-state.test.ts`); no `setState` in an effect body (`react-hooks/set-state-in-effect`, cited in `use-ride-status.tsx:226-230`).

**Logging**: `{ event, rideId, orderId, driverId, actor, actorId, from, to, cause, at }` (`ride-lifecycle.service.ts:483-494`). PIN rejections reuse `ride.lifecycle.transition_rejected` with a new `cause`, and never carry a PIN.

---

## UX (breadboards, states, friction audit)

**Rider — opt in and book**

```
/book ── [PIN kods iekāpšanai  (switch)] ──► /book (value persisted on device)
      ── [Pasūtīt] ──► /book/status
```

**Rider — status**

```
/book/status {status ≠ in_progress/completed/settled/cancelled_*, pickupPin ≠ null}
   └─ PIN block: «Jūsu PIN kods: 4 8 2 1»   (spoken digit by digit)
   └─ on `arrived`: Banner «Auto ir klāt. PIN: 4 8 2 1»   (the one announcement, #135's line + PIN)
   └─ on `in_progress`: PIN block gone
```

**Driver — start a pinned ride**

```
/active-ride {status: arrived, ride.request.options.pickupPin}
   └─ [Pasažiera PIN kods  (number-pad, maxLength 4)]
   └─ [Sākt braucienu] (disabled until 4 digits) ──► 201 → title «Brauciens notiek»
                                                  ──► 422 incorrect → Banner «Nepareizs PIN kods.» (field keeps the digits; Retry resends them)
                                                  ──► 409 locked → Banner «PIN bloķēts. Zvaniet dispečerim.»
```

**States**

| Surface | Loading | Empty | Error | Offline |
|---|---|---|---|---|
| Booking switch | Switch and Book disabled until the stored value is read | n/a (defaults off) | Storage read throws → value `false`, loaded; the switch shows off, **visibly**, before Book | Unaffected (local storage) |
| Rider PIN block | Hidden until a read returns the PIN | `pickupPin === null` → no block, no PIN in the banner | Read fails → existing «Atjaunojam savienojumu…» banner, retry with backoff (unchanged) | Same as error |
| Driver PIN field | Existing ride spinner | Ride without the option → no field, Start works as today | 422/409 → danger Banner with the catalog copy | Start fails `generic`/offline → Banner Retry resends the typed PIN |

**Touch targets & focus**: the switch sits in a row with `minHeight: 44` (the driver `pill` style precedent, `active-ride-screen.tsx:220`); `TextField` and `Button` already meet 44 px. The PIN field has an `accessibilityLabel` and a visible label; the switch has `accessibilityLabel` = label and `accessibilityHint` = the hint copy.

**Friction audit** (`derived`: counted from the breadboards above)

- Rider, not opted in: 0 extra taps.
- Rider opting in the first time: +1 tap (the switch). On every later booking: 0, because the value persists. Justified: opt-in is the user's decision (2026-09-23), and persisting it keeps repeat bookings at the #16 count.
- Rider at the kerb: says 4 digits, or shows the screen. No taps.
- Driver on a pinned ride: +1 tap (focus the field) + 4 key presses before the existing Start tap. That is 6 interactions instead of 1. Justified: entering the code is the verification. Not auto-focused: a field appearing and grabbing focus the moment the status flips interrupts TalkBack mid-announcement.
- Driver on an un-pinned ride: unchanged, 1 tap.

---

## IMPLEMENTATION PLAN

Work in a **git worktree** from `origin/main` (another session is live on this checkout; `git reflog -8` first). Run everything DB-touching with `COMPOSE_PROJECT_NAME=taxi`, copy `.env` into the worktree, and check `taxi-redis-1` is Up before any gate.

### Phase A: Contract + storage (shared, db)

T1–T3. Everything else imports these.

### Phase B: API (mint, rider read, start gate, SMS)

**Depends on:** Phase A (built `@taxi/shared` dist + migrated schema).
T4–T10.

### Phase C: Rider app

**Depends on:** Phase A (`riderRideSchema`, catalog keys). **Independent of:** Phase D. Its tests mock the api, so Phase B is not required for them to pass.
T11–T13.

### Phase D: Driver app

**Depends on:** Phase A. **Independent of:** Phase C.
T14–T15.

### Phase E: Docs, ledger, gate, emulator

T16–T18.

---

## STEP-BY-STEP TASKS

### T1 UPDATE `packages/shared/src/schemas/ride.ts`

- **IMPLEMENT**:
  - `rideOptionsSchema` gains `pickupPin: z.boolean().default(false)`, with a docblock: opt-in per booking (#258), minting keys on it, and the PIN itself is never on the request.
  - `:81` default literal becomes `{ childSeat: false, femaleDriver: false, pickupPin: false }`.
  - New, beside `rideCancelSchema`:
    - `pickupPinSchema = z.string().regex(/^\d{4}$/)` and `type PickupPin`.
    - `rideStartSchema = z.object({ pin: pickupPinSchema.optional() }).default({})` and `type RideStart`. The docblock covers two points. An absent body (Express 5 → `undefined`) means "no PIN". The actor comes from the JWT, as with `rideCancelSchema`.
    - `riderRideSchema = rideSchema.extend({ pickupPin: pickupPinSchema.nullable() })` and `type RiderRide`. The docblock covers three points. This is the ONLY schema that carries the PIN. `rideSchema` must never gain it, because the driver read, `complete`, `settle` and the dispatcher's `RideCreated` are all `rideSchema`, and leaving the PIN off it is what keeps them clean by construction. `.extend` keeps a plain `ZodObject`.
- **PATTERN**: `ride.ts:324-353` (small body schemas with rationale docblocks).
- **IMPORTS**: none new (`z` is imported). Make sure `packages/shared/src/index.ts` re-exports them. Check whether it uses `export *` from `./schemas/ride`; if not, add the names.
- **GOTCHA**:
  - `.default(false)` makes `pickupPin` REQUIRED in the OUTPUT type (`RideOptions`, `DispatcherBookingBody`), exactly like `childSeat`. That is why T3 exists.
  - Do not use `.optional()` to dodge T3: the api reads `request.options.pickupPin` as a boolean, and old jsonb rows must parse to `false`, not `undefined`.
- **VALIDATE**: `pnpm --filter @taxi/shared build && pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC1, AC4

### T2 UPDATE shared tests + catalogs

- **IMPLEMENT**:
  - (a) `packages/shared/tests/schemas-ride-request.test.ts` and `schemas-customer.test.ts`: add `pickupPin: false` wherever a literal or `toEqual` asserts the parsed `options`. Add cases:
    - `rideOptionsSchema.parse({})` → `pickupPin: false`, and a legacy `{ childSeat: true, femaleDriver: false }` parses to `pickupPin: false` (expected + the legacy-row edge).
    - `pickupPinSchema` accepts `'0000'` and `'4821'` and rejects `'482'`, `'48211'`, `'a821'`, `' 482'` and `4821` (the number) (failure).
    - `rideStartSchema.parse(undefined)` → `{}`; `parse({ pin: '0042' })` keeps it; `parse({ pin: '42' })` throws.
    - `riderRideSchema` parses a ride with `pickupPin: null` and with `'0042'`; `rideSchema.parse({ ...ride, pickupPin: '0042' })` has no `pickupPin` key (the strip is the contract).
  - (b) Catalogs, same keys in `lv.ts`/`ru.ts`/`en.ts`. **Eight keys, one line each in `lv.ts`**:

    | key | lv | ru | en |
    |---|---|---|---|
    | `sms.driver_arrived_pin` | `Jūsu taksometrs ({plate}) ir klāt. PIN: {pin}` | `Ваше такси ({plate}) на месте. PIN: {pin}` | `Your taxi ({plate}) has arrived. PIN: {pin}` |
    | `rider.book.pickup_pin` | `PIN kods iekāpšanai` | `PIN-код для посадки` | `Pickup PIN` |
    | `rider.book.pickup_pin_hint` | `Šoferis ievadīs jūsu PIN pirms brauciena.` | `Водитель введёт ваш PIN перед поездкой.` | `Your driver enters your PIN before the trip.` |
    | `rider.status.pin` | `Jūsu PIN kods: {pin}` | `Ваш PIN-код: {pin}` | `Your PIN: {pin}` |
    | `rider.status.arrived_pin` | `Auto ir klāt. PIN: {pin}` | `Машина подъехала. PIN: {pin}` | `Your car is here. PIN: {pin}` |
    | `driver.ride.pin_label` | `Pasažiera PIN kods` | `PIN-код пассажира` | `Rider's PIN` |
    | `driver.error.pickup_pin_incorrect` | `Nepareizs PIN kods.` | `Неверный PIN-код.` | `Wrong PIN.` |
    | `driver.error.pickup_pin_locked` | `PIN bloķēts. Zvaniet dispečerim.` | `PIN заблокирован. Позвоните диспетчеру.` | `PIN locked. Call dispatch.` |

    Place each beside its siblings. `sms.driver_arrived_pin` goes right after `sms.driver_arrived` (`lv.ts:21`); the `rider.status.*` keys go by `:445`. The `arrived_pin` rows reuse each language's existing `rider.status.arrived` wording, verified 2026-09-23: lv «Auto ir klāt» (`lv.ts:445`), ru «Машина подъехала» (`ru.ts:352`), en «Your car is here» (`en.ts:344`).
  - (c) `packages/shared/tests/sms-budget.test.ts`: a new `describe('the PIN arrival SMS at the maximum of every bound')`, one `it` per language. Render with `plate: 'A'.repeat(PLATE_MAX_CHARS)` and `pin: '0000'`, and assert an exact length and `smsSegments(body) === 1`.
    - Expected lengths, `derived` as fixed + 10 (plate) + 4 (pin): **lv 33+14 = 47**, **ru 29+14 = 43**, **en 31+14 = 45**. The fixed parts were measured with `python3` len() over the templates above, with placeholders removed, on 2026-09-23.
    - LV/RU are UCS-2 (70-char segment), EN GSM-7 (160). Re-derive them if the copy changes.
- **GOTCHA**:
  - **`lv.ts` is 483 lines, and the cap is 500 with comments counted** (`packages/shared/eslint.config.mjs:36`). Eight single-line keys → **491** (`derived`: 483 + 8).
    - The width condition is checked, not assumed. The repo's prettier config is `{ singleQuote, trailingComma }`, so `printWidth` is the default 80. Every lv row above, rendered as `  '<key>': '<copy>',`, was measured with `python3` len() on 2026-09-23: 76, 49, 76, 45, 57, 48, 61 and 71 characters.
    - All eight are ≤ 80, so prettier keeps each on one line.
    - Changing the copy re-opens this: re-measure.
  - If prettier wraps a row, shorten the copy. Never delete existing comments to make room. If it still does not fit, stop and raise it: splitting the catalog is out of scope.
  - `driver.error.pickup_pin_required` is deliberately absent. The app never sends a start without a PIN on a pinned ride (T14), so the code is unreachable from it and falls to `driver.error.generic` (`error-key.ts:9`).
  - `i18n.ts:26`'s `satisfies` fails the build if RU/EN miss a key: that is the parity check.
- **VALIDATE**: `pnpm --filter @taxi/shared build && pnpm --filter @taxi/shared test && pnpm --filter @taxi/shared lint && wc -l packages/shared/src/i18n/lv.ts` (≤ 500)
- **SATISFIES**: AC4, AC7, AC8

### T3 UPDATE `db/src/schema/rides.ts` + generate migration + the forced literals

- **IMPLEMENT**:
  - (a) In `rides`, after `trackingToken`:
    - `pickupPin: text('pickup_pin')`. Nullable; the docblock says NULL = no PIN (not opted in, or a legacy row), minted once at creation, never logged.
    - `pickupPinFailures: integer('pickup_pin_failures').notNull().default(0)`. The docblock says wrong entries so far, capped by `PICKUP_PIN_MAX_ATTEMPTS` in the api, and that it never resets: `arrived` has no dispatcher release, so no second driver ever inherits it.
  - (b) `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/db generate`, then read the SQL. Expect exactly two `ALTER TABLE "rides" ADD COLUMN` statements and nothing else. Then run migrate on the dev DB.
  - (c) The type-forced literals, each gaining `pickupPin: false`:
    - `apps/dispatch/src/features/phone-orders/use-booking-form.ts:313` (not the #275 checkbox: the value is hard `false`, with a one-line comment pointing at #275)
    - `services/api/src/features/dispatch/bookings/bookings.service.spec.ts`
    - `services/api/src/features/dispatch/strategies/candidate-filter.spec.ts` (×2)
    - whatever else `pnpm turbo run typecheck` names
- **GOTCHA**:
  - Do not add `$onUpdate` (`rides.ts:95-99`).
  - No CHECK constraint (see NOTES).
  - The DB column default `0` states a fact about a new row, not a config knob; it is the same argument as `booking_channel` (`rides.ts:80-83`).
- **VALIDATE**: `git diff --stat db/migrations` (one new `.sql`, one snapshot, the journal) `&& pnpm --filter @taxi/db build && pnpm turbo run typecheck`
- **SATISFIES**: AC1

### T4 CREATE `services/api/src/features/rides/pickup-pin.ts` (+ spec) and mint at creation

- **IMPLEMENT**:
  - `export function mintPickupPin(): string { return String(randomInt(0, 10_000)).padStart(4, '0'); }` with a docblock covering three points:
    - `randomInt`, never `Math.random`, as with the OTP.
    - Max exclusive, so the range is `0000`–`9999`.
    - Leading zeros kept on purpose: a `number` would lose them and the rider would say "42" to a field expecting 4 digits.
  - In `rides.repository.ts`: `CreateRideInput` gains `pickupPin: string | null` (docblock: minted by the caller, as `trackingToken`); `create()` inserts it.
  - In `rides.service.ts:262-269` `createRide`: `pickupPin: request.options.pickupPin ? mintPickupPin() : null,` beside `trackingToken`.
  - `pickup-pin.spec.ts` covers three cases:
    - 2,000 draws all match `/^\d{4}$/` (expected).
    - With `randomInt` mocked to return `7`, the result is `'0007'` (edge: leading zeros).
    - `randomInt` is called with `(0, 10_000)` (the pin on the range, failure-shaped: a `(0, 9999)` edit reddens it).
- **PATTERN**: `tracking.service.ts:59-61`, `rides.service.ts:268`.
- **GOTCHA**:
  - `rides.service.ts` is at **481**. This task adds 1–2 lines, and T5 adds ~3. Check `wc -l` after both (must be ≤ 500).
  - `bookings.service.ts:51` calls `RidesService.request`, so phone bookings are covered without a second mint site. Do not add one.
  - Mock `node:crypto` in the spec via `jest.mock('node:crypto', () => ({ ...jest.requireActual('node:crypto'), randomInt: jest.fn() }))`, scoped to that file.
- **VALIDATE**: `pnpm --filter @taxi/api test -- pickup-pin.spec && wc -l services/api/src/features/rides/rides.service.ts services/api/src/features/rides/rides.repository.ts`
- **SATISFIES**: AC1

### T5 UPDATE rider read: PIN as a sibling, never inside `Ride`

- **IMPLEMENT**:
  - `rides.repository.ts` `findWithQuote` returns `{ ride, quote, pickupPin: row.pickupPin }` and its return type gains `pickupPin: string | null`. The docblock explains why this is a sibling: `toRide` must never project it, because every non-rider caller hands `found.ride` straight to a driver, a dispatcher or the settlement response.
  - `toRide` is unchanged.
  - `rider-visible-ride.ts`: `export type RiderVisibleRide = Omit<Ride, 'split'> & { split: null; pickupPin: PickupPin | null }`, with a docblock paragraph on the added field.
  - `rides.service.ts:244-245` `findForRider`: `const snap = fresh ?? found; return { ...snap.ride, split: null, pickupPin: snap.pickupPin };`.
  - `rides.controller.ts:110` return type becomes `Promise<Ride | RiderVisibleRide>`, or whatever typechecks without widening `Ride`.
  - **Rewrite the "WHAT ACTUALLY CROSSES THE WIRE" paragraph** of `findForRider`'s docblock (`rides.service.ts:198-209`). It enumerates every field on the rider read and becomes false the moment `pickupPin` is added: name the PIN, why only this read carries it, and that it comes from the sibling field. Keep the rewrite within the paragraph's current length; this file is at 481.
- **GOTCHA**:
  - Key-set assertions: `ride-read.integration.spec.ts` and `rides.integration.spec.ts` showed no whole-body `toEqual`/`toStrictEqual` on the rider read (grep on `origin/main`, 2026-09-23; the one `toEqual` at `rides.integration.spec.ts:694` is on `quote`). Re-grep; any exact-key assertion that appears must be updated on purpose, not loosened.
  - `findWithQuote` has five other callers (`dispatch.service.ts:74`, `force-assign.service.ts:58`, `reassign.service.ts:74`, `settlement.service.ts:430`, lifecycle `:351/:372/:391`). They destructure `{ ride }`/`{ ride, quote }`, so the extra field is inert there. Grep to confirm nobody spreads the whole result onto a response.
  - The replay path (`rides.service.ts:335`) returns `RideCreated`, which carries no PIN. That is correct: the rider app reads the PIN from `GET` (T12).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api test -- rides.service.spec`
- **SATISFIES**: AC2, AC3

### T6 REFACTOR extract lifecycle logging to make room (no behaviour change)

- **IMPLEMENT**: move `RejectionCause` and `LoggableRide` (`ride-lifecycle.service.ts:38-48`) and the bodies of `logApplied`/`logRejected` (`:435-495`, docblocks included) into `ride-lifecycle.logging.ts`:
  - `export function logTransitionApplied(logger: Logger, ride, actor, actorId, from, to, reason = null)`
  - `export function logTransitionRejected(logger: Logger, ride, actor, actorId, to, cause)`
  - The service keeps two one-line private wrappers (or calls the functions directly with `this.logger`) so every call site keeps its shape.
  - `RejectionCause` gains `'pickup_pin_required' | 'pickup_pin_incorrect' | 'pickup_pin_locked'` (used by T7). Extend the closed-set docblock with one sentence: a PIN rejection's cause never carries the PIN.
- **PATTERN**: `ride-lifecycle.policy.ts` (a sibling file of pure helpers the service imports).
- **GOTCHA**:
  - Event names, field names and field order stay byte-identical. The service spec spies on `Logger.prototype.log/warn` (`ride-lifecycle.service.spec.ts:575-651`) and asserts the payloads with `toMatchObject` on event name and fields, not only call counts (read at `:570-600`). Those spies still see calls made through the passed instance, so they are the proof of no behaviour change. Run the spec BEFORE touching anything and again after, and compare the pass count.
  - Target: the service at ≤ ~440 lines after this task, leaving ≥ 55 for T7.
- **VALIDATE**: `pnpm --filter @taxi/api test -- ride-lifecycle.service.spec && pnpm --filter @taxi/api lint && wc -l services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts`
- **SATISFIES**: (enables AC5 under the line cap)

### T7 ADD the start gate: policy verdict, repository lock, service `start`, controller body

- **IMPLEMENT**:
  - (a) `ride-lifecycle.policy.ts`:
    - `export const PICKUP_PIN_MAX_ATTEMPTS = 5;` The docblock covers two points. The source is `rider-ux-evidence.md` §6.1 ("5 attempts"). The brute-force ceiling is `derived` as 5 ÷ 10,000 = **0.05 %** per ride, assuming a uniformly minted PIN and 5 distinct guesses, which the lock below makes the true maximum.
    - `export type PickupPinVerdict = 'open' | 'required' | 'incorrect' | 'locked';`
    - `export function pickupPinVerdict(gate: { pin: string | null; failures: number }, entered: string | undefined): PickupPinVerdict`, in this order:
      1. `gate.pin === null` → `'open'` (the entry is ignored).
      2. `gate.failures >= MAX` → `'locked'`, even for the right PIN.
      3. `entered === undefined` → `'required'`.
      4. `entered !== gate.pin` → `'incorrect'`.
      5. Otherwise `'open'`.
  - (b) `ride-lifecycle.repository.ts`:
    - `lockPickupPin(tx, rideId): Promise<{ pin: string | null; failures: number } | undefined>`: `tx.select({ pin: rides.pickupPin, failures: rides.pickupPinFailures }).from(rides).where(eq(rides.id, rideId)).for('update')`.
    - `recordPickupPinFailure(tx, rideId): Promise<void>`: `tx.update(rides).set({ pickupPinFailures: sql\`${rides.pickupPinFailures} + 1\` }).where(eq(rides.id, rideId))`.
    - The docblocks say the lock is what serialises concurrent attempts, and the increment must run in a transaction that COMMITS.
  - (c) `ride-lifecycle.service.ts`: `async start(driverId: string, rideId: string, pin: string | undefined): Promise<void>`:
    ```ts
    const { ride, from, to } = await this.guardDriverStep('start', driverId, rideId);
    const result = await this.db.transaction(async (tx) => {
      const gate = await this.lifecycle.lockPickupPin(tx, rideId);
      const verdict = gate ? pickupPinVerdict(gate, pin) : 'open';
      if (verdict === 'incorrect') await this.lifecycle.recordPickupPinFailure(tx, rideId);
      if (verdict !== 'open') return { verdict, moved: undefined };
      return { verdict, moved: await this.transitions.transitionInTx(tx, rideId, from, to) };
    });
    // ── committed ── (a failure increment is durable even though we now throw)
    if (result.verdict !== 'open') {
      this.logRejected(ride, 'driver', driverId, to, `pickup_pin_${result.verdict}`);
      throw result.verdict === 'locked'
        ? new ConflictException('pickup_pin_locked')
        : new UnprocessableEntityException(`pickup_pin_${result.verdict}`);
    }
    if (!result.moved) { this.logRejected(ride, 'driver', driverId, to, 'lost_race'); throw new ConflictException('ride_transition_conflict'); }
    this.transitions.emitStatus(result.moved, from);
    this.logApplied(result.moved, 'driver', driverId, from, to);
    ```
    - `driverStep`'s parameter type narrows to `Exclude<DriverStep, 'complete' | 'start'>`, so the compiler refuses the old ungated path. Update its docblock ("the third step is `start()`: it verifies the PIN").
  - (d) `ride-lifecycle.controller.ts:56-64`: `start(@CurrentUser() user, @Param('rideId', ParseUUIDPipe) rideId, @Body(new ZodValidationPipe(rideStartSchema)) body: RideStart)` → `this.lifecycle.start(user.sub, rideId, body.pin)`.
- **PATTERN**: `complete()` `ride-lifecycle.service.ts:130-181` (transaction → committed → emit → log).
- **IMPORTS**: `UnprocessableEntityException` from `@nestjs/common`; `sql` from `drizzle-orm` in the repository; `rideStartSchema`, `type RideStart` from `@taxi/shared`.
- **GOTCHA**:
  - **Never throw inside the transaction for a PIN verdict.** A throw rolls back the failure increment, and the counter would never move: infinite guesses. Return the verdict, throw after the commit. (A `lost_race` inside is fine to return too; keep it outside for symmetry.)
  - **Do not use `transitions.transition()`**: it opens its own transaction (`ride-transition.service.ts:146`), so the lock and the transition would not share one.
  - `gate === undefined` is unreachable (`guardDriverStep` just found the row), and `'open'` there is safe only because `transitionInTx` is conditional on `status = arrived`. Say so in a comment.
  - `logRejected`'s `cause` is typed `RejectionCause`, and the template literal must typecheck against it. If TS widens it, use a `Record<Exclude<PickupPinVerdict,'open'>, RejectionCause>`.
  - Never pass `pin`/`gate.pin` to any logger.
  - The Express 5 absent body: `rideStartSchema`'s `.default({})` handles `undefined`. The existing lifecycle integration spec's AC #1 posts `start` with **no `.send()`** (`ride-lifecycle.integration.spec.ts` ~`:337-341`), and it must stay 201. If it goes 400 `validation_failed`, the default is not being applied. Fix the schema, not the test.
  - `ride-lifecycle.service.ts` must end ≤ 500 lines (`wc -l`).
  - Narrowing `driverStep` breaks three existing calls: `ride-lifecycle.service.spec.ts:212`, `:223` and `:657` call `service.driverStep('start', DRIVER_ID, RIDE_ID)`. Move them to `service.start(DRIVER_ID, RIDE_ID, undefined)`, with the fake repository's `lockPickupPin` returning `{ pin: null, failures: 0 }`, so they keep asserting what they asserted: a status mismatch, a lost race and the log. Record the spec's pass count before T6 and after T7; the only change should be T8's additions.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint && pnpm --filter @taxi/api test -- ride-lifecycle` (unit + integration; integration needs the DB, see Level 3)
- **SATISFIES**: AC5, AC6

### T8 ADD unit specs for the verdict and the service start

- **IMPLEMENT**:
  - CREATE `ride-lifecycle.policy.spec.ts` (none exists on `origin/main`, verified 2026-09-23) with a table test of `pickupPinVerdict`:

    | gate | entered | verdict | case |
    |---|---|---|---|
    | `{ pin: null, failures: 0 }` | `undefined` | `'open'` | expected |
    | `{ pin: null, failures: 0 }` | `'1234'` | `'open'` | edge |
    | `{ pin: '0042', failures: 0 }` | `'0042'` | `'open'` | expected |
    | `{ pin: '0042', failures: 0 }` | `'42'` | `'incorrect'` | edge: never numeric-compare |
    | `{ pin: '0042', failures: 0 }` | `undefined` | `'required'` | failure |
    | `{ pin: '0042', failures: 4 }` | `'9999'` | `'incorrect'` | edge: the 5th wrong attempt still counts |
    | `{ pin: '0042', failures: 5 }` | `'0042'` | `'locked'` | failure: right PIN, too late |

  - In `ride-lifecycle.service.spec.ts`, mirror its existing fakes (`:166`):
    - incorrect → `recordPickupPinFailure` called once, `transitionInTx` not called, `emitStatus` not called, 422 thrown AFTER the transaction resolved (the fake `db.transaction` runs the callback and returns its value).
    - open → `transitionInTx(tx, id, 'arrived', 'in_progress')`, then `emitStatus`.
    - locked → 409, and nothing is written.
    - A spied `Logger.prototype.warn` receives `cause: 'pickup_pin_incorrect'`, and no argument anywhere in any log call contains the PIN string (`JSON.stringify(warn.mock.calls)` does not contain `'0042'`).
- **VALIDATE**: `pnpm --filter @taxi/api test -- ride-lifecycle.policy ride-lifecycle.service.spec`
- **SATISFIES**: AC5, AC6, AC9

### T9 ADD the PIN arrival SMS (phone bookings)

- **IMPLEMENT**:
  - `notifications.repository.ts`: `async pickupPin(rideId: string): Promise<string | null>`, a one-column select. Its docblock says **NOT on `NotifiableRide`**, because the tracking view reads that type and the tracking page is shared with non-riders.
  - `ride-notifications.service.ts:156-172`: in the phone branch, when `kind === 'driver_arrived'`, `const pin = await this.repository.pickupPin(ride.id);`, then `pin === null ? formatMessage(rider.language, 'sms.driver_arrived', { plate }) : formatMessage(rider.language, 'sms.driver_arrived_pin', { plate, pin })`. `SmsKind` stays `'driver_arrived'`: same moment, same budget line.
  - Extend the class docblock's send-policy paragraph by one sentence.
- **GOTCHA**:
  - Phone only. The app branch (`:143-146`) is untouched: an app rider has the PIN on screen, and #135's rule is one arrival message per ride.
  - `sendSms` counts segments (`:44-47`), and T2's budget test proves the new body is 1 segment.
- **VALIDATE**: `pnpm --filter @taxi/api test -- ride-notifications`
- **SATISFIES**: AC7

### T10 CREATE `services/api/src/features/rides/lifecycle/ride-pickup-pin.integration.spec.ts`

- **IMPLEMENT**: copy the setup/teardown and the helpers from `ride-lifecycle.integration.spec.ts` (66-130, `onlineDriver`, `rider`, `dispatcher`, `book`, `offerTo`, `pendingOffer`, `waitForEvent`). The copy's `book` takes an `options` argument so it can send `{ pickupPin: true }`. Cases:
  1. **"rider hears `in_progress` after the driver enters the PIN: book → connect → GET → accept → arriving → arrived → start"** (expected; **the named socket test, in the app's order**).
     - The rider books with `options.pickupPin: true` FIRST, then connects a socket, then `GET /rides/:id`. Assert `pickupPin` matches `/^\d{4}$/`, then read it from that response.
     - The driver accepts, then steps `arriving`, `arrived`, `start` with `{ pin }` → 201.
     - `waitForEvent(riderSocket, 'ride:status', ride.id)` resolves with `status: 'in_progress'`.
     - This is `use-ride-status.tsx`'s order: `booking-screen` replaces the route after `POST /rides`, and the hook mounts and connects after.
  2. **Leak checks** (failure-shaped, raw JSON via supertest `.body`):
     - The driver's `GET /rides/:id` has no `pickupPin` property (`expect(res.body).not.toHaveProperty('pickupPin')`).
     - The same for the `POST /rides/:id/complete` response's `ride`, and for `POST /rides/:id/settle` as the driver.
     - `POST /dispatch/bookings`'s `ride`, as a dispatcher, with `options.pickupPin: true`.
     - The public tracking read `GET /track/:token` (`tracking.controller.ts:16-17`, `@Public()`), with the ride's `trackingToken`: `JSON.stringify(res.body)` does not contain the PIN string.
  3. **Wrong PIN** (failure): `start` with a wrong 4-digit PIN → 422 `{ message: 'pickup_pin_incorrect' }`. The ride stays `arrived` (`rideRow`), and `pickup_pin_failures` = 1.
  4. **Missing PIN** (failure): `start` with no body on a pinned ride → 422 `pickup_pin_required`, failures still 0.
  5. **Lockout, then cancel** (edge):
     - 5 wrong → five 422s.
     - The 6th with the RIGHT PIN → 409 `pickup_pin_locked`; still `arrived`, failures = 5.
     - The rider's `POST /rides/:id/cancel` `{}` → 201 and `cancelled_by_rider`. This proves the only way out works.
  6. **Concurrency** (edge; the lock's proof). **Deterministic by construction, not by timing.** Firing requests in parallel does not guarantee they overlap. If they happen to run one after another, the version without the lock also returns 5/5, and the test proves nothing. So the test forces the overlap:
     1. With failures = 0, the test opens its own transaction on `ctx.db` and takes the ride row with `SELECT … FOR UPDATE`. It holds the lock through a promise that it resolves later.
     2. It fires **8** wrong-PIN starts without awaiting them.
     3. It polls `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()` every 25 ms until the count is 8 (3 s timeout, with a message naming the count reached).
        - With the production lock, the 8 wait on their own `FOR UPDATE`.
        - Without it, each has already computed `incorrect` and waits on its `UPDATE … + 1`.
        - Either way, all 8 are proven in flight before any of them proceeds.
     4. It commits the holder transaction and awaits all 8.
     - **Expected with the lock**: exactly five 422 `pickup_pin_incorrect` and three 409 `pickup_pin_locked`, and the column = 5. `derived`: the transactions run one at a time; the first 5 read 0–4 and each increments, and the last 3 read 5.
     - Then a start with the right PIN → 409 locked.
     - **Expected with `.for('update')` deleted**: all 8 read `failures = 0` before any increment commits, so eight 422s and the column = 8 → red, every time. `derived` from the forced overlap, not from timing.
     - **Run it both ways and record both results in the report** (the #137/#241 rule: the half that should go red must be executed, not believed).
     - **Why 8 and not 10.** The pool is 10 (see Relevant Documentation). The holder takes 1 connection, and each in-flight start holds 1 inside its transaction, so 1 + 8 = 9 ≤ 10 (`derived`). That leaves one connection for the polling query, which runs outside the holder's transaction on the same pool, and none spare. If the poll deadlocks on the pool, drop to 7 (the expected split becomes 5/2), and say so in the report.
     - `guardDriverStep`'s `findForAction` read uses and releases a connection before the transaction opens, so it does not add to the peak.
  7. **Un-pinned regression** (expected): a ride booked without the option starts with no body → 201. Its rider `GET` has `pickupPin: null`.
  8. **Phone SMS** (expected + edge):
     - A dispatcher books with `options.pickupPin: true`; the ride goes to `arrived`.
     - `ctx.sms.messagesFor(callerPhone)` has a last message that contains the PIN, and matches the `sms.driver_arrived_pin` render in the caller's language.
     - A phone booking without the option gets the plain `sms.driver_arrived`, with no `PIN`.
     - The app booking in case 1 gets no arrival SMS at all (#135 unchanged).
- **GOTCHA**:
  - Teardown: retire rides and release drivers exactly as the source file's `afterEach` does (`:88-121`), scoped to this file's ids (shared DB, parallel workers).
  - Pick pickups inside `centre`, as the source spec does.
  - The shared-test-DB collisions in `CLAUDE.md` apply: one gate at a time.
  - Know how to get the rider's own `pickupPin` in case 3 without the app: read it from the rider `GET`.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test -- ride-pickup-pin` (match `REDIS_PORT` in `.env`)
- **SATISFIES**: AC2, AC3, AC5, AC6, AC7

### T11 CREATE `apps/rider/src/features/booking/pickup-pin-preference.ts` (+ test)

- **IMPLEMENT**:
  - `PICKUP_PIN_KEY = 'sakta.rider.pickup_pin'`.
  - `usePickupPinPreference(): { value: boolean; loaded: boolean; set(v: boolean): void }`:
    - Read once on mount (`AsyncStorage.getItem`; `'1'` → true, anything else → false).
    - A throw → `{ value: false, loaded: true }`.
    - `set` updates state and writes, fire-and-forget; a write failure is swallowed (the value still applies to this booking).
    - Use a `cancelled` flag in the mount effect. The initial `setState` comes from the promise, which is not the effect body, so `react-hooks/set-state-in-effect` is satisfied.
  - Tests:
    - `loaded` false → true, and the value comes from storage (expected).
    - A storage throw → false and loaded (failure).
    - `set(true)` writes `'1'` (expected).
    - An unmount before the read resolves → no state update warning (edge).
- **PATTERN**: `saved-places-store.ts` (key naming, AsyncStorage rationale).
- **VALIDATE**: `pnpm --filter @taxi/shared build && pnpm --filter @taxi/rider test -- pickup-pin-preference`
- **SATISFIES**: AC4

### T12 UPDATE rider booking: the switch and the body

- **IMPLEMENT**:
  - `booking-screen.tsx`, between the payment chips (`:214-220`) and `</ScrollView>`: a row `View` (`minHeight: 44`, `flexDirection: 'row'`, `alignItems: 'center'`, `justifyContent: 'space-between'`) holding a `Text` label (`rider.book.pickup_pin`) and a `Switch`:
    - `value={pin.value}` and `onValueChange={pin.set}`
    - `disabled={!pin.loaded || busy}`
    - `accessibilityLabel={t('rider.book.pickup_pin')}` and `accessibilityHint={t('rider.book.pickup_pin_hint')}`
    - `trackColor` from theme tokens
    - Under it, the hint as muted text.
  - The Book button: `disabled={!isBookable(draft) || !pin.loaded}`.
  - `use-book-ride.ts`: `useBookRide(draft, pickupPin: boolean)`, with the body gaining `options: { pickupPin }` and `pickupPin` in the `useCallback` deps.
  - Tests:
    - `use-book-ride.test.tsx`: the body carries `options: { pickupPin: true }` when true, and `false` when false (expected + edge).
    - `booking-screen.test.tsx`: the switch renders with its a11y label and toggles. Book stays disabled while the preference is unloaded (edge: the ordering worst case, an opted-in rider booking before the value loads and getting an unprotected ride).
    - `accessibility.test.tsx`: the switch has role `switch` and a label.
- **GOTCHA**:
  - **The idempotency key does NOT rotate on the switch** (`booking-draft.ts:67-71`, rule 2). The worst case: the first `POST` lands without the PIN, the rider flips the switch, and the retry with the same key replays the PIN-less ride. The status screen then honestly shows no PIN. Disabling the switch while `busy` narrows this to a lost response. Put this in a comment beside the switch; do not add a draft action for it.
  - Theme tokens only, no literal colours.
  - `booking-screen.tsx` is 238 lines; if the row pushes the file past ~290, extract it to `pickup-pin-switch.tsx` in the slice.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- booking && pnpm --filter @taxi/rider lint && pnpm --filter @taxi/rider typecheck`
- **SATISFIES**: AC4, AC10

### T13 UPDATE rider status: read, show, speak the PIN

- **IMPLEMENT**:
  - `use-ride-status.tsx`:
    - `RideStatusState` gains `pickupPin: string | null` (init `null`).
    - The read's schema becomes `riderRideSchema` (`:153`).
    - In `.then`, **before** the `applied !== at || id < newestRead` return (`:162`): `setState((s) => (s.pickupPin === ride.pickupPin ? s : { ...s, pickupPin: ride.pickupPin }))`, null included. Never skip null: if the hook is ever reused across a `rideId` change without remounting, a non-null-only write would carry the previous ride's PIN onto a new ride. Reset `pickupPin` to null in the effect's cleanup, the same cleanup-not-body pattern as `use-ride-status.tsx:226-239`. The docblock says the PIN is immutable, so staleness cannot apply to it. Guarding it behind `:162` drops it whenever an `offered` event beats both cold-start reads, which is the normal order right after booking. The rider would then have no PIN until the next reconnect, which a healthy socket never has. The worst case is a driver locked out after 5 attempts on a ride the rider could have started.
  - `status-screen.tsx`:
    - A local `spaced(pin) = pin.split('').join(' ')`.
    - `showPin = pickupPin !== null && status !== null && !over && !status.startsWith('cancelled') && status !== 'in_progress'`.
    - The PIN block is `Text` with `fontSize.xl`, `testID="pickup-pin"`, the text `t('rider.status.pin', { pin: spaced(pickupPin) })` and `accessibilityLabel` the same string. Spacing the digits makes screen readers say «četri astoņi divi viens», not «četri tūkstoši…».
    - `statusKey` gains a `hasPin` parameter: `arrived` + pin → `'rider.status.arrived_pin'`, and `line = t(key, { pin: spaced(pickupPin ?? '') })`. `formatMessage` ignores unused params (`format-message.ts:26-27`), so un-pinned keys are unaffected.
  - Tests:
    - `use-ride-status.test.tsx`: **"keeps the PIN when a `ride:status` event lands before the read resolves"** (edge: the `:162` race). Emit `offered` on the fake socket, then resolve the GET; `result.current.pickupPin === '0042'`, and `status` stays `offered`. A null PIN stays null (expected).
    - `status-screen.test.tsx`:
      - The PIN block is shown on `accepted` with the label `'Jūsu PIN kods: 0 0 4 2'` (expected).
      - The `arrived` banner text contains `PIN: 0 0 4 2` (expected).
      - `in_progress` → no `pickup-pin` (edge).
      - `pickupPin: null` → no block, and the arrived banner is the plain `rider.status.arrived` (regression).
- **GOTCHA**:
  - One announcement per change is `Banner`'s job (`status-screen.tsx:63-68`); do not add an `announceForAccessibility` for the PIN.
  - Apps import `@taxi/shared` from `dist`, so rebuild shared first, or the test reads a stale schema without `riderRideSchema` and passes or fails for the wrong reason.
- **VALIDATE**: `pnpm --filter @taxi/shared build && pnpm --filter @taxi/rider test -- ride-status && pnpm --filter @taxi/rider lint`
- **SATISFIES**: AC3, AC8, AC10

### T14 UPDATE driver active-ride: PIN travels with the start

- **IMPLEMENT**:
  - `active-ride-state.ts`:
    - `step_pressed` gains `pin?: string`.
    - The `post_step` effect type gains `pin?: string`.
    - In `step_pressed`, `step === 'start' && state.ride.request.options.pickupPin`: when `event.pin` does not match `/^\d{4}$/` → `noop` (the button is disabled anyway); otherwise the effect carries `pin: event.pin`. Other steps and un-pinned rides ignore `pin`.
    - Export `needsPin(ride: Ride): boolean` (`ride.status === 'arrived' && ride.request.options.pickupPin`) for the screen.
  - `use-active-ride.tsx`:
    - The context's `step(pin?: string)` → `dispatch({ type: 'step_pressed', pin })`.
    - `post_step`: `api.request('POST', url, effect.pin ? { body: { pin: effect.pin } } : undefined)`. Verified: the driver `api-client.ts` takes `opts.body` (`:31`) and sets `content-type: application/json` only when `body !== undefined` (`:74`). A PIN-less step therefore still sends no body, which is the bodiless path T7 keeps working.
  - Tests:
    - `active-ride-state.test.ts`:
      - A pinned arrived ride with `pin: '0042'` → `post_step` with `pin: '0042'` (expected).
      - With `pin: '42'` → no effect (edge).
      - An un-pinned ride → an effect without `pin` (regression).
      - `step_failed` `pickup_pin_incorrect` → `errorCode` set and **no `fetch_ride` effect** (failure: the code must not match `ride_not_`).
      - `pickup_pin_locked` → the same.
    - `use-active-ride.test.tsx`: the POST carries `{ pin }`.
- **VALIDATE**: `pnpm --filter @taxi/shared build && pnpm --filter @taxi/driver test -- active-ride-state use-active-ride`
- **SATISFIES**: AC5, AC9

### T15 UPDATE `active-ride-screen.tsx`: the PIN field

- **IMPLEMENT**:
  - `const [pin, setPin] = useState('')`.
  - When `needsPin(ride)`, render above the primary button a `TextField`:
    - `label={t('driver.ride.pin_label')}`, `value={pin}`, `onChangeText={(v) => setPin(v.replace(/\D/g, ''))}`
    - `keyboardType="number-pad"`, `maxLength={4}`, `testID="pickup-pin-input"`
  - The primary button: `onPress={() => step(pin)}` and `disabled={needsPin(ride) && pin.length !== 4}`.
  - The error Banner's Retry (`:162`) becomes `onPress: () => step(pin)`, so the retry resends the typed PIN rather than posting none.
  - Tests in `active-ride-screen.test.tsx`:
    - A pinned arrived ride shows the field, and Start is disabled at 3 digits and enabled at 4 (expected + edge).
    - Pressing Start calls `step('0042')` (expected).
    - An un-pinned arrived ride shows no field, and Start is enabled (regression).
    - `errorCode: 'pickup_pin_incorrect'` renders `driver.error.pickup_pin_incorrect`'s copy, and Retry calls `step` with the typed PIN (failure).
    - The field has an accessible label.
- **GOTCHA**:
  - No `autoFocus` (see the friction audit).
  - The field keeps the digits after a 422, so the driver corrects rather than retypes.
  - `useState('')` resets naturally when the screen remounts for a new ride.
  - `active-ride-screen.tsx` is 231 lines: fine.
  - RNTL 14: `await act(async …)` always (memory: driver RNTL gotchas).
- **VALIDATE**: `pnpm --filter @taxi/driver test -- active-ride-screen && pnpm --filter @taxi/driver lint && pnpm --filter @taxi/driver typecheck`
- **SATISFIES**: AC5, AC9, AC10

### T16 UPDATE docs

- **IMPLEMENT**:
  - `docs/ux-metrics-ledger.md:16`: Ticket `#258`; Measured how: `api logs: ride.lifecycle.transition_rejected with cause pickup_pin_incorrect / pickup_pin_locked (opted-in rides only)`; Latest: `—`. The row now counts opted-in rides only, so say so in the Measured column.
  - `.claude/references/ride-state-machine.md`: one line under `arrived → in_progress`. On a ride with `pickup_pin`, `POST start` requires `{ pin }`. The error codes are 422 `pickup_pin_required` / `pickup_pin_incorrect` and 409 `pickup_pin_locked` after `PICKUP_PIN_MAX_ATTEMPTS` (5). The row lock serialises attempts.
  - `.claude/references/ui-decisions.md`: log the cosmetic calls: PIN block font size, spaced-digit rendering, switch placement below payment.
- **VALIDATE**: `git diff --stat docs .claude/references`
- **SATISFIES**: AC11

### T17 Gate

- **IMPLEMENT**: clear `dist` and `apps/dispatch/.next`, then run the gate.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` green, with `REDIS_TEST_URL` set to the `.env` port. Then run `wc -l` over the eight capped files named above. Report the counts, each labelled `observed`.
- **GOTCHA**:
  - **Budget one re-run.** Any `@taxi/api` integration suite can flake under the full gate and pass alone. It either exits red naming an unrelated suite, or it hangs: more than ~3 min with no test output means a hang, and a healthy gate is 60–90 s.
  - Re-run the named suite alone. If it passes alone and is not one of this ticket's files, re-run the gate once before diagnosing anything.
  - A red run in `ride-pickup-pin.integration.spec.ts` itself is never a flake until proven: run it alone three times.
  - Stale `apps/dispatch/.next` makes dispatch typecheck fail in ~25 s (TS6053). Clear it with `dist`.
- **SATISFIES**: AC12

### T18 Emulator run of the driver PIN flow (Level 4 step 6)

**Depends on:** T17 green and the branch pushed. EAS builds from the committed tree.

- **IMPLEMENT**:
  1. In `apps/driver`, run `npx expo install --check` (it must print nothing; this ticket adds no native module).
  2. Link the project with `eas init --id 976c4e03-9ef1-46aa-b383-bc72138890a4`. **Never `--account`**, which creates a new project. `extra.eas.projectId` is deliberately not committed.
  3. Build with `npx eas-cli@latest build -p android --profile preview`, from a tree whose `EXPO_PUBLIC_API_URL` points at this Mac's LAN IP (`driver-device-day.md` §0).
  4. Run steps a–e of Level 4 step 6 and record the build id, the dump excerpt and each result in the report.
- **GOTCHA**:
  - **Budget ~20 min per build and one failed build.** A green gate says nothing about whether the Android build works; two past blockers each cost a real build to find.
  - Coordinate the emulator (step 6's `adb devices` check) before booting.
  - Revert the `projectId` edit from `eas init` before any commit.
- **VALIDATE**: the report's T18 section has the build id, a `uiautomator` excerpt showing the PIN label and `enabled="false"` on Start, and results a–e.
- **SATISFIES**: AC13

---

## TESTING STRATEGY

### Unit Tests

- shared (vitest): schema cases (T2a), budget rows (T2c), catalog parity (existing `i18n.test.ts`).
- api (jest): `pickup-pin.spec.ts` (T4); the verdict table and the service start with fakes (T8); notifications (T9).
- apps (jest + RNTL): preference hook (T11), booking body/switch (T12), status hook race and screen (T13), driver reducer/provider/screen (T14/T15).

### Integration Tests

`ride-pickup-pin.integration.spec.ts` (T10). **Socket test named in T10 case 1**: rider books → rider socket connects → rider `GET` (join) → driver accept/arriving/arrived/start-with-PIN → the rider's socket receives `ride:status in_progress`. This is the app's order (`use-ride-status.tsx:65-79`: the hook mounts after `POST /rides` returns and the route is replaced), not the harness's convenient connect-first order.

### Edge Cases

| # | Edge case | Verified in |
|---|---|---|
| E1 | `ride:status` lands before the rider's first read → the PIN is still shown | `use-ride-status.test.tsx` (T13) |
| E2 | Book tapped before the stored switch value loads | `booking-screen.test.tsx` (T12): Book disabled |
| E3 | Switch flipped between a lost response and the retry (same idempotency key) | Documented in a comment (T12); the status screen shows the truth: `status-screen.test.tsx` null-PIN case |
| E4 | 8 wrong PINs forced to overlap behind a held row lock | T10 case 6 (+ the lock-deleted run, which must go red) |
| E5 | Right PIN after 5 wrong | T10 case 5, T8 table |
| E6 | Leading-zero PIN (`0042`) survives mint, storage, wire and the compare | T4 spec, T8 table (`'42'` ≠ `'0042'`), T13 label `0 0 4 2` |
| E7 | Bodiless `start` on an un-pinned ride (Express 5 `undefined` body) | Existing lifecycle AC #1 + T10 case 7 |
| E8 | PIN leaks to driver / dispatcher / settlement / tracking | T10 case 2 |
| E9 | Legacy `request` jsonb without `pickupPin` | T2a (`pickupPin: false`) |
| E10 | Driver Retry after a network failure resends the PIN | `active-ride-screen.test.tsx` (T15) |
| E11 | Rider cancels a locked ride | T10 case 5 |
| E12 | Phone ride with/without PIN → the right SMS | T10 case 8 |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm turbo run typecheck lint
wc -l packages/shared/src/i18n/lv.ts services/api/src/features/rides/rides.service.ts services/api/src/features/rides/rides.repository.ts services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts apps/rider/src/features/booking/booking-screen.tsx apps/rider/src/features/ride-status/use-ride-status.tsx apps/driver/src/features/active-ride/active-ride-state.ts apps/driver/src/features/active-ride/active-ride-screen.tsx
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared build && pnpm --filter @taxi/shared test
pnpm --filter @taxi/api test -- pickup-pin ride-lifecycle.policy ride-lifecycle.service.spec ride-notifications
pnpm --filter @taxi/rider test
pnpm --filter @taxi/driver test
```

### Level 3: Integration Tests

```bash
docker compose ps   # taxi-postgres + taxi-redis Up
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test -- ride-pickup-pin ride-lifecycle.integration rides.integration
COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
```

### Level 4: Manual Validation

Everything here is performable with what ships plus the seed. `pnpm dev` runs the api, and requests go via `curl` with tokens from the OTP flow. The stub SMS provider logs the full body (`stub-sms.provider.ts:30-38`, event `auth.sms.stub_sent`, verified). That is the one dev-only log line allowed to contain a PIN: it is the SMS itself, and the real providers log no body. Step 4's grep excludes it.

1. Sign in three accounts over REST: `POST /auth/otp/request {phone, role}`, then verify, with the code read from the stub log. The roles are rider, driver and dispatcher, on three different numbers. `findOrCreate` applies `role` only to a brand-new row (`auth.repository.ts:47-50`, per `driver-device-day.md:713-716`); #224's run used `+37120000001` for Dina and `+37120000002` for the driver. No socket and no position ping are needed, because step 2 force-assigns. The location ping is Socket.IO-only (`driver-location.gateway.ts:105`), which curl cannot send, and a force-assigned offline driver is the ordinary case (`ride-lifecycle.service.ts:79-81`).
2. Rider `POST /rides` with explicit pickup/destination coordinates in `centre`, `options: { pickupPin: true }`, and a **uuid** `Idempotency-Key`. On a stack without `GOOGLE_MAPS_API_KEY`, explicit coordinates are what work (`driver-device-day.md:245`). As the dispatcher, `POST /dispatch/rides/:rideId/assign {"driverId":"<driver uuid>"}` (`dispatch.controller.ts:95`). This skips the offer id, which only reaches the driver over the socket or push. Rider `GET /rides/:id` → `pickupPin` is 4 digits. Driver `GET /rides/:id` → no `pickupPin` key.
3. Driver `POST arriving`, `POST arrived`, then `POST start` with `{"pin":"<wrong>"}` → 422 `pickup_pin_incorrect`; `POST start` with no body → 422 `pickup_pin_required`; then the right PIN → 201, and rider `GET` shows `in_progress`.
4. Repeat with a fresh ride and 5 wrong PINs → the 6th (right) PIN gets 409 `pickup_pin_locked`. The api log shows five `ride.lifecycle.transition_rejected` lines with `cause: pickup_pin_incorrect`, one with `pickup_pin_locked`, and **no line other than `auth.sms.stub_sent` containing the PIN** (`grep <pin> | grep -v stub_sent` prints nothing; this is an app ride, so no SMS line exists either). The rider `POST cancel` → 201.
5. As the dispatcher, `POST /dispatch/bookings` with explicit coordinates, a uuid `Idempotency-Key`, a fresh `callerPhone` and `options.pickupPin: true`. Force-assign it to the driver as in step 2, then have the driver `POST arriving`, then `POST arrived`. The `auth.sms.stub_sent` line for that caller contains `PIN: <digits>` (the body is logged at `stub-sms.provider.ts:37`).
6. **Driver app on the Android emulator** (task T18). This is performable here: AVD `sakta224` plus an EAS `preview` APK is the route #224 ran (`docs/runbooks/driver-device-day.md:24-25,135`).
   - Before booting, run `adb devices` and `ps aux | grep -i qemu`. **Another session was about to use `sakta224` on 2026-09-23 (#261's AC8)**; if it is running, message that session and wait. Never start a second emulator, and never kill one you did not start.
   - Install the APK, sign in as the step-1 driver, and drive a pinned ride to `arrived` with steps 1–2's curl calls.
   - Record the following:
     - (a) The PIN field is visible, and Start is disabled.
     - (b) `adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml` shows the field's label (`content-desc` or hint text = the `driver.ride.pin_label` copy) and the Start node with `enabled="false"`.
     - (c) Type a wrong PIN with `adb shell input text 1111`, then tap Start. The banner shows `driver.error.pickup_pin_incorrect`'s copy.
     - (d) Type the right PIN and tap Start. The title becomes `driver.ride.title_in_progress`'s copy.
     - (e) `adb shell pm list packages | grep -i talkback`. If TalkBack is present, enable it (`settings put secure enabled_accessibility_services com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService`), focus the field and record what it speaks. If it is absent (likely on a `google_apis` image), say so; the speech leg is owed by #276.
   - The rider app has **no `eas.json`** (verified), so it has no device build. Its UI is proven by RNTL (T12, T13), and its device and screen-reader run is owed by **#276**, filed 2026-09-23 along with the iOS VoiceOver leg (Xcode ceiling). Add a row for both to `docs/runbooks/rider-a11y-walkthrough.md` in T16, citing #276.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1** A ride booked with `options.pickupPin: true` (app or phone) has a 4-digit `rides.pickup_pin` minted with `randomInt`. A ride without it has `NULL`, and legacy requests parse to `pickupPin: false`.
- [ ] **AC2** The PIN appears only in the rider's own `GET /rides/:id` (`riderRideSchema`). It is absent from the driver read, `complete`, `settle`, the dispatcher's booking response and the tracking page (T10 case 2).
- [ ] **AC3** The rider app shows the PIN from booking until `in_progress`, including when a status event beats the first read (E1).
- [ ] **AC4** The rider opts in with one booking-screen switch that is remembered on the device. Book waits for the stored value.
- [ ] **AC5** `POST /rides/:id/start` on a pinned ride gives 201 only with the right PIN. It gives 422 `pickup_pin_required` or `pickup_pin_incorrect` otherwise, and the status stays `arrived`. Un-pinned rides are unchanged (bodiless 201).
- [ ] **AC6** Five wrong entries lock the start (409 `pickup_pin_locked`, even for the right PIN). Exactly five are counted when 8 attempts are forced to overlap, and the same test goes red with the lock removed. Cancel still works.
- [ ] **AC7** A phone booking with a PIN gets `sms.driver_arrived_pin` at `arrived`, one segment at the maximum plate in lv/ru/en (47/43/45 chars, `derived`, pinned by the budget test). App bookings get no arrival SMS (#135).
- [ ] **AC8** The rider's arrival announcement speaks the PIN digit by digit, and the PIN block has a screen-reader label with spaced digits.
- [ ] **AC9** The driver enters the PIN in a labelled number field. Start is enabled at 4 digits, and Retry resends the PIN.
- [ ] **AC10** Every new interactive element is ≥ 44 px with a label, and every string comes from the LV/RU/EN catalogs.
- [ ] **AC11** The metrics-ledger row, the ride-state-machine reference and the ui-decisions log are updated.
- [ ] **AC12** `pnpm turbo run typecheck lint test build --force` green with `REDIS_TEST_URL` set, and every capped file ≤ 500 lines (`observed` in the report).
- [ ] **AC13** The driver PIN flow runs on the Android emulator from an EAS `preview` APK (Level 4 step 6, points a–d). The PIN field's label and Start's disabled state appear in the `uiautomator` dump, and the result is recorded in the report with the build id.
- [ ] Owed elsewhere:
  - Dina's checkbox → **#275**.
  - iOS VoiceOver, the rider-app device run and TalkBack speech (if the emulator image lacks TalkBack) → **#276**.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] T10 case 6 run with and without `.for('update')`, both results in the report
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing (Level 4 steps 1–5) confirms the api behaviour
- [ ] Acceptance criteria all met
- [ ] Every figure in the report and PR body re-derived at HEAD with its provenance

---

## RISK REGISTER

Every risk raised at planning time, how the plan closes it, and the evidence behind the closure.

| # | Risk | Closure | Evidence |
|---|---|---|---|
| R1 | Line caps: `ride-lifecycle.service.ts` 496, `rides.service.ts` 481, `lv.ts` 483 (cap 500, comments counted) | T6 moves 61 lines out first, with byte-identical logs proven by the existing `toMatchObject` spies. `lv.ts` rows measured at ≤ 80 columns, so 8 keys add exactly 8 lines. `rides.service.ts` +1 mint line, and the T5 docblock rewrite is held to its current length. T17 reports `wc -l` | `observed`: current counts, prettier config, row widths. `derived`: 483 + 8 = 491; 496 − 61 = 435 |
| R2 | The 5-attempt cap fails under parallel requests | `SELECT … FOR UPDATE` inside the one transaction (T7); the verdict is returned and the throw happens after the commit. T10 case 6 forces the overlap with a held lock, so it is deterministic, and it must be run with the lock removed and go red | `observed`: drizzle 0.45.2 `.for()` at `select.js:722`; pool max 10. `derived`: with the lock 5/3; without it 8×422 |
| R3 | The rider never sees the PIN (a read overtaken by a status event is dropped at `use-ride-status.tsx:162`) | T13 sets the PIN before the staleness guard, null included, and resets it in cleanup; a named test emits the event before the read resolves | `observed`: the guard's code path read at `:149-173` |
| R4 | Device and screen-reader behaviour is invisible to the gate | Driver: T18 emulator run with an EAS APK and a `uiautomator` accessibility-tree dump. Rider: RNTL, because no build pipeline exists. iOS and speech legs: #276 | `observed`: AVDs `sakta141`/`sakta224` exist, `google_apis` image, no `apps/rider/eas.json`, Xcode ceiling (memory, 2026-08-25) |
| R5 | A bodiless `start` 400s (Express 5 leaves `req.body` undefined) | `rideStartSchema` has `.default({})` (T1); the existing bodiless AC #1 lifecycle test is the oracle | `observed`: express 5.2.1, body-parser 2.3.0 `read.js:47` |
| R6 | The PIN leaks to a non-rider surface | The PIN is never on `rideSchema`: `toRide` is untouched, it is a sibling on `findWithQuote`, and it is kept off `NotifiableRide`. T10 case 2 checks the raw JSON of 5 surfaces | Design; the test is named |
| R7 | The `.default(false)` option breaks typed literals elsewhere | T3(c) lists the 5 sites found by grep, and typecheck names any others | `observed`: grep on `origin/main` |
| R8 | The gate flakes and is misread | T17 GOTCHA: one re-run budget, and this ticket's own spec is never assumed to be the flake | Memory: 3 of 7 full gates went bad in one session |
| R9 | The EAS build fails for reasons outside this ticket | T18: `expo install --check` first, a budget of one failed build, the known `eas init --id` route | Memory: #225 and #232 each cost a build |

**What is left after these closures:**
- The implementer can still diverge from the plan. The per-task VALIDATE lines and the report catch that.
- External services (EAS, the emulator) can be unavailable. T18 cannot run then, and the report must say so rather than call the ticket done.
- Neither is a gap in the plan.

## OPEN QUESTIONS / ASSUMPTIONS

- **Q1 (assumption)** — **422** for `required`/`incorrect`, **409** for `locked`. The apps key on the code, never the status, so changing either later touches only the api and one spec.
- **Q2 (assumption)** — The PIN is stored in plaintext. Hashing gives nothing against a 10⁴ space and would stop the rider re-reading it on reconnect. The protections that matter are the attempt cap, the row lock and keeping it off every non-rider response.
- **Q3 (worst case, ordering)** — Rider read vs a status event: the worst case is that the rider never sees the PIN and the driver locks out. T13 closes it and E1 tests it.
- **Q4 (worst case, ordering)** — Switch vs booking: the worst case is that an opted-in rider gets an unprotected ride. Book is gated on `loaded` (E2). The retry-replay case (E3) is visible and accepted, like payment method.
- **Q5 (worst case, ordering)** — Concurrent starts: the worst case is unlimited parallel guesses. The row lock closes it. E4 forces the overlap, so the test is deterministic, and runs it with and without the lock.
- **Q6 (worst case, ordering)** — Dispatcher release racing a start: `arrived` has no release edge, so no second driver ever sees a half-spent counter (`ride-state-machine.ts`, `arrived` row). If a future ticket adds one, the counter must reset there. Put a note on `ALLOWED_TRANSITIONS.arrived`.
- **Q7** — The rider can cancel a locked ride; the driver cannot, because the driver app has no cancel UI. The driver's banner says to call dispatch, and Dina's `CancelDialog` exists. The user accepted "cancel only" (2026-09-23).

## NOTES (open canvas)

**Why the PIN is not on `rideSchema` with a forced-null projection, as the split is.** The split is safe to strip because the rider is the only surface that must not see it, and there is one rider read. The PIN is the inverse: only the rider may see it, and five paths return a `Ride` to someone else (driver read, `complete`, `settle`, the dispatcher's booking response, dispatch's internal reads). Adding it to `rideSchema` would make every one of those a leak unless each remembered to null it. Leaving it off `Ride` means a forgotten path fails closed, and the one path that needs it asks for it by name (`riderRideSchema`, the sibling field on `findWithQuote`).

**Why a row lock and not a conditional increment.** `UPDATE … SET failures = failures + 1 WHERE failures < 5` caps the counter, but the comparison happens in the app. N parallel requests all read `failures = 0`, and the one carrying the right guess transitions whatever the others did. That gives an attacker N guesses per round trip. `FOR UPDATE` makes read-compare-write one serial step per attempt. Cost: one row lock held for two statements, on a route a driver hits a handful of times per ride.

**Rejected: a CHECK constraint on `pickup_pin`.** It would be the first CHECK in `db/migrations` (none today). The only writer is `mintPickupPin`, pinned by its spec, and every read parses through `pickupPinSchema`. Add one if a second writer ever appears.

**Rejected: a stored rider preference or settings screen** (user decision). **Rejected: including the PIN in the app rider's arrival push.** A lock-screen push is visible to anyone near the phone, and the push exists to get the rider to open the app, where the PIN is.

**Line-cap arithmetic** (`observed` on `origin/main` `1129710`; the deltas are `expected`): `ride-lifecycle.service.ts` 496 → about 435 after T6 (−61, `:435-495`) → about 480 after T7. `rides.service.ts` 481 → about 486. `rides.repository.ts` 464 → about 472. `lv.ts` 483 → 491. The gate's `max-lines` is the check; the report quotes the `wc -l` it observes.

## CONFIDENCE

**9/10** for a one-pass implementation, assessed 2026-09-23 after R1–R9 were closed.

Why it is not 10: the last point sits outside the plan.
- T10 runs against a shared test database that other sessions can wipe (CLAUDE.md).
- T18 depends on EAS and an emulator another session is using.
- A score of 10 would claim those cannot fail, and no plan can make that claim.

## AMENDMENTS

- 2026-09-23 — risk pass, before any implementation:
  - Verified the Express 5 body, drizzle `.for()`, pool size, prettier width, catalog wording and the driver api-client body handling.
  - Made the concurrency test deterministic (forced overlap, 8 attempts sized to the pool).
  - Added T18 (emulator run of the driver flow) and AC13.
  - Filed #276 for the owed screen-reader legs.
  - Added the gate re-run budget and the risk register.
