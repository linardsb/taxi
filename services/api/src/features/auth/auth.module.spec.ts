import type { Env } from '../../common/config/env.schema';
import { APP_ENV } from '../../common/config/env.schema';
import { AuthModule, smsProviderFactory } from './auth.module';
import { BudgetSmsProvider } from './sms/budgetsms.provider';
import { BulkGateSmsProvider } from './sms/bulkgate-sms.provider';
import { SMS_PROVIDER } from './sms/sms.tokens';
import { StubSmsProvider } from './sms/stub-sms.provider';
import { TwilioSmsProvider } from './sms/twilio-sms.provider';

// `SMS_PROVIDER: 'auto'` is the schema's default, so every case that does not
// name a kind describes a realistic `Env`. The cast is still needed — these
// literals are deliberately partial — but `satisfies Partial<Env>` runs FIRST
// and checks the keys against the schema, so a typo like `SMS_PROVDER` is a
// TS2561 rather than a green suite testing a field the factory never reads.
// It has to wrap the whole literal: `SMS_PROVIDER: 'auto' satisfies
// Env['SMS_PROVIDER']` checks the value and says nothing about the key.
const env = (NODE_ENV: Env['NODE_ENV'], over: Partial<Env> = {}) =>
  ({ NODE_ENV, SMS_PROVIDER: 'auto', ...over }) satisfies Partial<Env> as Env;

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

  it('names BOTH exits when a funded candidate group is present but unselected (failure)', () => {
    // The likeliest misconfiguration this PR introduces: an operator funds
    // BulkGate, sets all three BULKGATE_* vars and forgets the selector.
    // `SMS_PROVIDER` defaults to `'auto'`, the bulkgate branch is skipped,
    // the trio is absent — and before #137's selector existed a message
    // naming only Twilio was complete. It is not any more, so the refusal
    // must point at the vendor the operator actually funded too.
    const boot = () =>
      smsProviderFactory(env('production', { ...BULKGATE_GROUP }));

    expect(boot).toThrow(/No production SmsProvider is bound/);
    expect(boot).toThrow(/SMS_PROVIDER=bulkgate\|budgetsms/);
    // And the Twilio route stays named: `'auto'` + the trio is still the
    // path every pre-#137 deploy takes.
    expect(boot).toThrow(/TWILIO_ACCOUNT_SID/);
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
