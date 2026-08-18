import {
  BOARD_LIVE_RIDE_STATUSES,
  rideRequestSchema,
  type AddressPoint,
  type BoardRideStatus,
  type BookingChannel,
  type RideStatus,
} from '@taxi/shared';

/**
 * The board's projection off a ride row — the shape, and the two guards that
 * narrow a `rides` row into it.
 *
 * Split out of `rides.repository.ts` when #19 Phase C's `geozoneId` field took
 * that file past the 500-line cap. It is a projection, not a query: everything
 * here is pure, so it sits beside the repository rather than inside it and the
 * repository keeps only the reads. `findBoardRides` is the sole consumer.
 */

/**
 * The board needs the pickup and nothing else off the request snapshot, so it
 * validates the pickup and nothing else — see `findBoardRides`.
 */
export const boardPickupSchema = rideRequestSchema.pick({ pickup: true });

const BOARD_STATUS_SET = new Set<string>(BOARD_LIVE_RIDE_STATUSES);

/**
 * The board query's `inArray` already constrains this, but that guarantee
 * lives in SQL where the type system cannot see it. A checked guard rather
 * than a cast: `BoardRide.status` is what the wire schema demands, and an
 * assertion here would be the one unverified step between the two.
 */
export const isBoardStatus = (status: RideStatus): status is BoardRideStatus =>
  BOARD_STATUS_SET.has(status);

/** One board row: the ride, its pickup, and who (if anyone) is on it. */
export interface BoardRide {
  id: string;
  status: BoardRideStatus;
  pickup: AddressPoint;
  driverId: string | null;
  driverName: string | null;
  bookingChannel: BookingChannel;
  createdAt: Date;
  /**
   * The zone the ride was DISPATCHED from — stamped once by `setGeozone` at
   * first dispatch and never moved. The cascade needs it to name the right
   * queue: a driver accumulates memberships across a shift (lazy enrollment
   * enrolls, nothing calls `leave()`), so "the zone this driver is queued in"
   * is ambiguous and only the ride knows which one it meant.
   *
   * Null for a ride the engine has not reached yet, and for a pickup that
   * falls in no configured zone.
   */
  geozoneId: string | null;
}
