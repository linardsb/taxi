import type { Pool } from 'pg';
import { createDb, type Db } from '../src/client';

export const TEST_DB_NAME = 'taxi_test';

/** The admin/dev database; DATABASE_URL overrides for non-default hosts. */
export const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgres://taxi:taxi@localhost:5432/taxi';

/** Same server, isolated test database (created fresh in global-setup). */
export const TEST_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB_NAME}`);

let handle: { db: Db; pool: Pool } | null = null;

export function getTestDb(): Db {
  handle ??= createDb(TEST_URL);
  return handle.db;
}

export async function closeTestDb(): Promise<void> {
  await handle?.pool.end();
  handle = null;
}
