import { Inject, Injectable } from '@nestjs/common';
import { drivers, ledgerAccounts, ledgerEntries, type Db } from '@taxi/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type DbTx } from '../../common/db/db.module';
import type { LedgerEntryType, LedgerOwnerType } from './settlement-entries';

/** One row of the reconciliation read, joined to its account's owner. */
export interface LedgerEntryRow {
  id: string;
  transactionId: string;
  rideId: string | null;
  ownerType: LedgerOwnerType;
  ownerId: string | null;
  entryType: LedgerEntryType;
  amountCents: number;
  createdAt: Date;
}

export interface EntryInsert {
  accountId: string;
  entryType: LedgerEntryType;
  amountCents: number;
}

@Injectable()
export class LedgerRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Get-or-create, on the caller's transaction.
   *
   * `onConflictDoNothing()` with NO target: `ledger_accounts_owner_uix` is
   * `NULLS NOT DISTINCT` (so the platform account, `owner_id NULL`, dedupes
   * too), and drizzle's target inference on a nulls-not-distinct index is one
   * more thing to be wrong about. The table has exactly one unique constraint,
   * so a bare conflict clause is unambiguous.
   *
   * Two settlements racing to create the SAME account row block until the other
   * commits. Accepted at pilot scale (≤10 drivers) and stated rather than
   * papered over with an advisory lock — `LedgerService` resolves accounts in a
   * stable order, so they block rather than deadlock.
   */
  async accountFor(
    tx: DbTx,
    ownerType: LedgerOwnerType,
    ownerId: string | null,
  ): Promise<string> {
    const [created] = await tx
      .insert(ledgerAccounts)
      .values({ ownerType, ownerId })
      .onConflictDoNothing()
      .returning({ id: ledgerAccounts.id });
    if (created) return created.id;

    const [found] = await tx
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.ownerType, ownerType),
          ownerId === null
            ? isNull(ledgerAccounts.ownerId)
            : eq(ledgerAccounts.ownerId, ownerId),
        ),
      )
      .limit(1);
    if (found) return found.id;

    throw new Error(
      `ledger_accounts insert for (${ownerType}, ${ownerId ?? 'NULL'}) conflicted but no existing row matched. That combination is impossible while ledger_accounts_owner_uix exists — check whether the unique index was dropped.`,
    );
  }

  /** The entries of one settlement, sharing a `transactionId`. */
  async insertEntries(
    tx: DbTx,
    transactionId: string,
    rideId: string,
    rows: EntryInsert[],
  ): Promise<void> {
    await tx
      .insert(ledgerEntries)
      .values(rows.map((row) => ({ transactionId, rideId, ...row })));
  }

  /**
   * RELATIVE, never read-modify-write. Two settlements for one driver commit
   * concurrently; `balance = balance + delta` is the only form where both land.
   * A read-then-write here is the single easiest way to lose a driver's money in
   * this slice, and it would show up as a balance that silently disagrees with
   * the ledger rather than as an error.
   *
   * `deltaCents` is a `sql` template value, so drizzle parameterises it — never
   * string-concatenate it in.
   */
  async applyDriverBalanceDelta(
    tx: DbTx,
    driverId: string,
    deltaCents: number,
  ): Promise<void> {
    await tx
      .update(drivers)
      .set({ balanceCents: sql`${drivers.balanceCents} + ${deltaCents}` })
      .where(eq(drivers.userId, driverId));
  }

  /**
   * Every entry for one ride, oldest first — the reconciliation read
   * `ledger_entries_ride_idx` exists to serve (the deferred PR #32 finding).
   * #20 renders it; the payments integration spec asserts through it.
   */
  findByRide(rideId: string): Promise<LedgerEntryRow[]> {
    return this.db
      .select({
        id: ledgerEntries.id,
        transactionId: ledgerEntries.transactionId,
        rideId: ledgerEntries.rideId,
        ownerType: ledgerAccounts.ownerType,
        ownerId: ledgerAccounts.ownerId,
        entryType: ledgerEntries.entryType,
        amountCents: ledgerEntries.amountCents,
        createdAt: ledgerEntries.createdAt,
      })
      .from(ledgerEntries)
      .innerJoin(ledgerAccounts, eq(ledgerEntries.accountId, ledgerAccounts.id))
      .where(eq(ledgerEntries.rideId, rideId))
      .orderBy(asc(ledgerEntries.createdAt));
  }
}
