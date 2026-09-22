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
 * server-side before sign-out, and routes a tapped arrival push to that
 * ride's status screen (#17).
 *
 * **Clearing on sign-out is not housekeeping.** A phone handed on, or a rider
 * signing out of a shared device, would otherwise keep receiving a stranger's
 * arrival pushes — with their plate in the body.
 *
 * `navigate`, not `push`: the rider is usually already on `/book/status` for
 * this ride when the push arrives, and `push` would stack a second copy of
 * the same screen behind the first.
 */
export function PushRegistrar() {
  const { state, api, onBeforeSignOut } = useSession();
  const router = useRouter();
  const t = useT();
  // The channel name is read once, inside an async call that outlives the
  // render that started it — a ref keeps it current without re-running
  // registration every time the language changes.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(
    () =>
      installNotificationHandling((rideId) =>
        router.navigate({
          pathname: '/book/status',
          params: { rideId },
        }),
      ),
    [router],
  );

  useEffect(() => {
    if (state.status !== 'signedIn') return;
    void registerPushToken(api, tRef.current);
  }, [state.status, api]);

  useEffect(
    () =>
      onBeforeSignOut(async () => {
        // Best-effort: a failed clear must never block a sign-out, and the
        // api NULLs a dead token on its own when Expo reports one.
        await api
          .request('DELETE', '/riders/me/push-token')
          .catch(() => undefined);
      }),
    [api, onBeforeSignOut],
  );

  return null;
}
