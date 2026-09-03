import { drivers, rideOffers, rides } from '@taxi/db';
import {
  authSessionSchema,
  fareSplitSchema,
  IDEMPOTENCY_KEY_HEADER,
  rideCreatedSchema,
  rideSchema,
  RT,
  type LatLng,
  type RideOfferRevokedEvent,
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
 * `+371260` is this spec file's E.164 range — see phoneFor(). `+371210` (auth),
 * `+371220` (drivers), `+371230` (driver-location gateway), `+371240` (rides),
 * `+371250` (dispatch), `+371270` (payments), `+371280`
 * (tracking/notifications) and `+371290` (`scripts/mint-tracked-ride.ts`, the
 * only claimant that is not a spec — it runs against the DEV database, where
 * the collision is permanent) are taken, and `users.phone` is unique across a
 * run that never resets the database, so a collision reuses another file's
 * user — and its ROLE, which surfaces as a 403 naming nothing.
 */
const p = (n: number) => phoneFor('+371260', n);

/**
 * Inside centre only — clear of old_town and autoosta, both of which nest there.
 *
 * NOT the RIX pickup: RIX ships `queueModeEnabled: true`, and in queue mode
 * `offerNext` walks `['queued','offered']` inside one transaction and emits
 * ONCE with `previousStatus: 'requested'`. Pinning the pickup to centre is what
 * makes the asserted `requested → offered → accepted → …` sequence mean what it
 * claims.
 */
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

describe('ride lifecycle (integration)', () => {
  let ctx: TestApp;
  let http: ReturnType<typeof request>;
  let dispatch: DispatchService;
  let tokens: AuthTokenService;
  let cityId: string;
  let port: number;

  /** Every ride this file creates — retired in afterEach so they never crowd
   *  the sweeper's oldest-first batch and break another file's test. */
  const createdRides: string[] = [];
  /** Every driver this file touches, for presence and status cleanup. */
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

  // Order matters: clients first, app second, or jest hangs on open handles.
  afterEach(closeClients);

  afterEach(async () => {
    const driverIds = usedDrivers.splice(0);
    for (const driverId of driverIds) {
      await ctx.locations.markOffline(cityId, driverId);
    }
    // Retiring a ride by hand below never runs the lifecycle, so it never
    // releases `on_ride`. A driver left there 409s `driver_on_ride` on their
    // next `PUT /drivers/me/status` — against `.expect(200)`, naming nothing.
    //
    // Scoped to THIS file's drivers, like the ride retirement: spec files share
    // one database and run in parallel workers, so an unscoped
    // `where(status = 'on_ride')` would release another file's driver mid-test.
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
  const nextPlate = () => `LC${String(++plateSeq).padStart(4, '0')}`;

  /** A driver with a car, online, and a live position dispatch can find. */
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
    return { id, auth };
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

  /**
   * Dispatches THIS ride and nothing else.
   *
   * Deliberately NOT `DispatchSweeper.tick()`. The sweeper's work queue is
   * every `requested` ride in the database, and spec files share one database:
   * a tick here reaches into `dispatch.integration.spec.ts`'s rides and offers
   * them to THIS file's drivers, which fails that file's assertions with a
   * driver id it has never heard of. `offerNext` is the same production path
   * one ride at a time — the batching is dispatch's own concern and its own
   * spec's to cover.
   *
   * `Ride` already carries every `AwaitingRide` field, so nothing is invented.
   */
  const offerTo = (ride: Awaited<ReturnType<typeof book>>) =>
    dispatch.offerNext({
      id: ride.id,
      orderId: ride.orderId,
      riderId: ride.riderId,
      geozoneId: ride.geozoneId,
      request: ride.request,
      createdAt: ride.createdAt,
    });

  const rideRow = async (rideId: string) =>
    (await ctx.db.select().from(rides).where(eq(rides.id, rideId)))[0]!;

  const driverRow = async (driverId: string) =>
    (
      await ctx.db.select().from(drivers).where(eq(drivers.userId, driverId))
    )[0]!;

  const offersFor = (rideId: string) =>
    ctx.db.select().from(rideOffers).where(eq(rideOffers.rideId, rideId));

  const pendingOffer = async (rideId: string) =>
    (
      await ctx.db
        .select()
        .from(rideOffers)
        .where(
          and(eq(rideOffers.rideId, rideId), eq(rideOffers.status, 'pending')),
        )
    )[0];

  /**
   * Accumulates every `ride:status` this socket sees.
   *
   * NOT `waitFor`: each lifecycle POST returns AFTER its post-commit
   * `emitStatus` has already fired, so a listener attached after the request
   * has already missed the event and times out with nothing naming the cause.
   * Attach this BEFORE `POST /rides` — which is when `notifyRider` runs the
   * rider's join, and the only join these tests get for free. A socket opened
   * AFTER the booking is joined by `GET /rides/:rideId` instead, which is the
   * path the rider app actually takes; `joins a socket opened after the
   * booking` below is the test for it.
   */
  function collectStatuses(socket: Socket): RideStatusEvent[] {
    const seen: RideStatusEvent[] = [];
    socket.on(RT.rideStatus, (e: RideStatusEvent) => seen.push(e));
    return seen;
  }

  /** Sockets deliver asynchronously; the HTTP response does not wait for them. */
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

  /** Drives one ride from `requested` to a driver holding it. */
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

  /**
   * (expected) AC #1 — the whole ride, end to end over socket + REST. Every hop
   * is a guarded transition and the rider's phone follows all of them.
   */
  it('runs accepted → arriving → arrived → in_progress → completed (AC #1)', async () => {
    const d = await onlineDriver(1, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(50);

    // BEFORE the booking: `joinRideRoom` only reaches sockets that exist at
    // that instant, and it runs exactly once, at creation.
    const sock = await connectClient(port, r.token);
    const seen = collectStatuses(sock);

    const ride = await bookAndAccept(r.auth, d.auth);

    // The claim is what keeps `candidate-filter.ts` from offering this driver a
    // second car while they are driving the first.
    expect((await driverRow(d.id)).status).toBe('on_ride');

    for (const step of ['arriving', 'arrived', 'start'] as const) {
      await http
        .post(`/rides/${ride.id}/${step}`)
        .set('authorization', d.auth)
        .expect(201);
    }
    await http
      .post(`/rides/${ride.id}/complete`)
      .set('authorization', d.auth)
      .expect(201);

    const mine = () => seen.filter((e) => e.rideId === ride.id);
    await waitForCount(() => mine().length, 7);

    expect(mine().map((e) => e.status)).toEqual([
      'requested',
      'offered',
      'accepted',
      'arriving',
      'arrived',
      'in_progress',
      'completed',
    ]);
    expect(mine().map((e) => e.previousStatus)).toEqual([
      null,
      'requested',
      'offered',
      'accepted',
      'arriving',
      'arrived',
      'in_progress',
    ]);

    const row = await rideRow(ride.id);
    expect(row.status).toBe('completed');
    // All four settled columns, written together at completion.
    expect(row.commissionPct).not.toBeNull();
    expect(row.commissionSource).not.toBeNull();
    expect(row.commissionCents).not.toBeNull();
    expect(row.driverNetCents).not.toBeNull();

    // Released, so the driver is dispatchable again.
    expect((await driverRow(d.id)).status).toBe('online');
  });

  /**
   * (expected) AC #4 — the settled split is COPIED from the offer card the
   * driver accepted, not recomputed.
   *
   * The override is changed mid-ride on purpose: recomputing at completion
   * would pick up the new value and pay the driver a number different from the
   * one they said yes to. That is the €200→€130 failure mode, and this is the
   * assertion that makes it impossible to reintroduce.
   */
  it('settles the split the driver was actually shown, to the cent (AC #4)', async () => {
    const d = await onlineDriver(2, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(51);

    await ctx.db
      .update(drivers)
      .set({ commissionPctOverride: 5 })
      .where(eq(drivers.userId, d.id));

    const ride = await bookAndAccept(r.auth, d.auth);

    const accepted = (await offersFor(ride.id)).find(
      (o) => o.status === 'accepted',
    )!;
    const shown = fareSplitSchema.parse(accepted.split);
    expect(shown.commissionPct).toBe(5);

    // An admin edits the driver's commission mid-ride (#20 makes this routine).
    await ctx.db
      .update(drivers)
      .set({ commissionPctOverride: 40 })
      .where(eq(drivers.userId, d.id));

    for (const step of ['arriving', 'arrived', 'start'] as const) {
      await http
        .post(`/rides/${ride.id}/${step}`)
        .set('authorization', d.auth)
        .expect(201);
    }
    const res = await http
      .post(`/rides/${ride.id}/complete`)
      .set('authorization', d.auth)
      .expect(201);

    const row = await rideRow(ride.id);
    // The OFFER's percentage, not the freshly resolved one.
    expect(row.commissionPct).toBe(5);
    expect(row.commissionCents).toBe(shown.commissionCents);
    expect(row.driverNetCents).toBe(shown.driverNetCents);
    expect(row.commissionSource).toBe(shown.commissionSource);

    // No cent leaks, and every value is an integer.
    expect(row.commissionCents! + row.driverNetCents!).toBe(row.totalCents);
    expect(Number.isInteger(row.commissionCents)).toBe(true);
    expect(Number.isInteger(row.driverNetCents)).toBe(true);

    // The driver reads the full fare and the commission line off the response
    // to the tap that ended the ride.
    const body = res.body as {
      ride: {
        quote: { totalCents: number } | null;
        split: typeof shown | null;
      };
    };
    expect(body.ride.split!.totalCents).toBe(body.ride.quote!.totalCents);
    expect(body.ride.split!.commissionPct).toBe(5);
  });

  /**
   * (edge) AC #2 — the rider changes their mind while a card is on a driver's
   * phone. `ride:offer_revoked`'s third reason finally has a producer, and here
   * `cancelled` is accurate in a way it would not be for a decline.
   */
  it('cancels pre-acceptance and clears the pending offer card (AC #2)', async () => {
    const d = await onlineDriver(3, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(52);
    const driverSock = await connectClient(
      port,
      (await tokens.issue({ id: d.id, role: 'driver' })).accessToken,
    );

    const ride = await book(r.auth);
    await offerTo(ride);
    expect(await pendingOffer(ride.id)).toBeDefined();

    const cleared = waitForEvent<RideOfferRevokedEvent>(
      driverSock,
      RT.rideOfferRevoked,
      ride.id,
    );

    await http
      .post(`/rides/${ride.id}/cancel`)
      .set('authorization', r.auth)
      .send({ reason: 'changed my mind' })
      .expect(201);

    expect((await rideRow(ride.id)).status).toBe('cancelled_by_rider');
    expect((await cleared).reason).toBe('cancelled');
    expect((await offersFor(ride.id))[0]!.status).toBe('revoked');
  });

  /** (edge) AC #2 — a driver drops an accepted ride and rejoins the pool. */
  it('cancels post-acceptance and releases the driver (AC #2)', async () => {
    const d = await onlineDriver(4, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(53);

    const ride = await bookAndAccept(r.auth, d.auth);
    expect((await driverRow(d.id)).status).toBe('on_ride');

    await http
      .post(`/rides/${ride.id}/cancel`)
      .set('authorization', d.auth)
      .send({ reason: 'car trouble' })
      .expect(201);

    expect((await rideRow(ride.id)).status).toBe('cancelled_by_driver');
    expect((await driverRow(d.id)).status).toBe('online');
  });

  /**
   * (edge) AC #2 — `in_progress` allows only `completed` and
   * `cancelled_by_dispatcher`. Dina can pull a ride that is already moving; the
   * rider cannot, and gets a typed 409 rather than a 500.
   */
  it('lets only a dispatcher cancel a ride already under way (AC #2)', async () => {
    const d = await onlineDriver(5, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(54);
    const dina = await dispatcher(90);

    const ride = await bookAndAccept(r.auth, d.auth);
    for (const step of ['arriving', 'arrived', 'start'] as const) {
      await http
        .post(`/rides/${ride.id}/${step}`)
        .set('authorization', d.auth)
        .expect(201);
    }

    await http
      .post(`/rides/${ride.id}/cancel`)
      .set('authorization', r.auth)
      .send({})
      .expect(409);
    expect((await rideRow(ride.id)).status).toBe('in_progress');

    await http
      .post(`/rides/${ride.id}/cancel`)
      .set('authorization', dina.auth)
      .send({ reason: 'rider left the car' })
      .expect(201);

    expect((await rideRow(ride.id)).status).toBe('cancelled_by_dispatcher');
    expect((await driverRow(d.id)).status).toBe('online');
  });

  /**
   * (failure) AC #3 — Atis's hard rule. Editable while nobody has the job,
   * refused the moment a driver does.
   */
  it('refuses a payment-method change once a driver has accepted (AC #3)', async () => {
    const d = await onlineDriver(6, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(55);

    const ride = await book(r.auth);

    await http
      .patch(`/rides/${ride.id}/payment-method`)
      .set('authorization', r.auth)
      .send({ paymentMethod: 'card' })
      .expect(200);
    expect((await rideRow(ride.id)).paymentMethod).toBe('card');

    await offerTo(ride);
    const offer = await pendingOffer(ride.id);
    await http
      .post(`/dispatch/offers/${offer!.id}/accept`)
      .set('authorization', d.auth)
      .expect(201);

    const res = await http
      .patch(`/rides/${ride.id}/payment-method`)
      .set('authorization', r.auth)
      .send({ paymentMethod: 'cash' })
      .expect(409);
    expect((res.body as { message: string }).message).toBe(
      'payment_method_locked',
    );

    // The write never happened — the lock IS the conditional UPDATE.
    const row = await rideRow(ride.id);
    expect(row.paymentMethod).toBe('card');
    // …and the immutable "what was asked" snapshot was never rewritten.
    expect((row.request as { paymentMethod: string }).paymentMethod).toBe(
      'cash',
    );
  });

  /**
   * (failure) AC #1 — the guards. Out of order is a 409, someone else's ride is
   * a 403, and a double-tapped complete settles exactly once.
   */
  it('409s out-of-order steps and 403s a driver who is not on the ride (AC #1)', async () => {
    const d = await onlineDriver(7, near(CENTRE_PICKUP.location, 0.001, 0));
    const other = await onlineDriver(
      8,
      near(CENTRE_PICKUP.location, 0.02, 0.02),
    );
    const r = await rider(56);

    const ride = await bookAndAccept(r.auth, d.auth);

    // `arrived → in_progress` is the only edge into `start`.
    const early = await http
      .post(`/rides/${ride.id}/start`)
      .set('authorization', d.auth)
      .expect(409);
    expect((early.body as { message: string }).message).toBe(
      'ride_not_arrived',
    );

    await http
      .post(`/rides/${ride.id}/arrived`)
      .set('authorization', other.auth)
      .expect(403);

    for (const step of ['arriving', 'arrived', 'start'] as const) {
      await http
        .post(`/rides/${ride.id}/${step}`)
        .set('authorization', d.auth)
        .expect(201);
    }
    await http
      .post(`/rides/${ride.id}/complete`)
      .set('authorization', d.auth)
      .expect(201);

    const settled = await rideRow(ride.id);

    // A second tap settles nothing: the conditional UPDATE already matched.
    await http
      .post(`/rides/${ride.id}/complete`)
      .set('authorization', d.auth)
      .expect(409);

    const after = await rideRow(ride.id);
    expect(after.commissionCents).toBe(settled.commissionCents);
    expect(after.driverNetCents).toBe(settled.driverNetCents);
  });

  /**
   * (failure) AC #4 — two taps at once settle exactly once.
   *
   * The conditional UPDATE inside the transaction decides: the loser's
   * `transitionInTx` matches no row, its callback throws, and the whole
   * transaction — including the split write — rolls back. A double settlement
   * would be a driver paid twice, which is the one arithmetic error this
   * ticket's whole point forbids.
   */
  it('settles exactly once under two concurrent completes (AC #4)', async () => {
    const d = await onlineDriver(9, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(57);

    const ride = await bookAndAccept(r.auth, d.auth);
    for (const step of ['arriving', 'arrived', 'start'] as const) {
      await http
        .post(`/rides/${ride.id}/${step}`)
        .set('authorization', d.auth)
        .expect(201);
    }

    const accepted = (await offersFor(ride.id)).find(
      (o) => o.status === 'accepted',
    )!;
    const shown = fareSplitSchema.parse(accepted.split);

    const complete = () =>
      http.post(`/rides/${ride.id}/complete`).set('authorization', d.auth);
    const [first, second] = await Promise.all([complete(), complete()]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);

    // WHICH 409 depends on where the loser lost. Both are correct and both are
    // typed: `ride_transition_conflict` when it got past the prologue and lost
    // the in-transaction UPDATE, `ride_not_in_progress` when the winner had
    // already committed by the time it read the ride. Never a 500.
    const loser = [first, second].find((res) => res.status === 409)!;
    expect(['ride_transition_conflict', 'ride_not_in_progress']).toContain(
      (loser.body as { message: string }).message,
    );

    // One settlement, and it is the one the driver was shown.
    const row = await rideRow(ride.id);
    expect(row.status).toBe('completed');
    expect(row.commissionCents).toBe(shown.commissionCents);
    expect(row.driverNetCents).toBe(shown.driverNetCents);
    expect(row.commissionCents! + row.driverNetCents!).toBe(row.totalCents);
    expect((await driverRow(d.id)).status).toBe('online');
  });

  /**
   * (failure) C1 — the rider app's REAL ordering: book first, connect after.
   *
   * Every other test in this file connects before booking, because that is when
   * `notifyRider` runs its join. The app cannot: `booking-screen.tsx` reaches
   * `/book/status` by `router.replace` only once `book()` has resolved, so the
   * socket that renders the ride is created strictly after the only join the
   * server used to perform. The REST read the screen fires on `connect` is what
   * closes it.
   *
   * Delete `joinRideRoom` from `findForRider` and this fails with `seen` empty
   * while the CONTROL still reads `offered` — which is precisely how the bug
   * looked in the app: a silent screen reporting itself connected.
   */
  it('joins a socket opened AFTER the booking, through GET /rides/:rideId (failure)', async () => {
    // Bound to nothing: this test needs a driver to exist so `offerNext` has a
    // candidate, and never acts as one.
    await onlineDriver(10, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(58);

    const ride = await book(r.auth);
    // Only now — the app has no socket before this point.
    const sock = await connectClient(port, r.token);
    const seen = collectStatuses(sock);

    // What `useRideStatus` does on every `connect`. This is the join.
    await http
      .get(`/rides/${ride.id}`)
      .set('authorization', r.auth)
      .expect(200);

    await offerTo(ride);

    const mine = () => seen.filter((e) => e.rideId === ride.id);
    await waitForCount(() => mine().length, 1);
    expect(mine().map((e) => e.status)).toEqual(['offered']);

    // CONTROL: the ride moves either way, so an empty `seen` can only mean the
    // socket was deaf — never that dispatch did nothing.
    expect((await rideRow(ride.id)).status).toBe('offered');
  });

  /**
   * (edge) M3 — a SETTLED ride read by its own rider carries no commission.
   *
   * `toRide` fills `split` from the five settlement columns the moment they are
   * written, so the rider's own read is the one door through which the driver's
   * commission line could reach a rider surface. Twenty lines from here
   * `rideQuotePreviewSchema` refuses to carry it; this pins the same rule on the
   * path that actually has the data.
   */
  it('strips the settled split from the rider read (edge)', async () => {
    const d = await onlineDriver(11, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(59);

    const ride = await bookAndAccept(r.auth, d.auth);
    for (const step of ['arriving', 'arrived', 'start'] as const) {
      await http
        .post(`/rides/${ride.id}/${step}`)
        .set('authorization', d.auth)
        .expect(201);
    }
    await http
      .post(`/rides/${ride.id}/complete`)
      .set('authorization', d.auth)
      .expect(201);

    // CONTROL: the split EXISTS in the database — so a null below is the
    // stripping, not an unsettled ride.
    const row = await rideRow(ride.id);
    expect(row.commissionCents).not.toBeNull();

    const res = await http
      .get(`/rides/${ride.id}`)
      .set('authorization', r.auth)
      .expect(200);

    const body = rideSchema.parse(res.body);
    expect(body.status).toBe('completed');
    expect(body.split).toBeNull();
  });
});
