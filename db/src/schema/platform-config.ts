import {
  doublePrecision,
  integer,
  pgTable,
  text,
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
  /**
   * CONFIG, NOT CONSTANT: no column default — the SEED supplies 5000 (€50).
   * Same reasoning as `commissionPct`, and a default here would additionally
   * hand a limit nobody set to any future city row. See
   * `platformConfigSchema.driverDebtLimitCents` (@taxi/shared) for what the
   * number means and why it is a positive magnitude.
   */
  driverDebtLimitCents: integer('driver_debt_limit_cents').notNull(),
  defaultDispatchMode: dispatchModeEnum('default_dispatch_mode')
    .notNull()
    .default('auto_match'),
  offerTimeoutSeconds: integer('offer_timeout_seconds').notNull().default(20),
  unclaimedAlertSeconds: integer('unclaimed_alert_seconds')
    .notNull()
    .default(60),
  /**
   * CONFIG, NOT CONSTANT: no column default — the SEED supplies the pilot
   * number; #20 makes it admin-editable. The migration backfills with a
   * DEFAULT-then-DROP, the `driver_debt_limit_cents` precedent (0006).
   */
  dispatchPhone: text('dispatch_phone').notNull(),
  /** DB-owned, like `rides.updatedAt` — see migration 0003. */
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
