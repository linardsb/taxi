import { Injectable } from '@nestjs/common';
import type {
  AddressPoint,
  AddressSuggestion,
  GeocodeResult,
  LatLng,
  MapsProvider,
  RouteResult,
} from '@taxi/shared';
import { haversineMeters } from './haversine';

/**
 * Straight-line distance is shorter than any road, so it is scaled up. 1.35 is
 * the usual urban detour ratio and nothing more principled than that.
 *
 * STUB INTERNALS, NOT BUSINESS CONFIG. Rates live in `ride_tariffs`; these two
 * exist only so a quote is deterministic and free in dev, and they die with the
 * stub. Nothing may read them — a real provider returns real numbers.
 */
const ROAD_WINDING_FACTOR = 1.35;
const AVERAGE_SPEED_KMH = 40;

const NO_GEOCODER =
  'StubMapsProvider has no geocoder: a RideRequest already carries resolved AddressPoints. Bind the Google provider when address search lands (#16).';

/**
 * Separate from `NO_GEOCODER` because the remedy is different: address search
 * has a bound implementation (`GooglePlacesProvider`, #19) and reaching this
 * message means `GOOGLE_MAPS_API_KEY` is absent, not that the feature is
 * unbuilt. Dev without a key is expected — the console surfaces the throw as
 * "typeahead unavailable" and free text still reaches the draft.
 */
const NO_PLACES =
  'StubMapsProvider has no address search: set GOOGLE_MAPS_API_KEY to bind GooglePlacesProvider (#19).';

/**
 * Dev/pilot implementation of the MapsProvider seam (@taxi/shared). Computes a
 * route from geometry instead of spending money at Google; the real Routes
 * implementation lands with #13/#16.
 *
 * `GeoModule` refuses to boot this under `NODE_ENV=production` — a silent stub
 * that prices real rides off straight-line distance is worse than no boot.
 */
@Injectable()
export class StubMapsProvider implements MapsProvider {
  route(from: LatLng, to: LatLng, stops: LatLng[] = []): Promise<RouteResult> {
    const legs = [from, ...stops, to];
    let straightLineMeters = 0;
    for (let i = 0; i < legs.length - 1; i += 1) {
      straightLineMeters += haversineMeters(legs[i]!, legs[i + 1]!);
    }

    const distanceMeters = Math.round(straightLineMeters * ROAD_WINDING_FACTOR);
    const durationSeconds = Math.round(
      (distanceMeters / 1000 / AVERAGE_SPEED_KMH) * 3600,
    );

    return Promise.resolve({ distanceMeters, durationSeconds, polyline: '' });
  }

  // Parameters omitted deliberately: both throw, and a narrower signature
  // still satisfies the seam.
  geocode(): Promise<GeocodeResult[]> {
    throw new Error(NO_GEOCODER);
  }

  reverseGeocode(): Promise<GeocodeResult | null> {
    throw new Error(NO_GEOCODER);
  }

  searchAddress(): Promise<AddressSuggestion[]> {
    throw new Error(NO_PLACES);
  }

  resolvePlace(): Promise<AddressPoint | null> {
    throw new Error(NO_PLACES);
  }
}
