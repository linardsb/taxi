import { z } from "zod";
import {
  ASSIGNMENT_SOURCES,
  OFFER_STATUSES,
  PAYMENT_METHOD_TYPES,
  PRICING_MODELS,
  RIDE_CATEGORIES,
} from "../enums";
import { fareSplitSchema } from "../commission";
import { eurCurrencySchema, nonNegativeCentsSchema, nonPositiveCentsSchema } from "../money";
import { RIDE_STATUSES } from "../ride-state-machine";
import { addressPointSchema } from "./geo";

export const rideOptionsSchema = z.object({
  childSeat: z.boolean().default(false),
  femaleDriver: z.boolean().default(false),
});
export type RideOptions = z.infer<typeof rideOptionsSchema>;

export const fareQuoteSchema = z.object({
  model: z.enum(PRICING_MODELS),
  currency: eurCurrencySchema,
  totalCents: nonNegativeCentsSchema,
  breakdown: z.object({
    baseCents: nonNegativeCentsSchema,
    distanceCents: nonNegativeCentsSchema,
    timeCents: nonNegativeCentsSchema,
    /** Shared-ride route-overlap knock-down and similar (negative amount). */
    discountCents: nonPositiveCentsSchema.default(0),
  }),
});
export type FareQuote = z.infer<typeof fareQuoteSchema>;

export const rideRequestSchema = z.object({
  riderId: z.string().uuid(),
  pickup: addressPointSchema,
  /** Intermediate stops (outline §8: "gala adrese vai starp adrese"). */
  stops: z.array(addressPointSchema).max(5).default([]),
  destination: addressPointSchema,
  category: z.enum(RIDE_CATEGORIES).default("standard"),
  options: rideOptionsSchema.default({ childSeat: false, femaleDriver: false }),
  paymentMethod: z.enum(PAYMENT_METHOD_TYPES),
  /** Set for "izsaukumi uz laiku" — scheduled rides enter the machine as `scheduled`. */
  scheduledFor: z.coerce.date().optional(),
  /** Multi-taxi orders (transfers): how many cars this order needs. Each becomes its own ride. */
  vehicleCount: z.number().int().min(1).max(5).default(1),
  /** Rider's own price offer in cents (rider_bid pricing model only). */
  offeredPriceCents: z.number().int().positive().optional(),
});
export type RideRequest = z.infer<typeof rideRequestSchema>;

/**
 * How a ride got its driver, with the audit trail for manual overrides.
 * Dina's force-assign is the anketa's most-cited human-in-the-loop feature
 * (S9-2, S9-4), and an override without an actor is an unauditable one.
 */
export const rideAssignmentSchema = z
  .object({
    rideId: z.string().uuid(),
    driverId: z.string().uuid(),
    source: z.enum(ASSIGNMENT_SOURCES),
    /** Required when source === "dispatcher": the force-assign audit trail (S9-2, S9-4). */
    dispatcherId: z.string().uuid().nullable().default(null),
    /** Free-text reason a dispatcher overrode the algorithm — shown in the admin audit view. */
    reason: z.string().max(280).nullable().default(null),
    assignedAt: z.coerce.date(),
  })
  .refine((a) => a.source !== "dispatcher" || a.dispatcherId !== null, {
    message: "dispatcher assignments require dispatcherId (audit trail)",
    path: ["dispatcherId"],
  });
export type RideAssignment = z.infer<typeof rideAssignmentSchema>;

/** What a driver is shown before accepting — the offer cascade's unit of work. */
export const rideOfferSchema = z.object({
  id: z.string().uuid(),
  rideId: z.string().uuid(),
  driverId: z.string().uuid(),
  /**
   * Flat enum with no transition table by design: offer outcomes already map
   * onto guarded ride transitions (`offered → accepted`, `offered → requested`).
   * The repo has exactly one guarded state machine and it stays that way.
   */
  status: z.enum(OFFER_STATUSES),
  source: z.enum(ASSIGNMENT_SOURCES),
  sentAt: z.coerce.date(),
  /** Cascade deadline; on expiry the ride goes `offered → requested` and re-offers. */
  expiresAt: z.coerce.date(),
  etaSeconds: z.number().int().nonnegative(),
  pickup: addressPointSchema,
  destination: addressPointSchema,
  /** The full fare the RIDER pays — the driver sees it before accepting (S2-5 is the whole wedge). */
  quote: fareQuoteSchema,
  /** What the driver keeps, with the commission line explicit ("you keep 85%"). */
  split: fareSplitSchema,
  /** 1-based position when this offer came from a geozone queue (S7-2). */
  queuePosition: z.number().int().min(1).optional(),
});
export type RideOffer = z.infer<typeof rideOfferSchema>;

