import type { Env } from '../../common/config/env.schema';
import { APP_ENV } from '../../common/config/env.schema';
import { ExpoPushProvider } from './expo-push.provider';
import { PushModule, pushProviderFactory } from './push.module';
import { PUSH_PROVIDER } from './push.tokens';
import { StubPushProvider } from './stub-push.provider';

const env = (NODE_ENV: Env['NODE_ENV'], over: Partial<Env> = {}) =>
  ({ NODE_ENV, PUSH_PROVIDER: 'stub', ...over }) as Env;

describe('pushProviderFactory (#14)', () => {
  it('provides the stub outside production (expected)', () => {
    expect(pushProviderFactory(env('development'))).toBeInstanceOf(
      StubPushProvider,
    );
    expect(pushProviderFactory(env('test'))).toBeInstanceOf(StubPushProvider);
  });

  it('binds the Expo provider whenever PUSH_PROVIDER=expo, in every environment (expected)', () => {
    for (const NODE_ENV of ['development', 'test', 'production'] as const) {
      expect(
        pushProviderFactory(env(NODE_ENV, { PUSH_PROVIDER: 'expo' })),
      ).toBeInstanceOf(ExpoPushProvider);
    }
  });

  it('refuses to boot in production on the stub (failure)', () => {
    // The stub delivers nothing, and the nudge is a force-quit driver's only
    // recovery path — a silent stub is worse than no boot.
    expect(() => pushProviderFactory(env('production'))).toThrow(
      /No production PushProvider is bound/,
    );
  });

  it('is what the module actually binds PUSH_PROVIDER to (edge)', () => {
    const providers = Reflect.getMetadata('providers', PushModule) as {
      provide?: unknown;
      useClass?: unknown;
      useFactory?: unknown;
      inject?: unknown[];
    }[];
    const push = providers.find((p) => p.provide === PUSH_PROVIDER);

    expect(push?.useFactory).toBe(pushProviderFactory);
    expect(push?.inject).toEqual([APP_ENV]);
    expect(push?.useClass).toBeUndefined();
  });
});
