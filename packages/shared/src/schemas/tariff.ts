import { z } from "zod";
import { RIDE_CATEGORIES } from "../enums";
import { nonNegativeCentsSchema } from "../money";

/**
 * The rate card one city charges for one ride category. #6's table holds one
 * row per (city × category); #20 edits them from the admin panel.
 *
 * CONFIG, NOT CONSTANT — the same discipline as `platformConfigSchema`:
 * nothing here carries a zod default, so a missing tariff row fails loudly
 * instead of pricing a ride at zero. No rate may ever be a literal in code.
 *
 * `perKmCents` / `perMinuteCents` are cents per WHOLE kilometre and per WHOLE
 * minute — a route's fractional distance and duration are multiplied and then
 * `Math.round`ed by the pricing strategy. Read as cents-per-metre they are off
 * by 1000×.
 *
 * `minimumFareCents` is the floor the WHOLE fare is topped up to, not an extra
 * line: the top-up lands on the base line, because `fareQuoteSchema.breakdown`
 * has exactly four members and its parts must sum to the total.
 */
export const rideTariffSchema = z.object({
  id: z.string().uuid(),
  cityId: z.string().uuid(),
  category: z.enum(RIDE_CATEGORIES),
  /** The drop — what the meter reads before moving. */
  baseCents: nonNegativeCentsSchema,
  perKmCents: nonNegativeCentsSchema,
  perMinuteCents: nonNegativeCentsSchema,
  minimumFareCents: nonNegativeCentsSchema,
  updatedAt: z.coerce.date(),
});
export type RideTariff = z.infer<typeof rideTariffSchema>;
