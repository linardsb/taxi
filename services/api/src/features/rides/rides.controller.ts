import {
  Body,
  Controller,
  Get,
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
import { RideQuoteService } from './ride-quote.service';
import { RidesService } from './rides.service';

/**
 * Rider-self only. Dispatcher-created phone orders (#19) get their own
 * controller because they book ON BEHALF OF someone else.
 *
 * The rider id always comes from the JWT, never a param or a body:
 * `rideRequestBodySchema` has no `riderId` field, by construction, and
 * `rideQuoteBodySchema` inherits that.
 *
 * `GET /:rideId` LIVES HERE, and the class-level `@Roles('rider')` is why it
 * can. `RideLifecycleController` exists as a second controller on this prefix
 * because a rider-only class role would lock drivers out of the ride they are
 * driving — no such actor exists for this read, so no per-route role is needed.
 * If #17 or #19 later needs a non-rider single-ride read, THAT is when the route
 * moves and gains one.
 */
@Controller('rides')
@Roles('rider')
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly quotes: RideQuoteService,
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
   */
  @Post('quote')
  quote(
    @CurrentUser() user: JwtClaims,
    @Body(new ZodValidationPipe(rideQuoteBodySchema)) body: RideQuoteBody,
  ): Promise<RideQuotePreview> {
    return this.quotes.previewQuote(user.sub, body);
  }

  /**
   * The rider's own ride, so a reconnecting app can recover its state — see
   * `RidesService.findForRider` for why the socket alone cannot deliver that.
   *
   * DECLARED LAST among the `@Get`s, and it must stay that way: there is no
   * other `@Get` on a literal path in this controller today, and adding one
   * BELOW this would have Nest match the literal as a uuid param.
   */
  @Get(':rideId')
  read(
    @CurrentUser() user: JwtClaims,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ): Promise<Ride> {
    return this.rides.findForRider(user.sub, rideId);
  }
}
