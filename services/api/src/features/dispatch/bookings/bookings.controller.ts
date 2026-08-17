import { Body, Controller, Post } from '@nestjs/common';
import {
  dispatcherBookingBodySchema,
  idempotencyKeySchema,
  type DispatcherBookingBody,
  type JwtClaims,
  type RideCreated,
} from '@taxi/shared';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../../auth';
import { IdempotencyKeyHeader } from '../../rides';
import { BookingsService } from './bookings.service';

/**
 * Its own controller, not a mode of `RidesController` — which states the reason
 * in prose: a dispatcher books ON BEHALF OF someone else, so the identity rules
 * are inverted. The rider path takes the rider from the JWT; this path takes
 * the DISPATCHER from the JWT and the rider from a phone number in the body.
 */
@Controller('dispatch')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /**
   * `Idempotency-Key` is REQUIRED, exactly as on the rider path and with more
   * force: a keyboard-first form, a dispatcher typing fast on a call, and a
   * console that reconnects is precisely the double-submit case. A missing
   * header is a 400, never a booking.
   */
  @Post('bookings')
  @Roles('dispatcher', 'admin')
  book(
    @CurrentUser() user: JwtClaims,
    @IdempotencyKeyHeader(new ZodValidationPipe(idempotencyKeySchema))
    idempotencyKey: string,
    @Body(new ZodValidationPipe(dispatcherBookingBodySchema))
    body: DispatcherBookingBody,
  ): Promise<RideCreated> {
    return this.bookings.book(user.sub, idempotencyKey, body);
  }
}
