import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  IDEMPOTENCY_KEY_HEADER,
  idempotencyKeySchema,
} from "../src/idempotency";

describe("idempotency key contract", () => {
  it("round-trips a client-minted uuid (expected)", () => {
    const key = randomUUID();
    expect(idempotencyKeySchema.parse(key)).toBe(key);
  });

  it("names the header in the lowercase Express hands the server (edge)", () => {
    // The controller reads `req.headers[IDEMPOTENCY_KEY_HEADER]`, and Express
    // lowercases every inbound name. "Tidying" this to `Idempotency-Key` makes
    // every request 400 with a missing header; this test is why.
    expect(IDEMPOTENCY_KEY_HEADER).toBe("idempotency-key");
    expect(IDEMPOTENCY_KEY_HEADER).toBe(IDEMPOTENCY_KEY_HEADER.toLowerCase());
  });

  it("rejects low-entropy keys and near-misses (failure)", () => {
    // A constant would collapse every booking a rider ever makes into their
    // first ride — the entropy is the contract, not a formality.
    expect(idempotencyKeySchema.safeParse("").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("book").success).toBe(false);
    // 36 characters, correct shape, not a uuid.
    expect(
      idempotencyKeySchema.safeParse("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
        .success,
    ).toBe(false);
  });
});
