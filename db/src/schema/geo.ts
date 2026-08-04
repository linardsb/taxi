import { boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { geometryPolygon } from "../postgis";

/** Mirrors `citySchema` (@taxi/shared). */
export const cities = pgTable("cities", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  countryCode: text("country_code").notNull().default("LV"),
  timezone: text("timezone").notNull().default("Europe/Riga"),
});

/**
 * Mirrors `geozoneSchema` (@taxi/shared). Slug is free-form text, NOT an enum —
 * Dina adds zones without code changes (`RIGA_PILOT_DISTRICTS` is the seed's
 * slug set, not a closed universe).
 */
export const geozones = pgTable(
  "geozones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cityId: uuid("city_id")
      .notNull()
      .references(() => cities.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    polygon: geometryPolygon("polygon").notNull(),
    /** When true, dispatch here uses the driver queue instead of auto-match (S7-2). */
    queueModeEnabled: boolean("queue_mode_enabled").notNull().default(false),
  },
  (t) => [
    uniqueIndex("geozones_city_slug_uix").on(t.cityId, t.slug),
    index("geozones_polygon_gix").using("gist", t.polygon),
  ],
);
