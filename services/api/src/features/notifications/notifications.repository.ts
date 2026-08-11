import { Inject, Injectable } from '@nestjs/common';
import { drivers, rides, users, vehicles, type Db } from '@taxi/db';
import {
  LANGUAGES,
  rideRequestSchema,
  type BookingChannel,
  type Language,
  type RideCategory,
  type RideRequest,
  type RideStatus,
} from '@taxi/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DRIZZLE } from '../../common/db/db.module';

/** What both the SMS policy and the tracking view need off one ride row. */
export interface NotifiableRide {
  id: string;
  status: RideStatus;
  riderId: string;
  driverId: string | null;
  bookingChannel: BookingChannel;
  trackingToken: string | null;
  category: RideCategory;
  request: RideRequest;
  updatedAt: Date;
}

/**
 * A stored language predates the enum's guarantees (the column is plain text),
 * so it is validated on read with an `lv` fallback — a bad row costs the rider
 * their preferred language, never the SMS.
 */
const storedLanguageSchema = z.enum(LANGUAGES).catch('lv');

type RideRow = typeof rides.$inferSelect;

/** `request` round-trips through jsonb, so it is parsed rather than cast. */
function toNotifiable(row: RideRow): NotifiableRide {
  return {
    id: row.id,
    status: row.status,
    riderId: row.riderId,
    driverId: row.driverId,
    bookingChannel: row.bookingChannel,
    trackingToken: row.trackingToken,
    category: row.category,
    request: rideRequestSchema.parse(row.request),
    updatedAt: row.updatedAt,
  };
}

/**
 * Owns its own queries against rider/driver/vehicle rows, like every
 * repository owns its reads — the drivers slice exports no vehicle read API,
 * and widening its barrel for one plate lookup would be the larger evil.
 */
@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async rideById(rideId: string): Promise<NotifiableRide | undefined> {
    const [row] = await this.db
      .select()
      .from(rides)
      .where(eq(rides.id, rideId))
      .limit(1);
    return row ? toNotifiable(row) : undefined;
  }

  async rideByToken(token: string): Promise<NotifiableRide | undefined> {
    const [row] = await this.db
      .select()
      .from(rides)
      .where(eq(rides.trackingToken, token))
      .limit(1);
    return row ? toNotifiable(row) : undefined;
  }

  async riderContact(
    riderId: string,
  ): Promise<{ phone: string; language: Language } | undefined> {
    const [row] = await this.db
      .select({ phone: users.phone, language: users.language })
      .from(users)
      .where(eq(users.id, riderId))
      .limit(1);
    if (!row) return undefined;
    return {
      phone: row.phone,
      language: storedLanguageSchema.parse(row.language),
    };
  }

  /**
   * Driver name/photo plus the plate the rider should match at the kerb.
   * Plate heuristic (documented assumption, plan resolution #4): the driver's
   * vehicle in the ride's category, else their first vehicle, else null —
   * until a ride records its vehicle at acceptance (a dispatch-side ticket).
   */
  async driverCard(
    driverId: string,
    category: RideCategory,
  ): Promise<{
    name: string | null;
    photoUrl: string | null;
    plate: string | null;
  }> {
    const [profile] = await this.db
      .select({ displayName: users.displayName, photoUrl: drivers.photoUrl })
      .from(drivers)
      .innerJoin(users, eq(users.id, drivers.userId))
      .where(eq(drivers.userId, driverId))
      .limit(1);

    const fleet = await this.db
      .select({ plate: vehicles.plate, category: vehicles.category })
      .from(vehicles)
      .where(eq(vehicles.driverId, driverId));
    const plate =
      fleet.find((v) => v.category === category)?.plate ??
      fleet[0]?.plate ??
      null;

    return {
      name: profile?.displayName ?? null,
      photoUrl: profile?.photoUrl ?? null,
      plate,
    };
  }
}
