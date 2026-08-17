import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { dispatchQueueJoinedKey, dispatchQueueKey } from '../dispatch.policy';
import {
  snapshotFrom,
  type DispatchQueueStore,
  type QueueSnapshotEntry,
} from './dispatch-queue.store';

/**
 * The production queue: one Redis LIST per geozone, head = position 1.
 *
 * `LREM key 0 member` throughout — count **0** removes EVERY occurrence. Count 1
 * would leave a duplicate holding a second position, so a driver who declines
 * twice would end up ahead of where they started.
 */
@Injectable()
export class RedisDispatchQueueStore
  implements DispatchQueueStore, OnModuleDestroy
{
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url);
  }

  /**
   * `LPOS` then `RPUSH` only if absent, so an already-queued driver keeps their
   * position.
   *
   * Race-tolerant rather than atomic, deliberately: two concurrent joins can
   * both miss and double-append, and the next `sendToBack`/`leave` corrects it
   * via `LREM … 0`. At pilot scale one process runs the sweep, so the window is
   * theoretical — and the cost of being wrong is one driver briefly holding two
   * slots, not a lost ride.
   */
  async joinBack(geozoneId: string, driverId: string): Promise<void> {
    const key = dispatchQueueKey(geozoneId);
    const existing = await this.redis.lpos(key, driverId);
    if (existing !== null) return;
    // ONE `MULTI`, unlike the `LPOS` above: a crash between the RPUSH and the
    // stamp would leave a live queue entry with no timestamp, and the early
    // return means no later `joinBack` would ever fill it — the driver would
    // read as having just arrived for as long as they held the place.
    //
    // HSETNX, not HSET: the double-append race described above can still land
    // two RPUSHes for one driver, and the second must not overwrite the
    // first's timestamp — the same first-occurrence-wins rule `positions()`
    // applies to the list.
    await this.redis
      .multi()
      .rpush(key, driverId)
      .hsetnx(
        dispatchQueueJoinedKey(geozoneId),
        driverId,
        new Date().toISOString(),
      )
      .exec();
  }

  async sendToBack(geozoneId: string, driverId: string): Promise<void> {
    const key = dispatchQueueKey(geozoneId);
    // Remove-then-append, so a driver who was not queued still lands at the
    // back rather than nowhere.
    //
    // HSET, not HSETNX: the timestamp is REWRITTEN here. Losing the time you
    // earned is what going to the back means.
    await this.redis
      .multi()
      .lrem(key, 0, driverId)
      .rpush(key, driverId)
      .hset(
        dispatchQueueJoinedKey(geozoneId),
        driverId,
        new Date().toISOString(),
      )
      .exec();
  }

  async leave(geozoneId: string, driverId: string): Promise<void> {
    await this.redis
      .multi()
      .lrem(dispatchQueueKey(geozoneId), 0, driverId)
      .hdel(dispatchQueueJoinedKey(geozoneId), driverId)
      .exec();
  }

  /**
   * One `LRANGE` and index in JS, rather than an `LPOS` per driver: a dispatch
   * round asks about every candidate at once, and N round trips on the tick loop
   * buys nothing over one.
   */
  async positions(
    geozoneId: string,
    driverIds: string[],
  ): Promise<Map<string, number>> {
    const positions = new Map<string, number>();
    if (driverIds.length === 0) return positions;

    const queue = await this.redis.lrange(dispatchQueueKey(geozoneId), 0, -1);
    const wanted = new Set(driverIds);

    queue.forEach((driverId, index) => {
      // First occurrence wins, so a transiently double-appended driver reports
      // their EARNED position rather than the later duplicate.
      if (wanted.has(driverId) && !positions.has(driverId)) {
        positions.set(driverId, index + 1); // Redis is 0-based; this port is 1-based
      }
    });

    return positions;
  }

  /**
   * One `LRANGE` + one `HGETALL`, both unbounded by design: a zone queue is
   * bounded by the fleet, and the board reads ≤6 zones per frame. Two round
   * trips per zone rather than one pipeline because the two keys are read
   * independently and a torn read costs at most one frame's timestamp.
   */
  async snapshot(geozoneId: string): Promise<QueueSnapshotEntry[]> {
    const [queue, joined] = await Promise.all([
      this.redis.lrange(dispatchQueueKey(geozoneId), 0, -1),
      this.redis.hgetall(dispatchQueueJoinedKey(geozoneId)),
    ]);
    return snapshotFrom(queue, (driverId) => joined[driverId] ?? null);
  }

  /** Mirrors `RedisDriverLocationStore`: never let a failed quit abort shutdown. */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
