import type { LatLng, MapsProvider, RouteResult } from '@taxi/shared';
import { InMemoryKeyValueStore } from '../../../test/harness';
import { CachingMapsProvider, routeCacheKey } from './caching-maps.provider';
import { StubMapsProvider } from './stub-maps.provider';

const CENTRE = { lat: 56.9496, lng: 24.1052 };
const RIX = { lat: 56.9236, lng: 23.9711 };
const TEIKA = { lat: 56.97, lng: 24.18 };

/** Records what a real (paid) provider would have been asked to do. */
class CountingProvider implements MapsProvider {
  routeCalls = 0;
  private readonly inner = new StubMapsProvider();

  route(from: LatLng, to: LatLng, stops?: LatLng[]): Promise<RouteResult> {
    this.routeCalls += 1;
    return this.inner.route(from, to, stops);
  }

  geocode = jest.fn();
  reverseGeocode = jest.fn();
}

describe('CachingMapsProvider', () => {
  const build = () => {
    const kv = new InMemoryKeyValueStore();
    const source = new CountingProvider();
    return { kv, source, maps: new CachingMapsProvider(source, kv, 3600) };
  };

  it('delegates the first call and writes the cache key (expected)', async () => {
    const { kv, source, maps } = build();

    const route = await maps.route(CENTRE, RIX);

    expect(source.routeCalls).toBe(1);
    expect(route.distanceMeters).toBeGreaterThan(0);
    expect(await kv.get(routeCacheKey(CENTRE, RIX))).toBe(
      JSON.stringify(route),
    );
  });

  it('serves a repeated route from cache and still delegates a different one (edge)', async () => {
    // This is the <€100/mo guardrail: an uncached Routes call per request is
    // how the budget becomes a €400 bill. The different-route leg matters —
    // without it a cache key that collapses every route to one entry passes.
    const { source, maps } = build();

    const first = await maps.route(CENTRE, RIX);
    const second = await maps.route(CENTRE, RIX);

    expect(source.routeCalls).toBe(1);
    expect(second).toEqual(first);

    await maps.route(CENTRE, TEIKA);
    expect(source.routeCalls).toBe(2);
  });

  it('treats stops as part of the cache identity (edge)', async () => {
    const { source, maps } = build();

    await maps.route(CENTRE, RIX);
    await maps.route(CENTRE, RIX, [TEIKA]);

    expect(source.routeCalls).toBe(2);
  });

  it('drops a corrupt cache entry and re-routes rather than returning garbage (failure)', async () => {
    const { kv, source, maps } = build();
    // A cache entry is untrusted input like any other boundary — casting
    // instead of parsing would feed `NaN` cents into a fare. Rejecting it is
    // not enough on its own, though: throwing pinned the corridor to a 500
    // until the TTL expired, so the entry is dropped and re-fetched instead.
    await kv.setWithTtl(
      routeCacheKey(CENTRE, RIX),
      '{"distanceMeters":"nope"}',
      60,
    );

    const route = await maps.route(CENTRE, RIX);

    expect(source.routeCalls).toBe(1);
    expect(route.distanceMeters).toBeGreaterThan(0);
    expect(await kv.get(routeCacheKey(CENTRE, RIX))).toBe(
      JSON.stringify(route),
    );
  });

  it('recovers from cache bytes JSON.parse cannot read (failure)', async () => {
    const { kv, source, maps } = build();
    await kv.setWithTtl(routeCacheKey(CENTRE, RIX), 'not json at all', 60);

    const route = await maps.route(CENTRE, RIX);

    expect(source.routeCalls).toBe(1);
    expect(route.distanceMeters).toBeGreaterThan(0);
  });

  it('refuses to cache a result that breaks the seam contract (failure)', async () => {
    // Fractional metres are what a real Routes response produces. Written
    // unparsed, they served the first caller and threw for every one after,
    // for the whole 24h TTL — so the write is parsed and nothing is stored.
    const kv = new InMemoryKeyValueStore();
    const fractional: MapsProvider = {
      route: () =>
        Promise.resolve({
          distanceMeters: 10234.5,
          durationSeconds: 1187.4,
          polyline: 'abc',
        }),
      geocode: jest.fn(),
      reverseGeocode: jest.fn(),
    };
    const maps = new CachingMapsProvider(fractional, kv, 3600);

    await expect(maps.route(CENTRE, RIX)).rejects.toThrow();
    expect(await kv.get(routeCacheKey(CENTRE, RIX))).toBeNull();
  });
});
