import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ApiClient } from '@/features/auth';
import type { T } from '@/features/i18n';

export type PushRegistration = 'registered' | 'no_project' | 'unavailable';

/** The Android channel the nudge lands on — `channelId` in the api's Expo request. */
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

/**
 * A nudge arriving while the app is foregrounded still shows; a tap on one
 * lands on the router gate, which decides between the banner and home.
 */
export function installNotificationHandling(onTap: () => void): () => void {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
  });
  const sub = Notifications.addNotificationResponseReceivedListener(() =>
    onTap(),
  );
  return () => sub.remove();
}
