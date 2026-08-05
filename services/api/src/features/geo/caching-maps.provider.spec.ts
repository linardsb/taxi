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

  it('throws on a corrupt cache entry rather than returning garbage (failure)', async () => {
    const { kv, maps } = build();
    // A cache entry is untrusted input like any other boundary. Casting instead
    // of parsing would feed `NaN` cents into a fare.
    await kv.setWithTtl(
      routeCacheKey(CENTRE, RIX),
      '{"distanceMeters":"nope"}',
      60,
    );

    await expect(maps.route(CENTRE, RIX)).rejects.toThrow();
  });
});
