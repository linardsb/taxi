export const USER_ROLES = ['rider', 'driver', 'dispatcher', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const LANGUAGES = ['lv', 'ru', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const RIDE_CATEGORIES = ['standard', 'fastest', 'limo', 'vip'] as const;
export type RideCategory = (typeof RIDE_CATEGORIES)[number];

export const PAYMENT_METHOD_TYPES = [
  'cash',
  'card',
  'balance',
  'corporate',
] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

/**
 * What a rider may BOOK — and switch to, until the lock (#70).
 *
 * `balance` and `corporate` are deliberately absent: both are
 * `PAYMENT_METHOD_TYPES` values with no settlement flow, so a booked
 * `balance` ride would complete and then answer 409
 * `payment_method_unsupported` on every settle attempt, forever. Refusing
 * the booking makes that state unrepresentable; the settlement guard
 * (`settlementMethodOf`) stays as defence in depth. Written out rather than
 * filtered from `PAYMENT_METHOD_TYPES`, because a filter loses the literal
 * tuple `z.enum()` needs — the `DRIVER_PRESENCE_STATUSES` precedent.
 * Widen this list when a method's settlement flow actually lands.
 */
export const BOOKABLE_PAYMENT_METHODS = ['cash', 'card'] as const;
export type BookablePaymentMethod = (typeof BOOKABLE_PAYMENT_METHODS)[number];

export const DISPATCH_MODES = ['auto_match', 'geozone_queue'] as const;
export type DispatchMode = (typeof DISPATCH_MODES)[number];

export const PRICING_MODELS = [
  'upfront_fixed',
  'taximeter',
  'rider_bid',
] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const DRIVER_STATUSES = ['offline', 'online', 'on_ride'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

/**
 * What a driver may set for THEMSELVES. `on_ride` is deliberately absent: it is
 * written only by the ride lifecycle (#11) when a ride is accepted, and a driver
 * who could set it by hand could hide from dispatch while idle — or clear it
 * mid-ride and take a second offer. Written out rather than filtered from
 * `DRIVER_STATUSES`, because a filter loses the literal tuple `z.enum()` needs.
 */
export const DRIVER_PRESENCE_STATUSES = ['offline', 'online'] as const;
export type DriverPresenceStatus = (typeof DRIVER_PRESENCE_STATUSES)[number];

/**
 * The four evidenced pilot hotspots (S5-2, S7-2). Geozones themselves are data
 * (#6 seeds them) — this is the stable slug set for the pilot, not a closed
 * universe of zones; `geozone.slug` stays a free-form string.
 */
export const RIGA_PILOT_DISTRICTS = [
  'centre',
  'rix',
  'autoosta',
  'old_town',
] as const;
export type RigaPilotDistrict = (typeof RIGA_PILOT_DISTRICTS)[number];

/** Outcome of one offer to one driver. Flat by design — see `rideOfferSchema.status`. */
export const OFFER_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'expired',
  'revoked',
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/**
 * How a ride got its driver: either a dispatch mode, or Dina's manual override.
 * `dispatcher` is a source and not a `DispatchMode` because "dispatcher override
 * is NOT a strategy" (.claude/references/dispatch-strategies.md).
 */
export const ASSIGNMENT_SOURCES = [...DISPATCH_MODES, 'dispatcher'] as const;
export type AssignmentSource = (typeof ASSIGNMENT_SOURCES)[number];

/** Which rule produced a commission percentage. A const array so #27 adds "loyalty_tier" in one place. */
export const COMMISSION_SOURCES = ['platform_base', 'driver_override'] as const;
export type CommissionSource = (typeof COMMISSION_SOURCES)[number];

/**
 * How the ride was BOOKED — not to be confused with `ASSIGNMENT_SOURCES`,
 * which records how a ride got its driver. Drives the SMS policy (#63):
 * phone bookings get the tracking link because the rider has no app to watch.
 * The rider app always writes `app`; #19's dispatcher phone-order controller
 * writes `phone`.
 */
export const BOOKING_CHANNELS = ['app', 'phone'] as const;
export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

/**
 * The rider SMS messages the platform owes on a ride (#63). Lives here rather
 * than in the api because `dispatch:sms_failed` puts the kind on the wire and
 * the console renders a label per kind — three surfaces, one tuple.
 */
export const SMS_KINDS = [
  'booking_confirmed',
  'driver_assigned',
  'driver_arrived',
] as const;
export type SmsKind = (typeof SMS_KINDS)[number];
