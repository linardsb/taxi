import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Db } from '@taxi/db';
import type { RideStatus } from '@taxi/shared';
import type { DriversService } from '../drivers';
import type { RealtimeService } from '../realtime';
import type {
  RidesRepository,
  RideTransitionService,
  TransitionedRide,
} from '../rides';
import type { DispatchRepository } from './dispatch.repository';
import type { ForceAssignService } from './force-assign.service';
import { ReassignService } from './reassign.service';

const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const OLD_DRIVER = 'd0000000-0000-4000-8000-000000000001';
const NEW_DRIVER = 'd0000000-0000-4000-8000-000000000002';
const DISPATCHER_ID = 'a0000000-0000-4000-8000-000000000001';

const releasedRide: TransitionedRide = {
  id: RIDE_ID,
  orderId: '11111111-2222-4333-8444-555555555555',
  status: 'requested',
  riderId: '99999999-8888-4777-8666-555555555555',
  driverId: null,
  geozoneId: null,
  createdAt: new Date('2026-08-17T10:00:00.000Z'),
};

const input = () => ({
  dispatcherId: DISPATCHER_ID,
  rideId: RIDE_ID,
  driverId: NEW_DRIVER,
  reason: 'driver not moving',
});

function build(
  over: {
    /** `undefined` models an unknown or never-quoted ride. */
    found?: { ride: { status: RideStatus; driverId: string | null } };
    /** `undefined` = the ride moved between the read and the UPDATE. */
    release?: TransitionedRide;
    unassign?: boolean;
    releaseFromRide?: boolean;
    /** `[]` models a driver id that no longer resolves to a roster row. */
    matchAttributes?: unknown[];
    /** `false` = no accepted offer row to retire — a data impossibility. */
    supersede?: boolean;
    /** The half-completed reassign: release committed, force-assign throws. */
    forceAssignError?: Error;
  } = {},
) {
  // Ordering ledger, same convention as the ForceAssignService spec: "before
  // the second transaction" is a POSITION in this array, not an assertion
  // about time. The two-transaction split is the whole design here, so the
  // order is the thing worth pinning.
  const events: string[] = [];

  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      events.push('tx:begin');
      const result = await fn({});
      events.push('tx:commit');
      return result;
    },
  } as unknown as Db;

  const findWithQuote = jest.fn(() =>
    Promise.resolve(
      'found' in over
        ? over.found
        : { ride: { status: 'accepted', driverId: OLD_DRIVER } },
    ),
  );
  const unassignDriver = jest.fn(() => {
    events.push('unassign');
    return Promise.resolve(over.unassign ?? true);
  });
  const rides = { findWithQuote, unassignDriver } as unknown as RidesRepository;

  const transitionInTx = jest.fn(() =>
    Promise.resolve('release' in over ? over.release : releasedRide),
  );
  const emitStatus = jest.fn(() => {
    events.push('emit:status');
  });
  const transitions = {
    transitionInTx,
    emitStatus,
  } as unknown as RideTransitionService;

  const releaseFromRide = jest.fn(() =>
    Promise.resolve(over.releaseFromRide ?? true),
  );
  const findMatchAttributes = jest.fn(() =>
    Promise.resolve(
      over.matchAttributes ?? [{ driverId: NEW_DRIVER, status: 'online' }],
    ),
  );
  const drivers = {
    releaseFromRide,
    findMatchAttributes,
  } as unknown as DriversService;

  const insertAudit = jest.fn(() => Promise.resolve());
  const supersedeAcceptedOffer = jest.fn(() => {
    events.push('supersede');
    return Promise.resolve(over.supersede ?? true);
  });
  const offers = {
    insertAudit,
    supersedeAcceptedOffer,
  } as unknown as DispatchRepository;

  const leaveRideRoom = jest.fn(() => {
    events.push('leave:room');
  });
  const realtime = { leaveRideRoom } as unknown as RealtimeService;

  const forceAssign = jest.fn(() => {
    events.push('forceAssign');
    return over.forceAssignError
      ? Promise.reject(over.forceAssignError)
      : Promise.resolve({ rideId: RIDE_ID });
  });
  const forceAssignService = { forceAssign } as unknown as ForceAssignService;

  const service = new ReassignService(
    db,
    rides,
    transitions,
    drivers,
    offers,
    realtime,
    forceAssignService,
  );

  return {
    service,
    events,
    transitionInTx,
    unassignDriver,
    releaseFromRide,
    findMatchAttributes,
    insertAudit,
    supersedeAcceptedOffer,
    leaveRideRoom,
    emitStatus,
    forceAssign,
  };
}

