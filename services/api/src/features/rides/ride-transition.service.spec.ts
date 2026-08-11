import { InvalidRideTransitionError, type RideStatus } from '@taxi/shared';
import type { Db } from '@taxi/db';
import type { RideNotificationsService } from '../notifications';
import type { RealtimeService } from '../realtime';
import { RideTransitionService, type DbTx } from './ride-transition.service';

const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const ORDER_ID = '11111111-2222-4333-8444-555555555555';
const RIDER_ID = '99999999-8888-4777-8666-555555555555';

const rideRow = (status: RideStatus) => ({
  id: RIDE_ID,
  orderId: ORDER_ID,
  status,
  riderId: RIDER_ID,
  driverId: null,
  geozoneId: null,
  createdAt: new Date('2026-08-05T10:00:00.000Z'),
});

/**
 * A fake Drizzle whose `update().set().where().returning()` chain returns
 * whatever `rows` is set to — which is how "the conditional UPDATE matched no
 * row" is expressed without a database.
 *
 * `touched` records that the DB was reached at all, so the illegal-transition
 * case can assert `assertTransition` fired BEFORE any query was built.
 */
function build(rows: unknown[] = [rideRow('offered')]) {
  const touched = jest.fn();

  const chain = {
    update: (...args: unknown[]) => {
      touched(...args);
      return chain;
    },
    set: () => chain,
    where: () => chain,
    returning: () => Promise.resolve(rows),
    transaction: (fn: (tx: DbTx) => Promise<unknown>) =>
      fn(chain as unknown as DbTx),
  };

  const emitToRide = jest.fn();
  const realtime = { emitToRide } as unknown as RealtimeService;

  const onStatus = jest.fn().mockResolvedValue(undefined);
  const notifications = { onStatus } as unknown as RideNotificationsService;

  const service = new RideTransitionService(
    chain as unknown as Db,
    realtime,
    notifications,
  );

  return {
    service,
    emitToRide,
    touched,
    onStatus,
    tx: chain as unknown as DbTx,
  };
}

describe('RideTransitionService', () => {
  it('updates and emits ride:status with the previous status (expected)', async () => {
    const { service, emitToRide } = build([rideRow('accepted')]);

    const ride = await service.transition(RIDE_ID, 'offered', 'accepted');

    expect(ride?.status).toBe('accepted');
    expect(emitToRide).toHaveBeenCalledTimes(1);
    const [rideId, event, payload] = emitToRide.mock.calls[0] as [
      string,
      string,
      { status: string; previousStatus: string; orderId: string; at: string },
    ];
    expect(rideId).toBe(RIDE_ID);
    expect(event).toBe('ride:status');
    expect(payload.status).toBe('accepted');
    expect(payload.previousStatus).toBe('offered');
    // The emit needs `orderId`, which RETURNING * supplies — never a second read.
    expect(payload.orderId).toBe(ORDER_ID);
  });

  it('returns undefined and emits nothing when no row matched (edge)', async () => {
    const { service, emitToRide } = build([]);

    // The caller lost the race: someone else already moved this ride.
    await expect(
      service.transition(RIDE_ID, 'offered', 'accepted'),
    ).resolves.toBeUndefined();
    expect(emitToRide).not.toHaveBeenCalled();
  });

  it('rejects an illegal transition before touching the database (failure)', async () => {
    const { service, touched, emitToRide, tx } = build();

    // `requested → accepted` is absent from ALLOWED_TRANSITIONS; force-assign
    // exists in the shape it does precisely because of this.
    await expect(
      service.transitionInTx(tx, RIDE_ID, 'requested', 'accepted'),
    ).rejects.toBeInstanceOf(InvalidRideTransitionError);
    expect(touched).not.toHaveBeenCalled();
    expect(emitToRide).not.toHaveBeenCalled();
  });

  /**
   * The split's own guarantee. This is what stops a later refactor from quietly
   * folding the emit back into the write half and reintroducing the
   * mid-transaction-emit bug: a `ride:assigned` that reaches the driver's phone
   * and is then rolled back is worse than the 409 it replaced.
   */
  it('emits nothing on a SUCCESSFUL transitionInTx (the no-emit-in-transaction rule)', async () => {
    const { service, emitToRide, tx } = build([rideRow('offered')]);

    const ride = await service.transitionInTx(
      tx,
      RIDE_ID,
      'requested',
      'offered',
    );

    expect(ride?.status).toBe('offered');
    expect(emitToRide).not.toHaveBeenCalled();
  });
});
