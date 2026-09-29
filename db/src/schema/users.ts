import {
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
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
  /**
   * The dispatcher who minted this row on the caller's behalf (#123), NULL for
   * a row its owner created by OTP. Set ONLY by the phone path's insert, never
   * by a conflict clause, so a rider who signed up first can never become
   * provisional by being phone-booked later.
   *
   * Non-NULL means "provisional": the person never took part in creating it,
   * so their first OTP signup ADOPTS the row (`AuthRepository.adoptProvisional`
   * sets the signup role and clears this) instead of colliding with it. A FK
   * rather than a boolean because "who filed this identity" is the question a
   * support call asks. Not on `userSchema`, like the handles above.
   */
  provisionedBy: uuid('provisioned_by').references((): AnyPgColumn => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
