# Implementation Report — API payments + ledger (#12)

**Plan**: `.claude/plans/api-payments-ledger.md`   **Branch**: `feature/api-payments-ledger`   **Status**: COMPLETE

## Summary

The financial half of the ride now exists. `POST /rides/:rideId/settle` charges card rides through a new
`PaymentsProvider` seam (Stripe test mode, stub otherwise), then in one transaction takes
`completed → settled`, posts a balanced six-entry ledger set and nets the driver's balance. Cash rides
never touch the provider — the driver already took the money — and their commission debits
`drivers.balance_cents`, which dispatch now tolerates up to `platform_config.driver_debt_limit_cents`
(€50, seeded) instead of blocking at the first cent of debt.

`settled` is reachable for the first time, and it means something: a `settled` ride always has ledger rows.

## Tasks completed

**Phase 1 — contracts (`@taxi/shared`)**
- `PaymentsProvider` seam, its request/result types and the two failure reasons → `packages/shared/src/seams/payments-provider.ts` (CREATE)
- Barrel export → `packages/shared/src/index.ts` (UPDATE)
- `driverDebtLimitCents`, no zod default → `packages/shared/src/schemas/platform-config.ts` (UPDATE)
- `driverDebtLimitCents` on `DispatchContext` → `packages/shared/src/seams/dispatch-strategy.ts` (UPDATE)

