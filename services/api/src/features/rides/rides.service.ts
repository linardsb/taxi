import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  rideRequestSchema,
  RT,
  type RideCreated,
  type RideRequestBody,
} from '@taxi/shared';
import { randomUUID } from 'node:crypto';
import { PricingService } from '../pricing';
import { RealtimeService } from '../realtime';
import { entryStatusFor } from './ride-entry';
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
  ) {}

  async request(riderId: string, body: RideRequestBody): Promise<RideCreated> {
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

    const { quote, split } = await this.pricing.quote(request);

    const ride = await this.rides.create({
      orderId: randomUUID(),
      status: entryStatusFor(request),
      request,
      quote,
    });

    // Join BEFORE emitting, or the rider's own sockets miss the first event.
    // `joinRideRoom` returns void — do not await it. If the rider has no live
    // socket the join is a no-op and the emit reaches nobody, which is correct:
    // the REST response carries the same data.
    this.realtime.joinRideRoom(riderId, ride.id);
    this.realtime.emitToRide(ride.id, RT.rideStatus, {
      rideId: ride.id,
      orderId: ride.orderId,
      status: ride.status,
      previousStatus: null,
      reason: null,
      at: ride.createdAt.toISOString(),
    });

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
  }
}
