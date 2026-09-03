import { useEffect } from 'react';
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  /** The one thing to do about it — the failed quote's «Mēģināt vēlreiz». */
  action?: BannerAction;
  /** A quieter second choice. No caller in this app yet. */
  secondary?: BannerAction;
  testID?: string;
}

/**
 * A state change the RIDER should hear, with at most one thing to do about
 * it. `accessibilityLiveRegion` is Android-only, so on iOS the text is
 * announced outright — that is what VoiceOver hears. The announce is
 * iOS-only in turn: on Android both firing should read every fresh banner
 * twice under TalkBack (review F28).
 *
 * IT IS THE ONLY ANNOUNCER for the surfaces that use it. A screen that also
 * announces its own copy makes iOS speak every change twice — see
 * `status-screen.tsx`, which had exactly that.
 *
 * `expected`, NOT observed: no Android device has run this, and the test
 * below only pins that the announce is absent, not that TalkBack speaks. It
 * rests on the live region firing for a freshly MOUNTED view rather than
 * only for a content change — if that is wrong, Android has no announcement
 * at all. Plan §C.12 owes the TalkBack pass (review F47).
 */
export function Banner({ tone, text, action, secondary, testID }: BannerProps) {
  useEffect(() => {
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(text);
    }
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
