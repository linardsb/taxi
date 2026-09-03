import { randomUUID } from 'expo-crypto';

/**
 * The two uuids this app mints client-side: a booking attempt's
 * `Idempotency-Key` and each address field's Places session token.
 *
 * BOTH ARE UUIDS BY CONTRACT, not by habit — `idempotencyKeySchema` and
 * `addressSearchQuerySchema.session` are each `z.string().uuid()`, and the api
 * 400s anything else. The session token in particular is interpolated into the
 * provider's URL, so a free-form string there is a request-forgery surface on a
 * route that spends money.
 *
 * `expo-crypto` rather than a bare `crypto.randomUUID()`: Hermes does not ship
 * a WebCrypto global, and the dispatch console's `newUuid` fallback exists for
 * jsdom, not for a phone. Never hand-roll one — a v4 that fails the schema is a
 * booking the api refuses.
 */
export function newUuid(): string {
  return randomUUID();
}
