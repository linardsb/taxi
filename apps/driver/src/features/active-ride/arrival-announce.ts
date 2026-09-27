import type { DriverRide, MessageKey } from '@taxi/shared';
import type {
  ActiveRideDecision,
  ActiveRideEffect,
  ActiveRideState,
} from './active-ride-state';

/**
 * The arrival-announce protocol on the driver's side (#259), kept out of
 * `active-ride-state.ts` for its 500-line cap. The rider asked, per booking,
 * for the driver to get out at the kerb and say «Sakta, …!» aloud — a
 * procedure, never a statement about the rider (D1).
 */

/**
 * What the ride screen says about it, derived in render so a reload at
 * `arrived` still shows it. The note before arrival; at `arrived` the words to
 * call out — the rider's name when they set one, else the destination (D4).
 * The name is read inside #261's window, which `arrived` is in.
 */
export function announcePrompt(
  ride: DriverRide,
): { key: MessageKey; params: Record<string, string> } | null {
  if (!ride.request.options.announceArrival) return null;
  if (ride.status === 'accepted' || ride.status === 'arriving') {
    return { key: 'driver.ride.announce_note', params: {} };
  }
  if (ride.status !== 'arrived') return null;
  return ride.rider.displayName
    ? {
        key: 'driver.ride.announce_prompt_name',
        params: { name: ride.rider.displayName },
      }
    : {
        key: 'driver.ride.announce_prompt_destination',
        params: { address: ride.request.destination.address },
      };
}

/**
 * `toISOString()` strings are fixed-width UTC, so string order is time order.
 * Not `!==` (PR #282 review L5): a push for an older request landing after a
 * newer socket event must not buzz again.
 */
const isNewer = (at: string, last: string | null) => last === null || at > last;

/**
 * The notice for a request at `at` — from the socket, the push, or a re-read's
 * `announceRequestedAt` — or null when it must not fire: another ride, not at
 * `arrived`, or an `at` already heard. All three legs carry the same `at`, so
 * this is what makes them one notice and one buzz. The `announce` effect is
 * the one speaker (the Banner is silent, #259 T0): it runs app-wide, so the
 * notice is heard on whichever screen is up.
 */
export function announceNotice(
  state: ActiveRideState,
  rideId: string,
  at: string,
  effects: ActiveRideEffect[] = [],
): ActiveRideDecision | null {
  if (state.ride?.id !== rideId || state.ride.status !== 'arrived') {
    return null;
  }
  if (!isNewer(at, state.lastAnnounceAt)) return null;
  return {
    state: { ...state, notice: 'announce_requested', lastAnnounceAt: at },
    effects: [
      ...effects,
      { type: 'haptic' },
      { type: 'announce', key: 'driver.ride.announce_requested' },
    ],
  };
}

/**
 * The notice lives only while the car waits at `arrived` (PR #282 review M2).
 * «Sākt braucienu» moves the status itself in `step_done`, and dispatch can
 * release or cancel; either way the request is over. A `payment_changed`
 * notice keeps its own lifetime. Same object back when nothing changes.
 */
export function clearStaleAnnounce(state: ActiveRideState): ActiveRideState {
  return state.notice === 'announce_requested' &&
    state.ride?.status !== 'arrived'
    ? { ...state, notice: null }
    : state;
}
