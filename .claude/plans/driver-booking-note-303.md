# Feature: the driver sees the dispatcher's booking note (#303)

The following plan should be complete, but validate documentation, codebase patterns and task sanity before you start implementing.

Pay special attention to the names of existing utils, types and models. Import from the right files.

Every `file:line` below is `observed` on `origin/main` `da9c933` (2026-09-29) unless marked otherwise.

## Feature Description

Dina types a free-text note (up to 280 characters) when she books a ride for a caller by phone: "ratiņkrēsls", "zvanīt pie vārtiem", "neredzīgs, piezvanīt ierodoties". Today the note is written only into the booking audit row (`bookings.service.ts:77-85`) and no driver ever sees it. This ticket stores the note on the ride itself, in the same insert that creates the ride, and shows it to the assigned driver on the active-ride screen for the whole active ride. It is plain text. There is no Jev and no flag extraction; #271 adds those later next to this raw note.

## User Story

As a driver who took a phone booking
I want to read the note the dispatcher wrote for this ride
So that I know about a wheelchair, a gate code or a blind rider before I reach the pickup, without phoning Dina

## Problem Statement

`dispatcherBookingBodySchema.dispatcherNote` (`packages/shared/src/schemas/customer.ts:128`) is split off at `bookings.service.ts:37` and never reaches `RidesService.request`. Its only home is `dispatch_audit_log.payload.note`, written after the ride commits, outside its transaction, and allowed to fail (`auditFailed`, `bookings.service.ts:108-115`). `grep -rn dispatcherNote apps/driver/src` returns nothing (`observed`).

## Solution Statement

