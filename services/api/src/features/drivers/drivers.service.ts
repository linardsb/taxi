import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DriverMe,
  DriverPresenceStatus,
  DriverProfile,
  DriverProfileUpdate,
} from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import {
  DriversRepository,
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

  /** The driver app's whole bootstrap. The first call provisions the `drivers` row. */
  async getMe(userId: string): Promise<DriverMe> {
    const profile = await this.drivers.findOrCreate(userId);
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
    // by hand and take a second offer.
    if (profile.status === 'on_ride')
      throw new ConflictException('driver_on_ride');

    const cityId = this.env.DEFAULT_CITY_ID;
    let updated: DriverProfile;

    if (status === 'online') {
      // `auto_match` filters on `category` and `hasChildSeat`, both vehicle
      // attributes — an online driver with no vehicle is a candidate #10 can
      // only ever discard.
      if ((await this.vehicles.countForDriver(userId)) === 0)
        throw new ConflictException('vehicle_required');
      updated = await this.drivers.setStatus(userId, 'online');
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

  /** #10's entry point: the attributes it filters a proximity list by. */
  findMatchAttributes(driverIds: string[]): Promise<DriverMatchAttributes[]> {
    return this.drivers.findMatchAttributes(driverIds);
  }
}
