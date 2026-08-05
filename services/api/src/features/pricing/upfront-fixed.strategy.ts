import { Inject, Injectable } from '@nestjs/common';
import {
  fareQuoteSchema,
  type FareQuote,
  type PricingStrategy,
  type RideRequest,
  type RouteResult,
} from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { TariffRepository } from './tariff.repository';

/**
 * The `upfront_fixed` implementation of the `PricingStrategy` seam: the rider
 * is told the exact price before committing — no meter anxiety, no invisible
 * surge.
 *
 * Every line is `Math.round`ed INDEPENDENTLY and the total is their SUM, never
 * a separately-rounded product. That is what keeps `isFareQuoteConsistent` true
 * at any input, and it is the same no-leak discipline `splitFare` applies to
 * the commission.
 *
 * Rates come from a `ride_tariffs` row — no rate is ever a literal here.
 */
@Injectable()
export class UpfrontFixedPricingStrategy implements PricingStrategy {
  readonly model = 'upfront_fixed' as const;

  constructor(
    private readonly tariffs: TariffRepository,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async quote(request: RideRequest, route: RouteResult): Promise<FareQuote> {
    const tariff = await this.tariffs.forCategory(
      this.env.DEFAULT_CITY_ID,
      request.category,
    );

    const distanceCents = Math.round(
      (tariff.perKmCents * route.distanceMeters) / 1000,
    );
    const timeCents = Math.round(
      (tariff.perMinuteCents * route.durationSeconds) / 60,
    );
    const beforeMinimum = tariff.baseCents + distanceCents + timeCents;

    // The minimum-fare top-up lands on the BASE line, not as a fifth line:
    // `fareLineTypeEnum` has exactly four values, and a total that exceeds its
    // own breakdown fails `assertFareQuoteConsistent` — which #11 settles and
    // #20 reports against. "The drop covers the first bit" is also how a taxi
    // meter reads. Scaling all three lines to reach the minimum was rejected:
    // it makes `distanceCents` a number that does not correspond to the
    // distance, which is a lie the driver's transparency card would repeat.
    const baseCents =
      tariff.baseCents + Math.max(0, tariff.minimumFareCents - beforeMinimum);

    return fareQuoteSchema.parse({
      model: this.model,
      currency: 'EUR',
      totalCents: baseCents + distanceCents + timeCents,
      breakdown: { baseCents, distanceCents, timeCents, discountCents: 0 },
    });
  }
}
