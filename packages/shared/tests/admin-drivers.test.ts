import { describe, expect, it } from 'vitest';
import {
  adminDriverUpdateSchema,
  adminVehicleUpdateSchema,
  driverApprovalUpdateSchema,
} from '../src/schemas/admin-drivers';

describe('adminDriverUpdateSchema (#20)', () => {
  it('accepts a commission override and a display name (expected)', () => {
    expect(
      adminDriverUpdateSchema.parse({
        commissionPctOverride: 0,
        displayName: '  Anna ',
      }),
    ).toEqual({ commissionPctOverride: 0, displayName: 'Anna' });
  });

  it('keeps an explicit null override, distinct from absent (edge — null clears it)', () => {
    const parsed = adminDriverUpdateSchema.parse({
      commissionPctOverride: null,
    });
    expect(parsed).toHaveProperty('commissionPctOverride', null);
    expect(
      adminDriverUpdateSchema.parse({ isFemale: true }),
    ).not.toHaveProperty('commissionPctOverride');
  });

  it('rejects an empty patch and an out-of-range override (failure)', () => {
    expect(adminDriverUpdateSchema.safeParse({}).success).toBe(false);
    expect(
      adminDriverUpdateSchema.safeParse({ commissionPctOverride: 101 }).success,
    ).toBe(false);
  });
});

describe('adminVehicleUpdateSchema (#20)', () => {
  it('accepts a category-only patch (expected — the pricing tier is admin-set)', () => {
    expect(adminVehicleUpdateSchema.parse({ category: 'limo' })).toEqual({
      category: 'limo',
    });
  });

  it('strips id and driverId, then refuses the empty remainder (failure)', () => {
    expect(
      adminVehicleUpdateSchema.safeParse({
        id: '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
        driverId: '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
      }).success,
    ).toBe(false);
  });
});

describe('driverApprovalUpdateSchema (#20)', () => {
  it('refuses a status outside the three (failure)', () => {
    expect(
      driverApprovalUpdateSchema.safeParse({ status: 'vetted' }).success,
    ).toBe(false);
  });
});
