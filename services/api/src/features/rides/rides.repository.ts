import { Inject, Injectable } from '@nestjs/common';
import { rideFareLines, rides, type Db } from '@taxi/db';
import {
  assertFareQuoteConsistent,
  fareQuoteSchema,
  rideRequestSchema,
  rideSchema,
  type FareQuote,
  type Ride,
  type RideRequest,
} from '@taxi/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../../common/db/db.module';
import { assertEntryStatus, type RideEntryStatus } from './ride-entry';
import type { DbTx } from './ride-transition.service';

type RideRow = typeof rides.$inferSelect;

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
function toAwaiting(row: RideRow): AwaitingRide {
  return {
    id: row.id,
    orderId: row.orderId,
    riderId: row.riderId,
    geozoneId: row.geozoneId,
    request: rideRequestSchema.parse(row.request),
    createdAt: row.createdAt,
  };
}
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

  /**
   * The sweeper's work queue: rides waiting for a driver, oldest first.
   * Runs every tick; `rides_status_idx` already covers the predicate.
   */
  async findAwaitingDispatch(limit: number): Promise<AwaitingRide[]> {
    const rows = await this.db
      .select()
      .from(rides)
      .where(and(eq(rides.status, 'requested'), isNull(rides.driverId)))
      .orderBy(asc(rides.createdAt))
      .limit(limit);
    return rows.map(toAwaiting);
  }

  /**
   * Reads a ride back WITH its fare quote, reassembled from `total_cents` plus
   * the `ride_fare_lines` rows.
   *
   * This is the codebase's first reader of `ride_fare_lines` — `create()` writes
   * them and `toRide` takes the quote as an argument because the write path
   * already held it. The offer card cannot be built without it: the driver sees
   * the full fare the RIDER pays (S2-5), and re-quoting mid-cascade would spend
   * a paid Routes call per offer and could change the price after the rider
   * already agreed to it.
   *
   * `undefined` for a ride that was never quoted — not dispatchable, and a
   * half-built quote would land on a driver's card.
   *
   * The quote is returned alongside the `Ride` rather than read off `ride.quote`
   * because `rideSchema` types that field `FareQuote | null`; handing callers a
   * non-nullable quote is what keeps `buildOffer` free of a `!`.
   */
  async findWithQuote(
    rideId: string,
  ): Promise<{ ride: Ride; quote: FareQuote } | undefined> {
    const [row] = await this.db
      .select()
      .from(rides)
      .where(eq(rides.id, rideId))
      .limit(1);
    if (!row) return undefined;
    if (row.pricingModel === null || row.totalCents === null) return undefined;

    const lines = await this.db
      .select()
      .from(rideFareLines)
      .where(eq(rideFareLines.rideId, rideId));

    // `create()` deliberately omits a zero discount line ("noise in #11's
    // settlement read"), so an absent line is 0 — expecting a row here would
    // make every ordinary ride fail to dispatch.
    const amountOf = (lineType: (typeof lines)[number]['lineType']): number =>
      lines.find((line) => line.lineType === lineType)?.amountCents ?? 0;

    const quote = fareQuoteSchema.parse({
      model: row.pricingModel,
      currency: 'EUR',
      totalCents: row.totalCents,
      breakdown: {
        baseCents: amountOf('base'),
        distanceCents: amountOf('distance'),
        timeCents: amountOf('time'),
        discountCents: amountOf('discount'),
      },
    });

    // Only where the model says it must hold: for `rider_bid` the total is the
    // rider's own offer and the breakdown is an estimate, so requiring them to
    // agree "would make an honest bid unrepresentable"
    // (`isFareQuoteConsistent`). For every other model a mismatch is a real
    // data bug and must fail here, not on a driver's offer card.
    if (quote.model !== 'rider_bid') assertFareQuoteConsistent(quote);

    return { ride: toRide(row, quote), quote };
  }

  /**
   * Claims the ride for a driver, but ONLY while it has none — the race-safe
   * conditional UPDATE the whole cascade depends on. `false` means someone else
   * won, which is a 409 and never a 500.
   *
   * `tx` composes this into the accept path's transaction, where the offer
   * accept, the status change, this write and the audit row must commit or roll
   * back together. Without it this would silently commit outside the caller's
   * transaction and defeat that atomicity.
   */
  async assignDriver(
    rideId: string,
    driverId: string,
    tx?: DbTx,
  ): Promise<boolean> {
    const [row] = await (tx ?? this.db)
      .update(rides)
      .set({ driverId })
      .where(and(eq(rides.id, rideId), isNull(rides.driverId)))
      .returning({ id: rides.id });
    return row !== undefined;
  }

  /**
   * The pickup zone alone.
   *
   * Deliberately NOT `findWithQuote`: the decline path needs one nullable uuid,
   * and reassembling a `FareQuote` for it would read `ride_fare_lines` and run
   * `assertFareQuoteConsistent` — which THROWS on an inconsistent quote. That
   * throw would land after the offer row was already flipped to `declined`,
   * leaving the ride at `offered` with no pending offer: invisible to
   * `dispatchAwaitingRides`, which filters on `requested`, so the cascade would
   * die silently.
   */
  async findGeozoneId(rideId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ geozoneId: rides.geozoneId })
      .from(rides)
      .where(eq(rides.id, rideId))
      .limit(1);
    return row?.geozoneId ?? null;
  }

  /** Persists the resolved pickup zone; only ever written once, from null. */
  async setGeozone(rideId: string, geozoneId: string): Promise<void> {
    await this.db
      .update(rides)
      .set({ geozoneId })
      .where(and(eq(rides.id, rideId), isNull(rides.geozoneId)));
  }
}
