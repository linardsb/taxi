import type { Db } from '@taxi/db';
import { TariffRepository } from './tariff.repository';

const CITY_ID = '00000000-0000-4000-8000-000000000001';

const row = () => ({
  id: '00000000-0000-4000-8000-000000000003',
  cityId: CITY_ID,
  category: 'standard',
  baseCents: 200,
  perKmCents: 60,
  perMinuteCents: 15,
  minimumFareCents: 350,
  updatedAt: new Date('2026-08-03T09:00:00.000Z'),
});

/** Models the one read the repository makes: select → from → where → limit. */
const dbReturning = (rows: unknown[]) =>
  ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(rows) }),
      }),
    }),
  }) as unknown as Db;

const build = (rows: unknown[]) => new TariffRepository(dbReturning(rows));

describe('TariffRepository', () => {
  it('returns the rate card parsed through the shared schema (expected)', async () => {
    const tariff = await build([row()]).forCategory(CITY_ID, 'standard');

    expect(tariff.baseCents).toBe(200);
    expect(tariff.perKmCents).toBe(60);
    expect(tariff.updatedAt).toBeInstanceOf(Date);
  });

  it('throws naming the seed when the category has no row (failure)', async () => {
    // The load-bearing "a rate is config, there is no fallback" guarantee. The
    // strategy spec only rejects from a MOCKED forCategory, so without this the
    // real throw never executes — and a refactor returning a zero-rate default
    // would keep that spec green while pricing every ride at €0.00.
    await expect(build([]).forCategory(CITY_ID, 'standard')).rejects.toThrow(
      /No ride_tariffs row for city .* there is no fallback/,
    );
  });
});
