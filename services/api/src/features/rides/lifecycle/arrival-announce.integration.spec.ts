import { drivers, rideOffers, rides } from '@taxi/db';
import {
  authSessionSchema,
  driverRideSchema,
  IDEMPOTENCY_KEY_HEADER,
  rideCreatedSchema,
  RT,
  type LatLng,
  type Ride,
  type RideAnnounceRequestedEvent,
  type RideOfferEvent,
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
 * The arrival-announce protocol (#259) end to end: the flag stays off the
 * offer on both legs, the rider's request reaches the assigned driver by
 * socket, push and replay with one `at`, and nobody else hears it.
 *
 * THE MAIN CASE FOLLOWS THE APPS' ORDER. Driver A registers a push token and
 * connects its socket on going online (`use-presence.tsx` creates the socket
 * then), before the booking; the rider connects before booking too. Driver B
 * goes online and connects only after A has accepted — online at booking, B
 * could be offered the ride and the case would flake.
 *
 * `+371330` is this file's E.164 range and `PA` its plate prefix — see the
 * registry in `ride-lifecycle.integration.spec.ts`. `users.phone` and plates
 * are unique across a run that never resets the database.
 */
const p = (n: number) => phoneFor('+371330', n);

/** Inside centre, clear of queue-mode zones — see the lifecycle spec. */
const CENTRE_PICKUP = {
  location: { lat: 56.96, lng: 24.085 },
  address: 'Hanzas iela, Rīga',
};
const DESTINATION = {
  location: { lat: 56.9712, lng: 24.18 },
  address: 'Teika, Rīga',
};
const NEAR_PICKUP: LatLng = {
  lat: CENTRE_PICKUP.location.lat + 0.001,
  lng: CENTRE_PICKUP.location.lng,
};

describe('arrival-announce protocol (integration, #259)', () => {
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
    port = (
      ctx.app.getHttpServer() as { address(): AddressInfo | null }
    ).address()!.port;
    http = request(ctx.app.getHttpServer());
    dispatch = ctx.app.get(DispatchService);
    tokens = ctx.app.get(AuthTokenService);
    cityId = ctx.app.get<Env>(APP_ENV).DEFAULT_CITY_ID;
  });

  // Order matters: clients first, app second, or jest hangs on open handles.
  afterEach(closeClients);

  // Scoped to THIS file's drivers and rides — spec files share one database.
  afterEach(async () => {
    const driverIds = usedDrivers.splice(0);
    for (const driverId of driverIds) {
      await ctx.locations.markOffline(cityId, driverId);
    }
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
  const nextPlate = () => `PA${String(++plateSeq).padStart(4, '0')}`;

  async function onlineDriver(n: number, pushToken?: string) {
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
    if (pushToken) {
      await http
        .put('/drivers/me/push-token')
        .set('authorization', auth)
        .send({ token: pushToken })
        .expect(204);
    }
    await http
      .put('/drivers/me/status')
      .set('authorization', auth)
      .send({ status: 'online' })
      .expect(200);

    await ctx.locations.markOnline(cityId, id, Date.now());
    await ctx.locations.record(cityId, id, NEAR_PICKUP, Date.now());
    usedDrivers.push(id);
    return { id, auth, token: session.accessToken };
  }

  async function rider(n: number) {
    const session = await signIn(p(n), 'rider');
    return {
      id: session.user.id,
      auth: `Bearer ${session.accessToken}`,
      token: session.accessToken,
    };
  }

  async function dispatcher(n: number) {
    const user = await insertUser(ctx.db, { phone: p(n), role: 'dispatcher' });
    const { accessToken } = await tokens.issue({
      id: user.id,
      role: 'dispatcher',
    });
    return { id: user.id, auth: `Bearer ${accessToken}` };
  }

  async function book(riderAuth: string, announceArrival: boolean) {
    const res = await http
      .post('/rides')
      .set('authorization', riderAuth)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .send({
        pickup: CENTRE_PICKUP,
        destination: DESTINATION,
        paymentMethod: 'cash',
        options: { announceArrival },
      })
      .expect(201);
    const { ride } = rideCreatedSchema.parse(res.body);
    createdRides.push(ride.id);
    return ride;
  }

  /** Dispatches THIS ride only (never the sweeper — see the lifecycle spec). */
  const offer = (ride: Ride) =>
    dispatch.offerNext({
      id: ride.id,
      orderId: ride.orderId,
      riderId: ride.riderId,
      geozoneId: ride.geozoneId,
      request: ride.request,
      createdAt: ride.createdAt,
    });

  async function acceptPending(rideId: string, driverAuth: string) {
    const [pending] = await ctx.db
      .select()
      .from(rideOffers)
      .where(
        and(eq(rideOffers.rideId, rideId), eq(rideOffers.status, 'pending')),
      );
    await http
      .post(`/dispatch/offers/${pending!.id}/accept`)
      .set('authorization', driverAuth)
      .expect(201);
  }

  async function step(
    rideId: string,
    driverAuth: string,
    ...steps: ('arriving' | 'arrived')[]
  ) {
    for (const s of steps) {
      await http
        .post(`/rides/${rideId}/${s}`)
        .set('authorization', driverAuth)
        .expect(201);
    }
  }

  async function driverRead(rideId: string, driverAuth: string) {
    const res = await http
      .get(`/rides/${rideId}`)
      .set('authorization', driverAuth)
      .expect(200);
    return driverRideSchema.parse(res.body);
  }

  const announce = (rideId: string, auth: string) =>
    http.post(`/rides/${rideId}/announce-request`).set('authorization', auth);

  function waitForEvent<T extends { rideId: string }>(
    socket: Socket,
    event: string,
    rideId: string,
    timeoutMs = 3_000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event, onEvent);
        reject(new Error(`timed out waiting for ${event} on ride ${rideId}`));
      }, timeoutMs);
      function onEvent(payload: T) {
        if (payload.rideId !== rideId) return;
        clearTimeout(timer);
        socket.off(event, onEvent);
        resolve(payload);
      }
      socket.on(event, onEvent);
    });
  }

  /** Every `event` a socket received, from now on. */
  function record(socket: Socket, event: string): unknown[] {
    const seen: unknown[] = [];
    socket.on(event, (payload: unknown) => seen.push(payload));
    return seen;
  }

  /** The push tail is fire-and-forget; poll rather than race it. */
  async function waitUntil(
    predicate: () => boolean,
    what: string,
    timeoutMs = 2_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline)
        throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  const pause = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it('reaches the assigned driver by socket, push and replay with one `at`, and no one else (expected)', async () => {
    const pushToken = 'ExponentPushToken[arrivalannounce0001]';
    const a = await onlineDriver(1, pushToken);
    const aSocket = await connectClient(port, a.token);
    const r = await rider(50);
    const riderSocket = await connectClient(port, r.token);

    const ride = await book(r.auth, true);

    // D2 on both offer legs: the flag is revealed only after accept.
    const offered = waitForEvent<RideOfferEvent>(
      aSocket,
      RT.rideOffer,
      ride.id,
    );
    const pushesBefore = ctx.push.sent.length;
    await offer(ride);
    expect(JSON.stringify(await offered)).not.toContain('announceArrival');
    await waitUntil(
      () =>
        ctx.push.sent
          .slice(pushesBefore)
          .some((s) => s.message.data?.kind === 'offer'),
      'the offer push',
    );
    const offerPush = ctx.push.sent
      .slice(pushesBefore)
      .find((s) => s.message.data?.rideId === ride.id)!;
    // The offer JSON must be there, or the check below passes on nothing.
    expect(offerPush.message.data?.offer).toBeDefined();
    expect(offerPush.message.data?.offer).not.toContain('announceArrival');
    await acceptPending(ride.id, a.auth);

    const b = await onlineDriver(2);
    const bSocket = await connectClient(port, b.token);
    const bSeen = record(bSocket, RT.rideAnnounceRequested);
    const riderSeen = record(riderSocket, RT.rideAnnounceRequested);

    const accepted = await driverRead(ride.id, a.auth);
    expect(accepted.request.options.announceArrival).toBe(true);
    expect(accepted.announceRequestedAt).toBeNull();
    await step(ride.id, a.auth, 'arriving', 'arrived');

    const heard = waitForEvent<RideAnnounceRequestedEvent>(
      aSocket,
      RT.rideAnnounceRequested,
      ride.id,
    );
    const before = ctx.push.sent.length;
    await announce(ride.id, r.auth).expect(201, { ok: true });

    const { at } = await heard;
    expect(new Date(at).toISOString()).toBe(at);
    await waitUntil(() => ctx.push.sent.length > before, 'the announce push');
    const pushed = ctx.push.sent[before]!;
    expect(pushed.token).toBe(pushToken);
    expect(pushed.message.data).toEqual({
      kind: 'announce_requested',
      rideId: ride.id,
      at,
    });
    await pause(500);
    expect(bSeen).toEqual([]);
    expect(riderSeen).toEqual([]);

    // The replay leg, then the window.
    expect((await driverRead(ride.id, a.auth)).announceRequestedAt).toBe(at);
    const throttled = await announce(ride.id, r.auth).expect(429);
    expect(throttled.body).toMatchObject({ message: 'too_many_requests' });
    expect(
      (throttled.body as { retryAfterSeconds: number }).retryAfterSeconds,
    ).toBeGreaterThanOrEqual(1);
  });

  it('stops replaying once the ride has started (edge)', async () => {
    const d = await onlineDriver(3);
    const r = await rider(51);
    const ride = await book(r.auth, true);
    await offer(ride);
    await acceptPending(ride.id, d.auth);
    await step(ride.id, d.auth, 'arriving', 'arrived');
    await announce(ride.id, r.auth).expect(201);

    await http
      .post(`/rides/${ride.id}/start`)
      .set('authorization', d.auth)
      .expect(201);

    expect((await driverRead(ride.id, d.auth)).announceRequestedAt).toBeNull();
  });

  it('refuses a flagged ride before arrival with 409 ride_not_arrived (failure)', async () => {
    const d = await onlineDriver(4);
    const r = await rider(52);
    const ride = await book(r.auth, true);
    await offer(ride);
    await acceptPending(ride.id, d.auth);
    await step(ride.id, d.auth, 'arriving');

    const res = await announce(ride.id, r.auth).expect(409);
    expect(res.body).toMatchObject({ message: 'ride_not_arrived' });
  });

  it('refuses an un-flagged ride at arrived with 409 announce_not_requested (failure)', async () => {
    const d = await onlineDriver(5);
    const r = await rider(53);
    const ride = await book(r.auth, false);
    await offer(ride);
    await acceptPending(ride.id, d.auth);
    await step(ride.id, d.auth, 'arriving', 'arrived');

    const res = await announce(ride.id, r.auth).expect(409);
    expect(res.body).toMatchObject({ message: 'announce_not_requested' });
  });

  it('answers another rider with 404 and a driver token with 403 (failure)', async () => {
    const d = await onlineDriver(6);
    const r = await rider(54);
    const stranger = await rider(55);
    const ride = await book(r.auth, true);
    await offer(ride);
    await acceptPending(ride.id, d.auth);
    await step(ride.id, d.auth, 'arriving', 'arrived');

    const res = await announce(ride.id, stranger.auth).expect(404);
    expect(res.body).toMatchObject({ message: 'ride_not_found' });
    await announce(ride.id, d.auth).expect(403);
  });

  it('answers another rider 404, not 500, when the stored request no longer parses (failure — PR #293 F5)', async () => {
    const r = await rider(56);
    const stranger = await rider(57);
    const ride = await book(r.auth, true);
    // A legacy row whose request predates the current schema. Cancelled in
    // the same write so no sweeper can pick it up while it is malformed.
    await ctx.db
      .update(rides)
      .set({ request: {}, status: 'cancelled_by_system' })
      .where(eq(rides.id, ride.id));

    const res = await announce(ride.id, stranger.auth).expect(404);
    expect(res.body).toMatchObject({ message: 'ride_not_found' });
  });

  it('a phone booking carries the flag, and the caller name reaches the driver at arrived (edge)', async () => {
    const dina = await dispatcher(90);
    const d = await onlineDriver(7);
    const res = await http
      .post('/dispatch/bookings')
      .set('authorization', dina.auth)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .send({
        callerPhone: p(56),
        callerName: 'Anna',
        pickup: CENTRE_PICKUP,
        destination: DESTINATION,
        paymentMethod: 'cash',
        options: { announceArrival: true },
      })
      .expect(201);
    const { ride } = rideCreatedSchema.parse(res.body);
    createdRides.push(ride.id);

    await http
      .post(`/dispatch/rides/${ride.id}/assign`)
      .set('authorization', dina.auth)
      .send({ driverId: d.id })
      .expect(201);
    expect(
      (await driverRead(ride.id, d.auth)).request.options.announceArrival,
    ).toBe(true);

    await step(ride.id, d.auth, 'arriving', 'arrived');
    expect((await driverRead(ride.id, d.auth)).rider.displayName).toBe('Anna');
  });
});
