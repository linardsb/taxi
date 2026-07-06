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
  name: z.string().min(1),
  /** Polygon ring; first and last vertex need not repeat. Stored as PostGIS geometry server-side. */
  polygon: z.array(latLngSchema).min(3),
  /** When true, dispatch in this zone uses the driver queue instead of auto-match. */
  queueModeEnabled: z.boolean().default(false),
});
export type Geozone = z.infer<typeof geozoneSchema>;
