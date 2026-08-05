import type { RideRequest, RideStatus } from '@taxi/shared';

/**
 * The two states a ride may be CREATED in — the state machine's ENTRY, which is
 * not a transition: `assertTransition(from, to)` needs a `from`, and a ride that
 * does not exist has no status. `.claude/references/ride-state-machine.md` says
 * it plainly: "instant rides enter at `requested`; scheduled rides enter at
 * `scheduled`".
 *
 * This is therefore the ONLY place in the slice that names a ride status, and
 * `rides.repository.ts` takes its status from here and nowhere else. Every
 * status change AFTER creation goes through `assertTransition` — #11 owns
 * those, and this slice performs none.
 *
 * `as const satisfies` rather than an annotation: an annotation widens the
 * tuple and loses the literal types, the trap documented on
 * `DRIVER_PRESENCE_STATUSES`.
 */
export const RIDE_ENTRY_STATUSES = [
  'requested',
  'scheduled',
] as const satisfies readonly RideStatus[];

export type RideEntryStatus = (typeof RIDE_ENTRY_STATUSES)[number];

/** Instant rides enter at `requested`; scheduled ones wait at `scheduled`. */
export function entryStatusFor(request: RideRequest): RideEntryStatus {
  return request.scheduledFor ? 'scheduled' : 'requested';
}

/**
 * Guards the repository's insert: a future caller must not be able to create a
 * ride already mid-lifecycle, which would skip every transition guard between
 * entry and that state.
 */
export function assertEntryStatus(
  status: RideStatus,
): asserts status is RideEntryStatus {
  if (!(RIDE_ENTRY_STATUSES as readonly RideStatus[]).includes(status)) {
    throw new Error(
      `Cannot create a ride at status "${status}": a ride enters the machine at ${RIDE_ENTRY_STATUSES.join(
        ' or ',
      )}. Every later status is reached through assertTransition (#11).`,
    );
  }
}
