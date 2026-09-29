import {
  driverRideSchema,
  RIDE_STATUSES,
  rideSchema,
  type Ride,
  type RideStatus,
} from '@taxi/shared';
import type { Logger } from '@nestjs/common';
import {
  readDriverRide,
  toDriverRide,
  type DriverRideReadDeps,
} from './driver-ride';

const RIDER_ID = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
const DRIVER_ID = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';
const PHONE = '+37120000003';

function ride(status: RideStatus): Ride {
  return rideSchema.parse({
    id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
    orderId: '3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f',
    status,
    riderId: RIDER_ID,
    driverId: DRIVER_ID,
    paymentMethod: 'cash',
    request: {
      riderId: RIDER_ID,
      pickup: {
        location: { lat: 56.9496, lng: 24.1052 },
        address: 'Brīvības iela 1, Rīga',
      },
      destination: {
        location: { lat: 56.9236, lng: 23.9711 },
        address: 'Lidosta RIX',
      },
      paymentMethod: 'cash',
    },
    quote: null,
    createdAt: '2026-09-23T10:00:00.000Z',
    updatedAt: '2026-09-23T10:00:00.000Z',
  });
}

const ANNA = { phone: PHONE, displayName: 'Anna' };

/** Run through the wire contract, so the projection is checked against it. */
function project(
  status: RideStatus,
  identity: { phone: string; displayName: string | null } | undefined,
) {
  return driverRideSchema.parse(toDriverRide(ride(status), identity)).rider;
}

const PHONE_WINDOW = new Set<RideStatus>(['accepted', 'arriving', 'arrived']);
const NAME_WINDOW = new Set<RideStatus>([...PHONE_WINDOW, 'in_progress']);

describe('toDriverRide (#261)', () => {
  it('covers all 14 statuses', () => {
    expect(RIDE_STATUSES).toHaveLength(14);
  });

  it.each(RIDE_STATUSES)('releases only inside the windows at %s', (status) => {
    expect(project(status, ANNA)).toEqual({
      displayName: NAME_WINDOW.has(status) ? 'Anna' : null,
      phone: PHONE_WINDOW.has(status) ? PHONE : null,
    });
  });

  it('gives both at arrived (expected)', () => {
    expect(project('arrived', ANNA)).toEqual({
      displayName: 'Anna',
      phone: PHONE,
    });
  });

  it('keeps the name and withholds the phone once in_progress (edge)', () => {
    expect(project('in_progress', ANNA)).toEqual({
      displayName: 'Anna',
      phone: null,
    });
  });

  it('normalises a blank or over-long stored name so the parse holds (edge)', () => {
    expect(project('arrived', { phone: PHONE, displayName: '   ' })).toEqual({
      displayName: null,
      phone: PHONE,
    });
    const long = project('arrived', {
      phone: PHONE,
      displayName: `  ${'a'.repeat(130)}  `,
    });
    expect(long.displayName).toBe('a'.repeat(120));
    expect(project('arrived', { phone: PHONE, displayName: null })).toEqual({
      displayName: null,
      phone: PHONE,
    });
  });

  it('gives both null with no identity row, and at completed (failure)', () => {
    expect(project('arrived', undefined)).toEqual({
      displayName: null,
      phone: null,
    });
    expect(project('completed', ANNA)).toEqual({
      displayName: null,
      phone: null,
    });
  });

  it('leaves the ride fields untouched', () => {
    const base = ride('arriving');
    const { rider, ...rest } = toDriverRide(base, undefined);
    expect(rider).toEqual({ displayName: null, phone: null });
    expect(rest).toEqual({
      ...base,
      announceRequestedAt: null,
      dispatcherNote: null,
    });
  });
});

describe('toDriverRide announceRequestedAt (#259)', () => {
  const AT = '2026-09-27T10:00:00.000Z';

  it('carries the last request at arrived (expected)', () => {
    const read = toDriverRide(ride('arrived'), ANNA, AT);
    expect(read.announceRequestedAt).toBe(AT);
    expect(driverRideSchema.parse(read).announceRequestedAt).toBe(AT);
  });

  it('is null off arrived, so a request never replays after start (edge)', () => {
    expect(
      toDriverRide(ride('in_progress'), ANNA, AT).announceRequestedAt,
    ).toBeNull();
    expect(
      toDriverRide(ride('arriving'), ANNA, AT).announceRequestedAt,
    ).toBeNull();
  });

  it('is null with no request — the default for complete() (failure)', () => {
    expect(toDriverRide(ride('arrived'), ANNA).announceRequestedAt).toBeNull();
  });
});

describe('toDriverRide dispatcherNote (#303)', () => {
  const NOTE = 'Ratiņkrēsls, zvanīt pie vārtiem';
  const NOTE_WINDOW = NAME_WINDOW;

  it.each(RIDE_STATUSES)(
    'carries the note only inside the window at %s',
    (status) => {
      expect(
        driverRideSchema.parse(toDriverRide(ride(status), ANNA, null, NOTE))
          .dispatcherNote,
      ).toBe(NOTE_WINDOW.has(status) ? NOTE : null);
    },
  );

  it('keeps a null note null inside the window (edge)', () => {
    expect(
      toDriverRide(ride('accepted'), ANNA, null, null).dispatcherNote,
    ).toBeNull();
  });
});

describe('readDriverRide replay leg (#259, PR #293 F2)', () => {
  function deps(
    status: RideStatus,
    lastRequestedAt: jest.Mock,
    dispatcherNote: string | null = null,
  ) {
    const warn = jest.fn();
    const d = {
      rides: {
        findWithQuote: jest.fn(() =>
          Promise.resolve({ ride: ride(status), dispatcherNote }),
        ),
      },
      lifecycle: { findRiderIdentity: jest.fn(() => Promise.resolve(ANNA)) },
      realtime: { joinRideRoom: jest.fn() },
      announce: { lastRequestedAt },
      logger: { warn } as unknown as Logger,
    } as unknown as DriverRideReadDeps;
    return { d, warn };
  }
  const RIDE_ID = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
  const down = () => jest.fn(() => Promise.reject(new Error('redis down')));

  it('does not touch the KV off arrived, so a Redis failure cannot fail it (edge)', async () => {
    const lastRequestedAt = down();
    const { d } = deps('accepted', lastRequestedAt);

    const read = await readDriverRide(d, DRIVER_ID, RIDE_ID);

    expect(read.status).toBe('accepted');
    expect(lastRequestedAt).not.toHaveBeenCalled();
  });

  it('still answers at arrived when the KV read fails, with no replay and a warn (failure)', async () => {
    const { d, warn } = deps('arrived', down());

    const read = await readDriverRide(d, DRIVER_ID, RIDE_ID);

    expect(read.announceRequestedAt).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ride.read.announce_replay_failed',
        rideId: RIDE_ID,
        reason: 'redis down',
      }),
    );
  });

  it('replays the request at arrived when the KV answers (expected)', async () => {
    const AT = '2026-09-27T10:00:00.000Z';
    const { d } = deps(
      'arrived',
      jest.fn(() => Promise.resolve(AT)),
    );

    expect(
      (await readDriverRide(d, DRIVER_ID, RIDE_ID)).announceRequestedAt,
    ).toBe(AT);
  });

  it('passes the stored note through at accepted (expected, #303)', async () => {
    const { d } = deps('accepted', down(), 'Ratiņkrēsls');

    expect((await readDriverRide(d, DRIVER_ID, RIDE_ID)).dispatcherNote).toBe(
      'Ratiņkrēsls',
    );
  });
});
