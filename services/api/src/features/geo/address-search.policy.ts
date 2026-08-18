/**
 * Address-search policy — the same shape as `rides.policy.ts`, and for the same
 * reason: this route spends money on every call that reaches the provider, and
 * a cap in code is the only thing that bounds a hostile or broken client.
 *
 * Keyed on the DISPATCHER, not the rider: there is no rider yet when Dina is
 * typing an address, and one human at one keyboard is the natural unit.
 *
 * The numbers, `derived` and stated with their assumptions:
 * - A booked address field emits ~5 requests at a 300 ms debounce (`expected` —
 *   plan Q5's figure, unmeasured until the first real month).
 * - A busy minute for one dispatcher is ~3 bookings × 2 fields = ~30 requests.
 * - 120/min is 4× that, so an honest dispatcher never meets it, while a client
 *   loop with a broken debounce (~10 req/s ≈ 600/min) is cut at 120.
 *
 * Tune against the first Google bill — the same trigger `COORD_PRECISION` and
 * `RIDE_REQUEST_MAX_PER_WINDOW` carry.
 */
export const ADDRESS_SEARCH_MAX_PER_WINDOW = 120;
export const ADDRESS_SEARCH_WINDOW_SECONDS = 60;

export const addressSearchRateKey = (dispatcherId: string): string =>
  `geo:search:rate:${dispatcherId}`;

/**
 * The RESOLVE's own cap and key (#19).
 *
 * Sharing the search's key made the cap refuse the one call that saves money.
 * A resolve TERMINATES a Places session: the searches that preceded it bill as
 * one session plus $5.00/1,000, and without it those same N requests bill
 * individually at $2.83/1,000 each. Because the resolve always arrives last, it
 * was by construction the call at the cap — and `address-field.tsx` rotates the
 * session token in its `.catch`, so a 429 there permanently abandons the
 * session it was about to close. At the plan's expected 5 requests per field
 * that turns a $5.00/1,000 completion into 5 × $2.83 = $14.15/1,000.
 *
 * `derived`, on the same model as the search cap: one resolve per completed
 * address field, 2 fields per booking, ~3 bookings/minute = ~6/minute. 30 is 5×
 * that — an honest dispatcher never meets it, while a client looping resolves
 * is still cut well before the search cap would have caught it.
 */
export const ADDRESS_RESOLVE_MAX_PER_WINDOW = 30;

export const addressResolveRateKey = (dispatcherId: string): string =>
  `geo:resolve:rate:${dispatcherId}`;
