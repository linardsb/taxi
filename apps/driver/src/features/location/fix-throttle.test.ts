import {
  MIN_FIX_INTERVAL_MS,
  normaliseHeading,
  selectFixes,
} from './fix-throttle';

const T0 = 1_800_000_000_000;
const raw = (
  offsetMs: number,
  over: Partial<{ lat: number; lng: number; heading: number | null }> = {},
) => ({
  timestamp: T0 + offsetMs,
  coords: {
    latitude: over.lat ?? 56.95,
    longitude: over.lng ?? 24.1,
    heading: over.heading ?? null,
  },
});

describe('selectFixes', () => {
  it('keeps one fix per 4 s from a 1 Hz burst — 0, 4, 8 s (expected)', () => {
    const burst = Array.from({ length: 10 }, (_, i) => raw(i * 1000));

    const { fixes, lastTs } = selectFixes(burst, null);

    expect(fixes.map((f) => f.at)).toEqual([
      new Date(T0).toISOString(),
      new Date(T0 + 4000).toISOString(),
      new Date(T0 + 8000).toISOString(),
    ]);
    expect(lastTs).toBe(T0 + 8000);
    expect(MIN_FIX_INTERVAL_MS).toBe(4000);
  });

  it('yields nothing for a batch older than what was already enqueued (edge — OS replay)', () => {
    const { fixes, lastTs } = selectFixes([raw(0), raw(1000)], T0 + 20_000);

    expect(fixes).toEqual([]);
    expect(lastTs).toBe(T0 + 20_000);
  });

  it('sorts an out-of-order batch and drops non-finite coordinates (failure)', () => {
    const { fixes } = selectFixes(
      [raw(8000), raw(0, { lat: Number.NaN }), raw(4000, { heading: 725 })],
      null,
    );

    expect(fixes.map((f) => f.at)).toEqual([
      new Date(T0 + 4000).toISOString(),
      new Date(T0 + 8000).toISOString(),
    ]);
    expect(fixes[0]!.heading).toBe(5); // 725 mod 360
  });
});

describe('normaliseHeading', () => {
  it('maps unknown (-1/null) to null and wraps into [0, 360)', () => {
    expect(normaliseHeading(-1)).toBeNull();
    expect(normaliseHeading(null)).toBeNull();
    expect(normaliseHeading(undefined)).toBeNull();
    expect(normaliseHeading(360)).toBe(0);
    expect(normaliseHeading(359.5)).toBe(359.5);
  });
});
