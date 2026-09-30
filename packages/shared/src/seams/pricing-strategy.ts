import type { PricingModel } from '../enums';
import type { FareQuote, RideRequest } from '../schemas/ride';
import type { RouteResult } from './maps-provider';

/**
 * Seam for the three pricing models (decided 2026-07-06): upfront_fixed
 * powers the demo; taximeter and rider_bid plug in later. All strategies
 * emit the same FareQuote shape so the ledger and UI never care which
 * model priced the ride.
 */
export interface PricingStrategy {
  readonly model: PricingModel;
  /**
   * Takes the request WITHOUT its rider (#123): a price never depends on who
   * rides, and the phone path quotes before it resolves (or mints) the
   * caller's identity, so a maps outage leaves no `users` row behind.
   */
  quote(
    request: Omit<RideRequest, 'riderId'>,
    route: RouteResult,
  ): Promise<FareQuote>;
}
