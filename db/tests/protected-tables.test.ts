/**
 * K1 (#316, PRD metric 4): no application path can delete or overwrite a
 * protected record. Driven by `PROTECTED_TABLES` / `DELETE_BLOCKED_TABLES`, so
 * a table added there is covered here without editing the cases.
 *
 * "Application path" = drizzle's query builder (the api's data path) and raw
 * SQL. The test runs as superuser `taxi`, so it proves no application code
 * path can delete or overwrite, not that a superuser cannot — a superuser can
 * DISABLE TRIGGER. Option E2 (least-privilege role) is deferred (K1); the
 * drift check below at least fails on a disabled or missing trigger.
 *
 * Every destructive attempt runs in a transaction that always rolls back, so
 * a regressed trigger turns THIS test red instead of wiping rows other files
 * in `taxi_test` rely on.
 */
import { eq, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { DatabaseError } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DELETE_BLOCKED_TABLES,
  PROTECTED_TABLES,
} from '../src/protected-tables';
import {
  drivers,
  rideEvents,
  rideOffers,
  rides,
  users,
  vehicles,
} from '../src/schema';
import { closeTestDb, getTestDb, getTestPool } from './helpers';

afterAll(closeTestDb);

type ProtectedName = (typeof PROTECTED_TABLES)[number]['table'];
type BlockedName = (typeof DELETE_BLOCKED_TABLES)[number]['table'];

const ids = {} as Record<ProtectedName | BlockedName, string>;

/** Per table: its drizzle object, key column, and one harmless UPDATE. A name with no entry is a compile error. */
const PROTECTED: Record<
  ProtectedName,
  {
    table: PgTable;
    where: () => SQL;
    set: Record<string, unknown>;
    rawUpdate: string;
  }
> = {
  ride_events: {
    table: rideEvents,
    where: () => eq(rideEvents.id, ids.ride_events),
    set: { reasonText: 'edited' },
    rawUpdate: `UPDATE ride_events SET reason_text = 'edited' WHERE id = $1`,
  },
  ride_offers: {
    table: rideOffers,
    where: () => eq(rideOffers.id, ids.ride_offers),
    // A frozen column: only status/responded_at/decline_reason may move.
    set: { sentAt: new Date() },
    rawUpdate: `UPDATE ride_offers SET sent_at = now() WHERE id = $1`,
  },
};

const BLOCKED: Record<
  BlockedName,
  {
    table: PgTable;
    where: () => SQL;
    set: Record<string, unknown>;
    key: string;
  }
> = {
  rides: {
    table: rides,
    where: () => eq(rides.id, ids.rides),
    set: { totalCents: 1 },
    key: 'id',
  },
  drivers: {
    table: drivers,
    where: () => eq(drivers.userId, ids.drivers),
    set: { rating: 4.5 },
    key: 'user_id',
  },
  vehicles: {
    table: vehicles,
    where: () => eq(vehicles.id, ids.vehicles),
    set: { make: 'Škoda' },
    key: 'id',
  },
};

const PROTECTED_RE = /protected_record:/;

class Rollback extends Error {
  constructor(readonly inner: unknown) {
    super('rollback');
  }
}

/** Runs a drizzle statement in a tx that always rolls back; returns its error or null. */
async function drizzleAttempt(
  run: (
    tx: Parameters<
      Parameters<ReturnType<typeof getTestDb>['transaction']>[0]
    >[0],
  ) => Promise<unknown>,
): Promise<unknown> {
  try {
    await getTestDb().transaction(async (tx) => {
      const err = await run(tx).then(
        () => null,
        (e: unknown) => e,
      );
      throw new Rollback(err);
    });
  } catch (e) {
    if (e instanceof Rollback) return e.inner;
    throw e;
  }
  return null;
}

/**
 * Raw SQL on one client: every `setup` statement must succeed, then `attempt`
 * runs; always ROLLBACK. Returns the attempt's error or null.
 */
