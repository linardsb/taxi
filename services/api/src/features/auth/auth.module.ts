import { Logger, Module } from '@nestjs/common';
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

const logger = new Logger('smsProviderFactory');

/**
 * `SMS_PROVIDER` states which `SmsProvider` binds, and nothing else selects
 * one (#137). Until it names a real vendor, production refuses to boot:
 * `StubSmsProvider` delivers no SMS and logs the code in full, so an
 * internet-facing deploy that reached it would hand full sign-in to anyone
 * with log read access — the OTP *is* the credential. Structural rather than
 * conventional. `pushProviderFactory` (`features/push/push.module.ts`) is the
 * same function over the same reasoning.
 *
 * Naming a kind is a selection, NOT a fallback chain: exactly one provider
 * binds, and there is no failover to a second vendor (a silent one would make
 * the bake-off's scorecard unreadable and its €/week ledger wrong).
 *
 * **`'auto'` was retired here.** #240 shipped it as the default, meaning "the
 * `TWILIO_*` trio decides" — correct while the ticket's job was to measure
 * rather than migrate, and wrong the moment a second vendor account is
 * funded, which is the state the bake-off creates: an operator who adds a
 * complete `BULKGATE_*` group and forgets the selector got Twilio, silently,
 * and every OTP billed at the rate the bake-off existed to escape. Credential
 * presence stopped selecting; only this variable does. On the box it lives in
 * `/opt/taxi/.env`, handed whole to the container by `env_file` in
 * `compose.prod.yml` — the switch procedure is `docs/runbooks/hetzner-deploy.md` §5.4.
 */
export function smsProviderFactory(env: Env): SmsProvider {
  // ONE `event` name for every branch, including the refusal's absence of
  // one: what an operator greps for after a switch is a line naming the kind
  // that actually bound. The kind, never a credential — no sender ID, no
  // token, no application id (`logging-standard.md`'s never-log list).
  //
  // THIS LINE IS EMITTED TWICE PER BOOT, and that is correct. `AuthModule`
  // and `NotificationsModule` each bind `SMS_PROVIDER` with this factory
  // (`notifications.module.ts:13-20` explains why the duplicate is deliberate
  // — exporting auth's binding would let any module inject SMS off auth's
  // back and give away the production refusal). Two identical lines are the
  // operator-visible evidence that BOTH SMS paths bound the same vendor; one
  // line means only one path switched, and §5.4 step 5 teaches that as the
  // signal to roll back.
  const bind = <P extends SmsProvider>(provider: P): P => {
    logger.log({
      event: 'auth.sms.provider_bound',
      provider: env.SMS_PROVIDER,
      at: new Date().toISOString(),
    });
    return provider;
  };

  // The non-null assertions below are load-bearing on the schema, not on
  // luck: `SMS_PROVIDER` can only hold a kind once the superRefine has
  // confirmed that kind's whole credential group
  // (`sms-env.schema.ts`'s `checkSmsCredentialGroups`). That is also why the
  // Twilio branch carries no credential-presence test — it would duplicate a
  // check that has already passed, and a test here is what made presence look
  // like a selector.
  if (env.SMS_PROVIDER === 'twilio') {
    return bind(
      new TwilioSmsProvider({
        accountSid: env.TWILIO_ACCOUNT_SID!,
        authToken: env.TWILIO_AUTH_TOKEN!,
        from: env.TWILIO_FROM_NUMBER!,
      }),
    );
  }
  if (env.SMS_PROVIDER === 'bulkgate') {
    return bind(
      new BulkGateSmsProvider({
        applicationId: env.BULKGATE_APPLICATION_ID!,
        applicationToken: env.BULKGATE_APPLICATION_TOKEN!,
        senderIdValue: env.BULKGATE_SENDER_ID_VALUE!,
      }),
    );
  }
  if (env.SMS_PROVIDER === 'budgetsms') {
    return bind(
      new BudgetSmsProvider({
        username: env.BUDGETSMS_USERNAME!,
        userid: env.BUDGETSMS_USERID!,
        handle: env.BUDGETSMS_HANDLE!,
        from: env.BUDGETSMS_FROM!,
        // No `baseUrl`: `/testsms/` is the bake-off script's business, never a
        // deploy's.
      }),
    );
  }
  if (env.NODE_ENV === 'production') {
    // The `TWILIO_*` trio is no longer an alternative to `SMS_PROVIDER` — it
    // is the credential group `SMS_PROVIDER=twilio` demands. A message
    // offering it as a second way out would send an operator to set three
    // variables that will not bind on their own.
    throw new Error(
      "No production SmsProvider is bound: SMS_PROVIDER is stub (or unset, which defaults to stub), and StubSmsProvider delivers nothing and logs OTP codes in full. Set SMS_PROVIDER to twilio, bulkgate or budgetsms together with that kind's whole credential group — TWILIO_* (#85), BULKGATE_* or BUDGETSMS_* (#137). A complete credential group does NOT bind on its own. Then run with NODE_ENV=production.",
    );
  }
  return bind(new StubSmsProvider());
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
