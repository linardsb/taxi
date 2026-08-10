# Implementation Report — Close the double-assignment hole (#61)

**Plan**: `.claude/plans/api-dispatch-close-double-assignment.md`
**Branch**: `feature/api-dispatch-close-double-assignment`
**Status**: COMPLETE

## Summary

Both reachable double-assignment chains are closed on the durable truth instead of the
`drivers.status` cache. Chain A: going online is now refused (409 `driver_on_ride`) while the
driver has a ride in the new shared `ACTIVE_DRIVER_RIDE_STATUSES` set — the check lives inside
the UPDATE's WHERE (`setOnlineIfEligible`, L8 pattern), with a follow-up read only to pick the
409 message. Chain B: `offerNext` skips candidates already holding a live pending offer on any
ride (`findDriverIdsWithLiveOffers`), beside the existing per-ride `tried` set — one card per
driver, platform-wide. The accepted ms-wide residual (no accept-time guard) is documented in
KNOWN GAPS with `dispatch.assign.driver_not_claimed` as the tripwire.

## Tasks completed

- `ACTIVE_DRIVER_RIDE_STATUSES` constant → `packages/shared/src/ride-state-machine.ts` (UPDATE)
- Consistency test pinning the set to a machine derivation → `packages/shared/tests/ride-state-machine.test.ts` (UPDATE)
- `setOnlineIfHasVehicle` → `setOnlineIfEligible` (+ `notExists` rides subquery) and `hasActiveRide` → `services/api/src/features/drivers/drivers.repository.ts` (UPDATE)
- 409 split (`driver_on_ride` outranks `vehicle_required`) in `setPresence` → `services/api/src/features/drivers/drivers.service.ts` (UPDATE)
- Chain A gate tests (failure + completed-does-not-block edge) → `services/api/src/features/drivers/drivers.integration.spec.ts` (UPDATE)
- `findDriverIdsWithLiveOffers` → `services/api/src/features/dispatch/dispatch.repository.ts` (UPDATE)
- Busy-set exclusion in `offerNext` + rewritten `driver_not_claimed` comment → `services/api/src/features/dispatch/dispatch.service.ts` (UPDATE)
- Chain B edge + chain A end-to-end tests + AC #2 mode-switch proof restored (revoke statement) → `services/api/src/features/dispatch/dispatch.integration.spec.ts` (UPDATE)
- KNOWN GAPS bullet rewritten to the closed state + accepted residual → `services/api/src/features/dispatch/index.ts` (UPDATE)
- One clause on the presence gate → `services/api/CLAUDE.md`; one-card rule → `.claude/references/dispatch-strategies.md` (UPDATE)
- **Deviation set (see below)**: `services/api/package.json`, `services/api/test/harness.ts`, `services/api/src/features/rides/rides.integration.spec.ts` (UPDATE)

## Tests added

- `packages/shared/tests/ride-state-machine.test.ts` — `active-driver statuses are the non-terminal
  payment-locked ones minus completed (#61)` — pins the constant to
  `isPaymentMethodLocked && !isTerminal && !== 'completed'`. PASS.
- `drivers.integration.spec.ts` —
  `refuses to go online for an offline driver with a live accepted ride (#61 chain A — failure)`
  (hand-inserted paradox row; 409 `driver_on_ride`; both stores stay offline) and
  `lets a driver back online once their ride is completed but unsettled (#61 — edge)`. PASS (27/27 file).
- `dispatch.integration.spec.ts` —
  `never deals a second card to a driver already holding one (#61 chain B — edge)` (two rides, one
  driver, one tick → one card; decline → next tick deals ride B) and
  `refuses to go online for a driver who accepted while offline (#61 chain A — failure)` (the
  issue's five-step chain end to end). PASS (16/16 file).
- Regression honesty check: with the `offerNext` busy-set exclusion removed, the chain B test
  FAILS (verified, then restored) — it tests the fix, not the fixture.

## Validation results

- `pnpm --filter @taxi/shared typecheck` / `test` — pass (127 tests).
- `pnpm --filter @taxi/api typecheck` — pass. `lint` — 0 errors, 6 warnings (all pre-existing
  `getHttpServer()` `no-unsafe-argument` warnings across every integration spec, untouched files included).
- Full api suite with `REDIS_TEST_URL` — 48 suites, 382 tests, all pass.
- **The gate**: `REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`
  — 20/20 tasks successful, exit 0.

## Deviations from the plan

The plan's blast-radius warning fired, and closing it took three edits in files the plan did not
list. The first full-suite run failed six *pre-existing* dispatch tests. Root cause: jest ran
suites in parallel workers against the one shared Postgres, and `findAwaitingDispatch`'s pool is
global — another suite's freshly booked `requested` ride (oldest-first) was handed to the
dispatch spec's own sweeper tick, which dealt a card to this file's driver on the foreign ride.
Harmless while cascade state was per-ride; fatal once #61 made a live card platform-global
(the driver goes busy, the suite's own ride gets nothing). Fixes:

1. `services/api/package.json` — `"maxWorkers": 1`. Suites now run serially, restoring the
   architecture's own single-process/single-sweeper assumption in the test environment
   (11s → ~23s for the api package). Rationale documented in the harness docblock
   (`services/api/test/harness.ts`).
2. `services/api/src/features/rides/rides.integration.spec.ts` — the one integration suite that
   never retired its rides (the plan's "every integration file retires its rides" claim was false
   for this file); its `requested` leftovers would poison any later-running suite's tick even
   serially. Added a namespace-keyed `afterEach` retirement (`+371240` riders → `cancelled_by_system`),
   matching the cleanup the other three suites already have.
3. Verified post-run pool state: nothing left at `requested`/`offered` platform-wide.

Minor: the drivers/dispatch spec tests use `crypto.randomUUID()` (the files' existing idiom)
rather than importing `randomUUID` from `node:crypto` as the plan suggested.

Open Question 1 (the accepted ms residual, no accept-time guard) was implemented as planned —
documented in KNOWN GAPS, not coded around.

## Issues encountered

- `@taxi/api` resolves `@taxi/shared` from built dist — the new constant needed
  `pnpm --filter @taxi/shared build` before the api typecheck could see it (known workspace trait).
- None otherwise; the DB-per-invocation recreate in `global-setup.ts` means the parallel-worker
  interference was strictly in-run, which is what made serial execution a complete fix.
