import {
  colors,
  fontSize,
  formatEur,
  radius,
  spacing,
  type FareQuote,
} from '@taxi/shared';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useT } from '@/features/i18n';
import type { QuoteState } from './booking-draft';

/**
 * The price, before anything is booked — and the confirmation surface itself.
 * There is no separate confirm sheet after `Book`, because this card is what
 * the rider is agreeing to (the friction audit rejected the extra tap).
 *
 * IT READS AS ONE UTTERANCE: total first, then the breakdown
 * («€8.40. Pamatlikme €2.00, attālums €5.40, laiks €1.00.»). `accessible` on
 * the container is what merges the four Texts into one; four separate stops for
 * one number is exactly the audio cost §1.2 measures.
 *
 * Money comes from integer cents through `formatEur` — never a float, never a
 * division that leaves one.
 */
export function QuoteCard({
  quote,
  state,
}: {
  quote: FareQuote | null;
  state: QuoteState;
}) {
  const t = useT();

  if (state === 'loading') {
    return (
      <View style={styles.card}>
        <ActivityIndicator
          color={colors.accent}
          accessibilityRole="progressbar"
          accessibilityLabel={t('rider.book.searching')}
        />
      </View>
    );
  }
  if (quote === null || state !== 'ready') return null;

  const total = formatEur(quote.totalCents);
  const breakdown = t('rider.book.quote_breakdown', {
    base: formatEur(quote.breakdown.baseCents),
    distance: formatEur(quote.breakdown.distanceCents),
    time: formatEur(quote.breakdown.timeCents),
  });

  return (
    <View
      testID="quote-card"
      accessible
      accessibilityLabel={`${t('rider.book.quote_total', { total })}. ${breakdown}.`}
      style={styles.card}
    >
      <Text style={styles.total}>{total}</Text>
      <Text style={styles.breakdown}>{breakdown}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
  },
  total: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
  breakdown: { fontSize: fontSize.sm, color: colors.fgMuted },
});
