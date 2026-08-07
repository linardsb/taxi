import { Injectable } from '@nestjs/common';
import type {
  DispatchContext,
  DispatchStrategy,
  DriverCandidate,
  RideRequest,
} from '@taxi/shared';
import { DriversService, DriverLocationService } from '../../drivers';
import { toCandidates } from './candidate-filter';

/**
 * Nearest eligible driver first — the Bolt-style default.
 *
 * Never imported by the engine: `DispatchService` reaches a strategy only
 * through `DispatchStrategyResolver`.
 */
@Injectable()
export class AutoMatchStrategy implements DispatchStrategy {
  readonly mode = 'auto_match' as const;

  constructor(
    private readonly locations: DriverLocationService,
    private readonly drivers: DriversService,
  ) {}

  /**
   * Uses the `DispatchContext` for the debt limit ONLY — proximity mode still
   * has no use for the zone. The limit cannot be dropped the way `geozoneId`
   * is: eligibility is shared with the queue strategy through `toCandidates`,
   * and a mode that quietly kept the old `< 0` rule would block cash-carrying
   * drivers under auto-match and not under queue mode (#12).
   */
  async findCandidates(
    request: RideRequest,
    ctx: DispatchContext,
  ): Promise<DriverCandidate[]> {
    const nearby = await this.locations.findNearest(request.pickup.location);
    // `findMatchAttributes` short-circuits on [] anyway, but this round trip is
    // on the tick loop.
    if (nearby.length === 0) return [];

    const attrs = await this.drivers.findMatchAttributes(
      nearby.map((d) => d.driverId),
    );

    // `findNearest` already returns nearest-first — do NOT re-sort.
    return toCandidates(nearby, attrs, request, ctx.driverDebtLimitCents);
  }
}
