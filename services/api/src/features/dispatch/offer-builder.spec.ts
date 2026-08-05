import {
  isOfferSplitConsistent,
  rideRequestSchema,
  type DriverCandidate,
  type FareQuote,
  type PlatformConfig,
  type RideRequest,
} from '@taxi/shared';
import type { DriverMatchAttributes } from '../drivers';
import { buildOffer } from './offer-builder';

const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const DRIVER_ID = 'd0000000-0000-4000-8000-000000000001';

const request = (): RideRequest =>
  rideRequestSchema.parse({
    riderId: '5a5a5a5a-1111-4222-8333-444444444444',
    pickup: { location: { lat: 56.9512, lng: 24.1136 }, address: 'Brīvības 1' },
    destination: { location: { lat: 56.9236, lng: 23.9711 }, address: 'RIX' },
    paymentMethod: 'cash',
  });

/** €13.00 — the seeded centre→RIX fare. */
const quote: FareQuote = {
  model: 'upfront_fixed',
  currency: 'EUR',
  totalCents: 1_300,
  breakdown: {
    baseCents: 200,
    distanceCents: 840,
    timeCents: 260,
    discountCents: 0,
  },
};

const config = (over: Partial<PlatformConfig> = {}): PlatformConfig =>
  ({
    commissionPct: 15,
    offerTimeoutSeconds: 20,
    ...over,
  }) as PlatformConfig;

const candidate = (over: Partial<DriverCandidate> = {}): DriverCandidate => ({
  driverId: DRIVER_ID,
  location: { lat: 56.95, lng: 24.11 },
  status: 'online',
  etaSeconds: 120,
  ...over,
});

const attrs = (
  commissionPctOverride: number | null = null,
): DriverMatchAttributes => ({
  driverId: DRIVER_ID,
  status: 'online',
  isFemale: null,
  balanceCents: 0,
  commissionPctOverride,
  categories: ['standard'],
  hasChildSeat: false,
  maxPassengerSeats: 4,
});

const base = {
  rideId: RIDE_ID,
  request: request(),
  quote,
  candidate: candidate(),
  driverAttrs: attrs(),
  config: config(),
  source: 'auto_match' as const,
  status: 'pending' as const,
};

describe('buildOffer', () => {
  it('carries the FULL rider fare and the platform-base split (expected)', () => {
    const now = new Date('2026-08-05T10:00:00.000Z');
    const offer = buildOffer({ ...base, now });

    // The driver sees what the RIDER pays, never the net. This is S2-5.
    expect(offer.quote.totalCents).toBe(1_300);
    expect(offer.split.totalCents).toBe(1_300);
    expect(offer.split.commissionPct).toBe(15);
    expect(offer.split.commissionSource).toBe('platform_base');
    expect(offer.split.commissionCents).toBe(195);
    expect(offer.split.driverNetCents).toBe(1_105);
    expect(isOfferSplitConsistent(offer)).toBe(true);

    expect(offer.status).toBe('pending');
    expect(offer.source).toBe('auto_match');
    expect(offer.etaSeconds).toBe(120);
    expect(offer.sentAt).toEqual(now);
    // The deadline is config, never a literal.
    expect(offer.expiresAt).toEqual(new Date('2026-08-05T10:00:20.000Z'));
    expect(offer.queuePosition).toBeUndefined();
  });

  it('re-resolves the commission for a driver on an override (edge)', () => {
    // Reusing #9's platform-base preview would show 15% here and short the
    // driver's card by €130 — the number the whole pitch rests on.
    const offer = buildOffer({ ...base, driverAttrs: attrs(5) });

    expect(offer.split.commissionPct).toBe(5);
    expect(offer.split.commissionSource).toBe('driver_override');
    expect(offer.split.commissionCents).toBe(65);
    expect(offer.split.driverNetCents).toBe(1_235);
    expect(offer.split.totalCents).toBe(1_300); // the rider still pays €13.00
  });

  it('honours a 0% override rather than treating it as absent (edge)', () => {
    // `resolveCommissionPct` uses `!= null` precisely because the evidenced
    // S6-7 pilot is a real 0%.
    const offer = buildOffer({ ...base, driverAttrs: attrs(0) });

    expect(offer.split.commissionPct).toBe(0);
    expect(offer.split.commissionSource).toBe('driver_override');
    expect(offer.split.driverNetCents).toBe(1_300);
  });

  it('carries a 1-based queue position when the queue produced the candidate (edge)', () => {
    const offer = buildOffer({
      ...base,
      candidate: candidate({ queuePosition: 1 }),
    });

    expect(offer.queuePosition).toBe(1);
  });

  it('refuses to build an offer whose split contradicts its quote (failure)', () => {
    // A stale quote is the real-world version of this: the split is computed
    // from one total and the card shows another.
    expect(() =>
      buildOffer({
        ...base,
        // 150% commission makes driverNetCents negative — a driver paying the
        // platform, which `splitFare`'s parse rejects at the source.
        driverAttrs: attrs(150),
      }),
    ).toThrow();
  });

  it('gives every offer its own id (failure of a shared-id assumption)', () => {
    const first = buildOffer(base);
    const second = buildOffer(base);

    // The id is generated here, not by the column default: the offer is emitted
    // before the row exists and `/offers/:offerId/accept` must resolve it.
    expect(first.id).not.toBe(second.id);
  });
});
