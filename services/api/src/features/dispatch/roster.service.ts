import { Inject, Injectable } from '@nestjs/common';
import type { DispatchRoster } from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import {
  DRIVER_LOCATION_STORE,
  DriversService,
  type DriverLocationStore,
} from '../drivers';
import { GeozonesService } from '../geozones';
import { RidesRepository } from '../rides';
import { ROSTER_LIMIT } from './dispatch.policy';

/**
 * Who Dina can put on a ride (#19) — EVERY driver, not the online set.
 *
 * A sibling of `BoardService`, not a part of it, and the difference is the
 * cadence. The board frame is pushed every `BOARD_EMIT_INTERVAL_MS` and
 * persisted to localStorage on every receipt; the roster changes when a driver
 * is approved or deactivated. This is fetched when the picker OPENS. Putting
 * it on the frame would multiply a slow-moving list by 30 emissions a minute
 * and grow the driver-PII blob on a shared operator workstation for nothing.
 */
@Injectable()
export class RosterService {
  constructor(
    private readonly drivers: DriversService,
    @Inject(DRIVER_LOCATION_STORE)
    private readonly locations: DriverLocationStore,
    private readonly geozones: GeozonesService,
    private readonly rides: RidesRepository,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /**
   * Three reads, joined in memory: the roster rows, the online set (for
   * positions), and who is currently on a ride.
   *
   * Zone resolution runs ONLY for drivers with a recorded position, which is
   * the online set — an offline driver has no position by construction
   * (`markOffline` drops it), so the point-in-polygon fan-out here is bounded
   * by the same number `board.service.ts` documents its own ceiling against,
   * not by the roster size. Do not widen it to every driver: that would put a
   * per-driver `ST_Contains` behind a request that already competes with the
   * booking path for connections.
   */
  async listRoster(cityId: string): Promise<DispatchRoster> {
    const nowMs = Date.now();
    const [contacts, online, activeRides] = await Promise.all([
      this.drivers.findRosterContacts(ROSTER_LIMIT),
      this.locations.listOnline(cityId),
      this.rides.findActiveRideIdsByDriver(),
    ]);

    const positioned = online.filter((d) => d.location !== null);
    const zones = await Promise.all(
      positioned.map((d) =>
        // `positioned` is filtered above, so the non-null assertion the
        // compiler wants is avoided by re-reading the field inside the guard.
        d.location
          ? this.geozones.resolveForPoint(cityId, d.location)
          : Promise.resolve(undefined),
      ),
    );

    const zoneByDriver = new Map<string, string>();
    positioned.forEach((d, i) => {
      const name = zones[i]?.name;
      if (name !== undefined) zoneByDriver.set(d.driverId, name);
    });
    const rideByDriver = new Map(
      activeRides.map((r) => [r.driverId, r.rideId]),
    );

    return {
      at: new Date(nowMs).toISOString(),
      drivers: contacts
        .map((c) => ({
          driverId: c.driverId,
          // Same fallback rule as the board's: the wire schema promises a
          // non-null name, and the phone is the one identifier every driver
          // has and the one Dina dials anyway.
          name: c.name ?? c.phone,
          phone: c.phone,
          status: c.status,
          vehiclePlate: c.vehiclePlate,
          zoneName: zoneByDriver.get(c.driverId) ?? null,
          activeRideId: rideByDriver.get(c.driverId) ?? null,
        }))
        // Sorted HERE rather than in SQL so the order survives the in-memory
        // join above, and in `lv` so Ā sorts where a Latvian reader expects.
        .sort((a, b) => a.name.localeCompare(b.name, 'lv')),
    };
  }
}
