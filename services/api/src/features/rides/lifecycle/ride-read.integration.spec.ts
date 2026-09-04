import { drivers, rideOffers, rides } from '@taxi/db';
import {
  authSessionSchema,
  IDEMPOTENCY_KEY_HEADER,
  rideCreatedSchema,
  rideSchema,
  RT,
  type LatLng,
  type RideStatusEvent,
} from '@taxi/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Socket } from 'socket.io-client';
import request from 'supertest';
import {
  closeClients,
  connectClient,
  createTestApp,
  insertUser,
  phoneFor,
  type TestApp,
} from '../../../../test/harness';
import { APP_ENV, type Env } from '../../../common/config/env.schema';
import { AuthTokenService } from '../../auth';
import { DispatchService } from '../../dispatch';

/**
 * `GET /rides/:rideId` with a DRIVER token (#15): the read that re-joins a
 * reconnected driver socket to its ride room, and the role matrix around it.
 *
 * `+371300` is this spec file's E.164 range — see phoneFor() and the list in
 * `ride-lifecycle.integration.spec.ts`.
 */
const p = (n: number) => phoneFor('+371300', n);

/** Inside centre only, clear of old_town and autoosta — see the lifecycle spec. */
const CENTRE_PICKUP = {
  location: { lat: 56.96, lng: 24.085 },
  address: 'Hanzas iela, Rīga',
};
const DESTINATION = {
  location: { lat: 56.9712, lng: 24.18 },
  address: 'Teika, Rīga',
};

const near = (base: LatLng, dLat: number, dLng: number): LatLng => ({
  lat: base.lat + dLat,
  lng: base.lng + dLng,
});

