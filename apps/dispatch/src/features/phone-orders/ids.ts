/**
 * The two uuids the booking form mints client-side: the draft's
 * `Idempotency-Key` and each address field's Places session token. Both are
 * uuids by contract — the api validates the session token with
 * `z.string().uuid()` before it reaches a provider URL.
 *
 * The fallback exists for one reason: `crypto.randomUUID` is absent in
 * jsdom (and in any browser served over plain HTTP, since it lives behind a
 * secure context), and a form that throws on open in the test environment is a
 * form nobody can test. It is NOT cryptographically strong and does not need to
 * be — neither value is a secret: the idempotency key is scoped to the caller's
 * own rider id server-side, and a session token only groups a dispatcher's own
 * keystrokes into one bill.
 */
export function newUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
