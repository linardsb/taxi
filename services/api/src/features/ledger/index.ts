/**
 * The ledger slice's public API — nothing outside imports past this file.
 *
 * ONE LEDGER, AND IT IS THE SOURCE OF TRUTH. Every settlement writes a balanced
 * six-entry set sharing one `transaction_id`: the fare, the commission, and the
 * collection (who physically took the passenger's money). Card and cash differ
 * in exactly one pair, so a reconciliation read never has to know how the ride
 * was paid, and every party's account is a BALANCE rather than a spend log.
 *
 * NOTHING OUTSIDE THIS SLICE MAY INSERT `ledger_entries` OR MOVE
 * `drivers.balance_cents` AS MONEY. `LedgerRepository` is exported for the
 * reconciliation READ (`findByRide`) that #20 renders and the payments
 * integration spec asserts through — not as a second writer.
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - NO PAYOUTS. `'payout'` is in the enum and the shape accommodates both rails
 *   spike #5 names (SEPA batch now, Connect post-SIA) as the same two rows —
 *   `driver -payoutCents` / `platform +payoutCents`. Nothing writes them, and
 *   the pilot's first payday needs that ticket to exist.
 * - NO ADJUSTMENTS AND NO TOP-UPS, so a driver cannot pay down commission debt:
 *   the balance goes negative, blocks at `driver_debt_limit_cents`, and is
 *   cleared by a phone call and a manual row. Honest at ≤10 drivers; it must not
 *   survive to open enrolment.
 * - ONE AGGREGATE READ ONLY (#14): `GET /drivers/me/earnings/today` sums the
 *   driver's settlement entries since Rīga midnight for the home card. The
 *   per-ride statement is #15's; `GET /drivers/me` still carries `balanceCents`.
 * - NO DATABASE-LEVEL DOUBLE-ENTRY ENFORCEMENT. `sum(amount_cents) = 0` per
 *   transaction is guaranteed by the pure builder (which throws on an unbalanced
 *   set) and asserted in tests, not by a constraint. A deferred constraint
 *   trigger would fire on every insert forever to catch a bug the builder cannot
 *   have — revisit only if a second writer of `ledger_entries` ever appears,
 *   which the paragraph above forbids.
 * - THE PLATFORM ACCOUNT IS A CONTRA ACCOUNT. Its aggregate balance is
 *   `-(all party claims)` by construction and reconciles against nothing; read
 *   it BY ENTRY TYPE (`commission` is revenue, `payout` is money sent). The
 *   platform's cash on hand lives at Stripe and at the bank, not here.
 */
export { LedgerModule } from './ledger.module';
export { LEDGER_DAY_TIMEZONE } from './ledger.policy';
export { LedgerService } from './ledger.service';
export type {
  PostRideSettlementInput,
  PostedSettlement,
} from './ledger.service';
export { LedgerRepository } from './ledger.repository';
export type { EntryInsert, LedgerEntryRow } from './ledger.repository';
export type {
  LedgerEntryDraft,
  LedgerEntryType,
  LedgerOwnerType,
  SettlementInput,
} from './settlement-entries';
