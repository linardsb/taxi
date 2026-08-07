# Feature: API payments + ledger — cash + Stripe test mode via seam, integer-cent ledger, cash-commission netting

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

The financial half of the ride. After #11 the platform can carry a ride all the way to `completed` and
write the **settled split** onto `rides.commission_*` — the number the driver was shown and is owed.
Nothing then moves that money. `ledger_accounts` and `ledger_entries` have existed since #6 with a
docblock that says "shape-level only — #12 owns posting logic", and they are empty. `drivers.balance_cents`
is `0` on every row. `ALLOWED_TRANSITIONS.completed` is `['settled']` and no code path takes that edge,
so `settled` is a status the machine can name and the platform can never reach.

This ticket closes it:

- **A `PaymentsProvider` seam** in `packages/shared/src/seams/` — the one seam the architecture's
  "Boundaries & contracts" bullet names that does not exist yet — plus a **Stripe test-mode**
  implementation behind it and a stub that refuses to boot in production, exactly like `SMS_PROVIDER`
  and `MAPS_PROVIDER_SOURCE`. **Cash needs no provider call at all**, which is the whole reason the
  branch lives above the seam rather than inside it.
- **One ledger, and it is the source of truth.** Every settlement writes a balanced six-entry set
  sharing one `transaction_id`: the fare the driver earned from the rider, the commission the driver
  owes the platform, and the collection — *who physically took the passenger's money*. Card and cash
  differ in exactly one pair (who collected), so a reconciliation read never has to know how the ride
  was paid, and **every party's account is a balance rather than a spend log** — which is what lets
  prepaid balance and corporate invoicing land later without a second concept.
- **Cash netting.** A cash ride leaves the driver holding the passenger's money, so the commission is
  debited from `drivers.balance_cents`, netting against the card rides that credit it. This is the
  skeleton §5.3 model ("cash rides debit driver commission owed") turned into rows.
- **Negative balance blocks new rides — with a limit that makes it survivable.**
  `candidate-filter.ts:42` already drops any driver with `balanceCents < 0` and its own comment defers
  the threshold to this ticket. Shipping it as-is would block a cash-only driver after their *first*
  ride (−€1.50). The block becomes `balanceCents < -driverDebtLimitCents`, with the limit read from
  `platform_config` (seeded €50) — config, never a constant.
- **`completed → settled`**, taken exactly once per ride, by a conditional transition that doubles as
  the settlement lock.

## User Story

As a **driver finishing a shift of mixed cash and card rides**
I want to **every fare land in one account that nets what I collected in cash against what the platform
owes me on card, with the 15% line visible on each one**
So that **I can see a single honest number instead of guessing what a foreign platform subtracted, and
I am not cut off from work the moment I take one cash job.**

## Problem Statement

1. **The platform cannot take money.** There is no payments seam, no Stripe integration, and no code
   that charges anyone anything. `PAYMENT_METHOD_TYPES` has four values and all four are decorative.
2. **The ledger is an empty promise.** Both tables exist and are documented as this ticket's; nothing
   writes to them. `drivers.balance_cents` is documented as "signed — cash-ride commission nets against
   card earnings" and has never been anything but `0`.
3. **`settled` is unreachable.** The state machine's terminal financial state has no producer, so a
   completed ride is indistinguishable from a paid one at the database level.
4. **Live bug waiting to bite (and the reason this cannot ship as a stub):** the moment cash commission
   starts debiting `balance_cents`, `candidate-filter.ts:42`'s `balanceCents < 0` blocks the driver
   from every subsequent offer. One €10 cash ride → −150 → invisible to dispatch forever. The filter's
   own comment — *"The negative-balance threshold is a product question for that ticket"* — is an
   instruction to this plan, and the architecture doc assigns "thresholds/grace" to the spec.

## Solution Statement

Two new vertical slices in `services/api`, one new seam in `@taxi/shared`, one migration, one dispatch
change.

- **`features/ledger/`** — the posting engine, and the *only* writer of `ledger_entries` /
  `ledger_accounts` / `drivers.balance_cents`-as-money. Its heart is a pure function,
  `buildSettlementEntries()`, that turns a `FareSplit` plus a payment method into a balanced entry set —
  no DI, no I/O, unit-tested directly, exactly like `candidate-filter.ts`. Everything around it is
  a repository that inserts what the function produced inside the caller's transaction.
- **`features/payments/`** — the seam wiring and the settlement orchestration.
  `POST /rides/:rideId/settle` charges (card only, **outside** the transaction, because Socket.IO is not
  the only thing that has no rollback), then in one transaction takes `completed → settled`, posts the
  ledger and applies the balance delta.
- **`RideTransitionService.transitionInTx(tx, rideId, 'completed', 'settled')` IS the idempotency lock.**
  There is no second guard, no `settled_at` column, no advisory lock. Exactly one caller wins the edge;
  everyone else gets `undefined` and an already-settled read, which is the same pattern
  `DispatchService.offerNext` uses for the cascade.
- **The Stripe idempotency key is derived from the ride** (`settle:<rideId>`), never generated per
  attempt. That single decision is what makes "charge succeeded, database rolled back" survivable: the
  retry hits the same PaymentIntent and Stripe returns it instead of creating a second one.
- **The settled split is READ, never recomputed.** #11 wrote `rides.total_cents` and the four
  `commission_*` columns at completion, from the offer card the driver actually accepted. This slice
  reassembles them into a `FareSplit` and `fareSplitSchema.parse()`s it — so the no-cent-leak refinement
  runs one more time, at the last boundary before money moves.

## Out of Scope / Non-Goals

- **No `PayoutProvider` seam and no payout execution.** The ticket names exactly one new seam file
  (`payments-provider.ts`), no acceptance criterion mentions payouts, and `ledger_entry_type` already
  carries `'payout'` for whoever builds it. Spike #5's seam requirements are honoured by *documenting*
  (in NOTES) how this entry shape accommodates both rails — an interface with zero implementations and
  zero callers would be an abstraction for single-use code that does not exist yet. Payout execution,
  pain.001 batch assembly and camt.053 reconciliation are a later ticket.
- **No rider card enrollment.** Nothing in this ticket creates a Stripe Customer or attaches a card.
  Two nullable opaque columns land on `users` (`payment_customer_ref`, `payment_instrument_ref`) and
  **#17** (rider app: payment choice) fills them. A card ride whose rider has no instrument answers a
  typed 409 `payment_instrument_missing` — honest, and exactly what an unenrolled rider deserves.
- **No `balance` (prepaid) or `corporate` settlement.** Both are `PAYMENT_METHOD_TYPES` values and both
  are post-MVP per the playbook. The ledger *shape* accommodates them (a rider account already exists as
  an owner type, top-ups are an `adjustment`); `settle` answers 409 `payment_method_unsupported`.
- **No refunds, no partial captures, no cancellation fees, no no-show charges.** All are money movements
  with no evidenced policy — `features/rides/index.ts` already records that.
- **No pre-authorization at booking**, therefore **no new `cancelled_by_system` producer.** The rides
  barrel names "#12's payment-preauth failure" as `cancelled_by_system`'s eventual caller; this ticket
  charges at settlement, not at request, so that gap stays open. Flagged in OPEN QUESTIONS.
- **No Stripe webhooks.** `STRIPE_WEBHOOK_SECRET` already sits unused in `.env.example` and stays
  unused. The charge is synchronous and confirmed in the same call; asynchronous payment methods
  (SEPA Direct Debit, Bancontact) are not enabled.
- **No settlement sweeper / retry automation.** Decided with the user 2026-08-07: the route ships, the
  automation does not, because nothing consumes it in production yet (#15 and #17 are unbuilt). See
  OPEN QUESTIONS #1 for the escalation path.
- **No driver-facing balance or statement route.** `GET /drivers/me` already returns
  `profile.balanceCents`. An earnings/statement screen and its read model are #15's.
- **No admin reconciliation UI.** `LedgerRepository.findByRide()` exists (and is what the new
  `ledger_entries_ride_idx` is for) but nothing renders it — #20's.
- **Not changing** how #11 computes or writes the settled split, `RideTransitionService`, or the
  dispatcher force-assign path (an over-limit driver **can** still be force-assigned — the override
  "deliberately is NOT filtered through the eligibility rules", S9-2).

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**: `packages/shared` (seam + 2 contract fields) · `db` (5 schema edits incl. one enum value, migration `0006`, seed) · `services/api` (`features/ledger`, `features/payments`, `features/dispatch` filter, env schema, app module, test harness)
**Dependencies**: `stripe@^22.4.0` (new, `services/api` only — the first provider SDK in the repo)

## Related Work

**Implements**: [#12](https://github.com/linardsb/taxi/issues/12) — *API: payments + ledger* · **Epic**: [#1](https://github.com/linardsb/taxi/issues/1) (`docs/epics/sakta-cab.architecture.md`)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/db-foundation-drizzle-postgis.md` — Why: created `ledger_accounts` / `ledger_entries` /
  `drivers.balance_cents` / `platform_config`, all shape-only, all explicitly deferred to this ticket.
- `.claude/plans/api-ride-lifecycle.md` — Why: wrote the settled split this slice reads, stopped the ride
  at `completed`, and left `completed → settled` documented as this ticket's in three places.
- `.claude/plans/api-dispatch-engine.md` — Why: owns `toCandidates` and `DispatchContext`, both of which
  this ticket widens for the debt limit.
- `.claude/plans/api-rides-pricing.md` — Why: `splitFare` / `fareSplitSchema` / `resolveCommissionPct`
  are its contracts; this slice consumes them and re-parses at the money boundary.
- `docs/spikes/05-payout-rails.md` — Why: gating spike #5. Its verdict (SEPA batch for the pilot,
  Connect in test mode in parallel) is what makes "Stripe test mode only" correct here and what shapes
  the ledger's payout accommodation.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet) — expected: #15 (driver earnings reads `balance_cents` + the entry stream), #17 (rider
  payment choice fills `users.payment_*_ref`), #20 (admin edits `driver_debt_limit_cents`, renders
  reconciliation), payout-execution ticket (consumes `'payout'` entries).

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**The money contracts (read first — everything else is plumbing around these):**

- `packages/shared/src/money.ts` (whole file, 42 lines) — Why: `centsSchema` / `nonNegativeCentsSchema` /
  `commissionCentsFor`. Every new money field reuses these; never re-type `z.number().int()`.
- `packages/shared/src/commission.ts` (lines 43–91) — Why: `fareSplitSchema`'s `.refine()` IS the
  no-cent-leak invariant and `splitFare` derives the net by subtraction. This slice **parses** a split
  reassembled from `rides` columns through that same schema.
- `packages/shared/src/ride-state-machine.ts` (lines 79–86, 118–128) — Why: `completed: ['settled']`,
  `settled: []`. `isPaymentMethodLocked` already covers `settled`.

**What #11 left for this ticket:**

- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` (lines 117–181, `complete()`) —
  Why: the exact shape to mirror — pre-transaction validation, `db.transaction`, post-commit
  `emitStatus` + structured log. `settle()` is its sibling.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts` (lines 76–95,
  `writeSettledSplit`) — Why: the four columns this slice reads back.
- `services/api/src/features/rides/index.ts` (whole file) — Why: the barrel's KNOWN GAPS docblock names
  `completed → settled` as this ticket's, and **exports `RideTransitionService` + `RidesRepository`**,
  which is what lets `PaymentsModule` import `RidesModule` with no cycle. Update the docblock at the end.
- `services/api/src/features/rides/ride-transition.service.ts` — Why: `transitionInTx` (composable, no
  emit) vs `emitStatus` (post-commit). **No socket emit inside a transaction** — a hard api rule.
- `services/api/src/features/rides/rides.module.ts` — Why: shows why `DispatchModule` must not be
  imported by rides, and which providers are exported.

**The ledger tables and their neighbours:**

- `db/src/schema/ledger.ts` (whole file, 59 lines) — Why: `ledger_accounts_owner_uix` is
  `NULLS NOT DISTINCT` so the platform account (`owner_id NULL`) dedupes; `amount_cents` is signed
  because "netting is the point". Two indexes exist; the third (`ride_id`) is this ticket's.
- `db/src/schema/enums.ts` (lines 47–59) — Why: `ledgerOwnerTypeEnum` / `ledgerEntryTypeEnum` are
  **db-local by design** (no `@taxi/shared` counterpart). Derive the TS union from
  `ledgerEntryTypeEnum.enumValues`, never hand-write it. **This ticket adds `card_settlement`** — the
  sibling of `cash_settlement`; see the task and "Why the rider nets to zero" in NOTES.
- `db/src/schema/drivers.ts` (lines 24–27) — Why: `balance_cents` signed, `commission_pct_override`.
- `db/src/schema/rides.ts` (lines 46–55) — Why: `payment_method` (operative) + the four settled columns.
- `db/src/schema/users.ts` (whole file, 15 lines) — Why: **no payment columns exist**. This is the gap
  the two new opaque refs fill.
- `db/src/schema/platform-config.ts` (lines 21–26) — Why: `commission_pct` has **no column default** on
  purpose. `driver_debt_limit_cents` gets the same treatment.
- `db/src/seed/riga.ts` (lines 160–168) — Why: the `onConflictDoUpdate` block where `commissionPct: 15`
  lives. `driverDebtLimitCents: 5000` goes beside it.

**The seam patterns to copy (this is the single most load-bearing group):**

- `packages/shared/src/seams/sms-provider.ts` (whole file, 8 lines) — Why: seams are plain TS interfaces
  with a docblock naming the decision date. No zod, no SDK types.
- `services/api/src/features/auth/auth.module.ts` (lines 12–27, `smsProviderFactory`) — Why: **the exact
  production-refusal pattern.** Copy the shape and the tone of the error message.
- `services/api/src/features/geo/geo.module.ts` (whole file) — Why: two-token wiring
  (`MAPS_PROVIDER_SOURCE` + `MAPS_PROVIDER`) and why the source token is exported for the harness.
- `services/api/src/features/geo/maps.tokens.ts` — Why: token-file convention and its docblock density.
- `services/api/src/features/geo/caching-maps.provider.spec.ts` — Why: how a provider is unit-tested
  against an injected fake instead of a network.
- `services/api/src/common/config/env.schema.ts` (whole file) — Why: where `STRIPE_SECRET_KEY` goes, the
  `superRefine` production block, and `loadEnv`'s parse-once cache.

**Dispatch (the debt-limit change):**

- `services/api/src/features/dispatch/strategies/candidate-filter.ts` (lines 38–42) — Why: **the line
  this ticket exists to correct**, comment and all.
- `packages/shared/src/seams/dispatch-strategy.ts` (lines 14–17, `DispatchContext`) — Why: the channel
  the limit travels on.
- `services/api/src/features/dispatch/dispatch.service.ts` (lines 100–107 and ~313–340) — Why: **both**
  `findCandidates` call sites already have `config` in hand.
- `services/api/src/features/dispatch/strategies/auto-match.strategy.ts` (lines 26–41) — Why: its
  docblock currently says "Takes no `DispatchContext`" and stops being true.
- `services/api/src/features/dispatch/strategies/geozone-queue.strategy.ts` (lines 33–43) — Why: second
  `toCandidates` caller.

**Test scaffolding:**

