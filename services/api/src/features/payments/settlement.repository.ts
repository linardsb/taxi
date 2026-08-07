import { Inject, Injectable } from '@nestjs/common';
import { rides, users, type Db } from '@taxi/db';
import type {
  CommissionSource,
  PaymentMethodType,
  RideStatus,
} from '@taxi/shared';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DbTx } from '../../common/db/db.module';

/**
 * Everything deciding a settlement needs, in ONE read — the ride's status and
 * settled split, plus the rider's two payment refs.
 *
 * Deliberately NOT `RidesRepository.findWithQuote`: that read reassembles a
 * `FareQuote` from `ride_fare_lines` and runs `assertFareQuoteConsistent`, which
 * THROWS — the same reasoning `RideLifecycleRepository.findForAction` records.
 * Deciding whether a ride can settle needs no fare lines.
 *
 * The rider's refs are JOINED here rather than fetched by a second service call
 * because a settlement is one decision and wants one consistent read.
 */
export interface SettlableRide {
  id: string;
  orderId: string;
  status: RideStatus;
  riderId: string;
  driverId: string | null;
  /**
   * The OPERATIVE method (`rides.payment_method`), never
   * `ride.request.paymentMethod`. The two legitimately diverge once a rider
   * switches before acceptance, and the request snapshot is immutable history —
   * this is the ticket where reading the wrong one charges the wrong way.
   */
  paymentMethod: PaymentMethodType;
  totalCents: number | null;
  commissionPct: number | null;
  commissionSource: CommissionSource | null;
  commissionCents: number | null;
  driverNetCents: number | null;
  riderCustomerRef: string | null;
  riderInstrumentRef: string | null;
}

@Injectable()
export class SettlementRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async findSettlable(rideId: string): Promise<SettlableRide | undefined> {
    const [row] = await this.db
      .select({
        id: rides.id,
        orderId: rides.orderId,
        status: rides.status,
        riderId: rides.riderId,
        driverId: rides.driverId,
        paymentMethod: rides.paymentMethod,
        totalCents: rides.totalCents,
        commissionPct: rides.commissionPct,
        commissionSource: rides.commissionSource,
        commissionCents: rides.commissionCents,
        driverNetCents: rides.driverNetCents,
        riderCustomerRef: users.paymentCustomerRef,
        riderInstrumentRef: users.paymentInstrumentRef,
      })
      .from(rides)
      .innerJoin(users, eq(rides.riderId, users.id))
      .where(eq(rides.id, rideId))
      .limit(1);
    return row;
  }

  /**
   * The charge handle, written inside the caller's transaction so it commits
   * with the status change and the ledger entries. `updated_at` is left to the
   * `rides_set_updated_at` trigger.
   */
  async writePaymentRef(
    tx: DbTx,
    rideId: string,
    providerRef: string,
  ): Promise<void> {
    await tx
      .update(rides)
      .set({ paymentProviderRef: providerRef })
      .where(eq(rides.id, rideId));
  }
}
