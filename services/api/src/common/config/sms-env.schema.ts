import { z } from 'zod';

/**
 * The SMS credential surface, split out of `env.schema.ts`.
 *
 * The split is a LINE-BUDGET one and deliberately shallow — the same reason
 * `format-message.ts` left `@taxi/shared`'s catalogs where they were. #137
 * added two credential groups and a selector to a file already at 395 lines,
 * which took it past the 500-line `max-lines` cap. What moved is one
 * self-contained concern: the three groups' fields, the table naming them,
 * and the all-or-none check over that table. Everything else stayed put, and
 * the composed `envSchema` is unchanged in shape — these fields are spread
 * back in at the same position they occupied.
 */

/**
 * Everything `SMS_PROVIDER` accepts — DERIVED from the `z.enum` below rather
 * than listed again, for the same reason `SmsCredentialKey` is (see its
 * comment): a hand-written copy drifts silently, and the enum is the only
 * thing an operator's env file is actually checked against.
 *
 * Deriving it is what makes adding a kind a guided edit: the new value lands
 * in the enum, `SMS_GROUPS` is `Record<SmsProviderKind, …>` so the compiler
 * then demands its credential group, and `auth.module.spec.ts`'s
 * "every kind the enum lists" case demands a factory branch and a fixture.
 * Hand-written, the first of those three links was missing.
 *
 * `'stub'` is the kind that delivers nothing — it demands no credential
 * group, and `smsProviderFactory` refuses it under `NODE_ENV=production`.
 */
export type SmsProviderSelector = z.infer<typeof smsEnvFields.SMS_PROVIDER>;

/**
 * The kinds backed by a credential group — every value but `'stub'`, which
 * has none. This is `SMS_GROUPS`' key type, so re-admitting `'stub'` here
 * would demand a group the stub does not have.
 */
export type SmsProviderKind = Exclude<SmsProviderSelector, 'stub'>;

/**
 * Every env key belonging to one of the three `SmsProvider` credential groups
 * — DERIVED from `smsEnvFields` below rather than listed again.
 *
 * A hand-written union would let `smsEnvFields` and `SMS_GROUPS` drift apart
 * silently: `SmsEnvValues` is a `Partial<Record<…>>`, so renaming or dropping
 * a field leaves a parsed env structurally assignable and the all-or-none
 * check just stops covering that key, with no typecheck error anywhere.
 * Order-independence makes the forward reference legal — and
 * `smsEnvFields`' inferred type does not mention `SMS_GROUPS`, so there is no
 * cycle.
 */
type SmsCredentialKey = Exclude<keyof typeof smsEnvFields, 'SMS_PROVIDER'>;

/**
 * The credential group behind each selectable `SMS_PROVIDER` kind (#85, #137).
 *
 * KEY ORDER INSIDE EACH `keys` ARRAY IS LOAD-BEARING. `env.schema.spec.ts`
 * matches `/TWILIO_AUTH_TOKEN is missing[\s\S]*TWILIO_FROM_NUMBER is missing/`
 * — a regex that pins the two issues' RELATIVE order.
 * `checkSmsCredentialGroups` iterates these arrays literally, which preserves it; sorting the keys, or
 * collecting them into a `Set`, breaks a green-looking test in a way the diff
 * does not show.
 *
 * Note `budgetsms` has FOUR keys, not three — hence a table rather than the
 * hardcoded trio this replaces.
 */
const SMS_GROUPS: Record<
  SmsProviderKind,
  { prefix: string; keys: readonly SmsCredentialKey[] }
> = {
  twilio: {
    prefix: 'TWILIO_*',
    keys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
  },
  bulkgate: {
    prefix: 'BULKGATE_*',
    keys: [
      'BULKGATE_APPLICATION_ID',
      'BULKGATE_APPLICATION_TOKEN',
      'BULKGATE_SENDER_ID_VALUE',
    ],
  },
  budgetsms: {
    prefix: 'BUDGETSMS_*',
    keys: [
      'BUDGETSMS_USERNAME',
      'BUDGETSMS_USERID',
      'BUDGETSMS_HANDLE',
      'BUDGETSMS_FROM',
    ],
  },
};

