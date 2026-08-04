import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { KeyValueStore } from './kv.store';

@Injectable()
export class RedisKeyValueStore implements KeyValueStore, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url);
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async setWithTtl(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /**
   * Only the FIRST incr sets the expiry. Refreshing it on every call would let
   * a burst keep pushing the window out and the rate limit would never close.
   */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, ttlSeconds);
    return n;
  }

  /** ioredis returns -2 (no key) / -1 (no expiry); both mean "nothing left". */
  async ttl(key: string): Promise<number> {
    return Math.max(0, await this.redis.ttl(key));
  }

  /**
   * `quit()` is the graceful close, but it rejects when Redis is unreachable
   * (restart, network blip). Letting that escape would abort the rest of the
   * shutdown hooks — including the pg pool's — so force the socket down instead.
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