- `services/api/test/harness.ts` (lines 259–330, `createTestApp` + the self-check) — Why: where
  `PAYMENTS_PROVIDER` gets overridden and the `TestApp` type widened. **Read the self-check comment** —
  it is the reason the fake must be asserted identical after `app.get()`.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.integration.spec.ts` (lines 1–90, and the
  accept/complete flow further down) — Why: the phone-prefix rule (`+371260` is taken — this file needs
  its own range), ride cleanup in `afterEach`, and how a ride is driven to `completed`.
- `services/api/src/features/dispatch/strategies/candidate-filter.spec.ts` — Why: the pure-function
  table-test style to extend.
- `db/tests/schema-constraints.test.ts` + `db/tests/helpers.ts` — Why: vitest, not jest; how a
  constraint test opens a connection.
- `packages/shared/tests/platform-config.test.ts` — Why: extend for the new config field.

### New Files to Create

**`packages/shared`**

- `packages/shared/src/seams/payments-provider.ts` — the `PaymentsProvider` seam, its request/result
  types and the two failure reasons.

**`services/api/src/features/ledger/`** (new slice)

- `settlement-entries.ts` — pure `buildSettlementEntries()`; the balanced entry sets for cash and card.
- `settlement-entries.spec.ts` — unit tests for both sets, the sum-to-zero invariant, 0% commission.
- `ledger.repository.ts` — account get-or-create, entry insert, balance delta, `findByRide` read.
- `ledger.service.ts` — `postRideSettlement(tx, input)`; composes the pure builder with the repository.
- `ledger.service.spec.ts` — service-level unit tests against a fake repository.
- `ledger.module.ts`
- `index.ts` — the slice's public API (`LedgerModule`, `LedgerService`, its input type).

**`services/api/src/features/payments/`** (new slice)

- `payments.tokens.ts` — `PAYMENTS_PROVIDER`, `STRIPE_CLIENT`.
- `stub-payments.provider.ts` — dev/test provider; the factory refuses production.
- `stripe-payments.provider.ts` — the Stripe test-mode implementation (the **only** file in the repo
  that imports `stripe`).
- `stripe-payments.provider.spec.ts` — unit tests against an injected fake Stripe client.
- `settlement.repository.ts` — the one read `settle` needs, plus the `payment_provider_ref` write.
- `settlement.service.ts` — the orchestration.
- `settlement.service.spec.ts` — unit tests: cash, card, decline, provider error, already-settled,
  lost race, unsupported method, missing instrument.
- `settlement.controller.ts` — `POST /rides/:rideId/settle`.
- `payments.module.ts`
- `payments.integration.spec.ts` — the three acceptance criteria end to end against the real database.
- `index.ts` — the slice's public API.

**`db`**

- `db/migrations/0006_<drizzle-generated-name>.sql` — generated, then hand-edited for the NOT NULL
  backfill (see the task). Carries the `card_settlement` enum value, the deferred `ledger_entries`
  ride index, three nullable `text` columns and `platform_config.driver_debt_limit_cents`.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Stripe — Save a card and charge it later](https://docs.stripe.com/payments/save-and-reuse#charge-saved-payment-method)
  - Specific section: *Charge the saved payment method later*
  - Why: the canonical off-session shape this slice uses — `paymentIntents.create({ amount, currency,
    customer, payment_method, off_session: true, confirm: true })`. Note that `payment_method` is passed
    **explicitly**; relying on a customer default is not the documented path, which is why the seam
    carries two opaque refs.
- [Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
  - Specific section: how keys are scoped and how long they are retained (24h)
  - Why: the whole retry-safety story. Keys are passed as the **second argument** to `create()`
    (`{ idempotencyKey }`), not in the params object.
- [Stripe — Error handling](https://docs.stripe.com/error-handling#error-types)
  - Specific section: error types (`StripeCardError` vs the rest)
  - Why: classifies `declined` (do not retry) against `provider_error` (retry is safe).
- [Stripe — Declined payments / decline codes](https://docs.stripe.com/declines/card)
  - Why: an off-session confirm surfaces a hard decline as a thrown `StripeCardError`, not a returned
    intent with a failed status. Both paths must be handled.
- [Stripe — Testing Connect / test mode](https://docs.stripe.com/connect/testing)
  - Why: the spike's basis for "the entire loop is buildable and integration-testable pre-SIA".
- [Stripe Node SDK — TypeScript](https://github.com/stripe/stripe-node#usage-with-typescript)
  - Why: `new Stripe(key)` and the `Stripe.PaymentIntent` types; the SDK is typed and needs no
    `@types/stripe`.
- [Drizzle — `onConflictDoNothing` / upsert](https://orm.drizzle.team/docs/insert#on-conflict-do-nothing)
  - Why: the ledger-account get-or-create.
- [Drizzle — raw SQL in `set()`](https://orm.drizzle.team/docs/sql)
  - Why: `balance_cents = balance_cents + delta` must be a `sql` fragment, not a read-modify-write.
- [PostgreSQL — `ALTER TABLE ... ADD COLUMN`](https://www.postgresql.org/docs/current/sql-altertable.html)
  - Specific section: adding a `NOT NULL` column to a populated table
  - Why: the `driver_debt_limit_cents` backfill-then-`DROP DEFAULT` dance.

**In-repo, mandatory:**

- `.claude/references/ride-state-machine.md` — line 16 defines what `settled` means and says it is not
  implemented. **This ticket makes that line stale; update it.**
- `.claude/references/logging-standard.md` — `payment` is already a domain and
  `payment.ledger.settlement_written` is already the standard's own example event name. Use it.
- `.claude/references/conventions.md` — commit/PR shape (`Closes #12`).
- `services/api/CLAUDE.md` — the slice list already names `payments` and `ledger`; the "ride ends at
  `completed`" bullet becomes stale.
- `docs/spikes/05-payout-rails.md` — §"What it means for #12 (seam design)".

### Patterns to Follow

**Seam interface (from `seams/sms-provider.ts`)** — plain interface, docblock names the decision:

```ts
/**
 * Seam over Twilio (decided 2026-07-06) so a cheaper Latvian gateway can
 * replace it post-pilot without touching auth code.
 */
export interface SmsProvider {
  sendOtp(phoneE164: string, code: string): Promise<void>;
}
```

**Production-refusing factory (from `auth.module.ts:12-27`)** — copy the structure *and* the message tone:

```ts
export function smsProviderFactory(env: Env): SmsProvider {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'No production SmsProvider is bound: StubSmsProvider delivers nothing and logs OTP codes in full. Bind the real provider (#13) before running with NODE_ENV=production.',
    );
  }
  return new StubSmsProvider();
}
```

**Transaction + post-commit split (from `ride-lifecycle.service.ts:150-176`)** — validate before,
transact, emit and log after:

```ts
const moved = await this.db.transaction(async (tx) => {
  const moved = await this.transitions.transitionInTx(tx, rideId, from, to);
  if (!moved) { /* … */ }
  await this.lifecycle.writeSettledSplit(tx, rideId, split);
  return moved;
});

// ── committed ──
this.transitions.emitStatus(moved, from);
this.logger.log({ event: 'ride.lifecycle.settlement_written', /* … */ at: new Date().toISOString() });
```

**Lost-race handling that is not an error (from `dispatch.service.ts`)** — `undefined` out of the
transaction callback, checked by the caller:

```ts
const transitioned = await this.db.transaction(async (tx) => {
  const moved = await this.transitions.transitionInTx(tx, ride.id, from, to);
  if (!moved) return undefined; // someone else moved this ride
  /* … */
});
```

**Pure, DI-free domain function (from `candidate-filter.ts`)** — the shape `buildSettlementEntries` takes:

```ts
/**
 * A pure function — no DI, no I/O — so it unit-tests directly and neither
 * strategy can drift from the other on who is eligible.
 */
export function toCandidates(nearby, attrs, request): DriverCandidate[] { /* … */ }
```

**Structured logging** — `domain.component.action_state`, always `at`, never PII:

```ts
this.logger.log({
  event: 'payment.ledger.settlement_written',
  rideId, driverId, riderId,
  paymentMethod, totalCents, commissionCents, driverNetCents,
  balanceDeltaCents, transactionId,
  at: new Date().toISOString(),
});
```

**Naming conventions**: files `kebab-case.ts`, sub-slice folders lowercase; classes `PascalCase`;
DI tokens `SCREAMING_SNAKE` string constants in a `*.tokens.ts`; money fields always `*Cents`;
zod schemas `<thing>Schema` with `export type Thing = z.infer<typeof thingSchema>`.

**Error handling**: typed Nest exceptions with **snake_case string codes** as the message
(`throw new ConflictException('payment_method_locked')`), because every surface switches on the code.
A programming-error/data-bug uses a plain `Error` whose message names the violated invariant in a full
sentence — see `ride-lifecycle.service.ts:140-148` for the register.

---

## IMPLEMENTATION PLAN

### Phase 1: Contracts (`@taxi/shared`)

Everything downstream imports these; `db` mirrors the config schema and `services/api` consumes both.

**Tasks:**

- Add the `PaymentsProvider` seam and export it from the barrel.
- Add `driverDebtLimitCents` to `platformConfigSchema`.
- Add `driverDebtLimitCents` to `DispatchContext`.
- Extend the shared tests.

### Phase 2: Persistence (`db`)

**Depends on:** Phase 1 (the `platform_config` column mirrors the zod schema).

**Tasks:**

- Four schema edits: the deferred `ledger_entries` ride index, `platform_config.driver_debt_limit_cents`,
  two opaque payment refs on `users`, `rides.payment_provider_ref`.
- Generate migration `0006`, hand-edit the NOT NULL backfill.
- Seed the debt limit.
- Extend the constraint tests.

### Phase 3: Absorb the contract change (dispatch debt limit + config fixtures)

**Depends on:** Phase 1 + Phase 2 (`DispatchContext` field and the seeded config row).
**Independent of:** Phases 4–5 — nothing here imports payments or ledger.

Deliberately **before** the new slices, not after. Phase 1 made `DispatchContext.driverDebtLimitCents`
and `platformConfigSchema.driverDebtLimitCents` **required**, so the repo does not typecheck until this
phase lands. Doing it here keeps the tree green from here on; deferring it would leave a dozen tasks
running against a red typecheck, which is exactly the condition under which someone "fixes" the break by
making the field optional — the silent drift the required field exists to prevent.

**Tasks:**

- Widen `toCandidates`, both strategies and both `DispatchService` call sites.
- Sweep every `PlatformConfig` / `DispatchContext` literal in the repo.
- Update the specs and the now-false comments.

### Phase 4: The ledger slice

**Depends on:** Phase 2 (needs the schema, the enum value and the index).

**Tasks:**

- The pure entry builder and its tests.
- Repository: account get-or-create, entry insert, balance delta, ride read.
- Service + module + barrel.

### Phase 5: The payments slice

**Depends on:** Phase 4 (`LedgerService` is injected) and Phase 1 (the seam).

**Tasks:**

- Tokens, stub provider, Stripe provider, env plumbing.
- Settlement repository, service, controller, module.
- App-module wiring and the harness override.

### Phase 6: Integration, docs, gate

**Depends on:** all of the above.

**Tasks:**

- The three-acceptance-criteria integration spec.
- Update the three places that document `completed → settled` as unimplemented.
- Run the full CI-parity gate.

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

### CREATE `packages/shared/src/seams/payments-provider.ts`

- **IMPLEMENT**: The charge seam. Four exports:
  - `PAYMENT_FAILURE_REASONS = ['declined', 'provider_error'] as const` + its `PaymentFailureReason`
    type. **Exactly two values**, and the docblock must say why: `declined` is the rider's instrument
    saying no (a retry re-declines and costs a second Stripe call), `provider_error` is everything
    transient (a retry is safe *because* the idempotency key is derived from the ride).
  - `interface PaymentChargeRequest { idempotencyKey: string; amountCents: number; currency: 'EUR';
    customerRef: string; instrumentRef: string; rideId: string }`.
  - `type PaymentChargeResult = { ok: true; providerRef: string } | { ok: false; reason:
    PaymentFailureReason; providerRef: string | null; message: string }`.
  - `interface PaymentsProvider { charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> }`.
- **PATTERN**: `packages/shared/src/seams/sms-provider.ts` — a docblock naming the decision and its date,
  then the interface. `packages/shared/src/seams/dispatch-strategy.ts` for a seam that also exports its
  parameter/result types.
- **IMPORTS**: none. `@taxi/shared` imports nothing from the workspace, and a seam file imports no SDK.
  Do **not** import `Stripe` types here.
- **GOTCHA**:
  - `customerRef` and `instrumentRef` are **provider-opaque strings**, deliberately not named
    `stripeCustomerId`. Spike #5 requires the seam to abstract over destinations it has not met yet.
  - A **result union, not a thrown error**, on purpose: a declined card is an expected outcome of a
    correct call, and control flow through exceptions would make the settle service catch-and-classify
    Stripe internals it must not know about. Provider *bugs* (a malformed request) still throw.
  - `currency: 'EUR'` is a literal type, not `string`. All money is EUR (root CLAUDE.md); the field
    exists so a money-moving call site can never be read as currency-agnostic.
  - Document `idempotencyKey` as **derived from the ride, never per-attempt** right in the interface —
    that is where an implementer will look.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #4 (seam exists in `packages/shared/src/seams/`), AC #3 (typed failure)

### UPDATE `packages/shared/src/index.ts`

- **IMPLEMENT**: `export * from './seams/payments-provider';` appended to the seams block (after
  `sms-provider`).
