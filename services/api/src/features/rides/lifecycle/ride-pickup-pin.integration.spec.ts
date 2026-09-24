import { drivers, rideOffers, rides } from '@taxi/db';
import {
  authSessionSchema,
  formatMessage,
  IDEMPOTENCY_KEY_HEADER,
  rideCreatedSchema,
  riderRideSchema,
  RT,
  type LatLng,
  type Ride,
  type RideStatusEvent,
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
} from '../../../../test/harness';
import { APP_ENV, type Env } from '../../../common/config/env.schema';
import { AuthTokenService } from '../../auth';
import { DispatchService } from '../../dispatch';

/**
 * The pickup PIN (#258) end to end: mint, the rider-only read, the start gate,
 * the lockout under forced concurrency, and the phone rider's arrival SMS.
 *
 * `+371320` is this file's E.164 range — see phoneFor() and the registry in
 * `ride-lifecycle.integration.spec.ts`. `users.phone` is unique across a run
 * that never resets the database, so a collision reuses another file's user.
 */
const p = (n: number) => phoneFor('+371320', n);

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

/** A 4-digit PIN guaranteed to differ from `pin`. */
const wrongPin = (pin: string) =>
  String((Number(pin) + 1) % 10_000).padStart(4, '0');

describe('pickup PIN (integration, #258)', () => {
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

  // `PK`: plates are unique across the shared test DB, and every other spec
  // file owns its own prefix (`PN` is driver-presence's).
  let plateSeq = 0;
  const nextPlate = () => `PK${String(++plateSeq).padStart(4, '0')}`;

  async function onlineDriver(n: number) {
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

    await ctx.locations.markOnline(cityId, id, Date.now());
    await ctx.locations.record(cityId, id, NEAR_PICKUP, Date.now());
    usedDrivers.push(id);
    return { id, auth, plate };
  }

  async function rider(n: number) {
    const session = await signIn(p(n), 'rider');
    return {
      id: session.user.id,
      auth: `Bearer ${session.accessToken}`,
      token: session.accessToken,
      phone: p(n),
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

  async function book(riderAuth: string, options: { pickupPin?: boolean }) {
    const res = await http
      .post('/rides')
      .set('authorization', riderAuth)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .send({
        pickup: CENTRE_PICKUP,
        destination: DESTINATION,
        paymentMethod: 'cash',
        options,
      })
      .expect(201);
    const { ride } = rideCreatedSchema.parse(res.body);
    createdRides.push(ride.id);
    return ride;
  }

  /** `POST /dispatch/bookings` for a caller; returns the RAW response body too. */
  async function bookByPhone(
    dispatcherAuth: string,
    callerPhone: string,
    options: { pickupPin?: boolean },
  ) {
    const res = await http
      .post('/dispatch/bookings')
      .set('authorization', dispatcherAuth)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .send({
        callerPhone,
        pickup: CENTRE_PICKUP,
        destination: DESTINATION,
        paymentMethod: 'cash',
        options,
      })
      .expect(201);
    const { ride } = rideCreatedSchema.parse(res.body);
    createdRides.push(ride.id);
    return { ride, body: res.body as { ride: Record<string, unknown> } };
  }

  /** Dispatches THIS ride only (never the sweeper — see the lifecycle spec). */
  async function accept(ride: Ride, driverAuth: string) {
    await dispatch.offerNext({
      id: ride.id,
      orderId: ride.orderId,
      riderId: ride.riderId,
      geozoneId: ride.geozoneId,
      request: ride.request,
      createdAt: ride.createdAt,
    });
    const [offer] = await ctx.db
      .select()
      .from(rideOffers)
      .where(
        and(eq(rideOffers.rideId, ride.id), eq(rideOffers.status, 'pending')),
      );
    await http
      .post(`/dispatch/offers/${offer!.id}/accept`)
      .set('authorization', driverAuth)
      .expect(201);
  }

  async function toArrived(rideId: string, driverAuth: string) {
    for (const step of ['arriving', 'arrived'] as const) {
      await http
        .post(`/rides/${rideId}/${step}`)
        .set('authorization', driverAuth)
        .expect(201);
    }
  }

  const start = (rideId: string, driverAuth: string, pin?: string) => {
    const req = http
      .post(`/rides/${rideId}/start`)
      .set('authorization', driverAuth);
    return pin === undefined ? req : req.send({ pin });
  };

  /** The rider's own read: the ONLY response that carries the PIN. */
  async function riderRead(rideId: string, riderAuth: string) {
    const res = await http
      .get(`/rides/${rideId}`)
      .set('authorization', riderAuth)
      .expect(200);
    return riderRideSchema.parse(res.body);
  }

  const rideRow = async (rideId: string) =>
    (await ctx.db.select().from(rides).where(eq(rides.id, rideId)))[0]!;

  function waitForEvent<T extends { rideId: string }>(
    socket: Socket,
    event: string,
    rideId: string,
    match: (payload: T) => boolean,
    timeoutMs = 3_000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event, onEvent);
        reject(new Error(`timed out waiting for ${event} on ride ${rideId}`));
      }, timeoutMs);
      function onEvent(payload: T) {
        if (payload.rideId !== rideId || !match(payload)) return;
        clearTimeout(timer);
        socket.off(event, onEvent);
        resolve(payload);
      }
      socket.on(event, onEvent);
    });
  }

  /** The hooks are fire-and-forget: the transition resolves before the SMS lands. */
  async function waitForSms(
    phone: string,
    match: (body: string) => boolean,
    timeoutMs = 3_000,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = ctx.sms.messagesFor(phone).find(match);
      if (hit !== undefined) return hit;
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for an SMS to ${phone}; saw ${JSON.stringify(ctx.sms.messagesFor(phone))}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /**
   * Every string value anywhere in a JSON body, plus every non-boolean value
   * under a `pickupPin` key (`request.options.pickupPin` is the legitimate
   * boolean opt-in flag). A raw `JSON.stringify(body).includes(pin)` would
   * false-positive: a PIN such as `2026` is a substring of every timestamp.
   */
  function flatten(
    value: unknown,
    strings: string[] = [],
    pinValues: unknown[] = [],
  ) {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value))
      value.forEach((v) => flatten(v, strings, pinValues));
    else if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k === 'pickupPin' && typeof v !== 'boolean') pinValues.push(v);
        flatten(v, strings, pinValues);
      }
    }
    return { strings, pinValues };
  }

  function expectNoPin(body: unknown, pin: string) {
    const { strings, pinValues } = flatten(body);
    expect(pinValues).toEqual([]);
    expect(
      strings.filter((s) => s === pin || s.includes(`PIN: ${pin}`)),
    ).toEqual([]);
  }

  /**
   * (expected) The named socket test, in the APP's order: book first, then
   * connect, then `GET` (which joins the room), then the driver's steps.
   */
  it('rider hears in_progress after the driver enters the PIN: book → connect → GET → accept → arriving → arrived → start', async () => {
    const d = await onlineDriver(1);
    const r = await rider(50);

    const ride = await book(r.auth, { pickupPin: true });
    const sock = await connectClient(port, r.token);
    const { pickupPin } = await riderRead(ride.id, r.auth);
    expect(pickupPin).toMatch(/^\d{4}$/);

    await accept(ride, d.auth);
    await toArrived(ride.id, d.auth);

    const heard = waitForEvent<RideStatusEvent>(
      sock,
      RT.rideStatus,
      ride.id,
      (e) => e.status === 'in_progress',
    );
    await start(ride.id, d.auth, pickupPin!).expect(201);
    expect((await heard).previousStatus).toBe('arrived');

    // #135 unchanged: an app booking gets no arrival SMS, PIN or not.
    expect(
      ctx.sms.messagesFor(r.phone).filter((m) => m.includes('ir klāt')),
    ).toEqual([]);
  });

  /** (failure-shaped) E8 — the PIN reaches no surface but the rider's read. */
  it('keeps the PIN off the driver read, complete, settle, the dispatcher booking and tracking', async () => {
    const d = await onlineDriver(2);
    const r = await rider(51);
    const dina = await dispatcher(52);

    const ride = await book(r.auth, { pickupPin: true });
    const { pickupPin } = await riderRead(ride.id, r.auth);
    await accept(ride, d.auth);

    const driverRead = await http
      .get(`/rides/${ride.id}`)
      .set('authorization', d.auth)
      .expect(200);
    expect(driverRead.body).not.toHaveProperty('pickupPin');
    expectNoPin(driverRead.body, pickupPin!);

    const tracked = await http.get(`/track/${ride.trackingToken!}`).expect(200);
    expectNoPin(tracked.body, pickupPin!);

    await toArrived(ride.id, d.auth);
    await start(ride.id, d.auth, pickupPin!).expect(201);

    const completed = await http
      .post(`/rides/${ride.id}/complete`)
      .set('authorization', d.auth)
      .expect(201);
    expect((completed.body as { ride: object }).ride).not.toHaveProperty(
      'pickupPin',
    );
    expectNoPin(completed.body, pickupPin!);

    const settled = await http
      .post(`/rides/${ride.id}/settle`)
      .set('authorization', d.auth)
      .expect(201);
    expect((settled.body as { ride: object }).ride).not.toHaveProperty(
      'pickupPin',
    );
    expectNoPin(settled.body, pickupPin!);

    const phone = await bookByPhone(dina.auth, p(53), { pickupPin: true });
    const phonePin = (await rideRow(phone.ride.id)).pickupPin;
    expect(phonePin).toMatch(/^\d{4}$/);
    expect(phone.body.ride).not.toHaveProperty('pickupPin');
    expectNoPin(phone.body, phonePin!);
  });

  it('refuses a wrong PIN with 422, counts it, and leaves the ride arrived (failure)', async () => {
    const d = await onlineDriver(3);
    const r = await rider(54);
    const ride = await book(r.auth, { pickupPin: true });
    const { pickupPin } = await riderRead(ride.id, r.auth);
    await accept(ride, d.auth);
    await toArrived(ride.id, d.auth);

    const res = await start(ride.id, d.auth, wrongPin(pickupPin!)).expect(422);

    expect(res.body).toMatchObject({ message: 'pickup_pin_incorrect' });
    const row = await rideRow(ride.id);
    expect(row.status).toBe('arrived');
    expect(row.pickupPinFailures).toBe(1);
  });

  it('refuses a bodiless start on a pinned ride with 422 and spends no attempt (failure)', async () => {
    const d = await onlineDriver(4);
    const r = await rider(55);
    const ride = await book(r.auth, { pickupPin: true });
    await accept(ride, d.auth);
    await toArrived(ride.id, d.auth);

    const res = await start(ride.id, d.auth).expect(422);

    expect(res.body).toMatchObject({ message: 'pickup_pin_required' });
    expect((await rideRow(ride.id)).pickupPinFailures).toBe(0);
  });

  it('locks after five wrong PINs, refuses the right one, and the rider can still cancel (edge)', async () => {
    const d = await onlineDriver(5);
    const r = await rider(56);
    const ride = await book(r.auth, { pickupPin: true });
    const { pickupPin } = await riderRead(ride.id, r.auth);
    await accept(ride, d.auth);
    await toArrived(ride.id, d.auth);

    for (let i = 0; i < 5; i++) {
      const res = await start(ride.id, d.auth, wrongPin(pickupPin!)).expect(
        422,
      );
      expect(res.body).toMatchObject({ message: 'pickup_pin_incorrect' });
    }
    const locked = await start(ride.id, d.auth, pickupPin!).expect(409);
    expect(locked.body).toMatchObject({ message: 'pickup_pin_locked' });

    const row = await rideRow(ride.id);
    expect(row.status).toBe('arrived');
    expect(row.pickupPinFailures).toBe(5);

    await http
      .post(`/rides/${ride.id}/cancel`)
      .set('authorization', r.auth)
      .send({})
      .expect(201);
    expect((await rideRow(ride.id)).status).toBe('cancelled_by_rider');
  });

  /**
   * (edge) E4 — the row lock's proof, deterministic by construction.
   *
   * Parallel requests are not guaranteed to overlap; run back to back, the
   * lock-less version also counts 5 and the test proves nothing. So the test
   * holds the ride row itself, fires 8 wrong starts, and waits until all 8 are
   * PROVEN blocked on that row in `pg_stat_activity` before letting go:
   * - with `FOR UPDATE`, each waits on its own lock read, and the eight then
   *   run one at a time — `derived`: the first five read failures 0–4 and each
   *   increments (422), the last three read 5 (409);
   * - without it, each has already read `failures = 0` and waits on its
   *   increment, so all eight answer 422 and the column reaches 8.
   *
   * Why 8: the pool is 10 (pg-pool's default; `createDb` passes no `max`). The
   * holder takes 1 and each blocked start holds 1 inside its transaction, so
   * 1 + 8 = 9, leaving 1 for the poll.
   */
  it('counts exactly five of eight wrong PINs forced to overlap (edge — the row lock)', async () => {
    const d = await onlineDriver(6);
    const r = await rider(57);
    const ride = await book(r.auth, { pickupPin: true });
    const { pickupPin } = await riderRead(ride.id, r.auth);
    await accept(ride, d.auth);
    await toArrived(ride.id, d.auth);

    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const isHeld = new Promise<void>((resolve) => (held = resolve));
    const holder = ctx.db.transaction(async (tx) => {
      await tx
        .select({ id: rides.id })
        .from(rides)
        .where(eq(rides.id, ride.id))
        .for('update');
      held();
      await released;
    });
    await isHeld;

    const ATTEMPTS = 8;
    // `.then` is what sends a supertest request; each is in flight from here.
    const attempts = Array.from({ length: ATTEMPTS }, () =>
      start(ride.id, d.auth, wrongPin(pickupPin!)).then((res) => res),
    );

    const deadline = Date.now() + 3_000;
    let waiting = 0;
    while (waiting < ATTEMPTS) {
      const result = await ctx.db.execute<{ n: number }>(
        // Only this test's statements: another session's waiter on the shared
        // test DB would otherwise fill the count early (PR #277 L3). Both the
        // lock read and the increment name `pickup_pin_*` columns.
        sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database() AND query ILIKE '%pickup_pin%'`,
      );
      waiting = result.rows[0]!.n;
      if (waiting >= ATTEMPTS) break;
      if (Date.now() > deadline) {
        release();
        await holder;
        await Promise.all(attempts);
        throw new Error(
          `only ${waiting} of ${ATTEMPTS} starts reached the row lock in 3 s`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    release();
    await holder;
    const results = await Promise.all(attempts);

    const messages = results.map(
      (res) => `${res.status} ${(res.body as { message: string }).message}`,
    );
    expect(
      messages.filter((m) => m === '422 pickup_pin_incorrect'),
    ).toHaveLength(5);
    expect(messages.filter((m) => m === '409 pickup_pin_locked')).toHaveLength(
      3,
    );
    expect((await rideRow(ride.id)).pickupPinFailures).toBe(5);

    await start(ride.id, d.auth, pickupPin!).expect(409);
  });

  /**
   * PR #277 L1: the rider cancels between the start's status guard and its
   * row lock. The holder stands in for that cancel: it holds the row, the
   * wrong-PIN start blocks on `lockPickupPin`, and the holder commits a
   * cancelled status (a direct write — only the commit order matters here).
   * The start must read that status under the lock and answer the lost race,
   * not charge a failure to a cancelled ride.
   */
  it('a ride cancelled while the start waits on the lock is a lost race, not a wrong PIN (edge — PR #277 L1)', async () => {
    const d = await onlineDriver(10);
    const r = await rider(70);
    const ride = await book(r.auth, { pickupPin: true });
    const { pickupPin } = await riderRead(ride.id, r.auth);
    await accept(ride, d.auth);
    await toArrived(ride.id, d.auth);

    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const isHeld = new Promise<void>((resolve) => (held = resolve));
    const holder = ctx.db.transaction(async (tx) => {
      await tx
        .select({ id: rides.id })
        .from(rides)
        .where(eq(rides.id, ride.id))
        .for('update');
      held();
      await released;
      await tx
        .update(rides)
        .set({ status: 'cancelled_by_rider' })
        .where(eq(rides.id, ride.id));
    });
    await isHeld;

    const attempt = start(ride.id, d.auth, wrongPin(pickupPin!)).then(
      (res) => res,
    );
    const deadline = Date.now() + 3_000;
    for (;;) {
      const result = await ctx.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database() AND query ILIKE '%pickup_pin%'`,
      );
      if (result.rows[0]!.n >= 1) break;
      if (Date.now() > deadline) {
        release();
        await holder;
        await attempt;
        throw new Error('the start never reached the row lock in 3 s');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    release();
    await holder;
    const res = await attempt;

    expect(`${res.status} ${(res.body as { message: string }).message}`).toBe(
      '409 ride_transition_conflict',
    );
    expect((await rideRow(ride.id)).pickupPinFailures).toBe(0);
  });

  it('starts an un-pinned ride with no body, and its rider read says null (expected — regression)', async () => {
    const d = await onlineDriver(7);
    const r = await rider(58);
    const ride = await book(r.auth, {});

    expect((await riderRead(ride.id, r.auth)).pickupPin).toBeNull();
    expect((await rideRow(ride.id)).pickupPin).toBeNull();

    await accept(ride, d.auth);
    await toArrived(ride.id, d.auth);
    await start(ride.id, d.auth).expect(201);
    expect((await rideRow(ride.id)).status).toBe('in_progress');
  });

  it('texts a phone rider their PIN at arrival, and the plain text when they have none (expected + edge)', async () => {
    const dina = await dispatcher(59);

    const d1 = await onlineDriver(8);
    const pinned = await bookByPhone(dina.auth, p(60), { pickupPin: true });
    const pin = (await rideRow(pinned.ride.id)).pickupPin!;
    await accept(pinned.ride, d1.auth);
    await toArrived(pinned.ride.id, d1.auth);

    const withPin = await waitForSms(p(60), (m) => m.includes('ir klāt'));
    expect(withPin).toBe(
      formatMessage('lv', 'sms.driver_arrived_pin', { plate: d1.plate, pin }),
    );

    const d2 = await onlineDriver(9);
    const plain = await bookByPhone(dina.auth, p(61), {});
    await accept(plain.ride, d2.auth);
    await toArrived(plain.ride.id, d2.auth);

    const withoutPin = await waitForSms(p(61), (m) => m.includes('ir klāt'));
    expect(withoutPin).toBe(
      formatMessage('lv', 'sms.driver_arrived', { plate: d2.plate }),
    );
    expect(withoutPin).not.toContain('PIN');
  });
});
