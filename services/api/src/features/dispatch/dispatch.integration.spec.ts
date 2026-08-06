import { RIGA_ZONE_IDS, dispatchAuditLog, rideOffers, rides } from '@taxi/db';
import {
  authSessionSchema,
  IDEMPOTENCY_KEY_HEADER,
  rideCreatedSchema,
  RT,
  type LatLng,
  type RideOfferEvent,
  type RideOfferRevokedEvent,
  type DispatchUnclaimedEvent,
} from '@taxi/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
} from '../../../test/harness';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { AuthTokenService } from '../auth';
import { MAX_OFFER_ATTEMPTS } from './dispatch.policy';
import { DispatchSweeper } from './dispatch.sweeper';

/** `+371250` is this spec file's E.164 range — see phoneFor(). */
const p = (n: number) => phoneFor('+371250', n);

/** Inside the RIX geozone, which ships `queueModeEnabled: true`. */
const RIX_PICKUP = {
  location: { lat: 56.9236, lng: 23.9711 },
  address: 'Lidosta RIX',
};
/** Inside centre only — clear of old_town and autoosta, both of which nest there. */
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

describe('dispatch (integration)', () => {
  let ctx: TestApp;
  let http: ReturnType<typeof request>;
  let sweeper: DispatchSweeper;
  let cityId: string;
  let port: number;
  let tokens: AuthTokenService;

  /** Every ride this file creates — reset in afterEach so the sweeper's
   *  oldest-first batch stays dominated by the ride under test. */
  const createdRides: string[] = [];
  /** Every driver this file puts in the location store. */
  const usedDrivers: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0);
    port = (
      ctx.app.getHttpServer() as { address(): AddressInfo | null }
    ).address()!.port;
    http = request(ctx.app.getHttpServer());
    sweeper = ctx.app.get(DispatchSweeper);
    tokens = ctx.app.get(AuthTokenService);
    cityId = ctx.app.get<Env>(APP_ENV).DEFAULT_CITY_ID;
  });

  // Order matters: clients first, app second, or jest hangs on open handles.
  afterEach(closeClients);

  afterEach(async () => {
    // Presence is per-test: a driver left online at yesterday's coordinates is
    // a candidate for the next test's pickup.
    for (const driverId of usedDrivers.splice(0)) {
      await ctx.locations.markOffline(cityId, driverId);
    }
    // Retire this file's rides so they never crowd the sweeper's batch. Only
    // ever rides THIS file created — other spec files share the database and
    // assert on their own rows.
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

  async function signIn(phone: string, role: 'rider' | 'driver' = 'driver') {
    await http.post('/auth/otp/request').send({ phone, role }).expect(200);
    const code = ctx.sms.lastCodeFor(phone)!;
    const res = await http
      .post('/auth/otp/verify')
      .send({ phone, code })
      .expect(200);
    return authSessionSchema.parse(res.body);
  }

  let plateSeq = 0;
  const nextPlate = () => `DS${String(++plateSeq).padStart(4, '0')}`;

  /** A driver with a car, online, and a live position dispatch can find. */
  async function onlineDriver(
    n: number,
    location: LatLng,
    car: { hasChildSeat?: boolean } = {},
  ) {
    const session = await signIn(p(n));
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
        hasChildSeat: car.hasChildSeat ?? false,
      })
      .expect(201);

    await http
      .put('/drivers/me/status')
      .set('authorization', auth)
      .send({ status: 'online' })
      .expect(200);

    await place(id, location);
    return { id, auth };
  }

  /** Positions go straight into the store: the ping path is a socket concern. */
  async function place(driverId: string, location: LatLng): Promise<void> {
    await ctx.locations.markOnline(cityId, driverId);
    await ctx.locations.record(cityId, driverId, location, Date.now());
    if (!usedDrivers.includes(driverId)) usedDrivers.push(driverId);
  }

  async function bookRide(
    riderN: number,
    pickup: typeof RIX_PICKUP,
    options?: { childSeat?: boolean; femaleDriver?: boolean },
  ) {
    const session = await signIn(p(riderN), 'rider');
    const res = await http
      .post('/rides')
      .set('authorization', `Bearer ${session.accessToken}`)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .send({
        pickup,
        destination: DESTINATION,
        paymentMethod: 'cash',
        ...(options ? { options } : {}),
      })
      .expect(201);
    const { ride } = rideCreatedSchema.parse(res.body);
    createdRides.push(ride.id);
    return ride;
  }

  const offersFor = (rideId: string) =>
    ctx.db
      .select()
      .from(rideOffers)
      .where(eq(rideOffers.rideId, rideId))
      .orderBy(rideOffers.sentAt);

  const rideRow = async (rideId: string) =>
    (await ctx.db.select().from(rides).where(eq(rides.id, rideId)))[0]!;

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
   * Waits for one event about THIS ride. Filtering by ride id is not optional:
   * spec files share the test database, so another file's ride can legitimately
   * be dispatched by the same tick.
   */
  function waitFor<T extends { rideId: string }>(
    socket: Socket,
    event: string,
    rideId: string,
    timeoutMs = 2_000,
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

  const driverSocket = async (driverId: string) =>
    connectClient(
      port,
      (await tokens.issue({ id: driverId, role: 'driver' })).accessToken,
    );

  /**
   * (expected) AC #1 — the cascade end to end: the best candidate is offered,
   * a decline re-offers the next, and the accept assigns the ride and writes
   * the audit row.
   */
  it('offers, re-offers after a decline, and assigns on accept (AC #1)', async () => {
    const nearD = await onlineDriver(1, near(CENTRE_PICKUP.location, 0.001, 0));
    const farD = await onlineDriver(
      2,
      near(CENTRE_PICKUP.location, 0.02, 0.02),
    );
    const ride = await bookRide(10, CENTRE_PICKUP);

    await sweeper.tick();

    // The NEARER driver is offered first — this pickup is in auto-match mode.
    let live = await pendingOffer(ride.id);
    expect(live?.driverId).toBe(nearD.id);
    expect((await rideRow(ride.id)).status).toBe('offered');
    // The card carries the full fare the RIDER pays (S2-5), not the net.
    const quote = live!.quote as { totalCents: number };
    const split = live!.split as { totalCents: number; driverNetCents: number };
    expect(split.totalCents).toBe(quote.totalCents);
    expect(split.driverNetCents).toBeLessThan(quote.totalCents);

    await http
      .post(`/dispatch/offers/${live!.id}/decline`)
      .set('authorization', nearD.auth)
      .expect(201);

    // Back to `requested`, so the next tick tries somebody else.
    expect((await rideRow(ride.id)).status).toBe('requested');

    await sweeper.tick();

    live = await pendingOffer(ride.id);
    expect(live?.driverId).toBe(farD.id);

    await http
      .post(`/dispatch/offers/${live!.id}/accept`)
      .set('authorization', farD.auth)
      .expect(201);

    const row = await rideRow(ride.id);
    expect(row.status).toBe('accepted');
    expect(row.driverId).toBe(farD.id);

    const all = await offersFor(ride.id);
    expect(all.map((o) => o.status)).toEqual(['declined', 'accepted']);

    const audit = await ctx.db
      .select()
      .from(dispatchAuditLog)
      .where(eq(dispatchAuditLog.rideId, ride.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.source).toBe('auto_match');
    expect(audit[0]!.driverId).toBe(farD.id);
    expect(audit[0]!.dispatcherId).toBeNull();
  });

  /**
   * (edge) AC #2 — geozone queue fairness. The queue-ranked driver beats a
   * strictly nearer one; the SAME drivers under an auto-match pickup produce
   * the opposite answer, which is what proves the mode switched the result
   * rather than the fixture.
   */
  it('offers by queue position in a queue zone, and by distance outside one (AC #2)', async () => {
    const nearD = await onlineDriver(3, near(RIX_PICKUP.location, 0.0005, 0));
    const queuedD = await onlineDriver(
      4,
      near(RIX_PICKUP.location, 0.008, 0.008),
    );

    // `queuedD` waited their turn; `nearD` has not joined the rank at all.
    await ctx.queue.joinBack(RIGA_ZONE_IDS.rix, queuedD.id);

    const queueRide = await bookRide(11, RIX_PICKUP);
    await sweeper.tick();

    const queueOffer = await pendingOffer(queueRide.id);
    // The whole point of "izsaukumi rindas kārtībā": the rank decides.
    expect(queueOffer?.driverId).toBe(queuedD.id);
    expect(queueOffer?.queuePosition).toBe(1);
    expect(queueOffer?.source).toBe('geozone_queue');
    // The zone was resolved and stamped for Dina's district stats.
    expect((await rideRow(queueRide.id)).geozoneId).toBe(RIGA_ZONE_IDS.rix);

    // ── the paired half: same two drivers, same relative distances, a pickup
    // in a zone with queue mode OFF ──
    await place(nearD.id, near(CENTRE_PICKUP.location, 0.0005, 0));
    await place(queuedD.id, near(CENTRE_PICKUP.location, 0.008, 0.008));

    const autoRide = await bookRide(12, CENTRE_PICKUP);
    await sweeper.tick();

    const autoOffer = await pendingOffer(autoRide.id);
    // If both halves returned the same driver, the mode never switched and both
    // assertions would be lying.
    expect(autoOffer?.driverId).toBe(nearD.id);
    expect(autoOffer?.source).toBe('auto_match');
    expect(autoOffer?.queuePosition).toBeNull();
  });

  /**
   * (failure) AC #3 — an offer times out, the card is revoked, the ride returns
   * to the pool, and with no candidate left Dina gets the unclaimed alert with
   * the right attempt count.
   */
  it('expires an offer, re-offers, and finally alerts dispatch (AC #3)', async () => {
    const only = await onlineDriver(5, near(CENTRE_PICKUP.location, 0.001, 0));
    const driverSock = await driverSocket(only.id);

    const dispatcher = await insertUser(ctx.db, {
      phone: p(90),
      role: 'dispatcher',
    });
    const dispatchSock = await connectClient(
      port,
      (await tokens.issue({ id: dispatcher.id, role: 'dispatcher' }))
        .accessToken,
    );

    const ride = await bookRide(13, CENTRE_PICKUP);
    await sweeper.tick();

    const live = await pendingOffer(ride.id);
    expect(live?.driverId).toBe(only.id);

    const revoked = waitFor<RideOfferRevokedEvent>(
      driverSock,
      RT.rideOfferRevoked,
      ride.id,
    );
    const unclaimed = waitFor<DispatchUnclaimedEvent>(
      dispatchSock,
      RT.dispatchUnclaimed,
      ride.id,
    );

    // Time is driven by the DATABASE's clock, not by sleeping: an offer seeded
    // with a past deadline is overdue to Postgres's own now().
    await ctx.db
      .update(rideOffers)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(rideOffers.id, live!.id));

    await sweeper.tick();

    expect((await revoked).reason).toBe('expired');
    const afterExpiry = await offersFor(ride.id);
    expect(afterExpiry[0]!.status).toBe('expired');

    // The only candidate has already been tried, so the ride has nowhere left
    // to go — which is exactly Dina's S9-4 trigger.
    const alert = await unclaimed;
    expect(alert.offerAttempts).toBe(1);
    expect(alert.pickup.address).toBe(CENTRE_PICKUP.address);
    expect((await rideRow(ride.id)).status).toBe('requested');

    // …and it fires ONCE, however many ticks pass.
    let extra = 0;
    const countExtra = (e: DispatchUnclaimedEvent) => {
      if (e.rideId === ride.id) extra += 1;
    };
    dispatchSock.on(RT.dispatchUnclaimed, countExtra);
    await sweeper.tick();
    await sweeper.tick();
    expect(extra).toBe(0);
    // Removed explicitly: a listener left attached outlives the test and fires
    // into a closed socket during teardown.
    dispatchSock.off(RT.dispatchUnclaimed, countExtra);
  });

  /**
   * AC #4 — Dina overrides mid-cascade. The pending offer is revoked, the
   * overridden driver's card clears, and the audit row names her.
   */
  it('force-assigns mid-cascade and clears the overridden card (AC #4)', async () => {
    const offered = await onlineDriver(
      6,
      near(CENTRE_PICKUP.location, 0.001, 0),
    );
    const forced = await onlineDriver(
      7,
      near(CENTRE_PICKUP.location, 0.02, 0.02),
    );
    const offeredSock = await driverSocket(offered.id);

    const dispatcher = await insertUser(ctx.db, {
      phone: p(91),
      role: 'dispatcher',
    });
    const dispatcherAuth = `Bearer ${(await tokens.issue({ id: dispatcher.id, role: 'dispatcher' })).accessToken}`;

    const ride = await bookRide(14, CENTRE_PICKUP);
    await sweeper.tick();

    const live = await pendingOffer(ride.id);
    expect(live?.driverId).toBe(offered.id);

    const cleared = waitFor<RideOfferRevokedEvent>(
      offeredSock,
      RT.rideOfferRevoked,
      ride.id,
    );

    await http
      .post(`/dispatch/rides/${ride.id}/assign`)
      .set('authorization', dispatcherAuth)
      .send({ driverId: forced.id, reason: 'caller asked for this car' })
      .expect(201);

    const row = await rideRow(ride.id);
    expect(row.status).toBe('accepted');
    expect(row.driverId).toBe(forced.id);

    // The returned-pairs path from the repository is exercised ONLY here and on
    // a concurrent accept — without this assertion a silently-empty RETURNING
    // would ship green and the overridden driver's card would never clear.
    expect((await cleared).reason).toBe('taken');
    const revokedRow = (await offersFor(ride.id)).find(
      (o) => o.driverId === offered.id,
    );
    expect(revokedRow!.status).toBe('revoked');

    const audit = await ctx.db
      .select()
      .from(dispatchAuditLog)
      .where(eq(dispatchAuditLog.rideId, ride.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.source).toBe('dispatcher');
    expect(audit[0]!.dispatcherId).toBe(dispatcher.id);
    expect(audit[0]!.reason).toBe('caller asked for this car');
  });

  /**
   * The other half of force-assign: a ride still sitting in the pool, with no
   * offer out. `requested → accepted` is not a legal transition, so this path
   * walks `requested → offered → accepted` — and the driver need not be
   * eligible, or even online, because overriding the algorithm IS the feature.
   */
  it('force-assigns a pooled ride to an OFFLINE driver and still audits it (edge)', async () => {
    const offline = await onlineDriver(
      27,
      near(CENTRE_PICKUP.location, 0.001, 0),
    );
    await http
      .put('/drivers/me/status')
      .set('authorization', offline.auth)
      .send({ status: 'offline' })
      .expect(200);
    await ctx.locations.markOffline(cityId, offline.id);

    const dispatcher = await insertUser(ctx.db, {
      phone: p(93),
      role: 'dispatcher',
    });
    const dispatcherAuth = `Bearer ${(await tokens.issue({ id: dispatcher.id, role: 'dispatcher' })).accessToken}`;

    // No tick(): the ride is still at `requested` with nobody holding an offer.
    const ride = await bookRide(28, CENTRE_PICKUP);

    await http
      .post(`/dispatch/rides/${ride.id}/assign`)
      .set('authorization', dispatcherAuth)
      .send({ driverId: offline.id })
      .expect(201);

    const row = await rideRow(ride.id);
    expect(row.status).toBe('accepted');
    expect(row.driverId).toBe(offline.id);

    // The offer row records what the dispatcher put in front of the driver.
    const all = await offersFor(ride.id);
    expect(all).toHaveLength(1);
    expect(all[0]!.source).toBe('dispatcher');
    expect(all[0]!.status).toBe('accepted');

    const audit = await ctx.db
      .select()
      .from(dispatchAuditLog)
      .where(eq(dispatchAuditLog.rideId, ride.id));
    expect(audit[0]!.dispatcherId).toBe(dispatcher.id);
  });

  it('409s a force-assign onto a ride a driver just accepted (failure)', async () => {
    const winner = await onlineDriver(
      29,
      near(CENTRE_PICKUP.location, 0.001, 0),
    );
    const other = await onlineDriver(
      30,
      near(CENTRE_PICKUP.location, 0.02, 0.02),
    );
    const dispatcher = await insertUser(ctx.db, {
      phone: p(94),
      role: 'dispatcher',
    });
    const dispatcherAuth = `Bearer ${(await tokens.issue({ id: dispatcher.id, role: 'dispatcher' })).accessToken}`;

    const ride = await bookRide(31, CENTRE_PICKUP);
    await sweeper.tick();
    const live = await pendingOffer(ride.id);
    await http
      .post(`/dispatch/offers/${live!.id}/accept`)
      .set('authorization', winner.auth)
      .expect(201);

    // `accepted → accepted` is not a transition, and reassignment needs a
    // cancellation path (#11). The conditional transition refuses.
    await http
      .post(`/dispatch/rides/${ride.id}/assign`)
      .set('authorization', dispatcherAuth)
      .send({ driverId: other.id })
      .expect(409);

    expect((await rideRow(ride.id)).driverId).toBe(winner.id);
  });

  it('sends the offer over the socket with ISO timestamps (expected)', async () => {
    const d = await onlineDriver(8, near(CENTRE_PICKUP.location, 0.001, 0));
    const sock = await driverSocket(d.id);
    const ride = await bookRide(15, CENTRE_PICKUP);

    const offered = waitFor<RideOfferEvent>(sock, RT.rideOffer, ride.id);
    await sweeper.tick();

    const event = await offered;
    expect(event.driverId).toBe(d.id);
    // The wire carries ISO strings where the domain holds Dates — a `Date` here
    // would have thrown inside RT_EVENT_SCHEMAS.parse before it ever left.
    expect(typeof event.expiresAt).toBe('string');
    expect(new Date(event.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(event.quote.totalCents).toBe(event.split.totalCents);
  });

  it('never offers a ride to an offline driver (edge)', async () => {
    const online = await onlineDriver(
      16,
      near(CENTRE_PICKUP.location, 0.02, 0.02),
    );
    const goneOffline = await onlineDriver(
      17,
      near(CENTRE_PICKUP.location, 0.0005, 0),
    );

    // Nearer, but no longer present. Redis presence and `drivers.status` are
    // two stores and both must agree.
    await http
      .put('/drivers/me/status')
      .set('authorization', goneOffline.auth)
      .send({ status: 'offline' })
      .expect(200);

    const ride = await bookRide(18, CENTRE_PICKUP);
    await sweeper.tick();

    expect((await pendingOffer(ride.id))?.driverId).toBe(online.id);
  });

  it('goes straight to unclaimed when an option excludes everyone (edge)', async () => {
    // Every online driver has no child seat, so nobody is eligible.
    await onlineDriver(19, near(CENTRE_PICKUP.location, 0.001, 0), {
      hasChildSeat: false,
    });
    const dispatcher = await insertUser(ctx.db, {
      phone: p(92),
      role: 'dispatcher',
    });
    const dispatchSock = await connectClient(
      port,
      (await tokens.issue({ id: dispatcher.id, role: 'dispatcher' }))
        .accessToken,
    );

    const ride = await bookRide(20, CENTRE_PICKUP, { childSeat: true });
    const unclaimed = waitFor<DispatchUnclaimedEvent>(
      dispatchSock,
      RT.dispatchUnclaimed,
      ride.id,
    );

    await sweeper.tick();

    expect((await unclaimed).offerAttempts).toBe(0);
    // No offer row was ever written — nobody was eligible to receive one.
    expect(await offersFor(ride.id)).toHaveLength(0);
    expect((await rideRow(ride.id)).status).toBe('requested');
  });

  it('409s an accept on an already-expired offer (failure)', async () => {
    const d = await onlineDriver(21, near(CENTRE_PICKUP.location, 0.001, 0));
    const ride = await bookRide(22, CENTRE_PICKUP);
    await sweeper.tick();

    const live = await pendingOffer(ride.id);
    await ctx.db
      .update(rideOffers)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(rideOffers.id, live!.id));

    // The `expires_at > now()` predicate decides, and it is conditional — so
    // this is a 409, never a 500.
    await http
      .post(`/dispatch/offers/${live!.id}/accept`)
      .set('authorization', d.auth)
      .expect(409);

    expect((await rideRow(ride.id)).status).toBe('offered');
  });

  it('lets exactly one of two concurrent accepts win (failure)', async () => {
    const a = await onlineDriver(23, near(CENTRE_PICKUP.location, 0.001, 0));
    const ride = await bookRide(24, CENTRE_PICKUP);
    await sweeper.tick();
    const live = await pendingOffer(ride.id);

    const accept = () =>
      http
        .post(`/dispatch/offers/${live!.id}/accept`)
        .set('authorization', a.auth);

    const [first, second] = await Promise.all([accept(), accept()]);
    const codes = [first.status, second.status].sort();

    // One 201 and one 409 — the conditional UPDATE decides, and the loser gets
    // a conflict rather than a 500.
    expect(codes).toEqual([201, 409]);
    expect((await rideRow(ride.id)).driverId).toBe(a.id);
  });

  /**
   * The rolled-back half of a concurrent accept, asserted over a REAL socket
   * rather than a fake: the loser must receive neither `ride:assigned` nor a
   * `ride:status` of `accepted`. Every emit is post-commit, so a transaction
   * that rolled back leaves nothing on any phone — and this is the only place a
   * genuine rollback happens.
   */
  it('emits nothing to the loser of a concurrent accept (edge)', async () => {
    const a = await onlineDriver(32, near(CENTRE_PICKUP.location, 0.001, 0));
    const sock = await driverSocket(a.id);

    const assigned: unknown[] = [];
    const acceptedStatuses: unknown[] = [];
    const ride = await bookRide(33, CENTRE_PICKUP);
    await sweeper.tick();
    const live = await pendingOffer(ride.id);

    sock.on(RT.rideAssigned, (e: { rideId: string }) => {
      if (e.rideId === ride.id) assigned.push(e);
    });
    sock.on(RT.rideStatus, (e: { rideId: string; status: string }) => {
      if (e.rideId === ride.id && e.status === 'accepted') {
        acceptedStatuses.push(e);
      }
    });
    // Awaited rather than slept on, so the FIRST event's arrival is
    // deterministic; the window afterwards only has to catch a second one.
    const firstAssigned = waitFor(sock, RT.rideAssigned, ride.id);

    const accept = () =>
      http
        .post(`/dispatch/offers/${live!.id}/accept`)
        .set('authorization', a.auth);
    const [first, second] = await Promise.all([accept(), accept()]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);

    await firstAssigned;
    // Any emit from the ROLLED-BACK accept would land in this window.
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Exactly ONE of each — the winner's. The loser's rollback emitted nothing,
    // which is the whole reason emits live outside the transaction.
    expect(assigned).toHaveLength(1);
    expect(acceptedStatuses).toHaveLength(1);
  });

  /**
   * The cascade is bounded. Without this the engine would cycle candidates
   * forever while the rider watches nothing happen.
   */
  it('stops offering once MAX_OFFER_ATTEMPTS is reached and alerts instead (edge)', async () => {
    const d = await onlineDriver(34, near(CENTRE_PICKUP.location, 0.001, 0));
    const dispatcher = await insertUser(ctx.db, {
      phone: p(95),
      role: 'dispatcher',
    });
    const dispatchSock = await connectClient(
      port,
      (await tokens.issue({ id: dispatcher.id, role: 'dispatcher' }))
        .accessToken,
    );

    const ride = await bookRide(35, CENTRE_PICKUP);

    // Five spent attempts, all already resolved — so a candidate IS still
    // available and only the cap stops the cascade.
    const spent = Array.from({ length: MAX_OFFER_ATTEMPTS }, () => ({
      rideId: ride.id,
      driverId: d.id,
      status: 'expired' as const,
      source: 'auto_match' as const,
      sentAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() - 30_000),
      etaSeconds: 60,
      pickup: CENTRE_PICKUP,
      destination: DESTINATION,
      quote: {},
      split: {},
    }));
    await ctx.db.insert(rideOffers).values(spent);

    const unclaimed = waitFor<DispatchUnclaimedEvent>(
      dispatchSock,
      RT.dispatchUnclaimed,
      ride.id,
    );

    await sweeper.tick();

    expect((await unclaimed).offerAttempts).toBe(MAX_OFFER_ATTEMPTS);
    // No sixth offer was written.
    expect(await offersFor(ride.id)).toHaveLength(MAX_OFFER_ATTEMPTS);
    expect((await rideRow(ride.id)).status).toBe('requested');
  });

  it('refuses a force-assign from a driver token (failure)', async () => {
    const d = await onlineDriver(25, near(CENTRE_PICKUP.location, 0.001, 0));
    const ride = await bookRide(26, CENTRE_PICKUP);

    // The audit trail is only worth something if it cannot be written by the
    // person it would name.
    await http
      .post(`/dispatch/rides/${ride.id}/assign`)
      .set('authorization', d.auth)
      .send({ driverId: d.id })
      .expect(403);
  });
});
