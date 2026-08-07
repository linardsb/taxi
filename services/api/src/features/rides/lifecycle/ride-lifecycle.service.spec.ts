import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Db } from '@taxi/db';
import type { FareSplit, Ride, RideStatus } from '@taxi/shared';
import type { DriversService } from '../../drivers';
import type { RealtimeService } from '../../realtime';
import type { RideTransitionService, TransitionedRide } from '../index';
import type { RidesRepository } from '../rides.repository';
import type {
  LifecycleRide,
  RideLifecycleRepository,
} from './ride-lifecycle.repository';
import { RideLifecycleService } from './ride-lifecycle.service';

const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const ORDER_ID = '11111111-2222-4333-8444-555555555555';
const RIDER_ID = '99999999-8888-4777-8666-555555555555';
const DRIVER_ID = 'd0000000-0000-4000-8000-000000000001';
const OTHER_DRIVER = 'd0000000-0000-4000-8000-000000000002';
const OFFER_ID = '7c6b5a49-3827-4160-9504-3f2e1d0c9b8a';
const DISPATCHER_ID = 'a1111111-2222-4333-8444-555555555555';

/** What a rider actually types into a cancellation box. */
const PII_REASON = 'waiting at Brīvības iela 42, call me on 26123456';

const TOTAL_CENTS = 1_000;

const split = (over: Partial<FareSplit> = {}): FareSplit => ({
  currency: 'EUR',
  totalCents: TOTAL_CENTS,
  commissionPct: 15,
  commissionSource: 'platform_base',
  commissionCents: 150,
  driverNetCents: 850,
  ...over,
});

const lifecycleRide = (over: Partial<LifecycleRide> = {}): LifecycleRide => ({
  id: RIDE_ID,
  orderId: ORDER_ID,
  status: 'accepted',
  riderId: RIDER_ID,
  driverId: DRIVER_ID,
  totalCents: TOTAL_CENTS,
  ...over,
});

const transitioned = (status: RideStatus): TransitionedRide => ({
  id: RIDE_ID,
  orderId: ORDER_ID,
  status,
  riderId: RIDER_ID,
  driverId: DRIVER_ID,
  geozoneId: null,
  createdAt: new Date('2026-08-05T10:00:00.000Z'),
});

/**
 * Hand-rolled fakes for all five collaborators — no database, no app.
 *
 * `events` is the ORDERING LEDGER: every fake appends to it, so a test can
 * assert that no emit happened before the transaction resolved. That is the
 * "no socket emit inside a database transaction" rule under test rather than
 * merely under review.
 */
function build(
  over: {
    ride?: LifecycleRide | undefined;
    offerSplit?: FareSplit | undefined;
    transitioned?: TransitionedRide | undefined;
    revoked?: { offerId: string; driverId: string }[];
    paymentUpdated?: boolean;
    found?: { ride: Ride } | undefined;
  } = {},
) {
  const events: string[] = [];

  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      events.push('tx:begin');
      const result = await fn({});
      events.push('tx:commit');
      return result;
    },
  } as unknown as Db;

  const findForAction = jest.fn(() =>
    Promise.resolve('ride' in over ? over.ride : lifecycleRide()),
  );
  const findAcceptedOfferSplit = jest.fn(() =>
    Promise.resolve('offerSplit' in over ? over.offerSplit : split()),
  );
  const writeSettledSplit = jest.fn(() => {
    events.push('write:split');
    return Promise.resolve();
  });
  const updatePaymentMethod = jest.fn(() =>
    Promise.resolve(over.paymentUpdated ?? true),
  );
  const revokePendingOffers = jest.fn(() =>
    Promise.resolve(over.revoked ?? []),
  );
  const lifecycle = {
    findForAction,
    findAcceptedOfferSplit,
    writeSettledSplit,
    updatePaymentMethod,
    revokePendingOffers,
  } as unknown as RideLifecycleRepository;

  const findWithQuote = jest.fn(() =>
    Promise.resolve(
      'found' in over
        ? over.found
        : {
            ride: {
              id: RIDE_ID,
              quote: { totalCents: TOTAL_CENTS },
              split: split(),
            } as unknown as Ride,
            quote: { totalCents: TOTAL_CENTS },
          },
    ),
  );
  const rides = { findWithQuote } as unknown as RidesRepository;

  const resolveMoved = (to: RideStatus) =>
    'transitioned' in over ? over.transitioned : transitioned(to);

  const transitionInTx = jest.fn(
    (_tx: unknown, _id: string, _f, t: RideStatus) =>
      Promise.resolve(resolveMoved(t)),
  );
  const transition = jest.fn((_id: string, _f, t: RideStatus) => {
    events.push('transition');
    return Promise.resolve(resolveMoved(t));
  });
  const emitStatus = jest.fn(() => {
    events.push('emit:status');
  });
  const transitions = {
    transitionInTx,
    transition,
    emitStatus,
  } as unknown as RideTransitionService;

  const claimForRide = jest.fn(() => Promise.resolve(true));
  const releaseFromRide = jest.fn(() => {
    events.push('release');
    return Promise.resolve(true);
  });
  const drivers = {
    claimForRide,
    releaseFromRide,
  } as unknown as DriversService;

  const emitToDriver = jest.fn(() => {
    events.push('emit:revoked');
  });
  const realtime = { emitToDriver } as unknown as RealtimeService;

  const service = new RideLifecycleService(
    db,
    lifecycle,
    rides,
    transitions,
    drivers,
    realtime,
  );

  return {
    service,
    events,
    findForAction,
    findAcceptedOfferSplit,
    writeSettledSplit,
    updatePaymentMethod,
    revokePendingOffers,
    transitionInTx,
    transition,
    emitStatus,
    claimForRide,
    releaseFromRide,
    emitToDriver,
  };
}

