import { Inject, Injectable } from '@nestjs/common';
import { drivers, users, type Db } from '@taxi/db';
import { LANGUAGES, type Language } from '@taxi/shared';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { DRIZZLE } from '../../../common/db/db.module';

/** One driver whose "you've gone offline" nudge is due. */
export interface DueNudge {
  userId: string;
  pushToken: string | null;
  language: Language;
}

/** `users.language` is plain text — the auth repository's own lenient read. */
const languageSchema = z.enum(LANGUAGES).catch('lv');

/**
 * The presence writes the SERVER makes (#14) — kept out of the 396-line
 * `drivers.repository.ts`. Every write is a conditional UPDATE whose
 * RETURNING row is the answer, never a read-then-write (the L8 idiom): the
 * WHERE clause is what makes "was online" and "not yet claimed" race-free.
 */
@Injectable()
export class DriverPresenceRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * `online → offline` with the nudge stamped, only while still online.
   * `false` = was not online, nothing happened — a claim to `on_ride` that
   * landed first wins, and #11's status is never overwritten.
   */
  async markOfflineByServer(
    userId: string,
    nudgeDueAt: Date,
  ): Promise<boolean> {
    const [row] = await this.db
      .update(drivers)
      .set({ status: 'offline', offlineNudgeDueAt: nudgeDueAt })
      .where(and(eq(drivers.userId, userId), eq(drivers.status, 'online')))
      .returning({ userId: drivers.userId });
    return row !== undefined;
  }

  /**
   * Still offline and past due. `now` is a bound parameter, not `now()`, so
   * the sweeper's `tick(nowMs)` drives it with no clock in the test. A seq
   * scan over the drivers table: ≤100 rows every 15 s at pilot scale
   * (`expected`); a partial index on `offline_nudge_due_at IS NOT NULL` is
   * the fix if the table ever passes ~10k rows.
   */
  async findDueNudges(now: Date, limit: number): Promise<DueNudge[]> {
    const rows = await this.db
      .select({
        userId: drivers.userId,
        pushToken: drivers.pushToken,
        language: users.language,
      })
      .from(drivers)
      .innerJoin(users, eq(users.id, drivers.userId))
      .where(
        and(
          eq(drivers.status, 'offline'),
          isNotNull(drivers.offlineNudgeDueAt),
          lte(drivers.offlineNudgeDueAt, now),
        ),
      )
      .limit(limit);
    return rows.map((row) => ({
      ...row,
      language: languageSchema.parse(row.language),
    }));
  }

  /** The send lock: nulling the column IS the claim. `false` = someone else got there first. */
  async claimNudge(userId: string): Promise<boolean> {
    const [row] = await this.db
      .update(drivers)
      .set({ offlineNudgeDueAt: null })
      .where(
        and(eq(drivers.userId, userId), isNotNull(drivers.offlineNudgeDueAt)),
      )
      .returning({ userId: drivers.userId });
    return row !== undefined;
  }

  /** `null` forgets the token (sign-out, or a `DeviceNotRegistered` ticket). The caller runs `findOrCreate` first. */
  async setPushToken(userId: string, token: string | null): Promise<void> {
    await this.db
      .update(drivers)
      .set({ pushToken: token })
      .where(eq(drivers.userId, userId));
  }
}
