import { z } from 'zod';
import { DISPATCH_MODES } from '../enums';
import { commissionPctSchema, nonNegativeCentsSchema } from '../money';

/**
 * The per-city knobs the platform runs on. One row per city; #6 owns the table
 * and its seed, #20 edits it from the admin panel.
 */
export const platformConfigSchema = z.object({
  id: z.string().uuid(),
  cityId: z.string().uuid(),
  /**
   * Launch value 15 (flat, everyone, no intro promo — Linards 2026-08-03;
   * S2-9 preferred flat 15, 16 was the ceiling). CONFIG, NOT CONSTANT:
   * deliberately has no zod default so every caller must read a real row.
   * The seed lives in #6.
   */
  commissionPct: commissionPctSchema,
  /** Pilot guarantee placeholders — €15/h (S2-9d) and €500/week (S2-10). null = no guarantee in force. */
  hourlyGuaranteeCents: nonNegativeCentsSchema.nullable().default(null),
  weeklyGuaranteeCents: nonNegativeCentsSchema.nullable().default(null),
  /**
   * How much commission a driver may owe before dispatch stops offering them
   * rides. A POSITIVE magnitude of allowed debt: a driver is blocked when
   * `balanceCents < -driverDebtLimitCents`.
   *
   * Load-bearing, not a nicety. Cash rides debit commission (skeleton §5.3), so
   * at zero grace one €10 cash ride (−150) makes a driver invisible to dispatch
   * until they settle. Pilot value 5000 (€50 ≈ 33 cash rides at a €10 fare) —
   * seeded in #6's seed, edited by #20, never a literal.
   *
   * No zod default, for `commissionPct`'s reason: every caller must read a real
   * row.
   */
  driverDebtLimitCents: nonNegativeCentsSchema,
  /** Fallback when a geozone does not set `queueModeEnabled` (dispatch-strategies.md). */
  defaultDispatchMode: z.enum(DISPATCH_MODES).default('auto_match'),
  /** How long a driver has to accept before the cascade re-offers (`offered → requested`). */
  offerTimeoutSeconds: z.number().int().positive().default(20),
  /** Unclaimed-order alert threshold to Dina's board (S9-4). */
  unclaimedAlertSeconds: z.number().int().positive().default(60),
  updatedAt: z.coerce.date(),
});
export type PlatformConfig = z.infer<typeof platformConfigSchema>;
