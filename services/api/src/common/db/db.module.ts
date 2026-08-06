import {
  Global,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { createDb, type Db } from '@taxi/db';
import { APP_ENV, type Env } from '../config/env.schema';

export const DRIZZLE = 'DRIZZLE';

/**
 * Drizzle's transaction handle, derived so it never drifts from `Db`. Deriving
 * from `Db` needs no type arguments and cannot drift when the schema or driver
 * changes — do not reach for a `PgTransaction<...>` generic.
 *
 * Lives beside the `DRIZZLE` token because Drizzle plumbing is cross-cutting:
 * three slices now compose transactions, and homing this in one of them would
 * make the other two depend on that slice for a type.
 */
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Owns the pg pool so it can be closed on shutdown — without `pool.end()`
 * jest hangs after the suite with open handles. The pool is typed off
 * createDb's return so the api needs no direct `pg` dependency.
 */
@Injectable()
export class DbConnection implements OnModuleDestroy {
  readonly db: Db;
  private readonly pool: ReturnType<typeof createDb>['pool'];

  constructor(@Inject(APP_ENV) env: Env) {
    const { db, pool } = createDb(env.DATABASE_URL);
    this.db = db;
    this.pool = pool;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    DbConnection,
    {
      provide: DRIZZLE,
      useFactory: (c: DbConnection) => c.db,
      inject: [DbConnection],
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}
