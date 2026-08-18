import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { doublePrecision } from 'drizzle-orm/pg-core';
import { savedPlaceKindEnum } from './enums';
import { users } from './users';

/**
 * The phone channel's customer record (#19). NOT a parallel identity —
 * `user_id` points at the `users` row whose phone the caller rang from, so a
 * caller who later installs the app is the same person with the same history,
 * and their ride list does not fork.
 *
 * This table holds what the APP path has no place for: the venue flag, the
 * display label Dina reads aloud on the pop, and dispatcher notes. Nothing here
 * is rider-visible.
 */
export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * Unique: one customer record per person. A second row for the same user
   * would split the saved places between two caller-ID pops, and the pop would
   * be right half the time.
   */
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  /**
   * What Dina sees on the pop: "Hotel Roma" or "Anna B. (regulārā)". NULL until
   * she names them — a number that has rung once is a customer with no label,
   * not an unnamed venue.
   */
  label: text('label'),
  /** A venue books from a fixed address; a person does not. */
  isVenue: boolean('is_venue').notNull().default(false),
  /** Free-form dispatcher notes ("zvana no bāra, vienmēr uz Purvciemu"). */
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A customer's reusable address.
 *
 * `place_id` is stored INDEFINITELY — the one Places field the caching policy
 * exempts. `lat`/`lng`/`address` are a refreshable DERIVATION of it, which is
 * what `resolved_at` dates: past the Places content window they are re-resolved
 * from the place id rather than served forever.
 *
 * Typed columns rather than a jsonb `AddressPoint`, unlike `rides.request`:
 * that column stores an immutable snapshot of what was booked, while these are
 * queried, sorted and individually refreshed.
 */
export const savedPlaces = pgTable(
  'saved_places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    kind: savedPlaceKindEnum('kind').notNull(),
    /** "Mājas", "Darbs", "Ieeja no pagalma" — NULL for an unnamed address. */
    label: text('label'),
    address: text('address').notNull(),
    /**
     * NULL for an address that never came from Places — a dispatcher typing a
     * kerbside pickup Google does not know is the ordinary case, not an error.
     */
    placeId: text('place_id'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    /** When `lat`/`lng`/`address` were last resolved from `place_id`. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('saved_places_customer_idx').on(t.customerId)],
);
