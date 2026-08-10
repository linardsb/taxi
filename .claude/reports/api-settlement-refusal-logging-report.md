# Implementation Report — Log settlement refusals + restrict bookable payment methods (#70)

**Plan**: `.claude/plans/api-settlement-refusal-logging.md`   **Branch**: `feature/api-settlement-refusals-70`   **Status**: COMPLETE

## Summary

The two settlement refusals that leave a `completed` ride visibly stuck — `payment_method_unsupported` (both the enum arm and the `never` arm) and `payment_instrument_missing` — now emit a warn-level `payment.settlement.refused` event carrying `rideId`, `orderId`, `driverId`, `riderId`, `paymentMethod`, `cause`, `at`. The bigger half is closed at the contract: `BOOKABLE_PAYMENT_METHODS = ['cash', 'card']` in `@taxi/shared` narrows both wire bodies (`POST /rides` and `PATCH /rides/:rideId/payment-method`), so a permanently unsettleable `balance`/`corporate` ride can no longer be booked or switched into. Record schemas (`rideRequestSchema`, `rideSchema`) and the DB enum stay 4-wide — no migration, historical snapshots keep parsing.

## Tasks completed

- Add `BOOKABLE_PAYMENT_METHODS` subset (written-out tuple, `DRIVER_PRESENCE_STATUSES` precedent) → `packages/shared/src/enums.ts` (UPDATE)
- Narrow `rideRequestBodySchema` (`.omit().extend()`) and `ridePaymentMethodUpdateSchema`; docblocks state the why and the re-parse property → `packages/shared/src/schemas/ride.ts` (UPDATE)
- Contract tests: body schema refuses `balance`/`corporate`; update schema refuses `balance` (side-door); full `rideRequestSchema` still accepts `balance` (persisted-snapshot asymmetry) → `packages/shared/tests/schemas.test.ts` (UPDATE)
- Move `settlementMethodOf` from free function to private method (docblock reasoning preserved + one sentence on why it moved); `logRefused` fires in the `balance`/`corporate` arm, the `never` arm, and before the `payment_instrument_missing` throw; throws, messages, and check order unchanged; new `logRefused` helper beside `logChargeFailed` → `services/api/src/features/payments/settlement.service.ts` (UPDATE)
- Extend the two existing `it.each` blocks with `Logger.prototype.warn` spy assertions (`event`/`rideId`/`paymentMethod`/`cause`) → `services/api/src/features/payments/settlement.service.spec.ts` (UPDATE)
- Three verbatim KNOWN-GAPS prose transplants (card-enrollment bullet, balance/corporate bullet, mitigation tail), truth-checked sentence-by-sentence against the final diff → `services/api/src/features/payments/index.ts` (UPDATE)

## Tests added

- `packages/shared/tests/schemas.test.ts`: +4 cases — `it.each` refusing `balance`/`corporate` on the body schema (failure), full-schema-still-accepts-`balance` (edge, the snapshot property), update-schema refuses `balance` (failure, side door). Shared suite: 131 passed (was 127).
- `services/api/.../settlement.service.spec.ts`: the 4 existing refusal cases (2× `payment_method_unsupported`, 2× `payment_instrument_missing`) now also assert the warn log with the right `event`/`cause`/`rideId`. Suite: 17 passed.

## Validation results

- `pnpm --filter @taxi/shared typecheck && lint && test` — pass (131 tests).
- `pnpm --filter @taxi/api typecheck && lint` — pass (0 errors; 6 pre-existing `no-unsafe-argument` warnings in untouched integration specs).
- `pnpm --filter @taxi/api test settlement.service.spec.ts` — 17/17 pass.
- Wire-only tripwires: `z.enum(BOOKABLE_PAYMENT_METHODS)` ×2 in `ride.ts`; `z.enum(PAYMENT_METHOD_TYPES)` ×2 (down from 3); `db/src` does not consume the subset; `git diff main -- db/` empty.
- Full gate: `REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` — **20/20 tasks successful, 0 cached** (Redis container confirmed mapped to 6381, so the opt-in suites ran).

## Deviations from the plan

- None of substance. One mechanical note: `PaymentMethodType` was removed from the service's `@taxi/shared` import — after the restructure the method narrows from `ride.paymentMethod` (typed via `SettlableRide`), leaving the named import unused. The plan's IMPORTS note anticipated exactly this check.

## Issues encountered

- None. The plan's anchors matched the working tree exactly (pre-verified against main @ `1024250`, which the branch was cut from).

## Pending for `piv-create-pr`

- PR body must say `Closes #70`.
- Post the decision comment to #70 (`gh issue comment 70`), draft:

  > **Decision (Linards, 2026-08-10, during planning):** `balance`/`corporate` are **not bookable** until their settlement flows exist — `BOOKABLE_PAYMENT_METHODS = ['cash','card']` in `@taxi/shared`, enforced on `POST /rides` and `PATCH /rides/:rideId/payment-method`. `rideRequestSchema`/`rideSchema`/DB enum stay 4-wide so persisted snapshots parse and no migration ships. Log-only was rejected because it ships a knowingly broken booking path.
  >
  > **Logging:** `payment_method_unsupported` (both arms) and `payment_instrument_missing` now emit warn-level `payment.settlement.refused` with `rideId` + `cause`. The table's line numbers have shifted with the restructure (`settlementMethodOf` is now a private method of `SettlementService`); the two rows marked "will bite" now log, the other six remain silent by scope.

  Comment, don't close — the PR's `Closes #70` does that on merge. Never `gh pr review --approve` (solo repo).
