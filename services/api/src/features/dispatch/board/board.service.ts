import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { RT, type DispatchBoardEvent } from '@taxi/shared';
import { APP_ENV, type Env } from '../../../common/config/env.schema';
import {
  DRIVER_LOCATION_STORE,
  DriversService,
  type DriverLocationStore,
} from '../../drivers';
import { GeozonesService } from '../../geozones';
import { RealtimeService } from '../../realtime';
import { RidesRepository } from '../../rides';
import { DispatchRepository } from '../dispatch.repository';
import {
  DISPATCH_QUEUE_STORE,
  type DispatchQueueStore,
  type QueueSnapshotEntry,
} from '../queue/dispatch-queue.store';
import { BOARD_EMIT_INTERVAL_MS, BOARD_RIDES_LIMIT } from './board.policy';
import { buildCascades } from './cascade';
import { buildZoneRows } from './zone-rows';

/**
 * One snapshot builder, two transports (#18): `GET /dispatch/board` serves it
 * on demand, and the interval below pushes it to the dispatch room every
 * `BOARD_EMIT_INTERVAL_MS`. Same payload shape either way, so the client can
 * replace its state wholesale from whichever arrives — no event-sourcing
 * merge, and any missed change is corrected by the next frame.
 *
 * Like the sweeper, this is a background process with rows (well, Redis sets)
 * as its only state; a restart strands nothing but one frame.
 */
