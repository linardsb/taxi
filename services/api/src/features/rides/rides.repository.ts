import { Inject, Injectable, Logger } from '@nestjs/common';
import { rideFareLines, rides, users, vehicles, type Db } from '@taxi/db';
import {
  ACTIVE_DRIVER_RIDE_STATUSES,
  BOARD_LIVE_RIDE_STATUSES,
  assertFareQuoteConsistent,
  fareQuoteSchema,
  rideRequestSchema,
  rideSchema,
  type AddressPoint,
  type BoardRideStatus,
  type BookingChannel,
  type FareQuote,
  type Ride,
  type RideRequest,
  type RideStatus,
} from '@taxi/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
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

/**
 * The board needs the pickup and nothing else off the request snapshot, so it
 * validates the pickup and nothing else — see `findBoardRides`.
 */
const boardPickupSchema = rideRequestSchema.pick({ pickup: true });

const BOARD_STATUS_SET = new Set<string>(BOARD_LIVE_RIDE_STATUSES);

/**
 * The statuses `unassignDriver` will take a car off — see its docblock for why
 * `requested` is in the set and `arrived`/`in_progress` are not.
 */
const UNASSIGNABLE_RIDE_STATUSES = [
  'requested',
  'accepted',
  'arriving',
] as const satisfies readonly RideStatus[];

/**
 * The board query's `inArray` already constrains this, but that guarantee
 * lives in SQL where the type system cannot see it. A checked guard rather
 * than a cast: `BoardRide.status` is what the wire schema demands, and an
 * assertion here would be the one unverified step between the two.
 */
