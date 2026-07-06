import { z } from "zod";
import { PAYMENT_METHOD_TYPES, PRICING_MODELS, RIDE_CATEGORIES } from "../enums";
import { RIDE_STATUSES } from "../ride-state-machine";
import { addressPointSchema } from "./geo";

export const rideOptionsSchema = z.object({
  childSeat: z.boolean().default(false),
  femaleDriver: z.boolean().default(false),
});
export type RideOptions = z.infer<typeof rideOptionsSchema>;

export const fareQuoteSchema = z.object({
  model: z.enum(PRICING_MODELS),
  currency: z.literal("EUR"),
  totalCents: z.number().int().nonnegative(),
  breakdown: z.object({
    baseCents: z.number().int().nonnegative(),
    distanceCents: z.number().int().nonnegative(),
    timeCents: z.number().int().nonnegative(),
    /** Shared-ride route-overlap knock-down and similar (negative amount). */
    discountCents: z.number().int().nonpositive().default(0),
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

export const rideSchema = z.object({
  id: z.string().uuid(),
  /** Groups the N rides of a multi-taxi order. */
  orderId: z.string().uuid(),
  status: z.enum(RIDE_STATUSES),
  riderId: z.string().uuid(),
  driverId: z.string().uuid().nullable(),
  request: rideRequestSchema,
  quote: fareQuoteSchema.nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Ride = z.infer<typeof rideSchema>;
