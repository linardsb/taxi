import Redis from 'ioredis';
import { RedisKeyValueStore } from './redis-kv.store';

/**
 * Skipped unless a Redis is reachable — :6379 and :6380 are taken by other
 * projects on the primary dev machine, so the default gate must never depend
 * on this. Run it deliberately:
 *   REDIS_PORT=6381 docker compose up -d --wait redis
 *   REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run test --filter @taxi/api
 */
const REDIS_TEST_URL = process.env.REDIS_TEST_URL;
const describeWithRedis = REDIS_TEST_URL ? describe : describe.skip;

describeWithRedis('RedisKeyValueStore.incrWithTtl', () => {
  // Per-pid: jest workers share the one Redis and these keys are not namespaced.
  const key = `test:kv:incr:${process.pid}`;
  let store: RedisKeyValueStore;
  let raw: Redis;

  beforeAll(() => {
    store = new RedisKeyValueStore(REDIS_TEST_URL!);
    raw = new Redis(REDIS_TEST_URL!);
  });
  beforeEach(() => store.del(key));
  afterAll(async () => {
    await store.del(key);
    await store.onModuleDestroy();
    raw.disconnect();
  });

  it('starts the window with the first increment (expected)', async () => {
    expect(await store.incrWithTtl(key, 60)).toBe(1);
    expect(await store.ttl(key)).toBeGreaterThan(0);
  });

  it('never extends the window on later increments (edge)', async () => {
    await store.incrWithTtl(key, 60);
    const first = await store.ttl(key);

    // A longer ttl on a later call must still be ignored — otherwise a burst
    // keeps pushing the window out and the rate limit never closes.
    expect(await store.incrWithTtl(key, 3600)).toBe(2);
    expect(await store.ttl(key)).toBeLessThanOrEqual(first);
  });

  it('gives an expiry back to a counter that lost one (failure)', async () => {
    // What a crash between INCR and EXPIRE leaves behind: a live counter with
    // no expiry. Unhealed it stays above the cap forever, and the phone it
    // belongs to can never request another code without a manual DEL.
    await raw.set(key, '3');
    expect(await raw.ttl(key)).toBe(-1);

    expect(await store.incrWithTtl(key, 60)).toBe(4);
    expect(await store.ttl(key)).toBeGreaterThan(0);
  });
});

describeWithRedis('RedisKeyValueStore.setIfAbsent', () => {
  // Per-pid, like the counter suite above: jest workers share the one Redis
  // and it is never flushed between runs.
  const key = `test:kv:setnx:${process.pid}`;
  let store: RedisKeyValueStore;

  beforeAll(() => {
    store = new RedisKeyValueStore(REDIS_TEST_URL!);
  });
  beforeEach(() => store.del(key));
  afterAll(async () => {
    await store.del(key);
    await store.onModuleDestroy();
  });

  it('reserves once and refuses to overwrite (expected)', async () => {
    expect(await store.setIfAbsent(key, 'first', 60)).toBe(true);

    // The declined call must change NOTHING. An implementation that returned
    // false while still writing would hand the second caller's ride id to the
    // first caller's key — the double-book with extra steps.
    expect(await store.setIfAbsent(key, 'second', 60)).toBe(false);
    expect(await store.get(key)).toBe('first');

    // Proves `EX` applied: without it the reservation never expires and the
    // rider's key is burned for good.
    expect(await store.ttl(key)).toBeGreaterThan(0);
  });

  it('reserves again once the key has expired (edge)', async () => {
    // A 1s window is the only way to observe expiry against a real server —
    // the in-memory fake fast-forwards, Redis does not.
    expect(await store.setIfAbsent(key, 'first', 1)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(await store.setIfAbsent(key, 'second', 60)).toBe(true);
    expect(await store.get(key)).toBe('second');
  });
});
