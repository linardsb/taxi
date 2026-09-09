import {
  offerPushDataSchema,
  rideOfferEventSchema,
  type RideOfferEvent,
} from '@taxi/shared';

/**
 * Where a notification sends the app (#15). `offer` carries the wire offer
 * when the push fitted it in (`dispatch-notifier.ts`, ≤ 2,048 B), so a tap
 * on a killed app can draw the card with no read; `null` when the payload
 * was too large or malformed, in which case the tap still lands on `/offer`
 * and shows whatever the socket delivered — or redirects home.
 */
export type NotificationRoute =
  | {
      kind: 'offer';
      offer: RideOfferEvent | null;
      offerId: string | null;
      rideId: string | null;
    }
  | { kind: 'gate' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Pure: notification `data` (strings only, Expo forwards them verbatim) → route. */
export function routeNotification(data: unknown): NotificationRoute {
  // The literal comes off the SHARED schema, not a copy of it: the gate runs
  // before the parse, so a bare `'offer'` here would still compile after the
  // envelope's `kind` changed — and every offer push would fall to the gate.
  if (!isRecord(data) || data.kind !== offerPushDataSchema.shape.kind.value)
    return { kind: 'gate' };
  // Parsed through the SHARED envelope, which the api builds against — a
  // rename on either side now fails typecheck rather than silently degrading
  // every offer push to ids-only. A malformed envelope still routes the tap by
  // whatever ids survive, so a bad `offerId` never costs the driver the card.
  const envelope = offerPushDataSchema.safeParse(data);
  const offerId = envelope.success
    ? envelope.data.offerId
    : typeof data.offerId === 'string'
      ? data.offerId
      : null;
  const rideId = envelope.success
    ? envelope.data.rideId
    : typeof data.rideId === 'string'
      ? data.rideId
      : null;
  const raw = envelope.success ? envelope.data.offer : data.offer;
  let offer: RideOfferEvent | null = null;
  if (typeof raw === 'string') {
    try {
      const parsed = rideOfferEventSchema.safeParse(JSON.parse(raw) as unknown);
      if (parsed.success) offer = parsed.data;
    } catch {
      offer = null; // junk JSON: the ids still route the tap
    }
  }
  return { kind: 'offer', offer, offerId, rideId };
}