describe('RideLifecycleService', () => {
  describe('driverStep', () => {
    it('advances an arriving ride to arrived (expected)', async () => {
      const { service, transition, emitStatus } = build({
        ride: lifecycleRide({ status: 'arriving' }),
      });

      await service.driverStep('arrived', DRIVER_ID, RIDE_ID);

      expect(transition).toHaveBeenCalledWith(RIDE_ID, 'arriving', 'arrived');
      // The convenience form emits for itself — the service must not double up.
      expect(emitStatus).not.toHaveBeenCalled();
    });

    it('403s a driver who is not on the ride (failure)', async () => {
      const { service, transition } = build({
        ride: lifecycleRide({ status: 'arrived', driverId: OTHER_DRIVER }),
      });

      await expect(
        service.driverStep('start', DRIVER_ID, RIDE_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transition).not.toHaveBeenCalled();
    });

    it('409s a start on a ride that never arrived (failure)', async () => {
      const { service, transition } = build({
        ride: lifecycleRide({ status: 'accepted' }),
      });

      await expect(
        service.driverStep('start', DRIVER_ID, RIDE_ID),
      ).rejects.toThrow('ride_not_arrived');
      expect(transition).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('settles from the accepted offer and emits only after the commit (expected)', async () => {
      const { service, events, writeSettledSplit, releaseFromRide } = build({
        ride: lifecycleRide({ status: 'in_progress' }),
      });

      await service.complete(DRIVER_ID, RIDE_ID);

      // The split is COPIED from the offer the driver accepted, never recomputed.
      expect(writeSettledSplit).toHaveBeenCalledWith(
        expect.anything(),
        RIDE_ID,
        split(),
      );
      expect(releaseFromRide).toHaveBeenCalledWith(
        DRIVER_ID,
        expect.anything(),
      );
      // THE ORDERING INVARIANT: every write inside the transaction, the emit
      // strictly after the commit. Socket.IO has no rollback.
      expect(events).toEqual([
        'tx:begin',
        'write:split',
        'release',
        'tx:commit',
        'emit:status',
      ]);
    });

    it('throws before opening a transaction when the split drifts from the fare (failure)', async () => {
      const { service, events, writeSettledSplit } = build({
        ride: lifecycleRide({ status: 'in_progress' }),
        offerSplit: split({
          totalCents: 999,
          commissionCents: 149,
          driverNetCents: 850,
        }),
      });

      await expect(service.complete(DRIVER_ID, RIDE_ID)).rejects.toThrow(
        /does not match the ride's totalCents/,
      );
      // Nothing was written, because nothing was ever begun.
      expect(events).toEqual([]);
      expect(writeSettledSplit).not.toHaveBeenCalled();
    });

    it('throws loudly when the accepted offer row is missing (failure)', async () => {
      const { service, events } = build({
        ride: lifecycleRide({ status: 'in_progress' }),
        offerSplit: undefined,
      });

      // Both assignment paths write exactly one accepted offer. Inventing a
      // split here would pay a driver a number nobody showed them.
      await expect(service.complete(DRIVER_ID, RIDE_ID)).rejects.toThrow(
        /no accepted ride_offers row/,
      );
      expect(events).toEqual([]);
    });

    /**
     * The in-transaction guard, which no integration test can reach
     * deterministically: it needs the prologue to pass and someone else to move
     * the ride before the conditional UPDATE runs.
     */
    it('409s and writes no split when the conditional UPDATE loses the race (failure)', async () => {
      const { service, events, writeSettledSplit, emitStatus } = build({
        ride: lifecycleRide({ status: 'in_progress' }),
        transitioned: undefined, // the UPDATE matched no row
      });

      await expect(service.complete(DRIVER_ID, RIDE_ID)).rejects.toThrow(
        'ride_transition_conflict',
      );

      // The throw is inside the transaction callback, so nothing commits and
      // nothing reaches a phone — a driver must never be settled twice.
      expect(writeSettledSplit).not.toHaveBeenCalled();
      expect(emitStatus).not.toHaveBeenCalled();
      expect(events).toEqual(['tx:begin']);
    });

    it('settles a 0% commission without a truthiness bug (edge — the S6-7 pilot case)', async () => {
      const { service, writeSettledSplit } = build({
        ride: lifecycleRide({ status: 'in_progress' }),
        offerSplit: split({
          commissionPct: 0,
          commissionSource: 'driver_override',
          commissionCents: 0,
          driverNetCents: TOTAL_CENTS,
        }),
      });

      await service.complete(DRIVER_ID, RIDE_ID);

      expect(writeSettledSplit).toHaveBeenCalledWith(
        expect.anything(),
        RIDE_ID,
        expect.objectContaining({
          commissionPct: 0,
          commissionCents: 0,
          driverNetCents: TOTAL_CENTS,
        }),
      );
    });
  });

  describe('cancel', () => {
    /**
     * The ONLY coverage `cancelled_by_system` gets: there is deliberately no
     * HTTP route for it — #12's payment-preauth failure is the caller that will
     * use it.
     */
    it('cancels a requested ride as the system and clears the pending card (edge)', async () => {
      const { service, events, transitionInTx, emitToDriver, releaseFromRide } =
        build({
          ride: lifecycleRide({ status: 'requested', driverId: null }),
          revoked: [{ offerId: OFFER_ID, driverId: OTHER_DRIVER }],
        });

      await service.cancel({
        rideId: RIDE_ID,
        actor: 'system',
        actorId: RIDER_ID,
        reason: 'payment preauth failed',
      });

      expect(transitionInTx).toHaveBeenCalledWith(
        expect.anything(),
        RIDE_ID,
        'requested',
        'cancelled_by_system',
      );
      // `reason: 'cancelled'` has been in the catalog since #2 with no
      // producer. This is it — and unlike a decline, here it is accurate.
      expect(emitToDriver).toHaveBeenCalledWith(
        OTHER_DRIVER,
        'ride:offer_revoked',
        expect.objectContaining({ offerId: OFFER_ID, reason: 'cancelled' }),
      );
      // No driver on the ride yet, so nothing to release.
      expect(releaseFromRide).not.toHaveBeenCalled();
      expect(events).toEqual([
        'tx:begin',
        'tx:commit',
        'emit:status',
        'emit:revoked',
      ]);
    });

    it('releases the driver when cancelling after acceptance (edge)', async () => {
      const { service, releaseFromRide, events } = build({
        ride: lifecycleRide({ status: 'arrived' }),
      });

      await service.cancel({
        rideId: RIDE_ID,
        actor: 'driver',
        actorId: DRIVER_ID,
        reason: null,
      });

      // One line, five release sites — and it is inside the transaction.
      expect(releaseFromRide).toHaveBeenCalledWith(
        DRIVER_ID,
        expect.anything(),
      );
      expect(events).toEqual([
        'tx:begin',
        'release',
        'tx:commit',
        'emit:status',
      ]);
    });

    it('409s a rider cancelling a ride already under way (failure)', async () => {
      const { service, transitionInTx, events } = build({
        ride: lifecycleRide({ status: 'in_progress' }),
      });

      // `in_progress` allows only `completed` and `cancelled_by_dispatcher`.
      await expect(
        service.cancel({
          rideId: RIDE_ID,
          actor: 'rider',
          actorId: RIDER_ID,
          reason: null,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(transitionInTx).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    it('409s the system cancelling a ride a driver already took (failure)', async () => {
      const { service, transitionInTx } = build({
        ride: lifecycleRide({ status: 'accepted' }),
      });

      // "system cancels only pre-acceptance states"
      // (`.claude/references/ride-state-machine.md`) — once a driver has the
      // job, ending it is a person's decision, not a timeout's.
      await expect(
        service.cancel({
          rideId: RIDE_ID,
          actor: 'system',
          actorId: RIDER_ID,
          reason: 'payment preauth failed',
        }),
      ).rejects.toThrow('ride_not_cancellable');
      expect(transitionInTx).not.toHaveBeenCalled();
    });

    it('403s a rider cancelling somebody else’s ride (failure)', async () => {
      const { service } = build({
        ride: lifecycleRide({ status: 'requested', riderId: OTHER_DRIVER }),
      });

      await expect(
        service.cancel({
          rideId: RIDE_ID,
          actor: 'rider',
          actorId: RIDER_ID,
          reason: null,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a dispatcher cancel a ride that is not theirs — that IS the override (edge)', async () => {
      const { service, transitionInTx } = build({
        ride: lifecycleRide({ status: 'in_progress' }),
      });

      await service.cancel({
        rideId: RIDE_ID,
        actor: 'dispatcher',
        actorId: OTHER_DRIVER,
        reason: 'caller changed their mind',
      });

      expect(transitionInTx).toHaveBeenCalledWith(
        expect.anything(),
        RIDE_ID,
        'in_progress',
        'cancelled_by_dispatcher',
      );
    });
  });

  describe('changePaymentMethod', () => {
    it('409s payment_method_locked once a driver has accepted (failure)', async () => {
      const { service, updatePaymentMethod } = build({
        paymentUpdated: false,
        ride: lifecycleRide({ status: 'accepted' }),
      });

      await expect(
        service.changePaymentMethod(RIDE_ID, RIDER_ID, 'card'),
      ).rejects.toThrow('payment_method_locked');
      // THE WRITE IS THE LOCK: it is attempted first and refused by its own
      // WHERE, so a concurrent accept cannot race it. The read that follows
      // only picks the error message.
      expect(updatePaymentMethod).toHaveBeenCalledWith(
        RIDE_ID,
        RIDER_ID,
        'card',
      );
    });

    /**
     * The masking is the load-bearing behaviour of the rejection branch, and
     * the ride here is BOTH somebody else's AND locked: a `payment_method_locked`
     * 409 would confirm the id exists just as loudly as a 403 would.
     */
    it('404s rather than 403s on somebody else’s ride — no id confirmation (failure)', async () => {
      const { service } = build({
        paymentUpdated: false,
        ride: lifecycleRide({ status: 'accepted', riderId: OTHER_DRIVER }),
      });

      const thrown = await service
        .changePaymentMethod(RIDE_ID, RIDER_ID, 'card')
        .catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(NotFoundException);
      expect(thrown).not.toBeInstanceOf(ForbiddenException);
      expect(thrown).not.toBeInstanceOf(ConflictException);
      expect((thrown as Error).message).toBe('ride_not_found');
    });

    it('409s ride_not_editable on a cancelled ride — over, not locked (edge)', async () => {
      const { service } = build({
        paymentUpdated: false,
        ride: lifecycleRide({ status: 'cancelled_by_rider' }),
      });

      await expect(
        service.changePaymentMethod(RIDE_ID, RIDER_ID, 'card'),
      ).rejects.toThrow('ride_not_editable');
    });

    it('changes the method while the ride is still unassigned (expected)', async () => {
      const { service, updatePaymentMethod } = build();

      const { ride } = await service.changePaymentMethod(
        RIDE_ID,
        RIDER_ID,
        'card',
      );

      expect(updatePaymentMethod).toHaveBeenCalledWith(
        RIDE_ID,
        RIDER_ID,
        'card',
      );
      expect(ride.id).toBe(RIDE_ID);
    });
  });

  describe('claimDriver', () => {
    it('delegates to the drivers slice so on_ride keeps one owner (expected)', async () => {
      const { service, claimForRide } = build();
      const tx = {} as never;

      await expect(service.claimDriver(tx, DRIVER_ID)).resolves.toBe(true);
      expect(claimForRide).toHaveBeenCalledWith(DRIVER_ID, tx);
    });
  });

  /**
   * The log payloads themselves, asserted rather than reviewed. Every rule
   * checked here is a line in `.claude/references/logging-standard.md`.
   */
  describe('logging', () => {
    /** Nest's logger is per-instance but shares the prototype methods. */
    const payloadsOf = (spy: jest.SpyInstance): Record<string, unknown>[] =>
      (spy.mock.calls as unknown as [Record<string, unknown>][]).map(
        ([payload]) => payload,
      );

    const find = (spy: jest.SpyInstance, event: string) =>
      payloadsOf(spy).find((payload) => payload.event === event);

    afterEach(() => jest.restoreAllMocks());

    it('records WHICH dispatcher, and never the free text they typed (failure — PII)', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { service } = build({ ride: lifecycleRide({ status: 'arrived' }) });

      await service.cancel({
        rideId: RIDE_ID,
        actor: 'dispatcher',
        actorId: DISPATCHER_ID,
        reason: PII_REASON,
      });

      const applied = find(log, 'ride.lifecycle.transition_applied');
      // `actor: 'dispatcher'` alone does not say which of two on shift killed
      // a ride under way — the one ownership-bypassing action in this slice.
      expect(applied).toMatchObject({
        actor: 'dispatcher',
        actorId: DISPATCHER_ID,
        from: 'arrived',
        to: 'cancelled_by_dispatcher',
        hasReason: true,
      });
      expect(applied).not.toHaveProperty('reason');

      // EVERY payload from EVERY logger this flow touches, not just the field
      // the text used to live in: the standard forbids the address and the
      // unmasked phone number reaching a log at all, so renaming one field is
      // not what is under test. The reason still travels on `ride:status` to
      // the phones, which is where it belongs.
      const everything = JSON.stringify([
        ...payloadsOf(log),
        ...payloadsOf(warn),
      ]);
      expect(everything).not.toContain('26123456');
      expect(everything).not.toContain('Brīvības');
    });

    it('reports hasReason: false when no reason was given (edge)', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const { service } = build({ ride: lifecycleRide({ status: 'arrived' }) });

      await service.cancel({
        rideId: RIDE_ID,
        actor: 'driver',
        actorId: DRIVER_ID,
        reason: null,
      });

      expect(find(log, 'ride.lifecycle.transition_applied')).toMatchObject({
        actorId: DRIVER_ID,
        hasReason: false,
      });
    });

    it('logs the rejection when the conditional UPDATE loses the race (failure)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { service } = build({
        ride: lifecycleRide({ status: 'in_progress' }),
        transitioned: undefined, // the UPDATE matched no row
      });

      await expect(service.complete(DRIVER_ID, RIDE_ID)).rejects.toThrow(
        'ride_transition_conflict',
      );

      // A lost race IS a state-machine rejection: without this the loser gets
      // a typed 409 and leaves no trace at all.
      expect(find(warn, 'ride.lifecycle.transition_rejected')).toMatchObject({
        actor: 'driver',
        actorId: DRIVER_ID,
        from: 'in_progress',
        to: 'completed',
        cause: 'lost_race',
      });
    });

    it('distinguishes a stale read from a lost race (edge)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { service } = build({
        ride: lifecycleRide({ status: 'accepted' }),
      });

      await expect(
        service.driverStep('start', DRIVER_ID, RIDE_ID),
      ).rejects.toThrow('ride_not_arrived');

      // Same event, different cause — the guard saw the wrong status, rather
      // than the write losing to somebody faster.
      expect(find(warn, 'ride.lifecycle.transition_rejected')).toMatchObject({
        cause: 'not_in_expected_status',
        from: 'accepted',
      });
    });
  });
});
