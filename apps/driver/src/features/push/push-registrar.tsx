import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useSession } from '@/features/auth';
import { useT } from '@/features/i18n';
import { useOffers } from '@/features/offers';
import {
  installNotificationHandling,
  registerPushToken,
} from './register-push-token';

/**
 * Renders nothing. Registers the token once per sign-in, forgets it
 * server-side before sign-out (a phone handed to another driver must not
 * carry the old driver's nudges), and routes notifications (#14, #15):
 * an offer → the card (hydrated from the payload when it carried one), the
 * nudge → the gate. Mounted INSIDE `OffersProvider`, which is why it can
 * hand the offer over.
 */
export function PushRegistrar() {
  const { state, api, onBeforeSignOut } = useSession();
  const { receive } = useOffers();
  const router = useRouter();
  const t = useT();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(
    () =>
      installNotificationHandling({
        onTap: (route) => {
          if (route.kind === 'offer') {
            // `receive` dedupes by id and routes a fresh card itself;
            // `navigate` (not `push`) makes the second hop to `/offer` land on
            // the same screen instead of stacking a duplicate. Without a
            // payload the screen shows whatever is pending, or redirects home.
            if (route.offer) receive(route.offer, 'push');
            router.navigate('/offer');
            return;
          }
          router.replace('/');
        },
        onReceived: (route) => {
          // Foreground receipt while the socket is down (a reconnect in
          // progress): the push is the card's only way in.
          if (route.kind === 'offer' && route.offer)
            receive(route.offer, 'push');
        },
      }),
    [router, receive],
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
