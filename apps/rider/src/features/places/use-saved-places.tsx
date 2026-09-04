import type { AddressPoint } from '@taxi/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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

  /**
   * SERIALISED through one promise chain rather than closing over `places`.
   *
   * Two saves dispatched before the first `setPlaces` commits both read the
   * same array, and the second overwrites the first in AsyncStorage — reachable
   * by double-tapping «Saglabāt». Chaining makes each write see the previous
   * one's result; the ref holds the list the STORE has, which is what the next
   * write must be built on, not what React has rendered.
   *
   * THE QUEUE SURVIVES A FAILED WRITE, which is not free: `.then(onFulfilled)`
   * on a rejected promise skips its callback entirely, so a chain left rejected
   * would make every later save AND delete a silent no-op for the provider's
   * lifetime — `work` never even running. `enqueue` therefore keeps a caught
   * copy as the link the next write builds on, and hands the rejection to the
   * caller instead.
   *
   * THE MOUNT READ IS THE FIRST LINK rather than a separate writer of
   * `latest.current`. Two unordered writers to the ref would make the sentence
   * above ("the list the STORE has") a claim the code does not keep.
   */
  const pending = useRef<Promise<SavedPlace[]>>(Promise.resolve([]));
  const latest = useRef<SavedPlace[]>([]);

  useEffect(() => {
    let cancelled = false;
    pending.current = pending.current
      .then(async () => {
        const found = await readSavedPlaces();
        if (cancelled) return latest.current;
        latest.current = found;
        setPlaces(found);
        setLoading(false);
        return found;
      })
      .catch(() => latest.current);
    return () => {
      cancelled = true;
    };
  }, []);

  const enqueue = useCallback(
    (work: (current: SavedPlace[]) => Promise<SavedPlace[]>) => {
      const done = pending.current
        .then(() => work(latest.current))
        .then((next) => {
          latest.current = next;
          setPlaces(next);
          return next;
        });
      // The QUEUE resumes from the last list the store actually holds; `done`
      // keeps the rejection so the caller can still see it.
      pending.current = done.catch(() => latest.current);
      return done.then(() => undefined);
    },
    [],
  );

  const save = useCallback(
    (label: string, point: AddressPoint, placeId: string | null) =>
      enqueue((current) =>
        saveSavedPlace(toSavedPlace(newUuid(), label, point, placeId), current),
      ),
    [enqueue],
  );

  const remove = useCallback(
    (id: string) => enqueue((current) => removeSavedPlace(id, current)),
    [enqueue],
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
