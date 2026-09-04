import { z } from 'zod';
import {
  ASSIGNMENT_SOURCES,
  BOOKING_CHANNELS,
  DRIVER_STATUSES,
  PAYMENT_METHOD_TYPES,
  SMS_KINDS,
} from './enums';
import { dispatchExplanationSchema } from './dispatch-explanation';
import { BOARD_LIVE_RIDE_STATUSES, RIDE_STATUSES } from './ride-state-machine';
import { addressPointSchema, latLngSchema } from './schemas/geo';
import { rideOfferSchema } from './schemas/ride';

/**
 * Socket.IO event names and zod payload schemas shared by api, rider, driver,
 * and dispatch. Naming follows domain:action. Documented in
 * .claude/references/realtime-events.md — keep the two in sync.
 *
 * Wire timestamps are ISO strings (`z.string().datetime()`), not `Date`. The
 * domain schemas in ./schemas use `z.coerce.date()` and re-hydrate them on
 * receipt; do not unify the two worlds. This holds for all 9 events with no
 * exception: `ride:offer` is derived from a domain schema, so it overrides its
 * two date fields to obey the rule (see `rideOfferEventSchema`). The catalog
 * also carries exactly ONE acknowledgement — the api's reply to a
 * `driver:location` ping (`driverLocationAckSchema`, #14). It is a callback
 * parameter on the two client→server maps, not an event: no `RT` entry, no
 * timestamp, no room.
 *
 * `RT` must stay the first `as const` block in this file — the doc-sync check
 * that keeps .claude/references/realtime-events.md honest slices the catalog
 * from here.
 */
