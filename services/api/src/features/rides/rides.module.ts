import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers';
import { NotificationsModule } from '../notifications';
import { PricingModule } from '../pricing';
import { RealtimeModule } from '../realtime';
import { RideLifecycleController } from './lifecycle/ride-lifecycle.controller';
import { RideLifecycleRepository } from './lifecycle/ride-lifecycle.repository';
import { RideLifecycleService } from './lifecycle/ride-lifecycle.service';
import { RideQuoteService } from './ride-quote.service';
import { RideTransitionService } from './ride-transition.service';
import { RidesController } from './rides.controller';
import { RidesRepository } from './rides.repository';
import { RidesService } from './rides.service';

/**
 * `DriversModule` is imported for the `on_ride` claim/release, which the
 * lifecycle owns. No cycle: `DriversModule` imports only `RealtimeModule`.
 * `DispatchModule` must NOT be imported here — it already imports this module,
 * which is why the lifecycle reads `ride_offers` directly instead.
 * `NotificationsModule` supplies the two post-commit SMS hooks (#63); it reads
 * ride rows through its own repository and never imports this module back.
 */
@Module({
  imports: [PricingModule, RealtimeModule, DriversModule, NotificationsModule],
  controllers: [RidesController, RideLifecycleController],
  providers: [
    RidesService,
    RideQuoteService,
    RidesRepository,
    RideTransitionService,
    RideLifecycleService,
    RideLifecycleRepository,
  ],
  // #10 dispatches the rides this slice creates; the lifecycle transitions
  // them. The repository, the transition writer and `claimDriver` are exported
  // deliberately — see the barrel for why that cross-slice exception is the
  // lesser evil.
  exports: [
    RidesService,
    RidesRepository,
    RideTransitionService,
    RideLifecycleService,
  ],
})
export class RidesModule {}
