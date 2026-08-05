import { envSchema } from './env.schema';

/**
 * The two secrets are what stands between a `cp .env.example .env` and an
 * attacker minting `admin` tokens: `RolesGuard` reads `role` off the token and
 * never re-checks the database, and nothing revokes a 30-day token early.
 * These cases pin the boot-time refusal, not the parse.
 */

/** Distinct 32+ char values — what `openssl rand -hex 32` would produce. */
const STRONG_JWT = 'a'.repeat(16) + 'b'.repeat(16);
const STRONG_PEPPER = 'c'.repeat(16) + 'd'.repeat(16);

const base = {
  DATABASE_URL: 'postgres://taxi:taxi@localhost:5432/taxi',
  REDIS_URL: 'redis://localhost:6379',
};

const prod = (over: Record<string, string> = {}) => ({
  ...base,
  NODE_ENV: 'production',
  JWT_SECRET: STRONG_JWT,
  OTP_PEPPER: STRONG_PEPPER,
  ...over,
});

describe('envSchema production secret rules', () => {
  it('accepts two distinct strong secrets (expected)', () => {
    const env = envSchema.parse(prod());

    expect(env.JWT_SECRET).toBe(STRONG_JWT);
    expect(env.OTP_PEPPER).toBe(STRONG_PEPPER);
  });

  it('refuses the secrets committed to .env.example (failure)', () => {
    // The exact value at .env.example:16 — 18 chars, so the old `.min(16)`
    // accepted it and a copied example file booted a real host.
    expect(() =>
      envSchema.parse(prod({ JWT_SECRET: 'dev-only-change-me' })),
    ).toThrow(/JWT_SECRET is the value committed to \.env\.example/);

    expect(() =>
      envSchema.parse(prod({ OTP_PEPPER: 'dev-only-otp-pepper' })),
    ).toThrow(/OTP_PEPPER is the value committed to \.env\.example/);
  });

  it('refuses a secret one character under the floor (edge)', () => {
    expect(() => envSchema.parse(prod({ JWT_SECRET: 'z'.repeat(31) }))).toThrow(
      /JWT_SECRET must be at least 32 characters in production \(got 31\)/,
    );
    // …and accepts it at exactly the floor, so the boundary is pinned on both
    // sides rather than by a rule that happens to reject everything.
    expect(
      envSchema.parse(prod({ JWT_SECRET: 'z'.repeat(32) })).JWT_SECRET,
    ).toHaveLength(32);
  });

  it('refuses one value used as both secrets (failure)', () => {
    // Both are strong and neither is published, so only the equality check can
    // catch this — and without it, OTP_PEPPER buys nothing: rotating the
    // signing key would silently invalidate every OTP in flight again.
    expect(() =>
      envSchema.parse(prod({ JWT_SECRET: STRONG_JWT, OTP_PEPPER: STRONG_JWT })),
    ).toThrow(/OTP_PEPPER must differ from JWT_SECRET/);
  });

  it('leaves development and test alone (edge)', () => {
    // Dev and CI run on short, shared, committed values on purpose. A rule that
    // blocked them would be turned off, and then it would protect nothing.
    for (const NODE_ENV of ['development', 'test']) {
      const env = envSchema.parse({
        ...base,
        NODE_ENV,
        JWT_SECRET: 'dev-only-change-me',
      });
      expect(env.JWT_SECRET).toBe('dev-only-change-me');
      expect(env.OTP_PEPPER).toBe('dev-only-otp-pepper'); // the schema default
    }
  });
});
