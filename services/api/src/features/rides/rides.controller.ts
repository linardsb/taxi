import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  idempotencyKeySchema,
  rideQuoteBodySchema,
  rideRequestBodySchema,
  type JwtClaims,
  type Ride,
  type RideCreated,
  type RideQuoteBody,
  type RideQuotePreview,
  type RideRequestBody,
} from '@taxi/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth';
import { IdempotencyKeyHeader } from './idempotency-key.decorator';
import { RideLifecycleService } from './lifecycle/ride-lifecycle.service';
import { RideQuoteService } from './ride-quote.service';
import { RidesService } from './rides.service';

/**
 * Rider-self by default. Dispatcher-created phone orders (#19) get their own
 * controller because they book ON BEHALF OF someone else.
 *
 * The rider id always comes from the JWT, never a param or a body:
 * `rideRequestBodySchema` has no `riderId` field, by construction, and
 * `rideQuoteBodySchema` inherits that.
 *
 * `GET /:rideId` LIVES HERE and, since #15, admits a DRIVER too — through a
 * per-route `@Roles('rider', 'driver')` rather than a move to
 * `RideLifecycleController`. `RolesGuard` reads with `getAllAndOverride`, so
 * the method list REPLACES the class list for this one route and every other
 * route keeps the class-level `rider`. Kept in place so the route registration
 * the rider app already depends on does not change: the rider branch is the
 * same `findForRider` as before, and the driver branch lives in the lifecycle
 * service (`rides.service.ts` sits at the line cap).
 */
@Controller('rides')
@Roles('rider')
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly quotes: RideQuoteService,
    private readonly lifecycle: RideLifecycleService,
  ) {}

  /**
   * `Idempotency-Key` is REQUIRED: a missing header is a 400, not a pass. An
   * optional one would leave "the request is not idempotent" true for any client
   * that omits it, which is the gap #46 closes.
   */
  @Post()
  create(
    @CurrentUser() user: JwtClaims,
    @IdempotencyKeyHeader(new ZodValidationPipe(idempotencyKeySchema))
    idempotencyKey: string,
    @Body(new ZodValidationPipe(rideRequestBodySchema)) body: RideRequestBody,
  ): Promise<RideCreated> {
    return this.rides.request(user.sub, idempotencyKey, body);
  }

  /**
   * The upfront price, with NO ride created (#16). `POST /rides` is the only
   * other quote path and it books a car as a side effect, so "see the price,
   * then decide" is not expressible against it.
   *
   * No `Idempotency-Key`: a preview creates nothing, so there is nothing to
   * deduplicate.
   *
   * `@HttpCode(OK)` because Nest answers 201 to every `@Post` by default, and
   * 201 Created is exactly the claim this route exists to NOT make.
   */
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  quote(
    @CurrentUser() user: JwtClaims,
    @Body(new ZodValidationPipe(rideQuoteBodySchema)) body: RideQuoteBody,
  ): Promise<RideQuotePreview> {
    return this.quotes.previewQuote(user.sub, body);
  }

  /**
   * The caller's own ride, and the call that puts their sockets in its ride
   * room — see `RidesService.findForRider` for why the socket alone never gets
   * there; the driver read (#15) joins for the same reason, on every socket
   * connect. NOT a pure read, and that is the point.
   *
   * Branches on the JWT role, never on a param: a rider gets the rider
   * projection (`split` forced null), a driver gets the ride they are driving
   * (`split` once settled). A dispatcher or admin is refused by `@Roles`
   * before this body runs.
   *
   * DECLARED LAST among the `@Get`s, and it must stay that way: there is no
   * other `@Get` on a literal path in this controller today, and adding one
   * BELOW this would have Nest match the literal as a uuid param.
   */
  @Get(':rideId')
  @Roles('rider', 'driver')
  read(
    @CurrentUser() user: JwtClaims,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ): Promise<Ride> {
    return user.role === 'driver'
      ? this.lifecycle.findForDriver(user.sub, rideId)
      : this.rides.findForRider(user.sub, rideId);
  }
}
