import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ledgerEntryTypeEnum, ledgerOwnerTypeEnum } from "./enums";
import { rides } from "./rides";

/**
 * One ledger, double-entry-ish (skeleton §5.3): rides/commissions/top-ups in a
 * single place; cash rides debit driver commission owed. Shape-level only —
 * #12 owns posting logic.
 */
export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerType: ledgerOwnerTypeEnum("owner_type").notNull(),
    /** null for the platform account. */
    ownerId: uuid("owner_id"),
    currency: text("currency").notNull().default("EUR"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ledger_accounts_owner_uix").on(t.ownerType, t.ownerId)],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Double-entry pairing key — the entries of one transaction share it. */
    transactionId: uuid("transaction_id").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => ledgerAccounts.id),
    rideId: uuid("ride_id").references(() => rides.id),
    entryType: ledgerEntryTypeEnum("entry_type").notNull(),
    /** Signed — netting is the point (§5.3). */
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entries_account_idx").on(t.accountId),
    index("ledger_entries_transaction_idx").on(t.transactionId),
  ],
);
