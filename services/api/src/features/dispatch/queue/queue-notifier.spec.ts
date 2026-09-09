import { Logger } from '@nestjs/common';
import { driverQueueEventSchema } from '@taxi/shared';
import type { GeozonesService, ResolvedGeozone } from '../../geozones';
import type { RealtimeService } from '../../realtime';
import { InMemoryDispatchQueueStore } from './in-memory-dispatch-queue.store';
import { QueueNotifier } from './queue-notifier';

const ZONE = '00000000-0000-4000-8000-000000000102'; // RIX
const id = (n: number) => `d0000000-0000-4000-8000-00000000000${n}`;

const rix: ResolvedGeozone = {
  id: ZONE,
  slug: 'rix',
  name: 'Lidosta RIX',
  queueModeEnabled: true,
};

function build(
  over: { zone?: ResolvedGeozone; emitToDriver?: jest.Mock } = {},
) {
  const queue = new InMemoryDispatchQueueStore();
  const emitToDriver = over.emitToDriver ?? jest.fn();
  const notifier = new QueueNotifier(
    queue,
    {
      findById: () => Promise.resolve('zone' in over ? over.zone : rix),
    } as unknown as GeozonesService,
    { emitToDriver } as unknown as RealtimeService,
  );
  return { notifier, queue, emitToDriver };
}

describe('QueueNotifier.broadcast (#15)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('tells every queued driver their 1-based rank and the zone size (expected)', async () => {
    const { notifier, queue, emitToDriver } = build();
    for (const n of [1, 2, 3]) await queue.joinBack(ZONE, id(n));

    await notifier.broadcast(ZONE);

    expect(emitToDriver).toHaveBeenCalledTimes(3);
    const calls = emitToDriver.mock.calls as [string, string, unknown][];
    calls.forEach(([driverId, event, payload], index) => {
      expect(event).toBe('driver:queue');
      expect(driverId).toBe(id(index + 1));
      // Parses under the shared schema — the api's emit path would have
      // thrown otherwise, and the app parses the same schema on receipt.
      const parsed = driverQueueEventSchema.parse(payload);
      expect(parsed).toMatchObject({
        driverId: id(index + 1),
        geozoneId: ZONE,
        geozoneSlug: 'rix',
        position: index + 1,
        size: 3,
      });
    });
  });

  /**
   * F6: `size` was `entries.length`, which counts DEDUPLICATED entries, while
   * `position` is the raw list index — `snapshotFrom` skips a repeat driver but
   * keeps `index + 1` for everyone behind them, on purpose, so the app and
   * Dina's grid agree. On the double-append `joinBack` tolerates, ['A','A','B']
   * yields positions 1 and 3 from a list of length 2 and B was told «3 of 2».
   * `driverQueueEventSchema` permits it, so nothing else rejects it.
   */
  it('size never contradicts the largest position when the queue held a duplicate (edge)', async () => {
    const { notifier, queue, emitToDriver } = build();
    // What `snapshotFrom(['A','A','B'])` returns: two entries, positions 1 and 3.
    jest.spyOn(queue, 'snapshot').mockResolvedValue([
      { driverId: id(1), position: 1, joinedAt: null },
      { driverId: id(2), position: 3, joinedAt: null },
    ]);

    await notifier.broadcast(ZONE);

    const payloads = (
      emitToDriver.mock.calls as [string, string, unknown][]
    ).map(([, , payload]) => driverQueueEventSchema.parse(payload));
    expect(payloads).toHaveLength(2);
    for (const p of payloads) {
      expect(p.size).toBe(3);
      expect(p.position).toBeLessThanOrEqual(p.size);
    }
  });

  it('emits nothing for an empty queue (edge)', async () => {
    const { notifier, emitToDriver } = build();
    await notifier.broadcast(ZONE);
    expect(emitToDriver).not.toHaveBeenCalled();
  });

  it('warns and emits nothing for a zone the catalog does not know (edge)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { notifier, queue, emitToDriver } = build({ zone: undefined });
    await queue.joinBack(ZONE, id(1));

    await notifier.broadcast(ZONE);

    expect(emitToDriver).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'dispatch.queue.notify_failed',
        reason: 'unknown_zone',
      }),
    );
  });

  it('never throws when the emit does — a lost rank is a stale number, not a fairness bug (failure)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { notifier, queue } = build({
      emitToDriver: jest.fn(() => {
        throw new Error('adapter down');
      }),
    });
    await queue.joinBack(ZONE, id(1));

    await expect(notifier.broadcast(ZONE)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'dispatch.queue.notify_failed',
        reason: 'adapter down',
      }),
    );
  });
});
