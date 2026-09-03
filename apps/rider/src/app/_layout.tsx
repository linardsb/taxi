import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '@/features/auth';
import { SavedPlacesProvider } from '@/features/places';

/**
 * No side-effect import at the top, unlike the driver app's: `defineTask` has
 * no counterpart here because this app has no headless task and no background
 * location. That absence is the architecture's reason for two apps.
 */
export default function RootLayout() {
  return (
    <SessionProvider>
      <SavedPlacesProvider>
        <Stack screenOptions={{ headerShown: false }} />
        <StatusBar style="dark" />
      </SavedPlacesProvider>
    </SessionProvider>
  );
}
