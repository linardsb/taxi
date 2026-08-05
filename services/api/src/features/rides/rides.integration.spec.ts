import { rideFareLines, rides } from '@taxi/db';
import {
  authSessionSchema,
  isFareQuoteConsistent,
  rideCreatedSchema,
} from '@taxi/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp, phoneFor, type TestApp } from '../../../test/harness';
import { RidesRepository } from './rides.repository';

/**
 * `+371240` is this spec file's E.164 range — see phoneFor(). `+371210`
 * (auth), `+371220` (drivers) and `+371230` (driver-location gateway) are
 * taken, and `users.phone` is unique across a run that never resets the
 * database, so a collision reuses another file's user — and its ROLE, which
 * surfaces as a 403 rather than anything that names the real cause.
 */
const p = (n: number) => phoneFor('+371240', n);

const CENTRE = {
  location: { lat: 56.9496, lng: 24.1052 },
  address: 'Brīvības iela 1, Rīga',
};
const RIX = {
  location: { lat: 56.9236, lng: 23.9711 },
  address: 'Lidosta RIX',
};

/**
 * Coordinates unique to the cache case. `createTestApp()` runs once in
 * `beforeAll`, so the InMemoryKeyValueStore — and therefore the route cache —
 * persists across every `it()` in this file. Reusing the centre→RIX pair would
 * measure a delta of 0 (already cached) and pass for the wrong reason.
 */
const TEIKA = {
  location: { lat: 56.97, lng: 24.18 },
  address: 'Teika, Rīga',
};
const KENGARAGS = {
  location: { lat: 56.91, lng: 24.16 },
  address: 'Ķengarags, Rīga',
};
const PURVCIEMS = {
  location: { lat: 56.959, lng: 24.194 },
  address: 'Purvciems, Rīga',
};

