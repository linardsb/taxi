import { INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { users, type Db } from '@taxi/db';
import type {
  AddressPoint,
  AddressSearchOptions,
  AddressSuggestion,
  GeocodeResult,
  Language,
  LatLng,
  MapsProvider,
  PaymentChargeRequest,
  PaymentChargeResult,
  PaymentFailureReason,
  PaymentsProvider,
  PushDeliveryResult,
  PushMessage,
  PushProvider,
  RouteResult,
  SmsProvider,
  UserRole,
} from '@taxi/shared';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/common/db/db.module';
import { KV_STORE, type KeyValueStore } from '../src/common/kv/kv.store';
import { SMS_PROVIDER } from '../src/features/auth';
import {
  DISPATCH_QUEUE_STORE,
  type DispatchQueueStore,
} from '../src/features/dispatch';
import { InMemoryDispatchQueueStore } from '../src/features/dispatch/queue/in-memory-dispatch-queue.store';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
  type NearbyDriver,
  type OnlineDriver,
} from '../src/features/drivers';
import { MAPS_PROVIDER_SOURCE } from '../src/features/geo';
import { PAYMENTS_PROVIDER } from '../src/features/payments';
import { PUSH_PROVIDER } from '../src/features/push';
// Deep import on purpose: the geo barrel deliberately does not export the class
// — production code injects the token, never the implementation.
import { StubMapsProvider } from '../src/features/geo/stub-maps.provider';

/**
 * The KeyValueStore port, in memory. `advance()` expires a code without
 * sleeping — the whole reason the OTP store talks to a port instead of ioredis.
 */
export class InMemoryKeyValueStore implements KeyValueStore {
  private readonly store = new Map<
    string,
    { value: string; expiresAt: number }
  >();
  private offsetMs = 0;

  /** Test-only: move the virtual clock forward. */
  advance(seconds: number): void {
    this.offsetMs += seconds * 1000;
  }

  private now(): number {
    return Date.now() + this.offsetMs;
  }

  private live(key: string): { value: string; expiresAt: number } | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.live(key)?.value ?? null);
  }

  setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  setIfAbsent(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    // `live()`, not `store.has()` — an EXPIRED key must be reservable again,
    // which is the whole "outside the window" behaviour.
    if (this.live(key)) return Promise.resolve(false);
    this.store.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    return Promise.resolve(true);
  }

  del(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const current = this.live(key);
    const next = Number(current?.value ?? 0) + 1;
    // Only the first write sets the expiry, mirroring RedisKeyValueStore.
    this.store.set(key, {
      value: String(next),
      expiresAt: current?.expiresAt ?? this.now() + ttlSeconds * 1000,
    });
    return Promise.resolve(next);
  }

  ttl(key: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return Promise.resolve(0);
    return Promise.resolve(
      Math.max(0, Math.ceil((entry.expiresAt - this.now()) / 1000)),
    );
  }
}

/**
 * Test-only great-circle distance. The production path never computes one —
 * Redis does, from its geohash — and this exists purely so the fake can order
 * results the same way. The two disagree by a few metres, which is why the
 * store contract asserts ORDER and MEMBERSHIP, never absolute distances.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The DriverLocationStore port, in memory. Holds no clock — `record()` takes
 * `atMs` and `findNearby()` takes `freshSinceMs` — so staleness is tested by
 * passing numbers rather than by sleeping, the same trick as
 * `InMemoryKeyValueStore.advance()`.
 */
export class InMemoryDriverLocationStore implements DriverLocationStore {
  /** cityId → driverIds. */
  private readonly online = new Map<string, Set<string>>();
  /**
   * `location` is null between `markOnline` and the first accepted fix: the
   * seeded proof of life (#14) is an entry with a time and no position, the
   * same shape the real store's `seen` ZSET has without a GEO member.
   */
  private readonly positions = new Map<
    string,
    Map<string, { location: LatLng | null; atMs: number }>
  >();

