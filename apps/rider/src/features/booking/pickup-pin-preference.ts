import {
  useBooleanPreference,
  type BooleanPreference,
} from './boolean-preference';

/** Whether this rider opts in to a pickup PIN (#258), remembered on the device. */
export const PICKUP_PIN_KEY = 'sakta.rider.pickup_pin';

/**
 * Whether this rider opts in to the arrival-announce protocol (#259): the
 * driver gets out and calls «Sakta» at the kerb. A procedure the rider asks
 * for, remembered on the device — never a statement about the rider.
 */
export const ANNOUNCE_ARRIVAL_KEY = 'sakta.rider.announce_arrival';

export type PickupPinPreference = BooleanPreference;

export const usePickupPinPreference = () =>
  useBooleanPreference(PICKUP_PIN_KEY);

export const useAnnounceArrivalPreference = () =>
  useBooleanPreference(ANNOUNCE_ARRIVAL_KEY);
