import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { createDb } from '../src/client';
import { seedRiga } from '../src/seed/riga';
import { ADMIN_URL, TEST_DB_NAME, TEST_URL } from './helpers';

/**
 * Runs once, in its own process (no state sharing with tests — helpers create
 * their own pool): drop/recreate taxi_test, migrate, seed. Readiness is
 * normally guaranteed by the `pretest` docker --wait hook; the ECONNREFUSED
 * guard covers direct `vitest` invocations that bypass the pnpm script.
 */
export default async function setup(): Promise<void> {
  const admin = new Pool({ connectionString: ADMIN_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      throw new Error('Postgres is not up — run: docker compose up -d --wait');
    }
    throw err;
  } finally {
    await admin.end();
  }

  const { db, pool } = createDb(TEST_URL);
  try {
    await migrate(db, { migrationsFolder: './migrations' });
    await seedRiga(db);
  } finally {
    await pool.end();
  }
}