  /** Test observability: every accepted write, in order. */
  readonly recorded: {
    cityId: string;
    driverId: string;
    location: LatLng;
    atMs: number;
  }[] = [];

  /** Test-only assertion helper — specs read presence through this, not the Maps. */
  isOnline(cityId: string, driverId: string): boolean {
    return this.online.get(cityId)?.has(driverId) ?? false;
  }

  positionOf(
    cityId: string,
    driverId: string,
  ): Promise<{ location: LatLng; atMs: number } | null> {
    const pos = this.positions.get(cityId)?.get(driverId);
    return Promise.resolve(
      pos?.location ? { location: pos.location, atMs: pos.atMs } : null,
    );
  }

  markOnline(cityId: string, driverId: string, atMs: number): Promise<void> {
    const set = this.online.get(cityId) ?? new Set<string>();
    set.add(driverId);
    this.online.set(cityId, set);
    // Refresh the proof of life, keep any recorded position — ZADD + GEO.
    const city =
      this.positions.get(cityId) ??
      new Map<string, { location: LatLng | null; atMs: number }>();
    city.set(driverId, {
      location: city.get(driverId)?.location ?? null,
      atMs,
    });
    this.positions.set(cityId, city);
    return Promise.resolve();
  }

  markOffline(cityId: string, driverId: string): Promise<void> {
    this.online.get(cityId)?.delete(driverId);
    this.positions.get(cityId)?.delete(driverId);
    return Promise.resolve();
  }

  /**
   * Refuses a position for a driver who is not in the online set. The fake must
   * model the Lua gate EXACTLY, or the exclusion and ordering tests prove
   * nothing about the real store.
   */
  record(
    cityId: string,
    driverId: string,
    location: LatLng,
    atMs: number,
  ): Promise<boolean> {
    if (!this.isOnline(cityId, driverId)) return Promise.resolve(false);
    const city =
      this.positions.get(cityId) ??
      new Map<string, { location: LatLng | null; atMs: number }>();
    city.set(driverId, { location, atMs });
    this.positions.set(cityId, city);
    this.recorded.push({ cityId, driverId, location, atMs });
    return Promise.resolve(true);
  }

  findNearby(
    cityId: string,
    centre: LatLng,
    opts: { radiusMeters: number; limit: number; freshSinceMs: number },
  ): Promise<NearbyDriver[]> {
    const nearby: NearbyDriver[] = [];
    for (const [driverId, pos] of this.positions.get(cityId) ?? []) {
      if (!pos.location) continue; // online, never pinged — not routable
      if (pos.atMs < opts.freshSinceMs) continue;
      const distanceMeters = haversineMeters(centre, pos.location);
      if (distanceMeters > opts.radiusMeters) continue;
      nearby.push({ driverId, location: pos.location, distanceMeters });
    }
    nearby.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return Promise.resolve(nearby.slice(0, opts.limit));
  }

  /** No freshness filter, like the real store — the board stale-marks instead. */
  listOnline(cityId: string): Promise<OnlineDriver[]> {
    const out: OnlineDriver[] = [];
    for (const driverId of this.online.get(cityId) ?? []) {
      const pos = this.positions.get(cityId)?.get(driverId);
      out.push({
        driverId,
        location: pos?.location ?? null,
        lastSeenMs: pos?.atMs ?? null,
      });
    }
    return Promise.resolve(out);
  }
}

/** Captures what the stub would have texted, so tests can read the code. */
export class RecordingSmsProvider implements SmsProvider {
  readonly sent: { phone: string; code: string }[] = [];
  /** Ride-status SMS (#63) — separate from OTPs so counts stay assertable. */
  readonly sentMessages: { phone: string; body: string }[] = [];

  sendOtp(phoneE164: string, code: string): Promise<void> {
    this.sent.push({ phone: phoneE164, code });
    return Promise.resolve();
  }

  send(phoneE164: string, body: string): Promise<void> {
    this.sentMessages.push({ phone: phoneE164, body });
    return Promise.resolve();
  }

