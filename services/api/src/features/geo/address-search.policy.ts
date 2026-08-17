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
