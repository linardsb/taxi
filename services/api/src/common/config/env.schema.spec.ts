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
  // Production refuses the localhost default — every prod() case needs a real
  // one, and since #136 it must also be <= 10 characters of host. The old
  // `track.example.com` (17) is exactly what the new gate refuses.
  PUBLIC_TRACKING_BASE_URL: 'https://sakta.lv',
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

  // Also the #136 case: `localhost:3000` is a 14-character host, over the
  // budget the production gate enforces, and dev and CI must keep booting.
  it('leaves the localhost default alone outside production (expected)', () => {
    const env = envSchema.parse({
      ...base,
      NODE_ENV: 'development',
      JWT_SECRET: 'dev-only-change-me',
    });

    expect(env.PUBLIC_TRACKING_BASE_URL).toBe('http://localhost:3000');
  });

  it('accepts a host inside the SMS budget (expected — #136)', () => {
    const env = envSchema.parse(
      prod({ PUBLIC_TRACKING_BASE_URL: 'https://sakta.lv' }),
    );

    expect(env.PUBLIC_TRACKING_BASE_URL).toBe('https://sakta.lv');
  });

  it('refuses an 11-character host, naming the limit and the reason (failure — #136)', () => {
    // `saktacab.lv` is 11. One character over doubles the SMS bill on every
    // phone-booked ride, because RU driver_assigned has zero spare.
    expect(() =>
      envSchema.parse(
        prod({ PUBLIC_TRACKING_BASE_URL: 'https://saktacab.lv' }),
      ),
    ).toThrow(/host is 11 characters \(saktacab\.lv\); the limit is 10/);
  });

  it('does not count a trailing slash against the budget (edge — #136)', () => {
    // `https://sakta.lv/` is 8 characters of host, not 9. An off-by-one here
    // refuses a domain that actually fits.
    const env = envSchema.parse(
      prod({ PUBLIC_TRACKING_BASE_URL: 'https://sakta.lv/' }),
    );

    expect(env.PUBLIC_TRACKING_BASE_URL).toBe('https://sakta.lv/');
  });

  /**
   * THE SHAPE GATE (#246). Every case below except the last two BOOTED before
   * it existed — `observed` 2026-09-21 at 487570f — because the length check
   * was the only thing judging the value and a short domain leaves room for
   * the junk. The hosts here are deliberately 4-character `s.lv`, not
   * `sakta.lv`: at 8 characters the malformed forms happen to overflow the
   * 10-character budget and get refused for the wrong reason, which is what
   * made this bug look narrower than it is.
   *
   * Read through `safeParse`, not `toThrow`: a thrown `ZodError`'s message is
   * the issue array JSON-stringified, so every quote in it arrives escaped and
   * a pattern written the way the message reads cannot match.
   */
  const refusalMessages = (value: string): string => {
    const parsed = envSchema.safeParse(
      prod({ PUBLIC_TRACKING_BASE_URL: value }),
    );

    if (parsed.success) throw new Error(`${value} was accepted, not refused`);
    return parsed.error.issues.map((i) => i.message).join('\n');
  };

  it.each([
    ['userinfo', 'https://u@s.lv', 'u@s.lv', '@'],
    ['a query', 'https://s.lv?x', 's.lv?x', '?'],
    ['a fragment', 'https://s.lv#f', 's.lv#f', '#'],
  ])(
    'refuses %s in the tracking base URL, naming what the SMS would carry (failure — #246)',
    (_label, configured, carried, breaker) => {
      const messages = refusalMessages(configured);

      expect(messages).toContain(`would put "${carried}" in the rider SMS`);
      expect(messages).toContain(`the "${breaker}" breaks the link`);
    },
  );

  it('refuses the at-ceiling fragment PR #245 found (failure — #246)', () => {
    // `sakta.lv#f` is exactly 10, so the budget gate passed it and riders were
    // texted `sakta.lv#f/r/<token>` — a URL whose fragment swallows the path.
    expect(refusalMessages('https://sakta.lv#f')).toContain(
      'would put "sakta.lv#f" in the rider SMS',
    );
  });

  it('refuses a scheme the link builder does not strip (failure — #246)', () => {
    // 10 characters, so the budget gate accepted it, and the SMS then carried
    // the scheme: `ftp://s.lv/r/<token>`.
    expect(refusalMessages('ftp://s.lv')).toContain(
      'must begin with a lowercase http:// or https://',
    );
  });

  it('refuses an uppercase scheme by name, not by length (failure — #246)', () => {
    // The verdict on this input does NOT change — it was already refused, as
    // 16 characters of "host". The decision #246 records is that the fix is
    // this message rather than an `i` flag on `trackingLinkHost`, which would
    // have made the same input boot.
    expect(refusalMessages('HTTPS://SAKTA.LV')).toContain(
      'must begin with a lowercase http:// or https://',
    );
  });

  it('still accepts an uppercase HOST and a path prefix (expected — #246)', () => {
    // The two shapes the gate must NOT catch. DNS is case-insensitive, so
    // `SAKTA.LV` resolves and its link works; a path prefix is a supported
    // deployment that `trackingLinkHost` preserves on purpose, costed against
    // the budget rather than refused (`https://s.lv/a` is 6 characters).
    expect(
      envSchema.parse(prod({ PUBLIC_TRACKING_BASE_URL: 'https://SAKTA.LV' }))
        .PUBLIC_TRACKING_BASE_URL,
    ).toBe('https://SAKTA.LV');
    expect(
      envSchema.parse(prod({ PUBLIC_TRACKING_BASE_URL: 'https://s.lv/a' }))
        .PUBLIC_TRACKING_BASE_URL,
    ).toBe('https://s.lv/a');
  });

  it('names both faults when a value is malformed AND too long (edge — #246)', () => {
    // No shape check early-returns. One boot, one error, both reasons — an
    // operator who fixes only the query would otherwise hit the length refusal
    // on the next deploy.
    const messages = refusalMessages('https://sakta.lv/app?q=1');

    expect(messages).toContain('breaks the link');
    expect(messages).toContain('the limit is 10');
  });

  /**
   * WHITESPACE, C0 AND DEL — not every invisible character; see the limit
   * named at the end of this block. `new URL()` strips leading and trailing
   * whitespace and C0 controls from its INPUT and removes tab/CR/LF anywhere
   * before parsing, so `.url()` accepts all of these — and zod returns the
   * ORIGINAL string, which `trackingLinkHost` then carries into the SMS
   * intact. `observed` 2026-09-21 at 270bfe4: every row below BOOTED, because
   * the breaker map above lists only characters that are illegal in a host and
   * these are not.
   *
   * The host is quoted JSON-escaped in the refusal for exactly this reason: an
   * operator who hand-writes the host env file (runbook §3) and leaves a
   * trailing space cannot see it in a message that prints it raw.
   *
   * WHAT THIS GATE STILL MISSES, so the heading above is not read as a
   * complete claim: the zero-width format characters. `\s` does not match
   * U+200B or U+00AD, and `new URL()` accepts them and silently DROPS them
   * from the host — `observed` 2026-09-21: `https://sakta.lv\u200bx` parses to
   * hostname `sakta.lvx`, so that value boots at 10 characters and texts a
   * link resolving to a domain the operator does not own. Worse than the
   * truncation this block covers, and NOT fixed here: the one-line form
   * (`/[\s\p{Cf}]/u`) takes `env.schema.ts` from 495 to 499 of its 500-line
   * cap, which is not headroom. Carried on #13 with this evidence.
   */
  it.each([
    ['a trailing space', 'https://sakta.lv ', '"sakta.lv "'],
    ['a tab', 'https://sakta.lv\tx', '"sakta.lv\\tx"'],
    ['a newline', 'https://sakta.lv\nx', '"sakta.lv\\nx"'],
  ])(
    'refuses %s in the tracking base URL (failure — #246)',
    (_label, configured, quoted) => {
      const messages = refusalMessages(configured);

      expect(messages).toContain(`would put ${quoted} in the rider SMS`);
      expect(messages).toContain('every SMS linkifier ends the link there');
    },
  );

  it('refuses whitespace in the path prefix too (edge — #246)', () => {
    // The space does not have to be in the domain. `s.lv/a b` is 8 characters
    // and a legal `new URL()`, and the linkifier still ends the link at the
    // space — the rider taps `s.lv/a` and the token never travels.
    expect(refusalMessages('https://s.lv/a b')).toContain(
      'every SMS linkifier ends the link there',
    );
  });

  it('refuses a backslash by name, like the other breakers (failure — #246)', () => {
    // 6 characters, so the budget gate accepted it. A backslash gets its own
    // entry rather than the whitespace catch-all because it has its own
    // reason: it is not whitespace, and what it does depends on the linkifier.
    const messages = refusalMessages('https://s.lv\\x');

    expect(messages).toContain('would put "s.lv\\x" in the rider SMS');
    expect(messages).toContain('the "\\" breaks the link');
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

  it('reads a blanked line as unset rather than refusing to boot (edge — #242)', () => {
    // A blanked `PUSH_PROVIDER=` line delivers '', and `.default()`
    // substitutes `undefined` only — so un-wrapped this refused to boot in
    // EVERY environment with zod's generic enum message, naming no remedy.
    // The blank now reads as unset, exactly as it does for
    // ALLOW_STUB_MAPS_PROVIDER and SMS_PROVIDER. Production is NOT relaxed by
    // that: `stub` is the value `pushProviderFactory` refuses, so the blank
    // costs the operator the factory's own named message, not the gate.
    expect(envSchema.parse(dev({ PUSH_PROVIDER: '' })).PUSH_PROVIDER).toBe(
      'stub',
    );
    expect(envSchema.parse(prod({ PUSH_PROVIDER: '' })).PUSH_PROVIDER).toBe(
      'stub',
    );
  });

  it('refuses a provider it does not know (failure)', () => {
    // The factory switches on this value; an unknown one would silently
    // bind the stub in production and deliver no nudges.
    expect(() => envSchema.parse(dev({ PUSH_PROVIDER: 'fcm' }))).toThrow();
  });
});

describe('envSchema NODE_ENV (#242)', () => {
  it('refuses a blanked line rather than falling back to development (failure)', () => {
    // The deliberate EXCEPTION to the blank-means-unset rule the three
    // provider switches carry, and the reason the rule is conditional rather
    // than universal: `development` is the default that makes the
    // `NODE_ENV !== 'production'` gate skip every secret check and every
    // factory refusal. A wrapper here would boot a real host with the gates
    // off on one stray keystroke, so the generic refusal is the right answer
    // for this one field. A future consistency pass must not "fix" it.
    expect(() => envSchema.parse(prod({ NODE_ENV: '' }))).toThrow();
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
