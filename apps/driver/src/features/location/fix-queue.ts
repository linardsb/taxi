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
 * process kill loses no track data. `peek` is oldest-first, always.
 */
export interface FixQueue {
  enqueue(fixes: NewFix[]): Promise<void>;
  peek(limit: number): Promise<QueuedFix[]>;
  remove(ids: number[]): Promise<void>;
  count(): Promise<number>;
  clear(): Promise<void>;
  /** Drops the oldest rows beyond `keepNewest`. */
  prune(keepNewest: number): Promise<void>;
}

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
