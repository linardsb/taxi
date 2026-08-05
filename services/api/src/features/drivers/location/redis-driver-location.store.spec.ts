import {
  CONTRACT_DRIVER_IDS,
  runDriverLocationStoreContract,
} from '../../../../test/driver-location-store.contract';
import {
  asGeoSearchRow,
  asMemberSet,
  RedisDriverLocationStore,
} from './redis-driver-location.store';

/**
 * Runs without Redis, deliberately: this is about what happens when a reply is
 * NOT the shape the types claim, which the real client will not produce on
 * demand. `as GeoSearchRow[]` accepted every one of these and handed dispatch a
 * driver at `{lat: NaN, lng: NaN}` — inside the radius of nothing, and typed as
 * a `LatLng` that was never parsed (L6).
 */
describe('ioredis reply validation', () => {
  it('reads a well-formed GEOSEARCH row (expected)', () => {
    expect(
      asGeoSearchRow(['driver-1', '250.5', ['24.1136', '56.9512']]),
    ).toEqual(['driver-1', '250.5', ['24.1136', '56.9512']]);
  });

  it('drops a row that is not the documented shape (failure)', () => {
    for (const malformed of [
      undefined,
      'driver-1', // not a row at all
      ['driver-1', '250.5'], // WITHCOORD missing
      ['driver-1', '250.5', ['24.1136']], // half a coordinate
      ['driver-1', 'not-a-number', ['24.1136', '56.9512']],
      ['driver-1', '250.5', ['nope', '56.9512']], // the NaN that used to survive
      [42, '250.5', ['24.1136', '56.9512']], // member is not a string
    ]) {
      expect(asGeoSearchRow(malformed)).toBeUndefined();
    }
  });

  it('reads the freshness set and ignores non-string members (edge)', () => {
    expect(asMemberSet(['a', 'b'])).toEqual(new Set(['a', 'b']));
    expect(asMemberSet(['a', 7, null])).toEqual(new Set(['a']));
    expect(asMemberSet(undefined)).toEqual(new Set());
  });
});

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
