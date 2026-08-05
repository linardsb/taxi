# Feature: API drivers slice — profile/vehicle CRUD, online/offline presence, location ingestion (Redis GEO)

The following plan should be complete, but it's important that you validate documentation and codebase patterns and
task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files etc. In particular:
`@taxi/shared` is the ONLY source of cross-surface contracts, `@taxi/db` is the ONLY source of tables, and the
realtime slice's `RealtimeService` is the ONLY way to emit a socket event.

## Feature Description

Everything the platform knows about a driver, and the hot path that keeps knowing where they are.

Three concerns in one vertical slice (`services/api/src/features/drivers/`):

1. **Profile + vehicle CRUD** — a driver reads and edits their own profile (spoken languages, female-driver flag)
   and their own vehicles (plate, make/model/year, category, seats, child seat). These attributes are not
   decoration: `isFemale` and `hasChildSeat` are exactly what #17's rider filters select on and what #10's
   auto-match filters by.
2. **Online/offline presence** — a driver toggles availability. The durable answer lives in Postgres
   (`drivers.status`); the dispatchable answer lives in Redis, because dispatch must never ask Postgres
   "who is available" on the hot path.
3. **Location ingestion** — the driver app emits `driver:location` over the already-authenticated socket; the
   server stamps identity from the JWT, writes the position to a **Redis GEO set**, and fans the position out to
   Dina's dispatch board. Plus the nearest-driver query #10's `auto_match` strategy will call.

The load-bearing constraint is the third one: **a location ping never touches Postgres.** With ~10 drivers pinging
every few seconds that is thousands of writes an hour against a database that has a €100/mo budget guardrail over
it, and the positions are worthless the moment they are superseded. Redis GEO is the right store precisely because
the data is ephemeral.

## User Story

As a **Sakta Cab driver** (Atis)
I want to **register my car, say what I can offer, and flip myself online so the platform can see where I am**
So that **rides come to me when I am working and stop when I am not — without me being tracked while I am off shift.**

And, one layer down:

