import type { DispatchQueueStore } from '../src/features/dispatch/queue/dispatch-queue.store';

/**
 * ONE fixture, run against BOTH implementations of `DispatchQueueStore` — the
 * in-memory fake (always) and the real Redis list store (opt-in, under
 * `REDIS_TEST_URL`).
 *
 * THIS IS WHY AC #2 DOES NOT SILENTLY SKIP. The queue is Redis-backed, and
 * `REDIS_TEST_URL` is opt-in: if the only runner of this contract were the Redis
 * spec, then on a machine without that variable the queue-fairness edge case
 * would not execute and the gate would still be green. That is PR #36's
 * reviewer note 2, and it is the trap this file exists to close.
 *
 * Positions are 1-BASED at this boundary — Redis lists are 0-based and the port
 * owns the conversion.
 */

export const CONTRACT_QUEUE_DRIVERS = {
  a: 'q0000000-0000-4000-8000-0000000000a1',
  b: 'q0000000-0000-4000-8000-0000000000b1',
  c: 'q0000000-0000-4000-8000-0000000000c1',
  d: 'q0000000-0000-4000-8000-0000000000d1',
} as const;

export const CONTRACT_QUEUE_DRIVER_IDS = Object.values(CONTRACT_QUEUE_DRIVERS);

/**
 * @param makeStore runs before EVERY case and must hand back an empty queue.
 * @param opts.geozoneId namespace for the key — a real-Redis run passes a
 *   per-worker value, because jest workers share the one server.
 * @param opts.cleanup runs once at the end (close connections, drop keys).
 */
export function runDispatchQueueStoreContract(
  name: string,
  makeStore: () => Promise<DispatchQueueStore> | DispatchQueueStore,
  opts?: { geozoneId?: string; cleanup?: () => Promise<void> },
): void {
  describe(`${name} (DispatchQueueStore contract)`, () => {
    const zone = opts?.geozoneId ?? 'contract-zone';
    const { a, b, c, d } = CONTRACT_QUEUE_DRIVERS;
    let store: DispatchQueueStore;

    const positionsOf = (...ids: string[]) => store.positions(zone, ids);

    async function join(...ids: string[]): Promise<void> {
      for (const id of ids) await store.joinBack(zone, id);
    }

    beforeEach(async () => {
      store = await makeStore();
    });

    if (opts?.cleanup) afterAll(opts.cleanup);

    it('reports join order as 1-based positions (expected)', async () => {
      await join(a, b, c);

      const positions = await positionsOf(a, b, c);
      expect(positions.get(a)).toBe(1);
      expect(positions.get(b)).toBe(2);
      expect(positions.get(c)).toBe(3);
    });

    it('does NOT move a driver who is already queued (expected)', async () => {
      await join(a, b, c);

      // The fairness property: re-joining must not cost a driver their earned
      // place, or being offered a ride would punish them.
      await store.joinBack(zone, a);

      const positions = await positionsOf(a, b, c);
      expect(positions.get(a)).toBe(1);
      expect(positions.get(b)).toBe(2);
      expect(positions.get(c)).toBe(3);
    });

    it('sends the head driver to the back and shifts everyone up (edge)', async () => {
      await join(a, b, c);

      await store.sendToBack(zone, a); // what a decline costs

      const positions = await positionsOf(a, b, c);
      expect(positions.get(b)).toBe(1);
      expect(positions.get(c)).toBe(2);
      expect(positions.get(a)).toBe(3);
    });

    it('leaves a driver holding exactly ONE slot after repeated sendToBack (edge)', async () => {
      await join(a, b);

      // `LREM key 0 member` removes EVERY occurrence. With count 1 a
      // double-tapped decline would leave a stale duplicate ahead of where the
      // driver started — the queue would reward declining.
      await store.sendToBack(zone, a);
      await store.sendToBack(zone, a);

      const positions = await positionsOf(a, b);
      expect(positions.get(b)).toBe(1);
      expect(positions.get(a)).toBe(2);
    });

    it('returns an empty map for a zone with no queue (edge)', async () => {
      await expect(positionsOf(a, b)).resolves.toEqual(new Map());
    });

    it('treats leave on a driver who never joined as a no-op (failure)', async () => {
      await join(a);

      await expect(store.leave(zone, d)).resolves.toBeUndefined();

      const positions = await positionsOf(a, d);
      expect(positions.get(a)).toBe(1);
      expect(positions.has(d)).toBe(false);
    });

    /**
     * MIRRORS THE STRATEGY'S ACTUAL CALL SEQUENCE (lazy enrollment), which none
     * of the isolated cases above exercises: a partly-queued zone, the rest
     * enrolled on the spot, then one `positions` read over all four.
     *
     * The assertion is a TOTAL ORDER — no duplicates, no gaps — because that is
     * what the queue strategy sorts by. A store that returned two drivers at
     * position 2, or skipped 3, would rank them arbitrarily and the fairness the
     * feature exists for would leak out silently.
     */
    it('yields a gapless total order when latecomers are enrolled (edge)', async () => {
      await join(a, b); // already in the rank

      await join(c, d); // seen by dispatch for the first time

      const positions = await positionsOf(a, b, c, d);
      expect(positions.size).toBe(4);
      // The two who were already there kept what they earned.
      expect(positions.get(a)).toBe(1);
      expect(positions.get(b)).toBe(2);

      const ranks = [...positions.values()].sort((x, y) => x - y);
      expect(ranks).toEqual([1, 2, 3, 4]);
    });
  });
}