async function rawAttempt(
  attempt: string,
  params: unknown[] = [],
  setup: string[] = [],
): Promise<DatabaseError | null> {
  const client = await getTestPool().connect();
  try {
    await client.query('BEGIN');
    for (const s of setup) await client.query(s, params);
    try {
      await client.query(attempt, params);
      return null;
    } catch (e) {
      return e as DatabaseError;
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

function expectRefused(err: DatabaseError | null): void {
  expect(err, 'statement was not refused').not.toBeNull();
  expect(err!.code).toBe('P0001');
  expect(err!.message).toMatch(/^protected_record:/);
}

function expectDrizzleRefused(err: unknown): void {
  expect(err, 'statement was not refused').toBeInstanceOf(Error);
  expect(String((err as Error).cause)).toMatch(PROTECTED_RE);
}

beforeAll(async () => {
  const db = getTestDb();
  const [rider] = await db
    .insert(users)
    .values({ phone: '+37120316001', role: 'rider' })
    .returning();
  const [driverUser] = await db
    .insert(users)
    .values({ phone: '+37120316002', role: 'driver' })
    .returning();
  await db.insert(drivers).values({ userId: driverUser!.id });
  const [vehicle] = await db
    .insert(vehicles)
    .values({
      driverId: driverUser!.id,
      plate: 'PR-316',
      make: 'Toyota',
      model: 'Prius',
      year: 2020,
      passengerSeats: 4,
    })
    .returning();
  // The ride references the vehicle — deleting the car must still be refused
  // by the trigger (which fires before the FK).
  const [ride] = await db
    .insert(rides)
    .values({
      orderId: '31600000-0000-4000-8000-000000000001',
      status: 'requested',
      riderId: rider!.id,
      vehicleId: vehicle!.id,
      request: {},
      paymentMethod: 'card',
      category: 'standard',
    })
    .returning();
  const [offer] = await db
    .insert(rideOffers)
    .values({
      rideId: ride!.id,
      driverId: driverUser!.id,
      status: 'pending',
      source: 'auto_match',
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + 20_000),
      etaSeconds: 120,
      pickup: {},
      destination: {},
      quote: {},
      split: {},
    })
    .returning();
  const [event] = await db
    .insert(rideEvents)
    .values({
      rideId: ride!.id,
      kind: 'created',
      toStatus: 'requested',
      actorKind: 'rider',
      actorId: rider!.id,
    })
    .returning();
  ids.rides = ride!.id;
  ids.drivers = driverUser!.id;
  ids.vehicles = vehicle!.id;
  ids.ride_offers = offer!.id;
  ids.ride_events = event!.id;
});

describe.each(PROTECTED_TABLES.map((p) => p.table))(
  'protected table %s (K1 failure)',
  (name) => {
    const t = PROTECTED[name];

    it('drizzle UPDATE is refused', async () => {
      expectDrizzleRefused(
        await drizzleAttempt((tx) =>
          tx.update(t.table).set(t.set).where(t.where()),
        ),
      );
    });

    it('drizzle DELETE is refused', async () => {
      expectDrizzleRefused(
        await drizzleAttempt((tx) => tx.delete(t.table).where(t.where())),
      );
    });

    it('raw UPDATE and DELETE are refused', async () => {
      expectRefused(await rawAttempt(t.rawUpdate, [ids[name]]));
      expectRefused(
        await rawAttempt(`DELETE FROM ${name} WHERE id = $1`, [ids[name]]),
      );
    });

    it('TRUNCATE … CASCADE is refused', async () => {
      expectRefused(await rawAttempt(`TRUNCATE ${name} CASCADE`));
    });
  },
);

describe.each(DELETE_BLOCKED_TABLES.map((b) => b.table))(
  'delete-blocked table %s',
  (name) => {
    const t = BLOCKED[name];

    it('drizzle DELETE is refused (failure)', async () => {
      expectDrizzleRefused(
        await drizzleAttempt((tx) => tx.delete(t.table).where(t.where())),
      );
    });

    it('raw DELETE and TRUNCATE … CASCADE are refused (failure)', async () => {
      expectRefused(
        await rawAttempt(`DELETE FROM ${name} WHERE ${t.key} = $1`, [
          ids[name],
        ]),
      );
      expectRefused(await rawAttempt(`TRUNCATE ${name} CASCADE`));
    });

    it('an ordinary UPDATE still succeeds — operational rows stay mutable, AP1 (expected)', async () => {
      expect(
        await drizzleAttempt((tx) =>
          tx.update(t.table).set(t.set).where(t.where()),
        ),
      ).toBeNull();
    });
  },
);

describe('drift check', () => {
  it('every listed trigger exists and is enabled (failure on a missing or disabled one)', async () => {
    const { rows } = await getTestPool().query<{
      relname: string;
      tgname: string;
      tgenabled: string;
    }>(
      `SELECT c.relname, t.tgname, t.tgenabled FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal`,
    );
    for (const { table, triggers } of [
      ...PROTECTED_TABLES,
      ...DELETE_BLOCKED_TABLES,
    ]) {
      for (const tg of triggers) {
        const row = rows.find((r) => r.relname === table && r.tgname === tg);
        expect(row, `${table}.${tg} missing`).toBeDefined();
        expect(row!.tgenabled, `${table}.${tg} disabled`).not.toBe('D');
      }
    }
  });

  it('rides.vehicle_id and ride_fare_lines.ride_id are NO ACTION, not SET NULL / CASCADE (G2, G9)', async () => {
    const { rows } = await getTestPool().query<{
      conname: string;
      confdeltype: string;
    }>(
      `SELECT conname, confdeltype FROM pg_constraint
       WHERE conname IN ('rides_vehicle_id_vehicles_id_fk', 'ride_fare_lines_ride_id_rides_id_fk')`,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.confdeltype, r.conname).toBe('a');
  });
});

describe('ride_offers guard matrix', () => {
  const upd = (set: string): string =>
    `UPDATE ride_offers SET ${set} WHERE id = $1`;
  const offer = (): unknown[] => [ids.ride_offers];

  it.each([
    [
      'pending → accepted with responded_at',
      [upd(`status = 'accepted', responded_at = now()`)],
    ],
    [
      'pending → declined with decline_reason',
      [
        upd(
          `status = 'declined', responded_at = now(), decline_reason = 'decline_too_far'`,
        ),
      ],
    ],
    ['pending → expired', [upd(`status = 'expired'`)]],
    ['pending → revoked', [upd(`status = 'revoked'`)]],
    [
      'accepted → revoked, responded_at unchanged (AC 3 edge)',
      [
        upd(`status = 'accepted', responded_at = now()`),
        upd(`status = 'revoked'`),
      ],
    ],
  ])('allows %s (expected)', async (_label, steps) => {
    const [last, ...rest] = [...steps].reverse();
    expect(await rawAttempt(last!, offer(), rest.reverse())).toBeNull();
  });

  it.each([
    [
      'declined → accepted (AC 3 edge)',
      [upd(`status = 'declined'`)],
      upd(`status = 'accepted'`),
    ],
    [
      'expired → pending',
      [upd(`status = 'expired'`)],
      upd(`status = 'pending'`),
    ],
    [
      'revoked → accepted',
      [upd(`status = 'revoked'`)],
      upd(`status = 'accepted'`),
    ],
    ['pending → pending no-op', [], upd(`status = 'pending'`)],
    [
      'responded_at written twice',
      [upd(`status = 'accepted', responded_at = now()`)],
      upd(`status = 'revoked', responded_at = now() + interval '1 minute'`),
    ],
    [
      'decline_reason on an expired move',
      [],
      upd(`status = 'expired', decline_reason = 'decline_too_far'`),
    ],
    ['expires_at change on a pending row', [], upd(`expires_at = now()`)],
  ])('refuses %s (failure)', async (_label, setup, attempt) => {
    expectRefused(await rawAttempt(attempt, offer(), setup));
  });
});
