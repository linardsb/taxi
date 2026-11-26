import { drivers, rideEvents, rideOffers, rides, vehicles } from '@taxi/db';
import {
  ALLOWED_TRANSITIONS,
  authSessionSchema,
  IDEMPOTENCY_KEY_HEADER,
  rideCreatedSchema,
  type LatLng,
  type RideStatus,
} from '@taxi/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  approveDriver,
  closeClients,
  createTestApp,
  insertUser,
  phoneFor,
  type TestApp,
} from '../../../test/harness';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { AuthTokenService } from '../auth';
import { DispatchService } from '../dispatch';
import { RideTransitionService } from './ride-transition.service';

/**
 * `+371350` is this spec file's E.164 range — see phoneFor(). `users.phone` is
 * unique across a run, so a collision reuses another file's user and its ROLE.
 */
const p = (n: number) => phoneFor('+371350', n);

/** Centre only, NOT RIX: queue mode would collapse `requested → offered`. */
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

describe('ride events (integration, #316)', () => {
  let ctx: TestApp;
  let http: ReturnType<typeof request>;
  let dispatch: DispatchService;
  let transitions: RideTransitionService;
  let tokens: AuthTokenService;
  let cityId: string;
  let dina: { id: string; auth: string };
  let admin: { id: string; auth: string };

  /** Every ride this file creates — retired in afterEach. */
  const createdRides: string[] = [];
  const usedDrivers: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
    dispatch = ctx.app.get(DispatchService);
    transitions = ctx.app.get(RideTransitionService);
    tokens = ctx.app.get(AuthTokenService);
    cityId = ctx.app.get<Env>(APP_ENV).DEFAULT_CITY_ID;

    const d = await insertUser(ctx.db, { phone: p(90), role: 'dispatcher' });
    dina = {
      id: d.id,
      auth: `Bearer ${(await tokens.issue({ id: d.id, role: 'dispatcher' })).accessToken}`,
    };
    const a = await insertUser(ctx.db, { phone: p(91), role: 'admin' });
    admin = {
      id: a.id,
      auth: `Bearer ${(await tokens.issue({ id: a.id, role: 'admin' })).accessToken}`,
    };
  });

  afterEach(closeClients);

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
  const nextPlate = () => `RE${String(++plateSeq).padStart(4, '0')}`;

  async function onlineDriver(
    n: number,
    location: LatLng,
    beforeOnline?: (auth: string) => Promise<void>,
  ) {
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

    await beforeOnline?.(auth);
    await approveDriver(ctx.db, id);
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
    return { id: session.user.id, auth: `Bearer ${session.accessToken}` };
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

  /** ONE ride, never `DispatchSweeper.tick()` — see ride-lifecycle spec. */
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

  const pendingOffer = async (rideId: string) =>
    (
      await ctx.db
        .select()
        .from(rideOffers)
        .where(
          and(eq(rideOffers.rideId, rideId), eq(rideOffers.status, 'pending')),
        )
    )[0];

  /** Ordered by `seq`, never `occurred_at` — events in one tx can tie. */
  const eventsFor = (rideId: string) =>
    ctx.db
      .select()
      .from(rideEvents)
      .where(eq(rideEvents.rideId, rideId))
      .orderBy(asc(rideEvents.seq));

  const shape = (e: Awaited<ReturnType<typeof eventsFor>>[number]) =>
    `${e.kind}:${e.fromStatus ?? '-'}>${e.toStatus}:${e.actorKind}`;

  const vehicleIdOf = async (driverId: string) =>
    (
      await ctx.db
        .select()
        .from(vehicles)
        .where(eq(vehicles.driverId, driverId))
    )[0]!.id;

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

  it('writes exactly one status event per ALLOWED_TRANSITIONS edge, newest by seq (edge)', async () => {
    const r = await rider(50);
    const ride = await book(r.auth);
    const actor = { kind: 'dispatcher' as const, id: dina.id };

    const edges = (
      Object.entries(ALLOWED_TRANSITIONS) as [
        RideStatus,
        readonly RideStatus[],
      ][]
    ).flatMap(([from, tos]) => tos.map((to) => [from, to] as const));
    expect(edges.length).toBeGreaterThan(0);

    // Each edge runs in ONE transaction that is rolled back: another worker's
    // `sweeper.tick()` acts on every committed `requested` ride, so nothing
    // this walk sets up may ever be visible outside it.
    const rollback = new Error('rollback edge');
    for (const [from, to] of edges) {
      await expect(
        ctx.db.transaction(async (tx) => {
          await tx
            .update(rides)
            .set({ status: from })
            .where(eq(rides.id, ride.id));
          const statusRows = () =>
            tx
              .select()
              .from(rideEvents)
              .where(
                and(
                  eq(rideEvents.rideId, ride.id),
                  eq(rideEvents.kind, 'status'),
                ),
              );
          const before = (await statusRows()).length;

          const moved = await transitions.transitionInTx(
            tx,
            ride.id,
            from,
            to,
            actor,
          );
          expect(moved?.status).toBe(to);

          const after = (await statusRows()).length;
          expect(`${from}>${to}: ${after - before}`).toBe(`${from}>${to}: 1`);
          const [newest] = await tx
            .select()
            .from(rideEvents)
            .where(eq(rideEvents.rideId, ride.id))
            .orderBy(desc(rideEvents.seq))
            .limit(1);
          expect(newest).toMatchObject({
            kind: 'status',
            fromStatus: from,
            toStatus: to,
            actorKind: 'dispatcher',
            actorId: dina.id,
          });
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    }
    expect((await rideRow(ride.id)).status).toBe('requested');
  });

  it('adds no event when the transition loses its race (failure)', async () => {
    const r = await rider(51);
    const ride = await book(r.auth);
    await ctx.db
      .update(rides)
      .set({ status: 'requested' })
      .where(eq(rides.id, ride.id));
    const before = (await eventsFor(ride.id)).length;

    // Legal edge, wrong `from`: the ride is `requested`, not `offered`.
    const moved = await ctx.db.transaction((tx) =>
      transitions.transitionInTx(tx, ride.id, 'offered', 'accepted', {
        kind: 'dispatcher',
        id: dina.id,
      }),
    );

    expect(moved).toBeUndefined();
    expect(await eventsFor(ride.id)).toHaveLength(before);
    expect((await rideRow(ride.id)).status).toBe('requested');
  });

  it('leaves no event when the surrounding transaction rolls back (failure)', async () => {
    const r = await rider(52);
    const ride = await book(r.auth);
    const before = (await eventsFor(ride.id)).length;

    await expect(
      ctx.db.transaction(async (tx) => {
        const moved = await transitions.transitionInTx(
          tx,
          ride.id,
          'requested',
          'offered',
          { kind: 'dispatcher', id: dina.id },
        );
        expect(moved).toBeDefined();
        throw new Error('rollback after the event insert');
      }),
    ).rejects.toThrow('rollback after the event insert');

    expect(await eventsFor(ride.id)).toHaveLength(before);
    expect((await rideRow(ride.id)).status).toBe('requested');
  });

  it('records a rider booking as created by the rider (expected)', async () => {
    const r = await rider(53);
    const ride = await book(r.auth);

    const events = await eventsFor(ride.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'created',
      fromStatus: null,
      toStatus: 'requested',
      actorKind: 'rider',
      actorId: r.id,
    });
  });

  it('records a phone booking as created by the dispatcher (expected)', async () => {
    const res = await http
      .post('/dispatch/bookings')
      .set('authorization', dina.auth)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .send({
        callerPhone: p(60),
        pickup: CENTRE_PICKUP,
        destination: DESTINATION,
        paymentMethod: 'cash',
      })
      .expect(201);
    const { ride } = rideCreatedSchema.parse(res.body);
    createdRides.push(ride.id);

    const events = await eventsFor(ride.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'created',
      actorKind: 'dispatcher',
      actorId: dina.id,
    });
  });

  it('records offer, accept and assignment with status before assigned (expected)', async () => {
    const d = await onlineDriver(1, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(54);

    const ride = await bookAndAccept(r.auth, d.auth);

    const events = await eventsFor(ride.id);
    expect(events.map(shape)).toEqual([
      'created:->requested:rider',
      'status:requested>offered:system',
      'status:offered>accepted:driver',
      'assigned:->accepted:driver',
    ]);
    expect(events[1]!.actorId).toBeNull();
    expect(events[2]!.actorId).toBe(d.id);
    expect(events[3]).toMatchObject({
      driverId: d.id,
      vehicleId: await vehicleIdOf(d.id),
    });
  });

  it('records the driver steps, completion and cash settlement by the driver (expected)', async () => {
    const d = await onlineDriver(2, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(55);
    const ride = await bookAndAccept(r.auth, d.auth);

    for (const step of ['arriving', 'arrived', 'start', 'complete'] as const) {
      await http
        .post(`/rides/${ride.id}/${step}`)
        .set('authorization', d.auth)
        .expect(201);
    }
    await http
      .post(`/rides/${ride.id}/settle`)
      .set('authorization', d.auth)
      .expect(201);

    const tail = (await eventsFor(ride.id)).slice(4);
    expect(tail.map(shape)).toEqual([
      'status:accepted>arriving:driver',
      'status:arriving>arrived:driver',
      'status:arrived>in_progress:driver',
      'status:in_progress>completed:driver',
      'status:completed>settled:driver',
    ]);
    expect(tail.every((e) => e.actorId === d.id)).toBe(true);
  });

  it('stores an offer decline code on the offer row and the ride event (expected)', async () => {
    const d = await onlineDriver(3, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(56);
    const ride = await book(r.auth);
    await offerTo(ride);
    const offer = await pendingOffer(ride.id);

    await http
      .post(`/dispatch/offers/${offer!.id}/decline`)
      .set('authorization', d.auth)
      .send({ reasonCode: 'decline_too_far' })
      .expect(201);

    const [row] = await ctx.db
      .select()
      .from(rideOffers)
      .where(eq(rideOffers.id, offer!.id));
    expect(row).toMatchObject({
      status: 'declined',
      declineReason: 'decline_too_far',
    });
    expect(row!.respondedAt).not.toBeNull();

    const last = (await eventsFor(ride.id)).at(-1)!;
    expect(shape(last)).toBe('status:offered>requested:driver');
    expect(last).toMatchObject({
      actorId: d.id,
      reasonCode: 'decline_too_far',
    });
  });

  it('accepts a decline with no body at all and stores null reasons (edge)', async () => {
    const d = await onlineDriver(4, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(57);
    const ride = await book(r.auth);
    await offerTo(ride);
    const offer = await pendingOffer(ride.id);

    // No `.send()`: no body and no content-type. `.send({})` takes a
    // different parser path and would pass without the preprocess.
    await http
      .post(`/dispatch/offers/${offer!.id}/decline`)
      .set('authorization', d.auth)
      .expect(201);

    const [row] = await ctx.db
      .select()
      .from(rideOffers)
      .where(eq(rideOffers.id, offer!.id));
    expect(row!.status).toBe('declined');
    expect(row!.declineReason).toBeNull();
    expect(row!.respondedAt).not.toBeNull();

    const last = (await eventsFor(ride.id)).at(-1)!;
    expect(shape(last)).toBe('status:offered>requested:driver');
    expect(last.reasonCode).toBeNull();
    expect(last.reasonText).toBeNull();
  });

  it('records an expired offer as a system transition back to requested (edge)', async () => {
    const d = await onlineDriver(5, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(58);
    const ride = await book(r.auth);
    await offerTo(ride);
    const offer = await pendingOffer(ride.id);

    // The sweeper's own call, for this one ride; `expireOffer` does not look at
    // `expires_at`, so no offer row is edited.
    await dispatch.expireOffer({
      id: offer!.id,
      rideId: ride.id,
      driverId: d.id,
    });

    const last = (await eventsFor(ride.id)).at(-1)!;
    expect(shape(last)).toBe('status:offered>requested:system');
    expect(last.actorId).toBeNull();
  });

  it('records a rider cancel with no body and a null reason (edge)', async () => {
    const r = await rider(59);
    const ride = await book(r.auth);

    await http
      .post(`/rides/${ride.id}/cancel`)
      .set('authorization', r.auth)
      .expect(201);

    const last = (await eventsFor(ride.id)).at(-1)!;
    expect(shape(last)).toBe('status:requested>cancelled_by_rider:rider');
    expect(last).toMatchObject({
      actorId: r.id,
      reasonCode: null,
      reasonText: null,
    });
  });

  it('never stamps a retired car on assignment (edge)', async () => {
    // Same category, so only plate order separates the cars. Without the
    // `retired_at IS NULL` filter the ORDER BY picks the lower plate, the
    // retired `AA9001`, over the active `RE…` car `onlineDriver` registers.
    let retiredId = '';
    const d = await onlineDriver(
      11,
      near(CENTRE_PICKUP.location, 0.001, 0),
      async (auth) => {
        const res = await http
          .post('/drivers/me/vehicles')
          .set('authorization', auth)
          .send({
            plate: 'AA9001',
            make: 'Skoda',
            model: 'Fabia',
            year: 2018,
            passengerSeats: 4,
            hasChildSeat: false,
          })
          .expect(201);
        retiredId = (res.body as { id: string }).id;
        await http
          .post(`/drivers/me/vehicles/${retiredId}/retire`)
          .set('authorization', auth)
          .expect(204);
      },
    );
    const activeId = (
      await ctx.db.select().from(vehicles).where(eq(vehicles.driverId, d.id))
    ).find((v) => v.retiredAt === null)!.id;
    expect(activeId).not.toBe(retiredId);

    const r = await rider(68);
    const ride = await bookAndAccept(r.auth, d.auth);

    expect((await rideRow(ride.id)).vehicleId).toBe(activeId);
    const assigned = (await eventsFor(ride.id)).find(
      (e) => e.kind === 'assigned',
    );
    expect(assigned?.vehicleId).toBe(activeId);
  });

  it('records an admin force-assign as admin, in seq order, with the driver and car (expected)', async () => {
    const d = await onlineDriver(6, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(61);
    const ride = await book(r.auth);

    await http
      .post(`/dispatch/rides/${ride.id}/assign`)
      .set('authorization', admin.auth)
      .send({ driverId: d.id })
      .expect(201);

    const events = await eventsFor(ride.id);
    expect(events.map(shape)).toEqual([
      'created:->requested:rider',
      'status:requested>offered:admin',
      'status:offered>accepted:admin',
      'assigned:->accepted:admin',
    ]);
    expect(events.slice(1).every((e) => e.actorId === admin.id)).toBe(true);
    expect(events[3]).toMatchObject({
      driverId: d.id,
      vehicleId: await vehicleIdOf(d.id),
    });
  });

  it('releases with the OUTGOING driver and car on reassign (expected)', async () => {
    const first = await onlineDriver(7, near(CENTRE_PICKUP.location, 0.001, 0));
    const second = await onlineDriver(
      8,
      near(CENTRE_PICKUP.location, 0.002, 0),
    );
    const r = await rider(62);
    const ride = await bookAndAccept(r.auth, first.auth);
    const outgoingVehicle = await vehicleIdOf(first.id);
    const before = (await eventsFor(ride.id)).length;

    await http
      .post(`/dispatch/rides/${ride.id}/reassign`)
      .set('authorization', dina.auth)
      .send({ driverId: second.id })
      .expect(201);

    const added = (await eventsFor(ride.id)).slice(before);
    expect(added.map(shape)).toEqual([
      'status:accepted>requested:dispatcher',
      'released:->requested:dispatcher',
      'status:requested>offered:dispatcher',
      'status:offered>accepted:dispatcher',
      'assigned:->accepted:dispatcher',
    ]);
    expect(added[1]).toMatchObject({
      driverId: first.id,
      vehicleId: outgoingVehicle,
    });
    expect(added[4]).toMatchObject({
      driverId: second.id,
      vehicleId: await vehicleIdOf(second.id),
    });
  });

  it('releases a ride with no stamped car without a check violation (edge)', async () => {
    const first = await onlineDriver(9, near(CENTRE_PICKUP.location, 0.001, 0));
    const second = await onlineDriver(
      10,
      near(CENTRE_PICKUP.location, 0.002, 0),
    );
    const r = await rider(63);
    const ride = await bookAndAccept(r.auth, first.auth);
    // A ride accepted before #86 stamped the car.
    await ctx.db
      .update(rides)
      .set({ vehicleId: null })
      .where(eq(rides.id, ride.id));

    await http
      .post(`/dispatch/rides/${ride.id}/reassign`)
      .set('authorization', dina.auth)
      .send({ driverId: second.id })
      .expect(201);

    const released = (await eventsFor(ride.id)).find(
      (e) => e.kind === 'released',
    );
    expect(released).toMatchObject({ driverId: first.id, vehicleId: null });
  });

  it('stores a dispatcher cancel reason on the event (expected)', async () => {
    const r = await rider(64);
    const ride = await book(r.auth);

    await http
      .post(`/rides/${ride.id}/cancel`)
      .set('authorization', dina.auth)
      .send({ reasonCode: 'dispatcher_rider_request' })
      .expect(201);

    const last = (await eventsFor(ride.id)).at(-1)!;
    expect(last).toMatchObject({
      kind: 'status',
      toStatus: 'cancelled_by_dispatcher',
      actorKind: 'dispatcher',
      actorId: dina.id,
      reasonCode: 'dispatcher_rider_request',
    });
  });

  it('refuses a dispatcher cancel with no reason and writes nothing (failure)', async () => {
    const r = await rider(65);
    const ride = await book(r.auth);
    const before = (await eventsFor(ride.id)).length;

    const res = await http
      .post(`/rides/${ride.id}/cancel`)
      .set('authorization', dina.auth)
      .send({});

    expect(res.status).toBe(422);
    expect((res.body as { message: string }).message).toBe(
      'cancel_reason_required',
    );
    expect((await rideRow(ride.id)).status).toBe('requested');
    expect(await eventsFor(ride.id)).toHaveLength(before);
  });

  it('refuses a rider sending a dispatcher reason code (failure)', async () => {
    const r = await rider(66);
    const ride = await book(r.auth);
    const before = (await eventsFor(ride.id)).length;

    const res = await http
      .post(`/rides/${ride.id}/cancel`)
      .set('authorization', r.auth)
      .send({ reasonCode: 'dispatcher_other', reasonText: 'not mine to say' });

    expect(res.status).toBe(422);
    expect((res.body as { message: string }).message).toBe(
      'cancel_reason_not_allowed',
    );
    expect((await rideRow(ride.id)).status).toBe('requested');
    expect(await eventsFor(ride.id)).toHaveLength(before);
  });

  it('refuses an "other" reason with no text as a validation error (failure)', async () => {
    const r = await rider(67);
    const ride = await book(r.auth);
    const before = (await eventsFor(ride.id)).length;

    const res = await http
      .post(`/rides/${ride.id}/cancel`)
      .set('authorization', dina.auth)
      .send({ reasonCode: 'dispatcher_other' });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toBe('validation_failed');
    expect((await rideRow(ride.id)).status).toBe('requested');
    expect(await eventsFor(ride.id)).toHaveLength(before);
  });
});
