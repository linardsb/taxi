import {
  addressPointSchema,
  colors,
  fontSize,
  spacing,
  type AddressPoint,
} from '@taxi/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Banner,
  Button,
  Screen,
  TextField,
  useScreenFocus,
} from '@/components';
import { errorMessageKey, useT } from '@/features/i18n';
import {
  AddressRow,
  SAVED_PLACE_LABEL_MAX,
  currentPositionPoint,
  useSavedPlaces,
} from '@/features/places';
import { isBookable } from './booking-draft';
import { PaymentChips } from './payment-chips';
import { QuoteCard } from './quote-card';
import { useBookingDraft } from './use-booking-draft';
import { useBookRide } from './use-book-ride';
import { useQuote } from './use-quote';

/**
 * `/book` — the one booking screen, and it has NO MAP.
 *
 * Composition only: the draft's rules live in `booking-draft.ts`, the quote in
 * `use-quote.ts`, the booking call in `use-book-ride.ts`. Anything that starts
 * to look like logic here belongs in one of those — the 500-line cap is the
 * enforcement, and `presence-state`/`run-effects` (#141) is the precedent for
 * when a screen file starts growing.
 *
 * Friction: a saved-address repeat ride is TWO taps from here — the saved row
 * fills the dropoff and fires the quote in one, then Book. A new destination is
 * three. The quote fires on selection rather than behind a "Get price" button,
 * which would be the fourth.
 */
export function BookingScreen() {
  const t = useT();
  const router = useRouter();
  const heading = useRef<Text>(null);
  useScreenFocus(heading);
  const { draft, dispatch } = useBookingDraft();
  const { places, save } = useSavedPlaces();
  const { book, busy, error } = useBookRide(draft);
  useQuote(draft, dispatch);

  const [label, setLabel] = useState('');
  const params = useLocalSearchParams<{
    field?: string;
    address?: string;
    lat?: string;
    lng?: string;
    placeId?: string;
  }>();

  // Pickup DEFAULTS to the device's position and is NEVER required to come from
  // it (D7): permission refused, a timeout and an indoor fix all leave the row
  // empty and tappable rather than showing an error.
  //
  // `setPickupIfEmpty`, not `setPickup`. The `cancelled` flag below guards
  // UNMOUNT only, and `/book` is pushed over rather than unmounted when the
  // search sheet opens — so a fix that arrives while the rider is typing an
  // address would otherwise land on top of the one they chose.
  useEffect(() => {
    let cancelled = false;
    void currentPositionPoint().then((point) => {
      if (!cancelled && point !== null) {
        dispatch({ type: 'setPickupIfEmpty', point });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  // The search sheet hands its result back through route params, so it arrives
  // as strings and is re-parsed at this boundary like any other untrusted input.
  const { field, address, lat, lng, placeId } = params;
  useEffect(() => {
    if (address === undefined || lat === undefined || lng === undefined) return;
    const parsed = addressPointSchema.safeParse({
      location: { lat: Number(lat), lng: Number(lng) },
      address,
    });
    if (!parsed.success) return;
    if (field === 'pickup') dispatch({ type: 'setPickup', point: parsed.data });
    else {
      dispatch({
        type: 'setDropoff',
        point: parsed.data,
        placeId: placeId === undefined || placeId === '' ? null : placeId,
      });
    }
  }, [address, dispatch, field, lat, lng, placeId]);

  const open = (which: 'pickup' | 'dropoff') =>
    router.push({ pathname: '/book/address', params: { field: which } });

  const pick = (point: AddressPoint, id: string | null) =>
    dispatch({ type: 'setDropoff', point, placeId: id });

  async function confirm() {
    const rideId = await book();
    if (rideId !== null) {
      router.replace({ pathname: '/book/status', params: { rideId } });
    }
  }

  // Narrowed once, so the save block reads the same value its guard tested. The
  // `draft.dropoff!` it replaces was safe only for as long as the guard stayed
  // directly above it.
  const dropoff = draft.dropoff;

  return (
    <Screen scroll={false}>
      <Text ref={heading} style={styles.title} accessibilityRole="header">
        {t('rider.book.title')}
      </Text>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.body}
      >
        <AddressRow
          testID="pickup-row"
          primaryText={draft.pickup?.address ?? t('rider.book.pickup_empty')}
          secondaryText={t('rider.book.pickup_label')}
          onPress={() => open('pickup')}
        />
        <AddressRow
          testID="dropoff-row"
          primaryText={draft.dropoff?.address ?? t('rider.book.where_to')}
          secondaryText={t('rider.book.dropoff_label')}
          onPress={() => open('dropoff')}
        />

        {places.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t('rider.book.saved_header')}
            </Text>
            {places.map((place) => (
              <AddressRow
                key={place.id}
                primaryText={place.label}
                secondaryText={place.point.address}
                onPress={() => pick(place.point, place.placeId)}
              />
            ))}
          </View>
        ) : null}

        {/* Saving lives HERE, not in the search sheet: the sheet navigates away
            the instant a resolve lands, so an affordance there would cost the
            tap the friction budget spends on Book. */}
        {dropoff !== null ? (
          <View style={styles.section}>
            <TextField
              label={t('rider.book.save_prompt')}
              value={label}
              onChangeText={setLabel}
              // `savedPlaceSchema` parses INSIDE the write queue, so an
              // over-length label is a rejected write, not a validation
              // message. Capping the input is what keeps that unreachable.
              maxLength={SAVED_PLACE_LABEL_MAX}
            />
            <Button
              label={t('rider.book.save_address')}
              variant="secondary"
              disabled={label.trim() === ''}
              onPress={() => {
                // Cleared ONLY on success. Clearing regardless made a failed
                // write look exactly like a successful one — the row missing
                // and nothing to say why. Left in place, the label is both the
                // signal and the retry.
                void save(label.trim(), dropoff, draft.dropoffPlaceId)
                  .then(() => setLabel(''))
                  .catch(() => undefined);
              }}
            />
          </View>
        ) : null}

        <QuoteCard quote={draft.quote} state={draft.quoteState} />
        {draft.quoteState === 'failed' ? (
          // The api's OWN code, not the announce string: a 429, a maps outage
          // and an offline phone are three different things to a rider, and
          // `rider.error.offline` is only reachable through here.
          //
          // The RETRY is what makes the failure recoverable at all. `useQuote`
          // fires only out of `idle`, and re-picking the SAME address changes no
          // route param, so the effect never re-runs and nothing happens —
          // leaving the rider a disabled Book button and no way out but a
          // different destination or killing the app.
          <Banner
            tone="danger"
            text={t(errorMessageKey(draft.quoteErrorCode ?? 'generic'))}
            action={{
              label: t('rider.book.retry'),
              onPress: () => dispatch({ type: 'quoteRetry' }),
            }}
          />
        ) : null}
        {error ? <Banner tone="danger" text={t(error)} /> : null}

        <Text style={styles.sectionTitle}>{t('rider.book.payment_label')}</Text>
        <PaymentChips
          value={draft.paymentMethod}
          onChange={(paymentMethod) =>
            dispatch({ type: 'setPaymentMethod', paymentMethod })
          }
        />
      </ScrollView>
      <Button
        label={busy ? t('rider.book.confirming') : t('rider.book.confirm')}
        onPress={() => void confirm()}
        disabled={!isBookable(draft)}
        loading={busy}
        size="lg"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
  body: { gap: spacing.md, paddingBottom: spacing.md },
  section: { gap: spacing.xs },
  sectionTitle: { fontSize: fontSize.sm, color: colors.fgMuted },
});
