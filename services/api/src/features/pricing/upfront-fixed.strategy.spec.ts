import {
  isFareQuoteConsistent,
  type RideRequest,
  type RideTariff,
} from '@taxi/shared';
import type { Env } from '../../common/config/env.schema';
import type { TariffRepository } from './tariff.repository';
import { UpfrontFixedPricingStrategy } from './upfront-fixed.strategy';

const CITY_ID = '00000000-0000-4000-8000-000000000001';

/** The seeded Rīga standard card, fitted to S5-1's real fares. */
const STANDARD: RideTariff = {
  id: '00000000-0000-4000-8000-000000000201',
  cityId: CITY_ID,
  category: 'standard',
  baseCents: 200,
  perKmCents: 80,
  perMinuteCents: 15,
  minimumFareCents: 350,
  updatedAt: new Date('2026-08-03T09:00:00.000Z'),
};

const request = { category: 'standard' } as RideRequest;

const build = (forCategory: TariffRepository['forCategory']) =>
  new UpfrontFixedPricingStrategy(
    { forCategory } as TariffRepository,
    {
      DEFAULT_CITY_ID: CITY_ID,
    } as Env,
  );

const withTariff = (tariff: RideTariff) => build(() => Promise.resolve(tariff));

describe('UpfrontFixedPricingStrategy', () => {
  it('prices a 10 km / 20 min trip off the tariff rows (expected)', async () => {
    const quote = await withTariff(STANDARD).quote(request, {
      distanceMeters: 10_000,
      durationSeconds: 1_200,
      polyline: '',
    });

    // base 200 + distance 800 + time 300 = 1300 cents — the €13 centre→RIX
    // anchor the seeded standard tariff was fitted to (S5-1).
    expect(quote.breakdown.baseCents).toBe(200);
    expect(quote.breakdown.distanceCents).toBe(800);
    expect(quote.breakdown.timeCents).toBe(300);
    expect(quote.breakdown.discountCents).toBe(0);
    expect(quote.totalCents).toBe(1300);
    expect(quote.model).toBe('upfront_fixed');
    expect(isFareQuoteConsistent(quote)).toBe(true);
  });

  it('tops a short trip up to the minimum fare on the base line (edge)', async () => {
    const quote = await withTariff(STANDARD).quote(request, {
      distanceMeters: 400,
      durationSeconds: 36,
      polyline: '',
    });

    // distance 32 + time 9 + base 200 = 241, topped up to the 350 minimum by
    // adding 109 to the BASE line only — the distance line still corresponds to
    // the actual distance.
    expect(quote.breakdown.baseCents).toBe(309);
    expect(quote.breakdown.distanceCents).toBe(32);
    expect(quote.breakdown.timeCents).toBe(9);
    expect(quote.totalCents).toBe(350);
    expect(isFareQuoteConsistent(quote)).toBe(true);
  });

  it('keeps a zero-length route positive and consistent (edge)', async () => {
    const quote = await withTariff(STANDARD).quote(request, {
      distanceMeters: 0,
      durationSeconds: 0,
      polyline: '',
    });

    expect(quote.totalCents).toBe(350);
    expect(quote.breakdown.baseCents).toBe(350);
    expect(isFareQuoteConsistent(quote)).toBe(true);
  });

  it('propagates a missing tariff row unchanged (failure)', async () => {
    const strategy = build(() =>
      Promise.reject(
        new Error('No ride_tariffs row for city X / category vip'),
      ),
    );

    await expect(
      strategy.quote(request, {
        distanceMeters: 1_000,
        durationSeconds: 120,
        polyline: '',
      }),
    ).rejects.toThrow(/No ride_tariffs row/);
  });
});
