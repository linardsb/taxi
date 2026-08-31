import * as SQLite from 'expo-sqlite';
import {
  MAX_QUEUED_FIXES,
  type FixQueue,
  type NewFix,
  type QueuedFix,
} from './fix-queue';

const DB_NAME = 'sakta-driver.db';
const REMOVE_CHUNK = 100;

/**
 * Opened lazily and once — the headless task and the UI share the ONE
 * connection, and every write below stays on it: `withExclusiveTransactionAsync`
 * opens a second connection, which made the task's INSERTs and the uploader's
 * DELETEs two writers on one WAL file with no busy timeout — a lock collision
 * mid-drain failed `enqueue` and dropped the fixes silently. WAL so a read
 * (`peek`) never blocks a write. A failed open is NOT cached: the next call
 * retries instead of rejecting for the life of the process.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
function db(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= SQLite.openDatabaseAsync(DB_NAME)
    .then(async (opened) => {
      await opened.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS fixes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TEXT NOT NULL,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          heading REAL
        );
      `);
      return opened;
    })
    .catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  return dbPromise;
}

/**
 * The durable queue (D3). Exercised on a device (Level 4), not under jest —
 * jest-expo has no sqlite, and the port's contract is proven on the
 * in-memory twin.
 */
export class SqliteFixQueue implements FixQueue {
  async enqueue(fixes: NewFix[]): Promise<void> {
    const conn = await db();
    // A plain loop, no BEGIN/COMMIT: `enqueue` was the only transaction
    // opener on the shared connection, and two overlapping calls (TaskManager
    // re-invoking during a stalled batch) failed the second BEGIN, whose
    // ROLLBACK discarded the FIRST call's INSERTs (review F33). Batches are
    // 1–2 rows and every INSERT stands alone — nothing here needs
    // cross-statement atomicity.
    for (const fix of fixes) {
      await conn.runAsync(
        'INSERT INTO fixes (at, lat, lng, heading) VALUES (?, ?, ?, ?)',
        fix.at,
        fix.lat,
        fix.lng,
        fix.heading,
      );
    }
    if ((await this.count()) > MAX_QUEUED_FIXES)
      await this.prune(MAX_QUEUED_FIXES);
  }

  async peek(limit: number): Promise<QueuedFix[]> {
    const conn = await db();
    return conn.getAllAsync<QueuedFix>(
      'SELECT id, at, lat, lng, heading FROM fixes ORDER BY id LIMIT ?',
      limit,
    );
  }

  async remove(ids: number[]): Promise<void> {
    const conn = await db();
    for (let i = 0; i < ids.length; i += REMOVE_CHUNK) {
      const chunk = ids.slice(i, i + REMOVE_CHUNK);
      await conn.runAsync(
        `DELETE FROM fixes WHERE id IN (${chunk.map(() => '?').join(',')})`,
        ...chunk,
      );
    }
  }

  async count(): Promise<number> {
    const conn = await db();
    const row = await conn.getFirstAsync<{ n: number }>(
      'SELECT count(*) AS n FROM fixes',
    );
    return row?.n ?? 0;
  }

  async clear(): Promise<void> {
    await (await db()).runAsync('DELETE FROM fixes');
  }

  async prune(keepNewest: number): Promise<void> {
    await (
      await db()
    ).runAsync(
      'DELETE FROM fixes WHERE id NOT IN (SELECT id FROM fixes ORDER BY id DESC LIMIT ?)',
      keepNewest,
    );
  }

  async dropOlderThan(before: string): Promise<void> {
    await (await db()).runAsync('DELETE FROM fixes WHERE at < ?', before);
  }
}
