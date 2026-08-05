import { runDriverLocationStoreContract } from '../../../../test/driver-location-store.contract';
import { InMemoryDriverLocationStore } from '../../../../test/harness';

/**
 * The harness fake against the SAME fixture the real Redis store runs
 * (redis-driver-location.store.spec.ts, opt-in). Every other spec in the suite
 * trusts this fake to behave like Redis — this is where that is earned rather
 * than assumed.
 */
runDriverLocationStoreContract(
  'InMemoryDriverLocationStore',
  () => new InMemoryDriverLocationStore(),
);
