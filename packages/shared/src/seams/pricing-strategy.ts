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
  quote(request: RideRequest, route: RouteResult): Promise<FareQuote>;
}
