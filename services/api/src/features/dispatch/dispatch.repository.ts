import { Inject, Injectable } from '@nestjs/common';
import { dispatchAuditLog, rideOffers, type Db } from '@taxi/db';
import {
  rideAssignmentSchema,
  type AssignmentSource,
  type RideOffer,
} from '@taxi/shared';
import { and, count, eq, lte, ne, sql } from 'drizzle-orm';
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

export interface AuditEntry {
  rideId: string;
  driverId: string;
  source: AssignmentSource;
  dispatcherId?: string | null;
  reason?: string | null;
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

  async countAttempts(rideId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(rideOffers)
      .where(eq(rideOffers.rideId, rideId));
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
      payload: { assignedAt: assignment.assignedAt.toISOString() },
    });
  }
}
