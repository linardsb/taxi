import {
  rideRequestSchema,
  type DispatchContext,
  type RideRequest,
} from '@taxi/shared';
import type {
  DriversService,
  DriverLocationService,
  DriverMatchAttributes,
  NearbyDriver,
} from '../../drivers';
import { AutoMatchStrategy } from './auto-match.strategy';

const RIDER_ID = '5a5a5a5a-1111-4222-8333-444444444444';
const id = (n: number) => `d0000000-0000-4000-8000-00000000000${n}`;

/**
 * Proximity mode ignores `geozoneId` but not `driverDebtLimitCents` — the
 * eligibility filter is shared with the queue strategy, so the limit has to
 * reach it identically under both modes (#12). Boundary cases live in
 * `candidate-filter.spec.ts`; here the limit only has to be present and generous.
 */
const CTX: DispatchContext = {
  geozoneId: null,
  cityId: '00000000-0000-4000-8000-000000000001',
  driverDebtLimitCents: 5000,
};

const request = (over: Partial<RideRequest> = {}): RideRequest =>
  rideRequestSchema.parse({
    riderId: RIDER_ID,
    pickup: { location: { lat: 56.9512, lng: 24.1136 }, address: 'Brīvības 1' },
    destination: { location: { lat: 56.9236, lng: 23.9711 }, address: 'RIX' },
    paymentMethod: 'cash',
    ...over,
  });

const attrs = (
  n: number,
  over: Partial<DriverMatchAttributes> = {},
): DriverMatchAttributes => ({
  driverId: id(n),
  status: 'online',
  isFemale: null,
  balanceCents: 0,
  commissionPctOverride: null,
  categories: ['standard'],
  hasChildSeat: false,
  maxPassengerSeats: 4,
  ...over,
});

function build(nearby: NearbyDriver[], matchAttrs: DriverMatchAttributes[]) {
  const findNearest = jest.fn(() => Promise.resolve(nearby));
  const findMatchAttributes = jest.fn(() => Promise.resolve(matchAttrs));

  const strategy = new AutoMatchStrategy(
    { findNearest } as unknown as DriverLocationService,
    { findMatchAttributes } as unknown as DriversService,
  );

  return { strategy, findNearest, findMatchAttributes };
}

describe('AutoMatchStrategy', () => {
  it('declares the auto_match mode', () => {
    expect(build([], []).strategy.mode).toBe('auto_match');
  });

  it('returns eligible drivers in the order the store gave them (expected)', async () => {
    const nearby = [
      {
        driverId: id(1),
        location: { lat: 56.95, lng: 24.11 },
        distanceMeters: 400,
      },
      {
        driverId: id(2),
        location: { lat: 56.96, lng: 24.12 },
        distanceMeters: 900,
      },
    ];
    const { strategy } = build(nearby, [attrs(1), attrs(2)]);

    const found = await strategy.findCandidates(request(), CTX);

    // `findNearest` is already nearest-first; re-sorting is the bug this asserts
    // against.
    expect(found.map((c) => c.driverId)).toEqual([id(1), id(2)]);
    expect(found[0]!.etaSeconds).toBeLessThan(found[1]!.etaSeconds);
    // Proximity mode never ranks by a queue.
    expect(found.every((c) => c.queuePosition === undefined)).toBe(true);
  });

  it('skips the attributes round trip when nobody is nearby (edge)', async () => {
    const { strategy, findMatchAttributes } = build([], [attrs(1)]);

    await expect(strategy.findCandidates(request(), CTX)).resolves.toEqual([]);
    // The round trip is on the tick loop, once per awaiting ride per second.
    expect(findMatchAttributes).not.toHaveBeenCalled();
  });

  it('returns nothing when every nearby driver is ineligible (failure)', async () => {
    const nearby = [
      {
        driverId: id(1),
        location: { lat: 56.95, lng: 24.11 },
        distanceMeters: 400,
      },
    ];
    const { strategy } = build(nearby, [attrs(1, { status: 'offline' })]);

    await expect(strategy.findCandidates(request(), CTX)).resolves.toEqual([]);
  });
});
