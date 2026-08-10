import { Injectable, Logger } from '@nestjs/common';
import {
  RT,
  type AssignmentSource,
  type RideOffer,
  type RideStatus,
} from '@taxi/shared';
import { RealtimeService } from '../realtime';
import { RideTransitionService, type TransitionedRide } from '../rides';

/** What a revoked sibling offer needs for its `ride:offer_revoked`. */
export type RevokedRef = { offerId: string; driverId: string };

/**
 * The post-commit socket tail of the dispatch slice. Everything here runs
 * AFTER the transaction committed and never throws: Socket.IO has no rollback,
 * so a lost event costs a live update, never correctness.
 */
@Injectable()
export class DispatchNotifier {
  private readonly logger = new Logger(DispatchNotifier.name);

  constructor(
    private readonly realtime: RealtimeService,
    private readonly transitions: RideTransitionService,
  ) {}

  /** `rideOfferEventSchema` wants ISO strings where the domain holds `Date`s. */
  emitOffer(offer: RideOffer): void {
    try {
      this.realtime.emitToDriver(offer.driverId, RT.rideOffer, {
        ...offer,
        sentAt: offer.sentAt.toISOString(),
        expiresAt: offer.expiresAt.toISOString(),
      });
    } catch (error) {
      this.logger.warn({
        event: 'dispatch.offer.notify_failed',
        rideId: offer.rideId,
        offerId: offer.id,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
    }
  }

  /**
   * The shared post-commit emit tail for both assignment paths (accept and
   * force-assign).
   */
  emitAssigned(
    ride: TransitionedRide,
    driverId: string,
    source: AssignmentSource,
    dispatcherId: string | null,
    revoked: RevokedRef[],
    previousStatus: RideStatus,
  ): void {
    const at = new Date().toISOString();
    try {
      // JOIN BEFORE ANY EMIT, or the newly assigned driver's own sockets miss
      // the first event — they are not in the ride room until this runs, and
      // `ride:status` goes to that room. Same rule as `RidesService.notifyRider`
      // ("Join BEFORE emitting"). Ordering this after `emitStatus` cost the
      // driver their `accepted` status event, which a test caught.
      this.realtime.joinRideRoom(driverId, ride.id);
    } catch (error) {
      this.logger.warn({
        event: 'dispatch.assign.join_failed',
        rideId: ride.id,
        driverId,
        reason: error instanceof Error ? error.message : 'unknown',
        at,
      });
    }

    this.transitions.emitStatus(ride, previousStatus);

    try {
      this.realtime.emitToRide(ride.id, RT.rideAssigned, {
        rideId: ride.id,
        driverId,
        source,
        dispatcherId,
        at,
      });

      // The only consumer of `revokePendingForRide`'s returned pairs: a driver
      // holding a live offer that someone else took — or that Dina overrode —
      // must see their card clear.
      for (const other of revoked) {
        this.realtime.emitToDriver(other.driverId, RT.rideOfferRevoked, {
          offerId: other.offerId,
          rideId: ride.id,
          reason: 'taken',
          at,
        });
      }
    } catch (error) {
      this.logger.warn({
        event: 'dispatch.assign.notify_failed',
        rideId: ride.id,
        driverId,
        reason: error instanceof Error ? error.message : 'unknown',
        at,
      });
    }
  }
}
