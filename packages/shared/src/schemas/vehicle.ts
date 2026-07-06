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
