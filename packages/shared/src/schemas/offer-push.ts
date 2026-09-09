import { z } from 'zod';

/**
 * The offer push's `data` envelope — a cross-surface contract, so it lives
 * here rather than as bare string literals on each side.
 *
 * It was exactly that on both sides before: `dispatch-notifier.ts` built
 * `{ kind, offerId, rideId, expiresAt, offer }` from literals and
 * `route-notification.ts` read them back from literals, with nothing spanning
 * the two. They were already drifting — the api sent `expiresAt` and the app
 * never read it — and renaming `offer` or changing `kind` left typecheck, lint
 * and both suites green while every offer push silently degraded to ids-only,
 * or dumped a tapping driver on the gate.
 *
 * **Every value is a string.** Expo forwards notification `data` verbatim and
 * does not preserve types, which is why the offer travels as JSON in `offer`
 * rather than as a nested object.
 */
export const offerPushDataSchema = z.object({
  kind: z.literal('offer'),
  offerId: z.string().uuid(),
  rideId: z.string().uuid(),
  /**
   * The whole `ride:offer` wire event as JSON, present only when it fitted
   * inside {@link OFFER_PUSH_PAYLOAD_MAX_BYTES}. When absent the tap still
   * routes by the ids and the card is drawn from whatever the socket
   * delivered — so consumers must treat it as optional, never assume it.
   */
  offer: z.string().optional(),
});

export type OfferPushData = z.infer<typeof offerPushDataSchema>;

/**
 * The most bytes of offer JSON the push may carry. This project's sub-cap,
 * NOT Expo's limit: `dispatch-notifier.ts` measures the offer JSON alone
 * against it, and past that the push carries the ids only.
 *
 * `derived`: Expo's limit is 4,096 B for the whole message. Title + body
 * ≤ ~120 B in any of the three catalogs, and the rest of the envelope —
 * `kind` plus the two uuids, with `offer` empty — is 124 B (`observed`,
 * `Buffer.byteLength` of that object stringified), so 2,048 B leaves
 * 4,096 − 120 − 124 − 2,048 = 1,804 B spare. That headroom also absorbs the
 * escaping the offer JSON picks up when it is nested here as a string.
 *
 * The only unbounded strings in an offer are the two addresses
 * (`addressPointSchema.address` has no max), so a long pair is what drops an
 * offer to ids-only; the tap then lands on whatever card the socket delivered.
 *
 * Lives beside the schema because whether `offer` is present is part of the
 * envelope's contract, not an api-side implementation detail.
 */
export const OFFER_PUSH_PAYLOAD_MAX_BYTES = 2_048;
