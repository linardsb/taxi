import {
  CONTRACT_DRIVER_IDS,
  runDriverLocationStoreContract,
} from '../../../../test/driver-location-store.contract';
import { RedisDriverLocationStore } from './redis-driver-location.store';

/**
 * Skipped unless a Redis is reachable — :6379 and :6380 are taken by other
 * projects on the primary dev machine, so the default gate must never depend
 * on this. Run it deliberately:
 *   REDIS_PORT=6381 docker compose up -d --wait redis
 *   REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run test --filter @taxi/api
 *
 * This is the only place real GEOADD/GEOSEARCH run, and the only thing that
 * can catch the fake claiming an ordering guarantee Redis does not give.
 */
const REDIS_TEST_URL = process.env.REDIS_TEST_URL;
const describeWithRedis = REDIS_TEST_URL ? describe : describe.skip;

describeWithRedis('RedisDriverLocationStore', () => {
  // Per-pid: jest workers share the one Redis and these keys are not namespaced.
  const cityId = `test-city-${process.pid}`;
  let store: RedisDriverLocationStore | undefined;

  /** markOffline clears all three keys for an id — the contract's whole surface. */
  const clear = async (s: RedisDriverLocationStore) => {
    for (const id of CONTRACT_DRIVER_IDS) await s.markOffline(cityId, id);
  };

  runDriverLocationStoreContract(
    'RedisDriverLocationStore',
    async () => {
      store ??= new RedisDriverLocationStore(REDIS_TEST_URL!);
      await clear(store);
      return store;
    },
    {
      cityId,
      cleanup: async () => {
        if (!store) return;
        await clear(store);
        await store.onModuleDestroy();
      },
    },
  );
});
