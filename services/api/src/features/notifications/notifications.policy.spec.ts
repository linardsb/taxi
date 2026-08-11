import type { RouteResult } from '@taxi/shared';
import {
  etaMinutesFromRoute,
  quantizeForEtaCache,
} from './notifications.policy';

/** Only `durationSeconds` matters here; the other two are shape. */
const route = (durationSeconds: number): RouteResult => ({
  distanceMeters: 0,
  durationSeconds,
  polyline: '',
});

describe('quantizeForEtaCache', () => {
  it('snaps a raw GPS fix onto the ~100 m grid (expected)', () => {
    expect(quantizeForEtaCache({ lat: 56.9612349, lng: 24.0857 })).toEqual({
      lat: 56.961,
      lng: 24.086,
    });
  });

  it('leaves a point already on the grid alone (edge)', () => {
    expect(quantizeForEtaCache({ lat: 56.961, lng: 24.086 })).toEqual({
      lat: 56.961,
      lng: 24.086,
    });
  });

  it('collapses two fixes ~20 m apart onto one point (edge — the property the cache rides on)', () => {
    // Same cell → identical `routeCacheKey` text → one paid call for both,
    // which is the entire reason this function exists. A grid finer than
    // `COORD_PRECISION = 4` would make this two calls.
    const before = quantizeForEtaCache({ lat: 56.96121, lng: 24.0857 });
    const after = quantizeForEtaCache({ lat: 56.96139, lng: 24.0857 });

    expect(after).toEqual(before);
  });
});

describe('etaMinutesFromRoute', () => {
  it('converts a routed duration to whole minutes (expected)', () => {
    expect(etaMinutesFromRoute(route(300))).toBe(5);
  });

  it('rounds a part-minute UP — the rider waits the whole minute (edge)', () => {
    expect(etaMinutesFromRoute(route(90))).toBe(2);
  });

  it('never answers 0 min, however close the car is (failure)', () => {
    // "arriving in ~0 min" reads as a bug to the person at the kerb.
    expect(etaMinutesFromRoute(route(0))).toBe(1);
  });
});
