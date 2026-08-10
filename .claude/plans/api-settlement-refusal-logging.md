# Feature: Log settlement refusals + restrict bookable payment methods (#70)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

`SettlementService.settle()` has ten exit paths; eight emit no `payment.settlement.*` event (the corrected table lives in [#70's comment](https://github.com/linardsb/taxi/issues/70#issuecomment-5225023349) — the one place kept exact). No money is stranded on any unlogged path — all eight precede `this.payments.charge()` — but a `completed` ride that refuses to settle surfaces in the barrel's reconciliation query with nothing saying why. This ticket:

1. Logs the two refusals that will actually bite — `payment_method_unsupported` (409) and `payment_instrument_missing` (409) — as a new warn-level `payment.settlement.refused` event carrying the rideId.
2. **Closes the bigger half**: a rider can book a `balance` ride today (`rideRequestBodySchema` accepts all of `PAYMENT_METHOD_TYPES`), which quotes, dispatches, completes, and then 409s at settlement forever. **Decision (Linards, 2026-08-10, via this plan's AskUserQuestion): restrict booking to `cash`|`card`** with a new `BOOKABLE_PAYMENT_METHODS` subset in `@taxi/shared`, applied to both wire bodies (`POST /rides` and `PATCH /rides/:rideId/payment-method`). The settlement guard stays as defence in depth.
3. Re-widens the barrel's mitigation sentence in `services/api/src/features/payments/index.ts` now that the logging lands, and records the bookability decision on issue #70.

## User Story

As a dispatcher (or the solo operator reading logs at 02:00)
I want every settlement refusal to name the ride and the reason in the `payment.settlement.*` stream — and want unsettleable rides to be unbookable in the first place
So that a `completed` ride surfaced by the reconciliation query explains itself, and no ride can enter a state where settlement can never succeed.

## Problem Statement

- The reconciliation query (`SELECT … FROM rides WHERE status = 'completed'`) surfaces stuck rides, but the two 409 refusals that produce them log nothing — diagnosis requires re-POSTing `settle` and reading the HTTP response.
- `payment_instrument_missing` is the **expected outcome for every card ride until #17** ships rider card enrollment, so this silence is the common case, not a corner.
- Worse: `balance`/`corporate` are bookable on the wire but have no settlement flow, so a rider can create a ride that is *permanently* unsettleable — a contract hole, not a logging gap.

## Solution Statement

- Move the `settlementMethodOf` narrowing from a free function into a private method of `SettlementService` (the ticket's suggested restructure) so it can reach `this.logger` and the ride; log `payment.settlement.refused` (warn) in both the `balance`/`corporate` arm and the `never` arm, then throw as today.
- Log the same event before the `payment_instrument_missing` throw inside `chargeIfNeeded`, which already has `this.logger` and `ride` in scope.
- Add `BOOKABLE_PAYMENT_METHODS = ['cash', 'card']` to `@taxi/shared` enums (the `DRIVER_PRESENCE_STATUSES` written-out-subset precedent) and narrow the two **wire body schemas only**. `rideRequestSchema`, `rideSchema.paymentMethod`, and the DB enum stay 4-wide, so persisted snapshots keep parsing and no migration is needed.
- Update the barrel's KNOWN GAPS prose; post the decision back to #70.

## Out of Scope / Non-Goals

- **Not logging the other six silent exits** (`ride_not_found` 404, `ride_not_yours` 403, `ride_not_completed` 409, missing-split 500, split-refinement `ZodError` 500, and the `never` arm counted separately). #70's "Done when" names only the two 409 refusals; the `never` arm gets covered for free by the restructure. Do not add log lines beyond that.
- **Not changing** any HTTP status, error string, or the order of checks in `settle()` — this is observability plus a wire-contract narrowing, zero behavior change for `cash`/`card` rides.
- **Not touching** the DB `payment_method_type` enum (`db/src/schema/enums.ts:23-26`) — no migration. `balance`/`corporate` remain valid *stored* values and valid `PAYMENT_METHOD_TYPES` members.
- **Not building** `balance`/`corporate` settlement, pre-authorization, sweepers, or retry automation (all named as accepted gaps in the barrel).
- **Not adding** a settlement-refusal socket event or admin surface — logs only.

## Feature Metadata

**Feature Type**: Enhancement (observability) + small contract change
**Estimated Complexity**: Low–Medium (small diff, but it spans `@taxi/shared` → api and carries a recorded product decision)
**Primary Systems Affected**: `packages/shared` (enums, ride schemas, tests), `services/api/src/features/payments` (settlement service, spec, barrel)
**Dependencies**: none new

## Related Work

**Implements**: [#70](https://github.com/linardsb/taxi/issues/70) — PR must say `Closes #70`.   ·   **Epic**: none (`#70` is a review follow-up deferred from PR #65 round-2, finding 2; corrected table from PR #65 round-3, finding 4; superseded-note from PR #72 round-4, finding 3). No epic engineering plan applies.

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/api-payments-ledger.md` — Why: built the settlement slice this instruments; its charge-outside-transaction and idempotency decisions are load-bearing context.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet — #17 rider card enrollment will make `payment_instrument_missing` rare; a future `balance` settlement flow re-widens `BOOKABLE_PAYMENT_METHODS`)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `services/api/src/features/payments/settlement.service.ts` (whole file, 403 lines) — Why: the file being changed. Key anchors: `settlementMethodOf` free function + docblock (lines 39–74), call site (line 131, after `assertSettlable` at 127 — so `ride.driverId` is proven non-null before both refusal points), `chargeIfNeeded` with the `payment_instrument_missing` throw (lines 284–287), `logChargeFailed` (308–336, the field-shape pattern to mirror), `logWriteFailed` (354–373), `logRejected` (375–390, debug-level, benign causes — deliberately NOT the event we extend).
- `services/api/src/features/payments/settlement.service.spec.ts` (whole file, 412 lines) — Why: the spec being extended. Key anchors: `afterEach(() => jest.restoreAllMocks())` + why-comment (162–167), the `balance`/`corporate` `it.each` (250–267), the missing-ref `it.each` (269–283), the `Logger.prototype` spy pattern (`jest.spyOn(Logger.prototype, 'error').mockImplementation()`, lines 361, 391).
- `services/api/src/features/payments/index.ts` (lines 12–61) — Why: KNOWN GAPS prose to update — the card-enrollment bullet (14–17), the balance/corporate bullet (18–21), the mitigation sentence + "THE EXITS THAT NEVER REACH THE PROVIDER LOG NOTHING" tail (33–57).
- `packages/shared/src/enums.ts` (lines 10–16 `PAYMENT_METHOD_TYPES`; 31–39 `DRIVER_PRESENCE_STATUSES`) — Why: where the new subset lands, and the exact precedent to mirror (written-out tuple + docblock explaining why not filtered — a filter loses the literal tuple `z.enum()` needs).
- `packages/shared/src/schemas/ride.ts` (lines 71–101 `rideRequestSchema`/`rideRequestBodySchema`; 187–195 `rideSchema.paymentMethod`; 256–268 `ridePaymentMethodUpdateSchema`) — Why: the two wire schemas to narrow, and the docblocks whose claims must stay true (`.omit()` keeps a plain `ZodObject` carrying defaults; server re-parses `{ ...body, riderId }` through the full schema).
- `services/api/src/features/rides/rides.service.ts` (lines 54–62) — Why: the re-parse `rideRequestSchema.parse({ ...body, riderId })` — proof the narrowing composes: subset values pass the superset enum, so this line needs **no change**.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` (lines 266–300) — Why: `updatePaymentMethod` takes `PaymentMethodType`; the narrowed `RidePaymentMethodUpdate` stays assignable, so **no change** — read to confirm, don't touch.
- `packages/shared/tests/schemas.test.ts` (lines 66–80 rejection pattern `'crypto'`; 469–516 the `rideRequestBodySchema` and `ridePaymentMethodUpdateSchema` describes) — Why: where the new contract tests land and the assertion style to mirror.
- `packages/shared/src/commission.ts` (lines 51–64) — Why: `fareSplitSchema`'s no-cent-leak refinement — context for why the split-refinement 500 exists (out of scope, but the barrel prose touches it).
- `.claude/references/logging-standard.md` (16 lines) — Why: event taxonomy `domain.component.action_state`, mandatory fields (`rideId`, `event`, `at`), never-log rules (no card data — so never log `riderCustomerRef`/`riderInstrumentRef` as fields).
- `db/src/schema/enums.ts` (lines 23–26) — Why: `paymentMethodTypeEnum` derives from `PAYMENT_METHOD_TYPES` — confirm it stays untouched (no migration).

### New Files to Create

None. Every change lands in existing files (the slice's tests already exist and are extended in place).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Issue #70](https://github.com/linardsb/taxi/issues/70) — the ticket; the **comment's corrected table** is authoritative over the body (the body's IMPORTANT note says so).
- `.claude/references/logging-standard.md` — the taxonomy the new event name must fit.
- [Zod `.extend()` docs](https://zod.dev/api#extend) — `.extend()` on a `ZodObject` returns a plain `ZodObject` (defaults on other fields survive; `.omit().extend()` composes). Needed for the `rideRequestBodySchema` change.

### Patterns to Follow

**Written-out enum subset** (`packages/shared/src/enums.ts:31-39`):

```ts
/**
 * What a driver may set for THEMSELVES. `on_ride` is deliberately absent: …
 * Written out rather than filtered from `DRIVER_STATUSES`, because a filter
 * loses the literal tuple `z.enum()` needs.
 */
export const DRIVER_PRESENCE_STATUSES = ['offline', 'online'] as const;
export type DriverPresenceStatus = (typeof DRIVER_PRESENCE_STATUSES)[number];
```

**Warn-level settlement log with structured fields** (`settlement.service.ts:324-335`):

```ts
this.logger.warn({
  event: 'payment.settlement.charge_failed',
  rideId: ride.id,
  driverId,
  riderId: ride.riderId,
  paymentMethod: ride.paymentMethod,
  …
  at: new Date().toISOString(),
});
```

**Logger assertion in specs** (`settlement.service.spec.ts:361-381`): `jest.spyOn(Logger.prototype, 'warn').mockImplementation()` before the act, `expect(logged).toHaveBeenCalledWith(expect.objectContaining({ event: …, rideId: RIDE_ID, … }))` after; cleanup is already global via `afterEach(() => jest.restoreAllMocks())` — do NOT add per-test restores (the spec's 162–167 comment explains why).

**Docblocks carry the why**: every non-obvious decision in this slice is recorded where it lives (see `settlementMethodOf`'s existing docblock — preserve its reasoning when moving it; add one sentence about why it became a method: the refusal now logs, #70).

---

## IMPLEMENTATION PLAN

### Phase 1: Shared contract — bookable subset

`@taxi/shared` first: it imports nothing from the workspace, everything imports from it, and the contract-change rule says every change ships with tests and a consumer check.

**Tasks:**

- Add `BOOKABLE_PAYMENT_METHODS` to enums (auto-exported via `export * from './enums'`)
- Narrow the two wire body schemas
- Contract tests, including the wire-vs-record asymmetry test

### Phase 2: Settlement refusal logging

**Independent of:** Phase 1 (touches different files; no type from Phase 1 is consumed here — `settle()` still narrows from the 4-wide `PaymentMethodType` because the operative `rides.payment_method` column stays 4-wide). Sequential execution is still simplest in one session.

**Tasks:**

- Restructure `settlementMethodOf` into the class; add `logRefused`; wire both refusal points
- Extend the two existing `it.each` specs with warn-spy assertions

### Phase 3: Prose + record

**Depends on:** Phases 1 and 2 (the barrel prose describes both).

**Tasks:**

- Re-widen the barrel's mitigation sentence and update the two KNOWN GAPS bullets
- Record the decision on #70 (comment posts when the PR opens)

### Phase 4: Validation

- Package tests, then the full CI-parity gate

---

## STEP-BY-STEP TASKS

### UPDATE `packages/shared/src/enums.ts`

- **IMPLEMENT**: After the `PAYMENT_METHOD_TYPES` block (line 16), add:

  ```ts
  /**
   * What a rider may BOOK — and switch to, until the lock (#70).
   *
   * `balance` and `corporate` are deliberately absent: both are
   * `PAYMENT_METHOD_TYPES` values with no settlement flow, so a booked
   * `balance` ride would complete and then answer 409
   * `payment_method_unsupported` on every settle attempt, forever. Refusing
   * the booking makes that state unrepresentable; the settlement guard
   * (`settlementMethodOf`) stays as defence in depth. Written out rather than
   * filtered from `PAYMENT_METHOD_TYPES`, because a filter loses the literal
   * tuple `z.enum()` needs — the `DRIVER_PRESENCE_STATUSES` precedent.
   * Widen this list when a method's settlement flow actually lands.
   */
  export const BOOKABLE_PAYMENT_METHODS = ['cash', 'card'] as const;
  export type BookablePaymentMethod = (typeof BOOKABLE_PAYMENT_METHODS)[number];
  ```

- **PATTERN**: `DRIVER_PRESENCE_STATUSES`, `enums.ts:31-39`
- **IMPORTS**: none (auto-exported by `packages/shared/src/index.ts:1` `export * from './enums'`)
- **GOTCHA**: Do NOT touch `PAYMENT_METHOD_TYPES` itself — the DB enum (`db/src/schema/enums.ts:23-26`), `rideSchema.paymentMethod`, and `settlementMethodOf`'s exhaustive switch all depend on it staying 4-wide.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #2 (decision made concrete in the contract)

### UPDATE `packages/shared/src/schemas/ride.ts`

- **IMPLEMENT**:
  1. Add `BOOKABLE_PAYMENT_METHODS` to the existing `../enums` import (lines 2–8).
  2. Change `rideRequestBodySchema` (line 100) to:

     ```ts
     export const rideRequestBodySchema = rideRequestSchema
       .omit({ riderId: true })
       .extend({ paymentMethod: z.enum(BOOKABLE_PAYMENT_METHODS) });
     ```

     Extend its docblock (89–99) with the narrowing rationale: the wire refuses what settlement cannot finish (#70); `.extend()` keeps this a plain `ZodObject`, and since `BOOKABLE_PAYMENT_METHODS ⊂ PAYMENT_METHOD_TYPES`, the server's re-parse of `{ ...body, riderId }` through the full `rideRequestSchema` (`rides.service.ts:61`) still yields an identical, fully-defaulted `RideRequest`.
  3. Change `ridePaymentMethodUpdateSchema` (line 264) to `paymentMethod: z.enum(BOOKABLE_PAYMENT_METHODS)`, with a docblock sentence: the switch route is the booking restriction's side door — booking `cash` then switching to `balance` before the lock would recreate the exact unsettleable ride #70 closes.
- **PATTERN**: docblock style of the surrounding schemas (every narrowing states its why and its consumer)
- **IMPORTS**: `BOOKABLE_PAYMENT_METHODS` from `'../enums'`
- **GOTCHA**: `rideRequestSchema.paymentMethod` (line 79) and `rideSchema.paymentMethod` (line 195) stay `z.enum(PAYMENT_METHOD_TYPES)` — `rideRequestSchema` is also the persisted request-snapshot shape re-parsed on DB reads, and narrowing it would make a historical `balance` snapshot unparseable. The narrowing is wire-only, by construction.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck && pnpm --filter @taxi/shared test`, then the wire-only tripwire: `grep -c "z.enum(BOOKABLE_PAYMENT_METHODS)" packages/shared/src/schemas/ride.ts` prints exactly `2` (body schema + update schema) and `grep -c "z.enum(PAYMENT_METHOD_TYPES)" packages/shared/src/schemas/ride.ts` prints exactly `2` (down from 3 — lines 79 and 195 survive, the update schema is the one that changed)
- **SATISFIES**: AC #2, AC #3

### UPDATE `packages/shared/tests/schemas.test.ts`

- **IMPLEMENT**: In the `rideRequestBodySchema` describe (line 469) add:
  - refuses `paymentMethod: 'balance'` and `'corporate'` (`safeParse(...).success === false`) — mirror the `'crypto'` rejection at line 77;
  - **the asymmetry test**: the full `rideRequestSchema` still ACCEPTS `paymentMethod: 'balance'` (with a `riderId`) — the persisted-snapshot property that keeps old rows readable, named as such in the test title.

  In the `ridePaymentMethodUpdateSchema` describe (line 505): refuses `'balance'` (the side-door test).
- **PATTERN**: existing assertions at `schemas.test.ts:75-79` and `505-516`
- **IMPORTS**: none new (`rideRequestSchema` is already imported — verify; add if not)
- **GOTCHA**: shared runs **vitest**, not jest.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #3 (≥1 expected + edge + failure on the contract change)

### UPDATE `services/api/src/features/payments/settlement.service.ts`

- **IMPLEMENT**:
  1. Delete the free function `settlementMethodOf` (lines 39–74) and recreate it as a **private method** on `SettlementService`, keeping the docblock's reasoning intact (narrowed ONCE and ABOVE THE CHARGE; the `never` arm is the point) and adding one sentence: a method rather than a free function since #70, so the refusal can log before it throws. Signature: `private settlementMethodOf(ride: SettlableRide): 'cash' | 'card'`, switching on `ride.paymentMethod`. In the `'balance'`/`'corporate'` arm AND the `never` arm: `this.logRefused(ride, 'payment_method_unsupported')` immediately before the existing throws (throws unchanged, messages unchanged).
  2. Update the call site (line 131) to `const method = this.settlementMethodOf(ride);` — keep it AFTER `assertSettlable` (line 127) so `ride.driverId` is proven non-null before any refusal logs.
  3. In `chargeIfNeeded`, before the `payment_instrument_missing` throw (lines 284–287): `this.logRefused(ride, 'payment_instrument_missing');`
  4. Add the log helper next to `logChargeFailed`:

     ```ts
     /**
      * The two 409 refusals that leave a completed ride visibly stuck (#70):
      * the reconciliation query in the barrel surfaces the ride, and this line
      * is what says why. WARN, not debug like `logRejected` — those two causes
      * are benign idempotency outcomes; these mean settling CANNOT succeed
      * until something changes (#17 enrolls the rider's card; a future flow
      * settles `balance`). The rider's customerRef/instrumentRef are never
      * logged as fields, same rule as `logChargeFailed`.
      */
     private logRefused(
       ride: SettlableRide,
       cause: 'payment_method_unsupported' | 'payment_instrument_missing',
     ): void {
       this.logger.warn({
         event: 'payment.settlement.refused',
         rideId: ride.id,
         orderId: ride.orderId,
         driverId: ride.driverId,
         riderId: ride.riderId,
         paymentMethod: ride.paymentMethod,
         cause,
         at: new Date().toISOString(),
       });
     }
     ```
- **PATTERN**: `logChargeFailed` (`settlement.service.ts:308-336`) for shape; `logRejected` (375–390) for the `cause` field idea
- **IMPORTS**: none new (`ConflictException`, `Logger`, `SettlableRide` already imported); the `PaymentMethodType` import stays (still used by nothing else? — check: after the restructure the type may become unused in this file; if so remove it from the import, per the surgical-changes rule)
- **GOTCHA**: (a) `settlementMethodOf` is module-private today — nothing else imports it (verified: not in the barrel's exports), so moving it breaks no one. (b) Keep the `const unmapped: never = method;` exhaustiveness check in the default arm — it is the compile-time tripwire the docblock is about. (c) Do NOT change `logRejected` or reuse its `payment.settlement.rejected` event — levels and semantics differ. (d) Event name `payment.settlement.refused` fits the `domain.component.action_state` taxonomy (`refused` beside the existing `rejected`, `settled`, `charge_failed`, `write_failed`).
- **VALIDATE**: `pnpm --filter @taxi/api test settlement.service.spec.ts`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/payments/settlement.service.spec.ts`

- **IMPLEMENT**:
  1. Extend the `it.each(['balance', 'corporate'])` block (lines 250–267): add `const logged = jest.spyOn(Logger.prototype, 'warn').mockImplementation();` before the act, and after the rejection assert:

     ```ts
     expect(logged).toHaveBeenCalledWith(
       expect.objectContaining({
         event: 'payment.settlement.refused',
         rideId: RIDE_ID,
         paymentMethod,
         cause: 'payment_method_unsupported',
       }),
     );
     ```
  2. Extend the missing-ref `it.each` (lines 269–283) the same way with `cause: 'payment_instrument_missing'`.
- **PATTERN**: the `write_failed` spy tests (`settlement.service.spec.ts:347-404`)
- **IMPORTS**: none new (`Logger` already imported at line 1)
- **GOTCHA**: spy on `'warn'` (not `'error'`); do NOT add per-test `mockRestore()` — the global `afterEach(() => jest.restoreAllMocks())` at line 167 exists precisely so a failing assertion can't leak the spy (its comment explains).
- **VALIDATE**: `pnpm --filter @taxi/api test settlement.service.spec.ts`
- **SATISFIES**: AC #1, AC #3

### UPDATE `services/api/src/features/payments/index.ts`

- **IMPLEMENT**: Three prose edits in the KNOWN GAPS docblock (comments only, zero code). **Transplant the replacement text below VERBATIM** — this docblock burned three review rounds on paraphrased claims, so the wording was pre-drafted during planning and truth-checked sentence-by-sentence against the verified code. If the current file text differs from the "replace" anchors quoted here, stop and re-verify instead of adapting silently.
  1. Card-enrollment bullet (lines 14–17) — replace the whole bullet with:

     ```
      * - NO RIDER CARD ENROLLMENT. `users.payment_customer_ref` /
      *   `payment_instrument_ref` are filled by #17; a card ride for a rider missing
      *   either answers 409 `payment_instrument_missing` rather than inventing a
      *   charge — and, since #70, logs `payment.settlement.refused` with the
      *   rideId.
     ```
  2. `balance`/`corporate` bullet (lines 18–21) — replace the whole bullet with:

     ```
      * - NO `balance` OR `corporate` SETTLEMENT — and, since #70, NO `balance` OR
      *   `corporate` BOOKING: `BOOKABLE_PAYMENT_METHODS` (`@taxi/shared`) narrows
      *   both wire bodies (`POST /rides` and
      *   `PATCH /rides/:rideId/payment-method`), so a ride that cannot settle can
      *   no longer be created. Both stay `PAYMENT_METHOD_TYPES` values and both
      *   are post-MVP; `settle`'s 409 `payment_method_unsupported` remains as
      *   defence in depth and now logs `payment.settlement.refused`. The ledger
      *   SHAPE accommodates them — each would simply omit the collection pair —
      *   but the flow does not.
     ```
  3. The mitigation tail (lines 52–57, from `THE EXITS THAT NEVER REACH THE PROVIDER` through `…happens on any of them.`) — replace with:

     ```
      *   MOST EXITS THAT NEVER REACH THE PROVIDER STILL LOG NOTHING — #70
      *   tabulates them (no count here: the table is the one place worth keeping
      *   exact). The exceptions, since #70, are `payment_method_unsupported` and
      *   `payment_instrument_missing`, the two that bite: each now logs a
      *   warn-level `payment.settlement.refused` carrying the rideId and cause,
      *   so the query above surfaces the stuck ride and the log says why. The
      *   rest are silent on purpose: the request-shape guards (404 / 403 /
      *   `ride_not_completed`) mean the caller sent the wrong thing — the ride is
      *   not stuck because of them — and the data-bug 500s throw loud `Error`s
      *   that surface through Nest's exception logging.
     ```

  **Truth check, done at planning time — re-run it against your final diff**: "most … still log nothing" — of the eight unlogged exits in #70's corrected table, this ticket logs three rows (both `payment_method_unsupported` arms + `payment_instrument_missing`), five stay silent, so "most" holds ✓. "no count here" — the replacement text names exits but never counts them ✓. "carrying the rideId and cause" — matches `logRefused`'s field list ✓. "the ride is not stuck because of them" — the request-shape guards reject the *call*, not the ride ✓. "data-bug 500s throw loud `Error`s … Nest's exception logging" — the missing-split `Error` carries the rideId, the split-refinement `ZodError` does NOT, which is why the text claims loudness only, never "with the rideId" ✓.
- **PATTERN**: the barrel's existing prose voice (decisions + pointers, exactness delegated to #70)
- **GOTCHA**: this docblock was the subject of three review rounds about claim accuracy (#12, PRs #65/#72) — the drafted text keeps every sentence literally true; do not "improve" or re-flow it beyond the quoted wrapping. Do not reintroduce an exit count; do not claim "every failure logs" (five exits still don't — a fact for this plan, never for the docblock).
- **VALIDATE**: `pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #4

### UPDATE issue #70 (record the decision — at PR time)

- **IMPLEMENT**: When the PR opens (piv-create-pr), post via `gh issue comment 70 --body-file <draft>`:
  - Decision: `balance`/`corporate` are **not bookable** until their settlement flows exist — `BOOKABLE_PAYMENT_METHODS = ['cash','card']` in `@taxi/shared`, enforced on `POST /rides` and `PATCH /rides/:rideId/payment-method`; `rideRequestSchema`/`rideSchema`/DB enum stay 4-wide so snapshots parse and no migration ships. Decided by Linards 2026-08-10 during planning.
  - Logging: `payment_method_unsupported` (both arms) and `payment_instrument_missing` now emit warn-level `payment.settlement.refused` with `rideId` + `cause`. The table's line numbers have shifted with the restructure; the two rows marked "will bite" now log, the other six remain silent by scope.
- **GOTCHA**: comment, don't close — the PR's `Closes #70` does that on merge. Never `gh pr review --approve` (solo repo, always fails — memory).
- **VALIDATE**: `gh issue view 70 --comments | tail -40`
- **SATISFIES**: AC #2, the ticket's "Done when" bullet 2

---

## TESTING STRATEGY

### Unit Tests

- **shared (vitest)**: contract tests pinning the wire/record asymmetry — body schemas refuse `balance`/`corporate` (failure), still accept `cash`/`card` (expected, existing tests cover), full `rideRequestSchema` still accepts `balance` (edge — the snapshot property).
- **api (jest)**: the two extended `it.each` blocks assert the refusal log fires with the right `event`/`cause`/`rideId` alongside the existing 409 + provider-untouched assertions. The existing `settled`/`charge_failed`/`write_failed` tests prove no regression in the logged happy/failure paths.

### Integration Tests

No new ones. `payments.integration.spec.ts` exercises real transactions for cash/card and is untouched by a wire-schema narrowing (it never books `balance` — verified by grep). If the full gate shows it red, that's pre-existing (check `REDIS_TEST_URL` first — Redis-backed suites `describe.skip` without it).

### Edge Cases

- `balance` in the **full** `rideRequestSchema` must still parse (persisted snapshot re-read) — the one test that would catch an over-eager narrowing.
- The `never` arm logs through the same `logRefused` call (no separate test possible while the union is closed — the compile-time `never` check is the test).
- Zero-amount card ride still short-circuits BEFORE the instrument check (spec line 238–248 already pins this order; the new log must not fire there — the existing test's `payments.calls` assertion plus no-throw covers it).

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/shared typecheck && pnpm --filter @taxi/shared lint
pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint
```

Wire-only tripwire — the narrowing must not creep past the two body schemas, and nothing in `db/` may change:

```bash
grep -c "z.enum(BOOKABLE_PAYMENT_METHODS)" packages/shared/src/schemas/ride.ts   # exactly 2
grep -c "z.enum(PAYMENT_METHOD_TYPES)" packages/shared/src/schemas/ride.ts       # exactly 2 (was 3)
grep -rn "BOOKABLE_PAYMENT_METHODS" db/src || echo "OK: db does not consume the subset"
git diff main --stat -- db/                                                       # must print nothing
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm --filter @taxi/api test settlement.service.spec.ts
```

### Level 3: Integration Tests / Full Gate (CI parity)

```bash
# REDIS_TEST_URL must be set or five suites silently skip (memory: port 6381 locally)
REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force
```

### Level 4: Manual Validation

None required — no running server needed; the behavior change is a 400 on a `balance` booking body (provable by the shared schema test) and two log lines (proven by the jest spies).

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** (ticket "Done when" 1): `payment_method_unsupported` (both arms) and `payment_instrument_missing` emit `payment.settlement.refused` (warn) carrying `rideId` — proven by the two extended jest tests.
- [ ] **AC #2** (ticket "Done when" 2): the bookability decision is recorded — in the `BOOKABLE_PAYMENT_METHODS` docblock, the barrel's KNOWN GAPS, and a comment on #70.
- [ ] **AC #3**: `rideRequestBodySchema` and `ridePaymentMethodUpdateSchema` refuse `balance`/`corporate`; full `rideRequestSchema` still accepts them; all pinned by shared tests.
- [ ] **AC #4** (ticket "Done when" 3): the barrel's mitigation sentence is re-widened, stays count-free, and every sentence in it is still literally true.
- [ ] No HTTP status, error string, or check order changed in `settle()`.
- [ ] No DB migration generated; `db/src/schema/enums.ts` untouched.
- [ ] Full gate green: `REDIS_TEST_URL=… pnpm turbo run typecheck lint test build --force`.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] Full gate green from a clean dist (`--force`), with `REDIS_TEST_URL` set
- [ ] Barrel prose re-read once end-to-end for literal truth (three review rounds say this is where regressions hide)
- [ ] PR body says `Closes #70`; #70 comment drafted/posted at PR time
- [ ] No stray edits (worktree was clean at verification; concurrent sessions share this repo, so re-check `git status` before branching)

---

## OPEN QUESTIONS / ASSUMPTIONS

- **RESOLVED (2026-08-10, Linards via AskUserQuestion during planning)**: booking restricts to `cash`|`card` (option A). Log-only was rejected because it ships a knowingly broken booking path.
- **Assumption**: no persisted ride carries `balance`/`corporate` anywhere that parses through the *body* schemas (they never do — body schemas parse wire input only). Seeds use `cash`/`card` (grep found no `'balance'` literal outside shared enums, the settlement switch, and its spec).
- **Assumption**: `payment.settlement.refused` at **warn** is right — 409s a client can cause, but each means a completed ride cannot settle until something changes; `error` is reserved for `write_failed` (money may be stranded). If review disagrees, the level is one word.
- **Assumption**: the actor (`driver`/`dispatcher`) is deliberately NOT on `logRefused` — `logChargeFailed` doesn't carry it either, and adding it would widen `chargeIfNeeded`'s signature for a diagnosis field the reconciliation flow doesn't need. Flag in PR if wanted.
- **Branch**: start fresh from `main` (e.g. `feature/api-settlement-refusals-70`). The session that planned this sits on `feature/api-review-followups-74-66` — per the concurrent-sessions memory, check `git reflog -8` and `git status` before branching.

## NOTES (open canvas)

**Why the restructure and not a call-site try/catch**: wrapping `settlementMethodOf(ride.paymentMethod)` in try/catch inside `settle()` would keep the function pure, but it logs *after* the throw is in flight, needs a re-throw, and separates the log from the decision. The ticket itself suggests "move the narrowing into the class"; the method keeps one narrowing point, gains `this.logger` + the ride, and covers the `never` arm for free ("whatever logging `:64` gets should cover it" — #70 comment).

**Why the subset is wire-only**: three layers could be narrowed — wire bodies, record schemas (`rideRequestSchema`/`rideSchema`), DB enum. Only the wire refuses new intent; records and DB describe what may *exist*, and `balance` rides may legitimately exist later (and hypothetically in old data). Narrowing records would also force the settlement `never` arm to change type — losing the compile-time tripwire that fires when someone widens `PAYMENT_METHOD_TYPES` without deciding settlement.

**Event-name choice**: `refused` vs extending `rejected` — `logRejected` (debug) covers *benign* outcomes (`already_settled`, `lost_race`) that end in a 201. Folding warn-level cannot-settle causes into it would force every log consumer to split one event by cause and level. Separate event, same `cause`-field idiom.

**What deliberately stays silent** (so a future reader doesn't "fix" it): `ride_not_found`, `ride_not_yours`, `ride_not_completed` are request-shape guards — the caller sent the wrong thing and the HTTP code says so; the ride isn't stuck *because of them*. The two 500s (missing split, refinement failure) are data bugs that already throw loud `Error`s with the rideId in the message and surface through Nest's exception logging. #70 scoped logging to the two that bite; honor that.

**Sequencing note**: Phases 1 and 2 touch disjoint files and could run in parallel worktrees, but the diff is small enough that one session, top-to-bottom, is the right call.

## AMENDMENTS

<!-- append-only; newest at the bottom -->

- 2026-08-10 — Pre-implementation verification pass (fresh session, main @ `1024250`): every file/line anchor re-confirmed exact against main; issue #70 open and matching; open PRs #75/#76/#77 touch none of this plan's files (#77 changes `settlement.policy.ts` + the payments seam — disjoint; #75 committed the spike-file dirt the checklist previously mentioned, so that bullet was reworded). `'balance'`-literal grep claim and the shared-runs-vitest gotcha re-verified.
- 2026-08-10 — Risk hardening (same session). (1) Barrel-prose risk: the three KNOWN GAPS edits now carry pre-drafted VERBATIM replacement text, truth-checked sentence-by-sentence against the code and #70's corrected table (eight unlogged exits; this ticket logs three rows, five stay silent — hence "most"). The old task text's own "three request-shape guards and the two data-bug 500s" wording violated the no-count rule it stated one sentence later; the drafted prose is numeral-free. Also corrected the GOTCHA's stale "the six above still don't" to five (the `never` arm logs via the restructure). (2) Wire-only-narrowing risk: added mechanical tripwires — grep counts on `ride.ts` (`BOOKABLE_PAYMENT_METHODS` = 2 uses, `PAYMENT_METHOD_TYPES` enum uses drop 3→2) in the ride.ts task's VALIDATE and a Level-1 block that also proves `db/` neither changes nor consumes the subset.
