import { Injectable } from '@nestjs/common';
import type { PlatformConfig } from '@taxi/shared';
import { PlatformConfigRepository } from './platform-config.repository';

/**
 * The slice's public API. Thin on purpose: it exists so #10 (`offerTimeoutSeconds`,
 * `defaultDispatchMode`, `unclaimedAlertSeconds`) and #20 depend on a service
 * rather than a repository, and so a cache can be added in ONE place later.
 *
 * Do not add that cache now — a per-request read of a single-row table in a
 * ≤10-driver pilot is not the bottleneck, and a stale commission is a money bug.
 */
@Injectable()
export class PlatformConfigService {
  constructor(private readonly repository: PlatformConfigRepository) {}

  forCity(cityId: string): Promise<PlatformConfig> {
    return this.repository.forCity(cityId);
  }
}
