import { INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { users, type Db } from '@taxi/db';
import type {
  GeocodeResult,
  LatLng,
  MapsProvider,
  PaymentChargeRequest,
  PaymentChargeResult,
  PaymentFailureReason,
  PaymentsProvider,
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
} from '../src/features/drivers';
import { MAPS_PROVIDER_SOURCE } from '../src/features/geo';
import { PAYMENTS_PROVIDER } from '../src/features/payments';
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
  private readonly positions = new Map<
    string,
    Map<string, { location: LatLng; atMs: number }>
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

  /** Test-only assertion helper. */
  positionOf(
    cityId: string,
    driverId: string,
  ): { location: LatLng; atMs: number } | undefined {
    return this.positions.get(cityId)?.get(driverId);
  }

  markOnline(cityId: string, driverId: string): Promise<void> {
    const set = this.online.get(cityId) ?? new Set<string>();
    set.add(driverId);
    this.online.set(cityId, set);
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
      new Map<string, { location: LatLng; atMs: number }>();
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
      if (pos.atMs < opts.freshSinceMs) continue;
      const distanceMeters = haversineMeters(centre, pos.location);
      if (distanceMeters > opts.radiusMeters) continue;
      nearby.push({ driverId, location: pos.location, distanceMeters });
    }
    nearby.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return Promise.resolve(nearby.slice(0, opts.limit));
  }
}

/** Captures what the stub would have texted, so tests can read the code. */
export class RecordingSmsProvider implements SmsProvider {
  readonly sent: { phone: string; code: string }[] = [];

  sendOtp(phoneE164: string, code: string): Promise<void> {
    this.sent.push({ phone: phoneE164, code });
    return Promise.resolve();
  }

  lastCodeFor(phone: string): string | undefined {
    return this.sent.filter((s) => s.phone === phone).at(-1)?.code;
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

  route(from: LatLng, to: LatLng, stops: LatLng[] = []): Promise<RouteResult> {
    this.routeCalls += 1;
    this.routed.push({ from, to, stops });
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
  db: Db;
}

/**
 * The production module graph with exactly six providers swapped: KV_STORE,
 * DISPATCH_QUEUE_STORE and DRIVER_LOCATION_STORE (between them, no ioredis
 * client is ever constructed — all are `useFactory` providers that would dial
 * Redis), SMS_PROVIDER, MAPS_PROVIDER_SOURCE and PAYMENTS_PROVIDER. Guards,
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
 */
export async function createTestApp(options?: {
  controllers?: Type<unknown>[];
  /** Runs after the app is created but BEFORE init() — where a custom
   *  WebSocket adapter has to be installed to take effect. */
  configure?: (app: INestApplication) => Promise<void>;
}): Promise<TestApp> {
  const kv = new InMemoryKeyValueStore();
  const sms = new RecordingSmsProvider();
  const locations = new InMemoryDriverLocationStore();
  const maps = new CountingMapsProvider();
  const queue = new InMemoryDispatchQueueStore();
  const payments = new RecordingPaymentsProvider();

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
    .compile();

  const app = moduleRef.createNestApplication();
  await options?.configure?.(app);
  await app.init();

  // THE SELF-CHECK. Seeding a queue the strategy never reads would leave it
  // empty at dispatch time, the strategy would fall back to proximity order,
  // and the queue-fairness case would pass FOR THE AUTO-MATCH REASON — a green
  // test asserting the opposite of what it claims. Assert the container hands
  // back the very object this harness seeds.
  const resolvedQueue = app.get<DispatchQueueStore>(DISPATCH_QUEUE_STORE);
  if (resolvedQueue !== queue) {
    throw new Error(
      'DISPATCH_QUEUE_STORE override did not take: the app resolved a different instance than the harness seeds. Any queue-fairness assertion built on this app would be meaningless.',
    );
  }

  // Same reasoning, higher stakes: a PAYMENTS_PROVIDER override that did not
  // take leaves the always-succeeding stub bound, so `payments.calls` stays
  // empty and `failNext` does nothing. "Charged exactly once" and "a decline
  // writes no ledger entries" would then both pass without testing anything.
  const resolvedPayments = app.get<PaymentsProvider>(PAYMENTS_PROVIDER);
  if (resolvedPayments !== payments) {
    throw new Error(
      'PAYMENTS_PROVIDER override did not take: the app resolved a different instance than the harness records through. Any charge-count or decline assertion built on this app would be meaningless.',
    );
  }

  return {
    app,
    kv,
    sms,
    locations,
    maps,
    queue,
    payments,
    db: app.get<Db>(DRIZZLE),
  };
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
  const client = io(`http://localhost:${port}`, {
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
