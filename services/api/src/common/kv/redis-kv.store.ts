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

  async setIfAbsent(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    // One round trip, atomic in the server: SET NX EX either creates the key
    // with its expiry or does nothing at all. No Lua needed — unlike
    // INCR_WITH_TTL, there is no window here for a crash to leave a key
    // without a TTL.
    //
    // ioredis resolves to `null`, not `false`, when NX declines.
    const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /**
   * Counter and expiry in one atomic step. Two hazards make this a script
   * rather than INCR-then-EXPIRE: a crash between the two commands leaves a
   * counter that never expires — it climbs past every cap forever and only a
   * manual DEL recovers it — while refreshing the TTL on every call would let a
   * burst keep pushing the window out so the limit never closes.
   *
   * `TTL < 0` is both cases at once: -1 is the counter this call just created,
   * and also the one some earlier crash left without an expiry, so a stuck key
   * heals itself on the next increment.
   */
  private static readonly INCR_WITH_TTL = `
    local n = redis.call('INCR', KEYS[1])
    if redis.call('TTL', KEYS[1]) < 0 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    return n
  `;

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    return Number(
      await this.redis.eval(
        RedisKeyValueStore.INCR_WITH_TTL,
        1,
        key,
        ttlSeconds,
      ),
    );
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
