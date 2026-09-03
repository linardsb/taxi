import { z } from 'zod';
import {
  ASSIGNMENT_SOURCES,
  BOOKABLE_PAYMENT_METHODS,
  BOOKING_CHANNELS,
  OFFER_STATUSES,
  PAYMENT_METHOD_TYPES,
  PRICING_MODELS,
  RIDE_CATEGORIES,
} from '../enums';
import { fareSplitSchema } from '../commission';
import {
  eurCurrencySchema,
  nonNegativeCentsSchema,
  nonPositiveCentsSchema,
  positiveCentsSchema,
} from '../money';
import { RIDE_STATUSES } from '../ride-state-machine';
import { addressPointSchema } from './geo';
import { trackingTokenSchema } from './tracking';

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

/**
 * Whether a quote's breakdown reconciles to its total (#29).
 *
 * NOT enforced by the schema, and the asymmetry is the decision: for
 * `upfront_fixed` the breakdown IS the total, decomposed — #11 settles and #20
 * reports off these numbers, so a quote whose parts do not sum is a bug. For
 * `rider_bid` the total is the rider's own offer and the breakdown is an
 * estimate of what the ride is worth; requiring those to agree would make an
 * honest bid unrepresentable.
 *
 * A predicate rather than a `.refine()`, for the same reason as
 * `isOfferSplitConsistent`: `fareQuoteSchema` must stay a plain `ZodObject` so
 * #6 can derive Drizzle insert shapes from it with `.omit()`/`.extend()`, which
 * a `ZodEffects` does not carry. Call it where the model says it must hold.
 */
export function isFareQuoteConsistent(quote: FareQuote): boolean {
  const b = quote.breakdown;
  return (
    b.baseCents + b.distanceCents + b.timeCents + b.discountCents ===
    quote.totalCents
  );
}

export function assertFareQuoteConsistent(quote: FareQuote): void {
  if (!isFareQuoteConsistent(quote)) {
    const b = quote.breakdown;
    throw new Error(
      `Quote breakdown ${b.baseCents}+${b.distanceCents}+${b.timeCents}+${b.discountCents} does not sum to totalCents ${quote.totalCents}`,
    );
  }
}

export const rideRequestSchema = z.object({
  riderId: z.string().uuid(),
  pickup: addressPointSchema,
  /** Intermediate stops (outline §8: "gala adrese vai starp adrese"). */
  stops: z.array(addressPointSchema).max(5).default([]),
  destination: addressPointSchema,
  category: z.enum(RIDE_CATEGORIES).default('standard'),
  options: rideOptionsSchema.default({ childSeat: false, femaleDriver: false }),
  paymentMethod: z.enum(PAYMENT_METHOD_TYPES),
  /** Set for "izsaukumi uz laiku" — scheduled rides enter the machine as `scheduled`. */
  scheduledFor: z.coerce.date().optional(),
  /** Multi-taxi orders (transfers): how many cars this order needs. Each becomes its own ride. */
  vehicleCount: z.number().int().min(1).max(5).default(1),
  /** Rider's own price offer in cents (rider_bid pricing model only). */
  offeredPriceCents: positiveCentsSchema.optional(),
});
export type RideRequest = z.infer<typeof rideRequestSchema>;

/**
 * What a rider may put on the wire. `riderId` is omitted by construction, for
 * the same reason `driverLocationPingSchema` refuses to carry a `driverId`: the
 * identity comes from the JWT, and a body-supplied `riderId` would let any
 * authenticated rider book on someone else's account.
 *
 * `.omit()` keeps this a plain `ZodObject`, so it carries every default
 * (`stops: []`, `category: "standard"`, `options`, `vehicleCount: 1`) — which
 * is why the server can re-parse `{ ...body, riderId }` through the full
 * `rideRequestSchema` and get an identical, fully-defaulted `RideRequest`.
 *
 * `paymentMethod` is narrowed to `BOOKABLE_PAYMENT_METHODS`: the wire refuses
 * what settlement cannot finish (#70). `.extend()` keeps this a plain
 * `ZodObject`, and since the subset is contained in `PAYMENT_METHOD_TYPES`,
 * the server's re-parse of `{ ...body, riderId }` through the full
 * `rideRequestSchema` (`rides.service.ts`) still yields an identical,
 * fully-defaulted `RideRequest`.
 */
export const rideRequestBodySchema = rideRequestSchema
  .omit({ riderId: true })
  .extend({ paymentMethod: z.enum(BOOKABLE_PAYMENT_METHODS) });
export type RideRequestBody = z.infer<typeof rideRequestBodySchema>;

