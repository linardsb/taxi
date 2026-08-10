import { describe, expect, it } from 'vitest';
import {
  geozoneQueueSchema,
  geozoneSchema,
  queueEntrySchema,
} from '../src/schemas/geo';

const riga = { lat: 56.9496, lng: 24.1052 };
const uuid = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
const otherUuid = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';

describe('geozoneSchema', () => {
  const triangle = [
    riga,
    { lat: 56.95, lng: 24.11 },
    { lat: 56.96, lng: 24.12 },
  ];

  it('parses a pilot district with its slug (expected)', () => {
    const parsed = geozoneSchema.parse({
      id: uuid,
      cityId: otherUuid,
      slug: 'centre',
      name: 'Centrs',
      polygon: triangle,
    });
    expect(parsed.slug).toBe('centre');
    expect(parsed.queueModeEnabled).toBe(false);
  });

  it('parses a queue-mode zone with a two-driver queue (edge)', () => {
    const zone = geozoneSchema.parse({
      id: uuid,
      cityId: otherUuid,
      slug: 'rix',
      name: 'Lidosta RIX',
      polygon: triangle,
      queueModeEnabled: true,
    });
    expect(zone.queueModeEnabled).toBe(true);

    const queue = geozoneQueueSchema.parse({
      geozoneId: uuid,
      updatedAt: '2026-08-03T10:00:00.000Z',
      entries: [
        {
          driverId: uuid,
          geozoneId: uuid,
          position: 1,
          joinedAt: '2026-08-03T09:40:00.000Z',
        },
        {
          driverId: otherUuid,
          geozoneId: uuid,
          position: 2,
          joinedAt: '2026-08-03T09:50:00.000Z',
        },
      ],
    });
    expect(queue.entries).toHaveLength(2);
    expect(queue.entries[0]!.position).toBe(1);
  });

  it('rejects a polygon with fewer than 3 vertices (failure)', () => {
    const result = geozoneSchema.safeParse({
      id: '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
      cityId: '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
      name: 'Centrs',
      polygon: [riga, { lat: 56.95, lng: 24.11 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a queue position of 0 — positions are 1-based (failure)', () => {
    const result = queueEntrySchema.safeParse({
      driverId: uuid,
      geozoneId: uuid,
      position: 0,
      joinedAt: '2026-08-03T09:40:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});
