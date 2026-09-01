/* eslint-disable @typescript-eslint/no-require-imports */
import * as SQLite from 'expo-sqlite';

/**
 * sqlite itself is Level 4 (jest-expo has none). What IS provable here is
 * the connection contract: every write on the ONE opened connection — a
 * second connection made the task's INSERTs and the uploader's DELETEs two
 * writers on one WAL file — and a failed open that is retried, not cached.
 */
const open = SQLite.openDatabaseAsync as jest.Mock;

/**
 * The one connection, exactly as `openDatabaseAsync` hands it back.
 * `withExclusiveTransactionAsync` is present but must never be called: it
 * opens a SECOND connection, which is the thing round 1's F4 banned. Leaving
 * it off the fake made a regression throw with no test naming it (review
 * F48c).
 */
function fakeDb() {
  return {
    execAsync: jest.fn(() => Promise.resolve()),
    runAsync: jest.fn((..._args: unknown[]) =>
      Promise.resolve({ changes: 1, lastInsertRowId: 1 }),
    ),
    getAllAsync: jest.fn(() => Promise.resolve([])),
    getFirstAsync: jest.fn(() => Promise.resolve({ n: 0 })),
    withTransactionAsync: jest.fn((task: () => Promise<void>) => task()),
    withExclusiveTransactionAsync: jest.fn(),
  };
}

/** A fresh module per case — the connection promise is module state. */
function load(): typeof import('./sqlite-fix-queue') {
  let mod!: typeof import('./sqlite-fix-queue');
  jest.isolateModules(() => {
    mod = require('./sqlite-fix-queue') as typeof import('./sqlite-fix-queue');
  });
  return mod;
}

const fix = (n: number) => ({
  at: new Date(1_800_000_000_000 + n * 4000).toISOString(),
  lat: 56.95,
  lng: 24.1,
  heading: null,
});

describe('SqliteFixQueue (connection contract)', () => {
  beforeEach(() => open.mockReset());

  it('enqueue writes every INSERT on the opened connection, with no transaction to cross-talk with an overlapping call (expected — review F33)', async () => {
    const db = fakeDb();
    open.mockResolvedValueOnce(db);
    const { SqliteFixQueue } = load();

    await new SqliteFixQueue().enqueue([fix(1), fix(2)]);

    // No BEGIN/COMMIT: an overlapping enqueue's failed BEGIN rolled back the
    // first call's INSERTs — both batches lost (review F33).
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
    const inserts = db.runAsync.mock.calls.filter(([sql]) =>
      String(sql).startsWith('INSERT INTO fixes'),
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toEqual([
      'INSERT INTO fixes (at, lat, lng, heading) VALUES (?, ?, ?, ?)',
      fix(1).at,
      56.95,
      24.1,
      null,
    ]);
  });

  it('dropOlderThan deletes by the ISO cutoff (edge — the go-online age purge)', async () => {
    const db = fakeDb();
    open.mockResolvedValueOnce(db);
    const { SqliteFixQueue } = load();

    await new SqliteFixQueue().dropOlderThan(fix(3).at);

    expect(db.runAsync).toHaveBeenCalledWith(
      'DELETE FROM fixes WHERE at < ?',
      fix(3).at,
    );
  });

  it('every method rides the ONE connection and none opens an exclusive transaction (edge — review F4/F48c)', async () => {
    const db = fakeDb();
    open.mockResolvedValue(db);
    const { SqliteFixQueue } = load();
    const queue = new SqliteFixQueue();

    // The task's INSERTs and the uploader's DELETEs, interleaved the way they
    // run: a second connection made them two writers on one WAL file.
    await queue.enqueue([fix(1)]);
    await queue.remove([1]);
    await queue.prune(10);
    await queue.dropOlderThan(fix(3).at);
    await queue.count();

    expect(open).toHaveBeenCalledTimes(1);
    expect(db.withExclusiveTransactionAsync).not.toHaveBeenCalled();
  });

  it('a failed open is retried on the next call, not cached for the life of the process (failure)', async () => {
    const db = fakeDb();
    open
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValueOnce(db);
    const { SqliteFixQueue } = load();
    const queue = new SqliteFixQueue();

    await expect(queue.count()).rejects.toThrow('database is locked');
    await expect(queue.count()).resolves.toBe(0);

    expect(open).toHaveBeenCalledTimes(2);
  });
});
