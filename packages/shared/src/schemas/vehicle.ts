import { z } from 'zod';
import { RIDE_CATEGORIES } from '../enums';

export const vehicleSchema = z.object({
  id: z.string().uuid(),
  driverId: z.string().uuid(),
  plate: z.string().min(2).max(10),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1990).max(2100),
  category: z.enum(RIDE_CATEGORIES).default('standard'),
  passengerSeats: z.number().int().min(1).max(8),
  hasChildSeat: z.boolean().default(false),
});
export type Vehicle = z.infer<typeof vehicleSchema>;

/**
 * A plate as every surface stores it: no whitespace, upper case. The unique
 * index is on `upper(plate)` (`vehicles_plate_uix`), so case is already
 * covered there, but a space is not: `AB 1234` beside `AB1234` would pass it.
 * Every form that writes a plate calls this before sending (#20).
 */
export const normalizePlate = (plate: string): string =>
  plate.replace(/\s+/g, '').toUpperCase();

/**
 * POST body — the server owns `id`, `driverId` comes from the JWT, and
 * `category` is admin-set (#20: it picks the pricing tier, so a driver must not
 * self-promote to `limo`). A driver-created vehicle starts at the column
 * default, `standard`. Not `.strict()`: an installed app that still sends
 * `category` has it stripped, not refused.
 */
export const vehicleCreateSchema = vehicleSchema.omit({
  id: true,
  driverId: true,
  category: true,
});
export type VehicleCreate = z.infer<typeof vehicleCreateSchema>;

/**
 * PATCH body. The refine keeps an empty patch from reaching Drizzle, whose
 * `.set({})` throws. `.partial()` over the defaulted `hasChildSeat` leaves an
 * absent key `undefined` rather than materializing the default — which is
 * exactly what a PATCH must do. `category` is not here at all (admin-only,
 * `adminVehicleUpdateSchema`), so a body of only `category` strips to `{}` and
 * is refused as empty.
 */
export const vehicleUpdateSchema = vehicleCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type VehicleUpdate = z.infer<typeof vehicleUpdateSchema>;
