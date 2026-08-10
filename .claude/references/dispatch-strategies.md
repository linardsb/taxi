# Dispatch strategies (reference)

**Source of truth: `packages/shared/src/seams/dispatch-strategy.ts`.** Mode selected per geozone (`geozone.queueModeEnabled`), falling back to the city default.

## auto_match (default)
Bolt-style offer cascade: rank candidates by ETA from Redis GEO radius query, filter by category + options (childSeat via vehicle, femaleDriver via profile) + debt-limit check, offer to the best candidate with an expiry, on decline/timeout re-offer to the next (ride returns `offered → requested` in the machine).

**The debt check is a LIMIT, not a positive balance** (#12). A driver is dropped only at `balanceCents < -driverDebtLimitCents` (`platform_config.driver_debt_limit_cents`, €50 seeded), never at zero: a cash-only driver is permanently negative by design, so a hard zero would strand them after their first ride. The limit travels on `DispatchContext` — **strategies never read config themselves**.

**One live card per driver, platform-wide** (#61): a candidate already holding a pending unexpired offer on any ride is skipped this round — a skip is a wait, not a ban.

## geozone_queue ("izsaukumi rindas kārtībā")
Airport-rank fairness: drivers join a per-geozone FIFO queue when entering the zone online; the ride goes to the queue head (`queued → offered`); declining sends the driver to the back. Queue state lives in Redis lists.

## Dispatcher override (NOT a strategy)
Privileged commands available under both modes, used from the dispatch portal: `assign(rideId, driverId)`, `reassign`, `cancel`. They bypass candidate selection but still go through `assertTransition()` — never bypass the state machine.

## Phase notes
Both strategies shipped together in #10, ahead of the original plan (which held geozone_queue back to Phase 4, decision 2026-07-06) — S7-2 made queue fairness a launch concern, not a later one. Keep the seam honest: the engine must never import a concrete strategy directly.
