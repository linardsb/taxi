import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  rideRequestSchema,
  RT,
  type Ride,
  type RideCreated,
  type RideRequestBody,
} from '@taxi/shared';
import { randomUUID } from 'node:crypto';
import { KV_STORE, type KeyValueStore } from '../../common/kv/kv.store';
import { PricingService } from '../pricing';
import { RealtimeService } from '../realtime';
import { entryStatusFor } from './ride-entry';
import {
  RIDE_REQUEST_MAX_PER_WINDOW,
  RIDE_REQUEST_WINDOW_SECONDS,
  rideRequestRateKey,
} from './rides.policy';
import { RidesRepository } from './rides.repository';

/**
 * Orchestrates a ride request: validate → quote → persist → notify.
 *
 * This slice performs NO state transition. Creation is the machine's entry (see
 * `ride-entry.ts`), and every status change after it belongs to #11.
 *
 * It emits `ride:status`, not a `ride:requested` event: the catalog has no such
 * event by design — `ride:status` is emitted on every transition, which is
 * exactly why a separate creation event would be a duplicate.
 */
@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private readonly pricing: PricingService,
    private readonly rides: RidesRepository,
    private readonly realtime: RealtimeService,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
  ) {}

  async request(riderId: string, body: RideRequestBody): Promise<RideCreated> {
    await this.assertWithinRateLimit(riderId);

    // The server's identity wins. A body-supplied `riderId` was already
    // stripped by `.omit()` — this re-parse is what makes that structural.
    const request = rideRequestSchema.parse({ ...body, riderId });

    // #22 replaces this with a fan-out into N rides sharing one `orderId`.
    if (request.vehicleCount > 1) {
      throw new BadRequestException('multi_taxi_not_supported');
    }

    // A past pickup would enter at `scheduled` and sit there forever, because
    // the promoting timer is #21's. Rejecting it is cheaper than a support
    // ticket.
    if (request.scheduledFor && request.scheduledFor.getTime() <= Date.now()) {
      throw new BadRequestException('scheduled_in_past');
    }

    try {
      const { quote, split } = await this.pricing.quote(request);

      const ride = await this.rides.create({
        orderId: randomUUID(),
        status: entryStatusFor(request),
        request,
        quote,
      });

      this.notifyRider(riderId, ride);

      this.logger.log({
        event: 'ride.request.created',
        rideId: ride.id,
        orderId: ride.orderId,
        riderId,
        status: ride.status,
        totalCents: quote.totalCents,
        commissionPct: split.commissionPct,
        commissionSource: split.commissionSource,
        at: ride.createdAt.toISOString(),
      });

      return { ride, split };
    } catch (error) {
      // Only the spending path is logged here — the rejections above are the
      // client's fault, not an incident. Without this a 500 on POST /rides
      // leaves nothing to tell "one rider, one corridor" from "maps is down".
      this.logger.error({
        event: 'ride.request.failed',
        riderId,
        category: request.category,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
      throw error;
    }
  }

  /**
   * Spent before the quote, so a throttled request costs no paid Routes call.
   * INCR-then-check like the auth slice: a GET-then-INCR would let a burst all
   * read the same count and every one of them through.
   */
  private async assertWithinRateLimit(riderId: string): Promise<void> {
    const key = rideRequestRateKey(riderId);
    const attempts = await this.kv.incrWithTtl(
      key,
      RIDE_REQUEST_WINDOW_SECONDS,
    );
    if (attempts <= RIDE_REQUEST_MAX_PER_WINDOW) return;

    // The key can expire between the INCR and this read, and a
    // retryAfterSeconds of 0 would read as "retry now" on a rejection.
    const retryAfterSeconds = Math.max(1, await this.kv.ttl(key));
    this.logger.warn({
      event: 'ride.request.throttled',
      riderId,
      attempts,
      at: new Date().toISOString(),
    });
    throw new HttpException(
      { message: 'too_many_requests', retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Deliberately unable to fail the request: the ride is already committed, and
   * a rider who gets a 500 with no ride id retries — which books a second car.
   * The REST response carries the same data, so a lost event costs the live
   * update, not the ride.
   */
  private notifyRider(riderId: string, ride: Ride): void {
    try {
      // Join BEFORE emitting, or the rider's own sockets miss the first event.
      // `joinRideRoom` returns void — do not await it. If the rider has no live
      // socket the join is a no-op and the emit reaches nobody, which is
      // correct: the REST response carries the same data.
      this.realtime.joinRideRoom(riderId, ride.id);
      this.realtime.emitToRide(ride.id, RT.rideStatus, {
        rideId: ride.id,
        orderId: ride.orderId,
        status: ride.status,
        previousStatus: null,
        reason: null,
        at: ride.createdAt.toISOString(),
      });
    } catch (error) {
      this.logger.warn({
        event: 'ride.request.notify_failed',
        rideId: ride.id,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
    }
  }
}
