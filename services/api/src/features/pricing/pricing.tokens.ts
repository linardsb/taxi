/**
 * The bound `PricingStrategy`. One strategy exists today (`upfront_fixed`);
 * `taximeter` and `rider_bid` are `PRICING_MODELS` values with no
 * implementation.
 *
 * A single token, not a keyed multi-binding: nothing chooses a pricing model
 * yet — a `RideRequest` carries no model field, and the strategy stamps its own
 * onto the quote. This becomes a keyed binding when a ride actually picks one,
 * and not before.
 */
export const PRICING_STRATEGY = 'PRICING_STRATEGY';
