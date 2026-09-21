import { z } from 'zod';
import { phoneSchema } from './user';

/**
 * The no-login tracking-page contract (#63): what `GET /track/:token` returns
 * and what the `/t/:token` page renders. One page serves phone-booked riders,
 * share-trip from the rider app (#17), and blind riders' sighted assistants.
 */

/**
 * Shape-only validation of a tracking token: 16 base64url chars, the output of
 * `randomBytes(12).toString('base64url')` — 96 bits of entropy. MINTING lives
 * in the API (`TrackingService`) — this package is isomorphic and must not
 * touch `node:crypto`.
 *
 * THE 96 BITS ARE THE WHOLE DEFENCE AGAINST GUESSING, and nothing else backs
 * them up. `TRACKING_VIEW_MAX_PER_WINDOW` is keyed per token
 * (`notifications.policy.ts`'s `trackingViewRateKey`), so it bounds polling of
 * a KNOWN token — the spend path — and gives every guess at an UNKNOWN one its
 * own fresh window. That file says so outright; do not read the rate limit as
 * an enumeration control, and do not let it license a shorter token.
 *
 * SHORTENED FROM 22 IN #136 for the SMS character budget: six characters of a
 * 70-character UCS-2 segment. The rest of the URL contract — the host ceiling
 * and the per-language path — lives in `tracking-link.ts`, with the
 * derivation. This is a HARD cut-over, not a widening: no deploy has ever run
 * (`gh run list --workflow=deploy.yml` was empty on 2026-09-21), so no 22-char
 * link exists to break.
 *
 * It DOES break pre-existing local rows. `schemas/ride.ts` wires this into
 * `rideSchema`, and `rides.repository.ts` parses every row through it, so a
 * ride minted before #136 — including by `scripts/mint-tracked-ride.ts` —
 * throws on READ, not just when its link is opened. Remedy on a persistent
 * local DB: `UPDATE rides SET tracking_token = NULL`, or re-seed.
 */
export const trackingTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16}$/, 'expected 16-char base64url tracking token');
export type TrackingToken = z.infer<typeof trackingTokenSchema>;

/**
 * What the PAGE distinguishes — coarser than `RIDE_STATUSES` on purpose: the
 * rider at the kerb does not care which of four parties cancelled, and the
 * pre-driver machine states (`requested`/`offered`/`queued`/`scheduled`) all
 * read as "searching". `expired` is not a ride status at all: it is the
 * page's own 410 state once a terminal ride outlives its grace window.
 */
export const TRACKING_PAGE_STATES = [
  'searching',
  'assigned',
  'arriving',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'expired',
] as const;
export type TrackingPageState = (typeof TRACKING_PAGE_STATES)[number];

/**
 * WIRE schema (realtime-events.ts rule): timestamps are ISO strings, not
 * `Date` — the page consumes this over plain fetch/JSON. Deliberately exposes
 * NO rider PII: driver, vehicle, position, ETA and the dispatch phone are the
 * whole payload.
 */
export const trackingViewSchema = z.object({
  state: z.enum(TRACKING_PAGE_STATES),
  /** Driver first name only — null until a driver is assigned. */
  driverName: z.string().nullable(),
  driverPhotoUrl: z.string().nullable(),
  vehiclePlate: z.string().nullable(),
  /** Last known driver position; null before assignment or when GPS is silent. */
  position: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      /** When the position was recorded (ISO). */
      at: z.string().datetime(),
    })
    .nullable(),
  etaMinutes: z.number().int().nonnegative().nullable(),
  dispatchPhone: phoneSchema,
  updatedAt: z.string().datetime(),
});
export type TrackingView = z.infer<typeof trackingViewSchema>;
