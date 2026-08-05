import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing';
import { RealtimeModule } from '../realtime';
import { RidesController } from './rides.controller';
import { RidesRepository } from './rides.repository';
import { RidesService } from './rides.service';

@Module({
  imports: [PricingModule, RealtimeModule],
  controllers: [RidesController],
  providers: [RidesService, RidesRepository],
  // #10 dispatches the rides this slice creates; #11 transitions them.
  exports: [RidesService],
})
export class RidesModule {}
