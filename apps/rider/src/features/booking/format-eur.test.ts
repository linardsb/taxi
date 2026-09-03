import { formatEur } from './format-eur';

describe('formatEur', () => {
  it('formats whole and fractional euros (expected)', () => {
    expect(formatEur(8420)).toBe('€84.20');
    expect(formatEur(1734)).toBe('€17.34');
  });

  it('pads a zero and single-digit cents (edge)', () => {
    expect(formatEur(0)).toBe('€0.00');
    expect(formatEur(5)).toBe('€0.05');
    expect(formatEur(100)).toBe('€1.00');
  });

  it('keeps the sign in front of the symbol and never floats (failure)', () => {
    expect(formatEur(-186)).toBe('-€1.86');
    expect(formatEur(12.9)).toBe('€0.12'); // a float is truncated, never rounded into money
  });
});
