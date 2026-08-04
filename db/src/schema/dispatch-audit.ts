import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { assignmentSourceEnum } from "./enums";
import { drivers } from "./drivers";
import { rides } from "./rides";
import { users } from "./users";

/**
 * Event-shaped audit trail mirroring `rideAssignmentSchema` with room for #10's
 * dispatch events (one row per assignment-relevant event, jsonb payload).
 * dispatcher-required-when-source=dispatcher is app-level — the zod refine
 * enforces it at the write boundary, not the DDL.
 */
export const dispatchAuditLog = pgTable(
  "dispatch_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rideId: uuid("ride_id")
      .notNull()
      .references(() => rides.id),
    driverId: uuid("driver_id").references(() => drivers.userId),
    source: assignmentSourceEnum("source").notNull(),
    /** The force-assign audit trail (S9-2, S9-4). */
    dispatcherId: uuid("dispatcher_id").references(() => users.id),
    /** Free-text override reason — max length is app-level (zod, 280). */
    reason: text("reason"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dispatch_audit_log_ride_idx").on(t.rideId)],
);
