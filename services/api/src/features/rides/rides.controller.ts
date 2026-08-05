import { Body, Controller, Post } from '@nestjs/common';
import {
  rideRequestBodySchema,
  type JwtClaims,
  type RideCreated,
  type RideRequestBody,
} from '@taxi/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth';
import { RidesService } from './rides.service';

/**
 * Rider-self only. There is deliberately NO `:id` route here — ride reads
 * belong to #11/#16, and dispatcher-created phone orders (#19) get their own
 * controller because they book ON BEHALF OF someone else.
 *
 * The rider id always comes from the JWT, never a param or a body:
 * `rideRequestBodySchema` has no `riderId` field, by construction.
 */
@Controller('rides')
@Roles('rider')
export class RidesController {
  constructor(private readonly rides: RidesService) {}

  @Post()
  create(
    @CurrentUser() user: JwtClaims,
    @Body(new ZodValidationPipe(rideRequestBodySchema)) body: RideRequestBody,
  ): Promise<RideCreated> {
    return this.rides.request(user.sub, body);
  }
}
