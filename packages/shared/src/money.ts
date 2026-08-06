/**
 * Integer-cent primitives. All money in Sakta Cab is integer cents, EUR —
 * never floats (root CLAUDE.md). Every schema reuses these instead of
 * re-typing `z.number().int()`, so the rule is enforced in one place and a
 * float is rejected at every boundary that parses.
 */
import { z } from 'zod';

export const eurCurrencySchema = z.literal('EUR');

/** Signed — the ledger (#12) and `driverProfile.balanceCents` go negative. */
export const centsSchema = z.number().int();

export const nonNegativeCentsSchema = z.number().int().nonnegative();

/** Discounts only, e.g. the shared-ride route-overlap knock-down (#23). */
export const nonPositiveCentsSchema = z.number().int().nonpositive();

/**
 * Strictly positive — an amount that exists at all, like a rider's own bid.
 * Distinct from `nonNegativeCentsSchema` on purpose: a €0 bid is not a cheap
 * ride, it is a missing one, and the two differ only at that single value.
 */
export const positiveCentsSchema = z.number().int().positive();

/**
 * A percent (0–100), not basis points, per the architecture decision
 * (2026-08-03). `0` is valid and load-bearing: S6-7 has Atis driving at 0%
 * commission plus an hourly guarantee.
 */
export const commissionPctSchema = z.number().min(0).max(100);

/**
 * The platform's cut of a fare, rounded half-up to the nearest cent.
 *
 * The driver's net is ALWAYS derived by subtraction (`total - commission`),
 * never by an independent `Math.round`, so the two halves always sum back to
 * the total and no cent can leak. See `splitFare` in ./commission.
 */
export function commissionCentsFor(totalCents: number, pct: number): number {
  return Math.round((totalCents * pct) / 100);
}
