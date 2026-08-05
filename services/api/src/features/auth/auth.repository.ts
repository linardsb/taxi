import { Inject, Injectable } from '@nestjs/common';
import { users, type Db } from '@taxi/db';
import { LANGUAGES, type SignupRole, type User } from '@taxi/shared';
import { eq } from 'drizzle-orm';
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
  return {
    id: row.id,
    phone: row.phone,
    role: row.role,
    language: languageSchema.parse(row.language),
    createdAt: row.createdAt,
    ...(row.email ? { email: row.email } : {}),
    ...(row.displayName ? { displayName: row.displayName } : {}),
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
   * to the conflict `set`.
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
}
