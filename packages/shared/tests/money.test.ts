import { describe, expect, it } from "vitest";
import {
  centsSchema,
  commissionCentsFor,
  commissionPctSchema,
  nonNegativeCentsSchema,
  nonPositiveCentsSchema,
} from "../src/money";

describe("cent primitives", () => {
  it("parses whole cents, signed and unsigned (expected)", () => {
    expect(nonNegativeCentsSchema.parse(1250)).toBe(1250);
    expect(centsSchema.parse(-500)).toBe(-500); // ledger / negative driver balance
    expect(nonPositiveCentsSchema.parse(-250)).toBe(-250); // shared-ride discount
  });

  it("handles the zero cases without dividing by anything (edge)", () => {
    expect(commissionCentsFor(0, 15)).toBe(0);
    expect(commissionCentsFor(1000, 0)).toBe(0);
  });

  it("rejects floats and out-of-range values (failure)", () => {
    expect(nonNegativeCentsSchema.safeParse(-1).success).toBe(false);
    // Floats are the rule this module exists to enforce.
    expect(centsSchema.safeParse(12.5).success).toBe(false);
    expect(commissionPctSchema.safeParse(101).success).toBe(false);
    expect(commissionPctSchema.safeParse(-1).success).toBe(false);
  });
});
