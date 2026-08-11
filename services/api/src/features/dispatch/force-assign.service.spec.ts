import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Db } from '@taxi/db';
import {
  rideRequestSchema,
  type FareQuote,
  type PlatformConfig,
} from '@taxi/shared';
import type { Env } from '../../common/config/env.schema';
import type { DriverMatchAttributes, DriversService } from '../drivers';
import type { PlatformConfigService } from '../platform-config';
import type { RealtimeService } from '../realtime';
import type {
  RideLifecycleService,
  RidesRepository,
  RideTransitionService,
  TransitionedRide,
} from '../rides';
import { DispatchNotifier, type RevokedRef } from './dispatch-notifier';
import type { DispatchRepository } from './dispatch.repository';
import { ForceAssignService } from './force-assign.service';

const CITY = '00000000-0000-4000-8000-000000000001';
const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const DRIVER_ID = 'd0000000-0000-4000-8000-000000000001';
const DISPATCHER_ID = 'a0000000-0000-4000-8000-000000000001';
const OTHER_DRIVER = 'd0000000-0000-4000-8000-000000000002';
const OTHER_OFFER = '8d7c6b5a-4938-4271-8615-4a3b2c1d0e9f';

// `buildOffer` runs for REAL in this spec (it is the audit-trail write), so the
// request/quote/config fixtures must parse and split consistently.
const request = () =>
  rideRequestSchema.parse({
    riderId: '5a5a5a5a-1111-4222-8333-444444444444',
    pickup: { location: { lat: 56.9512, lng: 24.1136 }, address: 'Brīvības 1' },
    destination: { location: { lat: 56.9236, lng: 23.9711 }, address: 'RIX' },
    paymentMethod: 'cash',
  });

/** €13.00 — the seeded centre→RIX fare. */
const quote: FareQuote = {
  model: 'upfront_fixed',
  currency: 'EUR',
  totalCents: 1_300,
  breakdown: {
    baseCents: 200,
    distanceCents: 840,
    timeCents: 260,
    discountCents: 0,
  },
};

// OFFLINE on purpose: the override is deliberately not filtered through the
// eligibility rules, so the fixture driver is one the cascade would never pick.
const attrs = (): DriverMatchAttributes => ({
  driverId: DRIVER_ID,
  status: 'offline',
  isFemale: null,
  balanceCents: 0,
  commissionPctOverride: null,
  categories: ['standard'],
  hasChildSeat: false,
  maxPassengerSeats: 4,
});

const offeredRide: TransitionedRide = {
  id: RIDE_ID,
  orderId: '11111111-2222-4333-8444-555555555555',
  status: 'offered',
  riderId: '99999999-8888-4777-8666-555555555555',
  driverId: null,
  geozoneId: null,
  createdAt: new Date('2026-08-05T10:00:00.000Z'),
};
const acceptedRide: TransitionedRide = { ...offeredRide, status: 'accepted' };

const input = () => ({
  dispatcherId: DISPATCHER_ID,
  rideId: RIDE_ID,
  driverId: DRIVER_ID,
  reason: 'VIP regular',
});

