import { describe, expect, it } from 'vitest';
import {
  ACTIVE_DRIVER_RIDE_STATUSES,
  isInStatusSet,
  RIDER_NAME_VISIBLE_STATUSES,
  RIDER_PHONE_VISIBLE_STATUSES,
} from '../src/ride-state-machine';
import { driverRideSchema } from '../src/schemas/ride';

const uuid = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
const otherUuid = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';

const ride = {
  id: uuid,
  orderId: otherUuid,
  status: 'arrived',
  riderId: uuid,
  driverId: otherUuid,
  paymentMethod: 'cash',
  request: {
    riderId: uuid,
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
  createdAt: '2026-08-03T10:00:00.000Z',
  updatedAt: '2026-08-03T10:00:00.000Z',
};

describe('driverRideSchema (#261)', () => {
  it('parses a ride carrying the rider block (expected)', () => {
    const parsed = driverRideSchema.parse({
      ...ride,
      rider: { displayName: 'Anna', phone: '+37120000003' },
    });
    expect(parsed.rider).toEqual({
      displayName: 'Anna',
      phone: '+37120000003',
    });
  });

  it('parses a withheld block and pins both windows literally (edge)', () => {
    const parsed = driverRideSchema.parse({
      ...ride,
      rider: { displayName: null, phone: null },
    });
    expect(parsed.rider).toEqual({ displayName: null, phone: null });
    // A later edit that widens either window must fail here.
    expect([...RIDER_PHONE_VISIBLE_STATUSES]).toEqual([
      'accepted',
      'arriving',
      'arrived',
    ]);
    expect([...RIDER_NAME_VISIBLE_STATUSES]).toEqual([
      'accepted',
      'arriving',
      'arrived',
      'in_progress',
    ]);
    expect(RIDER_NAME_VISIBLE_STATUSES).toBe(ACTIVE_DRIVER_RIDE_STATUSES);
    expect(isInStatusSet(RIDER_PHONE_VISIBLE_STATUSES, 'arrived')).toBe(true);
    expect(isInStatusSet(RIDER_PHONE_VISIBLE_STATUSES, 'in_progress')).toBe(
      false,
    );
  });

  it('rejects a body with no rider block, and a non-E.164 phone (failure)', () => {
    expect(() => driverRideSchema.parse(ride)).toThrow();
    expect(() =>
      driverRideSchema.parse({
        ...ride,
        rider: { displayName: null, phone: '20000003' },
      }),
    ).toThrow();
  });
});
