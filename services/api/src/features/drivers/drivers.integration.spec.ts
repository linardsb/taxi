import { drivers, rides, vehicles } from '@taxi/db';
import {
  authSessionSchema,
  driverMeSchema,
  driverProfileSchema,
  vehicleSchema,
  type VehicleUpdate,
} from '@taxi/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp, phoneFor, type TestApp } from '../../../test/harness';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { DriversRepository } from './drivers.repository';
import { DriversService } from './drivers.service';
import { VehiclesRepository } from './vehicles.repository';

/** `+371220` is this spec file's E.164 range — see phoneFor(). */
const p = (n: number) => phoneFor('+371220', n);

const CAR = {
  plate: 'AB1234',
  make: 'Skoda',
  model: 'Octavia',
  year: 2019,
  passengerSeats: 4,
  hasChildSeat: true,
};

describe('drivers (integration)', () => {
  let ctx: TestApp;
  let http: ReturnType<typeof request>;
  let cityId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
    cityId = ctx.app.get<Env>(APP_ENV).DEFAULT_CITY_ID;
  });

  afterAll(async () => {
    await ctx.app.close(); // or the Drizzle pool keeps jest alive
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

  /** Signs a driver in and returns the pieces every case needs. */
  async function driver(n: number) {
    const session = await signIn(p(n));
    const auth = `Bearer ${session.accessToken}`;
    return {
      id: session.user.id,
      auth,
      row: async () =>
        (
          await ctx.db
            .select()
            .from(drivers)
            .where(eq(drivers.userId, session.user.id))
        )[0],
    };
  }

  /**
   * A fresh plate per car. `vehicles_plate_uix` (migration 0004) is unique
   * platform-wide, so the one shared fixture plate would 409 for the second
   * driver in this file — which is the constraint working, not a broken test.
   */
  let plateSeq = 0;
  const nextPlate = () => `TS${String(++plateSeq).padStart(4, '0')}`;

  const addCar = async (auth: string) => {
    const res = await http
      .post('/drivers/me/vehicles')
      .set('authorization', auth)
      .send({ ...CAR, plate: nextPlate() })
      .expect(201);
    return vehicleSchema.parse(res.body);
  };

  it('provisions the drivers row on first read and returns schema defaults (expected)', async () => {
    const d = await driver(1);
    expect(await d.row()).toBeUndefined();

    const res = await http
      .get('/drivers/me')
      .set('authorization', d.auth)
      .expect(200);

    const me = driverMeSchema.parse(res.body);
    expect(me.profile.userId).toBe(d.id);
    expect(me.profile.status).toBe('offline');
    expect(me.profile.spokenLanguages).toEqual(['lv']);
    expect(me.profile.balanceCents).toBe(0);
    expect(me.profile.commissionPctOverride).toBeNull();
    expect(me.vehicles).toEqual([]);
    expect(await d.row()).toBeDefined();
  });

  it('creates a vehicle and lists it back (expected)', async () => {
    const d = await driver(2);

    const created = await addCar(d.auth);
    expect(created.driverId).toBe(d.id);
    expect(created.hasChildSeat).toBe(true);
    expect(created.category).toBe('standard'); // the schema default applied

    const listed = await http
      .get('/drivers/me/vehicles')
      .set('authorization', d.auth)
      .expect(200);
    expect(vehicleSchema.array().parse(listed.body)).toEqual([created]);
  });

  it('reads /drivers/me without an upsert once the row exists (edge — L5)', async () => {
    const d = await driver(30);
    await http.get('/drivers/me').set('authorization', d.auth).expect(200);

    // `findOrCreate` is `ON CONFLICT DO UPDATE SET user_id = user_id` — still
    // an UPDATE, so a dead tuple per call on the driver app's bootstrap. Once
    // the row is there, this route must only read.
    const spy = jest.spyOn(ctx.app.get(DriversRepository), 'findOrCreate');
    try {
      const res = await http
        .get('/drivers/me')
        .set('authorization', d.auth)
        .expect(200);

      expect(driverMeSchema.parse(res.body).profile.userId).toBe(d.id);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses a plate another driver already registered (failure — it's the kerbside identity)", async () => {
    const owner = await driver(23);
    const impostor = await driver(24);
    const car = await addCar(owner.auth);

    await http
      .post('/drivers/me/vehicles')
      .set('authorization', impostor.auth)
      .send({ ...CAR, plate: car.plate })
      .expect(409); // not a raw 23505 surfacing as a 500

    // The impostor gets no car, and the owner's is untouched.
    const listed = await http
      .get('/drivers/me/vehicles')
      .set('authorization', impostor.auth)
      .expect(200);
    expect(listed.body).toEqual([]);
  });

  it('refuses a case-variant of a taken plate (edge — one lowercase letter must not defeat it)', async () => {
    const owner = await driver(25);
    const impostor = await driver(26);
    const car = await addCar(owner.auth);

    // The index is on `upper(plate)` precisely for this: a plain unique index
    // on the raw column leaves the constraint in place and the guarantee gone.
    await http
      .post('/drivers/me/vehicles')
      .set('authorization', impostor.auth)
      .send({ ...CAR, plate: car.plate.toLowerCase() })
      .expect(409);
  });

  it('refuses a PATCH onto a taken plate, not just a POST (failure)', async () => {
    const owner = await driver(27);
    const other = await driver(28);
    const taken = await addCar(owner.auth);
    const mine = await addCar(other.auth);

    await http
      .patch(`/drivers/me/vehicles/${mine.id}`)
      .set('authorization', other.auth)
      .send({ plate: taken.plate })
      .expect(409);

    // The update rolled back whole — no partial write.
    const [row] = await ctx.db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, mine.id));
    expect(row!.plate).toBe(mine.plate);
  });

  it('lets a driver re-register a plate they just deleted (edge — uniqueness is not a tombstone)', async () => {
    const d = await driver(29);
    const car = await addCar(d.auth);

    await http
      .delete(`/drivers/me/vehicles/${car.id}`)
      .set('authorization', d.auth)
      .expect(204);

    // A deleted row frees the plate: a driver swapping a car back must not be
    // locked out by their own history.
    await http
      .post('/drivers/me/vehicles')
      .set('authorization', d.auth)
      .send({ ...CAR, plate: car.plate })
      .expect(201);
  });

  it("updates a driver's own vehicle without resetting defaulted fields (expected)", async () => {
    const d = await driver(17);
    const car = await addCar(d.auth); // category standard · hasChildSeat true

    const res = await http
      .patch(`/drivers/me/vehicles/${car.id}`)
      .set('authorization', d.auth)
      .send({ plate: 'XY9999' })
      .expect(200);

    const updated = vehicleSchema.parse(res.body);
    expect(updated.plate).toBe('XY9999');
    // `.partial()` over the defaulted fields, not `.default()` — a PATCH that
    // names neither must not silently reset the two filters #10 matches on.
    expect(updated.hasChildSeat).toBe(true);
    expect(updated.category).toBe('standard');
    // And the patch reaches only the allowlisted columns.
    expect(updated.driverId).toBe(d.id);
    expect(updated.id).toBe(car.id);
  });

  it('ignores the fields a driver may not write (edge — the privilege boundary)', async () => {
    const d = await driver(3);

    const res = await http
      .patch('/drivers/me')
      .set('authorization', d.auth)
      .send({
        spokenLanguages: ['lv', 'ru'],
        commissionPctOverride: 0,
        balanceCents: 999999,
        status: 'online',
      })
      .expect(200);

    expect(driverProfileSchema.parse(res.body).spokenLanguages).toEqual([
      'lv',
      'ru',
    ]);

    const row = await d.row();
    expect(row!.spokenLanguages).toEqual(['lv', 'ru']);
    expect(row!.commissionPctOverride).toBeNull();
    expect(row!.balanceCents).toBe(0);
    expect(row!.status).toBe('offline');
  });

  it('refuses to put a driver with no vehicle online (edge)', async () => {
    const d = await driver(4);

    const res = await http
      .put('/drivers/me/status')
      .set('authorization', d.auth)
      .send({ status: 'online' })
      .expect(409);
    expect((res.body as { message: string }).message).toBe('vehicle_required');

    expect(ctx.locations.isOnline(cityId, d.id)).toBe(false);
  });

  it('puts a driver with a vehicle online in both stores (expected)', async () => {
    const d = await driver(5);
    await addCar(d.auth);

    const res = await http
      .put('/drivers/me/status')
      .set('authorization', d.auth)
      .send({ status: 'online' })
      .expect(200);

    expect(driverProfileSchema.parse(res.body).status).toBe('online');
    expect((await d.row())!.status).toBe('online');
    expect(ctx.locations.isOnline(cityId, d.id)).toBe(true);
  });

  it('takes a driver offline in both stores (expected)', async () => {
    const d = await driver(16);
    await addCar(d.auth);
    await http
      .put('/drivers/me/status')
      .set('authorization', d.auth)
      .send({ status: 'online' })
      .expect(200);

    // The offline branch writes the two stores in the OPPOSITE order to the
    // online one, deliberately — this is the case that exercises it.
    const res = await http
      .put('/drivers/me/status')
      .set('authorization', d.auth)
      .send({ status: 'offline' })
      .expect(200);

    expect(driverProfileSchema.parse(res.body).status).toBe('offline');
    expect((await d.row())!.status).toBe('offline');
    expect(ctx.locations.isOnline(cityId, d.id)).toBe(false);
  });

  it("404s on another driver's vehicle and leaves it untouched (edge — no existence oracle)", async () => {
    const owner = await driver(6);
    const other = await driver(7);
    const car = await addCar(owner.auth);

    await http
      .patch(`/drivers/me/vehicles/${car.id}`)
      .set('authorization', other.auth)
      .send({ plate: 'STOLEN' })
      .expect(404); // 404, not 403 — the scoped SQL means it simply does not exist

    const [row] = await ctx.db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, car.id));
    expect(row!.plate).toBe(car.plate);
  });

  it('cannot re-parent a car even when the patch names another driver (edge — the second layer)', async () => {
    const owner = await driver(21);
    const other = await driver(22);
    const car = await addCar(owner.auth);

    // Deliberately bypasses zod. `vehicleUpdateSchema` strips `driverId` and
    // `id` today, so the route cannot carry them — this asserts the
    // repository's allowlist stands on its own if that ever changes, which is
    // the whole reason it is not a spread of the patch.
    const rogue = {
      plate: 'ZZ0001',
      driverId: other.id,
      id: crypto.randomUUID(),
    } as unknown as VehicleUpdate;

    const updated = await ctx.app
      .get(VehiclesRepository)
      .update(owner.id, car.id, rogue);

    expect(updated!.plate).toBe('ZZ0001'); // the allowlisted key still lands
    expect(updated!.driverId).toBe(owner.id);
    expect(updated!.id).toBe(car.id);
  });

  it('rejects a non-UUID vehicle id at the contract, not in Postgres (failure)', async () => {
    const d = await driver(8);

    // Without the param pipe this reaches pg as "invalid input syntax for type
    // uuid" — a 500 for what is plainly a bad request.
    await http
      .patch('/drivers/me/vehicles/not-a-uuid')
      .set('authorization', d.auth)
      .send({ plate: 'AB1234' })
      .expect(400);
  });

  it('rejects on_ride from a driver at the contract (failure)', async () => {
    const d = await driver(9);

    const res = await http
      .put('/drivers/me/status')
      .set('authorization', d.auth)
      .send({ status: 'on_ride' })
      .expect(400);
    expect((res.body as { message: string }).message).toBe('validation_failed');
  });

  it('forbids a rider on the driver routes with 403, not 401 (failure)', async () => {
    const session = await signIn(p(10), 'rider');

    await http
      .get('/drivers/me')
      .set('authorization', `Bearer ${session.accessToken}`)
      .expect(403);
  });

  it('refuses a presence toggle while on_ride (edge — #11 owns that transition)', async () => {
    const d = await driver(12);
    await addCar(d.auth);
    // No route can write `on_ride` — that is the point — so set it directly.
    await ctx.db
      .update(drivers)
      .set({ status: 'on_ride' })
      .where(eq(drivers.userId, d.id));

    const res = await http
      .put('/drivers/me/status')
      .set('authorization', d.auth)
      .send({ status: 'offline' })
      .expect(409);
    expect((res.body as { message: string }).message).toBe('driver_on_ride');

    expect((await d.row())!.status).toBe('on_ride');
  });

  it('acks an online re-assert while on_ride with the profile — no 409, nothing touched (edge — review F3: the mid-ride reconnect)', async () => {
    const d = await driver(35);
    await addCar(d.auth);
    await ctx.db
      .update(drivers)
      .set({ status: 'on_ride' })
      .where(eq(drivers.userId, d.id));

    // The app re-asserts `online` on every socket reconnect; while the server
    // holds the driver `on_ride` that must be a no-op ack — a 409 flipped the
    // toggle and tore the stream down on a Wi-Fi handover mid-ride.
    const res = await http
      .put('/drivers/me/status')
      .set('authorization', d.auth)
      .send({ status: 'online' })
      .expect(200);

    expect(driverProfileSchema.parse(res.body).status).toBe('on_ride');
    expect((await d.row())!.status).toBe('on_ride');
    // Nothing touched: the ack wrote neither store.
    expect(ctx.locations.isOnline(cityId, d.id)).toBe(false);
  });

  it('refuses to go online for an offline driver with a live accepted ride (#61 chain A — failure)', async () => {
    const d = await driver(31);
    await addCar(d.auth);
    const rider = await signIn(p(32), 'rider');

    // Chain A's paradox state — `offline` in `drivers.status`, yet committed to
    // a live ride — is reachable only through a mid-offer disconnect, so no
    // route can produce it here. Written directly, like `on_ride` above.
    const [ride] = await ctx.db
      .insert(rides)
      .values({
        orderId: crypto.randomUUID(),
        status: 'accepted',
        riderId: rider.user.id,
        driverId: d.id,
        request: {}, // never parsed on this path
        paymentMethod: 'cash',
        category: 'standard',
      })
      .returning({ id: rides.id });

    try {
      const res = await http
        .put('/drivers/me/status')
        .set('authorization', d.auth)
        .send({ status: 'online' })
        .expect(409);
      // The rides table decides, and mid-ride outranks a missing vehicle.
      expect((res.body as { message: string }).message).toBe('driver_on_ride');

      expect((await d.row())!.status).toBe('offline');
      expect(ctx.locations.isOnline(cityId, d.id)).toBe(false);
    } finally {
      // This file has no createdRides afterEach — retire the ride by hand.
      await ctx.db
        .update(rides)
        .set({ status: 'cancelled_by_system' })
        .where(eq(rides.id, ride!.id));
    }
  });

  it('lets a driver back online once their ride is completed but unsettled (#61 — edge)', async () => {
    const d = await driver(33);
    await addCar(d.auth);
    const rider = await signIn(p(34), 'rider');

    // `completed` is deliberately outside ACTIVE_DRIVER_RIDE_STATUSES: the
    // driver was released inside `complete()`, so an unsettled fare must not
    // pin them offline.
    const [ride] = await ctx.db
      .insert(rides)
      .values({
        orderId: crypto.randomUUID(),
        status: 'completed',
        riderId: rider.user.id,
        driverId: d.id,
        request: {},
        paymentMethod: 'cash',
        category: 'standard',
      })
      .returning({ id: rides.id });

    try {
      await http
        .put('/drivers/me/status')
        .set('authorization', d.auth)
        .send({ status: 'online' })
        .expect(200);

      expect((await d.row())!.status).toBe('online');
    } finally {
      await ctx.db
        .update(rides)
        .set({ status: 'cancelled_by_system' })
        .where(eq(rides.id, ride!.id));
    }
  });

  describe('findMatchAttributes (#10 consumes this in-process)', () => {
    const service = () => ctx.app.get(DriversService);

    it("aggregates across a driver's vehicles (expected)", async () => {
      const d = await driver(13);
      await addCar(d.auth); // standard · 4 seats · child seat
      await http
        .post('/drivers/me/vehicles')
        .set('authorization', d.auth)
        .send({
          ...CAR,
          plate: 'VIP001',
          category: 'vip',
          passengerSeats: 7,
          hasChildSeat: false,
        })
        .expect(201);
      await http
        .post('/drivers/me/vehicles')
        .set('authorization', d.auth)
        .send({ ...CAR, plate: 'STD002', hasChildSeat: false }) // a second `standard`
        .expect(201);

      const [attrs] = await service().findMatchAttributes([d.id]);

      expect([...attrs!.categories].sort()).toEqual(['standard', 'vip']); // deduped
      expect(attrs!.hasChildSeat).toBe(true); // ANY vehicle, not every
      expect(attrs!.maxPassengerSeats).toBe(7);
      expect(attrs!.status).toBe('offline');
    });

    it('still returns a driver who owns no vehicle (edge — the leftJoin branch)', async () => {
      const d = await driver(14);
      await http.get('/drivers/me').set('authorization', d.auth).expect(200);

      const [attrs] = await service().findMatchAttributes([d.id]);

      // A row, not an absence: #10 needs to see the driver in order to discard
      // them, and `vehicles` is null on this join.
      expect(attrs!.driverId).toBe(d.id);
      expect(attrs!.categories).toEqual([]);
      expect(attrs!.hasChildSeat).toBe(false);
      expect(attrs!.maxPassengerSeats).toBe(0);
    });

    it('returns [] for an empty id list (edge — a saved round trip on a hot path)', async () => {
      expect(await service().findMatchAttributes([])).toEqual([]);
    });
  });

  it('forces a driver offline when their last vehicle is deleted (edge)', async () => {
    const d = await driver(15);
    const car = await addCar(d.auth);
    await http
      .put('/drivers/me/status')
      .set('authorization', d.auth)
      .send({ status: 'online' })
      .expect(200);
    expect(ctx.locations.isOnline(cityId, d.id)).toBe(true);

    await http
      .delete(`/drivers/me/vehicles/${car.id}`)
      .set('authorization', d.auth)
      .expect(204);

    expect((await d.row())!.status).toBe('offline');
    expect(ctx.locations.isOnline(cityId, d.id)).toBe(false);
  });

  it('keeps a driver online when a vehicle that is not their last is deleted (edge)', async () => {
    const d = await driver(19);
    const first = await addCar(d.auth);
    await http
      .post('/drivers/me/vehicles')
      .set('authorization', d.auth)
      .send({ ...CAR, plate: 'SPARE1' })
      .expect(201);
    await http
      .put('/drivers/me/status')
      .set('authorization', d.auth)
      .send({ status: 'online' })
      .expect(200);

    await http
      .delete(`/drivers/me/vehicles/${first.id}`)
      .set('authorization', d.auth)
      .expect(204);

    // The forced-offline rule must not over-trigger: they still have a car.
    expect((await d.row())!.status).toBe('online');
    expect(ctx.locations.isOnline(cityId, d.id)).toBe(true);
  });

  it('refuses to delete a vehicle while on_ride (edge — #11 owns that transition)', async () => {
    const d = await driver(20);
    const car = await addCar(d.auth);
    // Same trick as the presence case: no route can write `on_ride`.
    await ctx.db
      .update(drivers)
      .set({ status: 'on_ride' })
      .where(eq(drivers.userId, d.id));

    const res = await http
      .delete(`/drivers/me/vehicles/${car.id}`)
      .set('authorization', d.auth)
      .expect(409);
    expect((res.body as { message: string }).message).toBe('driver_on_ride');

    // Nothing deleted — otherwise #11 restores them to `online` with no vehicle,
    // which is exactly the state `vehicle_required` exists to prevent.
    const [row] = await ctx.db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, car.id));
    expect(row).toBeDefined();
  });

  it('404s when deleting a vehicle that is not there (failure)', async () => {
    const d = await driver(18);
    await http.get('/drivers/me').set('authorization', d.auth).expect(200);

    await http
      .delete(`/drivers/me/vehicles/${crypto.randomUUID()}`)
      .set('authorization', d.auth)
      .expect(404);
  });
});
