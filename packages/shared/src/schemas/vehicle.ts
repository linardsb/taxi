import { z } from "zod";
import { RIDE_CATEGORIES } from "../enums";

export const vehicleSchema = z.object({
  id: z.string().uuid(),
  driverId: z.string().uuid(),
  plate: z.string().min(2).max(10),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1990).max(2100),
  category: z.enum(RIDE_CATEGORIES).default("standard"),
  passengerSeats: z.number().int().min(1).max(8),
  hasChildSeat: z.boolean().default(false),
});
export type Vehicle = z.infer<typeof vehicleSchema>;

/** POST body — the server owns `id`, and `driverId` comes from the JWT, never the body. */
export const vehicleCreateSchema = vehicleSchema.omit({ id: true, driverId: true });
export type VehicleCreate = z.infer<typeof vehicleCreateSchema>;

/**
 * PATCH body. The refine keeps an empty patch from reaching Drizzle, whose
 * `.set({})` throws. `.partial()` over the defaulted fields (`category`,
 * `hasChildSeat`) leaves an absent key `undefined` rather than materializing
 * the default — which is exactly what a PATCH must do.
 */
export const vehicleUpdateSchema = vehicleCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "empty update" });
export type VehicleUpdate = z.infer<typeof vehicleUpdateSchema>;
