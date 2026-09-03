import { colors } from '@taxi/shared';
import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Banner, Screen } from '@/components';
import { useT } from '@/features/i18n';
import { useSession } from './use-session';

/**
 * The router gate: session → login | booking.
 *
 * THE NON-RIDER BRANCH IS NOT DEFENSIVE. `SIGNUP_ROLES` is `['rider','driver']`
 * and the api's rule is "role is used ONLY when the phone has no user yet; an
 * existing user's stored role wins" — so a driver's phone signing in HERE gets a
 * driver session, and every rider route would 403. That is correct api
 * behaviour and this app must not fight it; what it must not do is drop them
 * into a booking screen that fails on every request.
 *
 * The copy is `rider.error.generic` rather than "this number is registered as a
 * driver". A specific message would be kinder and would also confirm, to anyone
 * who can type a phone number, that an account exists — the exact enumeration
 * oracle `otpRequestResponseSchema` is shaped to avoid.
 */
export function GateScreen() {
  const { state, signOut } = useSession();
  const t = useT();
  const wrongRole =
    state.status === 'signedIn' && state.session.user.role !== 'rider';

  useEffect(() => {
    if (wrongRole) void signOut();
  }, [wrongRole, signOut]);

  if (wrongRole) {
    // `Banner` announces on iOS and is a live region on Android, so the reason
    // is spoken before the sign-out redirects away from it.
    return (
      <Screen>
        <Banner tone="danger" text={t('rider.error.generic')} />
      </Screen>
    );
  }
  if (state.status === 'loading') return <Spinner label={t('rider.loading')} />;
  if (state.status === 'signedOut') return <Redirect href="/login" />;
  return <Redirect href="/book" />;
}

function Spinner({ label }: { label: string }) {
  return (
    <View style={styles.centre}>
      <ActivityIndicator
        color={colors.accent}
        accessibilityRole="progressbar"
        accessibilityLabel={label}
      />
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
