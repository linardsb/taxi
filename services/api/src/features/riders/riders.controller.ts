import { Body, Controller, Delete, HttpCode, Put } from '@nestjs/common';
import {
  pushTokenUpdateSchema,
  type JwtClaims,
  type PushTokenUpdate,
} from '@taxi/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth';
import { RidersService } from './riders.service';

/**
 * Rider-self only (#17). Like `DriversController` there is deliberately NO
 * `:id` route: the rider id always comes from the JWT, never a param or a
 * body, so no rider can register a token against another rider's account.
 *
 * Nothing here reads. The token is write-only by design — it is a provider
 * handle, and putting it in a response body is how one reaches a log.
 */
@Controller('riders')
@Roles('rider')
export class RidersController {
  constructor(private readonly riders: RidersService) {}

  /** Registered on every signed-in app start (#17); 204, no body back. */
  @Put('me/push-token')
  @HttpCode(204)
  setPushToken(
    @CurrentUser() user: JwtClaims,
    @Body(new ZodValidationPipe(pushTokenUpdateSchema)) body: PushTokenUpdate,
  ): Promise<void> {
    return this.riders.setPushToken(user.sub, body.token);
  }

  @Delete('me/push-token')
  @HttpCode(204)
  clearPushToken(@CurrentUser() user: JwtClaims): Promise<void> {
    return this.riders.clearPushToken(user.sub);
  }
}
