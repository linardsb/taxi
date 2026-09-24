import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

/**
 * Whether this rider opts in to a pickup PIN (#258), remembered on the device.
 * AsyncStorage, like `sakta.rider.places`: a yes/no is not a secret, and a
 * stored preference on the server is out of scope (the user's 2026-09-23 call).
 */
export const PICKUP_PIN_KEY = 'sakta.rider.pickup_pin';

export interface PickupPinPreference {
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
export function usePickupPinPreference(): PickupPinPreference {
  const [state, setState] = useState({ value: false, loaded: false });

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(PICKUP_PIN_KEY)
      .then((stored) => stored === '1')
      .catch(() => false)
      .then((value) => {
        if (!cancelled) setState({ value, loaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = useCallback((value: boolean) => {
    setState({ value, loaded: true });
    AsyncStorage.setItem(PICKUP_PIN_KEY, value ? '1' : '0').catch(
      () => undefined,
    );
  }, []);

  return { ...state, set };
}
