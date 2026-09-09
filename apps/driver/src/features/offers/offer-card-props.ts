import {
  formatEur,
  type LatLng,
  type PaymentMethodType,
  type RideOffer,
} from '@taxi/shared';
import type { T } from '@/features/i18n';
import type { LatestFix } from '@/features/location';
import type { OfferState } from './offer-state';

/**
 * Above this the card collapses to fare · you-keep · payment · accept/decline
 * (`docs/research/driver-ux-evidence.md` §5.2: "above ~10 km/h").
 * `derived`: 10 km/h ÷ 3.6 = 2.78 m/s.
 */
export const GLANCE_SPEED_MPS = 10 / 3.6;

export interface OfferCardProps {
  fare: string;
  youKeep: string;
  pickup: string;
  destination: string;
  eta: string;
  /** Straight-line km from the phone's newest fix; null without one. */
  km: number | null;
  payment: string;
  seconds: number;
  countdown: string;
  glance: boolean;
  queue: string | null;
  a11yLabel: string;
  accepting: boolean;
}

const EARTH_RADIUS_KM = 6_371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance; the card's "pickup km" is straight-line by design (no routed leg). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** `15` → «15», `12.5` → «12.5»: the split's double, never a literal. */
export function pctLabel(pct: number): string {
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

/**
 * `cash` is the one method a driver handles differently; every other member
 * of `PAYMENT_METHOD_TYPES` (`card`, and the not-yet-bookable `balance` /
 * `corporate`) settles without the driver touching money, so it reads «card».
 */
export function paymentLabel(method: PaymentMethodType, t: T): string {
  return t(
    method === 'cash'
      ? 'driver.offer.payment_cash'
      : 'driver.offer.payment_card',
  );
}

export function youKeepLabel(offer: RideOffer, t: T): string {
  return t('driver.offer.you_keep', {
    amount: formatEur(offer.split.driverNetCents),
    // From the persisted split, never a literal: a 0% override reads 100.
    pct: pctLabel(100 - offer.split.commissionPct),
  });
}

/** The pure state → view mapper; `null` when there is no card to draw. */
export function offerCardProps(
  state: OfferState,
  latest: LatestFix | null,
  t: T,
): OfferCardProps | null {
  const pending = state.pending;
  if (!pending) return null;
  const { offer } = pending;
  const kmRaw = latest
    ? haversineKm({ lat: latest.lat, lng: latest.lng }, offer.pickup.location)
    : null;
  const km = kmRaw === null ? null : Math.round(kmRaw * 10) / 10;
  const seconds = Math.ceil(state.remainingMs / 1000);
  const fare = formatEur(offer.quote.totalCents);
  const net = formatEur(offer.split.driverNetCents);
  const pickup = t('driver.offer.pickup', { address: offer.pickup.address });
  const destination = t('driver.offer.destination', {
    address: offer.destination.address,
  });
  const eta = t('driver.offer.eta', {
    minutes: Math.ceil(offer.etaSeconds / 60),
    km: km === null ? '—' : km.toFixed(1),
  });
  const payment = paymentLabel(pending.paymentMethod, t);
  const queue = queueLabel(state.queue, t);
  return {
    fare: t('driver.offer.fare', { amount: fare }),
    youKeep: youKeepLabel(offer, t),
    pickup,
    destination,
    eta,
    km,
    payment,
    seconds,
    countdown: t('driver.offer.countdown', { seconds }),
    glance: state.speedMps !== null && state.speedMps > GLANCE_SPEED_MPS,
    queue,
    // The card is ONE accessible node: `Pressable` defaults `accessible` to
    // true, which collapses the subtree, and an explicit label then REPLACES
    // the child text instead of adding to it. So this composes every line the
    // sighted driver reads rather than restating three of them — the payment
    // method above all, which is the field `ride:offer` carries it for. The
    // accept instruction is appended LAST so nobody is told to tap before
    // hearing whether the fare is cash. Glance mode hides the addresses
    // visually only; audio keeps them, because speed is not blindness.
    a11yLabel: [
      t('driver.offer.a11y_card', { amount: fare, net, seconds }),
      payment,
      pickup,
      destination,
      eta,
      queue,
      t('driver.offer.a11y_accept'),
    ]
      .filter(Boolean)
      .join(' '),
    accepting: state.phase === 'accepting',
  };
}

/**
 * The live `driver:queue` only. The offer's own `queuePosition` carries no
 * zone size or slug, and the api broadcasts the zone's ranks BEFORE it emits
 * a queue-mode offer (enrolment runs inside `findCandidates`), so the event is
 * already here by the time the card is — the same string home shows.
 */
export function queueLabel(queue: OfferState['queue'], t: T): string | null {
  if (!queue) return null;
  return t('driver.queue.position', {
    position: queue.position,
    size: queue.size,
    zone: queue.geozoneSlug,
  });
}
