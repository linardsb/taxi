import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  rideRequestSchema,
  RT,
  type ApiErrorBody,
  type BookingChannel,
  type Ride,
  type RideCreated,
  type RideRequest,
  type RideRequestBody,
} from '@taxi/shared';
import { randomUUID } from 'node:crypto';
import { KV_STORE, type KeyValueStore } from '../../common/kv/kv.store';
import { mintTrackingToken, RideNotificationsService } from '../notifications';
import { PricingService } from '../pricing';
import { RealtimeService } from '../realtime';
import { entryStatusFor } from './ride-entry';
import type { RiderVisibleRide } from './rider-visible-ride';
import {
  DISPATCHER_BOOKING_MAX_PER_WINDOW,
  RIDE_IDEMPOTENCY_PENDING,
  RIDE_IDEMPOTENCY_PENDING_TTL_SECONDS,
  RIDE_IDEMPOTENCY_TTL_SECONDS,
  RIDE_REQUEST_MAX_PER_WINDOW,
  RIDE_REQUEST_WINDOW_SECONDS,
  dispatcherBookingRateKey,
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
    private readonly notifications: RideNotificationsService,
  ) {}

  /**
   * `bookingChannel` is a SERVER-SIDE argument, never wire input:
   * `rideRequestBodySchema` carries no such field, the rider-facing
   * controller always books `'app'`, and #19's dispatcher controller is the
   * one caller that will pass `'phone'`.
   */
  async request(
    riderId: string,
    idempotencyKey: string,
    body: RideRequestBody,
    bookingChannel: BookingChannel = 'app',
    /**
     * WHO the rate limit counts against, defaulting to the rider (#19 Q7).
     *
     * The cap bounds paid Routes calls, and on the rider path the rider is the
     * only actor. On the dispatcher path they are the wrong one: a venue
     * booking 25 cars in ten minutes creates 25 rides for 25 DIFFERENT riders,
     * so a rider key never trips and the cap does nothing — while one caller
     * rebooking would trip it and block a legitimate order mid-call. The
     * dispatcher is the actor whose keyboard produces the spend, and one human
     * is a natural rate limit; `BookingsService` passes their id.
     *
     * The MAGNITUDE moves with the subject, and must: the rider cap of 20 is
     * sized for someone who "re-quotes a handful of times at most", and leaving
     * it in place would 429 the 25-car venue this argument is built on.
     * `bookingChannel` selects `DISPATCHER_BOOKING_MAX_PER_WINDOW` instead.
     *
     * Note what does NOT move: `rideIdempotencyKey` stays rider-scoped, because
     * the thing being deduplicated is a RIDE, and two dispatchers booking the
     * same caller must not be able to collide on a key.
     */
    rateLimitSubject: string = riderId,
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
    //
    // The SHORT window, not the settled one: a marker nobody promotes is a key
    // no rider can clear, so it gets the shortest life that still covers a slow
    // first request. `recordIdempotency` promotes it on the way out.
    const key = rideIdempotencyKey(riderId, idempotencyKey);
    const reserved = await this.kv.setIfAbsent(
      key,
      RIDE_IDEMPOTENCY_PENDING,
      RIDE_IDEMPOTENCY_PENDING_TTL_SECONDS,
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
      await this.assertWithinRateLimit(rateLimitSubject, bookingChannel);
      return await this.createRide(key, request, riderId, bookingChannel);
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
   * ONE ride, for the rider who owns it (#16) — and THE READ IS ALSO THE JOIN.
   * It ships now rather than with #17 because of a hole in the socket layer,
   * not as a feature request.
   *
   * `roomsOnConnect()` never returns a ride room and `joinRideRoom()` only moves
   * the sockets that exist at the moment it runs. `notifyRider` runs that join
   * once, inside `POST /rides`, so EVERY socket created after the booking — the
   * rider app's status screen, which mounts on the `router.replace` that follows
   * `book()`, and every socket a reconnect replaces — is outside the ride room
   * and hears no `ride:status` at all. A REST snapshot alone left the screen
   * frozen on its first frame while reporting itself connected.
   *
   * So this route joins the caller's sockets to the ride room, and the rider app
   * calls it on EVERY socket `connect`. One mechanism closes both the
   * first-connect hole and the reconnect one; nothing else in the app needs to
   * know the room exists. The client still never names a room — `joinRideRoom`
   * is server-orchestrated, which is the rule `features/realtime/index.ts` sets.
   *
   * AFTER the ownership check, never before: the join is the one thing here that
   * changes server state, and joining first would put a stranger's socket in the
   * room the 404 below is about to deny them. Best-effort, like `notifyRider`'s
   * — a realtime failure must not turn a rider's state read into a 500. The
   * ordering is pinned by a test, not only by this paragraph: `ride-lifecycle`'s
   * "does NOT join a socket whose owner the read refuses" asserts a second
   * rider's socket stays silent after a 404, which is the only assertion that
   * would fail if someone hoisted the join above the check.
   *
   * THE SNAPSHOT IS TAKEN AFTER THE JOIN, in a second read. Taking it before
   * would leave a window — the first read's DB round trip — in which an
   * `emitStatus` reaches a room this socket has not joined AND is absent from
   * the body, so the transition is lost to the rider entirely: the client's next
   * chance is the next `connect`, and a healthy socket has none. Small (order
   * milliseconds) and real; a completion landing in it leaves the app showing
   * Cancel on a finished ride. The extra read costs one round trip per socket
   * connect, which is what "closes both holes" has to mean to be true.
   *
   * Rejoining a TERMINAL ride's room is deliberate and harmless: nothing emits
   * to it again (`leaveRideRoom` is called only for a REASSIGNED driver, never
   * for the rider), and the alternative — a status filter here — would decide by
   * guesswork which statuses may still move, when E8 says they can move backward.
   *
   * WHAT ACTUALLY CROSSES THE WIRE, rather than a list of what does not: the
   * `rides` row as `toRide` projects it, with `split` FORCED NULL — so `id`,
   * `orderId`, `status`, `riderId`, `driverId`, `geozoneId`, `paymentMethod`,
   * the rider's own `request`, the `quote`, `bookingChannel`, `trackingToken`
   * and the timestamps. `assignment` is `null` because `toRide` hardcodes it, so
   * a dispatcher's free-text override reason cannot reach a rider. `driverId` is
   * a bare uuid and NOT driver identity — no name, no plate, no phone, no
   * position, no ETA; those are #17's. `split` is stripped rather than merely
   * absent because `toRide` populates it the moment a ride settles: it is the
   * driver's transparency card (S2-5), and `rideQuotePreviewSchema` refuses to
   * carry it to a rider surface, so a settled ride read back by its own rider
   * must not be the door that does.
   *
   * ONE shape for both "no such ride" and "someone else's ride". A 403 on the
   * second would make this an existence oracle — a rider could walk uuids and
   * tell a real ride id from a fabricated one.
   */
  async findForRider(
    riderId: string,
    rideId: string,
  ): Promise<RiderVisibleRide> {
    // `findWithQuote` rather than a new rider-scoped read: the replay path
    // already reassembles exactly this, and the ownership check is one
    // comparison in the service. `undefined` also covers a ride with no quote,
    // which `create()` makes unreachable — every ride is written with one.
    const found = await this.rides.findWithQuote(rideId);
    if (!found || found.ride.riderId !== riderId) {
      throw new NotFoundException('ride_not_found');
    }

    try {
      this.realtime.joinRideRoom(riderId, rideId);
    } catch (error) {
      this.logger.warn({
        event: 'ride.read.join_failed',
        rideId,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
    }

    // The snapshot the caller gets, taken after the join — see the docblock.
    // `riderId` cannot change, so no second ownership check is owed; the
    // fallback is unreachable (nothing deletes a ride) and exists so a missing
    // row degrades to the pre-join snapshot rather than a 404 the caller has
    // already been told does not apply.
    const fresh = await this.rides.findWithQuote(rideId);
    return { ...(fresh ?? found).ride, split: null };
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
    bookingChannel: BookingChannel,
  ): Promise<RideCreated> {
    try {
      const { quote, split } = await this.pricing.quote(request);

      const ride = await this.rides.create({
        orderId: randomUUID(),
        status: entryStatusFor(request),
        request,
        quote,
        bookingChannel,
        trackingToken: mintTrackingToken(),
      });

      // ---- POST-COMMIT: nothing below may throw out of this method ----
      await this.recordIdempotency(key, ride.id);
      this.notifyRider(riderId, ride);
      // Fire-and-forget: onRideCreated catches everything itself — an SMS
      // failure never fails a booking.
      void this.notifications.onRideCreated(ride);

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
        event: 'ride.request.replay_conflicted',
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
   * Promotes the reservation to the ride id AND to the full window — the marker
   * was written with the short in-flight one.
   *
   * Swallows, for exactly the reason `notifyRider` does: the ride is already
   * committed. Letting a Redis blip here throw would run the caller's release,
   * delete the reservation, and hand the rider a 500 — so their retry reserves
   * a FREE key and books the second car this whole feature exists to prevent.
   *
   * The residue when it fails — or when the process dies before this runs — is
   * a key stuck at `pending`, so that attempt's retries get 409 until it
   * expires. Bounded to `RIDE_IDEMPOTENCY_PENDING_TTL_SECONDS` rather than a
   * day, which is the whole reason the two windows are separate constants.
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
  private async assertWithinRateLimit(
    subjectId: string,
    bookingChannel: BookingChannel,
  ): Promise<void> {
    // The CHANNEL picks both, because the subject alone does not say which
    // actor's model the cap was sized against. A rider's 20 is far below what
    // one dispatcher's shift produces — see `DISPATCHER_BOOKING_MAX_PER_WINDOW`
    // for the arithmetic, and plan Q7 for the 25-car venue it exists to admit.
    const viaDispatcher = bookingChannel === 'phone';
    const key = viaDispatcher
      ? dispatcherBookingRateKey(subjectId)
      : rideRequestRateKey(subjectId);
    const maxPerWindow = viaDispatcher
      ? DISPATCHER_BOOKING_MAX_PER_WINDOW
      : RIDE_REQUEST_MAX_PER_WINDOW;

    const attempts = await this.kv.incrWithTtl(
      key,
      RIDE_REQUEST_WINDOW_SECONDS,
    );
    if (attempts <= maxPerWindow) return;

    // The key can expire between the INCR and this read, and a
    // retryAfterSeconds of 0 would read as "retry now" on a rejection.
    const retryAfterSeconds = Math.max(1, await this.kv.ttl(key));
    this.logger.warn({
      event: 'ride.request.throttled',
      // The rider on the app path, the DISPATCHER on the phone path — whoever
      // the cap was counted against, so the line names the actor that was
      // actually throttled rather than a bystander.
      subjectId,
      attempts,
      at: new Date().toISOString(),
    });
    throw new HttpException(
      {
        message: 'too_many_requests',
        retryAfterSeconds,
      } satisfies ApiErrorBody,
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
