import { colors } from '@taxi/shared';
import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Banner, Screen } from '@/components';
import { useSession } from '@/features/auth';
import { useT } from '@/features/i18n';
import { nextRoute, useMe } from '@/features/onboarding';

/** The router gate: session → me → login | onboarding | home. */
export default function Index() {
  const { state } = useSession();
  const { me, status, refetch } = useMe();
  const t = useT();

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
      href={nextRoute({ signedIn: true, vehicles: me.vehicles.length })}
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
