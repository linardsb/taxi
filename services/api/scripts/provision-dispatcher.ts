/**
 * `provision:dispatcher` — upserts a `users` row with `role='dispatcher'` for
 * a phone number, so that phone can sign in to the console (#18).
 *
 * This script is the ONLY dispatcher-creation path, deliberately:
 * `SIGNUP_ROLES` excludes `dispatcher` (a phone may not claim the role for
 * itself), the seed creates no users, and `AuthRepository.findOrCreate` never
 * upgrades an existing row's role — the stored role always wins over the OTP
 * request's. So the role must be written explicitly, here, by the operator.
 * After provisioning, the phone logs in through the ordinary OTP flow (the
 * console sends `role:'rider'`; the stored `dispatcher` wins).
 *
 * NOT A TEST and not part of the app: a manual instrument, held to
 * `typecheck` and `lint` so it cannot rot, and kept out of `dist/` by
 * `tsconfig.build.json` — the same footing as mint-tracked-ride.ts.
 *
 * Run:  pnpm --filter @taxi/api provision:dispatcher +371XXXXXXXX [name]
 *       (no `--` separator — pnpm 10 forwards it literally as an argument;
 *       DATABASE_URL from the environment, e.g. sourced from the root .env)
 */
import { createDb, users } from '@taxi/db';
import { phoneSchema } from '@taxi/shared';
import { eq } from 'drizzle-orm';
import { maskPhone } from '../src/features/auth';

async function main(): Promise<void> {
  const [phoneArg, nameArg] = process.argv.slice(2);
  if (!phoneArg) {
    console.error(
      'usage: pnpm --filter @taxi/api provision:dispatcher +371XXXXXXXX [display name]',
    );
    process.exitCode = 1;
    return;
  }
  const phone = phoneSchema.parse(phoneArg);

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set — run from a shell that sourced the root .env',
    );
  }

  const { db, pool } = createDb(url);
  try {
    const [existing] = await db
      .select({
        id: users.id,
        role: users.role,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);

    const [row] = await db
      .insert(users)
      .values({
        phone,
        role: 'dispatcher',
        ...(nameArg ? { displayName: nameArg } : {}),
      })
      .onConflictDoUpdate({
        target: users.phone,
        // The explicit role write is the whole script — findOrCreate's
        // conflict branch deliberately never touches `role`.
        set: {
          role: 'dispatcher',
          ...(nameArg ? { displayName: nameArg } : {}),
        },
      })
      .returning({
        id: users.id,
        role: users.role,
        displayName: users.displayName,
      });

    if (!row) throw new Error('upsert returned no row');
    console.log(
      existing
        ? `updated ${maskPhone(phone)} (${row.id}): role ${existing.role} → ${row.role}` +
            (nameArg ? `, name → ${row.displayName ?? ''}` : '')
        : `created ${maskPhone(phone)} (${row.id}) as ${row.role}` +
            (row.displayName ? ` — ${row.displayName}` : ''),
    );
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
