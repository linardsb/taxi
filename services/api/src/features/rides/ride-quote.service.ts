import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  rideRequestSchema,
  type ApiErrorBody,
  type RideQuoteBody,
  type RideQuotePreview,
} from '@taxi/shared';
import { KV_STORE, type KeyValueStore } from '../../common/kv/kv.store';
import { PricingService } from '../pricing';
import {
  RIDE_QUOTE_MAX_PER_WINDOW,
  RIDE_REQUEST_WINDOW_SECONDS,
  rideQuoteRateKey,
} from './rides.policy';

/**
 * The price a rider sees BEFORE committing (#16) — `POST /rides/quote`.
 *
 * A SIBLING of `RidesService` rather than a method on it, and the split is
 * along a real seam: this path creates nothing. No idempotency reservation, no
 * repository write, no realtime emit, no state transition — it reads
 * `platform_config`, spends one (usually cached) Routes call, and returns.
 * `RidesService.request` is an orchestration with a post-commit boundary; a
 * preview has no commit to be after.
 *
 * The throttle below is DUPLICATED from `RidesService.assertWithinRateLimit`
 * rather than shared, deliberately. That method takes `(subjectId,
 * bookingChannel)` and picks key AND cap from the channel together, which is
 * load-bearing: `DISPATCHER_BOOKING_MAX_PER_WINDOW`'s derivation (30 + 25 = 55;
 * 60 clears it with ~9% headroom) assumes the pair moves as one. Widening it to
 * `(key, maxPerWindow)` would make it possible for a later caller to pair the
 * dispatcher key with the rider cap and 429 a venue mid-call — and it would
 * re-derive two LIVE MONEY CAPS inside a rider-app ticket. Ten duplicated lines
 * are the cheaper evil. Adding a third `bookingChannel` value would be the same
 * mistake by another door: a preview is not a booking channel.
 */
@Injectable()
export class RideQuoteService {
  private readonly logger = new Logger(RideQuoteService.name);

  constructor(
    private readonly pricing: PricingService,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
  ) {}

  async previewQuote(
    riderId: string,
    body: RideQuoteBody,
  ): Promise<RideQuotePreview> {
    // BEFORE the pricing call: the cap exists to bound paid Routes calls, so a
    // throttled preview must cost nothing.
    await this.assertWithinRateLimit(riderId);

    // `PricingService.quote()` takes a full `RideRequest`, which the preview
    // body deliberately does not carry: `riderId` comes from the JWT (the same
    // rule that keeps it off `rideRequestBodySchema`), and `paymentMethod` is
    // FIXED at 'cash'.
    //
    // Fixed, not defaulted, and the difference matters: `UpfrontFixedStrategy`
    // does not read it, and `docs/research/rider-ux-evidence.md` §7 requires
    // cash and card to show ONE identical price — diverging prices are what
    // creates distrust. A future strategy that DOES read `paymentMethod` must
    // fail review here rather than silently pricing every preview as cash.
    const request = rideRequestSchema.parse({
      ...body,
      riderId,
      paymentMethod: 'cash',
    });

    let quote;
    try {
      ({ quote } = await this.pricing.quote(request));
    } catch (error) {
      // The same reason `RidesService.createRide` writes `ride.request.failed`,
      // and it transfers verbatim: without this a 500 on `/rides/quote` leaves
      // nothing to tell "one rider, one corridor" from "maps is down". This is
      // the HIGHER-volume paid-Routes caller of the two (cap 30 vs 20), and the
      // only other line a Routes timeout emits is `geo.maps.route_failed`,
      // which carries a cell hash and no actor by design.
      this.logger.error({
        event: 'ride.quote.failed',
        riderId,
        category: request.category,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
      throw error;
    }

    this.logger.log({
      event: 'ride.quote.previewed',
      riderId,
      category: request.category,
      totalCents: quote.totalCents,
      at: new Date().toISOString(),
    });

    // The split is DISCARDED, not forwarded. `rideQuotePreviewSchema` has no
    // `split` field: the commission line is the driver's transparency card
    // (S2-5), and a rider-facing preview has no reason to hold it.
    return { quote };
  }

  /**
   * MIRRORS `RidesService.assertWithinRateLimit`'s mechanics — INCR-then-check
   * (a GET-then-INCR would let a burst all read the same count and every one of
   * them through), the same `Math.max(1, …)` floor because a
   * `retryAfterSeconds` of 0 reads as "retry now" to the client that was just
   * throttled, and the same `ApiErrorBody` 429 shape.
   */
  private async assertWithinRateLimit(riderId: string): Promise<void> {
    const key = rideQuoteRateKey(riderId);
    const attempts = await this.kv.incrWithTtl(
      key,
      RIDE_REQUEST_WINDOW_SECONDS,
    );
    if (attempts <= RIDE_QUOTE_MAX_PER_WINDOW) return;

    const retryAfterSeconds = Math.max(1, await this.kv.ttl(key));
    this.logger.warn({
      event: 'ride.quote.throttled',
      riderId,
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
}
