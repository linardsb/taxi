import { colors, fontSize, radius, spacing } from '@taxi/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface AddressRowProps {
  primaryText: string;
  /** Disambiguator ("Rīga, Latvija"). Empty for a result with no context. */
  secondaryText?: string;
  onPress: () => void;
  testID?: string;
}

/**
 * One tappable address — a search suggestion or a saved place.
 *
 * IT READS AS ONE UTTERANCE, never two. The composed `accessibilityLabel` and
 * `accessible` on the Pressable are what stop the reader announcing the primary
 * and secondary lines as separate elements: blind riders consume audio at up to
 * 3× speed, and a twelve-row list that speaks twenty-four times is twice the
 * cost for no information (`docs/research/rider-ux-evidence.md` §1.2).
 *
 * No "button" suffix in the label — the role already says it.
 */
export function AddressRow({
  primaryText,
  secondaryText,
  onPress,
  testID,
}: AddressRowProps) {
  const label = secondaryText
    ? `${primaryText}, ${secondaryText}`
    : primaryText;
  return (
    <Pressable
      testID={testID}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View>
        <Text style={styles.primary}>{primaryText}</Text>
        {secondaryText ? (
          <Text style={styles.secondary}>{secondaryText}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.bgSurface,
  },
  pressed: { opacity: 0.85 },
  primary: { fontSize: fontSize.md, color: colors.fg },
  secondary: { fontSize: fontSize.sm, color: colors.fgMuted },
});