const isBoardStatus = (status: RideStatus): status is BoardRideStatus =>
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
  /** How the booking arrived (#63) — the rider app's path always says 'app'. */
  bookingChannel: BookingChannel;
  /** Minted by the caller (notifications' `mintTrackingToken`) — every ride gets one. */
  trackingToken: string;
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
function toRide(row: RideRow, quote: FareQuote): Ride {
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

@Injectable()
export class RidesRepository {
  private readonly logger = new Logger(RidesRepository.name);

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
          bookingChannel: input.bookingChannel,
          trackingToken: input.trackingToken,
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
   * Which drivers are pinned to a ride right now, for #19's override picker —
   * so Dina is warned before she takes a car off a job it is already on.
   *
   * Reads the RIDES table, not `drivers.status`: that column is a derived
   * cache and this is exactly the read that must not inherit its lie (the same
   * reason #61 gates going-online on this set rather than on the status).
   */
  async findActiveRideIdsByDriver(): Promise<
    Array<{ driverId: string; rideId: string }>
  > {
    const rows = await this.db
      .select({ driverId: rides.driverId, rideId: rides.id })
      .from(rides)
      .where(inArray(rides.status, [...ACTIVE_DRIVER_RIDE_STATUSES]));
    // `driver_id` is nullable on the table but never null in these statuses —
    // filtered rather than asserted, because a cast here would be the one
    // unverified step between the SQL guarantee and the type.
    return rows.flatMap((r) =>
      r.driverId === null ? [] : [{ driverId: r.driverId, rideId: r.rideId }],
    );
  }

  /**
   * Every LIVE ride for Dina's board (#18), oldest first — `findAwaitingDispatch`
   * widened to the whole pre-terminal lifecycle, plus the driver's display name
   * in the same read (the board would otherwise need a query per assigned ride
   * every 2 s frame). `rides_status_idx` covers the predicate here too.
   *
   * ONE UNREADABLE ROW COSTS ONE CARD, NEVER THE BOARD. `rides.request` is an
   * audit snapshot written at creation and never migrated, so a later required
   * field on `rideRequestSchema` makes older live rows unparseable. A whole-
   * schema `.parse()` here would then reject the read on both transports at
   * once — `GET /dispatch/board` 500s and every 2 s beat emits nothing — until
   * that row leaves the live window, which includes `accepted`/`in_progress`
   * and can be a long time. So: validate only the field the board renders, per
   * row, and drop the row that fails.
   *
   * `toAwaiting`'s full parse deliberately stays strict — the sweeper
   * dispatches off `category`/`options`/`paymentMethod`, so a degraded request
   * there would silently mis-dispatch rather than omit a card.
   */
  async findBoardRides(limit: number): Promise<BoardRide[]> {
    const rows = await this.db
      .select({ ride: rides, driverName: users.displayName })
      .from(rides)
      .leftJoin(users, eq(users.id, rides.driverId))
      .where(inArray(rides.status, [...BOARD_LIVE_RIDE_STATUSES]))
      .orderBy(asc(rides.createdAt))
      .limit(limit);
    return rows.flatMap(({ ride, driverName }) => {
      const parsed = boardPickupSchema.safeParse(ride.request);
      if (!parsed.success || !isBoardStatus(ride.status)) {
        this.logger.warn({
          event: 'dispatch.board.ride_unreadable',
          rideId: ride.id,
          status: ride.status,
          reason: parsed.success
            ? 'status outside the board window'
            : (parsed.error.issues[0]?.message ?? 'unknown'),
          at: new Date().toISOString(),
        });
        return [];
      }
      return [
        {
          id: ride.id,
          status: ride.status,
          pickup: parsed.data.pickup,
          driverId: ride.driverId,
          driverName,
          bookingChannel: ride.bookingChannel,
          createdAt: ride.createdAt,
          geozoneId: ride.geozoneId,
        },
      ];
    });
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
   * The sole writer of BOTH assignment columns: `driver_id` and, since #86,
   * `vehicle_id`. The vehicle-resolution rule lives here and nowhere else —
   * the driver's vehicle in the ride's category, else their first by plate
   * (deterministic), else NULL.
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
      .set({
        driverId,
        // The vehicle the rider will match at the kerb, frozen at assignment:
        // the driver's vehicle in the ride's category, else their first by
        // plate (deterministic), else NULL — a force-assigned driver may own
        // no car at all, and refusing the assignment for that would break S9-2.
        vehicleId: sql`(
          select v.id from ${vehicles} as v
          where v.driver_id = ${driverId}
          order by (v.category = ${rides.category}) desc, v.plate asc
          limit 1
        )`,
      })
      .where(and(eq(rides.id, rideId), isNull(rides.driverId)))
      .returning({ id: rides.id });
    return row !== undefined;
  }

  /**
   * Takes the car back off a ride (#19's reassign) — the exact inverse of
   * `assignDriver`, including the vehicle stamp.
   *
   * Conditional on the ride STILL carrying the driver being released, so two
   * dispatchers reassigning the same ride cannot both proceed: the second
   * matches nothing and gets a 409 instead of clearing a driver the first one
   * already replaced. `assignDriver` guards on `isNull(driverId)` for the
   * mirror-image reason, and the pair is what lets a reassign be a release
   * followed by an ordinary force-assign.
   *
   * The STATUS predicate defends the method rather than the caller. Today the
   * only caller is behind `assertTransition`, so the "no car off a ride the
   * driver has reached" rule already holds — but this is exported through the
   * rides barrel, and the next caller inherits nothing from that guard. Its
   * sibling `setOnlineIfEligible` makes the same argument at length: the check
   * belongs in the WHERE (#120 review L2).
   *
   * IT IS NOT `['accepted','arriving']`, which is what the caller's own guard
   * checks. `ReassignService` moves the ride to `requested` FIRST and clears
   * the driver second, both inside one transaction, so by the time this runs
   * the row already reads `requested` — that set would match nothing and every
   * release would 409. What this refuses is the case the rule is about: a
   * driver standing at the pickup (`arrived`), carrying the passenger
   * (`in_progress`), or on a ride that has already ended.
   */
  async unassignDriver(
    rideId: string,
    driverId: string,
    tx?: DbTx,
  ): Promise<boolean> {
    const [row] = await (tx ?? this.db)
      .update(rides)
      .set({ driverId: null, vehicleId: null })
      .where(
        and(
          eq(rides.id, rideId),
          eq(rides.driverId, driverId),
          inArray(rides.status, [...UNASSIGNABLE_RIDE_STATUSES]),
        ),
      )
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
