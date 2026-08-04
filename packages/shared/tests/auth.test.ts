import { describe, expect, it } from "vitest";
import {
  authSessionSchema,
  jwtClaimsSchema,
  otpRequestSchema,
  otpVerifySchema,
} from "../src/schemas/auth";
import { RT, RT_EVENT_SCHEMAS } from "../src/realtime-events";

const uuid = "8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f";
const phone = "+37126123456";
const at = "2026-08-03T10:00:00.000Z";

describe("otpRequestSchema", () => {
  it("parses an E.164 phone with a signup role (expected)", () => {
    const parsed = otpRequestSchema.parse({ phone, role: "driver" });
    expect(parsed).toEqual({ phone, role: "driver" });
  });

  it("rejects a national-format phone number (failure)", () => {
    expect(otpRequestSchema.safeParse({ phone: "26123456", role: "rider" }).success).toBe(false);
  });

  it("rejects role 'admin' — privilege escalation blocked at the contract (failure)", () => {
    expect(otpRequestSchema.safeParse({ phone, role: "admin" }).success).toBe(false);
    expect(otpRequestSchema.safeParse({ phone, role: "dispatcher" }).success).toBe(false);
  });
});

describe("otpVerifySchema", () => {
  it("parses a 6-digit code (expected)", () => {
    expect(otpVerifySchema.parse({ phone, code: "012345" }).code).toBe("012345");
  });

  it("rejects a 5-digit code and a non-numeric one (failure)", () => {
    expect(otpVerifySchema.safeParse({ phone, code: "12345" }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ phone, code: "12345a" }).success).toBe(false);
  });
});

describe("authSessionSchema", () => {
  const session = {
    accessToken: "header.payload.signature",
    expiresAt: at,
    user: { id: uuid, phone, role: "driver", language: "lv", createdAt: at },
  };

  it("parses a session whose user.createdAt is an ISO string (expected)", () => {
    const parsed = authSessionSchema.parse(session);
    expect(parsed.user.createdAt).toBe(at);
  });

  it("rejects a Date where the wire demands an ISO string (edge — wire vs domain)", () => {
    const withDate = { ...session, user: { ...session.user, createdAt: new Date(at) } };
    expect(authSessionSchema.safeParse(withDate).success).toBe(false);
  });
});

describe("jwtClaimsSchema", () => {
  it("parses signed claims (expected) and carries no phone (edge)", () => {
    const claims = jwtClaimsSchema.parse({
      sub: uuid,
      role: "dispatcher",
      iat: 1_800_000_000,
      exp: 1_802_592_000,
      phone,
    });
    expect(claims.role).toBe("dispatcher");
    expect(claims).not.toHaveProperty("phone");
  });

  it("rejects a role outside USER_ROLES (failure)", () => {
    expect(
      jwtClaimsSchema.safeParse({ sub: uuid, role: "superuser", iat: 1, exp: 2 }).success,
    ).toBe(false);
  });
});

describe("RT_EVENT_SCHEMAS", () => {
  // Catalog COVERAGE is a compile-time guarantee: the map is declared
  // `satisfies Record<keyof ServerToClientEvents, z.ZodType>`, so a missing
  // event is a type error, not a test failure. This only smoke-tests that the
  // values are live schemas rather than placeholders.
  it("maps every event to a schema that actually validates (edge)", () => {
    for (const event of Object.values(RT)) {
      expect(RT_EVENT_SCHEMAS[event].safeParse({}).success).toBe(false);
    }
  });

  it("parses a well-formed ride:status payload (expected)", () => {
    const parsed = RT_EVENT_SCHEMAS[RT.rideStatus].parse({
      rideId: uuid,
      orderId: uuid,
      status: "accepted",
      at,
    });
    expect(parsed).toMatchObject({ status: "accepted", at });
  });
});
