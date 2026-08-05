# Implementation Report — API drivers slice (profile/vehicle CRUD, presence, location ingestion)

**Plan**: `.claude/plans/api-drivers-slice.md` · **Branch**: `feature/api-drivers-slice` · **Status**: COMPLETE

## Summary

Built `services/api/src/features/drivers/` as one vertical slice covering three concerns: driver profile +
vehicle CRUD in Postgres, an online/offline presence toggle written to both stores, and a Redis-GEO location
hot path fed by the API's first inbound socket handler. The location half sits behind a `DRIVER_LOCATION_STORE`
port with an ioredis GEO implementation and an in-memory fake, which is what makes "a ping never touches
Postgres" (AC #2) an executable assertion rather than a prose claim. Presence is gated in Lua so an offline
driver's straggler ping cannot silently re-add them to the dispatchable set.

## Tasks completed

| Task | File | Action |
|---|---|---|
| 1 | `packages/shared/src/enums.ts` | UPDATE — `DRIVER_PRESENCE_STATUSES` |
| 2 | `packages/shared/src/schemas/driver.ts` | UPDATE — `driverProfileUpdateSchema`, `driverStatusUpdateSchema`, `driverMeSchema` |
| 3 | `packages/shared/src/schemas/vehicle.ts` | UPDATE — `vehicleCreateSchema`, `vehicleUpdateSchema` |
| 4 | `packages/shared/tests/driver.test.ts` | UPDATE — 11 new cases (`src/index.ts` needed no edit, as the plan predicted) |
| 5 | `services/api/src/features/realtime/index.ts` | UPDATE — `export type { AuthedSocket, RealtimeServer }` |
| 5b | gateway skeleton + module + `app.module.ts` + spec | **SPIKE — passed**, see below |
| 6 | `drivers/location/driver-location.policy.ts` | CREATE |
| 7 | `drivers/location/driver-location.store.ts` | CREATE — port, token, `NearbyDriver` |
| 8 | `drivers/location/redis-driver-location.store.ts` | CREATE — GEO impl + Lua `record` |
| 9 | `drivers/drivers.repository.ts` | CREATE — + `DriverMatchAttributes` |
| 10 | `drivers/vehicles.repository.ts` | CREATE |
| 11 | `drivers/drivers.service.ts`, `drivers/vehicles.service.ts` | CREATE |
| 12 | `drivers/drivers.controller.ts`, `drivers/vehicles.controller.ts` | CREATE |
| 13 | `drivers/location/driver-location.service.ts` | CREATE |
| 14 | `drivers/location/driver-location.gateway.ts` | COMPLETE — real ingest handler |
| 15 | `drivers/drivers.module.ts`, `drivers/index.ts` | COMPLETE |
| 16 | `test/harness.ts`, `test/driver-location-store.contract.ts` | UPDATE / CREATE |
| 17 | three location specs (+ one extra, see deviations) | CREATE |
| 18 | `drivers/drivers.integration.spec.ts` | CREATE |
| 19 | `.claude/references/realtime-events.md`, `services/api/CLAUDE.md` | UPDATE |
| 20 | full gate | RUN |

### Task 5b — the spike, and its stop condition

Evaluated, not skipped. An options-less `@WebSocketGateway()` in the drivers slice **does** reuse
`RealtimeGateway`'s server and its JWT handshake middleware: the standing regression case
`refuses an unauthenticated handshake on the shared server (failure)` passes, and an authenticated driver's
ping reached the handler with `client.data.user.sub` equal to the JWT subject. The stop condition (fold the
handler into `RealtimeGateway`) was not triggered, so Tasks 13–15 proceeded as planned. Confirmed again at
boot: `DriverLocationGateway subscribed to the "driver:location" message` appears **exactly once**.

## Tests added

**`packages/shared/tests/driver.test.ts`** (+11 cases): profile-update allowlist strips
`commissionPctOverride`/`balanceCents`/`rating`/`fleetId`/`status`; empty patch and empty language list
rejected; `on_ride` rejected at the contract; vehicle-create defaults + `driverId`/`id` stripped; the
`.partial()`-over-`.default()` gotcha asserted; `driverMeSchema` round trip.

**`test/driver-location-store.contract.ts`** — one fixture, six cases, run by **both** store implementations:
nearest-first ordering (built so a lat/lng transposition inverts the answer), centre round trip, offline
exclusion, staleness exclusion, online-but-never-pinged excluded, and `record()` refused for a driver never
marked online.

| Spec | Level | Cases |
|---|---|---|
| `location/driver-location.store.spec.ts` | fake | the 6 contract cases |
| `location/redis-driver-location.store.spec.ts` | opt-in real Redis | the same 6 |
| `location/driver-location.service.spec.ts` | unit | 7 — incl. `never touches Postgres on the ping path (expected — AC 2)` |
| `location/driver-location.gateway.spec.ts` | socket | 4 — unauth refused, dispatch fan-out, rider ignored, malformed ignored |
| `drivers.integration.spec.ts` | HTTP + Postgres | 14 — all seven routes, the `on_ride` 409, and `findMatchAttributes` |

## Validation results