function build(
  over: {
    /** `undefined` models an unknown or never-quoted ride. */
    found?: { ride: { request: ReturnType<typeof request> }; quote: FareQuote };
    /** `[]` models an unknown driver. */
    driverAttrs?: DriverMatchAttributes[];
    /** First hop. `undefined` = the ride was NOT in `requested` (mid-cascade). */
    hopToOffered?: TransitionedRide;
    /** The guard hop. `undefined` = never assignable → 409. */
    hopToAccepted?: TransitionedRide;
    assignDriver?: boolean;
    /** `false` models the force-assigned OFFLINE driver: ordinary, never a throw. */
    claimDriver?: boolean;
    revoked?: RevokedRef[];
  } = {},
) {
  // The same ordering ledger the DispatchService spec uses: "inside the
  // transaction" is a position in this array, not an `expect.anything()`.
  const events: string[] = [];

  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      events.push('tx:begin');
      const result = await fn({});
      events.push('tx:commit');
      return result;
    },
  } as unknown as Db;

  const insertOffer = jest.fn(() => Promise.resolve());
  const insertAudit = jest.fn(() => Promise.resolve());
  const revokePendingForRide = jest.fn(() =>
    Promise.resolve(over.revoked ?? []),
  );
  const offers = {
    insertOffer,
    insertAudit,
    revokePendingForRide,
  } as unknown as DispatchRepository;

  const assignDriver = jest.fn(() =>
    Promise.resolve(over.assignDriver ?? true),
  );
  const findWithQuote = jest.fn(() =>
    Promise.resolve(
      'found' in over ? over.found : { ride: { request: request() }, quote },
    ),
  );
  const rides = { findWithQuote, assignDriver } as unknown as RidesRepository;

  const emitStatus = jest.fn();
  // The two hops are told apart by their `from` argument, so each can miss
  // independently — that pair of misses is exactly what this spec pins.
  const transitionInTx = jest.fn(
    (_tx: unknown, _rideId: string, from: string) =>
      Promise.resolve(
        from === 'requested'
          ? 'hopToOffered' in over
            ? over.hopToOffered
            : offeredRide
          : 'hopToAccepted' in over
            ? over.hopToAccepted
            : acceptedRide,
      ),
  );
  const transitions = {
    transitionInTx,
    emitStatus,
  } as unknown as RideTransitionService;

  const claimDriver = jest.fn(() => {
    events.push('claim');
    return Promise.resolve(over.claimDriver ?? true);
  });
  const lifecycle = { claimDriver } as unknown as RideLifecycleService;

  const emitToRide = jest.fn(() => {
    events.push('emit:assigned');
  });
  const emitToDriver = jest.fn();
  const realtime = {
    emitToRide,
    emitToDriver,
    joinRideRoom: jest.fn(),
  } as unknown as RealtimeService;

  const service = new ForceAssignService(
    db,
    offers,
    rides,
    transitions,
    lifecycle,
    {
      forCity: () =>
        Promise.resolve({
          commissionPct: 15,
          offerTimeoutSeconds: 20,
        } as PlatformConfig),
    } as unknown as PlatformConfigService,
    {
      findMatchAttributes: jest.fn(() =>
        Promise.resolve(over.driverAttrs ?? [attrs()]),
      ),
    } as unknown as DriversService,
    new DispatchNotifier(realtime, transitions),
    { DEFAULT_CITY_ID: CITY } as Env,
  );

  return {
    service,
    events,
    insertOffer,
    insertAudit,
    assignDriver,
    transitionInTx,
    emitStatus,
    emitToRide,
    emitToDriver,
  };
}

