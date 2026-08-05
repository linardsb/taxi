import { Inject, Injectable } from '@nestjs/common';
import { rideTariffs, type Db } from '@taxi/db';
import {
  rideTariffSchema,
  type RideCategory,
  type RideTariff,
} from '@taxi/shared';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../common/db/db.module';

@Injectable()
export class TariffRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Reads the rate card on the composite unique `(city_id, category)`.
   *
   * A missing row throws rather than falling back. Note this surfaces as a
   * **500, not a 4xx**: the request was perfectly valid, the platform is
   * misconfigured. Do not convert it — a fallback rate is the constant this
   * table exists to abolish.
   */
  async forCategory(
    cityId: string,
    category: RideCategory,
  ): Promise<RideTariff> {
    const [row] = await this.db
      .select()
      .from(rideTariffs)
      .where(
        and(eq(rideTariffs.cityId, cityId), eq(rideTariffs.category, category)),
      )
      .limit(1);

    if (!row) {
      throw new Error(
        `No ride_tariffs row for city ${cityId} / category ${category} — the @taxi/db seed is incomplete. A rate is config; there is no fallback.`,
      );
    }

    return rideTariffSchema.parse(row);
  }
}
