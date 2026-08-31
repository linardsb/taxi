import type { NewFix } from './fix-queue';

/**
 * The wire cadence (`apps/driver/CLAUDE.md` battery discipline): never two
 * fixes closer than this, whatever the OS delivers. Time-based, not
 * movement-based (issue comment 2026-08-04) — D7 makes a parked driver's
 * steady stream the heartbeat dark detection reads.
 */
export const MIN_FIX_INTERVAL_MS = 4_000;

/** The slice of `expo-location`'s LocationObject this reads — structural, so tests need no native types. */
export interface RawFix {
  timestamp: number;
  coords: {
    latitude: number;
    longitude: number;
    heading?: number | null;
  };
}

/** iOS reports -1 for "unknown"; the ping schema wants [0, 360). */
export function normaliseHeading(
  heading: number | null | undefined,
): number | null {
  if (heading === null || heading === undefined) return null;
  if (!Number.isFinite(heading) || heading < 0) return null;
  return ((heading % 360) + 360) % 360;
}

/**
 * Keeps the fixes that are ≥ MIN_FIX_INTERVAL_MS after the last kept one,
 * oldest first, and drops anything unusable. `lastTs` threads across calls
 * (the task is invoked per batch), so a replayed batch older than what was
 * already enqueued yields nothing.
 */
export function selectFixes(
  incoming: readonly RawFix[],
  lastTs: number | null,
): { fixes: NewFix[]; lastTs: number | null } {
  const sorted = [...incoming].sort((a, b) => a.timestamp - b.timestamp);
  const fixes: NewFix[] = [];
  let last = lastTs;
  for (const raw of sorted) {
    const { latitude: lat, longitude: lng } = raw.coords;
    if (
      !Number.isFinite(raw.timestamp) ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      continue;
    }
    if (last !== null && raw.timestamp - last < MIN_FIX_INTERVAL_MS) continue;
    fixes.push({
      at: new Date(raw.timestamp).toISOString(),
      lat,
      lng,
      heading: normaliseHeading(raw.coords.heading),
    });
    last = raw.timestamp;
  }
  return { fixes, lastTs: last };
}
