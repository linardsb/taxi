import { Logger } from '@nestjs/common';
import { drivers, rideOffers, rides, users } from '@taxi/db';
import {
  authSessionSchema,
  IDEMPOTENCY_KEY_HEADER,
  rideCreatedSchema,
  rideRequestSchema,
  trackingViewSchema,
  type LatLng,
  type RideRequestBody,
} from '@taxi/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  createTestApp,
  haversineMeters,
  insertUser,
  phoneFor,
  type TestApp,
} from '../../../../test/harness';
import { APP_ENV, type Env } from '../../../common/config/env.schema';
import { AuthTokenService } from '../../auth';
import { DispatchService } from '../../dispatch';
import { RidesService } from '../../rides';
import { TRACKING_ETA_SPEED_METERS_PER_MINUTE } from '../notifications.policy';

/**
 * `+371280` is this spec file's E.164 range — registered in the range comment
 * at `ride-lifecycle.integration.spec.ts` (the registry), where `+371210` …
 * `+371270` are already claimed. NOT `+371270`, whatever older docs say:
 * payments.integration.spec.ts already holds it (the registry had drifted).
 */
const p = (n: number) => phoneFor('+371280', n);

/** Inside centre only — the reasoning at `ride-lifecycle.integration.spec.ts`. */
const CENTRE_PICKUP = {
  location: { lat: 56.96, lng: 24.085 },
  address: 'Hanzas iela, Rīga',
};
const DESTINATION = {
  location: { lat: 56.9712, lng: 24.18 },
  address: 'Teika, Rīga',
};

const BODY: RideRequestBody = {
  pickup: CENTRE_PICKUP,
  destination: DESTINATION,
  paymentMethod: 'cash',
} as RideRequestBody;

const PHOTO_URL = 'https://cdn.example.test/drivers/janis.jpg';

