import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing';
import { RealtimeModule } from '../realtime';
import { RideTransitionService } from './ride-transition.service';
import { RidesController } from './rides.controller';
import { RidesRepository } from './rides.repository';
import { RidesService } from './rides.service';

@Module({
  imports: [PricingModule, RealtimeModule],
  controllers: [RidesController],
  providers: [RidesService, RidesRepository, RideTransitionService],
  // #10 dispatches the rides this slice creates; #11 transitions them. The
  // repository and the transition writer are exported deliberately — see the
  // barrel for why that cross-slice exception is the lesser evil.
  exports: [RidesService, RidesRepository, RideTransitionService],
})
export class RidesModule {}
