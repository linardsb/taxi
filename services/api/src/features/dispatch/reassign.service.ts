import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Db } from '@taxi/db';
import type { RideStatus } from '@taxi/shared';
import { DRIZZLE } from '../../common/db/db.module';
import { DriversService } from '../drivers';
import { RidesRepository, RideTransitionService } from '../rides';
import { DispatchRepository } from './dispatch.repository';
import { ForceAssignService } from './force-assign.service';

/**
 * The statuses a ride can be RELEASED from. Mirrors the two rows #19 added to
 * `ALLOWED_TRANSITIONS` — a driver standing at the pickup (`arrived`) or
 * carrying the passenger (`in_progress`) is not reassignable; that is a
 * cancellation.
 *
 * Declared here rather than derived from the transition table because the
 * table answers "is the hop legal", never "who may make it": this is the
 * dispatcher-only half of that split, and it is the guard that produces a 409
 * instead of the 500 an illegal `assertTransition` would throw.
 */
const RELEASABLE_STATUSES = new Set<RideStatus>(['accepted', 'arriving']);

/**
 * Dina swaps the car on a ride that already has one (#19).
 *
 * Composed from two committed steps rather than one transaction, and the split
 * is the design:
 *
 *   tx1  accepted|arriving → requested · release the driver · clear the stamp · audit
 *   ──   commit
 *   tx2  ForceAssignService.forceAssign(newDriver)
 *
 * One transaction would be tidier and strictly worse. A failure in the second
 * half would roll back the release, leaving the ride pinned to the driver Dina
 * has already decided is wrong. Split, the failure mode is "the ride sits in
 * `requested` and the cascade picks it up" — the rider gets a car by the
 * normal route, which is the outcome anyone would choose. Do NOT merge these.
 */
@Injectable()
export class ReassignService {
  private readonly logger = new Logger(ReassignService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly rides: RidesRepository,
    private readonly transitions: RideTransitionService,
    private readonly drivers: DriversService,
    private readonly offers: DispatchRepository,
    private readonly forceAssignService: ForceAssignService,
  ) {}

  async reassign(input: {
    dispatcherId: string;
    rideId: string;
    driverId: string;
    reason?: string | null;
  }): Promise<{ rideId: string }> {
    const found = await this.rides.findWithQuote(input.rideId);
    if (!found) throw new NotFoundException('ride_not_found');

    const from = found.ride.status;
    if (!RELEASABLE_STATUSES.has(from)) {
      throw new ConflictException('ride_not_reassignable');
    }

    const previousDriverId = found.ride.driverId;
    if (previousDriverId === null) {
      // An `accepted` ride with no driver is a data impossibility, not a state
      // to handle: it would mean `assignDriver` never ran. Reported as a
      // conflict rather than a 500 because the caller's correct next move is
      // the same either way — force-assign instead of reassign.
      throw new ConflictException('ride_not_reassignable');
    }

    // Refusing a no-op keeps the audit trail meaningful: a release-and-reassign
    // onto the SAME driver would write two audit rows describing a ride that
    // never changed hands, and briefly hand it back to the cascade for nothing.
    if (previousDriverId === input.driverId) {
      throw new ConflictException('ride_already_assigned');
    }

    const released = await this.db.transaction(async (tx) => {
      const ride = await this.transitions.transitionInTx(
        tx,
        input.rideId,
        from,
        'requested',
      );
      // The ride moved under us between the read and the UPDATE — the driver
      // completed it, or another dispatcher got there first.
      if (!ride) throw new ConflictException('ride_not_reassignable');

      if (
        !(await this.rides.unassignDriver(input.rideId, previousDriverId, tx))
      ) {
        throw new ConflictException('ride_already_assigned');
      }

      // The outgoing driver goes back to `online` and can be offered work
      // again immediately. `false` is ordinary — a driver Dina force-assigned
      // while offline was never claimed, so there is nothing to release.
      await this.drivers.releaseFromRide(previousDriverId, tx);

      await this.offers.insertAudit(
        {
          rideId: input.rideId,
          driverId: previousDriverId,
          source: 'dispatcher',
          dispatcherId: input.dispatcherId,
          reason: input.reason ?? null,
          payload: { event: 'released', from },
        },
        tx,
      );

      return ride;
    });

    // ── committed ── the ride is back in the pool from here on; a throw below
    // leaves it there for the cascade rather than stranding it.
    this.transitions.emitStatus(released, from, input.reason ?? null);

    this.logger.log({
      event: 'dispatch.assign.released',
      rideId: input.rideId,
      previousDriverId,
      dispatcherId: input.dispatcherId,
      from,
      at: new Date().toISOString(),
    });

    return this.forceAssignService.forceAssign({
      dispatcherId: input.dispatcherId,
      rideId: input.rideId,
      driverId: input.driverId,
      reason: input.reason,
    });
  }
}
