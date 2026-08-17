import {
  BOARD_LIVE_RIDE_STATUSES,
  type DispatchBoardEvent,
  type DispatchDriver,
} from '@taxi/shared';
import { describe, expect, it } from 'vitest';
import {
  assignErrorKey,
  assignVerb,
  driverWarning,
  filterRoster,
  pickupZoneOf,
  sortRoster,
  warningKey,
} from './assign-state';

const driver = (over: Partial<DispatchDriver>): DispatchDriver => ({
  driverId: 'd0000000-0000-4000-8000-000000000001',
  name: 'Jānis Ozols',
  phone: '+37129999001',
  status: 'online',
  vehiclePlate: 'AB-1234',
  zoneName: 'Centrs',
  activeRideId: null,
  ...over,
});

describe('assignVerb', () => {
  it('assigns a ride with no car and reassigns one that has a car (expected)', () => {
    expect(assignVerb('requested')).toBe('assign');
    expect(assignVerb('offered')).toBe('assign');
    expect(assignVerb('queued')).toBe('assign');
    expect(assignVerb('accepted')).toBe('reassign');
    expect(assignVerb('arriving')).toBe('reassign');
  });

  it('offers no verb once the driver has physically reached the ride (edge)', () => {
    // The api refuses these (RELEASABLE_STATUSES); showing a button that can
    // only 409 would be a worse version of the same answer.
    expect(assignVerb('arrived')).toBeNull();
    expect(assignVerb('in_progress')).toBeNull();
  });

  it('answers for EVERY board status — a new one must not fall through (failure)', () => {
    // The totality that `Record<BoardRideStatus, …>` buys, asserted at runtime
    // too: if the api adds a board status and this map is widened with the
    // wrong default, the build catches it — but this catches a bad default.
    for (const status of BOARD_LIVE_RIDE_STATUSES) {
      expect(['assign', 'reassign', null]).toContain(assignVerb(status));
    }
  });
});

describe('driverWarning', () => {
  it('is null for a free online driver — the ordinary override (expected)', () => {
    expect(driverWarning(driver({}))).toBeNull();
  });

  it('warns about an offline driver WITHOUT blocking them (edge)', () => {
    // S9-2: overriding onto an ineligible driver is the feature. This function
    // returns a warning, never a refusal — there is no "blocked" case to test.
    expect(driverWarning(driver({ status: 'offline' }))).toBe('offline');
    expect(warningKey('offline')).toBe('console.assign_offline_warning');
  });

  it('warns when the driver is pinned to another ride, by status OR by ride id (edge)', () => {
    expect(driverWarning(driver({ status: 'on_ride' }))).toBe('on_ride');
    // `drivers.status` is a derived cache; the ride id is the harder fact, so
    // either one alone is enough to raise the warning.
    expect(
      driverWarning(
        driver({
          status: 'online',
          activeRideId: 'ad000000-0000-4000-8000-000000000001',
        }),
      ),
    ).toBe('on_ride');
  });
});

describe('assignErrorKey', () => {
  it('maps the api codes to operator language (expected)', () => {
    expect(assignErrorKey('ride_not_assignable')).toBe(
      'console.assign_error_ride_not_assignable',
    );
    expect(assignErrorKey('ride_not_reassignable')).toBe(
      'console.assign_error_ride_not_reassignable',
    );
  });

  it('falls back to the generic message for an unknown code (failure)', () => {
    // A future api error must never render its raw identifier at Dina.
    expect(assignErrorKey('some_new_code')).toBe('console.assign_failed');
    expect(assignErrorKey(undefined)).toBe('console.assign_failed');
  });
});

