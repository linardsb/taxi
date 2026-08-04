export const KV_STORE = 'KV_STORE';

/**
 * The narrow slice of Redis this service actually uses. A port, not an
 * abstraction layer: it exists so tests run without a Redis server and so the
 * OTP store's contract is five methods instead of all of ioredis. There is
 * exactly one production implementation and nothing here is pluggable.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** INCR then EXPIRE only on first write; returns the new counter value. */
  incrWithTtl(key: string, ttlSeconds: number): Promise<number>;
  /** Remaining TTL in whole seconds, or 0 when the key is gone. */
  ttl(key: string): Promise<number>;
}
