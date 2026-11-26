import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  rideEventActorEnum,
  rideEventKindEnum,
  rideReasonCodeEnum,
  rideStatusEnum,
} from './enums';
import { drivers } from './drivers';
import { rides } from './rides';
import { users } from './users';
import { vehicles } from './vehicles';

/**
 * The ride's history (#316, architecture K1/K2): one append-only row per
 * status transition, plus one per creation, driver assignment and driver
 * release, written in the same transaction as the change. UPDATE, DELETE and
 * TRUNCATE raise (migration 0018) — a protected record under 35.² (5).
 *
 * Order by `seq`, never by `occurred_at`: several events can share one
 * transaction (force-assign writes three).
 */
export const rideEvents = pgTable(
  'ride_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().unique(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id),
    kind: rideEventKindEnum('kind').notNull(),
    /** Set only on `status` rows. */
    fromStatus: rideStatusEnum('from_status'),
    /** For `created`/`assigned`/`released`: the ride's status at that moment. */
    toStatus: rideStatusEnum('to_status').notNull(),
    actorKind: rideEventActorEnum('actor_kind').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    reasonCode: rideReasonCodeEnum('reason_code'),
    /** Free text (D4) — never logged; #320 erasure cannot reach it. */
    reasonText: text('reason_text'),
    driverId: uuid('driver_id').references(() => drivers.userId),
    /** On `released`: the OUTGOING car, null on rides accepted before #86's stamp. */
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),
    /** Wall clock per statement, so events in one transaction stay distinct. */
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    index('ride_events_ride_seq_idx').on(t.rideId, t.seq),
    // #322's 90-day driver history (K12).
    index('ride_events_driver_idx').on(t.driverId, t.occurredAt),
    check(
      'ride_events_actor_id_ck',
      sql`(${t.actorKind} = 'system') = (${t.actorId} IS NULL)`,
    ),
    check(
      'ride_events_status_kind_ck',
      sql`(${t.kind} = 'status') = (${t.fromStatus} IS NOT NULL)`,
    ),
    check(
      'ride_events_driver_kind_ck',
      sql`${t.kind} NOT IN ('assigned', 'released') OR ${t.driverId} IS NOT NULL`,
    ),
    check(
      'ride_events_reason_text_ck',
      sql`${t.reasonText} IS NULL OR char_length(${t.reasonText}) <= 280`,
    ),
  ],
);
