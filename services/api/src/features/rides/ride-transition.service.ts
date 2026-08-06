import { Inject, Injectable, Logger } from '@nestjs/common';
import { rides, type Db } from '@taxi/db';
import { assertTransition, RT, type RideStatus } from '@taxi/shared';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type DbTx } from '../../common/db/db.module';
import { RealtimeService } from '../realtime';

/**
 * The columns every caller of this service needs.
 *
 * Deliberately NOT a `Ride`: `rideSchema` requires a `quote`, which lives in
 * `total_cents` + `ride_fare_lines` and is not on this row. Returning a `Ride`
 * would force a `findWithQuote` on every transition, for data no caller of this
 * service reads.
 */
export interface TransitionedRide {
  id: string;
  orderId: string;
  status: RideStatus;
  riderId: string;
  driverId: string | null;
  geozoneId: string | null;
  createdAt: Date;
}

/**
 * Re-exported, not defined here: `DbTx` moved to `common/db` when the drivers
 * slice needed it too. The re-export keeps `dispatch.repository.ts` and the
 * rides barrel importing it from `'../rides'` exactly as before.
 */
export type { DbTx } from '../../common/db/db.module';

/** `RETURNING *` gives every column; this narrows to what callers use. */
type RideRow = typeof rides.$inferSelect;

function toTransitioned(row: RideRow): TransitionedRide {
  return {
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    riderId: row.riderId,
    driverId: row.driverId,
    geozoneId: row.geozoneId,
    createdAt: row.createdAt,
  };
}

/**
 * The ONE guarded writer of `rides.status`. Two consumers: #10 (dispatch,
 * `requested→offered→accepted` and `offered→requested`) and #11 (the lifecycle
 * from `accepted` onward). Dispatch writing status directly would mean
 * `assertTransition` is called in two places and #11 arrives to find the
 * invariant already forked.
 *
 * Split into a write half and an emit half ON PURPOSE — see `emitStatus`.
 */
@Injectable()
export class RideTransitionService {
  private readonly logger = new Logger(RideTransitionService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * The composable half: a guarded conditional UPDATE inside a caller's
   * transaction. NO emit — that is the whole point of the split.
   *
   * `assertTransition` runs FIRST and throws `InvalidRideTransitionError`, a
   * programming error that should 500 rather than be caught. The UPDATE is then
   * conditional on `status = from`, so `undefined` means no row matched and the
   * caller lost a race — a 409, never a 500.
   */
  async transitionInTx(
    tx: DbTx,
    rideId: string,
    from: RideStatus,
    to: RideStatus,
  ): Promise<TransitionedRide | undefined> {
    assertTransition(from, to);

    const [row] = await tx
      .update(rides)
      .set({ status: to })
      .where(and(eq(rides.id, rideId), eq(rides.status, from)))
      .returning();

    return row ? toTransitioned(row) : undefined;
  }

  /**
   * Fire-and-forget `ride:status`. Call AFTER the transaction commits, never
   * inside it: Socket.IO has no rollback, so an event emitted mid-transaction
   * has already reached the driver's phone when the rollback happens — #15
   * would show an accepted ride that does not exist.
   *
   * Never throws, for the reason `RidesService.notifyRider` documents: the write
   * is already committed and a lost event costs the live update, not the ride.
   */
  emitStatus(
    ride: TransitionedRide,
    from: RideStatus,
    reason: string | null = null,
  ): void {
    try {
      this.realtime.emitToRide(ride.id, RT.rideStatus, {
        rideId: ride.id,
        orderId: ride.orderId,
        status: ride.status,
        previousStatus: from,
        reason,
        at: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn({
        event: 'ride.transition.notify_failed',
        rideId: ride.id,
        status: ride.status,
        previousStatus: from,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
    }
  }

  /**
   * Convenience for genuinely single-statement callers — dispatch's
   * `offered → requested` on decline and on expiry, which touch nothing else.
   * A caller that also writes an offer row, a driver id or an audit row must
   * compose `transitionInTx` into its own transaction instead.
   */
  async transition(
    rideId: string,
    from: RideStatus,
    to: RideStatus,
    reason: string | null = null,
  ): Promise<TransitionedRide | undefined> {
    const ride = await this.db.transaction((tx) =>
      this.transitionInTx(tx, rideId, from, to),
    );
    if (ride) this.emitStatus(ride, from, reason);
    return ride;
  }
}
