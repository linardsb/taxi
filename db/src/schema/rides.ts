import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  assignmentSourceEnum,
  bookingChannelEnum,
  commissionSourceEnum,
  fareLineTypeEnum,
  offerStatusEnum,
  paymentMethodTypeEnum,
  pricingModelEnum,
  rideCategoryEnum,
  rideStatusEnum,
} from './enums';
import { drivers } from './drivers';
import { geozones } from './geo';
import { users } from './users';
import { vehicles } from './vehicles';

/**
 * Mirrors `rideSchema` (@taxi/shared). Rule of thumb: snapshot-of-a-contract →
 * jsonb (zod-validated at the boundary); anything queried/aggregated → typed
 * columns. `request` is the wire snapshot; status/driver/money are columns.
 */
export const rides = pgTable(
  'rides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Groups the N rides of a multi-taxi order. */
    orderId: uuid('order_id').notNull(),
    status: rideStatusEnum('status').notNull(),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => users.id),
    /** The denormalized field #6 indexes; `dispatch_audit_log` is the audit record. */
    driverId: uuid('driver_id').references(() => drivers.userId),
    /**
     * The car serving this ride (#86), stamped by `assignDriver` in the same
     * UPDATE as `driver_id` — category match, else first by plate, else NULL
     * (a force-assigned driver may own no vehicle). SET NULL on vehicle delete:
     * vehicles are deletable (`VehiclesService.remove`), ride history must not
     * pin them forever. Null also = pre-#86 rows and unassigned rides.
     */
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, {
      onDelete: 'set null',
    }),
    /** Pickup zone — drives queue mode and Dina's district stats (S7-2). */
    geozoneId: uuid('geozone_id').references(() => geozones.id),
    /** Full `RideRequest` snapshot — audit "what was asked". */
    request: jsonb('request').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    paymentMethod: paymentMethodTypeEnum('payment_method').notNull(),
    category: rideCategoryEnum('category').notNull(),
    /** null until quoted. */
    pricingModel: pricingModelEnum('pricing_model'),
    totalCents: integer('total_cents'),
    /** The settled split (`fareSplitSchema`) — all four written at completion (#11), null until then. */
    commissionPct: doublePrecision('commission_pct'),
    commissionSource: commissionSourceEnum('commission_source'),
    commissionCents: integer('commission_cents'),
    driverNetCents: integer('driver_net_cents'),
    /**
     * The charge that settled this ride (Stripe PaymentIntent id in test mode)
     * — NULL for cash and for anything unsettled. The reconciliation handle:
     * spike #5 requires every money movement to carry a platform-visible
     * provider reference. One column, not a `ride_payments` table: a ride has
     * at most one charge here (no refunds, no partial captures, and the derived
     * idempotency key rules out a second intent on retry).
     */
    paymentProviderRef: text('payment_provider_ref'),
    /**
     * How the ride was booked (#63). The column default is legitimate here —
     * it is a FACT about legacy rows (they all came from the app), not a
     * config knob.
     */
    bookingChannel: bookingChannelEnum('booking_channel')
      .notNull()
      .default('app'),
    /**
     * Unguessable handle for the no-login tracking page (#63), minted at
     * creation. Nullable: legacy rows never got one — untrackable by design.
     */
    trackingToken: text('tracking_token'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Maintained entirely by the database: DEFAULT now() on insert, the
    // `rides_set_updated_at` trigger on update (migration 0003). Do NOT add
    // `.$onUpdate(() => new Date())` back — that stamps the APP's clock onto a
    // column whose insert value comes from Postgres, and any skew between the
    // two makes updated_at land before created_at.
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('rides_rider_idx').on(t.riderId),
    index('rides_driver_idx').on(t.driverId),
    index('rides_status_idx').on(t.status),
    index('rides_order_idx').on(t.orderId),
    // The tracking page's only lookup path — unique because a token that
    // resolved to two rides would show a stranger's trip.
    uniqueIndex('rides_tracking_token_idx').on(t.trackingToken),
  ],
);

/**
 * Normalized fare-breakdown lines (`fareQuoteSchema.breakdown`). Lines, not a
 * fixed 4-key jsonb, so #11/#12 can reference per-line and #23 adds surcharges
 * without a migration of shape.
 */
export const rideFareLines = pgTable(
  'ride_fare_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    lineType: fareLineTypeEnum('line_type').notNull(),
    /** Signed — discount lines are negative. */
    amountCents: integer('amount_cents').notNull(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [index('ride_fare_lines_ride_idx').on(t.rideId)],
);

/** Insert shape derived from `rideOfferSchema`, as its docblock anticipates. */
export const rideOffers = pgTable(
  'ride_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.userId),
    status: offerStatusEnum('status').notNull(),
    source: assignmentSourceEnum('source').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    /** Cascade deadline; on expiry the ride goes `offered → requested` and re-offers. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    etaSeconds: integer('eta_seconds').notNull(),
    /** Wire-shape snapshots — audit "what was shown" (the S2-5 transparency card). */
    pickup: jsonb('pickup').notNull(),
    destination: jsonb('destination').notNull(),
    quote: jsonb('quote').notNull(),
    split: jsonb('split').notNull(),
    /** 1-based position when the offer came from a geozone queue (S7-2). */
    queuePosition: integer('queue_position'),
  },
  (t) => [
    index('ride_offers_ride_idx').on(t.rideId),
    // Dispatch's driver-side hot read is always status-filtered ("pending offer for driver X?").
    index('ride_offers_driver_idx').on(t.driverId, t.status),
  ],
);
