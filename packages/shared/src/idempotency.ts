import { z } from 'zod';

/**
 * Lowercase by construction. Express normalises every inbound header name to
 * lowercase before `@Headers()` reads it, and HTTP/2 forbids any other case on
 * the wire — so this one spelling is correct for both sending and receiving.
 *
 * Clients: mint a NEW key per booking ATTEMPT, not per session and not per
 * screen. Reusing a key after the rider edits the pickup returns the ride the
 * OLD body created; the key is the whole contract, and the server does not
 * re-read the body to second-guess it.
 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * A uuid, not an opaque string. Entropy is the point: a client that sent a
 * constant — `"book"`, or a screen name — would collapse every booking that
 * rider ever makes into their first ride. `randomUUID()` on the client makes
 * the safe thing the easy thing, and the schema makes the unsafe thing a 400.
 */
export const idempotencyKeySchema = z.string().uuid();
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
