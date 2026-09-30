import { drivers, rideOffers, rides } from '@taxi/db';
import {
  adminDriverDetailSchema,
  adminDriverSummarySchema,
  authSessionSchema,
  dispatchRosterSchema,
  IDEMPOTENCY_KEY_HEADER,
  rideCreatedSchema,
  vehicleSchema,
  type LatLng,
} from '@taxi/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  createTestApp,
  insertUser,
  phoneFor,
  type TestApp,
} from '../../../../test/harness';
import { APP_ENV, type Env } from '../../../common/config/env.schema';
import { AuthTokenService } from '../../auth';
import { DispatchSweeper } from '../../dispatch/dispatch.sweeper';
import { AdminDriversRepository } from './admin-drivers.repository';

/** `+371340` is this spec file's E.164 range — see phoneFor(). */
const p = (n: number) => phoneFor('+371340', n);

/** Inside centre only — the dispatch spec's auto-match pickup. */
const CENTRE_PICKUP = {
  location: { lat: 56.96, lng: 24.085 },
  address: 'Hanzas iela, Rīga',
};
const DESTINATION = {
  location: { lat: 56.9712, lng: 24.18 },
  address: 'Teika, Rīga',
};
const NEAR_PICKUP: LatLng = { lat: 56.961, lng: 24.085 };
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const messageOf = (res: request.Response) =>
  (res.body as { message: string }).message;

