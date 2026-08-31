import { InMemoryFixQueue } from './in-memory-fix-queue';

const fix = (n: number) => ({
  at: new Date(1_800_000_000_000 + n * 4000).toISOString(),
  lat: 56.95,
  lng: 24.1 + n / 1000,
  heading: null,
});

describe('InMemoryFixQueue', () => {
  it('hands fixes back oldest first with monotonic ids (expected)', async () => {
    const q = new InMemoryFixQueue();
    await q.enqueue([fix(1), fix(2)]);
    await q.enqueue([fix(3)]);

    const rows = await q.peek(10);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.at)).toEqual([fix(1).at, fix(2).at, fix(3).at]);
    expect(await q.peek(2)).toHaveLength(2);
  });

  it('removes a subset and leaves the rest in order (edge)', async () => {
    const q = new InMemoryFixQueue();
    await q.enqueue([fix(1), fix(2), fix(3)]);

    await q.remove([2]);

    expect((await q.peek(10)).map((r) => r.id)).toEqual([1, 3]);
    expect(await q.count()).toBe(2);
  });

  it('prune keeps exactly the newest N and clear empties (failure — the ceiling)', async () => {
    const q = new InMemoryFixQueue();
    await q.enqueue([fix(1), fix(2), fix(3), fix(4)]);

    await q.prune(2);

    expect((await q.peek(10)).map((r) => r.id)).toEqual([3, 4]);
    expect(await q.count()).toBe(2);
    await q.clear();
    expect(await q.count()).toBe(0);
  });
});
