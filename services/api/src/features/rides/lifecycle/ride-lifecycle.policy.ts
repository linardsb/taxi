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

/**
 * Wrong pickup-PIN entries a ride tolerates before its start locks (#258).
 * Source: `docs/research/rider-ux-evidence.md` §6.1 ("5 attempts"). Brute-force
 * ceiling, `derived`: 5 ÷ 10,000 = 0.05 % per ride, assuming a uniformly minted
 * PIN and 5 distinct guesses — which the row lock in `start()` makes the true
 * maximum even under parallel requests.
 */
export const PICKUP_PIN_MAX_ATTEMPTS = 5;

export type PickupPinVerdict = 'open' | 'required' | 'incorrect' | 'locked';

/**
 * Whether a `start` may proceed on this ride's PIN gate. Order matters: a ride
 * without a PIN ignores any entry; a locked ride refuses even the right PIN;
 * only then is the entry compared — as strings, so `'42'` never equals `'0042'`.
 */
export function pickupPinVerdict(
  gate: { pin: string | null; failures: number },
  entered: string | undefined,
): PickupPinVerdict {
  if (gate.pin === null) return 'open';
  if (gate.failures >= PICKUP_PIN_MAX_ATTEMPTS) return 'locked';
  if (entered === undefined) return 'required';
  return entered === gate.pin ? 'open' : 'incorrect';
}
