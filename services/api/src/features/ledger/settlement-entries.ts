import { ledgerEntryTypeEnum, ledgerOwnerTypeEnum } from '@taxi/db';
import type { FareSplit } from '@taxi/shared';

/**
 * Derived from drizzle's tuples, never hand-written. `db/src/schema/enums.ts`
 * records that the two ledger enums are db-local BY DESIGN (no `@taxi/shared`
 * counterpart), which makes those arrays the single source of truth — a
 * hand-written union would rot on the first added entry type.
 */
export type LedgerOwnerType = (typeof ledgerOwnerTypeEnum.enumValues)[number];
export type LedgerEntryType = (typeof ledgerEntryTypeEnum.enumValues)[number];

export interface LedgerEntryDraft {
  ownerType: LedgerOwnerType;
  /** null for the platform account. */
  ownerId: string | null;
  entryType: LedgerEntryType;
  amountCents: number;
}

export interface SettlementInput {
  /**
   * Only the two methods this ticket settles. `balance` and `corporate` are
   * refused at the route with 409 `payment_method_unsupported`, so they cannot
   * reach here — see the collection switch below for how they would land.
   */
  paymentMethod: 'cash' | 'card';
  riderId: string;
  driverId: string;
  split: FareSplit;
}

/**
 * Turns a settled fare split into the balanced set of ledger entries that moves
 * it. A pure function — no DI, no I/O — so it unit-tests directly and the
 * ledger's arithmetic is proven without a database, exactly like
 * `dispatch/strategies/candidate-filter.ts`.
 *
 * EVERY ACCOUNT BALANCE MEANS THE SAME THING IN EVERY ENTRY: what the platform
 * owes that party (negative = that party owes the platform). That is already
 * `drivers.balance_cents`'s documented meaning, and holding it uniformly is
 * what makes the three facts below fall out:
 *
 *  1. THE FARE       — the driver earned it from the rider (both methods).
 *  2. THE COMMISSION — the driver owes it to the platform (both methods).
 *  3. THE COLLECTION — who physically took the passenger's money. The ONLY pair
 *     that differs: the driver at the kerb (cash) or the platform through
 *     Stripe (card).
 *
 * Six entries either way, so a reconciliation read never has to know how the
 * ride was paid. Net standalone positions:
 *
 * |      | rider | driver               |
 * |------|-------|----------------------|
 * | card | 0     | +driverNetCents      |
 * | cash | 0     | -commissionCents     |
 *
 * THE RIDER NETS TO ZERO ON BOTH METHODS, and that is the point of the
 * collection pair rather than an accident. The tempting four-entry card set
 * (drop `card_settlement`) also sums to zero and also gives the driver the right
 * balance — and it leaves the rider's account at `-totalCents` forever, turning
 * it into a lifetime-spend log on card and a balance on cash. Prepaid balance
 * and corporate invoicing both read a rider account as a BALANCE, and neither
 * composes if ordinary card rides have already driven it to −∞.
 *
 * The platform account is the balancing (CONTRA) account: its aggregate is
 * `-(rider + driver)` by construction and reconciles against nothing. Read it by
 * entry type instead — `commission` is revenue, `payout` is money sent. The
 * platform's cash on hand is deliberately not modelled at all; that lives at
 * Stripe and at the bank.
 *
 * ZERO-AMOUNT ENTRIES ARE KEPT, not filtered. `resolveCommissionPct` legitimately
 * returns 0 (the evidenced S6-7 pilot), and a written `commission: 0` proves the
 * commission was computed as zero rather than forgotten — and keeps the entry
 * shape identical for every ride, so no reconciliation read needs a special case.
 */
export function buildSettlementEntries(
  input: SettlementInput,
): LedgerEntryDraft[] {
  const { split, riderId, driverId } = input;

  const entries: LedgerEntryDraft[] = [
    // 1. The fare: the rider owes it, the driver earned it.
    {
      ownerType: 'rider',
      ownerId: riderId,
      entryType: 'ride_fare',
      amountCents: -split.totalCents,
    },
    {
      ownerType: 'driver',
      ownerId: driverId,
      entryType: 'ride_fare',
      amountCents: split.totalCents,
    },

    // 2. The commission, as its OWN line on the driver's account. Not shortcut
    //    into a single `+driverNetCents` entry: the explicit line is the S2-5
    //    transparency wedge as a persisted record.
    {
      ownerType: 'driver',
      ownerId: driverId,
      entryType: 'commission',
      amountCents: -split.commissionCents,
    },
    {
      ownerType: 'platform',
      ownerId: null,
      entryType: 'commission',
      amountCents: split.commissionCents,
    },

    // 3. The collection. A `balance` ride would add NO pair here (the platform
    //    already holds the rider's money) and a `corporate` one likewise, leaving
    //    the rider legitimately negative until the invoice is paid — both are a
    //    case in this switch and nothing else.
    ...collectionPair(input),
  ];

  const sum = entries.reduce((acc, e) => acc + e.amountCents, 0);
  if (sum !== 0) {
    throw new Error(
      `buildSettlementEntries produced an unbalanced set summing to ${sum} for a ${input.paymentMethod} ride: every settlement transaction must sum to zero, or the ledger stops being double-entry and no reconciliation read means anything.`,
    );
  }

  return entries;
}

/** Who physically took the passenger's money — the one pair that differs. */
function collectionPair(input: SettlementInput): LedgerEntryDraft[] {
  const { split, riderId, driverId } = input;
  const collector: LedgerEntryDraft =
    input.paymentMethod === 'cash'
      ? // The driver holds it, so the platform's claim on them grows by the fare.
        {
          ownerType: 'driver',
          ownerId: driverId,
          entryType: 'cash_settlement',
          amountCents: -split.totalCents,
        }
      : // The platform took it through Stripe.
        {
          ownerType: 'platform',
          ownerId: null,
          entryType: 'card_settlement',
          amountCents: -split.totalCents,
        };

  return [
    collector,
    {
      ownerType: 'rider',
      ownerId: riderId,
      entryType: collector.entryType,
      amountCents: split.totalCents,
    },
  ];
}

/**
 * The driver's net movement, summed from the ROWS ABOUT TO BE INSERTED rather
 * than re-derived from the split.
 *
 * That is what makes `drivers.balance_cents == SUM(that driver's entries)` true
 * by construction: the cached balance and the ledger cannot disagree, because
 * they are computed from the same array. Re-deriving `+driverNetCents` /
 * `-commissionCents` here would be a second implementation of the entry sets,
 * free to drift from the first.
 */
export function driverBalanceDelta(
  entries: LedgerEntryDraft[],
  driverId: string,
): number {
  return entries
    .filter((e) => e.ownerType === 'driver' && e.ownerId === driverId)
    .reduce((acc, e) => acc + e.amountCents, 0);
}
