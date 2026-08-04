import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client";

/**
 * Package-relative, so any consumer can migrate without knowing where `db/`
 * sits. Built output is `db/dist/migrate.js`, so `../migrations` resolves to
 * `db/migrations` — the same folder drizzle-kit writes to. `__dirname` is
 * correct because this package builds to CJS; do not rewrite as import.meta.
 */
export const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
