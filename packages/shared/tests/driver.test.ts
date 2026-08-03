import { describe, expect, it } from "vitest";
import { driverProfileSchema } from "../src/schemas/driver";
import { resolveCommissionPct } from "../src/commission";
import { platformConfigSchema } from "../src/schemas/platform-config";

const uuid = "8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f";
const config15 = platformConfigSchema.parse({
  id: uuid,
  cityId: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  commissionPct: 15,
  updatedAt: "2026-08-03T09:00:00.000Z",
});

describe("driverProfileSchema", () => {
  it("parses a minimal profile with its defaults (expected)", () => {
    const parsed = driverProfileSchema.parse({ userId: uuid });
    expect(parsed.status).toBe("offline");
    expect(parsed.spokenLanguages).toEqual(["lv"]);
    expect(parsed.balanceCents).toBe(0);
    expect(parsed.commissionPctOverride).toBeNull();
    expect(parsed.fleetId).toBeNull();
  });

  it("allows a negative balance — it is a signed ledger, not a counter (edge)", () => {
    // Guards the money-primitive choice: `balanceCents` is `centsSchema`
    // (signed), NOT `nonNegativeCentsSchema`. A swap would silently break the
    // documented "negative blocks new rides" behaviour, since the state could
    // never be reached. Same failure class as the `discountCents` sign guard.
    const parsed = driverProfileSchema.parse({ userId: uuid, balanceCents: -1250 });
    expect(parsed.balanceCents).toBe(-1250);
  });

  it("carries a 0% override into the resolver (edge — S6-7, Atis's pilot)", () => {
    // 0 must survive both the schema default (`.default(null)` must not swallow
    // it) and the resolver's `!= null` check.
    const parsed = driverProfileSchema.parse({ userId: uuid, commissionPctOverride: 0 });
    expect(parsed.commissionPctOverride).toBe(0);
    expect(resolveCommissionPct(parsed, config15)).toEqual({ pct: 0, source: "driver_override" });
  });

  it("satisfies CommissionDriverInput structurally (edge — the #27 seam)", () => {
    const parsed = driverProfileSchema.parse({ userId: uuid, commissionPctOverride: 10 });
    expect(resolveCommissionPct(parsed, config15).source).toBe("driver_override");
  });

  it("rejects a float balance and an out-of-range override (failure)", () => {
    expect(driverProfileSchema.safeParse({ userId: uuid, balanceCents: 12.5 }).success).toBe(false);
    expect(
      driverProfileSchema.safeParse({ userId: uuid, commissionPctOverride: 150 }).success,
    ).toBe(false);
    expect(driverProfileSchema.safeParse({ userId: uuid, rating: 6 }).success).toBe(false);
  });
});
