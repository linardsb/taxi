import { Module } from '@nestjs/common';
import { RidersController } from './riders.controller';
import { RidersRepository } from './riders.repository';
import { RidersService } from './riders.service';

/**
 * The rider's own account surface (#17). No `imports`: the only dependency is
 * `DRIZZLE`, which `DbModule` provides globally, and the slice exports nothing
 * — the arrival push READS the token through the notifications slice's own
 * repository rather than through this one, because that read belongs to the
 * send that needs it.
 */
@Module({
  controllers: [RidersController],
  providers: [RidersService, RidersRepository],
})
export class RidersModule {}
