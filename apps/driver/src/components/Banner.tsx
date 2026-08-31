import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '@taxi/shared';
import { Button } from './Button';

export type BannerTone = 'info' | 'warning' | 'danger';

export interface BannerAction {
  label: string;
  onPress: () => void;
  loading?: boolean;
}

export interface BannerProps {
  tone: BannerTone;
  text: string;
  action?: BannerAction;
  /** A quieter second choice — the battery explainer's «Izlaist». */
  secondary?: BannerAction;
  testID?: string;
}

/**
 * A state change the driver should hear, with at most one thing to do about
 * it. `accessibilityLiveRegion` is Android-only, so the text is also
 * announced outright — that is what VoiceOver hears.
 */
export function Banner({ tone, text, action, secondary, testID }: BannerProps) {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[styles.base, tones[tone]]}
    >
      <Text style={styles.text}>{text}</Text>
      {action ? (
        <Button
          label={action.label}
          onPress={action.onPress}
          loading={action.loading}
          variant="primary"
        />
      ) : null}
      {secondary ? (
        <Button
          label={secondary.label}
          onPress={secondary.onPress}
          variant="secondary"
        />
      ) : null}
    </View>
  );
}

const tones = StyleSheet.create({
  info: { borderColor: colors.accent },
  warning: { borderColor: colors.warning },
  danger: { borderColor: colors.danger },
});

const styles = StyleSheet.create({
  base: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.bgSurface,
  },
  text: { fontSize: fontSize.md, color: colors.fg },
});
