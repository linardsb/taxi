import {
  Controller,
  ForbiddenException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { JwtClaims, Ride, UserRole } from '@taxi/shared';
import { CurrentUser, Roles } from '../auth';
import { SettlementService, type SettlementActor } from './settlement.service';

/**
 * Who may settle, and as what — one arm per member of the CLOSED `USER_ROLES`
 * union, so adding a role to `@taxi/shared` fails to compile here until someone
 * decides whether it settles rides.
 *
 * That is a narrower guarantee than the ternary chain this replaced claimed to
 * make, and unlike that one it is real. No type can connect a `@Roles(...)`
 * decorator argument to a mapping, so adding a role to the DECORATOR still
 * compiles — what changed is where it lands. The old chain's catch-all arm was
 * `: 'dispatcher'`, the actor that BYPASSES the ownership check in
 * `SettlementService.settle`, and `rider` — the only role addable to `@Roles`
 * today — mapped straight onto it. Now it maps to `null` and is refused.
 */
const SETTLEMENT_ACTORS: Record<UserRole, SettlementActor | null> = {
  driver: 'driver',
  dispatcher: 'dispatcher',
  // NOT collapsed into `dispatcher` the way `cancel` does it: nothing here
  // forces that (there is no `settled_by_admin` status to lack), and the
  // settlement log is an audit trail that should say which of them acted.
  admin: 'admin',
  // A rider does not settle their own ride.
  rider: null,
};

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
    // FAIL CLOSED, not "fall through to dispatcher": `RolesGuard` should have
    // refused anything unmapped long before here, so reaching this throw means
    // the decorator and `SETTLEMENT_ACTORS` disagree — which is a bug to
    // surface, never a full override to hand out silently.
    const actor = SETTLEMENT_ACTORS[user.role];
    if (actor === null) throw new ForbiddenException('role_cannot_settle');

    return this.settlement.settle({ rideId, actor, actorId: user.sub });
  }
}
