import { z } from "zod";
import { ASSIGNMENT_SOURCES, DRIVER_STATUSES } from "./enums";
import { RIDE_STATUSES } from "./ride-state-machine";
import { addressPointSchema, latLngSchema } from "./schemas/geo";
import { rideOfferSchema } from "./schemas/ride";

/**
 * Socket.IO event names and zod payload schemas shared by api, rider, driver,
 * and dispatch. Naming follows domain:action. Documented in
 * .claude/references/realtime-events.md — keep the two in sync.
 *
 * Wire timestamps are ISO strings (`z.string().datetime()`), not `Date`. The
 * domain schemas in ./schemas use `z.coerce.date()` and re-hydrate them on
 * receipt; do not unify the two worlds.
 *
 * `RT` must stay the first `as const` block in this file — the doc-sync check
 * that keeps .claude/references/realtime-events.md honest slices the catalog
 * from here.
 */
export const RT = {
  driverLocation: "driver:location",
  driverQueue: "driver:queue",
  rideStatus: "ride:status",
  rideOffer: "ride:offer",
  rideOfferRevoked: "ride:offer_revoked",
  rideAssigned: "ride:assigned",
  dispatchBoard: "dispatch:board",
  dispatchUnclaimed: "dispatch:unclaimed",
} as const;

/**
 * INBOUND, UNTRUSTED — carries no `driverId` on purpose. The server takes the
 * driver identity from the JWT. This is a security boundary, not tidiness: if
 * the inbound schema carried `driverId`, any authenticated driver could spoof
 * another driver's position on Dina's board. Do not merge with the outbound
 * schema below.
 */
export const driverLocationPingSchema = z.object({
  location: latLngSchema,
  heading: z.number().min(0).lt(360).optional(),
  at: z.string().datetime(),
});
export type DriverLocationPing = z.infer<typeof driverLocationPingSchema>;

/** OUTBOUND — the ping plus the server-attested driver identity. */
export const driverLocationEventSchema = driverLocationPingSchema.extend({
  driverId: z.string().uuid(),
});
export type DriverLocationEvent = z.infer<typeof driverLocationEventSchema>;

/** The driver's live place in a geozone queue (S7-2). `position` is 1-based. */
export const driverQueueEventSchema = z.object({
  driverId: z.string().uuid(),
  geozoneId: z.string().uuid(),
  geozoneSlug: z.string().min(1),
  position: z.number().int().min(1),
  size: z.number().int().nonnegative(),
  at: z.string().datetime(),
});
export type DriverQueueEvent = z.infer<typeof driverQueueEventSchema>;

/** Emitted on every state-machine transition — which is why there is no separate `ride:requested`. */
export const rideStatusEventSchema = z.object({
  rideId: z.string().uuid(),
  orderId: z.string().uuid(),
  status: z.enum(RIDE_STATUSES),
  previousStatus: z.enum(RIDE_STATUSES).nullable().default(null),
  reason: z.string().max(280).nullable().default(null),
  at: z.string().datetime(),
});
export type RideStatusEvent = z.infer<typeof rideStatusEventSchema>;

/**
 * The offer contract IS the wire payload — one shape, no duplication.
 * `sentAt`/`expiresAt` serialize as ISO strings and `z.coerce.date()`
 * re-hydrates them on receipt.
 */
export const rideOfferEventSchema = rideOfferSchema;
export type RideOfferEvent = z.infer<typeof rideOfferEventSchema>;

/** Clears the driver's offer card (#15) when the offer is no longer live. */
export const rideOfferRevokedEventSchema = z.object({
  offerId: z.string().uuid(),
  rideId: z.string().uuid(),
  reason: z.enum(["expired", "taken", "cancelled"]),
  at: z.string().datetime(),
});
export type RideOfferRevokedEvent = z.infer<typeof rideOfferRevokedEventSchema>;

/** A ride now has a driver — to the ride room and to the winning driver. */
export const rideAssignedEventSchema = z.object({
  rideId: z.string().uuid(),
  driverId: z.string().uuid(),
  source: z.enum(ASSIGNMENT_SOURCES),
  dispatcherId: z.string().uuid().nullable().default(null),
  at: z.string().datetime(),
});
export type RideAssignedEvent = z.infer<typeof rideAssignedEventSchema>;

/**
 * Thin on purpose: #18 owns the dispatch board's real shape and will widen
 * this. It exists so the gateway (#7) has something typed to emit before
 * Dina's console layout (S9-1) is drawn.
 */
export const dispatchBoardEventSchema = z.object({
  cityId: z.string().uuid(),
  at: z.string().datetime(),
  rides: z.array(
    z.object({
      rideId: z.string().uuid(),
      status: z.enum(RIDE_STATUSES),
      pickup: addressPointSchema,
      driverId: z.string().uuid().nullable(),
      unclaimedSeconds: z.number().int().nonnegative(),
    }),
  ),
  drivers: z.array(
    z.object({
      driverId: z.string().uuid(),
      location: latLngSchema,
      status: z.enum(DRIVER_STATUSES),
    }),
  ),
});
export type DispatchBoardEvent = z.infer<typeof dispatchBoardEventSchema>;

/** Dina's flash alert for an order nobody has taken (S9-4). */
export const dispatchUnclaimedEventSchema = z.object({
  rideId: z.string().uuid(),
  pickup: addressPointSchema,
  requestedAt: z.string().datetime(),
  unclaimedSeconds: z.number().int().nonnegative(),
  offerAttempts: z.number().int().nonnegative(),
});
export type DispatchUnclaimedEvent = z.infer<typeof dispatchUnclaimedEventSchema>;

/** Room names per .claude/references/realtime-events.md — never build these strings by hand. */
export const rideRoom = (rideId: string) => `ride:${rideId}` as const;
export const driverRoom = (driverId: string) => `driver:${driverId}` as const;
export const dispatchRoom = (cityId: string) => `dispatch:${cityId}` as const;

/** For Socket.IO generics in #7: `Server<ClientToServerEvents, ServerToClientEvents>`. */
export interface ClientToServerEvents {
  [RT.driverLocation]: (payload: DriverLocationPing) => void;
}

export interface ServerToClientEvents {
  [RT.driverLocation]: (payload: DriverLocationEvent) => void;
  [RT.driverQueue]: (payload: DriverQueueEvent) => void;
  [RT.rideStatus]: (payload: RideStatusEvent) => void;
  [RT.rideOffer]: (payload: RideOfferEvent) => void;
  [RT.rideOfferRevoked]: (payload: RideOfferRevokedEvent) => void;
  [RT.rideAssigned]: (payload: RideAssignedEvent) => void;
  [RT.dispatchBoard]: (payload: DispatchBoardEvent) => void;
  [RT.dispatchUnclaimed]: (payload: DispatchUnclaimedEvent) => void;
}
