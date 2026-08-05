import {
  CONTRACT_QUEUE_DRIVER_IDS,
  runDispatchQueueStoreContract,
} from '../../../../test/dispatch-queue-store.contract';
import { RedisDispatchQueueStore } from './redis-dispatch-queue.store';

/**
 * Skipped unless a Redis is reachable — :6379 and :6380 are taken by other
 * projects on the primary dev machine, so the default gate must never depend on
 * this. Run it deliberately:
 *   REDIS_PORT=6381 docker compose up -d --wait redis
 *   REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run test --filter @taxi/api
 *
 * This is the only place real LPOS/RPUSH/LREM/LRANGE run, and the only thing
 * that can catch the fake claiming list semantics Redis does not have. The
 * contract still runs without it, against the fake — see
 * dispatch-queue.store.spec.ts.
 */
const REDIS_TEST_URL = process.env.REDIS_TEST_URL;
const describeWithRedis = REDIS_TEST_URL ? describe : describe.skip;

describeWithRedis('RedisDispatchQueueStore', () => {
  // Per-pid: jest workers share the one Redis and these keys are not namespaced.
  const geozoneId = `test-zone-${process.pid}`;
  let store: RedisDispatchQueueStore | undefined;

  const clear = async (s: RedisDispatchQueueStore) => {
    for (const id of CONTRACT_QUEUE_DRIVER_IDS) await s.leave(geozoneId, id);
  };

  runDispatchQueueStoreContract(
    'RedisDispatchQueueStore',
    async () => {
      store ??= new RedisDispatchQueueStore(REDIS_TEST_URL!);
      await clear(store);
      return store;
    },
    {
      geozoneId,
      cleanup: async () => {
        if (!store) return;
        await clear(store);
        await store.onModuleDestroy();
      },
    },
  );
});
