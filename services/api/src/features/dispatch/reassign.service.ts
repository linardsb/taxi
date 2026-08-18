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
import { RealtimeService } from '../realtime';
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
 * has already decided is wrong. Split, the ride sits in `requested` and the
 * cascade works it as an ordinary awaiting ride. Do NOT merge these.
 *
 * WHAT THAT FALLBACK DOES AND DOES NOT PROMISE. It promises the ride is offered
 * again: `countAttempts` is scoped to `findLastReleasedAt`, so the release
 * resets the `MAX_OFFER_ATTEMPTS` budget and a ride that cascaded before it was
 * accepted is not already at the cap (#120 review H3, which found the earlier
 * wording promising more than the code did). It does NOT promise a car:
 * `findTriedDriverIds` is one-shot-per-driver-per-ride by design, so at pilot
 * scale the candidate set can exhaust — and then the ride surfaces as unclaimed
 * on Dina's board, which is the same escalation an unaccepted booking gets.
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
    private readonly realtime: RealtimeService,
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

    // PRE-FLIGHT, because the two-transaction split makes a late 404 expensive:
    // `forceAssign` throws `driver_not_found` after the release has committed,
    // so a stale roster row would read to Dina as "nothing happened" while the
    // ride had already lost its car (#120 review M2). `forceAssign` still makes
    // its own check — this narrows the window, it does not own the guard.
    const [incoming] = await this.drivers.findMatchAttributes([input.driverId]);
    if (!incoming) throw new NotFoundException('driver_not_found');

    let supersededOffer = false;
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

      // Retire the offer acceptance was built on, or the ride carries two
      // `accepted` rows and settles on whichever one the heap yields — see
      // `supersedeAcceptedOffer`. `false` is a data impossibility, not a state
      // to handle, so it is logged rather than thrown: refusing the release
      // here would pin the ride to the driver Dina has already rejected.
      supersededOffer = await this.offers.supersedeAcceptedOffer(
        input.rideId,
        previousDriverId,
        tx,
      );

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

    // NO REASON ON THE WIRE. `emitStatus` puts it on `ride:status`, which goes
    // to the ride room — the rider and the driver, per realtime-events.md. Dina
    // types that box for the record, not for the passenger ("first driver not
    // moving"), and `dispatch_audit_log` already has it (#120 review M1).
    this.transitions.emitStatus(released, from);

    // The mirror of `emitAssigned`'s join. Without it the released driver's
    // sockets keep receiving every later `ride:status` for a ride they are no
    // longer party to, the incoming driver's `ride:assigned`, and the rider's
    // position leg once it lands (#120 review H4). Never throws, for the reason
    // `emitStatus` documents: the release is committed either way.
    try {
      this.realtime.leaveRideRoom(previousDriverId, input.rideId);
    } catch (error) {
      this.logger.warn({
        event: 'dispatch.assign.leave_failed',
        rideId: input.rideId,
        driverId: previousDriverId,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
    }

    if (!supersededOffer) {
      this.logger.warn({
        event: 'dispatch.assign.no_accepted_offer',
        rideId: input.rideId,
        driverId: previousDriverId,
        at: new Date().toISOString(),
      });
    }

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
