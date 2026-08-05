import { describe, expect, it } from "vitest";
import { rideTariffSchema } from "../src/schemas/tariff";

const base = {
  id: "8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f",
  cityId: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  category: "standard",
  baseCents: 200,
  perKmCents: 80,
  perMinuteCents: 15,
  minimumFareCents: 350,
  updatedAt: "2026-08-03T09:00:00.000Z",
};

describe("rideTariffSchema", () => {
  it("parses a full rate card and coerces updatedAt (expected)", () => {
    const parsed = rideTariffSchema.parse(base);
    expect(parsed.category).toBe("standard");
    expect(parsed.baseCents).toBe(200);
    expect(parsed.perKmCents).toBe(80);
    expect(parsed.perMinuteCents).toBe(15);
    expect(parsed.minimumFareCents).toBe(350);
    expect(parsed.updatedAt).toBeInstanceOf(Date);
  });

  it("accepts a zero minimum fare — no floor is a real configuration (edge)", () => {
    expect(rideTariffSchema.parse({ ...base, minimumFareCents: 0 }).minimumFareCents).toBe(0);
  });

  it("rejects a fractional per-km rate — integer cents only (failure)", () => {
    expect(rideTariffSchema.safeParse({ ...base, perKmCents: 80.5 }).success).toBe(false);
  });

  it("requires baseCents — config, not constant (failure)", () => {
    // If this test ever needs changing, someone has given a rate a default.
    // A tariff is config: an absent row must fail loudly rather than price a
    // ride at zero.
    const { baseCents: _omitted, ...withoutBase } = base;
    const result = rideTariffSchema.safeParse(withoutBase);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("baseCents"))).toBe(true);
    }
  });

  it("rejects a category outside RIDE_CATEGORIES (failure)", () => {
    expect(rideTariffSchema.safeParse({ ...base, category: "helicopter" }).success).toBe(false);
  });
});
