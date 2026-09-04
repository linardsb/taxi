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

/**
 * The RIDER's caps (#16). Both routes widened to `'rider'` when the rider app
 * gained a dropoff field, and widening a paid route to a POPULATION without
 * resizing the cap would be a regression: the two above are sized for ONE HUMAN
 * AT A CONSOLE RUNNING A SHIFT, and a rider is one person booking one ride.
 *
 * `derived` from the same debounce model this file already carries (~5 requests
 * per address field at a 300 ms debounce — `expected`, unmeasured, plan Q5's
 * figure), and stated with what it assumes:
 * - A rider books one ride at a time. Pickup is GPS-defaulted or a saved place
 *   (typically 0 searches); the dropoff is typed → **~5 searches per attempt**.
 * - A rider who re-edits the dropoff twice inside the same minute is
 *   3 × 5 = **15 searches/min** — the honest worst case.
 * - **30 is 2× that**, and **4× tighter than the dispatcher's 120**, which is
 *   the whole point of a separate constant. A client with a broken debounce
 *   (~10 req/s ≈ 600/min) is cut at 30.
 *
 * Same "tune against the first Google bill" trigger as every other cap here.
 */
export const RIDER_ADDRESS_SEARCH_MAX_PER_WINDOW = 30;

/**
 * The rider's RESOLVE cap — deliberately generous rather than tight, for the
 * reason the dispatcher resolve cap above spells out at length: a resolve
 * TERMINATES the billed Places session, so refusing one converts a $5.00/1,000
 * completion into 5 × $2.83 = **$14.15/1,000** individual autocomplete requests.
 * Throttling a resolve costs money rather than saving it.
 *
 * `derived`: one resolve per completed field, so the same worst case above gives
 * **3 resolves/min**. **10 is ~3× that.**
 */
export const RIDER_ADDRESS_RESOLVE_MAX_PER_WINDOW = 10;

/**
 * SEPARATE key namespaces, not shared with the dispatcher keys above. One
 * person can hold both roles in a small operator, and a shared key would spend
 * a dispatcher's shift quota on their own rider searches — the same reason
 * `dispatcherBookingRateKey` exists as its own key.
 */
export const riderAddressSearchRateKey = (riderId: string): string =>
  `geo:search:rate:rider:${riderId}`;

export const riderAddressResolveRateKey = (riderId: string): string =>
  `geo:resolve:rate:rider:${riderId}`;
