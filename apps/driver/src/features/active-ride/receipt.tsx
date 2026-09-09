import {
  colors,
  fontSize,
  formatEur,
  radius,
  spacing,
  type FareSplit,
  type PaymentMethodType,
} from '@taxi/shared';
import { StyleSheet, Text, View } from 'react-native';
import { useT } from '@/features/i18n';

/** `15` → «15», `12.5` → «12.5»: the split's double, never a literal. */
export function pctLabel(pct: number): string {
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

/** `cash` is the one method the driver handles; every other member settles without them. */
export function paymentMethodLabel(
  method: PaymentMethodType,
  t: ReturnType<typeof useT>,
): string {
  return t(
    method === 'cash'
      ? 'driver.offer.payment_cash'
      : 'driver.offer.payment_card',
  );
}

/**
 * The per-ride receipt (S2-5, ledger row "constant arithmetic"): three lines
 * in this fixed order and no other — rider paid → Sakta (pct) → you — every
 * figure rendered from the persisted `split`, never recomputed. Lives in the
 * active-ride slice because the completed screen shows it first; the
 * earnings screen imports it from here (`earnings → active-ride`, never back).
 */
export function Receipt({
  split,
  paymentMethod,
}: {
  split: FareSplit;
  paymentMethod: PaymentMethodType;
}) {
  const t = useT();
  return (
    <View style={styles.card} accessibilityRole="summary" testID="receipt">
      <Text style={styles.line} testID="receipt-paid">
        {t('driver.earnings.receipt_paid', {
          amount: formatEur(split.totalCents),
        })}
      </Text>
      <Text style={styles.line} testID="receipt-commission">
        {t('driver.earnings.receipt_commission', {
          amount: formatEur(split.commissionCents),
          pct: pctLabel(split.commissionPct),
        })}
      </Text>
      <Text style={[styles.line, styles.net]} testID="receipt-net">
        {t('driver.earnings.receipt_net', {
          amount: formatEur(split.driverNetCents),
        })}
      </Text>
      <Text style={styles.method} testID="receipt-method">
        {t('driver.ride.payment', {
          method: paymentMethodLabel(paymentMethod, t),
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSurface,
  },
  line: { fontSize: fontSize.md, color: colors.fg },
  net: { fontSize: fontSize.lg, fontWeight: '700' },
  method: { fontSize: fontSize.sm, color: colors.fgMuted },
});
