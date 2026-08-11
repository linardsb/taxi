import { pgEnum } from 'drizzle-orm/pg-core';
import {
  ASSIGNMENT_SOURCES,
  BOOKING_CHANNELS,
  COMMISSION_SOURCES,
  DISPATCH_MODES,
  DRIVER_STATUSES,
  OFFER_STATUSES,
  PAYMENT_METHOD_TYPES,
  PRICING_MODELS,
  RIDE_CATEGORIES,
  RIDE_STATUSES,
  USER_ROLES,
} from '@taxi/shared';

// Every value list below comes FROM @taxi/shared — never retyped here (AC:
// "all enums derive from shared const arrays"). The three db-local enums at
// the bottom have no shared counterpart by design.

export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const driverStatusEnum = pgEnum('driver_status', DRIVER_STATUSES);
export const rideStatusEnum = pgEnum('ride_status', RIDE_STATUSES);
export const rideCategoryEnum = pgEnum('ride_category', RIDE_CATEGORIES);
export const paymentMethodTypeEnum = pgEnum(
  'payment_method_type',
  PAYMENT_METHOD_TYPES,
);
export const dispatchModeEnum = pgEnum('dispatch_mode', DISPATCH_MODES);
export const pricingModelEnum = pgEnum('pricing_model', PRICING_MODELS);
export const offerStatusEnum = pgEnum('offer_status', OFFER_STATUSES);
export const assignmentSourceEnum = pgEnum(
  'assignment_source',
  ASSIGNMENT_SOURCES,
);
export const commissionSourceEnum = pgEnum(
  'commission_source',
  COMMISSION_SOURCES,
);
export const bookingChannelEnum = pgEnum('booking_channel', BOOKING_CHANNELS);

/** Mirrors `fareQuoteSchema.breakdown` keys — the normalized fare-lines table (#11/#12 consume). */
export const fareLineTypeEnum = pgEnum('fare_line_type', [
  'base',
  'distance',
  'time',
  'discount',
]);

/** #6 shipped the shape; #12 gave it semantics (`features/ledger/`). */
export const ledgerOwnerTypeEnum = pgEnum('ledger_owner_type', [
  'platform',
  'driver',
  'rider',
]);
/**
 * `card_settlement` is `cash_settlement`'s SIBLING: both record who physically
 * collected the passenger's money — the driver at the kerb, or the platform
 * through Stripe. Without it a card ride leaves the rider's account permanently
 * negative and the rider account stops being a balance, which is what prepaid
 * balance and corporate invoicing both need it to be (#12).
 */
export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', [
  'ride_fare',
  'commission',
  'cash_settlement',
  'card_settlement',
  'payout',
  'adjustment',
]);
