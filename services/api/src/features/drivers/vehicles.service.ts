import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Vehicle, VehicleCreate, VehicleUpdate } from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { DriversRepository } from './drivers.repository';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from './location/driver-location.store';
import { isPlateConflict, VehiclesRepository } from './vehicles.repository';

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
   * The plate is unique platform-wide (migration 0004, on `upper(plate)`), so
   * both write paths can lose that race. Enforced in the database rather than
   * by a SELECT-then-INSERT, which two concurrent registrations walk straight
   * through — the check is only worth having if it is atomic.
   *
   * 409 `plate_taken` deliberately says nothing about WHO holds it: the same
   * reason vehicle routes answer 404 instead of 403, since confirming a plate
   * exists tells a driver which cars are on the platform.
   */
  private async translatingPlateConflict<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (isPlateConflict(err)) throw new ConflictException('plate_taken');
      throw err;
    }
  }

  /**
   * `findOrCreate` first: `vehicles.driver_id` FKs `drivers.user_id`, so an
   * insert for a driver who has never called GET /drivers/me would fail with a
   * raw FK violation (a 500 for a perfectly valid request).
   */
  async create(userId: string, input: VehicleCreate): Promise<Vehicle> {
    await this.drivers.findOrCreate(userId);
    return this.translatingPlateConflict(() =>
      this.vehicles.create(userId, input),
    );
  }

  async update(
    userId: string,
    vehicleId: string,
    patch: VehicleUpdate,
  ): Promise<Vehicle> {
    const updated = await this.translatingPlateConflict(() =>
      this.vehicles.update(userId, vehicleId, patch),
    );
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
    // Read BEFORE the delete: forcing offline only covers `online`, so an
    // `on_ride` driver deleting their last car would slip through untouched and
    // break the online ⟹ has-a-vehicle invariant the moment #11 restores them.
    // Refusing is also the better product answer — that is the car they are in.
    const profile = await this.drivers.findOrCreate(userId);
    if (profile.status === 'on_ride')
      throw new ConflictException('driver_on_ride');

    if (!(await this.vehicles.remove(userId, vehicleId)))
      throw new NotFoundException('vehicle_not_found');

    if ((await this.vehicles.countForDriver(userId)) > 0) return;

    // Redis first, then Postgres — the same "fail toward not dispatchable"
    // order `setPresence` documents.
    await this.locations.markOffline(this.env.DEFAULT_CITY_ID, userId);

    // A conditional UPDATE, not `profile.status !== 'online'` (L8). That status
    // was read BEFORE the delete, so a `PUT status=online` landing in between
    // was invisible: the early return left a driver online with zero cars.
    // `undefined` means they were not online, so nothing changed to report.
    const forcedOffline = await this.drivers.setOfflineIfOnline(userId);
    if (!forcedOffline) return;

    this.logger.log({
      event: 'driver.presence.forced_offline',
      driverId: userId,
      reason: 'no_vehicle',
      at: new Date().toISOString(),
    });
  }
}
