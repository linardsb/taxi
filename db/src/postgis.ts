import { customType } from "drizzle-orm/pg-core";
import type { LatLng } from "@taxi/shared";

/**
 * EWKT in (Postgres parses it into geometry), raw WKB hex out (opaque — read
 * via ST_AsGeoJSON in SQL). Drizzle's built-in `geometry` is point-only, so
 * polygons need this custom type; nothing in this ticket reads polygons into
 * JS — dispatch does zone lookups in SQL via ST_Contains.
 */
export const geometryPolygon = customType<{ data: string }>({
  dataType: () => "geometry(Polygon,4326)",
});

/** Closes the ring (shared geozoneSchema: "first and last vertex need not repeat"). WKT order is lng lat. */
export function polygonToEwkt(ring: LatLng[]): string {
  if (ring.length < 3) {
    throw new Error(`polygonToEwkt: a polygon ring needs ≥3 vertices, got ${ring.length}`);
  }
  const closed = [...ring, ring[0]!];
  const coords = closed.map((p) => `${p.lng} ${p.lat}`).join(", ");
  return `SRID=4326;POLYGON((${coords}))`;
}
