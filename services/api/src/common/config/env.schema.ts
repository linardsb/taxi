import { RIGA_CITY_ID } from '@taxi/db';
import { z } from 'zod';

/**
 * The values committed to `.env.example`. A `cp .env.example .env` that reaches
 * a real host must not boot: `JWT_SECRET` is the whole of the authorization
 * story — `RolesGuard` reads `role` off the token and never re-checks the
 * database — so a published signing key mints `admin` tokens, and the 30-day
 * default expiry with no revocation list means there is no way to cut one short.
 */
const PUBLISHED_SECRETS: readonly string[] = [
  'dev-only-change-me',
  'dev-only-otp-pepper',
];

/** 32 hex chars ≈ 128 bits — `openssl rand -hex 32` clears it with room spare. */
const MIN_PRODUCTION_SECRET_LENGTH = 32;

/** The two independent secrets, checked identically at boot. */
const SECRET_KEYS = ['JWT_SECRET', 'OTP_PEPPER'] as const;

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
    /**
     * Peppers the OTP hash, and NOTHING else. Separate from `JWT_SECRET` on
     * purpose: one secret serving two cryptographic purposes couples their
     * rotation lifecycles, and rotating the signing key would then invalidate
     * every OTP in flight — every user mid-login gets `invalid_or_expired_code`,
     * which by design says nothing, so the outage is indistinguishable from a
     * wrong code and nothing points at the rotation.
     */
    OTP_PEPPER: z
      .string()
      .min(16, 'OTP_PEPPER must be at least 16 characters')
      .default('dev-only-otp-pepper'),
    JWT_EXPIRES_IN: z.string().default('30d'),
    API_PORT: z.coerce.number().int().positive().default(3001),
    /** Single-city pilot; dispatchers join dispatch:<DEFAULT_CITY_ID>. */
    DEFAULT_CITY_ID: z.string().uuid().default(RIGA_CITY_ID),
    /**
     * How long a routed leg stays cached. Routes barely change; durations do —
     * and upfront_fixed prices off a flat estimate anyway, so a stale duration
     * costs cents while an uncached Routes call costs money. This is THE knob
     * behind the <€100/mo guardrail.
     */
    MAPS_ROUTE_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(86_400),
    /**
     * TEST MODE ONLY, structurally. `sk_live_…` is refused at boot: the repo
     * rule is "Stripe stays in test mode until the SIA exists", and spike #5
     * confirms a live platform account needs a legal entity we do not have.
     * Absent (or empty, as in `.env.example`) binds `StubPaymentsProvider`
     * instead, which refuses to boot in production — the same arrangement as
     * SMS and maps.
     *
     * `.optional().transform().refine()` IN THAT ORDER: the refine runs on the
     * transformed value, so the empty string is already `undefined` by the time
     * it is checked. Reordering breaks the `.env.example` case, which is the
     * common one. Deliberately NOT in `SECRET_KEYS`/`PUBLISHED_SECRETS` — those
     * guard length and published-value reuse for OUR secrets; a Stripe key is
     * refused on its prefix instead, which is a stronger check.
     */
    STRIPE_SECRET_KEY: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? undefined : v))
      .refine((v) => v === undefined || v.startsWith('sk_test_'), {
        message:
          'STRIPE_SECRET_KEY must be a test-mode key (sk_test_…): Stripe stays in test mode until the SIA exists.',
      }),
    /**
     * The Twilio trio (#85). Absent — or empty, as committed to
     * `.env.example` — binds `StubSmsProvider`, which refuses to boot in
     * production: the same arrangement as Stripe and maps. All three set
     * together or none — the superRefine below enforces it in EVERY
     * environment. Same `.optional().transform().refine()` order as
     * `STRIPE_SECRET_KEY`; the refine must see the transformed value.
     */
    TWILIO_ACCOUNT_SID: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? undefined : v))
      .refine((v) => v === undefined || v.startsWith('AC'), {
        message:
          'TWILIO_ACCOUNT_SID must start with AC — the Account SID from console.twilio.com, not an API key or the auth token.',
      }),
    TWILIO_AUTH_TOKEN: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? undefined : v)),
    /**
     * An E.164 number (trial accounts must use their trial number), or an
     * alphanumeric sender ID (≤11 chars, one-way, paid accounts only — no
     * registration needed in Latvia).
     */
    TWILIO_FROM_NUMBER: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? undefined : v))
      .refine(
        (v) =>
          v === undefined ||
          /^\+[1-9]\d{6,14}$/.test(v) ||
          /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/.test(v),
        {
          message:
            'TWILIO_FROM_NUMBER must be an E.164 number (+371…) or an alphanumeric sender ID (≤11 chars, at least one letter).',
        },
      ),
    /**
     * Where the SMS tracking links point (#63) — the dispatch web app's
     * public origin, which serves `/t/:token`. The default is its dev origin
     * (first in the seeded `CORS_ORIGINS`); a deploy sets the real domain.
     */
    PUBLIC_TRACKING_BASE_URL: z.string().url().default('http://localhost:3000'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000,http://localhost:3002')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
  })
  /**
   * Production-only below the gate, because dev and CI legitimately run on
   * short, shared, committed values — a rule that blocked those would just be
   * turned off. The Twilio all-or-nothing check is the one deliberate
   * exception, reasoned inline.
   */
  .superRefine((env, ctx) => {
    // EVERY environment, deliberately above the production gate: a partial
    // trio is a misconfiguration everywhere — in dev it silently binds the
    // stub while you think you are testing Twilio; in production the
    // factory's refusal would blame "no provider" when the real problem is
    // one missing var. One issue per missing key.
    const twilioKeys = [
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_FROM_NUMBER',
    ] as const;
    const set = twilioKeys.filter((k) => env[k] !== undefined);
    if (set.length > 0 && set.length < twilioKeys.length) {
      for (const k of twilioKeys.filter((k) => env[k] === undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [k],
          message: `${k} is missing: TWILIO_* must be set all together or not at all (a partial config silently binds the stub).`,
        });
      }
    }

    if (env.NODE_ENV !== 'production') return;

    for (const key of SECRET_KEYS) {
      const value = env[key];
      if (PUBLISHED_SECRETS.includes(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is the value committed to .env.example and is public. Generate a unique one: openssl rand -hex 32`,
        });
      } else if (value.length < MIN_PRODUCTION_SECRET_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production (got ${value.length}): openssl rand -hex 32`,
        });
      }
    }

    // Live since #85: with the TWILIO_* trio set, production boots past the
    // SMS gate — this check is what stops that deploy texting
    // `http://localhost:3000/t/…` links to real riders.
    const trackingHost = new URL(env.PUBLIC_TRACKING_BASE_URL).hostname;
    if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(trackingHost)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_TRACKING_BASE_URL'],
        message:
          'PUBLIC_TRACKING_BASE_URL is a localhost origin — SMS tracking links point here, so production needs the deployed dispatch-app domain.',
      });
    }

    // Two secrets with one value is the coupling OTP_PEPPER exists to break —
    // it would make a JWT rotation a silent sign-in outage again.
    if (env.JWT_SECRET === env.OTP_PEPPER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTP_PEPPER'],
        message:
          'OTP_PEPPER must differ from JWT_SECRET: sharing one value re-couples token signing to OTP hashing, so rotating the signing key invalidates every OTP in flight.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
export const APP_ENV = 'APP_ENV';

let cached: Env | undefined;
/** Parsed once per process; throws at bootstrap on a bad environment. */
export function loadEnv(): Env {
  return (cached ??= envSchema.parse(process.env));
}
