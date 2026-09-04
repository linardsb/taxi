import {
  formatMessage,
  platformConfigSchema,
  resolveCommissionPct,
  rideOfferSchema,
  splitFare,
} from '@taxi/shared';
import {
  GLANCE_SPEED_MPS,
  haversineKm,
  offerCardProps,
  pctLabel,
} from './offer-card-props';
import {
  initialOffers,
  type OfferState,
  type PendingOffer,
} from './offer-state';

const t = (
  key: Parameters<typeof formatMessage>[1],
  params?: Record<string, string | number>,
) => formatMessage('lv', key, params);

/** A config ROW, as `platform_config` would answer — the 15 lives here, not in an assertion. */
const config = platformConfigSchema.parse({
  id: '11111111-2222-4333-8444-555555555555',
  cityId: '00000000-0000-4000-8000-000000000001',
  commissionPct: 15,
  driverDebtLimitCents: 5000,
  dispatchPhone: '+37120000000',
  updatedAt: '2026-09-04T10:00:00.000Z',
});

const PICKUP = { lat: 56.9496, lng: 24.1052 };

function pendingFor(
  driver: { commissionPctOverride: number | null },
  over: Partial<PendingOffer> = {},
): PendingOffer {
  const split = splitFare(1240, resolveCommissionPct(driver, config));
  const offer = rideOfferSchema.parse({
    id: '7c6b5a49-3827-4160-9504-3f2e1d0c9b8a',
    rideId: '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c',
    driverId: 'd0000000-0000-4000-8000-000000000001',
    status: 'pending',
    source: 'auto_match',
    sentAt: '2026-09-04T10:00:00.000Z',
    expiresAt: '2026-09-04T10:00:20.000Z',
    etaSeconds: 250, // → 5 min, rounded UP
    pickup: { location: PICKUP, address: 'Brīvības iela 1' },
    destination: { location: { lat: 56.97, lng: 24.18 }, address: 'Teika' },
    quote: {
      model: 'upfront_fixed',
      currency: 'EUR',
      totalCents: 1240,
      breakdown: { baseCents: 300, distanceCents: 640, timeCents: 300 },
    },
    split,
  });
  return {
    offer,
    paymentMethod: 'cash',
    receivedAtMs: 0,
    durationMs: 20_000,
    ...over,
  };
}

const shown = (
  pending: PendingOffer,
  over: Partial<OfferState> = {},
): OfferState => ({
  ...initialOffers,
  phase: 'pending',
  pending,
  remainingMs: 17_400, // → 18 s, rounded UP
  ...over,
});

describe('offerCardProps (#15)', () => {
  it('renders fare, you-keep and pct from a split built off the config row (expected)', () => {
    const props = offerCardProps(
      shown(pendingFor({ commissionPctOverride: null })),
      { lat: PICKUP.lat + 0.009, lng: PICKUP.lng, speedMps: 0, atMs: 0 },
      t,
    );
    expect(props).not.toBeNull();
    // 1240 − round(1240 × 15 / 100) = 1240 − 186 = 1054; pct = 100 − 15.
    expect(props!.fare).toBe(t('driver.offer.fare', { amount: '€12.40' }));
    expect(props!.youKeep).toBe(
      t('driver.offer.you_keep', { amount: '€10.54', pct: 85 }),
    );
    expect(props!.payment).toBe(t('driver.offer.payment_cash'));
    expect(props!.seconds).toBe(18);
    expect(props!.countdown).toBe(t('driver.offer.countdown', { seconds: 18 }));
    // 0.009° of latitude ≈ 1.0 km (1° ≈ 111.2 km); one decimal.
    expect(props!.km).toBe(1);
    expect(props!.eta).toBe(t('driver.offer.eta', { minutes: 5, km: '1.0' }));
    expect(props!.glance).toBe(false);
    expect(props!.queue).toBeNull();
    expect(props!.a11yLabel).toBe(
      t('driver.offer.a11y_card', {
        amount: '€12.40',
        net: '€10.54',
        seconds: 18,
      }),
    );
  });

  it('a 0% override renders «you keep €12.40 (100%)» — never a hardcoded 85 (edge)', () => {
    const props = offerCardProps(
      shown(pendingFor({ commissionPctOverride: 0 })),
      null,
      t,
    );
    expect(props!.youKeep).toBe(
      t('driver.offer.you_keep', { amount: '€12.40', pct: 100 }),
    );
  });

  it('has no km without a fix, and shows the queue line from the live event (edge)', () => {
    const queue = {
      driverId: 'd0000000-0000-4000-8000-000000000001',
      geozoneId: '00000000-0000-4000-8000-000000000102',
      geozoneSlug: 'rix',
      position: 2,
      size: 5,
      at: '2026-09-04T10:00:00.000Z',
    };
    const props = offerCardProps(
      shown(pendingFor({ commissionPctOverride: null }), { queue }),
      null,
      t,
    );
    expect(props!.km).toBeNull();
    expect(props!.eta).toBe(t('driver.offer.eta', { minutes: 5, km: '—' }));
    expect(props!.queue).toBe(
      t('driver.queue.position', { position: 2, size: 5, zone: 'rix' }),
    );
  });

  it('enters glance mode above 10 km/h and stays full below it or when speed is unknown (edge)', () => {
    const base = pendingFor({ commissionPctOverride: null });
    // 12 km/h = 3.33 m/s > 2.78 m/s; 8 km/h = 2.22 m/s < 2.78 m/s.
    expect(
      offerCardProps(shown(base, { speedMps: 12 / 3.6 }), null, t)!.glance,
    ).toBe(true);
    expect(
      offerCardProps(shown(base, { speedMps: 8 / 3.6 }), null, t)!.glance,
    ).toBe(false);
    expect(
      offerCardProps(shown(base, { speedMps: null }), null, t)!.glance,
    ).toBe(false);
    expect(GLANCE_SPEED_MPS).toBeCloseTo(2.78, 2);
  });

  it('maps every non-cash method to the card label and reads «card» in the payment pill (edge)', () => {
    const props = offerCardProps(
      shown(
        pendingFor({ commissionPctOverride: null }, { paymentMethod: 'card' }),
      ),
      null,
      t,
    );
    expect(props!.payment).toBe(t('driver.offer.payment_card'));
  });

  it('is null with no pending card (failure)', () => {
    expect(offerCardProps(initialOffers, null, t)).toBeNull();
  });
});

describe('helpers', () => {
  it('pctLabel keeps a whole pct whole and a fractional one to one decimal', () => {
    expect(pctLabel(15)).toBe('15');
    expect(pctLabel(87.5)).toBe('87.5');
  });

  it('haversineKm is zero for the same point and symmetric', () => {
    const b = { lat: 56.9236, lng: 23.9711 };
    expect(haversineKm(PICKUP, PICKUP)).toBe(0);
    expect(haversineKm(PICKUP, b)).toBeCloseTo(haversineKm(b, PICKUP), 9);
    // Rīga centre → RIX airport ≈ 8.7 km straight-line.
    expect(haversineKm(PICKUP, b)).toBeCloseTo(8.7, 0);
  });
});