/**
 * What `POST /rides/quote` takes (#16) — the booking body minus everything that
 * does not move an `upfront_fixed` price. Sits here, next to the body it is
 * derived from, so the relationship is visible rather than inferred.
 *
 * `.pick()` for the reason `rideRequestBodySchema` uses `.omit()`/`.extend()`:
 * it keeps this a plain `ZodObject`, so it carries every default (`stops: []`,
 * `category: "standard"`, `options`) and the server can re-parse the preview
 * body into a full `RideRequest` the pricing strategy accepts.
 *
 * NO `paymentMethod`. The fare does not depend on it, and requiring one would
 * make the rider choose how to pay before seeing what it costs — the exact
 * inversion the upfront-quote criterion forbids. `docs/research/rider-ux-
 * evidence.md` §7: cash and card show ONE identical price, and diverging prices
 * are what creates distrust.
 *
 * DO NOT ADD `vehicleCount` OR `scheduledFor` HERE — and this is the coupling
 * the next field added to this list has to answer to. The preview path calls
 * `PricingService.quote()` directly and therefore skips `RidesService.request`'s
 * guards, so `multi_taxi_not_supported` and `scheduled_in_past` are unreachable
 * on a preview. `vehicleCount` defaults to 1 and `scheduledFor` is absent, so
 * the two paths agree today. A field added here would let the preview happily
 * price an order the booking path refuses, and the rider would see a quote for a
 * ride they cannot book.
 */
export const rideQuoteBodySchema = rideRequestBodySchema.pick({
  pickup: true,
  stops: true,
  destination: true,
  category: true,
  options: true,
});
export type RideQuoteBody = z.infer<typeof rideQuoteBodySchema>;

/**
 * The `POST /rides/quote` response (#16).
 *
 * DELIBERATELY NO `split`, unlike `rideCreatedSchema`. The commission line is
 * the DRIVER's transparency card (S2-5 — "you keep 85%"); a rider-facing
 * preview has no reason to hold the platform's cut, and returning it would
 * publish the commission to a surface that never renders it.
 */
export const rideQuotePreviewSchema = z.object({ quote: fareQuoteSchema });
export type RideQuotePreview = z.infer<typeof rideQuotePreviewSchema>;

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
  .refine((a) => a.source !== 'dispatcher' || a.dispatcherId !== null, {
    message: 'dispatcher assignments require dispatcherId (audit trail)',
    path: ['dispatcherId'],
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
  /**
   * The OPERATIVE, mutable payment method (`rides.payment_method`) — the rider
   * may change it until `isPaymentMethodLocked()` turns true at `accepted`.
   *
   * Deliberately distinct from `request.paymentMethod`, which is the immutable
   * wire snapshot of "what was asked" and must NEVER be rewritten: rewriting it
   * would destroy the audit record the table docblock describes.
   */
  paymentMethod: z.enum(PAYMENT_METHOD_TYPES),
  request: rideRequestSchema,
  quote: fareQuoteSchema.nullable(),
  /** How this ride got its driver. null until a driver is assigned. */
  assignment: rideAssignmentSchema.nullable().default(null),
  /** Written at completion (#11); null until then. */
  split: fareSplitSchema.nullable().default(null),
  /**
   * How the ride was booked (#63). Defaults `'app'` so pre-#63 ride objects
   * still parse; #19's dispatcher controller is the only writer of `'phone'`.
   */
  bookingChannel: z.enum(BOOKING_CHANNELS).default('app'),
  /**
   * Unguessable handle for the no-login tracking page, minted at creation
   * (#63; #17's share-trip reuses it). Nullable because legacy rows never got
   * one — those rides are simply untrackable, by design.
   */
  trackingToken: trackingTokenSchema.nullable().default(null),
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
    ride.quote === null ||
    ride.split === null ||
    ride.quote.totalCents === ride.split.totalCents
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

/**
 * The `PATCH /rides/:rideId/payment-method` body (#11).
 *
 * Lives here rather than beside the controller — unlike #10's local
 * `forceAssignBodySchema` — because it has a named cross-surface consumer
 * today: #17's rider app is the only thing that ever sends it.
 *
 * Narrowed to `BOOKABLE_PAYMENT_METHODS` because this route is the booking
 * restriction's side door: booking `cash` and then switching to `balance`
 * before the lock would recreate the exact unsettleable ride #70 closes.
 */
export const ridePaymentMethodUpdateSchema = z.object({
  paymentMethod: z.enum(BOOKABLE_PAYMENT_METHODS),
});
export type RidePaymentMethodUpdate = z.infer<
  typeof ridePaymentMethodUpdateSchema
>;

/**
 * The `POST /rides/:rideId/cancel` body (#11). The ACTOR is deliberately absent:
 * it comes from the JWT role, the same rule that keeps `riderId` off
 * `rideRequestBodySchema` and `dispatcherId` off the force-assign body.
 *
 * `max(280)` matches `rideAssignmentSchema.reason` and
 * `rideStatusEventSchema.reason` — the reason travels straight onto the wire.
 */
export const rideCancelSchema = z.object({
  reason: z.string().max(280).nullable().default(null),
});
export type RideCancel = z.infer<typeof rideCancelSchema>;

/**
 * The `POST /rides` response (#9).
 *
 * `split` here is the PLATFORM-BASE preview (`commissionSource:
 * "platform_base"`), computed with NO driver because no driver exists at
 * request time. It is returned and persisted nowhere. #10 re-resolves it per
 * driver for the offer card — a `commissionPctOverride` changes it, so reusing
 * this one would show the wrong number on the card the whole pitch rests on —
 * and #11 writes the settled split to `rides.commission_*`.
 *
 * Not to be confused with `rideSchema.split`, which stays `null` until
 * completion.
 */
export const rideCreatedSchema = z.object({
  ride: rideSchema,
  split: fareSplitSchema,
});
export type RideCreated = z.infer<typeof rideCreatedSchema>;
