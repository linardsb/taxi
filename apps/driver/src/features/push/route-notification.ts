import { rideOfferEventSchema, type RideOfferEvent } from '@taxi/shared';

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
  if (!isRecord(data) || data.kind !== 'offer') return { kind: 'gate' };
  const offerId = typeof data.offerId === 'string' ? data.offerId : null;
  const rideId = typeof data.rideId === 'string' ? data.rideId : null;
  let offer: RideOfferEvent | null = null;
  if (typeof data.offer === 'string') {
    try {
      const parsed = rideOfferEventSchema.safeParse(
        JSON.parse(data.offer) as unknown,
      );
      if (parsed.success) offer = parsed.data;
    } catch {
      offer = null; // junk JSON: the ids still route the tap
    }
  }
  return { kind: 'offer', offer, offerId, rideId };
}
