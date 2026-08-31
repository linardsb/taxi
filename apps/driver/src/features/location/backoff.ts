export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 30_000;
/** ±20 % — enough to keep a fleet coming out of the same tunnel from retrying in lockstep. */
export const BACKOFF_JITTER = 0.2;

/**
 * `min(1 s × 2^attempt, 30 s)` with jitter. The exponent is clamped so a
 * long outage cannot overflow the multiplication; the cap matches
 * Socket.IO's own `reconnectionDelayMax` so the two retries pace alike.
 */
export function nextBackoffMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.min(Math.max(0, Math.floor(attempt)), 30);
  const base = Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_CAP_MS);
  const jitter = (random() * 2 - 1) * BACKOFF_JITTER;
  return Math.round(base * (1 + jitter));
}
