import { Inject, Injectable } from '@nestjs/common';
import { users, type Db } from '@taxi/db';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../common/db/db.module';

/**
 * The rider's own row, written only ever for themselves — every method takes
 * the id off the JWT, and none of them takes a role, so there is no shape in
 * which this writes another person's token.
 */
@Injectable()
export class RidersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Registration is an unconditional write, not an upsert: the `users` row
   * already exists (the JWT proves it) and a rider has exactly one current
   * token. Re-registering the same value is a no-op UPDATE, which is what
   * every app start does.
   */
  async setPushToken(riderId: string, token: string | null): Promise<void> {
    await this.db
      .update(users)
      .set({ pushToken: token })
      .where(eq(users.id, riderId));
  }
}
