import type { DriverLocationPing } from '@taxi/shared';

/** One GPS fix as the throttle hands it to the queue. `heading` is null when the OS did not know. */
export interface NewFix {
  at: string;
  lat: number;
  lng: number;
  heading: number | null;
}

export interface QueuedFix extends NewFix {
  id: number;
}

/**
 * The durable queue port. Every fix is written here BEFORE it is sent and
 * deleted ONLY on the server's `accepted: true` — a tunnel, an LTE gap or a
 * process kill loses no track data younger than `MAX_REPLAY_AGE_MS`. The
 * queue carries no owner (the JWT is the identity), so sign-out clears it: a
 * phone handed to another driver must not replay the first driver's track
 * under the second's token. `peek` is oldest-first, always.
 */
export interface FixQueue {
  enqueue(fixes: NewFix[]): Promise<void>;
  peek(limit: number): Promise<QueuedFix[]>;
  remove(ids: number[]): Promise<void>;
  count(): Promise<number>;
  clear(): Promise<void>;
  /** Drops the oldest rows beyond `keepNewest`. */
  prune(keepNewest: number): Promise<void>;
  /** Drops rows whose `at` is before `before` (ISO, UTC — `toISOString()` output sorts as text). */
  dropOlderThan(before: string): Promise<void>;
}

/**
 * How old a queued fix may be and still be replayed when the driver goes
 * online (or the app cold-launches with the task alive). The server stamps
 * `at` itself, so a replayed row reads as the CURRENT position: a shift-end
 * or overnight backlog would walk the board along yesterday's track and let
 * dispatch offer on it. 5 min keeps a D14 kill-and-retap track (seconds to a
 * couple of minutes) and drops a garage backlog (hours). In-shift replay after
 * a dead zone (D6) is untouched — no go-online happens there. The phone's
 * clock is consistent with its own fixes, which is why the purge lives here
 * and not on a server that distrusts client clocks.
 */
export const MAX_REPLAY_AGE_MS = 5 * 60_000;

/**
 * Ceiling on the queue. `derived`: 1 fix / 4 s × 12 h = 10 800 fixes per
 * shift, ~60 B each ≈ 650 KB; 20 000 is a ~22 h ceiling on a phone that
 * never reconnected — past that, the oldest go.
 */
export const MAX_QUEUED_FIXES = 20_000;

/** The wire ping — no `driverId` (the JWT is the identity), `at` is the fix's own clock. */
export function toPing(fix: NewFix): DriverLocationPing {
  return {
    location: { lat: fix.lat, lng: fix.lng },
    at: fix.at,
    ...(fix.heading === null ? {} : { heading: fix.heading }),
  };
}
