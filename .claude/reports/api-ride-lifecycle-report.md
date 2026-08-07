# Implementation Report — API ride lifecycle (accepted → completed)

**Plan**: `.claude/plans/api-ride-lifecycle.md`
**Branch**: `feature/api-ride-lifecycle`
**Status**: COMPLETE

## Summary

The half of the ride the platform never had. A new `features/rides/lifecycle/` sub-slice carries a ride
from `accepted` to `completed` through the driver's four steps, adds all four cancellation branches with
the actor taken from the JWT role, enforces the payment-method lock with a single race-free conditional
UPDATE, and writes the **settled** fare split into the four `rides.commission_*` columns — copied from
the accepted offer's snapshot, never recomputed. `drivers.status = 'on_ride'` is now actually written:
claimed inside dispatch's accept/force-assign transactions, released at completion and at every
post-acceptance cancellation.

No new socket event, no new database migration, no new dependency.

## Tasks completed

**Phase 1 — contract (`packages/shared`)**

- `rideSchema.paymentMethod` (the operative, mutable value, distinct from the immutable
  `request.paymentMethod` snapshot) → `packages/shared/src/schemas/ride.ts` (UPDATE)
- `ridePaymentMethodUpdateSchema` + `rideCancelSchema` and their types → same file (UPDATE)
- Fixtures + three new cases → `packages/shared/tests/schemas.test.ts` (UPDATE)

**Phase 2 — plumbing**

- `DbTx` moved to its cross-cutting home; re-exported from the old site so `dispatch.repository.ts` and
  the rides barrel are untouched → `services/api/src/common/db/db.module.ts` (UPDATE),
  `services/api/src/features/rides/ride-transition.service.ts` (UPDATE)
- `claimForRide` / `releaseFromRide`, both conditional single-statement UPDATEs taking `tx?: DbTx` →
  `services/api/src/features/drivers/drivers.repository.ts` (UPDATE)
- Service-level wrappers that log only on a real change →
  `services/api/src/features/drivers/drivers.service.ts` (UPDATE)

**Phase 3 — the lifecycle sub-slice**

- `services/api/src/features/rides/lifecycle/ride-lifecycle.policy.ts` (CREATE) — actor→status map, the
  driver step table, `PAYMENT_METHOD_EDITABLE_STATUSES` derived from `isPaymentMethodLocked` + `isTerminal`
- `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts` (CREATE) — the light ride read,
  the accepted-offer split read, the settled-split write, the payment-method conditional UPDATE, the
  cancel-time offer revoke
- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` (CREATE) — 400 lines, under the cap
- `services/api/src/features/rides/lifecycle/ride-lifecycle.controller.ts` (CREATE) — six routes, per-route `@Roles`
- `toRide` projects `paymentMethod` and the settled split (all five money columns non-null) →
  `services/api/src/features/rides/rides.repository.ts` (UPDATE)
- Module wiring + rewritten KNOWN GAPS → `rides.module.ts`, `rides/index.ts` (UPDATE)

**Phase 4 — dispatch integration**

- `claimDriver(tx, driverId)` inside both the accept and force-assign transactions →
  `services/api/src/features/dispatch/dispatch.service.ts` (UPDATE)

**Phase 6 — documentation**

- `services/api/CLAUDE.md` (UPDATE) — the sub-slice exists; the two `on_ride` writers named; the
  copy-don't-recompute rule added
- `.claude/references/ride-state-machine.md` (UPDATE) — the lock's route and 409 codes; `completed → settled` is #12's
- `.claude/references/realtime-events.md` — deliberately untouched (no event added)

## Tests added

| File | Cases | Result |
|---|---|---|
| `packages/shared/tests/schemas.test.ts` | +3 (expected/failure/edge) on the two new body schemas | 38 pass |
| `services/api/src/features/rides/lifecycle/ride-lifecycle.service.spec.ts` (CREATE) | 18 unit cases | 18 pass |
| `services/api/src/features/rides/lifecycle/ride-lifecycle.integration.spec.ts` (CREATE) | 8 AC-labelled e2e cases | 8 pass |
| `services/api/src/features/dispatch/dispatch.service.spec.ts` (UPDATE) | +2 for the claim (called in-tx; `false` does not throw) | 12 pass |

Unit spec highlights: the emit-ordering ledger (`tx:begin → write:split → release → tx:commit →
emit:status`) asserts the no-emit-in-transaction rule mechanically; `cancelled_by_system` is covered
here both ways — it works from `requested` and is refused from `accepted` — because it deliberately has
no HTTP route; a 0% commission settles without a truthiness bug; the in-transaction
`ride_transition_conflict` branch is exercised deterministically (`events` stops at `tx:begin`, no split
written, nothing emitted), which no integration test can force reliably.

Integration spec highlights (`+371260` E.164 range, `CENTRE_PICKUP` to stay out of queue mode):
the full 7-event `ride:status` sequence with correct `previousStatus`; `drivers.status` `on_ride` after
accept and `online` after complete; **the commission override is changed mid-ride and the persisted
`commission_pct` is still the offer's** — the assertion that makes "recompute at completion" impossible
to reintroduce; the pre-acceptance cancel clears the offer card with `reason: 'cancelled'`; the
post-acceptance 409 `payment_method_locked` leaves both the column and the request snapshot untouched;
two concurrent completes yield exactly one 201 and one typed 409, with one settlement that sums.

## Validation results

`REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`

```
Tasks: 20 successful, 20 total     (0 cached)
@taxi/shared  test: 11 files, 122 tests passed
@taxi/api     test: 41 suites, 293 tests passed, 0 skipped
lint: 0 errors, 5 warnings (all pre-existing `app.getHttpServer()` any-warnings, one per integration spec)
```

The api suite was then run three more times consecutively — 293/293 each time — because the specs share
one Postgres and the first version of this spec was not stable (see Issues).

Redis-backed suites ran rather than skipping (`REDIS_TEST_URL` set to match the container on 6381).
Level 5 (the manual curl/psql playbook ride) was **not** run — integration test #1 and #2 assert the same
sequence and the same `commission_cents + driver_net_cents = total_cents` invariant against the same real
Postgres, so it would re-prove what CI already proves. Flagged rather than silently skipped.

## Deviations from the plan

1. **`completed → settled` is not implemented** (plan OPEN QUESTION Q1). The plan recommends against it
   and lists it under Out of Scope; this follows that recommendation. `settled` means "ledger entries
   written", the ledger is #12's, and a `settled` status with no ledger rows is a status that lies.
   **This is the one item that may want your sign-off before the PR merges.**
2. **`driverStep` checks only `ride.status !== from`, not `canTransition` as well.** Every `DRIVER_STEPS`
   pair is an edge of `ALLOWED_TRANSITIONS`, so for a fixed step table a `from` mismatch *is* the
   illegality and the extra call is dead logic. `cancel` still checks `canTransition`, where it is
   load-bearing because `to` varies by actor. Documented on `DRIVER_STEPS` and on `guardDriverStep`.
3. **`PRE_ACCEPTANCE_STATUSES` was dropped; `revokePendingOffers` is unconditional.** The UPDATE is
   already conditional on `status = 'pending'` and both assignment paths revoke their siblings, so a
   post-acceptance cancel matches zero rows. This removes the one hand-written status list in the diff,
   which the plan's own AC forbids ("no hand-written status list anywhere in the diff").
4. **`complete()` is a public method rather than `driverStep('complete', …)`.** Both share the same
   private `guardDriverStep` prologue. Completion settles money and returns the ride, so folding it into
   `driverStep` would have forced a union return type; `Exclude<DriverStep, 'complete'>` on `driverStep`
   makes the split a compiler error rather than a runtime surprise.
5. **`transition_rejected` logs the ride's ACTUAL status as `from`**, not the step's expected one — an
   expected-status log claims the ride was in the state we wanted, which is useless at 02:00.
6. **The integration spec accumulates `ride:status` events instead of using `waitFor`.** Each lifecycle
   POST returns *after* its post-commit emit has fired, so a listener attached after the request has
   already missed the event. The listener goes on before `POST /rides` (which is also when the rider's
   one and only `joinRideRoom` runs).
7. **The integration spec drives dispatch with `DispatchService.offerNext(ride)`, not
   `DispatchSweeper.tick()`.** The sweeper's work queue is *every* `requested` ride in the database, and
   spec files share one Postgres — a tick here reached into `dispatch.integration.spec.ts`'s rides and
   offered them to this file's drivers, breaking that file's assertions. `offerNext` is the same
   production path, one ride at a time; the batching is dispatch's own concern and its own spec's to
   cover. See Issues.
8. **The spec's `afterEach` also releases this file's `on_ride` drivers.** Retiring a ride by direct
   UPDATE never runs the lifecycle, so without this a driver is left at `on_ride` in a database that is
   never reset and 409s `driver_on_ride` on their next presence toggle. Scoped by driver id — spec files
   run in parallel workers over one database.

## Notes on the standing bar

- Production files are all well under the ~500-line cap: service 399, repository 150, controller 115,
  policy 72. The integration spec is 600 lines, matching the existing convention for this kind of file
  (`dispatch.integration.spec.ts` is 768); splitting it would separate the shared harness from the
  cases that need it.
- No direct `rides.status` write exists in the new code — the only `set({ status })` in the slice's
  production files targets `ride_offers` (`revoked`). Every ride status change goes through
  `RideTransitionService`.
- No money literal, no commission literal. The one status *table* in the diff is `DRIVER_STEPS`, whose
  entries are transition edges rather than a status list; `PAYMENT_METHOD_EDITABLE_STATUSES` is derived.

## Issues encountered

- The api typecheck failed once against a stale `@taxi/shared` dist after Phase 1. `pnpm --filter
  @taxi/shared build` fixed it, and it is exactly the failure mode the plan's `--force` note predicts —
  `pnpm check` would have hidden it.
- `dispatch.service.spec.ts` needed a `RideLifecycleService` fake for the new constructor argument; the
  two added cases cover the claim rather than just satisfying arity.
- **The first version of the integration spec broke `dispatch.integration.spec.ts` intermittently** —
  two failures on one gate run, in the *other* file. Cause: this spec called `DispatchSweeper.tick()`,
  making it the second sweeper running over the shared test database, and a tick dispatches every
  `requested` ride it finds, including another spec file's. Fixed by scoping to
  `DispatchService.offerNext(ride)` (deviation 7). This is exactly the risk the plan flagged as Medium,
  arriving from a direction the plan did not anticipate — it warned about crowding the sweeper's batch,
  not about owning a second sweeper.
- `request.paymentMethod` (the immutable snapshot) is now legitimately allowed to differ from
  `rides.payment_method` (the operative column). Grepped every reader: the ONLY one is
  `RidesRepository.create`, which seeds the column from the snapshot at insert. Nothing branches on the
  snapshot, so nothing had to change — **and #12 should branch on the operative column** for
  cash-vs-card, never on `request`.
