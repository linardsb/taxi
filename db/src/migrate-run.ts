import { createDb } from './client';
import { migrateDb, MIGRATIONS_DIR } from './migrate';

/**
 * Applies pending migrations and exits — the production runner (#13), run on
 * every deploy before the new API starts.
 *
 * Exists because `drizzle-kit migrate` (`pnpm --filter @taxi/db migrate`) is a
 * devDependency and is not in the pruned runtime image, whereas `drizzle-orm`'s
 * migrator, which `migrateDb()` wraps, is a production dependency. Same shape
 * as `seed/run.ts`: dev-default URL, `createDb`, the work in `try`,
 * `pool.end()` in `finally`, non-zero exit on any error.
 *
 * Idempotent: drizzle records applied migrations in
 * `drizzle.__drizzle_migrations` and skips them, so a re-run against a current
 * database is a no-op that exits 0. Reads `MIGRATIONS_DIR` (`db/migrations`,
 * resolved from `db/dist/`), so the image must ship the `.sql` files AND
 * `meta/_journal.json` at that path — the migrator reads the journal first and
 * throws if it is missing, which is what makes a Dockerfile that forgot the
 * folder fail loudly here rather than apply nothing.
 */
async function main(): Promise<void> {
  const url =
    process.env.DATABASE_URL ?? 'postgres://taxi:taxi@localhost:5432/taxi';
  const { db, pool } = createDb(url);
  try {
    await migrateDb(db);
    console.log(`Migrations up to date: ${MIGRATIONS_DIR}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