describe('ForceAssignService', () => {
  it('walks requested → offered → accepted and emits like a normal accept (expected)', async () => {
    const {
      service,
      transitionInTx,
      insertOffer,
      insertAudit,
      assignDriver,
      emitStatus,
      emitToRide,
      events,
    } = build();

    await expect(service.forceAssign(input())).resolves.toEqual({
      rideId: RIDE_ID,
    });

    // `requested → accepted` is not a legal transition: the override takes the
    // same two hops the cascade would, never a direct status write.
    expect(transitionInTx).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      RIDE_ID,
      'requested',
      'offered',
    );
    expect(transitionInTx).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      RIDE_ID,
      'offered',
      'accepted',
    );

    // The audit trail records what Dina put in front of the driver: an
    // already-accepted dispatcher offer, ETA 0 because nothing was ranked.
    expect(insertOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        rideId: RIDE_ID,
        driverId: DRIVER_ID,
        status: 'accepted',
        source: 'dispatcher',
        etaSeconds: 0,
      }),
      expect.anything(),
    );
    expect(insertAudit).toHaveBeenCalledWith(
      {
        rideId: RIDE_ID,
        driverId: DRIVER_ID,
        source: 'dispatcher',
        dispatcherId: DISPATCHER_ID,
        reason: 'VIP regular',
      },
      expect.anything(),
    );
    expect(assignDriver).toHaveBeenCalledWith(
      RIDE_ID,
      DRIVER_ID,
      expect.anything(),
    );

    // #15's driver app receives the same `ride:assigned` a normal accept
    // sends — no client special case — and the status event carries the TRUE
    // previous status the first hop bookkept.
    expect(emitStatus).toHaveBeenCalledWith(acceptedRide, 'requested');
    expect(emitToRide).toHaveBeenCalledWith(
      RIDE_ID,
      'ride:assigned',
      expect.objectContaining({
        rideId: RIDE_ID,
        driverId: DRIVER_ID,
        source: 'dispatcher',
        dispatcherId: DISPATCHER_ID,
      }),
    );

    // Claim inside the transaction, every emit strictly post-commit.
    expect(events).toEqual(['tx:begin', 'claim', 'tx:commit', 'emit:assigned']);
  });

  it('books from=offered mid-cascade and clears the overridden card (edge)', async () => {
    const { service, emitStatus, emitToDriver } = build({
      hopToOffered: undefined, // a driver is already holding a live offer
      revoked: [{ offerId: OTHER_OFFER, driverId: OTHER_DRIVER }],
    });

    await expect(service.forceAssign(input())).resolves.toEqual({
      rideId: RIDE_ID,
    });

    // The first hop matched nothing, so the status event must say the ride
    // came from `offered` — claiming `requested` would rewind the timeline.
    expect(emitStatus).toHaveBeenCalledWith(acceptedRide, 'offered');
    // The driver Dina overrode must see their card clear.
    expect(emitToDriver).toHaveBeenCalledWith(
      OTHER_DRIVER,
      'ride:offer_revoked',
      expect.objectContaining({ offerId: OTHER_OFFER, reason: 'taken' }),
    );
  });

  it('still assigns when the claim matches no online driver (edge)', async () => {
    const { service, events } = build({ claimDriver: false });

    // Overriding onto an OFFLINE driver is the feature (S9-2): the missed
    // claim is the ordinary outcome, never a throw.
    await expect(service.forceAssign(input())).resolves.toEqual({
      rideId: RIDE_ID,
    });
    expect(events).toEqual(['tx:begin', 'claim', 'tx:commit', 'emit:assigned']);
  });

  it('409s ride_not_assignable when the guard hop matches nothing (failure)', async () => {
    const { service, insertOffer, emitToRide, emitStatus } = build({
      hopToOffered: undefined,
      hopToAccepted: undefined, // already accepted, cancelled, or gone
    });

    const attempt = service.forceAssign(input());
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow('ride_not_assignable');

    // The guard fired inside the transaction: no offer row, nothing on a phone.
    expect(insertOffer).not.toHaveBeenCalled();
    expect(emitToRide).not.toHaveBeenCalled();
    expect(emitStatus).not.toHaveBeenCalled();
  });

  it('409s ride_already_assigned when another driver holds the ride (failure)', async () => {
    const { service, emitToRide, emitStatus } = build({ assignDriver: false });

    const attempt = service.forceAssign(input());
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow('ride_already_assigned');

    expect(emitToRide).not.toHaveBeenCalled();
    expect(emitStatus).not.toHaveBeenCalled();
  });

  it('404s before the transaction for an unknown ride or driver (failure)', async () => {
    const missingRide = build({ found: undefined });
    await expect(
      missingRide.service.forceAssign(input()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(missingRide.events).toEqual([]);

    const missingDriver = build({ driverAttrs: [] });
    await expect(
      missingDriver.service.forceAssign(input()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(missingDriver.events).toEqual([]);
  });
});
