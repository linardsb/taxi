import { z } from "zod";
import { DRIVER_STATUSES, LANGUAGES } from "../enums";

export const driverProfileSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(DRIVER_STATUSES).default("offline"),
  /** Languages the driver speaks — shown as badges to riders (outline: RU/LV/EN/IT…). */
  spokenLanguages: z.array(z.enum(LANGUAGES)).default(["lv"]),
  /** Used only for the rider's female-driver preference filter. */
  isFemale: z.boolean().optional(),
  /**
   * Independent platform drivers have no fleet. The owned-fleet extension
   * (decided 2026-07-06) hangs off this nullable reference.
   */
  fleetId: z.string().uuid().nullable().default(null),
  rating: z.number().min(1).max(5).optional(),
  /** Net balance in cents; cash-ride commission nets against card earnings. Negative blocks new rides. */
  balanceCents: z.number().int().default(0),
});
export type DriverProfile = z.infer<typeof driverProfileSchema>;
