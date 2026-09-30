import { Inject, Injectable } from '@nestjs/common';
import { drivers, rides, users, vehicles, type Db } from '@taxi/db';
import {
  ACTIVE_DRIVER_RIDE_STATUSES,
  readDisplayName,
  type AdminDriverSummary,
  type AdminDriverUpdate,
  type AdminVehicleUpdate,
  type DriverApprovalStatus,
  type DriverStatus,
  type Vehicle,
} from '@taxi/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../../common/db/db.module';
import { toVehicle } from '../vehicles.repository';

/**
 * The caller's ceiling, not a page — the `findRosterContacts` shape. `derived`:
 * 10× the PRD's ≥10-driver pilot target ×5 headroom = 500. No cursor, so a list
 * over it silently loses its oldest rows; ordered newest-first so the review
 * queue is what survives.
 */
const LIST_LIMIT = 500;

export type SetApprovalResult =
  | { outcome: 'not_found' }
  | { outcome: 'on_ride' }
  | {
      outcome: 'ok';
      previousStatus: DriverStatus;
      previousApproval: DriverApprovalStatus;
    };

/** The `users` half of a driver, which the drivers slice's profile does not carry. */
export interface DriverUserFields {
  displayName: string | null;
  phone: string;
  createdAt: Date;
}

/**
 * Admin-only reads and writes over the drivers slice's tables (#20). Kept out
 * of `drivers.repository.ts`, which serves the driver app and dispatch and has
 * no room under the 500-line cap.
 */
@Injectable()
export class AdminDriversRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async list(approval?: DriverApprovalStatus): Promise<AdminDriverSummary[]> {
    const rows = await this.db
      .select({
        userId: drivers.userId,
        displayName: users.displayName,
        phone: users.phone,
        approvalStatus: drivers.approvalStatus,
        status: drivers.status,
        createdAt: users.createdAt,
      })
      .from(drivers)
      .innerJoin(users, eq(users.id, drivers.userId))
      .where(approval ? eq(drivers.approvalStatus, approval) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(LIST_LIMIT);
    if (rows.length === 0) return [];

    // A second query rather than an aggregate: one row per vehicle, grouped here.
    const cars = await this.db
      .select({
        driverId: vehicles.driverId,
        plate: vehicles.plate,
        category: vehicles.category,
      })
      .from(vehicles)
      .where(
        inArray(
          vehicles.driverId,
          rows.map((r) => r.userId),
        ),
      )
      .orderBy(vehicles.plate);
    return rows.map((r) => ({
      ...r,
      displayName: readDisplayName(r.displayName),
      vehicles: cars
        .filter((c) => c.driverId === r.userId)
        .map(({ plate, category }) => ({ plate, category })),
    }));
  }

  async userFields(userId: string): Promise<DriverUserFields | undefined> {
    const [row] = await this.db
      .select({
        displayName: users.displayName,
        phone: users.phone,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row && { ...row, displayName: readDisplayName(row.displayName) };
  }

  /**
   * `false` when there is no drivers row. Each column is written only when its
   * key is present: `commissionPctOverride: null` clears the override,
   * `undefined` leaves it.
   */
  async update(userId: string, patch: AdminDriverUpdate): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(drivers)
        // An explicit allowlist, like `DriversRepository.updateProfile`. The
        // `userId` no-op keeps `.set()` non-empty for a name-only patch.
        .set({
          userId,
          ...(patch.spokenLanguages === undefined
            ? {}
            : { spokenLanguages: patch.spokenLanguages }),
          ...(patch.isFemale === undefined ? {} : { isFemale: patch.isFemale }),
          ...(patch.commissionPctOverride === undefined
            ? {}
            : { commissionPctOverride: patch.commissionPctOverride }),
        })
        .where(eq(drivers.userId, userId))
        .returning({ userId: drivers.userId });
      if (!row) return false;
      if (patch.displayName !== undefined)
        await tx
          .update(users)
          .set({ displayName: patch.displayName })
          .where(eq(users.id, userId));
      return true;
    });
  }

  /**
   * One transaction, row-locked, deciding everything from the locked read.
   *
   * The active-ride check is a SEPARATE statement after the lock: under READ
   * COMMITTED it takes a fresh snapshot, so it sees a ride an accept committed
   * while this waited on the lock. The `rides` reads are plain SELECTs and the
   * only write is this `drivers` row — it never locks a ride, which is what
   * keeps it cycle-free against accept/force-assign (rides → drivers).
   */
  async setApproval(
    userId: string,
    to: DriverApprovalStatus,
  ): Promise<SetApprovalResult> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          status: drivers.status,
          approvalStatus: drivers.approvalStatus,
        })
        .from(drivers)
        .where(eq(drivers.userId, userId))
        .for('update');
      if (!row) return { outcome: 'not_found' };

      if (to !== 'approved') {
        if (row.status === 'on_ride') return { outcome: 'on_ride' };
        const [active] = await tx
          .select({ one: sql`1` })
          .from(rides)
          .where(
            and(
              eq(rides.driverId, userId),
              inArray(rides.status, [...ACTIVE_DRIVER_RIDE_STATUSES]),
            ),
          )
          .limit(1);
        if (active) return { outcome: 'on_ride' };
      }

      const status: DriverStatus =
        to !== 'approved' && row.status === 'online' ? 'offline' : row.status;
      await tx
        .update(drivers)
        .set({ approvalStatus: to, status })
        .where(eq(drivers.userId, userId));
      return {
        outcome: 'ok',
        previousStatus: row.status,
        previousApproval: row.approvalStatus,
      };
    });
  }

  async vehicleOwner(vehicleId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ driverId: vehicles.driverId })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);
    return row?.driverId;
  }

  /**
   * Unscoped by owner — the admin may edit any car, `category` included.
   *
   * The `set` object is an explicit ALLOWLIST, as `VehiclesRepository.update`
   * is: `id` and `driverId` are never in it, so no request shape can re-parent
   * a car. Do not replace this with a spread of the patch.
   */
  async updateVehicle(
    vehicleId: string,
    patch: AdminVehicleUpdate,
  ): Promise<Vehicle | undefined> {
    const [row] = await this.db
      .update(vehicles)
      .set({
        ...(patch.plate === undefined ? {} : { plate: patch.plate }),
        ...(patch.make === undefined ? {} : { make: patch.make }),
        ...(patch.model === undefined ? {} : { model: patch.model }),
        ...(patch.year === undefined ? {} : { year: patch.year }),
        ...(patch.category === undefined ? {} : { category: patch.category }),
        ...(patch.passengerSeats === undefined
          ? {}
          : { passengerSeats: patch.passengerSeats }),
        ...(patch.hasChildSeat === undefined
          ? {}
          : { hasChildSeat: patch.hasChildSeat }),
      })
      .where(eq(vehicles.id, vehicleId))
      .returning();
    return row && toVehicle(row);
  }
}
