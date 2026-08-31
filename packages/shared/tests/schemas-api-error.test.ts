import { describe, expect, it } from 'vitest';
import { apiErrorBodySchema } from '../src/schemas/api-error';

describe('apiErrorBodySchema — the api error envelope', () => {
  it('parses a bare code, a 429 with retryAfterSeconds and a 400 with issues (expected)', () => {
    expect(
      apiErrorBodySchema.parse({
        statusCode: 409,
        message: 'vehicle_required',
        error: 'Conflict',
      }),
    ).toEqual({ message: 'vehicle_required' });

    expect(
      apiErrorBodySchema.parse({
        message: 'resend_too_soon',
        retryAfterSeconds: 42,
      }),
    ).toEqual({ message: 'resend_too_soon', retryAfterSeconds: 42 });

    expect(
      apiErrorBodySchema.parse({
        message: 'validation_failed',
        issues: [
          { path: ['year'], message: 'Too small' },
          { path: [0, 'x'], message: 'bad' },
        ],
      }).issues,
    ).toHaveLength(2);
  });

  it("keeps Nest's own bodies readable — `Unauthorized` is a string message too (edge)", () => {
    expect(
      apiErrorBodySchema.safeParse({ statusCode: 401, message: 'Unauthorized' })
        .success,
    ).toBe(true);
  });

  it('rejects a body with no string message or a malformed issue — the client reads those as generic (failure)', () => {
    expect(apiErrorBodySchema.safeParse({ statusCode: 500 }).success).toBe(
      false,
    );
    expect(apiErrorBodySchema.safeParse({ message: ['a', 'b'] }).success).toBe(
      false,
    );
    expect(
      apiErrorBodySchema.safeParse({
        message: 'validation_failed',
        issues: [{ path: 'year' }],
      }).success,
    ).toBe(false);
    expect(apiErrorBodySchema.safeParse(null).success).toBe(false);
  });
});
