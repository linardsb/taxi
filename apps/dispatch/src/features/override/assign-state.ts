import type {
  BoardRideStatus,
  DispatchDriver,
  DispatchBoardEvent,
  MessageKey,
} from '@taxi/shared';

/**
 * The override slice's pure state module — every decision the dialog makes on
 * data, with no React, no fetch and no clock of its own. Same rule as the
 * board's `board-state.ts`, and for the same reason: these are the rules a
 * dispatcher's override depends on, so they should be cheap to test
 * exhaustively rather than only reachable through a rendered dialog.
 */

export type AssignVerb = 'assign' | 'reassign';

/**
 * Which verb a ride takes, or `null` when it takes neither.
 *
 * TOTAL over `BoardRideStatus`, never `Partial`. The api decides what the
 * board carries via `BOARD_LIVE_RIDE_STATUSES`; a `Partial` would let this
 * file restate that set by hand, so a status added there — the scheduled-rides
 * work is the named case — would render a row with no action and no error
 * anywhere. Total, the omission is a build failure.
 *
 * `arrived` and `in_progress` map to `null` because the api refuses them
 * (`RELEASABLE_STATUSES` in reassign.service.ts): a driver standing at the
 * pickup or carrying the passenger is not reassignable, that is a
 * cancellation. Offering the button and then showing a 409 would be a worse
 * version of the same answer.
 */
const VERB_BY_STATUS: Record<BoardRideStatus, AssignVerb | null> = {
  requested: 'assign',
  offered: 'assign',
  queued: 'assign',
  accepted: 'reassign',
  arriving: 'reassign',
  arrived: null,
  in_progress: null,
};

export const assignVerb = (status: BoardRideStatus): AssignVerb | null =>
  VERB_BY_STATUS[status];

export type DriverWarning = 'offline' | 'on_ride';

/**
 * Why this driver needs a second confirm — or `null` when they need none.
 *
 * A WARNING, never a block. #10's force-assign is "deliberately NOT filtered
 * through the eligibility rules: overriding the algorithm — including onto an
 * offline or otherwise ineligible driver — is the feature, not a hole in it."
 * Dina has the driver on the phone; his app crashed; she still needs to send
 * him. Disabling the button here would break S9-2 from the client side while
 * the api happily allows it.
 */
export function driverWarning(driver: DispatchDriver): DriverWarning | null {
  if (driver.status === 'offline') return 'offline';
  if (driver.status === 'on_ride' || driver.activeRideId !== null) {
    return 'on_ride';
  }
  return null;
}

const WARNING_KEY: Record<DriverWarning, MessageKey> = {
  offline: 'console.assign_offline_warning',
  on_ride: 'console.assign_on_ride_warning',
};

export const warningKey = (warning: DriverWarning): MessageKey =>
  WARNING_KEY[warning];

/**
 * The api's error codes, mapped to what Dina reads.
 *
 * An UNMAPPED code falls back to the generic key rather than rendering the raw
 * code: `ride_not_assignable` on a console screen is worse than "the ride is
 * already assigned — the board will catch up", and a future api error must not
 * leak its identifier into an operator's face.
 *
 * Note which of these is the real failure path. Assigning an offline driver
 * SUCCEEDS (see `driverWarning`); the 409s below are what happens when the
 * ride moved on mid-cascade, and the cascade resuming is itself the re-offer.
 */
const ERROR_KEYS: Record<string, MessageKey> = {
  ride_not_found: 'console.assign_error_ride_not_found',
  driver_not_found: 'console.assign_error_driver_not_found',
  ride_not_assignable: 'console.assign_error_ride_not_assignable',
  ride_already_assigned: 'console.assign_error_ride_already_assigned',
  ride_not_reassignable: 'console.assign_error_ride_not_reassignable',
  // The CANCEL path's two codes (#120 review H2). Unmapped, both fell through
  // to the generic assign message — "could not assign" rendered inside the
  // cancel dialog, on the destructive action, for a ride that already ended.
  ride_not_cancellable: 'console.assign_error_ride_not_cancellable',
  ride_transition_conflict: 'console.assign_error_ride_moved_on',
};

/**
 * `fallback` is the verb's own generic message. It is a parameter and not a
 * constant because the cancel path shares this map: an unmapped code there must
 * read as a failed cancellation, not a failed assignment.
 */
export const assignErrorKey = (
  code: string | undefined,
  fallback: MessageKey = 'console.assign_failed',
): MessageKey => (code !== undefined ? ERROR_KEYS[code] : undefined) ?? fallback;

/**
 * Picker order: assignable-now first, then the driver already near the job,
 * then alphabetically.
 *
 * `online` outranks `on_ride` outranks `offline` — the ordinary override puts
 * a free car on a ride, and burying those under drivers who would need a
 * warning would make the common case the slowest. Within a rank, a driver
 * standing in the pickup's zone comes first: that is the one fact the roster
 * carries that predicts a short ETA.
 */
const STATUS_RANK: Record<DispatchDriver['status'], number> = {
  online: 0,
  on_ride: 1,
  offline: 2,
};

export function sortRoster(
  drivers: readonly DispatchDriver[],
  pickupZoneName: string | null,
): DispatchDriver[] {
  return [...drivers].sort((a, b) => {
    const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (byStatus !== 0) return byStatus;

    if (pickupZoneName !== null) {
      const aZone = a.zoneName === pickupZoneName ? 0 : 1;
      const bZone = b.zoneName === pickupZoneName ? 0 : 1;
      if (aZone !== bZone) return aZone - bZone;
    }

    return a.name.localeCompare(b.name, 'lv');
  });
}

/**
 * Free-text filter over the three identifiers Dina has to hand mid-call: the
 * name she was told, the plate she can see, and the number she dialled.
 * Case-insensitive; a blank query matches everything rather than nothing.
 */
export function filterRoster(
  drivers: readonly DispatchDriver[],
  query: string,
): DispatchDriver[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...drivers];
  return drivers.filter((d) =>
    [d.name, d.vehiclePlate ?? '', d.phone].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

/**
 * The zone the ride's pickup sits in, read off the board frame's DRIVERS —
 * the frame carries no zone for a ride, and this is a sort hint rather than a
 * fact worth a round trip. Returns null when nothing in the frame can answer,
 * which `sortRoster` treats as "skip the zone tier".
 */
export function pickupZoneOf(
  frame: DispatchBoardEvent | null,
  rideId: string,
): string | null {
  const ride = frame?.rides.find((r) => r.rideId === rideId);
  if (!ride || ride.driverId === null) return null;
  return (
    frame?.drivers.find((d) => d.driverId === ride.driverId)?.zoneName ?? null
  );
}
