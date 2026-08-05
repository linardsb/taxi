/**
 * The pricing slice's public API — nothing outside imports past this file.
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - Only `upfront_fixed` is bound. `taximeter` and `rider_bid` are
 *   `PRICING_MODELS` values with no implementation, so a request never chooses
 *   a model — the strategy stamps its own onto every quote.
 * - `PricingService.quote()` returns a **platform-base** split, because no
 *   driver exists at request time. Any consumer that KNOWS a driver (#10's
 *   offer card) must re-resolve with
 *   `splitFare(quote.totalCents, resolveCommissionPct(driver, config))` from
 *   `@taxi/shared` rather than reuse this one. A driver with a
 *   `commissionPctOverride` would otherwise see the wrong number on the single
 *   card the whole pitch rests on (S2-5).
 * - Tariff rates are placeholders fitted to S5-1, not researched numbers. They
 *   are rows, so #20 fixes them without a deploy — but they need Atis's real
 *   fares before any pilot.
 */
export { PricingModule } from './pricing.module';
export { PricingService } from './pricing.service';
