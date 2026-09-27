import {
  colors,
  fontSize,
  formatEur,
  isInStatusSet,
  radius,
  RIDER_NAME_VISIBLE_STATUSES,
  RIDER_PHONE_VISIBLE_STATUSES,
  spacing,
  type MessageKey,
  type Ride,
} from '@taxi/shared';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Banner, Button, Screen, TextField } from '@/components';
import { errorMessageKey, useT } from '@/features/i18n';
import { needsPin, pinSendable, stepFor, TITLE_KEY } from './active-ride-state';
import { announcePrompt } from './arrival-announce';
import {
  callRider,
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
  // The rider's pickup PIN as typed (#258). Kept after a 422 so the driver
  // corrects rather than retypes (Start stays off until it differs). The field
  // is uncontrolled: a changing `value` makes RN re-set the native text on
  // every keystroke, which TalkBack speaks as "replaced" (#280). Non-digits
  // stay visible and `pinSendable` refuses them. Keyed to the ride because a
  // force-assign can swap the ride under a mounted screen, and a remounted
  // uncontrolled field comes back empty — so an early return that unmounts the
  // field on the SAME ride at `arrived` would leave digits behind an empty box.
  const [pin, setPin] = useState({ rideId: '', text: '' });
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
              // Silent: the reducer's `completed_title` effect speaks it,
              // on the Receipt path too (#259 T0 P4).
              <Banner
                announce={false}
                tone="info"
                text={t('driver.ride.completed_title')}
                action={{ label: t('driver.ride.reload'), onPress: reload }}
              />
            )}
          </>
        ) : (
          // Silent: the reducer's `released`/`cancelled` effect is the one
          // speaker — it runs app-wide, so it is also heard after hardware
          // back has unmounted this screen (#259 T0 P2/P3).
          <Banner
            announce={false}
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

  const typedPin = pin.rideId === ride.id ? pin.text : '';
  const currentStep = stepFor(ride.status);
  const title = TITLE_KEY[ride.status] ?? 'driver.ride.title_accepted';
  const method = paymentMethodLabel(ride.paymentMethod, t);
  // The client half of #261's windows: `step_done` moves `ride.status` without
  // a re-read, so the phone read at `arrived` is still in memory after
  // «Sākt braucienu». This gate on the SAME shared sets is what hides it.
  const riderName = isInStatusSet(RIDER_NAME_VISIBLE_STATUSES, ride.status)
    ? ride.rider.displayName
    : null;
  const riderPhone = isInStatusSet(RIDER_PHONE_VISIBLE_STATUSES, ride.status)
    ? ride.rider.phone
    : null;
  const prompt = announcePrompt(ride);
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
        // Silent: the reducer's effect speaks this text (#259 T0 P1).
        <Banner
          announce={false}
          tone="warning"
          text={t('driver.ride.payment_changed', { method })}
          secondary={{ label: t('driver.action.done'), onPress: dismissNotice }}
          testID="payment-changed"
        />
      ) : null}
      {state.notice === 'announce_requested' ? (
        // Silent: the reducer's effect is the one speaker, heard on whichever
        // screen is up (#259 T0's rule).
        <Banner
          announce={false}
          tone="warning"
          text={t('driver.ride.announce_requested')}
          secondary={{ label: t('driver.action.done'), onPress: dismissNotice }}
          testID="announce-requested"
        />
      ) : null}
      {state.errorCode ? (
        <Banner
          tone="danger"
          text={t(errorMessageKey(state.errorCode))}
          // No Retry on a PIN verdict: resending the refused digits would
          // spend another of the ride's 5 attempts (PR #277 M1).
          action={
            state.errorCode.startsWith('pickup_pin_')
              ? undefined
              : {
                  label: t('driver.action.retry'),
                  onPress: () => step(typedPin),
                }
          }
          secondary={{ label: t('driver.ride.reload'), onPress: reload }}
          testID="ride-error"
        />
      ) : null}
      <View style={styles.details}>
        {riderName ? (
          <Text style={styles.detail} testID="rider-name">
            {t('driver.ride.rider_name', { name: riderName })}
          </Text>
        ) : null}
        {/* The arrival-announce protocol (#259). Plain text, not a Banner:
            a Banner speaks at mount and would talk over «Esat klāt». */}
        {prompt ? (
          <View style={styles.prompt} testID="announce-prompt">
            <Text style={styles.promptText}>
              {t(prompt.key, prompt.params)}
            </Text>
          </View>
        ) : null}
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
      {/* No autoFocus: a field grabbing focus the moment the status flips
          would cut TalkBack off mid-announcement. */}
      {needsPin(ride) ? (
        <TextField
          label={t('driver.ride.pin_label')}
          onChangeText={(text) => setPin({ rideId: ride.id, text })}
          keyboardType="number-pad"
          maxLength={4}
          testID="pickup-pin-input"
        />
      ) : null}
      {currentStep ? (
        <Button
          size="lg"
          label={t(STEP_KEY[currentStep])}
          onPress={() => step(typedPin)}
          disabled={needsPin(ride) && !pinSendable(state, typedPin)}
          loading={state.busy}
          testID="ride-step"
        />
      ) : null}
      {riderPhone ? (
        <Button
          variant="secondary"
          label={t('driver.ride.call_rider')}
          accessibilityHint={
            riderName
              ? t('driver.ride.call_rider_hint', { name: riderName })
              : undefined
          }
          onPress={() => void callRider(riderPhone)}
          testID="call-rider"
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
  prompt: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
  },
  promptText: { fontSize: fontSize.lg, fontWeight: '600', color: colors.fg },
  nav: { gap: spacing.sm, marginTop: 'auto' },
});
