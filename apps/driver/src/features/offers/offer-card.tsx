import { colors, fontSize, radius, spacing } from '@taxi/shared';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, Screen } from '@/components';
import { useT } from '@/features/i18n';
import type { OfferCardProps } from './offer-card-props';

/** Half-period of the flash: 500 ms on / 500 ms off = 1 Hz, well under the 3 Hz photosensitivity line. */
export const FLASH_HALF_PERIOD_MS = 500;
/** A screen reader hears the countdown every 5 s, then every second for the last 5. */
export const ANNOUNCE_EVERY_S = 5;

/**
 * The full-screen offer card (#15; evidence §1.3, §5.3). The WHOLE card is the
 * accept target — one `Pressable` with the whole-card label — and decline is
 * a separate 44 px button below it, outside that target. The fare is the
 * largest type; the payment method is a high-contrast pill above the fold;
 * addresses, ETA and the queue line collapse away in glance mode.
 *
 * Flash = the card background alternating accent / surface at 1 Hz while the
 * offer is pending. Colours and cadence are placeholders logged in
 * .claude/references/ui-decisions.md.
 */
export function OfferCard({
  card,
  onAccept,
  onDecline,
}: {
  card: OfferCardProps;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const t = useT();
  const [flashOn, setFlashOn] = useState(false);
  const announced = useRef<number | null>(null);

  // No flash while an answer is in flight: derived at render (`lit`), so the
  // effect only ever owns the interval.
  const lit = flashOn && !card.accepting;
  useEffect(() => {
    if (card.accepting) return;
    const timer = setInterval(
      () => setFlashOn((on) => !on),
      FLASH_HALF_PERIOD_MS,
    );
    return () => clearInterval(timer);
  }, [card.accepting]);

  // Not a live region on the visible number: 20 announcements per card is
  // noise. Every 5 s, then each of the last 5, on both platforms.
  useEffect(() => {
    const s = card.seconds;
    const due = s <= ANNOUNCE_EVERY_S || s % ANNOUNCE_EVERY_S === 0;
    if (!due || announced.current === s || s <= 0) return;
    announced.current = s;
    AccessibilityInfo.announceForAccessibility(
      t('driver.offer.countdown', { seconds: s }),
    );
  }, [card.seconds, t]);

  const fg = lit ? colors.accentFg : colors.fg;
  const muted = lit ? colors.accentFg : colors.fgMuted;

  return (
    <Screen scroll={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={card.a11yLabel}
        accessibilityState={{ disabled: card.accepting, busy: card.accepting }}
        disabled={card.accepting}
        onPress={onAccept}
        focusable
        style={[
          styles.card,
          { backgroundColor: lit ? colors.accent : colors.bgSurface },
        ]}
        testID="offer-accept"
      >
        <Text style={[styles.title, { color: muted }]}>
          {t('driver.offer.title')}
        </Text>
        <Text style={[styles.fare, { color: fg }]} testID="offer-fare">
          {card.fare}
        </Text>
        <Text style={[styles.keep, { color: fg }]} testID="offer-keep">
          {card.youKeep}
        </Text>
        <View style={styles.pill} testID="offer-payment">
          <Text style={styles.pillText}>{card.payment}</Text>
        </View>
        {card.glance ? null : (
          <View style={styles.details} testID="offer-details">
            <Text style={[styles.detail, { color: fg }]}>{card.pickup}</Text>
            <Text style={[styles.detail, { color: fg }]}>
              {card.destination}
            </Text>
            <Text style={[styles.detail, { color: muted }]}>{card.eta}</Text>
            {card.queue ? (
              <Text style={[styles.detail, { color: muted }]}>
                {card.queue}
              </Text>
            ) : null}
          </View>
        )}
        <Text
          style={[styles.countdown, { color: fg }]}
          testID="offer-countdown"
        >
          {card.accepting ? t('driver.offer.accepting') : card.countdown}
        </Text>
        <Text style={[styles.hint, { color: muted }]}>
          {t('driver.offer.accept')}
        </Text>
      </Pressable>
      <Button
        size="md"
        variant="secondary"
        label={t('driver.offer.decline')}
        onPress={onDecline}
        disabled={card.accepting}
        testID="offer-decline"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 44,
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: radius.lg,
    justifyContent: 'center',
  },
  title: { fontSize: fontSize.md, fontWeight: '600' },
  fare: { fontSize: fontSize.xl * 2, fontWeight: '700' },
  keep: { fontSize: fontSize.xl, fontWeight: '600' },
  pill: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.fg,
  },
  pillText: { color: colors.bg, fontSize: fontSize.lg, fontWeight: '700' },
  details: { gap: spacing.xs, marginTop: spacing.sm },
  detail: { fontSize: fontSize.md },
  countdown: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginTop: spacing.md,
  },
  hint: { fontSize: fontSize.sm },
});
