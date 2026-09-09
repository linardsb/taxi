import {
  colors,
  fontSize,
  formatEur,
  radius,
  spacing,
  type MessageKey,
  type Ride,
} from '@taxi/shared';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Banner, Button, Screen } from '@/components';
import { errorMessageKey, useT } from '@/features/i18n';
import { stepFor, TITLE_KEY } from './active-ride-state';
import {
  canOpenWaze,
  googleMapsLink,
  openNavigation,
  wazeLink,
} from './nav-links';
import { paymentMethodLabel, Receipt } from './receipt';
import { useActiveRide } from './use-active-ride';

const STEP_KEY = {
  arriving: 'driver.ride.step_arriving',
  arrived: 'driver.ride.step_arrived',
  start: 'driver.ride.step_start',
  complete: 'driver.ride.step_complete',
} as const satisfies Record<
  NonNullable<ReturnType<typeof stepFor>>,
  MessageKey
>;

/** Pickup until the driver has arrived; the destination from `arrived` on. */
function navTarget(ride: Ride) {
  return ride.status === 'accepted' || ride.status === 'arriving'
    ? ride.request.pickup.location
    : ride.request.destination.location;
}

/**
 * The ride from acceptance to the receipt (#15). One primary 56 px button —
 * whichever step `ride.status` allows — the payment method as a pill (the
 * OPERATIVE `ride.paymentMethod`, never the request snapshot), a one-time
 * warning when it changed between the card and acceptance, nav hand-off to
 * Google Maps / Waze, and the ended views: released / cancelled → banner +
 * home; completed → the receipt + done.
 */
export function ActiveRideScreen() {
  const t = useT();
  const { state, step, reload, dismissNotice, dismiss } = useActiveRide();
  const ride = state.ride;
  const target = ride ? navTarget(ride) : null;
  const targetKey = target ? `${target.lat},${target.lng}` : null;
  const [wazeAvailable, setWazeAvailable] = useState(false);
  useEffect(() => {
    if (!target) return;
    let live = true;
    void canOpenWaze(target).then((ok) => {
      if (live) setWazeAvailable(ok);
    });
    return () => {
      live = false;
    };
    // `targetKey` is the coordinates; `target` is a fresh object per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  if (!state.rideId) return <Redirect href="/home" />;

  if (state.ended) {
    const ended = state.ended;
    return (
      <Screen>
        {ended.kind === 'completed' ? (
          <>
            <Text style={styles.title} accessibilityRole="header">
              {t('driver.ride.completed_title')}
            </Text>
            {ended.ride.split ? (
              <Receipt
                split={ended.ride.split}
                paymentMethod={ended.ride.paymentMethod}
              />
            ) : (
              // Completed but the split has not been read yet (Q5): offer the re-read.
              <Banner
                tone="info"
                text={t('driver.ride.completed_title')}
                action={{ label: t('driver.ride.reload'), onPress: reload }}
              />
            )}
          </>
        ) : (
          <Banner
            tone={ended.kind === 'released' ? 'info' : 'warning'}
            text={
              ended.kind === 'released'
                ? t('driver.ride.released')
                : t('driver.ride.cancelled', {
                    reason: ended.reason ?? '',
                  }).trim()
            }
            testID="ended-banner"
          />
        )}
        <Button
          size="lg"
          label={t('driver.action.done')}
          onPress={dismiss}
          testID="ride-done"
        />
      </Screen>
    );
  }

  if (!ride) {
    return (
      <Screen>
        {state.errorCode ? (
          <Banner
            tone="danger"
            text={t(errorMessageKey(state.errorCode))}
            action={{ label: t('driver.ride.reload'), onPress: reload }}
            testID="ride-error"
          />
        ) : (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.accent} testID="ride-loading" />
          </View>
        )}
      </Screen>
    );
  }

  const currentStep = stepFor(ride.status);
  const title = TITLE_KEY[ride.status] ?? 'driver.ride.title_accepted';
  const method = paymentMethodLabel(ride.paymentMethod, t);
  return (
    <Screen>
      <Text style={styles.title} accessibilityRole="header">
        {t(title)}
      </Text>
      <View style={styles.pill} testID="ride-payment">
        <Text style={styles.pillText}>
          {t('driver.ride.payment', { method })}
        </Text>
      </View>
      {state.notice === 'payment_changed' ? (
        <Banner
          tone="warning"
          text={t('driver.ride.payment_changed', { method })}
          secondary={{ label: t('driver.action.done'), onPress: dismissNotice }}
          testID="payment-changed"
        />
      ) : null}
      {state.errorCode ? (
        <Banner
          tone="danger"
          text={t(errorMessageKey(state.errorCode))}
          action={{ label: t('driver.action.retry'), onPress: step }}
          secondary={{ label: t('driver.ride.reload'), onPress: reload }}
          testID="ride-error"
        />
      ) : null}
      <View style={styles.details}>
        <Text style={styles.detail}>
          {t('driver.offer.pickup', { address: ride.request.pickup.address })}
        </Text>
        <Text style={styles.detail}>
          {t('driver.offer.destination', {
            address: ride.request.destination.address,
          })}
        </Text>
        {ride.quote ? (
          <Text style={styles.fare} testID="ride-fare">
            {t('driver.offer.fare', {
              amount: formatEur(ride.quote.totalCents),
            })}
          </Text>
        ) : null}
      </View>
      {currentStep ? (
        <Button
          size="lg"
          label={t(STEP_KEY[currentStep])}
          onPress={step}
          loading={state.busy}
          testID="ride-step"
        />
      ) : null}
      <View style={styles.nav}>
        {target ? (
          <Button
            variant="secondary"
            label={t('driver.ride.navigate_maps')}
            onPress={() => void openNavigation(googleMapsLink(target))}
            testID="nav-maps"
          />
        ) : null}
        {target && wazeAvailable ? (
          <Button
            variant="secondary"
            label={t('driver.ride.navigate_waze')}
            onPress={() => void openNavigation(wazeLink(target))}
            testID="nav-waze"
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pill: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.fg,
  },
  pillText: { color: colors.bg, fontSize: fontSize.lg, fontWeight: '700' },
  details: { gap: spacing.xs },
  detail: { fontSize: fontSize.md, color: colors.fg },
  fare: { fontSize: fontSize.lg, fontWeight: '600', color: colors.fg },
  nav: { gap: spacing.sm, marginTop: 'auto' },
});
