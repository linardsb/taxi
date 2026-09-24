import type { Logger } from '@nestjs/common';
import type { RideStatus } from '@taxi/shared';
import type { LifecycleRide } from './ride-lifecycle.repository';
import type { LifecycleActor } from './ride-lifecycle.policy';

/**
 * Why the machine said no. A CLOSED set, deliberately: the cancellation
 * `reason` beside it is rider-authored free text and must never reach a log
 * (`.claude/references/logging-standard.md`), so making this a union rather
 * than a `string` turns that mistake into a compiler error. The `pickup_pin_*`
 * causes (#258) name the verdict only; a PIN never rides on a log line.
 */
export type RejectionCause =
  | 'not_in_expected_status'
  | 'illegal_transition'
  | 'lost_race'
  | 'pickup_pin_required'
  | 'pickup_pin_incorrect'
  | 'pickup_pin_locked';

/** Anything this slice logs about. Both ride shapes satisfy it structurally. */
export type LoggableRide = {
  id: string;
  orderId: string;
  driverId: string | null;
};

/**
 * `actorId` is WHICH person, not just which role: a dispatcher cancelling a
 * moving ride is the one ownership-bypassing action here, and `actor:
 * 'dispatcher'` alone does not say which of them did it.
 *
 * `reason` is rider/driver/dispatcher-authored free text (280 chars,
 * `rideCancelSchema`) and is therefore reduced to a BOOLEAN. "Waiting at
 * Brīvības iela 42, call me on 26123456" is an address and an unmasked phone
 * number, both of which `.claude/references/logging-standard.md` forbids.
 */
export function logTransitionApplied(
  logger: Logger,
  ride: LoggableRide,
  actor: LifecycleActor,
  actorId: string,
  from: RideStatus,
  to: RideStatus,
  reason: string | null = null,
): void {
  logger.log({
    event: 'ride.lifecycle.transition_applied',
    rideId: ride.id,
    orderId: ride.orderId,
    driverId: ride.driverId,
    actor,
    actorId,
    from,
    to,
    hasReason: reason !== null,
    at: new Date().toISOString(),
  });
}

/**
 * `from` is the ride's ACTUAL status as last read, never the one the step
 * expected — logging the expected one would claim the ride was in the state
 * we wanted it to be in, which is the opposite of useful at 02:00.
 *
 * On `lost_race` that read is by definition already stale: the conditional
 * UPDATE matched no row precisely because somebody else moved the ride
 * between the read and the write. `from` is what we saw, and `cause` says so.
 */
export function logTransitionRejected(
  logger: Logger,
  ride: LifecycleRide,
  actor: LifecycleActor,
  actorId: string,
  to: RideStatus,
  cause: RejectionCause,
): void {
  logger.warn({
    event: 'ride.lifecycle.transition_rejected',
    rideId: ride.id,
    orderId: ride.orderId,
    driverId: ride.driverId,
    actor,
    actorId,
    from: ride.status,
    to,
    cause,
    at: new Date().toISOString(),
  });
}