  lastCodeFor(phone: string): string | undefined {
    return this.sent.filter((s) => s.phone === phone).at(-1)?.code;
  }

  messagesFor(phone: string): string[] {
    return this.sentMessages
      .filter((m) => m.phone === phone)
      .map((m) => m.body);
  }
}

/**
 * Counts what a real (paid) Routes call would have cost. Stands in for
 * `MAPS_PROVIDER_SOURCE`, NOT for `MAPS_PROVIDER` — the real
 * `CachingMapsProvider` stays in the graph and wraps this, which is the only
 * arrangement where "cache hit on a repeated route" means anything.
 */
export class CountingMapsProvider implements MapsProvider {
  routeCalls = 0;
  readonly routed: { from: LatLng; to: LatLng; stops: LatLng[] }[] = [];
  private readonly inner = new StubMapsProvider();
  private nextFailure: Error | null = null;

  /**
   * Fails the NEXT route() only, then reverts — a leaked armed failure would
   * fail the next test's call instead, one case late. Still counted: a Routes
   * call that errors is an attempted paid call like any other.
   *
   * `CachingMapsProvider` sits ABOVE this fake, so an armed failure fires only
   * on a cache MISS. Arm it against coordinates no earlier test in the file has
   * routed, or the cache answers, the failure survives, and it goes off
   * somewhere unrelated.
   */
  failNext(error = new Error('test maps outage')): void {
    this.nextFailure = error;
  }

  route(from: LatLng, to: LatLng, stops: LatLng[] = []): Promise<RouteResult> {
    this.routeCalls += 1;
    this.routed.push({ from, to, stops });
    if (this.nextFailure) {
      const armed = this.nextFailure;
      this.nextFailure = null;
      return Promise.reject(armed);
    }
    return this.inner.route(from, to, stops);
  }

  // Narrow signatures, like the stub they delegate to: both throw, and nothing
  // in this slice geocodes yet (#16 binds a provider that can).
  geocode(): Promise<GeocodeResult[]> {
    return this.inner.geocode();
  }

  reverseGeocode(): Promise<GeocodeResult | null> {
    return this.inner.reverseGeocode();
  }

  /**
   * Address search is SEEDED rather than delegated, because the stub throws:
   * `StubMapsProvider` has no Places binding, and an integration test of
   * `GET /geo/address-search` needs a source that answers.
   *
   * Both counters are separate from `routeCalls` on purpose — Autocomplete
   * Requests and Place Details Essentials are two SKUs with two prices, so one
   * combined number could not check either against the spend model (plan Q5).
   */
  searchCalls = 0;
  resolveCalls = 0;
  readonly places = new Map<string, AddressPoint>();
  readonly searchedSessions: string[] = [];

  seedPlace(placeId: string, point: AddressPoint): void {
    this.places.set(placeId, point);
  }

  searchAddress(
    query: string,
    _language: Language,
    options: AddressSearchOptions,
  ): Promise<AddressSuggestion[]> {
    this.searchCalls += 1;
    this.searchedSessions.push(options.sessionToken);
    const matches = [...this.places.entries()]
      .filter(([, point]) =>
        point.address.toLowerCase().includes(query.toLowerCase()),
      )
      .map(([placeId, point]) => ({
        placeId,
        primaryText: point.address,
        secondaryText: 'Rīga, Latvija',
      }));
    return Promise.resolve(matches);
  }

  resolvePlace(placeId: string): Promise<AddressPoint | null> {
    this.resolveCalls += 1;
    return Promise.resolve(this.places.get(placeId) ?? null);
  }
}

/**
 * Records every charge and can be made to fail on demand. Stands in for
 * `PAYMENTS_PROVIDER` because `StubPaymentsProvider` ALWAYS SUCCEEDS: without
 * this override the decline test would pass for the wrong reason, and "charged
 * exactly once" would be unassertable.
 */