**Phase 2 — persistence (`db`)**
- `card_settlement` enum value → `db/src/schema/enums.ts` (UPDATE)
- `ledger_entries_ride_idx` (the deferred PR #32 finding) → `db/src/schema/ledger.ts` (UPDATE)
- `driver_debt_limit_cents`, NOT NULL, no column default → `db/src/schema/platform-config.ts` (UPDATE)
- `payment_customer_ref` / `payment_instrument_ref` → `db/src/schema/users.ts` (UPDATE)
- `payment_provider_ref` → `db/src/schema/rides.ts` (UPDATE)
- Migration, hand-edited for the NOT NULL backfill → `db/migrations/0006_harsh_donald_blake.sql` (CREATE)
- `driverDebtLimitCents: 5000` in values **and** conflict-set → `db/src/seed/riga.ts` (UPDATE)

**Phase 3 — absorbing the contract change**
- The block becomes `balanceCents < -driverDebtLimitCents`; stale comment deleted → `services/api/src/features/dispatch/strategies/candidate-filter.ts` (UPDATE)
- Both strategies thread the limit; auto-match's "takes no `DispatchContext`" docblock rewritten → `auto-match.strategy.ts`, `geozone-queue.strategy.ts` (UPDATE)
- The `DispatchContext` literal → `services/api/src/features/dispatch/dispatch.service.ts` (UPDATE)
- Fixture sweep → `platform-config.service.spec.ts` (the runtime-only one), the shared test fixtures, and every `DispatchContext` literal in the dispatch specs (UPDATE)

**Phase 4 — the ledger slice** (`services/api/src/features/ledger/`, all CREATE)
- `settlement-entries.ts` — the pure builder, the domain core
- `ledger.repository.ts` — account get-or-create, entry insert, relative balance delta, `findByRide`
- `ledger.service.ts` — composes the two, stable account order, `payment.ledger.settlement_written`
- `ledger.module.ts`, `index.ts`

**Phase 5 — the payments slice** (`services/api/src/features/payments/`, all CREATE)
- `payments.tokens.ts`, `stub-payments.provider.ts`, `stripe-payments.provider.ts`
- `settlement.policy.ts` (the derived idempotency key), `settlement.repository.ts`, `settlement.service.ts`, `settlement.controller.ts`
- `payments.module.ts` (production-refusing factory), `index.ts`
- `STRIPE_SECRET_KEY`, test-mode-only → `services/api/src/common/config/env.schema.ts` (UPDATE)
- `stripe@22.4.0` → `services/api/package.json` (UPDATE)
- `LedgerModule` + `PaymentsModule` → `services/api/src/app.module.ts` (UPDATE)
- `RecordingPaymentsProvider` + override + self-check → `services/api/test/harness.ts` (UPDATE)

**Phase 6 — docs**
- `.claude/references/ride-state-machine.md`, `services/api/CLAUDE.md`, `services/api/src/features/rides/index.ts` (UPDATE)

## Tests added

| File | Cases | Result |
|---|---|---|
| `ledger/settlement-entries.spec.ts` | 14 — both entry sets, rider-nets-zero, the one-pair difference asserted structurally, 0% commission, rounding, a 7-fare sum-to-zero table, `driverBalanceDelta` | pass |
| `ledger/ledger.service.spec.ts` | 4 — six entries under one txn id, cash delta, stable account order, nothing written when `accountFor` rejects | pass |
| `payments/stripe-payments.provider.spec.ts` | 13 — param shape, idempotency key **as second argument**, both decline paths, `requires_action`, three transient types, unrecognisable throws | pass |
| `payments/settlement.service.spec.ts` | 15 — the orchestration matrix; asserts provider **call counts**, not just responses | pass |
| `payments/payments.module.spec.ts` | 3 — all three factory branches | pass |
| `payments/payments.integration.spec.ts` | 7 — the three ACs end to end + idempotent settle, missing instrument, and a standing zero-sum invariant | pass |
| `common/config/env.schema.spec.ts` | +5 — `sk_test_` accepted, absent/empty → undefined, `sk_live_` refused in all three environments | pass |
| `dispatch/strategies/candidate-filter.spec.ts` | +3 — −4999 in, exactly −5000 in, −5001 out, and limit 0 reproducing the old rule | pass |
| `shared/tests/platform-config.test.ts` | +3 — parses, no default, rejects negative | pass |
| `db/tests/schema-constraints.test.ts` | +1 — `platform_config` rejects a row with no `driver_debt_limit_cents` | pass |

**Mutation-checked**: reverting `candidate-filter.ts` to the old `balanceCents < 0` makes the AC #2
integration case fail (at the "exactly at the limit is still eligible" assertion) and nothing else. The
boundary test is real, not incidentally green. Reverted immediately.

## Validation results

**CI-parity gate, from a cleared `dist/`, docker up, `REDIS_TEST_URL` set:**

```
pnpm turbo run typecheck lint test build --force   →  Tasks: 20 successful, 20 total
```

| Package | Typecheck | Lint | Tests |
|---|---|---|---|
| `@taxi/shared` | pass | pass | 125 passed (11 files) |
| `@taxi/db` | pass | pass | 17 passed (3 files) |
| `@taxi/api` | pass | 0 errors, 6 warnings | **364 passed, 47 suites** |

The 6 lint warnings are the pre-existing `no-unsafe-argument` on `app.getHttpServer()` present in every
integration spec — 5 predate this ticket, the 6th is the new spec following the identical pattern.

**AC #4 SDK containment** — `grep` over `packages/*/src db/src services/api/src` outside
`features/payments/`: *"OK: stripe SDK confined to features/payments/"*.

**Boot refusals, run live** (not inferred from the unit tests):

| Attempt | Result |
|---|---|
| `STRIPE_SECRET_KEY=sk_live_xxx`, `NODE_ENV=development` | **Refused at env parse** — *"STRIPE_SECRET_KEY must be a test-mode key (sk_test_…)"*. Unconditional across environments, as designed. |
| `STRIPE_SECRET_KEY=sk_test_dummy`, `NODE_ENV=development` | Boots; `SettlementController {/rides}` mounts; *"Nest application successfully started"*. Proves the Stripe provider path constructs and the route registers. |
| `NODE_ENV=production`, no key | Refuses — but on **`MapsProvider`**, not payments: `GeoModule` instantiates first, so an earlier unbound seam wins the race. |

The third row is worth recording: the production refusal chain today is maps → sms → payments, so the
payments refusal cannot be observed live until #13/#16 bind the two earlier seams. It is covered instead
by `payments.module.spec.ts`, which exercises all three factory branches directly.

**Migration**, verified three ways: applied to the dev database and re-run (idempotent); applied from
**zero** on a scratch database (`driver_debt_limit_cents` = 5000 with **no** column default,
`ledger_entries_ride_idx` present, `card_settlement` present); and re-created from zero by the db suite's
global setup on every run. The enum statement generated as the safe APPEND form the plan's probe predicted:

```sql
ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'card_settlement' BEFORE 'payout';
```

landing at `enumsortorder` 3.5 with existing rows untouched.

## Deviations from the plan

1. **`DispatchService` has ONE `findCandidates` call site, not two.** The plan says "~line 105 and
   ~line 338" and instructs threading the limit into both. Line 105 is the only one; line 315's `config`
   read belongs to `forceAssign`, which passes it to `buildOffer` and — by design (S9-2) — is *not*
   filtered through eligibility at all. Threading a debt limit there would have contradicted the override.
   The integration spec asserts force-assign still reaches a blocked driver.

2. **Two of the three planned `db` constraint cases already existed.** The integer-money sweep is
   self-extending (it already covers `ledger_entries.amount_cents` and now `driver_debt_limit_cents`), and
   the `NULLS NOT DISTINCT` platform-account case was already in the file. Only the new NOT NULL case was
   added rather than duplicating the other two.

3. **`offer-builder.spec.ts` and `pricing.service.spec.ts` were left alone.** The plan's sweep table
   expects the typecheck to catch them; it does not — both build `{...} as PlatformConfig` partial casts
   and neither parses or reads `driverDebtLimitCents`, so both are correct as-is. Adding the field would
   have been noise. The genuinely dangerous one the plan flagged — `platform-config.service.spec.ts`,
   which crosses an `as unknown as Db` boundary and fails at *runtime* inside `platformConfigSchema.parse`
   — was fixed, plus an assertion that the parsed value survives.

4. **`admin` is NOT collapsed into `dispatcher`** in the settlement controller, unlike
   `RideLifecycleController.cancel`. That collapse exists because the state machine has no
   `cancelled_by_admin`; nothing forces it here, and the settlement log is an audit trail that should
   record which of them actually settled. The actor is mapped explicitly rather than cast, so adding a
   fourth role to `@Roles` becomes a compile error instead of a silent dispatcher-grade authorization.

5. **The idempotency key lives in `settlement.policy.ts`**, not in `settlement.service.ts` — the plan
   offered either. It mirrors the existing `ride-lifecycle.policy.ts` convention and lets both specs
   assert on it by name instead of re-typing the format.

6. **AC #2's over-limit balance is set directly, not accumulated through ~33 cash settlements.** The
   cash netting that *produces* a negative balance is asserted immediately above in the same test, from a
   real settlement through the API; what the block half tests is the filter reading the config row. Both
   sides of the boundary are asserted (exactly `-5000` still gets the offer, `-5001` does not), which is
   what makes it a real test — confirmed by the mutation check above.

7. **`docker compose down -v` was not run.** The plan's Level 4 asks for it to prove a from-zero
   migration; it would also destroy the user's local dev volume. The same proof was obtained
   non-destructively on a scratch database (created, migrated from zero, seeded, verified, dropped).

8. **The route returns 201, not 200.** The plan's prose describes the idempotent and lost-race paths as
   "200", meaning "a success, not a 409". `@Post` defaults to 201 and the route keeps it, matching its
   direct sibling `POST /rides/:rideId/complete` (the repo reserves an explicit `@HttpCode(200)` for
   routes that create nothing — see `auth.controller.ts`, and settling does create six ledger rows). The
   first draft of the three new documentation sites named a literal 200 and contradicted the code; all
   three now describe the behaviour (an ordinary success carrying the settled ride, never a 409) and name
   201 where a status is useful.

## Issues encountered

- **A second `app.init()` in the new integration spec** (the harness already inits) surfaced only under
  the full parallel gate, as supertest's `Parse Error: Expected HTTP/, RTSP/ or ICE/` in the AC #2 case —
  green in isolation, red under load. Removed; five consecutive full-suite runs are green.
- **One transient failure in `auth.integration.spec.ts`**, a file this ticket does not touch, during one
  gate run. It did not reproduce in 4 isolated runs or 5 subsequent full-suite runs. Flagged as
  pre-existing flake rather than chased.
- **`stripe@22.4.0`'s error surface re-verified against the installed source** rather than taken on faith:
  `generateV1Error` picks `StripeCardError` from **HTTP 402** (not `rawType`), and each subclass passes
  its class name as `type` — so the plan's `error.type === 'StripeCardError'` classification is correct.
- **`.env.example` needed no edit** — it already ships `STRIPE_SECRET_KEY=` and `STRIPE_WEBHOOK_SECRET=`
  under a "test mode keys until the SIA exists" comment, so the plan's claim and the completion
  checklist item both hold as written. Checked rather than assumed.
- **`RecordingPaymentsProvider.reset()`** replaced the spec's `calls.splice(0)`: the splice cleared the
  call log but left an armed `failNext` in place, so a future test arming a failure on a path that never
  reaches the provider would have declined the *following* test's charge, silently and one case late.

## Open risks carried forward (unchanged from the plan, restated because they are now live)

- **Stuck money has no automatic recovery.** A `completed` ride that never settles sits there. Accepted:
  no production client calls the route yet. Mitigated by an idempotent route callable by
  dispatcher/admin, distinct `payment.settlement.*` failure logs, and a one-statement query — all
  recorded in the payments barrel. The real fix is #15 calling `settle` after `complete`.
- **`cancelled_by_system` still has no producer**, and is now *unassigned*: #12 was expected to be its
  caller via payment pre-authorization and charges at settlement instead. Restated accurately in the
  rides barrel.
- **No payout rail**, so the pilot's first payday needs its own ticket before #24's demo checkpoint.
- **Driver commission debt cannot be paid down** — the balance blocks at €50 and clears by a phone call
  and a manual `adjustment`. Honest at ≤10 drivers; must not survive open enrolment.

## Ready for the next step

All plan tasks complete, all validations pass, the gate is green from a cleared dist.
Next: `piv-commit`, then `piv-create-pr` (body from this report, `Closes #12`), then `piv-review-pr`.
