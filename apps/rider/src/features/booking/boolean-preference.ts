import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

/**
 * A yes/no remembered on the device under `key`. AsyncStorage, like
 * `sakta.rider.places`: a yes/no is not a secret, and a stored preference on
 * the server is out of scope (the user's 2026-09-23 call, #258).
 */
export interface BooleanPreference {
  value: boolean;
  /** False until the stored value is read — Book waits for it. */
  loaded: boolean;
  set(value: boolean): void;
}

/**
 * Read once on mount. A read that throws means "off", and still counts as
 * loaded: the switch then shows off, visibly, before the rider taps Book.
 * `set` applies at once and writes fire-and-forget — a failed write still
 * applies to this booking, and costs only the memory for the next one.
 */
export function useBooleanPreference(key: string): BooleanPreference {
  const [state, setState] = useState({ value: false, loaded: false });

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(key)
      .then((stored) => stored === '1')
      .catch(() => false)
      .then((value) => {
        if (!cancelled) setState({ value, loaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const set = useCallback(
    (value: boolean) => {
      setState({ value, loaded: true });
      AsyncStorage.setItem(key, value ? '1' : '0').catch(() => undefined);
    },
    [key],
  );

  return { ...state, set };
}