/**
 * The three credential groups and the selector, spread into `envSchema` at
 * exactly the position they used to occupy — so the composed schema, and
 * every message it can emit, is unchanged by the split.
 */
export const smsEnvFields = {
  /**
   * The Twilio trio (#85) — the credential group `SMS_PROVIDER=twilio`
   * demands, and reached only under that selector. Absent or empty (as
   * committed to `.env.example`) is fine while the selector names something
   * else; under `twilio` it is a boot refusal naming the missing keys, not a
   * quiet fall back to the stub. Presence selects nothing: that was `'auto'`,
   * retired at #137's second loop. All three set together or none —
   * `checkSmsCredentialGroups` below enforces it in EVERY environment. Same
   * `.optional().transform().refine()` order as `STRIPE_SECRET_KEY`; the
   * refine must see the transformed value.
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
   * BulkGate's Simple Transactional credentials (#137's bake-off candidate).
   * All three set together or none — `checkSmsCredentialGroups` below,
   * in EVERY environment. Presence makes the kind *selectable*; `SMS_PROVIDER`
   * selects. That split is new as of #137: before it, TWILIO_* presence WAS
   * the selection, and it cannot be any more — a bake-off funds two or three
   * accounts at once, so presence can no longer disambiguate.
   */
  BULKGATE_APPLICATION_ID: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v)),
  BULKGATE_APPLICATION_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v)),
  /**
   * The `gText` sender value — an alphanumeric sender ID, never an E.164
   * number, so `TWILIO_FROM_NUMBER`'s number alternative is deliberately
   * absent here.
   */
  BULKGATE_SENDER_ID_VALUE: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v))
    .refine(
      (v) => v === undefined || /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/.test(v),
      {
        message:
          'BULKGATE_SENDER_ID_VALUE must be an alphanumeric sender ID (≤11 chars, at least one letter).',
      },
    ),
  /**
   * BudgetSMS credentials (#137's second candidate). FOUR keys, not three.
   * `BUDGETSMS_HANDLE` is the API secret. No `baseUrl` entry: the provider
   * takes one as a constructor default so the bake-off script can point an
   * instance at `/testsms/`, and making a test endpoint production-
   * configurable is exactly what that must not become.
   */
  BUDGETSMS_USERNAME: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v)),
  BUDGETSMS_USERID: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v))
    .refine((v) => v === undefined || /^\d+$/.test(v), {
      message:
        'BUDGETSMS_USERID must be numeric — the account id, not the username (HTTP API spec V2.7 §2).',
    }),
  BUDGETSMS_HANDLE: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v)),
  /**
   * STRICTER than `TWILIO_FROM_NUMBER`, deliberately: BudgetSMS §2 allows
   * [a-z][A-Z][0-9] only, so the space the Twilio refine permits earns a
   * `2003`/`2004` at send time rather than at boot.
   */
  BUDGETSMS_FROM: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v))
    .refine(
      (v) => v === undefined || /^(?=.*[A-Za-z])[A-Za-z0-9]{1,11}$/.test(v),
      {
        message:
          'BUDGETSMS_FROM must be alphanumeric with no spaces (≤11 chars, at least one letter) — BudgetSMS allows [a-z][A-Z][0-9] only.',
      },
    ),
  /**
   * Which `SmsProvider` binds (#137). Every value names a kind outright, and
   * `checkSmsCredentialGroups` below then demands that kind's whole
   * credential group. `stub` names the one that delivers nothing:
   * `smsProviderFactory` refuses it under `NODE_ENV=production`.
   *
   * A switch rather than credential-driven, the `PUSH_PROVIDER` reasoning
   * ("the intent has to be stated") — but forced here rather than chosen:
   * during the bake-off two or three groups are funded at once.
   *
   * `'auto'` — #240's default, meaning "the TWILIO_* trio decides" — was
   * RETIRED by this ticket's second loop. It preferred Twilio over a funded
   * candidate with no log line and no refusal, which is the whole cost the
   * bake-off exists to escape. Do not re-introduce it: a value that infers
   * intent cannot be checked against what the operator meant, and
   * `auth.sms.provider_bound` can only name a kind that was stated.
   *
   * The name collides with the DI token string in `sms/sms.tokens.ts`. That
   * is the established arrangement (`push.tokens.ts:5` and `env.schema.ts`'s
   * `PUSH_PROVIDER` are the same pair), not an accident to route around.
   */
  SMS_PROVIDER: z.preprocess(
    // The blank-means-unset rule, stated once at the top of `env.schema.ts`
    // (#242) and carried by all three provider switches: a blanked
    // `SMS_PROVIDER=` line would otherwise deliver `''` and refuse to boot in
    // EVERY environment with a generic enum message. `NODE_ENV` deliberately
    // has no wrapper; the rule says why.
    (v) => (v === '' ? undefined : v),
    z
      .enum(['stub', 'twilio', 'bulkgate', 'budgetsms'], {
        // A custom `message` REPLACES zod's whole default string, so the legal
        // values are listed here rather than inherited — and the sentence has
        // to stay true for EVERY rejected value, not only `'auto'`: this fires
        // for `SMS_PROVIDER=vonage` too. Constraint first, retirement second.
        // `{ invalid_type_error }` is silently ignored for an out-of-range
        // enum value on zod 3.25.76; `{ message }` is the spelling that works.
        // It also has to live here rather than in
        // `checkSmsCredentialGroups`: a failing enum short-circuits the
        // object's `superRefine`, so code there would never run for `'auto'`.
        message:
          "SMS_PROVIDER must be one of: stub | twilio | bulkgate | budgetsms. 'auto' was retired (#137) — name the provider outright; 'stub' delivers nothing and production refuses it.",
      })
      .default('stub'),
  ),
};

