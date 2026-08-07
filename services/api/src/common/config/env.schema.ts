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
   * Production-only, because dev and CI legitimately run on short, shared,
   * committed values — a rule that blocked those would just be turned off.
   */
  .superRefine((env, ctx) => {
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
