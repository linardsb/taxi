import { createDb, migrateDb, seedRiga } from '@taxi/db';
import { RT_EVENT_SCHEMAS, otpRequestSchema, userRoom } from '@taxi/shared';
import { ADMIN_URL, TEST_DB_NAME, TEST_URL } from './test-db';

// Jest resolves @taxi/shared and @taxi/db to their BUILT dist, so a stale
// build runs the suite against yesterday's contracts. Turbo's `test` task
// depends on `^build`, but a direct `pnpm --filter @taxi/api test` skips it.
// Fail with the fix rather than mysteriously.
//
// If this FILE failed to import at all ("has no exported member …"), that is
// the same stale-dist problem with a less friendly message — the fix is
// identical.
const STALE_DIST_FIX =
  'Stale workspace build. Run: pnpm turbo run test --filter @taxi/api   (rebuilds deps first)';

const missing = Object.entries({
  'shared.userRoom': typeof userRoom === 'function',
  'shared.RT_EVENT_SCHEMAS': typeof RT_EVENT_SCHEMAS === 'object',
  'shared.otpRequestSchema': typeof otpRequestSchema === 'object',
  'db.migrateDb': typeof migrateDb === 'function',
})
  .filter(([, present]) => !present)
  .map(([name]) => name);

if (missing.length) {
  throw new Error(`${missing.join(', ')} missing from dist. ${STALE_DIST_FIX}`);
}

/** Runs once, in its own process: drop/recreate taxi_api_test, migrate, seed. */
export default async function setup(): Promise<void> {
  const { pool: adminPool } = createDb(ADMIN_URL);
  try {
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`,
    );
    await adminPool.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      throw new Error('Postgres is not up — run: docker compose up -d --wait');
    }
    throw err;
  } finally {
    await adminPool.end();
  }

  const { db, pool } = createDb(TEST_URL);
  try {
    await migrateDb(db);
    await seedRiga(db);
  } finally {
    await pool.end();
  }
}