/** The slice of a parsed env this module's check reads. */
export type SmsEnvValues = Partial<Record<SmsCredentialKey, string>> & {
  SMS_PROVIDER: SmsProviderSelector;
};

/**
 * The all-or-none group check plus the named-kind check, both belonging
 * ABOVE `env.schema.ts`'s `if (env.NODE_ENV !== 'production') return;`.
 *
 * PLACEMENT IS LOAD-BEARING and the caller owns it: below that line these
 * fire only in production, and the dev misconfiguration they exist to catch
 * would pass silently in the one environment where you would actually hit it.
 */
export function checkSmsCredentialGroups(
  env: SmsEnvValues,
  ctx: z.RefinementCtx,
): void {
  // EVERY environment, deliberately above the production gate: a partial
  // group is a misconfiguration everywhere — in dev it silently binds the
  // stub while you think you are testing a real gateway; in production the
  // factory's refusal would blame "no provider" when the real problem is
  // one missing var. One issue per missing key. Unchanged reasoning (#85),
  // now over three groups (#137).
  for (const { prefix, keys } of Object.values(SMS_GROUPS)) {
    const set = keys.filter((k) => env[k] !== undefined);
    if (set.length === 0 || set.length === keys.length) continue;
    for (const k of keys.filter((k) => env[k] === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [k],
        message: `${k} is missing: ${prefix} must be set all together or not at all (a partial config silently binds the stub).`,
      });
    }
  }

  // A kind backed by credentials must have its whole group — otherwise the
  // factory's non-null assertions on those fields would be the only thing
  // standing between a typo and a `new BulkGateSmsProvider(undefined)`.
  // `'stub'` demands nothing because it HAS no group (it is not a key of
  // `SMS_GROUPS`), which is why it is the one value this guard excludes —
  // and why the default keeps a fresh checkout parsing. Also above the
  // production gate, for the same reason the block above is.
  if (env.SMS_PROVIDER !== 'stub') {
    const missing = SMS_GROUPS[env.SMS_PROVIDER].keys.filter(
      (k) => env[k] === undefined,
    );
    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMS_PROVIDER'],
        message: `SMS_PROVIDER=${env.SMS_PROVIDER} needs ${missing.join(', ')}.`,
      });
    }
  }
}
