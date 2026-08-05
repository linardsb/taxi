import { Inject, Injectable } from '@nestjs/common';
import { rideFareLines, rides, type Db } from '@taxi/db';
import {
  rideSchema,
  type FareQuote,
  type Ride,
  type RideRequest,
} from '@taxi/shared';
import { DRIZZLE } from '../../common/db/db.module';
import { assertEntryStatus, type RideEntryStatus } from './ride-entry';

type RideRow = typeof rides.$inferSelect;
/** The ride id is added once the insert returns it. */
type FareLineDraft = Omit<typeof rideFareLines.$inferInsert, 'rideId'>;

export interface CreateRideInput {
  orderId: string;
  /**
   * Narrower than `RideStatus` on purpose: `entryStatusFor` already returns
   * this, so a mid-lifecycle status is rejected by the COMPILER at the call
   * site. `assertEntryStatus` still guards at runtime, for callers TypeScript
   * does not see.
   */
  status: RideEntryStatus;
  request: RideRequest;
  quote: FareQuote;
}

/**
 * Parsed rather than cast: `request` round-trips through jsonb, so
 * `scheduledFor` comes back as an ISO STRING and `rideSchema`'s
 * `z.coerce.date()` is what re-hydrates it into a `Date`.
 */
function toRide(row: RideRow, quote: FareQuote): Ride {
  return rideSchema.parse({
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    riderId: row.riderId,
    driverId: row.driverId,
    geozoneId: row.geozoneId,
    request: row.request,
    quote,
    assignment: null,
    split: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

@Injectable()
export class RidesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Writes the ride and its fare lines in ONE transaction: a ride without its
   * breakdown is a ride #11 cannot settle and #20 cannot report off.
   *
   * `request` is stored as the wire snapshot — the audit record of "what was
   * asked" — per the jsonb-vs-columns rule on the table.
   *
   * Deliberately unset: `driverId` and `geozoneId` (no dispatch yet — zone
   * precedence is #10's), and all four `commission_*` columns, which carry the
   * SETTLED split and belong to #11. Writing a preview split into them would
   * make an estimate look like a settlement.
   */
  async create(input: CreateRideInput): Promise<Ride> {
    assertEntryStatus(input.status);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(rides)
        .values({
          orderId: input.orderId,
          status: input.status,
          riderId: input.request.riderId,
          request: input.request,
          scheduledFor: input.request.scheduledFor ?? null,
          paymentMethod: input.request.paymentMethod,
          category: input.request.category,
          pricingModel: input.quote.model,
          totalCents: input.quote.totalCents,
        })
        .returning();

      if (!row) {
        throw new Error('rides insert returned no row');
      }

      const breakdown = input.quote.breakdown;
      const lines: FareLineDraft[] = [
        { lineType: 'base', amountCents: breakdown.baseCents, sort: 0 },
        { lineType: 'distance', amountCents: breakdown.distanceCents, sort: 1 },
        { lineType: 'time', amountCents: breakdown.timeCents, sort: 2 },
      ];
      // A zero discount line is noise in #11's settlement read.
      if (breakdown.discountCents !== 0) {
        lines.push({
          lineType: 'discount',
          amountCents: breakdown.discountCents,
          sort: 3,
        });
      }

      await tx
        .insert(rideFareLines)
        .values(lines.map((line) => ({ rideId: row.id, ...line })));

      return toRide(row, input.quote);
    });
  }
}
