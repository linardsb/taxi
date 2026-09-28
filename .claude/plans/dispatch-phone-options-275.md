# Feature: Dina's phone form gets both opt-ins, the board badges announce rides, and Dina can read a PIN (#275)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

Every `file:line` below was read on `origin/main` at `a4ed925` (2026-09-28) in the worktree `~/taxi-worktrees/wt-275`. Re-read before editing; lines drift.

## Feature Description

Three changes to the dispatcher console, plus the api read the third one needs.

1. **Phone-order form: two checkboxes.** «PIN kods» (`options.pickupPin`, #258) and «Šoferis pieteiksies balsī» (`options.announceArrival`, #259). Today the form sends both as a type-forced `false` (`apps/dispatch/src/features/phone-orders/use-booking-form.ts:313-319`). Each box carries a one-line hint telling Dina what the caller gets. For the PIN, that is "the PIN arrives in the arrival SMS".
2. **Board badge.** A ride booked with `announceArrival` shows a text badge on its board row. Dina can then act as the pickup assistant for a rider who cannot see the car (dispatcher-as-Aira, `docs/research/rider-ux-evidence.md:30`).
3. **Dispatcher PIN read (PR #277 L2, user decision 2026-09-28).** A phone rider gets their PIN only in the arrival SMS (`services/api/src/features/notifications/ride-notifications.service.ts:189-198`). If that SMS fails, the driver cannot start the ride and the only way out is a cancel. The recovery: on a PIN ride at `arrived`, Dina gets «Rādīt PIN» on the row. It opens a dialog that fetches the PIN from a new dispatcher-only route, and she reads it to the caller. Every read is logged; the PIN never is.

## User Story

As Dina, taking a phone order from a caller who cannot see well or wants to be sure of the car
I want to tick «PIN kods» and «Šoferis pieteiksies balsī» on the order, see which rides asked for the announcement, and read a PIN to a caller whose SMS never came
So that a phone caller gets the same pickup protections as an app rider, and a failed SMS does not end in a cancelled ride

## Problem Statement

- The api side of the phone path already works for both options. Phone bookings go through `POST /dispatch/bookings`, whose body inherits `options` from `rideRequestBodySchema` (`packages/shared/src/schemas/customer.ts:119`, `observed`). Minting, the start gate and the PIN SMS are tested in `ride-pickup-pin.integration.spec.ts:638-662`. The announce flag reaching the driver is tested in `arrival-announce.integration.spec.ts`. The console cannot send `true` for either.
- The board carries no option flags. `BoardRide` (`services/api/src/features/rides/board-ride.ts:38-57`) and the wire schema (`packages/shared/src/realtime-events.ts:231-263`) carry the pickup and nothing else off the request.
- L2: once the console can book a PIN ride, a failed arrival SMS strands the ride. `dispatch:sms_failed` tells Dina it failed (`board-state.ts:304`), but nothing in `apps/dispatch` can read the PIN.

## Solution Statement

- **Form** (`phone-orders` slice). `BookingDraft` gains `pickupPin: boolean` and `announceArrival: boolean`. Both default `false` in `emptyDraft`, and both are `.default(false)` in `draftSchema`, so a draft persisted by today's build still restores. `useBookingForm` gains `setPickupPin` and `setAnnounceArrival`, and `submit` sends the two draft values in place of the literals. `booking-form.tsx` renders a fieldset of two checkboxes, each with a hint, between payment and note. `prefillFrom` never touches them: they are per-trip fields (`use-booking-form.ts:248-253`).
- **Board flags** (api `rides` slice → shared wire → console `board` slice).
  - `board-ride.ts` gains a pure `boardFlagsOf(request: unknown)`. It reads `rideRequestSchema.pick({ options: true })` with its own `safeParse` and falls back to both `false`. `BoardRide` gains `announceArrival` and `pickupPinRequired`. `findBoardRides` and `buildBoardState` thread them through.
  - The wire schema gains `announceArrival: z.boolean().default(false)` and `pickupPinRequired: z.boolean().default(false)`.
  - `ride-queue.tsx` renders the badge when `announceArrival` is true.
  - `pickupPinRequired` is **not a second badge** (user decision: announce only). It decides whether «Rādīt PIN» appears. Its name says "a PIN is required", so nobody reads it as the PIN.
- **PIN read** (api `rides/lifecycle` slice, shared, console `override` slice).
  - A new route `GET /rides/:rideId/pickup-pin` on `RideLifecycleController`, `@Roles('dispatcher', 'admin')`, backed by a new `PickupPinReadService`. It returns `{ pin }`, parsed by a new shared `dispatcherPickupPinSchema`.
  - It refuses as follows: `404 ride_not_found` when there is no ride; `409 pickup_pin_not_set` when the ride has no PIN; `409 ride_not_arrived` when the status is not `arrived`.
  - It logs `ride.pickup_pin.dispatcher_read` with `rideId`, `actorId` and `at`, never the PIN.
  - Console: `use-pickup-pin.ts` (the fetch, fired from the click handler) and `pin-dialog.tsx` (`DialogShell`). The PIN lives in hook state only. It is never in the board frame, so it never reaches `localStorage`, and closing the dialog drops it.

## Out of Scope / Non-Goals

- **Not included: a PIN badge.** The user chose announce-only on 2026-09-28. `pickupPinRequired` only gates the action.
- **Not included: a resend-PIN SMS, or the PIN in the `driver_assigned` SMS.** Both were weighed and rejected on 2026-09-28. A resend fails during the same provider outage that caused the first failure.
- **Not included: unlocking a locked PIN.** After five wrong entries the driver sees «PIN bloķēts. Zvaniet dispečerim.» (`packages/shared/src/i18n/lv.ts:397`). Reading the PIN does not unlock the start; the way out is still `CancelDialog`, as #258 decided (`pickup-pin.md:41`).
- **Not included: remembering a caller's options.** Per booking, as #258 and #259 decided for the rider app (`arrival-announce-protocol-259.md:82`). Dina ticks the box each call.
- **Not included: the PIN read before `arrived`.** The arrival SMS is the first place a phone rider gets the PIN, so there is nothing to recover before it is sent.
- **Not changing:** the SMS templates, `rideSchema` (it must never carry the PIN, `ride.ts:435-447`), the offer payload (`announceArrival` must stay off it, #259 D2), the `dispatch:sms_failed` alert, or `isEmptyDraft` (its only caller is its own test, `booking-draft.test.ts:112-113`; `observed` by grep).

## Feature Metadata

**Feature Type**: Enhancement (two surfaces already built api-side) plus one New Capability (the PIN read)
**Estimated Complexity**: Medium. There are 3 packages and 1 new api route; there is no migration and no socket event.
**Primary Systems Affected**: `apps/dispatch` (`phone-orders`, `board`, `override`, `app/dispatch/page.tsx`), `services/api` (`rides` board projection, `rides/lifecycle` PIN read, `dispatch/board`), `packages/shared` (board wire schema, `dispatcherPickupPinSchema`, LV/RU/EN catalogs)
**Dependencies**: none new

## Related Work

**Implements**: [#275](https://github.com/linardsb/taxi/issues/275), widened by the #259 comment (both options plus the badge), and PR #277 review L2 (the carry-over checkbox on the issue body). **Epic**: #1 via #15's re-slice. `docs/epics/sakta-cab.architecture.md:42` lists the UX-evidence items; nothing there decides this ticket's fields.

**Back-references**:

- `.claude/plans/pickup-pin.md` (#258). Why: it defines the PIN contract. The rule this ticket keeps is that `rideSchema` never carries the PIN. The rule it **reverses** is "the PIN never reaches the dispatcher" (`pickup-pin.md:11`); see Q1. Its Level 4 steps 1–2 and 5 are the curl recipe this plan reuses.
- `.claude/plans/arrival-announce-protocol-259.md` (#259). Why: D7 (`:76`) moved the checkbox and badge here. D2 keeps the flag off the offer. T15 (`:666-669`) left the `announceArrival: false` literal this ticket replaces.
- `.claude/code-reviews/pr-277-review.md:58-63`. Why: L2, the recovery gap.

**Forward-references**: (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

Console, form:
- `apps/dispatch/src/features/phone-orders/booking-draft.ts` (47-85 draft + `emptyDraft`; 199-229 `draftSchema` + `deserializeDraft`). Why: the new fields and the restore rule.
- `apps/dispatch/src/features/phone-orders/use-booking-form.ts` (84-112 `BookingForm` interface; 217-234 setter pattern; 248-282 `prefillFrom`, which must not touch options; 305-322 the body literal). Why: every hook edit.
- `apps/dispatch/src/features/phone-orders/booking-form.tsx` (13-23 the tab-order docblock; 134-172 the payment fieldset to mirror). Why: the checkboxes.
- `apps/dispatch/src/features/phone-orders/booking-form.test.tsx` (80-106 body assertion; 108-133 tab order). Why: both tests change.
- `apps/dispatch/src/features/phone-orders/use-booking-form.test.tsx` (1-80). Why: hook harness, `fillBookable`, `api.book.mock.calls`.
- `apps/dispatch/src/features/phone-orders/booking-draft.test.ts`. Why: the restore tests.

Console, board and override:
- `apps/dispatch/src/features/board/ride-queue.tsx` (64-127 `RideRow`; 129-235 callback threading). Why: badge + new callback.
- `apps/dispatch/src/features/board/ride-queue.test.tsx` (1-30 `ride()` builder). Why: fixture + new tests.
- `apps/dispatch/src/features/override/row-actions.tsx` (whole, 87 lines). Why: «Rādīt PIN» joins this cluster; `address`-bearing `aria-label` rule (#120 M6).
- `apps/dispatch/src/features/override/use-assign.ts` (25-40 `errorCodeOf`; 62-71 auth failure; 73-97 a GET with `cache: 'no-store'`). Why: the fetch pattern `use-pickup-pin.ts` mirrors.
- `apps/dispatch/src/features/override/cancel-dialog.tsx` (whole). Why: dialog pattern (`DialogShell`, `role="alert"` error, buttons).
- `apps/dispatch/src/features/override/index.ts`. Why: slice public API.
- `apps/dispatch/src/app/dispatch/page.tsx` (35-38 `OverrideTarget`; 80-103 `openAssign`/`openCancel`; 264 `RideQueue`; 307-359 dialog render). Why: wiring. 359 lines today (`observed`, `wc -l`), cap 500.
- `apps/dispatch/src/features/board/use-board.ts` (57-69 `hydratedBoard`). Why: a cached frame is `dispatchBoardEventSchema.parse`d. A required new field would throw there and wipe the cached phone list on the first load after deploy. That is why the wire fields are `.default(false)`.

api:
- `services/api/src/features/rides/board-ride.ts` (whole, 57 lines). Why: `boardFlagsOf` and the `BoardRide` fields.
- `services/api/src/features/rides/rides.repository.ts` (162-216 `findBoardRides` and its docblock: parse only what the board renders, drop a bad row). Why: the tolerant-parse rule.
- `services/api/src/features/dispatch/board/board.service.ts` (176-200 the ride map). Why: two fields added.
- `services/api/src/features/dispatch/board/board.service.spec.ts` (52-60 `boardRide()` builder). Why: fixture.
- `services/api/src/features/rides/rides.integration.spec.ts` (606-662 `findBoardRides` describe). Why: new edge cases go here.
- `services/api/src/features/rides/lifecycle/arrival-announce.service.ts` (1-80). Why: the pattern `PickupPinReadService` mirrors: narrow repo read, one 404, then 409s, a closed `RejectCause` union, rejection logs.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts` (58-85 `findAnnounceTarget`). Why: the narrow-select pattern for the new read.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.controller.ts` (whole). Why: the route goes here. `@Roles` is per route (docblock 26-35).
- `services/api/src/features/rides/rides.module.ts:26-35`. Why: providers list.
- `services/api/src/features/rides/rides.controller.ts:99-107`. Why: `GET :rideId` is one segment, so `GET :rideId/pickup-pin` cannot collide with it.
- `services/api/src/features/rides/lifecycle/ride-pickup-pin.integration.spec.ts` (58-340 setup and helpers `dispatcher`, `bookByPhone`, `accept`, `toArrived`, `start`, `rideRow`; 638-662 the phone case). Why: the new integration cases go in this file.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.logging.ts:6-19`. Why: why a PIN never rides on a log line.

shared:
- `packages/shared/src/realtime-events.ts:189-263`. Why: the board wire schema and its docblock.
- `packages/shared/src/schemas/ride.ts:23-39` (`rideOptionsSchema`), `:419-447` (`pickupPinSchema`, `riderRideSchema` docblock). Why: the contract being reused.
- `packages/shared/src/schemas/dispatch.ts` (75 lines). Why: home for `dispatcherPickupPinSchema` (keeps `ride.ts`, 467 lines, away from the cap).
- `packages/shared/src/i18n/lv.ts` (406), `en.ts` (412), `ru.ts` (420 lines, `observed` `wc -l`). Why: new keys. `en`/`ru` are pinned to `lv` by `satisfies`, and placeholder parity by `tests/i18n.test.ts`.
- `packages/shared/src/i18n/lv-rider.ts:54-58`. Why: the rider app's wording for the same two options, for consistency.

### New Files to Create

- `services/api/src/features/rides/lifecycle/pickup-pin-read.service.ts`: the dispatcher PIN read.
- `services/api/src/features/rides/lifecycle/pickup-pin-read.service.spec.ts`: unit tests (verdicts, logs never carry the PIN).
- `services/api/src/features/rides/board-ride.spec.ts`: `boardFlagsOf` unit tests.
- `apps/dispatch/src/features/override/use-pickup-pin.ts`: fetch hook.
- `apps/dispatch/src/features/override/use-pickup-pin.test.tsx`
- `apps/dispatch/src/features/override/pin-dialog.tsx`
- `apps/dispatch/src/features/override/pin-dialog.test.tsx`

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `.claude/references/logging-standard.md`. Why: event naming, and no PII or secrets on a log line.
- `.claude/references/ui-decisions.md`. Why: log badge wording and dialog cosmetics here; do not debate them.
- [MDN: `<input type="checkbox">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/checkbox), and `aria-describedby` for the hints. Why: the hint must be announced with the box. Wrap the label and use `aria-describedby`, not a `title`.
- [WAI-ARIA APG: dialog (modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Why: `DialogShell` already implements this; the PIN must be read out on arrival (see T12).

### Patterns to Follow

**Setter** (`use-booking-form.ts:230-234`):
```ts
const setPaymentMethod = useCallback(
  (method: 'cash' | 'card') =>
    setDraft((current) => ({ ...current, paymentMethod: method })),
  [],
);
```

**Tolerant board parse** (`rides.repository.ts:190`): `boardPickupSchema.safeParse(ride.request)`, where a failure drops the row. The flags must NOT drop the row: a malformed `options` must still leave the card on the board. So `boardFlagsOf` is a separate `safeParse` whose failure yields `false`. Do not widen `boardPickupSchema` to `pick({ pickup: true, options: true })`.

**Narrow service with a closed rejection set** (`arrival-announce.service.ts:28-78`): `type RejectCause = …`, `NotFoundException('ride_not_found')`, `ConflictException('<code>')`, and `logRejected(rideId, actorId, cause)` before each throw.

**Console GET** (`use-assign.ts:73-97`): `loadSession()` → `fetch(\`${apiUrl()}…\`, { headers: { authorization: \`Bearer …\` }, cache: 'no-store' })` → 401/403 → `clearSession(); router.replace('/login')` → `!res.ok` → error key → `schema.parse(await res.json())`.

**Row action with the address in its accessible name** (`row-actions.tsx:59-75`): `aria-label={formatMessage(LANG, 'console.…_at', { address })}`.

**Logging**: `{ event: 'ride.pickup_pin.dispatcher_read', rideId, actorId, at: new Date().toISOString() }`. There is no `pin` key, ever.

**Lint rules that constrain the shape** (`apps/dispatch/eslint.config.mjs` extends `eslint-config-next` core-web-vitals + typescript; `max-lines` 500):
- The fetch runs in the click handler (`reveal(rideId)`), not in a mount effect. `react-hooks/set-state-in-effect` (`eslint-plugin-react-hooks@7.1.1` via `eslint-config-next@16.3.4`, `pnpm-lock.yaml:4749`, `observed`) flags a synchronous `setState` in an effect body. `use-booking-form.ts:131-136` records that the console's lint enforces it. The handler shape avoids the question entirely.
- No `expect.any()` inside an object literal in api specs: `@typescript-eslint/no-unsafe-assignment`, from `tseslint.configs.recommendedTypeChecked` (`packages/config/eslint/base.mjs:22`), flags it. Assert fields one by one.

---

## IMPLEMENTATION PLAN

### Phase A: Contract (shared)

Board wire fields, `dispatcherPickupPinSchema`, catalog keys. Everything else imports these.

### Phase B: api

**Depends on:** A.
Board flags (`board-ride.ts` → `findBoardRides` → `buildBoardState`) and the PIN read route. The two halves are independent of each other.

### Phase C: console form

**Depends on:** A (catalog keys only).
**Independent of:** B and D. The form's body type (`DispatcherBookingBody`) already has both fields.

### Phase D: console board + PIN dialog

**Depends on:** A. Its component tests are independent of B, because they stub `fetch`. Level 4 needs B.

### Phase E: validation

The gate, then Level 4.

---

## STEP-BY-STEP TASKS

### T1 UPDATE `packages/shared/src/realtime-events.ts`: board ride flags

- **IMPLEMENT**: in `dispatchBoardEventSchema.rides[]` (`:235-262`), after `bookingChannel`, add:
  - `announceArrival: z.boolean().default(false)`. Its docblock: the ride's `options.announceArrival`, so the console can badge it (dispatcher-as-Aira). It is a request for a procedure, not a statement about the rider (#259 D1).
  - `pickupPinRequired: z.boolean().default(false)`. Its docblock: whether the ride was booked with a pickup PIN. **Never the PIN.** The PIN travels only on `riderRideSchema` and `dispatcherPickupPinSchema`. This frame is broadcast to every dispatcher socket every 2 s and persisted to `localStorage` (`use-board.ts:43-49`).
  - Add one sentence to the schema docblock on why both are `.default(false)`: a frame cached by the previous build is re-parsed at load (`use-board.ts:57-69`), and a required field would throw there and drop Dina's cached phone list.
- **GOTCHA**: `.default()` makes both fields REQUIRED in the output type `DispatchBoardEvent`. Every fixture that builds `DispatchBoardEvent['rides'][number]` fails typecheck until it gains them. Known sites (`observed`, `grep -rln unclaimedSeconds`): `apps/dispatch/src/features/board/ride-queue.test.tsx:15-26`, `apps/dispatch/src/features/override/assign-state.test.ts:~219`, `apps/dispatch/src/features/board/use-board.test.tsx:~372`. Also check `board-state.test.ts:58`, which may be an unclaimed event rather than a ride. Add both keys explicitly to each; do not spread a default.
- **VALIDATE**: `pnpm --filter @taxi/shared build && pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC3, AC4

### T2 ADD `packages/shared/tests/realtime-events.test.ts`: frame compatibility

- **IMPLEMENT**: two cases:
  - A frame whose ride has neither new key parses, and both read `false`. This is the cached-frame edge.
  - A frame with `announceArrival: true, pickupPinRequired: true` round-trips.
- **PATTERN**: the file's existing `dispatchBoardEventSchema` cases (grep `dispatchBoardEventSchema` in it).
- **VALIDATE**: `pnpm --filter @taxi/shared test -- realtime-events`
- **SATISFIES**: AC4

### T3 ADD `packages/shared/src/schemas/dispatch.ts`: `dispatcherPickupPinSchema`

- **IMPLEMENT**: `export const dispatcherPickupPinSchema = z.object({ pin: pickupPinSchema }); export type DispatcherPickupPin = …`. Import `pickupPinSchema` from `./ride`; check first that `ride.ts` does not import `./dispatch`. Docblock:
  - The response of `GET /rides/:rideId/pickup-pin`, dispatcher/admin only (#275, PR #277 L2).
  - It is a separate schema, not a field on any ride shape, so `rideSchema` stays PIN-free by construction (`ride.ts:435-447`).
  - It exists because the arrival SMS is the phone rider's only other copy of the PIN.
- **VALIDATE**: `pnpm --filter @taxi/shared build`
- **SATISFIES**: AC6

### T4 ADD `packages/shared/tests/schemas-dispatch.test.ts`: PIN response

- **IMPLEMENT**: `{ pin: '0042' }` parses and keeps the leading zeros. `{ pin: '42' }` and `{ pin: '12345' }` fail.
- **VALIDATE**: `pnpm --filter @taxi/shared test -- schemas-dispatch`
- **SATISFIES**: AC6

### T4b UPDATE the claims T3 makes false (retire the subject, not the sentence)

- **IMPLEMENT**: once `dispatcherPickupPinSchema` exists, these statements are false. Rewrite each one so it names the second, logged way the PIN leaves: the dispatcher read at `arrived` (#275).
  - `packages/shared/src/schemas/ride.ts:439`: "This is the ONLY schema that carries the PIN." becomes: the only *ride* schema; the one other carrier is `dispatcherPickupPinSchema`, a standalone response, not a ride shape. `rideSchema` must still never gain it.
  - `services/api/src/features/rides/lifecycle/ride-pickup-pin.integration.spec.ts:254`: "the ONLY response that carries the PIN" becomes "the only *ride* response…".
  - `.claude/references/ride-state-machine.md:15`: add one sentence: a dispatcher or admin can read the PIN at `arrived` via `GET /rides/:rideId/pickup-pin` (logged, #275), because the arrival SMS is a phone rider's only copy.
  - `.claude/plans/pickup-pin.md`: append an AMENDMENTS line: 2026-09-28, #275 reverses ":11 … never reaches … the dispatcher" for one logged read at `arrived` (PR #277 L2).
  - `notifications.repository.ts:72` ("for the phone rider's arrival SMS only") stays: it describes that method, which is still true.
- **VALIDATE**: `grep -rn -i "only schema that carries the pin\|only response that carries the pin\|never reaches the driver, the dispatcher" packages/shared/src services/api/src apps .claude/references` prints nothing. The first grep at `a4ed925` printed `ride.ts:439` and `ride-pickup-pin.integration.spec.ts:254` (`observed`). Grep the noun too: `grep -rn -i "pickup pin\|pickupPin" .claude/references docs/epics`, and read each hit for an exclusivity claim.
- **SATISFIES**: AC6

### T5 UPDATE `packages/shared/src/i18n/{lv,en,ru}.ts`: console keys

- **IMPLEMENT**: add under the booking block (after `'console.booking_close'`, `lv.ts:217`) and the override block. LV wording below; EN and RU get translations with the same placeholders. Keep the LV wording consistent with `lv-rider.ts:54-58`.

| key | LV |
|---|---|
| `console.booking_options` | `Iekāpšana` (fieldset legend) |
| `console.option_pickup_pin` | `PIN kods` |
| `console.option_pickup_pin_hint` | `Zvanītājs saņems PIN īsziņā, kad auto būs klāt.` |
| `console.option_announce_arrival` | `Šoferis pieteiksies balsī` |
| `console.option_announce_arrival_hint` | `Ieradies šoferis izkāps un skaļi pateiks „Sakta”.` |
| `console.badge_announce_arrival` | `Pieteikšanās balsī` |
| `console.show_pin` | `Rādīt PIN` |
| `console.show_pin_at` | `Rādīt PIN — {address}` (amended: em dash, as the other `_at` keys) |
| `console.pin_title` | `PIN kods iekāpšanai` |
| `console.pin_hint` | `Nosauciet to zvanītājam. Šoferim to nesakiet.` |
| `console.pin_failed` | `Neizdevās nolasīt PIN. Mēģiniet vēlreiz.` |
| `console.pin_error_not_arrived` | `PIN var nolasīt, kad auto ir klāt.` |

- Reuse `console.loading` (`lv.ts:50`) and `console.booking_close` (`:217`, «Aizvērt»). Do not add twins.
- **GOTCHA**: `ru.ts` is 420 lines. +12 keys is ≤ ~434 (`derived`: 420 + 12, plus a few for any wrapped two-line value). That is under the 500 cap, but check `wc -l` after. The badge wording is cosmetic: if it gets debated, log it in `ui-decisions.md` and move on.
- **VALIDATE**: `pnpm --filter @taxi/shared build && pnpm --filter @taxi/shared test -- i18n`
- **SATISFIES**: AC1, AC3, AC6 (strings from catalogs)

### T6 UPDATE `services/api/src/features/rides/board-ride.ts`: flags

- **IMPLEMENT**:
  - `const boardOptionsSchema = rideRequestSchema.pick({ options: true });`
  - `export function boardFlagsOf(request: unknown): { announceArrival: boolean; pickupPinRequired: boolean }`. On `safeParse` success it returns `options.announceArrival` and `options.pickupPin`; on failure, both `false`.
  - Docblock:
    - Why it is separate from `boardPickupSchema`: a bad `options` must degrade to "no badge", not drop the card.
    - Why it reads the request flag and not the `pickup_pin` column: the two are equal by construction (`rides.service.ts:271` mints if and only if the flag is set), and the board projection must never touch the PIN column.
    - Why there is no log on the fallback: it would repeat every 2 s per bad row, and the options were validated at write time.
  - `BoardRide` gains `announceArrival: boolean; pickupPinRequired: boolean`.
- **GOTCHA**: `options` has a `.default(...)` (`ride.ts:95-100`), so a request with no `options` key parses to all-false. That is the right answer for a legacy row, not a failure.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck` (red until T7 fills the fields; that is expected)
- **SATISFIES**: AC3

### T7 UPDATE `rides.repository.ts` `findBoardRides` + `board.service.ts`

- **IMPLEMENT**:
  - In the returned object (`rides.repository.ts:203-213`), spread `...boardFlagsOf(ride.request)`, or name both keys. Import from `./board-ride`.
  - `board.service.ts:178-199`: add `announceArrival: r.announceArrival, pickupPinRequired: r.pickupPinRequired` beside `bookingChannel`.
  - `board.service.spec.ts:52-60`: the `boardRide()` builder gains both `false`.
  - Add one case: a `boardRide({ announceArrival: true, pickupPinRequired: true })` reaches the frame with both `true`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api test -- board.service`
- **SATISFIES**: AC3

### T8 CREATE `services/api/src/features/rides/board-ride.spec.ts`

- **IMPLEMENT**: `boardFlagsOf` cases:
  - `{ options: { announceArrival: true, pickupPin: false, … } }` gives `{ true, false }` (expected).
  - `{}` gives both false (legacy edge).
  - `{ options: 'junk' }` gives both false and does not throw (failure).
  - `null` gives both false.
- **VALIDATE**: `pnpm --filter @taxi/api test -- board-ride`
- **SATISFIES**: AC3

### T9 ADD `rides.integration.spec.ts` `findBoardRides` describe (`:606-662`): flags through the real read

- **IMPLEMENT**: two cases, using the describe's `createRide(n)` pattern. Extend it, or add a sibling that sends `options`.
  - A ride booked with `options: { announceArrival: true, pickupPin: true }` reads back with both `true` (expected).
  - A row whose `request` keeps a valid `pickup` but has `options: 'junk'` (set via `ctx.db.update(rides).set({ request: { ...ride.request, options: 'junk' } })`) is **still on the board** with both `false` (edge: degrade, not drop).
- **GOTCHA**: the rider phone indices `30-33` are taken in that describe. Grep `rider(` in the file and pick unused ones.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- rides.integration` (needs the docker pg and `.env` in the worktree; see T21)
- **SATISFIES**: AC3

### T10 CREATE `pickup-pin-read.service.ts` + repository read + route + module

- **IMPLEMENT**:
  - `ride-lifecycle.repository.ts`: `findPickupPinTarget(rideId)` → `{ status: RideStatus; pin: string | null } | undefined`. It is a narrow `select({ status: rides.status, pin: rides.pickupPin })`, mirroring `findAnnounceTarget` (`:58-85`). Docblock: the one read that hands the PIN to someone other than the rider, and why (L2).
  - `pickup-pin-read.service.ts`: `@Injectable() class PickupPinReadService`, with `read(actorId: string, rideId: string): Promise<DispatcherPickupPin>`. The order:
    1. no row → `logRejected(…, 'ride_not_found')` → `NotFoundException('ride_not_found')`
    2. `pin === null` → `'pickup_pin_not_set'` → `ConflictException('pickup_pin_not_set')`
    3. `status !== 'arrived'` → `'ride_not_arrived'` → `ConflictException('ride_not_arrived')`
    4. log `ride.pickup_pin.dispatcher_read` `{ rideId, actorId, at }` at `log` level → `return dispatcherPickupPinSchema.parse({ pin })`

    The rejection log is `ride.pickup_pin.dispatcher_read_rejected` `{ rideId, actorId, cause, at }` at `warn`. `type RejectCause = 'ride_not_found' | 'pickup_pin_not_set' | 'ride_not_arrived'`.
  - Class docblock:
    - Why it exists: PR #277 L2; the arrival SMS is the phone rider's only copy.
    - Which #258 rule it reverses, and why that is acceptable: Dina is trusted staff, and the PIN guards against the wrong car, not against the dispatcher. User decision 2026-09-28.
    - Why only at `arrived`: the SMS is sent there.
    - Why every read is logged with the actor: it is the audit trail for a secret leaving the rider's hands.
  - `ride-lifecycle.controller.ts`: add `@Get(':rideId/pickup-pin') @Roles('dispatcher', 'admin') pickupPin(@CurrentUser() user, @Param('rideId', ParseUUIDPipe) rideId): Promise<DispatcherPickupPin>` → `this.pinRead.read(user.sub, rideId)`. Add `Get` to the `@nestjs/common` import and inject the service in the constructor.
  - `rides.module.ts:27-35`: add `PickupPinReadService` to `providers`.
- **GOTCHA**:
  - The check order puts `pin === null` before status, as `arrival-announce.service.ts` puts the flag before status. A non-PIN ride answers `pickup_pin_not_set` whatever its status, so the console gets the more useful error.
  - The service must never pass `pin` to the logger. T11 asserts it.
  - `ride-lifecycle.service.ts` is 472 lines (`observed`), which is why this is a new file and not a method there.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC6, AC7

### T11 CREATE `pickup-pin-read.service.spec.ts`

- **IMPLEMENT**: a stub repo (`findPickupPinTarget: jest.fn()`) and a spied `Logger`, as in `arrival-announce.service.spec.ts`. Cases:
  - `arrived` + pin `'0042'` → `{ pin: '0042' }`, and one `log` call whose `event` is `ride.pickup_pin.dispatcher_read` with `actorId` (expected).
  - Undefined row → `NotFoundException` (failure).
  - Pin `null` at `arrived` → `ConflictException` with message `pickup_pin_not_set` (edge).
  - Pin set at `arriving` → `ride_not_arrived` (edge).
  - **For every case**, `JSON.stringify(logger calls)` does not contain `'0042'`. Run each case with the same PIN so the check means something.
- **VALIDATE**: `pnpm --filter @taxi/api test -- pickup-pin-read`
  - Mutation check: temporarily add `pin` to the success log object. The "never logs the PIN" assertion must go red. Revert, and confirm it is green again.
- **SATISFIES**: AC6, AC7

### T12 ADD `ride-pickup-pin.integration.spec.ts`: the recovery path and the board, end to end

- **IMPLEMENT**: new cases after `:662`, reusing `dispatcher`, `bookByPhone`, `onlineDriver`, `accept`, `toArrived`, `start` and `rideRow`. Widen `bookByPhone`'s `options` type to `{ pickupPin?: boolean; announceArrival?: boolean }`.
  1. **Recovery (expected)**: Dina books by phone with `{ pickupPin: true }` → accept → `toArrived`. Then `GET /rides/:id/pickup-pin` as Dina → 200. `dispatcherPickupPinSchema.parse(body).pin` equals `(await rideRow(id)).pickupPin`. Then `start(id, driver.auth, thatPin)` → 201. This is the L2 scenario: the PIN reached the driver's start without the SMS being read.
  2. **Refusals (failure)**:
     - the same route with the rider's token → 403, and with the driver's → 403;
     - a random uuid → 404 `ride_not_found`;
     - a PIN ride at `accepted` (before `toArrived`) → 409 `ride_not_arrived`;
     - a phone ride booked with `{}` and taken to `arrived` → 409 `pickup_pin_not_set`.
  3. **Board (expected + leak check)**: Dina books by phone with `{ pickupPin: true, announceArrival: true }`, then `GET /dispatch/board` as Dina. `dispatchBoardEventSchema.parse(body)`: the ride has `announceArrival: true, pickupPinRequired: true`, and the frame carries no PIN (see the structural assertion below).
     - **Assert on structure, not on a substring.** A 4-digit PIN can occur by chance inside a uuid, an ISO timestamp or a lat/lng, so `not.toContain(pin)` on any JSON string flakes. Walk the ride object recursively and assert that (a) no key matches `/pin/i` except `pickupPinRequired`, and (b) no string value equals the PIN.
- **GOTCHA**:
  - Phone indices `p(53)`…`p(61)` and drivers `onlineDriver(8)`, `(9)` are in use (`observed`, grep of `p(` in the file). Grep both again and pick unused numbers.
  - The board read goes through `GET /dispatch/board` (`dispatch.controller.ts:50-54`). The socket cadence uses the same `buildBoardState`, and this ticket adds no socket event. So no socket-order test is needed; the existing `dispatch.integration.spec.ts` socket cases cover frame delivery.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- ride-pickup-pin`
- **SATISFIES**: AC3, AC6, AC7

### T13 UPDATE `booking-draft.ts`: two draft fields

- **IMPLEMENT**:
  - `BookingDraft` gains `pickupPin: boolean; announceArrival: boolean`, with a docblock: per trip, never prefilled, reset with the draft.
  - `emptyDraft` sets both `false`.
  - `draftSchema` gains `pickupPin: z.boolean().default(false), announceArrival: z.boolean().default(false)`, with a comment: a draft persisted by the previous build lacks both, and a required field would drop it. That breaks "Booking form data lost on disconnect/refresh: 0" on the first load after deploy.
- **GOTCHA**: `isEmptyDraft` stays unchanged. It has no production caller (`observed`: grep shows only its definition and `booking-draft.test.ts:112-113`).
- **VALIDATE**: `npx vitest run --root apps/dispatch src/features/phone-orders/booking-draft.test.ts` after T14's tests
- **SATISFIES**: AC1, AC2

### T14 ADD `booking-draft.test.ts`: restore compatibility

- **IMPLEMENT**:
  - `deserializeDraft(JSON.stringify(<a draft object without the two keys>), now)` returns a draft with both `false` (edge: the pre-deploy draft).
  - A draft with `pickupPin: true` round-trips through `serializeDraft`/`deserializeDraft` (expected).
  - `{ …, pickupPin: 'yes' }` returns `null` (failure: parsed, never cast).
- **VALIDATE**: `npx vitest run --root apps/dispatch src/features/phone-orders/booking-draft.test.ts` (the `@/` alias needs `--root`; `pnpm --filter … test -- <name>` runs all files)
- **SATISFIES**: AC2

### T15 UPDATE `use-booking-form.ts`: setters and the body

- **IMPLEMENT**:
  - `BookingForm` gains `setPickupPin: (on: boolean) => void; setAnnounceArrival: (on: boolean) => void`, mirroring `setPaymentMethod` (`:230-234`), and both appear in the return object.
  - In `submit`, replace `:313-319` with `options: { childSeat: false, femaleDriver: false, pickupPin: draft.pickupPin, announceArrival: draft.announceArrival }`. The comment becomes: `childSeat`/`femaleDriver` stay hard `false`, because the phone form has no control for them.
  - `prefillFrom` is unchanged. Extend its docblock's "never" list with "never the pickup options".
- **VALIDATE**: `pnpm --filter @taxi/dispatch typecheck`
- **SATISFIES**: AC1

### T16 ADD `use-booking-form.test.tsx`: body and persistence

- **IMPLEMENT**:
  - `fillBookable`, then `setPickupPin(true)` and `setAnnounceArrival(true)`, then `submit`. `api.book.mock.calls[0][0].options` equals `{ childSeat: false, femaleDriver: false, pickupPin: true, announceArrival: true }` (expected).
  - The same without the setters: both `false` (regression).
  - After a successful submit, `result.current.draft.pickupPin === false` (edge: the next caller does not inherit a tick).
  - Tick, advance the 200 ms persist, unmount, remount: the tick survives (AC #9's ledger row).
- **PATTERN**: `:74-110` (the mint-after-close test's unmount/remount).
- **VALIDATE**: `npx vitest run --root apps/dispatch src/features/phone-orders/use-booking-form.test.tsx`
- **SATISFIES**: AC1, AC2

### T17 UPDATE `booking-form.tsx`: the checkboxes

- **IMPLEMENT**:
  - After the payment `</fieldset>` (`:172`) and before the note block (`:174`), add a `<fieldset>` with legend `console.booking_options`, styled like the payment fieldset but `display: 'grid'`. It holds two rows, each a `<label>` wrapping an `<input type="checkbox" id="booking-pickup-pin">` (resp. `booking-announce-arrival`) and its label text.
  - Each input has `aria-describedby` pointing at a `<span id="…-hint">` with the hint text, in `--color-fg-muted`, `--font-size-sm`.
  - `checked={form.draft.pickupPin}`, `onChange={(e) => form.setPickupPin(e.target.checked)}`.
  - The label has `minHeight: 44`, so the whole row is the 44 px target.
  - Update the docblock at `:16-19`: phone → caller name → pickup → destination → payment → **options** → note → book.
- **GOTCHA**:
  - Focus visibility: keep the native checkbox focus ring. `apps/dispatch/src/app/globals.css` has no `outline`/`focus` rule today (`observed`, grep exit 1), so nothing suppresses it. Do not add inline `outline: none`.
  - Space toggles a focused checkbox. **Enter on a focused checkbox SUBMITS the form in Chrome** (`observed`, Level 4 step 8, 2026-09-28). So both checkboxes carry an `onKeyDown` that prevents Enter's default and flips the box, and `booking-form.test.tsx` pins it (the keyDown returns `false`, the box toggles, `book` is not called).
- **VALIDATE**: `pnpm --filter @taxi/dispatch lint && pnpm --filter @taxi/dispatch typecheck`
- **SATISFIES**: AC1, AC5

### T18 UPDATE `booking-form.test.tsx`: tab order and body through the DOM

- **IMPLEMENT**:
  - Tab-order test (`:108-133`): the expected array becomes `['booking-phone', 'booking-caller-name', 'combobox', 'combobox', 'booking-pickup-pin', 'booking-announce-arrival', 'booking-note']`. The selector `input:not([type="radio"]), textarea` already includes checkboxes.
  - New test: fill a bookable draft, `fireEvent.click(screen.getByRole('checkbox', { name: 'PIN kods' }))` and the same for «Šoferis pieteiksies balsī», submit, and `body.options` has both `true`.
  - `getByRole('checkbox', { name: 'PIN kods' })` has an accessible description equal to the hint (`toHaveAccessibleDescription`).
- **VALIDATE**: `npx vitest run --root apps/dispatch src/features/phone-orders/booking-form.test.tsx`
- **SATISFIES**: AC1, AC5

### T19 UPDATE `ride-queue.tsx` + `row-actions.tsx`: badge and «Rādīt PIN»

- **IMPLEMENT**:
  - `row-actions.tsx`:
    - Props gain `pickupPinRequired: boolean; onShowPin: () => void`.
    - Render `<button aria-label={formatMessage(LANG, 'console.show_pin_at', { address })}>{formatMessage(LANG, 'console.show_pin')}</button>` with `buttonStyle(false)`, when `status === 'arrived' && pickupPinRequired`. Place it first in the cluster, because at `arrived` it is the action that saves the ride.
    - Docblock: why only at `arrived`.
  - `ride-queue.tsx`:
    - `RideRow` renders a badge `<span>` after the driver name when `ride.announceArrival`: `formatMessage(LANG, 'console.badge_announce_arrival')`, with a border and text. It must not rely on colour alone, and it carries no `className="console-flash"` and no `role="alert"`/`status`. A comment says it is state, not an alarm (ISA-18.2, `apps/dispatch/CLAUDE.md` alarm discipline).
    - Thread `onShowPin: (ride: BoardRide) => void` through `RideRow`, `Bucket` and `RideQueue`, exactly as `onCancel` is, and pass `pickupPinRequired={ride.pickupPinRequired}` to `RideRowActions`.
- **VALIDATE**: `pnpm --filter @taxi/dispatch typecheck` (red at `page.tsx` until T22)
- **SATISFIES**: AC3, AC6

### T20 ADD `ride-queue.test.tsx`: badge and action

- **IMPLEMENT**:
  - The `ride()` builder gains `announceArrival: false, pickupPinRequired: false` (T1's gotcha).
  - Cases:
    - `announceArrival: true` renders «Pieteikšanās balsī» in that row, and a sibling row without the flag has none (expected + regression);
    - «Rādīt PIN» appears only for `status: 'arrived', pickupPinRequired: true`; it is absent at `arriving` with the flag, and at `arrived` without it (edge);
    - clicking it calls `onShowPin` with that ride;
    - its accessible name includes the address.
- **VALIDATE**: `npx vitest run --root apps/dispatch src/features/board/ride-queue.test.tsx`
- **SATISFIES**: AC3, AC6

### T21 CREATE `use-pickup-pin.ts` + `pin-dialog.tsx` (+ tests); export from `override/index.ts`

- **IMPLEMENT**:
  - `use-pickup-pin.ts`: `usePickupPin(): { state: PinState; reveal: (rideId: string) => Promise<void>; clear: () => void }`, where `type PinState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'shown'; pin: string } | { kind: 'error'; key: MessageKey }`.
    - `reveal` sets `loading` and runs a GET `${apiUrl()}/rides/${rideId}/pickup-pin` with bearer and `cache: 'no-store'`.
    - 401/403 → `clearSession(); router.replace('/login')`.
    - `!ok` → map `errorCodeOf(res)`: `ride_not_arrived` → `console.pin_error_not_arrived`, anything else → `console.pin_failed`. Export `errorCodeOf` from `use-assign.ts` and import it; do not copy it.
    - ok → `dispatcherPickupPinSchema.parse(await res.json())` → `shown`. A throw → `console.pin_failed`.
    - A stale response must not overwrite a newer one: keep a `requestId` ref, and drop a response whose id is not the latest. The case is Dina closing and reopening on another ride while the first fetch is in flight.
  - `pin-dialog.tsx`: `PinDialog({ state, onClose })` → `DialogShell title={console.pin_title}`.
    - `loading` → `console.loading`.
    - `shown` → the PIN in `fontSize: 'var(--font-size-xl)'` with `letterSpacing`, inside a `role="status"` element so a screen reader speaks it when it arrives, followed by the `console.pin_hint` line.
    - `error` → `role="alert"` paragraph, as `cancel-dialog.tsx:39-53`.
    - One «Aizvērt» button (`console.booking_close`, `dialogButtonStyle('secondary')`).
    - Docblock: the PIN is never persisted, lives only as long as the dialog, and is never shown on the row.
  - `index.ts`: export `PinDialog` and `usePickupPin`.
- **GOTCHA**:
  - Check `DialogShell`'s focus effect (`dialog-shell.tsx`): it focuses the first focusable, which is «Aizvērt». That is fine: Enter or Escape closes.
  - `--font-size-xl` exists: `theme-css.ts:17` emits `--font-size-${k}` for every `fontSize` key, and `fontSize.xl` is 24 (`theme.ts:48`).
- **TESTS**:
  - `use-pickup-pin.test.tsx`: stub `global.fetch`. Cases:
    - 200 `{ pin: '0042' }` → `shown` with `'0042'`, and the request was a GET to `/rides/<id>/pickup-pin` with the bearer (expected);
    - 409 `{ message: 'ride_not_arrived' }` → `console.pin_error_not_arrived` (edge);
    - 500 → `console.pin_failed` (failure);
    - 401 → `routerReplace('/login')` (failure);
    - two `reveal`s where the first resolves last → state shows the second's PIN (edge: stale response);
    - after `shown`, `window.localStorage` contains no `'0042'` (edge: never persisted).
  - `pin-dialog.test.tsx`: `shown` renders the digits inside `role="status"` plus the hint; `error` renders `role="alert"`; «Aizvērt» calls `onClose`.
- **VALIDATE**: `npx vitest run --root apps/dispatch src/features/override/use-pickup-pin.test.tsx src/features/override/pin-dialog.test.tsx`
- **SATISFIES**: AC6, AC5

### T22 UPDATE `apps/dispatch/src/app/dispatch/page.tsx`: wiring

- **IMPLEMENT**:
  - `OverrideTarget` gains `| { kind: 'pin'; rideId: string }`.
  - `const pinApi = usePickupPin();`
  - `openPin = useCallback((ride: { rideId: string }) => { setTarget({ kind: 'pin', rideId: ride.rideId }); void pinApi.reveal(ride.rideId); }, [pinApi.reveal])`. Destructure `reveal`/`clear` as `loadRoster`/`reset` are at `:63`, so the deps stay stable.
  - Pass `onShowPin={openPin}` to `RideQueue`.
  - Render `{target?.kind === 'pin' && <PinDialog key={target.rideId} state={pinApi.state} onClose={() => { pinApi.clear(); setTarget(null); }} />}`.
- **GOTCHA**: the offline `disabledReasonKey` (`:80-81`) gates writes. This is a read over REST, which can work while the socket is down, so it is **not** gated; a failed fetch shows `console.pin_failed`. Say so in a one-line comment.
- **TEST**: add one case to `apps/dispatch/src/features/board/dispatch-page.test.tsx`. That file replaces `useBoard` with `useBoardMock` (`:11-14`, `:72`) and keeps everything else real, so stub `global.fetch` in the case for the PIN GET. A frame with an `arrived` + `pickupPinRequired` ride → click «Rādīt PIN» → the dialog shows the stubbed PIN → Escape → no PIN text remains in the document.
- **VALIDATE**: `pnpm --filter @taxi/dispatch typecheck && npx vitest run --root apps/dispatch src/features/board/dispatch-page.test.tsx && wc -l apps/dispatch/src/app/dispatch/page.tsx` (< 500)
- **SATISFIES**: AC6

### T23 Worktree prep + full gate

- **IMPLEMENT**:
  - `pnpm install` in the worktree (it has no `node_modules` at creation, `observed`), then copy the main checkout's env file in (`cp ~/Desktop/taxi/.env .`).
  - `docker ps --filter name=taxi-redis-1 --filter name=taxi-db-1` shows both Up.
  - Clear every `dist` and `apps/dispatch/.next` with `node -e "…fs.rmSync(p,{recursive:true,force:true})"`; the hook blocks `rm -r`.
  - Check that no other session is running a gate (`ps aux | grep -c "[t]urbo run"`).
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force`. Healthy is 60–90 s. A hang with no output after ~3 min is the known flake: re-run, do not diagnose.
- **SATISFIES**: AC8

### T24 Level 4 manual run, then close-out

- **IMPLEMENT**: run Level 4 below and record the results in the execution report. Tick the L2 checkbox on #275's body with `gh issue edit`, pointing at the plan's Q1 decision.
- **SATISFIES**: AC9, AC10

---

## UX (breadboards, states, friction audit)

**Phone order, keyboard-first**

```
Board ─[⌥N]→ Order form
  phone → caller name → pickup → destination → payment(radio)
  → [☐ PIN kods]  "Zvanītājs saņems PIN īsziņā…"
  → [☐ Šoferis pieteiksies balsī]  "Ieradies šoferis izkāps…"
  → note → [Pasūtīt] ─→ Booked ─[Jauns pasūtījums]→ empty form (boxes unticked)
                              └[Aizvērt]→ Board
```

**Board and PIN recovery**

```
Board row (any bucket, announceArrival) : "Brīvības 1 · Pieņemts · Jānis · [Pieteikšanās balsī] · 3 min"
Board row (arrived, pickupPinRequired)  : [Rādīt PIN] [Atcelt braucienu]
  [Rādīt PIN] → PIN dialog: loading → "4 2 0 7" + "Nosauciet to zvanītājam. Šoferim to nesakiet." ─[Aizvērt|Esc]→ Board
                           └ error → "PIN var nolasīt, kad auto ir klāt." / "Neizdevās nolasīt PIN…" ─[Aizvērt]→ Board
```

**States**

| Surface | Loading | Empty | Error | Offline |
|---|---|---|---|---|
| Checkboxes | n/a (local state) | unticked by default | n/a | still editable and persisted. Submit is already disabled with a reason (`booking-form.tsx:215-216`) |
| Badge | n/a (frame field) | absent when false | absent on a bad `options` (degrades) | the stale banner covers the frame; the badge shows last-known |
| PIN dialog | `console.loading` | n/a | `role="alert"`, mapped key | not gated. The REST read may still work, and a failed fetch shows `console.pin_failed` |

**Targets and focus**: every checkbox row and button is `minHeight: 44`. The native focus ring stays (T17 gotcha). The dialog's focus comes from `DialogShell`.

**Friction audit** (`derived` from the breadboards; "action" = one keystroke or click)

- **Default phone order**:
  - Tab traversal: +2 Tab stops between payment and note. The previous path was phone, name, pickup, destination, payment, note, book (7 stops); it is now 9 stops on a pure-Tab walk.
  - Why justified: Enter in a resolved address field with no suggestion highlighted is left to the form, so it submits (`address-field.tsx:183-190`, `observed` by reading: `if (!open || activeIndex < 0) return;` before any `preventDefault`). Condition: the suggestion list is closed or has no active item. Under that condition a dispatcher who books from the destination field pays 0 extra actions, and the +2 falls only on one who tabs to the note. With a suggestion highlighted, the first Enter picks it and a second Enter submits, which is the same as today.
  - Alternative rejected: an «Opcijas ▸» disclosure that hides both boxes. It saves the 2 stops but costs +2 actions (open, then tick) on every opted-in order. That is the order a blind caller makes, and it is the one this ticket exists for.
- **Opted-in order**: +1 Space per option (≤ 2). This is the lowest possible for a per-booking opt-in.
- **PIN recovery**: find the row, [Rādīt PIN], read aloud, [Esc] = 2 actions after the row is found.
  - Alternative rejected: showing the PIN inline on the row costs 0 actions, but it would put the PIN on the 2 s broadcast frame and in `localStorage` (`use-board.ts:43-49`), visible to every dispatcher screen for the whole `arrived` window.

---

## TESTING STRATEGY

### Unit Tests

- shared: board frame defaults (T2), the PIN response schema (T4), catalog parity (T5, the existing `i18n.test.ts`).
- api: `boardFlagsOf` (T8), `buildBoardState` threading (T7), `PickupPinReadService` verdicts and the no-PIN-in-logs check with its mutation test (T11).
- dispatch: draft restore (T14), hook body and persistence (T16), form DOM (T18), ride queue (T20), PIN hook and dialog (T21), page wiring (T22).

### Integration Tests

- `rides.integration.spec.ts` (T9): the flags through the real `findBoardRides` read, and degrade-not-drop.
- `ride-pickup-pin.integration.spec.ts` (T12): the L2 recovery end to end through the real guard chain, the refusal matrix, and the board frame carrying the flags and not the PIN.
- Sockets: no event is added and no room is joined. The board flags travel on the existing `dispatch:board` frame, built by the same `buildBoardState` that `GET /dispatch/board` returns (`dispatch.controller.ts:50-54`, `board.service.ts:104`). So the GET test pins the payload, and the existing socket tests in `dispatch.integration.spec.ts` pin delivery.

### Edge Cases

| # | Edge case | Verified in |
|---|---|---|
| E1 | A draft persisted before deploy (no option keys) restores | T14 |
| E2 | A board frame cached before deploy parses | T2 |
| E3 | A ride row with malformed `options` stays on the board, unbadged | T8, T9 |
| E4 | The next order after a ticked booking starts unticked | T16 |
| E5 | `prefillFrom` never sets an option | T16 (assert `draft.pickupPin` stays `false` after `prefillFrom('recent', …)`) |
| E6 | PIN read before `arrived` → 409 `ride_not_arrived` | T11, T12 |
| E7 | PIN read on a non-PIN ride → 409 `pickup_pin_not_set` | T11, T12 |
| E8 | PIN read by a rider or driver token → 403 | T12 |
| E9 | The PIN never appears on a log line | T11 (with mutation) |
| E10 | The PIN never appears on the board frame | T12 case 3 |
| E11 | The PIN never reaches `localStorage` | T21 |
| E12 | A stale PIN response does not overwrite a newer one | T21 |
| E13 | «Rādīt PIN» absent at `arriving`, and absent at `arrived` without a PIN | T20 |
| E14 | The announce flag still never reaches the offer (#259 D2 regression) | existing `arrival-announce.integration.spec.ts` case (T12 of #259); re-run in the gate |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/shared build
pnpm turbo run typecheck lint --filter @taxi/shared --filter @taxi/api --filter @taxi/dispatch
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm --filter @taxi/api test -- board-ride board.service pickup-pin-read
pnpm turbo run test --filter @taxi/dispatch
```

### Level 3: Integration Tests

```bash
COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- rides.integration ride-pickup-pin arrival-announce
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force
```

### Level 4: Manual Validation

Every step uses what this ticket ships plus the seed. Tokens and rides are minted by the steps themselves, not by the seed.

1. **API over curl**, following `pickup-pin.md` Level 4 steps 1–2 and 5. Sign in a dispatcher and a driver over OTP (the codes come from the stub log). If `+37120000001` hits the OTP limit, use the dispatcher `+37120000099` (`arrival-announce-protocol-259.md:789`).
2. As the dispatcher, `POST /dispatch/bookings` with explicit coordinates, a uuid `Idempotency-Key`, a fresh `callerPhone`, and `options: { pickupPin: true, announceArrival: true }`.
3. `GET /dispatch/board` → that ride has `"announceArrival":true,"pickupPinRequired":true`, and no 4-digit PIN anywhere in its object.
4. `GET /rides/<id>/pickup-pin` as the dispatcher → 409 `ride_not_arrived`.
5. Force-assign it to the driver (`POST /dispatch/rides/<id>/assign`), then as the driver `POST arriving` and `POST arrived`.
6. `GET /rides/<id>/pickup-pin` → `{"pin":"NNNN"}`, equal to the `PIN: NNNN` in the stub SMS log line for that caller. The api log has `ride.pickup_pin.dispatcher_read` with `actorId` and **no** `NNNN` (`grep NNNN` on the log shows only the SMS stub line).
7. As the driver, `POST /rides/<id>/start {"pin":"NNNN"}` → 201, then `POST /rides/<id>/complete`, so step 8 starts from a caller with no live ride. Nothing refuses a second booking for a caller with a live ride (`observed`: no `ConflictException(` in `rides.service.ts` or `bookings.service.ts`), so this is for a clean board, not a precondition.
8. **Console UI** (`pnpm --filter @taxi/dispatch dev` plus the api; sign in at `/login` as the dispatcher). Press ⌥N and type the step-2 caller's phone. The caller lookup offers the recent ride: prefill with it, so no Places key is needed. `findRecentRides` has no status filter (`customers.repository.ts:183-196`), so the step-2 ride is listed whatever its status. Tab through and check that the order passes both checkboxes, and that each hint is visible. Tick both with Space. Then focus «PIN kods» and press **Enter**: record whether the form submits (T17 gotcha). If it did, reopen with ⌥N and continue. Book.
   - Board: the row shows «Pieteikšanās balsī».
   - Take the ride to `arrived` over curl (step 5). The row shows «Rādīt PIN». Click it: the PIN matches the SMS log. Press Escape.
   - DevTools → Application → Local Storage: no key contains the PIN.
   - Take a screenshot with `agent-browser`.
9. Restore: cancel any leftover ride as the dispatcher and take the driver offline.

### Level 5: Additional Validation (Optional)

VoiceOver on macOS Safari over the booking form: each checkbox is announced with its hint, and the PIN is spoken when the dialog loads (the `role="status"`). If this is not run, say so in the report.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1** The phone-order form has «PIN kods» and «Šoferis pieteiksies balsī» checkboxes. Each has its catalog hint and sets `options.pickupPin` / `options.announceArrival` in the `POST /dispatch/bookings` body. `childSeat` and `femaleDriver` stay `false`.
- [ ] **AC2** The options persist with the draft, restore after a reload, reset after a booking, and are never prefilled. A draft persisted by the previous build still restores.
- [ ] **AC3** A board row for a ride booked with `announceArrival` shows a text badge that is not an alarm. `BoardRide` and the wire carry `announceArrival` and `pickupPinRequired`, derived tolerantly from the request options.
- [ ] **AC4** A board frame without the new fields (cached by the previous build) parses, with both `false`.
- [ ] **AC5** Every new control is ≥ 44 px, keeps a visible focus ring, and has an accessible name (plus an accessible description for the checkboxes). The docblock and test pin the tab order as phone → name → pickup → destination → payment → options → note → book.
- [ ] **AC6** L2 is settled. `GET /rides/:rideId/pickup-pin` (dispatcher/admin) returns `{ pin }` for a PIN ride at `arrived`, and the console shows it in a dialog from «Rādīt PIN», visible only on such rows. The PIN is never on the board frame, never in `localStorage`, and never on a row.
- [ ] **AC7** Every successful read logs `ride.pickup_pin.dispatcher_read` with the actor. No log line carries the PIN (unit-tested with a mutation check). Refusals: 403 for rider/driver, 404 `ride_not_found`, 409 `pickup_pin_not_set`, 409 `ride_not_arrived`.
- [ ] **AC8** `pnpm turbo run typecheck lint test build --force` is green with `REDIS_TEST_URL` set; name the run in the report.
- [ ] **AC9** Level 4 steps 1–8 were run and recorded.
- [ ] **AC10** #275's L2 checkbox is ticked with a pointer to this plan's Q1.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Q1 (decided 2026-09-28, the user: "Dispatcher PIN read").** This **reverses an epic-level rule from #258**: "The PIN never reaches the driver, the dispatcher or the tracking page" (`pickup-pin.md:11`).
  - The driver and tracking legs are unchanged.
  - The dispatcher leg now has one door: an explicit, logged, per-ride read at `arrived`. It never passes through a ride shape (`rideSchema` stays PIN-free, so #258's fail-closed construction holds for every existing path).
  - The report and PR body must name this reversal, not bury it.
- **Q2 (decided 2026-09-28: badge announce rides only).** `pickupPinRequired` still travels on the frame, because the «Rādīt PIN» action needs it. It is rendered only as that button, not as a badge. If the user reads "announce only" as "no PIN flag on the wire at all", the alternative is to show «Rādīt PIN» on every `arrived` row and let non-PIN rides 409. That is noisier and has one more failing click. Assumed: the flag is acceptable.
- **Q3 (worst case, ordering).** Dina opens the PIN for ride A and, while the fetch is in flight, closes and opens ride B. Worst case without a guard: A's PIN is displayed under B's dialog, and Dina reads the wrong PIN to B's caller. The driver's start then fails, and five such reads lock the ride. The `requestId` guard in T21 and its test (E12) close this. The `key={target.rideId}` remount alone does not, because the state lives in the hook, not the dialog.
- **Q4 (worst case, timing).** The ride leaves `arrived` (started or cancelled) while the dialog is open. The dialog keeps showing a PIN that no longer gates anything. That is harmless: the start already happened, or the ride is gone. The next frame drops «Rādīt PIN» from the row.
- **Q5 (assumption).** «Pieteikšanās balsī» and the other LV strings are drafts in Dina's language; cosmetic changes go to `ui-decisions.md`.
- **Q6 (assumption).** Admin can read the PIN, as admin can cancel (`ride-lifecycle.controller.ts:85-92`). Admin does a dispatcher's job.

## NOTES (open canvas)

**Why the flag comes off `request.options` and not the `pickup_pin` column.** Both answer "does this ride have a PIN" (`rides.service.ts:271` mints if and only if `request.options.pickupPin`). The board projection already holds the whole `rides` row in memory (`select({ ride: rides, … })`, `rides.repository.ts:183`), so the column is technically in reach. Deriving the flag from the options keeps the projection's rule simple: nothing in `board-ride.ts` touches the PIN column. A reviewer grepping `pickupPin` in the board path should find only the request flag.

**Why a new route under `/rides` and not `/dispatch`.** The PIN column and its gate live in `rides/lifecycle` (`ride-lifecycle.repository.ts:155-185`). A `/dispatch` route would need `DispatchModule` to reach into the rides slice's PIN column across the slice boundary. The lifecycle controller already mixes roles per route (`cancel` accepts dispatcher, `ride-lifecycle.controller.ts:91-92`), so this route follows that pattern.

**Why GET and not POST.** It is a read. The audit log is a side effect of serving it, the same as any access log. `cache: 'no-store'` on the client and no `Cache-Control` from the api match every other console read (`observed`: no `@Header(` / `no-store` anywhere in `services/api/src`).

**The SMS-failed alert is not the trigger.** Tying «Rādīt PIN» to the `dispatch:sms_failed` alert was considered and rejected. An SMS can succeed at the provider and never arrive, and a caller whose phone deleted it gets no alert. The caller ringing Dina is the real trigger, so the action lives on the row.

**Locked PIN (out of scope, noted).** The driver's lock message says «Zvaniet dispečerim» (`lv.ts:397`). Dina can read the PIN but cannot unlock, so the path after a lock is still `CancelDialog`. If the device day shows drivers calling Dina after locks, an unlock is a new ticket. Do not add it here.

**Confidence**: 8/10. The api pieces mirror `arrival-announce.service.ts` closely. The main risk is the fixture sweep that T1's required output fields force; typecheck finds every site.

## AMENDMENTS

- 2026-09-28 — implementation divergences (report `.claude/reports/dispatch-phone-options-275-report.md`, Deviations 1–10):
  - T5: `console.show_pin_at` is «Rādīt PIN — {address}» (em dash, matching the other `_at` keys). EN/RU wording chosen at implementation.
  - T17: Enter on a checkbox submitted the form in Chrome, so the `onKeyDown` Enter-toggle shipped with a test (gotcha rewritten above).
  - T21: `clear()` also invalidates an in-flight read, so a late response cannot repaint a closed dialog. The `role="status"` region wraps the loading text as well as the PIN, so it is mounted before the PIN lands; the error state swaps it for `role="alert"`. `PinState` is exported from the slice barrel.
  - T11: two mutation checks (success log and rejection log). `afterEach` reads the spy calls, restores, then asserts, so a red case cannot leak into the next.
  - T12: the board leak check walks the RAW response body. The file docblock's "rider-only read" was retired alongside `:254` (T4b's rule).
  - T16: the persist case waits on `localStorage` with `waitFor`, not fake timers.
  - T1: the fixture sweep touched `ride-queue.test.tsx` and `assign-state.test.ts` only; `use-board.test.tsx:372` and `board-state.test.ts:58` build unclaimed events, not rides.
  - T9/T12 phone indices used: `rides.integration` riders 34–35; `ride-pickup-pin` drivers 11–13, dispatchers 80/82/86, callers 81/84/85/87, rider 83.

