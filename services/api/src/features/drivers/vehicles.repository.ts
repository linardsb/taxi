import { Inject, Injectable } from '@nestjs/common';
import { vehicles, type Db } from '@taxi/db';
import type { Vehicle, VehicleCreate, VehicleUpdate } from '@taxi/shared';
import { and, count, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../common/db/db.module';

type VehicleRow = typeof vehicles.$inferSelect;

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';
/** The index from migration 0004, on `upper(plate)`. */
const PLATE_INDEX = 'vehicles_plate_uix';

/**
 * A plate collision surfaces as a driver error (409), not a 500. Matched on the
 * CONSTRAINT NAME rather than the bare SQLSTATE: `vehicles` gains more unique
 * indexes eventually, and a second one reported as `plate_taken` would send a
 * driver chasing the wrong field.
 */
export function isPlateConflict(err: unknown): boolean {
  // Walks `cause`, because Drizzle 0.44 wraps driver errors in a
  // DrizzleQueryError and the pg fields live one level down. Reading only the
  // top-level object silently matches nothing, which surfaces as the 500 this
  // exists to replace — and the tests would still pass on the happy path.
  for (let e: unknown = err, depth = 0; e !== null && depth < 5; depth++) {
    if (typeof e !== 'object') return false;
    const pg = e as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (pg.code === UNIQUE_VIOLATION && pg.constraint === PLATE_INDEX)
      return true;
    e = pg.cause;
  }
  return false;
}

function toVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    driverId: row.driverId,
    plate: row.plate,
    make: row.make,
    model: row.model,
    year: row.year,
    category: row.category,
    passengerSeats: row.passengerSeats,
    hasChildSeat: row.hasChildSeat,
  };
}

/**
 * THE OWNERSHIP BOUNDARY: every mutating query is scoped by `driverId` in the
 * SQL, never fetched and then compared in JS. That is what makes another
 * driver's vehicle simply not exist — a fetch-then-403 leaks existence, telling
 * a driver which plates are registered on the platform.
 */
@Injectable()
export class VehiclesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async listForDriver(driverId: string): Promise<Vehicle[]> {
    const rows = await this.db
      .select()
      .from(vehicles)
      .where(eq(vehicles.driverId, driverId));
    return rows.map(toVehicle);
  }

  async create(driverId: string, input: VehicleCreate): Promise<Vehicle> {
    const [row] = await this.db
      .insert(vehicles)
      .values({ ...input, driverId })
      .returning();
    return toVehicle(row!);
  }

  /**
   * `undefined` means "not yours, or not there" — the caller must not distinguish.
   *
   * The `set` object is an explicit ALLOWLIST, exactly as
   * `DriversRepository.updateProfile` is — `id` and `driverId` are never in it,
   * so no request shape can re-parent a car onto another driver. Today
   * `vehicleUpdateSchema` also omits them, but that is one `.omit()` away in a
   * different package; do not replace this with a spread of the patch.
   */
  async update(
    driverId: string,
    vehicleId: string,
    patch: VehicleUpdate,
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
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.driverId, driverId)))
      .returning();
    return row ? toVehicle(row) : undefined;
  }

  async remove(driverId: string, vehicleId: string): Promise<boolean> {
    const rows = await this.db
      .delete(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.driverId, driverId)))
      .returning({ id: vehicles.id });
    return rows.length > 0;
  }

  async countForDriver(driverId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(vehicles)
      .where(eq(vehicles.driverId, driverId));
    return row?.n ?? 0;
  }
}
