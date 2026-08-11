import { Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import type { SmsProvider } from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { SMS_PROVIDER } from './sms/sms.tokens';
import { StubSmsProvider } from './sms/stub-sms.provider';
import { TwilioSmsProvider } from './sms/twilio-sms.provider';

/**
 * The `TWILIO_*` trio binds `TwilioSmsProvider` (#85) — the schema's refines
 * already vetted the values, so trio-presence IS the client construction (the
 * `paymentsProviderFactory` shape, minus the SDK-handle token: `fetch` is
 * ambient). Until the trio is set, production refuses to boot:
 * `StubSmsProvider` delivers no SMS and logs the code in full, so an
 * internet-facing deploy that reached it would hand full sign-in to anyone
 * with log read access — the OTP *is* the credential. Structural rather than
 * conventional.
 */
export function smsProviderFactory(env: Env): SmsProvider {
  if (
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_FROM_NUMBER
  ) {
    return new TwilioSmsProvider({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      from: env.TWILIO_FROM_NUMBER,
    });
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'No production SmsProvider is bound: StubSmsProvider delivers nothing and logs OTP codes in full. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER (#85) before running with NODE_ENV=production.',
    );
  }
  return new StubSmsProvider();
}

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_SECRET,
        // `ms` types expiresIn as a template-literal union ('30d', '2h', …),
        // which no env-sourced string can satisfy statically. The value is a
        // validated string; `ms` throws at boot on anything it can't parse.
        signOptions: {
          expiresIn: env.JWT_EXPIRES_IN as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    AuthTokenService,
    {
      provide: SMS_PROVIDER,
      inject: [APP_ENV],
      useFactory: smsProviderFactory,
    },
  ],
  // AuthTokenService is the realtime gateway's only dependency on this slice.
  exports: [AuthTokenService],
})
export class AuthModule {}
