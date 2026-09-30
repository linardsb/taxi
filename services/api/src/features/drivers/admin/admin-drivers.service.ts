import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AdminDriverDetail,
  AdminDriverSummary,
  AdminDriverUpdate,
  AdminVehicleUpdate,
  DriverApprovalStatus,
  Vehicle,
} from '@taxi/shared';
import { APP_ENV, type Env } from '../../../common/config/env.schema';
import { DriversRepository } from '../drivers.repository';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '../location/driver-location.store';
import { isPlateConflict, VehiclesRepository } from '../vehicles.repository';
import { VehiclesService } from '../vehicles.service';
import { AdminDriversRepository } from './admin-drivers.repository';

/** Driver review and CRUD for the admin panel (#20). Every caller is `@Roles('admin')`. */
@Injectable()
export class AdminDriversService {
  private readonly logger = new Logger(AdminDriversService.name);

  constructor(
    private readonly admin: AdminDriversRepository,
    private readonly drivers: DriversRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly vehiclesService: VehiclesService,
    @Inject(DRIVER_LOCATION_STORE)
    private readonly locations: DriverLocationStore,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  list(approval?: DriverApprovalStatus): Promise<AdminDriverSummary[]> {
    return this.admin.list(approval);
  }

  async detail(userId: string): Promise<AdminDriverDetail> {
    const [profile, user, vehicles] = await Promise.all([
      this.drivers.find(userId),
      this.admin.userFields(userId),
      this.vehicles.listForDriver(userId),
    ]);
    if (!profile || !user) throw new NotFoundException('driver_not_found');
    return {
      userId,
      ...user,
      approvalStatus: profile.approvalStatus,
      status: profile.status,
      profile,
      vehicles,
    };
  }

  async update(
    userId: string,
    patch: AdminDriverUpdate,
  ): Promise<AdminDriverDetail> {
    if (!(await this.admin.update(userId, patch)))
      throw new NotFoundException('driver_not_found');
    return this.detail(userId);
  }

  /**
   * Postgres FIRST, then Redis — the opposite of `setPresence`'s offline
   * branch. The locked transaction is what decides whether the driver is on a
   * ride; clearing Redis before it would strand an `on_ride` driver's position
   * feed (the case `markOfflineByServer` repairs). A failure between the two
   * leaves a Redis member whose row says offline and not approved, which
   * `candidate-filter` rejects on both counts — still undispatchable.
   *
   * Not `markOfflineByServer`: that stamps the "you've gone offline, come
   * back" nudge, the wrong push for a rejected driver.
   */
  async setApproval(
    actorId: string,
    userId: string,
    to: DriverApprovalStatus,
  ): Promise<AdminDriverDetail> {
    const result = await this.admin.setApproval(userId, to);
    if (result.outcome === 'not_found')
      throw new NotFoundException('driver_not_found');
    if (result.outcome === 'on_ride')
      throw new ConflictException('driver_on_ride');

    // Idempotent, and also drops a stale member for an already-offline row.
    if (to !== 'approved')
      await this.locations.markOffline(this.env.DEFAULT_CITY_ID, userId);

    this.logger.log({
      event: 'driver.approval.status_changed',
      driverId: userId,
      actorId,
      from: result.previousApproval,
      to,
      forcedOffline: to !== 'approved' && result.previousStatus === 'online',
      at: new Date().toISOString(),
    });
    return this.detail(userId);
  }

  async updateVehicle(
    vehicleId: string,
    patch: AdminVehicleUpdate,
  ): Promise<Vehicle> {
    let updated: Vehicle | undefined;
    try {
      updated = await this.admin.updateVehicle(vehicleId, patch);
    } catch (err) {
      if (isPlateConflict(err)) throw new ConflictException('plate_taken');
      throw err;
    }
    if (!updated) throw new NotFoundException('vehicle_not_found');
    return updated;
  }

  /** Delegates to the driver's own delete, so its on-ride refusal and last-car-goes-offline rule are reused. */
  async removeVehicle(vehicleId: string): Promise<void> {
    const ownerId = await this.admin.vehicleOwner(vehicleId);
    if (!ownerId) throw new NotFoundException('vehicle_not_found');
    await this.vehiclesService.remove(ownerId, vehicleId);
  }
}
