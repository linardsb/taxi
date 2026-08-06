import { ConflictException } from '@nestjs/common';
import type { Db } from '@taxi/db';
import type { Env } from '../../common/config/env.schema';
import type { KeyValueStore } from '../../common/kv/kv.store';
import type { DriversService } from '../drivers';
import type { GeozonesService } from '../geozones';
import type { PlatformConfigService } from '../platform-config';
import type { RealtimeService } from '../realtime';
import type {
  AwaitingRide,
  RideLifecycleService,
  RidesRepository,
  RideTransitionService,
  TransitionedRide,
} from '../rides';
import type { DispatchRepository, OfferRef } from './dispatch.repository';
import { DispatchService } from './dispatch.service';
import { InMemoryDispatchQueueStore } from './queue/in-memory-dispatch-queue.store';
import type { DispatchStrategyResolver } from './strategies/dispatch-strategy.resolver';

const CITY = '00000000-0000-4000-8000-000000000001';
const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const OFFER_ID = '7c6b5a49-3827-4160-9504-3f2e1d0c9b8a';
const DRIVER_ID = 'd0000000-0000-4000-8000-000000000001';
const OTHER_DRIVER = 'd0000000-0000-4000-8000-000000000002';
const OTHER_OFFER = '8d7c6b5a-4938-4271-8615-4a3b2c1d0e9f';

const transitioned: TransitionedRide = {
  id: RIDE_ID,
  orderId: '11111111-2222-4333-8444-555555555555',
  status: 'accepted',
  riderId: '99999999-8888-4777-8666-555555555555',
  driverId: null,
  geozoneId: null,
  createdAt: new Date('2026-08-05T10:00:00.000Z'),
};

const offerRef = (over: Partial<OfferRef> = {}): OfferRef => ({
  id: OFFER_ID,
  rideId: RIDE_ID,
  driverId: DRIVER_ID,
  status: 'accepted',
  source: 'auto_match',
  queuePosition: null,
  ...over,
});

const awaitingRide = (over: Partial<AwaitingRide> = {}): AwaitingRide =>
  ({
    id: RIDE_ID,
    orderId: transitioned.orderId,
    riderId: transitioned.riderId,
    geozoneId: null,
    request: {
      pickup: { location: { lat: 56.95, lng: 24.11 }, address: 'Brīvības 1' },
    },
    createdAt: new Date(),
    ...over,
  }) as AwaitingRide;

function build(
  over: {
    acceptOffer?: OfferRef | undefined;
    transition?: TransitionedRide | undefined;
    assignDriver?: boolean;
    revoked?: { offerId: string; driverId: string }[];
    incrResult?: number;
    /** `false` models a force-assigned OFFLINE driver: ordinary, never a throw. */
    claimDriver?: boolean;
  } = {},
) {
  // A transaction that simply runs the callback: every write below is a fake,
  // so there is nothing to roll back — what matters is WHICH calls happen and
  // in what order relative to the emits.
  const db = {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  } as unknown as Db;

  const insertAudit = jest.fn(() => Promise.resolve());
  const revokePendingForRide = jest.fn(() =>
    Promise.resolve(over.revoked ?? []),
  );
  const offers = {
    acceptOffer: jest.fn(() =>
      Promise.resolve('acceptOffer' in over ? over.acceptOffer : offerRef()),
    ),
    declineOffer: jest.fn(() =>
      Promise.resolve(offerRef({ status: 'declined' })),
    ),
    insertAudit,
    revokePendingForRide,
    insertOffer: jest.fn(() => Promise.resolve()),
    countAttempts: jest.fn(() => Promise.resolve(0)),
    findTriedDriverIds: jest.fn(() => Promise.resolve([])),
  } as unknown as DispatchRepository;

  const assignDriver = jest.fn(() =>
    Promise.resolve(over.assignDriver ?? true),
  );
  const rides = {
    assignDriver,
    findWithQuote: jest.fn(() => Promise.resolve(undefined)),
    setGeozone: jest.fn(() => Promise.resolve()),
  } as unknown as RidesRepository;

  const emitStatus = jest.fn();
  const transitionInTx = jest.fn(() =>
    Promise.resolve('transition' in over ? over.transition : transitioned),
  );
  const transition = jest.fn(() => Promise.resolve(transitioned));
  const transitions = {
    transitionInTx,
    transition,
    emitStatus,
  } as unknown as RideTransitionService;

  const claimDriver = jest.fn(() => Promise.resolve(over.claimDriver ?? true));
  const lifecycle = { claimDriver } as unknown as RideLifecycleService;

  const emitToRide = jest.fn();
  const emitToDriver = jest.fn();
  const emitToDispatch = jest.fn();
  const realtime = {
    emitToRide,
    emitToDriver,
    emitToDispatch,
    joinRideRoom: jest.fn(),
  } as unknown as RealtimeService;

  const incrWithTtl = jest.fn(() => Promise.resolve(over.incrResult ?? 1));
  const kv = { incrWithTtl } as unknown as KeyValueStore;

  const service = new DispatchService(
    db,
    offers,
    rides,
    transitions,
    lifecycle,
    {
      resolveForPoint: () => Promise.resolve(undefined),
    } as unknown as GeozonesService,
    { forCity: () => Promise.resolve({}) } as unknown as PlatformConfigService,
    {} as DispatchStrategyResolver,
    {
      findMatchAttributes: () => Promise.resolve([]),
    } as unknown as DriversService,
    realtime,
    new InMemoryDispatchQueueStore(),
    kv,
    { DEFAULT_CITY_ID: CITY } as Env,
  );

  return {
    service,
    offers,
    insertAudit,
    revokePendingForRide,
    assignDriver,
    claimDriver,
    transitionInTx,
    transition,
    emitStatus,
    emitToRide,
    emitToDriver,
    emitToDispatch,
    incrWithTtl,
  };
}

