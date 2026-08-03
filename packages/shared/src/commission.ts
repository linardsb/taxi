import { z } from "zod";
import { COMMISSION_SOURCES } from "./enums";
import type { CommissionSource } from "./enums";
import {
  commissionCentsFor,
  commissionPctSchema,
  eurCurrencySchema,
  nonNegativeCentsSchema,
} from "./money";
import type { PlatformConfig } from "./schemas/platform-config";

/**
 * Structural input, deliberately NOT `DriverProfile`: the resolver reads only
 * what it needs, so the loyalty differentiator (#27) widens THIS interface with
 * tenure/quality inputs rather than adding a second subsystem (architecture,
 * 2026-08-03). `DriverProfile` satisfies it structurally.
 */
export interface CommissionDriverInput {
  commissionPctOverride?: number | null;
}

export interface CommissionResolution {
  pct: number;
  source: CommissionSource;
}

/**
 * The one place a commission percentage is decided. Pure: no I/O, no `Date`,
 * no invented defaults — an absent config row is the caller's problem, not a
 * silent 15.
 */
export function resolveCommissionPct(
  driver: CommissionDriverInput,
  config: PlatformConfig,
): CommissionResolution {
  // `!= null`, never truthiness: a 0% override (the evidenced S6-7 pilot) is real.
  if (driver.commissionPctOverride != null) {
    return { pct: driver.commissionPctOverride, source: "driver_override" };
  }
  return { pct: config.commissionPct, source: "platform_base" };
}

/**
 * What the rider pays, split into the platform's cut and the driver's net —
 * the driver-transparency wedge (S2-5), carried on every offer.
 *
 * The refinement is the no-cent-leak invariant: it re-checks at every parse
 * boundary (API response, socket payload, DB read), so a future refactor that
 * computes the net independently fails loudly instead of shorting a driver.
 */
export const fareSplitSchema = z
  .object({
    currency: eurCurrencySchema,
    /** What the rider pays — shown to the driver in full. THE transparency wedge (S2-5). */
    totalCents: nonNegativeCentsSchema,
    commissionPct: commissionPctSchema,
    commissionSource: z.enum(COMMISSION_SOURCES),
    commissionCents: nonNegativeCentsSchema,
    driverNetCents: nonNegativeCentsSchema,
  })
  .refine((s) => s.commissionCents + s.driverNetCents === s.totalCents, {
    message: "fare split must sum to totalCents (integer cents, no leak)",
  });
export type FareSplit = z.infer<typeof fareSplitSchema>;

/**
 * Builds the split. The net is derived by subtraction, so the no-leak invariant
 * holds at any rounding — but ONLY the sum is structural. Nothing bounds
 * `resolution.pct`, so the result is parsed rather than asserted: returning it
 * unparsed would type a rejected value as a `FareSplit`.
 *
 * That door is real, not theoretical. `CommissionDriverInput` is deliberately
 * structural so #6 can hand it a raw Drizzle row that was never zod-parsed and
 * #27 can widen it, and `pct: 150` there makes `driverNetCents` negative — a
 * driver paying the platform. The parse costs one pass per offer and turns that
 * into a loud failure at the source instead of a silent one on the offer card.
 */
export function splitFare(totalCents: number, resolution: CommissionResolution): FareSplit {
  const commissionCents = commissionCentsFor(totalCents, resolution.pct);
  return fareSplitSchema.parse({
    currency: "EUR",
    totalCents,
    commissionPct: resolution.pct,
    commissionSource: resolution.source,
    commissionCents,
    driverNetCents: totalCents - commissionCents,
  });
}
