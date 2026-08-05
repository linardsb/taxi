import type {
  GeocodeResult,
  Language,
  LatLng,
  MapsProvider,
  RouteResult,
} from '@taxi/shared';
import { z } from 'zod';
import type { KeyValueStore } from '../../common/kv/kv.store';

/**
 * ~11 m. The hit-rate/accuracy knob: 3 decimals (~111 m) would raise the hit
 * rate and cost a few cents of fare accuracy. Real hit rates are unmeasurable
 * until there is traffic — revisit when the first Google bill exists.
 */
const COORD_PRECISION = 4;

/**
 * The `v1` segment is deliberate: a change to `RouteResult`'s shape bumps it
 * rather than poisoning live cache entries mid-deploy.
 *
 * Coordinates are rounded to fixed text, never `JSON.stringify`ed — the float
 * text is not rounded, so `24.1` and `24.100000000000001` would otherwise be
 * two different cache entries for the same corner.
 */
export function routeCacheKey(
  from: LatLng,
  to: LatLng,
  stops: LatLng[] = [],
): string {
  const points = [from, ...stops, to]
    .map(
      (p) =>
        `${p.lat.toFixed(COORD_PRECISION)},${p.lng.toFixed(COORD_PRECISION)}`,
    )
    .join('|');
  return `maps:route:v1:${points}`;
}

/**
 * A cache entry is untrusted input like any other boundary, so reads are
 * PARSED, not cast: a shape change mid-deploy fails loudly instead of feeding
 * `NaN` cents into a fare.
 */
export const routeResultSchema = z.object({
  distanceMeters: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
  polyline: z.string(),
});

/**
 * A cache entry is recoverable, not fatal: malformed bytes throw from
 * `JSON.parse` and a rejected value throws from zod, and both mean the same
 * thing to the caller — treat the entry as absent and re-route.
 */
function parseEntry(raw: string): RouteResult | null {
  try {
    const parsed = routeResultSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Memoizes `route()` in Redis. Implements the same seam it wraps, so the cache
 * is invisible to every consumer and the real Google provider drops into
 * `MAPS_PROVIDER_SOURCE` (#13/#16) with the caching untouched.
 *
 * The seam's docblock says implementations MUST cache aggressively; this is
 * where that happens, and it is the <€100/mo guardrail in code — an uncached
 * Routes call per ride request, re-quote and price refresh is exactly how a
 * €100/mo budget becomes a €400 bill.
 */
export class CachingMapsProvider implements MapsProvider {
  constructor(
    private readonly inner: MapsProvider,
    private readonly kv: KeyValueStore,
    private readonly ttlSeconds: number,
  ) {}

  async route(
    from: LatLng,
    to: LatLng,
    stops: LatLng[] = [],
  ): Promise<RouteResult> {
    const key = routeCacheKey(from, to, stops);

    const hit = await this.kv.get(key);
    if (hit !== null) {
      const cached = parseEntry(hit);
      if (cached !== null) return cached;
      // A value the write path accepted and this parse rejects. Without the
      // delete, every later request for this corridor throws until the TTL
      // runs out — and the busiest routes are exactly the ones that cached.
      await this.kv.del(key);
    }

    const result = await this.inner.route(from, to, stops);
    // Parsed on write as well as read, so a provider that breaks the seam's
    // contract fails at the source rather than one request later.
    const validated = routeResultSchema.parse(result);
    await this.kv.setWithTtl(key, JSON.stringify(validated), this.ttlSeconds);
    return validated;
  }

  // Uncached, straight through: nothing calls these yet, and caching a call
  // that throws is dead code.
  geocode(query: string, language: Language): Promise<GeocodeResult[]> {
    return this.inner.geocode(query, language);
  }

  reverseGeocode(
    location: LatLng,
    language: Language,
  ): Promise<GeocodeResult | null> {
    return this.inner.reverseGeocode(location, language);
  }
}
