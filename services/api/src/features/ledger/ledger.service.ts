import { Injectable, Logger } from '@nestjs/common';
import {
  driverEarningsTodaySchema,
  type DriverEarningsToday,
} from '@taxi/shared';
import { randomUUID } from 'node:crypto';
import type { DbTx } from '../../common/db/db.module';
import { LEDGER_DAY_TIMEZONE } from './ledger.policy';
import { LedgerRepository, type EntryInsert } from './ledger.repository';
import {
  buildSettlementEntries,
  driverBalanceDelta,
  type LedgerOwnerType,
  type SettlementInput,
} from './settlement-entries';

export type PostRideSettlementInput = SettlementInput & { rideId: string };

export interface PostedSettlement {
  transactionId: string;
  balanceDeltaCents: number;
}

/**
 * Resolution order for ledger accounts. FIXED, and the reason is concurrency:
 * two settlements that touch the same accounts take the same row locks in the
 * same sequence, so they block rather than deadlock.
 */
const ACCOUNT_ORDER: LedgerOwnerType[] = ['platform', 'rider', 'driver'];

/**
 * The posting engine, and the ONLY writer of `ledger_entries`, `ledger_accounts`
 * and `drivers.balance_cents`-as-money.
 *
 * TAKES `tx`, NEVER OPENS ITS OWN. The ledger post must commit or roll back with
 * the `completed → settled` transition; a service that opened its own
 * transaction would make a half-settled ride reachable — money moved, status
 * unchanged, or the reverse. Mirrors `RideLifecycleRepository.writeSettledSplit`.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly ledger: LedgerRepository) {}

  async postRideSettlement(
    tx: DbTx,
    input: PostRideSettlementInput,
  ): Promise<PostedSettlement> {
    const entries = buildSettlementEntries(input);
    // Random, not derived: it does not need to be idempotent, because the
    // `completed → settled` transition already guarantees this runs at most once
    // per ride. It only has to group these rows and no others.
    const transactionId = randomUUID();

    const accountIds = new Map<string, string>();
    const key = (ownerType: LedgerOwnerType, ownerId: string | null) =>
      `${ownerType}:${ownerId ?? ''}`;

    for (const ownerType of ACCOUNT_ORDER) {
      for (const entry of entries) {
        if (entry.ownerType !== ownerType) continue;
        const k = key(entry.ownerType, entry.ownerId);
        if (accountIds.has(k)) continue;
        accountIds.set(
          k,
          await this.ledger.accountFor(tx, entry.ownerType, entry.ownerId),
        );
      }
    }

    const rows: EntryInsert[] = entries.map((entry) => {
      const accountId = accountIds.get(key(entry.ownerType, entry.ownerId));
      if (!accountId) {
        throw new Error(
          `No ledger account resolved for (${entry.ownerType}, ${entry.ownerId ?? 'NULL'}) on ride ${input.rideId}. Every owner type an entry can carry must appear in ACCOUNT_ORDER.`,
        );
      }
      return {
        accountId,
        entryType: entry.entryType,
        amountCents: entry.amountCents,
      };
    });

    await this.ledger.insertEntries(tx, transactionId, input.rideId, rows);

    const balanceDeltaCents = driverBalanceDelta(entries, input.driverId);
    await this.ledger.applyDriverBalanceDelta(
      tx,
      input.driverId,
      balanceDeltaCents,
    );

    // Logging inside the transaction is fine and is NOT the socket-emit rule: a
    // log line has no observer that can act on it before the commit.
    this.logger.log({
      event: 'payment.ledger.settlement_written',
      rideId: input.rideId,
      driverId: input.driverId,
      riderId: input.riderId,
      paymentMethod: input.paymentMethod,
      transactionId,
      totalCents: input.split.totalCents,
      commissionCents: input.split.commissionCents,
      driverNetCents: input.split.driverNetCents,
      balanceDeltaCents,
      at: new Date().toISOString(),
    });

    return { transactionId, balanceDeltaCents };
  }

  /**
   * The one aggregate READ this slice offers (#14): today's net for the
   * driver's home card. Parsed through the wire schema on the way out, so a
   * negative sum — impossible while `commission ≤ ride_fare` — is a loud 500
   * rather than a card reading "-€1.86".
   */
  async todayForDriver(driverId: string): Promise<DriverEarningsToday> {
    const row = await this.ledger.driverEarningsToday(
      driverId,
      LEDGER_DAY_TIMEZONE,
    );
    return driverEarningsTodaySchema.parse({
      ...row,
      timezone: LEDGER_DAY_TIMEZONE,
    });
  }
}
