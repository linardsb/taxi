import type { Language } from "../enums";
import type { AddressPoint, LatLng } from "../schemas/geo";

export interface GeocodeResult {
  point: AddressPoint;
  /** Provider-specific place identifier, cache key. */
  placeId?: string;
}

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
  reverseGeocode(location: LatLng, language: Language): Promise<GeocodeResult | null>;
  route(from: LatLng, to: LatLng, stops?: LatLng[]): Promise<RouteResult>;
}
