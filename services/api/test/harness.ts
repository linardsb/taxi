import { INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { users, type Db } from '@taxi/db';
import type { LatLng, SmsProvider, UserRole } from '@taxi/shared';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/common/db/db.module';
import { KV_STORE, type KeyValueStore } from '../src/common/kv/kv.store';
import { SMS_PROVIDER } from '../src/features/auth';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
  type NearbyDriver,
} from '../src/features/drivers';

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

export interface TestApp {
  app: INestApplication;
  kv: InMemoryKeyValueStore;
  sms: RecordingSmsProvider;
  locations: InMemoryDriverLocationStore;
  db: Db;
}

/**
 * The production module graph with exactly three providers swapped: KV_STORE
 * and DRIVER_LOCATION_STORE (between them, no ioredis client is ever
 * constructed — both are `useFactory` providers that would dial Redis) and
 * SMS_PROVIDER. Guards, pipes, JWT and Drizzle are all the real wiring.
 *
 * `controllers` mounts extra test-only controllers alongside the real ones —
 * the app has no non-@Public() route yet, so probing the global guards needs
 * a guarded route that exists only in the test.
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

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options?.controllers ?? [],
  })
    .overrideProvider(KV_STORE)
    .useValue(kv)
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .overrideProvider(DRIVER_LOCATION_STORE)
    .useValue(locations)
    .compile();

  const app = moduleRef.createNestApplication();
  await options?.configure?.(app);
  await app.init();

  return { app, kv, sms, locations, db: app.get<Db>(DRIZZLE) };
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
 */
export function connectClient(port: number, token?: string): Promise<Socket> {
  const client = io(`http://localhost:${port}`, {
    auth: token ? { token } : {},
    transports: ['websocket'], // skip the polling upgrade — faster, fewer handles
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
