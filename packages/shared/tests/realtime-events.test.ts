import { describe, expect, it } from "vitest";
import {
  RT,
  dispatchRoom,
  driverLocationEventSchema,
  driverLocationPingSchema,
  driverRoom,
  rideRoom,
  rideStatusEventSchema,
} from "../src/realtime-events";

const riga = { lat: 56.9496, lng: 24.1052 };
const uuid = "8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f";
const at = "2026-08-03T10:00:00.000Z";

describe("socket payloads", () => {
  it("parses a driver location event and a ride status event (expected)", () => {
    const location = driverLocationEventSchema.parse({ driverId: uuid, location: riga, at });
    expect(location.driverId).toBe(uuid);

    const status = rideStatusEventSchema.parse({
      rideId: uuid,
      orderId: uuid,
      status: "accepted",
      previousStatus: "offered",
      at,
    });
    expect(status.previousStatus).toBe("offered");
    expect(status.reason).toBeNull();
  });

  it("drops a client-supplied driverId from an inbound ping (edge — spoofing guard)", () => {
    const parsed = driverLocationPingSchema.parse({ driverId: "someone-else", location: riga, at });
    expect(parsed).not.toHaveProperty("driverId");
  });

  it("builds room names through the helpers (edge)", () => {
    expect(rideRoom(uuid)).toBe(`ride:${uuid}`);
    expect(driverRoom(uuid)).toBe(`driver:${uuid}`);
    expect(dispatchRoom(uuid)).toBe(`dispatch:${uuid}`);
  });

  it("rejects a bad latitude and a non-ISO timestamp (failure)", () => {
    expect(
      driverLocationPingSchema.safeParse({ location: { lat: 91, lng: 0 }, at: "not-a-date" }).success,
    ).toBe(false);
  });
});

describe("RT catalog", () => {
  it("carries exactly the 8 wired events, each domain:action (completeness)", () => {
    // Hand-listed on purpose: adding a 9th event without wiring it into the
    // direction maps and .claude/references/realtime-events.md must fail here.
    const wired = [
      "driver:location",
      "driver:queue",
      "ride:status",
      "ride:offer",
      "ride:offer_revoked",
      "ride:assigned",
      "dispatch:board",
      "dispatch:unclaimed",
    ];
    const names: string[] = Object.values(RT);
    expect(names).toHaveLength(8);
    expect([...names].sort()).toEqual([...wired].sort());
    for (const name of names) expect(name).toMatch(/^[a-z]+:[a-z_]+$/);
  });
});
