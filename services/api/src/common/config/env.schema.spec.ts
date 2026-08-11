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
  // Production refuses the localhost default — every prod() case needs a real one.
  PUBLIC_TRACKING_BASE_URL: 'https://track.example.com',
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

describe('envSchema PUBLIC_TRACKING_BASE_URL', () => {
  it('refuses its own localhost default in production (failure — review L3)', () => {
    // The forgot-to-set-it deploy: the schema default IS the refused value, so
    // this is exactly what would otherwise be texted to real riders.
    const { PUBLIC_TRACKING_BASE_URL: _omitted, ...forgotToSetIt } = prod();

    expect(() => envSchema.parse(forgotToSetIt)).toThrow(
      /PUBLIC_TRACKING_BASE_URL is a localhost origin/,
    );
  });

  it('refuses loopback spelled as an IP (edge)', () => {
    expect(() =>
      envSchema.parse(
        prod({ PUBLIC_TRACKING_BASE_URL: 'http://127.0.0.1:3000' }),
      ),
    ).toThrow(/PUBLIC_TRACKING_BASE_URL is a localhost origin/);
  });

  it('leaves the localhost default alone outside production (expected)', () => {
    const env = envSchema.parse({
      ...base,
      NODE_ENV: 'development',
      JWT_SECRET: 'dev-only-change-me',
    });

    expect(env.PUBLIC_TRACKING_BASE_URL).toBe('http://localhost:3000');
  });
});

describe('envSchema STRIPE_SECRET_KEY', () => {
  it('accepts a test-mode key (expected)', () => {
    const env = envSchema.parse(prod({ STRIPE_SECRET_KEY: 'sk_test_abc123' }));

    expect(env.STRIPE_SECRET_KEY).toBe('sk_test_abc123');
  });

  it.each([
    ['absent', {}],
    ['empty, as in .env.example', { STRIPE_SECRET_KEY: '' }],
    // The empty-string case is the COMMON one: `.env.example` ships
    // `STRIPE_SECRET_KEY=`, and a schema that rejected it would make a fresh
    // checkout fail to boot.
  ])(
    'reads %s as undefined so the stub binds instead (edge)',
    (_label, over) => {
      const env = envSchema.parse({
        ...base,
        NODE_ENV: 'development',
        JWT_SECRET: STRONG_JWT,
        ...over,
      });

      expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    },
  );

  it.each(['production', 'development', 'test'])(
    'refuses a live-mode key in %s (failure)',
    (NODE_ENV) => {
      // UNCONDITIONAL, unlike the secret-length checks: "Stripe stays in test
      // mode until the SIA exists" is a legal-entity fact, not an environment
      // convention, so there is no environment in which a live key is right.
      expect(() =>
        envSchema.parse({
          ...base,
          NODE_ENV,
          JWT_SECRET: STRONG_JWT,
          OTP_PEPPER: STRONG_PEPPER,
          STRIPE_SECRET_KEY: 'sk_live_realmoney',
        }),
      ).toThrow(/must be a test-mode key/);
    },
  );
});

