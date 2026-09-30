import { HttpException, HttpStatus, type Logger } from '@nestjs/common';
import type { ApiErrorBody, BookingChannel } from '@taxi/shared';
import type { KeyValueStore } from '../../common/kv/kv.store';
import {
  DISPATCHER_BOOKING_MAX_PER_WINDOW,
  RIDE_IDEMPOTENCY_TTL_SECONDS,
  RIDE_REQUEST_MAX_PER_WINDOW,
  RIDE_REQUEST_WINDOW_SECONDS,
  dispatcherBookingRateKey,
  rideRequestRateKey,
} from './rides.policy';

/*
 * `RidesService.request`'s two Redis-backed guards, moved out of that class
 * unchanged (#123) to keep it under the 500-line cap.
 */

/**
 * Spent before the quote, so a throttled request costs no paid Routes call.
 * INCR-then-check like the auth slice: a GET-then-INCR would let a burst all
 * read the same count and every one of them through.
 */
export async function assertWithinRideRateLimit(
  kv: KeyValueStore,
  logger: Logger,
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

  const attempts = await kv.incrWithTtl(key, RIDE_REQUEST_WINDOW_SECONDS);
  if (attempts <= maxPerWindow) return;

  // The key can expire between the INCR and this read, and a
  // retryAfterSeconds of 0 would read as "retry now" on a rejection.
  const retryAfterSeconds = Math.max(1, await kv.ttl(key));
  logger.warn({
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
export async function recordIdempotency(
  kv: KeyValueStore,
  logger: Logger,
  key: string,
  rideId: string,
): Promise<void> {
  try {
    await kv.setWithTtl(key, rideId, RIDE_IDEMPOTENCY_TTL_SECONDS);
  } catch (error) {
    logger.error({
      event: 'ride.request.idempotency_write_failed',
      rideId,
      reason: error instanceof Error ? error.message : 'unknown',
      at: new Date().toISOString(),
    });
  }
}
