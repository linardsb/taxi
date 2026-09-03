import {
  colors,
  fontSize,
  rideCancelSchema,
  type MessageKey,
  type RideStatus,
} from '@taxi/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Banner, Button, Screen, useScreenFocus } from '@/components';
import { ApiError, useSession } from '@/features/auth';
import { errorMessageKey, useT } from '@/features/i18n';
import { useRideStatus } from './use-ride-status';

/**
 * Status → catalog copy. `requested` is "finding a car"; every status past it
 * is "a car has been found", because this screen ends at matched — the arriving
 * / arrived / in-progress detail is #17's, and claiming it here would be a lie
 * about what the app knows.
 */
function statusKey(
  status: RideStatus | null,
  stillSearching: boolean,
): MessageKey {
  if (status === null || status === 'requested' || status === 'scheduled') {
    return stillSearching
      ? 'rider.status.still_searching'
      : 'rider.status.searching';
  }
  if (status.startsWith('cancelled')) return 'rider.status.cancelled';
  if (isOver(status)) return 'rider.status.completed';
  return 'rider.status.matched';
}

/**
 * The ride is finished — nothing more will happen to it, so the only sensible
 * control is a way back to booking.
 *
 * `completed` and `settled` used to fall through to `rider.status.matched`,
 * which told a rider whose ride had ended «Auto ir atrasts».
 */
function isOver(status: RideStatus): boolean {
  return status === 'completed' || status === 'settled';
}

/**
 * `/book/status` — what is happening, spoken.
 *
 * The status line is BOTH an Android live region and an iOS announce, which is
 * the split `Banner` already owns, so it reuses `Banner` rather than
 * reinventing it: `accessibilityLiveRegion` is Android-only, and on iOS
 * VoiceOver hears nothing unless the text is announced outright. A rider whose
 * phone is in their pocket is the whole point — nothing here requires looking
 * at the screen.
 *
 * ONE announcement per change, and `Banner` is it. A second effect here
 * announcing the same line under `rider.a11y.status_changed` made every iOS
 * transition speak twice: «Auto ir atrasts», then «Brauciena statuss: Auto ir
 * atrasts». Banner is kept over the effect because it also carries the Android
 * live region, which an announce alone does not.
 */
export function StatusScreen() {
  const t = useT();
  const router = useRouter();
  const { api } = useSession();
  const heading = useRef<Text>(null);
  useScreenFocus(heading);
  const params = useLocalSearchParams<{ rideId?: string }>();
  const rideId = params.rideId ?? null;
  const { status, stillSearching, connected } = useRideStatus(rideId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const key = statusKey(status, stillSearching);
  // No elapsed-minutes placeholder: a counter rendered once at 60 s and never
  // updated would say "1 min" to a rider who has waited five, and keeping it
  // honest costs a ticking timer plus an announcement every minute. The message
  // only has to mean "we are still looking".
  const line = t(key);

  // A ride that has ended, one way or the other. The only control that makes
  // sense is a way back: `/book/status` is reached by `router.replace`, so there
  // is no back entry, and «Atcelt braucienu» on a cancelled or completed ride
  // is a button whose only possible outcome is a 409.
  const over =
    status !== null && (status.startsWith('cancelled') || isOver(status));

  async function cancel() {
    if (rideId === null) return;
    setBusy(true);
    setError(null);
    try {
      // `{ reason: null }` — the body is nullable and defaults null; the ACTOR
      // comes from the JWT role, never from the body.
      await api.request('POST', `/rides/${rideId}/cancel`, {
        body: rideCancelSchema.parse({}),
      });
      router.replace('/book');
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError(errorMessageKey(err?.code ?? 'generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text ref={heading} style={styles.title} accessibilityRole="header">
        {t('rider.status.title')}
      </Text>
      <Banner tone="info" text={line} testID="status-line" />
      {!connected ? (
        <Banner tone="warning" text={t('rider.status.reconnecting')} />
      ) : null}
      {error ? <Banner tone="danger" text={t(error)} /> : null}
      {over ? (
        <Button
          label={t('rider.status.book_again')}
          onPress={() => router.replace('/book')}
        />
      ) : (
        <Button
          label={t('rider.status.cancel')}
          onPress={() => void cancel()}
          variant="danger"
          loading={busy}
          disabled={rideId === null}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
});
