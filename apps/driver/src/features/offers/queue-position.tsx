import { colors, fontSize, type DriverQueueEvent } from '@taxi/shared';
import { StyleSheet, Text } from 'react-native';
import { useT } from '@/features/i18n';
import { queueLabel } from './offer-card-props';

/**
 * «Rindā: 2. no 5 · rix» — the driver's live place in a geozone queue (S7-2,
 * ledger row "position always visible"). Rendered on home under the toggle
 * and beside the offer card; nothing until the first `driver:queue`, which
 * arrives when dispatch first ranks the driver (no zone-entry enrolment).
 * `position` is the store's 1-based rank — never add 1 here.
 */
export function QueuePosition({ queue }: { queue: DriverQueueEvent | null }) {
  const t = useT();
  const label = queueLabel(queue, t);
  if (!label) return null;
  return (
    <Text
      style={styles.text}
      accessibilityLiveRegion="polite"
      testID="queue-position"
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: fontSize.md, fontWeight: '600', color: colors.fg },
});