- **D1. Storage: a nullable `rides.dispatcher_note` text column, written inside `RidesRepository.create`'s insert** (`rides.repository.ts:79-99`). The failure AC ("the audit insert fails and the driver still sees the note") then holds by construction: the note commits with the ride or not at all. A read joined from the audit row was rejected because that row can be missing by design.
- **D2. The note is a SIBLING of `ride`, never a field of `Ride` and never inside `request`.** It follows `pickupPin` and `trip` exactly (`rides.repository.ts:242-251`, `:294-299`): `findWithQuote` returns it next to `ride`, and only `toDriverRide` projects it. `toRide` output reaches riders (`rides.service.ts:247`), the dispatch board and settlement, and `request` is on the rider's wire (`rides.service.ts:199-204`), so either placement would send health data to the rider app.
- **D3. Window: after acceptance only, for the whole active ride** (`accepted`, `arriving`, `arrived`, `in_progress`). **Linards' decision, 2026-09-29**, on the question the ticket raised. Never on the offer card, never in the offer push. This matches #259 D2 (`schemas/ride.ts:33-37`, `.claude/plans/arrival-announce-protocol-259.md:68`) and #261 (`.claude/plans/driver-ride-rider-identity.md:45`): a declining driver gets nothing, and the offer push's `data.offer` JSON goes through Expo's servers (`dispatch-notifier.ts:72-99`). The window is exported from shared as `DISPATCHER_NOTE_VISIBLE_STATUSES` and applied twice, as #261's are: server-side in `toDriverRide`, client-side in the screen (the reducer's `step_done` moves `status` without a re-read, `active-ride-state.ts:335-345`).
- **D4. Normalise once in `BookingsService`: trim, and blank becomes null.** The console sends `''` as null (`apps/dispatch/src/features/phone-orders/use-booking-form.ts:320`) but sends `'   '` as is, which would draw an empty box and fail the "no empty box" AC. The normalised value feeds both the ride column and the audit payload.
- **D5. The screen block** is a bordered `View` holding a small label «Dispečera piezīme» and the note text, with no `numberOfLines`. `Screen` scrolls (`apps/driver/src/components/Screen.tsx:21-26`), so 280 characters render in full. The wrapper is `accessible` with a composed label `[label, note].join('. ')`, the pattern at `availability/home-screen.tsx:105-108`, so TalkBack/VoiceOver read label and note as one stop.

## Out of Scope / Non-Goals

- **Not included: the note on the offer card, `rideOfferSchema` or the offer push** (D3). `offers/offer-card.tsx` and `offer-card-props.ts` are not touched.
- **Not included: Jev flags or chips.** That is #271, which is now blocked only on this.
- **Not included: showing the note on Dina's board or anywhere in `apps/dispatch`.** She wrote it.
- **Not included: the customer's `notes` field** (`customer.ts:103`, 1,000 characters). #271 lists it as a Jev input; routing it to the driver is a separate data-minimisation question.
- **Not included: an in-ride "I can't serve this" cancel for drivers.** The driver app has no cancel action (`active-ride-state.ts` only receives `cancelled`, `:411-424`). A driver who reads «ratiņkrēsls» after accepting phones Dina. This is the cost D3 accepts.
- **Not changing:** the audit row. `payload.note` is still written (now normalised, D4). The rider's `GET /rides/:rideId` body. `RidesService.request` for app bookings (the new argument defaults to null).
- **Not included: a DB length constraint.** The column is `text` like `pickup_pin`. The 280 cap is enforced at the wire by `dispatcherBookingBodySchema`, the only writer.

## Feature Metadata

**Feature Type**: Enhancement
**Estimated Complexity**: Medium (three packages plus a migration, every step mirrors an existing sibling field)
**Primary Systems Affected**: `db` (rides table), `services/api` (bookings, rides repository, driver read), `packages/shared` (window, `driverRideSchema`, catalogs), `apps/driver` (active-ride screen)
**Dependencies**: none new

## Related Work

**Implements**: #303 · **Epic**: Jev build order, step 2 of 5 (the ticket's own header). Architecture: `docs/epics/sakta-cab.architecture.md` holds no decision on rider PII or notes, so D1–D5 are ticket-level, as #261's D1–D3 were.

**Back-references**:

- `.claude/plans/driver-ride-rider-identity.md` (#261): `toDriverRide`, the status windows as shared data, the double gate.
- `.claude/plans/arrival-announce-protocol-259.md` (#259): D2 "after accept, never on the offer", and the offer-leak assertions on both legs.
- `.claude/plans/pickup-pin.md` (#258): the sibling-of-`ride` pattern on `findWithQuote`.
- `.claude/plans/dispatch-phone-options-275.md` (#275): the console's phone form, which already sends `dispatcherNote`.

**Forward-references**:

- #271 (Jev note flags): its acceptance says chips "on the offer and active-ride screens". Under D3 the offer half no longer holds. Task T15 records this on #271 as a comment. No new issue.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `services/api/src/features/dispatch/bookings/bookings.service.ts` (whole file, 116 lines): where the note is split off (`:37`), where `rides.request` is called (`:62-71`) and the audit write (`:77-85`).
- `services/api/src/features/dispatch/bookings/bookings.service.spec.ts` (`:70-100` the expected case, `:168-185` the audit-failure case): the unit patterns to extend.
- `services/api/src/features/rides/rides.service.ts` (`:63-155` `request`, `:255-308` `createRide`). **485 lines against the 500 cap** (`observed`, `wc -l`). Budget: 15 lines.
- `services/api/src/features/rides/rides.repository.ts` (`:40-60` `CreateRideInput`, `:79-99` `create`, `:236-300` `findWithQuote`).
- `db/src/schema/rides.ts` (`:92-112`): the `pickup_pin` and `trip_*` column docblocks to mirror.
- `packages/shared/src/ride-state-machine.ts` (`:35-55`): `ACTIVE_DRIVER_RIDE_STATUSES`, `RIDER_PHONE_VISIBLE_STATUSES`, `RIDER_NAME_VISIBLE_STATUSES`.
- `packages/shared/src/schemas/ride.ts` (`:315-336`): `driverRideRiderSchema`, `driverRideSchema`, and `announceRequestedAt`'s `.default(null)` precedent.
- `packages/shared/tests/schemas-driver-ride.test.ts` (whole file): shared test patterns, including the literal window pins at `:55-67`.
- `services/api/src/features/rides/lifecycle/driver-ride.ts` (whole file): `toDriverRide` (`:34-52`) and `readDriverRide` (`:84-124`).
- `services/api/src/features/rides/lifecycle/driver-ride.spec.ts` (`:1-80` the 14-status table, `:143-160` the `deps` mock).
- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` (`:230-236`): `complete` calls `toDriverRide` with two arguments. **472 lines: do not touch it.** The new parameter defaults to null and the window nulls it at `completed` anyway.
- `services/api/src/features/rides/lifecycle/ride-read.integration.spec.ts` (whole file, 435 lines): the integration home for this ticket. Prefix `+371300`. Drivers `1–6`, riders `50–54`, dispatcher `60` are taken (`observed`).
- `services/api/src/features/rides/lifecycle/arrival-announce.integration.spec.ts` (`:128-163` `onlineDriver` with a push token, `:247-270` `waitForEvent`, `:292-323` the offer-leak assertions on socket and push, `:443-473` a phone booking).
- `services/api/src/features/rides/lifecycle/ride-pickup-pin.integration.spec.ts` (`:196-218` `bookByPhone`).
- `apps/driver/src/features/active-ride/active-ride-screen.tsx` (`:158-251` the details block, `:318-331` styles).
- `apps/driver/src/features/active-ride/active-ride-screen.test.tsx` (`:20-60` the fixture, `:370-430` the #261 name/phone cases).
- `apps/driver/src/features/availability/home-screen.tsx` (`:90-113`): the composed accessible label and why it is composed.
- `packages/shared/src/i18n/lv.ts` (`:384-395`), `ru.ts` (`:317`), `en.ts` (`:312`): the `driver.ride.*` block. RU and EN are pinned by `satisfies Record<MessageKey, string>` (`ru.ts:435`, `en.ts:427`); `packages/shared/tests/i18n.test.ts` checks keys and placeholders.
- `.claude/references/logging-standard.md`: the note is free text and must never be logged, as `rideCancelSchema.reason` is reduced to a boolean (`ride-lifecycle.logging.ts:32-36`).

### New Files to Create

- `db/migrations/0014_<drizzle-generated-name>.sql` plus `db/migrations/meta/0014_snapshot.json` and the `_journal.json` entry, all by `pnpm --filter @taxi/db generate`. Never hand-written.

No new source files were planned. Implementation added one: `services/api/src/features/rides/ride-failure-reason.ts` + spec (AC8 fix, see AMENDMENTS 2026-09-29 implementation).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [React Native accessibility: `accessible`](https://reactnative.dev/docs/accessibility#accessible): a `View` with `accessible` groups its children into one focusable element.
- [React Native accessibility: `accessibilityLabel`](https://reactnative.dev/docs/accessibility#accessibilitylabel): an explicit label REPLACES the children's text, which is why the label must carry the note itself (`home-screen.tsx:90-103` records the bug this caused once).
- [Drizzle Kit generate](https://orm.drizzle.team/docs/drizzle-kit-generate): generates the SQL and the snapshot from the schema diff.

### Patterns to Follow

**Sibling field on `findWithQuote`** (`rides.repository.ts:294-299`):

```ts
return {
  ride: toRide(row, quote),
  quote,
  pickupPin: row.pickupPin,
  trip: toTrip(row),
};
```

**Window as shared data** (`ride-state-machine.ts:54-55`):

```ts
/** When a driver may see the rider's name: the whole active ride (#261). */
export const RIDER_NAME_VISIBLE_STATUSES = ACTIVE_DRIVER_RIDE_STATUSES;
```

**Server gate in the projection** (`driver-ride.ts:44-49`) and **client gate in the screen** (`active-ride-screen.tsx:165-167`):

```ts
const riderName = isInStatusSet(RIDER_NAME_VISIBLE_STATUSES, ride.status)
  ? ride.rider.displayName
  : null;
```

**Bordered block in the ride details** (`active-ride-screen.tsx:229-235`, styles `:323-329`): `styles.prompt` is `padding: spacing.md, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.md`.

**Server-side argument, never wire input** (`rides.service.ts:63-73`): `bookingChannel` is passed by the dispatcher path only; the rider controller never sets it.

**Offer-leak assertion on both legs** (`arrival-announce.integration.spec.ts:299-322`): `JSON.stringify(await offered)` must not contain the marker; the offer push's `data.offer` must be defined and must not contain it.

**Logging**: no new log line. The existing `dispatch.booking.created` event (`bookings.service.ts:89-96`) carries no note and must not gain one.

---

## UX (driver app, active-ride screen)

**Breadboard**

```
/offer  → [Pieņemt] → /active-ride
/active-ride (accepted | arriving | arrived | in_progress)
   ├─ «Pasažieris: {name}»              (existing, #261)
   ├─ arrival prompt                     (existing, #259, arrived only)
   ├─ NOTE BLOCK  «Dispečera piezīme» / {note}   ← new, only when note ≠ null
   ├─ pickup / destination / fare        (existing)
   └─ [step button] [Zvanīt pasažierim] [nav]    (existing)
/active-ride (ended) → no note block (ended view replaces the details)
```

Placement: under the arrival prompt, above the pickup line. Cosmetic; logged in `ui-decisions.md` (T14), not debated.

**States**

| State | What shows |
|---|---|
| Loading | Existing spinner (`active-ride-screen.tsx:150-152`). No note block. |
| Empty (app booking, or a phone booking with no note) | No block and no empty box. |
| Error | Existing `ride-error` Banner. The note stays if a ride is held; the error path never clears `state.ride`. |
| Offline | The note is in memory from the last read; a reconnect re-reads (`fetch_ride` on `socket_connected`). |
| Outside the window | Never reached on screen: every active status is inside it, and ended rides render the ended view. |

**Touch targets and focus**: the block is not interactive, so the 44 px rule does not apply. It is one screen-reader stop (`accessible`) with the composed label. No `accessibilityRole` and no live region: it is not announced on arrival, because the screen title is already spoken on each step and a second speaker would talk over it (#259 T0's one-speaker rule).

**Friction audit**: 0 taps from intent to done. The driver reads the note on the screen they are already on after «Pieņemt». The alternative, a «Rādīt piezīmi» disclosure, adds one tap for the case that matters most (a wheelchair at the pickup), so it is rejected.

---

## IMPLEMENTATION PLAN

### Phase A: Contract and column

`packages/shared` (window, `driverRideSchema.dispatcherNote`, one catalog key × 3) and `db` (column, migration). Rebuild shared `dist` afterwards: the apps import shared from `dist` (memory: a targeted vitest run reads a stale `dist` and goes green on a change that has not landed).

### Phase B: api write and read

**Depends on:** Phase A

`BookingsService` normalises and passes the note; `RidesService.request` threads it; `RidesRepository.create` writes it; `findWithQuote` returns it; `toDriverRide` gates it; `readDriverRide` passes it.

### Phase C: driver app

**Depends on:** Phase A · **Independent of:** Phase B (tests use `driverRideSchema.parse` fixtures; the two meet only in Level 4)

The note block on `active-ride-screen.tsx`.

### Phase D: tests, gate, manual pass, #271 note

**Depends on:** B and C

---

## PROBE RESULTS (read first)

Before handing over, every source change in T1–T3, T5–T8, T10 (source plus the `:115` fix), T11, T12 and T13 was implemented in this worktree, tested, mutation-probed, run through the full gate, then reverted. The exact diff is saved at **`/Users/Berzins/taxi-worktrees/wt-303-probe.patch`** (2,496 lines, 17 files, including the generated migration). `git apply --check` passes on `da9c933` (`observed`).

**Start with `git apply /Users/Berzins/taxi-worktrees/wt-303-probe.patch`**, then do the tasks the patch does not cover: T4 (shared tests), T9 (bookings unit tests), T10's new `driver-ride.spec` cases, T14 (ui-decisions), T15 (#271 comment), and re-run T16. Read each patched hunk against its task below before you commit; the tasks give the reasons.

| Check | Result (`observed`, this worktree, 2026-09-29, probe applied) |
|---|---|
| Full gate `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`, from cleared `dist` and `.next` | exit 0, **22/22 tasks**, api **931/931 tests, 91/91 suites, 0 skipped**, 2m33s |
| `rides.service.ts` length after prettier | **496** (cap 500). The earlier derived 491–495 was wrong: prettier wraps the `createRide(…)` call to 7 lines |
| `pnpm --filter @taxi/db generate` | `0014_redundant_mandroid.sql` = exactly `ALTER TABLE "rides" ADD COLUMN "dispatcher_note" text;` |
| T11 prototype, `ride-read.integration.spec.ts` alone | 8/8 (5 existing + 3 new) |
| T13 prototype, `active-ride-screen.test.tsx` | 34/34 (30 existing + 4 new) |
| Driver app suite | 357/357 before T13's cases were added |
| Unlisted breakage found | `driver-ride.spec.ts:115` compares the whole projection and needs `dispatcherNote: null`; now in T10 and in the patch |

Mutation probes, each run against the `#303` cases and then restored:

| Mutation | Cases red |
|---|---|
| M1 rider leak planted in `findForRider`'s return (`rides.service.ts:247`) | 1 (T11 case 1, the rider-path assertion) |
| M2 `dispatcherNote` dropped from `rides.create` values | 2 (case 1 and the audit-failure case) |
| M3 server window swapped to `RIDER_PHONE_VISIBLE_STATUSES` | 1 (case 1 at `start`) |
| M4 blank normalisation removed | 1 (case 4) |
| M5 client gate removed from the screen | 1 (T13's `offered` case) |

Facts read from code for the probe (`observed`): the rider `GET` returns `findForRider` unparsed (`rides.controller.ts:106-115`), which is why M1 can go red; `DispatchRepository` and `BookingsService` share `DispatchModule` (`dispatch.module.ts:48-56`), so the spy intercepts the real call; offers go only to drivers with status `online` (`strategies/candidate-filter.ts:30`); the accept path writes audit rows through `insertAudit`, not `insertBookingAudit` (`dispatch.repository.ts:382`).

---

## STEP-BY-STEP TASKS

### T0. Set up the worktree

- **IMPLEMENT**: work in `/Users/Berzins/taxi-worktrees/wt-303`: `git switch -c feature/driver-booking-note-303` from the current `docs/plan-303-driver-booking-note` (same base `da9c933`; the plan file is untracked and comes along), commit the plan first, then `git apply` the probe patch. The env file and `node_modules` are already in place (Linards copied the env file, 2026-09-29). Run everything DB-touching with `COMPOSE_PROJECT_NAME=taxi`. If colima's socket is dead (`start` says "already running", `docker ps` cannot connect), `colima stop && colima start`, then `COMPOSE_PROJECT_NAME=taxi docker compose up -d --wait` from the main checkout. Check `git reflog -8` in the main checkout and `ps` for another live gate first.
- **GOTCHA**: without `.env` a `REDIS_TEST_URL` gate hangs silently (memory: worktree `.env` → Redis hang).
- **VALIDATE**: `ls /Users/Berzins/taxi-worktrees/wt-303/.env && docker ps --format '{{.Names}} {{.Status}}' | grep -E 'taxi-(db|redis)-1'`
- **SATISFIES**: prerequisite

### T1. ADD `DISPATCHER_NOTE_VISIBLE_STATUSES` to `packages/shared/src/ride-state-machine.ts`

- **IMPLEMENT**: directly under `RIDER_NAME_VISIBLE_STATUSES` (`:55`):
  ```ts
  /**
   * When a driver may see Dina's booking note (#303, D3): the whole active
   * ride, never the offer. It can hold health data, so a declining driver
   * gets nothing — the same line #259 D2 draws for the announce flag.
   */
  export const DISPATCHER_NOTE_VISIBLE_STATUSES = ACTIVE_DRIVER_RIDE_STATUSES;
  ```
- **PATTERN**: `ride-state-machine.ts:54-55`
- **GOTCHA**: an alias, not a copied literal. Two copies of the list drift, and the drift fails open.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC2

### T2. ADD `dispatcherNote` to `driverRideSchema` in `packages/shared/src/schemas/ride.ts`

- **IMPLEMENT**: inside `rideSchema.extend({ … })` at `:325-335`, after `announceRequestedAt`:
  ```ts
  /**
   * Dina's free-text booking note (#303), phone bookings only. Null outside
   * `DISPATCHER_NOTE_VISIBLE_STATUSES` and when there is none. `.default(null)`:
   * a new app reading an api from before this change still parses.
   */
  dispatcherNote: z.string().min(1).max(280).nullable().default(null),
  ```
- **PATTERN**: `announceRequestedAt` at `:327-334`
- **GOTCHA**: `.min(1)`: the server never sends `''` (D4), and the contract says so. Do NOT add the field to `rideSchema`, `rideRequestSchema` or `rideOfferSchema` (D2, D3).
- **GOTCHA**: `max(280)` is the same number as `customer.ts:128`. Do not import a constant that does not exist; if you extract one (`DISPATCHER_NOTE_MAX`), use it in both places in the same commit.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC1

### T3. ADD the catalog key to `lv.ts`, `ru.ts`, `en.ts`

- **IMPLEMENT**: after `driver.ride.call_rider_hint` in each:
  - LV `'driver.ride.dispatcher_note': 'Dispečera piezīme'`
  - RU `'driver.ride.dispatcher_note': 'Заметка диспетчера'`
  - EN `'driver.ride.dispatcher_note': "Dispatcher's note"`
- **PATTERN**: `lv.ts:384-386`
- **GOTCHA**: no placeholder. The note is joined in the component (D5), so the three catalogs stay placeholder-identical for `i18n.test.ts`.
- **VALIDATE**: `pnpm --filter @taxi/shared test -- i18n`
- **SATISFIES**: AC4

### T4. UPDATE shared tests `packages/shared/tests/schemas-driver-ride.test.ts`

- **IMPLEMENT**: three cases in the existing `describe`:
  - expected: `dispatcherNote: 'Ratiņkrēsls'` parses and round-trips.
  - edge: omitted → `null` (an older api); a 280-character note mixing LV and RU parses. Build it in the test and assert `.length === 280` there, so the figure is checked, not stated. Also pin `[...DISPATCHER_NOTE_VISIBLE_STATUSES]` literally as `['accepted','arriving','arrived','in_progress']` and `toBe(ACTIVE_DRIVER_RIDE_STATUSES)`.
  - failure: `''` and a 281-character string are refused.
- **PATTERN**: `schemas-driver-ride.test.ts:49-97`
- **VALIDATE**: `pnpm --filter @taxi/shared test && pnpm --filter @taxi/shared build && grep -c DISPATCHER_NOTE_VISIBLE_STATUSES packages/shared/dist/ride-state-machine.d.ts` (expect ≥ 1; `index.d.ts` only re-exports with `export *`, so it never names the constant)
- **SATISFIES**: AC1, AC2, AC6

### T5. ADD the column in `db/src/schema/rides.ts` and generate the migration

- **IMPLEMENT**: after `tripDurationSeconds` (`:112`):
  ```ts
  /**
   * Dina's free-text note for the driver on a phone booking (#303), written
   * in the ride's own insert so it cannot be lost with the audit row. NULL =
   * no note, an app booking, or a legacy row. Can hold health data: never
   * logged, never projected onto `Ride`; only the driver read carries it.
   */
  dispatcherNote: text('dispatcher_note'),
  ```
  Then `pnpm --filter @taxi/db generate`.
- **PATTERN**: `pickupPin` at `:92-97`
- **GOTCHA**: the generated SQL must be exactly one `ALTER TABLE "rides" ADD COLUMN "dispatcher_note" text;`. Anything else in the diff means the snapshot had drifted. Stop and look before committing it.
- **VALIDATE**: `ls db/migrations | tail -2 && cat db/migrations/0014_*.sql && pnpm --filter @taxi/db typecheck`
- **SATISFIES**: AC3

### T6. UPDATE `services/api/src/features/rides/rides.repository.ts`

- **IMPLEMENT**:
  - `CreateRideInput` (`:40-60`): `/** Dina's note (#303); null off the phone path and when blank. */ dispatcherNote: string | null;`
  - `create()` values (`:85-99`): `dispatcherNote: input.dispatcherNote,`
  - `findWithQuote` return type (`:247-256`) gains `dispatcherNote: string | null;` and the return (`:294-299`) gains `dispatcherNote: row.dispatcherNote,`. Extend the docblock sentence at `:242-245`: "`dispatcherNote` (#303) is a sibling for the same reason: only the driver read projects it."
- **PATTERN**: `pickupPin` in all three places
- **GOTCHA**: `CreateRideInput.dispatcherNote` is required, not optional, so the compiler finds every `create()` caller. Specs that mock the repository use `as unknown as` and stay green; a spec that calls the real `create()` (`rides.integration.spec.ts`'s `createRide` helper) needs the field.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC3

### T7. UPDATE `services/api/src/features/rides/rides.service.ts`

- **IMPLEMENT**:
  - `request()` gains a sixth parameter after `rateLimitSubject`: `dispatcherNote: string | null = null,` with a docblock of at most 3 lines: "Dina's note (#303), server-side like `bookingChannel`: the rider body has no such field. Stored on the ride, read only by its driver."
  - pass it to `createRide(key, request, riderId, bookingChannel, dispatcherNote)` (`:142`), add the parameter to `createRide` (`:255-260`), and `dispatcherNote,` in the `rides.create({ … })` call (`:264-273`).
- **GOTCHA**: **the file is 485 lines and the cap is 500** (`max-lines`, `packages/config/eslint/base.mjs`, counts comments and blanks). The patched file is **496 lines** (`observed`); do not add anything else here, not even a comment. As shipped: **497**, after the one-line import of `rideFailureReason` (AMENDMENTS).
- **GOTCHA**: never log the note. `ride.request.created` (`:282-292`) and `ride.request.failed` (`:299-305`) stay as they are.
- **VALIDATE**: `wc -l services/api/src/features/rides/rides.service.ts` (≤ 500) `&& pnpm --filter @taxi/api lint`
- **SATISFIES**: AC3

### T8. UPDATE `services/api/src/features/dispatch/bookings/bookings.service.ts`

- **IMPLEMENT**:
  - After `:37`: `const note = dispatcherNote?.trim() ? dispatcherNote.trim() : null;` with a two-line comment: blank is "no note" (D4), because the console sends whitespace as typed and the driver would get an empty box.
  - `this.rides.request(user.id, idempotencyKey, rideBody, 'phone', dispatcherId, note)` (`:62-71`). Extend the existing comment block by one line: the note rides in the ride's own insert (#303), so it survives the audit failure below.
  - The audit payload (`:82`) uses `note` instead of `dispatcherNote`.
- **GOTCHA**: `dispatcherNote` is typed `string | null` after the zod default. Do not use `||` on a trimmed string where `''` and `null` must both end as `null`; the ternary above is explicit. `@typescript-eslint/prefer-nullish-coalescing` is not in `recommendedTypeChecked`, so no rule forces either form.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC3, AC5

### T9. UPDATE `bookings.service.spec.ts`

- **IMPLEMENT**:
  - expected (`:70-100`): destructure a sixth element `note` from `rides.request.mock.calls[0]` and assert it is `'zvana no bāra'` (the `BODY` note). The existing `rideBody` assertion that `dispatcherNote` is absent stays.
  - edge: `dispatcherNote: '  Ratiņkrēsls  '` reaches `rides.request` as `'Ratiņkrēsls'` and the audit as `{ note: 'Ratiņkrēsls' }`; `'   '` reaches both as null / `{}`.
  - failure (`:168-185`): additionally assert `rides.request` was called with the note as its sixth argument BEFORE the audit rejected. This is the unit half of the audit-failure AC; T11's integration case is the half that proves the driver sees it.
- **VALIDATE**: `pnpm --filter @taxi/api test -- bookings.service`
- **SATISFIES**: AC3, AC5

### T10. UPDATE `driver-ride.ts` and `driver-ride.spec.ts`

- **IMPLEMENT** (`driver-ride.ts`):
  - `toDriverRide(ride, identity, announceRequestedAt = null, dispatcherNote: string | null = null)`; in the returned object: `dispatcherNote: isInStatusSet(DISPATCHER_NOTE_VISIBLE_STATUSES, ride.status) ? dispatcherNote : null,`. Import the set from `@taxi/shared`. Add one docblock sentence: "`dispatcherNote` (#303) is gated on the snapshot's status as well."
  - `readDriverRide` (`:117-123`): pass `found.dispatcherNote` as the fourth argument.
  - `complete` in `ride-lifecycle.service.ts` is NOT changed: it passes two arguments, and at `completed` the window nulls the note anyway.
- **IMPLEMENT** (`driver-ride.spec.ts`):
  - extend the 14-status `it.each` (`:61-66`) or add a sibling one: `toDriverRide(ride(status), ANNA, null, NOTE).dispatcherNote` equals `NOTE` exactly in the four active statuses and `null` in the other ten, parsed through `driverRideSchema`.
  - edge: a null note stays null at `accepted`.
  - the `deps` mock (`:143-155`): `findWithQuote` resolves `{ ride: ride(status), dispatcherNote: NOTE }`; add one `readDriverRide` case asserting the note arrives at `accepted`.
- **GOTCHA**: the mock is `as unknown as DriverRideReadDeps`, so a mock without `dispatcherNote` yields `undefined`, which `.default(null)` turns into null on parse. The new case must set it, or it passes on nothing.
  - **`driver-ride.spec.ts:115` must change** (the probe found it): `expect(rest).toEqual({ ...base, announceRequestedAt: null, dispatcherNote: null })`. It is in the patch.
- **VALIDATE**: `pnpm --filter @taxi/api test -- driver-ride`, then the mutation probe: change `DISPATCHER_NOTE_VISIBLE_STATUSES` in `toDriverRide` to `RIDER_PHONE_VISIBLE_STATUSES` and run again. Expect the `in_progress` row to go red. Record the result, then revert.
- **SATISFIES**: AC1, AC2

### T11. ADD integration cases to `services/api/src/features/rides/lifecycle/ride-read.integration.spec.ts`

- **IMPLEMENT** helpers (spec files are uncapped):
  - `bookByPhone(dispatcherAuth, callerPhone, dispatcherNote)`: mirror `ride-pickup-pin.integration.spec.ts:196-218` (`POST /dispatch/bookings`, push to `createdRides`).
  - `waitForEvent`: copy `arrival-announce.integration.spec.ts:247-270`.
  - `onlineDriver(n, location, pushToken?)`: add the optional push-token `PUT /drivers/me/push-token` (expect 204) from `arrival-announce.integration.spec.ts:145-151`.
  - Numbers: drivers `7`, `8`, `9`, `10`; callers `55`, `56`, `57`; app rider `58`; dispatchers `61`, `62`, `63` (one per case). All unused in `+371300` (`observed`). The patch holds the finished cases (8/8 green, M1–M4 red).
- **IMPLEMENT** cases, in the app's order (book → offer → accept → driver `GET`), which is `bookAndAccept`'s order (`:203-213`):
  1. **expected + edge + leak (window, offer, rider path)**: driver `7` online with a push token and a connected socket; Dina books caller `55` with `NOTE_280` (a 280-character LV+RU string built in the test, `.length` asserted). Assert the booking's 201 body does not contain a marker substring of the note. Arm `waitForEvent(socket, RT.rideOffer, ride.id)`, `offerTo(ride)`. Assert `JSON.stringify(offer)` does not contain the marker, and the offer push's `data.offer` is defined and does not contain it (`arrival-announce…:309-322`). Accept. Driver `GET` → `dispatcherNote === NOTE_280` exactly (byte-for-byte through Postgres). **Rider path, same ride, same `it`:** sign in as caller `55` (`signIn(p(55), 'rider')`, the booking created the rider) and `GET /rides/:rideId`; the raw body has no `dispatcherNote` key and `JSON.stringify(body)` does not contain the marker. Then step `arriving`, `arrived`, `start`: note present on each driver read. `complete`: the reply's `ride.dispatcherNote` is null, and a re-read is null.
  2. (folded into case 1: the file's `afterEach` cancels every created ride and takes drivers offline, so a second `it` cannot reuse case 1's ride)
  3. **failure (audit insert fails)**: `const spy = jest.spyOn(ctx.app.get(DispatchRepository), 'insertBookingAudit').mockRejectedValueOnce(new Error('audit down'))`; Dina books caller `56` with a short note; expect 201; `expect(spy).toHaveBeenCalledTimes(1)`; **before `offerTo`**, assert `dispatch_audit_log` has no row for this ride (the accept path later writes assignment rows through a different method, `insertAudit`, `dispatch.repository.ts:382`, so a check after accept would find those). Then driver `8` accepts and the driver `GET` carries the note. `spy.mockRestore()` in a `finally`.
  4. **edge (no note, no key)**: caller `57` booked with `dispatcherNote: '   '`, accepted by driver `9`; app rider `58` books via `book(riderAuth)`, accepted by driver `10`. One driver per ride: a driver who accepted is `on_ride` and `offerNext` will not offer them a second ride. Bring driver `10` online only after driver `9` has accepted, so each offer has one candidate. Both driver reads have `dispatcherNote: null`, and the `rides` row has `dispatcher_note` NULL for both.
- **IMPORTS**: `DispatchRepository` from `'../../dispatch/dispatch.repository'` (it is not on the barrel, `features/dispatch/index.ts`; no lint rule restricts deep imports in specs, `observed` in both eslint configs). `dispatchAuditLog` from `@taxi/db`.
- **GOTCHA**: `@typescript-eslint/unbound-method` (in `recommendedTypeChecked`) flags `expect(repo.insertBookingAudit)`; assert through `spy`.
- **GOTCHA**: driver `7` must be the only driver online near the pickup when the ride is offered, or the cascade may offer another and the socket wait times out. Bring drivers `8` and `9` online only in their own cases; `afterEach` already marks every used driver offline.
- **GOTCHA** (memory): any api integration suite can flake under the full gate and pass alone. A red here under the gate is re-run once before it is diagnosed.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test -- ride-read.integration` (adjust the Redis port to `.env`'s `REDIS_PORT`).
- **VALIDATE (revert probe for the rider leak)**: NOT in `toRide`: it returns `rideSchema.parse(…)` (`ride-row.ts:71`), which strips an unknown key, so a leak planted there stays green and proves nothing. Plant it where nothing parses afterwards, `findForRider`'s return (`rides.service.ts:247`): `{ ...snap.ride, split: null, pickupPin: snap.pickupPin, dispatcherNote: snap.dispatcherNote }` (cast if typecheck objects). Run case 1, expect RED on the rider-path assertion; revert, expect GREEN. Record both. If it stays green with the leak planted, the controller strips the key: record that the rider path is blocked structurally, and say so in the report.
- **SATISFIES**: AC1, AC2, AC3, AC5, AC6

### T12. UPDATE `apps/driver/src/features/active-ride/active-ride-screen.tsx`

- **IMPLEMENT**:
  - next to `riderName` (`:165-167`): `const note = isInStatusSet(DISPATCHER_NOTE_VISIBLE_STATUSES, ride.status) ? ride.dispatcherNote : null;` Extend the comment at `:162-164` to name the third window.
  - after the announce prompt (`:235`), before the pickup line:
    ```tsx
    {note ? (
      // One screen-reader stop. The label is composed: an explicit label
      // REPLACES child text, so a static one would drop the note from
      // the audio channel (the bug `home-screen.tsx` records as F4).
      <View
        style={styles.note}
        accessible
        accessibilityLabel={[t('driver.ride.dispatcher_note'), note].join('. ')}
        testID="dispatcher-note"
      >
        <Text style={styles.noteLabel}>{t('driver.ride.dispatcher_note')}</Text>
        <Text style={styles.detail}>{note}</Text>
      </View>
    ) : null}
    ```
  - styles: `note: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, gap: spacing.xs }` and `noteLabel: { fontSize: fontSize.sm, color: colors.fgMuted }`. All four names exist in `packages/shared/src/theme.ts` (`colors.border` `:18`, `colors.fgMuted` `:17`, `spacing.xs` `:30`, `fontSize.sm` `:45`, `observed`).
- **GOTCHA**: no `numberOfLines` on the note `Text` (AC6). No `accessibilityRole`, no live region, no Banner.
- **GOTCHA**: `colors.border`, not `colors.accent`: the accent border belongs to the arrival prompt, an instruction; the note is information.
- **VALIDATE**: `pnpm --filter @taxi/driver typecheck && pnpm --filter @taxi/driver lint`
- **SATISFIES**: AC4, AC5, AC6

### T13. UPDATE `apps/driver/src/features/active-ride/active-ride-screen.test.tsx`

- **IMPLEMENT** (the fixture at `:20-60` already parses through `driverRideSchema`, so omitting the field gives null):
  - expected: `ride({ status: 'accepted', dispatcherNote: 'Ratiņkrēsls' })` renders `dispatcher-note`; its `accessibilityLabel` is `'Dispečera piezīme. Ratiņkrēsls'` (build it from `t()`, as the #261 cases do at `:375`).
  - edge: `NOTE_280` (LV+RU, length asserted) renders whole: `getByText(NOTE_280)` matches the full string, and that `Text`'s `props.numberOfLines` is undefined.
  - edge: `in_progress` still shows it (whole-ride window).
  - edge (no empty box): the default fixture (null note) has no `dispatcher-note` node.
  - failure (client gate): a fixture at `offered` with a non-null note renders no `dispatcher-note` node. `observed`: this case goes red when the gate is removed (M5), so the screen does render details at `offered` and the case is not vacuous.
- **GOTCHA** (memory): RNTL 14: `await act(async …)` always; `toHaveTextContent` is whole-text.
- **VALIDATE**: `pnpm --filter @taxi/driver test -- active-ride-screen`
- **SATISFIES**: AC4, AC5, AC6

### T14. ADD a line to `.claude/references/ui-decisions.md`

- **IMPLEMENT**: `2026-09-29 · driver · Dina's booking note is a bordered block (`colors.border`, `spacing.md` padding) under the arrival prompt and above the pickup line, a muted «Dispečera piezīme» label over the note text; one screen-reader stop (#303).`
- **VALIDATE**: `tail -1 .claude/references/ui-decisions.md`
- **SATISFIES**: CLAUDE.md cosmetic-log rule

### T15. Record D3 on #271

- **IMPLEMENT**: `gh issue comment 271 --body-file <scratchpad file>`: "#303 shows Dina's note to the driver after acceptance only, never on the offer (Linards' decision, 2026-09-29; same line as #259 D2). This ticket's acceptance line 'chips on the offer and active-ride screens' therefore becomes 'chips on the active-ride screen'." No new issue.
- **GOTCHA** (memory): keep closing keywords away from `#N` in the body.
- **VALIDATE**: `gh issue view 271 --comments | tail -5`
- **SATISFIES**: Forward-reference

### T16. Full gate

- **VALIDATE**: clear `dist` and `apps/dispatch/.next` first (memory: stale `.next` race), then `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:<REDIS_PORT> pnpm turbo run typecheck lint test build --force`. Budget one re-run for a flaky api suite.
- **SATISFIES**: all

---

## TESTING STRATEGY

### Unit Tests

- `packages/shared/tests/schemas-driver-ride.test.ts` (T4): contract, default, bounds, literal window pin.
- `services/api/.../bookings.service.spec.ts` (T9): the note reaches `rides.request`, normalisation, and the audit-failure ordering.
- `services/api/.../driver-ride.spec.ts` (T10): the window over all 14 statuses, and the read passing the sibling through.
- `apps/driver/.../active-ride-screen.test.tsx` (T13): render, accessible label, full length, no empty box, the client gate.

### Integration Tests

`ride-read.integration.spec.ts` (T11). This ticket adds no socket event or room join. It does assert on the existing `ride:offer` delivery (a leak check), in the app's order: the driver's socket is connected before the offer is made, the offer arrives, then the driver accepts and reads over REST, which is `bookAndAccept`'s order and the driver app's.

### Edge Cases

| Edge case | Where verified |
|---|---|
| 280-character note, LV + RU characters, byte-for-byte through Postgres | T11 case 1 |
| 280-character note renders in full on screen | T13 edge; Level 4 step 3 |
| 281 characters refused at the wire | existing `schemas-customer.test.ts:63-67`; T4 for the driver contract |
| Whitespace-only note → no box | T9 edge, T11 case 4 |
| App booking → no box | T11 case 4, T13 edge |
| Audit insert fails → driver still sees the note | T9 failure (unit), T11 case 3 (integration) |
| Note on the offer socket event or the offer push | T11 case 1 (must be absent) |
| Note on the rider's `GET /rides/:rideId` or the booking 201 | T11 case 1 (must be absent), with the revert probe |
| Note after `completed` | T10 table, T11 case 1 |
| Idempotent replay of a phone booking | not a new case: the replay returns the ride the first request wrote, note included; `bookings.integration.spec.ts:127` covers the replay itself |
| VoiceOver reads it as one stop | not performable here (owed by #257's hardware, as in #261); Level 4 step 4 covers TalkBack |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/shared typecheck && pnpm --filter @taxi/shared lint
pnpm --filter @taxi/db typecheck
pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint
pnpm --filter @taxi/driver typecheck && pnpm --filter @taxi/driver lint
wc -l services/api/src/features/rides/rides.service.ts   # ≤ 500
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm --filter @taxi/shared build   # the driver app reads dist
pnpm --filter @taxi/api test -- bookings.service driver-ride
pnpm --filter @taxi/driver test -- active-ride-screen
```

### Level 3: Integration Tests

```bash
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:<REDIS_PORT> pnpm --filter @taxi/api test -- ride-read.integration bookings.integration
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:<REDIS_PORT> pnpm turbo run typecheck lint test build --force
```

### Level 4: Manual Validation (emulator `sakta224`)

State comes from the #15 device-pass recipe, `.claude/plans/driver-15-offers-device-pass.md` §"START the stack and the accounts": dispatcher `+37120000001`, driver `+37120000002`. Run `pnpm --filter @taxi/db migrate` against the dev DB first, so `dispatcher_note` exists. Every step below is reachable with that recipe plus the dispatch console's phone form, which already sends `dispatcherNote` (`use-booking-form.ts:320`).

1. Driver online on the emulator. In the console (`/dispatch`), book a new caller with the note `Ratiņkrēsls, zvanīt pie vārtiem. Инвалидная коляска.`
   - **Expect:** the offer card shows no note.
   - **Artifact:** a screencap of the offer card.
2. Accept.
   - **Expect:** the block «Dispečera piezīme» with the full note, under the rider name and above the pickup line, as in the breadboard.
   - **Artifact:** a screencap.
3. Book a second ride with a 280-character note (paste from T11's `NOTE_280`), accept.
   - **Expect:** the full text visible by scrolling, not cut with an ellipsis.
4. TalkBack on, swipe to the block.
   - **Expect:** one stop reading «Dispečera piezīme. Ratiņkrēsls, …» (`Speaking fragment` in logcat).
5. Step through to `in_progress`: the block stays. Complete: the ended view shows no note.
6. Book a third ride with an empty note, accept.
   - **Expect:** no block and no empty box.
7. **Not performable here:** VoiceOver on iOS (owed by #257's hardware, as #261 Level 4 step 6). Say so in the report; do not mark it passed.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1**: A driver's `GET /rides/:rideId` body parses as `driverRideSchema` with `dispatcherNote` equal to the note of a phone booking, and `null` for an app booking or a booking without a note.
- [ ] **AC2**: The note is non-null only in `accepted`, `arriving`, `arrived` and `in_progress` (D3), enforced by `toDriverRide` over all 14 statuses and by the screen's gate on the same shared set.
- [ ] **AC3**: The note is written in the ride's own insert. With `insertBookingAudit` failing, the booking returns 201 and the assigned driver still reads the note.
- [ ] **AC4**: The active-ride screen shows «Dispečera piezīme» and the note as one screen-reader stop whose label carries both, with the label in LV/RU/EN catalogs.
- [ ] **AC5**: No empty box: a null or whitespace-only note renders nothing.
- [ ] **AC6**: A 280-character note with Latvian and Russian characters survives the DB byte for byte and renders in full.
- [ ] **AC7**: The note is absent from the `ride:offer` socket payload, the offer push, the rider's `GET /rides/:rideId`, and the booking's 201 body. The rider-read case is shown RED with a deliberate leak and GREEN without.
- [ ] **AC8**: No log line contains the note.
- [ ] **AC9**: `pnpm turbo run typecheck lint test build --force` green with `REDIS_TEST_URL` set (`observed`, name the run).
- [ ] **AC10**: #271 carries the D3 comment.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] T10's mutation probe and T11's revert probe recorded with both results
- [ ] Full gate green (T16)
- [ ] Level 4 steps 1–6 run with artifacts; step 7 recorded as not performable
- [ ] `rides.service.ts` ≤ 500 lines
- [ ] `ui-decisions.md` line added

---

## OPEN QUESTIONS / ASSUMPTIONS

- **A1. Worst case of the snapshot race.** `readDriverRide` reads the ride (with its note) and gates on that snapshot's status. The worst case is a note shown one read after the ride left `in_progress`. That cannot happen on screen: every status after `in_progress` renders the ended view, which has no details block.
- **A2. Worst case of a release.** A dispatcher release (`accepted → requested`) moves the ride to a second driver. Driver 1's next read 404s and the app shows «released» (`driver-ride.ts:106-113`), so the note leaves driver 1's screen at the next event or read. Until then driver 1 still holds it in memory; that is the same exposure #261 accepted for the phone. Driver 2 sees the note after accepting.
- **A3.** The column is written once at creation and never updated. Dina cannot edit a note after booking; that is today's behaviour too.
- **A4.** The audit payload now stores the trimmed note (D4). Before, it stored the raw string. The S9-2 trail's purpose (who booked on whose behalf) is unaffected.
- **Q1 (answered).** Window: after accept only, for the whole active ride. Linards, 2026-09-29.

## NOTES (open canvas)

**Rejected: read the note from the audit row.** The audit write is deliberately outside the ride's transaction and may fail (`auditFailed`). A driver read joined to it would show no note on exactly the rides where logging broke, with nothing to tell the driver a note existed.

**Rejected: put the note in `request` (the jsonb wire snapshot).** One line of code, and it would reach the rider's own read (`findForRider` spreads `snap.ride`, whose `request` is the full snapshot), the dispatch board, and `offerNext`'s input. `rideOfferSchema.parse` would strip it from the offer, but the rider leak alone rules it out.

**Rejected: a field on `Ride`.** Same reason: `toRide` output is handed to every surface. The sibling pattern exists for exactly this (`rides.repository.ts:242-245`).

**Why `ride-read.integration.spec.ts` and not a new file.** It is the driver read's own spec, it has the dispatcher helper and `bookAndAccept`, and its number range has room. A new file would need a new `phoneFor` prefix and a second copy of every helper.

**Line budget, `observed`.** `rides.service.ts` is 496 after the patch and prettier. My pre-probe derivation (491, or 495 if the call wrapped) was wrong: the call wraps to 7 lines, not 5. Kept here as the record of a figure the probe corrected.

## AMENDMENTS

- 2026-09-29 — Probe pass at Linards' request ("increase confidence to 10 and address all risks"). The code was implemented, gated and reverted; the patch is saved. Added PROBE RESULTS, corrected the line budget (491 derived → 496 observed), added the `driver-ride.spec.ts:115` fix to T10, gave one dispatcher per T11 case, resolved T13's gate case to `offered` (proven non-vacuous by M5), and rewrote T0 for the prepared worktree.
- 2026-09-29 — Implementation (report `.claude/reports/driver-booking-note-303-report.md`). Superseded or added, as shipped:
  - **AC8 fix, not in any task:** drizzle-orm 0.45.2's `DrizzleQueryError` message carries the bound params, and `ride.request.failed` logged `error.message`, so a failed ride insert would have logged the note. Added `rides/ride-failure-reason.ts` (`rideFailureReason`: a query failure → `query_failed:<SQLSTATE>`, otherwise the message) with a 3-case spec, wired at `ride.request.failed`. `rides.service.ts` is 497 lines.
  - **T9:** the note is read through a `noteArg` helper (`mock.calls[0][5]` tripped `no-unsafe-member-access`), and the failure case also asserts `rides.request` ran before `insertBookingAudit` (`invocationCallOrder`, `?? 0` fails closed).
  - **T4:** `NOTE_280` is built as `'Ratiņkrēsls, коляска. '.repeat(13).slice(0, 280)`.
  - **T13:** "in_progress still shows it" is covered by the 280-character case, which renders at `in_progress`. It has no separate case.
  - **Level 4 step 6:** run with a whitespace-only note (`'   '`), the D4 case, instead of an empty one.
