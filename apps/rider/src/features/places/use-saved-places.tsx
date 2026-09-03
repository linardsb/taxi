import type { AddressPoint } from '@taxi/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { newUuid } from '@/uuid';
import {
  readSavedPlaces,
  removeSavedPlace,
  saveSavedPlace,
  toSavedPlace,
  type SavedPlace,
} from './saved-places-store';

export interface SavedPlacesValue {
  places: SavedPlace[];
  loading: boolean;
  save(
    label: string,
    point: AddressPoint,
    placeId: string | null,
  ): Promise<void>;
  remove(id: string): Promise<void>;
}

const SavedPlacesContext = createContext<SavedPlacesValue | null>(null);

/**
 * The saved list, read once on mount and held for the session.
 *
 * DEVICE-LOCAL for #16 (decision D3): it meets the ≤4-tap target for a
 * returning device at about a hundred lines, where an API-backed list needs a
 * table, a migration and a rider-facing slice. The cost is accepted and named —
 * addresses are lost on reinstall and do not follow the rider to a second
 * device — and a follow-up ticket owes the server-backed version.
 */
export function SavedPlacesProvider({ children }: { children: ReactNode }) {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void readSavedPlaces().then((found) => {
      if (cancelled) return;
      setPlaces(found);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    async (label: string, point: AddressPoint, placeId: string | null) => {
      const next = await saveSavedPlace(
        toSavedPlace(newUuid(), label, point, placeId),
        places,
      );
      setPlaces(next);
    },
    [places],
  );

  const remove = useCallback(
    async (id: string) => setPlaces(await removeSavedPlace(id, places)),
    [places],
  );

  const value = useMemo<SavedPlacesValue>(
    () => ({ places, loading, save, remove }),
    [places, loading, save, remove],
  );
  return (
    <SavedPlacesContext.Provider value={value}>
      {children}
    </SavedPlacesContext.Provider>
  );
}

export function useSavedPlaces(): SavedPlacesValue {
  const value = useContext(SavedPlacesContext);
  if (value === null) {
    throw new Error('useSavedPlaces must be used inside <SavedPlacesProvider>');
  }
  return value;
}
