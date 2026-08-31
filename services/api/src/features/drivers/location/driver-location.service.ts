import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  RT,
  type DriverLocationAck,
  type DriverLocationPing,
  type LatLng,
} from '@taxi/shared';
import { APP_ENV, type Env } from '../../../common/config/env.schema';
import { RealtimeService } from '../../realtime';
import {
  NEAREST_DEFAULT_LIMIT,
  NEAREST_DEFAULT_RADIUS_METERS,
  DRIVER_LOCATION_TTL_SECONDS,
} from './driver-location.policy';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
  type NearbyDriver,
} from './driver-location.store';

/**
 * The hot path. This class has NO Drizzle dependency, and that is the whole
 * feature: a location ping must never reach Postgres (issue #8 AC 2). If you
 * find yourself needing the database here, you are solving the wrong problem —
 * presence lives in the Redis online set precisely so this stays true.
 * driver-location.service.spec.ts boots this path with a DRIZZLE provider that
 * throws on any access; adding one here fails that test.
 */
@Injectable()
export class DriverLocationService {
  private readonly logger = new Logger(DriverLocationService.name);

  constructor(
    @Inject(DRIVER_LOCATION_STORE)
    private readonly store: DriverLocationStore,
    private readonly realtime: RealtimeService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /**
   * The ping carries an `at` and we ignore it for storage. Freshness decided by
   * a client clock is freshness a skewed or hostile phone controls — it would
   * stay dispatchable forever, or evaporate instantly. Same boundary rule as
   * taking `driverId` from the JWT rather than the payload.
   *
   * Returns the ack the gateway hands back to the phone (#14): the app deletes
   * a queued fix only on `accepted: true`. Store errors are NOT caught here —
   * the gateway maps them to `store_unavailable`.
   */
  async ingest(
    driverId: string,
    ping: DriverLocationPing,
  ): Promise<DriverLocationAck> {
    const atMs = Date.now(); // SERVER clock
    const cityId = this.env.DEFAULT_CITY_ID;

    const accepted = await this.store.record(
      cityId,
      driverId,
      ping.location,
      atMs,
    );
    if (!accepted) {
      this.logger.warn({
        event: 'driver.location.ping_ignored',
        driverId,
        reason: 'not_online',
        at: new Date(atMs).toISOString(),
      });
      return { accepted: false, reason: 'not_online' };
    }

    // Debug, not log: one line per fix per driver. It is also the only
    // server-side track there is (no `ride_tracks` yet) — `clientAt` contiguity
    // across a dead zone is what the #14 field check reads.
    this.logger.debug({
      event: 'driver.location.ping_accepted',
      driverId,
      clientAt: ping.at,
      at: new Date(atMs).toISOString(),
      lagMs: atMs - Date.parse(ping.at),
    });

    // Dispatch room only. #11 adds the rider fan-out to the ride room during an
    // active ride — no ride can exist yet.
    // `emitToDispatch` returns void and parses through RT_EVENT_SCHEMAS before
    // sending, where `at` is `z.string().datetime()` — a Date would throw.
    this.realtime.emitToDispatch(cityId, RT.driverLocation, {
      driverId,
      location: ping.location,
      at: new Date(atMs).toISOString(),
      ...(ping.heading === undefined ? {} : { heading: ping.heading }),
    });
    return { accepted: true };
  }

  /**
   * Raw proximity, nearest first — eligibility (category, child seat, female
   * driver, positive balance) is `auto_match`'s job in #10, composed from this
   * plus `DriversService.findMatchAttributes`.
   */
  findNearest(centre: LatLng): Promise<NearbyDriver[]> {
    return this.store.findNearby(this.env.DEFAULT_CITY_ID, centre, {
      radiusMeters: NEAREST_DEFAULT_RADIUS_METERS,
      limit: NEAREST_DEFAULT_LIMIT,
      freshSinceMs: Date.now() - DRIVER_LOCATION_TTL_SECONDS * 1000,
    });
  }
}
