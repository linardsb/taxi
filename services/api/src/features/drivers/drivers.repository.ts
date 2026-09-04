import { Inject, Injectable } from '@nestjs/common';
import { drivers, rides, users, vehicles, type Db } from '@taxi/db';
import {
  ACTIVE_DRIVER_RIDE_STATUSES,
  type DriverProfile,
  type DriverProfileUpdate,
  type DriverStatus,
  type Language,
  type RideCategory,
} from '@taxi/shared';
import { and, eq, exists, inArray, notExists, sql } from 'drizzle-orm';
import { DRIZZLE, type DbTx } from '../../common/db/db.module';

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
  /**
   * Why the per-driver split can differ from #9's platform-base preview. The
   * offer card shows what THIS driver keeps; without this field every card
   * silently shows the platform base and the S2-5 transparency wedge — the
   * whole pitch — is quietly wrong for any driver on an override.
   */
  commissionPctOverride: number | null;
  /** Distinct categories across the driver's vehicles. */
  categories: RideCategory[];
  /** True when ANY of the driver's vehicles has one. */
  hasChildSeat: boolean;
  maxPassengerSeats: number;
}

/**
 * Who an online driver IS, for Dina's board (#18): the drivers row joined to
 * its user for the phone she dispatches by voice with. `name` is nullable —
 * `users.display_name` is optional — and the board service decides the
 * fallback, because the wire schema promises a non-null name.
 */
export interface DriverBoardContact {
  driverId: string;
  name: string | null;
  phone: string;
  status: DriverStatus;
}

/**
 * `DriverBoardContact` plus the plate, for #19's override picker. A separate
 * interface rather than an optional field on the board's: the board renders
 * the ONLINE set 30 times a minute and has no use for a plate, and widening
 * its shape would put an unread column on every frame's query.
 */
