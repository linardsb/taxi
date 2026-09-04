// FIRST, for its side effect: `defineTask` must run in the global scope of
// the bundle (expo-task-manager), before any screen mounts.
import '@/features/location/location-task';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActiveRideProvider } from '@/features/active-ride';
import { SessionProvider } from '@/features/auth';
import { PresenceProvider } from '@/features/availability';
import { OffersProvider } from '@/features/offers';
import { MeProvider } from '@/features/onboarding';
import { PushRegistrar } from '@/features/push';

/**
 * `OffersProvider` sits inside `ActiveRideProvider` because an accepted
 * offer opens the ride; `PushRegistrar` sits inside both because a tapped
 * offer push hands the card to the offers provider (#15). Both providers
 * outlive every screen, so a card or a ride survives navigation.
 */
export default function RootLayout() {
  return (
    <SessionProvider>
      <MeProvider>
        <PresenceProvider>
          <ActiveRideProvider>
            <OffersProvider>
              <PushRegistrar />
              <Stack screenOptions={{ headerShown: false }} />
              <StatusBar style="dark" />
            </OffersProvider>
          </ActiveRideProvider>
        </PresenceProvider>
      </MeProvider>
    </SessionProvider>
  );
}
