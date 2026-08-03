import { z } from "zod";

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof latLngSchema>;

export const addressPointSchema = z.object({
  location: latLngSchema,
  /** Human-readable address as shown to rider/driver/dispatcher. */
  address: z.string().min(1),
});
export type AddressPoint = z.infer<typeof addressPointSchema>;

export const citySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  countryCode: z.literal("LV"),
  timezone: z.string().default("Europe/Riga"),
});
export type City = z.infer<typeof citySchema>;

export const geozoneSchema = z.object({
  id: z.string().uuid(),
  cityId: z.string().uuid(),
  /**
   * Stable human key — `RIGA_PILOT_DISTRICTS` members for the pilot zones.
   * UUIDs are for joins, slugs for seeds and config. Deliberately free-form
   * rather than `z.enum(RIGA_PILOT_DISTRICTS)`: "first pilot geozones — decide
   * with Dina" is still open, and Dina must be able to add a zone without a
   * code change.
   */
  slug: z.string().min(1),
  name: z.string().min(1),
  /** Polygon ring; first and last vertex need not repeat. Stored as PostGIS geometry server-side. */
  polygon: z.array(latLngSchema).min(3),
  /** When true, dispatch in this zone uses the driver queue instead of auto-match. */
  queueModeEnabled: z.boolean().default(false),
});
export type Geozone = z.infer<typeof geozoneSchema>;

/**
 * One driver's place in a geozone queue ("izsaukumi rindas kārtībā" — S7-2,
 * S8-1). `position` is 1-based, because it is a queue *position*, not an array
 * index; #10's Redis list is 0-based and owns that conversion.
 */
export const queueEntrySchema = z.object({
  driverId: z.string().uuid(),
  geozoneId: z.string().uuid(),
  position: z.number().int().min(1),
  joinedAt: z.coerce.date(),
});
export type QueueEntry = z.infer<typeof queueEntrySchema>;

/**
 * A geozone queue as read by the driver app and Dina's board. Live state lives
 * in Redis lists (#8/#10); this is the wire/read shape, never the storage one.
 */
export const geozoneQueueSchema = z.object({
  geozoneId: z.string().uuid(),
  updatedAt: z.coerce.date(),
  entries: z.array(queueEntrySchema).default([]),
});
export type GeozoneQueue = z.infer<typeof geozoneQueueSchema>;
