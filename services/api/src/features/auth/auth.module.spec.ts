import type { Env } from '../../common/config/env.schema';
import { APP_ENV } from '../../common/config/env.schema';
import { AuthModule, smsProviderFactory } from './auth.module';
import { SMS_PROVIDER } from './sms/sms.tokens';
import { StubSmsProvider } from './sms/stub-sms.provider';

const env = (NODE_ENV: Env['NODE_ENV']) => ({ NODE_ENV }) as Env;

describe('smsProviderFactory', () => {
  it('provides the stub outside production (expected)', () => {
    expect(smsProviderFactory(env('development'))).toBeInstanceOf(
      StubSmsProvider,
    );
    expect(smsProviderFactory(env('test'))).toBeInstanceOf(StubSmsProvider);
  });

  it('refuses to boot in production (failure)', () => {
    // The stub delivers no SMS and logs the code in full, so an internet-facing
    // deploy before #13 hands sign-in to anyone with log read access. Failing
    // at boot is the point: a silent stub is worse than no boot.
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
