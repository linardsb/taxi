import { describe, expect, it } from "vitest";
import { phoneSchema } from "../src/schemas/user";
import { rideRequestSchema } from "../src/schemas/ride";
import { geozoneSchema } from "../src/schemas/geo";

const riga = { lat: 56.9496, lng: 24.1052 };

describe("phoneSchema", () => {
  it("accepts a Latvian mobile in E.164 (expected)", () => {
    expect(phoneSchema.safeParse("+37129123456").success).toBe(true);
  });
  it("accepts a foreign number (edge)", () => {
    expect(phoneSchema.safeParse("+491701234567").success).toBe(true);
  });
  it("rejects local format without country code (failure)", () => {
    expect(phoneSchema.safeParse("29123456").success).toBe(false);
  });
});

describe("rideRequestSchema", () => {
  const base = {
    riderId: "8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f",
    pickup: { location: riga, address: "Brīvības iela 1, Rīga" },
    destination: { location: { lat: 56.9236, lng: 23.9711 }, address: "Lidosta RIX" },
    paymentMethod: "cash",
  };

  it("parses a minimal request with defaults (expected)", () => {
    const parsed = rideRequestSchema.parse(base);
    expect(parsed.category).toBe("standard");
    expect(parsed.vehicleCount).toBe(1);
    expect(parsed.stops).toEqual([]);
    expect(parsed.options.childSeat).toBe(false);
  });

  it("accepts a scheduled multi-taxi order with stops (edge — the differentiators)", () => {
    const parsed = rideRequestSchema.parse({
      ...base,
      stops: [{ location: riga, address: "Autoosta, Rīga" }],
      scheduledFor: "2026-08-01T06:30:00.000Z",
      vehicleCount: 3,
    });
    expect(parsed.vehicleCount).toBe(3);
    expect(parsed.scheduledFor).toBeInstanceOf(Date);
  });

  it("rejects an unknown payment method (failure)", () => {
    expect(rideRequestSchema.safeParse({ ...base, paymentMethod: "crypto" }).success).toBe(false);
  });
});

describe("geozoneSchema", () => {
  it("rejects a polygon with fewer than 3 vertices (failure)", () => {
    const result = geozoneSchema.safeParse({
      id: "8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f",
      cityId: "8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f",
      name: "Centrs",
      polygon: [riga, { lat: 56.95, lng: 24.11 }],
    });
    expect(result.success).toBe(false);
  });
});
