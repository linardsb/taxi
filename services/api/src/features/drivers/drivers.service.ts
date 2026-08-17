import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DriverMe,
  DriverPresenceStatus,
  DriverProfile,
  DriverProfileUpdate,
} from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import type { DbTx } from '../../common/db/db.module';
import {
  DriversRepository,
  type DriverBoardContact,
  type DriverRosterContact,
  type DriverMatchAttributes,
} from './drivers.repository';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from './location/driver-location.store';
import { VehiclesRepository } from './vehicles.repository';

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(
    private readonly drivers: DriversRepository,
    private readonly vehicles: VehiclesRepository,
    @Inject(DRIVER_LOCATION_STORE)
    private readonly locations: DriverLocationStore,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /**
   * The driver app's whole bootstrap. The FIRST call provisions the `drivers`
   * row; every later one only reads it.
   *
   * Read-then-provision rather than a straight `findOrCreate` (L5): the latter
   * is an UPDATE even when nothing changes, so this call — which runs on every
   * app open — left a dead tuple behind each time. Still race-safe, because the
   * fallback is the same atomic upsert: two concurrent first calls both miss
   * the SELECT and both land on `findOrCreate`, which is built for exactly that.
   */
  async getMe(userId: string): Promise<DriverMe> {
    const profile =
      (await this.drivers.find(userId)) ??
      (await this.drivers.findOrCreate(userId));
    return { profile, vehicles: await this.vehicles.listForDriver(userId) };
  }

  /**
   * `findOrCreate` first, like every other write path in this slice: a driver
   * whose first call is PATCH has no row yet, and the bare UPDATE would match
   * nothing and 500 on a perfectly valid request.
   */
  async updateProfile(
    userId: string,
    patch: DriverProfileUpdate,
  ): Promise<DriverProfile> {
    await this.drivers.findOrCreate(userId);
    return this.drivers.updateProfile(userId, patch);
  }

  /**
   * The two stores are written in OPPOSITE orders on purpose, so that both
   * halves fail toward *not dispatchable*:
   *
   * Going online, Postgres commits first. A Redis failure after it leaves a
   * driver who believes they are online but receives nothing — visible to them,
   * and self-healing on the next toggle.
   *
   * Going offline, Redis is cleared first. A Postgres failure after it leaves a
   * driver who is already undispatchable while the durable record catches up.
   *
   * Either order reversed would hand rides to a driver who is not there.
   */
  async setPresence(
    userId: string,
    status: DriverPresenceStatus,
  ): Promise<DriverProfile> {
    // A driver may toggle before ever GETting /me.
    const profile = await this.drivers.findOrCreate(userId);

    // #11 owns entering and leaving `on_ride`; a driver must not step out of it
    // by hand and take a second offer. Cheap first gate only: chain A's driver
    // (#61) is `offline` with a live ride, which is what the rides-table check
    // inside `setOnlineIfEligible` catches below.
    if (profile.status === 'on_ride')
      throw new ConflictException('driver_on_ride');

    const cityId = this.env.DEFAULT_CITY_ID;
    let updated: DriverProfile;

    if (status === 'online') {
      // `auto_match` filters on `category` and `hasChildSeat`, both vehicle
      // attributes — an online driver with no vehicle is a candidate #10 can
      // only ever discard.
      //
      // The vehicle check is INSIDE the update (L8). Counting first and setting
      // after left a window for a concurrent delete of the last vehicle to slip
      // between them, which is how a driver ended up online with no car.
      const online = await this.drivers.setOnlineIfEligible(userId);
      if (!online) {
        // The UPDATE said no; this read only picks the message. #61 chain A: an
        // active ride outranks a missing vehicle — that driver is mid-ride, and
        // `vehicle_required` would send them to the garage instead of the ride.
        throw new ConflictException(
          (await this.drivers.hasActiveRide(userId))
            ? 'driver_on_ride'
            : 'vehicle_required',
        );
      }
      updated = online;
      await this.locations.markOnline(cityId, userId);
    } else {
      await this.locations.markOffline(cityId, userId);
      updated = await this.drivers.setStatus(userId, 'offline');
    }

    this.logger.log({
      event: 'driver.presence.status_changed',
      driverId: userId,
      from: profile.status,
      to: updated.status,
      at: new Date().toISOString(),
    });
    return updated;
  }

  /**
   * Clears presence when a driver's LAST socket goes away (#38). Before this,
   * a force-quit left them `online` in Postgres and in all three
   * `drivers:*:<city>` keys forever: dispatch was safe, because the freshness
   * filter drops a stale position from `findNearest`, but #18's board and #20's
   * stats would both have read a ghost as available.
   *
   * Same Redis-then-Postgres order as `setPresence`'s offline branch, and for
   * the same reason — a failure between the two must leave the driver
   * undispatchable, never the reverse.
   */
  async clearPresenceOnDisconnect(userId: string): Promise<void> {
    const status = (await this.drivers.find(userId))?.status;

    // Only `online` is this path's to clear. `on_ride` belongs to #11 — a
    // driver whose app crashes mid-ride must not be dropped off the ride by a
    // lost socket — and `offline`/no row is already where this would land.
    if (status !== 'online') return;

    await this.locations.markOffline(this.env.DEFAULT_CITY_ID, userId);
    await this.drivers.setStatus(userId, 'offline');

    this.logger.log({
      event: 'driver.presence.status_changed',
      driverId: userId,
      from: 'online',
      to: 'offline',
      reason: 'socket_disconnected',
      at: new Date().toISOString(),
    });
  }

  /**
   * `on_ride` claim and release — the ONLY two writers of that status, both
   * reached through #11's lifecycle (`services/api/CLAUDE.md`). Without the
   * claim, `candidate-filter.ts` still sees an accepted driver as `online` and
   * the very next sweeper tick offers them a second car.
   *
   * `false` means the conditional UPDATE matched nothing, which is ordinary —
   * see `DriversRepository.claimForRide`. Neither method throws.
   *
   * Both run INSIDE the caller's transaction, so the log line is deliberately
   * modest: it records that the statement matched, not that the ride moved.
   * The caller's post-commit `ride.lifecycle.transition_applied` is the
   * authoritative record, and a rollback would make anything stronger a lie.
   */
  async claimForRide(driverId: string, tx?: DbTx): Promise<boolean> {
    const claimed = await this.drivers.claimForRide(driverId, tx);
    if (claimed) {
      this.logger.log({
        event: 'driver.presence.claimed_for_ride',
        driverId,
        from: 'online',
        to: 'on_ride',
        at: new Date().toISOString(),
      });
    }
    return claimed;
  }

  async releaseFromRide(driverId: string, tx?: DbTx): Promise<boolean> {
    const released = await this.drivers.releaseFromRide(driverId, tx);
    if (released) {
      this.logger.log({
        event: 'driver.presence.released_from_ride',
        driverId,
        from: 'on_ride',
        to: 'online',
        at: new Date().toISOString(),
      });
    }
    return released;
  }

  /** #10's entry point: the attributes it filters a proximity list by. */
  findMatchAttributes(driverIds: string[]): Promise<DriverMatchAttributes[]> {
    return this.drivers.findMatchAttributes(driverIds);
  }

  /** #18's entry point: who the online set IS — name, phone, status. */
  findBoardContacts(driverIds: string[]): Promise<DriverBoardContact[]> {
    return this.drivers.findBoardContacts(driverIds);
  }

  /** #19's entry point: EVERY driver, offline ones included — the override picker. */
  findRosterContacts(): Promise<DriverRosterContact[]> {
    return this.drivers.findRosterContacts();
  }
}
