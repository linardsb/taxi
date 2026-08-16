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
import { BOARD_EMIT_INTERVAL_MS, BOARD_RIDES_LIMIT } from './board.policy';

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
   * joined query), the Redis online set (with whatever positions exist), and
   * a zone per positioned driver. Every timestamp is serialized here, off the
   * server clock — the wire schema takes ISO strings only.
   */
  async buildBoardState(cityId: string): Promise<DispatchBoardEvent> {
    const nowMs = Date.now();
    const [rides, online] = await Promise.all([
      this.rides.findBoardRides(BOARD_RIDES_LIMIT),
      this.locations.listOnline(cityId),
    ]);

    const contacts = new Map(
      (await this.drivers.findBoardContacts(online.map((d) => d.driverId))).map(
        (c) => [c.driverId, c],
      ),
    );
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
        // Same arithmetic as the sweeper's isStale, but only a `requested`
        // ride is "unclaimed" — an offered/queued ride has the engine on it.
        unclaimedSeconds:
          r.status === 'requested'
            ? Math.max(0, Math.round((nowMs - r.createdAt.getTime()) / 1000))
            : 0,
      })),
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
