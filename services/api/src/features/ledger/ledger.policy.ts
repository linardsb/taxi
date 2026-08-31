/**
 * Ledger policy. Constants only.
 */

/**
 * The timezone a ledger "day" is cut in (#14's today card). Single-city pilot:
 * this is `citySchema.timezone`'s default for Rīga. When a second city lands,
 * the day boundary becomes a per-city read, like `PlatformConfigService`.
 * Postgres does the arithmetic (`date_trunc('day', now() AT TIME ZONE …)`);
 * the api never computes a midnight.
 */
export const LEDGER_DAY_TIMEZONE = 'Europe/Riga';
