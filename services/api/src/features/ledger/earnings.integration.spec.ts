import { ledgerAccounts, ledgerEntries, rides } from '@taxi/db';
import { authSessionSchema, driverEarningsTodaySchema } from '@taxi/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  createTestApp,
  insertUser,
  phoneFor,
  type TestApp,
} from '../../../test/harness';
import { LEDGER_DAY_TIMEZONE } from './ledger.policy';

/** `+371292` is this spec file's E.164 range — see phoneFor(). */
const p = (n: number) => phoneFor('+371292', n);

describe('GET /drivers/me/earnings/today (integration, #14)', () => {
  let ctx: TestApp;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  async function signIn(phone: string, role: 'rider' | 'driver' = 'driver') {
    await http.post('/auth/otp/request').send({ phone, role }).expect(200);
    const code = ctx.sms.lastCodeFor(phone)!;
    const res = await http
      .post('/auth/otp/verify')
      .send({ phone, code })
      .expect(200);
    const session = authSessionSchema.parse(res.body);
    const auth = `Bearer ${session.accessToken}`;
    // Provisions the `drivers` row — `rides.driver_id` FKs it.
    if (role === 'driver')
      await http.get('/drivers/me').set('authorization', auth).expect(200);
    return { id: session.user.id, auth };
  }

  /** A settled ride row — the FK `count(distinct ride_id)` needs; nothing on it is read. */
  async function ride(riderId: string, driverId: string): Promise<string> {
    const [row] = await ctx.db
      .insert(rides)
      .values({
        orderId: randomUUID(),
        status: 'settled',
        riderId,
        driverId,
        request: {},
        paymentMethod: 'cash',
        category: 'standard',
      })
      .returning({ id: rides.id });
    return row!.id;
  }

  it('sums ride_fare + commission for today only, ignoring the collection pair and yesterday (expected)', async () => {
    const d = await signIn(p(1));
    const rider = await insertUser(ctx.db, { phone: p(90), role: 'rider' });
    const [account] = await ctx.db
      .insert(ledgerAccounts)
      .values({ ownerType: 'driver', ownerId: d.id })
      .returning({ id: ledgerAccounts.id });
    const accountId = account!.id;
    const [rideA, rideB, rideOld] = await Promise.all([
      ride(rider.id, d.id),
      ride(rider.id, d.id),
      ride(rider.id, d.id),
    ]);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await ctx.db.insert(ledgerEntries).values([
      // Ride A: €12.40 fare, €1.86 commission → +1054 net.
      {
        transactionId: randomUUID(),
        accountId,
        rideId: rideA,
        entryType: 'ride_fare',
        amountCents: 1240,
      },
      {
        transactionId: randomUUID(),
        accountId,
        rideId: rideA,
        entryType: 'commission',
        amountCents: -186,
      },
      // Cash collection: the driver took the money — NOT earnings.
      {
        transactionId: randomUUID(),
        accountId,
        rideId: rideA,
        entryType: 'cash_settlement',
        amountCents: -1240,
      },
      // Ride B: €8.00 fare, €1.20 commission → +680 net.
      {
        transactionId: randomUUID(),
        accountId,
        rideId: rideB,
        entryType: 'ride_fare',
        amountCents: 800,
      },
      {
        transactionId: randomUUID(),
        accountId,
        rideId: rideB,
        entryType: 'commission',
        amountCents: -120,
      },
      // Yesterday's pair — outside the day.
      {
        transactionId: randomUUID(),
        accountId,
        rideId: rideOld,
        entryType: 'ride_fare',
        amountCents: 5000,
        createdAt: yesterday,
      },
      {
        transactionId: randomUUID(),
        accountId,
        rideId: rideOld,
        entryType: 'commission',
        amountCents: -750,
        createdAt: yesterday,
      },
    ]);

    const res = await http
      .get('/drivers/me/earnings/today')
      .set('authorization', d.auth)
      .expect(200);

    const body = driverEarningsTodaySchema.parse(res.body);
    // `derived`: 1240 − 186 + 800 − 120 = 1734, over rides A and B.
    expect(body.earnedCents).toBe(1734);
    expect(body.rideCount).toBe(2);
    expect(body.timezone).toBe(LEDGER_DAY_TIMEZONE);
    expect(body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reads zero for a driver with no ledger account at all (edge)', async () => {
    const d = await signIn(p(2));

    const res = await http
      .get('/drivers/me/earnings/today')
      .set('authorization', d.auth)
      .expect(200);

    expect(driverEarningsTodaySchema.parse(res.body)).toMatchObject({
      earnedCents: 0,
      rideCount: 0,
      timezone: LEDGER_DAY_TIMEZONE,
    });
  });

  it('refuses a rider (failure)', async () => {
    const rider = await signIn(p(3), 'rider');

    await http
      .get('/drivers/me/earnings/today')
      .set('authorization', rider.auth)
      .expect(403);
  });
});