describe('DispatchService', () => {
  describe('accept', () => {
    it('writes the audit row, revokes siblings and emits ride:assigned (expected)', async () => {
      const { service, insertAudit, assignDriver, emitToRide, emitToDriver } =
        build({
          revoked: [{ offerId: OTHER_OFFER, driverId: OTHER_DRIVER }],
        });

      await expect(service.accept(DRIVER_ID, OFFER_ID)).resolves.toEqual({
        rideId: RIDE_ID,
      });

      expect(insertAudit).toHaveBeenCalledWith(
        { rideId: RIDE_ID, driverId: DRIVER_ID, source: 'auto_match' },
        expect.anything(),
      );
      // `rides.driver_id` is written ONLY here — never alongside the status.
      expect(assignDriver).toHaveBeenCalledWith(
        RIDE_ID,
        DRIVER_ID,
        expect.anything(),
      );

      expect(emitToRide).toHaveBeenCalledWith(
        RIDE_ID,
        'ride:assigned',
        expect.objectContaining({
          rideId: RIDE_ID,
          driverId: DRIVER_ID,
          source: 'auto_match',
          dispatcherId: null,
        }),
      );

      // The losing driver's card clears — the only consumer of
      // `revokePendingForRide`'s returned pairs.
      expect(emitToDriver).toHaveBeenCalledWith(
        OTHER_DRIVER,
        'ride:offer_revoked',
        expect.objectContaining({ offerId: OTHER_OFFER, reason: 'taken' }),
      );
    });

    it('claims the driver on_ride inside the transaction (expected)', async () => {
      const { service, claimDriver } = build();

      await service.accept(DRIVER_ID, OFFER_ID);

      // Without this the driver stays `online`, `candidate-filter.ts` keeps
      // them in the pool, and the next tick offers them a second car.
      expect(claimDriver).toHaveBeenCalledWith(expect.anything(), DRIVER_ID);
    });

    it('still assigns when the claim matches no online driver (edge)', async () => {
      const { service, insertAudit } = build({ claimDriver: false });

      // The ordinary outcome for a driver Dina overrode onto a ride while
      // offline. Throwing here would break the S9-2 override.
      await expect(service.accept(DRIVER_ID, OFFER_ID)).resolves.toEqual({
        rideId: RIDE_ID,
      });
      expect(insertAudit).toHaveBeenCalled();
    });

    it('409s and transitions nothing when another driver already took it (edge)', async () => {
      const { service, transitionInTx, emitToRide, emitStatus } = build({
        acceptOffer: undefined, // the conditional UPDATE matched no row
      });

      await expect(service.accept(DRIVER_ID, OFFER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(transitionInTx).not.toHaveBeenCalled();
      // Nothing reached any phone: every emit is post-commit, so a rolled-back
      // accept leaves no trace.
      expect(emitToRide).not.toHaveBeenCalled();
      expect(emitStatus).not.toHaveBeenCalled();
    });

    it('409s without emitting when the ride is no longer offered (edge)', async () => {
      const { service, emitToRide, emitToDriver, emitStatus } = build({
        transition: undefined,
      });

      await expect(service.accept(DRIVER_ID, OFFER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(emitToRide).not.toHaveBeenCalled();
      expect(emitToDriver).not.toHaveBeenCalled();
      expect(emitStatus).not.toHaveBeenCalled();
    });

    it('409s without emitting when the ride was assigned a moment earlier (failure)', async () => {
      const { service, emitToRide, emitStatus } = build({
        assignDriver: false,
      });

      await expect(service.accept(DRIVER_ID, OFFER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(emitToRide).not.toHaveBeenCalled();
      expect(emitStatus).not.toHaveBeenCalled();
    });
  });

  describe('decline', () => {
    it('sends no ride:offer_revoked to the decliner (expected)', async () => {
      const { service, emitToDriver, transition } = build();

      await service.decline(DRIVER_ID, OFFER_ID);

      // None of `expired | taken | cancelled` describes "you declined this
      // yourself"; `cancelled` would read as the RIDER cancelling.
      expect(emitToDriver).not.toHaveBeenCalled();
      expect(transition).toHaveBeenCalledWith(RIDE_ID, 'offered', 'requested');
    });

    it('409s on a double-tapped decline (failure)', async () => {
      const { service, offers } = build();
      (offers.declineOffer as jest.Mock).mockResolvedValue(undefined);

      await expect(service.decline(DRIVER_ID, OFFER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('raiseUnclaimed', () => {
    it('alerts Dina once and stays silent on repeat ticks (expected + edge)', async () => {
      const { service, emitToDispatch, incrWithTtl } = build({ incrResult: 1 });
      const ride = awaitingRide();

      await service.raiseUnclaimed(ride, 2);

      expect(emitToDispatch).toHaveBeenCalledWith(
        CITY,
        'dispatch:unclaimed',
        expect.objectContaining({ rideId: RIDE_ID, offerAttempts: 2 }),
      );
      // The dedupe is the atomic first-writer trick, not a GET-then-SET.
      expect(incrWithTtl).toHaveBeenCalledTimes(1);
    });

    it('emits nothing when the dedupe key already exists (edge)', async () => {
      // At one tick per second this is the difference between one alert and 60
      // a minute for the same stale order.
      const { service, emitToDispatch } = build({ incrResult: 2 });

      await service.raiseUnclaimed(awaitingRide(), 2);

      expect(emitToDispatch).not.toHaveBeenCalled();
    });
  });
});
