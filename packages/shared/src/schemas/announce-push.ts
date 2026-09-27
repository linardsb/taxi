import { z } from 'zod';

/**
 * The arrival-announce push's `data` envelope (#259): the rider asked the
 * driver to call out. One schema for both sides, for `offer-push.ts`'s
 * reasons — a rename fails typecheck on the api and the app together — and,
 * as there, **every value is a string**, because Expo forwards `data`
 * verbatim and does not preserve types.
 *
 * `at` is the same instant the socket event and the driver read's
 * `announceRequestedAt` carry: the app dedupes the three legs on it. Nothing
 * here names the rider or an address.
 */
export const announcePushDataSchema = z.object({
  kind: z.literal('announce_requested'),
  rideId: z.string().uuid(),
  at: z.string().datetime(),
});

export type AnnouncePushData = z.infer<typeof announcePushDataSchema>;