| Gate | Result |
|---|---|
| `pnpm --filter @taxi/shared typecheck && build` | pass (no import cycle from `driverMeSchema` → `./vehicle`) |
| `pnpm --filter @taxi/shared test` | **96 passed** (8 files) |
| `pnpm --filter @taxi/api typecheck` / `lint` | pass — 0 errors; 2 warnings, both the pre-existing `request(app.getHttpServer())` `no-unsafe-argument` pattern |
| `pnpm turbo run test --filter @taxi/api` | **71 passed, 11 skipped** (13 suites) |
| `REDIS_TEST_URL=… pnpm turbo run test --filter @taxi/api` | **82 passed, 0 skipped** — real `GEOADD`/`GEOSEARCH`/Lua green |
| `pnpm check` | pass (15/15) |
| `pnpm turbo run typecheck lint test build --force` (cold `dist`) | pass (18/18) — CI parity |

### The transposition detector, verified by mutation

The fixture's central claim was checked rather than assumed: lat/lng were swapped **consistently on both the
write and the read path** of `RedisDriverLocationStore` (the failure mode a round-trip test cannot see), and
the real-Redis contract run was re-executed. Exactly one case failed —
`returns the in-radius drivers nearest first (expected — and detects a lat/lng transposition)` — with the other
five still passing, which is precisely the design. Mutation reverted; suite re-run green (78/78).

### Level 5 (live server) — all verified by hand

`/health` 200 (AC #3) · gateway subscribed **once** · `GET /drivers/me` provisions the row with defaults ·
`online` with no vehicle → 409 `vehicle_required` · vehicle created → `online` 200 · `on_ride` → 400 ·
socket ping → `drivers:geo:<city>` gains the driver and **`GEOPOS` returns lng 24.1136 / lat 56.9512, in the
right order** · `drivers:seen:<city>` carries a server-stamped ms score · the `drivers` row is **byte-identical
across the ping** (AC #2 by hand) · `offline` clears all three keys · a straggler ping while offline writes
nothing and leaves the socket connected.

## Deviations from the plan

1. **`DriversService.updateProfile` provisions the row first** (plan said "repo passthrough"). A driver whose
   first-ever call is `PATCH /drivers/me` has no `drivers` row, so the bare UPDATE matches nothing and the
   repository's `row!` would 500 on a valid request. Now `findOrCreate` → update, matching every other write
   path in the slice.
2. **One extra spec file, `location/driver-location.store.spec.ts`.** Task 16 requires both implementations to
   run the shared contract, but Task 17's file list only wires it to the Redis store — the fake would never
   have run it, and the whole suite trusts that fake. Twelve lines.
3. **The contract helper takes an options object** — `(name, makeStore, { cityId?, cleanup? })` instead of
   `(name, makeStore, cleanup?)`. The Redis spec needs a per-`pid` city namespace, since jest workers share one
   Redis and these keys are not namespaced.
4. **The spike's throwaway recording array was removed in Task 14**, as planned; its `@MessageBody()` parameter
   was dropped for the duration of the spike only, because an unused parameter is a lint error here.
5. **`services/api/CLAUDE.md` slice list**: `vehicles` was removed from the menu rather than annotated in place,
   with the reason stated on the following line — the plan asked for the drift to be recorded, and leaving the
   word in a list of slice folders would keep inviting the split it argues against.

6. **Four integration cases beyond the plan's list**, added after a review pass found two branches that the
   plan's own Edge Cases (#9 and #14) name but whose file list never wired a test to:
   - `findMatchAttributes` — #10's entry point, exported from the barrel, and until now **never executed**.
     Three cases: cross-vehicle aggregation (categories deduped, `hasChildSeat` from ANY vehicle,
     `maxPassengerSeats` from the widest), a driver who owns no vehicle still returning a row with empty
     categories (the `leftJoin` null branch), and `[]` for an empty id list.
   - The `driver_on_ride` 409. Integration case 7 covers the *contract* rejection of `status: 'on_ride'` in a
     request body; this covers the different branch where the stored row is already `on_ride`. `on_ride` is set
     directly through Drizzle, since by design no route can write it.

Everything else — including the `findNearby` body, the Lua script, the fixture offsets and the ordering of the
two stores in `setPresence` — is as specified.

## Issues encountered

1. **`localhost:5432` is not the docker Postgres on this machine.** A brew Postgres owns `127.0.0.1:5432` and
   `::1:5432`, and an ssh tunnel holds `*:5432`; the docker container is only reachable on the LAN IP. The jest
   suite is unaffected (it inherits a working `DATABASE_URL` from the shell), but the Level-5 walkthrough
   initially 500'd with `role "taxi" does not exist` until pointed at `192.168.1.11:5432`. This is the known
   local-ports issue, not a code defect.
2. **Absence assertions over an async socket handler** — the plan's flagged 0.5 risk. Resolved without a sleep:
   both rejection paths (`not_a_driver`, `malformed_payload`) return *before* any `await`, so a second, valid
   ping on the same socket that lands in `recorded` proves the first was already handled. The malformed case
   uses exactly that; the rider case emits the bad ping first and waits on a driver ping.
3. No migration was added and no `ride_tracks` table was created, per the plan's Non-Goals (#11 owns both).

## Ready for the next step

`piv-commit` → `piv-create-pr` → `piv-review-pr`.
