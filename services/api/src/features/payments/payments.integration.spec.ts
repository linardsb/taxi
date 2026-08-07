import { drivers, ledgerEntries, rideOffers, rides, users } from '@taxi/db';
import {
  authSessionSchema,
  IDEMPOTENCY_KEY_HEADER,
  rideCreatedSchema,
  type LatLng,
  type PaymentMethodType,
} from '@taxi/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  createTestApp,
  insertUser,
  phoneFor,
  type TestApp,
} from '../../../test/harness';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { AuthTokenService } from '../auth';
import { DispatchService } from '../dispatch';
import { LedgerRepository, LedgerService } from '../ledger';
import { settlementIdempotencyKey } from './settlement.policy';

/**
 * `+371270` is this spec file's E.164 range — see phoneFor(). `+371210` (auth),
 * `+371220` (drivers), `+371230` (driver-location gateway), `+371240` (rides),
 * `+371250` (dispatch) and `+371260` (ride lifecycle) are taken, and
 * `users.phone` is unique across a run that never resets the database, so a
 * collision reuses another file's user — and its ROLE, which surfaces as a 403
 * naming nothing.
 */
const p = (n: number) => phoneFor('+371270', n);

/**
 * Inside centre only, for the reason the lifecycle spec records: RIX ships
 * `queueModeEnabled: true` and changes the transition sequence.
 */
const CENTRE_PICKUP = {
  location: { lat: 56.96, lng: 24.085 },
  address: 'Hanzas iela, Rīga',
};
const DESTINATION = {
  location: { lat: 56.9712, lng: 24.18 },
  address: 'Teika, Rīga',
};

/** The seeded pilot limit (`platform_config.driver_debt_limit_cents`). */
const DEBT_LIMIT = 5_000;

const near = (base: LatLng, dLat: number, dLng: number): LatLng => ({
  lat: base.lat + dLat,
  lng: base.lng + dLng,
});

