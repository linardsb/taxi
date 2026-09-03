import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MAX_SAVED_PLACES,
  PLACES_KEY,
  clearSavedPlaces,
  readSavedPlaces,
  removeSavedPlace,
  saveSavedPlace,
  toSavedPlace,
  type SavedPlace,
} from './saved-places-store';

const point = (address: string) => ({
  location: { lat: 56.9496, lng: 24.1052 },
  address,
});

const place = (n: number): SavedPlace =>
  toSavedPlace(`id-${n}`, `Vieta ${n}`, point(`Iela ${n}, Rīga`), `place-${n}`);

describe('saved places store', () => {
  beforeEach(() => clearSavedPlaces());

  it('round-trips a saved place, newest first (expected)', async () => {
    const first = await saveSavedPlace(place(1), []);
    const second = await saveSavedPlace(place(2), first);

    expect(second.map((p) => p.id)).toEqual(['id-2', 'id-1']);
    expect(await readSavedPlaces()).toEqual(second);
    // The place id has to survive: the api caches resolutions by it, so a
    // re-resolve of a saved place is free only if it is still here.
    expect((await readSavedPlaces())[0]!.placeId).toBe('place-2');
  });

  it('replaces a twin address rather than adding a second identical row (edge)', async () => {
    const existing = await saveSavedPlace(place(1), []);
    const renamed = toSavedPlace('id-9', 'Mājas', point('Iela 1, Rīga'), 'p-9');

    const next = await saveSavedPlace(renamed, existing);

    // Two rows reading "Iela 1, Rīga" are indistinguishable to a screen reader.
    expect(next).toHaveLength(1);
    expect(next[0]!.label).toBe('Mājas');
  });

  it(`caps the list at ${MAX_SAVED_PLACES}, dropping the oldest (edge)`, async () => {
    let list: SavedPlace[] = [];
    for (let i = 0; i < MAX_SAVED_PLACES + 3; i += 1) {
      list = await saveSavedPlace(place(i), list);
    }

    expect(list).toHaveLength(MAX_SAVED_PLACES);
    expect(list[0]!.id).toBe(`id-${MAX_SAVED_PLACES + 2}`);
    expect(list.map((p) => p.id)).not.toContain('id-0');
  });

  it('removes one and leaves the rest (expected)', async () => {
    const list = await saveSavedPlace(
      place(2),
      await saveSavedPlace(place(1), []),
    );

    const next = await removeSavedPlace('id-1', list);

    expect(next.map((p) => p.id)).toEqual(['id-2']);
    expect(await readSavedPlaces()).toEqual(next);
  });

  it('self-cleans a corrupt blob instead of breaking every launch (failure — E12)', async () => {
    await AsyncStorage.setItem(PLACES_KEY, '{not json');
    await expect(readSavedPlaces()).resolves.toEqual([]);
    expect(await AsyncStorage.getItem(PLACES_KEY)).toBeNull();

    // Valid JSON, wrong shape — the case a schema change produces.
    await AsyncStorage.setItem(
      PLACES_KEY,
      JSON.stringify([{ label: 'Mājas' }]),
    );
    await expect(readSavedPlaces()).resolves.toEqual([]);
    expect(await AsyncStorage.getItem(PLACES_KEY)).toBeNull();
  });

  it('reads an empty list when nothing was ever saved (edge)', async () => {
    await expect(readSavedPlaces()).resolves.toEqual([]);
  });
});
