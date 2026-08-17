import { describe, expect, it } from 'vitest';
import {
  dispatchRosterSchema,
  forceAssignBodySchema,
  reassignBodySchema,
} from '../src/schemas/dispatch';

const DRIVER_ID = 'd0000000-0000-4000-8000-000000000001';
const RIDE_ID = 'ad000000-0000-4000-8000-000000000001';

describe('forceAssignBodySchema', () => {
  it('defaults the reason to null so the audit row always has the column (expected)', () => {
    expect(forceAssignBodySchema.parse({ driverId: DRIVER_ID })).toEqual({
      driverId: DRIVER_ID,
      reason: null,
    });
  });

  it('accepts a reason at exactly the audit limit (edge)', () => {
    const reason = 'x'.repeat(280);
    expect(
      forceAssignBodySchema.parse({ driverId: DRIVER_ID, reason }).reason,
    ).toBe(reason);
  });

  it('rejects a reason one character over the limit (failure)', () => {
    expect(
      forceAssignBodySchema.safeParse({
        driverId: DRIVER_ID,
        reason: 'x'.repeat(281),
      }).success,
    ).toBe(false);
  });

  it('carries no dispatcherId field — a body-supplied one would forge the S9-2 audit trail', () => {
    const parsed = forceAssignBodySchema.parse({
      driverId: DRIVER_ID,
      dispatcherId: '00000000-0000-4000-8000-0000000000ff',
    });
    expect(parsed).not.toHaveProperty('dispatcherId');
  });
});

describe('reassignBodySchema', () => {
  it('parses the same shape as force-assign but is a distinct schema (expected)', () => {
    expect(reassignBodySchema.parse({ driverId: DRIVER_ID })).toEqual({
      driverId: DRIVER_ID,
      reason: null,
    });
    // Distinct object identity is the point: the two routes can diverge, and a
    // shared alias would let a call site post to the wrong one and typecheck.
    expect(reassignBodySchema).not.toBe(forceAssignBodySchema);
  });
});

describe('dispatchRosterSchema', () => {
  const driver = {
    driverId: DRIVER_ID,
    name: 'Jānis Ozols',
    phone: '+37129999001',
    status: 'offline' as const,
    vehiclePlate: 'AB-1234',
    zoneName: null,
    activeRideId: null,
  };

  it('accepts an OFFLINE driver with no zone — the whole reason this read exists (expected)', () => {
    const parsed = dispatchRosterSchema.parse({
      at: '2026-08-17T12:00:00.000Z',
      drivers: [driver],
    });
    expect(parsed.drivers[0]?.status).toBe('offline');
    expect(parsed.drivers[0]?.zoneName).toBeNull();
  });

  it('carries the ride pinning a driver, so the picker can warn before stealing a car (edge)', () => {
    const parsed = dispatchRosterSchema.parse({
      at: '2026-08-17T12:00:00.000Z',
      drivers: [{ ...driver, status: 'on_ride', activeRideId: RIDE_ID }],
    });
    expect(parsed.drivers[0]?.activeRideId).toBe(RIDE_ID);
  });

  it('rejects a non-ISO timestamp — the wire carries strings, never Dates (failure)', () => {
    expect(
      dispatchRosterSchema.safeParse({ at: 'now', drivers: [] }).success,
    ).toBe(false);
  });
});
