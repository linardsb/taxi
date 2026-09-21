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
    // The exact value `.env.example` commits for JWT_SECRET — 18 chars, so
    // `.min(16)` alone accepted it and a copied example file booted a real host.
    // Named, not line-pinned: the line moves whenever that file is edited.
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

describe('envSchema ALLOW_STUB_MAPS_PROVIDER', () => {
  it('defaults to false, so the production maps gate is untouched unless asked (expected)', () => {
    // The forgot-to-set-it deploy must land on the OLD behaviour — refuse to
    // boot on the stub — not silently on the relaxed one.
    expect(envSchema.parse(prod()).ALLOW_STUB_MAPS_PROVIDER).toBe(false);
    expect(
      envSchema.parse(prod({ ALLOW_STUB_MAPS_PROVIDER: 'false' }))
        .ALLOW_STUB_MAPS_PROVIDER,
    ).toBe(false);
  });

  it('reads the literal string "true" as true (edge)', () => {
    expect(
      envSchema.parse(prod({ ALLOW_STUB_MAPS_PROVIDER: 'true' }))
        .ALLOW_STUB_MAPS_PROVIDER,
    ).toBe(true);
  });

  it('reads an empty value as unset, like every optional sibling (edge — review F7)', () => {
    // A blanked line in a hand-written env file delivers '', and `.default()`
    // substitutes `undefined` only. Production must still refuse to boot — but
    // through the maps gate's own message, not a generic enum error — and dev
    // and test must not refuse at all. Same shape as GOOGLE_MAPS_API_KEY and
    // the Twilio trio: '' is unset.
    expect(
      envSchema.parse(prod({ ALLOW_STUB_MAPS_PROVIDER: '' }))
        .ALLOW_STUB_MAPS_PROVIDER,
    ).toBe(false);
    expect(
      envSchema.parse({
        ...base,
        NODE_ENV: 'development',
        JWT_SECRET: STRONG_JWT,
        ALLOW_STUB_MAPS_PROVIDER: '',
      }).ALLOW_STUB_MAPS_PROVIDER,
    ).toBe(false);
  });

  it.each(['1', 'yes', 'TRUE', 'on'])(
    'refuses %s rather than guessing (failure)',
    (value) => {
      // `z.coerce.boolean()` would take every one of these as true — and the
      // string "false" too. An operator who typed one gets a boot error naming
      // the variable, not a stub bound by accident.
      expect(() =>
        envSchema.parse(prod({ ALLOW_STUB_MAPS_PROVIDER: value })),
      ).toThrow();
    },
  );
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

describe('envSchema PUSH_PROVIDER (#14)', () => {
  const dev = (over: Record<string, string> = {}) => ({
    ...base,
    NODE_ENV: 'development',
    JWT_SECRET: STRONG_JWT,
    ...over,
  });

  it('defaults to the stub with no access token (expected)', () => {
    const env = envSchema.parse(dev());

    expect(env.PUSH_PROVIDER).toBe('stub');
    expect(env.EXPO_PUSH_ACCESS_TOKEN).toBeUndefined();
  });

  it('parses expo and reads the empty access token committed to the env template as undefined (edge)', () => {
    const env = envSchema.parse(
      dev({ PUSH_PROVIDER: 'expo', EXPO_PUSH_ACCESS_TOKEN: '' }),
    );

    expect(env.PUSH_PROVIDER).toBe('expo');
    expect(env.EXPO_PUSH_ACCESS_TOKEN).toBeUndefined();
  });

  it('refuses a provider it does not know (failure)', () => {
    // The factory switches on this value; an unknown one would silently
    // bind the stub in production and deliver no nudges.
    expect(() => envSchema.parse(dev({ PUSH_PROVIDER: 'fcm' }))).toThrow();
  });
});

describe('envSchema SMS_PROVIDER and the bake-off credential groups (#137)', () => {
  const dev = (over: Record<string, string> = {}) => ({
    ...base,
    NODE_ENV: 'development',
    JWT_SECRET: STRONG_JWT,
    OTP_PEPPER: STRONG_PEPPER,
    ...over,
  });

  const bulkgate = {
    BULKGATE_APPLICATION_ID: '12345',
    BULKGATE_APPLICATION_TOKEN: 'h'.repeat(32),
    BULKGATE_SENDER_ID_VALUE: 'SaktaCab',
  };

  const budgetsms = {
    BUDGETSMS_USERNAME: 'saktacab',
    BUDGETSMS_USERID: '123456',
    BUDGETSMS_HANDLE: 'i'.repeat(32),
    BUDGETSMS_FROM: 'SaktaCab',
  };

  it('defaults to stub and accepts a checkout with no SMS credentials at all (expected)', () => {
    // A fresh clone and the committed `.env.example` both look like this.
    // `stub` is a NAMED kind rather than an inference, mirroring
    // `PUSH_PROVIDER` — it demands no credential group, and the factory
    // refuses it under `NODE_ENV=production`.
    const env = envSchema.parse(dev());

    expect(env.SMS_PROVIDER).toBe('stub');
    expect(env.BULKGATE_APPLICATION_ID).toBeUndefined();
    expect(env.BUDGETSMS_FROM).toBeUndefined();
  });

  it('refuses the retired `auto` with a message naming the migration (failure)', () => {
    // The one invalid value a real deploy will actually contain: #240 shipped
    // `SMS_PROVIDER=auto` in the committed template, so every env file copied
    // from it carries it. zod's own text ("Invalid enum value. Expected …")
    // says what is legal and nothing about what to do, which is the whole
    // reason for a custom `message` — and an untested custom message is one
    // refactor away from silently reverting to the generic one.
    expect(() => envSchema.parse(dev({ SMS_PROVIDER: 'auto' }))).toThrow(
      /'auto' was retired \(#137\)/,
    );

    // The message has to be true for EVERY rejected value, not only `'auto'`
    // — a custom `message` replaces zod's whole string, so this case gets it
    // too. Constraint first is what makes it honest here.
    expect(() => envSchema.parse(dev({ SMS_PROVIDER: 'vonage' }))).toThrow(
      /SMS_PROVIDER must be one of: stub \| twilio \| bulkgate \| budgetsms/,
    );
  });

  it('parses each full group with values retained, and reads empty lines as unset (expected)', () => {
    const parsed = envSchema.parse(
      dev({ ...bulkgate, ...budgetsms, SMS_PROVIDER: 'budgetsms' }),
    );

    expect(parsed.BULKGATE_SENDER_ID_VALUE).toBe('SaktaCab');
    expect(parsed.BUDGETSMS_USERID).toBe('123456');
    expect(parsed.SMS_PROVIDER).toBe('budgetsms');

    // The `.env.example` template commits all seven keys empty.
    const blank = envSchema.parse(
      dev({
        BULKGATE_APPLICATION_ID: '',
        BULKGATE_APPLICATION_TOKEN: '',
        BULKGATE_SENDER_ID_VALUE: '',
        BUDGETSMS_USERNAME: '',
        BUDGETSMS_USERID: '',
        BUDGETSMS_HANDLE: '',
        BUDGETSMS_FROM: '',
      }),
    );
    expect(blank.BULKGATE_APPLICATION_TOKEN).toBeUndefined();
    expect(blank.BUDGETSMS_HANDLE).toBeUndefined();
  });

  it('reads a blanked SMS_PROVIDER line as unset rather than refusing to boot (edge)', () => {
    // The seven credential keys above all carry the `'' -> undefined`
    // transform; the SELECTOR is an enum with `.default()`, which fires on
    // `undefined` only. Without the preprocess, `SMS_PROVIDER=` — a line
    // blanked in a hand-edited env file rather than deleted — would be `''`
    // and refuse to boot in EVERY environment with a generic enum message.
    expect(envSchema.parse(dev({ SMS_PROVIDER: '' })).SMS_PROVIDER).toBe(
      'stub',
    );
    // And the widening stops there: an unknown kind is still rejected.
    expect(() => envSchema.parse(dev({ SMS_PROVIDER: '  ' }))).toThrow();
  });

  it('refuses a named kind whose credential group is absent (failure)', () => {
    // Without this the factory's non-null assertions would be the only thing
    // between a typo and `new BulkGateSmsProvider({ applicationId: undefined })`.
    expect(() => envSchema.parse(dev({ SMS_PROVIDER: 'bulkgate' }))).toThrow(
      /SMS_PROVIDER=bulkgate needs BULKGATE_APPLICATION_ID, BULKGATE_APPLICATION_TOKEN, BULKGATE_SENDER_ID_VALUE/,
    );

    // A named kind with SOMEONE ELSE'S group funded is the bake-off's own
    // misconfiguration, and it fails for the same reason.
    expect(() =>
      envSchema.parse(dev({ ...bulkgate, SMS_PROVIDER: 'budgetsms' })),
    ).toThrow(/SMS_PROVIDER=budgetsms needs BUDGETSMS_USERNAME/);
  });

  it('accepts a named kind once its whole group is present (expected)', () => {
    expect(
      envSchema.parse(dev({ ...bulkgate, SMS_PROVIDER: 'bulkgate' }))
        .SMS_PROVIDER,
    ).toBe('bulkgate');

    expect(
      envSchema.parse(
        prod({
          TWILIO_ACCOUNT_SID: 'AC' + 'f'.repeat(32),
          TWILIO_AUTH_TOKEN: 'g'.repeat(32),
          TWILIO_FROM_NUMBER: '+37120000000',
          SMS_PROVIDER: 'twilio',
        }),
      ).SMS_PROVIDER,
    ).toBe('twilio');
  });

  it('refuses a partial BUDGETSMS group — four keys, not three — in every environment (failure)', () => {
    // The group the generalised all-or-none check exists for: hardcoding a
    // trio would have let the fourth key go missing silently.
    expect(() =>
      envSchema.parse(
        dev({
          BUDGETSMS_USERNAME: budgetsms.BUDGETSMS_USERNAME,
          BUDGETSMS_USERID: budgetsms.BUDGETSMS_USERID,
          BUDGETSMS_HANDLE: budgetsms.BUDGETSMS_HANDLE,
        }),
      ),
    ).toThrow(
      /BUDGETSMS_FROM is missing: BUDGETSMS_\* must be set all together or not at all/,
    );

    expect(() =>
      envSchema.parse(
        prod({ BULKGATE_APPLICATION_ID: bulkgate.BULKGATE_APPLICATION_ID }),
      ),
    ).toThrow(
      /BULKGATE_APPLICATION_TOKEN is missing[\s\S]*BULKGATE_SENDER_ID_VALUE is missing/,
    );
  });

  it('holds BUDGETSMS_FROM to a stricter shape than TWILIO_FROM_NUMBER (edge)', () => {
    // `Sakta Cab` clears the Twilio refine, which permits a space. BudgetSMS
    // §2 allows [a-z][A-Z][0-9] only, and a space earns a 2003/2004 at send
    // time — so it has to fail at boot instead.
    expect(
      envSchema.parse(
        prod({
          TWILIO_ACCOUNT_SID: 'AC' + 'f'.repeat(32),
          TWILIO_AUTH_TOKEN: 'g'.repeat(32),
          TWILIO_FROM_NUMBER: 'Sakta Cab',
        }),
      ).TWILIO_FROM_NUMBER,
    ).toBe('Sakta Cab');

    expect(() =>
      envSchema.parse(dev({ ...budgetsms, BUDGETSMS_FROM: 'Sakta Cab' })),
    ).toThrow(/BUDGETSMS_FROM must be alphanumeric with no spaces/);

    // BulkGate's own sender, by contrast, is the Twilio alphanumeric shape
    // minus the E.164 alternative — a bare number is not a `gText` sender.
    expect(() =>
      envSchema.parse(dev({ ...bulkgate, BULKGATE_SENDER_ID_VALUE: '37167' })),
    ).toThrow(/BULKGATE_SENDER_ID_VALUE must be an alphanumeric sender ID/);
  });

  it('refuses a non-numeric BUDGETSMS_USERID and an unknown SMS_PROVIDER (failure)', () => {
    // The username pasted into the userid slot fails here, at boot, rather
    // than as a 2001 on the first send.
    expect(() =>
      envSchema.parse(dev({ ...budgetsms, BUDGETSMS_USERID: 'saktacab' })),
    ).toThrow(/BUDGETSMS_USERID must be numeric/);

    expect(() => envSchema.parse(dev({ SMS_PROVIDER: 'vonage' }))).toThrow();
  });
});
