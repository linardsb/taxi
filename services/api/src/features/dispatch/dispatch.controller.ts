import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { JwtClaims } from '@taxi/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth';
import { DispatchService } from './dispatch.service';

/**
 * Locally defined, deliberately NOT a shared contract: this body never crosses a
 * surface boundary until #19 draws the override UI, and that ticket can promote
 * it then. #10 adds no new shared contract.
 *
 * No `dispatcherId` field, by construction — the same rule as
 * `rideRequestBodySchema` omitting `riderId`. A body-supplied dispatcher id
 * would make the S9-2 audit trail forgeable, which is the one thing the audit
 * row exists to prevent.
 */
const forceAssignBodySchema = z.object({
  driverId: z.string().uuid(),
  reason: z.string().max(280).nullable().default(null),
});
type ForceAssignBody = z.infer<typeof forceAssignBodySchema>;

/**
 * `@Roles` is per-ROUTE here, not per-controller: drivers and dispatchers share
 * this controller, so a class-level `@Roles('driver')` would lock Dina out of
 * her own override.
 */
@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Post('offers/:offerId/accept')
  @Roles('driver')
  accept(
    @CurrentUser() user: JwtClaims,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ): Promise<{ rideId: string }> {
    // Identity from the JWT; the route carries no driver id and the ride id
    // comes off the offer ROW, never the request.
    return this.dispatch.accept(user.sub, offerId);
  }

  @Post('offers/:offerId/decline')
  @Roles('driver')
  async decline(
    @CurrentUser() user: JwtClaims,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ): Promise<{ ok: true }> {
    await this.dispatch.decline(user.sub, offerId);
    return { ok: true };
  }

  /**
   * Dina's override (S9-2). `rideId` is a route param and `driverId` a body
   * field — both legitimate here, because a dispatcher is acting on someone
   * else's behalf by design. Only the DISPATCHER's identity is taken from the
   * token.
   */
  @Post('rides/:rideId/assign')
  @Roles('dispatcher', 'admin')
  forceAssign(
    @CurrentUser() user: JwtClaims,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body(new ZodValidationPipe(forceAssignBodySchema)) body: ForceAssignBody,
  ): Promise<{ rideId: string }> {
    return this.dispatch.forceAssign({
      dispatcherId: user.sub,
      rideId,
      driverId: body.driverId,
      reason: body.reason,
    });
  }
}