export interface DriverRosterContact extends DriverBoardContact {
  vehiclePlate: string | null;
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
   * Goes online ONLY if the driver still has a vehicle AND no live
   * post-acceptance ride, as one statement. `undefined` means a precondition
   * failed — a 409, not a 500; `hasActiveRide` picks which one.
   *
   * The checks have to live inside the UPDATE (L8). Counting vehicles and then
   * setting the status leaves a window: a concurrent DELETE of the last vehicle
   * lands between the two and the driver ends up online with no car — online
   * and unable to be matched, which is the exact disagreement between "you are
   * online" and "you can be offered a ride" that `vehicle_required` exists to
   * prevent. No transaction needed; one statement cannot interleave.
   */
  async setOnlineIfEligible(
    userId: string,
  ): Promise<DriverProfile | undefined> {
    const [row] = await this.db
      .update(drivers)
      // Going online cancels a pending "you've gone offline" nudge (#14): the
      // phone is back, so the push would only tell the driver what they know.
      .set({ status: 'online', offlineNudgeDueAt: null })
      .where(
        and(
          eq(drivers.userId, userId),
          exists(
            this.db
              .select({ one: sql`1` })
              .from(vehicles)
              .where(eq(vehicles.driverId, userId)),
          ),
          // #61 chain A: the rides table decides, not `drivers.status` — an
          // offline driver who accepted mid-disconnect has a live ride and no
          // `on_ride` status. Inside the WHERE (L8), so an accept landing
          // between a read and this write cannot slip through.
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(rides)
              .where(
                and(
                  eq(rides.driverId, userId),
                  inArray(rides.status, [...ACTIVE_DRIVER_RIDE_STATUSES]),
                ),
              ),
          ),
        ),
      )
      .returning();
    return row ? toProfile(row) : undefined;
  }

  /**
   * The ride this driver is committed to, or null — `GET /drivers/me`'s
   * `activeRideId` (#15). Same predicate as `hasActiveRide`; the id is what a
   * cold-started app needs to land on the active-ride screen.
   */
  async findActiveRideId(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: rides.id })
      .from(rides)
      .where(
        and(
          eq(rides.driverId, userId),
          inArray(rides.status, [...ACTIVE_DRIVER_RIDE_STATUSES]),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  /** Follow-up read for the error message ONLY — the WHERE above decides. */
  async hasActiveRide(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql`1` })
      .from(rides)
      .where(
        and(
          eq(rides.driverId, userId),
          inArray(rides.status, [...ACTIVE_DRIVER_RIDE_STATUSES]),
        ),
      )
      .limit(1);
    return row !== undefined;
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

  /**
   * `online → on_ride`, only while the driver is still online. One statement,
   * for the same reason as the two above: a status read followed by a write
   * would let a concurrent `PUT /drivers/me/status` slip between them.
   *
   * Guarded on `online` DELIBERATELY. A force-assigned driver may be `offline`
   * — overriding the eligibility rules is Dina's feature, not a hole in it —
   * and claiming them would end the ride by putting an offline driver online.
   * `false` is therefore an ordinary outcome, not an error: that driver stays
   * offline for the whole ride and `releaseFromRide` correctly does nothing.
   *
   * `tx` composes this into the accept and force-assign transactions, where the
   * claim must commit or roll back with the assignment.
   */
  async claimForRide(userId: string, tx?: DbTx): Promise<boolean> {
    const [row] = await (tx ?? this.db)
      .update(drivers)
      .set({ status: 'on_ride' })
      .where(and(eq(drivers.userId, userId), eq(drivers.status, 'online')))
      .returning({ userId: drivers.userId });
    return row !== undefined;
  }

  /**
   * `on_ride → online`, only while the driver is actually on one. The mirror of
   * `claimForRide`, and `false` is equally ordinary: a driver who was never
   * claimed (force-assigned while offline) has nothing to release.
   */
  async releaseFromRide(userId: string, tx?: DbTx): Promise<boolean> {
    const [row] = await (tx ?? this.db)
      .update(drivers)
      .set({ status: 'online' })
      .where(and(eq(drivers.userId, userId), eq(drivers.status, 'on_ride')))
      .returning({ userId: drivers.userId });
    return row !== undefined;
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
   * The board's who-is-this read (#18), one query for the whole online set.
   * INNER join on purpose: a drivers row without its user is an FK violation,
   * not a state to render.
   */
  async findBoardContacts(driverIds: string[]): Promise<DriverBoardContact[]> {
    if (driverIds.length === 0) return [];
    return this.db
      .select({
        driverId: drivers.userId,
        name: users.displayName,
        phone: users.phone,
        status: drivers.status,
      })
      .from(drivers)
      .innerJoin(users, eq(users.id, drivers.userId))
      .where(inArray(drivers.userId, driverIds));
  }

  /**
   * EVERY driver, for #19's override picker — deliberately unfiltered.
   *
   * `findBoardContacts` above answers "who is in the online set"; this answers
   * "who exists at all", because force-assign is documented as NOT filtered
   * through the eligibility rules and a picker that hid offline drivers could
   * not express S9-2. There is no approval flag to filter on yet either —
   * driver onboarding review is #20's.
   *
   * `min(plate)` rather than a row per vehicle: a driver may own several cars
   * and the picker shows one identifying plate, so aggregating here keeps the
   * result one row per driver. Which plate wins is arbitrary and stated to be
   * — the plate is a hint for Dina, not the vehicle stamped on the ride (#86
   * picks that at assignment, by category).
   *
   * BOUNDED, like every other read in the dispatch slice (#120 review L1). The
   * caller's ceiling, not a page: there is no cursor and nothing here reads a
   * second page, so a roster over the limit silently loses drivers from the
   * picker. Sized well above the pilot so that cannot happen before someone
   * has to build paging anyway. Ordered so the truncation is at least stable.
   */
  async findRosterContacts(limit: number): Promise<DriverRosterContact[]> {
    return this.db
      .select({
        driverId: drivers.userId,
        name: users.displayName,
        phone: users.phone,
        status: drivers.status,
        vehiclePlate: sql<string | null>`min(${vehicles.plate})`,
      })
      .from(drivers)
      .innerJoin(users, eq(users.id, drivers.userId))
      .leftJoin(vehicles, eq(vehicles.driverId, drivers.userId))
      .groupBy(drivers.userId, users.displayName, users.phone, drivers.status)
      .orderBy(users.displayName)
      .limit(limit);
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
          commissionPctOverride: driver.commissionPctOverride,
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
