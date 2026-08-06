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
  type RideRequest,
  type RideRequestBody,
} from '@taxi/shared';
import { randomUUID } from 'node:crypto';
import { KV_STORE, type KeyValueStore } from '../../common/kv/kv.store';
import { PricingService } from '../pricing';
import { RealtimeService } from '../realtime';
import { entryStatusFor } from './ride-entry';
import {
  RIDE_IDEMPOTENCY_PENDING,
  RIDE_IDEMPOTENCY_TTL_SECONDS,
  RIDE_REQUEST_MAX_PER_WINDOW,
  RIDE_REQUEST_WINDOW_SECONDS,
  rideIdempotencyKey,
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

  async request(
    riderId: string,
    idempotencyKey: string,
    body: RideRequestBody,
  ): Promise<RideCreated> {
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

    // BEFORE the rate limit, for the reason the rate limit is itself placed
    // after the rejections: the cap bounds paid Routes calls, and a replay
    // reaches none. Charging quota for it would throttle exactly the rider this
    // feature protects — the one whose app retried.
    //
    // `setIfAbsent`, never get-then-set: two taps racing would both read null,
    // both "win", and both book a car — the bug this exists to close.
    const key = rideIdempotencyKey(riderId, idempotencyKey);
    const reserved = await this.kv.setIfAbsent(
      key,
      RIDE_IDEMPOTENCY_PENDING,
      RIDE_IDEMPOTENCY_TTL_SECONDS,
    );
    if (!reserved) {
      const replayed = await this.replay(key, riderId);
      if (replayed) return replayed;
      // The mapping pointed at a ride that no longer exists — defensive only,
      // rides are never deleted. Falling through creates one, because if the
      // original is gone there is no duplicate to make. NOT hardened against
      // two callers reaching this branch at once: the key holds a stale ride id
      // rather than `pending`, so both would create. Unreachable today, and
      // guarding it would cost a second reservation round trip on every request.
    }

    try {
      await this.assertWithinRateLimit(riderId);
      return await this.createRide(key, request, riderId);
    } catch (error) {
      // Release, best-effort. Without it a maps outage — or a single 429 —
      // burns the rider's key for 24 h and every honest retry replays a ride
      // that was never created. Only PRE-commit failures reach here: everything
      // after `rides.create` swallows its own errors by design, which is what
      // keeps this from ever deleting a key whose ride actually exists.
      //
      // `.catch()` because if Redis is the thing that is down, a throw here
      // would REPLACE the real error with a Redis one and hide the cause.
      await this.kv.del(key).catch(() => undefined);
      throw error;
    }
  }

  /**
   * The spending path, with the commit as a hard boundary: everything above
   * `rides.create` may throw and lets the caller release the reservation;
   * nothing below it may throw at all.
   */
  private async createRide(
    key: string,
    request: RideRequest,
    riderId: string,
  ): Promise<RideCreated> {
    try {
      const { quote, split } = await this.pricing.quote(request);

      const ride = await this.rides.create({
        orderId: randomUUID(),
        status: entryStatusFor(request),
        request,
        quote,
      });

      // ---- POST-COMMIT: nothing below may throw out of this method ----
      await this.recordIdempotency(key, ride.id);
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
   * Resolves the reservation to the ride it already created, or `undefined`
   * when the mapping points at nothing and the caller should create one.
   *
   * Throws 409 while the first request is still in flight. Waiting instead
   * would hold a connection open for as long as a route call takes, and needs a
   * timeout and a poll interval; the client retries a 409 and gets the ride.
   */
  private async replay(
    key: string,
    riderId: string,
  ): Promise<RideCreated | undefined> {
    const stored = await this.kv.get(key);

    // `null` is reachable: the key can expire between `setIfAbsent` returning
    // false and this read. Treating it as "no reservation, go create" would
    // reopen the very race the reservation closes.
    if (stored === null || stored === RIDE_IDEMPOTENCY_PENDING) {
      this.logger.warn({
        event: 'ride.request.in_progress',
        riderId,
        at: new Date().toISOString(),
      });
      throw new HttpException(
        { message: 'idempotent_request_in_progress' },
        HttpStatus.CONFLICT,
      );
    }

    const found = await this.rides.findWithQuote(stored);
    if (!found) {
      this.logger.error({
        event: 'ride.request.replay_missing',
        rideId: stored,
        riderId,
        at: new Date().toISOString(),
      });
      return undefined;
    }

    // Join, but do NOT re-emit. The case that produces a retry is a network
    // blip — exactly when the rider's socket is new and not in the room, so a
    // replay that skipped this would leave them deaf to every later
    // `ride:status`. Re-emitting is the other error: #10 may have moved the
    // ride on, and `previousStatus: null` would be a lie.
    try {
      this.realtime.joinRideRoom(riderId, found.ride.id);
    } catch (error) {
      this.logger.warn({
        event: 'ride.request.notify_failed',
        rideId: found.ride.id,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
    }

    // Recomputed, never read back: the split is returned and persisted nowhere.
    const split = await this.pricing.previewSplit(found.quote.totalCents);

    this.logger.log({
      event: 'ride.request.replayed',
      rideId: found.ride.id,
      riderId,
      status: found.ride.status,
      at: new Date().toISOString(),
    });

    return { ride: found.ride, split };
  }

  /**
   * Swallows, for exactly the reason `notifyRider` does: the ride is already
   * committed. Letting a Redis blip here throw would run the caller's release,
   * delete the reservation, and hand the rider a 500 — so their retry reserves
   * a FREE key and books the second car this whole feature exists to prevent.
   *
   * The residue when it fails is a key stuck at `pending` for the window, so
   * that attempt's retries get 409. The rider already has the ride id from the
   * 201, and a 409 is strictly better than a duplicate car.
   */
  private async recordIdempotency(key: string, rideId: string): Promise<void> {
    try {
      await this.kv.setWithTtl(key, rideId, RIDE_IDEMPOTENCY_TTL_SECONDS);
    } catch (error) {
      this.logger.error({
        event: 'ride.request.idempotency_write_failed',
        rideId,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
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