/**
 * The two halves of the driver's transparency card must describe the SAME fare.
 *
 * `fareSplitSchema`'s no-leak refinement proves the split is internally
 * consistent; it cannot see the quote sitting next to it. Without this, an
 * offer built from a stale quote parses clean and the S2-5 card — the whole
 * wedge — reads "€20.00 fare · you keep €4.25".
 *
 * A predicate rather than a `.refine()`, for the reason recorded on
 * `isRideAssignmentConsistent`: `rideOfferSchema` must stay a plain `ZodObject`
 * so #6 can derive a `ride_offers` insert shape from it. Call at the write and
 * emit boundaries (#10/#11).
 */
export function isOfferSplitConsistent(offer: RideOffer): boolean {
  return offer.quote.totalCents === offer.split.totalCents;
}

export function assertOfferSplitConsistent(offer: RideOffer): void {
  if (!isOfferSplitConsistent(offer)) {
    throw new Error(
      `Offer ${offer.id}: split.totalCents ${offer.split.totalCents} does not match quote.totalCents ${offer.quote.totalCents}`,
    );
  }
}

/** The ride record ("RideRecord" in issue #2 and the build playbook). */
export const rideSchema = z.object({
  id: z.string().uuid(),
  /** Groups the N rides of a multi-taxi order. */
  orderId: z.string().uuid(),
  status: z.enum(RIDE_STATUSES),
  riderId: z.string().uuid(),
  driverId: z.string().uuid().nullable(),
  /** Pickup zone — drives queue mode and the district stats Dina asked for (S7-2). */
  geozoneId: z.string().uuid().nullable().default(null),
  request: rideRequestSchema,
  quote: fareQuoteSchema.nullable(),
  /** How this ride got its driver. null until a driver is assigned. */
  assignment: rideAssignmentSchema.nullable().default(null),
  /** Written at completion (#11); null until then. */
  split: fareSplitSchema.nullable().default(null),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Ride = z.infer<typeof rideSchema>;

/**
 * `ride.driverId` is the denormalized field #6 indexes; `assignment.driverId`
 * is the audit record. They must not drift.
 *
 * Deliberately a predicate rather than a `.refine()` on `rideSchema`: a refined
 * schema is a `ZodEffects` and loses `.omit()`/`.pick()`/`.extend()`, which #6
 * needs for Drizzle insert shapes and #9/#11 need for partial reads. Call this
 * at write boundaries (#11).
 */
export function isRideAssignmentConsistent(ride: Ride): boolean {
  return ride.assignment === null || ride.assignment.driverId === ride.driverId;
}

export function assertRideAssignmentConsistent(ride: Ride): void {
  if (!isRideAssignmentConsistent(ride)) {
    throw new Error(
      `Ride ${ride.id}: driverId ${String(ride.driverId)} does not match assignment.driverId ${String(
        ride.assignment?.driverId,
      )}`,
    );
  }
}

/**
 * The settled counterpart of `isOfferSplitConsistent`: what #11 pays the driver
 * must be a cut of what the rider was actually quoted.
 *
 * Checked only when BOTH are present — a quote with no split is the legitimate
 * mid-ride state (the quote lands at request time, the split at completion), so
 * requiring both would fire on every in-flight ride.
 */
export function isRideSplitConsistent(ride: Ride): boolean {
  return (
    ride.quote === null || ride.split === null || ride.quote.totalCents === ride.split.totalCents
  );
}

export function assertRideSplitConsistent(ride: Ride): void {
  if (!isRideSplitConsistent(ride)) {
    throw new Error(
      `Ride ${ride.id}: split.totalCents ${String(ride.split?.totalCents)} does not match quote.totalCents ${String(
        ride.quote?.totalCents,
      )}`,
    );
  }
}
