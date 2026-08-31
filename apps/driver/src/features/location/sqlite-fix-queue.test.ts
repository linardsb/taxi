/* eslint-disable @typescript-eslint/no-require-imports */
import * as SQLite from 'expo-sqlite';

/**
 * sqlite itself is Level 4 (jest-expo has none). What IS provable here is
 * the connection contract: every write on the ONE opened connection — a
 * second connection made the task's INSERTs and the uploader's DELETEs two
 * writers on one WAL file — and a failed open that is retried, not cached.
 */
const open = SQLite.openDatabaseAsync as jest.Mock;

/** The one connection, exactly as `openDatabaseAsync` hands it back. No `withExclusiveTransactionAsync` — that is the point. */
function fakeDb() {
  return {
    execAsync: jest.fn(() => Promise.resolve()),
    runAsync: jest.fn((..._args: unknown[]) =>
      Promise.resolve({ changes: 1, lastInsertRowId: 1 }),
    ),
    getAllAsync: jest.fn(() => Promise.resolve([])),
    getFirstAsync: jest.fn(() => Promise.resolve({ n: 0 })),
    withTransactionAsync: jest.fn((task: () => Promise<void>) => task()),
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

  it('enqueue writes every INSERT on the opened connection, inside its own transaction — no second connection (expected)', async () => {
    const db = fakeDb();
    open.mockResolvedValueOnce(db);
    const { SqliteFixQueue } = load();

    await new SqliteFixQueue().enqueue([fix(1), fix(2)]);

    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1);
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
