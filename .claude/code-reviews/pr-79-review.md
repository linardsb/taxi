# PR #79 Review — feat(api): log settlement refusals, book only settleable methods (#70)

**Verdict: ✅ Approve** (posted as a comment — solo repo, GitHub refuses self-approval). 0 Critical · 0 High · 0 Medium · 3 Low. Validation green. A human (Linards) makes the final merge call.

## Summary

The PR does exactly what #70 asked and what the plan committed to: warn-level `payment.settlement.refused` (with `rideId` + `cause`) on the two 409 refusals that leave a completed ride stuck, and a wire-only `BOOKABLE_PAYMENT_METHODS = ['cash','card']` narrowing on both booking bodies so a permanently unsettleable `balance`/`corporate` ride can no longer be created or switched into. Record schemas and the DB enum stay 4-wide — no migration, historical snapshots keep parsing. The one deviation (dropping the now-unused `PaymentMethodType` import) was documented in the report and anticipated by the plan — not an issue.

## Validation

| Check | Result |
|---|---|
| Full CI-parity gate (`REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`) | ✅ 20/20 tasks, 0 cached |
| `@taxi/api` tests (Redis suites ran, not skipped) | ✅ 378/378 |
| Lint | ✅ 0 errors (6 pre-existing `no-unsafe-argument` warnings in untouched integration specs) |
| Wire-only tripwires | ✅ `z.enum(BOOKABLE_PAYMENT_METHODS)` ×2 in `ride.ts`; `git diff main -- db/` empty |

## Issues

### Low

1. **Barrel prose misses the `already_settled` case** — `services/api/src/features/payments/index.ts:60-67`. "MOST EXITS THAT NEVER REACH THE PROVIDER STILL LOG NOTHING … The exceptions, since #70, are `payment_method_unsupported` and `payment_instrument_missing` … The rest are silent on purpose: the request-shape guards … and the data-bug 500s". Strictly read, `already_settled` is also a provider-untouched exit, is not one of the named "exceptions", and is not silent — it has logged debug-level `payment.settlement.rejected` since before #70. Given this docblock's history (three review rounds on literal accuracy), worth one parenthetical, e.g. after "The rest are silent on purpose": *"(the benign idempotency exits — `already_settled`, `lost_race` — keep their debug `payment.settlement.rejected`, as before)"*.

2. **Inline `'cash' | 'card'` union now duplicates `BookablePaymentMethod`** (optional) — `services/api/src/features/payments/settlement.service.ts:248,280`. `settlementMethodOf()` and `chargeIfNeeded()` write out the exact union this PR named in `@taxi/shared`, and the two sets are meant to coincide by construction ("bookable = settleable"). Using the named type would keep them coinciding when the set widens, without weakening the `never`-arm tripwire (that fires on `PAYMENT_METHOD_TYPES`). Counter-argument: "settleable" and "bookable" are distinct roles and the inline union predates the PR. Either resolution is defensible; if kept inline, a one-line comment noting the deliberate decoupling would stop the next reader from "fixing" it.

3. **Stale spec comment undersells the restore's scope** — `services/api/src/features/payments/settlement.service.spec.ts:162-166`. The `afterEach(() => jest.restoreAllMocks())` justification still says "The two `write_failed` cases spy on `Logger.prototype`"; since this PR, the four new warn-spy executions depend on that same restore. Suggested: *"The `Logger.prototype` spies (warn in the refusal cases, error in the `write_failed` cases) are global…"*.

Pre-existing, not a PR defect: `packages/shared/tests/schemas.test.ts` is ~596 lines against the ~500 soft cap (was already over; this PR adds ~22). A future split candidate, not a blocker.

## Verified specifically

- **No consumer fallout from the wire narrowing.** Nothing under `apps/` touches `paymentMethod` yet; the only consumers are the rides controller/service and lifecycle controller. The server re-parse `rideRequestSchema.parse({ ...body, riderId })` composes (subset ⊂ superset), and `changePaymentMethod(paymentMethod: PaymentMethodType)` accepts the narrowed `RidePaymentMethodUpdate`. `db/` does not consume the subset.
- **Exhaustiveness tripwire preserved.** `const unmapped: never = method` survives the move; adding a fifth `PAYMENT_METHOD_TYPES` value still breaks compilation. Reusing `payment_method_unsupported` as the `never`-arm cause is fine — the log's `paymentMethod` field carries the raw value.
- **`driverId` non-null at all three `logRefused` sites** — `assertSettlable` throws on null `driverId` before both `settlementMethodOf` and `chargeIfNeeded`.
- **Log compliance.** Fields match the logging standard (`event`, `rideId`, `orderId`, `driverId`, `riderId`, `paymentMethod`, `cause`, `at`); no `riderCustomerRef`/`riderInstrumentRef`, no PII; `payment.settlement.refused` fits the `domain.component.action_state` taxonomy beside `rejected`/`settled`/`charge_failed`/`write_failed`.
- **Spec integrity.** Warn spy installed after `build()` (which emits no warn), `jest.restoreAllMocks()` present in the global `afterEach`, `objectContaining` is the right matcher for the single-object logger arg.
- **Docblock reasoning preserved** through the free-function→method move, plus the one-sentence why-it-moved addition. `settlement.service.ts` at 434 lines stays under the file cap.

## Done well

- The asymmetry test (full `rideRequestSchema` still accepts `balance`) pins the wire-only decision so a future "cleanup" narrowing the record schema fails loudly — the single best test in the PR.
- Closing the `PATCH /rides/:rideId/payment-method` side door shows the restriction was treated as a system property, not a single-endpoint patch, and the docblock records why.
- `BOOKABLE_PAYMENT_METHODS` follows the documented written-out-tuple precedent with the rationale stated in place.
- Refusal tests assert `transactionsOpened() === 0` and `payments.calls === []` — they test the hazard (nothing moved), not just the thrown message.

## Recommendation

**Approve.** Nothing blocks merge. The three Lows are follow-up candidates at Linards' discretion (`piv-fix-review-findings` on this report if desired) — #1 is the only one I'd actually do, given the docblock's accuracy history.
