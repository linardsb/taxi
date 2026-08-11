# Feature: `mint:ride` — a dev script that mints a live tracked ride and counts paid route calls per cell crossing

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

A standalone dev script, `services/api/scripts/mint-tracked-ride.ts`, run via `pnpm --filter @taxi/api mint:ride`, that:

1. Boots the real `AppModule` **in-process** against the dev database and dev Redis, on its own ephemeral port.
2. Drives the full booking chain over the real wire: OTP sign-in (rider + driver) → vehicle → online presence → `POST /rides` → dispatch sweeper offers → driver accepts over Socket.IO + REST.
3. Walks the driver **due north** along one longitude column in exact `0.001°` latitude steps, so each step crosses exactly one `TRACKING_ETA_GRID_DECIMALS = 3` cell boundary.
4. Polls `GET /track/:token` five times per cell (modelling the dispatch tracking page's 5 s poll) and counts `geo.maps.route_fetched` events filtered to `caller: 'eta'`.
5. Asserts **one paid route call per cell crossing, zero per sub-cell poll**, and prints the arithmetic.

This is the artefact that closes #94's Level 4 step 3 — "confirm a SINGLE `geo.maps.route_fetched` per cell crossing rather than one per poll" — which has been unverifiable across three tickets.

## User Story

As the engineer validating the maps seam
I want a single command that produces a live, accepted, GPS-moving ride and counts the paid route calls it costs
So that the <€100/mo budget guardrail is verified by observation rather than asserted by a spec that stubs the very thing it measures

## Problem Statement

`geo.maps.route_fetched` is the maps seam's own success condition, and it has never been observed against a running system:

- **#87** could not run the check — no counter existed.
- **#94** built the counter (`caching-maps.provider.ts:264-271`) but shipped without exercising it live.
- **#100** shipped the 429 client handling without it.

It stays open for one concrete reason: **the dev database has no tracking token**. Tokens are minted by `mintTrackingToken()` inside the booking flow (`tracking.service.ts:47`), never by the seed. Without a token there is no `GET /track/:token`, so there is no ETA path, so there is nothing to count. The integration spec proves the behaviour against `InMemoryKeyValueStore` and a fake maps source — which is exactly the arrangement that cannot answer "does this hold against real Redis, with real TTLs, in a real process".

## Solution Statement

Ship the means to produce the observation. The script boots the real app in-process, captures Nest's log payloads **as objects** via `Logger.overrideLogger()`, and uses one capture stream for both jobs the log stream has to do: reading the stub OTP and counting paid route calls.

The driver walk is deliberately geometric — a fixed longitude column, exact `0.001°` latitude steps — so the expected call count is arithmetic, not an estimate.

## Out of Scope / Non-Goals

- **Not** a test. It does not run under jest, is not part of `pnpm turbo run typecheck lint test build`, and asserts nothing in CI. It is a manual Level 4 instrument.
- **Not** a load or spend benchmark. It verifies the *invariant* (one call per crossing), not the *rate* (crossings per minute). See "On the heading arithmetic" in NOTES.
- **Not** changing `CachingMapsProvider`, `TrackingService`, `notifications.policy.ts`, or any counter/cache behaviour. If the script finds a defect, that is a separate ticket.
- **Not** replacing `tracking.integration.spec.ts`. The spec keeps its own coverage; this observes what the spec's fakes cannot.
- **Not** wiring a Google Routes provider. `MAPS_PROVIDER_SOURCE` stays `StubMapsProvider` in dev (`geo.module.ts:21-28`) — the cache, the counter and the grid are what is under observation, and all three are provider-agnostic.
- **Not** touching `apps/dispatch`. The 5 s poll is *modelled* by the script's loop, not driven by a browser.

## Feature Metadata

**Feature Type**: New Capability (dev tooling)
**Estimated Complexity**: Medium — the logic is linear, but it spans auth, sockets, dispatch timing, Redis cache state and process lifecycle
**Primary Systems Affected**: `services/api` (new `scripts/` dir, package scripts, build/lint config). No `src/` behaviour changes.
**Dependencies**: `socket.io-client@4.8.3` (already a devDependency of `@taxi/api`), `ts-node` + `tsconfig-paths` (already present)

## Related Work

**Implements**: #94 Level 4 step 3 (no dedicated issue — created from the free-form request; open one if you want a `Closes #` link)
**Epic**: maps seam hardening — `.claude/plans/harden-maps-seam-spend-controls.md`

**Back-references**:

- `.claude/plans/tracking-eta-maps-quantized-cache.md` — #87, introduced `TRACKING_ETA_GRID_DECIMALS` and the quantized cache this script measures
- `.claude/plans/harden-maps-seam-spend-controls.md` — #94, built the `geo.maps.route_fetched` counter and the negative cache
- `.claude/plans/dispatch-tracking-429-throttle-ux.md` — #100, the token throttle the script must stay under

**Forward-references**:

- (none yet) — #13/#16 (real Google Routes provider) should re-run this script as its own Level 4 evidence

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `services/api/src/features/notifications/tracking/tracking.integration.spec.ts` (lines 102-271) — Why: **the model for this whole script**. `signIn` / `onlineDriver` / `acceptedRide` / `moveDriver` / `view` are the proven chain. Mirror the sequence, not the harness.
- `services/api/src/features/geo/caching-maps.provider.ts` (lines 208-295) — Why: the `geo.maps.route_fetched` payload shape (`event`, `caller`, `cell`, `distanceMeters`, `durationSeconds`, `at`) and the emit-before-cache-write ordering. `cell` is the sha256-derived corridor id the script asserts distinctness on.
- `services/api/src/features/geo/caching-maps.provider.ts` (lines 81-103) — Why: `routeCacheKey()` / `routeFailureKey()` are **exported**; the script deletes exactly these keys for its planned cells so a re-run inside the 300 s TTL cannot silently report zero.
- `services/api/src/features/notifications/notifications.policy.ts` (lines 29-57) — Why: `TRACKING_ETA_GRID_DECIMALS = 3`, the anisotropy docblock, and the heading figures the report must quote rather than re-derive.
- `services/api/src/features/notifications/notifications.policy.ts` (lines 104-106) — Why: `TRACKING_VIEW_MAX_PER_WINDOW = 120` / `TRACKING_VIEW_WINDOW_SECONDS = 60` — the budget the poll loop must provably stay under.
- `services/api/src/features/notifications/tracking/tracking.service.ts` (lines 109-143, 186-209) — Why: the ETA only runs when `ride.driverId` is set, status is in `ACTIVE_DRIVER_RIDE_STATUSES`, **and** a position is recorded. All three preconditions must hold before a poll can cost a call.
- `services/api/src/features/notifications/notifications.policy.ts` (lines 175-180) — Why: `quantizeForEtaCache` uses `toFixed(3)`, which **rounds**. Cell centres are at `.xxx0`, boundaries at `.xxx5` — the walk must sit mid-cell.
- `services/api/src/features/drivers/location/driver-location.gateway.ts` (lines 93-139) — Why: `handleLocation` **never throws and never acks**. A ping is fire-and-forget; the script cannot assert the write landed the way `moveDriver` does, and must read the position back instead.
- `services/api/src/features/realtime/realtime.gateway.ts` (lines 107-126) — Why: handshake auth is `socket.handshake.auth.token` (bare token, no `Bearer` prefix) or an `authorization` header.
- `services/api/src/features/dispatch/dispatch.sweeper.ts` (lines 45-62) — Why: the interval **does** run when `NODE_ENV !== 'test'`. This is what lets the script wait for an offer instead of calling `tick()`.
- `services/api/src/features/dispatch/dispatch.policy.ts` (line 38) — Why: `SWEEP_INTERVAL_MS = 1_000` sizes the offer wait.
- `services/api/src/features/dispatch/dispatch.controller.ts` (line 37) — Why: `POST dispatch/offers/:offerId/accept`.
- `services/api/src/features/drivers/vehicles.controller.ts` (lines 28-39) — Why: `GET`/`POST /drivers/me/vehicles`. The script must GET first — see the plate-uniqueness gotcha.
- `services/api/src/features/geo/geo.module.ts` (lines 50-95) — Why: two `CachingMapsProvider` instances over one source. `MAPS_PROVIDER` is `caller: 'quote'`, `MAPS_PROVIDER_ETA` is `caller: 'eta'`. **The filter exists because of this.**
- `services/api/src/common/kv/kv.store.ts` — Why: `KV_STORE` token and the `del()` the pre-flight cache clear uses.
- `spikes/stripe-idempotency/double-tap.cjs` — Why: precedent for a standalone driver script's shape, output style and exit-code discipline.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.integration.spec.ts` (lines 29-37) — Why: **the E.164 range registry**. The script claims `+371290` and must register it here.

### New Files to Create

- `services/api/scripts/mint-tracked-ride.ts` — the script (single file; target ≲400 lines, under the ~500 cap)

### Files to Update

- `services/api/package.json` — add the `mint:ride` script entry; widen the `lint` glob to cover `scripts`
- `services/api/tsconfig.build.json` — exclude `scripts` so `nest build` does not emit a dev tool into `dist/`
- `services/api/src/features/rides/lifecycle/ride-lifecycle.integration.spec.ts` — register `+371290` in the range comment

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [NestJS Logger — custom implementation](https://docs.nestjs.com/techniques/logger#custom-logger-implementation)
  - Specific section: extending `ConsoleLogger`, and `Logger.overrideLogger()`
  - Why: the capture mechanism. **Verified empirically against `@nestjs/common@11.1.27` in this repo** — see Patterns below.
- [NestJS Logger — JSON logging](https://docs.nestjs.com/techniques/logger#json-logging)
  - Specific section: the `json: true` `ConsoleLogger` option
  - Why: documented **fallback only**. Confirmed present in 11.1.27 (`console-logger.service.d.ts:24`). Not the chosen route — in-process capture needs no serialization at all.
- [socket.io-client — handshake auth](https://socket.io/docs/v4/client-options/#auth)
  - Specific section: the `auth` option
  - Why: `io(url, { auth: { token } })` is what `realtime.gateway.ts:109` reads.
- [socket.io-client — `io.on('connect_error')`](https://socket.io/docs/v4/client-socket-instance/#connect_error)
  - Why: a rejected handshake surfaces here, not as a thrown error. Without a listener the script hangs silently on a bad token.

### Patterns to Follow

**Log capture — VERIFIED, not assumed.** Probed against `@nestjs/common@11.1.27` in this worktree. The payload arrives as the **first** argument, still an object; context follows in the rest args; a logger constructed *after* the override is still intercepted:

```ts
class CapturingLogger extends ConsoleLogger {
  readonly events: Record<string, unknown>[] = [];
  log(message: unknown, ...rest: unknown[]): void {
    if (typeof message === 'object' && message !== null) {
      this.events.push(message as Record<string, unknown>);
    }
    super.log(message as string, ...(rest as string[])); // tee — keeps the run debuggable
  }
}
```

`super.log(...)` is **load-bearing, not tidiness**: without the tee, a run where the offer never arrives prints nothing at all and is undiagnosable.

**Why NOT stdout parsing (the decision the request asked for).** Nest 11's default `ConsoleLogger` renders object payloads as ANSI-coloured, multi-line `util.inspect` output — *not* JSON. Probed output:

```
[Nest] 66182  - 11/08/2026, 22:26:49     LOG [CachingMapsProvider] Object(6) {
  event: 'geo.maps.route_fetched',
  caller: 'eta',
  ...
}
```

Single-quoted keys/values, colour escapes, one record spanning seven lines. Line-oriented `JSON.parse` is impossible and a regex over this is a liability. **In-process capture is therefore the design**, and it happens to satisfy the constraint that drove the question: the same stream yields both the OTP and the counter, because it is the same `CapturingLogger` instance.

**Structured logging** — every payload in this codebase is `{ event, …, at: new Date().toISOString() }` (`logging-standard.md`). The script *reads* these; it emits plain `console.log` report output, not `Logger` events. It is not part of the platform's log surface.

**Standalone script shape** — mirror `spikes/stripe-idempotency/double-tap.cjs`: a top-level `main()`, `process.exitCode = 1` on a failed assertion, everything torn down in a `finally`.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — config, harness, and the capture mechanism

Get the script file executable and the log capture proven before any ride logic exists.

**Tasks:**

- Create `scripts/` with a minimal `mint-tracked-ride.ts` that boots the app in-process with `CapturingLogger` and exits.
- Add the `mint:ride` entry; settle `tsconfig.build.json` and the lint glob.
- Prove the capture works and the run is teardown-clean.

### Phase 2: Core — the booking chain over the real wire

**Depends on:** Phase 1 (needs the booted app and OTP capture)

**Tasks:**

- OTP sign-in for rider and driver, reading the code from the captured `auth.otp.stub_sent`.
- Idempotent vehicle setup, driver online, presence + first position.
- `POST /rides`, then wait for the sweeper's `RT.rideOffer` **matched to our own ride id**, then accept.

### Phase 3: The measured walk

**Depends on:** Phase 2 (needs an accepted ride and a tracking token)

**Tasks:**

- Pre-flight cache clear for the planned cells.
- The walk loop: ping position, confirm it landed, poll N times, tally per-cell.

### Phase 4: The report, the guards, and teardown

**Depends on:** Phase 3

**Tasks:**

- Positive control, distinct-`cell` assertion, arithmetic report, exit code.
- `finally` teardown mirroring the spec's `afterEach`.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### CREATE `services/api/scripts/mint-tracked-ride.ts` (skeleton + capture)

- **IMPLEMENT**: `CapturingLogger extends ConsoleLogger` exactly as in Patterns. `const logger = new CapturingLogger()`, then `const app = await NestFactory.create(AppModule, { logger })`. Bind `app.useWebSocketAdapter(new RedisIoAdapter(...))` mirroring `main.ts:14-16` — the driver socket will not work without it. `await app.listen(0)` for an ephemeral port; read the actual port back via `app.getHttpServer().address()`.
- **PATTERN**: `services/api/src/main.ts:6-21` for the bootstrap sequence; `spikes/stripe-idempotency/double-tap.cjs` for the `main()`/exit-code shape.
- **IMPORTS**: `NestFactory` from `@nestjs/core`; `ConsoleLogger` from `@nestjs/common`; `AppModule` from `../src/app.module`; `RedisIoAdapter` from `../src/features/realtime`; `APP_ENV, type Env` from `../src/common/config/env.schema`.
- **GOTCHA**: `NODE_ENV` must **not** be `test` or the dispatch sweeper never starts (`dispatch.sweeper.ts:56`) and no offer will ever arrive. Do not set it; the env default is correct.
- **GOTCHA**: Port `0` deliberately — the script must be able to run alongside a `pnpm dev` already holding 3001.
- **VALIDATE**: `cd services/api && node -r ts-node/register -r tsconfig-paths/register scripts/mint-tracked-ride.ts` boots and exits 0.
- **SATISFIES**: AC #1

### ADD `mint:ride` to `services/api/package.json`

- **IMPLEMENT**: `"mint:ride": "node -r ts-node/register -r tsconfig-paths/register scripts/mint-tracked-ride.ts"`.
- **PATTERN**: `services/api/package.json` `test:debug` uses the same `-r ts-node/register -r tsconfig-paths/register` pair. Note that `test:debug` is *not* real precedent for this — it runs jest, which compiles through `ts-jest`, not ts-node's own resolver. So this was verified directly instead (below).
- **VERIFIED, do not re-litigate**: a probe file at `services/api/scripts/__probe.ts` doing `import { AppModule } from '../src/app.module'` ran clean under exactly this invocation and resolved `AppModule` as a function — **no `TS_NODE_COMPILER_OPTIONS` override is needed** despite `"module": "nodenext"`. If you nonetheless hit an ESM/`nodenext` resolution error, the escape hatch is `TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}'` prefixed on the script entry — but do not add it pre-emptively.
- **VALIDATE**: `pnpm --filter @taxi/api mint:ride` reaches the same boot-and-exit as the task above.
- **SATISFIES**: AC #1

### UPDATE `services/api/tsconfig.build.json`

- **IMPLEMENT**: add `"scripts"` to `exclude`, giving `["node_modules", "test", "dist", "scripts", "**/*spec.ts"]`.
- **GOTCHA — MEASURED, not predicted. This task is mandatory, and it is the one most likely to be skipped as cosmetic.** `tsconfig.build.json` currently excludes only `node_modules, test, dist, **/*spec.ts`, so `scripts/` falls inside the build. Observed by building this worktree with a file present in `services/api/scripts/`:
  - **before** (no `scripts/`): `dist/main.js` exists.
  - **after** (`scripts/` present, no exclude): `dist/` contains `scripts/` and `src/` — and **`dist/main.js` is gone**, relocated to `dist/src/main.js`.
  - **after adding the exclude**: `dist/main.js` is back.

  The cause is tsc's `rootDir` inference: `tsconfig.json` sets no `rootDir`, so tsc takes the common root of all included files. A second top-level directory moves that root from `src/` up to the package root and re-parents every emitted path. `nest-cli.json`'s `sourceRoot: "src"` does **not** prevent this — `nest build` delegates to tsc with `tsconfig.build.json`. The visible symptom is `start:prod` (`node dist/main`) breaking, with nothing in the build output suggesting why.
- **VALIDATE**: `pnpm --filter @taxi/api build && ls services/api/dist/main.js && ! ls services/api/dist/scripts 2>/dev/null && echo OK`
- **SATISFIES**: AC #6

### UPDATE the `lint` glob in `services/api/package.json`

- **IMPLEMENT**: `"lint": "eslint \"{src,test,scripts}/**/*.ts\""`.
- **GOTCHA**: `tsconfig.json` has **no `include`**, so it already covers `scripts/` — `typecheck` will hold the script to `strict` + `noUncheckedIndexedAccess` from the moment it exists. Lint does not, and leaving one TS file in the package unlinted is a gap, not a saving. Expect to fix real lint findings in the new file.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck lint` green.
- **SATISFIES**: AC #6

### ADD startup diagnostics + the parameter guard

- **IMPLEMENT**: after boot, print the resolved `DATABASE_URL` and `REDIS_URL` **host:port only, credentials stripped**, plus `DEFAULT_CITY_ID` and the chosen port. Then assert `CELLS * POLLS_PER_CELL + 1 <= TRACKING_VIEW_MAX_PER_WINDOW`, printing the arithmetic, and refuse to run if it fails.
- **PATTERN**: `notifications.policy.ts:104-106` for the constants — **import them, never re-type the numbers**.
- **GOTCHA**: this is the seed/connection verification the plan owes. `.env` is not readable by tooling here, and `localhost:5432` is shadowed by a brew Postgres on this machine — so "which database did we actually reach" must be *printed by the running app*, not inferred. Redis is on **6381** in this checkout, while `.env.example` defaults to 6379.
- **GOTCHA**: strip credentials with `new URL(...)` → `${u.hostname}:${u.port}`. Never print the raw URL.
- **VALIDATE**: `pnpm --filter @taxi/api mint:ride` prints e.g. `db=localhost:5432 redis=localhost:6381 city=00000000-…-0001 port=54xxx`.
- **SATISFIES**: AC #2, AC #7

### ADD the OTP sign-in helper

- **IMPLEMENT**: `signIn(phone, role)` — `POST /auth/otp/request`, then read the code from the **captured** `auth.otp.stub_sent` event whose `phone` matches the masked form, then `POST /auth/otp/verify`. Parse with `authSessionSchema`. Poll the capture buffer with a deadline (the send is fire-and-forget).
- **PATTERN**: `tracking.integration.spec.ts:102-110`.
- **IMPORTS**: `authSessionSchema` from `@taxi/shared`; `maskPhone` from `../src/features/auth/phone-mask` for the match.
- **IMPLEMENT (guard)**: immediately after `authSessionSchema.parse`, assert `session.user.role === role` and fail with `phone <masked> is registered as <actual>, not <expected> — pick an unused number in the +371290 range`.
- **GOTCHA**: the payload's `phone` is **masked** (`stub-sms.provider.ts`), so match on `maskPhone(phone)`, not `phone`.
- **GOTCHA — the role guard is not defensive padding.** `auth.service.ts:301` calls `repo.findOrCreate({ phone, role })` and line 308 issues the session with **`user.role` — the persisted row's role, not the requested one.** The role argument only takes effect when the user is *created*. The integration spec never meets this because its users are fresh; this script uses **fixed** phones against a dev DB that already holds 7 users and is never reset. So one earlier run (or one typo) that signed `+371290001` in as a driver permanently makes it a driver, and the failure surfaces much later as a `403` on `POST /rides` naming nothing — exactly the failure mode the E.164 registry comment warns about.
- **GOTCHA**: if `TWILIO_*` are set in `.env`, the real provider is bound and **logs nothing** — no OTP, and the script hangs. Detect the timeout and fail with "no `auth.otp.stub_sent` captured — is the Twilio trio set? unset it for this script".
- **VALIDATE**: script signs both users in, prints their user ids **and roles**, and the printed roles are `rider` and `driver`.
- **SATISFIES**: AC #3, AC #11

### ADD driver setup (idempotent)

- **IMPLEMENT**: `GET /drivers/me/vehicles` first; `POST` the fixed-plate vehicle **only if absent**. Then `PUT /drivers/me/status {status:'online'}`. Then connect the driver socket and emit one `RT.driverLocation` ping at the walk start.
- **PATTERN**: `tracking.integration.spec.ts:116-155`.
- **GOTCHA**: `vehicles_plate_uix` is `UNIQUE btree(upper(plate))` — **globally unique, not per driver**. A fixed plate + unconditional POST fails on the second run. This is the single most likely "worked once, never again" defect.
- **GOTCHA**: presence comes from the socket connection; `driver-location.gateway.ts:60-80` clears it on last-socket disconnect. Keep the socket open for the whole run.
- **VALIDATE**: run twice in a row — both runs reach "driver online" without a 409.
- **SATISFIES**: AC #3

### ADD booking + offer acceptance

- **IMPLEMENT**: `POST /rides` with `IDEMPOTENCY_KEY_HEADER: randomUUID()` and the `CENTRE_PICKUP`/`DESTINATION` body. Take the tracking token straight from the response via `rideCreatedSchema`. Then wait on the driver socket for `RT.rideOffer` **whose `rideId` equals our ride id**, and `POST /dispatch/offers/:offerId/accept`.
- **PATTERN**: `tracking.integration.spec.ts:361-373` (app booking, and line 390 proves an app-booked ride carries a usable token).
- **IMPORTS**: `RT`, `rideOfferEventSchema`, `rideCreatedSchema`, `IDEMPOTENCY_KEY_HEADER` from `@taxi/shared`.
- **GOTCHA**: **the dev DB already holds 5 rides and the sweeper ticks every 1 s over all awaiting ones.** An unfiltered `RT.rideOffer` listener will accept someone else's ride — or consume the driver before ours is offered. Filter on `rideId`; `decline` anything else so it cascades on rather than expiring.
- **GOTCHA**: `pickup` must stay `{lat: 56.96, lng: 24.085}`. Verified against this dev DB: it is contained by `centre` **only** — `old_town` and `autoosta` nest inside `centre`, and `rix` ships `queueModeEnabled: true`, which takes a different dispatch path.
- **GOTCHA**: give the offer wait a generous deadline (≥30 s = 30 sweeps) and, on timeout, fail with the diagnosis — no online driver in range / geozone lookup failed / sweeper not running because `NODE_ENV=test`.
- **GOTCHA**: `rides.geozone_id` is `NOT NULL` from a PostGIS containment lookup. If the seed is missing, `POST /rides` is where it breaks — catch that and print "no geozone contains the pickup → run `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/db seed`". **This is the seed assertion**, made by the running system rather than assumed.
- **VALIDATE**: script prints the ride id, offer id, and a 22-char tracking token.
- **SATISFIES**: AC #3, AC #2

### ADD the pre-flight cache clear

- **IMPLEMENT**: compute the planned cell list up front. For each, `kv.del(routeCacheKey('eta', cell, PICKUP))` and `kv.del(routeFailureKey('eta', cell, PICKUP))`, via `app.get<KeyValueStore>(KV_STORE)`.
- **PATTERN**: `caching-maps.provider.ts:81-103` — both key builders are exported precisely so callers outside the class can address them.
- **GOTCHA**: **without this the script is wrong on its second run within 5 minutes.** `MAPS_ETA_CACHE_TTL_SECONDS = 300` against *real* Redis: the corridors are still warm, every crossing is a hit, the count is 0 — which looks like a spectacular pass and is a false one. The integration spec never hits this because `InMemoryKeyValueStore` dies with the process.
- **GOTCHA**: quantize with `quantizeForEtaCache` and pass the **quantized** origin — that is what `TrackingService.roadEta` hands the seam (`tracking.service.ts:192`). Clearing un-quantized coordinates clears nothing.
- **VALIDATE**: run twice back to back; the second run reports the same counts as the first.
- **SATISFIES**: AC #5

### ADD the measured walk

- **IMPLEMENT**: for each of `CELLS` cells: emit `RT.driverLocation` `{location, at}`; confirm the move landed by polling `GET /track/:token` until `position.lat` matches to 4 dp; then take `POLLS_PER_CELL` further views, recording the `caller:'eta'` event delta per view.
- **PATTERN**: `tracking.integration.spec.ts:684-709` — the sub-cell-hit / crossing-costs-one case this script reproduces live.
- **GOTCHA**: `handleLocation` **never acks and never throws** (`driver-location.gateway.ts:93-139`). The spec's `moveDriver` asserts `record()` returned `true`; the script has no such return. Read the position back through the page — otherwise a silently dropped ping shows up as a mysteriously missing route call several assertions later.
- **GOTCHA**: the confirmation read is itself a poll and **costs a route call on a fresh cell**. Count it as the cell's first view, not as overhead, or the arithmetic will be off by one per cell.
- **GOTCHA**: `quantizeForEtaCache` uses `toFixed(3)`, which **rounds**: cell centres are `.xxx0`, boundaries `.xxx5`. Walk on exact `.xxx0` latitudes so no step lands on a boundary where float representation decides the cell.
- **GOTCHA**: sub-cell jitter, if added, must stay within ±0.0004° lat of the centre. ±0.0002 (~22 m, the spec's figure at line 697) is safe.
- **VALIDATE**: the per-cell table prints `1` for each cell's first view and `0` for every subsequent one.
- **SATISFIES**: AC #4, AC #5

### ADD the positive control and the assertions

- **IMPLEMENT**: **before** any zero-expecting assertion, assert the first cell's first view produced **≥1** `caller:'eta'` event. On failure, abort with "no `geo.maps.route_fetched` captured at all — log interception is broken; this is NOT a cache result." Then assert: total `eta` events `=== CELLS`; `new Set(cell).size === CELLS`; every non-first view added 0; and `caller:'quote'` events `>= 1`.
- **GOTCHA**: **zero is this script's success-looking answer.** If capture silently breaks, "0 calls across 30 polls" reads as a triumphant pass. The positive control must run first and must fail loudly.
- **GOTCHA**: assert on **distinct `cell` values**, not just the total. A total of 6 is also what "one corridor routed 6 times" looks like; `distinct(cell) === CELLS` is what actually proves *one per cell*.
- **GOTCHA**: the `quote >= 1` assertion is not decoration — it proves the `caller` filter is discriminating rather than matching nothing. `POST /rides` pricing routes through `MAPS_PROVIDER` (`caller:'quote'`, `geo.module.ts:52-77`), so exactly one is expected.
- **VALIDATE**: temporarily comment out the `Logger.overrideLogger` call — the script must fail with the interception message, not report a pass. Restore it.
- **SATISFIES**: AC #4, AC #5, AC #8

### ADD the report

- **IMPLEMENT**: print a per-cell table (cell index, quantized lat/lng, `cell` hash, views, eta calls) and a summary naming the heading, the cell dimensions, and both counts with their arithmetic.
- **PATTERN**: the arithmetic style of `notifications.policy.ts:41-46` — state which case each number describes.
- **GOTCHA**: **name the heading.** `0.001°` latitude ≈ 111.3 m; that is the cell's *largest* dimension and therefore the *fewest* crossings per metre driven — the best case for spend. Quote `notifications.policy.ts`'s own figures (~16 s per crossing due N/S, ~8.8 s due E/W, ~7.7 s on the worst heading ~61° off north, ~8.9 s averaged over uniform heading at 417 m/min) rather than deriving fresh metres. State plainly that the script walks due north because the invariant under test is *one call per crossing* — which is heading-independent — not the crossing *rate*, which is not what this measures.
- **VALIDATE**: read the printed summary; every number is either imported from a policy constant or shown with its arithmetic.
- **SATISFIES**: AC #7

### ADD teardown

- **IMPLEMENT**: in a `finally`: cancel the ride (`cancelled_by_system`), reset the driver off `on_ride` back to `online`, `markOffline`, disconnect sockets, `await app.close()`.
- **PATTERN**: `tracking.integration.spec.ts:74-96` — mirror it directly.
- **GOTCHA**: **without this, run 2 fails.** A driver left `on_ride` is never a dispatch candidate again, and the failure surfaces as "no offer arrived" with nothing pointing at the previous run.
- **GOTCHA**: teardown must run on the failure path too, or the first failed run poisons every later one.
- **VALIDATE**: run, force a mid-run failure (bad token), run again cleanly — the second run succeeds.
- **SATISFIES**: AC #9

### UPDATE the E.164 registry

- **IMPLEMENT**: claim `+371290` for the script in the range comment at `ride-lifecycle.integration.spec.ts:29-36`.
- **GOTCHA**: `+371210`…`+371280` are taken (verified by grep across `services/api/src`). `users.phone` is unique across a database that is never reset, so a collision silently reuses another file's user **and its role** — surfacing as a 403 that names nothing.
- **GOTCHA**: use **fixed** phones, not fresh-per-run. Fresh phones mint an unbounded user table in the dev DB, one pair per run.
- **VALIDATE**: `grep -rn "371290" services/api/src` shows both the registry entry and the script's use.
- **SATISFIES**: AC #6

---

## TESTING STRATEGY

This ships **no automated tests**, deliberately — see Non-Goals. The script *is* an instrument, and its correctness is established by the runnability checks below rather than by a spec that would have to fake the very Redis and logger it exists to exercise.

What stands in for tests:

### Self-verification inside the script

- **Positive control** — the first cell must produce ≥1 event before any zero-expecting assertion runs.
- **Filter control** — `caller:'quote'` ≥ 1 proves the `caller` filter discriminates.
- **Distinctness** — `distinct(cell) === CELLS` proves *one per cell*, which a bare total does not.
- **Parameter guard** — the poll budget is checked against `TRACKING_VIEW_MAX_PER_WINDOW` before the run starts.

### Idempotence

Run twice back to back; identical counts. This covers the two re-run defects (warm Redis corridors, and a driver stranded `on_ride`), both of which are invisible on a first run.

### Edge cases the script must survive

- Second run inside the 300 s ETA TTL → pre-flight `del()` (else a false zero).
- A vehicle already existing for the fixed plate → GET-then-POST.
- Someone else's ride offered by the sweeper → `rideId` filter.
- `TWILIO_*` set → no stub OTP; fail with the diagnosis, don't hang.
- Missing seed → `POST /rides` fails on the `NOT NULL` geozone; print the `seed` command.
- Failed mid-run → teardown still runs.

### Regression surface

The gate must stay green with the new file present: `scripts/` newly enters `typecheck` (no `include` in `tsconfig.json`) and `lint` (widened glob), and must stay out of `build` output.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

> **Every command below runs from the worktree and touches Docker or the DB — `COMPOSE_PROJECT_NAME=taxi` is mandatory.** Compose names its project after the directory, so without it a worktree starts a *second* Postgres against the occupied 5432. `services/api`'s own `pretest` runs compose, so even `test` needs it.

### Level 0: Prerequisites

```bash
cd /Users/Berzins/Desktop/taxi-tracking-eta
COMPOSE_PROJECT_NAME=taxi docker compose up -d --wait
pnpm install
# @taxi/shared and @taxi/db resolve through dist package exports — the script
# cannot import them until they are built.
pnpm --filter @taxi/shared --filter @taxi/db build
```

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/api typecheck
pnpm --filter @taxi/api lint
```

### Level 2: Unit Tests

```bash
COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test
```

### Level 3: Full Gate (CI parity)

```bash
cd /Users/Berzins/Desktop/taxi-tracking-eta
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 \
  pnpm turbo run typecheck lint test build --force
# then confirm the build did not absorb the script:
ls services/api/dist/main.js && ! ls services/api/dist/scripts 2>/dev/null && echo "build output clean"
```

### Level 4: Manual Validation — the point of the ticket

Each step is a command with a stated expected output. **No step requires an artefact that does not exist by the time it runs** — that is the rule this ticket exists to enforce.

```bash
cd /Users/Berzins/Desktop/taxi-tracking-eta
```

**Step 1 — the seed assumption, verified not assumed.** Confirms the pickup is contained by exactly one geozone and tariffs exist:

```bash
COMPOSE_PROJECT_NAME=taxi docker compose exec -T db psql -U taxi -d taxi -c \
  "SELECT slug FROM geozones WHERE ST_Contains(polygon, ST_SetSRID(ST_MakePoint(24.085, 56.96), 4326));"
COMPOSE_PROJECT_NAME=taxi docker compose exec -T db psql -U taxi -d taxi -c \
  "SELECT count(*) FROM ride_tariffs;"
```

Expected: exactly one row, `centre`; and `4`. **Already verified in this checkout** — recorded here so the step is reproducible, and so a fresh machine is told what to do (`pnpm --filter @taxi/db seed`) rather than left guessing.

**Step 2 — the script runs at all.**

```bash
pnpm --filter @taxi/api mint:ride
```

Expected: prints resolved `db=host:port redis=host:port city=… port=…`, then the poll-budget arithmetic, then rider/driver ids, ride id, offer id, and a 22-char tracking token.

**Step 3 — THE observation (#94 Level 4 step 3).** Same command; read the report.

Expected, with `CELLS=6`, `POLLS_PER_CELL=5`:

| Quantity | Expected | Why |
|---|---|---|
| `GET /track/:token` views | 30 | 6 cells × 5 polls |
| `geo.maps.route_fetched` `caller:'eta'` | **6** | one per cell, on that cell's first view |
| distinct `cell` values | **6** | proves *one per cell*, not six for one corridor |
| eta calls on views 2–5 of any cell | **0** | the headline property: polling inside a cell is free |
| `geo.maps.route_fetched` `caller:'quote'` | ≥1 | `POST /rides` pricing — proves the filter discriminates |
| unquantized counterfactual | 30 | what one-call-per-poll would have cost |

Reduction at this dwell: **30 → 6, a 5× saving**, and it scales with polls-per-cell, not with anything the grid does. The walk is **due north**: `0.001°` latitude ≈ 111.3 m, the cell's largest dimension — the *fewest* crossings per metre driven. The invariant under test (one call per crossing) is heading-independent; the crossing *rate* is not, and is not what this measures.

**Step 4 — idempotence.** Run Step 2 again immediately.

Expected: identical counts. A second run reporting **0** eta calls means the pre-flight `del()` is not clearing the right keys — that is a script defect, not a cache success.

**Step 5 — the positive control actually controls.** Comment out `Logger.overrideLogger(...)`, run, restore.

Expected: fails with "log interception is broken", **not** a zero-call pass.

**Step 6 — cross-check against the dispatch page (optional).** With `pnpm dev` running, open `http://localhost:3000/t/<token>` from Step 2 while a run is in flight and watch the ETA change per cell. Note the page's own 5 s poll spends against the same 120/60 s token budget.

### Level 5: Additional Validation (Optional)

```bash
COMPOSE_PROJECT_NAME=taxi docker compose exec -T redis redis-cli --scan --pattern 'maps:route:v1:eta:*' | head
```

Inspect the cache entries the run created — one per visited cell, TTL ≤300 s.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — `pnpm --filter @taxi/api mint:ride` boots the real `AppModule` in-process on an ephemeral port and exits cleanly, alongside a running `pnpm dev` if present
- [ ] **AC #2** — The script prints the resolved DB and Redis `host:port` (credentials stripped) and fails with an actionable message naming `pnpm --filter @taxi/db seed` if the pickup has no containing geozone
- [ ] **AC #3** — It drives the full chain over the real wire — OTP sign-in, vehicle, online, `POST /rides`, sweeper offer matched by `rideId`, socket accept — and yields a live 22-char tracking token
- [ ] **AC #4** — It reports `geo.maps.route_fetched` `caller:'eta'` counts per cell, and `distinct(cell) === CELLS` with exactly one call on each cell's first view and zero on every subsequent poll
- [ ] **AC #5** — Two consecutive runs report identical counts (pre-flight cache clear + teardown both work)
- [ ] **AC #6** — `pnpm turbo run typecheck lint test build --force` stays green; `scripts/` is typechecked and linted but absent from `dist/`, and `dist/main.js` still exists
- [ ] **AC #7** — Every number in the report is either an imported policy constant or shown with its arithmetic, and the summary names the heading it describes
- [ ] **AC #8** — With log interception disabled the script fails loudly rather than reporting a zero-call pass
- [ ] **AC #9** — Teardown runs on both the success and failure paths; the driver is left `online`, not `on_ride`
- [ ] **AC #10** — `+371290` is claimed in the E.164 registry and used by the script
- [ ] **AC #11** — Sign-in asserts the returned `session.user.role` matches the requested role and fails with an actionable message if a fixed phone was previously registered under the other role

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] Level 0–3 commands executed successfully with `COMPOSE_PROJECT_NAME=taxi`
- [ ] Level 4 steps 1–5 executed and their outputs recorded in the execution report
- [ ] No linting or type checking errors
- [ ] Acceptance criteria all met
- [ ] The observed counts are pasted into the #94 thread — the artefact this ticket exists to produce

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions (each verified in this checkout unless noted):**

1. **"The DEV server" means the dev config, database and Redis — not the literal `pnpm dev` process.** The script boots the same `AppModule` in-process against the same `.env`, on its own port so it can run alongside one. The only thing not exercised is the `node dist/main` entrypoint, which has no bearing on the counter. *This is the one interpretation worth confirming.*
2. Nest 11 renders object payloads as ANSI multi-line `util.inspect`, not JSON — **probed empirically**, and the reason stdout parsing was rejected.
3. `Logger.overrideLogger()` intercepts loggers constructed afterwards, payload first — **probed empirically**.
4. The dev DB is seeded: `centre` contains `(56.96, 24.085)`; 4 tariffs, 1 city, 1 platform_config — **queried**. The script re-verifies at runtime rather than trusting this.
5. The sweeper runs when `NODE_ENV !== 'test'` at `SWEEP_INTERVAL_MS = 1_000` — **read from source**. This is what removes the need to call `tick()`.
6. `StubMapsProvider` stays bound in dev (`GOOGLE_MAPS_API_KEY` empty). The cache, counter and grid are provider-agnostic, so the observation holds.
7. `offer-builder.ts` makes **no** maps calls — **grepped**. Only pricing (`quote`) and tracking (`eta`) emit `route_fetched`.
8. `socket.io-client@4.8.3` resolves from `services/api` via the hoisted root `node_modules` — **verified with `require.resolve`**.
9. `node -r ts-node/register -r tsconfig-paths/register scripts/<file>.ts` executes and resolves `../src/app.module` under `"module": "nodenext"` — **probed with a throwaway `scripts/__probe.ts`**, which was then deleted. No compiler-options override needed.
10. Leaving `scripts/` inside `tsconfig.build.json` relocates `dist/main.js` to `dist/src/main.js` and breaks `start:prod` — **measured by building this worktree with and without the exclude**, then reverted. Both the probe file and the tsconfig edit were reverted; the worktree carries only this plan.
11. `POST /auth/otp/verify` returns the **persisted** `users.role`, not the requested one (`auth.service.ts:301,308`) — **read from source**. Hence AC #11.

**Open questions:**

1. **Should `mint:ride` be committed at all, or live in `spikes/`?** This plan puts it in `services/api/scripts/` as requested, which pulls it into `typecheck` and (by the widened glob) `lint`. The `spikes/` alternative escapes both. Recommendation: keep it in `services/api/scripts/` — a Level 4 instrument that rots is worse than one held to the gate.
2. **Widening the lint glob** touches a config line beyond the strict request. Called out here rather than done silently; the alternative is one unlinted TS file in the package.
3. `CELLS=6` / `POLLS_PER_CELL=5` are chosen to be legible and to sit far under the 120/60 s throttle (31 of 120). Both should be CLI-overridable; the parameter guard makes an over-large choice fail with arithmetic rather than a confusing 429.

---

## NOTES (open canvas)

### The design decision the request asked for: spawn, or consume the stream?

**Neither — boot in-process.** The request framed it as a binary, and the empirical finding collapses the binary:

| Approach | Verdict |
|---|---|
| Spawn `node dist/main`, parse stdout | **Rejected.** Nest 11 emits ANSI-coloured multi-line `util.inspect`, not JSON. One record spans seven lines with single-quoted values. A regex over this would be the most fragile thing in the repo. |
| Consume an already-running dev server's stream | **Rejected.** You cannot attach to another process's stdout on macOS. It would need `pnpm dev \| tee`, a two-terminal ritual, and a file-tail race at startup — and it still lands on the same unparseable format. |
| Spawn a child with `ConsoleLogger({json:true})` | **Rejected, but viable.** Confirmed present in 11.1.27. Needs a `main.ts` change to gate on an env var — production code edited for a dev script, to buy serialization we then have to undo. |
| **Boot `AppModule` in-process with a capturing logger** | **Chosen.** Payloads arrive as objects. No parsing, no ANSI, no format coupling. One `CapturingLogger` instance serves both jobs the stream had to do — the OTP *and* the counter — which is exactly the coupling the request identified, resolved rather than worked around. |

The constraint that drove the question ("the SAME stream is what counts `route_fetched`") is what makes in-process capture correct: it is genuinely one stream, and now a structured one.

### On the heading arithmetic

`TRACKING_ETA_GRID_DECIMALS = 3` at Rīga's ~57°N gives an **anisotropic** cell: ~111 m N/S, ~61 m E/W (`notifications.policy.ts:41-46`). The script walks **due north** in exact `0.001°` latitude steps, so:

- Each step traverses ~111.3 m — the cell's **largest** dimension, the **fewest** crossings per metre driven, the **best** case for spend.
- Per the policy docblock, at 417 m/min a crossing costs one call per ~16 s due N/S (**best**), ~8.8 s due E/W, ~7.7 s on the worst heading (~61° off north), ~8.9 s averaged over uniform heading.

**The script does not measure that cadence, and must not be read as doing so.** The invariant under test is *one paid call per cell crossing*, which is heading-independent. Due north is chosen because it makes each step cross exactly one boundary, so the expected count is arithmetic rather than an estimate. #87 shipped a best-case interval labelled worst-case; this plan states which case every number describes, and the script's report must too.

### Why the sub-cell assertion is the fragile half

The headline claim — "polls inside one cell are free" — expects **zero**. Zero is also what a broken counter, a broken logger override, a warm cache, and a driver who never moved all produce. Four failure modes, one indistinguishable output. Hence three separate guards, all of which must run *before* any zero is trusted:

1. **Positive control** — cell 1 view 1 must be ≥1, or abort naming the interception.
2. **Distinct `cell`** — six calls to one corridor is not six cells.
3. **Pre-flight `del()`** — a warm corridor from a run four minutes ago is the most likely false pass, and the one the integration spec structurally cannot experience.

### What this cannot tell us

`StubMapsProvider` is what answers `route()`. The script verifies the **cache/grid/counter** contract — how many times the seam would have reached a paid provider — not Google's latency, quota behaviour, or billing. #13/#16 should re-run this script as its own Level 4 evidence once the real provider is bound; the counter is provider-agnostic by construction, so the same command should answer the same way.

### Sequencing note

The four config edits (`mint:ride`, `tsconfig.build.json`, lint glob, E.164 registry) are independent of each other and of the script body. Only `tsconfig.build.json` gates the full build, so land it before running Level 3.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. -->
