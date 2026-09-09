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
 * Expo's per-notification `data` budget. The offer JSON is included only if
 * the whole payload stays under it; past that the push carries ids only.
 * Lives beside the schema because whether `offer` is present is part of the
 * envelope's contract, not an api-side implementation detail.
 */
export const OFFER_PUSH_PAYLOAD_MAX_BYTES = 2_048;