export const RT = {
  driverLocation: 'driver:location',
  driverQueue: 'driver:queue',
  rideStatus: 'ride:status',
  rideOffer: 'ride:offer',
  rideOfferRevoked: 'ride:offer_revoked',
  rideAssigned: 'ride:assigned',
  dispatchBoard: 'dispatch:board',
  dispatchUnclaimed: 'dispatch:unclaimed',
  dispatchSmsFailed: 'dispatch:sms_failed',
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

/**
 * The server's answer to one `driver:location` ping (#14). The driver app
 * keeps every fix in a local queue and deletes it ONLY on `accepted: true`,
 * so a fix the server never acknowledged is retried, never lost.
 * `not_online` means the server no longer holds this driver in the online
 * set — the app re-asserts its intent or flips its toggle; it must not keep
 * retrying that fix. `malformed` is dropped client-side (a retry cannot fix
 * it). `store_unavailable` is kept and retried.
 */
export const driverLocationAckSchema = z.object({
  accepted: z.boolean(),
  reason: z.enum(['not_online', 'malformed', 'store_unavailable']).optional(),
});
export type DriverLocationAck = z.infer<typeof driverLocationAckSchema>;

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
 * The wire projection of `rideOfferSchema` — derived with `.extend()` rather
 * than restated, so the offer still has exactly one source of truth.
 *
 * The two timestamps are overridden on purpose. `rideOfferSchema` is the DOMAIN
 * shape (`z.coerce.date()`, so `z.infer` says `Date`); this is the WIRE shape,
 * and JSON carries ISO strings. Without the override the typed handler promises
 * #15 a `Date` that never arrives: `payload.expiresAt.getTime()` would compile
 * and throw, and `Date.now() < payload.expiresAt` would compile, coerce to NaN
 * and silently render every offer as already-expired.
 *
 * Producers serialize before emitting; a consumer that wants the domain object
 * calls `rideOfferSchema.parse(payload)`, which re-hydrates both fields.
 *
 * `paymentMethod` is WIRE-ONLY (#15): the operative `ride.paymentMethod` at
 * emit time, so the card can make it unmissable at accept. The rider may
 * still change it until the offer is accepted, so it is a snapshot, not a
 * lock (see `isPaymentMethodLocked`); the app compares it with the accepted
 * ride's method and announces a change. Not on `rideOfferSchema`, which is
 * the `ride_offers` insert shape — no column, no migration.
 */
export const rideOfferEventSchema = rideOfferSchema.extend({
  sentAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  paymentMethod: z.enum(PAYMENT_METHOD_TYPES),
});
export type RideOfferEvent = z.infer<typeof rideOfferEventSchema>;

/** Clears the driver's offer card (#15) when the offer is no longer live. */
export const rideOfferRevokedEventSchema = z.object({
  offerId: z.string().uuid(),
  rideId: z.string().uuid(),
  reason: z.enum(['expired', 'taken', 'cancelled']),
  at: z.string().datetime(),
});
export type RideOfferRevokedEvent = z.infer<typeof rideOfferRevokedEventSchema>;

/**
 * A ride now has a driver — to the ride room and to the winning driver.
 *
 * Carries the same audit rule as `rideAssignmentSchema`: what the record
 * rejects, the wire must reject too, or an unauditable override reaches Dina's
 * board and admin (#20) and only fails later when someone writes the record.
 * Safe as a `ZodEffects` here — unlike `rideSchema`, this is a leaf wire schema
 * that nothing needs to `.omit()`/`.extend()`.
 */
export const rideAssignedEventSchema = z
  .object({
    rideId: z.string().uuid(),
    driverId: z.string().uuid(),
    source: z.enum(ASSIGNMENT_SOURCES),
    dispatcherId: z.string().uuid().nullable().default(null),
    at: z.string().datetime(),
  })
  .refine((a) => a.source !== 'dispatcher' || a.dispatcherId !== null, {
    message: 'dispatcher assignments require dispatcherId (audit trail)',
    path: ['dispatcherId'],
  });
export type RideAssignedEvent = z.infer<typeof rideAssignedEventSchema>;

/**
 * One full frame of Dina's board (#18): every live ride and every online
 * driver in the city. The client replaces its state wholesale on each frame —
 * no event-sourcing merge — so this same shape serves both transports
 * (`GET /dispatch/board` and the cadenced socket emission).
 *
 * `phone` legitimately travels here — the operator console exists so Dina can
 * dispatch by voice, and the masking rule is about LOGS (see raiseUnclaimed's
 * pickup-point note). `location`/`lastSeenAt` are null for an online driver
 * whose GEO position has never been recorded or was dropped; staleness is the
 * client's presentation concern.
 *
 * A ride's `status` is `BOARD_LIVE_RIDE_STATUSES`, NOT the full `RIDE_STATUSES`
 * — the same tuple the board query selects on. The wide enum let the console
 * type its status→label map as a `Partial` and hand-restate the set in three
 * predicates, so a status added to the query would arrive on the wire and
 * render in no bucket: live work silently missing from the board, with every
 * check green. Narrow, adding one is a compile error in both packages.
 *
 * `zones` and per-ride `cascade` are #19's additions and change nothing about
 * how the frame is APPLIED: still a wholesale replace, still ≤2 s apart, still
 * self-healing. `applyDriverLocation` patches `frame.drivers` only — it does
 * NOT move a driver between `zones` entries, and must not start to. A queue
 * rank is earned by joining a zone, not by a GPS ping crossing its boundary,
 * so a patch that reordered zones would invent positions the store never
 * issued. The next full frame carries the real ranks, on the same self-healing
 * rule `drivers` already runs on.
 */
export const dispatchBoardEventSchema = z.object({
  cityId: z.string().uuid(),
  at: z.string().datetime(),
  rides: z.array(
    z.object({
      rideId: z.string().uuid(),
      status: z.enum(BOARD_LIVE_RIDE_STATUSES),
      pickup: addressPointSchema,
      driverId: z.string().uuid().nullable(),
      driverName: z.string().nullable(),
      bookingChannel: z.enum(BOOKING_CHANNELS),
      requestedAt: z.string().datetime(),
      unclaimedSeconds: z.number().int().nonnegative(),
      /**
       * Who currently holds this ride's offer and who is behind them (#19).
       *
       * Null for a ride with no live offer — a `requested` ride the engine has
       * not reached yet, or an `accepted` one where the cascade is over. The
       * console draws nothing rather than an empty strip, so "no cascade" and
       * "a cascade with no data" cannot look the same.
       */
      cascade: z
        .object({
          offeredToDriverId: z.string().uuid().nullable(),
          offeredToName: z.string().nullable(),
          expiresAt: z.string().datetime().nullable(),
          nextDriverName: z.string().nullable(),
          attempts: z.number().int().nonnegative(),
          explanation: dispatchExplanationSchema.nullable(),
        })
        .nullable(),
    }),
  ),
  /**
   * EVERY configured zone in the city, including ones with nobody in them —
   * sourced from the `geozones` catalog, not from the drivers present. An
   * empty rank is information: it is where Dina sends the next free car.
   * `zones-panel.tsx` could not draw those because the frame carried no
   * catalog; this is that catalog.
   *
   * `entries` is the QUEUE, head first — not "drivers currently inside the
   * polygon". A driver who has gone offline while holding position 1 still
   * appears, with `status: 'offline'`, because that is precisely the thing
   * Dina needs to see and resolve. Positions are the store's, unmodified.
   */
  zones: z.array(
    z.object({
      geozoneId: z.string().uuid(),
      slug: z.string().min(1),
      name: z.string().min(1),
      queueModeEnabled: z.boolean(),
      entries: z.array(
        z.object({
          driverId: z.string().uuid(),
          name: z.string(),
          /**
           * Carried per ENTRY, not looked up in `drivers`, because the entry
           * that most needs a phone number is the one `drivers` does not have:
           * a driver who went offline still holding a place. Same PII rule as
           * the driver list — the console exists so Dina can dispatch by voice.
           */
          phone: z.string(),
          position: z.number().int().min(1),
          /** Time in the QUEUE, not since the driver's last job. */
          secondsInZone: z.number().int().nonnegative(),
          status: z.enum(DRIVER_STATUSES),
        }),
      ),
    }),
  ),
  drivers: z.array(
    z.object({
      driverId: z.string().uuid(),
      name: z.string(),
      phone: z.string(),
      location: latLngSchema.nullable(),
      lastSeenAt: z.string().datetime().nullable(),
      zoneName: z.string().nullable(),
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
export type DispatchUnclaimedEvent = z.infer<
  typeof dispatchUnclaimedEventSchema
>;

/**
 * An SMS the platform owed a rider was not delivered (#18) — an operator
 * alert, so Dina can phone the rider instead. `kind` comes from `SMS_KINDS`,
 * the same tuple the api's one emit site (ride-notifications.service.ts)
 * derives its `SmsKind` from — one definition, no twin to drift.
 */
export const dispatchSmsFailedEventSchema = z.object({
  rideId: z.string().uuid(),
  kind: z.enum(SMS_KINDS),
  at: z.string().datetime(),
});
export type DispatchSmsFailedEvent = z.infer<
  typeof dispatchSmsFailedEventSchema
>;

/** Room names per .claude/references/realtime-events.md — never build these strings by hand. */
export const rideRoom = (rideId: string) => `ride:${rideId}` as const;
export const driverRoom = (driverId: string) => `driver:${driverId}` as const;
export const dispatchRoom = (cityId: string) => `dispatch:${cityId}` as const;

/**
 * A user's private room — every authenticated socket joins its own on
 * connect. This is how the server addresses one person's sockets across
 * the cluster (`server.in(userRoom(id)).socketsJoin(rideRoom(rideId))`),
 * which is what makes ride rooms server-orchestrated instead of
 * client-requested. Clients never ask to join anything.
 */
export const userRoom = (userId: string) => `user:${userId}` as const;

/**
 * The SERVER's listen map: `Server<ClientToServerEvents, ServerToClientEvents>`.
 *
 * `unknown` on purpose — this is the untrusted boundary. A typed payload here
 * would let a #7 handler read `payload.location.lat` off raw client JSON that
 * has never been parsed, with the type system implying it was validated. The
 * only way in is `driverLocationPingSchema.parse(payload)`, which is also what
 * strips a spoofed `driverId` (see the schema comment above).
 */
export interface ClientToServerEvents {
  [RT.driverLocation]: (
    payload: unknown,
    ack?: (response: DriverLocationAck) => void,
  ) => void;
}

/**
 * The CLIENT's emit map: `Socket<ServerToClientEvents, ClientToServerEmitEvents>`
 * in the driver app. Typed, because the app is our own code and the payload it
 * builds should be checked at compile time — the same event, one trust level
 * per direction, mirroring the ping/event schema split above.
 */
export interface ClientToServerEmitEvents {
  [RT.driverLocation]: (
    payload: DriverLocationPing,
    ack: (response: DriverLocationAck) => void,
  ) => void;
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
  [RT.dispatchSmsFailed]: (payload: DispatchSmsFailedEvent) => void;
}

/**
 * Event → payload schema, so the api's emit helpers can `.parse()` before
 * they send. This makes the ISO-string rule at the top of this file an
 * enforced invariant instead of a documented one.
 *
 * `satisfies`, never an annotation: `rideAssignedEventSchema` is a
 * `ZodEffects` (it has a `.refine()`), and annotating the object would widen
 * every entry to the common supertype and destroy per-key inference.
 */
export const RT_EVENT_SCHEMAS = {
  [RT.driverLocation]: driverLocationEventSchema,
  [RT.driverQueue]: driverQueueEventSchema,
  [RT.rideStatus]: rideStatusEventSchema,
  [RT.rideOffer]: rideOfferEventSchema,
  [RT.rideOfferRevoked]: rideOfferRevokedEventSchema,
  [RT.rideAssigned]: rideAssignedEventSchema,
  [RT.dispatchBoard]: dispatchBoardEventSchema,
  [RT.dispatchUnclaimed]: dispatchUnclaimedEventSchema,
  [RT.dispatchSmsFailed]: dispatchSmsFailedEventSchema,
} satisfies Record<keyof ServerToClientEvents, z.ZodType>;