export class RecordingPaymentsProvider implements PaymentsProvider {
  readonly calls: PaymentChargeRequest[] = [];
  private nextFailure: PaymentFailureReason | null = null;

  /** Fails the NEXT charge only, then reverts to succeeding. */
  failNext(reason: PaymentFailureReason): void {
    this.nextFailure = reason;
  }

  /**
   * Clears BOTH the call log and any armed failure — one app per spec file, so
   * state leaks between tests otherwise. Arming `failNext` on a path that never
   * reaches the provider (an unsupported method, a missing instrument) would
   * otherwise decline the *next* test's charge, silently and one case late.
   */
  reset(): void {
    this.calls.splice(0);
    this.nextFailure = null;
  }

  charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    this.calls.push(request);
    if (this.nextFailure) {
      const reason = this.nextFailure;
      this.nextFailure = null;
      return Promise.resolve({
        ok: false,
        reason,
        providerRef: null,
        message: `test ${reason}`,
      });
    }
    // DERIVED FROM THE IDEMPOTENCY KEY, like `StubPaymentsProvider`: a retry
    // with the same key lands on the same PaymentIntent, so tests can assert
    // the ref — not just the key — is stable across a retry (#66).
    return Promise.resolve({
      ok: true,
      providerRef: `pi_test_${request.idempotencyKey}`,
    });
  }
}

/**
 * Captures every push the nudge path sends (#14). `nextResult` answers the
 * NEXT send only, then resets to ok — like `RecordingPaymentsProvider`'s
 * one-shot `nextFailure`.
 */
export class RecordingPushProvider implements PushProvider {
  readonly sent: { token: string; message: PushMessage }[] = [];
  nextResult: PushDeliveryResult = { ok: true };

  send(token: string, message: PushMessage): Promise<PushDeliveryResult> {
    this.sent.push({ token, message });
    const result = this.nextResult;
    this.nextResult = { ok: true };
    return Promise.resolve(result);
  }
}

export interface TestApp {
  app: INestApplication;
  kv: InMemoryKeyValueStore;
  sms: RecordingSmsProvider;
  locations: InMemoryDriverLocationStore;
  maps: CountingMapsProvider;
  /** The SAME instance the app resolves — verified in `createTestApp`. */
  queue: InMemoryDispatchQueueStore;
  /** The SAME instance the app resolves — verified in `createTestApp`. */
  payments: RecordingPaymentsProvider;
  /** What the offline nudge (#14) sent; `PushModule` exports the token, so the swap is sanctioned. */
  push: RecordingPushProvider;
  db: Db;
}

/**
 * The production module graph with exactly seven providers swapped: KV_STORE,
 * DISPATCH_QUEUE_STORE and DRIVER_LOCATION_STORE (between them, no ioredis
 * client is ever constructed — all are `useFactory` providers that would dial
 * Redis), SMS_PROVIDER, MAPS_PROVIDER_SOURCE, PAYMENTS_PROVIDER and
 * PUSH_PROVIDER. Guards,
 * pipes, JWT, Drizzle and the caching maps decorator are all the real wiring.
 *
 * The maps override targets the SOURCE, deliberately: `CachingMapsProvider`
 * stays in the graph, so the integration suite exercises the real cache against
 * a counted fake rather than stubbing the cache away.
 *
 * `controllers` mounts extra test-only controllers alongside the real ones —
 * the app has no non-@Public() route yet, so probing the global guards needs
 * a guarded route that exists only in the test.
 *
 * Suites run SERIALLY (`maxWorkers: 1` in package.json). Every suite shares
 * one Postgres, and dispatch's `findAwaitingDispatch` pool is global — a
 * parallel worker booking a ride mid-test put that foreign ride, oldest-first,
 * in front of this worker's own sweeper tick. Harmless while cascade state was
 * per-ride; fatal since #61 made live cards platform-global: one card dealt
 * onto a foreign ride marks the driver busy everywhere and starves the suite
 * that owns them. Serial workers plus each file retiring its rides keep every
 * tick's world single-owner — which is the architecture's own assumption
 * (one process, one sweeper).
 *
 * The app LISTENS before it is returned, and specs must not listen again (#193).
 * supertest's `serverAddress()` binds the server itself whenever `address()` is
 * null — once per REQUEST, closing it again when the response lands — so an
 * init-only app cost the suite 630 ephemeral binds per run (`observed`, the
 * #193 RCA) where listening once costs one per app built. The host argument is
 * the half that matters: `listen(0)` binds the WILDCARD, and a
 * wildcard bind over a foreign `127.0.0.1` listener succeeds and then loses the
 * routing, handing the request to that other process. A loopback-specific bind
 * either wins (foreign wildcard listener) or fails loudly with EADDRINUSE
 * (foreign specific listener) — never silently answers from somewhere else.
 * `src/test-harness.spec.ts` asserts both halves.
 */
