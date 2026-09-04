import { colors } from '@taxi/shared';
import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Banner, Screen } from '@/components';
import { useActiveRide } from '@/features/active-ride';
import { useSession } from '@/features/auth';
import { useT } from '@/features/i18n';
import { nextRoute } from './onboarding-state';
import { useMe } from './use-me';

/**
 * The router gate: session → me → login | onboarding | active ride | home.
 * A cold start mid-ride (#15) opens the ride in the provider BEFORE the
 * redirect, so `/active-ride` mounts with a fetch already in flight.
 */
export function GateScreen() {
  const { state } = useSession();
  const { me, status, refetch } = useMe();
  const { open } = useActiveRide();
  const t = useT();
  const activeRideId =
    state.status === 'signedIn' ? (me?.activeRideId ?? null) : null;

  useEffect(() => {
    if (activeRideId) open(activeRideId);
  }, [activeRideId, open]);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'signedOut') return <Redirect href="/login" />;
  if (status === 'error') {
    return (
      <Screen>
        <Banner
          tone="danger"
          text={t('driver.error.offline')}
          action={{
            label: t('driver.action.retry'),
            onPress: () => void refetch(),
          }}
        />
      </Screen>
    );
  }
  if (!me) return <Spinner />;
  return (
    <Redirect
      href={nextRoute({
        signedIn: true,
        vehicles: me.vehicles.length,
        activeRideId: me.activeRideId,
      })}
    />
  );
}

function Spinner() {
  return (
    <View style={styles.centre}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
