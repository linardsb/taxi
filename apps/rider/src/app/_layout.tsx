import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionGuard, SessionProvider } from '@/features/auth';
import { SavedPlacesProvider } from '@/features/places';
import { PushRegistrar } from '@/features/push';

/**
 * No side-effect import at the top, unlike the driver app's: `defineTask` has
 * no counterpart here because this app has no headless task and no background
 * location. That absence is the architecture's reason for two apps — and
 * `expo-notifications` does not change it: remote push needs no task, no
 * foreground service and no boot receiver (the last is blocked in app.json).
 */
export default function RootLayout() {
  return (
    <SessionProvider>
      <SavedPlacesProvider>
        {/* INSIDE the provider — it reads the session — and beside the Stack,
            because a signed-out rider on `/book/status` has to be moved, not
            re-rendered. */}
        <SessionGuard />
        {/* Same reason, and it must outlive any one screen: the arrival push
            can be tapped from a cold start, with no screen mounted yet — that
            response is read here, via `getLastNotificationResponseAsync`, and
            not by the listener, which never sees it. */}
        <PushRegistrar />
        <Stack screenOptions={{ headerShown: false }} />
        <StatusBar style="dark" />
      </SavedPlacesProvider>
    </SessionProvider>
  );
}
