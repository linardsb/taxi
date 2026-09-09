import { Injectable, Logger } from '@nestjs/common';
import {
  formatEur,
  formatMessage,
  OFFER_PUSH_PAYLOAD_MAX_BYTES,
  RT,
  type AssignmentSource,
  type OfferPushData,
  type PaymentMethodType,
  type RideOffer,
  type RideOfferEvent,
  type RideStatus,
} from '@taxi/shared';
import { DriversService } from '../drivers';
import { RealtimeService } from '../realtime';
import { RideTransitionService, type TransitionedRide } from '../rides';

/** What a revoked sibling offer needs for its `ride:offer_revoked`. */
export type RevokedRef = { offerId: string; driverId: string };

/**
 * The most bytes of wire offer the push `data` may carry (#15).
 *
 * `derived`: Expo's push payload limit is 4,096 bytes for the whole message.
 * Title + body ≤ ~120 B in any of the three catalogs, `kind` + the three ids
 * + `expiresAt` ≤ ~200 B, so 2,048 B for the offer JSON leaves ~1.7 KB of
 * headroom. The only unbounded strings in an offer are the two addresses
 * (`addressPointSchema.address` has no max); an offer that does not fit
 * still pushes with the ids alone, and the tap lands on whatever card the
 * socket already delivered.
 */

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
    private readonly drivers: DriversService,
  ) {}

  /**
   * `rideOfferEventSchema` wants ISO strings where the domain holds `Date`s,
   * plus the operative payment method the offer row does not carry (#15).
   *
   * Two deliveries of the same card: the socket for a live app, a push for a
   * backgrounded or killed one. The push carries the wire offer itself so a
   * tap on a cold app can render the card without a read that does not
   * exist; the app dedupes by offer id, so whichever arrives first shows it
   * and the other is a no-op.
   */
  emitOffer(offer: RideOffer, paymentMethod: PaymentMethodType): void {
    const wire: RideOfferEvent = {
      ...offer,
      sentAt: offer.sentAt.toISOString(),
      expiresAt: offer.expiresAt.toISOString(),
      paymentMethod,
    };
    try {
      this.realtime.emitToDriver(offer.driverId, RT.rideOffer, wire);
    } catch (error) {
      this.logger.warn({
        event: 'dispatch.offer.notify_failed',
        rideId: offer.rideId,
        offerId: offer.id,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
    }
    this.pushOffer(wire);
  }

  /**
   * Fire-and-forget on purpose: the sweeper's tick must never wait on Expo's
   * HTTP timeout, and `sendPush` already logs every outcome. `data` values are
   * strings only — Expo forwards them verbatim.
   */
  private pushOffer(wire: RideOfferEvent): void {
    const json = JSON.stringify(wire);
    const fits =
      Buffer.byteLength(json, 'utf8') <= OFFER_PUSH_PAYLOAD_MAX_BYTES;
    // Built through the shared schema so a rename cannot pass typecheck on one
    // side only. `expiresAt` used to ride along here and nothing ever read it —
    // a dead field on a size-constrained wire, so it is gone.
    const data: OfferPushData = {
      kind: 'offer',
      offerId: wire.id,
      rideId: wire.rideId,
      ...(fits ? { offer: json } : {}),
    };
    void this.drivers
      .sendPush(
        wire.driverId,
        (language) => ({
          title: formatMessage(language, 'push.offer_title'),
          body: formatMessage(language, 'push.offer_body', {
            amount: formatEur(wire.split.driverNetCents),
          }),
          data,
        }),
        'dispatch.offer.push',
      )
      .catch(() => undefined);
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
