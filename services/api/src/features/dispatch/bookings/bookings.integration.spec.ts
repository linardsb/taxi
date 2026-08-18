import { customers, dispatchAuditLog, rides, users } from '@taxi/db';
import { IDEMPOTENCY_KEY_HEADER } from '@taxi/shared';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  createTestApp,
  insertUser,
  phoneFor,
  type TestApp,
} from '../../../../test/harness';
import { AuthTokenService } from '../../auth';

/** `+371253` is this spec file's E.164 range — see phoneFor(). */
const p = (n: number) => phoneFor('+371253', n);

const PICKUP = {
  location: { lat: 56.96, lng: 24.085 },
  address: 'Hanzas iela, Rīga',
};
const DESTINATION = {
  location: { lat: 56.9712, lng: 24.18 },
  address: 'Teika, Rīga',
};

const body = (callerPhone: string, over: Record<string, unknown> = {}) => ({
  callerPhone,
  pickup: PICKUP,
  destination: DESTINATION,
  paymentMethod: 'cash',
  ...over,
});

describe('POST /dispatch/bookings (#19)', () => {
  let ctx: TestApp;
  let http: request.Agent;
  let tokens: AuthTokenService;
  let dispatcherAuth: string;

  const createdRides: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
    tokens = ctx.app.get(AuthTokenService);

    const dispatcher = await insertUser(ctx.db, {
      phone: p(1),
      role: 'dispatcher',
    });
    dispatcherAuth = `Bearer ${
      (await tokens.issue({ id: dispatcher.id, role: 'dispatcher' }))
        .accessToken
    }`;
  });

  afterEach(async () => {
    // Every ride this file creates is retired: the sweeper's oldest-first batch
    // is global, and a live ride left behind starves the next suite.
    if (createdRides.length > 0) {
      await ctx.db
        .update(rides)
        .set({ status: 'completed' })
        .where(inArray(rides.id, createdRides));
      createdRides.splice(0);
    }
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const book = (callerPhone: string, key: string, over = {}) =>
    http
      .post('/dispatch/bookings')
      .set('authorization', dispatcherAuth)
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .send(body(callerPhone, over));

  it('creates a phone-channel ride for a caller who has never rung (expected — AC #5, AC #12)', async () => {
    const caller = p(10);

    const res = await book(caller, randomUUID(), { callerName: 'Anna' });

    expect(res.status).toBe(201);
    const rideId = (res.body as { ride: { id: string } }).ride.id;
    createdRides.push(rideId);

    const [row] = await ctx.db
      .select()
      .from(rides)
      .where(eq(rides.id, rideId))
      .limit(1);
    // The ONE thing that distinguishes a phone order from an app one — and the
    // column AC #12's share query counts.
    expect(row?.bookingChannel).toBe('phone');
    // It entered the machine normally: quoted, and awaiting dispatch like any
    // other ride.
    expect(row?.status).toBe('requested');
    expect(row?.totalCents).toBeGreaterThan(0);

    // The caller became a rider and a customer record, so the next call pops.
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.phone, caller))
      .limit(1);
    expect(user?.role).toBe('rider');
    expect(user?.displayName).toBe('Anna');
    const [customer] = await ctx.db
      .select()
      .from(customers)
      .where(eq(customers.userId, user!.id))
      .limit(1);
    expect(customer).toBeDefined();

    // And who booked on whose behalf is on the record (S9-2).
    const audit = await ctx.db
      .select()
      .from(dispatchAuditLog)
      .where(eq(dispatchAuditLog.rideId, rideId));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.driverId).toBeNull();
    expect(audit[0]?.source).toBe('dispatcher');
  });

  it('replays the same ride on a repeated Idempotency-Key (expected — #46)', async () => {
    const caller = p(11);
    const key = randomUUID();

    const first = await book(caller, key);
    const second = await book(caller, key);

    expect(first.status).toBe(201);
    const rideId = (first.body as { ride: { id: string } }).ride.id;
    createdRides.push(rideId);
    expect((second.body as { ride: { id: string } }).ride.id).toBe(rideId);

    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.phone, caller))
      .limit(1);
    const all = await ctx.db
      .select()
      .from(rides)
      .where(eq(rides.riderId, user!.id));
    // A dispatcher typing fast on a reconnecting console must never dispatch
    // two cars.
    expect(all).toHaveLength(1);
  });

  it('reuses an existing rider rather than forking their history (edge)', async () => {
    const caller = p(12);
    const existing = await insertUser(ctx.db, { phone: caller, role: 'rider' });

    const res = await book(caller, randomUUID(), { callerName: 'Ignored' });

    expect(res.status).toBe(201);
    createdRides.push((res.body as { ride: { id: string } }).ride.id);

    const [row] = await ctx.db
      .select()
      .from(rides)
      .where(eq(rides.id, (res.body as { ride: { id: string } }).ride.id))
      .limit(1);
    expect(row?.riderId).toBe(existing.id);

    // `callerName` never overwrites an existing rider's own name.
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, existing.id))
      .limit(1);
    expect(user?.displayName).toBeNull();
  });

  it('refuses a caller phone that belongs to a driver (failure)', async () => {
    const driverPhone = p(13);
    await insertUser(ctx.db, { phone: driverPhone, role: 'driver' });

    const res = await book(driverPhone, randomUUID());

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toBe(
      'phone_belongs_to_staff',
    );
  });

  it('requires an Idempotency-Key (failure — #46)', async () => {
    const res = await http
      .post('/dispatch/bookings')
      .set('authorization', dispatcherAuth)
      .send(body(p(14)));

    expect(res.status).toBe(400);
  });

  it('is closed to riders (failure)', async () => {
    const rider = await insertUser(ctx.db, { phone: p(15), role: 'rider' });
    const auth = `Bearer ${
      (await tokens.issue({ id: rider.id, role: 'rider' })).accessToken
    }`;

    const res = await http
      .post('/dispatch/bookings')
      .set('authorization', auth)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .send(body(p(16)));

    expect(res.status).toBe(403);
  });
});
