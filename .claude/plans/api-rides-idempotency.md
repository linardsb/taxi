# Feature: `Idempotency-Key` on POST /rides

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

`POST /rides` gains a **required, client-generated `Idempotency-Key` header**. Two requests carrying the same key from the same rider produce **one** ride: the first creates it, every repeat inside the window returns the same `RideCreated` payload. The header name and its key schema live in `@taxi/shared` as the cross-surface contract; the API imports them and duplicates nothing.

## User Story

As a **rider whose thumb slipped on "Book"** (or whose phone retried on a flaky LTE hop)
I want **the second tap to return the ride I already have**
So that **one car comes to my kerb, and I am charged for one ride**

## Problem Statement

`RidesService.request` (`services/api/src/features/rides/rides.service.ts:49`) deduplicates nothing. A double-tap creates two `rides` rows at `requested`, each with its own `orderId`. The second tap is *cheap* — `CachingMapsProvider` already holds the route — so no cost signal, no cache miss, and no rate limit stops it.

**#10 shipped first, so this is now worse than a duplicate row.** `DispatchSweeper.tick()` picks up every `requested` ride with no driver (`RidesRepository.findAwaitingDispatch`, `rides.repository.ts:151`). Two rows = two offer cascades = **two cars to one kerb**, two drivers who each declined a real fare to take it, and a manual cleanup in Dina's console.

Two things that already landed and do **not** fix this:

- The #45 review PR wrapped the post-commit side effects (`notifyRider`, `rides.service.ts:147`) so a socket failure logs `ride.request.notify_failed` and still returns the committed ride. That closes *retry-after-500* — a rider who got a 500 and re-tapped — but a genuine double-tap never had an error to begin with.
- `RIDE_REQUEST_MAX_PER_WINDOW` (`rides.policy.ts:14`) bounds the **cost** of 20 repeats. It does not merge them. Twenty taps are twenty rides.

## Solution Statement

**Option B from the issue.** A client mints one UUID per booking attempt and sends it as `Idempotency-Key`. The server:

1. **Reserves** `rides:idem:<riderId>:<key>` atomically (`SET NX EX`) with a `pending` marker.
2. **Reservation won** → quote, create, then overwrite the marker with the new ride id.
3. **Reservation lost** → read the key. A ride id means replay: re-read the ride from Postgres and return it. The `pending` marker means the first request is still in flight → `409 idempotent_request_in_progress`.
4. **Anything throws** → release the key, so a rider whose first attempt died on a maps outage is not locked out for the whole window.

The atomic reserve is the whole fix. A `get`-then-`set` would let two simultaneous taps both read `null` and both create — reproducing the exact bug, which is why `incrWithTtl` is INCR-then-check rather than GET-then-INCR (`rides.service.ts:115`). Same hazard, same answer.

**Why B over A** (server-side Redis dedupe on `riderId` + pickup/destination/paymentMethod, ~60s TTL): A makes the server *guess* what "the same request" means. That guess is wrong in both directions — two genuinely separate rides to the same airport 90 seconds apart get silently merged, and a rider who nudges the pin 15 m between taps gets two cars anyway. B states the contract instead of inferring it, and #16 has not been built, so the rider app pays nothing to adopt it now and a migration later.

## Out of Scope / Non-Goals

