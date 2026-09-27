import { colors, fontSize, type DriverQueueEvent } from '@taxi/shared';
import { StyleSheet, Text } from 'react-native';
import { useAnnounceChange } from '@/components';
import { useT } from '@/features/i18n';
import { queueLabel } from './offer-card-props';

/**
 * «Rindā: 2. no 5 · rix» — the driver's live place in a geozone queue (S7-2,
 * ledger row "position always visible"). Rendered on home under the toggle
 * and beside the offer card; nothing until the first `driver:queue`, which
 * arrives when dispatch first ranks the driver (no zone-entry enrolment).
 * `position` is the store's 1-based rank — never add 1 here.
 *
 * A new rank is announced outright, not through a live region, which does
 * not reach TalkBack on this stack (#279). `announce={false}` while another
 * screen is on top: home stays mounted beneath `/offer`, `/active-ride` and
 * `/earnings`, and an on-ride driver stays queued (nothing in production
 * calls `DispatchQueueStore.leave()`), so every zone broadcast would
 * otherwise talk over the offer countdown or the arrival calls.
 */
export function QueuePosition({
  queue,
  announce = true,
}: {
  queue: DriverQueueEvent | null;
  announce?: boolean;
}) {
  const t = useT();
  const label = queueLabel(queue, t);
  useAnnounceChange(label, announce);
  if (!label) return null;
  return (
    <Text style={styles.text} testID="queue-position">
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: fontSize.md, fontWeight: '600', color: colors.fg },
});
