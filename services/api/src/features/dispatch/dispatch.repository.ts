import { Inject, Injectable } from '@nestjs/common';
import { dispatchAuditLog, rideOffers, type Db } from '@taxi/db';
import {
  rideAssignmentSchema,
  type AssignmentSource,
  type RideOffer,
} from '@taxi/shared';
import { and, count, desc, eq, gt, inArray, lte, ne, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../common/db/db.module';
import type { DbTx } from '../rides';

type OfferRow = typeof rideOffers.$inferSelect;

/** What the cascade needs off an offer row — the jsonb columns stay untouched. */
export interface OfferRef {
  id: string;
  rideId: string;
  driverId: string;
  status: OfferRow['status'];
  source: AssignmentSource;
  queuePosition: number | null;
}

/** One offer row as the board's cascade projection reads it (#19). */
export interface CascadeOfferRow {
  rideId: string;
  driverId: string;
  status: OfferRow['status'];
  source: AssignmentSource;
  expiresAt: Date;
  etaSeconds: number;
  queuePosition: number | null;
}

export interface AuditEntry {
  rideId: string;
  driverId: string;
  source: AssignmentSource;
  dispatcherId?: string | null;
  reason?: string | null;
  /**
   * Extra context merged into the row's jsonb payload. #19's reassign writes
   * `{ event: 'released', from }` here so the trail distinguishes "a car was
   * taken OFF this ride" from "a car was put ON it" — both are dispatcher
   * rows against the same ride, and without this they read identically.
   */
  payload?: Record<string, unknown>;
}

const toRef = (row: OfferRow): OfferRef => ({
  id: row.id,
  rideId: row.rideId,
  driverId: row.driverId,
  status: row.status,
  source: row.source,
  queuePosition: row.queuePosition,
});

/**
 * All `ride_offers` and `dispatch_audit_log` access.
 *
 * EVERY WRITE TAKES AN OPTIONAL `tx`. The accept path composes four of these
 * into one transaction, and a method that could only use `this.db` would
 * silently open its own connection and commit outside the caller's transaction
 * — defeating the exact atomicity the rollback depends on.
 *
 * Expiry predicates use Postgres `now()`, never a JS `Date`: one clock, and it
 * is the one the rows were written against.
 */
@Injectable()
export class DispatchRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * The jsonb columns store WIRE shapes per the table comment, so the dates
   * inside them are serialized to ISO before insert. The `sent_at`/`expires_at`
   * COLUMNS stay real timestamps — Postgres compares them against `now()`.
   */
  async insertOffer(offer: RideOffer, tx?: DbTx): Promise<void> {
    await (tx ?? this.db).insert(rideOffers).values({
      id: offer.id,
      rideId: offer.rideId,
      driverId: offer.driverId,
      status: offer.status,
      source: offer.source,
      sentAt: offer.sentAt,
      expiresAt: offer.expiresAt,
      etaSeconds: offer.etaSeconds,
      pickup: offer.pickup,
      destination: offer.destination,
      quote: offer.quote,
      split: offer.split,
      queuePosition: offer.queuePosition ?? null,
    });
  }

  async findPendingForRide(rideId: string): Promise<OfferRef | undefined> {
    const [row] = await this.db
      .select()
      .from(rideOffers)
      .where(
        and(eq(rideOffers.rideId, rideId), eq(rideOffers.status, 'pending')),
      )
      .limit(1);
    return row ? toRef(row) : undefined;
  }

  /** Any offer row, any status — a driver gets one shot at a given ride. */
  async findTriedDriverIds(rideId: string): Promise<string[]> {
    const rows = await this.db
      .select({ driverId: rideOffers.driverId })
      .from(rideOffers)
      .where(eq(rideOffers.rideId, rideId));
    return rows.map((r) => r.driverId);
  }

  /**
   * EVERY offer row for a set of rides, in ONE query — the board's cascade
   * projection (#19).
   *
   * Deliberately not three calls. `findPendingForRide`, `countAttempts` and
   * `findTriedDriverIds` each answer part of this and are each per-RIDE; the
   * board rebuilds every 2 s over up to `BOARD_RIDES_LIMIT` rides, so using
   * them would put 3 × N queries on a 30-per-minute loop. Every one of those
   * three answers is derivable from these rows in JS (see `board/cascade.ts`),
   * so the extra round trips buy nothing.
   *
   * The jsonb columns are NOT selected: the cascade strip shows names and a
   * countdown, and dragging four blobs per offer through the frame builder
   * would be the expensive part of an otherwise trivial read.
   */
  async findOffersForRides(rideIds: string[]): Promise<CascadeOfferRow[]> {
    if (rideIds.length === 0) return [];
    return this.db
      .select({
        rideId: rideOffers.rideId,
        driverId: rideOffers.driverId,
        status: rideOffers.status,
        source: rideOffers.source,
        expiresAt: rideOffers.expiresAt,
        etaSeconds: rideOffers.etaSeconds,
        queuePosition: rideOffers.queuePosition,
      })
      .from(rideOffers)
      .where(inArray(rideOffers.rideId, rideIds));
  }

  /**
   * When the ride last re-entered the pool by a DISPATCHER RELEASE (#19), or
   * `null` if it never has — which is every ride that was booked and cascaded
   * normally.
   *
   * Read off the release audit row rather than a column on `rides`, because the
   * row is already written and a column would be a migration carrying a fact
   * the audit trail holds anyway. Matched on `payload->>'event'` and not on
   * `source = 'dispatcher'`: a force-assign writes a dispatcher row too, and
   * that one marks the ride LEAVING the pool.
   *
   * Both callers pass the result to `countAttempts` and to the unclaimed clock,
   * so the cap and the staleness age answer the same question — how long has
   * this ride been without a car SINCE Dina took the last one off it.
   *
   * COST: one indexed read per awaiting ride per sweeper pass, and the sweeper
   * runs this in two of its three passes — `derived`, worst case 2 ×
   * `AWAITING_BATCH_LIMIT` = 40 extra queries per second, at the full batch.
   * Both loops were already per-ride (`findPendingForRide`, `countAttempts`),
   * so this widens an existing N+1 rather than introducing one.
   * `dispatch_audit_log_ride_idx` covers the `ride_id` half; the jsonb filter
   * and the sort then run over that ride's handful of audit rows. At pilot volume the
   * batch is nowhere near 20; if the sweeper ever runs full batches, this and
   * its two siblings should become one batched read, not three.
   */
  async findLastReleasedAt(rideId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ at: dispatchAuditLog.createdAt })
      .from(dispatchAuditLog)
      .where(
        and(
          eq(dispatchAuditLog.rideId, rideId),
          sql`${dispatchAuditLog.payload}->>'event' = 'released'`,
        ),
      )
      .orderBy(desc(dispatchAuditLog.createdAt))
      .limit(1);
    return row?.at ?? null;
  }

  /**
   * Cascade attempts on a ride, counted from `since` when the ride has been
   * released back into the pool.
   *
   * `MAX_OFFER_ATTEMPTS` bounds "a ride that would otherwise cycle candidates
   * forever" — a bound on ONE dispatch problem. A released ride is a new one:
   * without the cutoff a ride that cascaded through a few candidates before it
   * was accepted sits at or over the cap the moment Dina releases it, and the
   * cascade the release hands it to declines to offer at all (#120 review H3).
   *
   * `since` IS REQUIRED, AND `null` HAS TO BE WRITTEN OUT. An optional
   * parameter defaulting to "count everything" is the old behaviour under a new
   * name: a caller added later would compile, pass the suite, and quietly
   * reinstate H3 — the same argument `unassignDriver` makes for putting its
   * guard in the WHERE. Pass `findLastReleasedAt`'s result, or `null` to ask
   * the genuinely different question "how many offers has this ride ever had".
   */
  async countAttempts(rideId: string, since: Date | null): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(rideOffers)
      .where(
        and(
          eq(rideOffers.rideId, rideId),
          ...(since ? [gt(rideOffers.sentAt, since)] : []),
        ),
      );
    return row?.value ?? 0;
  }

  /** Pending offers whose deadline has passed, by the database's clock. */
  async findOverdue(limit: number): Promise<OfferRef[]> {
    const rows = await this.db
      .select()
      .from(rideOffers)
      .where(
        and(
          eq(rideOffers.status, 'pending'),
          lte(rideOffers.expiresAt, sql`now()`),
        ),
      )
      .limit(limit);
    return rows.map(toRef);
  }

  /**
   * Drivers currently holding a LIVE card on any ride — #61 chain B: one card
   * per driver platform-wide. Liveness matches `acceptOffer`'s predicate
   * (`pending` + unexpired, by Postgres's clock), so a card this query counts
   * is exactly a card its holder could still accept.
   */
  async findDriverIdsWithLiveOffers(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ driverId: rideOffers.driverId })
      .from(rideOffers)
      .where(
        and(
          eq(rideOffers.status, 'pending'),
          sql`${rideOffers.expiresAt} > now()`,
        ),
      );
    return rows.map((r) => r.driverId);
  }

  /**
   * Race-safe accept: only a PENDING offer, only by the driver it was made to,
   * and only before it expired. `undefined` means someone else won or the
   * deadline passed — a 409, never a 500.
   */
  async acceptOffer(
    offerId: string,
    driverId: string,
    tx?: DbTx,
  ): Promise<OfferRef | undefined> {
    const [row] = await (tx ?? this.db)
      .update(rideOffers)
      .set({ status: 'accepted' })
      .where(
        and(
          eq(rideOffers.id, offerId),
          eq(rideOffers.driverId, driverId),
          eq(rideOffers.status, 'pending'),
          sql`${rideOffers.expiresAt} > now()`,
        ),
      )
      .returning();
    return row ? toRef(row) : undefined;
  }

  async declineOffer(
    offerId: string,
    driverId: string,
    tx?: DbTx,
  ): Promise<OfferRef | undefined> {
    const [row] = await (tx ?? this.db)
      .update(rideOffers)
      .set({ status: 'declined' })
      .where(
        and(
          eq(rideOffers.id, offerId),
          eq(rideOffers.driverId, driverId),
          eq(rideOffers.status, 'pending'),
        ),
      )
      .returning();
    return row ? toRef(row) : undefined;
  }

  async expireOffer(offerId: string, tx?: DbTx): Promise<OfferRef | undefined> {
    const [row] = await (tx ?? this.db)
      .update(rideOffers)
      .set({ status: 'expired' })
      .where(and(eq(rideOffers.id, offerId), eq(rideOffers.status, 'pending')))
      .returning();
    return row ? toRef(row) : undefined;
  }

  /**
   * Revokes every other live offer on a ride and HANDS BACK WHO HELD THEM.
   *
   * The `RETURNING` is load-bearing. The `ride:offer_revoked` fan-out happens
   * AFTER the commit, and by then these rows are `revoked` — a
   * find-the-pending-offers query would return nothing and the other drivers'
   * offer cards would never clear. The ids have to travel out of the
   * transaction with the result; there is no second chance to read them.
   */
  async revokePendingForRide(
    rideId: string,
    exceptOfferId?: string,
    tx?: DbTx,
  ): Promise<{ offerId: string; driverId: string }[]> {
    const rows = await (tx ?? this.db)
      .update(rideOffers)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(rideOffers.rideId, rideId),
          eq(rideOffers.status, 'pending'),
          ...(exceptOfferId ? [ne(rideOffers.id, exceptOfferId)] : []),
        ),
      )
      .returning({ offerId: rideOffers.id, driverId: rideOffers.driverId });
    return rows;
  }

  /**
   * Retires the OUTGOING driver's accepted offer when a dispatcher releases the
   * ride (#19). `revokePendingForRide` cannot do this — it matches `pending`,
   * and by acceptance the row is `accepted`.
   *
   * THE AT-MOST-ONE-ACCEPTED-OFFER INVARIANT IS A MONEY INVARIANT, not
   * bookkeeping. `findAcceptedOfferSplit` reads the accepted row with `LIMIT 1`
   * and no `ORDER BY` to settle the ride, and the split it reads is
   * driver-specific (`resolveCommissionPct` applies the driver's override). Two
   * accepted rows and completion settles on whichever the heap yields — the
   * outgoing driver's commission paid to the incoming one, silently, with the
   * rider-facing total unchanged so no total-cents guard fires (#120 review C1).
   *
   * `false` means there was no accepted row to retire, which is a data
   * impossibility rather than a state to handle: both assignment paths write
   * one. Reported to the caller to log rather than thrown — refusing the
   * release would pin the ride to the driver Dina has already rejected, the
   * exact outcome `ReassignService`'s two-transaction split exists to avoid.
   */
  async supersedeAcceptedOffer(
    rideId: string,
    driverId: string,
    tx?: DbTx,
  ): Promise<boolean> {
    const rows = await (tx ?? this.db)
      .update(rideOffers)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(rideOffers.rideId, rideId),
          eq(rideOffers.driverId, driverId),
          eq(rideOffers.status, 'accepted'),
        ),
      )
      .returning({ offerId: rideOffers.id });
    return rows.length > 0;
  }

  /**
   * The S9-2 audit trail. Parsed through `rideAssignmentSchema` FIRST so the
   * "dispatcher assignments require dispatcherId" refine fires at the write
   * boundary — the DDL deliberately does not enforce it (see the table
   * docblock), which makes this parse the only thing standing between an
   * override and an unauditable one.
   *
   * The contract object carries `assignedAt`; the table has `created_at` with a
   * default. Parse the contract, then map onto the columns — do not bend either
   * shape to fit the other.
   */
  async insertAudit(entry: AuditEntry, tx?: DbTx): Promise<void> {
    const assignment = rideAssignmentSchema.parse({
      rideId: entry.rideId,
      driverId: entry.driverId,
      source: entry.source,
      dispatcherId: entry.dispatcherId ?? null,
      reason: entry.reason ?? null,
      assignedAt: new Date(),
    });

    await (tx ?? this.db).insert(dispatchAuditLog).values({
      rideId: assignment.rideId,
      driverId: assignment.driverId,
      source: assignment.source,
      dispatcherId: assignment.dispatcherId,
      reason: assignment.reason,
      payload: {
        assignedAt: assignment.assignedAt.toISOString(),
        ...entry.payload,
      },
    });
  }

  /**
   * Who booked on whose behalf (#19). A SEPARATE method from `insertAudit`
   * because it cannot go through `rideAssignmentSchema`: that contract requires
   * a `driverId`, and a phone order has no driver yet — the cascade gives it one
   * seconds later, and that assignment writes its own row.
   *
   * `driverId: null` is therefore what distinguishes a booking row from an
   * assignment row on the same ride, without a second enum value.
   */
  async insertBookingAudit(entry: {
    rideId: string;
    dispatcherId: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(dispatchAuditLog).values({
      rideId: entry.rideId,
      driverId: null,
      source: 'dispatcher',
      dispatcherId: entry.dispatcherId,
      reason: null,
      payload: {
        event: 'booked_on_behalf',
        bookedAt: new Date().toISOString(),
        ...entry.payload,
      },
    });
  }
}
