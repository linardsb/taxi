import {
  BOOKABLE_PAYMENT_METHODS,
  colors,
  fontSize,
  radius,
  spacing,
  type BookablePaymentMethod,
} from '@taxi/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useT } from '@/features/i18n';

const LABEL_KEYS = {
  cash: 'rider.book.payment_cash',
  card: 'rider.book.payment_card',
} as const;

/**
 * How the rider pays — rendered from `BOOKABLE_PAYMENT_METHODS`, which is
 * NARROWER than `PAYMENT_METHOD_TYPES`. `balance` and `corporate` are refused
 * by the wire (#70), and offering one here would build a booking that
 * settlement cannot finish.
 *
 * `radio`, not `button`, with `checked` on `accessibilityState`: the selection
 * must be audible, and colour alone is not a state (accessibility property 3).
 * Changing it does NOT re-quote — cash and card are one identical price.
 */
export function PaymentChips({
  value,
  onChange,
}: {
  value: BookablePaymentMethod;
  onChange: (method: BookablePaymentMethod) => void;
}) {
  const t = useT();
  return (
    <View accessibilityRole="radiogroup" style={styles.row}>
      {BOOKABLE_PAYMENT_METHODS.map((method) => {
        const checked = method === value;
        return (
          <Pressable
            key={method}
            accessibilityRole="radio"
            accessibilityLabel={t(LABEL_KEYS[method])}
            accessibilityState={{ checked }}
            onPress={() => onChange(method)}
            style={[styles.chip, checked && styles.checked]}
          >
            <Text style={styles.label}>{t(LABEL_KEYS[method])}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    minHeight: 44,
    minWidth: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  checked: { borderWidth: 2, borderColor: colors.accent },
  label: { fontSize: fontSize.md, color: colors.fg },
});
