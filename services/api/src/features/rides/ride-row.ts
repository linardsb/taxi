import type { rides } from '@taxi/db';
import {
  rideRequestSchema,
  rideSchema,
  type FareQuote,
  type Ride,
  type RideRequest,
  type TripEstimate,
} from '@taxi/shared';

/**
 * The pure projections off a `rides` row: the `Ride`, the sweeper's
 * `AwaitingRide` and the stored trip.
 *
 * Split out of `rides.repository.ts` for #260: with the trip projection inline
 * that file went from 473 to 498 of its 500 lines after prettier. Follows
 * `board-ride.ts`: these are projections, not queries, so they sit beside the
 * repository and it keeps only the reads and writes.
 */

export type RideRow = typeof rides.$inferSelect;

/**
 * What the sweeper needs to dispatch a ride, in one read.
 *
 * Carries `request` and `createdAt` because the unclaimed alert
 * (`dispatchUnclaimedEventSchema`) needs `pickup` and an elapsed-seconds count,
 * and `TransitionedRide` deliberately omits both — without them `raiseUnclaimed`
 * would need a second read per ride per tick.
 */
export interface AwaitingRide {
  id: string;
  orderId: string;
  riderId: string;
  geozoneId: string | null;
  request: RideRequest;
  createdAt: Date;
}

/** `request` round-trips through jsonb, so it is parsed rather than cast. */
export function toAwaiting(row: RideRow): AwaitingRide {
  return {
    id: row.id,
    orderId: row.orderId,
    riderId: row.riderId,
    geozoneId: row.geozoneId,
    request: rideRequestSchema.parse(row.request),
    createdAt: row.createdAt,
  };
}

/**
 * Parsed rather than cast: `request` round-trips through jsonb, so
 * `scheduledFor` comes back as an ISO STRING and `rideSchema`'s
 * `z.coerce.date()` is what re-hydrates it into a `Date`.
 *
 * The settled split is projected only when ALL FIVE money columns are set, so a
 * half-written settlement can never be read back as a split. `rideSchema.parse`
 * then runs `fareSplitSchema`'s sum refinement over it — a settled row that
 * does not sum fails loudly on the READ, at the boundary, rather than reaching
 * a driver's earnings screen.
 */
export function toRide(row: RideRow, quote: FareQuote): Ride {
  const settled =
    row.totalCents !== null &&
    row.commissionPct !== null &&
    row.commissionSource !== null &&
    row.commissionCents !== null &&
    row.driverNetCents !== null;

  return rideSchema.parse({
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    riderId: row.riderId,
    driverId: row.driverId,
    geozoneId: row.geozoneId,
    // The OPERATIVE method (`rides.payment_method`), not `request.paymentMethod`
    // — the rider may have changed it before the lock closed at `accepted`.
    paymentMethod: row.paymentMethod,
    request: row.request,
    quote,
    assignment: null,
    split: settled
      ? {
          currency: 'EUR',
          totalCents: row.totalCents,
          commissionPct: row.commissionPct,
          commissionSource: row.commissionSource,
          commissionCents: row.commissionCents,
          driverNetCents: row.driverNetCents,
        }
      : null,
    bookingChannel: row.bookingChannel,
    trackingToken: row.trackingToken,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * The stored trip (#260), both columns or none: a half-written pair is "no
 * trip", never a zero — a zero-km trip would read as real and hide the rate.
 */
export function toTrip(
  row: Pick<RideRow, 'tripDistanceMeters' | 'tripDurationSeconds'>,
): TripEstimate | null {
  return row.tripDistanceMeters === null || row.tripDurationSeconds === null
    ? null
    : {
        distanceMeters: row.tripDistanceMeters,
        durationSeconds: row.tripDurationSeconds,
      };
}
