/** The connection pill: read from RECEIPT (the last ack), never socket flags. */
import type { PresenceState } from './presence-state';

export type Connection = 'live' | 'reconnecting' | 'offline';

/** An ack younger than this reads «Tiešraide». */
export const LIVE_WINDOW_MS = 10_000;
/** …older than this reads «Nav savienojuma» — the dispatch freshness window. */
export const RECONNECTING_WINDOW_MS = 60_000;

/**
 * The connection pill, from RECEIPT (the last ack) — never socket flags
 * (the board's rule). `null` while offline: there is nothing to be
 * truthful about. No ack yet reads as reconnecting: we are waiting.
 */
export function pillFrom(
  state: PresenceState,
  nowMs: number,
): Connection | null {
  if (state.intent !== 'online') return null;
  if (state.lastAckAt === null) return 'reconnecting';
  const age = nowMs - state.lastAckAt;
  if (age <= LIVE_WINDOW_MS) return 'live';
  if (age <= RECONNECTING_WINDOW_MS) return 'reconnecting';
  return 'offline';
}
