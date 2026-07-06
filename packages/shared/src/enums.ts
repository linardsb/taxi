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
