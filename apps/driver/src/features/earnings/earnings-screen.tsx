import { colors, fontSize, radius, spacing } from '@taxi/shared';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button, Screen } from '@/components';
import { Receipt, useActiveRide } from '@/features/active-ride';
import { earningsBody, useEarnings } from '@/features/availability';
import { useT } from '@/features/i18n';

/**
 * Today's total (`GET /drivers/me/earnings/today`, NET of commission — never
 * present it as gross) and the receipt of the ride just completed, held by
 * the active-ride provider until the driver dismisses it. No per-ride history
 * (Q1 = Option B): the receipt covers the ride just completed.
 */
export function EarningsScreen() {
  const t = useT();
  const router = useRouter();
  // `true`: refresh every minute while this screen is up, online or not —
  // one indexed aggregate, and the driver came here to watch the number.
  const { earnings, status } = useEarnings(true);
  const { state } = useActiveRide();
  const last = state.ended?.kind === 'completed' ? state.ended.ride : null;
  // The same three states, and the same catalog string, as the home card —
  // `driver.earnings.today` was a byte-identical second copy of it (F14).
  const today = earningsBody(earnings, status, t);

  return (
    <Screen>
      <Text style={styles.title} accessibilityRole="header">
        {t('driver.earnings.title')}
      </Text>
      <View
        style={styles.card}
        accessibilityLiveRegion="polite"
        testID="earnings-today"
      >
        {today === null ? (
          <ActivityIndicator color={colors.fgMuted} testID="earnings-loading" />
        ) : (
          <Text style={styles.today}>{today}</Text>
        )}
      </View>
      {last?.split ? (
        <Receipt split={last.split} paymentMethod={last.paymentMethod} />
      ) : (
        <Text style={styles.empty} testID="earnings-empty">
          {t('driver.earnings.none_yet')}
        </Text>
      )}
      <View style={styles.footer}>
        <Button
          variant="secondary"
          label={t('driver.action.done')}
          onPress={() => router.back()}
          testID="earnings-back"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
  card: {
    minHeight: 44,
    justifyContent: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSurface,
  },
  today: { fontSize: fontSize.lg, fontWeight: '600', color: colors.fg },
  empty: { fontSize: fontSize.md, color: colors.fgMuted },
  footer: { marginTop: 'auto' },
});