export async function createTestApp(options?: {
  controllers?: Type<unknown>[];
  /** Runs after the app is created but BEFORE init() — where a custom
   *  WebSocket adapter has to be installed to take effect.
   *
   *  MAY return a teardown for whatever it opened. `app.close()` covers the
   *  ordinary case, but it cannot reach a websocket adapter installed here
   *  when `init()` rejects before `registerModules()`: `SocketModule.close()`
   *  has no `applicationConfig` yet and returns at its first line
   *  (`socket-module.js:49-52`), so `dispose()` never runs. That span is this
   *  callback's to close (#208). Nothing calls it on the success path.
   *
   *  Three constraints on that teardown, the first two of which the
   *  implementation below depends on:
   *
   *  - **It must be IDEMPOTENT.** It runs on every failure, after
   *    `app.close()`, which on most paths has already torn the same thing
   *    down — deciding which span a failure fell in would mean reading Nest's
   *    private init state. `RedisIoAdapter.dispose()` qualifies because it
   *    clears both refs before quitting (#205); a `() => server.close()`
   *    (`ERR_SERVER_NOT_RUNNING`) or `() => pool.end()` ("called end on pool
   *    more than once") does not, and would print a confusing second error
   *    from the inner `catch` on every failed boot.
   *  - **Its lifetime is the FAILURE path only.** Nothing calls it when the
   *    boot succeeds and `TestApp` exposes no hook to, so whatever it closes
   *    must also be something `app.close()` reaches once `init()` has got
   *    past `registerModules()`. A resource `close()` can never reach leaks
   *    on every green run.
   *  - **It cannot cover a `configure` that throws BEFORE returning it.**
   *    Whatever such a `configure` has already opened must clean itself up,
   *    because the teardown that would have closed it was never handed back —
   *    the same gap as a `configure` that returns no teardown at all, arrived
   *    at from the other side. The only thing any `configure` here opens
   *    before it returns is `RedisIoAdapter`'s two ioredis clients, and
   *    `connectToRedis` disconnects them itself when the ping rejects (#211).
   *    A future `configure` that opens something else owes the same. */
  configure?: (app: INestApplication) => Promise<(() => Promise<void>) | void>;
}): Promise<TestApp> {
  const kv = new InMemoryKeyValueStore();
  const sms = new RecordingSmsProvider();
  const locations = new InMemoryDriverLocationStore();
  const maps = new CountingMapsProvider();
  const queue = new InMemoryDispatchQueueStore();
  const payments = new RecordingPaymentsProvider();
  const push = new RecordingPushProvider();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options?.controllers ?? [],
  })
    .overrideProvider(KV_STORE)
    .useValue(kv)
    // Like DRIVER_LOCATION_STORE: a `useFactory` provider that would otherwise
    // dial Redis. Overriding it here is what keeps the integration suite
    // Redis-free.
    .overrideProvider(DISPATCH_QUEUE_STORE)
    .useValue(queue)
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .overrideProvider(DRIVER_LOCATION_STORE)
    .useValue(locations)
    // Resolves by token across the whole compiled graph, including providers a
    // module does not export — GeoModule exports MAPS_PROVIDER_SOURCE anyway,
    // which documents this swap as sanctioned.
    .overrideProvider(MAPS_PROVIDER_SOURCE)
    .useValue(maps)
    // Without this the suite binds StubPaymentsProvider, every charge silently
    // succeeds, and the decline test passes for the wrong reason.
    // `PaymentsModule` exports PAYMENTS_PROVIDER, which documents the swap as
    // sanctioned rather than a reach-through.
    .overrideProvider(PAYMENTS_PROVIDER)
    .useValue(payments)
    // The stub logs and delivers nothing; the presence suite asserts on what
    // was sent, to whom, in which language.
    .overrideProvider(PUSH_PROVIDER)
    .useValue(push)
    .compile();

  const app = moduleRef.createNestApplication();
  // Explicitly initialised: without it the compiler cannot prove the `try`
  // reached the assignment, and the `typeof` read in the `catch` is
  // `error TS2454: Variable 'teardownConfigured' is used before being
  // assigned.` (`observed`, both variants compiled under `--strict`).
  let teardownConfigured: (() => Promise<void>) | void = undefined;

  // Every step that can throw sits inside this `try` — `configure`, `init()`,
  // both self-checks, the listen, and the `DRIZZLE` resolution in the returned
  // object. That absolute is about where the STATEMENTS sit, and not a claim
  // that a failing `configure` can strand nothing: one that opens something and
  // throws before returning never registers its teardown, which is the third
  // constraint on `configure`'s contract above.
  //
  // Any of them throwing would otherwise leave `ctx` unassigned with the app
  // still holding whatever `configure` opened — the Redis-gated adapter spec's
  // two ioredis clients — plus, past the listen, a bound socket. `afterAll`'s `ctx.app.close()` then throws on top of it, nothing
  // ever closes the app, and those handles hold jest open past its run (#199,
  // `observed` both ways in `.claude/reports/issue-199-fix.md`; the `init()`
  // half in `.claude/reports/issue-205-fix.md`; the listen half in
  // `.claude/reports/issue-208-fix.md`). Closed here instead: `close()`
  // releases the pool (`onModuleDestroy` → `pool.end()`), releases the socket
  // (`express-adapter.js` `close()`), and reaches `RedisIoAdapter.dispose()`,
  // which quits both clients whether or not a gateway registered an io server
  // (#205).
  //
  // One span `close()` cannot cover, which is why `configure` may hand back a
  // teardown: an `init()` that rejects before `registerModules()` leaves
  // `SocketModule.close()` without an `applicationConfig`, so it returns at
  // its first line and never reaches `dispose()` (`socket-module.js:49-52`).
  // The span is `applyOptions()`, the http adapter's own `init()` (a no-op on
  // Express) and the parser middleware — `nest-application.js:99-102`.
  //
  // The original error is the one that names the defect, so anything thrown by
  // the teardown path — `close()` or the `configure` teardown — is printed and
  // the ORIGINAL is rethrown; neither is ever allowed to mask it.
  try {
    teardownConfigured = await options?.configure?.(app);

    await app.init();

    // THE SELF-CHECK. Seeding a queue the strategy never reads would leave it
    // empty at dispatch time, the strategy would fall back to proximity order,
    // and the queue-fairness case would pass FOR THE AUTO-MATCH REASON — a
    // green test asserting the opposite of what it claims. Assert the
    // container hands back the very object this harness seeds.
    const resolvedQueue = app.get<DispatchQueueStore>(DISPATCH_QUEUE_STORE);
    if (resolvedQueue !== queue) {
      throw new Error(
        'DISPATCH_QUEUE_STORE override did not take: the app resolved a different instance than the harness seeds. Any queue-fairness assertion built on this app would be meaningless.',
      );
    }

    // Same reasoning, higher stakes: a PAYMENTS_PROVIDER override that did
    // not take leaves the always-succeeding stub bound, so `payments.calls`
    // stays empty and `failNext` does nothing. "Charged exactly once" and "a
    // decline writes no ledger entries" would then both pass without testing
    // anything.
    const resolvedPayments = app.get<PaymentsProvider>(PAYMENTS_PROVIDER);
    if (resolvedPayments !== payments) {
      throw new Error(
        'PAYMENTS_PROVIDER override did not take: the app resolved a different instance than the harness records through. Any charge-count or decline assertion built on this app would be meaningless.',
      );
    }

    // LAST, after both self-checks: nothing between `init()` and here needs a
    // port (both checks are `app.get()` calls), and a check that throws before
    // the listen never has a bound socket to release — with the listen in its
    // old place that socket alone held jest open (#194 review F1, `observed`
    // both ways). Inside the `try` since #208: the ordering is unchanged, and
    // a rejection here or from the `DRIZZLE` resolution below now takes the
    // same `catch` rather than escaping with the app open.
    await app.listen(0, '127.0.0.1');

    return {
      app,
      kv,
      sms,
      locations,
      maps,
      queue,
      payments,
      push,
      db: app.get<Db>(DRIZZLE),
    };
  } catch (err) {
    try {
      await app.close();
    } catch (closeErr) {
      console.error(
        'createTestApp: app.close() after a failed boot threw (the original error follows)',
        closeErr,
      );
    }
    // The backstop for the pre-`registerModules()` span above. Run on EVERY
    // failure rather than only that one: `RedisIoAdapter.dispose()` clears
    // both references before quitting (#205), so a second pass after a
    // `close()` that already disposed is a no-op, and deciding which span the
    // failure fell in would mean reading Nest's private init state.
    try {
      if (typeof teardownConfigured === 'function') await teardownConfigured();
    } catch (teardownErr) {
      console.error(
        'createTestApp: the configure teardown after a failed boot threw (the original error follows)',
        teardownErr,
      );
    }
    throw err;
  }
}

