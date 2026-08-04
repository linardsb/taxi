/**
 * The api suite's database coordinates, in ONE place because jest's
 * `globalSetup` runs in its own process and never sees `setupFiles`. If these
 * were derived separately the two could disagree about which database to drop.
 *
 * `taxi_api_test`, NOT `taxi_test`: turbo runs @taxi/db:test and @taxi/api:test
 * in parallel and both global-setups DROP their database. Different names
 * cannot race.
 */
export const TEST_DB_NAME = 'taxi_api_test';

/** The admin/dev database; DATABASE_URL overrides for non-default hosts. */
export const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgres://taxi:taxi@localhost:5432/taxi';

/** Same server, isolated test database (created fresh in global-setup). */
export const TEST_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB_NAME}`);
