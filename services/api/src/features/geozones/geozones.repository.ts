import { Inject, Injectable } from '@nestjs/common';
import { geozones, type Db } from '@taxi/db';
import type { LatLng } from '@taxi/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../common/db/db.module';

/**
 * The narrow api-local projection of a geozone. NOT the shared `Geozone`: the
 * polygon is never read back into JS — zone lookups happen in SQL via
 * `ST_Contains`, against the GIST index — so carrying a WKB blob through the
 * dispatch hot path would buy nothing.
 */
export interface ResolvedGeozone {
  id: string;
  slug: string;
  /** Human name for Dina's board (#18) — slugs are for seeds and config. */
  name: string;
  queueModeEnabled: boolean;
}

@Injectable()
export class GeozonesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * The zone a point falls in, or `undefined` when it falls in none.
   *
   * PRECEDENCE: smallest polygon wins. Vecrīga is deliberately drawn inside
   * centre (`db/src/seed/riga.ts`), and autoosta overlaps both — the more
   * specific zone is the more useful answer for queue mode and for Dina's
   * district stats alike. `ORDER BY ST_Area` makes that deterministic instead of
   * leaving it to row order.
   *
   * `ST_Area` runs on the raw 4326 geometry, so the unit is squared degrees, not
   * m². That is deliberate and sufficient: this only ever ORDERS zones against
   * each other, and at Rīga's latitude the ranking is identical either way. No
   * caller reads the value.
   *
   * ARGUMENT ORDER, both traps in one statement:
   * `ST_Contains(polygon, point)` — polygon first; reversed it returns false for
   * every row and silently disables queue mode everywhere.
   * `ST_MakePoint(lng, lat)` — LONGITUDE first.
   */
  async findContaining(
    cityId: string,
    point: LatLng,
  ): Promise<ResolvedGeozone | undefined> {
    const [row] = await this.db
      .select({
        id: geozones.id,
        slug: geozones.slug,
        name: geozones.name,
        queueModeEnabled: geozones.queueModeEnabled,
      })
      .from(geozones)
      .where(
        and(
          eq(geozones.cityId, cityId),
          sql`ST_Contains(${geozones.polygon}, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326))`,
        ),
      )
      .orderBy(sql`ST_Area(${geozones.polygon}) ASC`)
      .limit(1);

    return row;
  }
}
