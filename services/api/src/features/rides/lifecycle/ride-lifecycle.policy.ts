import {
  isPaymentMethodLocked,
  isTerminal,
  RIDE_STATUSES,
  type RideStatus,
} from '@taxi/shared';

/**
 * Ride-lifecycle policy: pure status knowledge, no I/O and no DI. The same role
 * `ride-entry.ts` plays for the machine's entry, this file plays for everything
 * from `accepted` onward.
 */

/**
 * Who is acting. Derived from the JWT role — NEVER from a request body, for the
 * reason `rideRequestBodySchema` omits `riderId`: an actor a client can choose
 * is an actor a client can forge, and the actor is what the terminal status
 * records forever.
 *
 * There is no `admin` member: an admin cancelling is doing a dispatcher's job,
 * and the machine has no `cancelled_by_admin`. The controller maps it.
 */
export type LifecycleActor = 'rider' | 'driver' | 'dispatcher' | 'system';

/**
 * `as const satisfies`, never an annotation — an annotation widens the values
 * back to `RideStatus` and loses the literal types, the trap documented on
 * `DRIVER_PRESENCE_STATUSES`.
 */
const CANCELLED_STATUS_BY_ACTOR = {
  rider: 'cancelled_by_rider',
  driver: 'cancelled_by_driver',
  dispatcher: 'cancelled_by_dispatcher',
  system: 'cancelled_by_system',
} as const satisfies Record<LifecycleActor, RideStatus>;

/** actor → terminal cancellation status. Exhaustive over `LifecycleActor`. */
export function cancelledStatusFor(actor: LifecycleActor): RideStatus {
  return CANCELLED_STATUS_BY_ACTOR[actor];
}

/**
 * The driver's four steps, in order. Every pair is an edge of
 * `ALLOWED_TRANSITIONS`, which is what lets the service check `ride.status ===
 * from` and be done: for a FIXED step table a `from` mismatch IS the
 * illegality, so a separate `canTransition` call would be dead logic. (Cancel
 * is different — there `to` varies by actor, so it checks `canTransition`.)
 *
 * `from` doubles as the 409 error code: `ride_not_arrived` for a `start` on a
 * ride that never arrived.
 */
export const DRIVER_STEPS = {
  arriving: { from: 'accepted', to: 'arriving' },
  arrived: { from: 'arriving', to: 'arrived' },
  start: { from: 'arrived', to: 'in_progress' },
  complete: { from: 'in_progress', to: 'completed' },
} as const satisfies Record<string, { from: RideStatus; to: RideStatus }>;

export type DriverStep = keyof typeof DRIVER_STEPS;

/**
 * When the rider may still change how they pay — DERIVED from the shared
 * predicate, never hand-listed. Hand-listing it is the "never bypass
 * `isPaymentMethodLocked()`" hard rule bypassed by copy-paste, and it would rot
 * silently the moment #21/#22 add a status.
 *
 * `isTerminal` is in the filter because a cancelled ride is not LOCKED
 * (`isPaymentMethodLocked('cancelled_by_rider')` is `false`) but must not be
 * editable either — it is over, which is a different 409.
 */
export const PAYMENT_METHOD_EDITABLE_STATUSES: readonly RideStatus[] =
  RIDE_STATUSES.filter((s) => !isPaymentMethodLocked(s) && !isTerminal(s));
