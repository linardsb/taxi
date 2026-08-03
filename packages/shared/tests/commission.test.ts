import { describe, expect, it } from "vitest";
import { fareSplitSchema, resolveCommissionPct, splitFare } from "../src/commission";
import { platformConfigSchema } from "../src/schemas/platform-config";

// Built through the schema rather than hand-typed, so this breaks loudly if a
// required config field is added later.
const config15 = platformConfigSchema.parse({
  id: "8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f",
  cityId: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  commissionPct: 15,
  updatedAt: "2026-08-03T09:00:00.000Z",
});

describe("resolveCommissionPct", () => {
  it("falls back to the platform base (expected)", () => {
    expect(resolveCommissionPct({ commissionPctOverride: null }, config15)).toEqual({
      pct: 15,
      source: "platform_base",
    });
    expect(resolveCommissionPct({}, config15).source).toBe("platform_base");
  });

  it("lets a 0% override beat the base (edge — S6-7, the `!= null` rule)", () => {
    const resolution = resolveCommissionPct({ commissionPctOverride: 0 }, config15);
    expect(resolution).toEqual({ pct: 0, source: "driver_override" });
    expect(splitFare(2000, resolution).driverNetCents).toBe(2000);
  });
});

describe("splitFare", () => {
  it("splits a €20 fare at the launch rate (expected)", () => {
    const split = splitFare(2000, resolveCommissionPct({ commissionPctOverride: null }, config15));
    expect(split).toEqual({
      currency: "EUR",
      totalCents: 2000,
      commissionPct: 15,
      commissionSource: "platform_base",
      commissionCents: 300,
      driverNetCents: 1700,
    });
    expect(fareSplitSchema.safeParse(split).success).toBe(true);
  });

  it("rounds the half cent up and keeps the sum exact (edge)", () => {
    const split = splitFare(333, { pct: 15, source: "platform_base" }); // 49.95 → 50
    expect(split.commissionCents).toBe(50);
    expect(split.driverNetCents).toBe(283);
  });

  it("never leaks a cent across totals × percentages (edge — the invariant sweep)", () => {
    const totals = [0, 1, 7, 333, 1299, 2000, 19999, 1_000_000];
    const pcts = [0, 12.5, 15, 16, 100];
    for (let t = 0; t < totals.length; t++) {
      for (let p = 0; p < pcts.length; p++) {
        const total = totals[t]!;
        const split = splitFare(total, { pct: pcts[p]!, source: "platform_base" });
        expect(split.commissionCents + split.driverNetCents).toBe(total);
        expect(Number.isInteger(split.commissionCents)).toBe(true);
        expect(Number.isInteger(split.driverNetCents)).toBe(true);
        expect(split.commissionCents).toBeGreaterThanOrEqual(0);
        expect(split.driverNetCents).toBeGreaterThanOrEqual(0);
        expect(fareSplitSchema.safeParse(split).success).toBe(true);
      }
    }
  });

  it("rejects a split that does not sum to the total (failure)", () => {
    expect(
      fareSplitSchema.safeParse({
        currency: "EUR",
        totalCents: 1000,
        commissionPct: 15,
        commissionSource: "platform_base",
        commissionCents: 150,
        driverNetCents: 800, // a leaked cent — 50 of them, in fact
      }).success,
    ).toBe(false);
  });
});
