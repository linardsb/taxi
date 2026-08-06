import {
  doublePrecision,
  integer,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { dispatchModeEnum } from './enums';
import { cities } from './geo';

/**
 * Mirrors `platformConfigSchema` (@taxi/shared). One row per city; #20 edits it
 * from the admin panel.
 */
export const platformConfig = pgTable('platform_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  cityId: uuid('city_id')
    .notNull()
    .unique()
    .references(() => cities.id),
  /**
   * CONFIG, NOT CONSTANT: deliberately NO column default — the SEED supplies 15
   * (launch decision 2026-08-03). A default here would recreate the constant
   * the architecture forbids.
   */
  commissionPct: doublePrecision('commission_pct').notNull(),
  /** Pilot guarantee placeholders (S2-9d, S2-10). null = no guarantee in force. */
  hourlyGuaranteeCents: integer('hourly_guarantee_cents'),
  weeklyGuaranteeCents: integer('weekly_guarantee_cents'),
  defaultDispatchMode: dispatchModeEnum('default_dispatch_mode')
    .notNull()
    .default('auto_match'),
  offerTimeoutSeconds: integer('offer_timeout_seconds').notNull().default(20),
  unclaimedAlertSeconds: integer('unclaimed_alert_seconds')
    .notNull()
    .default(60),
  /** DB-owned, like `rides.updatedAt` — see migration 0003. */
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
