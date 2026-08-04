import { boolean, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { rideCategoryEnum } from "./enums";
import { drivers } from "./drivers";

/** Mirrors `vehicleSchema` (@taxi/shared). `has_child_seat` is the vehicle attribute; `is_female` lives on the driver. */
export const vehicles = pgTable("vehicles", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id")
    .notNull()
    .references(() => drivers.userId),
  plate: text("plate").notNull(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  category: rideCategoryEnum("category").notNull().default("standard"),
  passengerSeats: integer("passenger_seats").notNull(),
  hasChildSeat: boolean("has_child_seat").notNull().default(false),
});
