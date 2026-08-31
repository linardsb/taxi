import { colors, fontSize, radius, spacing } from '@taxi/shared';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useT } from '@/features/i18n';
import { formatEur } from './format-eur';
import { useEarnings } from './use-earnings';

/** Punctuation, not copy: the card's "no number" state. */
const NO_VALUE = '—';

/**
 * The one number on the home screen: today's net, integer cents, catalog
 * copy. Loading is a spinner, an error with nothing cached is a dash — the
 * toggle beside it is unaffected either way.
 */
export function EarningsCard({ online }: { online: boolean }) {
  const t = useT();
  const { earnings, status } = useEarnings(online);
  let body: string | null = null;
  if (earnings) {
    body = t('driver.home.today', {
      amount: formatEur(earnings.earnedCents),
      rides: earnings.rideCount,
    });
  } else if (status === 'error') {
    body = NO_VALUE;
  }
  return (
    <View
      style={styles.card}
      accessibilityLiveRegion="polite"
      testID="earnings"
    >
      {body === null ? (
        <ActivityIndicator color={colors.fgMuted} />
      ) : (
        <Text style={styles.text}>{body}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 44,
    justifyContent: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSurface,
  },
  text: { fontSize: fontSize.lg, fontWeight: '600', color: colors.fg },
});
