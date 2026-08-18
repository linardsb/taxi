import { z } from 'zod';
import { DRIVER_STATUSES } from '../enums';

/**
 * What a dispatcher puts on the wire to override the algorithm (S9-2).
 *
 * PROMOTED from `services/api/.../dispatch.controller.ts` by #19, which is
 * exactly what that file's docblock invited: #10 kept it local because "this
 * body never crosses a surface boundary until #19 draws the override UI, and
 * that ticket can promote it then." The console now posts it, so it is a
 * contract and lives here.
 *
 * No `dispatcherId` field, by construction — the same rule as
 * `rideRequestBodySchema` omitting `riderId`. A body-supplied dispatcher id
 * would make the S9-2 audit trail forgeable, which is the one thing the audit
 * row exists to prevent. The api takes it from the JWT.
 */
export const forceAssignBodySchema = z.object({
  driverId: z.string().uuid(),
  reason: z.string().max(280).nullable().default(null),
});
export type ForceAssignBody = z.infer<typeof forceAssignBodySchema>;

/**
 * Reassignment's body. Structurally identical to `forceAssignBodySchema` and
 * deliberately NOT an alias of it: the two routes mean different things to the
 * ride (one puts a car on an unassigned ride, the other takes one off and
 * replaces it), they can diverge, and a shared name would make a call site
 * that posts to the wrong route typecheck happily.
 */
export const reassignBodySchema = z.object({
  driverId: z.string().uuid(),
  reason: z.string().max(280).nullable().default(null),
});
export type ReassignBody = z.infer<typeof reassignBodySchema>;

/**
 * One driver as the override picker sees them.
 *
 * Note what this is NOT: `DispatchBoardEvent['drivers']` carries the Redis
 * ONLINE set with live positions, because that is what a live board shows.
 * This carries EVERY approved driver including the offline ones — force-assign
 * "deliberately is NOT filtered through the eligibility rules", so a picker
 * that only listed online drivers could not express the feature. Dina has
 * Jānis on the phone; his app crashed; she still needs to send him.
 */
export const dispatchDriverSchema = z.object({
  driverId: z.string().uuid(),
  name: z.string(),
  phone: z.string(),
  status: z.enum(DRIVER_STATUSES),
  /** Null when the driver owns no vehicle — force-assign permits that. */
  vehiclePlate: z.string().nullable(),
  /** Null when the driver has no position in Redis (i.e. is offline). */
  zoneName: z.string().nullable(),
  /** The ride currently pinning them, so the picker can warn before stealing a car. */
  activeRideId: z.string().uuid().nullable(),
});
export type DispatchDriver = z.infer<typeof dispatchDriverSchema>;

/**
 * `GET /dispatch/drivers` — a REQUEST-SCOPED read, fetched when the picker
 * opens, never pushed on the board's 2 s cadence.
 *
 * The roster changes when a driver is approved or deactivated (hourly at
 * best); the frame is emitted 30 times a minute and persisted to localStorage
 * on every receipt. Putting the roster on the frame would multiply a
 * slow-moving list by that cadence and grow the PII blob on a shared operator
 * workstation for no benefit.
 */
export const dispatchRosterSchema = z.object({
  at: z.string().datetime(),
  drivers: z.array(dispatchDriverSchema),
});
export type DispatchRoster = z.infer<typeof dispatchRosterSchema>;