/**
 * A distinct E.164 per spec file — `users.phone` is unique and the database is
 * not reset between tests, so parallel workers must not collide.
 */
export function phoneFor(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(3, '0')}`;
}

/** #20 owns dispatcher/admin provisioning; until then tests insert the row. */
export async function insertUser(
  db: Db,
  input: { phone: string; role: UserRole },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(users)
    .values({ phone: input.phone, role: input.role })
    .returning();
  return { id: row!.id };
}

const openClients: Socket[] = [];

/**
 * Connects and resolves only once the server has run handleConnection, so room
 * assertions immediately after are never racy. Rejects on connect_error so a
 * failed handshake is an explicit test outcome.
 *
 * `transports` defaults to websocket only — faster, fewer handles — but that
 * transport is exempt from CORS, so a suite pinned to it is blind to a missing
 * CORS config by construction. Pass `['polling']` to exercise what a browser
 * actually starts with.
 */
export function connectClient(
  port: number,
  token?: string,
  transports: ('websocket' | 'polling')[] = ['websocket'],
): Promise<Socket> {
  // `127.0.0.1`, not `localhost`: the app now binds loopback IPv4 only, and
  // `localhost` resolves to `::1` first here. Happy Eyeballs (autoSelectFamily,
  // on by default in Node 20) does reach us either way — but it reaches
  // whoever answers ::1 FIRST, which is the same wrong-process hole the
  // loopback bind closes on the HTTP path (#193).
  const client = io(`http://127.0.0.1:${port}`, {
    auth: token ? { token } : {},
    transports,
    reconnection: false, // a rejected handshake must not retry forever
  });
  openClients.push(client);
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve(client));
    client.once('connect_error', (err) => reject(err));
  });
}

/** afterEach(closeClients); afterAll(() => app.close()) — in that order. */
export function closeClients(): void {
  for (const c of openClients.splice(0)) c.close();
}
