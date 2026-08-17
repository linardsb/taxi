import { z } from 'zod';
import { SAVED_PLACE_KINDS } from '../enums';
import { addressPointSchema } from './geo';
import { rideRequestBodySchema } from './ride';
import { phoneSchema } from './user';

/**
 * The phone channel's customer record (#19) — a `users` row plus what the app
 * path has no place for. Not an identity of its own: `userId` is the person,
 * and a caller who later installs the app keeps their history.
 */
export const customerSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  /** What Dina reads aloud on the pop. NULL for a number that has rung once. */
  label: z.string().max(120).nullable().default(null),
  isVenue: z.boolean().default(false),
  notes: z.string().max(1000).nullable().default(null),
});
export type Customer = z.infer<typeof customerSchema>;

/** One reusable address on a customer record. */
export const savedPlaceSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  kind: z.enum(SAVED_PLACE_KINDS),
  label: z.string().max(120).nullable().default(null),
  point: addressPointSchema,
  /** NULL for an address that never came from Places — a kerbside pickup. */
  placeId: z.string().nullable().default(null),
});
export type SavedPlace = z.infer<typeof savedPlaceSchema>;

/**
 * One of the caller's last three rides, projected for reuse as a booking
 * prefill.
 *
 * STABLE FIELDS ONLY, and this projection is where that rule is enforced
 * rather than remembered: pickup, destination and when. No payment method, no
 * notes, no category — evidence F2.2's "Clean jobs" toggle exists because
 * prefilling per-trip fields produces confidently wrong bookings.
 */
export const recentRideSchema = z.object({
  rideId: z.string().uuid(),
  pickup: addressPointSchema,
  destination: addressPointSchema,
  /**
   * When the ride was BOOKED, not when it finished — `rides` has no completion
   * timestamp, and inventing one from `updated_at` would date the last status
   * change, which for a cancelled ride is the cancellation. Booking time is
   * what makes a job recognizable to the caller reading it back ("the airport
   * one on Friday"), which is all this list is for.
   */
  bookedAt: z.coerce.date(),
});
export type RecentRide = z.infer<typeof recentRideSchema>;

/**
 * What `GET /customers/lookup` answers. The whole response is `null` for a
 * number that has never rung — a first-time caller is the ordinary case, not a
 * 404.
 *
 * `customer` is separately nullable, and the case is real: a rider who has only
 * ever used the app has a `users` row and a ride history but no `customers`
 * row, because nobody has filed them. Their recent rides are the useful half of
 * the pop, so the panel shows them under an unnamed header rather than claiming
 * the number is unknown.
 */
export const callerLookupSchema = z.object({
  userId: z.string().uuid(),
  customer: customerSchema.nullable(),
  savedPlaces: z.array(savedPlaceSchema).default([]),
  recentRides: z.array(recentRideSchema).max(3).default([]),
});
export type CallerLookup = z.infer<typeof callerLookupSchema>;

/** Naming a caller or flagging a venue — Dina's own edits to the record. */
export const customerUpsertBodySchema = z.object({
  phone: phoneSchema,
  label: z.string().max(120).nullable().default(null),
  isVenue: z.boolean().default(false),
  notes: z.string().max(1000).nullable().default(null),
});
export type CustomerUpsertBody = z.infer<typeof customerUpsertBodySchema>;

/**
 * What Dina puts on the wire to book for a caller (#19).
 *
 * Inherits `rideRequestBodySchema`, which means it inherits the OMISSION of
 * `riderId` — the dispatcher never names the rider, she names the phone that
 * rang, and the server resolves it. A body-supplied rider id would let a
 * dispatcher book onto any account and would make the audit row a fiction.
 *
 * `.extend()` keeps it a plain `ZodObject`, so every default of the rider body
 * survives and the server can re-parse `{ ...rideBody, riderId }` through the
 * full `rideRequestSchema` exactly as the rider path does.
 */
export const dispatcherBookingBodySchema = rideRequestBodySchema.extend({
  callerPhone: phoneSchema,
  /** Prefills the `users` row on first sight; never overwrites an existing one. */
  callerName: z.string().max(120).optional(),
  dispatcherNote: z.string().max(280).nullable().default(null),
});
export type DispatcherBookingBody = z.infer<typeof dispatcherBookingBodySchema>;