As the **dispatch engine** (#10) and **Dina's console** (#18)
I want to **ask "who is near this pickup, right now" and get an ordered answer in milliseconds**
So that **a rider gets matched before they give up and open Bolt.**

## Problem Statement

After #7 the API knows *who* a user is (phone → OTP → JWT → role) and has an authenticated socket per user. It knows
nothing about drivers as drivers:

- There is no `drivers` row for a user who signed up with `role: 'driver'` — `AuthRepository.findOrCreate` writes
  `users` and stops. The `drivers` and `vehicles` tables exist (#6) and are empty forever.
- `RealtimeGateway` has **zero** inbound handlers by deliberate design (`realtime.gateway.ts:40-44`: "#8 adds the
  first one"). Nothing can receive a location ping.
- There is no notion of a driver being available. `drivers.status` defaults to `'offline'` and nothing ever writes it.
- There is no way to answer "nearest driver to this point", which is the single query the entire dispatch engine
  (#10) is built on top of.

Every downstream ticket is blocked on this: #10 (matching), #14 (driver app online toggle + location streaming),
#18 (Dina's live driver map), #20 (admin driver approval), #17 (rider filters read attributes that live here).

## Solution Statement

One vertical slice, `services/api/src/features/drivers/`, with a hard split between the two storage worlds:

| Concern | Store | Why |
|---|---|---|
| Profile, vehicles, `status` | Postgres (`@taxi/db`) | Durable, queried, joined, admin-visible |
| Presence set, live position, last-seen | Redis | Ephemeral, hot path, rebuilt from the next ping |

The Redis half sits behind a **port** — `DriverLocationStore`, a DI token with an ioredis GEO implementation and an
in-memory fake in the test harness. This mirrors `common/kv/kv.store.ts` exactly ("a port, not an abstraction
layer"), and it is what makes AC #2 provable rather than aspirational: the whole ingest path can be booted with a
`DRIZZLE` provider that throws on any property access, and it still works.

Presence is authoritative in Redis for the ingest path: `record()` is a Lua script that **refuses to write a
position for a driver who is not in the online set**. Without that, an offline driver's straggler ping silently
re-adds them to the GEO set and dispatch offers them a ride — the exact failure AC #1's "excludes offline drivers"
case is guarding.

Freshness is a read-time filter, not a background reaper: positions carry a server-stamped `lastSeenAt` in a
companion ZSET, and `findNearby` drops anything older than `DRIVER_LOCATION_TTL_SECONDS`. A driver whose phone
lost signal disappears from dispatch in 60 seconds without any cron job, and without us flipping their durable
status on a network blip.

## Out of Scope / Non-Goals

- **Recorded trip tracks in Postgres.** Issue #8's scope line ("recorded trip tracks go to Postgres only during an
  active ride") is read as a *constraint on where tracks belong*, not a deliverable in this ticket — **decided with
  Linards, 2026-08-05**. There is no `ride_tracks` table, no ride can exist yet (#9/#11 aren't built), and none of
  the ACs test it. A recording hook here would be dead code with a synthetic test. **#11 owns the table, the
  migration, and the hook.** Do not add a migration in this ticket.
- **Not adding** a `vehicles` sibling slice. `services/api/CLAUDE.md` lists `vehicles` in its slice menu; this
  ticket keeps vehicles inside `features/drivers/` (decided with Linards, 2026-08-05) — a vehicle belongs to a
  driver, its FK is `drivers.user_id`, and splitting would force a cross-slice import for #10's child-seat filter.
  Task 16 records the drift in `services/api/CLAUDE.md`.
- **No ETA computation.** `DriverCandidate.etaSeconds` (shared seam) needs the maps seam; `findNearest` returns
  `distanceMeters` and #10/#9 convert. Do not import a maps SDK here.
- **No eligibility filtering inside the nearest query.** Category / child-seat / female-driver / positive-balance
  filtering is `auto_match`'s job (`.claude/references/dispatch-strategies.md`). This slice exposes the raw
  proximity list *and* a bulk attribute lookup; #10 composes them.
- **No geozone queue.** `geozone_queue` and `driver:queue` land in #10 (Phase 4 per dispatch-strategies.md). Do not
  emit `RT.driverQueue` here.
- **No `dispatch:board` snapshot event.** #18 owns the board's real shape; `dispatchBoardEventSchema` stays the thin
  placeholder it is. This slice emits `driver:location` to the dispatch room and nothing else.
- **No client-side ping throttling** and no server-side rate limiter on `driver:location`. Movement throttling is
  #14's job in the driver app. At pilot scale (≤10 drivers) a server limiter is unjustified complexity — see NOTES.
- **No admin/dispatcher-facing driver endpoints.** `GET /drivers/:id`, approval, listing → #20. Routes here are
  driver-self only; #10/#18 consume the slice through its `index.ts` service API, in-process.
- **Not changing** `RealtimeGateway`, `room-policy.ts`, or the "no client-initiated join API" rule. The per-driver
  room already exists — `roomsOnConnect` joins `driverRoom(sub)` for role `driver` (`room-policy.ts:29-38`). The
  only realtime edit is exporting the `AuthedSocket` type.
- **No `heading` persistence.** It is passed through to the emitted event and not stored.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium-High (three concerns, a new storage primitive, a second gateway)
**Primary Systems Affected**: `services/api` (new `drivers` slice, one realtime export), `packages/shared` (request
contracts), `services/api/test/harness.ts` (new fake + override)
**Dependencies**: no new packages — `ioredis@^5.11.1`, `socket.io`, `drizzle-orm`, `zod` are all already direct
dependencies of `@taxi/api`. Redis ≥ 6.2 is required for `GEOSEARCH`; `docker-compose.yml` pins `redis:7-alpine`. ✅

## Related Work

**Implements**: [issue #8](https://github.com/linardsb/taxi/issues/8) · **Epic**: [#1](https://github.com/linardsb/taxi/issues/1)
(`docs/epics/sakta-cab.architecture.md` + `docs/build-playbook.md` slice 2.3)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/shared-contracts-ride-loop.md` — #2. Owns `driverProfileSchema`, `vehicleSchema`,
  `driverLocationPingSchema` / `driverLocationEventSchema`, `RT`, `DriverCandidate`. **Inherit; do not redecide.**
- `.claude/plans/db-foundation-drizzle-postgis.md` — #6. Owns `drivers` / `vehicles` / `geozones` tables and the
  Rīga seed. **No migration in this ticket.**
- `.claude/plans/api-auth-realtime-gateway.md` — #7. Owns the guard stack, the socket handshake, `RealtimeService`,
  the KV port, and the jest harness. Every pattern this plan cites comes from there.
- `.claude/reports/api-auth-realtime-gateway-report.md` — read "Deviations" and "Issues"; the stale-`dist` and
  `pnpm check` ≠ CI-parity lessons apply verbatim here.

**Forward-references**:

- #10 (dispatch engine) — consumes `DriverLocationService.findNearest()` + `DriversService.findMatchAttributes()`.
- #14 (driver app) — consumes every REST route below and emits `driver:location`.
- #11 (ride lifecycle) — owns `status: 'on_ride'` writes and the deferred `ride_tracks` table.
- #18 (dispatch console) — consumes the `driver:location` fan-out to `dispatch:<cityId>`.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**The contracts you must not restate (`packages/shared`)**

- `packages/shared/src/schemas/driver.ts` (whole file, 27 lines) — `driverProfileSchema`. Note `commissionPctOverride`
  and `balanceCents` are on it: they are readable by the driver, **never writable by them**.
- `packages/shared/src/schemas/vehicle.ts` (whole file, 15 lines) — `vehicleSchema`. `hasChildSeat` is the VEHICLE
  attribute; `isFemale` is the DRIVER attribute. Do not move either.
- `packages/shared/src/realtime-events.ts` (lines 33-51) — `driverLocationPingSchema` (inbound, **no `driverId` on
  purpose — read the docblock**) and `driverLocationEventSchema` (outbound, `.extend({driverId})`). Lines 178-199:
  `ClientToServerEvents` types the inbound payload as `unknown` deliberately. Lines 212-230: `RT_EVENT_SCHEMAS`.
- `packages/shared/src/enums.ts` (lines 19-20) — `DRIVER_STATUSES = ["offline","online","on_ride"]`. Lines 4-5 —
  `LANGUAGES`. Lines 7-8 — `RIDE_CATEGORIES`.
- `packages/shared/src/schemas/geo.ts` (lines 3-7) — `latLngSchema` / `LatLng`, the only lat/lng type.
- `packages/shared/src/seams/dispatch-strategy.ts` (whole file) — `DriverCandidate` / `DispatchContext`. This is
  what #10 wants; shape `findNearest`'s return so #10 can build a `DriverCandidate` from it without a translation
  layer, but do **not** implement `DispatchStrategy` here.

**The database (`@taxi/db`)**

- `db/src/schema/drivers.ts` (whole file, 21 lines) — PK is `userId`, "a driver IS a user". FK → `users.id`.
- `db/src/schema/vehicles.ts` (whole file, 18 lines) — FK `driverId` → `drivers.userId`. **A vehicle cannot be
  inserted before the `drivers` row exists.**
- `db/src/index.ts` — the export surface. `drivers`, `vehicles`, `users`, `createDb`, `Db`, `RIGA_CITY_ID`.

**The patterns you are mirroring (`services/api`)**

- `services/api/src/features/auth/auth.repository.ts` (whole file, 57 lines) — **the** repository pattern:
  `@Inject(DRIZZLE) db: Db`, a `toDomain(row)` mapper for nullable columns, and race-safe find-or-create via
  `.onConflictDoUpdate({ target, set: <no-op> }).returning()`. Read the docblock at lines 35-45 — the deliberate
  column omission *is* the privilege-escalation defence. You are copying that idea for profile updates.
- `services/api/src/features/auth/auth.controller.ts` (whole file, 37 lines) — `@Body(new ZodValidationPipe(schema))`,
  `@HttpCode(200)` on non-creating POSTs, thin controller delegating to a service.
- `services/api/src/features/auth/auth.module.ts` (whole file) — module shape; `exports` is the slice's DI contract.
- `services/api/src/features/auth/index.ts` (whole file, 9 lines) — barrel = the slice's public API.
- `services/api/src/features/auth/otp.policy.ts` (whole file) — **constants-not-env** for policy numbers, with the
  rationale in the docblock. `driver-location.policy.ts` copies this exactly.
- `services/api/src/features/auth/auth.service.ts` (lines 34-62 and 94-137) — the Redis key-naming convention
  (`domain:purpose:<id>`) and the "claim atomically, never read-then-write" reasoning. Your Lua script follows it.
- `services/api/src/common/kv/kv.store.ts` (whole file, 17 lines) — the port docblock to imitate for
  `DriverLocationStore`.
- `services/api/src/common/kv/redis-kv.store.ts` (lines 29-57) — how a Lua script is embedded as a
  `private static readonly` string and run with `redis.eval(SCRIPT, numKeys, ...keys, ...argv)`. Lines 64-75 —
  `onModuleDestroy` with the `quit()`-then-`disconnect()` fallback. **Copy both.**
- `services/api/src/common/kv/kv.module.ts` (whole file) — `useFactory` + `inject: [APP_ENV]` for a Redis-backed
  provider bound to a string token.
- `services/api/src/features/realtime/realtime.gateway.ts` (lines 18-33 and 40-44) — `AuthedSocket` /
  `RealtimeServer` types, and the comment that names this ticket as the one adding the first
  `@SubscribeMessage`. Line 84: `client.data.user` is where the handshake put the claims.
- `services/api/src/features/realtime/realtime.service.ts` (whole file, 76 lines) — `emitToDispatch(cityId, event,
  payload)` is your only fan-out route. Note `emit()` **parses before it sends** (line 68).
- `services/api/src/features/realtime/room-policy.ts` (lines 29-38) — proof the per-driver room already exists.
- `services/api/src/features/auth/guards/jwt-auth.guard.ts` (lines 20-30) — the WS branch throws
  `unsupported_context`, which is **why** your `@SubscribeMessage` handler must authorize from
  `client.data.user` and never rely on the global guard.
- `services/api/src/common/config/env.schema.ts` (whole file) — `APP_ENV`, `Env`, `DEFAULT_CITY_ID`.
- `services/api/src/app.module.ts` (whole file) — where `DriversModule` gets registered.

**Tests**

- `services/api/test/harness.ts` (whole file, ~180 lines) — `createTestApp()` boots the real `AppModule` with
  exactly two providers overridden. You add a third. Read `InMemoryKeyValueStore` (lines 12-75) as the template for
  `InMemoryDriverLocationStore`, including the `advance()` virtual clock idea. `phoneFor()` (lines ~150) — **each
  spec file must use its own E.164 prefix**; the DB is not reset between specs.
- `services/api/src/features/auth/auth.integration.spec.ts` (whole file, 200 lines) — the HTTP integration shape:
  a test-only `ProbeController`, a `signIn()` helper, `afterAll(() => ctx.app.close())`, and test titles that
  literally end in `(expected)` / `(edge)` / `(failure)`. **Match that naming — the 1+1+1 rule is graded off it.**
- `services/api/src/features/realtime/realtime.gateway.spec.ts` (whole file, 131 lines) — socket-level testing:
  `app.listen(0)`, read the port off `getHttpServer().address()`, `connectClient(port, token)`,
  `afterEach(closeClients)` **before** `afterAll(app.close())` or jest hangs.
- `services/api/src/common/kv/redis-kv.store.spec.ts` (whole file, 56 lines) — **the opt-in real-Redis pattern**:
  `const describeWithRedis = process.env.REDIS_TEST_URL ? describe : describe.skip`, keys namespaced by
  `process.pid`. Copy verbatim for the GEO store.
- `services/api/test/global-setup.ts` (lines 1-30) — the stale-`dist` guard. If you add a shared export and run
  `pnpm --filter @taxi/api test` directly, it fails with the fix in the message. Use `pnpm turbo run test --filter
  @taxi/api`.
- `packages/shared/tests/driver.test.ts` (whole file) — vitest style for the shared package; note the comments
  explaining *why* each case exists.

### New Files to Create

```
packages/shared/src/schemas/driver.ts          UPDATE  + driverProfileUpdateSchema, driverStatusUpdateSchema, driverMeSchema
packages/shared/src/schemas/vehicle.ts         UPDATE  + vehicleCreateSchema, vehicleUpdateSchema
packages/shared/src/enums.ts                   UPDATE  + DRIVER_PRESENCE_STATUSES
packages/shared/tests/driver.test.ts           UPDATE  + cases for the four new schemas
packages/shared/tests/schemas.test.ts          UPDATE  + vehicle create/update cases (if the vehicle cases live there)

services/api/src/features/realtime/index.ts    UPDATE  + export type { AuthedSocket }

services/api/src/features/drivers/
  index.ts                                     CREATE  slice public API
  drivers.module.ts                            CREATE
  drivers.controller.ts                        CREATE  GET/PATCH /drivers/me, PUT /drivers/me/status
  drivers.service.ts                           CREATE  profile read/update + presence transitions
  drivers.repository.ts                        CREATE  drivers table + match-attribute join
  vehicles.controller.ts                       CREATE  /drivers/me/vehicles CRUD
  vehicles.service.ts                          CREATE  ownership rules + last-vehicle rule
  vehicles.repository.ts                       CREATE  vehicles table
  location/driver-location.policy.ts           CREATE  TTL / radius / limit constants
  location/driver-location.store.ts            CREATE  port + DI token + NearbyDriver
  location/redis-driver-location.store.ts      CREATE  ioredis GEO implementation
  location/driver-location.service.ts          CREATE  ingest + findNearest
  location/driver-location.gateway.ts          CREATE  @SubscribeMessage(RT.driverLocation)
  drivers.integration.spec.ts                  CREATE  HTTP + Postgres
  location/driver-location.service.spec.ts     CREATE  unit — ingest, Redis-only proof, nearest ordering
  location/driver-location.gateway.spec.ts     CREATE  socket-level
  location/redis-driver-location.store.spec.ts CREATE  opt-in, real Redis

services/api/test/harness.ts                   UPDATE  + InMemoryDriverLocationStore + override + haversineMeters
services/api/test/driver-location-store.contract.ts  CREATE  one fixture, run by both store impls
services/api/src/app.module.ts                 UPDATE  + DriversModule
services/api/CLAUDE.md                         UPDATE  drivers-slice rules + the vehicles-slice drift note
.claude/references/realtime-events.md          UPDATE  driver:location row — inbound handler now exists
```

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Redis `GEOSEARCH`](https://redis.io/docs/latest/commands/geosearch/)
  - Sections: *Syntax* (`FROMLONLAT` / `BYRADIUS` / `ASC` / `WITHCOORD` / `WITHDIST`) and *Reply*.
  - Why: this is the read half of AC #1. **Reply order matters**: with `WITHDIST` + `WITHCOORD` (and no
    `WITHHASH`) each element is `[member, distance, [longitude, latitude]]` — distance and coords come back as
    **strings**, and `BYRADIUS … m` makes the distance metres. Requires Redis ≥ 6.2 (we ship 7).
- [Redis `GEOADD`](https://redis.io/docs/latest/commands/geoadd/)
  - Section: *Syntax* — argument order is `GEOADD key longitude latitude member`. **lng before lat**, the opposite
    of how `LatLng` reads. This is the single easiest bug to write in this ticket.
- [Redis geospatial index intro](https://redis.io/docs/latest/develop/data-types/geospatial/)
  - Section: *"a sorted set under the hood"*.
  - Why: there is no `GEODEL`. Removing a driver's position is `ZREM geoKey driverId`.
- [Redis `EVAL` / scripting](https://redis.io/docs/latest/develop/interact/programmability/eval-intro/)
  - Section: *KEYS and ARGV*.
  - Why: `record()` must check presence and write the position atomically. `redis-kv.store.ts:40-57` already does
    this in-repo — follow that shape rather than inventing one.
- [ioredis API](https://github.com/redis/ioredis#readme)
  - Sections: *Pipelining*, *Transactions*, *Lua scripting*.
  - Why: `geosearch` is typed `(...args: [key: RedisKey, ...args: RedisValue[]]) => Result<unknown[]>` in
    `node_modules/ioredis/built/utils/RedisCommander.d.ts:2305-2310` — **the reply is `unknown[]` and you must
    narrow it yourself.** Under `recommendedTypeChecked` eslint, narrow with an explicit
    `as GeoSearchRow[]` and a length guard, never `any`.
- [NestJS Gateways — `@SubscribeMessage`](https://docs.nestjs.com/websockets/gateways#subscribing-to-messages)
  - Sections: *Subscribing to messages*, *Multiple gateways*.
  - Why: the drivers slice adds a **second** `@WebSocketGateway()` class. See the verified GOTCHA below.
- [NestJS custom providers](https://docs.nestjs.com/fundamentals/custom-providers#non-class-based-provider-tokens)
  - Why: `DRIVER_LOCATION_STORE` is a string token, same as `KV_STORE` / `SMS_PROVIDER` / `DRIZZLE`.
- [Drizzle — `onConflictDoUpdate`](https://orm.drizzle.team/docs/insert#on-conflict-do-update)
  - Why: the find-or-create for the `drivers` row. `onConflictDoNothing().returning()` returns `[]` on conflict —
    already learned in `auth.repository.ts:41-44`.

**In-repo references (read all three):**

- `.claude/references/realtime-events.md` — the `driver:location` row and rules 3–5. You will edit this file (Task 15).
- `.claude/references/dispatch-strategies.md` — `auto_match` explicitly says "rank candidates by ETA from Redis GEO
  radius query, filter by category + options + positive-balance check". The **query** is yours; the **filter** is #10's.
- `.claude/references/logging-standard.md` — `domain.component.action_state`. Your domain is `driver`.

### Patterns to Follow

**Slice barrel = public API** (`features/auth/index.ts`)

```ts
/** The drivers slice's public API — nothing outside imports past this file. */
export { DriversModule } from './drivers.module';
export { DriversService } from './drivers.service';
export type { DriverMatchAttributes } from './drivers.repository';
export { DriverLocationService } from './location/driver-location.service';
export { DRIVER_LOCATION_STORE } from './location/driver-location.store';
export type { DriverLocationStore, NearbyDriver } from './location/driver-location.store';
```

**Repository: map rows to the shared domain shape, and let the column list be the security boundary**
(`auth.repository.ts:10-20, 35-56`)

```ts
type DriverRow = typeof drivers.$inferSelect;

function toProfile(row: DriverRow): DriverProfile {
  return {
    userId: row.userId,
    status: row.status,
    spokenLanguages: row.spokenLanguages as Language[],
    fleetId: row.fleetId,
    balanceCents: row.balanceCents,
    commissionPctOverride: row.commissionPctOverride,
    ...(row.isFemale === null ? {} : { isFemale: row.isFemale }),
    ...(row.rating === null ? {} : { rating: row.rating }),
  };
}
```

**Policy constants, not env vars** (`otp.policy.ts`)

```ts
/**
 * Location policy. Constants, not env vars — these are dispatch-correctness
 * limits, not deployment knobs, and a wrong TTL silently hands offers to
 * drivers who are no longer there.
 */
export const DRIVER_LOCATION_TTL_SECONDS = 60;
export const NEAREST_DEFAULT_RADIUS_METERS = 5_000;
export const NEAREST_DEFAULT_LIMIT = 10;
```

**Redis key naming** (`auth.service.ts:40-59`) — `domain:purpose:<discriminator>`, one `const` arrow per key,
each with a comment saying why it is its own key:

```ts
const onlineKey = (cityId: string) => `drivers:online:${cityId}`;
const geoKey = (cityId: string) => `drivers:geo:${cityId}`;
const seenKey = (cityId: string) => `drivers:seen:${cityId}`;
```

**Structured logging** (`auth.service.ts:169-173`) — always `event`, `at`, and the id:

```ts
this.logger.warn({
  event: 'driver.location.ping_rejected',
  driverId: user.sub,
  reason: 'malformed_payload',
  at: new Date().toISOString(),
});
```

**Test titles carry the 1+1+1 grade** (`auth.integration.spec.ts`) — every `it(...)` ends in `(expected)`,
`(edge)`, or `(failure)`.

---

## IMPLEMENTATION PLAN

### Phase 1: Contracts (`packages/shared`)

The request/response shapes the driver app (#14) and this API both need. Derived from the existing domain schemas
(`.omit()` / `.pick()`), never restated — `packages/shared/CLAUDE.md`: "Types derive from zod schemas via `z.infer`
— never hand-write a twin type."

**Tasks:** `DRIVER_PRESENCE_STATUSES` enum · profile-update / status-update / `driverMe` schemas · vehicle
create/update schemas · shared tests.

### Phase 2: The location port and its Redis implementation

**Depends on:** Phase 1 only for `LatLng` (already exists) — in practice **independent of Phase 1**, so this can be
built in parallel with it.

The storage primitive, in isolation and fully testable on its own. Port + token + policy constants + ioredis GEO
implementation.

### Phase 3: Postgres side of the slice — profile, vehicles, presence

**Depends on:** Phase 1 (request schemas), Phase 2 (presence writes go through the store).

Repositories, services, controllers, module wiring.

### Phase 4: The hot path — ingestion gateway and nearest query

**Depends on:** Phase 2 (the store), and on the realtime slice exporting `AuthedSocket`.
**Independent of:** Phase 3 — the ingest path deliberately has no Postgres dependency, which is the whole point of
AC #2. Build it against the fake store without waiting for Phase 3.

### Phase 5: Test harness, tests, wiring

**Depends on:** Phases 2–4. `createTestApp()` boots the real `AppModule`, so `DriversModule` must be registered
(Task 13) **before** any spec can run — same ordering lesson as Deviation 1 in the #7 report.

### Phase 6: Docs and the validation gate

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task Format Guidelines

- **CREATE** new file · **UPDATE** existing file · **ADD** new functionality into existing code · **MIRROR** copy a
  pattern from elsewhere in the codebase.

---

### UPDATE `packages/shared/src/enums.ts` — Task 1

- **IMPLEMENT**: append a `DRIVER_PRESENCE_STATUSES` const array — the subset of `DRIVER_STATUSES` a driver may set
  for themselves.
  ```ts
  /**
   * What a driver may set for THEMSELVES. `on_ride` is deliberately absent: it
   * is written only by the ride lifecycle (#11) when a ride is accepted, and a
   * driver who could set it by hand could hide from dispatch while idle — or
   * clear it mid-ride and take a second offer.
   */
  export const DRIVER_PRESENCE_STATUSES = ["offline", "online"] as const;
  export type DriverPresenceStatus = (typeof DRIVER_PRESENCE_STATUSES)[number];
  ```
- **PATTERN**: `packages/shared/src/enums.ts:19-20` (`DRIVER_STATUSES`), `:30-32` (`OFFER_STATUSES` — a const array
  with a docblock explaining the design choice).
- **GOTCHA**: do **not** derive it as `DRIVER_STATUSES.filter(...)` — that loses the literal tuple type and
  `z.enum()` stops working. Write the literals out.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #7 (malformed/forbidden status rejected at the contract)

### UPDATE `packages/shared/src/schemas/driver.ts` — Task 2

- **IMPLEMENT**: three additions below the existing `driverProfileSchema`.
  ```ts
  /**
   * What a driver may change about their own profile. An ALLOWLIST, not a
   * `.partial()` of the profile: `balanceCents`, `commissionPctOverride`,
   * `rating`, `fleetId` and `status` all live on the profile and none of them
   * are the driver's to write. Unknown keys are stripped by zod; the
   * repository's explicit column list is the second half of the same defence
   * (see auth.repository.ts:35-45).
   */
  export const driverProfileUpdateSchema = z
    .object({
      spokenLanguages: z.array(z.enum(LANGUAGES)).min(1).optional(),
      isFemale: z.boolean().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: "empty update" });
  export type DriverProfileUpdate = z.infer<typeof driverProfileUpdateSchema>;

  /** Presence toggle. `on_ride` is not a value a driver may send — see DRIVER_PRESENCE_STATUSES. */
  export const driverStatusUpdateSchema = z.object({
    status: z.enum(DRIVER_PRESENCE_STATUSES),
  });
  export type DriverStatusUpdate = z.infer<typeof driverStatusUpdateSchema>;

  /** GET /drivers/me — the driver app's whole bootstrap payload in one call. */
  export const driverMeSchema = z.object({
    profile: driverProfileSchema,
    vehicles: z.array(vehicleSchema),
  });
  export type DriverMe = z.infer<typeof driverMeSchema>;
  ```
- **IMPORTS**: extend the existing import to
  `import { DRIVER_PRESENCE_STATUSES, DRIVER_STATUSES, LANGUAGES } from "../enums";` and add
  `import { vehicleSchema } from "./vehicle";`.
- **GOTCHA 1**: `driverMeSchema` importing `./vehicle` is a **new intra-package edge**. `vehicle.ts` imports only
  `../enums`, so there is no cycle. Verify with `pnpm --filter @taxi/shared build` (a cycle would surface as a
  runtime `undefined` at module init, not a type error).
- **GOTCHA 2**: `driverMeSchema` needs **no** wire/domain date override — neither `driverProfileSchema` nor
  `vehicleSchema` has a date field. Do not add one "for consistency"; the override rule
  (`realtime-events.ts:12-20`) applies only where `z.coerce.date()` exists.
- **GOTCHA 3**: `.refine()` makes `driverProfileUpdateSchema` a `ZodEffects`, which loses `.omit()`/`.extend()`.
  That is safe here for the reason recorded on `rideAssignedEventSchema` (`realtime-events.ts:104-112`): it is a
  leaf request schema nothing derives from. Do **not** put a `.refine()` on `driverMeSchema`.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck && pnpm --filter @taxi/shared build`
- **SATISFIES**: AC #4, AC #7

### UPDATE `packages/shared/src/schemas/vehicle.ts` — Task 3

- **IMPLEMENT**:
  ```ts
  /** POST body — the server owns `id`, and `driverId` comes from the JWT, never the body. */
  export const vehicleCreateSchema = vehicleSchema.omit({ id: true, driverId: true });
  export type VehicleCreate = z.infer<typeof vehicleCreateSchema>;

  /** PATCH body. The refine keeps an empty patch from reaching Drizzle, whose `.set({})` throws. */
  export const vehicleUpdateSchema = vehicleCreateSchema
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: "empty update" });
  export type VehicleUpdate = z.infer<typeof vehicleUpdateSchema>;
  ```
- **PATTERN**: `.omit()` derivation mirrors `rideOfferEventSchema`'s `.extend()` derivation
  (`realtime-events.ts:89-92`) — one source of truth, projected.
- **GOTCHA**: `.partial()` over fields carrying `.default()` (`category`, `hasChildSeat`) yields
  `ZodOptional<ZodDefault<…>>` — an absent key stays `undefined` rather than materializing the default. That is
  what a PATCH must do. Assert it in the test (Task 4) so nobody "fixes" it later.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #4

### UPDATE `packages/shared/src/index.ts` (verify) + `packages/shared/tests/driver.test.ts` — Task 4

- **IMPLEMENT**: `src/index.ts` already does `export * from "./schemas/driver"` / `"./schemas/vehicle"` /
  `"./enums"` — **confirm no edit is needed**, then add vitest cases to `tests/driver.test.ts`:
  - `driverProfileUpdateSchema` **strips** `commissionPctOverride` / `balanceCents` / `status` from a body that
    carries them *(edge — the privilege boundary at the contract)*.
  - `driverProfileUpdateSchema` rejects `{}` and rejects `spokenLanguages: []` *(failure)*.
  - `driverStatusUpdateSchema` rejects `{ status: "on_ride" }` *(failure — #11 owns that transition)*.
  - `vehicleCreateSchema` parses a body without `id`/`driverId` and applies the two defaults *(expected)*; it
    rejects a body that supplies `driverId` — assert the key is **absent** from the parsed result *(edge)*.
  - `vehicleUpdateSchema` leaves absent defaulted keys `undefined` *(edge — the `.partial()` gotcha)*.
  - `driverMeSchema` round-trips a profile plus two vehicles *(expected)*.
- **PATTERN**: `packages/shared/tests/driver.test.ts` — vitest, `describe`/`it`, `(expected)`/`(edge)`/`(failure)`
  suffixes, a comment on each case saying what regression it guards.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #4, AC #7

### UPDATE `services/api/src/features/realtime/index.ts` — Task 5

- **IMPLEMENT**: add one line, keeping the existing DESIGN docblock untouched:
  ```ts
  export type { AuthedSocket, RealtimeServer } from './realtime.gateway';
  ```
- **GOTCHA**: `export type`, not `export` — these are types only, and `isolatedModules: true` is on in
  `services/api/tsconfig.json`.
- **GOTCHA**: do **not** relax the "no client-initiated join API" rule the docblock states. The drivers gateway
  subscribes to a **message**, which is a different thing from a join.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1 (the ingest handler needs the socket type)

### SPIKE — prove the second gateway shares the authenticated server — Task 5b

**Do this before Tasks 6–18.** The single assumption the whole ingest design rests on is that an options-less
`@WebSocketGateway()` in the drivers slice reuses `RealtimeGateway`'s server *and its JWT handshake middleware*.
That is verified statically above (`socket-server-provider.js`), but a static reading is the wrong evidence for
"is this socket authenticated" — and if it is wrong, the fix is architectural (fold the handler into
`RealtimeGateway` behind an injected port, inverting the slice dependency) and would invalidate Tasks 13–15. Cost
of finding out now: ~40 lines. Cost of finding out at Task 17: a rewrite.

- **IMPLEMENT**: a **walking skeleton**, not a throwaway — Tasks 14–15 grow both files into their real form.
  - `features/drivers/location/driver-location.gateway.ts`: `@WebSocketGateway()` class with one
    `@SubscribeMessage(RT.driverLocation)` handler that, for now, records `client.data.user?.sub` onto a public
    array on the instance and returns.
  - `features/drivers/drivers.module.ts`: `@Module({ providers: [DriverLocationGateway] })`.
  - Register `DriversModule` in `app.module.ts`.
  - `features/drivers/location/driver-location.gateway.spec.ts` with two cases:
    1. `await expect(connectClient(port)).rejects.toThrow('unauthorized')` — **the load-bearing one.** If the
       drivers gateway had forked its own server, this connection would succeed.
    2. an authenticated driver's `driver:location` emit reaches the handler and the recorded id equals the JWT
       `sub` — proves handler binding and identity in one.
- **PATTERN**: `realtime/realtime.gateway.spec.ts` for the socket harness (`app.listen(0)`, port off
  `getHttpServer().address()`, `afterEach(closeClients)` before `afterAll(app.close())`).
- **GOTCHA**: also read the boot log — `DriverLocationGateway subscribed to the "driver:location" message` must
  appear **once**. Two servers would show two `Nest application successfully started`-adjacent bindings.
- **STOP CONDITION**: if case 1 fails (an unauthenticated socket connects), **do not work around it** by
  re-registering middleware in the drivers gateway — that double-registers on the shared server in the passing
  case. Stop, and move the handler into `RealtimeGateway` with `DriverLocationService` injected through a token
  the realtime module resolves lazily. Record the switch in AMENDMENTS.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api`
- **SATISFIES**: AC #1, AC #3 — and de-risks Tasks 13–18

### CREATE `services/api/src/features/drivers/location/driver-location.policy.ts` — Task 6

- **IMPLEMENT**: the three constants from *Patterns to Follow*, with the docblock.
  - `DRIVER_LOCATION_TTL_SECONDS = 60` — how long a position stays dispatchable without a refresh.
  - `NEAREST_DEFAULT_RADIUS_METERS = 5_000` — greater-Rīga pickup radius.
  - `NEAREST_DEFAULT_LIMIT = 10`.
- **PATTERN**: `services/api/src/features/auth/otp.policy.ts` — file-level docblock justifying constants over env.
- **GOTCHA**: the TTL is a **read filter**, not a Redis key expiry. GEO members are zset members and cannot carry
  a per-member TTL — say so in the comment so nobody "fixes" it with `EXPIRE`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1 (edge — offline/stale exclusion)

### CREATE `services/api/src/features/drivers/location/driver-location.store.ts` — Task 7

- **IMPLEMENT**: the port, its token, and its return type.
  ```ts
  export const DRIVER_LOCATION_STORE = 'DRIVER_LOCATION_STORE';

  /** One driver's live position as dispatch sees it. `distanceMeters` is from the query centre. */
  export interface NearbyDriver {
    driverId: string;
    location: LatLng;
    distanceMeters: number;
  }

  /**
   * The narrow slice of Redis the driver hot path uses. A port, not an
   * abstraction layer — same rationale as common/kv/kv.store.ts: it exists so
   * the suite runs without a Redis server, and so the "location writes never
   * touch Postgres" rule is provable rather than documented. There is exactly
   * one production implementation and nothing here is pluggable.
   */
  export interface DriverLocationStore {
    /** Makes the driver eligible to have a position recorded. Idempotent. */
    markOnline(cityId: string, driverId: string): Promise<void>;

    /** Drops presence AND any recorded position — this is what "excludes offline drivers" means. */
    markOffline(cityId: string, driverId: string): Promise<void>;

    /**
     * Writes a position, but ONLY for a driver in the online set, and
     * atomically so — a read-then-write leaves a window in which a driver who
     * just went offline is re-added by their own straggler ping and gets
     * offered a ride. Returns false when the ping was ignored.
     */
    record(cityId: string, driverId: string, location: LatLng, atMs: number): Promise<boolean>;

    /** Nearest first. `freshSinceMs` drops positions from sockets that vanished without going offline. */
    findNearby(
      cityId: string,
      centre: LatLng,
      opts: { radiusMeters: number; limit: number; freshSinceMs: number },
    ): Promise<NearbyDriver[]>;
  }
  ```
- **IMPORTS**: `import type { LatLng } from '@taxi/shared';`
- **GOTCHA**: `atMs` / `freshSinceMs` are **numbers**, not `Date`. Redis ZSET scores are numbers; keeping the port
  in the same unit removes a conversion at every call site and makes the in-memory fake exact.
- **GOTCHA**: the caller supplies both timestamps. The store holds no clock — that is what lets the fake test
  staleness without sleeping (same trick as `InMemoryKeyValueStore.advance()`).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #2, AC #1 (edge)

### CREATE `services/api/src/features/drivers/location/redis-driver-location.store.ts` — Task 8

- **IMPLEMENT**: `RedisDriverLocationStore implements DriverLocationStore, OnModuleDestroy`.
  - Constructor takes a `url: string` and does `this.redis = new Redis(url)` — **mirror `RedisKeyValueStore`
    exactly**, including the `onModuleDestroy` `quit()`-then-`disconnect()` fallback and its docblock rationale.
  - Keys: the three `const` arrows from *Patterns to Follow*, each with a one-line comment.
  - `markOnline` → `await this.redis.sadd(onlineKey(cityId), driverId)`.
  - `markOffline` → one `multi()`: `.srem(onlineKey, id).zrem(geoKey, id).zrem(seenKey, id).exec()`.
    Comment: **there is no `GEODEL`** — a GEO set is a sorted set, so `ZREM` is the removal.
  - `record` → a `private static readonly RECORD` Lua script, run with
    `this.redis.eval(RECORD, 3, onlineKey(c), geoKey(c), seenKey(c), driverId, String(lng), String(lat), String(atMs))`:
    ```lua
    if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 0 then return 0 end
    redis.call('GEOADD', KEYS[2], ARGV[2], ARGV[3], ARGV[1])
    redis.call('ZADD', KEYS[3], ARGV[4], ARGV[1])
    return 1
    ```
    Return `Number(result) === 1`.
  - `findNearby` → one pipeline, two commands. **Write this body as given** — the reply narrowing is the fiddliest
    part of the ticket and this version is already clean under `noUncheckedIndexedAccess` + `no-unsafe-*`:
    ```ts
    /** GEOSEARCH … WITHDIST WITHCOORD → [member, distance, [lng, lat]]; all leaves are STRINGS. */
    type GeoSearchRow = [string, string, [string, string]];

    async findNearby(
      cityId: string,
      centre: LatLng,
      opts: { radiusMeters: number; limit: number; freshSinceMs: number },
    ): Promise<NearbyDriver[]> {
      const replies = await this.redis
        .pipeline()
        .geosearch(
          geoKey(cityId),
          'FROMLONLAT',
          String(centre.lng), // lng FIRST — the reverse of how LatLng reads
          String(centre.lat),
          'BYRADIUS',
          String(opts.radiusMeters),
          'm',
          'ASC', // nearest first; the freshness filter below preserves the order
          'WITHDIST',
          'WITHCOORD',
        )
        .zrangebyscore(seenKey(cityId), opts.freshSinceMs, '+inf')
        .exec();

      if (!replies) throw new Error('driver-location: redis pipeline returned no replies');
      const [geoReply, freshReply] = replies;
      // Surface a command error instead of degrading to "nobody is nearby" — a
      // silent empty list here reads to dispatch as "no drivers in Rīga".
      if (geoReply?.[0]) throw geoReply[0];
      if (freshReply?.[0]) throw freshReply[0];

      const fresh = new Set((freshReply?.[1] ?? []) as string[]);
      const rows = (geoReply?.[1] ?? []) as GeoSearchRow[];

      const nearby: NearbyDriver[] = [];
      for (const [driverId, distance, coord] of rows) {
        if (!fresh.has(driverId)) continue; // socket went away without going offline
        nearby.push({
          driverId,
          location: { lat: Number(coord[1]), lng: Number(coord[0]) }, // coord is [lng, lat]
          distanceMeters: Number(distance),
        });
        if (nearby.length === opts.limit) break;
      }
      return nearby;
    }
    ```
- **IMPORTS**: `import { Injectable, OnModuleDestroy } from '@nestjs/common'; import Redis from 'ioredis'; import
  type { LatLng } from '@taxi/shared'; import type { DriverLocationStore, NearbyDriver } from './driver-location.store';`
- **GOTCHA 1 — argument order**: `GEOADD key LONGITUDE LATITUDE member` and `FROMLONLAT lng lat`. **lng first**,
  the reverse of how `LatLng` reads. Put a comment on both call sites. This is the highest-probability bug here.
- **GOTCHA 2 — reply narrowing**: `geosearch` is typed `Result<unknown[]>`
  (`node_modules/ioredis/built/utils/RedisCommander.d.ts:2305-2310`). Narrow explicitly, and remember
  `noUncheckedIndexedAccess: true` — every index access is `T | undefined`:
  ```ts
  /** GEOSEARCH … WITHDIST WITHCOORD → [member, distance, [lng, lat]]; distance and coords are STRINGS. */
  type GeoSearchRow = [string, string, [string, string]];
  const rows = (geoRes[1] ?? []) as GeoSearchRow[];
  ```
  Then map with destructuring (`for (const [driverId, dist, coord] of rows)`) so you never index blindly. Do **not**
  use `any` — `@typescript-eslint/no-unsafe-*` are errors here (only `no-unsafe-argument` is a warning; see
  `services/api/eslint.config.mjs:29-33`).
- **GOTCHA 3 — no COUNT**: deliberately omit `COUNT`; the radius bounds the result and the freshness filter runs
  *after*, so a `COUNT` would let stale entries crowd out live ones. At pilot scale (≤10 drivers) this is free.
  Say so in a comment — see NOTES for the scaling trigger.
- **GOTCHA 4 — pipeline replies**: ioredis `.exec()` returns `[error, result][]`. Read `[1]`, and throw if `[0]`
  is non-null rather than silently returning an empty list.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #1, AC #2

### CREATE `services/api/src/features/drivers/drivers.repository.ts` — Task 9

- **IMPLEMENT**: `@Injectable() DriversRepository` with `@Inject(DRIZZLE) private readonly db: Db`.
  - `toProfile(row)` mapper — exactly as in *Patterns to Follow*.
  - `findOrCreate(userId: string): Promise<DriverProfile>` — race-safe, mirroring `auth.repository.ts:46-56`:
    ```ts
    const [row] = await this.db
      .insert(drivers)
      .values({ userId })
      .onConflictDoUpdate({ target: drivers.userId, set: { userId } })
      .returning();
    ```
    Docblock: the no-op `set` is the only form that always returns the row (`onConflictDoNothing().returning()`
    yields `[]`); every other column is left to its Postgres default, which is how a returning driver keeps their
    status, balance and override.
  - `updateProfile(userId, patch: DriverProfileUpdate): Promise<DriverProfile>` — build the `set` object from an
    **explicit two-column allowlist**, with the `auth.repository.ts`-style docblock naming the omission as the
    defence: `balanceCents`, `commissionPctOverride`, `rating`, `fleetId`, `status` are never in this object.
  - `setStatus(userId, status: DriverStatus): Promise<DriverProfile>` — `update … set({ status }) … returning()`.
  - `findMatchAttributes(driverIds: string[]): Promise<DriverMatchAttributes[]>` — the read #10 calls:
    ```ts
    export interface DriverMatchAttributes {
      driverId: string;
      status: DriverStatus;
      isFemale: boolean | null;
      balanceCents: number;
      /** Distinct categories across the driver's vehicles. */
      categories: RideCategory[];
      /** True when ANY of the driver's vehicles has one. */
      hasChildSeat: boolean;
      maxPassengerSeats: number;
    }
    ```
    Implementation: `select().from(drivers).leftJoin(vehicles, eq(vehicles.driverId, drivers.userId))
    .where(inArray(drivers.userId, driverIds))`, aggregated in JS. Return `[]` for an empty input **without
    querying** — drizzle 0.44.7 compiles `inArray(col, [])` to `sql\`false\`` (verified in
    `node_modules/drizzle-orm/sql/expressions/conditions.cjs:111-117`), so this is a saved round trip on a hot
    dispatch path, not a correctness fix. Keep the guard and say which it is in the comment.
- **IMPORTS**: `import { drivers, vehicles, type Db } from '@taxi/db';`,
  `import { eq, inArray } from 'drizzle-orm';`,
  `import type { DriverProfile, DriverProfileUpdate, DriverStatus, Language, RideCategory } from '@taxi/shared';`,
  `import { DRIZZLE } from '../../common/db/db.module';`
- **GOTCHA**: `spokenLanguages` is `text[]` in Drizzle → `string[]` in TS, while the domain type is `Language[]`.
  Cast in `toProfile` (`row.spokenLanguages as Language[]`) with a comment — the DB has no CHECK constraint, so
  this is a genuine narrowing, and the update path is the only writer and it validates through zod first.
- **GOTCHA**: `drivers.isFemale` and `drivers.rating` are nullable while the domain fields are `.optional()`. Use
  the conditional-spread pattern from `auth.repository.ts:10-20`, not `?? undefined`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1 (edge — offline exclusion needs a durable status), AC #4

### CREATE `services/api/src/features/drivers/vehicles.repository.ts` — Task 10

- **IMPLEMENT**: `@Injectable() VehiclesRepository`, `@Inject(DRIZZLE) db: Db`, `toVehicle(row)` mapper.
  - `listForDriver(driverId): Promise<Vehicle[]>`
  - `create(driverId, input: VehicleCreate): Promise<Vehicle>`
  - `update(driverId, vehicleId, patch: VehicleUpdate): Promise<Vehicle | undefined>` — the `where` clause is
    `and(eq(vehicles.id, vehicleId), eq(vehicles.driverId, driverId))`. **Both predicates, always.**
  - `remove(driverId, vehicleId): Promise<boolean>` — same double predicate; return `result.length > 0` off
    `.returning({ id: vehicles.id })`.
  - `countForDriver(driverId): Promise<number>`
- **PATTERN**: `auth.repository.ts` for structure.
- **GOTCHA — the ownership boundary**: scoping by `driverId` **in the SQL** (never "fetch, then compare in JS") is
  what makes another driver's vehicle simply not exist. A separate fetch-then-403 leaks existence. Put that
  sentence in the docblock; Task 14 tests it.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #4

### CREATE `services/api/src/features/drivers/drivers.service.ts` + `vehicles.service.ts` — Task 11

**`drivers.service.ts`** — `@Injectable() DriversService`, injecting `DriversRepository`, `VehiclesRepository`,
`@Inject(DRIVER_LOCATION_STORE) locations: DriverLocationStore`, `@Inject(APP_ENV) env: Env`, and a `Logger`.

- `getMe(userId): Promise<DriverMe>` — `findOrCreate` then `listForDriver`. First call provisions the row.
- `updateProfile(userId, patch)` → repo passthrough.
- `setPresence(userId, status: DriverPresenceStatus): Promise<DriverProfile>`:
  ```
  profile = await repo.findOrCreate(userId)            // a driver may toggle before ever GETting /me

  if (profile.status === 'on_ride')
      throw ConflictException('driver_on_ride')        // #11 owns leaving this state

  if (status === 'online'):
      if (await vehicles.countForDriver(userId) === 0)
          throw ConflictException('vehicle_required')
      updated = await repo.setStatus(userId, 'online') // Postgres FIRST
      await locations.markOnline(cityId, userId)       // …then Redis
  else:
      await locations.markOffline(cityId, userId)      // Redis FIRST
      updated = await repo.setStatus(userId, 'offline')

  log 'driver.presence.changed' { driverId, from, to, at }
  return updated
  ```
  **Docblock the ordering**, because it is not arbitrary: both orders fail toward *not dispatchable*. Going online,
  a Redis failure after the Postgres commit leaves a driver who believes they are online but receives nothing —
  visible and self-healing on the next toggle. Going offline, a Postgres failure after the Redis removal leaves a
  driver who is already undispatchable. The reverse of either order would hand rides to a driver who is not there.
- `findMatchAttributes(driverIds)` → repo passthrough (the #10 entry point).

**`vehicles.service.ts`** — `@Injectable() VehiclesService`, injecting `VehiclesRepository`, `DriversRepository`,
`DRIVER_LOCATION_STORE`, `APP_ENV`, `Logger`.

- `list(userId)`.
- `create(userId, input)` — call `drivers.findOrCreate(userId)` **first**: `vehicles.driver_id` FKs
  `drivers.user_id`, so a vehicle insert for a driver with no row fails with a raw FK violation (500). This one
  line turns that into correct behaviour.
- `update(userId, vehicleId, patch)` — `undefined` from the repo → `NotFoundException('vehicle_not_found')`.
- `remove(userId, vehicleId)`:
  ```
  if (!await repo.remove(userId, vehicleId)) throw NotFoundException('vehicle_not_found')
  if (await repo.countForDriver(userId) === 0):
      profile = await drivers.findOrCreate(userId)
      if (profile.status === 'online'):
          await locations.markOffline(cityId, userId)
          await drivers.setStatus(userId, 'offline')
          log 'driver.presence.forced_offline' { driverId, reason: 'no_vehicle', at }
  ```
  Docblock: this is the symmetric half of the `vehicle_required` rule in `setPresence`. Without it a driver deletes
  their only car and stays online and undispatchable-but-offered.
- **IMPORTS**: `ConflictException` / `NotFoundException` from `@nestjs/common`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1 (edge), AC #4

### CREATE `services/api/src/features/drivers/drivers.controller.ts` + `vehicles.controller.ts` — Task 12

**`drivers.controller.ts`** — `@Controller('drivers')`, `@Roles('driver')` **on the class**.

| Method | Path | Body pipe | Returns |
|---|---|---|---|
| `@Get('me')` | `/drivers/me` | — | `DriverMe` |
| `@Patch('me')` | `/drivers/me` | `new ZodValidationPipe(driverProfileUpdateSchema)` | `DriverProfile` |
| `@Put('me/status')` | `/drivers/me/status` | `new ZodValidationPipe(driverStatusUpdateSchema)` | `DriverProfile` |

**`vehicles.controller.ts`** — `@Controller('drivers/me/vehicles')`, `@Roles('driver')` on the class.

| Method | Body pipe | Returns |
|---|---|---|
| `@Get()` | — | `Vehicle[]` |
| `@Post()` | `new ZodValidationPipe(vehicleCreateSchema)` | `Vehicle` (201 — the Nest default is correct here) |
| `@Patch(':id')` | `new ZodValidationPipe(vehicleUpdateSchema)` | `Vehicle` |
| `@Delete(':id')` + `@HttpCode(204)` | — | `void` |

- **PATTERN**: `auth.controller.ts` — thin, one line per route, `@Body(new ZodValidationPipe(schema)) body: T`.
- **IMPORTS**: `CurrentUser` from `../auth` (the barrel, not a deep path), `Roles` from `../auth`.
- **GOTCHA 1**: `@Roles('driver')` at class level is enough — `RolesGuard` uses
  `getAllAndOverride(ROLES_KEY, [handler, class])` (`roles.guard.ts:20-23`).
- **GOTCHA 2**: take the driver id from `@CurrentUser() user: JwtClaims` → `user.sub`. **Never** from a path param
  or the body — that is the same boundary the ping schema enforces for sockets.
- **GOTCHA 3**: validate `:id` as a UUID with `@Param('id', new ZodValidationPipe(z.string().uuid()))`. Without it,
  a non-UUID reaches Postgres as `invalid input syntax for type uuid` → 500 instead of 400.
- **GOTCHA 4**: do **not** add `@Public()` anywhere. Both controllers are fail-closed behind the global guards.
- **GOTCHA 5 — leave `DriversController` without a `:id` route.** `@Get(':id')` would shadow `@Get('me')` under
  Express path matching (first registration wins, and `me` is a valid `:id` string). #20's admin-facing driver
  reads belong on an `/admin/drivers` controller, not here. Say so in the controller docblock.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && lint`
- **SATISFIES**: AC #4, AC #7

### CREATE `services/api/src/features/drivers/location/driver-location.service.ts` — Task 13

- **IMPLEMENT**: `@Injectable() DriverLocationService`, injecting **only**
  `@Inject(DRIVER_LOCATION_STORE) store`, `RealtimeService`, `@Inject(APP_ENV) env`, plus a `Logger`.
  ```ts
  /**
   * The hot path. This class has NO Drizzle dependency, and that is the whole
   * feature: a location ping must never reach Postgres (issue #8 AC 2). If you
   * find yourself needing the database here, you are solving the wrong problem
   * — presence lives in the Redis online set precisely so this stays true.
   * driver-location.service.spec.ts boots this path with a DRIZZLE provider
   * that throws on any access; adding one here fails that test.
   */
  ```
  - `async ingest(driverId: string, ping: DriverLocationPing): Promise<void>`
    ```ts
    const atMs = Date.now();                              // SERVER clock — see gotcha
    const accepted = await this.store.record(cityId, driverId, ping.location, atMs);
    if (!accepted) { this.logger.warn({ event: 'driver.location.ping_ignored', driverId, reason: 'not_online', at }); return; }
    this.realtime.emitToDispatch(cityId, RT.driverLocation, {
      driverId,
      location: ping.location,
      at: new Date(atMs).toISOString(),
      ...(ping.heading === undefined ? {} : { heading: ping.heading }),
    });
    ```
  - `async findNearest(centre: LatLng, opts?: { radiusMeters?: number; limit?: number }): Promise<NearbyDriver[]>`
    — fills defaults from `driver-location.policy.ts` and computes
    `freshSinceMs = Date.now() - DRIVER_LOCATION_TTL_SECONDS * 1000`.
- **GOTCHA 1 — server clock, not the client's**: the ping carries `at`, and we ignore it for storage. A client
  clock decides freshness otherwise, so a skewed or hostile phone stays "fresh" forever or evaporates instantly.
  Same boundary rule as taking `driverId` from the JWT (`realtime-events.ts:33-38`) — put that sentence in the code.
- **GOTCHA 2**: `emitToDispatch` parses through `RT_EVENT_SCHEMAS` before sending
  (`realtime.service.ts:63-75`), and `driverLocationEventSchema.at` is `z.string().datetime()`. Passing a `Date`
  throws at runtime. Always `.toISOString()`.
- **GOTCHA 3**: do not `await` an emit — `emitToDispatch` returns `void`.
- **GOTCHA 4 — no ride-room fan-out yet.** `.claude/references/realtime-events.md` says positions also go to the
  rider during an active ride; no ride exists until #11. Dispatch room only, with a `// #11:` comment.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #2

### COMPLETE `services/api/src/features/drivers/location/driver-location.gateway.ts` — Task 14

- **IMPLEMENT**: grow Task 5b's skeleton into the API's first real inbound socket handler — replace the recording
  array with the service call, keep the class and its `@WebSocketGateway()` decorator exactly as the spike left them.
  ```ts
  @WebSocketGateway()
  export class DriverLocationGateway {
    private readonly logger = new Logger(DriverLocationGateway.name);
    constructor(private readonly locations: DriverLocationService) {}

    @SubscribeMessage(RT.driverLocation)
    async handleLocation(
      @ConnectedSocket() client: AuthedSocket,
      @MessageBody() payload: unknown,
    ): Promise<void> {
      const user = client.data.user;
      if (user?.role !== 'driver') { warn 'driver.location.ping_rejected' reason:'not_a_driver'; return; }
      const parsed = driverLocationPingSchema.safeParse(payload);
      if (!parsed.success) { warn … reason:'malformed_payload'; return; }
      await this.locations.ingest(user.sub, parsed.data);
    }
  }
  ```
- **GOTCHA 1 — VERIFIED: a second `@WebSocketGateway()` shares the first one's server and handshake.**
  Nest keys cached servers on `{port, path}` only (`node_modules/@nestjs/websockets/socket-server-provider.js`,
  `scanForSocketServer`), so an options-less `@WebSocketGateway()` reuses the server `RealtimeGateway` created —
  **including the `server.use()` JWT middleware** registered in its `afterInit`. Three corollaries, all checked
  against the installed source:
  - `init` is a `ReplaySubject` (`factories/server-and-event-streams-factory.js`), so gateway registration order
    does not matter.
  - `handleConnection` still fires once per socket: the shared `connection` Subject is piped through
    `distinctUntilChanged` (`web-sockets-controller.js:74-79`, `subscribeConnectionEvent`).
  - **Do not** give this class an `afterInit`, a `handleConnection`, or `@WebSocketGateway({...options})`. Any of
    the three either double-registers middleware or forks a second server with **no** authentication.
- **GOTCHA 2**: the global `JwtAuthGuard` cannot help here — it throws `unsupported_context` for non-HTTP contexts
  by design (`jwt-auth.guard.ts:20-30`). `client.data.user` is the only identity source.
- **GOTCHA 3 — never throw out of this handler.** A `WsException` emits an `exception` frame and a thrown zod error
  is worse. A driver mid-shift must not be disturbed by one bad frame: log and return. Test asserts the socket
  stays connected.
- **GOTCHA 4**: `role !== 'driver'` uses optional chaining (`user?.role`) — `SocketData.user` is optional in the
  type even though the middleware guarantees it.
- **IMPORTS**: `ConnectedSocket`, `MessageBody`, `SubscribeMessage`, `WebSocketGateway` from `@nestjs/websockets`;
  `driverLocationPingSchema`, `RT` from `@taxi/shared`; `type AuthedSocket` from `../../realtime`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && lint`
- **SATISFIES**: AC #1 (failure — malformed pings), AC #2

### COMPLETE `services/api/src/features/drivers/drivers.module.ts` + CREATE `index.ts` — Task 15

- **IMPLEMENT** `drivers.module.ts` — Task 5b created it with a single provider; fill it out. `app.module.ts` is
  already wired from the spike, so re-check rather than re-edit.
  ```ts
  @Module({
    imports: [RealtimeModule],   // for RealtimeService — the only cross-slice dependency
    controllers: [DriversController, VehiclesController],
    providers: [
      DriversService, DriversRepository, VehiclesService, VehiclesRepository,
      DriverLocationService, DriverLocationGateway,
      {
        provide: DRIVER_LOCATION_STORE,
        useFactory: (env: Env) => new RedisDriverLocationStore(env.REDIS_URL),
        inject: [APP_ENV],
      },
    ],
    exports: [DriversService, DriverLocationService, DRIVER_LOCATION_STORE],
  })
  export class DriversModule {}
  ```
- **IMPLEMENT** `index.ts` — the barrel from *Patterns to Follow*, with a docblock stating that #10 consumes
  `DriverLocationService.findNearest()` + `DriversService.findMatchAttributes()` and nothing else.
- **UPDATE** `app.module.ts` — add `DriversModule` to `imports`, after `RealtimeModule`. Do not touch the
  `APP_GUARD` ordering comment.
- **PATTERN**: `kv.module.ts` for the `useFactory` + `inject: [APP_ENV]` provider; `auth.module.ts` for `exports`
  as the DI contract.
- **GOTCHA 1**: `RedisDriverLocationStore` opens a **third** ioredis connection in production (KV + adapter pub/sub
  + this). That is correct and intended — a blocking or subscribed client cannot serve GEO commands. Note it in the
  module docblock; `enableShutdownHooks()` in `main.ts:17` already closes it via `onModuleDestroy`.
- **GOTCHA 2**: do **not** make `DriversModule` `@Global()`. #10 will `imports: [DriversModule]`.
- **GOTCHA 3 — ordering**: this task must land **before** Tasks 16–18. `createTestApp()` boots the real
  `AppModule`, so no spec can resolve a drivers provider until it is registered (Deviation 1 in the #7 report is
  this exact lesson).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && lint` then `pnpm --filter @taxi/api build`
- **SATISFIES**: AC #3

### UPDATE `services/api/test/harness.ts` + CREATE `test/driver-location-store.contract.ts` — Task 16

- **IMPLEMENT** in `harness.ts`:
  - `haversineMeters(a: LatLng, b: LatLng): number` — test-only, with a comment saying the production path never
    computes distance (Redis does) and this exists so the fake can order results the same way.
  - `InMemoryDriverLocationStore implements DriverLocationStore` — mirroring `InMemoryKeyValueStore`:
    ```ts
    private readonly online = new Map<string, Set<string>>();               // cityId → driverIds
    private readonly positions = new Map<string, Map<string, { location: LatLng; atMs: number }>>();
    /** Test observability: every accepted write, in order. */
    readonly recorded: { cityId: string; driverId: string; location: LatLng; atMs: number }[] = [];

    /** Test-only assertions helpers — the specs read presence and position through these, never the Maps. */
    isOnline(cityId: string, driverId: string): boolean;
    positionOf(cityId: string, driverId: string): { location: LatLng; atMs: number } | undefined;
    ```
    `record()` returns `false` and records nothing when the driver is not in the city's online set — **the fake
    must model the Lua gate exactly or the ordering/exclusion tests prove nothing**. `findNearby()` filters by
    radius **and** `atMs >= freshSinceMs`, sorts by distance ascending, slices to `limit`.
  - Extend `TestApp` with `locations: InMemoryDriverLocationStore` and add the third override in `createTestApp`:
    `.overrideProvider(DRIVER_LOCATION_STORE).useValue(locations)`. Update the `createTestApp` docblock —
    "exactly two providers swapped" becomes three, and say why (no ioredis client is ever constructed).
- **IMPLEMENT** `test/driver-location-store.contract.ts` — one exported
  `runDriverLocationStoreContract(name: string, makeStore: () => Promise<DriverLocationStore> | DriverLocationStore, cleanup?)`
  containing the shared fixture and its four cases. Both the fake and the real Redis store run it, so the
  in-memory ordering guarantee is verified against real `GEOSEARCH` too.
  **Fixture — chosen so a lat/lng transposition anywhere in the stack inverts the answer.** Centre is Brīvības
  piemineklis, `lat 56.9512, lng 24.1136`; radius 5 km. At this latitude one degree of longitude is ~60,714 m
  against ~111,132 m for latitude, so an east offset and a north offset of similar size swap rank when the axes
  are transposed:

  | Driver | Offset from centre | True distance | Distance if lat/lng were transposed |
  |---|---|---|---|
  | `east` | `lng +0.0100` | **~607 m** (1st) | ~1,111 m (2nd) |
  | `north` | `lat +0.0080` | **~889 m** (2nd) | ~813 m (1st) |
  | `far` | `lat +0.0350` | **~3,890 m** (3rd) | ~3,556 m (3rd) |
  | `outside` | `lat +0.1000` | ~11,113 m — **excluded** | ~10,160 m — still excluded |

  Assert the order is exactly `[east, north, far]`. A consistent swap on both the write and the read path — the
  one a round-trip test cannot see — flips the first two. The 282 m gap between them is an order of magnitude
  larger than the few metres by which Redis's geohash distance and the fake's haversine disagree, so the
  assertion is stable across both implementations.

  Cases:
  1. nearest-first order is exactly `[east, north, far]`, `outside` absent *(expected — also the lat/lng
     transposition detector; say so in the test's comment so nobody "simplifies" the fixture)*
  2. a position written at the centre round-trips to `distanceMeters < 5` when queried from the centre
     *(expected — catches a swap on the write path only, which case 1 would also catch but this localizes it)*
  3. a driver who called `markOffline` is absent *(edge)*
  4. a position older than `freshSinceMs` is absent *(edge)*
  5. a driver marked online who has **never pinged** is absent — presence alone is not a position, and dispatch
     must not receive a candidate with no location *(edge)*
  6. `record()` for a driver never marked online returns `false` and stores nothing *(failure)*
- **GOTCHA**: give the fake **no** internal clock — `record()` takes `atMs` and `findNearby()` takes
  `freshSinceMs`, so staleness is tested by passing numbers, never by sleeping.
- **GOTCHA**: `haversineMeters` will differ from Redis's geohash distance by a few metres. **Assert order and
  membership, never absolute distances.** State this in the contract file's docblock.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #2

### CREATE the three api spec files — Task 17

**`location/redis-driver-location.store.spec.ts`** (opt-in)
- **MIRROR** `common/kv/redis-kv.store.spec.ts` verbatim: `const describeWithRedis = process.env.REDIS_TEST_URL ?
  describe : describe.skip`, with the same run-it-deliberately comment block.
- Namespace the city id per worker (`const cityId = \`test-city-${process.pid}\``) — jest workers share one Redis
  and these keys are not namespaced. Clean all three keys in `beforeEach`/`afterAll`.
- Body: `runDriverLocationStoreContract('RedisDriverLocationStore', () => new RedisDriverLocationStore(url))`.

**`location/driver-location.service.spec.ts`** (unit — no HTTP, no Postgres)
- Build a bare testing module: `Test.createTestingModule({ providers: [DriverLocationService, {provide:
  DRIVER_LOCATION_STORE, useValue: store}, {provide: RealtimeService, useValue: emitSpy}, {provide: APP_ENV,
  useValue: {DEFAULT_CITY_ID: CITY}}, {provide: DRIZZLE, useValue: throwingDb}] })` where
  ```ts
  /** AC 2, enforced: any Postgres access anywhere on the ingest path explodes here. */
  const throwingDb = new Proxy({}, {
    get() { throw new Error('the location hot path must not touch Postgres'); },
  });
  ```
- Cases:
  1. `ingest` records the position and emits `driver:location` to `dispatch:<cityId>` with an ISO `at` *(expected)*.
  2. `ingest` runs to completion with `throwingDb` wired in — **AC #2** *(expected)*. Title it so the intent is
     unmissable: `'never touches Postgres on the ping path (expected — AC 2)'`.
  3. `ingest` for a driver not marked online records nothing and emits nothing *(edge)*.
  4. the emitted `at` is the **server** clock, not the ping's — send `at: '2020-01-01T00:00:00.000Z'` and assert the
     emitted value differs *(edge)*.
  5. `findNearest` returns nearest-first under the shared fixture *(expected)*; excludes an offline driver *(edge)*;
     excludes a position older than `DRIVER_LOCATION_TTL_SECONDS` *(edge)*.
- **GOTCHA**: run the emit assertion against a hand-rolled spy object `{ emitToDispatch: jest.fn() }` cast to
  `RealtimeService` — instantiating the real one drags in `RealtimeGateway` and a live server.
  The `RT_EVENT_SCHEMAS` parse is covered separately by the gateway spec (below), which uses the real service.

**`location/driver-location.gateway.spec.ts`** (socket level) — **extend** the spec Task 5b already created; keep
its unauthenticated-handshake case, which is the standing regression guard for the shared-server assumption.
- **MIRROR** `realtime/realtime.gateway.spec.ts` — `createTestApp()`, `app.listen(0)`, port off
  `getHttpServer().address()`, `afterEach(closeClients)` **before** `afterAll(app.close())`.
- Cases:
  1. an online driver's ping lands in `ctx.locations.recorded` **and** arrives at a connected dispatcher's socket
     as `RT.driverLocation` with the right `driverId` *(expected — this is also the end-to-end proof that the
     second gateway shares the first's authenticated server)*.
  2. a socket authenticated as `rider` emits `driver:location` → nothing recorded, nothing emitted *(edge)*.
  3. a malformed ping (`{ location: { lat: 999, lng: 0 }, at: 'nope' }`) → nothing recorded, nothing emitted, and
     the client is **still connected** afterwards *(failure)*.
- **GOTCHA**: the driver must be marked online first. Call `ctx.locations.markOnline(cityId, driverId)` directly —
  going through `PUT /drivers/me/status` here would drag Postgres and a vehicle into a socket test.
- **GOTCHA**: assert *absence* by awaiting a short `Promise.race` against a timer, or by asserting
  `ctx.locations.recorded` is empty after an `await` on a round-trip acknowledgement. Do not assert absence
  synchronously right after `emit` — the handler is async.

- **VALIDATE**: `pnpm turbo run test --filter @taxi/api`
- **SATISFIES**: AC #1, AC #2, AC #5

### CREATE `services/api/src/features/drivers/drivers.integration.spec.ts` — Task 18

- **MIRROR** `features/auth/auth.integration.spec.ts` end to end, including its `signIn()` helper.
- **GOTCHA — pick an unused E.164 prefix.** `auth.integration.spec.ts` owns `+371210`. Use **`+371220`** here and
  say so in the same one-line comment style. The test DB is not reset between specs and `users.phone` is unique.
- Cases (all through supertest, real Postgres, in-memory location store):
  1. `GET /drivers/me` on a fresh driver provisions the `drivers` row and returns schema defaults plus an empty
     vehicle list *(expected)* — parse the body with `driverMeSchema`, not `any`.
  2. `POST /drivers/me/vehicles` → 201; the vehicle comes back from `GET /drivers/me/vehicles` *(expected)*.
  3. `PATCH /drivers/me` with `{ spokenLanguages: ['lv','ru'], commissionPctOverride: 0, balanceCents: 999999 }`
     → 200; re-read the row and assert `commissionPctOverride` is still `null` and `balanceCents` still `0`
     *(edge — the privilege boundary, mirroring auth's escalation test)*.
  4. `PUT /drivers/me/status {status:'online'}` with **no** vehicle → 409 `vehicle_required` *(edge)*.
  5. After creating a vehicle, `PUT …{status:'online'}` → 200, `drivers.status === 'online'`, and the driver is in
     `ctx.locations` *(expected)*.
  6. `PATCH /drivers/me/vehicles/:id` for a vehicle belonging to **another** signed-in driver → **404**, and the
     other driver's row is unchanged *(edge — no existence oracle)*.
  7. `PUT /drivers/me/status {status:'on_ride'}` → 400 `validation_failed` *(failure)*.
  8. A **rider**-role token on `GET /drivers/me` → 403, not 401 *(failure)*.
  9. `DELETE` the last vehicle while online → 204, `drivers.status === 'offline'`, and the driver is gone from
     `ctx.locations` *(edge)*.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api`
- **SATISFIES**: AC #4, AC #5, AC #7

### UPDATE `.claude/references/realtime-events.md` and `services/api/CLAUDE.md` — Task 19

- **UPDATE** `realtime-events.md`:
  - `driver:location` row — Notes column becomes: inbound handler is `features/drivers/location/driver-location.gateway.ts`;
    identity from the JWT; **the server stamps `at` and ignores the client's**; positions live in a Redis GEO set
    with a `DRIVER_LOCATION_TTL_SECONDS` read-time freshness window; the rider fan-out during an active ride
    arrives with #11.
  - Add one bullet under **Rules**: `@SubscribeMessage` handlers live in the owning feature slice, on an
    options-less `@WebSocketGateway()` that shares the realtime slice's authenticated server — never a second
    server, never a second `afterInit`.
  - **GOTCHA**: the file's own rule 26 says the source of truth is `RT` + the payload schemas in shared. This edit
    adds **no** event and changes **no** payload — documentation only.
- **UPDATE** `services/api/CLAUDE.md`:
  - Amend the slice list: note that `vehicles` lives **inside** `drivers/` (a vehicle belongs to a driver; the FK
    is `drivers.user_id`), so the menu entry is not a separate slice.
  - Add: "Live driver positions go through `DRIVER_LOCATION_STORE` (a Redis GEO port in the drivers slice) — the
    location ping path must never inject `DRIZZLE`."
  - Add: "`drivers.status = 'on_ride'` is written only by the ride lifecycle (#11); the driver-facing presence
    route accepts `online`/`offline` only."
- **VALIDATE**: `grep -n "driver:location" .claude/references/realtime-events.md`
- **SATISFIES**: AC #6

### RUN the full gate — Task 20

- **IMPLEMENT**: execute every command in VALIDATION COMMANDS, levels 1→5, and fix what falls out.
- **GOTCHA**: `pnpm check` is **weaker than CI** — it omits `build` and rides a warm `dist`
  (`.claude/reports/api-auth-realtime-gateway-report.md`, Issues 5). Run the parity command too.
- **VALIDATE**: `pnpm check` **and** `pnpm turbo run typecheck lint test build --force`
- **SATISFIES**: AC #5

---

## TESTING STRATEGY

Frameworks are fixed by the packages: **vitest** in `@taxi/shared` (`tests/**/*.test.ts`), **jest + ts-jest** in
`@taxi/api` (`rootDir: src`, `testRegex: .*\.spec\.ts$`, `globalSetup` drops/creates/migrates/seeds
`taxi_api_test`).

### Unit Tests

- `packages/shared/tests/driver.test.ts` — the four new schemas, pure zod, no I/O.
- `services/api/src/features/drivers/location/driver-location.service.spec.ts` — the hot path in isolation, with
  the throwing-`DRIZZLE` proxy that turns AC #2 into an executable assertion. This is the most valuable spec in
  the ticket: it fails the day someone adds a Postgres write to the ping path.

### Integration Tests

- `drivers.integration.spec.ts` — real Postgres via `createTestApp()`, the full guard stack, all seven routes.
- `driver-location.gateway.spec.ts` — a real Socket.IO server on an ephemeral port; proves the second gateway
  inherits the handshake and that the emit reaches the dispatch room.
- `redis-driver-location.store.spec.ts` — **opt-in** (`REDIS_TEST_URL`), the only place real `GEOADD`/`GEOSEARCH`
  run. Skipped by default exactly like `redis-kv.store.spec.ts`, because :6379 is taken on the dev machine.

### Edge Cases

Every one of these has a named test above:

1. Offline driver's straggler ping → refused by the Lua gate, nothing stored, nothing emitted.
2. Position older than the freshness window → excluded from `findNearby` even though the GEO member still exists.
3. Driver never marked online → `record()` returns `false`.
4. Ping from a rider-role socket → ignored (role check before parse).
5. Malformed ping (bad lat, bad `at`) → ignored, socket stays connected.
6. Client-supplied `at` in the past/future → ignored for storage; server clock wins.
7. Profile PATCH carrying `commissionPctOverride` / `balanceCents` → stripped by the schema, absent from the
   repository's column allowlist, columns unchanged.
8. `status: 'on_ride'` from a driver → 400 at the contract.
9. Presence toggle while `on_ride` → 409, `#11` keeps ownership of that transition.
10. Going online with zero vehicles → 409 `vehicle_required`.
11. Deleting the last vehicle while online → forced offline in both stores.
12. Mutating another driver's vehicle → 404 (never 403 — no existence oracle).
13. Non-UUID `:id` → 400, not a Postgres 500.
14. `findMatchAttributes([])` → `[]` without hitting the database (drizzle would compile a harmless
    `where false`, but the round trip is wasted on a hot path).
15. Empty PATCH body → 400 rather than Drizzle's `.set({})` throw.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 0: Prerequisites (once, before Task 5b — the spike already runs the jest suite)

```bash
docker compose up -d --wait db          # postgres+postgis; the api `pretest` also does this
cp -n .env.example .env                 # if you have no .env yet
```

If `localhost:5432` / `6379` are shadowed on this machine (a brew Postgres and an ssh tunnel are known to shadow
them here), point `DATABASE_URL` at the LAN IP of the docker Postgres and set `REDIS_PORT=6381` +
`REDIS_URL=redis://localhost:6381` in `.env` — `docker-compose.yml` reads `REDIS_PORT`.

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/shared typecheck
pnpm --filter @taxi/shared build          # driverMeSchema's new intra-package import must not cycle
pnpm --filter @taxi/api typecheck
pnpm --filter @taxi/api lint              # no-unsafe-* are ERRORS; the GEOSEARCH narrowing must be clean
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
```

### Level 3: Integration Tests

```bash
pnpm turbo run test --filter @taxi/api    # NOT `pnpm --filter @taxi/api test` — that skips ^build and
                                          # global-setup.ts fails on the stale dist
```

### Level 4: Full Gate

```bash
pnpm check
pnpm turbo run typecheck lint test build --force    # true CI parity — cold dist, includes `build`
```

### Level 5: Manual Validation (live server)

```bash
docker compose up -d --wait db redis
pnpm --filter @taxi/api dev
```

```bash
# 1. sign in as a driver (the stub SMS provider logs the code to the api console)
curl -s localhost:3001/auth/otp/request -H 'content-type: application/json' \
  -d '{"phone":"+37122000001","role":"driver"}'
TOKEN=$(curl -s localhost:3001/auth/otp/verify -H 'content-type: application/json' \
  -d '{"phone":"+37122000001","code":"<from the log>"}' | jq -r .accessToken)

# 2. profile provisioning + vehicle
curl -s localhost:3001/drivers/me -H "authorization: Bearer $TOKEN" | jq
curl -s -X POST localhost:3001/drivers/me/vehicles -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"plate":"AB1234","make":"Skoda","model":"Octavia","year":2019,"passengerSeats":4,"hasChildSeat":true}' | jq

# 3. go online  → expect 200 (and 409 vehicle_required if you skip step 2)
curl -s -X PUT localhost:3001/drivers/me/status -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"status":"online"}' | jq

# 4. ping a position over the socket, then read Redis directly
node -e "const {io}=require('socket.io-client');const s=io('http://localhost:3001',{auth:{token:process.env.TOKEN},transports:['websocket']});s.on('connect',()=>{s.emit('driver:location',{location:{lat:56.9512,lng:24.1136},at:new Date().toISOString()});setTimeout(()=>process.exit(0),500)})"

redis-cli ZRANGE  "drivers:geo:00000000-0000-4000-8000-000000000001" 0 -1     # the driver id
redis-cli GEOPOS  "drivers:geo:00000000-0000-4000-8000-000000000001" "<driverId>"
redis-cli SMEMBERS "drivers:online:00000000-0000-4000-8000-000000000001"

# 5. go offline → all three keys must drop the driver
curl -s -X PUT localhost:3001/drivers/me/status -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"status":"offline"}' | jq
redis-cli ZRANGE "drivers:geo:00000000-0000-4000-8000-000000000001" 0 -1      # empty

# 6. AC 2, by hand: no Postgres write on the ping path
psql "$DATABASE_URL" -c "select userid, status from drivers;"   # unchanged across step 4
```

**Also verify by eye:** the api console shows `DriverLocationGateway subscribed to the "driver:location" message`
exactly **once** at boot (twice would mean two servers) and one `driver.location.*` log line per ping.

### Level 6: Real-Redis suite (optional but recommended before the PR)

```bash
REDIS_PORT=6381 docker compose up -d --wait redis
REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run test --filter @taxi/api
# expect: redis-kv.store.spec.ts AND redis-driver-location.store.spec.ts green rather than skipped
```

---

## ACCEPTANCE CRITERIA

Issue #8's three ACs, expanded into checkable items:

- [ ] **AC #1a (expected)** — nearest-driver query returns the expected order under a seeded fixture, verified
      against **both** the in-memory fake and (opt-in) real Redis `GEOSEARCH`, via one shared contract test.
- [ ] **AC #1b (edge)** — the query excludes offline drivers (removed from the GEO set by `markOffline`) and
      excludes drivers whose last ping is older than `DRIVER_LOCATION_TTL_SECONDS`.
- [ ] **AC #1c (failure)** — malformed pings are rejected: nothing stored, nothing emitted, socket stays
      connected, one `driver.location.ping_rejected` warning logged.
- [ ] **AC #2** — the location write path touches Redis only, asserted by booting `DriverLocationService` with a
      `DRIZZLE` provider that throws on any property access.
- [ ] **AC #3** — `pnpm --filter @taxi/api dev` boots and `/health` still returns 200.
- [ ] **AC #4** — driver profile + vehicle CRUD works end to end, including the attributes #10 and #17 depend on
      (`isFemale`, `hasChildSeat`, `category`, `passengerSeats`).
- [ ] **AC #5** — `pnpm check` green, **and** `pnpm turbo run typecheck lint test build --force` green.
- [ ] **AC #6** — ≥1 expected + 1 edge + 1 failure case per concern (profile/vehicles, presence, location),
      readable straight off the test titles.
- [ ] **AC #7** — no privilege leak: a driver cannot write `balanceCents`, `commissionPctOverride`, `rating`,
      `fleetId`, or `status: 'on_ride'`, and cannot touch another driver's vehicle.
- [ ] `packages/shared` still imports nothing from the workspace; no contract is duplicated in `services/api`.
- [ ] No new Drizzle migration, no `ride_tracks` table (deferred to #11 — see Non-Goals).
- [ ] `.claude/references/realtime-events.md` and `services/api/CLAUDE.md` updated.

---

## COMPLETION CHECKLIST

- [ ] All 21 tasks completed in order (1–20, plus the **5b spike** which runs before 6)
- [ ] Task 5b's stop condition was evaluated, not skipped — an unauthenticated socket is still refused
- [ ] Each task's `VALIDATE` command passed immediately after that task
- [ ] All validation commands executed successfully (levels 1–5; level 6 recommended)
- [ ] Full test suite passes (shared vitest + api jest)
- [ ] No typecheck or lint errors (`no-unsafe-*` clean on the GEOSEARCH narrowing)
- [ ] Manual Level-5 walkthrough confirms Redis keys appear on ping and vanish on offline
- [ ] Acceptance criteria all met
- [ ] Implementation report written to `.claude/reports/api-drivers-slice-report.md`

---

## OPEN QUESTIONS / ASSUMPTIONS

**Resolved with Linards, 2026-08-05** (recorded so the execution agent does not reopen them):

1. **Trip tracks → deferred to #11.** No `ride_tracks` table, no migration in this ticket.
2. **One `drivers/` slice, vehicles inside it.** The `services/api/CLAUDE.md` slice menu is amended in Task 19
   rather than obeyed.

**Assumptions this plan makes** — each would change the plan if wrong:

3. **Single city.** `env.DEFAULT_CITY_ID` is the city for every Redis key and every dispatch-room emit, matching
   how `RealtimeGateway` already places dispatchers (`realtime.gateway.ts:90`). A second city would need the city
   resolved per driver, which is a geozone lookup and therefore #10's problem.
4. **A driver must have ≥1 vehicle to go online** (and deleting the last one forces them offline). *This is a
   judgment call, not something #8 asked for.* Rationale: `auto_match` filters on `category` and `hasChildSeat`,
   both vehicle attributes, so an online driver with no vehicle is a candidate #10 can only ever discard. If you
   would rather ship without it, delete the two `ConflictException` branches in Task 11 and integration cases 4
   and 9 — nothing else depends on it.
5. **Presence is authoritative in Redis for the ingest path.** Postgres `drivers.status` stays the durable record
   (admin #20, stats), but a ping never reads it. A Redis flush therefore makes every driver undispatchable until
   they re-toggle. Acceptable at pilot scale; the alternative (reconciling from Postgres on boot) is real
   complexity for a ~10-driver pilot and is noted as a follow-up trigger in NOTES.
6. **60 s freshness window.** Long enough to survive a tunnel or a traffic-light signal gap, short enough that a
   dead phone leaves dispatch within a minute. It is a constant precisely so #10 can tune it against real data.
7. **The nearest query returns raw proximity, not eligibility.** If #10's plan turns out to want one call that
   already filters, that is a thin addition on top of `findNearest` + `findMatchAttributes` — no rework.

**Still open (does not block execution):**

8. `findMatchAttributes` aggregates in JS rather than SQL. Correct and readable for ≤10 drivers; if #10's cascade
   turns out to call it per offer, move the aggregation into the query. Flagged, not solved.

---

## NOTES (open canvas)

### Why a slice-owned port and not `KeyValueStore` + GEO methods

`common/kv/kv.store.ts` says out loud what it is: "the narrow slice of Redis this service actually uses… the OTP
store's contract is five methods instead of all of ioredis." Bolting `geoadd`/`geosearch` onto it would make it the
generic Redis wrapper its own docblock rejects, and it would push driver-domain knowledge into `common/`. A
slice-owned port keeps the drivers domain in `features/drivers/` (VSA), keeps `common/` honest, and gives the
harness a second, independently-overridable seam.

The cost is a third ioredis connection in production. That is unavoidable regardless of where the port lives — the
adapter's sub client is subscribed and cannot serve GEO commands.

### Why presence needs its own Redis set

Rejected alternative: infer presence from GEO-set membership. It cannot work — `markOffline` removes the member,
but the very next `GEOADD` from a straggler ping puts them straight back. There is no "update only if present" form
of `GEOADD` that also handles the going-online case (at online time we do not yet have a position to seed).

Rejected alternative: `SISMEMBER` then `GEOADD` as two commands. Correct in the happy path, and wrong in exactly
the window this codebase already reasons carefully about elsewhere (`auth.service.ts:49-59` on why the OTP cooldown
is *claimed* rather than read-then-set). Five lines of Lua removes the window entirely.

### Why freshness is a read filter, not a key TTL

Redis GEO members are sorted-set members. There is no per-member expiry — `EXPIRE` would evict every driver at
once. The options were a background reaper (a cron, state, a failure mode) or a read-time filter (one extra
`ZRANGEBYSCORE` in the same pipeline). The filter is strictly simpler and has the better failure mode: if the
filter is wrong, drivers are missing from dispatch, which is loud. If a reaper is wrong, dispatch offers rides to
drivers who left, which is silent and lands on the rider.

Follow-up trigger for the ZSET growing unbounded: it only holds drivers who have been online since the last flush,
so at pilot scale it is bounded by the driver roster. Add `ZREMRANGEBYSCORE seenKey -inf <cutoff>` to
`markOffline` if the roster ever passes a few thousand.

### Why no `COUNT` on `GEOSEARCH`

`COUNT n` is applied by Redis *before* our freshness filter, so `COUNT 10` on a set holding 8 stale positions can
return zero usable drivers while a live one sits 200 m away. Radius-bounding plus a post-filter is correct at any
scale; it is merely *inefficient* at large scale. The scaling fix, when the pilot outgrows it, is to move freshness
into Redis (a second GEO set rotated per minute, or `GEOSEARCHSTORE` into a temp key intersected with the fresh
ZSET) — not to add `COUNT`.

### Why the ping path must not read Postgres for presence

This is the whole ticket in one line. The obvious implementation of "is this driver online?" is
`SELECT status FROM drivers WHERE user_id = $1`, once per ping. Ten drivers at one ping every four seconds is
~9,000 queries an hour, growing linearly with the roster, for a fact that changes twice a shift. Putting presence
in Redis is not an optimization — it is what makes AC #2 statable at all.

### Rejected: auto-offline on socket disconnect

Tempting, and wrong. A driver in a tunnel, a phone switching from LTE to Wi-Fi, an app backgrounded by iOS — all
produce disconnects, and all resolve in seconds. Flipping the durable status on each one produces a `drivers.status`
column that thrashes, an audit trail full of noise, and a driver who has to re-toggle constantly. The freshness
window achieves the dispatch-correctness goal (they stop receiving offers) without touching the durable record.

### Request/response surface, in one table

| Method | Path | Role | Body | Success | Notable failures |
|---|---|---|---|---|---|
| GET | `/drivers/me` | driver | — | 200 `DriverMe` | 403 non-driver |
| PATCH | `/drivers/me` | driver | `driverProfileUpdateSchema` | 200 `DriverProfile` | 400 empty/invalid |
| PUT | `/drivers/me/status` | driver | `driverStatusUpdateSchema` | 200 `DriverProfile` | 400 `on_ride`; 409 `vehicle_required`; 409 `driver_on_ride` |
| GET | `/drivers/me/vehicles` | driver | — | 200 `Vehicle[]` | — |
| POST | `/drivers/me/vehicles` | driver | `vehicleCreateSchema` | 201 `Vehicle` | 400 invalid |
| PATCH | `/drivers/me/vehicles/:id` | driver | `vehicleUpdateSchema` | 200 `Vehicle` | 404 not-yours-or-missing |
| DELETE | `/drivers/me/vehicles/:id` | driver | — | 204 | 404 not-yours-or-missing |

### Data flow of one ping

```
driver app  --socket 'driver:location' {location, heading?, at}-->  DriverLocationGateway
                                                                     | role check (socket.data.user)
                                                                     | driverLocationPingSchema.safeParse
                                                                     v
                                                            DriverLocationService.ingest(sub, ping)
                                                                     |
                                    Date.now() -----------------------+
                                                                     v
                                            DriverLocationStore.record(cityId, sub, loc, atMs)
                                                                     |  Lua: SISMEMBER online?
                                                                     |       GEOADD  drivers:geo:<city>
                                                                     |       ZADD    drivers:seen:<city>
                                                          false <----+----> true
                                                            |                 |
                                              log ping_ignored     RealtimeService.emitToDispatch(
                                                                     cityId, RT.driverLocation,
                                                                     {driverId, location, heading?, at: ISO})
                                                                          |  RT_EVENT_SCHEMAS.parse
                                                                          v
                                                                   room dispatch:<cityId>  →  Dina's board (#18)
```

Postgres appears nowhere on that path. That is the assertion.

### Sequencing note for the epic

#8 and #9 are marked parallel in the epic's Wave 4. They touch disjoint packages inside `services/api`
(`features/drivers/` vs `features/rides/`) but **both** edit `app.module.ts` and **both** may add to
`packages/shared`. The playbook's hygiene rule ("never two execute sessions in the same package") means: run them
sequentially, or in worktrees and accept a two-line merge in `app.module.ts` and the shared barrel.

### How the top risks were bought down

The four things most likely to cost a second pass, and what in this plan removes each:

| Risk | Why it was dangerous | Mitigation in the plan |
|---|---|---|
| A second `@WebSocketGateway()` might fork its own **unauthenticated** server | Statically verified only, and the failure is silent — an open socket, not an error. Discovering it late invalidates Tasks 13–15 | **Task 5b** proves it at runtime in ~40 lines *before* anything depends on it, with an explicit stop condition and the fallback architecture named |
| lat/lng transposition in `GEOADD` / `FROMLONLAT` / the `WITHCOORD` reply | Both orders are *valid* coordinates near Rīga, so a swap throws nothing and silently mis-ranks every candidate. A consistent swap on read+write is invisible to a round-trip test | Fixture in Task 16 is built so an east and a north offset **invert rank** under transposition (607 m vs 889 m becomes 1,111 m vs 813 m), plus a centre round-trip case for write-only swaps. Full `findNearby` body given literally with the order commented at each of the three sites |
| `geosearch` returns `unknown[]` under `no-unsafe-*` errors | Easy to "fix" with `any`, which lint rejects, costing a round of churn | Complete method body supplied, already clean under `noUncheckedIndexedAccess` + `recommendedTypeChecked`, including pipeline error handling |
| "Redis only" being aspirational | A prose AC nobody can fail | `DriverLocationService` takes no `Db`, and its spec boots the path with a `DRIZZLE` proxy that throws on any property access — the assertion fails the day someone adds a Postgres read |

### Confidence

**9.5 / 10** for one-pass execution.

What the remaining 0.5 is: the two integration specs assert *absence* over an async socket handler (nothing
recorded, nothing emitted), and absence assertions are the classic place to write a test that passes because it
raced rather than because the code is right. Task 17 says to await a round trip rather than assert synchronously,
but the implementer still has to get that right. Everything else in the ticket is either mechanically specified,
covered by an existing in-repo pattern, or proven at runtime by Task 5b before it can propagate.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. -->

- 2026-08-05 — plan hardened before execution: added the **Task 5b** shared-gateway spike (converts the
  multi-gateway assumption from a static reading to a runtime proof, with a stop condition); rebuilt the Task 16
  fixture so a lat/lng transposition inverts the expected order; supplied `findNearby` as literal
  lint-clean code; added the online-but-never-pinged and centre-round-trip contract cases; added the
  `@Get(':id')`-shadows-`me` guard. Confidence 9 → 9.5.
