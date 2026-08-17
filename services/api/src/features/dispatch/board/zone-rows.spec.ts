import type { ResolvedGeozone } from '../../geozones';
import type { QueueSnapshotEntry } from '../queue/dispatch-queue.store';
import { buildZoneRows, type ZoneRowContact } from './zone-rows';

const ZONE_A = 'e0000000-0000-4000-8000-000000000001';
const ZONE_B = 'e0000000-0000-4000-8000-000000000002';
const DRIVER_A = 'd0000000-0000-4000-8000-000000000001';
const DRIVER_B = 'd0000000-0000-4000-8000-000000000002';
const NOW_MS = Date.parse('2026-08-15T12:00:00.000Z');

const zone = (over: Partial<ResolvedGeozone> = {}): ResolvedGeozone => ({
  id: ZONE_A,
  slug: 'centrs',
  name: 'Centrs',
  queueModeEnabled: true,
  ...over,
});

const contact = (over: Partial<ZoneRowContact> = {}): ZoneRowContact => ({
  driverId: DRIVER_A,
  name: 'Jānis Ozols',
  phone: '+37129999001',
  status: 'online',
  ...over,
});

const entry = (over: Partial<QueueSnapshotEntry> = {}): QueueSnapshotEntry => ({
  driverId: DRIVER_A,
  position: 1,
  joinedAt: new Date(NOW_MS - 2_820_000).toISOString(), // 47 min
  ...over,
});

const build = (over: {
  catalog?: ResolvedGeozone[];
  snapshots?: Array<[string, QueueSnapshotEntry[]]>;
  contacts?: ZoneRowContact[];
  nowMs?: number;
}) =>
  buildZoneRows({
    catalog: over.catalog ?? [zone()],
    snapshots: new Map(over.snapshots ?? []),
    contacts: new Map(
      (over.contacts ?? [contact()]).map((c) => [c.driverId, c]),
    ),
    nowMs: over.nowMs ?? NOW_MS,
  });

describe('buildZoneRows', () => {
  it('joins the catalog to each zone’s queue, head first (expected)', () => {
    const rows = build({
      snapshots: [
        [ZONE_A, [entry(), entry({ driverId: DRIVER_B, position: 2 })]],
      ],
      contacts: [
        contact(),
        contact({ driverId: DRIVER_B, name: 'Anna Bērziņa' }),
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.entries.map((e) => [e.name, e.position])).toEqual([
      ['Jānis Ozols', 1],
      ['Anna Bērziņa', 2],
    ]);
    expect(rows[0]!.entries[0]!.secondsInZone).toBe(2_820);
  });

  it('emits every configured zone, occupied or not (expected)', () => {
    const rows = build({
      catalog: [zone(), zone({ id: ZONE_B, slug: 'lidosta', name: 'Lidosta' })],
      snapshots: [[ZONE_A, [entry()]]],
    });

    expect(rows.map((r) => r.slug)).toEqual(['centrs', 'lidosta']);
    expect(rows[1]!.entries).toEqual([]);
  });

  it('keeps the store’s positions verbatim, gap and all (edge)', () => {
    // A transient double-append leaves the drivers behind it at index+1. The
    // grid must show what the DRIVER's app shows, not a tidied-up sequence —
    // a renumbered rank is one Dina cannot defend to the driver reading it.
    const rows = build({
      snapshots: [
        [
          ZONE_A,
          [entry({ position: 1 }), entry({ driverId: DRIVER_B, position: 3 })],
        ],
      ],
      contacts: [contact(), contact({ driverId: DRIVER_B })],
    });

    expect(rows[0]!.entries.map((e) => e.position)).toEqual([1, 3]);
  });

  it('reads an unknown join instant as zero seconds, not as a crash (edge)', () => {
    const rows = build({ snapshots: [[ZONE_A, [entry({ joinedAt: null })]]] });

    expect(rows[0]!.entries[0]!.secondsInZone).toBe(0);
  });

  it('clamps a future join instant to zero rather than going negative (edge)', () => {
    // Clock skew between the api and Redis. The wire schema is `nonnegative`,
    // so a negative here would fail the parse and take the whole frame down.
    const rows = build({
      snapshots: [
        [
          ZONE_A,
          [entry({ joinedAt: new Date(NOW_MS + 60_000).toISOString() })],
        ],
      ],
    });

    expect(rows[0]!.entries[0]!.secondsInZone).toBe(0);
  });

  it('falls back name→phone, because the wire promises a name (edge)', () => {
    const rows = build({
      snapshots: [[ZONE_A, [entry()]]],
      contacts: [contact({ name: null })],
    });

    expect(rows[0]!.entries[0]!.name).toBe('+37129999001');
  });

  it('drops a queued id with no driver row instead of rendering a ghost (failure)', () => {
    const rows = build({
      snapshots: [[ZONE_A, [entry({ driverId: DRIVER_B })]]],
      contacts: [contact()], // DRIVER_B has no row
    });

    expect(rows[0]!.entries).toEqual([]);
  });
});
