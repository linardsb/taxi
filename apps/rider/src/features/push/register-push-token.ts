import { PUSH_CHANNEL_ID } from '@taxi/shared';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import type { ApiClient } from '@/features/auth';
import type { T } from '@/features/i18n';

export type PushRegistration = 'registered' | 'no_project' | 'unavailable';

/**
 * The Android channel the arrival push lands on — `channelId` in the api's
 * Expo request (`expo-push.provider.ts`). The api sends one channel id for
 * every push it makes, so this name is a CONTRACT with it, not a local
 * choice: drift here and Android silently drops the notification into the
 * default channel with default importance. It therefore re-exports the seam's
 * `PUSH_CHANNEL_ID` rather than repeating the literal — which is what the api
 * and the driver app each used to do too.
 */
export const RIDE_CHANNEL = PUSH_CHANNEL_ID;

/**
 * Mints the phone's Expo push token and registers it (#17). Runs on every
 * signed-in app start, like the driver app's equivalent.
 *
 * This is the rider's ONLY arrival signal when the app is backgrounded:
 * #135 stopped their `driver_arrived` SMS, and `/book/status` is a foreground
 * screen. A rider who declines the permission gets neither — an accepted
 * cost, and the reason `unavailable` is returned rather than thrown.
 *
 * Never throws. A rider who cannot receive push must still be able to book.
 */
export async function registerPushToken(
  api: ApiClient,
  t: T,
): Promise<PushRegistration> {
  const projectId = (
    Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  )?.eas?.projectId;
  // No logging on any branch: this app's eslint bans `console` (the driver
  // app's does not, which is why its twin logs). The return value IS the
  // diagnostic — `no_project` and `unavailable` are distinct precisely so a
  // caller can tell a build-config problem from a rider's own choice.
  if (!projectId) return 'no_project';
  try {
    if (Platform.OS === 'android') {
      // Before the token on Android 13+, or the permission prompt never shows.
      await Notifications.setNotificationChannelAsync(RIDE_CHANNEL, {
        name: t('rider.push.channel_name'),
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    const permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') return 'unavailable';
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    await api.request('PUT', '/riders/me/push-token', { body: { token } });
    return 'registered';
  } catch {
    return 'unavailable';
  }
}

/**
 * `getLastNotificationResponseAsync` answers with the SAME response on every
 * call after a cold-start tap; without this a re-mount of the registrar would
 * route that tap again, on top of wherever the rider navigated since. Keyed by
 * the notification id, so each tap routes exactly once per process. Same
 * mechanism as the driver app's (#14).
 */
const routedColdStartTaps = new Set<string>();

/**
 * Foreground presentation, taps, and the cold-start tap (#17).
 *
 * An arrival push arriving while the app is ACTIVE is suppressed: the rider
 * is already looking at `/book/status`, which reads «Auto ir klāt» and has
 * already been announced by `Banner`. Showing a banner on top of the screen
 * that just said the same thing is the double-announcement the status screen
 * was explicitly fixed to avoid.
 */
export function installNotificationHandling(
  onTap: (rideId: string) => void,
): () => void {
  Notifications.setNotificationHandler({
    handleNotification: (notification) => {
      // Only OUR arrival push is suppressed, and only while the app is
      // active. An unrecognised payload still shows: suppressing by app
      // state alone would silence a future notification kind that has no
      // on-screen equivalent.
      const quiet =
        rideIdOf(notification.request.content.data) !== null &&
        AppState.currentState === 'active';
      return Promise.resolve({
        shouldShowBanner: !quiet,
        shouldShowList: !quiet,
        shouldPlaySound: !quiet,
        shouldSetBadge: false,
      });
    },
  });
  const tapped = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const rideId = rideIdOf(response.notification.request.content.data);
      if (rideId) onTap(rideId);
    },
  );
  // The tap that LAUNCHED the app does not reach the listener above — it is
  // waiting here instead, which is the only reason the driver app reads it
  // too. Backgrounded is the case #17 exists for, and a rider whose phone was
  // asleep in their pocket is on the killed-app side of that as often as not:
  // without this, tapping «Auto ir klāt» from a cold start opens the app on
  // `/book` and the rider has to find their own ride.
  //
  // This routes the response; it does not prove a device does. The whole path
  // is unverified on hardware — no Android phone (#4) — so the claim here is
  // "the response is read and handed to `onTap`", nothing further.
  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (!response) return;
      const rideId = rideIdOf(response.notification.request.content.data);
      if (!rideId) return;
      const id = response.notification.request.identifier;
      if (routedColdStartTaps.has(id)) return;
      routedColdStartTaps.add(id);
      onTap(rideId);
    })
    .catch(() => undefined);
  return () => tapped.remove();
}

/**
 * The api puts `{ kind: 'ride_arrived', rideId }` in `data` and Expo forwards
 * it verbatim — so this is REMOTE input, read defensively rather than cast.
 * An unknown `kind` routes nowhere instead of opening a wrong screen.
 */
export function rideIdOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const { kind, rideId } = data as { kind?: unknown; rideId?: unknown };
  if (kind !== 'ride_arrived') return null;
  return typeof rideId === 'string' && rideId.length > 0 ? rideId : null;
}
