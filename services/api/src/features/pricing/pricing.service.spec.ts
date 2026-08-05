import type {
  FareQuote,
  MapsProvider,
  PlatformConfig,
  PricingStrategy,
  RideRequest,
} from '@taxi/shared';
import type { Env } from '../../common/config/env.schema';
import type { PlatformConfigService } from '../platform-config';
import { PricingService } from './pricing.service';

const CITY_ID = '00000000-0000-4000-8000-000000000001';
const RIGA = { lat: 56.9496, lng: 24.1052 };
const RIX = { lat: 56.9236, lng: 23.9711 };

const request = {
  pickup: { location: RIGA, address: 'Brīvības iela 1, Rīga' },
  destination: { location: RIX, address: 'Lidosta RIX' },
  stops: [],
  category: 'standard',
} as unknown as RideRequest;

const quote = (totalCents: number): FareQuote => ({
  model: 'upfront_fixed',
  currency: 'EUR',
  totalCents,
  breakdown: {
    baseCents: totalCents,
    distanceCents: 0,
    timeCents: 0,
    discountCents: 0,
  },
});

function build(options: { commissionPct?: number; quote?: FareQuote } = {}): {
  service: PricingService;
  routeCalls: () => number;
} {
  let routeCalls = 0;

  const maps = {
    route: () => {
      routeCalls += 1;
      return Promise.resolve({
        distanceMeters: 10_000,
        durationSeconds: 1_200,
        polyline: '',
      });
    },
  } as unknown as MapsProvider;

  const strategy = {
    model: 'upfront_fixed',
    quote: () => Promise.resolve(options.quote ?? quote(1_300)),
  } as unknown as PricingStrategy;

  const platformConfig = {
    forCity: () =>
      Promise.resolve({
        commissionPct: options.commissionPct ?? 15,
      } as PlatformConfig),
  } as unknown as PlatformConfigService;

  return {
    service: new PricingService(maps, strategy, platformConfig, {
      DEFAULT_CITY_ID: CITY_ID,
    } as Env),
    routeCalls: () => routeCalls,
  };
}

describe('PricingService', () => {
  it('derives the split from the config row with no cent leaking (expected)', async () => {
    const { service, routeCalls } = build();

    const { quote: fare, split } = await service.quote(request);

    expect(routeCalls()).toBe(1);
    expect(split.commissionPct).toBe(15);
    expect(split.commissionSource).toBe('platform_base');
    expect(split.totalCents).toBe(fare.totalCents);
    expect(split.commissionCents + split.driverNetCents).toBe(fare.totalCents);
    expect(split.commissionCents).toBe(195); // 15% of 1300
  });

  it('follows a changed config row with no code change (edge)', async () => {
    // This test exists to catch a regression to a constant: if it ever needs a
    // CODE edit to pass, someone has hardcoded the commission again. Only the
    // config row moves here.
    const { service } = build({ commissionPct: 12 });

    const { split } = await service.quote(request);

    expect(split.commissionPct).toBe(12);
    expect(split.commissionCents).toBe(156); // 12% of 1300
    expect(split.commissionCents + split.driverNetCents).toBe(1_300);
  });

  it('carries a 0% commission through to a full driver net (edge)', async () => {
    const { service } = build({ commissionPct: 0 });

    const { split } = await service.quote(request);

    expect(split.commissionCents).toBe(0);
    expect(split.driverNetCents).toBe(1_300);
  });

  it('throws when a rogue strategy returns an inconsistent quote (failure)', async () => {
    const inconsistent: FareQuote = {
      model: 'upfront_fixed',
      currency: 'EUR',
      totalCents: 2_000,
      breakdown: {
        baseCents: 100,
        distanceCents: 100,
        timeCents: 100,
        discountCents: 0,
      },
    };
    const { service } = build({ quote: inconsistent });

    await expect(service.quote(request)).rejects.toThrow(
      /does not sum to totalCents/,
    );
  });
});
