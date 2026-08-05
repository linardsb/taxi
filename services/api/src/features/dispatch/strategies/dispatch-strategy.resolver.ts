import { Injectable } from '@nestjs/common';
import type { DispatchStrategy, PlatformConfig } from '@taxi/shared';
import type { ResolvedGeozone } from '../../geozones';
import { AutoMatchStrategy } from './auto-match.strategy';
import { GeozoneQueueStrategy } from './geozone-queue.strategy';

/**
 * Zone → mode → strategy. The seam between "where is this pickup" and "how do we
 * pick a driver", and the only place either concrete strategy is named.
 */
@Injectable()
export class DispatchStrategyResolver {
  constructor(
    private readonly autoMatch: AutoMatchStrategy,
    private readonly geozoneQueue: GeozoneQueueStrategy,
  ) {}

  /**
   * "Mode selected per geozone, falling back to the city default"
   * (`dispatch-strategies.md`).
   *
   * `queueModeEnabled` is a non-nullable boolean, so `false` genuinely means
   * "this zone opted out" and correctly falls back to `defaultDispatchMode`
   * rather than forcing auto-match — a city whose default is `geozone_queue`
   * must keep it in an unflagged zone.
   *
   * A pickup in NO zone is `undefined` and also takes the city default.
   */
  forZone(
    zone: ResolvedGeozone | undefined,
    config: PlatformConfig,
  ): DispatchStrategy {
    const mode = zone?.queueModeEnabled
      ? 'geozone_queue'
      : config.defaultDispatchMode;

    return mode === 'geozone_queue' ? this.geozoneQueue : this.autoMatch;
  }
}
