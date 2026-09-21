import type { Env } from '../../common/config/env.schema';
import { APP_ENV } from '../../common/config/env.schema';
import { AuthModule, smsProviderFactory } from './auth.module';
import { BudgetSmsProvider } from './sms/budgetsms.provider';
import { BulkGateSmsProvider } from './sms/bulkgate-sms.provider';
import { SMS_PROVIDER } from './sms/sms.tokens';
import { StubSmsProvider } from './sms/stub-sms.provider';
import { TwilioSmsProvider } from './sms/twilio-sms.provider';

// `SMS_PROVIDER: 'auto'` is the schema's default, so every case that does not
// name a kind describes a realistic `Env`. The helper casts, so this field is
// NOT typechecked against the schema — it is spelled to match the schema key
// exactly, and a typo here would leave the cases below green against a field
// the factory never reads.
const env = (NODE_ENV: Env['NODE_ENV'], over: Partial<Env> = {}) =>
  ({ NODE_ENV, SMS_PROVIDER: 'auto', ...over }) as Env;

const TRIO: Partial<Env> = {
  TWILIO_ACCOUNT_SID: 'AC' + 'f'.repeat(32),
  TWILIO_AUTH_TOKEN: 'auth-token-secret',
  TWILIO_FROM_NUMBER: '+37167000000',
};

const BULKGATE_GROUP: Partial<Env> = {
  BULKGATE_APPLICATION_ID: '12345',
  BULKGATE_APPLICATION_TOKEN: 'application-token-secret',
  BULKGATE_SENDER_ID_VALUE: 'SaktaCab',
};

const BUDGETSMS_GROUP: Partial<Env> = {
  BUDGETSMS_USERNAME: 'saktacab',
  BUDGETSMS_USERID: '123456',
  BUDGETSMS_HANDLE: 'handle-secret',
  BUDGETSMS_FROM: 'SaktaCab',
};

describe('smsProviderFactory', () => {
  it('provides the stub outside production (expected)', () => {
    expect(smsProviderFactory(env('development'))).toBeInstanceOf(
      StubSmsProvider,
    );
    expect(smsProviderFactory(env('test'))).toBeInstanceOf(StubSmsProvider);
  });

  it('binds the Twilio provider whenever the trio is present (expected)', () => {
    // The values are only present when they passed the schema's refines, so
    // "the trio exists" already means "vetted" — the same reasoning as the
    // payments factory's "a client exists already means test mode".
    for (const NODE_ENV of ['development', 'test', 'production'] as const) {
      expect(smsProviderFactory(env(NODE_ENV, TRIO))).toBeInstanceOf(
        TwilioSmsProvider,
      );
    }
  });

  it('binds BulkGate when SMS_PROVIDER names it (expected)', () => {
    // Reachable only once the superRefine has confirmed the whole group, which
    // is what the factory's non-null assertions rest on.
    expect(
      smsProviderFactory(
        env('development', { ...BULKGATE_GROUP, SMS_PROVIDER: 'bulkgate' }),
      ),
    ).toBeInstanceOf(BulkGateSmsProvider);
  });

  it('binds BudgetSMS when SMS_PROVIDER names it (expected)', () => {
    expect(
      smsProviderFactory(
        env('development', { ...BUDGETSMS_GROUP, SMS_PROVIDER: 'budgetsms' }),
      ),
    ).toBeInstanceOf(BudgetSmsProvider);
  });

  it('lets an explicitly named kind beat a present TWILIO_* trio (edge)', () => {
    // The bake-off's whole point: two or three accounts are funded at once, so
    // presence cannot disambiguate them and the selector must win. Before
    // #137 this same Env bound Twilio.
    for (const NODE_ENV of ['development', 'test', 'production'] as const) {
      expect(
        smsProviderFactory(
          env(NODE_ENV, {
            ...TRIO,
            ...BULKGATE_GROUP,
            SMS_PROVIDER: 'bulkgate',
          }),
        ),
      ).toBeInstanceOf(BulkGateSmsProvider);
    }
  });

  it('refuses to boot in production (failure)', () => {
    // The stub delivers no SMS and logs the code in full, so an internet-facing
    // deploy without the TWILIO_* trio hands sign-in to anyone with log read
    // access. Failing at boot is the point: a silent stub is worse than no boot.
    expect(() => smsProviderFactory(env('production'))).toThrow(
      /No production SmsProvider is bound/,
    );

    // #137 added a selector above this branch; `'auto'` — the default, and
    // what every existing `.env` means — must still reach the same refusal.
    expect(() =>
      smsProviderFactory(env('production', { SMS_PROVIDER: 'auto' })),
    ).toThrow(/No production SmsProvider is bound/);
  });

  it('is what the module actually binds SMS_PROVIDER to (edge)', () => {
    // Without this, the two cases above pass just as happily against the
    // `useClass: StubSmsProvider` registration they exist to replace — the
    // factory would be dead code and production would still boot the stub.
    const providers = Reflect.getMetadata('providers', AuthModule) as {
      provide?: unknown;
      useClass?: unknown;
      useFactory?: unknown;
      inject?: unknown[];
    }[];
    const sms = providers.find((p) => p.provide === SMS_PROVIDER);

    expect(sms?.useFactory).toBe(smsProviderFactory);
    expect(sms?.inject).toEqual([APP_ENV]);
    expect(sms?.useClass).toBeUndefined();
  });
});
