import { describe, expect, it } from "vitest";
import { splitFare } from "../src/commission";
import { phoneSchema } from "../src/schemas/user";
import {
  assertRideAssignmentConsistent,
  isRideAssignmentConsistent,
  rideAssignmentSchema,
  rideOfferSchema,
  rideRequestSchema,
  rideSchema,
} from "../src/schemas/ride";
import { geozoneQueueSchema, geozoneSchema, queueEntrySchema } from "../src/schemas/geo";

const riga = { lat: 56.9496, lng: 24.1052 };
const uuid = "8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f";
const otherUuid = "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d";

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
  const triangle = [riga, { lat: 56.95, lng: 24.11 }, { lat: 56.96, lng: 24.12 }];

  it("parses a pilot district with its slug (expected)", () => {
    const parsed = geozoneSchema.parse({
      id: uuid,
      cityId: otherUuid,
      slug: "centre",
      name: "Centrs",
      polygon: triangle,
    });
    expect(parsed.slug).toBe("centre");
    expect(parsed.queueModeEnabled).toBe(false);
  });

  it("parses a queue-mode zone with a two-driver queue (edge)", () => {
    const zone = geozoneSchema.parse({
      id: uuid,
      cityId: otherUuid,
      slug: "rix",
      name: "Lidosta RIX",
      polygon: triangle,
      queueModeEnabled: true,
    });
    expect(zone.queueModeEnabled).toBe(true);

    const queue = geozoneQueueSchema.parse({
      geozoneId: uuid,
      updatedAt: "2026-08-03T10:00:00.000Z",
      entries: [
        { driverId: uuid, geozoneId: uuid, position: 1, joinedAt: "2026-08-03T09:40:00.000Z" },
        { driverId: otherUuid, geozoneId: uuid, position: 2, joinedAt: "2026-08-03T09:50:00.000Z" },
      ],
    });
    expect(queue.entries).toHaveLength(2);
    expect(queue.entries[0]!.position).toBe(1);
  });

  it("rejects a polygon with fewer than 3 vertices (failure)", () => {
    const result = geozoneSchema.safeParse({
      id: "8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f",
      cityId: "8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f",
      name: "Centrs",
      polygon: [riga, { lat: 56.95, lng: 24.11 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a queue position of 0 — positions are 1-based (failure)", () => {
    const result = queueEntrySchema.safeParse({
      driverId: uuid,
      geozoneId: uuid,
      position: 0,
      joinedAt: "2026-08-03T09:40:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

const quote = {
  model: "upfront_fixed",
  currency: "EUR",
  totalCents: 2000,
  breakdown: { baseCents: 300, distanceCents: 1400, timeCents: 300 },
};

describe("rideOfferSchema", () => {
  const base = {
    id: uuid,
    rideId: otherUuid,
    driverId: uuid,
    status: "pending",
    source: "auto_match",
    sentAt: "2026-08-03T10:00:00.000Z",
    expiresAt: "2026-08-03T10:00:20.000Z",
    etaSeconds: 240,
    pickup: { location: riga, address: "Brīvības iela 1, Rīga" },
    destination: { location: { lat: 56.9236, lng: 23.9711 }, address: "Lidosta RIX" },
    quote,
    split: splitFare(2000, { pct: 15, source: "platform_base" }),
  };

  it("parses a full offer carrying both the fare and the split (expected)", () => {
    const parsed = rideOfferSchema.parse(base);
    // The transparency wedge: the driver sees what the rider pays AND the cut.
    expect(parsed.quote.totalCents).toBe(2000);
    expect(parsed.split.commissionCents + parsed.split.driverNetCents).toBe(2000);
    expect(parsed.split.driverNetCents).toBe(1700);
    expect(parsed.quote.breakdown.discountCents).toBe(0);
    expect(parsed.expiresAt).toBeInstanceOf(Date);
  });

  it("keeps the discount line non-positive after the money-primitive swap (failure)", () => {
    // Guards the fareQuoteSchema substitutions: `discountCents` must stay
    // nonpositive. A sign flip here would make a discount ADD to the fare.
    expect(
      rideOfferSchema.safeParse({
        ...base,
        quote: { ...quote, breakdown: { ...quote.breakdown, discountCents: 250 } },
      }).success,
    ).toBe(false);
  });

  it("accepts a queue-sourced offer at the head of the queue (edge)", () => {
    const parsed = rideOfferSchema.parse({ ...base, source: "geozone_queue", queuePosition: 1 });
    expect(parsed.queuePosition).toBe(1);
  });

  it("rejects a queue position of 0 (failure)", () => {
    expect(rideOfferSchema.safeParse({ ...base, queuePosition: 0 }).success).toBe(false);
  });
});

describe("rideAssignmentSchema", () => {
  const base = {
    rideId: uuid,
    driverId: otherUuid,
    assignedAt: "2026-08-03T10:00:05.000Z",
  };

  it("parses an auto-matched assignment with no dispatcher (expected)", () => {
    const parsed = rideAssignmentSchema.parse({ ...base, source: "auto_match" });
    expect(parsed.dispatcherId).toBeNull();
    expect(parsed.reason).toBeNull();
  });

  it("parses a dispatcher override with its audit trail (edge)", () => {
    const parsed = rideAssignmentSchema.parse({
      ...base,
      source: "dispatcher",
      dispatcherId: uuid,
      reason: "Rider called in; nearest driver was declining",
    });
    expect(parsed.dispatcherId).toBe(uuid);
  });

  it("rejects a dispatcher assignment without dispatcherId (failure — the audit rule)", () => {
    expect(rideAssignmentSchema.safeParse({ ...base, source: "dispatcher" }).success).toBe(false);
  });
});

describe("rideSchema", () => {
  const base = {
    id: uuid,
    orderId: otherUuid,
    status: "requested",
    riderId: uuid,
    driverId: null,
    request: {
      riderId: uuid,
      pickup: { location: riga, address: "Brīvības iela 1, Rīga" },
      destination: { location: { lat: 56.9236, lng: 23.9711 }, address: "Lidosta RIX" },
      paymentMethod: "cash",
    },
    quote: null,
    createdAt: "2026-08-03T10:00:00.000Z",
    updatedAt: "2026-08-03T10:00:00.000Z",
  };

  it("parses a fresh ride with assignment, split and geozone defaulting to null (expected)", () => {
    const parsed = rideSchema.parse(base);
    expect(parsed.assignment).toBeNull();
    expect(parsed.split).toBeNull();
    expect(parsed.geozoneId).toBeNull();
  });

  it("is consistent while unassigned, and stays composable (edge)", () => {
    expect(isRideAssignmentConsistent(rideSchema.parse(base))).toBe(true);
    // Locks in the Task 7 decision: `rideSchema` is a plain ZodObject, so #6 can
    // derive Drizzle insert shapes from it. This line stops typechecking if
    // anyone turns it into a ZodEffects with a `.refine()`.
    expect(() => rideSchema.omit({ id: true })).not.toThrow();
  });

  it("throws when assignment.driverId drifts from ride.driverId (failure)", () => {
    const ride = rideSchema.parse({
      ...base,
      status: "accepted",
      driverId: uuid,
      assignment: {
        rideId: uuid,
        driverId: otherUuid, // drifted
        source: "auto_match",
        assignedAt: "2026-08-03T10:00:05.000Z",
      },
    });
    expect(isRideAssignmentConsistent(ride)).toBe(false);
    expect(() => assertRideAssignmentConsistent(ride)).toThrow(/does not match assignment/);
  });
});
