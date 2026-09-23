import { colors, fontSize, radius, spacing } from '@taxi/shared';
import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NO_EARNINGS } from './earnings-body';

/**
 * The one number on the home screen: today's net, integer cents, catalog copy.
 * Loading is a spinner, an error with nothing cached is a dash — the toggle
 * beside it is unaffected either way.
 *
 * Presentational on purpose. `body` is computed by the caller (`earningsBody`)
 * because the link wrapping this card needs the identical string for its
 * accessible name — see the note on that helper.
 *
 * Not a live region (#262): this card sits inside home's grouping `Pressable`,
 * which collapses it into one node, so `accessibilityLiveRegion` never reached
 * the accessibility tree — TalkBack reported `nodeLiveRegion=0` and spoke the
 * update zero times. The card announces a new number itself instead.
 */
export function EarningsCard({ body }: { body: string | null }) {
  useAnnounceChange(body);
  return (
    <View style={styles.card} testID="earnings">
      {body === null ? (
        <ActivityIndicator color={colors.fgMuted} />
      ) : (
        <Text style={styles.text}>{body}</Text>
      )}
    </View>
  );
}

/**
 * Speaks `body` when it changes to a number — the spinner → value transition
 * and any later refresh that moves it. Not on mount (a live region would not
 * speak its initial content either) and not for «—», which is no news.
 */
function useAnnounceChange(body: string | null) {
  const last = useRef(body);
  useEffect(() => {
    if (body === last.current) return;
    last.current = body;
    if (body === null || body === NO_EARNINGS) return;
    AccessibilityInfo.announceForAccessibility(body);
  }, [body]);
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