describe('envSchema TWILIO_*', () => {
  const trio = {
    TWILIO_ACCOUNT_SID: 'AC' + 'f'.repeat(32),
    TWILIO_AUTH_TOKEN: 'g'.repeat(32),
    TWILIO_FROM_NUMBER: '+37120000000',
  };

  const dev = (over: Record<string, string> = {}) => ({
    ...base,
    NODE_ENV: 'development',
    JWT_SECRET: STRONG_JWT,
    ...over,
  });

  it('parses the full trio with values retained, in dev and production (expected)', () => {
    for (const parsed of [
      envSchema.parse(dev(trio)),
      envSchema.parse(prod(trio)),
    ]) {
      expect(parsed.TWILIO_ACCOUNT_SID).toBe(trio.TWILIO_ACCOUNT_SID);
      expect(parsed.TWILIO_AUTH_TOKEN).toBe(trio.TWILIO_AUTH_TOKEN);
      expect(parsed.TWILIO_FROM_NUMBER).toBe(trio.TWILIO_FROM_NUMBER);
    }
  });

  it('reads the empty strings committed to .env.example as undefined so the stub binds (edge)', () => {
    const env = envSchema.parse(
      dev({
        TWILIO_ACCOUNT_SID: '',
        TWILIO_AUTH_TOKEN: '',
        TWILIO_FROM_NUMBER: '',
      }),
    );

    expect(env.TWILIO_ACCOUNT_SID).toBeUndefined();
    expect(env.TWILIO_AUTH_TOKEN).toBeUndefined();
    expect(env.TWILIO_FROM_NUMBER).toBeUndefined();
  });

  it('refuses an Account SID without the AC prefix (failure)', () => {
    // An API key (SK…) or the auth token pasted into the SID slot fails here,
    // at boot, instead of as a 401 on the first send.
    expect(() =>
      envSchema.parse(
        prod({ ...trio, TWILIO_ACCOUNT_SID: 'SK' + 'f'.repeat(32) }),
      ),
    ).toThrow(/TWILIO_ACCOUNT_SID must start with AC/);
  });

  it('refuses a partial trio, naming each missing key (failure)', () => {
    // In EVERY environment, not just production: a partial trio in dev
    // silently binds the stub while you think you are testing Twilio.
    expect(() =>
      envSchema.parse(dev({ TWILIO_ACCOUNT_SID: trio.TWILIO_ACCOUNT_SID })),
    ).toThrow(
      /TWILIO_AUTH_TOKEN is missing[\s\S]*TWILIO_FROM_NUMBER is missing/,
    );

    expect(() =>
      envSchema.parse(
        prod({
          TWILIO_AUTH_TOKEN: trio.TWILIO_AUTH_TOKEN,
          TWILIO_FROM_NUMBER: trio.TWILIO_FROM_NUMBER,
        }),
      ),
    ).toThrow(/TWILIO_ACCOUNT_SID is missing/);
  });

  it('accepts an alphanumeric sender ID and refuses malformed senders (edge)', () => {
    expect(
      envSchema.parse(prod({ ...trio, TWILIO_FROM_NUMBER: 'SaktaCab' }))
        .TWILIO_FROM_NUMBER,
    ).toBe('SaktaCab');

    // One char over Twilio's 11-char alphanumeric limit.
    expect(() =>
      envSchema.parse(prod({ ...trio, TWILIO_FROM_NUMBER: 'SaktaCabRiga' })),
    ).toThrow(/TWILIO_FROM_NUMBER must be an E\.164 number/);

    // Digits without a leading + are neither E.164 nor alphanumeric (no letter).
    expect(() =>
      envSchema.parse(prod({ ...trio, TWILIO_FROM_NUMBER: '37120000000' })),
    ).toThrow(/TWILIO_FROM_NUMBER must be an E\.164 number/);
  });
});

describe('envSchema MAPS_ETA_FAILURE_TTL_SECONDS', () => {
  it('accepts 0 as the negative cache kill switch (edge — review L4)', () => {
    // `CachingMapsProvider` reads `failureTtlSeconds > 0` as the switch, and
    // the `quote` facade is built with a literal 0. `.positive()` would leave
    // the `eta` facade with a code-level kill switch and no config-level one,
    // so turning it off against a misbehaving provider would need a deploy.
    expect(
      envSchema.parse(prod({ MAPS_ETA_FAILURE_TTL_SECONDS: '0' }))
        .MAPS_ETA_FAILURE_TTL_SECONDS,
    ).toBe(0);
  });

  it('still refuses a negative TTL, and defaults to 60 (failure)', () => {
    expect(() =>
      envSchema.parse(prod({ MAPS_ETA_FAILURE_TTL_SECONDS: '-1' })),
    ).toThrow();

    expect(envSchema.parse(prod()).MAPS_ETA_FAILURE_TTL_SECONDS).toBe(60);
  });
});