describe('GET /rides/:rideId as a driver (integration, #15)', () => {
  let ctx: TestApp;
  let http: ReturnType<typeof request>;
  let dispatch: DispatchService;
  let tokens: AuthTokenService;
  let cityId: string;
  let port: number;

  const createdRides: string[] = [];
  const usedDrivers: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0);
    port = (
      ctx.app.getHttpServer() as { address(): AddressInfo | null }
    ).address()!.port;
    http = request(ctx.app.getHttpServer());
    dispatch = ctx.app.get(DispatchService);
    tokens = ctx.app.get(AuthTokenService);
    cityId = ctx.app.get<Env>(APP_ENV).DEFAULT_CITY_ID;
  });

  afterEach(closeClients);

  afterEach(async () => {
    const driverIds = usedDrivers.splice(0);
    for (const driverId of driverIds) {
      await ctx.locations.markOffline(cityId, driverId);
    }
    // Retiring a ride by hand never runs the lifecycle, so it never releases
    // `on_ride` — put this file's drivers back, and only this file's.
    if (driverIds.length) {
      await ctx.db
        .update(drivers)
        .set({ status: 'online' })
        .where(
          and(
            inArray(drivers.userId, driverIds),
            eq(drivers.status, 'on_ride'),
          ),
        );
    }
    if (createdRides.length) {
      await ctx.db
        .update(rides)
        .set({ status: 'cancelled_by_system' })
        .where(inArray(rides.id, createdRides.splice(0)));
    }
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  async function signIn(phone: string, role: 'rider' | 'driver') {
    await http.post('/auth/otp/request').send({ phone, role }).expect(200);
    const code = ctx.sms.lastCodeFor(phone)!;
    const res = await http
      .post('/auth/otp/verify')
      .send({ phone, code })
      .expect(200);
    return authSessionSchema.parse(res.body);
  }

  let plateSeq = 0;
  const nextPlate = () => `RR${String(++plateSeq).padStart(4, '0')}`;

  async function onlineDriver(n: number, location: LatLng) {
    const session = await signIn(p(n), 'driver');
    const auth = `Bearer ${session.accessToken}`;
    const id = session.user.id;

    await http
      .post('/drivers/me/vehicles')
      .set('authorization', auth)
      .send({
        plate: nextPlate(),
        make: 'Skoda',
        model: 'Octavia',
        year: 2019,
        passengerSeats: 4,
        hasChildSeat: false,
      })
      .expect(201);
    await http
      .put('/drivers/me/status')
      .set('authorization', auth)
      .send({ status: 'online' })
      .expect(200);

    await ctx.locations.markOnline(cityId, id, Date.now());
    await ctx.locations.record(cityId, id, location, Date.now());
    usedDrivers.push(id);
    return { id, auth, token: session.accessToken };
  }

  async function rider(n: number) {
    const session = await signIn(p(n), 'rider');
    return { id: session.user.id, auth: `Bearer ${session.accessToken}` };
  }

  async function dispatcher(n: number) {
    const user = await insertUser(ctx.db, { phone: p(n), role: 'dispatcher' });
    const { accessToken } = await tokens.issue({
      id: user.id,
      role: 'dispatcher',
    });
    return { id: user.id, auth: `Bearer ${accessToken}` };
  }

  async function book(riderAuth: string) {
    const res = await http
      .post('/rides')
      .set('authorization', riderAuth)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .send({
        pickup: CENTRE_PICKUP,
        destination: DESTINATION,
        paymentMethod: 'cash',
      })
      .expect(201);
    const { ride } = rideCreatedSchema.parse(res.body);
    createdRides.push(ride.id);
    return ride;
  }

  /** THIS ride only — never `DispatchSweeper.tick()`, which would reach other files' rides. */
  const offerTo = (ride: Awaited<ReturnType<typeof book>>) =>
    dispatch.offerNext({
      id: ride.id,
      orderId: ride.orderId,
      riderId: ride.riderId,
      geozoneId: ride.geozoneId,
      request: ride.request,
      createdAt: ride.createdAt,
    });

  const pendingOffer = async (rideId: string) =>
    (
      await ctx.db
        .select()
        .from(rideOffers)
        .where(
          and(eq(rideOffers.rideId, rideId), eq(rideOffers.status, 'pending')),
        )
    )[0];

  const rideRow = async (rideId: string) =>
    (await ctx.db.select().from(rides).where(eq(rides.id, rideId)))[0]!;

  async function bookAndAccept(riderAuth: string, driverAuth: string) {
    const ride = await book(riderAuth);
    await offerTo(ride);
    const offer = await pendingOffer(ride.id);
    await http
      .post(`/dispatch/offers/${offer!.id}/accept`)
      .set('authorization', driverAuth)
      .expect(201);
    return ride;
  }

  function collectStatuses(socket: Socket): RideStatusEvent[] {
    const seen: RideStatusEvent[] = [];
    socket.on(RT.rideStatus, (e: RideStatusEvent) => seen.push(e));
    return seen;
  }

  async function waitForCount(
    count: () => number,
    expected: number,
    timeoutMs = 3_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (count() < expected) {
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for ${expected} ride:status events, saw ${count()}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  /**
   * (expected + the C1 edge) The app's real order: reconnect, re-read, keep
   * stepping. Socket A is joined by `emitAssigned` at accept; socket B,
   * connected AFTER that, is in the user and driver rooms only. Until the
   * driver's `GET /rides/:rideId` runs, B hears NOTHING — and after it, the
   * very next transition arrives on B.
   */
  it('a driver socket connected after accept hears ride:status only once GET /rides/:rideId has run', async () => {
    const d = await onlineDriver(1, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(50);

    const a = await connectClient(port, d.token);
    const ride = await bookAndAccept(r.auth, d.auth);
    a.close();

    const b = await connectClient(port, d.token);
    const seen = collectStatuses(b);

    await http
      .post(`/rides/${ride.id}/arriving`)
      .set('authorization', d.auth)
      .expect(201);
    await settle();
    // CONTROL first: the ride DID move, so B's silence below is the missing
    // room membership, never a dispatch that did nothing.
    expect((await rideRow(ride.id)).status).toBe('arriving');
    expect(seen.filter((e) => e.rideId === ride.id)).toEqual([]);

    // What the app does on every `connect`. This is the join.
    const res = await http
      .get(`/rides/${ride.id}`)
      .set('authorization', d.auth)
      .expect(200);
    const body = rideSchema.parse(res.body);
    expect(body.driverId).toBe(d.id);
    expect(body.status).toBe('arriving');
    expect(body.paymentMethod).toBe('cash');

    await http
      .post(`/rides/${ride.id}/arrived`)
      .set('authorization', d.auth)
      .expect(201);

    const mine = () => seen.filter((e) => e.rideId === ride.id);
    await waitForCount(() => mine().length, 1);
    expect(mine()[0]).toMatchObject({
      status: 'arrived',
      previousStatus: 'arriving',
    });
  });

  it('404s a driver reading a ride assigned to someone else, with the same shape as a missing ride (failure)', async () => {
    const d1 = await onlineDriver(2, near(CENTRE_PICKUP.location, 0.001, 0));
    const d2 = await onlineDriver(3, near(CENTRE_PICKUP.location, 0.03, 0.03));
    const r = await rider(51);

    const ride = await bookAndAccept(r.auth, d1.auth);

    const foreign = await http
      .get(`/rides/${ride.id}`)
      .set('authorization', d2.auth)
      .expect(404);
    const missing = await http
      .get(`/rides/${randomUUID()}`)
      .set('authorization', d2.auth)
      .expect(404);
    expect((foreign.body as { message: string }).message).toBe(
      'ride_not_found',
    );
    expect((missing.body as { message: string }).message).toBe(
      'ride_not_found',
    );
  });

  it('gives the rider the ride without the split and the driver the same ride WITH it (expected — R1)', async () => {
    const d = await onlineDriver(4, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(52);

    const ride = await bookAndAccept(r.auth, d.auth);
    for (const step of ['arriving', 'arrived', 'start', 'complete'] as const) {
      await http
        .post(`/rides/${ride.id}/${step}`)
        .set('authorization', d.auth)
        .expect(201);
    }
    // CONTROL: settled in the database, so a null below is a projection.
    expect((await rideRow(ride.id)).commissionCents).not.toBeNull();

    const asRider = rideSchema.parse(
      (
        await http
          .get(`/rides/${ride.id}`)
          .set('authorization', r.auth)
          .expect(200)
      ).body,
    );
    expect(asRider.status).toBe('completed');
    expect(asRider.split).toBeNull();

    const asDriver = rideSchema.parse(
      (
        await http
          .get(`/rides/${ride.id}`)
          .set('authorization', d.auth)
          .expect(200)
      ).body,
    );
    expect(asDriver.status).toBe('completed');
    expect(asDriver.split).not.toBeNull();
    // The receipt's constant arithmetic, from the persisted split.
    expect(
      asDriver.split!.commissionCents + asDriver.split!.driverNetCents,
    ).toBe(asDriver.split!.totalCents);
    expect(asDriver.split!.totalCents).toBe(asDriver.quote!.totalCents);
  });

  it('refuses a dispatcher token on this route (failure)', async () => {
    const d = await onlineDriver(5, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(53);
    const dina = await dispatcher(60);

    const ride = await bookAndAccept(r.auth, d.auth);

    await http
      .get(`/rides/${ride.id}`)
      .set('authorization', dina.auth)
      .expect(403);
  });
});
