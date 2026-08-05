# Implementation Report — API dispatch engine

**Plan**: `.claude/plans/api-dispatch-engine.md`   **Branch**: `feature/api-dispatch-engine`   **Status**: COMPLETE

## Summary

Built the dispatch engine as one vertical slice (`services/api/src/features/dispatch/`) driven by a polling
sweeper: candidate selection behind the `DispatchStrategy` seam (`auto_match` by proximity, `geozone_queue` by
FIFO rank), the offer cascade over `ride_offers` rows, the unclaimed-order alert to Dina, and dispatcher
force-assign with an audit row. Two supporting pieces landed outside the slice: `RideTransitionService` (the
codebase's first and only guarded writer of `rides.status`) in the rides slice, and a new `geozones` slice that
resolves a pickup to its zone in SQL via `ST_Contains`.

No new shared contract was added and no new dependency was installed, as the plan required. All 7 pre-flight
checks matched the plan's expectations.

## Tasks completed

| # | Task | File(s) |
|---|---|---|
| 1–2 | Guarded transition writer + spec | `features/rides/ride-transition.service.ts` (CREATE), `.spec.ts` (CREATE) |
| 3 | `findAwaitingDispatch` · `findWithQuote` · `assignDriver` · `setGeozone`; module + barrel exports | `features/rides/rides.repository.ts`, `rides.module.ts`, `index.ts` (UPDATE) |
| 3b | Quote-reconstruction integration cases | `features/rides/rides.integration.spec.ts` (UPDATE) |
| 4–5 | Geozones slice + integration spec | `features/geozones/{repository,service,module,index,service.spec}.ts` (CREATE) |
| 6 | `commissionPctOverride` on `DriverMatchAttributes` | `features/drivers/drivers.repository.ts` (UPDATE) |
| 7–9 | Queue port, Redis + in-memory impls, shared contract run against both | `features/dispatch/queue/*` (CREATE), `test/dispatch-queue-store.contract.ts` (CREATE) |
| 10 | Non-config constants + key builders | `features/dispatch/dispatch.policy.ts` (CREATE) |
| 11–15 | Eligibility filter, both strategies, resolver, token (+ specs) | `features/dispatch/strategies/*` (CREATE) |
| 16 | Offer builder + spec | `features/dispatch/offer-builder.ts` (CREATE) |
| 17 | `ride_offers` / `dispatch_audit_log` access | `features/dispatch/dispatch.repository.ts` (CREATE) |
| 18 | `offerNext` · `accept` · `decline` · `forceAssign` · `raiseUnclaimed` · `expireOffer` | `features/dispatch/dispatch.service.ts` (CREATE) |
| 19 | Sweeper (`tick()` + three passes) | `features/dispatch/dispatch.sweeper.ts` (CREATE) |
| 20–21 | Controller, module, barrel + KNOWN GAPS, `app.module.ts` | `features/dispatch/{controller,module,index}.ts` (CREATE), `app.module.ts` (UPDATE) |
| 22–23 | Unit specs + the acceptance suite | `features/dispatch/*.spec.ts` (CREATE) |
| 24 | Closed gaps, new rules | `features/rides/index.ts`, `services/api/CLAUDE.md` (UPDATE) |
| — | Queue store wired into the shared harness with the identity self-check | `test/harness.ts` (UPDATE) |

## Tests added

78 new tests (173 → 251 total). Every new unit of behaviour has ≥1 expected + 1 edge + 1 failure case.

- `ride-transition.service.spec.ts` (4) — including the assertion that a **successful `transitionInTx` emits
  nothing**, which is what stops a later refactor from folding the emit back inside the transaction.
- `rides.integration.spec.ts` (+3) — quote round-trip **with** a discount, the no-discount-line → `0` case, and
  an unquoted ride returning `undefined`. Asserts the whole `FareQuote`, so a swapped distance/time mapping
  cannot pass by summing the same.
- `geozones.service.spec.ts` (4) — RIX, the overlap → smallest zone, no zone, and the anti-transposition case.
- `dispatch-queue.store.spec.ts` + `redis-dispatch-queue.store.spec.ts` (7 each) — one contract, both impls.
- `candidate-filter.spec.ts` (5), `auto-match.strategy.spec.ts` (4), `geozone-queue.strategy.spec.ts` (5),
  `dispatch-strategy.resolver.spec.ts` (3), `offer-builder.spec.ts` (6).
- `dispatch.service.spec.ts` (8), `dispatch.sweeper.spec.ts` (8).
- `dispatch.integration.spec.ts` (14) — all four ACs, plus offline-driver exclusion, an option that excludes
  everyone, an expired accept, concurrent accepts, a driver token refused on force-assign, the socket silence
  of a rolled-back concurrent accept, and the `MAX_OFFER_ATTEMPTS` cap.

**AC #2's fixture is asserted in both directions**: the same two drivers under a RIX pickup offer the
queue-ranked driver, and under a centre pickup offer the nearer one — so a green result cannot come from the
mode never switching.

## Validation results

| Gate | Result |
|---|---|
| `pnpm turbo run typecheck lint test build --force` (repo root, cleared dist) | **green — 18/18 tasks**; 233 passed, 18 skipped |
| Same, with `REDIS_TEST_URL=redis://127.0.0.1:6381` | **green — 251 passed, 0 skipped, 39/39 suites** |
| Lint | 0 errors (4 pre-existing warnings, untouched) |
| Baseline before starting | green — 162 passed + 11 skipped (173 total) |
| Repeat runs of `src/features/dispatch src/features/rides` ×3 | identical (86 passed, 7 skipped) — no order- or residue-dependent flake |

Both gate runs above were executed AFTER the manual smoke test, so they ran against a database
`global-setup.ts` had freshly dropped and re-seeded — the reported numbers are not inherited from a
pre-smoke-test state.

**Anti-transposition verified by mutation**, as the plan demands: swapping `ST_MakePoint`'s arguments turned
the geozones spec red (3 of 4 cases, including the transposition case itself); reverted and re-run green.

**Live smoke test** of the one path jest cannot cover — the sweeper's real interval under
`NODE_ENV=development`. Booted the app against the test database with a seeded online driver and a `requested`
ride, called no `tick()`, and the ride advanced to `offered` on its own with `geozone_id` stamped and an offer
carrying the full €13.00 rider fare split 15% / €11.05 net. Dispatch logs carry the geozone **slug** and no
coordinates or addresses.

Also confirmed structurally: **no socket emit occurs inside a transaction callback** — every emit in
`dispatch.service.ts` sits after a `// ── committed ──` marker.

## Deviations from the plan

1. **The sweeper does not auto-start under `NODE_ENV=test`** (Task 19 says start it in `onModuleInit`
   unconditionally). `test/harness.ts` boots the real `AppModule`, so an auto-started interval would run inside
   every existing integration suite — dispatching the rides `rides.integration.spec.ts` creates and racing the
   `tick()` a dispatch test calls by hand. Mirrors how `StubMapsProvider` and the env-secret checks already
   branch on environment. Verified afterwards that the rides/drivers/auth suites still pass, and covered the
   production path with the live smoke test above.
2. **Force-assign accepts a ride already at `offered`, not only at `requested`.** Task 18 specifies two hops
   (`requested → offered → accepted`), but AC #4 requires force-assign to work **mid-cascade**, where a driver
   is already holding an offer and the ride is at `offered`. The first hop is now allowed to match nothing; the
   `offered → accepted` hop is the conditional guard, so a ride that was never assignable (already accepted,
   cancelled) still 409s. Both paths have their own test. This was caught by AC #4's own test failing.
3. **`assertFareQuoteConsistent` is skipped for `rider_bid` quotes** in `findWithQuote`. Task 3 says to call it
   unconditionally, but `isFareQuoteConsistent`'s own docblock records the asymmetry ("requiring those to agree
   would make an honest bid unrepresentable") and says to call it "where the model says it must hold". Only
   `upfront_fixed` is produced today, so this changes nothing now and prevents a latent failure on a driver's
   offer card later.
4. **`tx` is the LAST, optional parameter** on composable writes, not the first. Task 17 asks for an "optional
   first `tx?: DbTx`"; the expressible form of that is a required-but-nullable `tx: DbTx | undefined` first
   parameter, which would force every non-transactional call site to pass an explicit `undefined`.
   Trailing-optional achieves the plan's stated goal — composing into the caller's transaction — and reads
   better at the ~20 call sites that do not need one.
5. **The in-memory queue store is wired into `test/harness.ts`** rather than overridden per-spec as Task 23
   sketches. The harness already owns the four other fakes, and centralizing it means no integration spec can
   accidentally dial Redis. The plan's `toBe` self-check is preserved and strengthened: `createTestApp` throws
   if the container resolves any instance other than the one it seeds, so a silently-ineffective override fails
   every suite loudly instead of making the queue-fairness case pass for the auto-match reason.
6. **`RidesRepository.setGeozone` and `findGeozoneId` added** (not in the plan's task list) — `offerNext` must
   stamp `rides.geozone_id`, and writing it anywhere else would put a second writer on that column;
   `findGeozoneId` exists because the decline path must not reassemble a quote to read one uuid (see Bugs
   found, below).
7. **`AutoMatchStrategy.findCandidates` takes no `DispatchContext`.** Proximity mode has no use for the zone,
   and an unused parameter is a lint error; a method with fewer parameters still satisfies the interface.

## Bugs found and fixed during review

Both were found after the first green gate, by a review pass and by the two tests added for the plan's
uncovered edge cases. Both are real defects, not style.

1. **`decline` could strand a ride permanently.** It called `findWithQuote` purely to read `geozoneId` — which
   reassembles a `FareQuote` and runs `assertFareQuoteConsistent`, and that **throws** on an inconsistent quote.
   The throw landed *after* the offer row was already flipped to `declined` but *before* the
   `offered → requested` transition, leaving the ride at `offered` with no pending offer. `dispatchAwaitingRides`
   filters on `requested`, so the sweeper would never see it again: the cascade dies silently and the rider waits
   forever. Fixed three ways — a narrow `RidesRepository.findGeozoneId` read, the transition moved ahead of the
   queue bookkeeping, and the demotion wrapped in a guard, so nothing after the offer flip can strand the ride.
2. **The newly assigned driver never received `ride:status` = `accepted`.** `emitAssigned` called `emitStatus`
   before `joinRideRoom`, so the driver was not yet in the ride room when the status event went to it — exactly
   the trap `RidesService.notifyRider` documents ("Join BEFORE emitting, or the rider's own sockets miss the
   first event"). Fixed by joining first. Caught by the new concurrent-accept socket-silence test, which is the
   only test that watches a driver's socket across an assignment.

## Issues encountered

- **`ride_fare_lines` had no reader anywhere in the codebase**, exactly as the plan's NOTES predicted. Building
  `findWithQuote` was a small build rather than the read it looks like, and it is on the critical path for every
  offer.
- **Spec files share one test database across parallel jest workers.** A tick can legitimately pick up another
  file's `requested` ride. Handled by filtering every socket assertion on `rideId` and by retiring only this
  file's own rides in `afterEach`, so the sweeper's oldest-first batch stays dominated by the ride under test.
  No other file's rows are touched.
- **`autoosta` is the smallest seeded zone and overlaps `old_town`**, so the "Vecrīga ∩ centre → old_town" case
  only holds west of lng 24.108. All test coordinates were verified against the real polygons with a
  `ST_Contains` sweep before being asserted, rather than derived by reading the rings.
- `localhost:5432` reaches brew's Postgres (no `taxi` role); the Docker instance needs the LAN IP. This only
  affected the manual smoke test — the jest suite resolves its own URL and was left alone.

## Follow-ups for the next session (not done here, by design)

- `.claude/references/dispatch-strategies.md` still says "Phase 1 ships auto_match only; geozone_queue lands
  Phase 4". That line is now false — the plan's Open Question 1 says to fix it **after** this ships.
- Balance eligibility is `>= 0`; the real negative-balance threshold is a product decision for #12's ledger.