describe('rides (integration)', () => {
  let ctx: TestApp;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
  });

  afterAll(async () => {
    await ctx.app.close(); // or the Drizzle pool keeps jest alive
  });

  async function signIn(phone: string, role: 'rider' | 'driver' = 'rider') {
    await http.post('/auth/otp/request').send({ phone, role }).expect(200);
    const code = ctx.sms.lastCodeFor(phone)!;
    const res = await http
      .post('/auth/otp/verify')
      .send({ phone, code })
      .expect(200);
    return authSessionSchema.parse(res.body);
  }

  async function rider(n: number) {
    const session = await signIn(p(n));
    return { id: session.user.id, auth: `Bearer ${session.accessToken}` };
  }

  it('quotes and persists a ride with its fare breakdown (expected)', async () => {
    const r = await rider(1);

    const res = await http
      .post('/rides')
      .set('authorization', r.auth)
      .send({ pickup: CENTRE, destination: RIX, paymentMethod: 'card' })
      .expect(201);

    const { ride, split } = rideCreatedSchema.parse(res.body);

    expect(ride.status).toBe('requested');
    expect(ride.riderId).toBe(r.id);
    expect(ride.quote?.model).toBe('upfront_fixed');
    expect(ride.quote!.totalCents).toBeGreaterThan(0);
    expect(isFareQuoteConsistent(ride.quote!)).toBe(true);
    // Nothing dispatches, zones, or settles in this slice.
    expect(ride.driverId).toBeNull();
    expect(ride.geozoneId).toBeNull();
    expect(ride.split).toBeNull();

    // 15 is the SEEDED platform_config value, read at quote time — asserting
    // the seed, not a constant in code.
    expect(split.commissionPct).toBe(15);
    expect(split.commissionSource).toBe('platform_base');
    expect(split.totalCents).toBe(ride.quote!.totalCents);
    expect(split.commissionCents + split.driverNetCents).toBe(split.totalCents);

    const [row] = await ctx.db
      .select()
      .from(rides)
      .where(eq(rides.id, ride.id));
    expect(row!.status).toBe('requested');
    expect(row!.totalCents).toBe(ride.quote!.totalCents);
    expect(row!.pricingModel).toBe('upfront_fixed');
    // The settled columns belong to #11 and must stay untouched here.
    expect(row!.commissionPct).toBeNull();
    expect(row!.commissionCents).toBeNull();

    const lines = await ctx.db
      .select()
      .from(rideFareLines)
      .where(eq(rideFareLines.rideId, ride.id));
    // Exactly three: a zero discount line is noise in #11's settlement read.
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.lineType).sort()).toEqual([
      'base',
      'distance',
      'time',
    ]);
    expect(lines.reduce((sum, l) => sum + l.amountCents, 0)).toBe(
      ride.quote!.totalCents,
    );
  });

  it('serves a repeated route from cache and still routes a new one (edge)', async () => {
    // The <€100/mo guardrail under test: an uncached Routes call per request is
    // how the budget becomes a €400 bill. Snapshot INSIDE the test — the cache
    // and the counter both persist across `it()`s in this file.
    const r = await rider(2);
    const before = ctx.maps.routeCalls;

    const body = {
      pickup: TEIKA,
      destination: KENGARAGS,
      paymentMethod: 'cash',
    };
    const first = await http
      .post('/rides')
      .set('authorization', r.auth)
      .send(body)
      .expect(201);
    const second = await http
      .post('/rides')
      .set('authorization', r.auth)
      .send(body)
      .expect(201);

    expect(ctx.maps.routeCalls - before).toBe(1);
    expect(rideCreatedSchema.parse(second.body).ride.quote).toEqual(
      rideCreatedSchema.parse(first.body).ride.quote,
    );

    // Without this leg, a cache key that collapses every route to one entry
    // would pass the assertion above.
    await http
      .post('/rides')
      .set('authorization', r.auth)
      .send({ ...body, destination: PURVCIEMS })
      .expect(201);
    expect(ctx.maps.routeCalls - before).toBe(2);
  });

  it('creates a future-dated request at status scheduled (edge)', async () => {
    const r = await rider(3);
    const scheduledFor = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const res = await http
      .post('/rides')
      .set('authorization', r.auth)
      .send({
        pickup: CENTRE,
        destination: RIX,
        paymentMethod: 'cash',
        scheduledFor: scheduledFor.toISOString(),
      })
      .expect(201);

    const { ride } = rideCreatedSchema.parse(res.body);
    expect(ride.status).toBe('scheduled');

    const [row] = await ctx.db
      .select()
      .from(rides)
      .where(eq(rides.id, ride.id));
    expect(row!.scheduledFor).toEqual(scheduledFor);
    // Nothing promotes it to `requested` — that timer is #21's.
  });

  it('books for the authenticated rider, ignoring a smuggled riderId (edge)', async () => {
    const victim = await rider(4);
    const attacker = await rider(5);

    const res = await http
      .post('/rides')
      .set('authorization', attacker.auth)
      .send({
        pickup: CENTRE,
        destination: RIX,
        paymentMethod: 'cash',
        riderId: victim.id,
      })
      .expect(201);

    const { ride } = rideCreatedSchema.parse(res.body);
    expect(ride.riderId).toBe(attacker.id);
    expect(ride.request.riderId).toBe(attacker.id);
  });

  it('rejects multi-taxi orders, past pickups and malformed bodies (failure)', async () => {
    const r = await rider(6);
    const base = { pickup: CENTRE, destination: RIX, paymentMethod: 'cash' };

    const codeOf = (res: { body: unknown }) =>
      (res.body as { message: string }).message;

    const multi = await http
      .post('/rides')
      .set('authorization', r.auth)
      .send({ ...base, vehicleCount: 3 })
      .expect(400);
    expect(codeOf(multi)).toBe('multi_taxi_not_supported');

    const past = await http
      .post('/rides')
      .set('authorization', r.auth)
      .send({ ...base, scheduledFor: new Date(Date.now() - 60_000) })
      .expect(400);
    expect(codeOf(past)).toBe('scheduled_in_past');

    const malformed = await http
      .post('/rides')
      .set('authorization', r.auth)
      .send({ pickup: CENTRE, paymentMethod: 'cash' })
      .expect(400);
    expect(codeOf(malformed)).toBe('validation_failed');
  });

  it('refuses a driver token and an anonymous request (failure)', async () => {
    // Global, fail-closed guards — not code this slice writes.
    const driverSession = await signIn(p(7), 'driver');
    const body = { pickup: CENTRE, destination: RIX, paymentMethod: 'cash' };

    await http
      .post('/rides')
      .set('authorization', `Bearer ${driverSession.accessToken}`)
      .send(body)
      .expect(403);

    await http.post('/rides').send(body).expect(401);
  });

  /**
   * `findWithQuote` is the codebase's FIRST reader of `ride_fare_lines` — the
   * write path always held the quote in hand, so nothing ever reversed it.
   * Every offer card depends on this reconstruction being exact.
   */
  describe('findWithQuote (the quote reconstructor)', () => {
    const repo = () => ctx.app.get(RidesRepository);

    async function createRide(n: number) {
      const r = await rider(n);
      const res = await http
        .post('/rides')
        .set('authorization', r.auth)
        .send({ pickup: CENTRE, destination: RIX, paymentMethod: 'cash' })
        .expect(201);
      return rideCreatedSchema.parse(res.body).ride;
    }

    it('round-trips a quote WITH a discount line back to an identical FareQuote (expected)', async () => {
      const ride = await createRide(20);

      // The seeded pricing path never produces a discount, so the discount line
      // is written directly — this is the only way to exercise the branch.
      const discountCents = -150;
      await ctx.db.insert(rideFareLines).values({
        rideId: ride.id,
        lineType: 'discount',
        amountCents: discountCents,
        sort: 3,
      });
      await ctx.db
        .update(rides)
        .set({ totalCents: ride.quote!.totalCents + discountCents })
        .where(eq(rides.id, ride.id));

      const found = await repo().findWithQuote(ride.id);

      // The WHOLE object, not just totalCents: a swapped distance/time mapping
      // sums identically and would pass every narrower assertion.
      expect(found?.quote).toEqual({
        ...ride.quote!,
        totalCents: ride.quote!.totalCents + discountCents,
        breakdown: { ...ride.quote!.breakdown, discountCents },
      });
      expect(found?.ride.id).toBe(ride.id);
    });

    it('reconstructs a ride with NO discount line as discountCents 0 (edge)', async () => {
      const ride = await createRide(21);

      const found = await repo().findWithQuote(ride.id);

      // `create()` omits a zero discount line, so expecting a row here would
      // make every ordinary ride fail to dispatch.
      expect(found?.quote.breakdown.discountCents).toBe(0);
      expect(found?.quote).toEqual(ride.quote);
      expect(isFareQuoteConsistent(found!.quote)).toBe(true);
    });

    it('returns undefined for a ride that was never quoted (failure)', async () => {
      const ride = await createRide(22);
      await ctx.db
        .update(rides)
        .set({ pricingModel: null, totalCents: null })
        .where(eq(rides.id, ride.id));

      // A half-built quote would land on a driver's offer card.
      await expect(repo().findWithQuote(ride.id)).resolves.toBeUndefined();
    });
  });
});
