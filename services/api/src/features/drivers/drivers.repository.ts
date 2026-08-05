import { Inject, Injectable } from '@nestjs/common';
import { drivers, vehicles, type Db } from '@taxi/db';
import type {
  DriverProfile,
  DriverProfileUpdate,
  DriverStatus,
  Language,
  RideCategory,
} from '@taxi/shared';
import { and, eq, exists, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../common/db/db.module';

type DriverRow = typeof drivers.$inferSelect;

/**
 * What #10's `auto_match` filters a proximity list by. Not a shared contract:
 * it never crosses a surface boundary — the dispatch engine consumes it
 * in-process through this slice's barrel.
 */
export interface DriverMatchAttributes {
  driverId: string;
  status: DriverStatus;
  isFemale: boolean | null;
  balanceCents: number;
  /** Distinct categories across the driver's vehicles. */
  categories: RideCategory[];
  /** True when ANY of the driver's vehicles has one. */
  hasChildSeat: boolean;
  maxPassengerSeats: number;
}

/**
 * An UPDATE whose WHERE matched nothing returns no row, and `toProfile(row!)`
 * made that a bare "cannot read properties of undefined" 500 (L7). Unreachable
 * today — every caller runs `findOrCreate` first and `drivers` has no delete
 * path — so this is about what the 500 SAYS when something upstream changes.
 */
function requireRow(
  row: DriverRow | undefined,
  userId: string,
  operation: string,
): DriverRow {
  if (!row)
    throw new Error(
      `drivers row for ${userId} vanished during ${operation} — a caller reached a write without findOrCreate, or the row was deleted`,
    );
  return row;
}

/** The row's nullable columns are optional in the shared domain shape. */
function toProfile(row: DriverRow): DriverProfile {
  return {
    userId: row.userId,
    status: row.status,
    // `text[]` is `string[]` to Drizzle and there is no CHECK constraint behind
    // it, so this is a genuine narrowing. The update path is the only writer
    // and it validates through zod first.
    spokenLanguages: row.spokenLanguages as Language[],
    fleetId: row.fleetId,
    balanceCents: row.balanceCents,
    commissionPctOverride: row.commissionPctOverride,
    ...(row.isFemale === null ? {} : { isFemale: row.isFemale }),
    ...(row.rating === null ? {} : { rating: row.rating }),
  };
}

@Injectable()
export class DriversRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Race-safe find-or-create. `onConflictDoNothing().returning()` yields [] on
   * conflict, which is why this is DO UPDATE with a no-op SET — the only form
   * that always returns the row. Every other column is left to its Postgres
   * default, which is how a returning driver keeps their status, balance and
   * commission override.
   */
  async findOrCreate(userId: string): Promise<DriverProfile> {
    const [row] = await this.db
      .insert(drivers)
      .values({ userId })
      .onConflictDoUpdate({ target: drivers.userId, set: { userId } })
      .returning();
    return toProfile(requireRow(row, userId, 'findOrCreate'));
  }

  /**
   * A pure READ — `undefined` when there is no row yet.
   *
   * `findOrCreate`'s `ON CONFLICT DO UPDATE SET user_id = user_id` is still an
   * UPDATE, so every call through it writes a dead tuple. That form is right
   * for the WRITE paths, which need the row back either way; it is wrong for
   * the two hot read paths that only look:
   *
   * - `GET /drivers/me`, the driver app's bootstrap call, on every app open (L5)
   * - the socket disconnect path, on every socket close (#38) — where it would
   *   also provision a row for a driver who never had one, as a side effect of
   *   hanging up
   */
  async find(userId: string): Promise<DriverProfile | undefined> {
    const [row] = await this.db
      .select()
      .from(drivers)
      .where(eq(drivers.userId, userId))
      .limit(1);
    return row ? toProfile(row) : undefined;
  }

  /**
   * The `set` object is an explicit two-column ALLOWLIST, and the omission is
   * the point: `balanceCents`, `commissionPctOverride`, `rating`, `fleetId` and
   * `status` are never in it, so no request shape can reach them. This is the
   * second half of the defence `driverProfileUpdateSchema` starts — do not
   * replace it with a spread of the patch.
   */
  async updateProfile(
    userId: string,
    patch: DriverProfileUpdate,
  ): Promise<DriverProfile> {
    const [row] = await this.db
      .update(drivers)
      .set({
        ...(patch.spokenLanguages === undefined
          ? {}
          : { spokenLanguages: patch.spokenLanguages }),
        ...(patch.isFemale === undefined ? {} : { isFemale: patch.isFemale }),
      })
      .where(eq(drivers.userId, userId))
      .returning();
    return toProfile(requireRow(row, userId, 'updateProfile'));
  }

  /**
   * Goes online ONLY if the driver still has a vehicle, as one statement.
   * `undefined` means the precondition failed — a 409, not a 500.
   *
   * The check has to live inside the UPDATE (L8). Counting vehicles and then
   * setting the status leaves a window: a concurrent DELETE of the last vehicle
   * lands between the two and the driver ends up online with no car — online
   * and unable to be matched, which is the exact disagreement between "you are
   * online" and "you can be offered a ride" that `vehicle_required` exists to
   * prevent. No transaction needed; one statement cannot interleave.
   */
  async setOnlineIfHasVehicle(
    userId: string,
  ): Promise<DriverProfile | undefined> {
    const [row] = await this.db
      .update(drivers)
      .set({ status: 'online' })
      .where(
        and(
          eq(drivers.userId, userId),
          exists(
            this.db
              .select({ one: sql`1` })
              .from(vehicles)
              .where(eq(vehicles.driverId, userId)),
          ),
        ),
      )
      .returning();
    return row ? toProfile(row) : undefined;
  }

  /**
   * The mirror of the above, for the delete path: forces offline only if the
   * driver is currently online, in one statement. `undefined` means they were
   * not online, so nothing happened and nothing should be logged.
   *
   * Also L8: the caller used to decide this from a `status` it had read BEFORE
   * deleting the vehicle, so a `PUT status=online` that landed in between was
   * invisible and the driver stayed online with zero cars.
   */
  async setOfflineIfOnline(userId: string): Promise<DriverProfile | undefined> {
    const [row] = await this.db
      .update(drivers)
      .set({ status: 'offline' })
      .where(and(eq(drivers.userId, userId), eq(drivers.status, 'online')))
      .returning();
    return row ? toProfile(row) : undefined;
  }

  async setStatus(
    userId: string,
    status: DriverStatus,
  ): Promise<DriverProfile> {
    const [row] = await this.db
      .update(drivers)
      .set({ status })
      .where(eq(drivers.userId, userId))
      .returning();
    return toProfile(requireRow(row, userId, 'setStatus'));
  }

  /**
   * The read #10 calls once per dispatch round to filter a proximity list.
   * Aggregated in JS: correct and readable for a ≤10-driver pilot; if the
   * cascade ends up calling this per offer, move the aggregation into SQL.
   */
  async findMatchAttributes(
    driverIds: string[],
  ): Promise<DriverMatchAttributes[]> {
    // Drizzle compiles `inArray(col, [])` to `false`, so this guard is a saved
    // round trip on a hot path, not a correctness fix.
    if (driverIds.length === 0) return [];

    const rows = await this.db
      .select()
      .from(drivers)
      .leftJoin(vehicles, eq(vehicles.driverId, drivers.userId))
      .where(inArray(drivers.userId, driverIds));

    const byDriver = new Map<string, DriverMatchAttributes>();
    for (const { drivers: driver, vehicles: vehicle } of rows) {
      let attrs = byDriver.get(driver.userId);
      if (!attrs) {
        attrs = {
          driverId: driver.userId,
          status: driver.status,
          isFemale: driver.isFemale,
          balanceCents: driver.balanceCents,
          categories: [],
          hasChildSeat: false,
          maxPassengerSeats: 0,
        };
        byDriver.set(driver.userId, attrs);
      }
      if (!vehicle) continue; // leftJoin: a driver with no vehicle still has a row
      if (!attrs.categories.includes(vehicle.category))
        attrs.categories.push(vehicle.category);
      attrs.hasChildSeat ||= vehicle.hasChildSeat;
      attrs.maxPassengerSeats = Math.max(
        attrs.maxPassengerSeats,
        vehicle.passengerSeats,
      );
    }
    return [...byDriver.values()];
  }
}
