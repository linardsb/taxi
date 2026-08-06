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
    // Read BEFORE the maps call: this throws hard on a missing row (the
    // config-not-constant rule), and an unseeded environment should not spend
    // a paid route call only to 500 three lines later.
    const config = await this.platformConfig.forCity(this.env.DEFAULT_CITY_ID);

    // `request.stops` are AddressPoints; the seam takes LatLngs.
    const route = await this.maps.route(
      request.pickup.location,
      request.destination.location,
      request.stops.map((stop) => stop.location),
    );

    const quote = await this.strategy.quote(request, route);
    assertFareQuoteConsistent(quote);

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

  /**
   * The platform-base preview split for a total, with no driver in the picture.
   *
   * Public because the idempotent replay path needs it: a replayed request must
   * return the same shape as the original WITHOUT spending a route call, and the
   * split is computed, never persisted (see `rideCreatedSchema`).
   *
   * The two lines below are duplicated from `quote()` rather than shared with
   * it, on purpose. `PlatformConfigService.forCity` does not cache — its
   * docstring forbids adding one, because "a stale commission is a money bug" —
   * so routing `quote()` through here would double the config read on the hot
   * path to save three lines on the cold one.
   */
  async previewSplit(totalCents: number): Promise<FareSplit> {
    const config = await this.platformConfig.forCity(this.env.DEFAULT_CITY_ID);
    const NO_DRIVER_YET: CommissionDriverInput = {};
    return splitFare(totalCents, resolveCommissionPct(NO_DRIVER_YET, config));
  }
}
