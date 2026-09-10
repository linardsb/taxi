import { colors, fontSize, radius, spacing } from '@taxi/shared';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

/**
 * The one number on the home screen: today's net, integer cents, catalog copy.
 * Loading is a spinner, an error with nothing cached is a dash — the toggle
 * beside it is unaffected either way.
 *
 * Presentational on purpose. `body` is computed by the caller (`earningsBody`)
 * because the link wrapping this card needs the identical string for its
 * accessible name — see the note on that helper.
 */
export function EarningsCard({ body }: { body: string | null }) {
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