describe('payments + ledger (integration)', () => {
  let ctx: TestApp;
  let http: ReturnType<typeof request>;
  let dispatch: DispatchService;
  let ledger: LedgerRepository;
  let tokens: AuthTokenService;
  let cityId: string;

  const createdRides: string[] = [];
  const usedDrivers: string[] = [];

  beforeAll(async () => {
    // `createTestApp` already calls `app.init()`; a second one re-runs
    // bootstrap and leaves the HTTP adapter in a state supertest reads as a
    // malformed response under parallel load.
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
    dispatch = ctx.app.get(DispatchService);
    ledger = ctx.app.get(LedgerRepository);
    tokens = ctx.app.get(AuthTokenService);
    cityId = ctx.app.get<Env>(APP_ENV).DEFAULT_CITY_ID;
  });

  afterEach(async () => {
    // One app per FILE, so charges accumulate across tests. Every case here
    // asserts an exact call count, which is the point ("charged exactly once") —
    // so the recorder is cleared between them rather than offset against.
    ctx.payments.reset();

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
    // Retired so this file's `completed`/`settled` rides never crowd the
    // sweeper's oldest-first batch and break another file's test.
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
  const nextPlate = () => `PY${String(++plateSeq).padStart(4, '0')}`;

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

    await ctx.locations.markOnline(cityId, id);
    await ctx.locations.record(cityId, id, location, Date.now());
    usedDrivers.push(id);
    return { id, auth };
  }

  /**
   * A rider, optionally card-enrolled.
   *
   * The refs are written DIRECTLY because no enrollment API exists — that is
   * #17's, and this ticket's scope note says so. Two opaque strings are exactly
   * what the seam takes.
   */
  async function rider(n: number, enrolled = true) {
    const session = await signIn(p(n), 'rider');
    if (enrolled) {
      await ctx.db
        .update(users)
        .set({
          paymentCustomerRef: `cus_test_${n}`,
          paymentInstrumentRef: `pm_test_${n}`,
        })
        .where(eq(users.id, session.user.id));
    }
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

  async function book(riderAuth: string, paymentMethod: PaymentMethodType) {
    const res = await http
      .post('/rides')
      .set('authorization', riderAuth)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .send({ pickup: CENTRE_PICKUP, destination: DESTINATION, paymentMethod })
      .expect(201);
    const { ride } = rideCreatedSchema.parse(res.body);
    createdRides.push(ride.id);
    return ride;
  }

  /** One ride, one dispatch — never `DispatchSweeper.tick()`, which would reach
   *  into other spec files' rides. Same reasoning as the lifecycle spec. */
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

  const driverRow = async (driverId: string) =>
    (
      await ctx.db.select().from(drivers).where(eq(drivers.userId, driverId))
    )[0]!;

  /** Drives a ride all the way to `completed`, ready to settle. */
  async function completedRide(
    riderAuth: string,
    driver: { id: string; auth: string },
    paymentMethod: PaymentMethodType,
  ) {
    const ride = await book(riderAuth, paymentMethod);
    await offerTo(ride);
    const offer = await pendingOffer(ride.id);
    await http
      .post(`/dispatch/offers/${offer!.id}/accept`)
      .set('authorization', driver.auth)
      .expect(201);
    for (const step of ['arriving', 'arrived', 'start'] as const) {
      await http
        .post(`/rides/${ride.id}/${step}`)
        .set('authorization', driver.auth)
        .expect(201);
    }
    await http
      .post(`/rides/${ride.id}/complete`)
      .set('authorization', driver.auth)
      .expect(201);
    return ride;
  }

  const sumOf = (entries: { amountCents: number }[]) =>
    entries.reduce((acc, e) => acc + e.amountCents, 0);

  /**
   * (expected) AC #1 — a card ride settles with correct ledger entries.
   *
   * Read through `LedgerRepository.findByRide()` rather than a raw query, so
   * `ledger_entries_ride_idx` (the deferred PR #32 finding) has a real caller.
   */
  it('settles a card ride into a balanced six-entry set (AC #1)', async () => {
    const d = await onlineDriver(1, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(50);
    const ride = await completedRide(r.auth, d, 'card');
    const before = await rideRow(ride.id);
    const balanceBefore = (await driverRow(d.id)).balanceCents;

    await http
      .post(`/rides/${ride.id}/settle`)
      .set('authorization', d.auth)
      .expect(201);

    const after = await rideRow(ride.id);
    expect(after.status).toBe('settled');
    expect(after.paymentProviderRef).not.toBeNull();

    const entries = await ledger.findByRide(ride.id);
    expect(entries).toHaveLength(6);
    expect(new Set(entries.map((e) => e.transactionId)).size).toBe(1);
    expect(sumOf(entries)).toBe(0);

    const of = (ownerType: string) =>
      entries.filter((e) => e.ownerType === ownerType);
    // The rider is a BALANCE on card too — the property prepaid balance and
    // corporate invoicing both need, and the reason `card_settlement` exists.
    expect(sumOf(of('rider'))).toBe(0);
    expect(sumOf(of('driver'))).toBe(before.driverNetCents);
    // The contra property, asserted AS A RELATION — never as a hardcoded figure,
    // because the platform account's aggregate means nothing on its own.
    expect(sumOf(of('platform'))).toBe(
      -(sumOf(of('rider')) + sumOf(of('driver'))),
    );
    // What IS meaningful on the platform account: revenue, by entry type.
    expect(
      sumOf(of('platform').filter((e) => e.entryType === 'commission')),
    ).toBe(before.commissionCents);

    // THE INVARIANT: the cached balance equals this driver's ledger movement.
    const balanceAfter = (await driverRow(d.id)).balanceCents;
    expect(balanceAfter - balanceBefore).toBe(sumOf(of('driver')));

    expect(ctx.payments.calls).toHaveLength(1);
    expect(ctx.payments.calls[0]).toMatchObject({
      idempotencyKey: settlementIdempotencyKey(ride.id),
      amountCents: before.totalCents,
      currency: 'EUR',
    });
  });

  /**
   * (edge) AC #2 — a cash ride nets commission against the driver's balance,
   * and past the limit dispatch stops offering — while force-assign still reaches.
   */
  it('nets cash commission and blocks the driver past the debt limit (AC #2)', async () => {
    const d = await onlineDriver(2, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(51);
    const ride = await completedRide(r.auth, d, 'cash');
    const settledRow = await rideRow(ride.id);
    const balanceBefore = (await driverRow(d.id)).balanceCents;

    await http
      .post(`/rides/${ride.id}/settle`)
      .set('authorization', d.auth)
      .expect(201);

    // ZERO provider calls: the driver already took the money at the kerb.
    expect(ctx.payments.calls).toHaveLength(0);
    expect((await rideRow(ride.id)).paymentProviderRef).toBeNull();

    const entries = await ledger.findByRide(ride.id);
    expect(entries).toHaveLength(6);
    expect(sumOf(entries)).toBe(0);
    expect(sumOf(entries.filter((e) => e.ownerType === 'rider'))).toBe(0);
    // The netting: all that is left between driver and platform is what is owed.
    const balanceAfter = (await driverRow(d.id)).balanceCents;
    expect(balanceAfter - balanceBefore).toBe(-settledRow.commissionCents!);

    // ── the block ──
    // Reaching €50 of debt through the API would take ~33 more cash rides; the
    // netting that produces the negative balance is asserted directly above, and
    // what is under test HERE is the filter reading the config limit. Set at the
    // boundary and one cent past it, since the two outcomes differ by that cent.
    const second = await onlineDriver(
      3,
      near(CENTRE_PICKUP.location, 0.002, 0),
    );

    await ctx.db
      .update(drivers)
      .set({ balanceCents: -DEBT_LIMIT })
      .where(eq(drivers.userId, d.id));
    const atLimit = await book(r.auth, 'cash');
    await offerTo(atLimit);
    // EXACTLY at the limit is still eligible: the block is `< -limit`.
    expect((await pendingOffer(atLimit.id))?.driverId).toBe(d.id);

    await ctx.db
      .update(drivers)
      .set({ balanceCents: -DEBT_LIMIT - 1 })
      .where(eq(drivers.userId, d.id));
    const overLimit = await book(r.auth, 'cash');
    await offerTo(overLimit);
    // One cent past it, the nearer driver is skipped and the second one gets it.
    expect((await pendingOffer(overLimit.id))?.driverId).toBe(second.id);

    // ── but the override still reaches them (S9-2) ──
    const dina = await dispatcher(90);
    const forced = await book(r.auth, 'cash');
    await http
      .post(`/dispatch/rides/${forced.id}/assign`)
      .set('authorization', dina.auth)
      .send({ driverId: d.id })
      .expect(201);
    // "Deliberately NOT filtered through the eligibility rules" — overriding the
    // algorithm IS the feature, and a debt-blocked driver is exactly the case a
    // dispatcher overrides for.
    expect((await rideRow(forced.id)).driverId).toBe(d.id);

    await ctx.db
      .update(drivers)
      .set({ balanceCents: 0 })
      .where(eq(drivers.userId, d.id));
  });

  /** (failure) AC #3a — a decline answers 402 and leaves no residue at all. */
  it('writes nothing when the charge is declined, then settles cleanly on retry (AC #3)', async () => {
    const d = await onlineDriver(4, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(52);
    const ride = await completedRide(r.auth, d, 'card');
    const balanceBefore = (await driverRow(d.id)).balanceCents;

    ctx.payments.failNext('declined');
    await http
      .post(`/rides/${ride.id}/settle`)
      .set('authorization', d.auth)
      .expect(402);

    // The charge runs BEFORE the transaction, so a failure writes nothing.
    const afterDecline = await rideRow(ride.id);
    expect(afterDecline.status).toBe('completed');
    expect(afterDecline.paymentProviderRef).toBeNull();
    expect(await ledger.findByRide(ride.id)).toHaveLength(0);
    expect((await driverRow(d.id)).balanceCents).toBe(balanceBefore);

    // A failed attempt leaves no residue: settling again produces exactly ONE set.
    await http
      .post(`/rides/${ride.id}/settle`)
      .set('authorization', d.auth)
      .expect(201);

    const entries = await ledger.findByRide(ride.id);
    expect(entries).toHaveLength(6);
    expect(new Set(entries.map((e) => e.transactionId)).size).toBe(1);
    expect((await rideRow(ride.id)).status).toBe('settled');
  });

  /**
   * (failure) AC #3b — CHARGE SUCCEEDED, DATABASE FAILED.
   *
   * The hazard that costs a rider real money, and the one defended by a naming
   * convention rather than by machinery: the retry must reach the SAME
   * PaymentIntent. Asserted at the boundary we control — same key, twice.
   */
  it('reuses the idempotency key when the post-charge transaction fails (AC #3)', async () => {
    const d = await onlineDriver(5, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(53);
    const ride = await completedRide(r.auth, d, 'card');
    const balanceBefore = (await driverRow(d.id)).balanceCents;

    const ledgerService = ctx.app.get(LedgerService);
    const post = jest
      .spyOn(ledgerService, 'postRideSettlement')
      .mockRejectedValueOnce(
        new Error('connection terminated mid-transaction'),
      );

    await http
      .post(`/rides/${ride.id}/settle`)
      .set('authorization', d.auth)
      .expect(500);

    // The transaction rolled back: the charge happened, nothing else did.
    expect(ctx.payments.calls).toHaveLength(1);
    expect((await rideRow(ride.id)).status).toBe('completed');
    expect(await ledger.findByRide(ride.id)).toHaveLength(0);
    expect((await driverRow(d.id)).balanceCents).toBe(balanceBefore);

    post.mockRestore();
    await http
      .post(`/rides/${ride.id}/settle`)
      .set('authorization', d.auth)
      .expect(201);

    // TWO calls, ONE key — so Stripe returns the original PaymentIntent rather
    // than charging the rider a second time.
    expect(ctx.payments.calls).toHaveLength(2);
    expect(ctx.payments.calls[0]!.idempotencyKey).toBe(
      ctx.payments.calls[1]!.idempotencyKey,
    );
    expect(ctx.payments.calls[0]!.idempotencyKey).toBe(
      settlementIdempotencyKey(ride.id),
    );
    expect(await ledger.findByRide(ride.id)).toHaveLength(6);
  });

  /** (edge) Settling twice is a 201 both times, one charge, one entry set. */
  it('is idempotent: a second settle charges nothing and posts nothing (AC #1)', async () => {
    const d = await onlineDriver(6, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(54);
    const ride = await completedRide(r.auth, d, 'card');

    await http
      .post(`/rides/${ride.id}/settle`)
      .set('authorization', d.auth)
      .expect(201);
    const balanceAfterFirst = (await driverRow(d.id)).balanceCents;

    // A retrying client must not have to distinguish "I settled it" from "it was
    // already settled" — so this is a success-shaped answer, never a 409.
    const second = await http
      .post(`/rides/${ride.id}/settle`)
      .set('authorization', d.auth)
      .expect(201);
    // Cast at the boundary like the lifecycle spec does — supertest types the
    // body `any`, and the shape assertion is the point.
    expect((second.body as { ride: { status: string } }).ride.status).toBe(
      'settled',
    );

    expect(ctx.payments.calls).toHaveLength(1);
    expect(await ledger.findByRide(ride.id)).toHaveLength(6);
    expect((await driverRow(d.id)).balanceCents).toBe(balanceAfterFirst);
  });

  /** (failure) A card ride whose rider never enrolled is refused, not invented. */
  it('refuses a card ride for a rider with no payment instrument (AC #3)', async () => {
    const d = await onlineDriver(7, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(55, false); // #17 is what fills the refs
    const ride = await completedRide(r.auth, d, 'card');

    await http
      .post(`/rides/${ride.id}/settle`)
      .set('authorization', d.auth)
      .expect(409);

    expect(ctx.payments.calls).toHaveLength(0);
    expect((await rideRow(ride.id)).status).toBe('completed');
    expect(await ledger.findByRide(ride.id)).toHaveLength(0);
  });

  /** (failure) A rider does not settle their own ride — pinned at THIS route. */
  it('refuses a rider at the settle route with 403 (failure)', async () => {
    // `RolesGuard`'s own spec proves the mechanism generically, but nothing
    // pinned this route's `@Roles` list. The rider owns this ride, so a 403 is
    // about the ROLE, not about ownership.
    //
    // THE MESSAGE IS THE ASSERTION, not the status code. Two layers refuse a
    // rider here and BOTH answer 403 — `RolesGuard` with `insufficient_role`,
    // and `SETTLEMENT_ACTORS`' `null` arm one layer down with
    // `role_cannot_settle`. Against `.expect(403)` alone this test stays green
    // when `'rider'` is added to `@Roles`, which is the one edit it exists to
    // catch (verified by making that edit). `insufficient_role` is reachable
    // only from the guard, so asserting it is what pins the decorator list.
    const d = await onlineDriver(8, near(CENTRE_PICKUP.location, 0.001, 0));
    const r = await rider(56);
    const ride = await completedRide(r.auth, d, 'card');

    // Cast at the boundary like the idempotency case above — supertest types
    // the body `any`, and the shape assertion is the point.
    const refused = await http
      .post(`/rides/${ride.id}/settle`)
      .set('authorization', r.auth)
      .expect(403);
    expect((refused.body as { message: string }).message).toBe(
      'insufficient_role',
    );

    expect(ctx.payments.calls).toHaveLength(0);
    expect((await rideRow(ride.id)).status).toBe('completed');
    expect(await ledger.findByRide(ride.id)).toHaveLength(0);
  });

  /** Every settlement transaction in the database balances. A standing invariant. */
  it('leaves every settlement transaction summing to zero (AC #1)', async () => {
    const all = await ctx.db
      .select({
        transactionId: ledgerEntries.transactionId,
        amountCents: ledgerEntries.amountCents,
      })
      .from(ledgerEntries);

    const byTransaction = new Map<string, number>();
    for (const entry of all) {
      byTransaction.set(
        entry.transactionId,
        (byTransaction.get(entry.transactionId) ?? 0) + entry.amountCents,
      );
    }

    expect([...byTransaction.values()].every((sum) => sum === 0)).toBe(true);
  });
});
