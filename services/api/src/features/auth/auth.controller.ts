import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  otpRequestSchema,
  otpVerifySchema,
  type AuthSession,
  type OtpRequest,
  type OtpRequestResponse,
  type OtpVerify,
} from '@taxi/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';

/** Both routes are @Public() — they are how a client gets its first token. */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // @HttpCode(200): @Post defaults to 201, and neither of these creates a resource.
  @Public()
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(
    @Body(new ZodValidationPipe(otpRequestSchema)) body: OtpRequest,
  ): Promise<OtpRequestResponse> {
    return this.auth.requestOtp(body);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(
    @Body(new ZodValidationPipe(otpVerifySchema)) body: OtpVerify,
  ): Promise<AuthSession> {
    return this.auth.verifyOtp(body);
  }
}
