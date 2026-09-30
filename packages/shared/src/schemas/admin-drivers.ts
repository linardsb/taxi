import { z } from 'zod';
import {
  DRIVER_APPROVAL_STATUSES,
  DRIVER_STATUSES,
  RIDE_CATEGORIES,
} from '../enums';
import { commissionPctSchema } from '../money';
import { driverProfileSchema, driverProfileUpdateFieldsSchema } from './driver';
import { displayNameSchema, phoneSchema } from './user';
import { vehicleSchema } from './vehicle';

// The admin panel's driver review contract (#20). Every route that serves or
// accepts these is `@Roles('admin')` only — which is why the summary carries
// the FULL phone: the admin calls the driver to vet them.

const nonEmpty = (v: object) => Object.keys(v).length > 0;

/** `GET /admin/drivers?approval=` — absent lists every driver. */
export const adminDriverListQuerySchema = z.object({
  approval: z.enum(DRIVER_APPROVAL_STATUSES).optional(),
});
export type AdminDriverListQuery = z.infer<typeof adminDriverListQuerySchema>;

/** One row of the review list: enough to decide without opening the driver. */
export const adminDriverSummarySchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().nullable(),
  phone: phoneSchema,
  approvalStatus: z.enum(DRIVER_APPROVAL_STATUSES),
  status: z.enum(DRIVER_STATUSES),
  /** When the driver signed up (`users.created_at`). */
  createdAt: z.coerce.date(),
  vehicles: z.array(
    z.object({ plate: z.string(), category: z.enum(RIDE_CATEGORIES) }),
  ),
});
export type AdminDriverSummary = z.infer<typeof adminDriverSummarySchema>;

/** `GET /admin/drivers/:id` — the summary plus the profile and full vehicles. */
export const adminDriverDetailSchema = adminDriverSummarySchema.extend({
  profile: driverProfileSchema,
  vehicles: z.array(vehicleSchema),
});
export type AdminDriverDetail = z.infer<typeof adminDriverDetailSchema>;

/**
 * `PATCH /admin/drivers/:id`. The driver's own fields plus the two only an
 * admin writes. `commissionPctOverride: null` CLEARS the override (platform
 * base applies) and is distinct from absent (leave it alone) — the repository
 * writes the column only when the key is not `undefined`.
 */
export const adminDriverUpdateSchema = driverProfileUpdateFieldsSchema
  .extend({
    displayName: displayNameSchema.optional(),
    commissionPctOverride: commissionPctSchema.nullable().optional(),
  })
  .refine(nonEmpty, { message: 'empty update' });
export type AdminDriverUpdate = z.infer<typeof adminDriverUpdateSchema>;

/** `PUT /admin/drivers/:id/approval`. */
export const driverApprovalUpdateSchema = z.object({
  status: z.enum(DRIVER_APPROVAL_STATUSES),
});
export type DriverApprovalUpdate = z.infer<typeof driverApprovalUpdateSchema>;

/**
 * `PATCH /admin/vehicles/:id`. Unlike the driver's `vehicleUpdateSchema`, this
 * one carries `category`: the pricing tier is the admin's to set.
 */
export const adminVehicleUpdateSchema = vehicleSchema
  .omit({ id: true, driverId: true })
  .partial()
  .refine(nonEmpty, { message: 'empty update' });
export type AdminVehicleUpdate = z.infer<typeof adminVehicleUpdateSchema>;
