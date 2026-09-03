import AsyncStorage from '@react-native-async-storage/async-storage';
import { addressPointSchema, type AddressPoint } from '@taxi/shared';
import { z } from 'zod';

/** AsyncStorage, NOT SecureStore: a home address is not a secret, and a growing
 *  list is the wrong shape for SecureStore's iOS value ceiling (the session
 *  store's own comment sizes one session at ~600 bytes against it). */
export const PLACES_KEY = 'sakta.rider.places';

/**
 * Ten. A scrollable list of saved places past that is #17's problem, not this
 * ticket's — and the friction budget this list exists to serve is about the
 * FIRST row being one tap away, which a longer list makes worse rather than
 * better.
 */
export const MAX_SAVED_PLACES = 10;

export const savedPlaceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(40),
  point: addressPointSchema,
  /**
   * The provider place id, kept alongside the point. `place-cache.ts` in the api
   * caches resolutions BY PLACE ID, so re-resolving a saved place is free — but
   * only if the id survived. `null` for a place saved from a source that had no
   * id (there is none today; the field is what keeps that true by construction).
   */
  placeId: z.string().min(1).nullable(),
});
export type SavedPlace = z.infer<typeof savedPlaceSchema>;

const savedPlacesSchema = z.array(savedPlaceSchema);

/**
 * The saved list, or `[]` — and the store is CLEANED on any parse miss, the
 * same self-healing contract `session-store.ts` carries and for the same
 * reason: a corrupt blob must not break every launch. There is nothing here a
 * rider cannot re-enter, so discarding beats bouncing.
 */
export async function readSavedPlaces(): Promise<SavedPlace[]> {
  const raw = await AsyncStorage.getItem(PLACES_KEY);
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await clearSavedPlaces();
    return [];
  }
  const result = savedPlacesSchema.safeParse(parsed);
  if (!result.success) {
    await clearSavedPlaces();
    return [];
  }
  return result.data;
}

/**
 * Adds one, newest first, capped. A place whose `point.address` already exists
 * REPLACES the old row rather than adding a twin — two "Brīvības iela 45" rows
 * read identically to a screen reader and cost a tap to tell apart.
 */
export async function saveSavedPlace(
  place: SavedPlace,
  existing: SavedPlace[],
): Promise<SavedPlace[]> {
  const deduped = existing.filter(
    (p) => p.point.address !== place.point.address && p.id !== place.id,
  );
  const next = [place, ...deduped].slice(0, MAX_SAVED_PLACES);
  await AsyncStorage.setItem(PLACES_KEY, JSON.stringify(next));
  return next;
}

export async function removeSavedPlace(
  id: string,
  existing: SavedPlace[],
): Promise<SavedPlace[]> {
  const next = existing.filter((p) => p.id !== id);
  await AsyncStorage.setItem(PLACES_KEY, JSON.stringify(next));
  return next;
}

export async function clearSavedPlaces(): Promise<void> {
  await AsyncStorage.removeItem(PLACES_KEY);
}

/** The shape a resolved address takes on its way into the list. */
export function toSavedPlace(
  id: string,
  label: string,
  point: AddressPoint,
  placeId: string | null,
): SavedPlace {
  return savedPlaceSchema.parse({ id, label, point, placeId });
}
