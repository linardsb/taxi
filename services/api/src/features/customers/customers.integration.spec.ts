import { customers, rides, savedPlaces, users } from '@taxi/db';
import { IDEMPOTENCY_KEY_HEADER, type CallerLookup } from '@taxi/shared';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  createTestApp,
  insertUser,
  phoneFor,
  type TestApp,
} from '../../../test/harness';
import { AuthTokenService } from '../auth';

/** `+371254` is this spec file's E.164 range — see phoneFor(). */
const p = (n: number) => phoneFor('+371254', n);

const PICKUP = {
  location: { lat: 56.96, lng: 24.085 },
  address: 'Hanzas iela, Rīga',
};
const DESTINATION = {
  location: { lat: 56.9712, lng: 24.18 },
  address: 'Teika, Rīga',
};

describe('customers (#19)', () => {
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

  it('pops a repeat caller with their record and last jobs (expected — AC #5)', async () => {
    const caller = p(10);
    const booked = await http
      .post('/dispatch/bookings')
      .set('authorization', dispatcherAuth)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .send({
        callerPhone: caller,
        pickup: PICKUP,
        destination: DESTINATION,
        paymentMethod: 'cash',
      });
    createdRides.push((booked.body as { ride: { id: string } }).ride.id);

    const res = await http
      .get('/customers/lookup')
      .query({ phone: caller })
      .set('authorization', dispatcherAuth);

    expect(res.status).toBe(200);
    const lookup = res.body as CallerLookup;
    expect(lookup.customer).not.toBeNull();
    expect(lookup.recentRides).toHaveLength(1);
    expect(lookup.recentRides[0]?.pickup.address).toBe(PICKUP.address);
    // STABLE FIELDS ONLY — the projection never carries what the caller chose
    // for THAT trip (evidence F2.2's "Clean jobs" rule).
    expect(lookup.recentRides[0]).not.toHaveProperty('paymentMethod');
    expect(lookup.recentRides[0]).not.toHaveProperty('note');
  });

  it('answers null for a number that has never rung (edge)', async () => {
    const res = await http
      .get('/customers/lookup')
      .query({ phone: p(11) })
      .set('authorization', dispatcherAuth);

    expect(res.status).toBe(200);
    // THE WIRE SHAPE, asserted deliberately rather than incidentally: Nest
    // answers a `null` return with a ZERO-LENGTH body, never the JSON literal
    // `null`. `booking-api.authedFetch` maps an empty body back to `null` for
    // exactly this route — `res.json()` rejects on it, which is what made every
    // first-time caller render as a lookup failure.
    expect(res.text).toBe('');
    // A pure READ: the lookup must not file the caller it failed to find.
    const rows = await ctx.db
      .select()
      .from(users)
      .where(eq(users.phone, p(11)));
    expect(rows).toHaveLength(0);
  });

  it('files a venue and lists it for quick-book (expected)', async () => {
    const venuePhone = p(12);

    const created = await http
      .post('/customers')
      .set('authorization', dispatcherAuth)
      .send({ phone: venuePhone, label: 'Hotel Roma', isVenue: true });

    expect(created.status).toBe(201);
    const customerId = (created.body as { id: string }).id;
    await ctx.db.insert(savedPlaces).values({
      customerId,
      kind: 'pickup',
      address: PICKUP.address,
      lat: PICKUP.location.lat,
      lng: PICKUP.location.lng,
      placeId: 'place-hotel-roma',
    });

    const venues = await http
      .get('/customers/venues')
      .set('authorization', dispatcherAuth);

    expect(venues.status).toBe(200);
    const entry = (
      venues.body as { customer: { id: string }; places: unknown[] }[]
    ).find((row) => row.customer.id === customerId);
    expect(entry?.places).toHaveLength(1);
  });

  it('rejects a malformed phone rather than searching for it (edge)', async () => {
    const res = await http
      .get('/customers/lookup')
      .query({ phone: '29999000' })
      .set('authorization', dispatcherAuth);

    expect(res.status).toBe(400);
  });

  it('is closed to drivers — it returns their passengers PII (failure)', async () => {
    const driver = await insertUser(ctx.db, { phone: p(13), role: 'driver' });
    const auth = `Bearer ${
      (await tokens.issue({ id: driver.id, role: 'driver' })).accessToken
    }`;

    const lookup = await http
      .get('/customers/lookup')
      .query({ phone: p(10) })
      .set('authorization', auth);
    const venues = await http
      .get('/customers/venues')
      .set('authorization', auth);

    expect(lookup.status).toBe(403);
    expect(venues.status).toBe(403);
  });

  it('refuses to file a staff number as a customer (failure)', async () => {
    const driverPhone = p(14);
    await insertUser(ctx.db, { phone: driverPhone, role: 'driver' });

    const res = await http
      .post('/customers')
      .set('authorization', dispatcherAuth)
      .send({ phone: driverPhone, label: 'Jānis', isVenue: false });

    expect(res.status).toBe(400);
    const rows = await ctx.db
      .select()
      .from(customers)
      .innerJoin(users, eq(customers.userId, users.id))
      .where(eq(users.phone, driverPhone));
    expect(rows).toHaveLength(0);
  });
});
