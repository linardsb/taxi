import type { FixQueue, NewFix, QueuedFix } from './fix-queue';

/** The test double — array-backed, monotonic ids, the same FIFO contract as sqlite. Nothing else uses it. */
export class InMemoryFixQueue implements FixQueue {
  private rows: QueuedFix[] = [];
  private nextId = 1;

  enqueue(fixes: NewFix[]): Promise<void> {
    for (const fix of fixes) this.rows.push({ id: this.nextId++, ...fix });
    return Promise.resolve();
  }

  peek(limit: number): Promise<QueuedFix[]> {
    return Promise.resolve(this.rows.slice(0, limit));
  }

  remove(ids: number[]): Promise<void> {
    const drop = new Set(ids);
    this.rows = this.rows.filter((row) => !drop.has(row.id));
    return Promise.resolve();
  }

  count(): Promise<number> {
    return Promise.resolve(this.rows.length);
  }

  clear(): Promise<void> {
    this.rows = [];
    return Promise.resolve();
  }

  prune(keepNewest: number): Promise<void> {
    if (this.rows.length > keepNewest) {
      this.rows = this.rows.slice(this.rows.length - keepNewest);
    }
    return Promise.resolve();
  }
}
