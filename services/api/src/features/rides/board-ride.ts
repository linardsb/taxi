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

/** The request's opt-ins, validated apart from the pickup — see `boardFlagsOf`. */
const boardOptionsSchema = rideRequestSchema.pick({ options: true });

/**
 * The two option flags the board carries (#275), read off the request snapshot.
 *
 * A SEPARATE parse from `boardPickupSchema`, because the failure mode differs:
 * a bad pickup costs the card (there is nothing to render), a bad `options`
 * must cost only the badge. So a failure here yields `false`, never a dropped
 * row. A request with no `options` key parses to all-false through the
 * schema's own default, which is the right answer for a legacy row.
 *
 * `pickupPinRequired` comes from the request flag, not the `pickup_pin` column:
 * the two are equal by construction (`RidesService` mints if and only if the
 * flag is set), and the board projection must never touch the PIN column.
 *
 * No log on the fallback: it would repeat every 2 s per bad row, and the
 * options were validated at write time.
 */
export function boardFlagsOf(request: unknown): {
  announceArrival: boolean;
  pickupPinRequired: boolean;
} {
  const parsed = boardOptionsSchema.safeParse(request);
  if (!parsed.success) {
    return { announceArrival: false, pickupPinRequired: false };
  }
  return {
    announceArrival: parsed.data.options.announceArrival,
    pickupPinRequired: parsed.data.options.pickupPin,
  };
}

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
  /** `options.announceArrival` (#275), for the console's badge. */
  announceArrival: boolean;
  /** Whether the ride has a pickup PIN (#275) — never the PIN itself. */
  pickupPinRequired: boolean;
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
