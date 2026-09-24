import { NotFoundException, type Logger } from '@nestjs/common';
import {
  assertRideSplitConsistent,
  isInStatusSet,
  RIDER_NAME_VISIBLE_STATUSES,
  RIDER_PHONE_VISIBLE_STATUSES,
  type DriverRide,
  type Ride,
} from '@taxi/shared';
import type { RealtimeService } from '../../realtime';
import type { RidesRepository } from '../rides.repository';
import type { RideLifecycleRepository } from './ride-lifecycle.repository';

type RiderIdentity = { phone: string; displayName: string | null };

/** `driverRideRiderSchema`'s bounds (`userSchema.displayName`, 1–120). */
const DISPLAY_NAME_MAX = 120;

/**
 * The driver's projection of a ride (#261). The windows are applied HERE
 * and nowhere else server-side, keyed on the SNAPSHOT's own status, so the
 * block is always consistent with the `status` it travels with.
 *
 * `identity` undefined = no users row, which `rides.rider_id`'s FK forbids;
 * nulls rather than a throw, because the ride is still the driver's to finish.
 *
 * `users.display_name` is unconstrained `text` while the contract requires
 * 1–120 characters, and a name outside that fails the app's parse of the WHOLE
 * ride. So it is trimmed, blank becomes null and over-long is cut — here, not
 * left to whichever writer #269 adds.
 */
export function toDriverRide(
  ride: Ride,
  identity: RiderIdentity | undefined,
): DriverRide {
  const name = identity?.displayName?.trim().slice(0, DISPLAY_NAME_MAX);
  return {
    ...ride,
    rider: {
      displayName: isInStatusSet(RIDER_NAME_VISIBLE_STATUSES, ride.status)
        ? name || null
        : null,
      phone: isInStatusSet(RIDER_PHONE_VISIBLE_STATUSES, ride.status)
        ? (identity?.phone ?? null)
        : null,
    },
  };
}

/** What `readDriverRide` borrows from `RideLifecycleService`. */
export type DriverRideReadDeps = {
  rides: RidesRepository;
  lifecycle: RideLifecycleRepository;
  realtime: RealtimeService;
  logger: Logger;
};

/**
 * The DRIVER's read of the ride they are driving (#15), and the call that
 * puts their sockets in its ride room — `GET /rides/:rideId` with a driver
 * token. The app calls it on every socket `connect`, because `joinRideRoom`
 * reaches only the sockets alive when `emitAssigned` ran: a reconnected
 * socket is in no ride room and would be deaf to every later `ride:status`
 * (the rider had the same hole, #16's C1).
 *
 * Same shape as `RidesService.findForRider`, on purpose: ownership FIRST
 * (a stranger's socket must never be joined to the room the 404 is about to
 * deny them), then the join, then a SECOND read so the snapshot cannot miss
 * a transition that landed in the join's own round trip. One 404 for
 * "no such ride" and "someone else's ride" — no existence oracle.
 *
 * The split IS on this read once settled — this is the driver's own
 * commission line (S2-5), the thing the rider projection strips.
 *
 * Moved here from `RideLifecycleService.findForDriver` (#261), which now
 * delegates to it: the rider block would have taken that file past the
 * 500-line cap.
 */
export async function readDriverRide(
  deps: DriverRideReadDeps,
  driverId: string,
  rideId: string,
): Promise<DriverRide> {
  const first = await deps.rides.findWithQuote(rideId);
  if (!first || first.ride.driverId !== driverId) {
    throw new NotFoundException('ride_not_found');
  }

  try {
    deps.realtime.joinRideRoom(driverId, rideId);
  } catch (error) {
    deps.logger.warn({
      event: 'ride.read.join_failed',
      rideId,
      driverId,
      reason: error instanceof Error ? error.message : 'unknown',
      at: new Date().toISOString(),
    });
  }

  // The snapshot the app gets, taken after the join. A dispatcher release
  // between the two reads moves `driverId` off this driver: the second read
  // then 404s, which is the truthful answer for a ride that is no longer
  // theirs — and the app treats it as the release it is.
  const found = await deps.rides.findWithQuote(rideId);
  if (!found || found.ride.driverId !== driverId) {
    throw new NotFoundException('ride_not_found');
  }
  // As `readRide`: the parse in `toRide` proves a settled split sums; only
  // this proves it is a cut of the fare the rider was quoted.
  assertRideSplitConsistent(found.ride);
  return toDriverRide(
    found.ride,
    await deps.lifecycle.findRiderIdentity(found.ride.riderId),
  );
}
