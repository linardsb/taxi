import { rideFareLines, rides, users } from '@taxi/db';
import {
  authSessionSchema,
  IDEMPOTENCY_KEY_HEADER,
  isFareQuoteConsistent,
  rideCreatedSchema,
} from '@taxi/shared';
import { and, eq, inArray, like } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, phoneFor, type TestApp } from '../../../test/harness';
import { RidesRepository } from './rides.repository';

/**
 * A fresh booking-attempt key. FRESH per call by default: reuse one across two
 * `POST /rides` and the second replays rather than books, which silently guts
 * any test measuring what the second call did.
 */
const idem = () => randomUUID();

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

  // Nothing in this slice dispatches, but a ride left at `requested` sits in
  // `findAwaitingDispatch`'s shared pool forever — and since #61 made live
  // cards platform-global, a later suite's tick dealing its driver onto OUR
  // leftover marks that driver busy and starves that suite's own assertions.
  // Rides are booked at a dozen call sites here, so retirement keys on this
  // file's rider namespace instead of a tracked id list.
  afterEach(async () => {
    await ctx.db
      .update(rides)
      .set({ status: 'cancelled_by_system' })
      .where(
        and(
          inArray(rides.status, ['requested', 'offered']),
          inArray(
            rides.riderId,
            ctx.db
              .select({ id: users.id })
              .from(users)
              .where(like(users.phone, '+371240%')),
          ),
        ),
      );
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
      .set(IDEMPOTENCY_KEY_HEADER, idem())
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
    // DISTINCT keys, all three calls. Share one and the second request replays
    // without ever reaching PricingService — the delta below is still 1 and the
    // test passes while proving nothing about the cache.
    const first = await http
      .post('/rides')
      .set('authorization', r.auth)
      .set(IDEMPOTENCY_KEY_HEADER, idem())
      .send(body)
      .expect(201);
    const second = await http
      .post('/rides')
      .set('authorization', r.auth)
      .set(IDEMPOTENCY_KEY_HEADER, idem())
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
      .set(IDEMPOTENCY_KEY_HEADER, idem())
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
      .set(IDEMPOTENCY_KEY_HEADER, idem())
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
      .set(IDEMPOTENCY_KEY_HEADER, idem())
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

    // A VALID key on all three. The header pipe is declared before `@Body` and
    // so runs first: omit it and the `malformed` case still returns
    // `validation_failed` — from the HEADER — and the body assertion it was
    // written for never runs.
    const multi = await http
      .post('/rides')
      .set('authorization', r.auth)
      .set(IDEMPOTENCY_KEY_HEADER, idem())
      .send({ ...base, vehicleCount: 3 })
      .expect(400);
    expect(codeOf(multi)).toBe('multi_taxi_not_supported');

    const past = await http
      .post('/rides')
      .set('authorization', r.auth)
      .set(IDEMPOTENCY_KEY_HEADER, idem())
      .send({ ...base, scheduledFor: new Date(Date.now() - 60_000) })
      .expect(400);
    expect(codeOf(past)).toBe('scheduled_in_past');

    const malformed = await http
      .post('/rides')
      .set('authorization', r.auth)
      .set(IDEMPOTENCY_KEY_HEADER, idem())
      .send({ pickup: CENTRE, paymentMethod: 'cash' })
      .expect(400);
    expect(codeOf(malformed)).toBe('validation_failed');
  });

  it('returns the same ride — and writes ONE row — for a repeated key (expected)', async () => {
    // The acceptance criterion end-to-end, and the one assertion that would
    // have caught #46: before this, a double-tapped "Book" left two `requested`
    // rows, and #10's sweeper sent two cars to one kerb.
    const r = await rider(30);
    const key = idem();
    const payload = { pickup: CENTRE, destination: RIX, paymentMethod: 'cash' };

    const first = await http
      .post('/rides')
      .set('authorization', r.auth)
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .send(payload)
      .expect(201);
    const second = await http
      .post('/rides')
      .set('authorization', r.auth)
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .send(payload)
      .expect(201);

    const one = rideCreatedSchema.parse(first.body);
    const two = rideCreatedSchema.parse(second.body);
    expect(two.ride.id).toBe(one.ride.id);
    // The replay recomputes the split rather than re-reading a snapshot, so it
    // must still come out identical.
    expect(two.split).toEqual(one.split);

    // Scoped to THIS rider: the row count is the only assertion that truly
    // proves "one ride", and earlier tests' rides would pollute a global count.
    const rows = await ctx.db
      .select()
      .from(rides)
      .where(eq(rides.riderId, r.id));
    expect(rows).toHaveLength(1);
  });

  it('rejects a booking with no idempotency key and with a non-uuid one (failure)', async () => {
    const r = await rider(31);
    const payload = { pickup: CENTRE, destination: RIX, paymentMethod: 'cash' };

    // Required, not optional: an optional header would leave "the request is
    // not idempotent" true for any client that omits it.
    await http
      .post('/rides')
      .set('authorization', r.auth)
      .send(payload)
      .expect(400);

    await http
      .post('/rides')
      .set('authorization', r.auth)
      .set(IDEMPOTENCY_KEY_HEADER, 'not-a-uuid')
      .send(payload)
      .expect(400);

    // Neither reached the service, so neither booked.
    const rows = await ctx.db
      .select()
      .from(rides)
      .where(eq(rides.riderId, r.id));
    expect(rows).toHaveLength(0);
  });

  it('keeps one rider’s key from returning another rider’s ride (edge)', async () => {
    // The key is rider-scoped, so a guessed uuid cannot reach someone else's
    // ride — and two riders colliding on one key still get two cars.
    const a = await rider(32);
    const b = await rider(33);
    const key = idem();
    const payload = { pickup: CENTRE, destination: RIX, paymentMethod: 'cash' };

    const first = await http
      .post('/rides')
      .set('authorization', a.auth)
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .send(payload)
      .expect(201);
    const second = await http
      .post('/rides')
      .set('authorization', b.auth)
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .send(payload)
      .expect(201);

    const one = rideCreatedSchema.parse(first.body);
    const two = rideCreatedSchema.parse(second.body);
    expect(two.ride.id).not.toBe(one.ride.id);
    expect(two.ride.riderId).toBe(b.id);
  });

  it('refuses a driver token and an anonymous request (failure)', async () => {
    // Global, fail-closed guards — not code this slice writes.
    const driverSession = await signIn(p(7), 'driver');
    const body = { pickup: CENTRE, destination: RIX, paymentMethod: 'cash' };

    await http
      .post('/rides')
      .set('authorization', `Bearer ${driverSession.accessToken}`)
      .set(IDEMPOTENCY_KEY_HEADER, idem())
      .send(body)
      .expect(403);

    // No header here on purpose: the guard rejects before any handler pipe
    // runs, so an anonymous request never reaches the header validation.
    await http.post('/rides').send(body).expect(401);
  });

  /**
   * `rides.request` is an audit snapshot written at creation and never
   * migrated, so a later required field on `rideRequestSchema` makes older
   * live rows unparseable. Both board transports read through here, so an
   * all-or-nothing parse would take Dina's console dark on one bad row.
   */
  describe('findBoardRides (degrading on an unreadable request)', () => {
    const repo = () => ctx.app.get(RidesRepository);

    async function createRide(n: number) {
      const r = await rider(n);
      const res = await http
        .post('/rides')
        .set('authorization', r.auth)
        .set(IDEMPOTENCY_KEY_HEADER, idem())
        .send({ pickup: CENTRE, destination: RIX, paymentMethod: 'cash' })
        .expect(201);
      return rideCreatedSchema.parse(res.body).ride;
    }

    it('carries a live ride with its pickup (expected)', async () => {
      const ride = await createRide(30);

      const board = await repo().findBoardRides(100);

      const row = board.find((r) => r.id === ride.id);
      expect(row?.pickup).toEqual(CENTRE);
      expect(row?.status).toBe('requested');
    });

    it('drops ONLY the unreadable row and still serves the rest (edge)', async () => {
      const good = await createRide(31);
      const bad = await createRide(32);
      // The shape a future required field produces: a snapshot that no longer
      // satisfies the schema. `pickup` itself is gone, so the board has
      // nothing to render for this ride even in principle.
      await ctx.db
        .update(rides)
        .set({ request: {} })
        .where(eq(rides.id, bad.id));

      const board = await repo().findBoardRides(100);

      const ids = board.map((r) => r.id);
      expect(ids).toContain(good.id);
      expect(ids).not.toContain(bad.id);
    });

    it('never rejects the read because of a bad row (failure)', async () => {
      const bad = await createRide(33);
      await ctx.db
        .update(rides)
        .set({ request: { pickup: 'Brīvības 1' } }) // pickup, wrong shape
        .where(eq(rides.id, bad.id));

      // A throw here 500s GET /dispatch/board AND silences every 2 s beat.
      await expect(repo().findBoardRides(100)).resolves.toEqual(
        expect.arrayContaining([]),
      );
      const board = await repo().findBoardRides(100);
      expect(board.map((r) => r.id)).not.toContain(bad.id);
    });
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
        .set(IDEMPOTENCY_KEY_HEADER, idem())
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
