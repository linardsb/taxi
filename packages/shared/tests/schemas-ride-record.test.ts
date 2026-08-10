import { describe, expect, it } from 'vitest';
import { splitFare } from '../src/commission';
import {
  assertRideAssignmentConsistent,
  assertRideSplitConsistent,
  isRideAssignmentConsistent,
  isRideSplitConsistent,
  rideAssignmentSchema,
  rideCreatedSchema,
  rideSchema,
} from '../src/schemas/ride';

const riga = { lat: 56.9496, lng: 24.1052 };
const uuid = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
const otherUuid = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';

const quote = {
  model: 'upfront_fixed',
  currency: 'EUR',
  totalCents: 2000,
  breakdown: { baseCents: 300, distanceCents: 1400, timeCents: 300 },
};

describe('rideAssignmentSchema', () => {
  const base = {
    rideId: uuid,
    driverId: otherUuid,
    assignedAt: '2026-08-03T10:00:05.000Z',
  };

  it('parses an auto-matched assignment with no dispatcher (expected)', () => {
    const parsed = rideAssignmentSchema.parse({
      ...base,
      source: 'auto_match',
    });
    expect(parsed.dispatcherId).toBeNull();
    expect(parsed.reason).toBeNull();
  });

  it('parses a dispatcher override with its audit trail (edge)', () => {
    const parsed = rideAssignmentSchema.parse({
      ...base,
      source: 'dispatcher',
      dispatcherId: uuid,
      reason: 'Rider called in; nearest driver was declining',
    });
    expect(parsed.dispatcherId).toBe(uuid);
  });

  it('rejects a dispatcher assignment without dispatcherId (failure — the audit rule)', () => {
    expect(
      rideAssignmentSchema.safeParse({ ...base, source: 'dispatcher' }).success,
    ).toBe(false);
  });
});

describe('rideSchema', () => {
  const base = {
    id: uuid,
    orderId: otherUuid,
    status: 'requested',
    riderId: uuid,
    driverId: null,
    paymentMethod: 'cash',
    request: {
      riderId: uuid,
      pickup: { location: riga, address: 'Brīvības iela 1, Rīga' },
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

  it('parses a fresh ride with assignment, split and geozone defaulting to null (expected)', () => {
    const parsed = rideSchema.parse(base);
    expect(parsed.assignment).toBeNull();
    expect(parsed.split).toBeNull();
    expect(parsed.geozoneId).toBeNull();
  });

  it('is consistent while unassigned, and stays composable (edge)', () => {
    expect(isRideAssignmentConsistent(rideSchema.parse(base))).toBe(true);
    // Locks in the Task 7 decision: `rideSchema` is a plain ZodObject, so #6 can
    // derive Drizzle insert shapes from it. This line stops typechecking if
    // anyone turns it into a ZodEffects with a `.refine()`.
    expect(() => rideSchema.omit({ id: true })).not.toThrow();
  });

  it('is split-consistent while quote or split is still null (edge — mid-ride)', () => {
    // A quote with no split is the legitimate in-flight state (#11 writes the
    // split at completion), so the predicate must not fire on it.
    expect(isRideSplitConsistent(rideSchema.parse(base))).toBe(true);
    expect(isRideSplitConsistent(rideSchema.parse({ ...base, quote }))).toBe(
      true,
    );
  });

  it('throws when the settled split drifts from the quote (failure)', () => {
    const ride = rideSchema.parse({
      ...base,
      status: 'completed',
      quote,
      split: splitFare(500, { pct: 15, source: 'platform_base' }),
    });
    expect(isRideSplitConsistent(ride)).toBe(false);
    expect(() => assertRideSplitConsistent(ride)).toThrow(
      /does not match quote.totalCents/,
    );
  });

  it('throws when assignment.driverId drifts from ride.driverId (failure)', () => {
    const ride = rideSchema.parse({
      ...base,
      status: 'accepted',
      driverId: uuid,
      assignment: {
        rideId: uuid,
        driverId: otherUuid, // drifted
        source: 'auto_match',
        assignedAt: '2026-08-03T10:00:05.000Z',
      },
    });
    expect(isRideAssignmentConsistent(ride)).toBe(false);
    expect(() => assertRideAssignmentConsistent(ride)).toThrow(
      /does not match assignment/,
    );
  });
});

describe('rideCreatedSchema', () => {
  const ride = {
    id: uuid,
    orderId: otherUuid,
    status: 'requested',
    riderId: uuid,
    driverId: null,
    paymentMethod: 'cash',
    request: {
      riderId: uuid,
      pickup: { location: riga, address: 'Brīvības iela 1, Rīga' },
      destination: {
        location: { lat: 56.9236, lng: 23.9711 },
        address: 'Lidosta RIX',
      },
      paymentMethod: 'cash',
    },
    quote,
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
  };

  it('parses a ride with its platform-base split (expected)', () => {
    const parsed = rideCreatedSchema.parse({
      ride,
      split: splitFare(quote.totalCents, { pct: 15, source: 'platform_base' }),
    });
    expect(parsed.ride.status).toBe('requested');
    // The preview split is NOT persisted on the ride — that field stays null
    // until #11 settles.
    expect(parsed.ride.split).toBeNull();
    expect(parsed.split.commissionSource).toBe('platform_base');
    expect(parsed.split.commissionCents + parsed.split.driverNetCents).toBe(
      quote.totalCents,
    );
  });

  it('requires the split — a created ride always carries its preview (failure)', () => {
    expect(rideCreatedSchema.safeParse({ ride }).success).toBe(false);
  });
});
