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

/** The stub's centre→RIX route (`api-rides-pricing.md`: 11 655 m, 1 049 s). */
const TRIP = { distanceMeters: 11_655, durationSeconds: 1_049 };

function pendingFor(
  driver: { commissionPctOverride: number | null },
  over: Partial<PendingOffer> = {},
  trip: { distanceMeters: number; durationSeconds: number } | null = null,
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
    trip,
  });
  return {
    offer,
    paymentMethod: 'cash',
    receivedAtMs: 0,
    durationMs: 20_000,
    source: 'socket',
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
  it('shows trip duration, km and the NET per routed km (#260, expected)', () => {
    const props = offerCardProps(
      shown(pendingFor({ commissionPctOverride: null }, {}, TRIP)),
      null,
      t,
    )!;
    // ceil(1049 / 60) = 18; 11655 m → 11.7; round(1054 × 1000 / 11655) =
    // round(90.43) = 90 cents — net, not the €12.40 fare.
    expect(props.trip).toBe('Brauciens ~18 min · 11.7 km · €0.90/km');
    // After the destination, before the pickup ETA, in the one a11y node.
    const label = props.a11yLabel;
    expect(label.indexOf('Teika')).toBeLessThan(label.indexOf('Brauciens'));
    expect(label.indexOf('Brauciens')).toBeLessThan(
      label.indexOf(t('driver.offer.eta', { minutes: 5, km: '—' })),
    );
  });

  it('reads the rate off the net, so a 0% override rates the full fare (#260, edge)', () => {
    const props = offerCardProps(
      shown(pendingFor({ commissionPctOverride: 0 }, {}, TRIP)),
      null,
      t,
    )!;
    // round(1240 × 1000 / 11655) = round(106.39) = 106 cents.
    expect(props.trip).toBe('Brauciens ~18 min · 11.7 km · €1.06/km');
  });

  it('omits the line for a ride with no stored trip (#260, edge)', () => {
    const props = offerCardProps(
      shown(pendingFor({ commissionPctOverride: null }, {}, null)),
      null,
      t,
    )!;
    expect(props.trip).toBeNull();
    expect(props.a11yLabel).not.toContain('Brauciens');
  });

  it('omits the line for a zero-length trip rather than dividing by zero (#260, edge)', () => {
    const props = offerCardProps(
      shown(
        pendingFor(
          { commissionPctOverride: null },
          {},
          {
            distanceMeters: 0,
            durationSeconds: 0,
          },
        ),
      ),
      null,
      t,
    )!;
    expect(props.trip).toBeNull();
    expect(props.a11yLabel).not.toMatch(/Infinity|NaN/);
  });

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
    // F4: the whole card is ONE accessible node (Pressable defaults
    // `accessible`), so this label REPLACES the child text rather than adding
    // to it. Everything the sighted driver reads has to be in here, and the
    // accept instruction has to come last — a blind driver must not be told to
    // tap before hearing whether the fare is cash.
    expect(props!.a11yLabel).toContain(t('driver.offer.payment_cash'));
    expect(props!.a11yLabel).toContain('Brīvības iela 1');
    expect(props!.a11yLabel).toContain('Teika');
    expect(props!.a11yLabel).toContain('€12.40');
    expect(props!.a11yLabel).toContain('€10.54');
    expect(props!.a11yLabel.trimEnd()).toMatch(
      new RegExp(`${t('driver.offer.a11y_accept')}$`),
    );
    // F22: the middle segments are label forms with no terminal punctuation,
    // so each is terminated — without it «Skaidrā naudā Iekāpšana: …» runs on
    // and the payment method has no pause after it.
    expect(props!.a11yLabel).toContain(
      `${t('driver.offer.payment_cash')}. ${t('driver.offer.pickup', {
        address: 'Brīvības iela 1',
      })}.`,
    );
    // …and the two that already end in a full stop are not double-punctuated.
    expect(props!.a11yLabel).not.toMatch(/\.\./);
  });

  it('the accessible name does not change as the countdown ticks (#263, edge)', () => {
    // A name that mutates every second makes TalkBack re-read the whole card
    // on each change and starves the throttled countdown announcements.
    const pending = pendingFor({ commissionPctOverride: null });
    const at18 = offerCardProps(shown(pending), null, t)!;
    const at3 = offerCardProps(
      shown(pending, { remainingMs: 2_100 }),
      null,
      t,
    )!;
    expect(at18.seconds).toBe(18);
    expect(at3.seconds).toBe(3);
    expect(at3.a11yLabel).toBe(at18.a11yLabel);
    expect(at18.a11yLabel).not.toMatch(/18/);
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
  it('haversineKm is zero for the same point and symmetric', () => {
    const b = { lat: 56.9236, lng: 23.9711 };
    expect(haversineKm(PICKUP, PICKUP)).toBe(0);
    expect(haversineKm(PICKUP, b)).toBeCloseTo(haversineKm(b, PICKUP), 9);
    // Rīga centre → RIX airport ≈ 8.7 km straight-line.
    expect(haversineKm(PICKUP, b)).toBeCloseTo(8.7, 0);
  });
});
