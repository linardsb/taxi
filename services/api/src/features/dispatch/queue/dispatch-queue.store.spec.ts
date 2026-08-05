import { runDispatchQueueStoreContract } from '../../../../test/dispatch-queue-store.contract';
import { InMemoryDispatchQueueStore } from './in-memory-dispatch-queue.store';

/**
 * The fake against the SAME fixture the real Redis store runs
 * (redis-dispatch-queue.store.spec.ts, opt-in). Every other spec in the suite —
 * including the queue-fairness acceptance case — trusts this fake to behave like
 * a Redis list; this is where that is earned rather than assumed.
 *
 * Runs with NO Redis present, deliberately. That is the whole point: AC #2 must
 * execute on the default gate.
 */
runDispatchQueueStoreContract(
  'InMemoryDispatchQueueStore',
  () => new InMemoryDispatchQueueStore(),
);
