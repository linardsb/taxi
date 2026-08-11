import type { Language } from '../enums';
import type { AddressPoint, LatLng } from '../schemas/geo';

export interface GeocodeResult {
  point: AddressPoint;
  /** Provider-specific place identifier, cache key. */
  placeId?: string;
}

/**
 * WHOLE UNITS, both of them — an invariant TypeScript cannot express, which is
 * exactly why it lives in prose and is enforced at the cache boundary instead.
 *
 * An adapter must not assume its provider already agrees: Google's Routes API
 * documents `duration` as a fractional-seconds string (`"1187.400s"`), so
 * fractional is the documented shape, not an edge case. `CachingMapsProvider`
 * rounds on its write path before validating, so an adapter that passes
 * fractions straight through degrades nothing — sub-metre and sub-second
 * accuracy is the entire cost.
 */
export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** Encoded polyline for map display. */
  polyline: string;
}

/**
 * Seam over Google Maps Platform (decided 2026-07-06). Every call site goes
 * through this interface so the provider can be swapped (OSM/Mapbox) if the
 * <€100/mo budget demands it. Implementations MUST cache aggressively.
 */
export interface MapsProvider {
  geocode(query: string, language: Language): Promise<GeocodeResult[]>;
  reverseGeocode(
    location: LatLng,
    language: Language,
  ): Promise<GeocodeResult | null>;
  route(from: LatLng, to: LatLng, stops?: LatLng[]): Promise<RouteResult>;
}
