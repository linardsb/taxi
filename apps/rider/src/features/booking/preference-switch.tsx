import { colors, fontSize } from '@taxi/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text } from 'react-native';

export interface PreferenceSwitchProps {
  label: string;
  hint: string;
  value: boolean;
  enabled: boolean;
  onChange(value: boolean): void;
  testID?: string;
}

/**
 * A booking option as one switch row (#258, extracted for #259's second one).
 *
 * The whole row is the switch (PR #277 M2): one 44 px touch target with the
 * label, and one screen-reader stop that says label, state and hint once. The
 * native `Switch` and the visible hint are hidden from that tree so neither is
 * read a second time. An accent outline while focused, as `NameRow` (PR #293
 * F3): an outline, so nothing reflows.
 *
 * A flip does NOT rotate the booking's idempotency key, like payment
 * (`booking-draft.ts` rule 2): a lost response, a flip, then a retry replays
 * the ride as first booked. Callers pass `enabled={loaded && !busy}`, which
 * narrows that to a lost response.
 */
export function PreferenceSwitch({
  label,
  hint,
  value,
  enabled,
  onChange,
  testID,
}: PreferenceSwitchProps) {
  const [focused, setFocused] = useState(false);
  return (
    <>
      <Pressable
        style={[styles.row, focused && styles.focused]}
        onPress={() => onChange(!value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={!enabled}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ checked: value, disabled: !enabled }}
        testID={testID}
      >
        <Text style={styles.label}>{label}</Text>
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={!enabled}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          trackColor={{ true: colors.accent, false: colors.border }}
        />
      </Pressable>
      <Text
        style={styles.hint}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {hint}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  focused: { outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 2 },
  label: { flex: 1, fontSize: fontSize.md, color: colors.fg },
  hint: { fontSize: fontSize.sm, color: colors.fgMuted },
});
