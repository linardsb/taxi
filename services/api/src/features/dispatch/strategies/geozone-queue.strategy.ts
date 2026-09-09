import { Inject, Injectable } from '@nestjs/common';
import type {
  DispatchContext,
  DispatchStrategy,
  DriverCandidate,
  RideRequest,
} from '@taxi/shared';
import { DriversService, DriverLocationService } from '../../drivers';
import {
  DISPATCH_QUEUE_STORE,
  type DispatchQueueStore,
} from '../queue/dispatch-queue.store';
import { QueueNotifier } from '../queue/queue-notifier';
import { toCandidates } from './candidate-filter';

/**
 * "Izsaukumi rindas kārtībā" (S7-2): the rank decides, not the distance.
 *
 * Same proximity + eligibility pipeline as auto-match, then re-ranked by
 * position in the zone's queue. Sorting by `queuePosition` ONLY is the whole
 * point — adding distance as a tiebreak would leak the fairness this mode exists
 * to provide back out.
 */
@Injectable()
export class GeozoneQueueStrategy implements DispatchStrategy {
  readonly mode = 'geozone_queue' as const;

  constructor(
    private readonly locations: DriverLocationService,
    private readonly drivers: DriversService,
    @Inject(DISPATCH_QUEUE_STORE) private readonly queue: DispatchQueueStore,
    private readonly queueNotifier: QueueNotifier,
  ) {}

  async findCandidates(
    request: RideRequest,
    ctx: DispatchContext,
  ): Promise<DriverCandidate[]> {
    const nearby = await this.locations.findNearest(request.pickup.location);
    if (nearby.length === 0) return [];

    const attrs = await this.drivers.findMatchAttributes(
      nearby.map((d) => d.driverId),
    );
    const eligible = toCandidates(
      nearby,
      attrs,
      request,
      ctx.driverDebtLimitCents,
    );

    // A pickup in no zone has no queue to rank by; proximity order stands.
    if (ctx.geozoneId === null || eligible.length === 0) return eligible;

    const zoneId = ctx.geozoneId;
    const ids = eligible.map((c) => c.driverId);

    // LAZY ENROLLMENT. Zone-entry enrollment would need point-in-polygon on
    // every location ping, and that path is forbidden from touching Drizzle —
    // so a driver is enrolled the first time dispatch sees them in the zone
    // instead. An already-queued driver keeps their earned position
    // (`joinBack` is idempotent), which is the property that matters.
    //
    // A batch of newly-seen drivers is enrolled in their PROXIMITY order, which
    // is arbitrary-but-stable. That is the lazy-enrollment compromise, not a
    // fairness claim: nobody was in the rank, so there was no order to honour.
    const known = await this.queue.positions(zoneId, ids);
    const newcomers = ids.filter((driverId) => !known.has(driverId));
    for (const driverId of newcomers) {
      await this.queue.joinBack(zoneId, driverId);
    }
    // The zone's ranks changed: every queued driver hears theirs (#15). No
    // zone-entry enrolment exists, so this is the FIRST `driver:queue` a
    // newcomer ever receives.
    if (newcomers.length) await this.queueNotifier.broadcast(zoneId);

    const positions = newcomers.length
      ? await this.queue.positions(zoneId, ids)
      : known;

    // The sentinel is for SORTING only and never reaches a candidate: a driver
    // the queue still does not know sorts last rather than jumping the rank,
    // but `queuePosition` stays absent on them — `rideOfferSchema` types it as a
    // 1-based rank, and MAX_SAFE_INTEGER on an offer card is a lie, not a rank.
    const rankOf = (driverId: string) =>
      positions.get(driverId) ?? Number.MAX_SAFE_INTEGER;

    return [...eligible]
      .sort((x, y) => rankOf(x.driverId) - rankOf(y.driverId))
      .map((candidate) => {
        const queuePosition = positions.get(candidate.driverId);
        return queuePosition === undefined
          ? candidate
          : { ...candidate, queuePosition };
      });
  }
}
