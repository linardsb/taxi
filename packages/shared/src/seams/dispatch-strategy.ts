import type { DispatchMode, DriverStatus } from '../enums';
import type { LatLng } from '../schemas/geo';
import type { RideRequest } from '../schemas/ride';

export interface DriverCandidate {
  driverId: string;
  location: LatLng;
  status: DriverStatus;
  etaSeconds: number;
  /** Position in the geozone queue, when the queue strategy produced this candidate. */
  queuePosition?: number;
}

export interface DispatchContext {
  geozoneId: string | null;
  cityId: string;
  /**
   * `platform_config.driver_debt_limit_cents`, carried to the eligibility
   * filter. On the context rather than read inside a strategy because
   * `DispatchService` already resolves the config row per tick and neither
   * strategy may grow its own config read (#12).
   */
  driverDebtLimitCents: number;
}

/**
 * Seam for the two dispatch modes (decided 2026-07-06): auto_match
 * (nearest eligible driver, Bolt-style offer cascade) and geozone_queue
 * ("izsaukumi rindas kārtībā"). Dispatcher override is NOT a strategy —
 * it is a privileged command that works under either mode.
 */
export interface DispatchStrategy {
  readonly mode: DispatchMode;
  findCandidates(
    request: RideRequest,
    ctx: DispatchContext,
  ): Promise<DriverCandidate[]>;
}
