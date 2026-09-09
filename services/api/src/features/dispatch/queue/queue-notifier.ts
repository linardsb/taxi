import { Inject, Injectable, Logger } from '@nestjs/common';
import { RT } from '@taxi/shared';
import { GeozonesService } from '../../geozones';
import { RealtimeService } from '../../realtime';
import {
  DISPATCH_QUEUE_STORE,
  type DispatchQueueStore,
} from './dispatch-queue.store';

/**
 * The `driver:queue` emitter (#15) — every driver in a zone hears their live
 * rank after each queue mutation: lazy enrolment (`GeozoneQueueStrategy`) and
 * the decline demotion (`DispatchService.decline`).
 *
 * THE WHOLE ZONE, never the mutated driver alone: a `sendToBack` shifts
 * everyone behind the demoted driver, and emitting to one would leave the
 * others reading a stale number — the "unexplained skip" the evidence says
 * destroys more trust than no number at all (`driver-ux-evidence.md` §6.1).
 * At ≤ 10 drivers per zone that is one `LRANGE`, one Postgres `SELECT` (the
 * `geozones.findById` below, needed for the zone slug) and ≤ 10 room emits per
 * mutation (`expected`). The `SELECT` is named because it is the only one of
 * the three that leaves the process for a different store, and this runs on
 * the sweeper's per-tick path (`geozone-queue.strategy.ts`).
 *
 * A post-commit tail like `DispatchNotifier`: never throws. A lost event
 * costs one stale rank until the next mutation, never a fairness bug — the
 * store's order is the truth and this only announces it.
 */
@Injectable()
export class QueueNotifier {
  private readonly logger = new Logger(QueueNotifier.name);

  constructor(
    @Inject(DISPATCH_QUEUE_STORE) private readonly queue: DispatchQueueStore,
    private readonly geozones: GeozonesService,
    private readonly realtime: RealtimeService,
  ) {}

  async broadcast(geozoneId: string): Promise<void> {
    const at = new Date().toISOString();
    try {
      const entries = await this.queue.snapshot(geozoneId);
      if (entries.length === 0) return;

      const zone = await this.geozones.findById(geozoneId);
      if (!zone) {
        this.logger.warn({
          event: 'dispatch.queue.notify_failed',
          geozoneId,
          reason: 'unknown_zone',
          at,
        });
        return;
      }

      // `position` is the store's own 1-based rank — the same number Dina's
      // grid shows for this driver, by the `snapshot()` identity. Leave it
      // alone: `snapshotFrom` counts a duplicated driver for everyone behind
      // them on purpose, so the app and the grid agree.
      //
      // `size` therefore cannot be `entries.length`, which counts DEDUPLICATED
      // entries: on the double-append `joinBack` deliberately tolerates,
      // ['A','A','B'] yields positions 1 and 3 from a list of length 2, and B
      // would be told «3 of 2». The schema permits it (position min 1, size
      // nonnegative), so nothing else rejects it.
      //
      // So `size` is the LARGEST ISSUED RANK, and the last entry always holds
      // it: `snapshotFrom` walks the raw list assigning `position = index + 1`
      // and only ever drops repeats, so positions ascend. That over-counts by
      // the duplicates ahead of the last unique driver — A hears «1 of 3» with
      // two drivers queued — which is the deliberate trade for agreeing with
      // the rank. `entries.length` is a total-expression fallback only; the
      // empty list already returned above.
      const size = entries.at(-1)?.position ?? entries.length;
      for (const entry of entries) {
        this.realtime.emitToDriver(entry.driverId, RT.driverQueue, {
          driverId: entry.driverId,
          geozoneId,
          geozoneSlug: zone.slug,
          position: entry.position,
          size,
          at,
        });
      }
    } catch (error) {
      this.logger.warn({
        event: 'dispatch.queue.notify_failed',
        geozoneId,
        reason: error instanceof Error ? error.message : 'unknown',
        at,
      });
    }
  }
}
