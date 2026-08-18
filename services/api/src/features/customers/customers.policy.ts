/**
 * Caller-lookup policy (#19) — the same shape as `address-search.policy.ts`,
 * for a different reason: this route spends no money, it discloses PII.
 *
 * `GET /customers/lookup` turns a phone number into a person, their saved
 * addresses and their last three trips. Role-guarding it stops a driver reading
 * it; nothing stopped a dispatcher token WALKING it. Without a cap, one leaked
 * console session enumerates the Latvian mobile range (+371 2xxxxxxx, 10^7
 * numbers) into an identity-and-address oracle, and the access log — even with
 * the subject now on it — records that as ordinary work at machine speed.
 *
 * The number, `derived` and stated with its assumption: a dispatcher looks up
 * ONE caller per call, and `address-search.policy.ts` already models her at ~3
 * bookings/minute. 60/minute is 20× that — she cannot meet it by hand, while a
 * script walking the range is cut to 60 numbers per minute instead of
 * thousands. It bounds the rate, not the total; the real fix for a stolen token
 * is revocation, which is the auth slice's.
 */
export const CUSTOMER_LOOKUP_MAX_PER_WINDOW = 60;
export const CUSTOMER_LOOKUP_WINDOW_SECONDS = 60;

export const customerLookupRateKey = (dispatcherId: string): string =>
  `customers:lookup:rate:${dispatcherId}`;
