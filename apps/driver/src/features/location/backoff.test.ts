import { BACKOFF_CAP_MS, nextBackoffMs } from './backoff';

const noJitter = () => 0.5;

describe('nextBackoffMs', () => {
  it('doubles from 1 s and caps at 30 s (expected)', () => {
    expect([0, 1, 2, 3, 4, 5].map((a) => nextBackoffMs(a, noJitter))).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000,
    ]);
  });

  it('jitters within ±20 % of the base (edge)', () => {
    expect(nextBackoffMs(2, () => 0)).toBe(3200);
    expect(nextBackoffMs(2, () => 1)).toBe(4800);
    for (let i = 0; i < 50; i += 1) {
      const ms = nextBackoffMs(2);
      expect(ms).toBeGreaterThanOrEqual(3200);
      expect(ms).toBeLessThanOrEqual(4800);
    }
  });

  it('does not overflow on a long outage (failure)', () => {
    expect(nextBackoffMs(20, noJitter)).toBe(BACKOFF_CAP_MS);
    expect(nextBackoffMs(1e9, noJitter)).toBe(BACKOFF_CAP_MS);
    expect(nextBackoffMs(-3, noJitter)).toBe(1000);
  });
});