describe('tracking + ride SMS (integration)', () => {
  let ctx: TestApp;
  let http: ReturnType<typeof request>;
  let ridesService: RidesService;
  let dispatch: DispatchService;
  let tokens: AuthTokenService;
  let cityId: string;

  const createdRides: string[] = [];
  const usedDrivers: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
    ridesService = ctx.app.get(RidesService);
    dispatch = ctx.app.get(DispatchService);
    tokens = ctx.app.get(AuthTokenService);
    cityId = ctx.app.get<Env>(APP_ENV).DEFAULT_CITY_ID;
  });

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
  const nextPlate = () => `TR${String(++plateSeq).padStart(4, '0')}`;

  /** A named driver with a photo, a car, presence and a live position. */
  async function onlineDriver(n: number, location: LatLng) {
    const session = await signIn(p(n), 'driver');
    const auth = `Bearer ${session.accessToken}`;
    const id = session.user.id;
    const plate = nextPlate();

    await http
      .post('/drivers/me/vehicles')
      .set('authorization', auth)
      .send({
        plate,
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

    // Onboarding (#20) owns these writes in production; the spec fills them in
    // so the SMS and the page have a name and a photo to show.
    await ctx.db
      .update(users)
      .set({ displayName: 'Jānis Bērziņš' })
      .where(eq(users.id, id));
    await ctx.db
      .update(drivers)
      .set({ photoUrl: PHOTO_URL })
      .where(eq(drivers.userId, id));

    await ctx.locations.markOnline(cityId, id);
    await ctx.locations.record(cityId, id, location, Date.now());
    usedDrivers.push(id);
    return { id, auth, plate };
  }

  async function rider(n: number) {
    const session = await signIn(p(n), 'rider');
    return { id: session.user.id, auth: `Bearer ${session.accessToken}` };
  }

  /** Phone bookings have no wire path until #19 — the service layer IS the entry. */
  async function bookByPhone(riderId: string, body: RideRequestBody = BODY) {
    const { ride } = await ridesService.request(
      riderId,
      randomUUID(),
      body,
      'phone',
    );
    createdRides.push(ride.id);
    return ride;
  }

  async function acceptBy(rideId: string, driverAuth: string) {
    const [row] = await ctx.db.select().from(rides).where(eq(rides.id, rideId));
    await dispatch.offerNext({
      id: row!.id,
      orderId: row!.orderId,
      riderId: row!.riderId,
      geozoneId: row!.geozoneId,
      request: rideRequestSchema.parse(row!.request),
      createdAt: row!.createdAt,
    });
    const [offer] = await ctx.db
      .select()
      .from(rideOffers)
      .where(
        and(eq(rideOffers.rideId, rideId), eq(rideOffers.status, 'pending')),
      );
    await http
      .post(`/dispatch/offers/${offer!.id}/accept`)
      .set('authorization', driverAuth)
      .expect(201);
  }

  /**
   * A booked, accepted ride whose driver starts parked beside the pickup —
   * where dispatch needs them to be — ready for the test to move.
   */
  async function acceptedRide(driverN: number, riderN: number) {
    const d = await onlineDriver(driverN, {
      lat: CENTRE_PICKUP.location.lat + 0.001,
      lng: CENTRE_PICKUP.location.lng,
    });
    const r = await rider(riderN);
    const ride = await bookByPhone(r.id);
    await acceptBy(ride.id, d.auth);
    return { d, rideId: ride.id, token: ride.trackingToken! };
  }

  const smsTo = (phone: string) => ctx.sms.messagesFor(phone);

  /** The hooks are fire-and-forget: the HTTP/service call resolves before the SMS lands. */
  async function waitForSms(
    phone: string,
    expected: number,
    timeoutMs = 3_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (smsTo(phone).length < expected) {
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for ${expected} SMS to ${phone}, saw ${smsTo(phone).length}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /**
   * `record()` answers false for a driver the store believes is offline and
   * silently keeps the OLD position — which shows up three assertions later as
   * an ETA nobody can explain. Assert the write landed.
   */
  async function moveDriver(driverId: string, location: LatLng) {
    const written = await ctx.locations.record(
      cityId,
      driverId,
      location,
      Date.now(),
    );
    expect(written).toBe(true);
  }

  /**
   * What the maps seam answers in dev/test: `StubMapsProvider`'s documented
   * maths — straight line × 1.35 detour at 40 km/h, rounded at each step —
   * then the policy's never-zero ceil. Recomputed here so the expectation is a
   * number this file derived, not one the service handed back.
   */
  const routedEtaMinutes = (from: LatLng, to: LatLng): number => {
    const distanceMeters = Math.round(haversineMeters(from, to) * 1.35);
    const durationSeconds = Math.round((distanceMeters / 1000 / 40) * 3600);
    return Math.max(1, Math.ceil(durationSeconds / 60));
  };

  /** The v1 straight-line policy, which survives as the maps-outage fallback. */
  const fallbackEtaMinutes = (from: LatLng, to: LatLng): number =>
    Math.max(
      1,
      Math.ceil(
        haversineMeters(from, to) / TRACKING_ETA_SPEED_METERS_PER_MINUTE,
      ),
    );

  const track = (token: string) => http.get(`/track/${token}`);

  const view = async (token: string) => {
    const res = await track(token).expect(200);
    return trackingViewSchema.parse(res.body);
  };

  it('phone booking: 3 SMS with the link, page follows the full lifecycle (expected — AC #1, #2, budget)', async () => {
    const d = await onlineDriver(1, {
      lat: CENTRE_PICKUP.location.lat + 0.001,
      lng: CENTRE_PICKUP.location.lng,
    });
    const r = await rider(50);

    const ride = await bookByPhone(r.id);
    const token = ride.trackingToken!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    // AC #1: the link travels IN the confirmation, sent inside the creation
    // request — delay ≈ 0, comfortably under the ≤30 s ledger row.
    await waitForSms(p(50), 1);
    expect(smsTo(p(50))[0]).toContain(`/t/${token}`);

    // Before any driver: searching, and nothing to show but the dispatch phone.
    const searching = await view(token);
    expect(searching.state).toBe('searching');
    expect(searching.driverName).toBeNull();
    expect(searching.vehiclePlate).toBeNull();
    expect(searching.position).toBeNull();
    expect(searching.dispatchPhone).toMatch(/^\+/);

    await acceptBy(ride.id, d.auth);

    // The phone-channel follow-up: driver, plate, ETA, link (AC #1).
    await waitForSms(p(50), 2);
    const assigned = smsTo(p(50))[1]!;
    expect(assigned).toContain('Jānis');
    expect(assigned).toContain(d.plate);
    expect(assigned).toMatch(/~\d+ min/);
    expect(assigned).toContain(`/t/${token}`);

    // AC #2: plate + driver + live position while active.
    const active = await view(token);
    expect(active.state).toBe('assigned');
    expect(active.driverName).toBe('Jānis');
    expect(active.driverPhotoUrl).toBe(PHOTO_URL);
    expect(active.vehiclePlate).toBe(d.plate);
    expect(active.position).not.toBeNull();
    expect(active.position!.lat).toBeCloseTo(
      CENTRE_PICKUP.location.lat + 0.001,
      3,
    );
    expect(active.etaMinutes).toBeGreaterThanOrEqual(1);

    for (const step of ['arriving', 'arrived'] as const) {
      await http
        .post(`/rides/${ride.id}/${step}`)
        .set('authorization', d.auth)
        .expect(201);
      expect((await view(token)).state).toBe(step);
    }

    // The arrival SMS goes to every channel (AC #1).
    await waitForSms(p(50), 3);
    expect(smsTo(p(50))[2]).toContain(d.plate);

    await http
      .post(`/rides/${ride.id}/start`)
      .set('authorization', d.auth)
      .expect(201);
    const inProgress = await view(token);
    expect(inProgress.state).toBe('in_progress');

    await http
      .post(`/rides/${ride.id}/complete`)
      .set('authorization', d.auth)
      .expect(201);
    const completed = await view(token);
    expect(completed.state).toBe('completed');
    // A completed ride's page is a receipt, not a surveillance feed.
    expect(completed.position).toBeNull();

    // The budget row: EXACTLY 3 SMS for a phone booking, none extra from the
    // arriving/in_progress/completed hops.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(smsTo(p(50))).toHaveLength(3);
  });

  it('app booking: 2 SMS, no link, no driver_assigned (edge — budget row)', async () => {
    const d = await onlineDriver(2, {
      lat: CENTRE_PICKUP.location.lat + 0.001,
      lng: CENTRE_PICKUP.location.lng,
    });
    const r = await rider(51);

    const res = await http
      .post('/rides')
      .set('authorization', r.auth)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .send(BODY)
      .expect(201);
    const { ride } = rideCreatedSchema.parse(res.body);
    createdRides.push(ride.id);

    await waitForSms(p(51), 1);
    expect(smsTo(p(51))[0]).not.toContain('/t/');

    await acceptBy(ride.id, d.auth);
    for (const step of ['arriving', 'arrived'] as const) {
      await http
        .post(`/rides/${ride.id}/${step}`)
        .set('authorization', d.auth)
        .expect(201);
    }

    // arrived SMS arrives; driver_assigned never does.
    await waitForSms(p(51), 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const bodies = smsTo(p(51));
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain(d.plate);
    expect(bodies[1]).not.toContain('/t/');

    // The app rider's ride is still trackable — #17's share-trip reuses this.
    expect((await view(ride.trackingToken!)).state).toBe('arrived');
  });

  it('terminal ride outliving the 24 h grace answers 410 (edge — AC #3)', async () => {
    const r = await rider(52);
    const ride = await bookByPhone(r.id);
    const token = ride.trackingToken!;

    // The 0003 trigger unconditionally stamps NEW.updated_at = now(), so a
    // plain backdate is silently overwritten — disable it around the write.
    // Safe: jest runs serially (maxWorkers 1), nothing else is writing rides.
    await ctx.db.execute(
      sql`ALTER TABLE rides DISABLE TRIGGER rides_set_updated_at`,
    );
    try {
      await ctx.db.execute(sql`
        UPDATE rides
        SET status = 'cancelled_by_system',
            updated_at = now() - interval '2 days'
        WHERE id = ${ride.id}
      `);
    } finally {
      await ctx.db.execute(
        sql`ALTER TABLE rides ENABLE TRIGGER rides_set_updated_at`,
      );
    }

    await track(token).expect(410);
  });

  it('a completed-but-never-settled ride expires too — page-terminal, not machine-terminal (edge — review L1)', async () => {
    const r = await rider(54);
    const ride = await bookByPhone(r.id);
    const token = ride.trackingToken!;

    // `completed` is NOT machine-terminal (`completed → settled` remains), so
    // an isTerminal() gate kept this link alive forever when the settle call
    // never came. Same trigger dance as the test above.
    await ctx.db.execute(
      sql`ALTER TABLE rides DISABLE TRIGGER rides_set_updated_at`,
    );
    try {
      await ctx.db.execute(sql`
        UPDATE rides
        SET status = 'completed',
            updated_at = now() - interval '2 days'
        WHERE id = ${ride.id}
      `);
    } finally {
      await ctx.db.execute(
        sql`ALTER TABLE rides ENABLE TRIGGER rides_set_updated_at`,
      );
    }

    await track(token).expect(410);
  });

  it('a FRESH terminal ride is still viewable — grace, not instant death (edge)', async () => {
    const r = await rider(53);
    const ride = await bookByPhone(r.id);

    await ctx.db
      .update(rides)
      .set({ status: 'cancelled_by_rider' })
      .where(eq(rides.id, ride.id));

    expect((await view(ride.trackingToken!)).state).toBe('cancelled');
  });

  it('unknown and malformed tokens both answer 404 (failure — AC #3)', async () => {
    // Valid shape, no ride: indistinguishable from malformed by design.
    await track('AAAAAAAAAAAAAAAAAAAAAA').expect(404);
    await track('not-a-token').expect(404);
    await track(randomUUID()).expect(404);
  });

  it('multi-vehicle driver: the stamped category-matched car is shown, not fleet[0] (expected — #86 AC #1, #2)', async () => {
    const d = await onlineDriver(3, {
      lat: CENTRE_PICKUP.location.lat + 0.001,
      lng: CENTRE_PICKUP.location.lng,
    });
    // A second car in ANOTHER category — the old read-time heuristic would
    // pick whichever fleet row matched at read time; the stamp freezes this one.
    const limoRes = await http
      .post('/drivers/me/vehicles')
      .set('authorization', d.auth)
      .send({
        plate: nextPlate(),
        make: 'Mercedes',
        model: 'S-Class',
        year: 2021,
        category: 'limo',
        passengerSeats: 4,
        hasChildSeat: false,
      })
      .expect(201);
    const limo = limoRes.body as { id: string; plate: string };

    const r = await rider(55);
    const ride = await bookByPhone(r.id, {
      ...BODY,
      category: 'limo',
    });
    const token = ride.trackingToken!;

    await acceptBy(ride.id, d.auth);

    // AC #1: the ride row records the category-matched car at assignment.
    const [row] = await ctx.db
      .select()
      .from(rides)
      .where(eq(rides.id, ride.id));
    expect(row!.vehicleId).toBe(limo.id);

    // AC #2: page and SMS read the stamp — the limo plate, not the standard one.
    const assigned = await view(token);
    expect(assigned.vehiclePlate).toBe(limo.plate);
    await waitForSms(p(55), 2);
    const sms = smsTo(p(55))[1]!;
    expect(sms).toContain(limo.plate);
    expect(sms).not.toContain(d.plate);
  });

  it('force-assigning a vehicle-less driver stamps NULL and blocks nothing (edge — #86 AC #1)', async () => {
    // A driver with a `drivers` row but NO vehicle: force-assign's
    // findMatchAttributes 404s without the row, so GET /drivers/me creates it.
    const session = await signIn(p(4), 'driver');
    const auth = `Bearer ${session.accessToken}`;
    const driverId = session.user.id;
    await http.get('/drivers/me').set('authorization', auth).expect(200);
    await ctx.db
      .update(users)
      .set({ displayName: 'Jānis Bērziņš' })
      .where(eq(users.id, driverId));
    usedDrivers.push(driverId);

    const dispatcher = await insertUser(ctx.db, {
      phone: p(95),
      role: 'dispatcher',
    });
    const dispatcherAuth = `Bearer ${(await tokens.issue({ id: dispatcher.id, role: 'dispatcher' })).accessToken}`;

    const r = await rider(56);
    const ride = await bookByPhone(r.id);

    await http
      .post(`/dispatch/rides/${ride.id}/assign`)
      .set('authorization', dispatcherAuth)
      .send({ driverId })
      .expect(201);

    const [row] = await ctx.db
      .select()
      .from(rides)
      .where(eq(rides.id, ride.id));
    expect(row!.vehicleId).toBeNull();

    const assigned = await view(ride.trackingToken!);
    expect(assigned.state).toBe('assigned');
    expect(assigned.driverName).toBe('Jānis');
    expect(assigned.vehiclePlate).toBeNull();
  });

  it('vehicle deleted after the ride: SET NULL, the page never 500s and never resurrects a plate (failure — #86 AC #3)', async () => {
    const d = await onlineDriver(5, {
      lat: CENTRE_PICKUP.location.lat + 0.001,
      lng: CENTRE_PICKUP.location.lng,
    });
    const r = await rider(57);
    const ride = await bookByPhone(r.id);
    const token = ride.trackingToken!;

    await acceptBy(ride.id, d.auth);
    const [stamped] = await ctx.db
      .select()
      .from(rides)
      .where(eq(rides.id, ride.id));
    expect(stamped!.vehicleId).not.toBeNull();

    for (const step of ['arriving', 'arrived', 'start', 'complete'] as const) {
      await http
        .post(`/rides/${ride.id}/${step}`)
        .set('authorization', d.auth)
        .expect(201);
    }

    // `complete` released the driver, so the `on_ride` guard passes — and the
    // FK must not turn a legitimate delete into a 500.
    await http
      .delete(`/drivers/me/vehicles/${stamped!.vehicleId}`)
      .set('authorization', d.auth)
      .expect(204);

    const [after] = await ctx.db
      .select()
      .from(rides)
      .where(eq(rides.id, ride.id));
    expect(after!.vehicleId).toBeNull(); // ON DELETE SET NULL fired

    // Within the terminal grace the receipt still renders — plate null, not
    // re-derived from the (now empty) fleet as the old heuristic would try.
    const receipt = await view(token);
    expect(receipt.state).toBe('completed');
    expect(receipt.vehiclePlate).toBeNull();
  });

  // #87 — the ETA below the map. One InMemoryKeyValueStore serves this whole
  // file, so every case that needs a cache MISS parks the driver in a grid
  // cell no earlier case has routed. `routeCalls` is only ever read as a
  // delta: each booking's pricing quote routes through the same counter.

  it('the ETA is routed through the maps seam, origin snapped to the ~100 m grid (expected — AC #1)', async () => {
    const { d, token } = await acceptedRide(6, 58);

    // ~5.6 km out, deliberately off a 3-decimal boundary so the snap is
    // visible — and far enough that the two formulas disagree. At the kerb
    // both answer "1 min" and the assertion would pass for the wrong reason.
    const far = {
      lat: CENTRE_PICKUP.location.lat + 0.0504,
      lng: CENTRE_PICKUP.location.lng + 0.0007,
    };
    await moveDriver(d.id, far);

    const routed = ctx.maps.routed.length;
    const page = await view(token);

    // Exactly one paid call, with the snapped origin and the untouched pickup.
    const origin = { lat: 57.01, lng: 24.086 }; // `far`, at 3 decimals
    expect(ctx.maps.routed).toHaveLength(routed + 1);
    expect(ctx.maps.routed.at(-1)!.from).toEqual(origin);
    expect(ctx.maps.routed.at(-1)!.to).toEqual(CENTRE_PICKUP.location);

    expect(page.etaMinutes).toBe(
      routedEtaMinutes(origin, CENTRE_PICKUP.location),
    );
    expect(page.etaMinutes).not.toBe(
      fallbackEtaMinutes(far, CENTRE_PICKUP.location),
    );
  });

  it('a sub-cell move is a cache hit, a cell crossing is one paid call (edge — AC #2, the budget guardrail)', async () => {
    const { d, token } = await acceptedRide(7, 59);

    const start = {
      lat: CENTRE_PICKUP.location.lat + 0.0601,
      lng: CENTRE_PICKUP.location.lng + 0.0007,
    };
    await moveDriver(d.id, start);
    await view(token); // warms this cell
    const calls = ctx.maps.routeCalls;

    // ~22 m — one poll's worth of driving, still inside the cell. THE headline
    // property: the page can be polled every 5 s for free.
    const nudged = { lat: start.lat + 0.0002, lng: start.lng };
    await moveDriver(d.id, nudged);
    const sameCell = await view(token);
    expect(ctx.maps.routeCalls).toBe(calls);
    // …and the map still shows the car where it actually is. Snapping is for
    // the cache key alone; a quantized `position` would fail at 4 decimals.
    expect(sameCell.position!.lat).toBeCloseTo(nudged.lat, 4);

    // ~111 m — over the boundary, and worth exactly one call.
    await moveDriver(d.id, { lat: nudged.lat + 0.001, lng: nudged.lng });
    await view(token);
    expect(ctx.maps.routeCalls).toBe(calls + 1);
  });

  it('a maps outage degrades to the straight-line estimate, page still 200 (failure — AC #3)', async () => {
    const { d, rideId, token } = await acceptedRide(8, 60);

    const far = {
      lat: CENTRE_PICKUP.location.lat + 0.0704,
      lng: CENTRE_PICKUP.location.lng + 0.0007,
    };
    await moveDriver(d.id, far);

    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const calls = ctx.maps.routeCalls;
    ctx.maps.failNext();

    const page = await view(token);

    // The armed failure went off at the SOURCE. A cache hit would have
    // absorbed it and left it armed for some unrelated case.
    expect(ctx.maps.routeCalls).toBe(calls + 1);
    expect(page.state).toBe('assigned');
    expect(page.position).not.toBeNull();
    expect(page.etaMinutes).toBe(
      fallbackEtaMinutes(far, CENTRE_PICKUP.location),
    );
    expect(page.etaMinutes).not.toBe(
      // `far` at 3 decimals — what the seam would have answered.
      routedEtaMinutes({ lat: 57.03, lng: 24.086 }, CENTRE_PICKUP.location),
    );

    // The whole key set, not `objectContaining`: what matters is that no
    // coordinate ever reaches a log line (logging-standard.md), and only
    // pinning every key can say that.
    //
    // #94 made this assertion STRONGER, not just different: dropping `message`
    // pins the ABSENCE of any free-text field, so a provider message that
    // embedded coordinates could not slip through a payload of this shape —
    // which a key-set assertion never could have caught while `message`
    // existed, because the coordinate would be INSIDE it. Provider-error
    // detail now lives on `geo.maps.route_failed`, as a closed-enum `reason`.
    const payload = warned.mock.calls
      .map(([first]) => first as unknown)
      .find(
        (arg): arg is Record<string, unknown> =>
          typeof arg === 'object' &&
          arg !== null &&
          'event' in arg &&
          arg.event === 'ride.notifications.track_eta_failed',
      );
    expect(payload).toBeDefined();
    expect(Object.keys(payload!).sort()).toEqual([
      'at',
      'driverId',
      'event',
      'rideId',
    ]);
    expect(payload).toMatchObject({ rideId, driverId: d.id });
    warned.mockRestore();

    // `failNext()` armed the negative cache, and its entry lives 60 s
    // (`MAPS_ETA_FAILURE_TTL_SECONDS`) in the ONE store this whole file
    // shares. Left behind, it hands whichever case is appended next a
    // negative-cached THROW instead of a source call — and a `routeCalls`
    // delta that fails for a reason looking nothing like the cause. Cleared
    // here rather than documented, so this case stops having to be last.
    //
    // 61 s, not more: it clears the failure entry without expiring route
    // caches an appended case might rely on (300 s for `eta`, 24 h for
    // `quote`) or the 120 s ride-idempotency reservations.
    ctx.kv.advance(61);

    // And proved, not assumed — this is what an appended case would see. The
    // corridor reaches the SOURCE again (the failure wrote no success entry to
    // hit), and the ETA is the routed one the assertion above ruled out.
    const recovered = await view(token);
    expect(ctx.maps.routeCalls).toBe(calls + 2);
    expect(recovered.etaMinutes).toBe(
      routedEtaMinutes({ lat: 57.03, lng: 24.086 }, CENTRE_PICKUP.location),
    );
  });
});
