import { Inject, Injectable } from '@nestjs/common';
import { platformConfig, type Db } from '@taxi/db';
import { platformConfigSchema, type PlatformConfig } from '@taxi/shared';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../common/db/db.module';

@Injectable()
export class PlatformConfigRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Parsed through `platformConfigSchema` rather than returned raw: the row's
   * `commission_pct` is a `double precision` (a plain JS number to Drizzle),
   * and the schema is the only thing asserting it is within 0–100.
   *
   * A missing row throws. There is no fallback by design — `commissionPct` has
   * no default in the schema OR the column, so inventing one here is exactly
   * the constant the architecture forbids.
   */
  async forCity(cityId: string): Promise<PlatformConfig> {
    const [row] = await this.db
      .select()
      .from(platformConfig)
      .where(eq(platformConfig.cityId, cityId))
      .limit(1);

    if (!row) {
      throw new Error(
        `No platform_config row for city ${cityId} — run the @taxi/db seed. Commission is config, not a constant: there is no default to fall back to.`,
      );
    }

    return platformConfigSchema.parse(row);
  }
}
