import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { rideCategoryEnum } from './enums';
import { drivers } from './drivers';

/** Mirrors `vehicleSchema` (@taxi/shared). `has_child_seat` is the vehicle attribute; `is_female` lives on the driver. */
export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.userId),
    plate: text('plate').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    year: integer('year').notNull(),
    category: rideCategoryEnum('category').notNull().default('standard'),
    passengerSeats: integer('passenger_seats').notNull(),
    hasChildSeat: boolean('has_child_seat').notNull().default(false),
    /**
     * Set when the car leaves service (#316). Vehicles are never deleted —
     * 35.² (5) protects them as records — so "the driver's cars" means
     * `retired_at IS NULL` everywhere except reads of a past ride's car.
     */
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (t) => [
    /**
     * The plate is the identity a rider matches at the kerb, so two drivers
     * must not be able to register one. Indexed on `upper(plate)`, not the raw
     * column: a plain unique index is bypassed by a single lowercase letter,
     * which would leave the constraint present and the guarantee absent.
     * Partial on ACTIVE cars (#316, D3): a retired car's plate can be
     * registered again.
     */
    uniqueIndex('vehicles_plate_uix')
      .on(sql`upper(${t.plate})`)
      .where(sql`${t.retiredAt} IS NULL`),
  ],
);
