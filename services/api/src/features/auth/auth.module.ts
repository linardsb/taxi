import { Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import type { SmsProvider } from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { BudgetSmsProvider } from './sms/budgetsms.provider';
import { BulkGateSmsProvider } from './sms/bulkgate-sms.provider';
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
 *
 * `SMS_PROVIDER` names a kind outright (#137). It exists because a delivery
 * bake-off funds two or three vendor accounts AT ONCE, so credential presence
 * can no longer disambiguate them. `'auto'` is exactly the paragraph above —
 * the default, and what every existing `.env` already means. Naming a kind is
 * a selection, NOT a fallback chain: exactly one provider binds, and there is
 * no failover to a second vendor (a silent one would make the scorecard
 * unreadable).
 *
 * **The production refusal is unchanged.** It still fires on the same
 * condition — nothing bound and `NODE_ENV=production` — and `'auto'` reaches
 * it by the same path it always did.
 */
export function smsProviderFactory(env: Env): SmsProvider {
  // The non-null assertions below are load-bearing on the schema, not on
  // luck: `SMS_PROVIDER` can only hold a named kind once the superRefine has
  // confirmed that kind's whole credential group. Same reasoning
  // `auth.module.spec.ts` records for the trio — the values are only present
  // when they passed the schema's refines.
  if (env.SMS_PROVIDER === 'bulkgate') {
    return new BulkGateSmsProvider({
      applicationId: env.BULKGATE_APPLICATION_ID!,
      applicationToken: env.BULKGATE_APPLICATION_TOKEN!,
      senderIdValue: env.BULKGATE_SENDER_ID_VALUE!,
    });
  }
  if (env.SMS_PROVIDER === 'budgetsms') {
    return new BudgetSmsProvider({
      username: env.BUDGETSMS_USERNAME!,
      userid: env.BUDGETSMS_USERID!,
      handle: env.BUDGETSMS_HANDLE!,
      from: env.BUDGETSMS_FROM!,
      // No `baseUrl`: `/testsms/` is the bake-off script's business, never a
      // deploy's.
    });
  }
  // Both `'twilio'` and `'auto'` land here, and deliberately share one branch
  // rather than getting a second construction each: under `'twilio'` the
  // superRefine has already demanded the trio, so the presence test it would
  // duplicate can only pass.
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
