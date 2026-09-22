import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { userRoleEnum } from './enums';

/** Mirrors `userSchema` (@taxi/shared). Phone is the identity — E.164, unique. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull().unique(),
  email: text('email'),
  role: userRoleEnum('role').notNull(),
  language: text('language').notNull().default('lv'),
  displayName: text('display_name'),
  /**
   * Provider-opaque customer handle (Stripe Customer id in test mode) and the
   * instrument to charge off-session. Both NULL until #17's rider app enrolls a
   * card; a card ride settled for a rider missing either answers 409
   * `payment_instrument_missing` rather than inventing a charge (#12).
   *
   * Deliberately untyped and unvalidated here: the payments seam abstracts over
   * providers whose handles look nothing like Stripe's. Not on `userSchema` —
   * no surface reads them, and a provider handle on the wire user object is how
   * a customer id ends up in a log.
   */
  paymentCustomerRef: text('payment_customer_ref'),
  paymentInstrumentRef: text('payment_instrument_ref'),
  /**
   * The rider's Expo push token (#17), NULL until their app registers one and
   * NULLed again when Expo answers `device_not_registered`. Same shape as
   * `drivers.push_token`, and deliberately a second column rather than a shared
   * one: a driver's token belongs to the driver row that `drivers` owns, and
   * one person can hold both roles on two phones.
   *
   * Never on `userSchema` — a provider handle on the wire user object is how it
   * ends up in a log, exactly as for the two payment refs above.
   */
  pushToken: text('push_token'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
