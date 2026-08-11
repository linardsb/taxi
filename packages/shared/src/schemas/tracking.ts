import { z } from 'zod';
import { phoneSchema } from './user';

/**
 * The no-login tracking-page contract (#63): what `GET /track/:token` returns
 * and what the `/t/:token` page renders. One page serves phone-booked riders,
 * share-trip from the rider app (#17), and blind riders' sighted assistants.
 */

/**
 * Shape-only validation of a tracking token: 22 base64url chars, the output of
 * `randomBytes(16).toString('base64url')`. MINTING lives in the API
 * (`TrackingService`) — this package is isomorphic and must not touch
 * `node:crypto`.
 */
export const trackingTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22}$/, 'expected 22-char base64url tracking token');
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
