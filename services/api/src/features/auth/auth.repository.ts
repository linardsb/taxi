import { Inject, Injectable } from '@nestjs/common';
import { users, type Db } from '@taxi/db';
import {
  LANGUAGES,
  readDisplayName,
  type SignupRole,
  type User,
} from '@taxi/shared';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { DRIZZLE } from '../../common/db/db.module';

type UserRow = typeof users.$inferSelect;

/**
 * `users.language` is plain `text` with a `'lv'` default — no pg enum, no
 * CHECK — so the column cannot guarantee the union it is typed as. Parsed
 * rather than cast: an off-enum value used to reach `authSessionSchema.parse`
 * and surface as a 500 on SIGN-IN, the one screen that cannot afford one.
 * `.catch` falls back to the column's own default instead of throwing, because
 * a stray language is not a reason to refuse someone their session.
 */
const languageSchema = z.enum(LANGUAGES).catch('lv');

/** The row's nullable columns are optional in the shared domain shape. */
function toUser(row: UserRow): User {
  // A legacy blank or over-long name must neither become a blank row label in
  // the rider's session nor fail `authSessionSchema` at sign-in (#269).
  const name = readDisplayName(row.displayName);
  return {
    id: row.id,
    phone: row.phone,
    role: row.role,
    language: languageSchema.parse(row.language),
    createdAt: row.createdAt,
    ...(row.email ? { email: row.email } : {}),
    ...(name ? { displayName: name } : {}),
  };
}

@Injectable()
export class AuthRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async findByPhone(phone: string): Promise<User | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);
    return row ? toUser(row) : undefined;
  }

  /**
   * Race-safe find-or-create. `role` applies ONLY to a brand-new row: the
   * conflict branch touches `phone` and nothing else, so an existing user's
   * stored role always wins over whatever the OTP request claimed. That one
   * omission is the whole privilege-escalation defence — do not add `role`
   * to the conflict `set`. The one sanctioned exception is a row a dispatcher
   * minted, and it lives in `adoptProvisional`, not here (#123).
   *
   * `onConflictDoNothing().returning()` returns [] on conflict, which is why
   * this is DO UPDATE with a no-op SET — the only form that always returns
   * the row. `language` is left to the column default ('lv').
   */
  async findOrCreate(input: {
    phone: string;
    role: SignupRole;
  }): Promise<User> {
    const [row] = await this.db
      .insert(users)
      .values({ phone: input.phone, role: input.role })
      .onConflictDoUpdate({ target: users.phone, set: { phone: input.phone } })
      .returning();
    return toUser(row!);
  }

  /**
   * The ONE place an existing row's role may change on sign-in (#123), and
   * only for a row a dispatcher minted on the person's behalf. Runs after
   * `findOrCreate`, never instead of it, so a provisional row inserted by a
   * concurrent phone booking is already there to adopt.
   *
   * Three conditions, each load-bearing:
   * - `provisioned_by IS NOT NULL` — a row its owner created by OTP is never
   *   touched, so `findOrCreate`'s "stored role wins" defence holds for it.
   * - `role = 'rider'` — the phone path only ever mints riders; a staff row
   *   that somehow carries the marker (#20 provisions staff accounts) must not
   *   be demoted to a driver by whoever holds the SIM.
   * - `role` is a `SignupRole` — `otpRequestSchema` and the OTP record both
   *   admit only `rider`/`driver`, so an adoption cannot reach a staff role.
   *
   * Clearing the marker makes it one-shot: the next OTP for this number finds a
   * row its owner has now claimed, and the stored role wins again.
   */
  async adoptProvisional(input: {
    phone: string;
    role: SignupRole;
  }): Promise<User | undefined> {
    const [row] = await this.db
      .update(users)
      .set({ role: input.role, provisionedBy: null })
      .where(
        and(
          eq(users.phone, input.phone),
          isNotNull(users.provisionedBy),
          eq(users.role, 'rider'),
        ),
      )
      .returning();
    return row ? toUser(row) : undefined;
  }
}
