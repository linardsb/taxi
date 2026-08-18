import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  forceAssignBodySchema,
  reassignBodySchema,
  type DispatchBoardEvent,
  type DispatchRoster,
  type ForceAssignBody,
  type JwtClaims,
  type ReassignBody,
} from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth';
import { BoardService } from './board/board.service';
import { DispatchService } from './dispatch.service';
import { ForceAssignService } from './force-assign.service';
import { ReassignService } from './reassign.service';
import { RosterService } from './roster.service';

/**
 * `@Roles` is per-ROUTE here, not per-controller: drivers and dispatchers share
 * this controller, so a class-level `@Roles('driver')` would lock Dina out of
 * her own override.
 */
@Controller('dispatch')
export class DispatchController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly forceAssignService: ForceAssignService,
    private readonly reassignService: ReassignService,
    private readonly rosterService: RosterService,
    private readonly board: BoardService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /**
   * The console's snapshot read (#18) — the SAME payload the socket's
   * `dispatch:board` cadence pushes, so a (re)connecting or polling client
   * resyncs from one shape. Single-city pilot: the city is the deployment's,
   * never the caller's.
   */
  @Get('board')
  @Roles('dispatcher', 'admin')
  boardSnapshot(): Promise<DispatchBoardEvent> {
    return this.board.buildBoardState(this.env.DEFAULT_CITY_ID);
  }

  /**
   * The override picker's roster (#19) — EVERY driver, offline ones included,
   * which is precisely what the board frame is not. Request-scoped: fetched
   * when the picker opens, never pushed on the 2 s cadence. Same single-city
   * rule as the board above.
   */
  @Get('drivers')
  @Roles('dispatcher', 'admin')
  roster(): Promise<DispatchRoster> {
    return this.rosterService.listRoster(this.env.DEFAULT_CITY_ID);
  }

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
    return this.forceAssignService.forceAssign({
      dispatcherId: user.sub,
      rideId,
      driverId: body.driverId,
      reason: body.reason,
    });
  }

  /**
   * Swap the car on a ride that already has one (#19). A separate route from
   * `assign` rather than a mode of it: the two mean different things to the
   * ride — one puts a car on an unassigned ride, the other takes one off and
   * replaces it — and only this one can 409 with `ride_not_reassignable`.
   */
  @Post('rides/:rideId/reassign')
  @Roles('dispatcher', 'admin')
  reassign(
    @CurrentUser() user: JwtClaims,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body(new ZodValidationPipe(reassignBodySchema)) body: ReassignBody,
  ): Promise<{ rideId: string }> {
    return this.reassignService.reassign({
      dispatcherId: user.sub,
      rideId,
      driverId: body.driverId,
      reason: body.reason,
    });
  }
}
