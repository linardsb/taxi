import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useActiveRide } from '@/features/active-ride';
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
 * hand the offer over, and inside `ActiveRideProvider`, which is why it can
 * hand over an arrival-announce request (#259).
 */
export function PushRegistrar() {
  const { state, api, onBeforeSignOut } = useSession();
  const { receive, hasCard } = useOffers();
  const { announceRequested, state: rideState } = useActiveRide();
  // Read through a ref, as `t` is, so the handler effect below does not
  // reinstall on every ride-state change (PR #282 round 1 L1).
  const rideStateRef = useRef(rideState);
  useEffect(() => {
    rideStateRef.current = rideState;
  }, [rideState]);
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
          if (route.kind === 'announce') {
            // Dispatched first: it dedupes on `at`, and for another ride than
            // the one held the reducer ignores it (PR #282 round 2 H1).
            announceRequested(route.rideId, route.at);
            // A held ride → its screen, which redirects only when none is held.
            // NOT the gate on a warm tap: it redirects from the `me` cache,
            // which an offer accept never updates, so a ride accepted in this
            // session would land on `/home` with no way back. With nothing
            // held (a cold start) `/active-ride` would redirect home, so the
            // gate opens the ride and the re-read replays the request.
            if (rideStateRef.current.rideId) router.navigate('/active-ride');
            else router.replace('/');
            return;
          }
          if (route.kind === 'offer') {
            // `receive` dedupes by id and routes a fresh card itself
            // (`route_offer`); this hop is for the ids-only push, whose card
            // the socket already delivered. `navigate` (not `push`) makes the
            // two hops land on one screen instead of stacking a duplicate.
            //
            // Gated on there BEING a card, not on the payload carrying one: a
            // tray entry for an offer already answered in-app is never
            // dismissed, and tapping it mid-ride used to pull the driver onto
            // `/offer`, which redirects to `/home` — a screen with no
            // active-ride affordance and nothing routing back short of a
            // relaunch. `hasCard()` reads the ref `receive` just wrote.
            if (route.offer) receive(route.offer, 'push');
            if (hasCard()) router.navigate('/offer');
            return;
          }
          router.replace('/');
        },
        onReceived: (route) => {
          // Foreground receipt while the socket is down (a reconnect in
          // progress): the push is the card's only way in.
          if (route.kind === 'offer' && route.offer)
            receive(route.offer, 'push');
          if (route.kind === 'announce')
            announceRequested(route.rideId, route.at);
        },
      }),
    [router, receive, hasCard, announceRequested],
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
