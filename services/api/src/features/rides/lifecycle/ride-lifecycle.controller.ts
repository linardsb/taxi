import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  rideCancelSchema,
  ridePaymentMethodUpdateSchema,
  type JwtClaims,
  type Ride,
  type RideCancel,
  type RidePaymentMethodUpdate,
} from '@taxi/shared';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../../auth';
import type { LifecycleActor } from './ride-lifecycle.policy';
import { RideLifecycleService } from './ride-lifecycle.service';

/**
 * The ride's own routes from `accepted` onward. A SECOND controller on the
 * `rides` prefix, deliberately: `RidesController` is class-level
 * `@Roles('rider')`, and a rider-only class role would lock the driver out of
 * the ride they are driving. So `@Roles` is per-ROUTE here, exactly as
 * `DispatchController` does for the same reason.
 *
 * Identity always comes from the JWT: the `:rideId` param says WHICH ride, the
 * token says who is acting, and no body carries an actor.
 */
@Controller('rides')
export class RideLifecycleController {
  constructor(private readonly lifecycle: RideLifecycleService) {}

  @Post(':rideId/arriving')
  @Roles('driver')
  async arriving(
    @CurrentUser() user: JwtClaims,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ): Promise<{ ok: true }> {
    await this.lifecycle.driverStep('arriving', user.sub, rideId);
    return { ok: true };
  }

  @Post(':rideId/arrived')
  @Roles('driver')
  async arrived(
    @CurrentUser() user: JwtClaims,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ): Promise<{ ok: true }> {
    await this.lifecycle.driverStep('arrived', user.sub, rideId);
    return { ok: true };
  }

  @Post(':rideId/start')
  @Roles('driver')
  async start(
    @CurrentUser() user: JwtClaims,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ): Promise<{ ok: true }> {
    await this.lifecycle.driverStep('start', user.sub, rideId);
    return { ok: true };
  }

  /** Returns the settled ride — the full fare and the commission line, at the
   *  one moment the driver wants them. */
  @Post(':rideId/complete')
  @Roles('driver')
  complete(
    @CurrentUser() user: JwtClaims,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ): Promise<{ ride: Ride }> {
    return this.lifecycle.complete(user.sub, rideId);
  }

  /**
   * `admin → dispatcher`: an admin cancelling is doing a dispatcher's job, and
   * the machine has no `cancelled_by_admin`. Adding a fifth status for it would
   * be a shared-contract plus database-enum change; the audit answer is #20's
   * admin view.
   */
  @Post(':rideId/cancel')
  @Roles('rider', 'driver', 'dispatcher', 'admin')
  async cancel(
    @CurrentUser() user: JwtClaims,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body(new ZodValidationPipe(rideCancelSchema)) body: RideCancel,
  ): Promise<{ ok: true }> {
    const actor: LifecycleActor =
      user.role === 'admin' ? 'dispatcher' : user.role;
    await this.lifecycle.cancel({
      rideId,
      actor,
      actorId: user.sub,
      reason: body.reason,
    });
    return { ok: true };
  }

  @Patch(':rideId/payment-method')
  @Roles('rider')
  changePaymentMethod(
    @CurrentUser() user: JwtClaims,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body(new ZodValidationPipe(ridePaymentMethodUpdateSchema))
    body: RidePaymentMethodUpdate,
  ): Promise<{ ride: Ride }> {
    return this.lifecycle.changePaymentMethod(
      rideId,
      user.sub,
      body.paymentMethod,
    );
  }
}
