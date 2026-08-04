import { boolean, doublePrecision, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { driverStatusEnum } from "./enums";
import { users } from "./users";

/** Mirrors `driverProfileSchema` (@taxi/shared). PK = user_id: a driver IS a user. */
export const drivers = pgTable("drivers", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  status: driverStatusEnum("status").notNull().default("offline"),
  spokenLanguages: text("spoken_languages").array().notNull().default(["lv"]),
  /** Used only for the rider's female-driver preference filter. */
  isFemale: boolean("is_female"),
  /** Owned-fleet extension point (decided 2026-07-06) — no fleets table yet, so no FK. */
  fleetId: uuid("fleet_id"),
  rating: doublePrecision("rating"),
  /** Signed — cash-ride commission nets against card earnings (skeleton §5.3). */
  balanceCents: integer("balance_cents").notNull().default(0),
  /** Per-driver override, e.g. the S6-7 0%-pilot; null = platform base (`resolveCommissionPct`). */
  commissionPctOverride: doublePrecision("commission_pct_override"),
});
