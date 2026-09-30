import { customers, dispatchAuditLog, rides, users } from '@taxi/db';
import { authSessionSchema, IDEMPOTENCY_KEY_HEADER } from '@taxi/shared';
import { Logger } from '@nestjs/common';
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
import { PricingService } from '../../pricing';
import { RidesRepository } from '../../rides';
import {
  RIDE_IDEMPOTENCY_PENDING,
  callerIdempotencyKey,
  dispatcherBookingRateKey,
} from '../../rides/rides.policy';

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
  let dispatcherId: string;

  const createdRides: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
    tokens = ctx.app.get(AuthTokenService);

    const dispatcher = await insertUser(ctx.db, {
      phone: p(1),
      role: 'dispatcher',
    });
    dispatcherId = dispatcher.id;
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
    // Minted on the caller's behalf, so marked provisional — by this
    // dispatcher, the answer a support call needs (#123).
    expect(user?.provisionedBy).toBe(dispatcherId);
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

  const storedName = async (userId: string) =>
    (
      await ctx.db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    )[0]?.displayName;

  const named = async (phone: string, displayName: string | null) => {
    const user = await insertUser(ctx.db, { phone, role: 'rider' });
    await ctx.db
      .update(users)
      .set({ displayName })
      .where(eq(users.id, user.id));
    return user;
  };

  it('reuses an existing rider rather than forking their history (edge)', async () => {
    const caller = p(12);
    const existing = await named(caller, 'Rider-set');

    const res = await book(caller, randomUUID(), { callerName: 'Ignored' });

    expect(res.status).toBe(201);
    createdRides.push((res.body as { ride: { id: string } }).ride.id);

    const [row] = await ctx.db
      .select()
      .from(rides)
      .where(eq(rides.id, (res.body as { ride: { id: string } }).ride.id))
      .limit(1);
    expect(row?.riderId).toBe(existing.id);

    // `callerName` never overwrites a set name (#269 D2).
    expect(await storedName(existing.id)).toBe('Rider-set');
    // A row its owner created is never made provisional by a booking: the
    // marker is in the insert's values, never its conflict clause (#123).
    const [after] = await ctx.db
      .select({ provisionedBy: users.provisionedBy })
      .from(users)
      .where(eq(users.id, existing.id));
    expect(after?.provisionedBy).toBeNull();
  });

  it("fills an existing rider's EMPTY name with Dina's, trimmed (edge — #269)", async () => {
    const existing = await named(p(17), null);

    const res = await book(p(17), randomUUID(), { callerName: '  Anna  ' });

    expect(res.status).toBe(201);
    createdRides.push((res.body as { ride: { id: string } }).ride.id);
    expect(await storedName(existing.id)).toBe('Anna');
  });

  // Every value JS `trim()` empties, because `readDisplayName` shows it as no
  // name and Dina is offered the field. Postgres `btrim` strips only spaces,
  // so NBSP and tab were refused by the fill (#290 F3).
  it.each([
    ['spaces', 18, '  '],
    ['NBSP and tab', 20, '\u00a0\t'],
    ['ideographic space and BOM', 21, '\u3000\ufeff'],
  ])(
    'treats a legacy whitespace-only name (%s) as empty (edge — #269)',
    async (_label, n, legacy) => {
      const existing = await named(p(n), legacy);

      const res = await book(p(n), randomUUID(), { callerName: 'Anna' });

      expect(res.status).toBe(201);
      createdRides.push((res.body as { ride: { id: string } }).ride.id);
      expect(await storedName(existing.id)).toBe('Anna');
    },
  );

  it('books a new caller with a blank callerName and stores no name (failure — #269 D4)', async () => {
    const caller = p(19);

    const res = await book(caller, randomUUID(), { callerName: '   ' });

    expect(res.status).toBe(201);
    createdRides.push((res.body as { ride: { id: string } }).ride.id);
    const [user] = await ctx.db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.phone, caller))
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

  it("keeps Dina's note out of every log when the ride insert fails (failure — #303 PR #304 H1)", async () => {
    // Nest's default ExceptionsHandler logs any non-HttpException it catches,
    // and drizzle's message carries every bound param: the note, PIN, token.
    const NOTE = 'Ratiņkrēsls, neredzīgs';
    const first = await book(p(17), randomUUID());
    expect(first.status).toBe(201);
    const firstId = (first.body as { ride: { id: string } }).ride.id;
    createdRides.push(firstId);
    const [taken] = await ctx.db
      .select({ token: rides.trackingToken })
      .from(rides)
      .where(eq(rides.id, firstId));
    const token = taken?.token;
    if (!token) throw new Error('the first ride has no tracking token');

    // A real insert failure, not a mocked error: the second ride reuses the
    // first one's token, so Postgres refuses it with a unique violation.
    const repo = ctx.app.get(RidesRepository);
    const create = repo.create.bind(repo);
    const clash = jest
      .spyOn(repo, 'create')
      .mockImplementation((input) =>
        create({ ...input, trackingToken: token }),
      );
    const levels = [
      'log',
      'error',
      'warn',
      'debug',
      'verbose',
      'fatal',
    ] as const;
    const spies = levels.map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );

    try {
      const res = await book(p(18), randomUUID(), { dispatcherNote: NOTE });

      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain(NOTE);
      const lines = spies
        .flatMap((spy) => (spy.mock.calls as unknown[][]).flat())
        .map((arg: unknown) =>
          arg instanceof Error
            ? `${arg.message} ${arg.stack ?? ''}`
            : JSON.stringify(arg),
        )
        .join('\n');
      // The premise: the real insert failed and the spies see this path.
      expect(lines).toContain('query_failed:23505');
      expect(lines).not.toContain(NOTE);
      expect(lines).not.toContain(token);
    } finally {
      clash.mockRestore();
      spies.forEach((spy) => spy.mockRestore());
    }
  });
  describe('provisional callers (#123)', () => {
    const identityFor = async (phone: string) => {
      const found = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phone, phone));
      const filed =
        found[0] === undefined
          ? []
          : await ctx.db
              .select({ id: customers.id })
              .from(customers)
              .where(eq(customers.userId, found[0].id));
      return { users: found.length, customers: filed.length };
    };

    it('lets a phone-booked number sign up as a DRIVER and get the driver role (expected)', async () => {
      const caller = p(30);
      const booked = await book(caller, randomUUID());
      expect(booked.status).toBe(201);
      createdRides.push((booked.body as { ride: { id: string } }).ride.id);

      await http
        .post('/auth/otp/request')
        .send({ phone: caller, role: 'driver' })
        .expect(200);
      const verified = await http
        .post('/auth/otp/verify')
        .send({ phone: caller, code: ctx.sms.lastCodeFor(caller)! })
        .expect(200);

      const session = authSessionSchema.parse(verified.body);
      expect(session.user.role).toBe('driver');
      // The SAME identity, adopted — not a second one — and no longer
      // provisional, so a later OTP cannot move the role again.
      const [row] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.phone, caller));
      expect(session.user.id).toBe(row?.id);
      expect(row?.role).toBe('driver');
      expect(row?.provisionedBy).toBeNull();

      // And the reverse direction still holds: the number is now staff.
      const again = await book(caller, randomUUID());
      expect(again.status).toBe(400);
    });

    it('leaves no users or customers row when the rate limit refuses (failure)', async () => {
      const caller = p(31);
      const kv = ctx.kv;
      const rateKey = dispatcherBookingRateKey(dispatcherId);
      // At the cap: the next INCR is 61 > 60.
      await kv.setWithTtl(rateKey, '60', 600);
      try {
        const res = await book(caller, randomUUID());
        expect(res.status).toBe(429);
      } finally {
        await kv.del(rateKey);
      }
      expect(await identityFor(caller)).toEqual({ users: 0, customers: 0 });
    });

    it('leaves no users or customers row when the idempotency guard refuses (failure)', async () => {
      const caller = p(32);
      const key = randomUUID();
      // The first attempt is still in flight: the retry must 409, not mint.
      await ctx.kv.setWithTtl(
        callerIdempotencyKey(caller, key),
        RIDE_IDEMPOTENCY_PENDING,
        120,
      );

      const res = await book(caller, key);

      expect(res.status).toBe(409);
      expect(await identityFor(caller)).toEqual({ users: 0, customers: 0 });
    });

    it('leaves no users or customers row when the quote fails (failure)', async () => {
      const caller = p(33);
      const quote = jest
        .spyOn(ctx.app.get(PricingService), 'quote')
        .mockRejectedValue(new Error('maps provider is down'));
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      try {
        const res = await book(caller, randomUUID());
        expect(res.status).toBe(500);
      } finally {
        quote.mockRestore();
        error.mockRestore();
      }
      expect(await identityFor(caller)).toEqual({ users: 0, customers: 0 });
    });

    it('books two concurrent orders for one new number onto ONE identity (edge)', async () => {
      const caller = p(34);

      const [a, b] = await Promise.all([
        book(caller, randomUUID()),
        book(caller, randomUUID()),
      ]);

      expect([a.status, b.status]).toEqual([201, 201]);
      const ids = [a, b].map(
        (r) => (r.body as { ride: { id: string } }).ride.id,
      );
      createdRides.push(...ids);
      const riders = await ctx.db
        .select({ riderId: rides.riderId })
        .from(rides)
        .where(inArray(rides.id, ids));
      expect(new Set(riders.map((r) => r.riderId)).size).toBe(1);
      // Nothing is ever deleted on this path, so neither booking can strand
      // the other's rider — the race a catch-block rollback would open.
      expect(await identityFor(caller)).toEqual({ users: 1, customers: 1 });
    });
  });
});
