import type { DispatchBoardEvent } from '@taxi/shared';
import type { ResolvedGeozone } from '../../geozones';
import type { QueueSnapshotEntry } from '../queue/dispatch-queue.store';

type BoardZone = DispatchBoardEvent['zones'][number];

/** What the projection needs to name a queued driver. Any wider row also fits. */
export interface ZoneRowContact {
  driverId: string;
  name: string | null;
  phone: string;
  status: BoardZone['entries'][number]['status'];
}

export interface BuildZoneRowsInput {
  /** The city catalog — EVERY zone, already ordered. */
  catalog: readonly ResolvedGeozone[];
  /** Queue snapshot per zone id, as `DispatchQueueStore.snapshot()` returned it. */
  snapshots: ReadonlyMap<string, readonly QueueSnapshotEntry[]>;
  contacts: ReadonlyMap<string, ZoneRowContact>;
  /** The frame's clock, passed in — this module never reads one. */
  nowMs: number;
}

/**
 * The zone grid's rows: the city's zone catalog joined to each zone's queue.
 *
 * PURE, and time is an argument — the same rule `board-state.ts` runs on in the
 * console. Every fairness question this answers ("who is ahead of whom, and for
 * how long") is then testable without a Redis, a clock or a database.
 *
 * What it deliberately does NOT do: re-rank. Positions come from the store
 * verbatim, because the driver's own app reads the same numbers and a grid that
 * renumbered them would have Dina arbitrating a queue nobody else can see.
 */
export function buildZoneRows(input: BuildZoneRowsInput): BoardZone[] {
  return input.catalog.map((zone) => ({
    geozoneId: zone.id,
    slug: zone.slug,
    name: zone.name,
    queueModeEnabled: zone.queueModeEnabled,
    entries: (input.snapshots.get(zone.id) ?? []).flatMap((entry) => {
      const contact = input.contacts.get(entry.driverId);
      // A queued id with no drivers/users row would be an FK impossibility —
      // dropped rather than rendered as a ghost, same as the frame's driver
      // list does with the online set.
      if (!contact) return [];
      return [
        {
          driverId: entry.driverId,
          // The wire promises a non-null name; the phone is the one identifier
          // every driver has and the one Dina dials anyway.
          name: contact.name ?? contact.phone,
          phone: contact.phone,
          position: entry.position,
          secondsInZone: secondsSince(entry.joinedAt, input.nowMs),
          status: contact.status,
        },
      ];
    }),
  }));
}

/**
 * Whole seconds a driver has held their place.
 *
 * Zero for an unknown join instant (`joinedAt: null` — see
 * `QueueSnapshotEntry`) AND for a timestamp in the future, which a clock skew
 * between the api and Redis can produce. Both render as "just arrived": the
 * wire schema is `nonnegative`, and under-claiming tenure is the safe
 * direction — a driver briefly credited with less waiting than they earned is
 * corrected by the next frame, a negative number is a parse failure that takes
 * the whole board down.
 */
function secondsSince(joinedAt: string | null, nowMs: number): number {
  if (joinedAt === null) return 0;
  const joinedMs = Date.parse(joinedAt);
  if (Number.isNaN(joinedMs)) return 0;
  return Math.max(0, Math.floor((nowMs - joinedMs) / 1000));
}
