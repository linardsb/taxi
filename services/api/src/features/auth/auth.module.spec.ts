import type { Env } from '../../common/config/env.schema';
import { APP_ENV } from '../../common/config/env.schema';
import { AuthModule, smsProviderFactory } from './auth.module';
import { SMS_PROVIDER } from './sms/sms.tokens';
import { StubSmsProvider } from './sms/stub-sms.provider';
import { TwilioSmsProvider } from './sms/twilio-sms.provider';

const env = (NODE_ENV: Env['NODE_ENV'], over: Partial<Env> = {}) =>
  ({ NODE_ENV, ...over }) as Env;

const TRIO: Partial<Env> = {
  TWILIO_ACCOUNT_SID: 'AC' + 'f'.repeat(32),
  TWILIO_AUTH_TOKEN: 'auth-token-secret',
  TWILIO_FROM_NUMBER: '+37167000000',
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

  it('refuses to boot in production (failure)', () => {
    // The stub delivers no SMS and logs the code in full, so an internet-facing
    // deploy without the TWILIO_* trio hands sign-in to anyone with log read
    // access. Failing at boot is the point: a silent stub is worse than no boot.
    expect(() => smsProviderFactory(env('production'))).toThrow(
      /No production SmsProvider is bound/,
    );
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
