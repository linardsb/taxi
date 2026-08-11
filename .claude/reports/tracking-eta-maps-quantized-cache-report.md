# Implementation Report — Maps-based ETA for the tracking page (quantized cache)

**Plan**: `.claude/plans/tracking-eta-maps-quantized-cache.md`
**Branch**: `feature/tracking-eta-maps-quantized-cache` (built in a worktree — see Deviations)
**Status**: COMPLETE

## Summary

The no-login tracking page's ETA now comes from `MAPS_PROVIDER.route()` instead of
straight-line metres ÷ 417. The driver's position is snapped to a 3-decimal grid
(~111 m × ~61 m at Rīga's latitude) **before** the seam call, so every raw position
inside a cell renders the same `routeCacheKey` text and the page's 5 s poll rides the
existing `CachingMapsProvider` cache — a paid call happens when the driver crosses a
cell, not when a page refreshes. The displayed `position` stays raw, the haversine
estimate survives as the maps-outage fallback, and the assigned-SMS ETA is untouched.

## Tasks completed

- Policy: grid constant + `quantizeForEtaCache` + `etaMinutesFromRoute`; the speed
  constant's docblock rewritten from "upgrade path, later ticket" to "the fallback"
  → `services/api/src/features/notifications/notifications.policy.ts` (UPDATE)
- Unit spec for the two new pure helpers
  → `services/api/src/features/notifications/notifications.policy.spec.ts` (CREATE)
- Harness: `CountingMapsProvider.failNext()`, self-clearing, with the cache-sits-above
  caveat in its docblock → `services/api/test/harness.ts` (UPDATE)
- Service: `@Inject(MAPS_PROVIDER)`, ETA via a new private `roadEta()` with try/catch
  fallback + structured warn
  → `services/api/src/features/notifications/tracking/tracking.service.ts` (UPDATE)
- Module: `GeoModule` imported, docblock inventory extended
  → `services/api/src/features/notifications/notifications.module.ts` (UPDATE)
- Geo barrel: injector inventory now names the tracking page
  → `services/api/src/features/geo/index.ts` (UPDATE)
- Three integration cases + two local ETA calculators + `acceptedRide`/`moveDriver`
  helpers → `.../tracking/tracking.integration.spec.ts` (UPDATE)

## Tests added

`notifications.policy.spec.ts` — 6 cases, no Nest boot:

- `quantizeForEtaCache`: snaps a raw fix (expected) · a point already on the grid is
  unchanged (edge) · two fixes ~20 m apart collapse to one point (edge — the property
  the cache rides on)
- `etaMinutesFromRoute`: 300 s → 5 (expected) · 90 s → 2, rounds up (edge) · 0 s → 1,
  never "~0 min" (failure)

`tracking.integration.spec.ts` — 3 cases on the real Nest graph, real
`CachingMapsProvider` over the counted fake:

- **expected (AC #1)** — the seam is called exactly once, `from` deep-equals the
  3-decimal point, `to` is the untouched pickup, and `etaMinutes` equals the stub's
  documented road maths — asserted `not.toBe` the straight-line value, so it cannot
  pass for the wrong reason (they agree at short range, hence the ~5.6 km geometry).
- **edge (AC #2)** — a ~22 m move between polls adds **zero** source calls while
  `position.lat` still reports the new raw coordinate (`toBeCloseTo(…, 4)`, which a
  quantized display fails); a ~111 m move adds exactly one. Counts read as deltas only.
- **failure (AC #3)** — `failNext()` on a never-routed cell: page still 200, state
  intact, ETA equals the haversine fallback (and differs from the maps value), and the
  `ride.notifications.track_eta_fallback` warn carries exactly
  `at, driverId, event, message, rideId` — no coordinate can hide in it.

**Mutation check** (not required by the plan): with `quantizeForEtaCache` stubbed to a
no-op, 2 unit cases and 2 integration cases fail; reverting makes them pass. The new
tests are load-bearing, not decorative.

## Validation results

| Command | Result |
|---|---|
| `pnpm --filter @taxi/api typecheck` | pass |
| `pnpm --filter @taxi/api lint` | pass — 0 errors, 7 warnings (all pre-existing `getHttpServer()` ones) |
| `pnpm --filter @taxi/api test notifications.policy` | 6/6 pass |
| `pnpm --filter @taxi/api test tracking.integration` | 9/9 pass (6 pre-existing + 3 new) |
| `pnpm turbo run typecheck lint test build --force` | **green** — 20/20 tasks; api 418/418 in 51 suites, plus `@taxi/shared` and `@taxi/db` |

Run with `DATABASE_URL` on the LAN IP and `REDIS_TEST_URL=…:6381`: both Redis-backed
suites report `PASS`, not `describe.skip`, so the gate is genuinely at CI parity and
not five tests short. Nothing is skipped in the totals.

The first gate attempt failed with 32 `users_phone_unique` duplicates across six auth /
lifecycle suites — a concurrent session's jest run sharing `taxi_api_test`, not this
code. Re-run with no competing jest process: clean.

## Deviations from the plan

1. **Built in a git worktree** (`/Users/Berzins/Desktop/taxi-tracking-eta`), not the
   main checkout. Two other sessions were live in `~/Desktop/taxi` while this ticket
   started — the Twilio ticket holds uncommitted changes to `notifications.module.ts`,
   which this ticket also edits. The user chose isolation when asked.
2. **Branch repair, worth reading before reviewing history.** Creating this ticket's
   branch in the shared checkout put HEAD on it seconds before the vehicle-stamp
   session committed, so `feat(api): stamp rides.vehicle_id … (#86)` landed on this
   branch. It was moved to `feature/api-ride-vehicle-stamp` (fast-forward, nothing
   lost) and this branch reset to `main` (80bd98c). This branch contains only #87 work.
3. **Fallback-warn assertion shape.** The plan's exact-payload assertion via
   `toHaveBeenCalledWith({… message: expect.any(String)})` is a lint **error** here —
   `expect.any()` is `any`-typed and trips `no-unsafe-assignment` inside an object
   literal. Replaced with a sorted `Object.keys()` equality plus `toMatchObject`, which
   pins the same thing (the whole key set) and type-checks.
4. **Two spec helpers the plan did not list**: `acceptedRide()` (the three new cases
   share one book-and-accept setup) and `moveDriver()`, which asserts
   `locations.record()` returned `true` — the in-memory store answers `false` for a
   driver it thinks is offline and silently keeps the OLD position, which would surface
   three assertions later as an ETA nobody can explain.
5. **`imports: [DriversModule, GeoModule, PlatformConfigModule]`** — alphabetical, as
   the file already was, rather than the plan's literal append-at-the-end.

## Issues encountered

- **Shared-checkout collisions** (see Deviations 1–2). Three tickets were being built in
  one working directory; everything is isolated now — Twilio holds `~/Desktop/taxi`,
  vehicle-stamp has its own worktree, this ticket has `~/Desktop/taxi-tracking-eta`.
- **`localhost:5432` is the brew Postgres**, not the docker one (no `taxi` role); the
  docker instance answers on the LAN IP. Test runs use `DATABASE_URL` on that address.
- **`pretest` from a worktree would start a second compose stack** — compose derives its
  project name from the directory, so `taxi-tracking-eta` would try to bind a taken
  5432. Every run here sets `COMPOSE_PROJECT_NAME=taxi`, which reuses the healthy
  container (verified with `--dry-run`).
- **Shared `taxi_api_test` database.** `globalSetup` drops and recreates it, so two
  sessions running api tests at the same moment can flake each other. Nothing in this
  ticket changes that; worth knowing if a rerun looks inexplicable.

## Follow-ups (not in scope, for the review to log)

- **The seam has no timeout.** Once #13/#16 binds a real provider, a hung Routes call
  hangs a public, unauthenticated page; the fallback only covers a *rejected* promise.
- **The warn logs `error.message` verbatim.** The stub's message is inert, but a real
  provider could echo the origin coordinates into a log line the standard forbids.
  Both belong to the real-provider ticket, next to the plan's TTL-staleness question.
- The assigned-SMS ETA (`etaToPickup`) still uses the haversine estimate, as scoped.