@Injectable()
export class BoardService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BoardService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly rides: RidesRepository,
    private readonly drivers: DriversService,
    @Inject(DRIVER_LOCATION_STORE)
    private readonly locations: DriverLocationStore,
    private readonly geozones: GeozonesService,
    private readonly realtime: RealtimeService,
    private readonly dispatch: DispatchRepository,
    @Inject(DISPATCH_QUEUE_STORE)
    private readonly queue: DispatchQueueStore,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /** No auto-start under NODE_ENV=test — same rationale as DispatchSweeper. */
  onModuleInit(): void {
    if (this.env.NODE_ENV === 'test') return;

    this.timer = setInterval(
      () => void this.emitFrame(),
      BOARD_EMIT_INTERVAL_MS,
    );
    // Never hold the process open on its own account.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * The whole city in one read pass: live rides (with driver names, one
   * joined query), the Redis online set (with whatever positions exist), a
   * zone per positioned driver, the zone catalog with its queues, and each
   * ride's cascade. Every timestamp is serialized here, off the server clock —
   * the wire schema takes ISO strings only.
   *
   * POSTGRES QUERIES PER FRAME (`derived`, and the number that matters because
   * this runs 30 times a minute forever):
   *   1 rides · 1 zone catalog · 1 driver contacts · 1 offers · N `ST_Contains`
   * = **4 + N**, where N is the number of ONLINE drivers with a position.
   * #19 added 2 of those 4 and neither scales with rides or drivers: the
   * catalog is one row set, and every offer for every live ride comes back in
   * one `findOffersForRides`. Before #19 the same frame cost 2 + N.
   *
   * REDIS PER FRAME: 1 `listOnline` + one `snapshot()` per catalog zone (each
   * an LRANGE + an HGETALL). Z zones, not Z × drivers — the queue is read
   * whole, once per zone.
   *
   * The `Promise.all` below is the same fan-out the pre-#19 frame ran, with
   * the flat reads folded in beside it. It is still bounded by the FLEET, not
   * by anything #19 added — see the warning on the `ST_Contains` fan-out.
   */
  async buildBoardState(cityId: string): Promise<DispatchBoardEvent> {
    const nowMs = Date.now();
    const [rides, online, catalog] = await Promise.all([
      this.rides.findBoardRides(BOARD_RIDES_LIMIT),
      this.locations.listOnline(cityId),
      this.geozones.listForCity(cityId),
    ]);

    // Per ZONE, never per driver: ≤6 pairs of Redis calls at pilot scale, and
    // the count is bounded by the catalog rather than by the fleet.
    const snapshots = new Map<string, QueueSnapshotEntry[]>(
      await Promise.all(
        catalog.map(
          async (zone) =>
            [zone.id, await this.queue.snapshot(zone.id)] as const,
        ),
      ),
    );

    // ONE contacts read for both the online set and the queues. A driver who
    // went offline still holding position 1 is exactly what the grid must
    // show, and they are not in `online` — so their name has to come from
    // here or the row would be dropped as a ghost.
    const queuedIds = [...snapshots.values()].flatMap((entries) =>
      entries.map((e) => e.driverId),
    );
    const contacts = new Map(
      (
        await this.drivers.findBoardContacts([
          ...new Set([...online.map((d) => d.driverId), ...queuedIds]),
        ])
      ).map((c) => [c.driverId, c]),
    );

    const zoneRows = buildZoneRows({ catalog, snapshots, contacts, nowMs });
    const cascades = buildCascades({
      offers: await this.dispatch.findOffersForRides(rides.map((r) => r.id)),
      zones: zoneRows,
      // The zone each ride was DISPATCHED from, so the cascade explains that
      // queue rather than whichever one the holder also happens to sit in.
      rideZones: new Map(rides.map((r) => [r.id, r.geozoneId])),
      contacts,
    });
    // Reuses the geozone lookup dispatch's queue mode runs (smallest polygon
    // wins, in SQL) rather than a second point-in-polygon path. ≤10 pilot
    // drivers × one indexed query each per 2 s frame — bounded and boring.
    //
    // THIS IS BOUNDED BY THE FLEET SIZE, NOT BY ANYTHING HERE. `Promise.all`
    // fans out one `ST_Contains` per positioned driver, concurrently, against
    // the same pool ride booking uses — so the pilot's ≤10 becomes 200
    // concurrent queries per frame at 200 online drivers, every 2 s. Whoever
    // raises the fleet cap owns this: batch the lookup into a single query
    // (one `ST_Contains` over a VALUES list of points) before the cap moves,
    // or the board starts competing with the booking path for connections.
    const zones = await Promise.all(
      online.map((d) =>
        d.location
          ? this.geozones.resolveForPoint(cityId, d.location)
          : Promise.resolve(undefined),
      ),
    );

    return {
      cityId,
      at: new Date(nowMs).toISOString(),
      rides: rides.map((r) => ({
        rideId: r.id,
        status: r.status,
        pickup: r.pickup,
        driverId: r.driverId,
        driverName: r.driverName,
        bookingChannel: r.bookingChannel,
        requestedAt: r.createdAt.toISOString(),
        // NO LONGER the same arithmetic as the sweeper's `isStale`: #120's M3
        // re-based the ALERT's clock on the ride's last entry into the pool,
        // and this one is still time-since-booking. Deliberate for now — the
        // board reads this per ride on a 2 s frame, and re-basing it would cost
        // a `findLastReleasedAt` per row per frame for a field no screen in
        // `apps/dispatch/src` renders today. Re-base it with the first consumer.
        // Only a `requested` ride is "unclaimed" — an offered/queued ride has
        // the engine on it.
        unclaimedSeconds:
          r.status === 'requested'
            ? Math.max(0, Math.round((nowMs - r.createdAt.getTime()) / 1000))
            : 0,
        cascade: cascades.get(r.id) ?? null,
      })),
      zones: zoneRows,
      drivers: online.flatMap((d, i) => {
        const contact = contacts.get(d.driverId);
        // A member of the Redis online set without a drivers/users row would
        // be an FK impossibility — dropped rather than rendered as a ghost.
        if (!contact) return [];
        return [
          {
            driverId: d.driverId,
            // The wire schema promises a non-null name; the phone is the one
            // identifier every driver has and the one Dina dials anyway.
            name: contact.name ?? contact.phone,
            phone: contact.phone,
            location: d.location,
            lastSeenAt:
              d.lastSeenMs === null
                ? null
                : new Date(d.lastSeenMs).toISOString(),
            zoneName: zones[i]?.name ?? null,
            status: contact.status,
          },
        ];
      }),
    };
  }

  /**
   * One cadence beat. Skipped entirely while no LOCAL socket sits in the
   * dispatch room (single-node assumption — see RealtimeService.dispatchRoomSize)
   * so an idle api does no per-frame Postgres work. Never throws: a failed
   * frame is a log line and a stale pill on Dina's screen — which is the pill
   * telling the truth — and the next beat retries from scratch.
   */
  async emitFrame(): Promise<void> {
    // A build still in flight skips the beat rather than overlapping it —
    // same guard as DispatchSweeper.tick().
    if (this.running) return;
    const cityId = this.env.DEFAULT_CITY_ID;
    if (this.realtime.dispatchRoomSize(cityId) === 0) return;

    this.running = true;
    try {
      const frame = await this.buildBoardState(cityId);
      this.realtime.emitToDispatch(cityId, RT.dispatchBoard, frame);
    } catch (error) {
      this.logger.error({
        event: 'dispatch.board.emit_failed',
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
    } finally {
      this.running = false;
    }
  }
}
