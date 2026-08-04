import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb } from "./helpers";

afterAll(closeTestDb);

async function zonesContaining(lng: number, lat: number): Promise<string[]> {
  const db = getTestDb();
  const result = await db.execute<{ slug: string }>(
    sql`SELECT slug FROM geozones WHERE ST_Contains(polygon, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)) ORDER BY slug`,
  );
  return result.rows.map((r) => r.slug);
}

describe("PostGIS smoke — seeded Rīga zones", () => {
  it("all four pilot slugs are seeded (expected)", async () => {
    const db = getTestDb();
    const result = await db.execute<{ slug: string }>(sql`SELECT slug FROM geozones ORDER BY slug`);
    expect(result.rows.map((r) => r.slug)).toEqual(["autoosta", "centre", "old_town", "rix"]);
  });

  it("a point in Vecrīga is inside old_town AND centre — the overlap is deliberate (expected)", async () => {
    // Precedence between overlapping zones is #10's problem, not #6's.
    expect(await zonesContaining(24.106, 56.9489)).toEqual(["centre", "old_town"]);
  });

  it("a point in Jūrmala matches zero zones (edge)", async () => {
    expect(await zonesContaining(23.77, 56.97)).toEqual([]);
  });

  it("the GIST spatial index exists on geozones.polygon (expected)", async () => {
    const db = getTestDb();
    const result = await db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'geozones' AND indexname = 'geozones_polygon_gix'`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.indexdef).toContain("USING gist");
  });
});
