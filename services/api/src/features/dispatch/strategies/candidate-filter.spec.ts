import { rideRequestSchema, type RideRequest } from '@taxi/shared';
import type { DriverMatchAttributes, NearbyDriver } from '../../drivers';
import { DISPATCH_AVG_SPEED_MPS } from '../dispatch.policy';
import { toCandidates } from './candidate-filter';

const RIDER_ID = '5a5a5a5a-1111-4222-8333-444444444444';
const id = (n: number) => `d0000000-0000-4000-8000-00000000000${n}`;

/**
 * The seeded pilot value (`platform_config.driver_debt_limit_cents`, €50), used
 * as a fixture rather than imported: the point of the parameter is that the
 * filter takes whatever the config row says, and the boundary cases below pass
 * their own.
 */
const DEBT_LIMIT = 5000;

const request = (over: Partial<RideRequest> = {}): RideRequest =>
  rideRequestSchema.parse({
    riderId: RIDER_ID,
    pickup: { location: { lat: 56.9512, lng: 24.1136 }, address: 'Brīvības 1' },
    destination: { location: { lat: 56.9236, lng: 23.9711 }, address: 'RIX' },
    paymentMethod: 'cash',
    ...over,
  });

const nearby = (n: number, distanceMeters: number): NearbyDriver => ({
  driverId: id(n),
  location: { lat: 56.95, lng: 24.11 },
  distanceMeters,
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

describe('toCandidates', () => {
  it('keeps eligible drivers in nearest-first order with derived ETAs (expected)', () => {
    const list = [nearby(1, 500), nearby(2, 1_000), nearby(3, 2_000)];
    const found = toCandidates(
      list,
      [
        attrs(1),
        attrs(2, { status: 'offline' }), // presence says near, Postgres says gone
        attrs(3),
      ],
      request(),
      DEBT_LIMIT,
    );

    expect(found.map((c) => c.driverId)).toEqual([id(1), id(3)]);
    expect(found[0]!.etaSeconds).toBe(Math.round(500 / DISPATCH_AVG_SPEED_MPS));
    expect(found[1]!.etaSeconds).toBe(
      Math.round(2_000 / DISPATCH_AVG_SPEED_MPS),
    );
    // Proximity order is the store's; the filter must not re-sort.
    expect(found[0]!.etaSeconds).toBeLessThan(found[1]!.etaSeconds);
  });

  it('excludes isFemale false AND null when femaleDriver is asked for (edge)', () => {
    const list = [nearby(1, 100), nearby(2, 200), nearby(3, 300)];
    const found = toCandidates(
      list,
      [
        attrs(1, { isFemale: false }),
        attrs(2, { isFemale: null }), // "not stated" is not a yes
        attrs(3, { isFemale: true }),
      ],
      request({ options: { childSeat: false, femaleDriver: true } }),
      DEBT_LIMIT,
    );

    expect(found.map((c) => c.driverId)).toEqual([id(3)]);
  });

  it('drops a nearby driver with no attributes row rather than crashing (edge)', () => {
    const found = toCandidates(
      [nearby(1, 100), nearby(2, 200)],
      [attrs(2)], // driver 1 is in Redis but has no Postgres row
      request(),
      DEBT_LIMIT,
    );

    expect(found.map((c) => c.driverId)).toEqual([id(2)]);
  });

  it('yields nothing when childSeat is required and no vehicle has one (failure)', () => {
    const found = toCandidates(
      [nearby(1, 100), nearby(2, 200)],
      [attrs(1), attrs(2)],
      request({ options: { childSeat: true, femaleDriver: false } }),
      DEBT_LIMIT,
    );

    expect(found).toEqual([]);
  });

  it('excludes a driver whose category or balance disqualifies them (failure)', () => {
    const found = toCandidates(
      [nearby(1, 100), nearby(2, 200), nearby(3, 300)],
      [
        attrs(1, { categories: ['vip'] }), // not the requested tier
        attrs(2, { balanceCents: -5_001 }), // owes MORE than the limit allows
        attrs(3),
      ],
      request(),
      DEBT_LIMIT,
    );

    expect(found.map((c) => c.driverId)).toEqual([id(3)]);
  });

  it('keeps a driver carrying cash-ride debt inside the limit (expected)', () => {
    // THE REASON THIS PARAMETER EXISTS. Every cash ride debits commission
    // (#12), so a working cash-only driver is permanently negative. At the old
    // `< 0` rule this driver — 33 ordinary €10 cash rides in — was invisible to
    // dispatch forever.
    const found = toCandidates(
      [nearby(1, 100)],
      [attrs(1, { balanceCents: -4_999 })],
      request(),
      DEBT_LIMIT,
    );

    expect(found.map((c) => c.driverId)).toEqual([id(1)]);
  });

  it('treats the limit itself as still eligible — the block is `< -limit` (edge)', () => {
    const found = toCandidates(
      [nearby(1, 100), nearby(2, 200)],
      [
        attrs(1, { balanceCents: -DEBT_LIMIT }), // exactly at the limit: in
        attrs(2, { balanceCents: -DEBT_LIMIT - 1 }), // one cent past it: out
      ],
      request(),
      DEBT_LIMIT,
    );

    expect(found.map((c) => c.driverId)).toEqual([id(1)]);
  });

  it('reproduces the old zero-tolerance rule when the limit is 0 (edge)', () => {
    // The pre-#12 behaviour is still expressible through config alone, which is
    // what makes the limit a knob (#20 edits it) rather than a rewrite.
    const found = toCandidates(
      [nearby(1, 100), nearby(2, 200)],
      [attrs(1, { balanceCents: 0 }), attrs(2, { balanceCents: -1 })],
      request(),
      0,
    );

    expect(found.map((c) => c.driverId)).toEqual([id(1)]);
  });
});
