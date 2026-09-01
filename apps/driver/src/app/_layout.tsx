// FIRST, for its side effect: `defineTask` must run in the global scope of
// the bundle (expo-task-manager), before any screen mounts.
import '@/features/location/location-task';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '@/features/auth';
import { PresenceProvider } from '@/features/availability';
import { MeProvider } from '@/features/onboarding';
import { PushRegistrar } from '@/features/push';

export default function RootLayout() {
  return (
    <SessionProvider>
      <MeProvider>
        <PresenceProvider>
          <PushRegistrar />
          <Stack screenOptions={{ headerShown: false }} />
          <StatusBar style="dark" />
        </PresenceProvider>
      </MeProvider>
    </SessionProvider>
  );
}
