import { RIDE_CATEGORIES } from '@taxi/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  drivers,
  ledgerAccounts,
  rideFareLines,
  rides,
  rideTariffs,
  users,
} from '../src/schema';
import { RIGA_CITY_ID } from '../src/seed/riga';
import { closeTestDb, getTestDb } from './helpers';

afterAll(closeTestDb);

describe('schema constraints', () => {
  it('valid user → driver → ride with fare lines roundtrips, totals intact (expected)', async () => {
    const db = getTestDb();
    const [rider] = await db
      .insert(users)
      .values({ phone: '+37120000001', role: 'rider' })
      .returning();
    const [driverUser] = await db
      .insert(users)
      .values({ phone: '+37120000002', role: 'driver' })
      .returning();
    await db.insert(drivers).values({ userId: driverUser!.id });

    const [ride] = await db
      .insert(rides)
      .values({
        orderId: '10000000-0000-4000-8000-000000000001',
        status: 'completed',
        riderId: rider!.id,
        driverId: driverUser!.id,
        request: { note: 'wire snapshot — zod-validated at the boundary' },
        paymentMethod: 'card',
        category: 'standard',
        totalCents: 1250,
      })
      .returning();

    await db.insert(rideFareLines).values([
      { rideId: ride!.id, lineType: 'base', amountCents: 500, sort: 0 },
      { rideId: ride!.id, lineType: 'distance', amountCents: 600, sort: 1 },
      { rideId: ride!.id, lineType: 'time', amountCents: 250, sort: 2 },
      { rideId: ride!.id, lineType: 'discount', amountCents: -100, sort: 3 },
    ]);

    const lines = await db
      .select()
      .from(rideFareLines)
      .where(eq(rideFareLines.rideId, ride!.id));
    const sum = lines.reduce((acc, l) => acc + l.amountCents, 0);
    expect(lines).toHaveLength(4);
    expect(sum).toBe(ride!.totalCents);
  });

  it('every *_cents column across the schema is integer — the money rule as a self-extending guard (edge)', async () => {
    // A future float money column fails this without anyone editing the test.
    const db = getTestDb();
    const result = await db.execute<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      sql`SELECT table_name, column_name, data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name LIKE '%\\_cents'`,
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(`${row.table_name}.${row.column_name}: ${row.data_type}`).toBe(
        `${row.table_name}.${row.column_name}: integer`,
      );
    }
  });

  it('a second platform ledger account (owner_id NULL) is rejected — NULLS NOT DISTINCT (failure)', async () => {
    const db = getTestDb();
    await db.insert(ledgerAccounts).values({ ownerType: 'platform' });
    const err: unknown = await db
      .insert(ledgerAccounts)
      .values({ ownerType: 'platform' })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).cause)).toMatch(/ledger_accounts_owner_uix/);
  });

  it('updated_at moves on UPDATE instead of staying frozen at insert (edge)', async () => {
    const db = getTestDb();
    const [rider] = await db
      .insert(users)
      .values({ phone: '+37120000003', role: 'rider' })
      .returning();
    const [ride] = await db
      .insert(rides)
      .values({
        orderId: '10000000-0000-4000-8000-000000000002',
        status: 'requested',
        riderId: rider!.id,
        request: {},
        paymentMethod: 'cash',
        category: 'standard',
      })
      .returning();

    await new Promise((r) => setTimeout(r, 5)); // outlast ms timestamp granularity
    const [after] = await db
      .update(rides)
      .set({ status: 'cancelled_by_rider' })
      .where(eq(rides.id, ride!.id))
      .returning();
    expect(after!.updatedAt.getTime()).toBeGreaterThan(
      ride!.updatedAt.getTime(),
    );
  });

  it('ride_offers has the driver-side composite index the dispatch loop reads by (edge)', async () => {
    const db = getTestDb();
    const result = await db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes
          WHERE tablename = 'ride_offers' AND indexname = 'ride_offers_driver_idx'`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.indexdef).toMatch(/\(driver_id, status\)/);
  });

  it('the seed produced exactly one Rīga tariff per ride category (expected)', async () => {
    const db = getTestDb();
    const rows = await db
      .select()
      .from(rideTariffs)
      .where(eq(rideTariffs.cityId, RIGA_CITY_ID));
    expect(rows).toHaveLength(RIDE_CATEGORIES.length);
    expect(rows.map((r) => r.category).sort()).toEqual(
      [...RIDE_CATEGORIES].sort(),
    );
    // Rates are config rows, never constants — the standard card is the one
    // fitted to S5-1's real €13 centre→RIX fare.
    const standard = rows.find((r) => r.category === 'standard');
    expect(standard).toMatchObject({
      baseCents: 200,
      perKmCents: 80,
      perMinuteCents: 15,
      minimumFareCents: 350,
    });
  });

  it('a second tariff for the same city and category is rejected (failure)', async () => {
    const db = getTestDb();
    const err: unknown = await db
      .insert(rideTariffs)
      .values({
        cityId: RIGA_CITY_ID,
        category: 'standard',
        baseCents: 999,
        perKmCents: 999,
        perMinuteCents: 999,
        minimumFareCents: 999,
      })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).cause)).toMatch(
      /ride_tariffs_city_category_uix/,
    );
  });

  it('rejects a ride status outside the shared state machine (failure)', async () => {
    // NOTE: Postgres silently ROUNDS numeric→integer on insert, so the
    // integer-cents rule is proven by the column-type sweep above, never by
    // expecting an error on a fractional insert. The enum is what rejects.
    const db = getTestDb();
    const err: unknown = await db
      .execute(
        sql`INSERT INTO rides (order_id, status, rider_id, request, payment_method, category)
            VALUES (gen_random_uuid(), 'flying', gen_random_uuid(), '{}', 'card', 'standard')`,
      )
      .then(() => null)
      .catch((e: unknown) => e);
    // Drizzle wraps the pg error; the enum rejection is on `cause`.
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).cause)).toMatch(
      /invalid input value for enum ride_status/,
    );
  });
});
