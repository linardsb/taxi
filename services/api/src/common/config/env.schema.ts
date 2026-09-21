import { RIGA_CITY_ID } from '@taxi/db';
import { TRACKING_LINK_HOST_MAX_CHARS, trackingLinkHost } from '@taxi/shared';
import { z } from 'zod';
import { checkSmsCredentialGroups, smsEnvFields } from './sms-env.schema';

/**
 * BLANK MEANS UNSET — the rule for the enums in this file and its SMS
 * sibling, stated once here rather than three times at the sites (#242).
 *
 * `.default()` substitutes `undefined` ONLY, so a blanked line (`FOO=`) in a
 * hand-edited dotenv delivers `''`. An un-wrapped `z.enum` then refuses to
 * boot in EVERY environment with zod's generic enum message, which names no
 * remedy. Wrapping it in `z.preprocess((v) => (v === '' ? undefined : v), …)`
 * reads the blank as unset instead — the reading every optional sibling here
 * already gives it (`GOOGLE_MAPS_API_KEY`, `STRIPE_SECRET_KEY`, the three SMS
 * credential groups).
 *
 * APPLIED TO THE THREE PROVIDER SWITCHES, and to them because their default
 * is itself the value production refuses: `ALLOW_STUB_MAPS_PROVIDER`
 * (`false`), `PUSH_PROVIDER` (`stub`) and `SMS_PROVIDER` (`stub`, in
 * `sms-env.schema.ts`). A blank there costs the operator that gate's own
 * named message instead of a generic one; it cannot cost them the gate,
 * because the gate still fires.
 *
 * DELIBERATELY NOT `NODE_ENV` — the fourth and last enum carrying a default
 * across the two files, and the one where that condition fails. Its default
 * is `development`, which is what makes the `NODE_ENV !== 'production'` gate
 * in the `superRefine` below skip every secret check, and each provider
 * factory skip its production refusal. Blank-as-unset there would turn one
 * stray keystroke on a real host into a clean boot with every gate off, so
 * `NODE_ENV` keeps the generic refusal — for it, refusing IS the remedy.
 */

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

/**
 * Characters that make a `PUBLIC_TRACKING_BASE_URL` un-linkable once
 * `trackingLink` appends `/<lang>/<token>` to it (#246), each with the reason
 * it does — the boot gate quotes the matching one rather than saying
 * "malformed".
 *
 * A `/` IS DELIBERATELY ABSENT. A path prefix is a supported deployment
 * (`sakta.lv/app`); `trackingLinkHost` preserves it on purpose so the rider's
 * SMS budget pays for it, and its test pins that. This set is the shapes that
 * break the link, not the shapes that cost characters.
 */
