import { describe, expect, it } from 'vitest';
import { platformConfigSchema } from '../src/schemas/platform-config';

const base = {
  id: '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
  cityId: '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  updatedAt: '2026-08-03T09:00:00.000Z',
};

describe('platformConfigSchema', () => {
  it('applies the dispatch defaults around a supplied commission (expected)', () => {
    const parsed = platformConfigSchema.parse({ ...base, commissionPct: 15 });
    expect(parsed.commissionPct).toBe(15);
    expect(parsed.hourlyGuaranteeCents).toBeNull();
    expect(parsed.weeklyGuaranteeCents).toBeNull();
    expect(parsed.defaultDispatchMode).toBe('auto_match');
    expect(parsed.offerTimeoutSeconds).toBe(20);
    expect(parsed.unclaimedAlertSeconds).toBe(60);
    expect(parsed.updatedAt).toBeInstanceOf(Date);
  });

  it('accepts a 0% commission — the S6-7 pilot scenario (edge)', () => {
    expect(
      platformConfigSchema.parse({ ...base, commissionPct: 0 }).commissionPct,
    ).toBe(0);
  });

  it('rejects an empty object (failure)', () => {
    expect(platformConfigSchema.safeParse({}).success).toBe(false);
  });

  it('requires commissionPct — config, not constant (failure)', () => {
    // If this test ever needs changing, someone has turned the commission back
    // into a constant. `commissionPct` must carry NO zod default, so every
    // caller is forced to read a real config row.
    const result = platformConfigSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.path.includes('commissionPct'),
        ),
      ).toBe(true);
    }
  });
});
