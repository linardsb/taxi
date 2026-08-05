export const USER_ROLES = ["rider", "driver", "dispatcher", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const LANGUAGES = ["lv", "ru", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const RIDE_CATEGORIES = ["standard", "fastest", "limo", "vip"] as const;
export type RideCategory = (typeof RIDE_CATEGORIES)[number];

export const PAYMENT_METHOD_TYPES = ["cash", "card", "balance", "corporate"] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

export const DISPATCH_MODES = ["auto_match", "geozone_queue"] as const;
export type DispatchMode = (typeof DISPATCH_MODES)[number];

export const PRICING_MODELS = ["upfront_fixed", "taximeter", "rider_bid"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const DRIVER_STATUSES = ["offline", "online", "on_ride"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

/**
 * What a driver may set for THEMSELVES. `on_ride` is deliberately absent: it is
 * written only by the ride lifecycle (#11) when a ride is accepted, and a driver
 * who could set it by hand could hide from dispatch while idle — or clear it
 * mid-ride and take a second offer. Written out rather than filtered from
 * `DRIVER_STATUSES`, because a filter loses the literal tuple `z.enum()` needs.
 */
export const DRIVER_PRESENCE_STATUSES = ["offline", "online"] as const;
export type DriverPresenceStatus = (typeof DRIVER_PRESENCE_STATUSES)[number];

/**
 * The four evidenced pilot hotspots (S5-2, S7-2). Geozones themselves are data
 * (#6 seeds them) — this is the stable slug set for the pilot, not a closed
 * universe of zones; `geozone.slug` stays a free-form string.
 */
export const RIGA_PILOT_DISTRICTS = ["centre", "rix", "autoosta", "old_town"] as const;
export type RigaPilotDistrict = (typeof RIGA_PILOT_DISTRICTS)[number];

/** Outcome of one offer to one driver. Flat by design — see `rideOfferSchema.status`. */
export const OFFER_STATUSES = ["pending", "accepted", "declined", "expired", "revoked"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/**
 * How a ride got its driver: either a dispatch mode, or Dina's manual override.
 * `dispatcher` is a source and not a `DispatchMode` because "dispatcher override
 * is NOT a strategy" (.claude/references/dispatch-strategies.md).
 */
export const ASSIGNMENT_SOURCES = [...DISPATCH_MODES, "dispatcher"] as const;
export type AssignmentSource = (typeof ASSIGNMENT_SOURCES)[number];

/** Which rule produced a commission percentage. A const array so #27 adds "loyalty_tier" in one place. */
export const COMMISSION_SOURCES = ["platform_base", "driver_override"] as const;
export type CommissionSource = (typeof COMMISSION_SOURCES)[number];
