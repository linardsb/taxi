import {
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { rideCategoryEnum } from './enums';
import { cities } from './geo';

/**
 * Mirrors `rideTariffSchema` (@taxi/shared). One row per city × ride category;
 * #20 edits them from the admin panel.
 *
 * CONFIG, NOT CONSTANT: deliberately NO column default on any of the four cent
 * columns — the SEED supplies them, exactly as `platform_config.commission_pct`
 * does. A default here would recreate the hardcoded rate this table exists to
 * abolish.
 *
 * The composite unique is what makes the seed idempotent and a duplicate rate
 * card for one city impossible.
 */
export const rideTariffs = pgTable(
  'ride_tariffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id),
    category: rideCategoryEnum('category').notNull(),
    baseCents: integer('base_cents').notNull(),
    /** Cents per WHOLE kilometre — applied to fractional distance by the strategy. */
    perKmCents: integer('per_km_cents').notNull(),
    /** Cents per WHOLE minute — applied to fractional duration by the strategy. */
    perMinuteCents: integer('per_minute_cents').notNull(),
    minimumFareCents: integer('minimum_fare_cents').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('ride_tariffs_city_category_uix').on(t.cityId, t.category),
  ],
);