describe('admin drivers (#20, integration)', () => {
  let ctx: TestApp;
  let http: ReturnType<typeof request>;
  let cityId: string;
  let adminAuth: string;
  let dispatcherAuth: string;
  let riderAuth: string;
  let riderId: string;

  const usedDrivers: string[] = [];
  const createdRides: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
    cityId = ctx.app.get<Env>(APP_ENV).DEFAULT_CITY_ID;
    const tokens = ctx.app.get(AuthTokenService);
    const bearer = async (
      n: number,
      role: 'admin' | 'dispatcher' | 'rider',
    ) => {
      const u = await insertUser(ctx.db, { phone: p(n), role });
      if (role === 'rider') riderId = u.id;
      return `Bearer ${(await tokens.issue({ id: u.id, role })).accessToken}`;
    };
    adminAuth = await bearer(1, 'admin');
    dispatcherAuth = await bearer(2, 'dispatcher');
    riderAuth = await bearer(3, 'rider');
  });

  afterEach(async () => {
    const ids = usedDrivers.splice(0);
    for (const id of ids) await ctx.locations.markOffline(cityId, id);
    if (ids.length)
      await ctx.db
        .update(drivers)
        .set({ status: 'offline' })
        .where(inArray(drivers.userId, ids));
    if (createdRides.length)
      await ctx.db
        .update(rides)
        .set({ status: 'cancelled_by_system' })
        .where(inArray(rides.id, createdRides.splice(0)));
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
  const nextPlate = () => `AD${String(++plateSeq).padStart(4, '0')}`;

  /** A self-registered driver with one car — `pending`, as sign-up leaves them. */
  async function pendingDriver(n: number) {
    const session = await signIn(p(n), 'driver');
    const auth = `Bearer ${session.accessToken}`;
    const res = await http
      .post('/drivers/me/vehicles')
      .set('authorization', auth)
      .send({
        plate: nextPlate(),
        make: 'Skoda',
        model: 'Octavia',
        year: 2019,
        passengerSeats: 4,
      })
      .expect(201);
    usedDrivers.push(session.user.id);
    return { id: session.user.id, auth, car: vehicleSchema.parse(res.body) };
  }

  const goOnline = (auth: string) =>
    http
      .put('/drivers/me/status')
      .set('authorization', auth)
      .send({ status: 'online' });

  const setApproval = (id: string, status: string, auth = adminAuth) =>
    http
      .put(`/admin/drivers/${id}/approval`)
      .set('authorization', auth)
      .send({ status });

  const row = async (id: string) =>
    (await ctx.db.select().from(drivers).where(eq(drivers.userId, id)))[0]!;

  /** An approved driver online in both stores, near the centre pickup. */
  async function onlineApprovedDriver(n: number) {
    const d = await pendingDriver(n);
    await setApproval(d.id, 'approved').expect(200);
    await goOnline(d.auth).expect(200);
    await ctx.locations.markOnline(cityId, d.id, Date.now());
    await ctx.locations.record(cityId, d.id, NEAR_PICKUP, Date.now());
    return d;
  }

  it('refuses a pending driver online, then lets them on once approved (edge → expected, AC A2)', async () => {
    const d = await pendingDriver(10);

    const refused = await goOnline(d.auth).expect(409);
    expect(messageOf(refused)).toBe('driver_not_approved');
    expect(ctx.locations.isOnline(cityId, d.id)).toBe(false);

    // The review queue lists them with the plate and the tier they would bill at.
    const queue = await http
      .get('/admin/drivers?approval=pending')
      .set('authorization', adminAuth)
      .expect(200);
    const listed = adminDriverSummarySchema
      .array()
      .parse(queue.body)
      .find((s) => s.userId === d.id);
    expect(listed?.vehicles).toEqual([
      { plate: d.car.plate, category: 'standard' },
    ]);
    expect(listed?.phone).toBe(p(10));

    const approved = await setApproval(d.id, 'approved').expect(200);
    expect(adminDriverDetailSchema.parse(approved.body).approvalStatus).toBe(
      'approved',
    );

    await goOnline(d.auth).expect(200);
    expect((await row(d.id)).status).toBe('online');
  });

  it('rejecting an online driver takes them offline in both stores (expected, AC A4)', async () => {
    const d = await onlineApprovedDriver(11);
    expect(ctx.locations.isOnline(cityId, d.id)).toBe(true);

    const res = await setApproval(d.id, 'rejected').expect(200);
    const detail = adminDriverDetailSchema.parse(res.body);
    expect(detail.approvalStatus).toBe('rejected');
    expect(detail.status).toBe('offline');

    expect((await row(d.id)).status).toBe('offline');
    expect(ctx.locations.isOnline(cityId, d.id)).toBe(false);
    // And they cannot put themselves back.
    expect(messageOf(await goOnline(d.auth).expect(409))).toBe(
      'driver_not_approved',
    );
  });

  it('a reject landing between go-online’s commit and its Redis write still ends offline (edge, PR #309 L1)', async () => {
    const d = await pendingDriver(22);
    await setApproval(d.id, 'approved').expect(200);

    // Forces the interleaving: the go-online `UPDATE` has committed, and the
    // admin's whole reject runs before the driver's `markOnline` lands.
    const markOnline = ctx.locations.markOnline.bind(ctx.locations);
    const spy = jest
      .spyOn(ctx.locations, 'markOnline')
      .mockImplementationOnce(async (...args) => {
        await setApproval(d.id, 'rejected').expect(200);
        return markOnline(...args);
      });
    try {
      const res = await goOnline(d.auth).expect(409);
      expect(messageOf(res)).toBe('driver_not_approved');
    } finally {
      spy.mockRestore();
    }

    expect(ctx.locations.isOnline(cityId, d.id)).toBe(false);
    expect((await row(d.id)).status).toBe('offline');
  });

  it('refuses rejecting an on-ride driver and leaves approval unchanged (failure, AC A4)', async () => {
    const d = await onlineApprovedDriver(12);
    await ctx.db
      .update(drivers)
      .set({ status: 'on_ride' })
      .where(eq(drivers.userId, d.id));

    expect(messageOf(await setApproval(d.id, 'rejected').expect(409))).toBe(
      'driver_on_ride',
    );
    const after = await row(d.id);
    expect(after.approvalStatus).toBe('approved');
    expect(after.status).toBe('on_ride');
  });

  it('refuses rejecting an OFFLINE driver who holds an accepted ride (failure, #61 chain A)', async () => {
    // `drivers.status` says offline, so only the fresh rides-table read in
    // `setApproval` sees the ride.
    const d = await pendingDriver(17);
    await setApproval(d.id, 'approved').expect(200);
    const [ride] = await ctx.db
      .insert(rides)
      .values({
        orderId: randomUUID(),
        status: 'accepted',
        riderId,
        driverId: d.id,
        request: {},
        paymentMethod: 'cash',
        category: 'standard',
      })
      .returning({ id: rides.id });
    createdRides.push(ride!.id);
    expect((await row(d.id)).status).toBe('offline');

    expect(messageOf(await setApproval(d.id, 'rejected').expect(409))).toBe(
      'driver_on_ride',
    );
    expect((await row(d.id)).approvalStatus).toBe('approved');
  });

  it('keeps an unapproved driver out of the force-assign roster (edge, AC A2)', async () => {
    const pending = await pendingDriver(18);
    const approved = await pendingDriver(19);
    await setApproval(approved.id, 'approved').expect(200);

    const res = await http
      .get('/dispatch/drivers')
      .set('authorization', dispatcherAuth)
      .expect(200);
    const ids = dispatchRosterSchema
      .parse(res.body)
      .drivers.map((x) => x.driverId);
    expect(ids).toContain(approved.id);
    expect(ids).not.toContain(pending.id);
  });

  it('refuses dispatcher and rider tokens (403) and anonymous (401) on every route (failure, AC A3)', async () => {
    const routes = [
      () => http.get('/admin/drivers'),
      () => http.get(`/admin/drivers/${UNKNOWN_ID}`),
      () => http.patch(`/admin/drivers/${UNKNOWN_ID}`).send({ isFemale: true }),
      () =>
        http
          .put(`/admin/drivers/${UNKNOWN_ID}/approval`)
          .send({ status: 'approved' }),
      () =>
        http.patch(`/admin/vehicles/${UNKNOWN_ID}`).send({ category: 'limo' }),
      () => http.delete(`/admin/vehicles/${UNKNOWN_ID}`),
    ];
    for (const route of routes) {
      // The message, not the status: `insufficient_role` is only the guard's.
      for (const auth of [dispatcherAuth, riderAuth]) {
        const res = await route().set('authorization', auth).expect(403);
        expect(messageOf(res)).toBe('insufficient_role');
      }
      await route().expect(401);
    }
  });

  it('category is the admin’s to set; a driver’s edit cannot change it (expected, AC A6)', async () => {
    const d = await pendingDriver(13);

    const set = await http
      .patch(`/admin/vehicles/${d.car.id}`)
      .set('authorization', adminAuth)
      .send({ category: 'limo' })
      .expect(200);
    expect(vehicleSchema.parse(set.body).category).toBe('limo');

    // An installed app still sending `category` has it stripped, not refused.
    const own = await http
      .patch(`/drivers/me/vehicles/${d.car.id}`)
      .set('authorization', d.auth)
      .send({ category: 'standard', make: 'Škoda' })
      .expect(200);
    const car = vehicleSchema.parse(own.body);
    expect(car.make).toBe('Škoda');
    expect(car.category).toBe('limo');

    // Category alone strips to an empty patch.
    await http
      .patch(`/drivers/me/vehicles/${d.car.id}`)
      .set('authorization', d.auth)
      .send({ category: 'standard' })
      .expect(400);
  });

  it('an admin vehicle patch cannot re-parent the car, even past the schema (edge, PR #309 L2)', async () => {
    const owner = await pendingDriver(20);
    const other = await pendingDriver(21);
    const repo = ctx.app.get(AdminDriversRepository);

    // Simulates `adminVehicleUpdateSchema` losing its `.omit()`: the
    // repository's allowlist is the guard that must still hold.
    const smuggled = { make: 'Škoda', driverId: other.id, id: randomUUID() };
    const car = await repo.updateVehicle(owner.car.id, smuggled);

    expect(car?.make).toBe('Škoda');
    expect(car?.id).toBe(owner.car.id);
    expect(await repo.vehicleOwner(owner.car.id)).toBe(owner.id);
  });

  it('sets and clears the commission override, distinct from absent (edge, AC A5)', async () => {
    const d = await pendingDriver(14);
    const patch = (body: object) =>
      http
        .patch(`/admin/drivers/${d.id}`)
        .set('authorization', adminAuth)
        .send(body)
        .expect(200);

    await patch({ commissionPctOverride: 0, displayName: 'Anna' });
    expect((await row(d.id)).commissionPctOverride).toBe(0);

    // A patch without the key leaves it.
    const kept = await patch({ isFemale: true });
    const detail = adminDriverDetailSchema.parse(kept.body);
    expect(detail.profile.commissionPctOverride).toBe(0);
    expect(detail.displayName).toBe('Anna');

    await patch({ commissionPctOverride: null });
    expect((await row(d.id)).commissionPctOverride).toBeNull();
  });

  it("deleting an online driver's only car takes them offline (expected, AC A5)", async () => {
    const d = await onlineApprovedDriver(15);

    await http
      .delete(`/admin/vehicles/${d.car.id}`)
      .set('authorization', adminAuth)
      .expect(204);

    expect((await row(d.id)).status).toBe('offline');
    expect(ctx.locations.isOnline(cityId, d.id)).toBe(false);
  });

  it('answers 404 with a code for an unknown driver or vehicle (failure)', async () => {
    const as = <T extends request.Test>(t: T) =>
      t.set('authorization', adminAuth).expect(404);

    expect(messageOf(await as(http.get(`/admin/drivers/${UNKNOWN_ID}`)))).toBe(
      'driver_not_found',
    );
    expect(
      messageOf(
        await as(
          http
            .put(`/admin/drivers/${UNKNOWN_ID}/approval`)
            .send({ status: 'rejected' }),
        ),
      ),
    ).toBe('driver_not_found');
    expect(
      messageOf(
        await as(
          http.patch(`/admin/drivers/${UNKNOWN_ID}`).send({ isFemale: true }),
        ),
      ),
    ).toBe('driver_not_found');
    expect(
      messageOf(
        await as(
          http.patch(`/admin/vehicles/${UNKNOWN_ID}`).send({ category: 'vip' }),
        ),
      ),
    ).toBe('vehicle_not_found');
    expect(
      messageOf(await as(http.delete(`/admin/vehicles/${UNKNOWN_ID}`))),
    ).toBe('vehicle_not_found');
  });

  it('refuses an accept from a driver revoked while the offer was on screen (failure, AC A2)', async () => {
    const d = await onlineApprovedDriver(16);
    const booked = await http
      .post('/rides')
      .set('authorization', riderAuth)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .send({
        pickup: CENTRE_PICKUP,
        destination: DESTINATION,
        paymentMethod: 'cash',
      })
      .expect(201);
    const { ride } = rideCreatedSchema.parse(booked.body);
    createdRides.push(ride.id);

    await ctx.app.get(DispatchSweeper).tick();
    const [offer] = await ctx.db
      .select()
      .from(rideOffers)
      .where(
        and(eq(rideOffers.rideId, ride.id), eq(rideOffers.status, 'pending')),
      );
    expect(offer?.driverId).toBe(d.id);

    await setApproval(d.id, 'rejected').expect(200);
    expect((await row(d.id)).status).toBe('offline');

    const refused = await http
      .post(`/dispatch/offers/${offer!.id}/accept`)
      .set('authorization', d.auth)
      .expect(409);
    expect(messageOf(refused)).toBe('driver_not_approved');

    // The whole accept rolled back: the ride is still on offer and unassigned.
    const [after] = await ctx.db
      .select()
      .from(rides)
      .where(eq(rides.id, ride.id));
    expect(after!.status).toBe('offered');
    expect(after!.driverId).toBeNull();
  });
});
