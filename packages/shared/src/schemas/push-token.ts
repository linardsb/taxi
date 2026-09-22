import { z } from 'zod';

/**
 * `ExponentPushToken[...]` (classic) or `ExpoPushToken[...]` — both are minted
 * by `getExpoPushTokenAsync` (#14). Deliberately NOT on any wire profile
 * schema: a provider handle on the wire profile is how it ends up in a log
 * (the `users.payment_customer_ref` precedent in db/src/schema/users.ts).
 *
 * **Lived in `schemas/driver.ts` until #17's rider arrival push.** A push token
 * is a property of a PHONE, not of a role — the driver app and the rider app
 * mint the same shape from the same Expo API, and both register it against
 * their own `me/push-token` route. Leaving it under `driver` would have made
 * the rider slice import a driver schema for a value that was never the
 * driver's, which is the duplication the contract seam exists to prevent.
 */
export const expoPushTokenSchema = z
  .string()
  .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,64}\]$/);
export const pushTokenUpdateSchema = z.object({ token: expoPushTokenSchema });
export type PushTokenUpdate = z.infer<typeof pushTokenUpdateSchema>;
