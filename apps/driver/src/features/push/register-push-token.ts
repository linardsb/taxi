import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import type { ApiClient } from '@/features/auth';
import type { T } from '@/features/i18n';
import {
  routeNotification,
  type NotificationRoute,
} from './route-notification';

export type PushRegistration = 'registered' | 'no_project' | 'unavailable';

/** The Android channel the nudge AND the offer push land on — `channelId` in the api's Expo request. */
export const PRESENCE_CHANNEL = 'presence';

/**
 * Mints the phone's Expo push token and registers it (#14). Runs on every
 * signed-in app start. Without an EAS `projectId` (prerequisite A2) or FCM
 * credentials (A1) there is no token — the app runs, the nudge is skipped
 * server-side with `no_token`, and this says so once on the console.
 */
export async function registerPushToken(
  api: ApiClient,
  t: T,
): Promise<PushRegistration> {
  const projectId = (
    Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  )?.eas?.projectId;
  if (!projectId) {
    console.warn('push: no EAS projectId in app.json (A2) — no push token');
    return 'no_project';
  }
  try {
    if (Platform.OS === 'android') {
      // Before the token on Android 13+, or the permission prompt never shows.
      await Notifications.setNotificationChannelAsync(PRESENCE_CHANNEL, {
        name: t('driver.foreground_service.title'),
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    const permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') return 'unavailable';
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    await api.request('PUT', '/drivers/me/push-token', { body: { token } });
    return 'registered';
  } catch (error) {
    console.warn(
      'push: registration failed',
      error instanceof Error ? error.message : 'unknown',
    );
    return 'unavailable';
  }
}

export interface NotificationHandlers {
  /** A tap on a notification — background, or the cold-start response. */
  onTap(route: NotificationRoute): void;
  /** A notification delivered while the app is in the foreground. */
  onReceived?(route: NotificationRoute): void;
}

/**
 * `getLastNotificationResponseAsync` answers with the SAME response on every
 * call after a cold-start tap; without this a re-mount of the registrar would
 * route that tap again, on top of whatever the driver navigated to since.
 * Keyed by the notification id, so each tap routes exactly once per process.
 */
const routedColdStartTaps = new Set<string>();

/**
 * Foreground presentation, taps, and the cold-start tap (#14, #15).
 *
 * An OFFER arriving while the app is active is suppressed: the socket path
 * already showed the card, played the tone and buzzed, and a second banner
 * plus sound for the same card is noise. Everything else — the offline
 * nudge included — still shows in the foreground, as before.
 */
export function installNotificationHandling(
  handlers: NotificationHandlers,
): () => void {
  Notifications.setNotificationHandler({
    handleNotification: (notification) => {
      const route = routeNotification(notification.request.content.data);
      const quiet =
        route.kind === 'offer' && AppState.currentState === 'active';
      return Promise.resolve({
        shouldShowBanner: !quiet,
        shouldShowList: !quiet,
        shouldPlaySound: !quiet,
        shouldSetBadge: false,
      });
    },
  });
  const tapped = Notifications.addNotificationResponseReceivedListener(
    (response) =>
      handlers.onTap(
        routeNotification(response.notification.request.content.data),
      ),
  );
  const received = Notifications.addNotificationReceivedListener(
    (notification) =>
      handlers.onReceived?.(
        routeNotification(notification.request.content.data),
      ),
  );
  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (routedColdStartTaps.has(id)) return;
      routedColdStartTaps.add(id);
      handlers.onTap(
        routeNotification(response.notification.request.content.data),
      );
    })
    .catch(() => undefined);
  return () => {
    tapped.remove();
    received.remove();
  };
}
