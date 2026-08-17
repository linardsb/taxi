import {
  snapshotFrom,
  type DispatchQueueStore,
  type QueueSnapshotEntry,
} from './dispatch-queue.store';

/**
 * TEST-ONLY mirror of `RedisDispatchQueueStore`.
 *
 * Never wire this into production: an in-memory queue forgets every driver's
 * earned position on restart, which is a fairness bug that would never surface
 * as an error. It exists so the queue-fairness contract runs on a machine with
 * no Redis — the difference between AC #2 being tested and AC #2 silently
 * skipping.
 */
export class InMemoryDispatchQueueStore implements DispatchQueueStore {
  private readonly queues = new Map<string, string[]>();
  /** Mirrors the Redis companion hash: zone → driverId → ISO instant. */
  private readonly joined = new Map<string, Map<string, string>>();

  private queue(geozoneId: string): string[] {
    let queue = this.queues.get(geozoneId);
    if (!queue) {
      queue = [];
      this.queues.set(geozoneId, queue);
    }
    return queue;
  }

  private joinedAt(geozoneId: string): Map<string, string> {
    let stamps = this.joined.get(geozoneId);
    if (!stamps) {
      stamps = new Map();
      this.joined.set(geozoneId, stamps);
    }
    return stamps;
  }

  joinBack(geozoneId: string, driverId: string): Promise<void> {
    const queue = this.queue(geozoneId);
    if (queue.includes(driverId)) return Promise.resolve();
    queue.push(driverId);
    // Mirrors `HSETNX`: never overwrite an existing stamp.
    const stamps = this.joinedAt(geozoneId);
    if (!stamps.has(driverId)) stamps.set(driverId, new Date().toISOString());
    return Promise.resolve();
  }

  sendToBack(geozoneId: string, driverId: string): Promise<void> {
    const queue = this.queue(geozoneId);
    // Every occurrence, mirroring `LREM key 0 member`.
    let index = queue.indexOf(driverId);
    while (index !== -1) {
      queue.splice(index, 1);
      index = queue.indexOf(driverId);
    }
    queue.push(driverId);
    // Mirrors `HSET`: the back of the queue is a fresh clock.
    this.joinedAt(geozoneId).set(driverId, new Date().toISOString());
    return Promise.resolve();
  }

  leave(geozoneId: string, driverId: string): Promise<void> {
    const queue = this.queue(geozoneId);
    let index = queue.indexOf(driverId);
    while (index !== -1) {
      queue.splice(index, 1);
      index = queue.indexOf(driverId);
    }
    this.joinedAt(geozoneId).delete(driverId);
    return Promise.resolve();
  }

  positions(
    geozoneId: string,
    driverIds: string[],
  ): Promise<Map<string, number>> {
    const positions = new Map<string, number>();
    if (driverIds.length === 0) return Promise.resolve(positions);

    const wanted = new Set(driverIds);
    this.queue(geozoneId).forEach((driverId, index) => {
      if (wanted.has(driverId) && !positions.has(driverId)) {
        positions.set(driverId, index + 1); // 1-based, like the Redis impl
      }
    });
    return Promise.resolve(positions);
  }

  snapshot(geozoneId: string): Promise<QueueSnapshotEntry[]> {
    const stamps = this.joinedAt(geozoneId);
    return Promise.resolve(
      snapshotFrom(this.queue(geozoneId), (id) => stamps.get(id) ?? null),
    );
  }
}