- **Not included**: idempotency on any other route. Payments (#12) and the dispatcher's phone-order controller (#19) will each want it; this ticket adds the shared contract they can import, not their call sites.
- **Not included**: a request **fingerprint** stored beside the ride id, i.e. rejecting a reused key whose body changed. See OPEN QUESTIONS — flagged for a decision, recommended deferral.
- **Not included**: a `Idempotency-Replayed: true` response header. Nothing consumes it yet.
- **Not changing**: the rate limit's numbers, the quote path, the state machine, `notifyRider`, or anything #10 touches.
- **Not changing**: `rides` table schema. **No migration** — the mapping is Redis-only and TTL'd, which is what gives "outside the window" its meaning.

## Feature Metadata

**Feature Type**: Bug Fix (with a cross-surface contract addition)
**Estimated Complexity**: Medium — the code is small; the ordering, the release-on-failure path and the concurrent case are where it goes wrong.
**Primary Systems Affected**: `packages/shared` (contract), `services/api` rides slice, `services/api` KV port + Redis impl, test harness.
**Dependencies**: none new. Uses the existing `KV_STORE` port and `ioredis`.

## Related Work

**Implements**: #46 · deferred from the PR #45 review, finding **M3** (`.claude/code-reviews/pr-45-review.md`)

**Back-references**:

- `.claude/plans/api-rides-pricing.md` — Why: built `RidesService.request`, the rate limit, and the quote path this wraps
- `.claude/plans/api-dispatch-engine.md` — Why: #10 is what turns a duplicate row into a duplicate car; `findAwaitingDispatch` is the consumer that makes this urgent

**Forward-references**:

- (none yet) — #16 (rider booking screen) must send the header; #13 (Railway deploy) must not ship without this.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `services/api/src/features/rides/rides.service.ts` (whole file, 171 lines) — Why: the file being changed. Note the **ordering rationale** at lines 66-71 and the "spending path only" logging scope at lines 99-101 — both constrain where the new code goes.
- `services/api/src/features/rides/rides.policy.ts` (all 19 lines) — Why: where the new TTL constant and key builder go; mirror its comment style (constants-not-env, with the reasoning).
- `services/api/src/features/rides/rides.controller.ts` (all 32 lines) — Why: the `@Body(new ZodValidationPipe(...))` pattern the header validation mirrors.
- `services/api/src/common/kv/kv.store.ts` (all 20 lines) — Why: the port gaining `setIfAbsent`. Read the "narrow slice, not an abstraction layer" docstring before adding to it.
- `services/api/src/common/kv/redis-kv.store.ts` (lines 13-30, and the `INCR_WITH_TTL` comment at 39-51) — Why: the impl pattern, and the precedent for *why* atomicity is spelled out in a comment.
- `services/api/src/features/rides/rides.repository.ts` (lines 179-221, `findWithQuote`) — Why: this is the replay read. It already returns exactly `{ ride, quote }` and handles the never-quoted case.
- `services/api/src/features/pricing/pricing.service.ts` (lines 34-80, esp. 58-70) — Why: the `NO_DRIVER_YET` platform-base split block that gets extracted into `previewSplit`.
- `services/api/src/features/rides/rides.service.spec.ts` (whole file, 256 lines) — Why: the unit-test harness and, critically, the test at lines 207-223 that **pins the ordering principle** the new code must not break.
- `services/api/src/features/rides/rides.integration.spec.ts` (lines 47-120) — Why: the supertest harness, `phoneFor` range discipline, and every existing `POST /rides` call that now needs a header.
- `services/api/src/features/dispatch/dispatch.integration.spec.ts` (lines 154-173, `bookRide`) — Why: the **other** `POST /rides` caller. Miss it and the dispatch suite 400s.
- `services/api/test/harness.ts` (lines 36-95, `InMemoryKeyValueStore`) — Why: gains `setIfAbsent`; note `advance()` at line 44 is how "outside the window" gets tested without waiting.
- `services/api/src/features/rides/index.ts` (lines 20-21) — Why: the `NOT IDEMPOTENT` bullet to delete (AC #4).
- `packages/shared/src/money.ts` and `packages/shared/src/commission.ts` — Why: the shape of a small top-level shared module (the new `idempotency.ts` is a sibling, **not** a `schemas/` file — it is a transport contract, not a payload schema).

### New Files to Create

- `packages/shared/src/idempotency.ts` — the header name constant + key schema
- `packages/shared/tests/idempotency.test.ts` — contract tests
- `services/api/src/features/rides/idempotency-key.decorator.ts` — a pipe-accepting param decorator, because `@Headers` is not one

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
  - Specific section: key lifetime and the concurrent-request response
  - Why: the reference implementation of this exact pattern. Confirms the 24h window and that a second request *while the first is in flight* is a `409`, not a wait.
- [IETF draft — The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header)
  - Specific section: §2 (header syntax), §4 (error responses)
  - Why: fixes the header **name** we are standardising on, and validates the 409-on-concurrent choice.
- [Redis `SET`](https://redis.io/docs/latest/commands/set/)
  - Specific section: the `NX` and `EX` options
  - Why: `SET key val NX EX ttl` is one atomic round trip and returns `null` when the key existed — no Lua script needed here, unlike `incrWithTtl`.
- [ioredis `set` signature](https://github.com/redis/ioredis) — Why: `redis.set(k, v, 'EX', ttl, 'NX')` resolves to `'OK'` or `null`. **Argument order matters**; `'NX'` last is the form ioredis types accept alongside `'EX'`.

### Patterns to Follow

**Constants live in `rides.policy.ts`, with their reasoning** (`rides.policy.ts:1-15`):

```ts
/**
 * Ride-request policy. Constants, not env vars — this is the <€100/mo budget
 * guardrail in code.
 */
export const RIDE_REQUEST_MAX_PER_WINDOW = 20;
export const rideRequestRateKey = (riderId: string): string =>
  `rides:rate:${riderId}`;
```

**Error shape — a coded message, not prose** (`rides.service.ts:56`, `135-138`):

```ts
throw new BadRequestException('multi_taxi_not_supported');
throw new HttpException(
  { message: 'too_many_requests', retryAfterSeconds },
  HttpStatus.TOO_MANY_REQUESTS,
);
```

**Logging — `domain.component.action_state`, always with `at`** (`.claude/references/logging-standard.md`):

```ts
this.logger.log({
  event: 'ride.request.created',
  rideId: ride.id,
  riderId,
  at: ride.createdAt.toISOString(),
});
```

New events this ticket adds: `ride.request.replayed` (log) and `ride.request.in_progress` (warn). Both are `ride` domain, `request` component — consistent with the four that already exist (`created`, `failed`, `throttled`, `notify_failed`). **Never log the key itself** alongside addresses; the key is fine, addresses are not (logging standard: "addresses beyond geozone name" are forbidden).

**Test naming — every slice ships expected + edge + failure** (`rides.service.spec.ts`):

```ts
it('joins the ride room before emitting, with an ISO timestamp (expected)', ...)
it('creates a future-dated request at status scheduled (edge)', ...)
it('rejects a multi-taxi order before spending a maps call (failure)', ...)
```

**Anti-pattern to avoid**: reading the key with `get` and then writing it with `setWithTtl`. That is the check-then-act race this ticket exists to close, and it will pass a sequential unit test while failing in production.

---

## IMPLEMENTATION PLAN

### Phase 1: The shared contract

The header name and key schema, in `@taxi/shared`, imported by the API and never redeclared there.

**Tasks:**

- Create `packages/shared/src/idempotency.ts`
- Export it from the barrel
- Contract tests

### Phase 2: The atomic KV primitive

**Depends on:** nothing — **Independent of** Phase 1. Could be done in parallel; it touches only `services/api/src/common/kv/` and the harness.

**Tasks:**

- Add `setIfAbsent` to the `KeyValueStore` port
- Implement in `RedisKeyValueStore` (`SET NX EX`) and `InMemoryKeyValueStore`
- Contract test in the Redis-gated spec

### Phase 3: Service + controller

**Depends on:** Phases 1 and 2 (needs both the contract and the primitive).

**Tasks:**

- Policy constants and key builder
- `PricingService.previewSplit` extraction (the replay path needs a split without a route call)
- `RidesService.request` reserve / replay / release
- Controller header binding

### Phase 4: Tests, gap removal, docs

**Depends on:** Phase 3.

**Tasks:**

- Unit tests for all four acceptance criteria plus the concurrent and release paths
- Update **both** integration specs to send the header, and add the replay case
- Delete the `NOT IDEMPOTENT` bullet
- One line in `services/api/CLAUDE.md`

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### CREATE `packages/shared/src/idempotency.ts`

- **IMPLEMENT**:

  ```ts
  import { z } from 'zod';

  /**
   * Lowercase by construction. Express normalises every inbound header name to
   * lowercase before `@Headers()` reads it, and HTTP/2 forbids any other case on
   * the wire — so this one spelling is correct for both sending and receiving.
   *
   * Clients: mint a NEW key per booking ATTEMPT, not per session and not per
   * screen. Reusing a key after the rider edits the pickup returns the ride the
   * OLD body created; the key is the whole contract, and the server does not
   * re-read the body to second-guess it.
   */
  export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

  /**
   * A uuid, not an opaque string. Entropy is the point: a client that sent a
   * constant — `"book"`, or a screen name — would collapse every booking that
   * rider ever makes into their first ride. `randomUUID()` on the client makes
   * the safe thing the easy thing, and the schema makes the unsafe thing a 400.
   */
  export const idempotencyKeySchema = z.string().uuid();
  export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
  ```

- **PATTERN**: a small top-level module beside `money.ts` / `commission.ts` — **not** under `schemas/`, which holds payload shapes. This is a transport contract.
- **IMPORTS**: `zod` only. This package imports nothing from the workspace (`packages/shared/CLAUDE.md`).
- **GOTCHA**: do **not** put this in `schemas/ride.ts`. Payments (#12) and phone orders (#19) will import the same header, and a ride-shaped home would force a bad import later.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: the issue's "the header belongs in `@taxi/shared`" constraint

### UPDATE `packages/shared/src/index.ts`

- **IMPLEMENT**: add `export * from './idempotency';` beside the other top-level exports (after `./commission`, before `./realtime-events` — the file is grouped loosely by kind, keep contract primitives together).
- **VALIDATE**: `pnpm --filter @taxi/shared build`
- **SATISFIES**: makes the contract importable by the API

### CREATE `packages/shared/tests/idempotency.test.ts`

- **IMPLEMENT**: three cases —
  - (expected) `idempotencyKeySchema.parse(randomUUID())` round-trips
  - (edge) the header constant is exactly `'idempotency-key'` and is lowercase — `expect(IDEMPOTENCY_KEY_HEADER).toBe(IDEMPOTENCY_KEY_HEADER.toLowerCase())`. This pins the Express-normalisation assumption the controller depends on; if someone "tidies" it to `Idempotency-Key`, every request 400s and this test says why.
  - (failure) `''`, `'book'`, and a 36-char non-uuid are all rejected
- **PATTERN**: `packages/shared/tests/money.test.ts` — flat `describe`/`it`, no harness.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: the ≥1 expected + 1 edge + 1 failure rule

### UPDATE `services/api/src/common/kv/kv.store.ts`

- **IMPLEMENT**: add to the `KeyValueStore` interface:

  ```ts
  /**
   * Atomic reserve: writes only when the key is absent, and reports which
   * happened. A `get` followed by a `setWithTtl` is NOT equivalent — two callers
   * racing both read null and both "win", which is precisely the double-book
   * this exists to stop.
   */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  ```

- **GOTCHA**: the port's docstring says "a port, not an abstraction layer… exactly one production implementation". Adding a sixth method is in keeping with that only because a real caller needs it now — do not add speculative siblings (`setIfPresent`, `getAndDelete`).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck` (fails until both implementations follow — expected mid-task)
- **SATISFIES**: AC #1 (the atomic half)

### UPDATE `services/api/src/common/kv/redis-kv.store.ts`

- **IMPLEMENT**:

  ```ts
  async setIfAbsent(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    // One round trip, atomic in the server: SET NX EX either creates the key
    // with its expiry or does nothing at all. No Lua needed — unlike
    // INCR_WITH_TTL, there is no window here for a crash to leave a key
    // without a TTL.
    const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }
  ```

- **GOTCHA**: ioredis returns `null` (not `false`, not a throw) when `NX` declines. Compare against `'OK'`; `Boolean(result)` also works but reads as if any truthy reply means success.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1

### UPDATE `services/api/test/harness.ts`

- **IMPLEMENT**: `setIfAbsent` on `InMemoryKeyValueStore`, mirroring the Redis semantics **through `live()`** so an expired key counts as absent:

  ```ts
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    // `live()`, not `store.has()` — an EXPIRED key must be reservable again,
    // which is the whole "outside the window" behaviour.
    if (this.live(key)) return Promise.resolve(false);
    this.store.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    return Promise.resolve(true);
  }
  ```

- **PATTERN**: `harness.ts:66-69` (`setWithTtl`) for the write, `harness.ts:52-60` (`live`) for the expiry check.
- **GOTCHA**: using `this.store.get(key)` instead of `this.live(key)` makes the "repeat outside the window" test (AC #3) fail — the key is present but dead.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3

### UPDATE `services/api/src/common/kv/redis-kv.store.spec.ts`

- **IMPLEMENT**: one case against real Redis — first `setIfAbsent` returns `true`, an immediate second with a different value returns `false` **and the stored value is still the first one** (proves it did not overwrite), and `ttl()` is > 0 (proves `EX` applied).
- **GOTCHA**: this suite `describe.skip`s without `REDIS_TEST_URL`. Use a key namespaced to this spec and `del` it first — the suite runs against a live Redis that is not flushed between runs.
- **VALIDATE**: `REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test -- redis-kv`
- **SATISFIES**: AC #1 — the primitive is atomic *in Redis*, not just in the fake

### UPDATE `services/api/src/features/rides/rides.policy.ts`

- **IMPLEMENT**:

  ```ts
  /**
   * A booking attempt's key outlives the attempt by a day.
   *
   * Long is safe here in a way it would NOT be for server-side dedupe: the
   * client mints a fresh uuid per attempt, so a wide window never merges two
   * bookings the rider meant to be separate — it only catches a retry. Matches
   * the de-facto standard (Stripe's is 24h), which is what a client library
   * author will assume.
   */
  export const RIDE_IDEMPOTENCY_TTL_SECONDS = 86_400; // 24 h

  /** Reserved, not yet resolved to a ride — see `RidesService.request`. */
  export const RIDE_IDEMPOTENCY_PENDING = 'pending';

  /**
   * Scoped by rider, deliberately. Two riders colliding on a key must not share
   * a ride, and an unscoped key would let a guessed uuid return someone else's
   * ride id.
   */
  export const rideIdempotencyKey = (riderId: string, key: string): string =>
    `rides:idem:${riderId}:${key}`;
  ```

- **PATTERN**: `rides.policy.ts:14-18` — constants with the reasoning, key builder as an arrow fn.
- **GOTCHA**: `RIDE_IDEMPOTENCY_PENDING` must not be a valid uuid, or the replay path cannot tell a marker from a ride id. `'pending'` is safe; do not "improve" it to a uuid.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3

### UPDATE `services/api/src/features/pricing/pricing.service.ts`

- **IMPLEMENT**: extract the platform-base split block (currently lines 58-70) into a public method, and have `quote()` call it:

  ```ts
  /**
   * The platform-base preview split for a total, with no driver in the picture.
   *
   * Public because the idempotent replay path needs it: a replayed request must
   * return the same shape as the original WITHOUT spending a route call, and the
   * split is computed, never persisted (see `rideCreatedSchema`).
   */
  async previewSplit(totalCents: number): Promise<FareSplit> {
    const config = await this.platformConfig.forCity(this.env.DEFAULT_CITY_ID);
    const NO_DRIVER_YET: CommissionDriverInput = {};
    return splitFare(totalCents, resolveCommissionPct(NO_DRIVER_YET, config));
  }
  ```

- **REFACTOR**: **Leave `quote()`'s body as it is.** It must keep its own `config` read (it needs the config *before* the maps call, for the reason its comment gives at lines 34-37), and it must keep calling `splitFare(...)` inline. Do **not** rewrite it to call `previewSplit(quote.totalCents)` — verified: `PlatformConfigService.forCity` does **not** cache (`platform-config.service.ts:16-18`, whose docstring says "Do not add that cache now… a stale commission is a money bug"), so routing `quote()` through `previewSplit` would double the config read on the hot path. `previewSplit` is a **second, separate reader** used only by the replay path.
- **GOTCHA**: do **not** move the config read out of `quote()` to share it — the ordering there ("read BEFORE the maps call… an unseeded environment should not spend a paid route call only to 500 three lines later") is deliberate.
- **VALIDATE**: `pnpm --filter @taxi/api test -- pricing`
- **SATISFIES**: AC #1 (the replay must return a complete `RideCreated`)

### UPDATE `services/api/src/features/rides/rides.service.ts`

- **IMPLEMENT**: `request` takes the key and owns reserve / replay / release. Extract the existing spending path into `createRide` so there is exactly **one** release point and the `ride.request.failed` scope is unchanged.

  ```ts
  async request(
    riderId: string,
    idempotencyKey: string,
    body: RideRequestBody,
  ): Promise<RideCreated> {
    const request = rideRequestSchema.parse({ ...body, riderId });

    if (request.vehicleCount > 1) { /* unchanged */ }
    if (request.scheduledFor && ...) { /* unchanged */ }

    // BEFORE the rate limit, for the reason the rate limit is itself placed
    // after the rejections: the cap bounds paid Routes calls, and a replay
    // reaches none. Charging quota for it would throttle exactly the rider this
    // feature protects — the one whose app retried.
    const key = rideIdempotencyKey(riderId, idempotencyKey);
    const reserved = await this.kv.setIfAbsent(
      key,
      RIDE_IDEMPOTENCY_PENDING,
      RIDE_IDEMPOTENCY_TTL_SECONDS,
    );
    if (!reserved) return this.replay(key, riderId);

    try {
      await this.assertWithinRateLimit(riderId);
      return await this.createRide(key, request, riderId);
    } catch (error) {
      // Release, best-effort. Without it a maps outage — or a single 429 —
      // burns the rider's key for 24 h and every honest retry replays a ride
      // that was never created. `.catch(() => {})` because if Redis is the
      // thing that is down, a throw here would REPLACE the real error with a
      // Redis one and hide the actual cause.
      await this.kv.del(key).catch(() => undefined);
      throw error;
    }
  }
  ```

  Only **pre-commit** failures reach that catch — the quote, the insert, and the
  rate limit. Everything after the commit is swallowed by design (see
  `recordIdempotency` and `notifyRider`), which is what keeps the release from
  ever deleting a key whose ride actually exists.

  `createRide(key, request, riderId)` = today's `try { quote → create → notify → log } catch { log ride.request.failed; throw }`, with the **commit as a hard boundary**:

  ```ts
  const ride = await this.rides.create({ ... });

  // ---- POST-COMMIT: nothing below may throw out of this method ----
  await this.recordIdempotency(key, ride.id);
  this.notifyRider(riderId, ride);
  this.logger.log({ event: 'ride.request.created', ... });
  return { ride, split };
  ```

  ```ts
  /**
   * Swallows, for exactly the reason `notifyRider` does: the ride is already
   * committed. Letting a Redis blip here throw would run the caller's release,
   * delete the reservation, and hand the rider a 500 — so their retry reserves
   * a FREE key and books the second car this whole ticket exists to prevent.
   *
   * The residue when it fails is a key stuck at `pending` for the window, so
   * that attempt's retries get 409. The rider already has the ride id from the
   * 201, and a 409 is strictly better than a duplicate car.
   */
  private async recordIdempotency(key: string, rideId: string): Promise<void> {
    try {
      await this.kv.setWithTtl(key, rideId, RIDE_IDEMPOTENCY_TTL_SECONDS);
    } catch (error) {
      this.logger.error({
        event: 'ride.request.idempotency_write_failed',
        rideId,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
    }
  }
  ```

  `replay(key, riderId)`:

  ```ts
  private async replay(key: string, riderId: string): Promise<RideCreated> {
    const stored = await this.kv.get(key);

    // The first request holds the reservation and has not finished. Waiting
    // would tie up a connection for as long as a route call takes; the client
    // retries a 409 and gets the ride.
    if (stored === null || stored === RIDE_IDEMPOTENCY_PENDING) {
      this.logger.warn({ event: 'ride.request.in_progress', riderId, at: ... });
      throw new HttpException(
        { message: 'idempotent_request_in_progress' },
        HttpStatus.CONFLICT,
      );
    }

    const found = await this.rides.findWithQuote(stored);
    // The mapping outlives nothing — rides are never deleted — so this is a
    // data bug, not a flow. Falling through to a fresh create is still correct:
    // if the original is gone there is no duplicate to make.
    if (!found) { this.logger.error({ event: 'ride.request.replay_missing', ... }); ... }

    // Join, but do NOT re-emit. The case that produces a retry is a network
    // blip — exactly when the rider's socket is new and not in the room, so a
    // replay that skipped this would leave them deaf to every later
    // `ride:status`. Re-emitting is the other error: #10 may have moved the
    // ride on, and `previousStatus: null` would be a lie.
    try {
      this.realtime.joinRideRoom(riderId, found.ride.id);
    } catch (error) {
      this.logger.warn({ event: 'ride.request.notify_failed', rideId: found.ride.id, ... });
    }

    const split = await this.pricing.previewSplit(found.quote.totalCents);
    this.logger.log({ event: 'ride.request.replayed', rideId: found.ride.id, riderId, at: ... });
    return { ride: found.ride, split };
  }
  ```

- **GOTCHA (the one that will bite)**: `stored === null` is reachable — the key can expire between `setIfAbsent` returning `false` and this `get`. Treating `null` as "no reservation, go create" would reopen the race; treat it as in-progress and let the client retry.
- **GOTCHA**: `RIDE_REQUEST_MAX_PER_WINDOW` is still spent on the *first* request of each key, so 20 distinct bookings in 10 minutes still throttles. That is intended and unchanged.
- **GOTCHA**: keep `notifyRider` **after** the mapping write. If the emit path somehow threw before the mapping landed (it cannot today — it swallows), a retry would create a second ride.
- **PATTERN**: `HttpException` with a coded `message`, as at `rides.service.ts:135-138`.
- **VALIDATE**: `pnpm --filter @taxi/api test -- rides.service`
- **SATISFIES**: AC #1, #2, #3

### CREATE `services/api/src/features/rides/idempotency-key.decorator.ts`

- **IMPLEMENT**:

  ```ts
  import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
  import { IDEMPOTENCY_KEY_HEADER } from '@taxi/shared';

  /**
   * The raw `Idempotency-Key` header, for a `ZodValidationPipe` to validate.
   *
   * A custom decorator rather than `@Headers(IDEMPOTENCY_KEY_HEADER, pipe)`,
   * because `@Headers` is typed `(property?: string) => ParameterDecorator` and
   * takes NO pipes — the one built-in param decorator that doesn't. Anything
   * built with `createParamDecorator` does, so this recovers the per-parameter
   * validation every other bound parameter in the codebase uses.
   */
  export const IdempotencyKeyHeader = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): unknown =>
      ctx
        .switchToHttp()
        .getRequest<{ headers: Record<string, string | undefined> }>()
        .headers[IDEMPOTENCY_KEY_HEADER],
  );
  ```

- **PATTERN**: `services/api/src/features/auth/decorators/current-user.decorator.ts` — same shape, same one-line docstring habit.
- **GOTCHA**: return type is `unknown`, not `string`. A missing header is `undefined`, and the pipe is what narrows it — typing this `string` would lie to every caller and hide the missing-header case from the compiler.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/rides/rides.controller.ts`

- **IMPLEMENT**:

  ```ts
  @Post()
  create(
    @CurrentUser() user: JwtClaims,
    @IdempotencyKeyHeader(new ZodValidationPipe(idempotencyKeySchema))
    idempotencyKey: string,
    @Body(new ZodValidationPipe(rideRequestBodySchema)) body: RideRequestBody,
  ): Promise<RideCreated> {
    return this.rides.request(user.sub, idempotencyKey, body);
  }
  ```

- **IMPORTS**: `IdempotencyKeyHeader` from `./idempotency-key.decorator`; `idempotencyKeySchema` from `@taxi/shared`. **Do not** import `Headers` from `@nestjs/common` — see the decorator's docstring.
- **GOTCHA (verified against the installed Nest 11)**: `@Headers` is declared `(property?: string) => ParameterDecorator` in `node_modules/@nestjs/common/decorators/http/route-params.decorator.d.ts:176` — **it accepts no pipes**, so the obvious `@Headers(IDEMPOTENCY_KEY_HEADER, new ZodValidationPipe(...))` does not compile. `createParamDecorator` is declared `(...dataOrPipes: (Type<PipeTransform> | PipeTransform | FactoryData)[]) => ParameterDecorator` and does, which is why the decorator above exists.
- **GOTCHA**: a **missing** header arrives as `undefined`, which `idempotencyKeySchema` rejects → `400 validation_failed`. That is the intended contract (required, not optional) — see OPEN QUESTIONS for why required.
- **GOTCHA**: no CORS change needed. `app.enableCors({ origin })` (`main.ts:13`) leaves `allowedHeaders` unset, and the cors middleware then reflects `Access-Control-Request-Headers`. The rider app is React Native anyway — no preflight.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/rides/rides.service.spec.ts`

- **IMPLEMENT**: thread a key through the existing `build()` helper (add a `const KEY_A = '<uuid>'` and a small `req(service, key, body?)` wrapper so the eight existing calls stay readable), then add:
  1. **(expected, AC #1)** same key twice → identical `ride.id`, and `calls.filter(c => c === 'pricing.quote')` has length **1**. Asserting the quote count is what proves no paid call on replay.
  2. **(edge, AC #2)** two different keys → `rides.create` called twice.
  3. **(edge, AC #3)** same key, then `kv.advance(RIDE_IDEMPOTENCY_TTL_SECONDS + 1)`, then same key again → `rides.create` called twice.
  4. **(failure)** while the first is in flight → 409. Drive it by calling `service.request` twice **without awaiting the first** (make the fake `pricing.quote` return a promise you resolve manually), so the second lands on the `pending` marker.
  5. **(failure)** release-on-failure: `build({ pricingThrows: true })`, first call rejects, then a **second call with the same key** on a non-throwing service reaches `rides.create`. Without the `kv.del` this returns a 409 forever.
  6. **(edge)** a replay does not consume rate-limit quota: exhaust nothing, replay the same key `RIDE_REQUEST_MAX_PER_WINDOW + 5` times, then confirm a *new* key still succeeds. Pins the ordering decision.
- **PATTERN**: `rides.service.spec.ts:207-223` — the existing test that pins an ordering decision, and the model for #6.
- **GOTCHA (this one inverts two existing tests if missed)**: the throttle tests at `:174-190` and `:192-205` loop `RIDE_REQUEST_MAX_PER_WINDOW` times and then assert the next call throws `too_many_requests`. If `req()` defaults to a **shared** key, those 20 calls become 1 create + 19 replays, the counter is charged **once**, and the 21st call *succeeds* — the assertion inverts and the failure looks like the ordering decision is wrong when it isn't. Every iteration of those loops mints a **distinct** key. Only the replay tests share one.
- **GOTCHA**: in the rollover test at `:192-205`, `kv.advance(RIDE_REQUEST_WINDOW_SECONDS + 1)` is 601s and does **not** expire an 86400s idempotency key. The call after the advance needs a fresh key too, or it replays instead of proving the rate window reopened.
- **GOTCHA**: `build()`'s `rides.create` fake returns a **constant** `RIDE_ID`; tests #2 and #3 assert on the *call count*, not on distinct ids. If you'd rather assert distinct ids, make the fake mint one per call — but then update test #1, which compares ids.
- **GOTCHA**: the replay path calls `this.rides.findWithQuote`, `this.pricing.previewSplit` and `this.realtime.joinRideRoom` — all three must exist on the fakes in `build()` or every replay test throws `not a function`.
- **VALIDATE**: `pnpm --filter @taxi/api test -- rides.service`
- **SATISFIES**: AC #1, #2, #3

### UPDATE `services/api/src/features/rides/rides.integration.spec.ts`

- **IMPLEMENT**: add a `const idem = () => randomUUID()` helper and `.set(IDEMPOTENCY_KEY_HEADER, idem())` to every existing `POST /rides` call. **Do not trust a line-number list — re-run `git grep -n "post('/rides')"` and work the hits**, because earlier edits shift them. As of `c877ed1` there are 12 in this file (81, 145, 150, 163, 175, 201, 224, 231, 238, 251, 256, 270); line **256 is the 401 case** and needs none, since the guard rejects before any handler pipe runs. Then add:
  - **(expected)** two `POST /rides` with the **same** key → both `201`, identical `ride.id`, and exactly **one** row in `rides` for that rider (`select().from(rides).where(eq(rides.riderId, r.id))`). This is the acceptance criterion end-to-end and the one that would have caught the bug.
  - **(failure)** `POST /rides` with **no** header → `400`.
  - **(failure)** `POST /rides` with `idempotency-key: not-a-uuid` → `400`.
- **GOTCHA**: use a **fresh phone from the `+371240` range** for the new tests (`phoneFor`, and read the comment at the top of the file) — the DB is never reset between runs and reusing another test's rider crosses the rate-limit counter into your assertions.
- **GOTCHA**: the same-key test must use coordinates already used elsewhere in the file, or it measures a cache miss too; but the **row count** assertion must be scoped to its own rider or earlier tests' rides pollute it.
- **GOTCHA (silently guts the `<€100/mo` guardrail test)**: the route-cache test at `:139-166` posts the **same body twice**, expects both `201`, and asserts `ctx.maps.routeCalls - before === 1` — i.e. *the cache* saved the second call. Give those two calls a **shared** key and the second replays without ever reaching `PricingService`; the delta is still 1 and the test passes while proving nothing about the cache. Every call in that test gets a **distinct** key.
- **GOTCHA (passes for the wrong reason)**: the `malformed` case at `:238` asserts `codeOf(res) === 'validation_failed'`. The header pipe is declared before `@Body` and so runs first — omit the header there and it still returns `validation_failed`, from the *header*, and the body assertion it was written for never runs. Send a **valid** header in all three `expect(400)` cases at `:224/:231/:238`; the sibling cases (`multi_taxi_not_supported`, `scheduled_in_past`) will fail loudly if you forget, but this one will not.
- **VALIDATE**: `DATABASE_URL=... REDIS_TEST_URL=... pnpm --filter @taxi/api test -- rides.integration`
- **SATISFIES**: AC #1, and the "must land before #13" bar

### UPDATE `services/api/src/features/dispatch/dispatch.integration.spec.ts`

- **IMPLEMENT**: add `.set(IDEMPOTENCY_KEY_HEADER, randomUUID())` inside `bookRide` (line ~160). One line, one place — `bookRide` is the only `POST /rides` in this file.
- **GOTCHA**: this is the easiest task to forget and the loudest failure — the whole dispatch suite 400s. If dispatch tests fail with `validation_failed`, this is why.
- **VALIDATE**: `DATABASE_URL=... REDIS_TEST_URL=... pnpm --filter @taxi/api test -- dispatch.integration`
- **SATISFIES**: no regressions

### REMOVE the gap bullet from `services/api/src/features/rides/index.ts`

- **IMPLEMENT**: delete lines 20-21:

  ```
  - The request is NOT IDEMPOTENT. A double-tapped "Book" creates two rides
    (#46); the rate limit bounds the cost but does not deduplicate.
  ```

  Leave the other four bullets and the surrounding docstring exactly as they are.
- **GOTCHA**: do not replace it with a "now idempotent" bullet. `KNOWN GAPS` lists gaps; a closed one just leaves.
- **VALIDATE**: `grep -c 'NOT IDEMPOTENT' services/api/src/features/rides/index.ts` returns 0
- **SATISFIES**: **AC #4**

### UPDATE `services/api/CLAUDE.md`

- **IMPLEMENT**: one line beside the existing `POST /rides` rule ("takes the rider id from the JWT; `rideRequestBodySchema` has no `riderId` field, by construction"):

  > `POST /rides` **requires** an `Idempotency-Key` header (`IDEMPOTENCY_KEY_HEADER` in `@taxi/shared`, a uuid per booking attempt). The rider-scoped reservation is atomic (`setIfAbsent`), released on failure, and replays out of Postgres — a new ride-creating path needs the same.

- **GOTCHA**: one line. The rules file stays true, not longer (`rules-check-drift`).
- **VALIDATE**: n/a — read it back and check it is still accurate.
- **SATISFIES**: keeps the rules file non-stale

---

## TESTING STRATEGY

### Unit Tests

`packages/shared/tests/idempotency.test.ts` (3 cases) and the six additions to `rides.service.spec.ts`. The service suite runs with `InMemoryKeyValueStore`, so no Redis is needed and `advance()` makes the TTL testable in milliseconds.

### Integration Tests

`rides.integration.spec.ts` proves it end-to-end through supertest → controller → service → real Postgres, including the **row count**, which is the only assertion that truly proves "one ride". `redis-kv.store.spec.ts` proves `SET NX EX` against a real Redis, because the in-memory fake could agree with a wrong implementation.

### Edge Cases

- Two taps racing, the second landing on the `pending` marker → 409 (not a second ride, not a hang)
- The key expiring between `setIfAbsent` → `false` and the follow-up `get` → 409, not a fresh create
- First attempt fails (maps down, or throttled) → key released → an honest retry with the same key creates the ride
- The mapping points at a ride that no longer exists → logged, falls through to create
- A replay of a ride that has since been dispatched by #10 → returns it at its **current** status (`offered`/`accepted`), same id. Correct: the criterion is "the same ride id", and the rider gets the truth.
- Different rider, same key → separate rides (the key is rider-scoped)

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm turbo run typecheck lint --force
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm --filter @taxi/api test -- rides.service
```

### Level 3: Integration Tests

```bash
docker compose -p taxi up -d          # -p taxi: see the warning under Level 4
DATABASE_URL=postgres://taxi:taxi@192.168.1.11:5432/taxi \
REDIS_TEST_URL=redis://localhost:6381 \
pnpm --filter @taxi/api test -- rides.integration dispatch.integration
```

### Level 4: The gate (CI parity — this is the one that counts)

```bash
docker compose -p taxi up -d
docker compose -p taxi ps             # confirm postgres+redis are the ORIGINAL containers
DATABASE_URL=postgres://taxi:taxi@192.168.1.11:5432/taxi \
REDIS_TEST_URL=redis://localhost:6381 \
pnpm turbo run typecheck lint test build --force
```

Three ways this command lies if you shorten it:

1. `localhost:5432` is a **Homebrew postgres**, not the compose container. The LAN IP is mandatory.
2. Without `REDIS_TEST_URL`, three Redis suites `describe.skip` — the run reports green while testing less than it claims.
3. **`-p taxi` is mandatory when running from a worktree.** Compose takes its project name from the directory basename, so a bare `docker compose up -d` in `taxi-46-idempotency/` starts a *second, empty* project — new volumes, same host ports, so it either fails to bind or serves an **unseeded** database. The integration specs assert the seed (`split.commissionPct === 15` is "the SEEDED platform_config value, read at quote time"), so an unseeded DB fails in a way that looks like a commission bug. Simplest alternative: run compose from the main worktree and only the `pnpm` command from here.

### Level 5: Manual Validation

```bash
# same key twice → same ride id
K=$(uuidgen | tr 'A-Z' 'a-z')
for i in 1 2; do
  curl -s -X POST localhost:3000/rides \
    -H "authorization: Bearer $TOKEN" \
    -H "idempotency-key: $K" \
    -H 'content-type: application/json' \
    -d '{"pickup":{"location":{"lat":56.9496,"lng":24.1052},"address":"Brīvības iela 1"},"destination":{"location":{"lat":56.9236,"lng":23.9711},"address":"RIX"},"paymentMethod":"cash"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["ride"]["id"])'
done
# → the same uuid twice.  Omit the header → 400.
```

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** Two identical requests in-window return the same ride id, and exactly one `rides` row exists — **sequentially**. A repeat that lands while the first is *still in flight* returns `409` instead of the id, by design (see the 409 criterion below and OPEN QUESTIONS Q4). Either way exactly one ride exists, which is the harm the ticket names.
- [ ] **AC #2** A genuinely different second request (different key) creates a new ride
- [ ] **AC #3** A repeat outside the window creates a new ride
- [ ] **AC #4** `KNOWN GAPS` in `services/api/src/features/rides/index.ts` loses its `NOT IDEMPOTENT` bullet
- [ ] The header name and key schema live in `@taxi/shared` and are **not** redeclared in the API
- [ ] A concurrent repeat gets a 409, never a second ride
- [ ] A failed first attempt releases the key
- [ ] `pnpm turbo run typecheck lint test build --force` green with `DATABASE_URL` on the LAN IP and `REDIS_TEST_URL` set
- [ ] No regressions: both integration suites pass with the header threaded through

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] Gate run green (Level 4, with **both** env vars)
- [ ] `grep -rn 'NOT IDEMPOTENT' services/api/src` returns nothing
- [ ] `grep -rn "'idempotency-key'" services/api/src` returns nothing (the API imports the constant, never the literal)
- [ ] Acceptance criteria all met
- [ ] `services/api/CLAUDE.md` updated and still true

---

## OPEN QUESTIONS / ASSUMPTIONS

**Q1 — The header is REQUIRED, not optional. (Decided; flagging because it is the load-bearing call.)**
An optional header cannot honestly close this ticket: AC #4 removes the `NOT IDEMPOTENT` bullet, and with an optional header the statement "the request is not idempotent" stays true for any client that omits it. Required costs nothing today — #16 has not been built, and the only two callers are integration specs in this repo. It becomes expensive the moment a shipped app depends on the loose behaviour. **If you would rather it be optional**, say so before implementation: the change is a `.optional()` on the controller binding plus a fallback, but the gap bullet then has to stay, with a note pointing at #16.

**Q2 — No request fingerprint. (Recommend deferring; your call.)**
Stripe stores a hash of the request body beside the key and errors when the same key arrives with different parameters. This plan does not: the key alone is the contract. The failure mode is a **client bug** — if the rider app reuses a key after the rider edits the destination, the server returns the ride the *old* body created, and the rider gets a car to the wrong place. Mitigated here by documenting the obligation loudly in `idempotency.ts` and by #16 not existing yet to get it wrong. Adding it later is a value-format change (`<rideId>` → `<rideId>:<hash>`) inside one private method, and the window is only 24h, so no migration. **Say the word and I will add it now** — it is maybe 15 lines and one more test.

**Q4 — A truly concurrent repeat gets 409, not the ride id. (Decided; flagging because it reads against AC #1's literal wording.)**
AC #1 says "two identical requests in-window return the same ride id". That holds for a *sequential* repeat. A genuine double-tap is ~200 ms apart, and the first request holds the `pending` reservation across a config read, a route call and a transaction — so the second one usually lands mid-flight and gets `409 idempotent_request_in_progress`. That is Stripe's behaviour and the IETF draft's, and the alternative (block and poll until the first finishes) is rejected in NOTES. **The harm the ticket names — two cars to one kerb — is prevented in both cases**; only the response shape differs, and the client retries the 409 to get the id. Flagging so you bless it rather than find it in review.

**Q3 — 24h window.** Chosen over the issue's "~60s" because that number was written for **Option A**, where a long window would wrongly merge distinct bookings. With a client-minted key that risk disappears and a long window buys real protection. If you want it shorter it is one constant.

**Assumptions**
- `PlatformConfigService.forCity` does **not** cache — verified (`platform-config.service.ts:16-18`). So a replay costs one extra single-row Postgres read. Accepted: it is a `<10`-driver pilot, the read is a primary-key lookup, and the alternative (caching) is explicitly forbidden by that file's docstring because "a stale commission is a money bug".
- Rides are never deleted, so the `replay_missing` branch is defensive only.
- No other surface calls `POST /rides` today — confirmed by `git grep -n "'/rides'"` across the **whole repo** (not just `src/`): 13 hits, all in the two integration specs. `services/api/test/app.e2e-spec.ts` only hits `/`. Nothing in `apps/` books a ride yet, so the required header breaks no shipped client.

## NOTES (open canvas)

**Why not store the whole response body in Redis?** The obvious alternative to re-reading Postgres is to cache the serialized `RideCreated` under the key and replay it verbatim — one round trip, exact-replay semantics. Rejected on two grounds. First, it copies the rider's pickup and destination **addresses** into Redis, and this repo is deliberately strict about where addresses live (the logging standard forbids them even in logs). Second, it would return a frozen snapshot: a replay 30 seconds later would say `requested` even after #10 had already dispatched the ride and the driver was en route. Re-reading Postgres returns the truth, and `findWithQuote` already exists and returns exactly the shape needed — the split is the only recomputed part, and it is explicitly a preview that is "returned and persisted nowhere".

**The ordering argument, spelled out.** There are three gates in `request()` now: body rejections, idempotency, rate limit. The existing code already establishes the principle for the middle one — the cap is spent "AFTER the rejections above and BEFORE the quote", because "a rejected request never reaches one" and charging it "would only lock out a rider whose app sends a bad body". Apply that same test to a replay: it makes no paid call, so it must not be charged. Hence idempotency sits above the rate limit. The consequence is that a *reserved* request which then trips the rate limit must release its key — otherwise a rider who hits 429 on their first attempt with a given key can never use that key again, and their retry replays nothing. That release is why `assertWithinRateLimit` moved inside the try.

**Rejected: waiting instead of 409.** When the second tap finds a `pending` marker, we could poll until the first request resolves and then return its ride, which is nicer for the client. Rejected: it holds a Node connection open for the duration of a route call, it needs a timeout policy and a poll interval, and it turns a trivial branch into the most complex code in the slice. A 409 with a retry is what Stripe does and what the IETF draft describes, and the rider app can retry in the background without the user seeing anything.

**Rejected: a database unique constraint.** `rides.idempotency_key` unique on `(rider_id, key)` is durable, atomic, and survives a Redis flush — genuinely attractive. Rejected because it has no natural window: AC #3 ("a repeat outside the window creates a new ride") would need either a key that embeds time or a pruning job, and it costs a migration on a table #10 and #11 are actively building on. Redis TTL gives the window for free. Worth revisiting if idempotency ever needs to outlive a Redis restart — for a 24h double-tap guard, it does not.

**Sequencing risk.** Phases 1 and 2 are independent and both are small; Phase 3 is where every subtle bug lives (the `null` case, the release path, the ordering). Do not batch Phase 3 and Phase 4 — write the six unit tests as the service code lands, not after, or the concurrent-request test in particular will be written to match whatever was built.

**Blast radius.** `KeyValueStore` has one production implementation and one fake, both updated here. `RidesService.request`'s signature changes, and it has exactly one caller (`RidesController.create`). `PricingService` gains a method and loses none. Nothing in `apps/` imports any of it yet.

**The commit is the boundary — the single most important line in this plan.** `rides.service.ts:141-146` already says it for the socket emit: *"Deliberately unable to fail the request: the ride is already committed, and a rider who gets a 500 with no ride id retries — which books a second car."* The idempotency mapping write is **also** post-commit, so it inherits that rule exactly. An earlier draft of this plan put it inside the try whose catch releases the key, which would have meant: insert commits → Redis blips on the mapping write → catch releases the key → 500 → retry reserves a *free* key → **second ride**. A bug-fix plan that reintroduces its own bug through the back door. The structure to hold onto: everything before `rides.create` may throw and releases the key; nothing after it may throw at all.

**Confidence: 9.5/10** for one-pass success. The uncertainty is not in the design — it is in the eleven mechanical edits across two integration specs, where the route-cache test and the `malformed` 400 case both fail *silently* (passing for the wrong reason) rather than loudly. Both are called out as GOTCHAs on their tasks.

## AMENDMENTS

<!-- newest at the bottom -->