describe('sortRoster', () => {
  it('ranks online over on_ride over offline (expected)', () => {
    const sorted = sortRoster(
      [
        driver({ driverId: 'd0000000-0000-4000-8000-00000000000a', name: 'C', status: 'offline' }),
        driver({ driverId: 'd0000000-0000-4000-8000-00000000000b', name: 'B', status: 'on_ride' }),
        driver({ driverId: 'd0000000-0000-4000-8000-00000000000c', name: 'A', status: 'online' }),
      ],
      null,
    );
    expect(sorted.map((d) => d.status)).toEqual([
      'online',
      'on_ride',
      'offline',
    ]);
  });

  it('puts the driver already in the pickup zone first within a rank (edge)', () => {
    const sorted = sortRoster(
      [
        driver({ driverId: 'd0000000-0000-4000-8000-00000000000a', name: 'Anna', zoneName: 'Purvciems' }),
        driver({ driverId: 'd0000000-0000-4000-8000-00000000000b', name: 'Zane', zoneName: 'Āgenskalns' }),
      ],
      'Āgenskalns',
    );
    expect(sorted.map((d) => d.name)).toEqual(['Zane', 'Anna']);
  });

  it('falls back to Latvian collation when nothing else separates them (edge)', () => {
    const sorted = sortRoster(
      [
        driver({ driverId: 'd0000000-0000-4000-8000-00000000000a', name: 'Zane' }),
        driver({ driverId: 'd0000000-0000-4000-8000-00000000000b', name: 'Āris' }),
      ],
      null,
    );
    expect(sorted.map((d) => d.name)).toEqual(['Āris', 'Zane']);
  });

  it('does not mutate its input (failure)', () => {
    const input = [
      driver({ driverId: 'd0000000-0000-4000-8000-00000000000a', name: 'Z' }),
      driver({ driverId: 'd0000000-0000-4000-8000-00000000000b', name: 'A' }),
    ];
    sortRoster(input, null);
    expect(input.map((d) => d.name)).toEqual(['Z', 'A']);
  });
});

describe('filterRoster', () => {
  it('matches on name, plate and phone — the three things a caller says (expected)', () => {
    const all = [
      driver({ name: 'Jānis Ozols', vehiclePlate: 'AB-1234', phone: '+37129999001' }),
      driver({
        driverId: 'd0000000-0000-4000-8000-000000000002',
        name: 'Māra Liepa',
        vehiclePlate: 'CD-5678',
        phone: '+37129999002',
      }),
    ];
    expect(filterRoster(all, 'māra')).toHaveLength(1);
    expect(filterRoster(all, 'cd-56')).toHaveLength(1);
    expect(filterRoster(all, '9001')).toHaveLength(1);
  });

  it('treats a blank query as "everything", not "nothing" (edge)', () => {
    const all = [driver({})];
    expect(filterRoster(all, '   ')).toHaveLength(1);
  });

  it('tolerates a driver with no plate (failure)', () => {
    const all = [driver({ vehiclePlate: null })];
    expect(() => filterRoster(all, 'ab')).not.toThrow();
    expect(filterRoster(all, 'ab')).toHaveLength(0);
  });
});

describe('pickupZoneOf', () => {
  const frame = (over: Partial<DispatchBoardEvent>): DispatchBoardEvent => ({
    cityId: '00000000-0000-4000-8000-000000000001',
    at: '2026-08-17T12:00:00.000Z',
    rides: [],
    drivers: [],
    ...over,
  });

  it('reads the zone off the driver currently on the ride (expected)', () => {
    const zone = pickupZoneOf(
      frame({
        rides: [
          {
            rideId: 'ad000000-0000-4000-8000-000000000001',
            status: 'accepted',
            pickup: { location: { lat: 56.9, lng: 24.1 }, address: 'Brīvības 1' },
            driverId: 'd0000000-0000-4000-8000-000000000001',
            driverName: 'Jānis',
            bookingChannel: 'app',
            requestedAt: '2026-08-17T11:59:00.000Z',
            unclaimedSeconds: 0,
          },
        ],
        drivers: [
          {
            driverId: 'd0000000-0000-4000-8000-000000000001',
            name: 'Jānis',
            phone: '+37129999001',
            location: { lat: 56.9, lng: 24.1 },
            lastSeenAt: '2026-08-17T11:59:30.000Z',
            zoneName: 'Centrs',
            status: 'on_ride',
          },
        ],
      }),
      'ad000000-0000-4000-8000-000000000001',
    );
    expect(zone).toBe('Centrs');
  });

  it('is null for an unassigned ride — there is no driver to read a zone from (edge)', () => {
    expect(
      pickupZoneOf(frame({}), 'ad000000-0000-4000-8000-000000000001'),
    ).toBeNull();
  });

  it('is null with no frame at all, rather than throwing (failure)', () => {
    expect(
      pickupZoneOf(null, 'ad000000-0000-4000-8000-000000000001'),
    ).toBeNull();
  });
});
