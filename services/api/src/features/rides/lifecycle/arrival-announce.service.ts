import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  formatMessage,
  rideRequestSchema,
  RT,
  type AnnouncePushData,
  type ApiErrorBody,
} from '@taxi/shared';
import { KV_STORE, type KeyValueStore } from '../../../common/kv/kv.store';
import { DriversService } from '../../drivers';
import { RealtimeService } from '../../realtime';
import {
  ARRIVAL_ANNOUNCE_REPLAY_SECONDS,
  ARRIVAL_ANNOUNCE_WINDOW_SECONDS,
  arrivalAnnounceLastKey,
  arrivalAnnounceRateKey,
} from './arrival-announce.policy';
import { RideLifecycleRepository } from './ride-lifecycle.repository';

type RejectCause =
  | 'ride_not_found'
  | 'announce_not_requested'
  | 'ride_not_arrived'
  | 'too_many_requests';

/**
 * The rider's «ask the driver to call out» (#259). The rider's side is REST
 * because it needs auth, a rate limit and a status code the rider can hear.
 * The driver is reached three ways, all carrying the same `at`, which the app
 * dedupes on: the socket event (live), the push (backgrounded), and the replay
 * on the driver's next read (`lastRequestedAt`, foreground and reconnect).
 *
 * The flag names a procedure, not the rider: nothing here logs a phone, a
 * name, or why the rider asked.
 */
@Injectable()
export class ArrivalAnnounceService {
  private readonly logger = new Logger(ArrivalAnnounceService.name);

  constructor(
    private readonly lifecycle: RideLifecycleRepository,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
    private readonly realtime: RealtimeService,
    private readonly drivers: DriversService,
  ) {}

  /**
   * Every check comes before the INCR, so only an accepted request spends the
   * window: a press that races `start` gets its 409, not a 429 on the retry.
   */
  async request(riderId: string, rideId: string): Promise<{ ok: true }> {
    const ride = await this.lifecycle.findAnnounceTarget(rideId);
    // One 404 for "no such ride" and "someone else's ride": no existence oracle.
    if (!ride || ride.riderId !== riderId) {
      this.logRejected(rideId, riderId, 'ride_not_found');
      throw new NotFoundException('ride_not_found');
    }
    // Parsed only after the owner check, so a stored request that no longer
    // parses cannot answer a stranger 500 instead of the 404 (PR #293 F5).
    if (!rideRequestSchema.parse(ride.request).options.announceArrival) {
      this.logRejected(rideId, riderId, 'announce_not_requested');
      throw new ConflictException('announce_not_requested');
    }
    const driverId = ride.driverId;
    if (ride.status !== 'arrived' || driverId === null) {
      this.logRejected(rideId, riderId, 'ride_not_arrived');
      throw new ConflictException('ride_not_arrived');
    }

    // INCR-then-check, as `RidesService.assertWithinRateLimit`: a GET-then-INCR
    // would let a burst all read the same count and every one through.
    const rateKey = arrivalAnnounceRateKey(rideId);
    const count = await this.kv.incrWithTtl(
      rateKey,
      ARRIVAL_ANNOUNCE_WINDOW_SECONDS,
    );
    if (count > 1) {
      // The key can expire between the INCR and this read; 0 would read as
      // "retry now" on a rejection.
      const retryAfterSeconds = Math.max(1, await this.kv.ttl(rateKey));
      this.logRejected(rideId, riderId, 'too_many_requests');
      throw new HttpException(
        {
          message: 'too_many_requests',
          retryAfterSeconds,
        } satisfies ApiErrorBody,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const at = new Date().toISOString();
    // Best-effort, as the emit below: the window is already spent, so a failed
    // replay write must not also cost the live legs (PR #293 F4).
    try {
      await this.kv.setWithTtl(
        arrivalAnnounceLastKey(rideId),
        at,
        ARRIVAL_ANNOUNCE_REPLAY_SECONDS,
      );
    } catch (error) {
      this.logger.warn({
        event: 'ride.arrival_announce.replay_write_failed',
        rideId,
        reason: error instanceof Error ? error.message : 'unknown',
        at,
      });
    }
    try {
      this.realtime.emitToDriver(driverId, RT.rideAnnounceRequested, {
        rideId,
        at,
      });
    } catch (error) {
      this.logger.warn({
        event: 'ride.arrival_announce.emit_failed',
        rideId,
        reason: error instanceof Error ? error.message : 'unknown',
        at,
      });
    }
    // Fire-and-forget, as the offer push: `sendPush` logs every outcome
    // (`ride.arrival_announce.push_sent|_skipped|_failed`) and never throws.
    const data: AnnouncePushData = {
      kind: 'announce_requested',
      rideId,
      at,
    };
    void this.drivers
      .sendPush(
        driverId,
        (language) => ({
          title: formatMessage(language, 'push.announce_requested_title'),
          body: formatMessage(language, 'push.announce_requested_body'),
          data,
        }),
        'ride.arrival_announce.push',
      )
      .catch(() => undefined);

    this.logger.log({
      event: 'ride.arrival_announce.requested',
      rideId,
      orderId: ride.orderId,
      riderId,
      driverId,
      at,
    });
    return { ok: true };
  }

  /** The replay leg: the last accepted request's `at`, or null. */
  lastRequestedAt(rideId: string): Promise<string | null> {
    return this.kv.get(arrivalAnnounceLastKey(rideId));
  }

  private logRejected(rideId: string, riderId: string, cause: RejectCause) {
    this.logger.warn({
      event: 'ride.arrival_announce.rejected',
      rideId,
      riderId,
      cause,
      at: new Date().toISOString(),
    });
  }
}
