import type { Language } from '../enums';
import type { AddressSuggestion } from '../schemas/address-search';
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

/** Per-call configuration for `MapsProvider.searchAddress`. */
export interface AddressSearchOptions {
  /** Bias results to the pilot city; NOT a restriction — Pierīga/Jūrmala
   *  pickups are in scope (PRD §6 geography). */
  bias: { center: LatLng; radiusMeters: number };
  /**
   * Groups a burst of keystrokes AND the terminating `resolvePlace` into ONE
   * billed session. Minted per address FIELD, not per form: two fields typed
   * in one booking are two sessions, because each ends in its own resolve.
   *
   * An implementation that ignores it is correct but expensive — every
   * keystroke then bills as its own autocomplete request.
   */
  sessionToken: string;
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
  /**
   * Typeahead for the dispatcher's booking form (#19). Returns `[]` for a
   * query the provider has nothing for — never throws to say "no matches".
   *
   * Predictions are Places CONTENT and MUST NOT be cached (policy); the
   * session token and the caller's debounce are the spend controls.
   */
  searchAddress(
    query: string,
    language: Language,
    options: AddressSearchOptions,
  ): Promise<AddressSuggestion[]>;
  /**
   * Resolves a chosen suggestion to a bookable point, and TERMINATES the
   * session token that found it. Returns `null` when the provider no longer
   * knows the place id — a stale saved place, not an error.
   *
   * `sessionToken: null` means "no session is open": a saved place being
   * re-resolved, where nobody typed and no autocomplete request was billed.
   * The distinction is not cosmetic — it decides whether an implementation may
   * answer from cache. See `CachingMapsProvider.resolvePlace`.
   */
  resolvePlace(
    placeId: string,
    language: Language,
    sessionToken: string | null,
  ): Promise<AddressPoint | null>;
}