const TRACKING_BASE_URL_BREAKERS: Readonly<Record<string, string>> = {
  '@': 'everything before it is read as userinfo, so the link resolves to a different host than the one it reads as',
  '?': 'the /<lang>/<token> path lands inside the query string',
  '#': 'the /<lang>/<token> path lands inside the fragment and never reaches the server at all',
};

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
     * The TRACKING page's own route TTL, deliberately not the one above.
     *
     * Pricing consumes `distanceMeters`, which is near time-invariant; the
     * tracking page consumes `durationSeconds`, which is exactly the field
     * traffic moves. Inheriting 24 h would serve an 08:30 rush-hour page from
     * an 02:00 off-peak route on the same key. 5 min is roughly the interval
     * over which a Rīga corridor's travel time changes meaningfully — a guess,
     * with no traffic data to calibrate against yet.
     */
    MAPS_ETA_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    /**
     * How long a FAILED route is remembered — for the `eta` caller only.
     *
     * Long enough that a provider outage costs one call per corridor per
     * minute instead of one per poll per viewer; short enough that a transient
     * blip self-heals inside a rider's patience. Named `ETA` rather than
     * `ROUTE` precisely because the `quote` caller does NOT negative-cache: a
     * `MAPS_ROUTE_*` name invites someone to wire it into both, and on the
     * booking path a cached failure blocks real bookings (see `geo.module.ts`).
     *
     * **`0` disables the negative cache entirely** — `CachingMapsProvider`
     * reads `failureTtlSeconds > 0` as the switch, and the `quote` facade is
     * built with a literal `0` for exactly that reason. `.nonnegative()`, not
     * `.positive()`, so the `eta` facade has the same kill switch from
     * configuration: if it ever misbehaves against a real provider, turning it
     * off is an env change rather than a deploy.
     */
    MAPS_ETA_FAILURE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(60),
    /**
     * BOTH callers share this one — pricing as well as tracking, unlike the
     * two `MAPS_ETA_*` knobs above. Lowering it to make the tracking page fail
     * faster also fails every quote, and therefore every booking.
     *
     * Bounds LATENCY, not spend: `Promise.race` does not cancel the loser, so
     * the upstream HTTP call keeps running and still bills. What it buys is
     * that a hung Routes call cannot hang `GET /track/:token` — public,
     * no-login, polled every 5 s.
     *
     * The `.max()` is the enforcement, not a comment: this MUST stay well under
     * `RIDE_IDEMPOTENCY_PENDING_TTL_SECONDS` (120 s), or a hang past that
     * window reopens #46 by a new door.
     */
    MAPS_ROUTE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(30_000)
      .default(3_000),
    /**
     * Binds `GooglePlacesProvider` for the dispatcher's address typeahead
     * (#19). Absent binds the stub, whose `searchAddress` throws — dev without
     * a key is expected, and the console falls back to free-text entry.
     *
     * `mapsProviderSourceFactory` names its absence in the production refusal:
     * an address field that throws on Dina's first keystroke is a dead console,
     * and finding that out from a support call rather than a failed deploy is
     * the failure this prevents.
     *
     * Same `.optional().transform()` shape as `STRIPE_SECRET_KEY` and the
     * Twilio trio: an EMPTY value is the committed template's way of saying
     * "unbound", and `.min(1).optional()` would reject it at boot in every dev
     * checkout that copied the template.
     *
     * DELIBERATELY UNCHECKED BEYOND THAT, and #125 is the ticket that argued
     * otherwise. Not in `SECRET_KEYS`/`PUBLISHED_SECRETS` for the reason
     * `STRIPE_SECRET_KEY` is not: those guard length and reuse of a committed
     * placeholder for OUR secrets, and this key has neither — the template
     * commits it empty. No `.refine()` either, unlike the Stripe and Twilio
     * prefixes: Google documents no format for a Maps Platform key, so a prefix
     * test would encode a guess as a boot gate. What a WRONG key gets instead
     * is `geo.places.request_failed reason=key_rejected` at `error` level from
     * `GooglePlacesProvider` on the first call — the shape a 401/403 has, told
     * apart from an outage.
     */
    GOOGLE_MAPS_API_KEY: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? undefined : v)),
    /**
     * Autocomplete bias radius. 30 km from Rīga centre reaches Jūrmala and the
     * Pierīga ring, which PRD §6 puts in scope. A BIAS, not a restriction:
     * results outside it still return, ranked lower. Raising it does not cost
     * money — the price is per request, not per kilometre — it costs relevance,
     * because a Rīga street name also exists in Liepāja.
     *
     * The `.max()` is the enforcement, not a comment, exactly as
     * `MAPS_ROUTE_TIMEOUT_MS` above puts it. 50 000 m is GOOGLE'S OWN bound —
     * `locationBias.circle.radius` "must be between 0.0 and 50000.0, inclusive"
     * (Places API (New) Autocomplete reference, read 2026-08-18) — and above it
     * the provider is rejected per request. Without the bound an operator who
     * widens the bias to cover Latvia boots cleanly and 500s on Dina's first
     * keystroke: a support call instead of a failed deploy.
     */
    PLACES_BIAS_RADIUS_METERS: z.coerce
      .number()
      .int()
      .positive()
      .max(50_000)
      .default(30_000),
    /**
     * Below this, `GET /geo/address-search` answers `[]` without spending. 3 is
     * the shortest input that narrows a Latvian street meaningfully ("bri" →
     * Brīvības); at 1–2 characters the request buys a list nobody can use.
     *
     * This is a SPEND control, and the one the client cannot weaken: the
     * console debounces too, but a broken client loop is bounded here.
     */
    PLACES_SEARCH_MIN_CHARS: z.coerce.number().int().positive().default(3),
    /**
     * How long a resolved place id keeps its coordinate and formatted address.
     *
     * 30 days is `expected`, not verified: the Places policy exempts place IDs
     * from caching restrictions indefinitely but points at the Maps Service
     * Terms for how long other content may be held, and that page was not
     * readable in full on 2026-08-17 (plan Q6). The knob exists so a corrected
     * figure is one env change. Predictions are NOT cached at any TTL.
     */
    MAPS_PLACE_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(2_592_000),
    /**
     * `true` lets `mapsProviderSourceFactory` bind `StubMapsProvider` for
     * ROUTES under `NODE_ENV=production`. Default `false`: the gate stays
     * exactly as it was — production refuses to boot on the stub.
     *
     * WHY IT EXISTS (#13). No real routing `MapsProvider` exists in the tree,
     * and the one that will — `OsrmMapsProvider`, #134 — is its own ticket, so
     * without this the first deploy cannot boot at all. It is the #103 move (a
     * code-level gate becomes a config-level switch) applied to ONE clause of
     * ONE factory and nothing else: it does not touch the secret rules below,
     * the `PUBLIC_TRACKING_BASE_URL` rule, the SMS or payments gates, or the
     * same factory's `GOOGLE_MAPS_API_KEY` refusal — a switch that accepts
     * straight-line quotes has not accepted a dead address typeahead.
     *
     * WHAT IT COSTS. Every quote is priced off haversine distance × 1.35 at
     * 40 km/h (`stub-maps.provider.ts`), and `route()` returns no polyline, so
     * the tracking page's ETA and any route line are geometry, not roads.
     *
     * WHY IT IS SAFE TODAY, and only today: the pilot is not open, so no rider
     * is quoted a straight-line price at all. That is the whole of it, and the
     * due date is the pilot OPENING, not #134. The empty `STRIPE_SECRET_KEY`
     * buys less than it looks: `CardPaymentsDisabledProvider` refuses the CARD
     * rail only, and a cash ride quoted at haversine x 1.35 is real money at
     * the kerb. So: unset this before the first real rider, whether or not OSRM
     * has landed, and let the deploy fail instead.
     *
     * #134 DELETES THIS VARIABLE together with the branch that reads it. Debt
     * with a due date, not a feature. `z.enum`, not `z.coerce.boolean()`, which
     * reads the string "false" as `true`. The preprocess is the blank-means-
     * unset rule at the top of this file (#242) — a blanked line still refuses
     * to boot in production, through the maps gate's own message rather than a
     * generic enum error.
     */
    ALLOW_STUB_MAPS_PROVIDER: z
      .preprocess(
        (v) => (v === '' ? undefined : v),
        z.enum(['true', 'false']).default('false'),
      )
      .transform((v) => v === 'true'),
    /**
     * TEST MODE ONLY, structurally. `sk_live_…` is refused at boot: the repo
     * rule is "Stripe stays in test mode until the SIA exists", and spike #5
     * confirms a live platform account needs a legal entity we do not have.
     * Absent (or empty, as in `.env.example`) binds `StubPaymentsProvider` in
     * dev and test, and `CardPaymentsDisabledProvider` in production (#13):
     * the cash-only pilot has no card rail, and a provider that REFUSES is the
     * honest shape of that, where the stub's silent success is not.
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
     * The three SMS credential groups and the `SMS_PROVIDER` selector,
     * spread in from `sms-env.schema.ts` at exactly the position they used
     * to occupy. Split out for the line budget (#137 took this file past
     * `max-lines`), not for a boundary — the composed schema is unchanged.
     */
    ...smsEnvFields,
    /**
     * Which `PushProvider` binds (#14). A switch rather than credential-driven
     * like Twilio, because Expo's push API needs no credential — the intent
     * has to be stated. `stub` logs the nudge and delivers nothing; the
     * factory (`features/push/push.module.ts`) refuses it in production, like
     * `SMS_PROVIDER`.
     *
     * The preprocess is the blank-means-unset rule at the top of this file
     * (#242). It was the un-wrapped odd one out until then, so a blanked
     * `PUSH_PROVIDER=` line refused to boot in EVERY environment with a
     * generic enum message; now it falls back to `stub` and production
     * refuses through the push factory's own message, which names the remedy.
     */
    PUSH_PROVIDER: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.enum(['stub', 'expo']).default('stub'),
    ),
    /** Optional: Expo "enhanced push security" — sent as a Bearer on every push. */
    EXPO_PUSH_ACCESS_TOKEN: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? undefined : v)),
    /**
     * Where the SMS tracking links point (#63) — the dispatch web app's
     * public origin, which serves `/t/:token`. The default is its dev origin
     * (first in the seeded `CORS_ORIGINS`); a deploy sets the real domain.
     *
     * ITS HOST MUST BE <= `TRACKING_LINK_HOST_MAX_CHARS` (10) IN PRODUCTION,
     * refused in the `superRefine` below. The host is a term in the rider
     * SMS's 70-character UCS-2 segment budget (#136) and the binding template
     * has zero spare, so `saktacab.lv` (11) would silently double the bill on
     * every phone-booked ride. `sakta.lv` is 8.
     *
     * ITS SHAPE IS CHECKED THERE TOO (#246): a bare origin, spelled with a
     * lowercase scheme, optionally with a path prefix. `z.string().url()`
     * accepts far more than that — userinfo, a query, a fragment, `FTP://` —
     * and each of those reaches the rider as a link that does not resolve.
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
   * turned off. The SMS all-or-nothing check is the one deliberate
   * exception, reasoned in `sms-env.schema.ts`.
   */
  .superRefine((env, ctx) => {
    // The all-or-none group check and the named-kind check, ABOVE the
    // production gate below: a partial group is a misconfiguration in
    // EVERY environment — in dev it silently binds the stub while you
    // think you are testing a real gateway. Moved to `sms-env.schema.ts`
    // with the fields it checks; the PLACEMENT stays here, because that
    // is what the caller owns.
    checkSmsCredentialGroups(env, ctx);

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

    // Live since #136, and production-only for the same reason as the check
    // above: dev and CI run `http://localhost:3000`, whose host is 14
    // characters, and must keep booting. `trackingLinkHost` is the link
    // builder's own function, so this measures exactly what the SMS carries.
    const smsHost = trackingLinkHost(env.PUBLIC_TRACKING_BASE_URL);

    // SHAPE BEFORE LENGTH (#246). The two checks below run first because the
    // character count under them is only meaningful once the string it counts
    // is a host: `u:p@sakta.lv` is refused today for being 12 characters, as
    // if the userinfo were domain.
    //
    // Length is not a filter for shape, it only hides how little it catches.
    // `observed` 2026-09-21 at 487570f, through this schema: `https://u@s.lv`,
    // `https://s.lv?x`, `https://s.lv#f` and `ftp://s.lv` all BOOT — 6, 6, 6
    // and 10 characters against a limit of 10 — and each texts a rider a link
    // that does not resolve. `https://sakta.lv#f` is the same escape at the
    // ceiling exactly (10), which is how PR #245's review found it.
    //
    // Neither check early-returns: a value can be both malformed and too long
    // (`https://sakta.lv/app?q=1`), and one boot should name both.
    //
    // NOT production-only by necessity — nothing in dev legitimately carries
    // these either — but placed inside the gate so all three rules on this one
    // variable read as one block.
    const breaker = Object.keys(TRACKING_BASE_URL_BREAKERS).find((c) =>
      smsHost.includes(c),
    );
    if (breaker !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_TRACKING_BASE_URL'],
        message: `PUBLIC_TRACKING_BASE_URL would put "${smsHost}" in the rider SMS (#136), and the "${breaker}" breaks the link: ${TRACKING_BASE_URL_BREAKERS[breaker]}. Configure a bare origin, optionally with a path prefix: https://<domain> or https://<domain>/<prefix>.`,
      });
    }

    // THE SCHEME, and the second decision #246 asks for: no `i` flag.
    // `trackingLinkHost` strips `^https?://` case-sensitively, so `HTTPS://`
    // or `ftp://` survives into the SMS as part of the "host". Making that
    // strip case-insensitive would fix one operator typo by changing what a
    // pure function emits on the rider SMS send path, and would flip an
    // existing boot verdict (`HTTPS://SAKTA.LV`, refused at 16 characters
    // today, would become an 8-character accept) as a side effect of a regex
    // flag. Refusing here costs the operator one lowercase edit, keeps
    // `@taxi/shared` untouched, and changes no verdict — only the reason
    // `HTTPS://SAKTA.LV` is already given.
    if (!/^https?:\/\//.test(env.PUBLIC_TRACKING_BASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_TRACKING_BASE_URL'],
        message: `PUBLIC_TRACKING_BASE_URL must begin with a lowercase http:// or https:// (got "${env.PUBLIC_TRACKING_BASE_URL}"). The SMS link builder strips exactly that prefix, so any other spelling is carried into the rider SMS as part of the host: "${smsHost}".`,
      });
    }

    if (smsHost.length > TRACKING_LINK_HOST_MAX_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_TRACKING_BASE_URL'],
        message: `PUBLIC_TRACKING_BASE_URL's host is ${smsHost.length} characters (${smsHost}); the limit is ${TRACKING_LINK_HOST_MAX_CHARS}. The linked rider SMS must fit one billed UCS-2 segment (#136) and the Russian driver_assigned template has zero spare, so a longer host doubles the SMS bill on every phone-booked ride. Use a shorter domain — sakta.lv is 8.`,
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
