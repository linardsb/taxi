import { Module } from '@nestjs/common';
import type { PushProvider } from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { ExpoPushProvider } from './expo-push.provider';
import { PUSH_PROVIDER } from './push.tokens';
import { StubPushProvider } from './stub-push.provider';

/**
 * `PUSH_PROVIDER=expo` binds `ExpoPushProvider` (#14). Until it is set,
 * production refuses to boot: `StubPushProvider` delivers nothing, and a
 * driver whose phone died would never get the "you've gone offline" nudge
 * that is their only recovery path after a force-quit — the `smsProviderFactory`
 * arrangement, minus the credential trio (Expo's API needs none, so the
 * switch is the intent).
 */
export function pushProviderFactory(env: Env): PushProvider {
  if (env.PUSH_PROVIDER === 'expo') {
    return new ExpoPushProvider({ accessToken: env.EXPO_PUSH_ACCESS_TOKEN });
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'No production PushProvider is bound: StubPushProvider delivers nothing. Set PUSH_PROVIDER=expo (#14) before running with NODE_ENV=production.',
    );
  }
  return new StubPushProvider();
}

@Module({
  providers: [
    {
      provide: PUSH_PROVIDER,
      inject: [APP_ENV],
      useFactory: pushProviderFactory,
    },
  ],
  exports: [PUSH_PROVIDER],
})
export class PushModule {}
