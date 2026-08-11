import { Module } from '@nestjs/common';
import { APP_ENV } from '../../common/config/env.schema';
import { smsProviderFactory, SMS_PROVIDER } from '../auth';
import { DriversModule } from '../drivers';
import { GeoModule } from '../geo';
import { PlatformConfigModule } from '../platform-config';
import { NotificationsRepository } from './notifications.repository';
import { RideNotificationsService } from './ride-notifications.service';
import { TrackingController } from './tracking/tracking.controller';
import { TrackingService } from './tracking/tracking.service';

/**
 * `SMS_PROVIDER` is bound HERE TOO, with auth's exported factory — a
 * deliberate duplicate: Nest providers are module-scoped, two stub instances
 * are harmless, and the test harness's `overrideProvider(SMS_PROVIDER)`
 * overrides the token across the whole compiled graph, so one
 * `RecordingSmsProvider` still captures both OTP and ride SMS. Importing
 * AuthModule instead would work only if auth exported its provider binding,
 * which would let ANY module inject SMS off auth's back silently.
 *
 * `PlatformConfigModule` is deliberately not `@Global()` — the import is the
 * declared dependency (`dispatchPhone` on the tracking view). `DriversModule`
 * supplies `DRIVER_LOCATION_STORE` for live positions. `GeoModule` supplies
 * `MAPS_PROVIDER`, the cached seam behind the tracking page's road ETA (#87).
 */
@Module({
  imports: [DriversModule, GeoModule, PlatformConfigModule],
  controllers: [TrackingController],
  providers: [
    RideNotificationsService,
    NotificationsRepository,
    TrackingService,
    {
      provide: SMS_PROVIDER,
      inject: [APP_ENV],
      useFactory: smsProviderFactory,
    },
  ],
  // The rides slice fires both hooks — the only intended consumer.
  exports: [RideNotificationsService],
})
export class NotificationsModule {}