- **PATTERN**: the existing four seam exports, lines 17–20.
- **GOTCHA**: order in this file is deliberate (primitives → schemas → theme → seams). Do not resort it.
- **VALIDATE**: `pnpm --filter @taxi/shared build && pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #4

### UPDATE `packages/shared/src/schemas/platform-config.ts`

- **IMPLEMENT**: Add to `platformConfigSchema`, after `weeklyGuaranteeCents`:

  ```ts
  /**
   * How much commission a driver may owe before dispatch stops offering them
   * rides. A POSITIVE magnitude of allowed debt: a driver is blocked when
   * `balanceCents < -driverDebtLimitCents`.
   *
   * Load-bearing, not a nicety. Cash rides debit commission (skeleton §5.3),
   * so at zero grace one €10 cash ride (−150) makes a driver invisible to
   * dispatch until they settle. Pilot value 5000 (€50 ≈ 33 cash rides at a €10
   * fare) — seeded in #6's seed, edited by #20, never a literal.
   *
   * No zod default, for `commissionPct`'s reason: every caller must read a
   * real row.
   */
  driverDebtLimitCents: nonNegativeCentsSchema,
  ```

- **PATTERN**: `commissionPct` directly above — the "CONFIG, NOT CONSTANT: deliberately has no zod
  default" comment is the model.
- **IMPORTS**: `nonNegativeCentsSchema` is already imported on line 3.
- **GOTCHA**: **No `.default()`.** A default here would let a caller settle for an invented limit, which
  is exactly the failure `commissionPct` documents. Every existing constructor of a `PlatformConfig`
  object in tests will now fail to typecheck until it supplies the field — that is the point; fix them.
- **VALIDATE**: `pnpm --filter @taxi/shared test -- platform-config`
- **SATISFIES**: AC #2

### UPDATE `packages/shared/src/seams/dispatch-strategy.ts`

- **IMPLEMENT**: Add to `DispatchContext`:

  ```ts
  /**
   * `platform_config.driver_debt_limit_cents`, carried to the eligibility
   * filter. On the context rather than read inside a strategy because
   * `DispatchService` already resolves the config row per tick and neither
   * strategy may grow its own config read (#12).
   */
  driverDebtLimitCents: number;
  ```

- **PATTERN**: the two existing fields, lines 15–16.
- **GOTCHA**: this is a **breaking contract change** — every `findCandidates` call site and every spec
  that builds a `DispatchContext` literal stops compiling. That is deliberate: a strategy that silently
  kept the old `< 0` rule would block cash drivers with no visible diff.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #2

### UPDATE `packages/shared/tests/platform-config.test.ts`

- **IMPLEMENT**: three cases — a valid row parses with `driverDebtLimitCents: 5000`; a **missing**
  `driverDebtLimitCents` **fails** to parse (proving no default crept in); a negative value fails.
- **PATTERN**: the existing `commissionPct` cases in the same file.
- **VALIDATE**: `pnpm --filter @taxi/shared test -- platform-config`
- **SATISFIES**: AC #2

### UPDATE `db/src/schema/enums.ts`

- **IMPLEMENT**: add `'card_settlement'` to `ledgerEntryTypeEnum`, **after** `'cash_settlement'`:

  ```ts
  /** #12 owns ledger semantics (#6 shipped the shape). `card_settlement` is
   *  `cash_settlement`'s sibling: both record WHO collected the passenger's
   *  money — the driver at the kerb, or the platform through Stripe. Without it
   *  a card ride leaves the rider's account permanently negative and the rider
   *  account stops being a balance. */
  export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', [
    'ride_fare',
    'commission',
    'cash_settlement',
    'card_settlement',
    'payout',
    'adjustment',
  ]);
  ```

  Also update the "Shape-level only; #12 owns ledger semantics" comment above the two ledger enums to
  say the semantics now exist.
- **PATTERN**: the enum block at lines 47–59. Note the file's own rule: the ledger enums are the
  db-local ones with **no `@taxi/shared` counterpart by design** — so this list is the single source of
  truth and nothing needs to change in `packages/shared`.
- **GOTCHA** — **all three of these were verified empirically on 2026-08-07**, by making exactly this
  edit, running `pnpm --filter @taxi/db generate`, and executing the result against the project's own
  `postgis/postgis:16-3.4-alpine` container. Reverted afterwards; the findings stand:
  - **drizzle-kit emits an APPEND, not a recreate.** The generated `0006_panoramic_bishop.sql` was
    exactly one line:
    ```sql
    ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'card_settlement' BEFORE 'payout';
    ```
    (Your generated filename will differ — drizzle picks a random suffix.) So the drop-and-recreate
    hazard that makes enum migrations scary **does not apply here**. You still get the belt-and-braces
    check in VALIDATE below; it should pass on the first try.
  - **It is legal inside drizzle's migration transaction.** Ran `BEGIN; ALTER TYPE … ADD VALUE …
    BEFORE 'payout'; COMMIT;` on PG 16 against a populated enum column: succeeded, landed at
    `enumsortorder` 3.5 between `cash_settlement` and `payout`, existing rows untouched, and the new
    value was insertable immediately after the commit. The PG rule to respect is only that the new
    value must not be **used** in the same transaction — `0006` adds it and nothing else, so it is fine.
    **Do not write a row using `card_settlement` in this migration.**
  - **Position `card_settlement` after `cash_settlement` in the TS array**, which is what produces the
    `BEFORE 'payout'` form above. Appending at the end would work too; grouping the two collection types
    is the readable choice and costs nothing.
  - `LedgerEntryType` in the ledger slice derives from `enumValues`, so it picks this up with no edit.
- **VALIDATE**: `pnpm --filter @taxi/db typecheck`
- **SATISFIES**: AC #1

### UPDATE `db/src/schema/ledger.ts`

- **IMPLEMENT**: Add the third index to `ledgerEntries`:
  `index('ledger_entries_ride_idx').on(t.rideId),`
- **PATTERN**: the two indexes beside it, lines 56–57.
- **GOTCHA**: This is the **explicitly deferred finding from PR #32**, and the only comment on issue #12:
  reconciliation reads ("all entries for ride X") seq-scan without it. `LedgerRepository.findByRide()`
  in Phase 4 is the read path that makes it earn its keep — do not add the index without adding that
  method, and do not add the method without the index.
- **VALIDATE**: `pnpm --filter @taxi/db typecheck`
- **SATISFIES**: AC #1 (reconciliation read), issue #12 comment

### UPDATE `db/src/schema/platform-config.ts`

- **IMPLEMENT**: `driverDebtLimitCents: integer('driver_debt_limit_cents').notNull(),` after
  `weeklyGuaranteeCents`, with a docblock pointing at `platformConfigSchema` for the reasoning and
  repeating **"no column default — the SEED supplies 5000"**.
- **PATTERN**: `commissionPct` lines 21–26 — same no-default reasoning, same comment placement.
- **GOTCHA**: `notNull()` **without** `.default()` on a table that already has a seeded row is exactly
  what forces the hand-edited migration in the next task. Do not take the easy `.default(5000)` — it
  recreates the constant the architecture forbids and would silently supply a limit to any future city
  row nobody configured.
- **VALIDATE**: `pnpm --filter @taxi/db typecheck`
- **SATISFIES**: AC #2

### UPDATE `db/src/schema/users.ts`

- **IMPLEMENT**: two nullable opaque columns:

  ```ts
  /**
   * Provider-opaque customer handle (Stripe Customer id in test mode) and the
   * instrument to charge off-session. Both NULL until #17's rider app enrolls
   * a card; a card ride settled for a rider with either missing answers 409
   * `payment_instrument_missing` rather than inventing a charge (#12).
   *
   * Deliberately untyped and unvalidated here: the payments seam abstracts over
   * providers whose handles look nothing like Stripe's.
   */
  paymentCustomerRef: text('payment_customer_ref'),
  paymentInstrumentRef: text('payment_instrument_ref'),
  ```

- **PATTERN**: `email: text('email')` on line 8 — nullable, no ceremony.
- **GOTCHA**: These belong on `users`, not on a `rider_payment_methods` table. One saved instrument per
  rider is the MVP shape; a table with `is_default`, brand and last4 is #17's problem when it has a UI
  to justify the columns. **Do not** add them to `userSchema` in `@taxi/shared` — no surface reads them,
  and putting a provider handle on the wire user object is how a customer id ends up in a log.
- **VALIDATE**: `pnpm --filter @taxi/db typecheck`
- **SATISFIES**: AC #1

### UPDATE `db/src/schema/rides.ts`

- **IMPLEMENT**: `paymentProviderRef: text('payment_provider_ref'),` after `driverNetCents`, docblocked
  as "the charge that settled this ride (Stripe PaymentIntent id in test mode) — NULL for cash and for
  anything unsettled. The reconciliation handle: spike #5 requires every money movement to carry a
  platform-visible provider reference."
- **PATTERN**: the `commission_*` block above it — settled-money columns, null until settlement.
- **IMPORTS**: add `text` to the existing `drizzle-orm/pg-core` import list.
- **GOTCHA**: One column, not a `ride_payments` table. A ride has at most one charge in this ticket (no
  refunds, no partial captures, no retries that produce a *second* intent — the idempotency key
  guarantees that). Add the table when a second row per ride becomes possible.
- **VALIDATE**: `pnpm --filter @taxi/db typecheck`
- **SATISFIES**: AC #1, AC #3

### CREATE `db/migrations/0006_<generated>.sql` — via `drizzle-kit generate`, then hand-edit

- **IMPLEMENT**:
  1. Run `pnpm --filter @taxi/db generate`. It will produce `0006_*.sql` containing
     `ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'card_settlement' …`, the ride index, the three
     nullable `text` columns, and an `ALTER TABLE "platform_config" ADD COLUMN
     "driver_debt_limit_cents" integer NOT NULL;`.
  2. **Hand-edit that one statement** into the populated-table dance:

     ```sql
     ALTER TABLE "platform_config" ADD COLUMN "driver_debt_limit_cents" integer NOT NULL DEFAULT 5000;
     --> statement-breakpoint
     -- Config, not constant: the default exists only to backfill the seeded Rīga
     -- row. Dropped immediately so no future city row gets a limit nobody set.
     ALTER TABLE "platform_config" ALTER COLUMN "driver_debt_limit_cents" DROP DEFAULT;
     ```
  3. Leave `migrations/meta/` exactly as drizzle-kit wrote it.
- **PATTERN**: `db/migrations/0003_updated_at_trigger.sql` and `0004_vehicle_plate_unique.sql` are both
  hand-authored — hand-editing generated SQL is established practice here.
- **GOTCHA**:
  - Drizzle-kit may **prompt interactively** when it cannot prove a NOT NULL add is safe. If it does,
    accept the column-add; you are rewriting the statement anyway.
  - `--> statement-breakpoint` is drizzle's separator and is **required** between statements or the
    migrator sends both in one batch.
  - Do **not** hand-edit `meta/_journal.json` or the snapshot; regenerate instead if you get it wrong.
  - The `0006` prefix is drizzle's; take whatever suffix it generates.
- **VALIDATE**:
  ```bash
  # Belt-and-braces: confirm the enum line is the APPEND that the probe produced.
  # It should be — this exact edit was generated and run on 2026-08-07 — but a
  # DROP TYPE / CREATE TYPE would fail MID-migration, after the other statements
  # have already applied, so it is worth five seconds.
  grep -n "ledger_entry_type" db/migrations/0006_*.sql
  #   want: ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'card_settlement' BEFORE 'payout';
  #   NOT:  DROP TYPE … / CREATE TYPE …   ← stop, fix the schema edit, regenerate

  docker compose up -d --wait
  pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db seed
  ```
  then re-run both to prove re-runnability from an already-migrated database.
- **SATISFIES**: AC #1, AC #2

### UPDATE `db/src/seed/riga.ts`

- **IMPLEMENT**: extend the `platformConfig` upsert (lines 162–168) to supply and re-assert
  `driverDebtLimitCents: 5000`, in **both** `.values()` and the `onConflictDoUpdate` `set`. Extend the
  existing comment: "commissionPct 15 and the €50 debt limit live HERE, not as column defaults".
- **PATTERN**: the `commissionPct: 15` handling in the same statement — value **and** conflict-set, so a
  re-seed corrects a hand-edited row.
- **GOTCHA**: 5000 is **€50, in cents**. Rationale for the review trail: at 15% that is ~€333 of cash
  fares (~33 rides at a €10 fare) before a driver is blocked — comfortably more than a day, less than an
  unbounded credit line, and re-openable in #20 without a deploy. Chosen with the user, 2026-08-07.
- **VALIDATE**: `pnpm --filter @taxi/db seed && pnpm --filter @taxi/db test`
- **SATISFIES**: AC #2

### UPDATE `db/tests/schema-constraints.test.ts`

- **IMPLEMENT**: three cases —
  1. `platform_config` rejects an INSERT with no `driver_debt_limit_cents` (NOT NULL, no default);
  2. `ledger_entries.amount_cents` rejects a non-integer (money is integer cents) — extend the existing
     money-column case set if one already covers it, otherwise add;
  3. `ledger_accounts_owner_uix` rejects a second `('platform', NULL)` row — proving `nullsNotDistinct`
     actually holds, because the whole get-or-create in Phase 4 rests on it.
- **PATTERN**: the existing constraint cases in this file; `db/tests/helpers.ts` for connection setup.
- **GOTCHA**: vitest, not jest. `pnpm --filter @taxi/db test`. The db test suite needs docker postgres up.
- **VALIDATE**: `pnpm --filter @taxi/db test`
- **SATISFIES**: AC #1, AC #2

### UPDATE `services/api/src/features/dispatch/strategies/candidate-filter.ts`

- **IMPLEMENT**: add a fourth parameter `driverDebtLimitCents: number` and replace lines 38–42 with:

  ```ts
  // A driver carries commission owed between settlements — every cash ride
  // debits it (#12, skeleton §5.3) — so the block is the LIMIT, not zero.
  // Blocking at the first cent of debt would strand a cash-only driver after
  // one €10 ride (−150). The limit is `platform_config.driver_debt_limit_cents`
  // (€50 for the pilot), carried on the DispatchContext; never a literal.
  if (a.balanceCents < -driverDebtLimitCents) continue;
  ```

- **PATTERN**: the existing filter lines, each with a comment explaining the sharp edge.
- **GOTCHA**:
  - **Delete the stale comment** ("`>= 0` rather than `> 0`: until #12's ledger exists…"). It is the
    instruction this task carries out and becomes a lie the moment the ledger posts.
  - `driverDebtLimitCents` is a **positive magnitude**; the negation lives at the comparison. Passing a
    negative limit would invert the rule — a `nonNegativeCentsSchema` at the config boundary is what
    prevents that, which is why the shared schema uses it.
- **VALIDATE**: `pnpm --filter @taxi/api test -- candidate-filter`
- **SATISFIES**: AC #2

### UPDATE both dispatch strategies

- **IMPLEMENT**:
  - `auto-match.strategy.ts`: `findCandidates(request, ctx)` now takes and uses `ctx`; pass
    `ctx.driverDebtLimitCents` to `toCandidates`. **Rewrite the docblock** — "Takes no `DispatchContext`:
    proximity mode has no use for the zone" is no longer true; it now uses the debt limit and only
    ignores the zone.
  - `geozone-queue.strategy.ts`: pass `ctx.driverDebtLimitCents` into its `toCandidates` call (line 43).
- **VALIDATE**: `pnpm --filter @taxi/api test -- strategy`
- **SATISFIES**: AC #2

### UPDATE `services/api/src/features/dispatch/dispatch.service.ts`

- **IMPLEMENT**: add `driverDebtLimitCents: config.driverDebtLimitCents` to the `DispatchContext` literal
  at **both** `findCandidates` call sites (~line 105 and ~line 338). `config` is already in scope at both.
- **GOTCHA**: there are **two** call sites — the sweeper's `offerNext` and the second one further down.
  Miss one and the typecheck catches it, but only because `DispatchContext` gained a required field;
  that is the whole reason the field is required rather than optional.
- **VALIDATE**: `pnpm --filter @taxi/api test -- dispatch`
- **SATISFIES**: AC #2

### UPDATE the dispatch specs

- **IMPLEMENT**:
  - `candidate-filter.spec.ts`: **Expected** — a driver at `balanceCents: -4999` with a 5000 limit is a
    candidate. **Edge** — exactly `-5000` is still a candidate (the limit is inclusive: `< -limit`
    blocks). **Failure** — `-5001` is filtered out. **Edge** — with a `0` limit, `-1` is filtered
    (the old behaviour is still expressible).
  - `auto-match.strategy.spec.ts` / `geozone-queue.strategy.spec.ts` / `dispatch.service.spec.ts` /
    `dispatch.integration.spec.ts`: add `driverDebtLimitCents` to every `DispatchContext` literal the
    typecheck now rejects.
- **VALIDATE**: `pnpm --filter @taxi/api test -- dispatch && pnpm --filter @taxi/api test -- candidate-filter`
- **SATISFIES**: AC #2

### UPDATE every `PlatformConfig` fixture in the repo — the sweep

- **IMPLEMENT**: `driverDebtLimitCents` is required with no default, so every hand-built config object
  needs it. The known set (verified 2026-08-07 — re-run the greps below, they are cheap):

  | file | note |
  |---|---|
  | `packages/shared/tests/commission.test.ts` (3 sites: ~14, ~48, ~100) | typecheck catches |
  | `packages/shared/tests/driver.test.ts` (~19) | typecheck catches |
  | `packages/shared/tests/platform-config.test.ts` | the shared `base` fixture |
  | `services/api/src/features/dispatch/offer-builder.spec.ts` (~38) | typecheck catches |
  | `services/api/src/features/pricing/pricing.service.spec.ts` (~63–68) | typecheck catches |
  | **`services/api/src/features/platform-config/platform-config.service.spec.ts` (~7, the `row()` factory)** | **typecheck does NOT catch — see GOTCHA** |

  Confirm the set with:
  ```bash
  grep -rn "commissionPct:" --include="*.ts" services/api/src services/api/test packages/shared/tests
  ```
- **GOTCHA**:
  - **`platform-config.service.spec.ts` is the dangerous one.** Its `row()` factory is fed through a
    `db` fake typed `as unknown as Db`, so the object is `unknown` at the boundary and the typecheck says
    nothing. It fails at **runtime**, inside `platformConfigSchema.parse(row)`, with a zod error about a
    missing field — from a spec that has nothing to do with this ticket. Add
    `driverDebtLimitCents: 5000` to the factory and, while you are there, an assertion that the parsed
    value survives, since this spec is the only unit-level proof the repository reads the column at all.
  - `PlatformConfigRepository.forCity` uses a bare `.select()` (all columns), so **no repository change
    is needed** — the new column flows through automatically. Do not "fix" it into an explicit column
    list.
  - Ignore `commissionPct:` hits inside `FareSplit` fixtures (`rides.service.spec.ts`,
    `ride-lifecycle.service.spec.ts`) — same key name, different schema, unaffected.
- **VALIDATE**: `pnpm --filter @taxi/shared test && pnpm --filter @taxi/api test -- platform-config && pnpm --filter @taxi/api test -- pricing`
- **SATISFIES**: AC #2

### CREATE `services/api/src/features/ledger/settlement-entries.ts`

- **IMPLEMENT**: the pure entry builder — the domain core of this ticket.

  ```ts
  export type LedgerOwnerType = (typeof ledgerOwnerTypeEnum.enumValues)[number];
  export type LedgerEntryType = (typeof ledgerEntryTypeEnum.enumValues)[number];

  export interface LedgerEntryDraft {
    ownerType: LedgerOwnerType;
    /** null for the platform account. */
    ownerId: string | null;
    entryType: LedgerEntryType;
    amountCents: number;
  }

  export interface SettlementInput {
    /** Only the two methods this ticket settles. */
    paymentMethod: 'cash' | 'card';
    riderId: string;
    driverId: string;
    split: FareSplit;
  }

  export function buildSettlementEntries(input: SettlementInput): LedgerEntryDraft[];
  export function driverBalanceDelta(entries: LedgerEntryDraft[], driverId: string): number;
  ```

  **Every account balance means the same thing in every entry: what the platform owes that party**
  (negative = that party owes the platform). `drivers.balance_cents` is already documented exactly that
  way. Hold that invariant and the sets fall out of three facts:

  **1. The fare** — the driver earned it from the rider (both methods):

  | account | entryType | amountCents |
  |---|---|---|
  | rider | `ride_fare` | `-totalCents` |
  | driver | `ride_fare` | `+totalCents` |

  **2. The commission** — the driver owes it to the platform (both methods):

  | account | entryType | amountCents |
  |---|---|---|
  | driver | `commission` | `-commissionCents` |
  | platform | `commission` | `+commissionCents` |

  **3. The collection** — *who physically took the passenger's money.* This is the only pair that
  differs, and it is where card and cash actually diverge:

  | method | account | entryType | amountCents |
  |---|---|---|---|
  | cash | driver | `cash_settlement` | `-totalCents` |
  | cash | rider | `cash_settlement` | `+totalCents` |
  | card | platform | `card_settlement` | `-totalCents` |
  | card | rider | `card_settlement` | `+totalCents` |

  **Six entries either way.** Net positions of the two accounts that carry a standalone meaning:

  | | rider | driver |
  |---|---|---|
  | card | `0` | `+driverNetCents` |
  | cash | `0` | `-commissionCents` |

  **The platform account is the balancing (contra) account.** Its aggregate balance is
  `-(rider + driver)` by construction — `-(total - commission)` on card, `+commissionCents` on cash —
  and those two numbers are not on the same scale, because the balance is a negated sum of other
  people's claims, not a position anyone can reconcile against. Do not present it as one. What IS
  meaningful on the platform account is the **per-entry-type breakdown**:
  `SUM(amount_cents) WHERE account = platform AND entry_type = 'commission'` is revenue, and the same
  read over `'payout'` is money actually sent. The platform's *cash on hand* is deliberately not
  modelled at all — that lives at Stripe and at the bank, not in a claims ledger.

  Both sets **sum to zero**. Assert it in the function with a plain `Error` naming the invariant before
  returning — a builder that returns an unbalanced set has already lost the argument.
- **PATTERN**: `services/api/src/features/dispatch/strategies/candidate-filter.ts` — pure, no DI, no I/O,
  a docblock that explains *why* it is a free function.
- **IMPORTS**: `import { ledgerEntryTypeEnum, ledgerOwnerTypeEnum } from '@taxi/db';`,
  `import type { FareSplit } from '@taxi/shared';`
- **GOTCHA**:
  - **Derive the two unions from `enumValues`**, never hand-write them. `db/src/schema/enums.ts` says
    the ledger enums are db-local by design (no `@taxi/shared` twin), so drizzle's tuple is the only
    source of truth and a hand-written union would rot on the first added entry type.
  - The full `totalCents` is credited to the driver **even on a card ride**, and the commission is a
    separate negative line. Do **not** shortcut to a single `+driverNetCents` entry: the explicit
    commission line IS the S2-5 transparency wedge as a persisted record, and it is what makes a
    reconciliation read identical in shape for cash and card.
  - **The rider must net to ZERO on both methods.** The tempting four-entry card set (drop the
    `card_settlement` pair) still sums to zero and still gives the driver the right balance — and it is
    wrong, because it leaves the rider's account at `-totalCents` forever. That turns the rider account
    into a lifetime-spend log instead of a balance, and the ticket requires the ledger to
    *accommodate prepaid balance and corporate invoicing*, both of which read a rider account as a
    balance: a top-up is `rider +amount / platform -amount` (`adjustment`), a `balance`-paid ride simply
    omits the collection pair because the platform already holds the money, and a corporate ride omits
    it too and leaves the rider legitimately negative until the invoice is paid. None of that composes
    if ordinary card rides have already driven the account to −∞.
  - Follow the same logic to its conclusion: a `balance` or `corporate` ride would be entries 1+2 with
    **no** collection pair. Neither is implemented here (`settle` answers 409), but write the builder so
    adding them is a case in the collection switch and nothing else.
  - **Zero-amount entries are kept**, not filtered. `resolveCommissionPct` legitimately returns 0 (the
    evidenced S6-7 pilot), and a written `commission: 0` proves the commission was computed as zero
    rather than forgotten. Say so in the docblock.
  - `driverBalanceDelta` exists so the repository never re-derives the number from the split — it sums
    exactly the rows it is about to insert, which is what makes the
    `balance_cents == SUM(driver entries)` invariant true by construction.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #2

### CREATE `services/api/src/features/ledger/settlement-entries.spec.ts`

- **IMPLEMENT**: table-driven unit tests.
  - **Expected**: card, €10 fare at 15% → exactly 6 entries; **rider nets 0**, driver nets +850,
    platform nets −850; every `amountCents` an integer.
  - **Expected**: cash, same fare → exactly 6 entries; **rider nets 0**, driver nets −150,
    platform nets +150.
  - **Expected**: the two sets differ in **exactly one pair** — the collection — and are otherwise
    identical. Assert this structurally (filter out `*_settlement` and compare), because it is the
    property that lets a reconciliation read ignore the payment method.
  - **Edge**: 0% commission (`commissionPctOverride: 0`) → the two `commission` rows are present and zero.
  - **Edge**: an odd fare that rounds (e.g. `totalCents: 999`, 15% → 150, net 849) — sums still exact.
  - **Failure/invariant**: for both methods and a spread of fares, `sum(amountCents) === 0`
    **and the rider's rows sum to 0**.
  - **Failure/invariant**: `driverBalanceDelta` equals `split.driverNetCents` for card and
    `-split.commissionCents` for cash.
- **PATTERN**: `candidate-filter.spec.ts` — jest, arrange a plain object, assert on the returned array.
- **IMPORTS**: build the `FareSplit` fixtures with `splitFare(total, { pct, source: 'platform_base' })`
  from `@taxi/shared`, not by hand — that way the fixtures are themselves proof the split is legal.
- **VALIDATE**: `pnpm --filter @taxi/api test -- settlement-entries`
- **SATISFIES**: AC #1, AC #2

### CREATE `services/api/src/features/ledger/ledger.repository.ts`

- **IMPLEMENT**: four methods, all `tx`-first where they write.
  - `accountFor(tx: DbTx, ownerType: LedgerOwnerType, ownerId: string | null): Promise<string>` —
    get-or-create. `INSERT … ON CONFLICT DO NOTHING RETURNING id`; if no row came back, `SELECT` it
    (`ownerId === null ? isNull(ledgerAccounts.ownerId) : eq(ledgerAccounts.ownerId, ownerId)`). If the
    select also finds nothing, throw an `Error` naming `ledger_accounts_owner_uix` — that combination is
    impossible unless the unique index was dropped.
  - `insertEntries(tx, transactionId: string, rideId: string, rows: { accountId, entryType, amountCents }[])`.
  - `applyDriverBalanceDelta(tx, driverId: string, deltaCents: number): Promise<void>` —
    `set({ balanceCents: sql\`${drivers.balanceCents} + ${deltaCents}\` })`.
  - `findByRide(rideId: string)` — every entry for a ride joined to its account's owner, ordered by
    `createdAt`. The reconciliation read the new index serves.
- **PATTERN**: `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts` — `@Injectable()`,
  `@Inject(DRIZZLE) private readonly db: Db`, `tx` as the first parameter on composable writes.
- **IMPORTS**: `{ drivers, ledgerAccounts, ledgerEntries, type Db } from '@taxi/db'`,
  `{ and, eq, isNull, sql } from 'drizzle-orm'`, `{ DRIZZLE, type DbTx } from '../../common/db/db.module'`.
- **GOTCHA**:
  - **`applyDriverBalanceDelta` must be a `sql` fragment, never a read-modify-write.** Two settlements
    for one driver commit concurrently; `balance = balance + delta` is the only form where both land.
    This is the single easiest way to lose a driver's money in this ticket.
  - Use `.onConflictDoNothing()` **with no `target`**. `ledger_accounts_owner_uix` is
    `NULLS NOT DISTINCT`, and drizzle's target inference on a nulls-not-distinct index is one more thing
    to be wrong about; the table has exactly one unique constraint, so a bare conflict clause is
    unambiguous.
  - Concurrent inserts of the *same* account row block until the other transaction commits. Accepted at
    pilot scale (≤10 drivers) — say so in a comment rather than reaching for an advisory lock.
  - `sql` template values are parameterised by drizzle — do not string-concatenate `deltaCents`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #2

### CREATE `services/api/src/features/ledger/ledger.service.ts`

- **IMPLEMENT**: `LedgerService.postRideSettlement(tx: DbTx, input: SettlementInput & { rideId: string })
  : Promise<{ transactionId: string; balanceDeltaCents: number }>`:
  1. `const entries = buildSettlementEntries(input)`;
  2. `const transactionId = randomUUID()`;
  3. resolve an account id per distinct `(ownerType, ownerId)` — resolve them in a **stable order**
     (platform, rider, driver) so two concurrent settlements never take the same two row locks in
     opposite orders;
  4. `insertEntries(tx, transactionId, input.rideId, …)`;
  5. `applyDriverBalanceDelta(tx, input.driverId, driverBalanceDelta(entries, input.driverId))`;
  6. log `payment.ledger.settlement_written` — **the logging standard's own example event name** — with
     `rideId`, `driverId`, `riderId`, `paymentMethod`, `transactionId`, `totalCents`, `commissionCents`,
     `driverNetCents`, `balanceDeltaCents`, `at`.
  7. return `{ transactionId, balanceDeltaCents }`.
- **PATTERN**: `RideLifecycleService` for the `@Injectable()` + `private readonly logger = new
  Logger(LedgerService.name)` shape.
- **IMPORTS**: `randomUUID` from `node:crypto` (as `ride-lifecycle.integration.spec.ts` already does).
- **GOTCHA**:
  - **Takes `tx`, never opens its own transaction.** The ledger post must commit or roll back with the
    `completed → settled` transition; a service that opened its own would make a half-settled ride
    reachable. Mirrors `RideLifecycleRepository.writeSettledSplit`.
  - Logging *inside* the transaction callback is fine and different from emitting a socket event —
    a log line has no observer that can act on it before the commit. Keep the *socket* emit post-commit.
  - `transactionId` is random, not derived. It does not need to be idempotent: the state transition
    already guarantees this code runs at most once per ride.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #2

### CREATE `services/api/src/features/ledger/ledger.service.spec.ts`

- **IMPLEMENT**: unit tests with a fake repository (a plain object recording calls; no database).
  - **Expected**: a card settlement inserts 6 entries all sharing one `transactionId` and applies
    `+driverNetCents`.
  - **Edge**: a cash settlement inserts 6 and applies `-commissionCents`.
  - **Failure**: `accountFor` rejecting propagates — nothing is inserted, no balance delta applied
    (the caller's transaction rolls the rest back).
  - Assert accounts are resolved in the documented stable order.
- **PATTERN**: `services/api/src/features/dispatch/dispatch.service.spec.ts` for fake-collaborator style.
- **VALIDATE**: `pnpm --filter @taxi/api test -- ledger.service`
- **SATISFIES**: AC #1, AC #2

### CREATE `services/api/src/features/ledger/ledger.module.ts` and `index.ts`

- **IMPLEMENT**:
  - `ledger.module.ts`: `@Module({ providers: [LedgerService, LedgerRepository], exports:
    [LedgerService, LedgerRepository] })`. No `imports` — `DbModule` is `@Global()`.
  - `index.ts`: export `LedgerModule`, `LedgerService`, `LedgerRepository`, and the types
    `SettlementInput` / `LedgerEntryDraft`. Head it with a docblock listing this slice's KNOWN GAPS:
    no payouts, no adjustments/top-ups, no per-account statement read, no double-entry *enforcement* at
    the database level (the balance is checked by the builder and asserted in tests, not by a constraint).
- **PATTERN**: `services/api/src/features/geozones/index.ts` for a small barrel;
  `services/api/src/features/rides/index.ts` for the KNOWN GAPS docblock register.
- **GOTCHA**: `LedgerRepository` is exported because the payments integration spec and #20's future
  reconciliation read it. Nothing outside the slice may insert entries — say so in the barrel.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1

### CREATE `services/api/src/features/payments/payments.tokens.ts`

- **IMPLEMENT**:
  ```ts
  export const PAYMENTS_PROVIDER = 'PAYMENTS_PROVIDER';
  export const STRIPE_CLIENT = 'STRIPE_CLIENT';
  ```
  Docblock `PAYMENTS_PROVIDER` as the facade every consumer injects, and `STRIPE_CLIENT` as the SDK
  handle that exists as its own token **so `StripePaymentsProvider` unit-tests against a fake instead of
  the network** — the same reasoning `MAPS_PROVIDER_SOURCE` records.
- **PATTERN**: `services/api/src/features/geo/maps.tokens.ts`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #4

### CREATE `services/api/src/features/payments/stub-payments.provider.ts`

- **IMPLEMENT**: `StubPaymentsProvider implements PaymentsProvider` — returns
  `{ ok: true, providerRef: \`stub_pi_${request.idempotencyKey}\` }` and logs
  `payment.stub.charge_succeeded` with `rideId` and `amountCents`.
- **PATTERN**: `services/api/src/features/auth/sms/stub-sms.provider.ts`.
- **GOTCHA**:
  - The ref is **derived from the idempotency key**, so a stubbed retry returns the same ref — the stub
    demonstrates the property the real provider must have instead of quietly not having it.
  - The stub **always succeeds**. Do not build magic-amount failure triggers into it: the integration
    suite overrides `PAYMENTS_PROVIDER` with a controllable fake (see the harness task), which is
    clearer than a stub that behaves differently for amounts nobody documents.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #4

### CREATE `services/api/src/features/payments/stripe-payments.provider.ts`

- **IMPLEMENT**:

  ```ts
  /** The narrow slice of the SDK this provider uses — what a fake must implement. */
  export type StripeClient = Pick<Stripe, 'paymentIntents'>;

  @Injectable()
  export class StripePaymentsProvider implements PaymentsProvider {
    constructor(@Inject(STRIPE_CLIENT) private readonly stripe: StripeClient) {}

    async charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
      try {
        const intent = await this.stripe.paymentIntents.create(
          {
            amount: request.amountCents,
            currency: request.currency.toLowerCase(),   // Stripe wants 'eur'
            customer: request.customerRef,
            payment_method: request.instrumentRef,
            off_session: true,
            confirm: true,
            metadata: { rideId: request.rideId },
          },
          { idempotencyKey: request.idempotencyKey },
        );
        if (intent.status === 'succeeded') return { ok: true, providerRef: intent.id };
        return { ok: false, reason: 'declined', providerRef: intent.id,
                 message: `payment_intent_${intent.status}` };
      } catch (error) { /* classify — see below */ }
    }
  }
  ```

  Classification helper in the same file. **VERIFIED against `stripe@22.4.0`'s own source
  (`cjs/Error.js`, `cjs/Error.d.ts`), 2026-08-07** — this is not inferred from the docs:

  ```ts
  /**
   * `declined` means the RIDER'S INSTRUMENT said no. Everything else — including
   * anything we fail to recognise — is `provider_error`, which is the
   * retry-SAFE bucket. That default is deliberate and asymmetric: a transient
   * error misfiled as `declined` strands a settleable ride behind a 402 that
   * says the rider's card failed when it did not, while a decline misfiled as
   * `provider_error` costs one retry that re-declines against the SAME
   * idempotency key. One is a lie to a driver; the other is a wasted API call.
   *
   * Verified in stripe@22.4.0 `Error.js`: every subclass passes its own name as
   * `type` (`super(raw, 'StripeCardError')`), and `generateV1Error` picks
   * `StripeCardError` from **HTTP 402** — not from `rawType === 'card_error'`.
   * So `type` is the one field to switch on. `payment_intent`, `code` and
   * `decline_code` are declared optional on the `StripeError` base class.
   */
  function isCardError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { type?: unknown }).type === 'StripeCardError'
    );
  }
  ```

  On a card error: `reason: 'declined'`, `providerRef: error.payment_intent?.id ?? null`,
  `message: error.decline_code ?? error.code ?? 'card_error'`. Everything else: `reason:
  'provider_error'`, `providerRef: null`, `message: error instanceof Error ? error.message : 'unknown'`.
- **PATTERN**: `services/api/src/features/geo/caching-maps.provider.ts` — a provider class that takes its
  collaborator by constructor injection and is unit-testable without a network.
- **IMPORTS**: `import type Stripe from 'stripe';` — a **type-only** import of the SDK plus the value
  import used by the module factory. This file and `payments.module.ts` are the **only** two files in the
  repo allowed to name `stripe` (root CLAUDE.md: provider SDKs only inside the slice implementing the seam).
- **GOTCHA**:
  - The **idempotency key is the second argument**, not a params field. Getting this wrong is silent:
    every retry creates a new PaymentIntent and double-charges.
  - An off-session confirm reports a hard decline by **throwing** a `StripeCardError` (HTTP 402), not by
    returning an intent with a failed status. **Handle both.** `PaymentIntent.Status` is exactly
    `'canceled' | 'processing' | 'requires_action' | 'requires_capture' | 'requires_confirmation' |
    'requires_payment_method' | 'succeeded'` (verified, `stripe@22.4.0`) — treat anything but
    `'succeeded'` as a non-success and carry the status into `message` so the log says which one.
    `'requires_action'` in particular means SCA: the rider must be brought back on-session, which is
    #17's problem and a `declined` from here.
  - Classify on `error.type === 'StripeCardError'` rather than `instanceof Stripe.errors.StripeCardError`.
    The string check works against the injected fake, and the fake is the only way this file is tested.
  - **Do not try to distinguish more failure kinds than the two the seam has.** `stripe@22.4.0` also
    raises `StripeIdempotencyError` (same key, *different* params), `StripeRateLimitError`,
    `StripeConnectionError`, `StripeAuthenticationError` and `StripeAPIError`. All are
    `provider_error`. `StripeIdempotencyError` deserves one thing though: it can only happen if the
    amount for a ride changed between attempts, which the frozen settled split makes impossible — so if
    it ever appears it is a real bug. Log the `type` verbatim in
    `payment.stripe.charge_failed` so that shows up instead of being flattened into "provider error".
  - `currency` goes to Stripe **lowercase**.
  - `Pick<Stripe, 'paymentIntents'>` keeps the fake to one method. Do not widen it to `Stripe`.
  - Never log `customerRef` / `instrumentRef`. `providerRef` (a `pi_…` id) is fine and is the
    reconciliation handle.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #3, AC #4

### CREATE `services/api/src/features/payments/stripe-payments.provider.spec.ts`

- **IMPLEMENT**: unit tests against a hand-rolled `StripeClient` fake.
  - **Expected**: a succeeded intent → `{ ok: true, providerRef: 'pi_…' }`; assert the params —
    `amount` in cents, `currency: 'eur'`, `off_session: true`, `confirm: true`,
    `metadata.rideId` — and that the **second argument** carries `idempotencyKey`.
  - **Edge**: an intent returned with `status: 'requires_payment_method'` → `{ ok: false, reason:
    'declined' }` with the intent id preserved.
  - **Edge**: two calls with the same `PaymentChargeRequest` pass the same `idempotencyKey` — the
    retry-safety property, asserted at the boundary we control.
  - **Edge**: an intent returned with `status: 'requires_action'` → `{ ok: false, reason: 'declined' }`,
    with the status in `message` (SCA is #17's problem, not a transient fault to retry).
  - **Failure**: a thrown `{ type: 'StripeCardError', code: 'card_declined', decline_code:
    'insufficient_funds', payment_intent: { id: 'pi_…' } }` → `{ ok: false, reason: 'declined',
    providerRef: 'pi_…', message: 'insufficient_funds' }`.
  - **Failure**: a thrown `{ type: 'StripeRateLimitError' }` and a thrown
    `{ type: 'StripeIdempotencyError' }` → both `{ ok: false, reason: 'provider_error' }` with the
    `type` preserved in `message`.
  - **Failure**: a thrown generic `Error('connection reset')` → `{ ok: false, reason: 'provider_error' }`.
  - **Failure (the default-safety case)**: a thrown object with **no recognisable shape** (`{}`, a
    string, `null`) → `{ ok: false, reason: 'provider_error' }` and **never** a crash. This is the test
    that pins the asymmetric default described in the provider's docblock.
- **PATTERN**: `services/api/src/features/geo/caching-maps.provider.spec.ts`.
- **VALIDATE**: `pnpm --filter @taxi/api test -- stripe-payments`
- **SATISFIES**: AC #3, AC #4

### UPDATE `services/api/src/common/config/env.schema.ts`

- **IMPLEMENT**: add to the object, after `MAPS_ROUTE_CACHE_TTL_SECONDS`:

  ```ts
  /**
   * TEST MODE ONLY, structurally. `sk_live_…` is refused at boot: the repo rule
   * is "Stripe stays in test mode until the SIA exists", and spike #5 confirms
   * a live platform account needs a legal entity we do not have. Absent (or
   * empty, as in .env.example) binds StubPaymentsProvider instead, which
   * refuses to boot in production — same arrangement as SMS and maps.
   */
  STRIPE_SECRET_KEY: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v))
    .refine((v) => v === undefined || v.startsWith('sk_test_'), {
      message:
        'STRIPE_SECRET_KEY must be a test-mode key (sk_test_…): Stripe stays in test mode until the SIA exists.',
    }),
  ```

- **PATTERN**: the `CORS_ORIGINS` field directly below — the file already uses `.transform()` inside the
  object.
- **GOTCHA**:
  - **`.optional().transform().refine()` in that order.** The refine runs on the transformed value, so
    the empty string is already `undefined` by the time it is checked. Reordering breaks the
    `.env.example` case, which is the common one.
  - `.env.example` **already ships** `STRIPE_SECRET_KEY=` and `STRIPE_WEBHOOK_SECRET=` — no edit needed
    beyond a comment update if you want one. `STRIPE_WEBHOOK_SECRET` stays out of the schema: no webhook
    handler exists, and validating an unused secret invites someone to think one does.
  - Do **not** add the key to `SECRET_KEYS` / `PUBLISHED_SECRETS`. Those guard length and
    published-value reuse for *our* secrets; a Stripe key is refused on its prefix instead, which is a
    stronger check.
- **VALIDATE**: `pnpm --filter @taxi/api test -- env.schema`
- **SATISFIES**: AC #4

### UPDATE `services/api/src/common/config/env.schema.spec.ts`

- **IMPLEMENT**: **Expected** — a valid `sk_test_…` parses through. **Edge** — absent and empty-string
  both parse to `undefined`. **Failure** — `sk_live_…` fails with the test-mode message, in
  `development` as well as `production` (the rule is unconditional, unlike the secret-length checks).
- **PATTERN**: the existing cases in the file.
- **VALIDATE**: `pnpm --filter @taxi/api test -- env.schema`
- **SATISFIES**: AC #4

### CREATE `services/api/src/features/payments/settlement.repository.ts`

- **IMPLEMENT**:
  - `interface SettlableRide { id, orderId, status: RideStatus, riderId, driverId: string | null,
    paymentMethod: PaymentMethodType, totalCents: number | null, commissionPct: number | null,
    commissionSource: CommissionSource | null, commissionCents: number | null,
    driverNetCents: number | null, riderCustomerRef: string | null, riderInstrumentRef: string | null }`
  - `findSettlable(rideId): Promise<SettlableRide | undefined>` — one `rides` ⋈ `users` (on
    `rides.riderId`) select. Explicit column list, no `select()`.
  - `writePaymentRef(tx: DbTx, rideId: string, providerRef: string): Promise<void>`.
- **PATTERN**: `RideLifecycleRepository.findForAction` — a purpose-built narrow read with a docblock
  saying why it is not `findWithQuote` (that read reassembles a `FareQuote` and *throws*; deciding
  whether a ride can settle needs no fare lines).
- **IMPORTS**: `{ rides, users, type Db } from '@taxi/db'`, `{ eq } from 'drizzle-orm'`.
- **GOTCHA**:
  - Read `rides.paymentMethod`, **never** `ride.request.paymentMethod`. The root CLAUDE.md rule: the two
    legitimately diverge once a rider switches before acceptance, and the request snapshot is immutable
    history. This is the ticket where reading the wrong one charges the wrong way.
  - The rider's two refs come from `users`, joined here rather than fetched by a second service, because
    a settlement is one decision and wants one consistent read.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #3

### CREATE `services/api/src/features/payments/settlement.service.ts`

- **IMPLEMENT**: `SettlementService.settle(input: { rideId, actor: 'driver' | 'dispatcher' | 'admin',
  actorId }): Promise<{ ride: Ride }>`, in this exact order:

  1. `findSettlable(rideId)`; `undefined` → `NotFoundException('ride_not_found')`.
  2. **Authorize**: `actor === 'driver' && ride.driverId !== actorId` → `ForbiddenException('ride_not_yours')`.
     Dispatcher and admin bypass ownership (the same override reasoning as `RideLifecycleService.cancel`).
  3. **Already settled** → log `payment.settlement.rejected` with `cause: 'already_settled'` at `debug`
     and **return the ride, 200**. Settlement is idempotent; a retrying client must not have to
     distinguish "I settled it" from "it was settled".
  4. `status !== 'completed'` → `ConflictException('ride_not_completed')`.
  5. `driverId === null` or any of the five money columns null → plain `Error` naming the invariant
     ("a completed ride always carries a driver and the settled split #11 wrote; settling without one
     would invent a number nobody was shown").
  6. `const split = fareSplitSchema.parse({ currency: 'EUR', totalCents, commissionPct,
     commissionSource, commissionCents, driverNetCents })` — the no-cent-leak refinement, run once more
     at the last boundary before money moves.
  7. **Branch on `ride.paymentMethod`**:
     - `'balance' | 'corporate'` → `ConflictException('payment_method_unsupported')`.
     - `'cash'` → `charge = null`.
     - `'card'`:
       - `split.totalCents === 0` → no provider call (Stripe rejects zero-amount intents), `charge = null`.
       - `riderCustomerRef == null || riderInstrumentRef == null` →
         `ConflictException('payment_instrument_missing')`.
       - `await this.payments.charge({ idempotencyKey: settlementIdempotencyKey(rideId), amountCents:
         split.totalCents, currency: 'EUR', customerRef, instrumentRef, rideId })`.
       - `ok: false, reason: 'declined'` → log `payment.settlement.charge_failed`, throw
         `new HttpException('payment_declined', HttpStatus.PAYMENT_REQUIRED)` (402).
       - `ok: false, reason: 'provider_error'` → log, throw
         `new HttpException('payment_provider_error', HttpStatus.BAD_GATEWAY)` (502).
       - **The failure log MUST carry `charge.message` and `charge.providerRef` verbatim, not just
         `reason`.** The HTTP code is deliberately coarse — two values, because a client can only
         retry or not — so the log is the *only* place the difference between "the issuer declined this
         card" and "`requires_action`: the rider must re-authenticate in-app (#17)" survives. Both
         answer 402. A dispatcher on the phone to a driver needs to tell them apart, and dropping
         `message` here is what would make that impossible. Fields: `event`, `rideId`, `driverId`,
         `riderId`, `paymentMethod`, `amountCents`, `reason`, `message`, `providerRef`, `at`.
  8. **Transaction**:
     ```ts
     const result = await this.db.transaction(async (tx) => {
       const moved = await this.transitions.transitionInTx(tx, rideId, 'completed', 'settled');
       if (!moved) return undefined;               // someone else settled — see GOTCHA
       const posted = await this.ledger.postRideSettlement(tx, {
         rideId, riderId: ride.riderId, driverId, paymentMethod, split,
       });
       if (charge) await this.settlements.writePaymentRef(tx, rideId, charge.providerRef);
       return { moved, posted };
     });
     ```
  9. `result === undefined` → log `payment.settlement.rejected` with `cause: 'lost_race'`, then return
     the ride as read (idempotent success — the winner already settled it).
  10. **Post-commit**: `this.transitions.emitStatus(result.moved, 'completed')`, then log
      `payment.settlement.settled` with `rideId`, `orderId`, `driverId`, `riderId`, `actor`, `actorId`,
      `paymentMethod`, `totalCents`, `commissionCents`, `driverNetCents`,
      `balanceDeltaCents`, `transactionId`, `providerRef`, `at`.
  11. Return `{ ride: await this.rides.findWithQuote(rideId) … }` — mirror
      `RideLifecycleService.readRide()`, including its `assertRideSplitConsistent` call and its loud
      `Error` when the quote is missing.

  Also export `settlementIdempotencyKey(rideId) => \`settle:${rideId}\`` from this file (or a tiny
  `settlement.policy.ts` beside it) so the spec can assert on it by name.
- **PATTERN**: `RideLifecycleService.complete()` (`ride-lifecycle.service.ts:130-181`) — the pre-checks /
  transaction / post-commit skeleton is deliberately identical. `dispatch.service.ts` for the
  `return undefined` lost-race convention. For step 6 specifically, mirror `toRide`'s settled-split
  reassembly (`rides.repository.ts:74-104`): it builds the same `FareSplit` from the same five columns
  and is already the codebase's answer to "how do I turn these columns back into a split".
- **IMPORTS**: `{ RideTransitionService, RidesRepository } from '../rides'` (the barrel's sanctioned
  cross-slice export), `{ LedgerService } from '../ledger'`, `{ PAYMENTS_PROVIDER }` +
  `type { PaymentsProvider }`, `{ DRIZZLE } from '../../common/db/db.module'`,
  `{ fareSplitSchema } from '@taxi/shared'`.
- **GOTCHA**:
  - **The charge happens BEFORE and OUTSIDE the transaction.** A Stripe call inside a transaction holds
    a database connection across a network round trip and — worse — cannot be rolled back. This is the
    same rule as "no socket emit inside a transaction", for the same reason.
  - **A lost race is not a 409.** Because the idempotency key is derived from the ride, the loser's
    charge and the winner's charge are the *same* PaymentIntent. Answering 200 with the settled ride is
    both true and the only answer a retrying driver app can use.
  - **`transitionInTx` must be the first statement in the transaction.** `return undefined` then commits
    an empty transaction, which is the dispatch pattern; anything written before it would commit
    unpaired.
  - Do **not** call `assertTransition` here. `RideTransitionService` is the one caller; this slice adds
    no transition machinery, exactly as #11 added none.
  - `HttpException` with an explicit status for 402/502 — Nest has no `PaymentRequiredException`.
  - Never log the rider's `customerRef`/`instrumentRef`, and never a card number (we never see one).
- **VALIDATE**: `pnpm --filter @taxi/api test -- settlement.service`
- **SATISFIES**: AC #1, AC #2, AC #3

### CREATE `services/api/src/features/payments/settlement.service.spec.ts`

- **IMPLEMENT**: unit tests with fake collaborators (fake repository, fake ledger, fake transitions, a
  controllable fake `PaymentsProvider`, and a `db` whose `transaction` just invokes the callback).
  - **Expected**: a `card` ride charges once with `idempotencyKey === 'settle:<rideId>'` and
    `amountCents === totalCents`, then posts the ledger and writes the provider ref.
  - **Expected**: a `cash` ride **never calls the provider** and still posts the ledger.
  - **Edge**: an already-`settled` ride returns 200, charges nothing, posts nothing.
  - **Edge**: `transitionInTx` returning `false` (lost race) → no exception, no second charge attempt
    after the transaction, ledger not posted.
  - **Edge**: `totalCents === 0` on a card ride → no provider call, ledger still posted.
  - **Edge**: a `balance` and a `corporate` ride → 409 `payment_method_unsupported`, provider untouched.
  - **Failure**: card with `riderCustomerRef: null` → 409 `payment_instrument_missing`, provider untouched.
  - **Failure**: provider `declined` → 402, **ledger not posted**, transaction never opened.
  - **Failure**: provider `provider_error` → 502, ledger not posted.
  - **Failure**: a `completed` ride with `commissionCents: null` → plain `Error`, nothing charged.
  - **Failure**: a driver settling someone else's ride → 403; a dispatcher settling it → allowed.
- **PATTERN**: `services/api/src/features/rides/lifecycle/ride-lifecycle.service.spec.ts`.
- **GOTCHA**: assert **provider call counts**, not just outcomes. "Charged exactly once" is the property
  this ticket is really about, and a test that only checks the response body would pass while
  double-charging.
- **VALIDATE**: `pnpm --filter @taxi/api test -- settlement.service`
- **SATISFIES**: AC #1, AC #2, AC #3

### CREATE `services/api/src/features/payments/settlement.controller.ts`

- **IMPLEMENT**:
  ```ts
  @Controller('rides')
  export class SettlementController {
    @Post(':rideId/settle')
    @Roles('driver', 'dispatcher', 'admin')
    settle(@CurrentUser() user: JwtClaims,
           @Param('rideId', ParseUUIDPipe) rideId: string): Promise<{ ride: Ride }> {
      return this.settlement.settle({ rideId, actor: /* from user.role */, actorId: user.sub });
    }
  }
  ```
  Map `user.role` to the actor: `admin` acts as `dispatcher` for authorization purposes (the same
  `admin → dispatcher` collapse `RideLifecycleController.cancel` documents), and `rider` is not in the
  `@Roles` list at all — a rider does not settle their own ride.
- **PATTERN**: `services/api/src/features/rides/lifecycle/ride-lifecycle.controller.ts` — the **third**
  `@Controller('rides')` in the codebase, and its docblock already explains why per-route `@Roles` is
  right when one prefix serves several actors. Say in this file's docblock which controller owns what.
- **IMPORTS**: `{ CurrentUser, Roles } from '../auth'`.
- **GOTCHA**:
  - Identity comes from the JWT; there is no body at all on this route. `ParseUUIDPipe` rejects a
    malformed id before the service reads anything.
  - Guards are global and fail-closed — no `@Public()` here, obviously.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #2, AC #3

### CREATE `services/api/src/features/payments/payments.module.ts` and `index.ts`

- **IMPLEMENT**:
  - `paymentsProviderFactory(env: Env, stripe: StripeClient | null): PaymentsProvider` — if a
    `STRIPE_SECRET_KEY` is present, return `new StripePaymentsProvider(stripe)`; otherwise, if
    `env.NODE_ENV === 'production'`, **throw** with a message in the house register:
    > `'No production PaymentsProvider is bound: StubPaymentsProvider settles card rides without moving any money, so a ride would be marked settled and paid while the rider was never charged. Set STRIPE_SECRET_KEY (test mode until the SIA exists) before running with NODE_ENV=production.'`
    otherwise return `new StubPaymentsProvider()`.
  - `STRIPE_CLIENT` provider: `useFactory: (env) => env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null`.
  - `@Module({ imports: [RidesModule, LedgerModule], controllers: [SettlementController], providers:
    [SettlementService, SettlementRepository, STRIPE_CLIENT provider, PAYMENTS_PROVIDER provider],
    exports: [PAYMENTS_PROVIDER] })`.
  - `index.ts`: export `PaymentsModule`, `SettlementService`, `PAYMENTS_PROVIDER`, and re-export
    `paymentsProviderFactory` for its spec. Head it with the KNOWN GAPS docblock: no webhooks, no
    refunds, no preauth, no payouts, no `balance`/`corporate`, rider enrollment is #17's, retry is manual.
- **PATTERN**: `auth.module.ts`'s `smsProviderFactory` and `geo.module.ts`'s two-token wiring — read both
  before writing this.
- **GOTCHA**:
  - **`PaymentsModule` imports `RidesModule`, never the reverse.** `RidesModule` already imports
    `PricingModule`, `RealtimeModule`, `DriversModule` and must not learn about payments — that is the
    cycle. The rides barrel exports `RideTransitionService` + `RidesRepository` precisely so a consumer
    like this one can compose them.
  - `PAYMENTS_PROVIDER` is exported so the test harness can override it by token across the compiled
    graph — the same sanction `geo.module.ts` records for `MAPS_PROVIDER_SOURCE`.
  - Export a `paymentsProviderFactory` spec alongside (mirroring `geo.module.spec.ts` /
    `auth.module.spec.ts`): production + no key → throws; production + key → `StripePaymentsProvider`;
    development + no key → `StubPaymentsProvider`.
- **VALIDATE**: `pnpm --filter @taxi/api test -- payments.module`
- **SATISFIES**: AC #4

### UPDATE `services/api/package.json`

- **IMPLEMENT**: add `"stripe": "^22.4.0"` to `dependencies` (alphabetical order puts it after
  `socket.io`), then `pnpm install` from the repo root.
- **GOTCHA**: `stripe` ships its own TypeScript types — do **not** add `@types/stripe` (it is a
  deprecated stub for an ancient major). Add it to `services/api` only; `@taxi/shared` must stay
  SDK-free, and `db` has no business with it.
- **VALIDATE**: `pnpm install && pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #4

### UPDATE `services/api/src/app.module.ts`

- **IMPLEMENT**: import `LedgerModule` then `PaymentsModule`, both **after** `RidesModule` and
  `DispatchModule`, with a comment matching the existing ones: "After RidesModule: payments composes the
  rides slice's transition writer and repository."
- **PATTERN**: the `DispatchModule` comment already in the file.
- **VALIDATE**: `pnpm --filter @taxi/api test -- app.controller`
- **SATISFIES**: AC #1

### UPDATE `services/api/test/harness.ts`

- **IMPLEMENT**:
  - Add `RecordingPaymentsProvider implements PaymentsProvider`: records every `PaymentChargeRequest`,
    returns `{ ok: true, providerRef: \`pi_test_${calls.length}\` }` by default, and exposes
    `failNext(reason: PaymentFailureReason)` plus `calls: PaymentChargeRequest[]`.
  - Override `PAYMENTS_PROVIDER` in `createTestApp` and add `payments: RecordingPaymentsProvider` to the
    returned `TestApp`.
  - Extend the existing **self-check** block with the payments provider: resolve `PAYMENTS_PROVIDER` from
    the app and throw if it is not the same instance.
- **PATTERN**: `RecordingSmsProvider` in the same file, and the `DISPATCH_QUEUE_STORE` self-check at
  lines 317–327 — read its comment, it argues exactly why this assertion is not paranoia.
- **GOTCHA**: without the override the suite binds `StubPaymentsProvider`, every charge silently
  succeeds, and the decline test would pass for the wrong reason. Update the `createTestApp` docblock —
  it currently says "exactly four providers swapped".
- **VALIDATE**: `pnpm --filter @taxi/api test -- ride-lifecycle.integration`
- **SATISFIES**: AC #1, AC #3

### CREATE `services/api/src/features/payments/payments.integration.spec.ts`

- **IMPLEMENT**: the three acceptance criteria, end to end against the real database, driving a ride to
  `completed` the way `ride-lifecycle.integration.spec.ts` does.

  1. **Expected — card ride settles with correct ledger entries.** Enroll the rider by writing
     `payment_customer_ref` / `payment_instrument_ref` directly (no enrollment API exists — that is #17).
     Complete the ride, `POST /rides/:id/settle`. Assert: 200; `rides.status === 'settled'`;
     `rides.payment_provider_ref` set; **exactly 6** `ledger_entries` for the ride, sharing one
     `transaction_id`, summing to 0; **the rider's rows sum to 0**; the driver's rows sum to
     `driverNetCents`; `drivers.balance_cents` **equals** the driver's entry sum (the invariant);
     the platform's rows sum to `-(rider sum + driver sum)` (the contra property — assert it as that
     relation, **never** as a hardcoded figure) and its `commission` rows alone sum to
     `commissionCents` (revenue);
     `harness.payments.calls` has length 1 with `idempotencyKey === 'settle:<rideId>'`.
     **This read is exactly what `ledger_entries_ride_idx` serves** — go through
     `LedgerRepository.findByRide()`, not a raw query, so the index has a production caller.
  2. **Edge — cash ride nets commission, drives the balance negative, blocks the next offer.** Settle a
     cash ride: **zero** provider calls, **6** entries, rider rows still summing to 0,
     `balance_cents === -commissionCents`. Then drive
     the balance below −5000 (settle enough cash rides, or one large fare), put the driver online at a
     known point, run `DispatchSweeper.tick()` / `DispatchService` for a fresh ride and assert the
     driver receives **no** offer — and that a second driver inside the limit does. Then also assert the
     **dispatcher force-assign path still reaches the blocked driver** (S9-2: the override is not
     filtered through eligibility).
  3. **Failure — a Stripe failure leaves a consistent ledger.** Two sub-cases, both mandatory:
     - `payments.failNext('declined')` → 402 `payment_declined`; ride still `completed`; **zero**
       `ledger_entries`; `balance_cents` unchanged; `payment_provider_ref` null. Then settle again
       successfully and assert exactly one entry set — a failed attempt leaves no residue.
     - **Charge succeeded, database failed.** Force the post-charge transaction to throw (e.g. spy on
       `LedgerService.postRideSettlement` to reject once), assert the ride is still `completed` with zero
       entries, then retry: assert the provider was called **twice** with the **same**
       `idempotencyKey` — the property that makes the retry safe at Stripe — and that exactly one entry
       set now exists.
  4. **Edge — idempotent settle**: calling `POST /settle` twice on a card ride yields 200 both times,
     one charge, one entry set.
- **PATTERN**: `ride-lifecycle.integration.spec.ts` — copy its `beforeAll`/`afterEach` skeleton, the
  ride-cleanup list and the socket-client teardown order.
- **GOTCHA**:
  - **Pick a fresh phone prefix.** `+371210/220/230/240/250/260` are taken and `users.phone` is unique
    across a run that never resets the database — use `+371270` and say so in the file docblock, exactly
    as the lifecycle spec does.
  - Register every created ride and driver in the cleanup lists, or this file's `completed` rides crowd
    the sweeper's oldest-first batch and break another file's test.
  - The database is **not** reset between tests: assert on entries **filtered by this test's `rideId`**,
    never on a global count.
  - Pin pickups inside `centre` (not RIX) for the same reason the lifecycle spec does — RIX ships
    `queueModeEnabled: true` and changes the transition sequence.
- **VALIDATE**: `pnpm --filter @taxi/api test -- payments.integration`
- **SATISFIES**: AC #1, AC #2, AC #3

### UPDATE the three places that document `completed → settled` as unimplemented

- **IMPLEMENT**:
  - `.claude/references/ride-state-machine.md` line 16: rewrite to say `completed → settled` **is**
    implemented by `POST /rides/:rideId/settle` (#12), that the transition is the settlement lock, and
    that `settled` now means ledger entries exist.
  - `services/api/CLAUDE.md`: rewrite the "The ride ends at `completed` — `completed → settled` is #12's"
    bullet. Add the new invariants worth carrying forward: the ledger is the only writer of
    `balance_cents` as money; the Stripe idempotency key is derived from the ride; the charge happens
    outside the transaction; provider SDK imports stay inside `features/payments/`.
  - `services/api/src/features/rides/index.ts`: update the first KNOWN GAP (the ride now ends at
    `settled`), and the two gaps that named #12 as the fixer of `cancelled_by_system` and cancellation
    fees — **those stay open**, so restate them accurately rather than deleting them.
- **PATTERN**: these three files already carry precise, dated statements; match their register.
- **GOTCHA**: `rules-check-drift` will flag whichever of these you miss. Do all three.
- **VALIDATE**: `grep -rn "completed → settled" .claude/references services/api` returns only accurate
  statements.
- **SATISFIES**: AC #4 (documentation currency)

### RUN the CI-parity gate

- **IMPLEMENT**: from a clean tree, with docker up:
  ```bash
  docker compose up -d --wait
  pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db seed
  REDIS_TEST_URL=redis://localhost:${REDIS_PORT:-6379} pnpm turbo run typecheck lint test build --force
  ```
- **GOTCHA**: `pnpm check` is **not** the gate — it omits `build` and rides warm `dist/`. This ticket
  changes `@taxi/shared`, and `services/api` resolves it from `dist/`, so a stale build makes the api
  typecheck against the *old* `DispatchContext` and pass while CI fails. `--force` from a cleared dist is
  the parity condition. Set `REDIS_TEST_URL` or five Redis-backed suites `describe.skip` and the green is
  short.
- **VALIDATE**: the command above, exit 0.
- **SATISFIES**: AC #4

---

## TESTING STRATEGY

`services/api` runs **jest** (`pnpm --filter @taxi/api test -- <substring>`); `@taxi/shared` and `db` run
**vitest** (`pnpm --filter @taxi/shared test`, `pnpm --filter @taxi/db test`). Every slice ships
**≥1 expected + 1 edge + 1 failure** case (root CLAUDE.md).

### Unit Tests

- `settlement-entries.spec.ts` — the pure builder. The highest-value file in the ticket: it is where the
  ledger's arithmetic is actually proven, with no database and no mocks. Both entry sets, the
  sum-to-zero invariant, the 0% commission case, rounding.
- `ledger.service.spec.ts` — composition over a fake repository: entry count, shared `transaction_id`,
  balance delta, stable account-resolution order.
- `settlement.service.spec.ts` — the orchestration matrix (11 cases listed in its task). Assert
  **provider call counts**, not just responses.
- `stripe-payments.provider.spec.ts` — the SDK boundary against an injected fake: parameter shape,
  idempotency key placement, both decline paths, transient-error classification.
- `payments.module.spec.ts` — the production-refusal factory, all three branches.
- `env.schema.spec.ts` — `sk_test_` accepted, empty/absent → `undefined`, `sk_live_` refused.
- `candidate-filter.spec.ts` — the four debt-limit boundary cases.
- `platform-config.test.ts` (shared, vitest) — the new field parses, has no default, rejects negatives.

### Integration Tests

- `payments.integration.spec.ts` — the three acceptance criteria plus idempotent-settle, against the real
  Postgres, through HTTP, with `PAYMENTS_PROVIDER` overridden by the harness's recording fake.
- `db/tests/schema-constraints.test.ts` — the NOT NULL config column, integer money, and the
  `NULLS NOT DISTINCT` platform-account uniqueness the get-or-create depends on.
- Existing `dispatch.integration.spec.ts` must stay green with the widened context — treat any
  adjustment there as a signal, not a chore.

### Edge Cases

Must be covered explicitly:

- 0% commission (the evidenced S6-7 pilot) — zero-amount entries written, not skipped.
- `totalCents === 0` — no Stripe call (zero-amount intents are rejected by Stripe), ledger still posted.
- A fare whose 15% rounds (999 → 150 / 849) — the split still sums exactly.
- Settle called twice — one charge, one entry set, 200 both times.
- Two concurrent settles (simulated via `transitionInTx` returning `false`) — the loser answers 200, does
  not post, does not re-charge.
- A driver settling a ride that is not theirs — 403; a dispatcher settling it — allowed.
- A `completed` ride with a null `commission_cents` — loud `Error`, nothing charged.
- `balance` and `corporate` payment methods — 409, provider untouched.
- A card ride whose rider has no instrument — 409, provider untouched.
- Balance exactly at `-driverDebtLimitCents` — still eligible; one cent beyond — blocked.
- A blocked driver is still reachable by **dispatcher force-assign**.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
pnpm turbo run typecheck lint --filter @taxi/shared --filter @taxi/db --filter @taxi/api

# The one structurally-checkable half of AC #4: the Stripe SDK is confined to the
# slice implementing the seam (root CLAUDE.md). Must print nothing but the OK line.
grep -rn "from 'stripe'\|require('stripe')" --include="*.ts" \
  packages/*/src db/src services/api/src \
  | grep -v "services/api/src/features/payments/" \
  || echo "OK: stripe SDK confined to features/payments/"
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm --filter @taxi/api test -- settlement-entries
pnpm --filter @taxi/api test -- ledger.service
pnpm --filter @taxi/api test -- settlement.service
pnpm --filter @taxi/api test -- stripe-payments
pnpm --filter @taxi/api test -- payments.module
pnpm --filter @taxi/api test -- env.schema
pnpm --filter @taxi/api test -- candidate-filter
```

### Level 3: Integration Tests

```bash
docker compose up -d --wait
pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db seed
pnpm --filter @taxi/db test
pnpm --filter @taxi/api test -- payments.integration
pnpm --filter @taxi/api test -- dispatch
pnpm --filter @taxi/api test -- ride-lifecycle.integration
```

### Level 4: Manual Validation

```bash
# fresh database, prove the migration is re-runnable from zero
docker compose down -v && docker compose up -d --wait
pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db seed
psql "$DATABASE_URL" -c "\d platform_config" \
  -c "select driver_debt_limit_cents, commission_pct from platform_config;" \
  -c "\d ledger_entries"        # ledger_entries_ride_idx must be listed
```

Then, with `pnpm --filter @taxi/api dev` running and a ride driven to `completed` via the existing
lifecycle routes (see the phase gate in `docs/build-playbook.md`):

```bash
curl -sX POST localhost:3001/rides/$RIDE_ID/settle -H "Authorization: Bearer $DRIVER_JWT" | jq .ride.status
# → "settled"
curl -sX POST localhost:3001/rides/$RIDE_ID/settle -H "Authorization: Bearer $DRIVER_JWT" | jq .ride.status
# → "settled" again, no error, no second charge
psql "$DATABASE_URL" -c "select entry_type, amount_cents from ledger_entries where ride_id='$RIDE_ID';"
psql "$DATABASE_URL" -c "select balance_cents from drivers where user_id='$DRIVER_ID';"
```

The two reconciliation reads that must be true after ANY settlement, and the stuck-money query
(OPEN QUESTION #7) — run all three before calling the ticket done:

```bash
# 1. Every settlement transaction balances to zero. Must return NO rows, ever.
psql "$DATABASE_URL" -c "
  SELECT transaction_id, sum(amount_cents) FROM ledger_entries
  GROUP BY transaction_id HAVING sum(amount_cents) <> 0;"

# 2. Every driver's cached balance equals their ledger. Must return NO rows, ever.
psql "$DATABASE_URL" -c "
  SELECT d.user_id, d.balance_cents, coalesce(sum(e.amount_cents), 0) AS ledger
  FROM drivers d
  LEFT JOIN ledger_accounts a ON a.owner_type = 'driver' AND a.owner_id = d.user_id
  LEFT JOIN ledger_entries  e ON e.account_id = a.id
  GROUP BY d.user_id, d.balance_cents
  HAVING d.balance_cents <> coalesce(sum(e.amount_cents), 0);"

# 3. Unsettled money: rides that ended physically but never financially.
psql "$DATABASE_URL" -c "
  SELECT id, order_id, driver_id, payment_method, total_cents, updated_at
  FROM rides WHERE status = 'completed' ORDER BY updated_at;"
```

Boot refusals, both of which must fail loudly:

```bash
NODE_ENV=production STRIPE_SECRET_KEY= pnpm --filter @taxi/api start   # → no-provider-bound error
STRIPE_SECRET_KEY=sk_live_xxx pnpm --filter @taxi/api start            # → test-mode-only error
```

### Level 5: CI-parity gate (the one that decides "done")

```bash
REDIS_TEST_URL=redis://localhost:${REDIS_PORT:-6379} \
  pnpm turbo run typecheck lint test build --force
```

---

## ACCEPTANCE CRITERIA

From issue #12, plus what the codebase requires:

- [ ] **AC #1 (expected)** — a card ride settles with correct ledger entries: 6 entries, one
      `transaction_id`, summing to zero, **rider rows summing to zero**; `rides.status = 'settled'`;
      `payment_provider_ref` written; `drivers.balance_cents` credited `driverNetCents` and equal to the
      sum of that driver's entries.
- [ ] **AC #2 (edge)** — a cash ride nets commission (6 entries, driver delta `-commissionCents`), can
      drive the balance negative, and past `driver_debt_limit_cents` the driver receives no further
      offers — while dispatcher force-assign still reaches them.
- [ ] **AC #3 (failure)** — a Stripe failure leaves a consistent ledger: a decline writes nothing and
      answers 402; a post-charge database failure writes nothing, and the retry re-uses the same
      idempotency key so exactly one charge and one entry set exist.
- [ ] **AC #4** — Stripe test mode only: `sk_live_…` is refused at boot, `StubPaymentsProvider` refuses
      to boot in production, and the `stripe` SDK is imported in no file outside `features/payments/`.
- [ ] `PaymentsProvider` seam lives in `packages/shared/src/seams/payments-provider.ts` and imports
      nothing from the workspace.
- [ ] All money is integer cents EUR; no float arithmetic anywhere in the two new slices.
- [ ] **Every party's ledger account is a balance, not a spend log**: a rider's rows sum to zero after
      an ordinary ride on *both* payment methods, so prepaid balance and corporate invoicing can land
      later without backfilling history.
- [ ] `drivers.balance_cents` is written only as `balance_cents + delta` (a `sql` fragment), never
      read-modify-write, and equals the sum of that driver's ledger entries.
- [ ] Commission is never recomputed at settlement — the split is read from the columns #11 wrote and
      re-parsed through `fareSplitSchema`.
- [ ] Every ride status change goes through `RideTransitionService`; `assertTransition` gains no second
      caller.
- [ ] `driver_debt_limit_cents` is a `platform_config` row with no column default and no zod default.
- [ ] `ledger_entries_ride_idx` exists (the deferred PR #32 finding) **and** has a read path.
- [ ] Each new slice ships ≥1 expected + 1 edge + 1 failure test; files stay under ~500 lines.
- [ ] `.claude/references/ride-state-machine.md`, `services/api/CLAUDE.md` and the rides barrel no longer
      claim `completed → settled` is unimplemented.
- [ ] `pnpm turbo run typecheck lint test build --force` is green from a cleared dist, with
      `REDIS_TEST_URL` set.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works (settle twice, boot refusals, fresh-database migration)
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability
- [ ] `.env.example` comment still accurate for `STRIPE_SECRET_KEY`
- [ ] PR body links `Closes #12` per `.claude/references/conventions.md`

---

## OPEN QUESTIONS / ASSUMPTIONS

**Decided with the user, 2026-08-07 — not open:**

1. **Driver debt limit = €50** (`driver_debt_limit_cents: 5000`), as a `platform_config` knob rather than
   a constant or a hard zero.
2. **Settlement trigger = an explicit `POST /rides/:rideId/settle`**, not an auto-settle sweeper and not a
   call from inside `complete()`.

**Assumptions this plan makes:**

3. **A completed ride always carries a driver and the four settled columns.** #11 writes them in the same
   transaction as `in_progress → completed` and refuses to complete without an accepted offer split, so
   the plan treats a null as a data bug (loud `Error`), not a case to handle. If that ever stops holding,
   the fix is in #11's completion, not here.
4. **One saved instrument per rider is enough** for the pilot, so two opaque columns on `users` beat a
   `rider_payment_methods` table. If #17 needs card brand/last4 or multiple cards, it promotes them —
   the seam does not change, because it already takes opaque refs.
5. **The pilot settles in EUR only.** `currency: 'EUR'` is a literal type throughout.
6. **Cash is the dominant method at pilot open** (Phase 1 of the playbook ships cash; cards arrive with
   #17), so the debt limit — not the card credit — is what keeps drivers dispatchable early.

**Genuinely open — flag before or during execution:**

7. **Stuck money has no automatic recovery** — the largest accepted risk in this ticket. A ride that
   reaches `completed` and never gets settled sits there forever: no sweeper, no alert, no admin view.
   Accepted because no production client calls the route yet (#15 and #17 are unbuilt), so there is
   nothing to strand.

   **What this ticket does about it, concretely, at zero extra machinery:**
   - The route is **idempotent and callable by `dispatcher` and `admin`**, not only by the ride's driver
     — so a stuck ride is already recoverable by hand today, by the person on the phone with the driver.
   - Every failure path logs a distinct `payment.settlement.*` event with the `rideId`, so "why is this
     ride stuck" has an answer in the logs rather than requiring a repro.
   - **Stuck rides are queryable with one statement**, written into Level 4 of the validation commands
     so the query exists before anyone needs it at 02:00:
     ```sql
     SELECT id, order_id, driver_id, payment_method, total_cents, updated_at
     FROM rides WHERE status = 'completed' ORDER BY updated_at;   -- unsettled money
     ```

   **The escalation, in order of cost, decided rather than left open:** (a) **#15 calls `settle`
   immediately after `complete` and retries on failure** — do this, it is the real fix and costs #15
   nothing; (b) **#20 renders the query above as an "unsettled rides" list** with a retry button — do
   this, it is one screen; (c) a `SettlementSweeper` mirroring `DispatchSweeper`, which needs an attempt
   counter, backoff and a dead-letter state — **file this ticket only if stuck rides actually appear
   after (a) ships.** Recording (a) and (b) as requirements on those tickets is an action for whoever
   plans them, not a question for this one.
8. **`cancelled_by_system` still has no producer.** The rides barrel names "#12's payment-preauth failure"
   as its eventual caller, but this ticket charges at settlement rather than pre-authorizing at booking,
   so the gap survives. Whether the platform should pre-authorize a card at request time is a real
   product question (it costs a Stripe call per booking and would let the platform refuse a ride the
   rider cannot pay for) — **not decided here.**
9. **The ledger has no database-level balance constraint.** `sum(amount_cents) = 0` per `transaction_id`
   is enforced by the pure builder and asserted in tests, not by Postgres. A deferred constraint trigger
   would make it structural; it would also fire on every insert. Deferred — revisit if a second writer
   of `ledger_entries` ever appears (which the ledger barrel forbids).
10. **How the commission debt is actually collected from a driver is unmodelled.** The balance goes
    negative and blocks; nothing in this ticket lets a driver pay it down (that is an `adjustment` entry
    and a payment flow nobody has designed). At €50 and ≤10 pilot drivers this is a phone call and a
    manual `adjustment`, which is honest for the pilot but should not survive to open enrolment. Tracks
    the PRD's still-open "Cash-ride commission settlement" question.
11. **`docs/spikes/05-payout-rails.md` says SEPA batch for the pilot, and this ticket ships no payout
    rail at all.** That is deliberate and matches the ACs, but it means the pilot's first payday needs
    the payout ticket to exist. **Worth scheduling before #24's demo checkpoint**, since "how do I get
    paid" is the first question Atis will ask.

---

## NOTES (open canvas)

### Why these entry sets, and how they accommodate both payout rails

The design constraint from spike #5 is that the pilot pays drivers by **SEPA batch** while Stripe stays
in test mode, and switches to **Connect transfers** post-SIA. The ledger must not care which.

It doesn't, because of one choice: **`drivers.balance_cents` is "what the platform owes the driver"**, a
signed running total that is exactly the sum of that driver's ledger entries. That single account is what
a payout run reads — not the platform account, which is a contra figure (see the entry-set task) and
reconciles against nothing. A payout — by either rail — is then the same two rows:

| account | entryType | amountCents |
|---|---|---|
| driver | `payout` | `-payoutCents` |
| platform | `payout` | `+payoutCents` |

SEPA batch and Connect differ only in *when* those rows are written relative to the money actually
moving, and in what external reference is stored beside them (an `EndToEndId` vs a `tr_…`). Neither
needs a new entry type — `'payout'` is already in the enum — and neither needs the settlement entries to
change shape. That is what "the ledger shape accommodates both rails" means concretely, and it is why a
`PayoutProvider` interface written today would be guessing at a signature nobody can validate.

Prepaid balance (#post-MVP) is the same story from the rider side: a top-up is
`rider +topUp / platform -topUp` as an `adjustment`, and a `balance` ride then needs **no** collection
pair at all, because the platform is already holding the rider's money. Corporate invoicing is a rider
account allowed to run negative between invoices — structurally identical to the driver debt this ticket
implements — settled by an `adjustment` when the invoice is paid. Both fit; neither is built.

### Why the rider nets to zero, and why that cost an enum value

This is the one place the plan changed after review, and it is worth recording why.

The obvious card set is four entries: `rider -total`, `driver +total`, `driver -commission`,
`platform +commission`. It sums to zero, gives the driver the right balance, and is wrong.

It is wrong because it makes the **rider account mean something different depending on how the ride was
paid**: on a cash ride the rider ends at 0 (they handed the money over and we credit it back), on a card
ride they end at `-total` forever. So the rider account is a balance in one case and a lifetime-spend log
in the other, and the ticket's own scope bullet — *"Prepaid balance + corporate invoicing: ledger schema
accommodates them"* — is not satisfiable: a prepaid balance read off an account that every card ride
drags further negative is not a balance.

The fix generalises rather than patches. Stop thinking of `cash_settlement` as "the cash thing" and start
thinking of it as **the collection**: every ride credits the rider for the fare *and debits whoever
physically took the money*. The driver took it (cash) or the platform took it (card). That is one pair
either way, and it makes every account mean exactly one thing:

| account | meaning, uniformly |
|---|---|
| driver | what the platform owes the driver (negative: what the driver owes us) — already `drivers.balance_cents`'s documented meaning |
| rider | prepaid credit (positive) or invoiceable debt (negative); **zero after an ordinary ride, both methods** |
| platform | **contra account.** Its aggregate balance is `-(all party claims)` by construction and means nothing on its own; read it **by entry type** — `commission` is revenue, `payout` is money sent |

The platform's actual cash position is **not** in this ledger and is not meant to be: what sits at
Stripe and at the bank is a fact about the outside world, reconciled *against* the ledger rather than
stored in it. A claims ledger answers "who is owed what"; a general ledger would answer "what do we
hold", and building the second one for a ten-driver pilot is not this ticket.

The cost is one new value on a db-local enum (`card_settlement`) in a migration this ticket was writing
anyway, on tables that have never held a row. That is the cheapest this correction will ever be; making
it after #17 ships prepaid balance would mean backfilling every historical card ride.

A simpler ledger would skip the rider entirely and post only `driver` and `platform` rows. That fails
for the same reason plus one more: the cash set stops balancing, because there is nowhere to credit the
money the driver collected on our behalf, and the `cash_settlement` pair degenerates into an unpaired
row. `ledger_owner_type` has `'rider'` in it because #6 saw this coming.

### The two hazards, and which one the design actually spends effort on

| Hazard | Cost | Defence |
|---|---|---|
| Charge fails → we settle anyway | driver paid for money never collected | charge is **before** the transaction; a failure throws before `transitionInTx` |
| Charge succeeds → ledger write fails → retry | **rider charged twice** | idempotency key derived from the ride; Stripe returns the same PaymentIntent |
| Two settles race | double charge + double entries | the same derived key, plus `completed → settled` as the lock |
| Cash driver blocked after one ride | driver leaves the platform | `driver_debt_limit_cents`, €50 |

The first is easy and the plan spends one line on it. The second is the one that costs a rider real money
and it is defended by a **naming convention** (`settle:<rideId>`) rather than by machinery — which is
exactly why it gets its own integration test rather than a comment.

### Risk register — what was resolved, what is defended, what is accepted

Written after a de-risking pass on 2026-08-07. Three risks were **resolved empirically** rather than
left as warnings; the rest are defended in code or consciously accepted. Nothing here is an open
unknown at execution time.

| # | Risk | Status | Where |
|---|---|---|---|
| 1 | Charge succeeds → ledger write fails → retry **double-charges the rider** | **Defended.** Idempotency key derived from the ride (`settle:<rideId>`), never per-attempt. Has its own integration sub-case asserting two provider calls, same key, one entry set. | `settlement.service.ts` task; integration spec case 3b |
| 2 | Two concurrent settles double-charge / double-post | **Defended.** Same derived key at Stripe, plus `completed → settled` as the only lock. A loser answers 200, not 409. | `settlement.service.ts` step 8–9 |
| 3 | Stripe SDK error surface guessed wrong → declines misfiled | **RESOLVED.** Verified against `stripe@22.4.0`'s own `Error.js`: subclasses set `type` to their class name, `StripeCardError` is chosen by **HTTP 402**. Classification now switches on one verified field, and defaults **to the retry-safe bucket** when it recognises nothing. | `stripe-payments.provider.ts` task |
| 4 | drizzle-kit emits the enum change as DROP/CREATE → migration fails **mid-run** | **RESOLVED.** Made the edit, generated, inspected: one line, `ALTER TYPE … ADD VALUE 'card_settlement' BEFORE 'payout';`. Reverted. | migration task GOTCHA |
| 5 | `ALTER TYPE ADD VALUE` illegal inside drizzle's migration transaction | **RESOLVED.** Executed `BEGIN; ALTER TYPE … ; COMMIT;` on this project's own PG 16 container against a populated enum column: succeeded, sortorder 3.5, rows untouched, immediately insertable. | migration task GOTCHA |
| 6 | Read-modify-write on `drivers.balance_cents` loses a concurrent settlement | **Defended.** `sql\`balance_cents + ${delta}\`` only, called out as "the single easiest way to lose a driver's money in this ticket", with an invariant query in Level 4. | `ledger.repository.ts` task |
| 7 | Cash driver blocked after one ride | **Defended.** `driver_debt_limit_cents`, €50, config not constant, with boundary tests at −4999 / −5000 / −5001. | Phase 3 |
| 8 | Contract change silently absorbed by making the field optional | **Defended structurally.** Required field + Phase 3 moved *before* the new slices so the red window is one phase, not a dozen tasks. | Phase 3 rationale |
| 9 | A spec unrelated to this ticket fails at **runtime**, not typecheck | **Defended.** `platform-config.service.spec.ts`'s `row()` factory crosses an `as unknown as Db` boundary; named explicitly in the sweep task. | fixture sweep task |
| 10 | Stripe SDK leaks outside the payments slice in a later ticket | **Defended.** Grep added to validation Level 1 — the only structurally checkable half of AC #4. | Level 1 |
| 11 | **Stuck money**: a `completed` ride never settles | **Accepted, made visible.** No client calls the route yet. Recoverable by dispatcher/admin today, logged distinctly, and queryable (Level 4 #3). Fix lands in #15; sweeper only if it actually happens. | OPEN QUESTION #7 |
| 12 | Ledger imbalance not enforced by the database | **Accepted, asserted.** The pure builder throws on an unbalanced set, and Level 4 #1 is a standing zero-row query. A deferred constraint trigger would fire on every insert forever to catch a bug the builder cannot have. | OPEN QUESTION #9 |
| 13 | Concurrent inserts of the same `ledger_accounts` row block | **Accepted.** Blocks, does not deadlock (accounts resolved in a stable order). ≤10 drivers. | `ledger.service.ts` task |
| 14 | No payout rail exists, so the pilot's first payday has no mechanism | **Accepted, escalated.** Out of scope by the ACs, but it needs a ticket **before #24's demo**. | OPEN QUESTION #11 |

The two probes in rows 3–5 mutated the working tree (a schema edit, a generated migration) and a
throwaway `enum_probe` database. Both were reverted and the database dropped; `git status` was clean
afterwards. Recorded here so a reviewer knows the claims are measured, not assumed, and does not have to
re-derive them.

### Rejected alternatives

- **Settle inside `complete()`.** Would put a Stripe round trip inside the completion transaction, or
  else need `RidesModule → PaymentsModule` on top of the existing `PaymentsModule → RidesModule`, i.e. a
  `forwardRef` cycle. Rejected on both counts.
- **A `SettlementSweeper`.** Genuinely attractive — self-healing, no client call, mirrors
  `DispatchSweeper`, and the `completed` status is already a perfect queue. Rejected *for this ticket*
  because it needs an attempt counter, backoff and a dead-letter state so a hard decline is not retried
  until Stripe rate-limits us, and none of that has a consumer yet. Recorded as OPEN QUESTION #7(b).
- **A `ride_payments` table instead of `rides.payment_provider_ref`.** Correct the day a ride can have
  more than one charge (refunds, partial captures, a second attempt producing a second intent). The
  idempotency key rules out the third, and the first two are explicitly out of scope. One column now,
  a table when a second row becomes possible.
- **Enforcing the zero-sum invariant with a deferred constraint trigger.** Structural, and it would fire
  on every insert forever to catch a bug the pure builder cannot have. Deferred.
- **Skipping zero-amount commission entries.** Would make the 0%-commission pilot (S6-7) produce a
  *different entry shape* from every other ride, which any reconciliation read then has to special-case.
  Kept.
- **The four-entry card set (no `card_settlement` pair, no new enum value).** Balances, and breaks the
  rider account. Rejected — see "Why the rider nets to zero" above. Recorded here because it is the
  version a reviewer will reach for as a simplification.
- **A `debtLimitCents` read inside each strategy.** Would give the dispatch slice two config readers and
  let the strategies drift. It goes on `DispatchContext`, which `DispatchService` already builds from a
  config row it already fetched.

### Data flow, one card ride

```
driver taps Complete                    (#11 — already built)
  POST /rides/:id/complete
    in_progress → completed  +  rides.commission_* written from the ACCEPTED OFFER's split
                                                       │
driver app calls settle                                ▼
  POST /rides/:id/settle          ┌─────────── read: rides ⋈ users ───────────┐
    │                             │ status, paymentMethod, total, split, refs │
    ├─ status settled? ──────────▶ 200, no-op                                 │
    ├─ status ≠ completed? ──────▶ 409 ride_not_completed                     │
    ├─ fareSplitSchema.parse(...)  ← no-cent-leak refinement, last boundary    │
    │                             └───────────────────────────────────────────┘
    ├─ cash  → no provider call
    └─ card  → PaymentsProvider.charge({ idempotencyKey: 'settle:<rideId>', … })   ← OUTSIDE the tx
                 ├─ declined       → 402, nothing written
                 └─ provider_error → 502, nothing written
    │
    └─ BEGIN
         completed → settled          ← the lock; a loser returns undefined → 200
         ledger: 6 entries, one transaction_id, sum 0, rider nets 0
                 (card and cash differ ONLY in the collection pair)
         drivers.balance_cents = balance_cents + delta      ← relative, never read-modify-write
         rides.payment_provider_ref = 'pi_…'                ← card only
       COMMIT
    │
    └─ post-commit: emitStatus(ride:status settled) · log payment.settlement.settled
```

### Sequencing note for the implementer

Phase 1 makes two contract fields **required**, which breaks the api's typecheck the moment it lands.
That is intentional — a strategy that silently kept the old `< 0` rule would block cash drivers with no
visible diff — and it is why **Phase 3 (dispatch + the fixture sweep) comes before the two new slices**,
not after. Do not defer it: the window in which the repo does not typecheck is the window in which
someone makes `driverDebtLimitCents` optional to get green, and that reintroduces exactly the drift the
required field prevents. From the end of Phase 3 onward the tree stays green task by task.

Two standing traps in this repo:

- **Rebuild `@taxi/shared` before trusting an api typecheck.** `services/api` resolves the package from
  `dist/`, so a stale build type-checks the *old* contract and passes. This is precisely how the
  `DispatchContext` change would appear to be absorbed when it is not.
- **`platform-config.service.spec.ts` fails at runtime, not typecheck** (see the sweep task). If the
  api suite goes red in a spec you did not touch, that is the one.

### One thing that needed checking and turned out fine

`settle` returns `{ ride }` via `RidesRepository.findWithQuote` → `toRide` → `rideSchema.parse`.
Verified: `rideSchema.status` is `z.enum(RIDE_STATUSES)`, which contains `'settled'`, and `toRide`
already reassembles `split` from exactly the five columns this slice reads — so a settled ride
round-trips with no schema change. `assertRideSplitConsistent` compares `split.totalCents` against
`quote.totalCents`, neither of which settlement touches.

**Do not add `paymentProviderRef` to `rideSchema`.** No surface reads it, and putting a provider handle
on the wire ride object is how a Stripe id ends up in a client log. `toRide`'s settled-split
reassembly (`rides.repository.ts:74-104`) is, however, the exact pattern to mirror when
`SettlementService` builds its `FareSplit` from the row — read it before writing that step.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Each entry: ISO date — what changed and why. -->

- 2026-08-07 — De-risking pass before execution. (a) **Card entry set corrected from 4 entries to 6**:
  the four-entry version leaves the rider's account at `-fare` permanently, which makes the rider
  account a spend log on card and a balance on cash, and the ticket requires the ledger to accommodate
  prepaid balance / corporate invoicing — both of which read that account as a balance. Cost: one value
  (`card_settlement`) on a db-local enum whose tables have never held a row. (b) The **platform account
  is documented as a contra account** — its aggregate balance is `-(all party claims)` by construction
  and reconciles against nothing; the meaningful read is per entry type. (c) **Phases reordered**: the
  dispatch debt-limit work moved ahead of the two new slices so the required-field contract change is
  absorbed in one phase instead of leaving the repo un-typecheckable for a dozen tasks. (d) **Three
  risks resolved empirically** rather than mitigated in prose — the Stripe error surface (against
  `stripe@22.4.0` source), drizzle-kit's enum emission, and `ALTER TYPE ADD VALUE` inside a transaction
  on this project's PG 16 container; see the Risk register. (e) Added the AC #4 SDK-containment grep,
  the two standing reconciliation queries and the stuck-money query to the validation levels.
