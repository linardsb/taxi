# Dispatch strategies (reference)

**Source of truth: `packages/shared/src/seams/dispatch-strategy.ts`.** Mode selected per geozone (`geozone.queueModeEnabled`), falling back to the city default.

## auto_match (default)
Bolt-style offer cascade: rank candidates by ETA from Redis GEO radius query, filter by category + options (childSeat via vehicle, femaleDriver via profile) + positive-balance check, offer to the best candidate with an expiry, on decline/timeout re-offer to the next (ride returns `offered → requested` in the machine).

## geozone_queue ("izsaukumi rindas kārtībā")
Airport-rank fairness: drivers join a per-geozone FIFO queue when entering the zone online; the ride goes to the queue head (`queued → offered`); declining sends the driver to the back. Queue state lives in Redis lists.

## Dispatcher override (NOT a strategy)
Privileged commands available under both modes, used from the dispatch portal: `assign(rideId, driverId)`, `reassign`, `cancel`. They bypass candidate selection but still go through `assertTransition()` — never bypass the state machine.

## Phase notes
Phase 1 ships auto_match only; geozone_queue lands Phase 4 (decision 2026-07-06). Keep the seam honest: the engine must never import a concrete strategy directly.
