import { addressPointSchema, type AddressPoint } from '@taxi/shared';
import * as Location from 'expo-location';

/**
 * The device's coarse position as a bookable point, or `null`.
 *
 * `null` IS AN ORDINARY OUTCOME, NOT AN ERROR (decision D7). Permission
 * refused, a timeout, an indoor fix that never arrives — every one of them just
 * means the rider types their pickup instead, and a booking must be completable
 * with location permission denied outright. Nothing here throws.
 *
 * FOREGROUND ONLY. `requestForegroundPermissionsAsync`, never the background
 * pair: the architecture's justification for two apps is that permissions are
 * declared per app at build time, and Play policy reviews the driver app's
 * background location against the rider majority. This app must never ask.
 *
 * The street line comes from `expo-location`'s own `reverseGeocodeAsync` rather
 * than a fourth geo route. If it gives nothing usable the coordinates are shown
 * instead — degraded, and cheaper than widening a paid endpoint.
 */
export async function currentPositionPoint(): Promise<AddressPoint | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return null;

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const location = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };

    return addressPointSchema.parse({
      location,
      address: await describe(location),
    });
  } catch {
    return null;
  }
}

/** A street line, else the coordinates — `addressPointSchema.address` is
 *  `min(1)`, so there is always something to render and to speak. */
async function describe(location: {
  lat: number;
  lng: number;
}): Promise<string> {
  try {
    const [place] = await Location.reverseGeocodeAsync({
      latitude: location.lat,
      longitude: location.lng,
    });
    const line = [
      [place?.street, place?.streetNumber].filter(Boolean).join(' '),
      place?.city,
    ]
      .filter((part) => part !== undefined && part !== '')
      .join(', ');
    if (line !== '') return line;
  } catch {
    // Falls through to coordinates — a reverse-geocode failure must not cost
    // the rider their pickup.
  }
  return `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`;
}
