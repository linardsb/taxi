import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  assertFareQuoteConsistent,
  resolveCommissionPct,
  splitFare,
  type CommissionDriverInput,
  type FareQuote,
  type FareSplit,
  type MapsProvider,
  type PricingStrategy,
  type RideRequest,
} from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { MAPS_PROVIDER } from '../geo';
import { PlatformConfigService } from '../platform-config';
import { PRICING_STRATEGY } from './pricing.tokens';

/**
 * Composes the three seams a price needs: route (maps) → fare (strategy) →
 * commission (platform config).
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @Inject(MAPS_PROVIDER) private readonly maps: MapsProvider,
    @Inject(PRICING_STRATEGY) private readonly strategy: PricingStrategy,
    private readonly platformConfig: PlatformConfigService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async quote(
    request: RideRequest,
  ): Promise<{ quote: FareQuote; split: FareSplit }> {
    // `request.stops` are AddressPoints; the seam takes LatLngs.
    const route = await this.maps.route(
      request.pickup.location,
      request.destination.location,
      request.stops.map((stop) => stop.location),
    );

    const quote = await this.strategy.quote(request, route);
    assertFareQuoteConsistent(quote);

    const config = await this.platformConfig.forCity(this.env.DEFAULT_CITY_ID);

    // No driver exists at quote time, so the resolution can only be the
    // platform base — `CommissionDriverInput` is structural precisely so
    // "nobody yet" is expressible. #10 re-resolves per driver once one is
    // picked (a `commissionPctOverride` changes it), #11 writes the settled
    // split.
    const NO_DRIVER_YET: CommissionDriverInput = {};
    const split = splitFare(
      quote.totalCents,
      resolveCommissionPct(NO_DRIVER_YET, config),
    );

    // No addresses and no coordinates — logging-standard.md allows nothing
    // finer than a geozone name.
    this.logger.log({
      event: 'ride.pricing.quote_created',
      category: request.category,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      totalCents: quote.totalCents,
      commissionPct: split.commissionPct,
      commissionSource: split.commissionSource,
      at: new Date().toISOString(),
    });

    return { quote, split };
  }
}
