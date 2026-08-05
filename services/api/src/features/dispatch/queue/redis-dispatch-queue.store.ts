import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { dispatchQueueKey } from '../dispatch.policy';
import type { DispatchQueueStore } from './dispatch-queue.store';

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
    await this.redis.rpush(key, driverId);
  }

  async sendToBack(geozoneId: string, driverId: string): Promise<void> {
    const key = dispatchQueueKey(geozoneId);
    // Remove-then-append, so a driver who was not queued still lands at the
    // back rather than nowhere.
    await this.redis.multi().lrem(key, 0, driverId).rpush(key, driverId).exec();
  }

  async leave(geozoneId: string, driverId: string): Promise<void> {
    await this.redis.lrem(dispatchQueueKey(geozoneId), 0, driverId);
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

  /** Mirrors `RedisDriverLocationStore`: never let a failed quit abort shutdown. */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
