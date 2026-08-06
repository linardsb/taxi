import { describe, expect, it } from 'vitest';
import { polygonToEwkt } from '../src/postgis';

describe('polygonToEwkt', () => {
  it('closes the ring — last vertex repeats the first (expected)', () => {
    const ewkt = polygonToEwkt([
      { lat: 56.9, lng: 24.0 },
      { lat: 56.9, lng: 24.1 },
      { lat: 57.0, lng: 24.1 },
    ]);
    expect(ewkt).toBe(
      'SRID=4326;POLYGON((24 56.9, 24.1 56.9, 24.1 57, 24 56.9))',
    );
  });

  it('a degenerate repeated-point ring still emits ≥4 vertices (edge)', () => {
    const p = { lat: 56.9, lng: 24.0 };
    const ewkt = polygonToEwkt([p, p, p]);
    expect(ewkt.match(/24 56\.9/g)).toHaveLength(4);
  });

  it('throws on a ring with fewer than 3 vertices instead of emitting invalid EWKT (failure)', () => {
    expect(() => polygonToEwkt([])).toThrow(/≥3 vertices/);
    expect(() => polygonToEwkt([{ lat: 56.9, lng: 24.0 }])).toThrow(
      /≥3 vertices/,
    );
  });

  it('emits SRID 4326 and lng-before-lat — WKT axis order, not lat-lng (failure guard)', () => {
    const ewkt = polygonToEwkt([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
      { lat: 5, lng: 6 },
    ]);
    expect(ewkt.startsWith('SRID=4326;POLYGON((')).toBe(true);
    // lat 1 / lng 2 must serialize as "2 1" — swapping puts Rīga in the Indian Ocean.
    expect(ewkt).toContain('((2 1,');
  });
});
