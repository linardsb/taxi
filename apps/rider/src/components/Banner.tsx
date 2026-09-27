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
  /** The one thing to do about it — the failed quote's «Mēģināt vēlreiz». */
  action?: BannerAction;
  /** A quieter second choice. No caller in this app yet. */
  secondary?: BannerAction;
  /**
   * `false` for a caller whose event is already spoken elsewhere, or whose
   * text changes on a timer. Default `true`.
   */
  announce?: boolean;
  testID?: string;
}

/**
 * A state change the RIDER should hear, with at most one thing to do about
 * it. The text is announced outright with `announceForAccessibility`, on
 * both platforms, whenever it mounts or changes.
 *
 * Android: `observed` on the `sakta224` emulator (API 36, `targetSdk=36`,
 * RN 0.86.3) with TalkBack's verbose log, #259 R11. With only
 * `accessibilityLiveRegion="polite"` on the `View` the text changed with
 * `nodeLiveRegion=0` and 0 utterances; a live region on `Text` also gave 0;
 * `announceForAccessibility` spoke the text with subtype
 * `TYPE_ANNOUNCEMENT`. So there is no live region here: it never reached the
 * platform node, and if a later RN wired it, Android would speak every banner
 * twice. `announceForAccessibility` is deprecated on API 36 but spoke there
 * (`observed`) — a deprecation clean-up that removes it leaves Android with
 * no announcer at all.
 *
 * IT IS THE ONLY ANNOUNCER for the surfaces that use it. A screen that also
 * announces the same event makes both platforms speak it twice. A caller
 * whose event already has an announcer that speaks whichever screen is
 * mounted (an app-wide reducer effect), or whose text changes on a timer,
 * passes `announce={false}` (#259 T0).
 */
export function Banner({
  tone,
  text,
  action,
  secondary,
  announce = true,
  testID,
}: BannerProps) {
  useEffect(() => {
    if (announce) {
      AccessibilityInfo.announceForAccessibility(text);
    }
  }, [text, announce]);
  return (
    <View testID={testID} style={[styles.base, tones[tone]]}>
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
