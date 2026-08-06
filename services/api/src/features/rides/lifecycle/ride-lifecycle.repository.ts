import { Inject, Injectable } from '@nestjs/common';
import { rideOffers, rides, type Db } from '@taxi/db';
import {
  fareSplitSchema,
  type FareSplit,
  type PaymentMethodType,
  type RideStatus,
} from '@taxi/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { DRIZZLE, type DbTx } from '../../../common/db/db.module';
import { PAYMENT_METHOD_EDITABLE_STATUSES } from './ride-lifecycle.policy';

/**
 * What authorizing and guarding a lifecycle action needs, in one read.
 *
 * Deliberately NOT `findWithQuote`: that read reassembles a `FareQuote` from
 * `ride_fare_lines` and runs `assertFareQuoteConsistent`, which THROWS — the
 * same reasoning `RidesRepository.findGeozoneId` records. Deciding whether a
 * driver owns a ride needs no fare lines. `totalCents` is here only so
 * completion can check the offer's split against the fare without a second read.
 */
export interface LifecycleRide {
  id: string;
  orderId: string;
  status: RideStatus;
  riderId: string;
  driverId: string | null;
  totalCents: number | null;
}

@Injectable()
export class RideLifecycleRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async findForAction(rideId: string): Promise<LifecycleRide | undefined> {
    const [row] = await this.db
      .select({
        id: rides.id,
        orderId: rides.orderId,
        status: rides.status,
        riderId: rides.riderId,
        driverId: rides.driverId,
        totalCents: rides.totalCents,
      })
      .from(rides)
      .where(eq(rides.id, rideId))
      .limit(1);
    return row;
  }

  /**
   * The split the driver was ACTUALLY SHOWN on the offer card they accepted.
   *
   * THE MIRROR OF THE BARREL'S CROSS-SLICE EXCEPTION. `ride_offers` is
   * dispatch's table, but `DispatchModule` already imports `RidesModule`, so
   * injecting `DispatchRepository` here would need a `forwardRef` cycle for one
   * read of one column. The narrower evil is this query, exactly as the rides
   * barrel argues for the export going the other way.
   *
   * PARSED, never cast. `fareSplitSchema`'s refinement is the no-cent-leak
   * invariant, and this is the one place a corrupted split would otherwise
   * reach a driver's earnings. The column stores the WIRE shape and the schema
   * has no `Date` fields, so a plain `.parse()` round-trips cleanly.
   */
  async findAcceptedOfferSplit(rideId: string): Promise<FareSplit | undefined> {
    const [row] = await this.db
      .select({ split: rideOffers.split })
      .from(rideOffers)
      .where(
        and(eq(rideOffers.rideId, rideId), eq(rideOffers.status, 'accepted')),
      )
      .limit(1);
    return row ? fareSplitSchema.parse(row.split) : undefined;
  }

  /**
   * The four `commission_*` columns — the SETTLED split, written once, at
   * completion, inside the caller's transaction so it commits with the status.
   * `updated_at` is left to the `rides_set_updated_at` trigger.
   */
  async writeSettledSplit(
    tx: DbTx,
    rideId: string,
    split: FareSplit,
  ): Promise<void> {
    await tx
      .update(rides)
      .set({
        commissionPct: split.commissionPct,
        commissionSource: split.commissionSource,
        commissionCents: split.commissionCents,
        driverNetCents: split.driverNetCents,
      })
      .where(eq(rides.id, rideId));
  }

  /**
   * THE LOCK ITSELF, as one conditional UPDATE.
   *
   * Ownership, existence and editability are all in the WHERE, so a driver's
   * accept cannot land between a read and a write and change the payment method
   * on an accepted ride — which is the exact hard-rule violation this route
   * exists to prevent. `false` means not-found, not-theirs or not-editable; the
   * service does a second read only to pick the right error message.
   */
  async updatePaymentMethod(
    rideId: string,
    riderId: string,
    paymentMethod: PaymentMethodType,
  ): Promise<boolean> {
    const [row] = await this.db
      .update(rides)
      .set({ paymentMethod })
      .where(
        and(
          eq(rides.id, rideId),
          eq(rides.riderId, riderId),
          inArray(rides.status, PAYMENT_METHOD_EDITABLE_STATUSES),
        ),
      )
      .returning({ id: rides.id });
    return row !== undefined;
  }

  /**
   * Clears any live offer card on a cancelled ride and HANDS BACK WHO HELD IT.
   *
   * The `RETURNING` is load-bearing, for the reason
   * `DispatchRepository.revokePendingForRide` records: the `ride:offer_revoked`
   * fan-out happens AFTER the commit, by which time these rows are `revoked`
   * and a re-query would find nothing.
   *
   * Unconditional on the ride's status: the WHERE is already conditional on
   * `pending`, and both assignment paths revoke their siblings, so a
   * post-acceptance cancel matches zero rows. A status list here would buy one
   * saved statement at the price of a hand-written list that rots.
   */
  async revokePendingOffers(
    tx: DbTx,
    rideId: string,
  ): Promise<{ offerId: string; driverId: string }[]> {
    return tx
      .update(rideOffers)
      .set({ status: 'revoked' })
      .where(
        and(eq(rideOffers.rideId, rideId), eq(rideOffers.status, 'pending')),
      )
      .returning({ offerId: rideOffers.id, driverId: rideOffers.driverId });
  }
}
