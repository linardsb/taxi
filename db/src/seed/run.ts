import { RIGA_PILOT_DISTRICTS } from '@taxi/shared';
import { createDb } from '../client';
import { seedRiga } from './riga';

async function main(): Promise<void> {
  const url =
    process.env.DATABASE_URL ?? 'postgres://taxi:taxi@localhost:5432/taxi';
  const { db, pool } = createDb(url);
  try {
    await seedRiga(db);
    console.log(
      `Seeded Rīga: ${RIGA_PILOT_DISTRICTS.join(', ')}, commissionPct=15`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
