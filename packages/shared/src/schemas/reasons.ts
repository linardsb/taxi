import { z } from 'zod';
import {
  CANCEL_REASON_CODES,
  DECLINE_REASONS,
  reasonNeedsText,
  type RideReasonCode,
} from '../reasons';

/**
 * Free text beside a reason code (D4): trimmed, capped at 280, `''` → null.
 * It lands in an undeletable `ride_events` row, so it is never logged.
 * `max(280)` matches `rideStatusEventSchema.reason` — the text also travels
 * onto the `ride:status` wire.
 */
const reasonText = z
  .string()
  .trim()
  .max(280)
  .nullable()
  .default(null)
  .transform((v) => (v === '' ? null : v));

/** A `*_other` code needs text (D2). */
const needsText = (b: {
  reasonCode: RideReasonCode | null;
  reasonText: string | null;
}): boolean =>
  !(b.reasonCode && reasonNeedsText(b.reasonCode)) || b.reasonText !== null;

/**
 * A bodiless POST with no content-type reaches the pipe as `undefined`, not
 * `{}` (#316 spike S8: express 5 / body-parser 2). The driver app's decline
 * sends exactly that, so treat it as an empty body.
 */
const bodyOrEmpty = (v: unknown): unknown => v ?? {};

/**
 * The `POST /rides/:rideId/cancel` body (#11, reshaped by #316). The ACTOR is
 * deliberately absent: it comes from the JWT role, the same rule that keeps
 * `riderId` off `rideRequestBodySchema` and `dispatcherId` off the
 * force-assign body. Which codes an actor may send, and whether one is
 * required, is the api's call (dispatcher/admin must send one).
 */
export const rideCancelSchema = z.preprocess(
  bodyOrEmpty,
  z
    .object({
      reasonCode: z.enum(CANCEL_REASON_CODES).nullable().default(null),
      reasonText,
    })
    .refine(needsText, {
      path: ['reasonText'],
      message: 'reason_text_required',
    }),
);
export type RideCancel = z.infer<typeof rideCancelSchema>;

/** The `POST /offers/:offerId/decline` body (#316). Optional until the driver picker lands (#322). */
export const offerDeclineSchema = z.preprocess(
  bodyOrEmpty,
  z
    .object({
      reasonCode: z.enum(DECLINE_REASONS).nullable().default(null),
      reasonText,
    })
    .refine(needsText, {
      path: ['reasonText'],
      message: 'reason_text_required',
    }),
);
export type OfferDecline = z.infer<typeof offerDeclineSchema>;
