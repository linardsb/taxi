import type { Db } from '@taxi/db';
import { PlatformConfigRepository } from './platform-config.repository';
import { PlatformConfigService } from './platform-config.service';

const CITY_ID = '00000000-0000-4000-8000-000000000001';

// Crosses an `as unknown as Db` boundary, so TypeScript says nothing about a
// missing field here — a config column added without a matching key fails at
// RUNTIME, inside `platformConfigSchema.parse`, in a spec that has nothing to do
// with the ticket that added it. Keep this row complete.
const row = (commissionPct: number) => ({
  id: '00000000-0000-4000-8000-000000000002',
  cityId: CITY_ID,
  commissionPct,
  driverDebtLimitCents: 5000,
  hourlyGuaranteeCents: null,
  weeklyGuaranteeCents: null,
  defaultDispatchMode: 'auto_match',
  offerTimeoutSeconds: 20,
  unclaimedAlertSeconds: 60,
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

const build = (rows: unknown[]) =>
  new PlatformConfigService(new PlatformConfigRepository(dbReturning(rows)));

describe('PlatformConfigService', () => {
  it('returns the city row parsed through the shared schema (expected)', async () => {
    const config = await build([row(15)]).forCity(CITY_ID);

    expect(config.commissionPct).toBe(15);
    expect(config.defaultDispatchMode).toBe('auto_match');
    expect(config.updatedAt).toBeInstanceOf(Date);
    // The only unit-level proof that the debt limit survives the read at all —
    // `forCity` uses a bare `.select()`, so nothing else would notice if the
    // column stopped arriving, and dispatch would silently block on `undefined`.
    expect(config.driverDebtLimitCents).toBe(5000);
  });

  it('carries a 0% commission through as 0, not as a falsy default (edge)', async () => {
    // The evidenced S6-7 pilot (Atis at 0% plus an hourly guarantee) and the
    // single most dangerous truthiness bug in the money path: anything that
    // treats 0 as "unset" and substitutes 15 silently charges a driver.
    const config = await build([row(0)]).forCity(CITY_ID);

    expect(config.commissionPct).toBe(0);
  });

  it('throws naming the seed when the city has no row (failure)', async () => {
    // No fallback percentage, ever — a missing row is a misconfiguration, and
    // a defaulted commission would be the constant this table exists to abolish.
    await expect(build([]).forCity(CITY_ID)).rejects.toThrow(
      /No platform_config row for city .* run the @taxi\/db seed/,
    );
  });
});
