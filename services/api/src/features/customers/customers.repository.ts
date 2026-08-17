import { Inject, Injectable } from '@nestjs/common';
import { customers, rides, savedPlaces, users, type Db } from '@taxi/db';
import {
  addressPointSchema,
  type Customer,
  type RecentRide,
  type SavedPlace,
  type UserRole,
} from '@taxi/shared';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../common/db/db.module';

/** How many past jobs the caller panel offers for reuse (evidence F2.2). */
export const RECENT_RIDES_LIMIT = 3;

type CustomerRow = typeof customers.$inferSelect;
type SavedPlaceRow = typeof savedPlaces.$inferSelect;

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    isVenue: row.isVenue,
    notes: row.notes,
  };
}

function toSavedPlace(row: SavedPlaceRow): SavedPlace {
  return {
    id: row.id,
    customerId: row.customerId,
    kind: row.kind,
    label: row.label,
    point: { location: { lat: row.lat, lng: row.lng }, address: row.address },
    placeId: row.placeId,
  };
}

@Injectable()
export class CustomersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * The caller's `users` row, by phone. A pure READ, and the reason the
   * booking path can refuse a phone that belongs to a driver before creating
   * anything.
   */
  async findUserByPhone(
    phone: string,
  ): Promise<{ id: string; role: UserRole } | undefined> {
    const [row] = await this.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);
    return row;
  }

  /**
   * Find-or-create the caller's user row.
   *
   * `DO UPDATE SET phone = phone` — the no-op form `DriverRepository.findOrCreate`
   * uses, and for the same reason: `DO NOTHING` returns [] on conflict. The
   * omission is what matters here: `displayName`, `language` and `role` are
   * NEVER in the `set`, so a dispatcher typing a name for an existing rider
   * cannot rename them or downgrade a role.
   */
  async findOrCreateUser(
    phone: string,
    displayName: string | undefined,
  ): Promise<{ id: string; role: UserRole }> {
    const [row] = await this.db
      .insert(users)
      .values({
        phone,
        role: 'rider',
        ...(displayName === undefined ? {} : { displayName }),
      })
      .onConflictDoUpdate({ target: users.phone, set: { phone } })
      .returning({ id: users.id, role: users.role });
    if (row === undefined) {
      throw new Error('customers.findOrCreateUser returned no row');
    }
    return row;
  }

  /** Same no-op-conflict shape, keyed on the unique `user_id`. */
  async findOrCreateCustomer(userId: string): Promise<Customer> {
    const [row] = await this.db
      .insert(customers)
      .values({ userId })
      .onConflictDoUpdate({ target: customers.userId, set: { userId } })
      .returning();
    if (row === undefined) {
      throw new Error('customers.findOrCreateCustomer returned no row');
    }
    return toCustomer(row);
  }

  async findCustomerByUserId(userId: string): Promise<Customer | undefined> {
    const [row] = await this.db
      .select()
      .from(customers)
      .where(eq(customers.userId, userId))
      .limit(1);
    return row ? toCustomer(row) : undefined;
  }

  async updateCustomer(
    id: string,
    patch: { label: string | null; isVenue: boolean; notes: string | null },
  ): Promise<Customer | undefined> {
    const [row] = await this.db
      .update(customers)
      .set(patch)
      .where(eq(customers.id, id))
      .returning();
    return row ? toCustomer(row) : undefined;
  }

  async listSavedPlaces(customerId: string): Promise<SavedPlace[]> {
    const rows = await this.db
      .select()
      .from(savedPlaces)
      .where(eq(savedPlaces.customerId, customerId));
    return rows.map(toSavedPlace);
  }

  /** Venue records for the quick-book list — the `is_venue` flag is the filter. */
  async listVenues(): Promise<{ customer: Customer; places: SavedPlace[] }[]> {
    const rows = await this.db
      .select()
      .from(customers)
      .where(eq(customers.isVenue, true));
    return Promise.all(
      rows.map(async (row) => ({
        customer: toCustomer(row),
        places: await this.listSavedPlaces(row.id),
      })),
    );
  }

  /**
   * The caller's last rides, newest first, projected to STABLE fields only.
   *
   * The projection happens here rather than in the service because this is
   * where the row is widest: `rides.request` is a jsonb snapshot carrying the
   * payment method, the notes and the category, and never selecting them is a
   * stronger guarantee than remembering not to return them.
   */
  async findRecentRides(
    riderId: string,
    limit = RECENT_RIDES_LIMIT,
  ): Promise<RecentRide[]> {
    const rows = await this.db
      .select({
        id: rides.id,
        request: rides.request,
        bookedAt: rides.createdAt,
      })
      .from(rides)
      .where(eq(rides.riderId, riderId))
      .orderBy(desc(rides.createdAt))
      .limit(limit);

    return rows.flatMap((row) => {
      const request = row.request as {
        pickup?: unknown;
        destination?: unknown;
      };
      const pickup = addressPointSchema.safeParse(request.pickup);
      const destination = addressPointSchema.safeParse(request.destination);
      // A snapshot that cannot be parsed is skipped, not thrown on: one odd
      // historical row must not take down the whole caller pop mid-call.
      if (!pickup.success || !destination.success) return [];
      return [
        {
          rideId: row.id,
          pickup: pickup.data,
          destination: destination.data,
          bookedAt: row.bookedAt,
        },
      ];
    });
  }
}
