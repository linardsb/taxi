import { z } from "zod";
import { DRIVER_PRESENCE_STATUSES, DRIVER_STATUSES, LANGUAGES } from "../enums";
import { centsSchema, commissionPctSchema } from "../money";
import { vehicleSchema } from "./vehicle";

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
  balanceCents: centsSchema.default(0),
  /**
   * Per-driver commission override set by admin (#20) — e.g. Atis's evidenced
   * "0% + hourly guarantee" pilot (S6-7). null = use the platform base.
   * Read by `resolveCommissionPct`.
   */
  commissionPctOverride: commissionPctSchema.nullable().default(null),
});
export type DriverProfile = z.infer<typeof driverProfileSchema>;

/**
 * What a driver may change about their own profile. An ALLOWLIST, not a
 * `.partial()` of the profile: `balanceCents`, `commissionPctOverride`,
 * `rating`, `fleetId` and `status` all live on the profile and none of them are
 * the driver's to write. Unknown keys are stripped by zod; the repository's
 * explicit column list is the second half of the same defence (see the api's
 * auth.repository.ts). Safe as a `ZodEffects` — a leaf request schema nothing
 * derives from, same reasoning as `rideAssignedEventSchema`.
 */
export const driverProfileUpdateSchema = z
  .object({
    spokenLanguages: z.array(z.enum(LANGUAGES)).min(1).optional(),
    isFemale: z.boolean().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "empty update" });
export type DriverProfileUpdate = z.infer<typeof driverProfileUpdateSchema>;

/** Presence toggle. `on_ride` is not a value a driver may send — see DRIVER_PRESENCE_STATUSES. */
export const driverStatusUpdateSchema = z.object({
  status: z.enum(DRIVER_PRESENCE_STATUSES),
});
export type DriverStatusUpdate = z.infer<typeof driverStatusUpdateSchema>;

/** GET /drivers/me — the driver app's whole bootstrap payload in one call. */
export const driverMeSchema = z.object({
  profile: driverProfileSchema,
  vehicles: z.array(vehicleSchema),
});
export type DriverMe = z.infer<typeof driverMeSchema>;
