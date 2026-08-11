import { Inject, Injectable } from '@nestjs/common';
import { drivers, rides, users, vehicles, type Db } from '@taxi/db';
import {
  LANGUAGES,
  rideRequestSchema,
  type BookingChannel,
  type Language,
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
  /** The car stamped at assignment (#86) — null until assigned, or when the driver owned no vehicle. */
  vehicleId: string | null;
  bookingChannel: BookingChannel;
  trackingToken: string | null;
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
    vehicleId: row.vehicleId,
    bookingChannel: row.bookingChannel,
    trackingToken: row.trackingToken,
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
   * Driver name/photo plus the plate the rider should match at the kerb —
   * read off the vehicle stamped on the ride at assignment (#86), never
   * re-derived from the driver's current fleet.
   */
  async driverCard(
    driverId: string,
    vehicleId: string | null,
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

    let plate: string | null = null;
    if (vehicleId) {
      const [vehicle] = await this.db
        .select({ plate: vehicles.plate })
        .from(vehicles)
        .where(eq(vehicles.id, vehicleId))
        .limit(1);
      // ON DELETE SET NULL makes a miss ~impossible, but never throw here —
      // a throw would cost the rider their SMS body, not just the plate.
      plate = vehicle?.plate ?? null;
    }

    return {
      name: profile?.displayName ?? null,
      photoUrl: profile?.photoUrl ?? null,
      plate,
    };
  }
}
