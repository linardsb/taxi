import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Vehicle, VehicleCreate, VehicleUpdate } from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { DriversRepository } from './drivers.repository';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from './location/driver-location.store';
import { VehiclesRepository } from './vehicles.repository';

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    private readonly vehicles: VehiclesRepository,
    private readonly drivers: DriversRepository,
    @Inject(DRIVER_LOCATION_STORE)
    private readonly locations: DriverLocationStore,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  list(userId: string): Promise<Vehicle[]> {
    return this.vehicles.listForDriver(userId);
  }

  /**
   * `findOrCreate` first: `vehicles.driver_id` FKs `drivers.user_id`, so an
   * insert for a driver who has never called GET /drivers/me would fail with a
   * raw FK violation (a 500 for a perfectly valid request).
   */
  async create(userId: string, input: VehicleCreate): Promise<Vehicle> {
    await this.drivers.findOrCreate(userId);
    return this.vehicles.create(userId, input);
  }

  async update(
    userId: string,
    vehicleId: string,
    patch: VehicleUpdate,
  ): Promise<Vehicle> {
    const updated = await this.vehicles.update(userId, vehicleId, patch);
    // 404, never 403: the repository scopes by owner in SQL, so someone else's
    // vehicle is indistinguishable from one that does not exist.
    if (!updated) throw new NotFoundException('vehicle_not_found');
    return updated;
  }

  /**
   * The symmetric half of `setPresence`'s `vehicle_required` rule. Without it a
   * driver deletes their only car and stays online — offered rides they cannot
   * take, and unfilterable by #10.
   */
  async remove(userId: string, vehicleId: string): Promise<void> {
    if (!(await this.vehicles.remove(userId, vehicleId)))
      throw new NotFoundException('vehicle_not_found');

    if ((await this.vehicles.countForDriver(userId)) > 0) return;

    const profile = await this.drivers.findOrCreate(userId);
    if (profile.status !== 'online') return;

    await this.locations.markOffline(this.env.DEFAULT_CITY_ID, userId);
    await this.drivers.setStatus(userId, 'offline');
    this.logger.log({
      event: 'driver.presence.forced_offline',
      driverId: userId,
      reason: 'no_vehicle',
      at: new Date().toISOString(),
    });
  }
}