describe('ReassignService', () => {
  it('releases the old driver, then force-assigns the new one (expected)', async () => {
    const t = build();

    await expect(t.service.reassign(input())).resolves.toEqual({
      rideId: RIDE_ID,
    });

    expect(t.transitionInTx).toHaveBeenCalledWith(
      {},
      RIDE_ID,
      'accepted',
      'requested',
    );
    expect(t.unassignDriver).toHaveBeenCalledWith(RIDE_ID, OLD_DRIVER, {});
    expect(t.releaseFromRide).toHaveBeenCalledWith(OLD_DRIVER, {});
    expect(t.forceAssign).toHaveBeenCalledWith({
      dispatcherId: DISPATCHER_ID,
      rideId: RIDE_ID,
      driverId: NEW_DRIVER,
      reason: 'driver not moving',
    });
  });

  it('force-assigns only AFTER the release commits — two transactions, not one (expected)', async () => {
    const t = build();
    await t.service.reassign(input());

    // If these ever collapse into one transaction, a failed re-assign would
    // roll back the release and leave the ride pinned to the wrong driver.
    expect(t.events).toEqual([
      'tx:begin',
      'unassign',
      'supersede',
      'tx:commit',
      'emit:status',
      'leave:room',
      'forceAssign',
    ]);
  });

  it('audits the RELEASE against the outgoing driver, not the incoming one (expected)', async () => {
    const t = build();
    await t.service.reassign(input());

    expect(t.insertAudit).toHaveBeenCalledWith(
      {
        rideId: RIDE_ID,
        driverId: OLD_DRIVER,
        source: 'dispatcher',
        dispatcherId: DISPATCHER_ID,
        reason: 'driver not moving',
        payload: { event: 'released', from: 'accepted' },
      },
      {},
    );
  });

  it('retires the outgoing driver’s accepted offer inside the release (expected)', async () => {
    const t = build();
    await t.service.reassign(input());

    // Left behind, the ride carries two `accepted` offer rows and
    // `findAcceptedOfferSplit` settles it on whichever the heap yields — at the
    // OUTGOING driver's commission rate. Against the outgoing driver, and
    // inside the transaction, or a rollback would leave the row retired on a
    // ride that still has its original car.
    expect(t.supersedeAcceptedOffer).toHaveBeenCalledWith(
      RIDE_ID,
      OLD_DRIVER,
      {},
    );
  });

  it('takes the released driver out of the ride room (expected)', async () => {
    const t = build();
    await t.service.reassign(input());

    // The mirror of `emitAssigned`'s join. Without it they keep receiving
    // `ride:status` and the incoming driver's `ride:assigned` for a ride they
    // are no longer on.
    expect(t.leaveRideRoom).toHaveBeenCalledWith(OLD_DRIVER, RIDE_ID);
  });

  it('keeps Dina’s reason off the wire — it goes to the audit log, not the rider (expected)', async () => {
    const t = build();
    await t.service.reassign(input());

    // `emitStatus` puts its third argument on `ride:status`, which reaches the
    // rider. The audit assertion above proves the reason is still recorded.
    expect(t.emitStatus).toHaveBeenCalledWith(releasedRide, 'accepted');
  });

  it('releases an `arriving` ride too — the driver is en route, not there yet (edge)', async () => {
    const t = build({
      found: { ride: { status: 'arriving', driverId: OLD_DRIVER } },
    });

    await expect(t.service.reassign(input())).resolves.toEqual({
      rideId: RIDE_ID,
    });
    expect(t.transitionInTx).toHaveBeenCalledWith(
      {},
      RIDE_ID,
      'arriving',
      'requested',
    );
  });

  it('tolerates a driver who was never claimed — the offline force-assign case (edge)', async () => {
    const t = build({ releaseFromRide: false });

    // `false` is ordinary, not an error: a driver overridden onto a ride while
    // offline was never claimed, so there is nothing to release.
    await expect(t.service.reassign(input())).resolves.toEqual({
      rideId: RIDE_ID,
    });
    expect(t.forceAssign).toHaveBeenCalled();
  });

  it('refuses a ride the driver has physically reached (failure)', async () => {
    const t = build({
      found: { ride: { status: 'arrived', driverId: OLD_DRIVER } },
    });

    await expect(t.service.reassign(input())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(t.transitionInTx).not.toHaveBeenCalled();
    expect(t.forceAssign).not.toHaveBeenCalled();
  });

  it('refuses a ride mid-ride (failure)', async () => {
    const t = build({
      found: { ride: { status: 'in_progress', driverId: OLD_DRIVER } },
    });

    await expect(t.service.reassign(input())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses a no-op reassign onto the same driver (failure)', async () => {
    const t = build({
      found: { ride: { status: 'accepted', driverId: NEW_DRIVER } },
    });

    // Two audit rows describing a ride that never changed hands, plus a
    // pointless round through the cascade — refused rather than performed.
    await expect(t.service.reassign(input())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(t.forceAssign).not.toHaveBeenCalled();
  });

  it('404s an unknown ride (failure)', async () => {
    const t = build({ found: undefined });

    await expect(t.service.reassign(input())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('409s when the ride moved between the read and the UPDATE (failure)', async () => {
    const t = build({ release: undefined });

    await expect(t.service.reassign(input())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(t.forceAssign).not.toHaveBeenCalled();
  });

  it('409s when another dispatcher already took the car off (failure)', async () => {
    const t = build({ unassign: false });

    await expect(t.service.reassign(input())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(t.forceAssign).not.toHaveBeenCalled();
  });

  it('404s an unknown INCOMING driver before the release commits (failure)', async () => {
    const t = build({ matchAttributes: [] });

    // The pre-flight. Without it `forceAssign` raises the same 404 after the
    // release has committed: Dina sees an error that reads as "nothing
    // happened" while the ride has already lost its car.
    await expect(t.service.reassign(input())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(t.events).toEqual([]);
    expect(t.unassignDriver).not.toHaveBeenCalled();
  });

  it('leaves the ride released when the force-assign half throws (failure)', async () => {
    const t = build({ forceAssignError: new ConflictException('boom') });

    // THE PATH THE TWO-TRANSACTION SPLIT EXISTS TO PRODUCE. The error reaches
    // the caller, and everything before the commit stays committed — the ride
    // is at `requested` with no driver, audited, and the cascade will work it.
    await expect(t.service.reassign(input())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(t.events).toEqual([
      'tx:begin',
      'unassign',
      'supersede',
      'tx:commit',
      'emit:status',
      'leave:room',
      'forceAssign',
    ]);
    expect(t.insertAudit).toHaveBeenCalled();
  });

  it('completes the release when there is no accepted offer to retire (edge)', async () => {
    const t = build({ supersede: false });

    // A data impossibility, logged rather than thrown: refusing here would pin
    // the ride to the driver Dina has already rejected, which is the outcome
    // the two-transaction split exists to avoid.
    await expect(t.service.reassign(input())).resolves.toEqual({
      rideId: RIDE_ID,
    });
    expect(t.forceAssign).toHaveBeenCalled();
  });
});
