import { describe, expect, it } from 'vitest';
import {
  centsSchema,
  commissionCentsFor,
  commissionPctSchema,
  formatEur,
  nonNegativeCentsSchema,
  nonPositiveCentsSchema,
} from '../src/money';

describe('formatEur (#15)', () => {
  it('formats whole and fractional euros, symbol first (expected)', () => {
    expect(formatEur(1240)).toBe('€12.40');
    expect(formatEur(8420)).toBe('€84.20');
  });

  it('pads single-digit cents and zero (edge)', () => {
    expect(formatEur(5)).toBe('€0.05');
    expect(formatEur(0)).toBe('€0.00');
  });

  it('keeps the sign in front of the symbol and truncates a float (failure)', () => {
    expect(formatEur(-186)).toBe('-€1.86');
    expect(formatEur(12.9)).toBe('€0.12');
  });
});

describe('cent primitives', () => {
  it('parses whole cents, signed and unsigned (expected)', () => {
    expect(nonNegativeCentsSchema.parse(1250)).toBe(1250);
    expect(centsSchema.parse(-500)).toBe(-500); // ledger / negative driver balance
    expect(nonPositiveCentsSchema.parse(-250)).toBe(-250); // shared-ride discount
  });

  it('handles the zero cases without dividing by anything (edge)', () => {
    expect(commissionCentsFor(0, 15)).toBe(0);
    expect(commissionCentsFor(1000, 0)).toBe(0);
  });

  it('rejects floats and out-of-range values (failure)', () => {
    expect(nonNegativeCentsSchema.safeParse(-1).success).toBe(false);
    // Floats are the rule this module exists to enforce.
    expect(centsSchema.safeParse(12.5).success).toBe(false);
    expect(commissionPctSchema.safeParse(101).success).toBe(false);
    expect(commissionPctSchema.safeParse(-1).success).toBe(false);
  });
});
