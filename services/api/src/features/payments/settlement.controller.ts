import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { JwtClaims, Ride } from '@taxi/shared';
import { CurrentUser, Roles } from '../auth';
import { SettlementService, type SettlementActor } from './settlement.service';

/**
 * The THIRD `@Controller('rides')` in the codebase, and the split is by
 * ownership: `RidesController` creates and quotes rides (class-level
 * `@Roles('rider')`), `RideLifecycleController` runs the ride from `accepted` to
 * `completed`, and this one moves the money afterwards. Per-ROUTE `@Roles` for
 * the reason the lifecycle controller documents — one prefix serves several
 * actors, and a class-level role would lock out the rest.
 *
 * There is NO BODY on this route: the `:rideId` param says which ride, the token
 * says who is acting, and the amount comes from the settled split #11 already
 * wrote. Nothing a client sends can change what is charged.
 */
@Controller('rides')
export class SettlementController {
  constructor(private readonly settlement: SettlementService) {}

  @Post(':rideId/settle')
  @Roles('driver', 'dispatcher', 'admin')
  settle(
    @CurrentUser() user: JwtClaims,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ): Promise<{ ride: Ride }> {
    // `rider` is absent from `@Roles` entirely — a rider does not settle their
    // own ride. Driver, dispatcher and admin are exactly the settlement actors,
    // and dispatcher/admin are what make a stuck ride recoverable by hand today.
    //
    // Mapped explicitly rather than cast: the guard already narrows the role to
    // these three, but a cast would keep compiling if a fourth were added to
    // `@Roles` and would silently authorize it as a dispatcher. Unlike
    // `cancel`, `admin` is NOT collapsed into `dispatcher` — nothing here forces
    // it (there is no `settled_by_admin` status to lack), and the settlement log
    // is an audit trail that should say which of them actually did it.
    const actor: SettlementActor =
      user.role === 'driver'
        ? 'driver'
        : user.role === 'admin'
          ? 'admin'
          : 'dispatcher';

    return this.settlement.settle({ rideId, actor, actorId: user.sub });
  }
}
