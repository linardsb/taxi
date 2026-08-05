import { Inject, Injectable } from '@nestjs/common';
import { drivers, vehicles, type Db } from '@taxi/db';
import type {
  DriverProfile,
  DriverProfileUpdate,
  DriverStatus,
  Language,
  RideCategory,
} from '@taxi/shared';
import { eq, inArray } from 'drizzle-orm';
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
    return toProfile(row!);
  }

  /**
   * A READ, deliberately — the disconnect path calls this on every socket
   * close, and `findOrCreate` would both provision a row for a driver who
   * never had one and write a dead tuple (its no-op `SET` is still an UPDATE)
   * on the highest-frequency event in the slice. `undefined` means no row,
   * which is already the state a disconnect would be trying to reach.
   */
  async findStatus(userId: string): Promise<DriverStatus | undefined> {
    const [row] = await this.db
      .select({ status: drivers.status })
      .from(drivers)
      .where(eq(drivers.userId, userId));
    return row?.status;
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
    return toProfile(row!);
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
    return toProfile(row!);
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
