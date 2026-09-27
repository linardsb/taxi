import { colors, fontSize, spacing } from '@taxi/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSession } from '@/features/auth';
import { useT } from '@/features/i18n';

/**
 * The `/book` row that opens `/name` (#269 D1): it reaches every signed-in
 * rider and adds no tap to a booking. One screen-reader stop that reads the
 * visible text and a hint (the switch-row rule, PR #277 M2); 44 px, with an
 * accent outline while focused (`Button`'s focus pattern, so no layout shift).
 */
export function NameRow() {
  const t = useT();
  const router = useRouter();
  const { state } = useSession();
  const [focused, setFocused] = useState(false);
  const name =
    state.status === 'signedIn' ? state.session.user.displayName : undefined;
  const label = name
    ? t('rider.book.name_row', { name })
    : t('rider.book.name_row_empty');

  return (
    <Pressable
      style={[styles.row, focused && styles.focused]}
      onPress={() => router.push('/name')}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('rider.book.name_row_hint')}
      testID="name-row"
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  focused: { outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 2 },
  label: { fontSize: fontSize.md, color: colors.fg },
});
