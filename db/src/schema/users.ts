import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { userRoleEnum } from "./enums";

/** Mirrors `userSchema` (@taxi/shared). Phone is the identity — E.164, unique. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull().unique(),
  email: text("email"),
  role: userRoleEnum("role").notNull(),
  language: text("language").notNull().default("lv"),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
