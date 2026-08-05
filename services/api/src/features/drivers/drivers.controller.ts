import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import {
  driverProfileUpdateSchema,
  driverStatusUpdateSchema,
  type DriverMe,
  type DriverProfile,
  type DriverProfileUpdate,
  type DriverStatusUpdate,
  type JwtClaims,
} from '@taxi/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth';
import { DriversService } from './drivers.service';

/**
 * Driver-self only. There is deliberately NO `:id` route here: `@Get(':id')`
 * would shadow `@Get('me')` under Express path matching (first registration
 * wins and `me` is a valid `:id` string). #20's admin-facing driver reads
 * belong on an `/admin/drivers` controller.
 *
 * The driver id always comes from the JWT, never a param or a body — the same
 * boundary `driverLocationPingSchema` enforces for sockets.
 */
@Controller('drivers')
@Roles('driver')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get('me')
  getMe(@CurrentUser() user: JwtClaims): Promise<DriverMe> {
    return this.drivers.getMe(user.sub);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: JwtClaims,
    @Body(new ZodValidationPipe(driverProfileUpdateSchema))
    body: DriverProfileUpdate,
  ): Promise<DriverProfile> {
    return this.drivers.updateProfile(user.sub, body);
  }

  @Put('me/status')
  setStatus(
    @CurrentUser() user: JwtClaims,
    @Body(new ZodValidationPipe(driverStatusUpdateSchema))
    body: DriverStatusUpdate,
  ): Promise<DriverProfile> {
    return this.drivers.setPresence(user.sub, body.status);
  }
}
