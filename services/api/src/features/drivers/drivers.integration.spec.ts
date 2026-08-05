import { drivers, vehicles } from '@taxi/db';
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

  const addCar = async (auth: string) => {
    const res = await http
      .post('/drivers/me/vehicles')
      .set('authorization', auth)
      .send(CAR)
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
    expect(row!.plate).toBe(CAR.plate);
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
