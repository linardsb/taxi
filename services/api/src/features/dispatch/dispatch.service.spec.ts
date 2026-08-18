import { ConflictException, Logger } from '@nestjs/common';
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
import { DispatchNotifier } from './dispatch-notifier';
import { MAX_OFFER_ATTEMPTS } from './dispatch.policy';
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
    /** Cascade attempts already made on the ride, as `countAttempts` reports them. */
    attempts?: number;
    /** When the ride last re-entered the pool by a dispatcher release (#19). */
    lastReleasedAt?: Date | null;
    /** `false` models a force-assigned OFFLINE driver: ordinary, never a throw. */
    claimDriver?: boolean;
    /** What the drivers slice reports for the accepted driver at warn time. */
    driverStatus?: 'offline' | 'on_ride';
  } = {},
) {
  /**
   * `events` is the ORDERING LEDGER, the same mechanism the lifecycle spec
   * uses: the transaction fake brackets the callback and the writes append to
   * it, so "inside the transaction" is a position in an array rather than an
   * `expect.anything()` that a tx object and a stray `{}` both satisfy.
   */
  const events: string[] = [];

  // Every write below is a fake, so there is nothing to roll back — what
  // matters is WHICH calls happen and in what order relative to the emits.
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      events.push('tx:begin');
      const result = await fn({});
      events.push('tx:commit');
      return result;
    },
  } as unknown as Db;

  const insertAudit = jest.fn(() => Promise.resolve());
  const revokePendingForRide = jest.fn(() =>
    Promise.resolve(over.revoked ?? []),
  );
  const countAttempts = jest.fn(() => Promise.resolve(over.attempts ?? 0));
  const findLastReleasedAt = jest.fn(() =>
    Promise.resolve(over.lastReleasedAt ?? null),
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
    countAttempts,
    findLastReleasedAt,
    findDriverIdsWithLiveOffers: jest.fn(() => Promise.resolve([])),
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

  const claimDriver = jest.fn(() => {
    events.push('claim');
    return Promise.resolve(over.claimDriver ?? true);
  });
  const lifecycle = { claimDriver } as unknown as RideLifecycleService;

  const emitToRide = jest.fn(() => {
    events.push('emit:assigned');
  });
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
      findMatchAttributes: () =>
        Promise.resolve(
          over.driverStatus
            ? [{ driverId: DRIVER_ID, status: over.driverStatus }]
            : [],
        ),
    } as unknown as DriversService,
    realtime,
    new DispatchNotifier(realtime, transitions),
    new InMemoryDispatchQueueStore(),
    kv,
    { DEFAULT_CITY_ID: CITY } as Env,
  );

  return {
    service,
    events,
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
    countAttempts,
    findLastReleasedAt,
  };
}

describe('DispatchService', () => {
  // A logger spy left installed by a throwing test would silence every suite
  // after it, so restoring is the suite's job rather than each test's.
  afterEach(() => jest.restoreAllMocks());

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
      const { service, claimDriver, events } = build();

      await service.accept(DRIVER_ID, OFFER_ID);

      // Without this the driver stays `online`, `candidate-filter.ts` keeps
      // them in the pool, and the next tick offers them a second car.
      expect(claimDriver).toHaveBeenCalledWith(expect.anything(), DRIVER_ID);
      // INSIDE, asserted by position: the claim must roll back with the
      // assignment. `expect.anything()` on the tx argument would pass just as
      // happily with the claim moved out of the transaction entirely.
      expect(events).toEqual([
        'tx:begin',
        'claim',
        'tx:commit',
        'emit:assigned',
      ]);
    });

    it('still assigns when the claim matches no online driver (edge)', async () => {
      const { service, insertAudit, events } = build({ claimDriver: false });

      // The ordinary outcome for a driver Dina overrode onto a ride while
      // offline. Throwing here would break the S9-2 override.
      await expect(service.accept(DRIVER_ID, OFFER_ID)).resolves.toEqual({
        rideId: RIDE_ID,
      });
      expect(insertAudit).toHaveBeenCalled();
      // Still committed, still emitted — a missed claim is logged, not fatal.
      expect(events).toEqual([
        'tx:begin',
        'claim',
        'tx:commit',
        'emit:assigned',
      ]);
    });

    it('warns when the claim misses, so the hole is observable (edge)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { service } = build({
        claimDriver: false,
        driverStatus: 'offline',
      });

      await service.accept(DRIVER_ID, OFFER_ID);

      // A driver whose socket dropped mid-offer accepts without ever being
      // marked `on_ride`, and can then go `online` again mid-ride. Not closed
      // here — see the dispatch KNOWN GAPS — but no longer silent. The warn
      // also fires on the double-commit seam, so `driverStatus` carries the
      // driver's current status: `offline` here reads as this benign
      // disconnect, `on_ride` would read as the seam.
      const payloads = (
        warn.mock.calls as unknown as [Record<string, unknown>][]
      ).map(([payload]) => payload);
      expect(
        payloads.find(
          (payload) => payload.event === 'dispatch.assign.driver_not_claimed',
        ),
      ).toMatchObject({
        rideId: RIDE_ID,
        driverId: DRIVER_ID,
        driverStatus: 'offline',
        offerId: OFFER_ID,
      });
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

  describe('offerNext — the cascade budget after a release (#19, #120 review H3)', () => {
    it('counts attempts only since the ride was released (expected)', async () => {
      const pooledSince = new Date('2026-08-17T10:00:00.000Z');
      const t = build({ lastReleasedAt: pooledSince });

      await t.service.offerNext(awaitingRide());

      // THIS is the assertion H3 is about. `offerNext` gates on the count, so
      // an unscoped read here is the whole defect regardless of what the
      // repository can do — the sweeper's own call and the repository test both
      // pass with this line reverted.
      expect(t.findLastReleasedAt).toHaveBeenCalledWith(RIDE_ID);
      expect(t.countAttempts).toHaveBeenCalledWith(RIDE_ID, pooledSince);
    });

    it('passes the pooled-since through to the unclaimed alert at the cap (edge)', async () => {
      const pooledSince = new Date('2026-08-17T10:00:00.000Z');
      const t = build({
        lastReleasedAt: pooledSince,
        attempts: MAX_OFFER_ATTEMPTS,
      });
      const ride = awaitingRide();

      await t.service.offerNext(ride);

      // Or Dina's alert reports time-since-booking on a ride that was released
      // seconds ago (M3), on the one path that reaches the alert from here.
      expect(t.emitToDispatch).toHaveBeenCalledWith(
        CITY,
        'dispatch:unclaimed',
        expect.objectContaining({ rideId: RIDE_ID }),
      );
      expect(t.countAttempts).toHaveBeenCalledWith(RIDE_ID, pooledSince);
    });

    it('reads the whole history for a ride that was never released (edge)', async () => {
      const t = build({ lastReleasedAt: null });

      await t.service.offerNext(awaitingRide());

      // The ordinary booking: `null` means the cap counts every offer ever
      // made, which is the pre-#19 behaviour and must not change.
      expect(t.countAttempts).toHaveBeenCalledWith(RIDE_ID, null);
    });
  });

  describe('raiseUnclaimed', () => {
    it('alerts Dina once and stays silent on repeat ticks (expected + edge)', async () => {
      const { service, emitToDispatch, incrWithTtl } = build({ incrResult: 1 });
      const ride = awaitingRide();

      // `null` = never released, so the clock runs from the booking.
      await service.raiseUnclaimed(ride, 2, null);

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

      await service.raiseUnclaimed(awaitingRide(), 2, null);

      expect(emitToDispatch).not.toHaveBeenCalled();
    });
  });
});
