import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useSession } from '@/features/auth';
import { useT } from '@/features/i18n';
import {
  installNotificationHandling,
  registerPushToken,
} from './register-push-token';

/**
 * Renders nothing. Registers the token once per sign-in, forgets it
 * server-side before sign-out (a phone handed to another driver must not
 * carry the old driver's nudges), and routes a notification tap to the gate.
 */
export function PushRegistrar() {
  const { state, api, onBeforeSignOut } = useSession();
  const router = useRouter();
  const t = useT();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(
    () => installNotificationHandling(() => router.replace('/')),
    [router],
  );

  useEffect(() => {
    if (state.status !== 'signedIn') return;
    void registerPushToken(api, tRef.current);
  }, [state.status, api]);

  useEffect(
    () =>
      onBeforeSignOut(async () => {
        await api
          .request('DELETE', '/drivers/me/push-token')
          .catch(() => undefined);
      }),
    [api, onBeforeSignOut],
  );

  return null;
}
