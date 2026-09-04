import { splitFare } from '@taxi/shared';
import { routeNotification } from './route-notification';

const OFFER_ID = '7c6b5a49-3827-4160-9504-3f2e1d0c9b8a';
const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const DRIVER_ID = 'd0000000-0000-4000-8000-000000000001';

/** The wire offer as the api serialises it into `data.offer`. */
const wire = {
  id: OFFER_ID,
  rideId: RIDE_ID,
  driverId: DRIVER_ID,
  status: 'pending',
  source: 'auto_match',
  sentAt: '2026-09-04T10:00:00.000Z',
  expiresAt: '2026-09-04T10:00:20.000Z',
  etaSeconds: 240,
  pickup: { location: { lat: 56.95, lng: 24.11 }, address: 'Brīvības iela 1' },
  destination: { location: { lat: 56.97, lng: 24.18 }, address: 'Teika' },
  quote: {
    model: 'upfront_fixed',
    currency: 'EUR',
    totalCents: 1240,
    breakdown: { baseCents: 300, distanceCents: 640, timeCents: 300 },
  },
  split: splitFare(1240, { pct: 15, source: 'platform_base' }),
  paymentMethod: 'cash',
};

const offerData = (over: Record<string, string> = {}) => ({
  kind: 'offer',
  offerId: OFFER_ID,
  rideId: RIDE_ID,
  expiresAt: wire.expiresAt,
  offer: JSON.stringify(wire),
  ...over,
});

describe('routeNotification (#15)', () => {
  it('parses a carried offer into the wire event (expected)', () => {
    const route = routeNotification(offerData());
    expect(route.kind).toBe('offer');
    if (route.kind !== 'offer') throw new Error('unreachable');
    expect(route.offerId).toBe(OFFER_ID);
    expect(route.rideId).toBe(RIDE_ID);
    expect(route.offer?.id).toBe(OFFER_ID);
    expect(route.offer?.paymentMethod).toBe('cash');
    // Still the WIRE shape: dates are strings until `rideOfferSchema.parse`.
    expect(typeof route.offer?.expiresAt).toBe('string');
  });

  it('routes a payload the api dropped for size with the ids alone (edge)', () => {
    const { offer: _dropped, ...idsOnly } = offerData();
    expect(routeNotification(idsOnly)).toEqual({
      kind: 'offer',
      offer: null,
      offerId: OFFER_ID,
      rideId: RIDE_ID,
    });
  });

  it('sends every other notification — the offline nudge included — to the gate (edge)', () => {
    expect(routeNotification({ kind: 'offline_nudge' })).toEqual({
      kind: 'gate',
    });
    expect(routeNotification(undefined)).toEqual({ kind: 'gate' });
    expect(routeNotification('offer')).toEqual({ kind: 'gate' });
  });

  it('treats junk or off-schema JSON as no offer, never a throw (failure)', () => {
    expect(routeNotification(offerData({ offer: '{not json' }))).toMatchObject({
      kind: 'offer',
      offer: null,
      offerId: OFFER_ID,
    });
    // Parses as JSON, fails the schema (no `paymentMethod`, a Date-less wire).
    const { paymentMethod: _gone, ...noMethod } = wire;
    expect(
      routeNotification(offerData({ offer: JSON.stringify(noMethod) })),
    ).toMatchObject({ kind: 'offer', offer: null });
  });
});
