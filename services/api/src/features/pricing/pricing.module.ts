import { Module } from '@nestjs/common';
import { GeoModule } from '../geo';
import { PlatformConfigModule } from '../platform-config';
import { PricingService } from './pricing.service';
import { PRICING_STRATEGY } from './pricing.tokens';
import { TariffRepository } from './tariff.repository';
import { UpfrontFixedPricingStrategy } from './upfront-fixed.strategy';

/**
 * `GeoModule` and `PlatformConfigModule` are imported rather than absorbed:
 * #10 needs both directly (ETAs, `offerTimeoutSeconds`) and must not reach them
 * through this barrel.
 */
@Module({
  imports: [GeoModule, PlatformConfigModule],
  providers: [
    PricingService,
    TariffRepository,
    { provide: PRICING_STRATEGY, useClass: UpfrontFixedPricingStrategy },
  ],
  exports: [PricingService],
})
export class PricingModule {}
