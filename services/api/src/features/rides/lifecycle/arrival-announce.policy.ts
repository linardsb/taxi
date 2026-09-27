/**
 * The arrival-announce protocol's limits (#259): pure constants and key
 * builders, no I/O.
 *
 * WINDOW, `derived`: one accepted request per fixed window per ride.
 * `incrWithTtl` sets the expiry only on the first INCR
 * (`redis-kv.store.ts`), so the next accepted request is at least 20 s after
 * the last one — worst case 3 interruptions a minute per ride (60 ÷ 20). The
 * 20 s itself is `expected`: a guess at the time a driver needs to get out of
 * the car and walk round it.
 */
export const ARRIVAL_ANNOUNCE_WINDOW_SECONDS = 20;

/**
 * REPLAY, `expected`: how stale a request the driver read may replay. A kerbside
 * search longer than 10 min is a dispatcher problem, not a notice, and the
 * replay is shown only at `arrived` anyway.
 */
export const ARRIVAL_ANNOUNCE_REPLAY_SECONDS = 600;

export const arrivalAnnounceRateKey = (rideId: string) =>
  `rides:announce:rate:${rideId}`;

/** The last accepted request's `at`, read back by the driver's ride read. */
export const arrivalAnnounceLastKey = (rideId: string) =>
  `rides:announce:last:${rideId}`;
