# Feature: Real SMS provider behind the seam (Twilio) — pre-pilot gate

The following plan should be complete, but validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files.

## Feature Description

`StubSmsProvider` throws at boot under `NODE_ENV=production` by design, so production cannot start until a real `SmsProvider` ships (issue #85, the follow-up §NOTES of `.claude/plans/rider-comms-sms-tracking-page.md` promised). This ticket:

1. Implements `TwilioSmsProvider` (`sendOtp` + `send`) inside the factory branch — the "real key present → real provider" shape `paymentsProviderFactory` already demonstrates.
2. Reconciles `.env.example`'s `TWILIO_*` keys with `env.schema.ts` (pre-existing drift: the example lists them, the schema doesn't know them) — prefix-refine + superRefine per the house pattern.
3. Records the gateway evaluation the ticket mandates (see NOTES): **Twilio for pilot**, with the seam + segment-count logging producing the evidence to swap to a cheaper gateway post-pilot.

Both consumers (auth OTP, ride notifications) work unchanged — that is the seam's whole promise, and the existing suites prove it.

## User Story

As **the operator (Linards)**
I want to **deploy the API with `NODE_ENV=production` and have riders actually receive OTP and ride-status SMS**
So that **the pilot can run on real phones instead of a console log**.

## Problem Statement

The stub delivers nothing and logs secrets in full, so the factory structurally refuses production boot. Additionally, `.env.example` promises `TWILIO_*` configuration the env schema silently drops — a filled-in trio today changes nothing, which is exactly the drift the schema exists to prevent.

## Solution Statement

- New `TwilioSmsProvider` in `services/api/src/features/auth/sms/` (the slice implementing the seam — the only place allowed to speak Twilio, per root CLAUDE.md). Plain `fetch` against Twilio's Messages REST API — **no SDK dependency** (two form-encoded POSTs don't justify the `twilio` package's dependency tree; Stripe's "narrow client, testable without a network" doctrine is applied here as an injectable `fetch`).
- `smsProviderFactory` gains the real-branch: `TWILIO_*` trio present → `TwilioSmsProvider`; absent → stub, which still refuses production. Factory signature stays `(env: Env)`, so **both** existing bindings (auth + notifications, `inject: [APP_ENV]`) are untouched.
- `env.schema.ts` learns the trio with the `.optional().transform().refine()` house pattern (empty string → `undefined`, so `.env.example` keeps booting), prefix-refines the SID (`AC…`) and the sender (E.164 **or** ≤11-char alphanumeric), and a superRefine pins the trio as all-or-nothing.
- OTP body copy: new `sms.otp_code` key in the shared LV/RU/EN catalog (nothing user-facing is hardcoded). The provider sends it in **lv** — at request-otp time no user row exists yet, so there is no language preference to read.
- Success log carries `segments` (from Twilio's `num_segments`) — the exact feed for the "SMS spend €/week" ledger row.

## Out of Scope / Non-Goals

- Not included: **a second provider implementation** (BudgetSMS/LMT gateway). The evaluation (NOTES) keeps the swap door open; the swap itself is a post-pilot ticket triggered by the €/week ledger row going red.
- Not included: **delivery receipts / status callbacks** — fire-and-forget send is the seam contract; a webhook is a new surface for zero pre-pilot benefit.
- Not included: **retry logic** — auth already releases the cooldown and answers 502 on failure; notifications is fire-and-forget by design.
- Not included: **SMS copy changes** (GSM-7 transliteration to halve segment costs) — a product/copy decision, logged as a follow-up in NOTES.
- Not included: fixing the **`GOOGLE_MAPS_API_KEY`** example↔schema drift — same drift class, but it belongs to the future real-maps-provider ticket.
- Not changing: `StubSmsProvider` behavior (dev workflow reads OTP codes from its log), the seam interface in `@taxi/shared` (already `sendOtp` + `send`), either consumer's code, the harness's `RecordingSmsProvider`.
- Expectation to state plainly: **production still won't boot after this ships** — `StubMapsProvider` (and `StubPaymentsProvider` unless `sk_test_…` is set) refuse production the same way. This ticket clears the *SMS* gate only.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Low–Medium (one new class + env plumbing; the risk is external account setup, not code)
**Primary Systems Affected**: `services/api` (auth slice, env schema), `packages/shared` (one i18n key)
**Dependencies**: none new (native `fetch`, Node ≥18 / @types/node 24)

## Related Work

**Implements**: [#85](https://github.com/linardsb/taxi/issues/85) · **Epic**: #1 — the seam-over-Twilio decision (2026-07-06) is recorded in `packages/shared/src/seams/sms-provider.ts:1-4` and inherited, not re-decided; the ticket's mandate to *evaluate before defaulting to Twilio* is discharged in NOTES.

**Back-references**:

- `.claude/plans/rider-comms-sms-tracking-page.md` — §NOTES named this follow-up; widened the seam (`send()`), built both consumers, and left the `TWILIO_*` drift alone on purpose (its task 6 GOTCHA)
- `#13` (auth OTP) — the origin of the stub + boot-refusal factory; two docblocks still say "#13 lands the real provider" and get corrected here

**Forward-references** (append as created):

- (future) cheaper-gateway swap ticket — one provider class + one factory line, triggered by the €/week ledger row
- (future) real maps provider — the next production-boot gate after this one

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `packages/shared/src/seams/sms-provider.ts` (10 lines) — the seam: `sendOtp(phoneE164, code)`, `send(phoneE164, body)`, both `Promise<void>`, throw on failure. Interface unchanged this ticket.
- `services/api/src/features/auth/auth.module.ts:12-27` — `smsProviderFactory` to extend; `:49-53` the binding (`inject: [APP_ENV]` — keep). The docblock's "#13 replaces this factory" sentence is what this ticket makes true (rewrite it).
- `services/api/src/features/payments/payments.module.ts:22-47` — **the pattern to mirror**: real-when-configured branch first, production refusal second, stub last. Note we deliberately do NOT mirror the two-token `STRIPE_CLIENT` split — see Patterns.
- `services/api/src/features/payments/payments.module.spec.ts` — the factory-spec house style: `env()` helper, `(expected)/(edge)/(failure)` titles, instanceof assertions.
- `services/api/src/features/auth/auth.module.spec.ts` — extend this: same three factory cases + the reflection check that the module really binds the factory (`:26-41`). The `#13` comment at `:19-20` goes stale — update it.
- `services/api/src/features/auth/sms/stub-sms.provider.ts` — stays as-is behaviorally; docblocks at `:7-8` and `:17,29` reference "#13" / "the real provider (#13)" — point them at `twilio-sms.provider.ts` (#85) instead.
- `services/api/src/features/auth/sms/sms.tokens.ts` — `SMS_PROVIDER` token; unchanged.
- `services/api/src/features/auth/auth.service.ts:185-198` — the OTP consumer: awaits `sendOtp`, catches, releases cooldown, logs `auth.otp.send_failed` **with `err.message` verbatim**, answers 502. This is why the provider's thrown message must never contain the phone or body (Twilio's own error text can echo the unmasked `To` number).
- `services/api/src/features/auth/phone-mask.ts` — `maskPhone`; every provider log with a phone uses it.
- `services/api/src/features/notifications/notifications.module.ts:11-23, 31-35` — the second `SMS_PROVIDER` binding via the same exported factory. No code change; the docblock's "two stub instances are harmless" wording generalizes to "two provider instances" (one-line touch-up).
- `services/api/src/features/notifications/ride-notifications.service.ts` — the `send()` consumer; wraps everything in its own catch (`ride.notifications.sms_send_failed`). Read to confirm nothing needs changing.
- `services/api/src/common/config/env.schema.ts:57-79` — the `STRIPE_SECRET_KEY` block: `.optional().transform().refine()` **in that order** (the refine must run on the transformed value; reordering breaks the empty-string `.env.example` case). The `TWILIO_*` trio copies this shape. `:96-143` the production superRefine; `:120-123` the "Unreachable while the stub SMS factory refuses production boot" comment that this ticket makes stale — rewrite it (the localhost-links check becomes live and load-bearing the moment the trio is set).
- `services/api/src/common/config/env.schema.spec.ts` — extend: the `prod()`/`base` helpers, the STRIPE describe block (`:114-158`) is the template for the TWILIO block.
- `services/api/src/features/payments/stripe-payments.provider.ts:15, 155-161` — the "narrow client, testable without a network" doctrine and the one-log-site style to imitate (adapted: our injectable is `fetch` itself).
- `services/api/test/harness.ts:216-240` — `RecordingSmsProvider` overrides the token across the whole graph (`overrideProvider(SMS_PROVIDER)`), so integration tests never construct or dial Twilio regardless of env. No harness changes.
- `services/api/test/setup-env.ts` — does NOT load `.env`; `TWILIO_*` are absent under jest, so every non-factory spec keeps hitting the stub path. No changes.
- `packages/shared/src/i18n.ts:15-40, 42-97` — the catalog: `lv` is the reference dictionary, `satisfies` forces ru/en parity at compile time; `tests/i18n.test.ts` pins placeholder parity automatically. Add `sms.otp_code` to all three.
- `.claude/references/logging-standard.md` — `domain.component.action_state`; the provider's success event lives in the `auth` domain like the stub's (`auth.sms.…`); never a full phone, never the body.

### New Files to Create

- `services/api/src/features/auth/sms/twilio-sms.provider.ts` — the real provider
- `services/api/src/features/auth/sms/twilio-sms.provider.spec.ts` — unit tests with a captured fake `fetch`

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Twilio Message resource — create](https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource)
  - `POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json`, HTTP Basic auth (`AccountSid:AuthToken`), form-encoded `To`/`From`/`Body`. Success = HTTP 201 with `{ sid, num_segments, status: 'queued', … }`; error = 4xx with `{ code, message, more_info }`.
- [Twilio error 21211 & friends](https://www.twilio.com/docs/api/errors) — error `code` is a safe integer to surface; `message` can contain the unmasked destination number (do not re-throw it).
- [Alphanumeric sender IDs](https://www.twilio.com/docs/messaging/services/services-send-messages#alphanumeric-sender-id) — Latvia needs **no pre-registration**, ≤11 chars, free; one-way only. **Trial accounts can't use them** — manual validation on a trial uses the trial number as `TWILIO_FROM_NUMBER`.
- [SMS pricing, Latvia](https://www.twilio.com/en-us/sms/pricing/lv) — $0.0801/segment (verified 2026-08-11); numbers from $1.15/mo (not needed with an alpha sender).
- Geographic permissions: console → Messaging → Settings → Geo permissions — **Latvia must be enabled** on the account or every send 400s with error 21408.

### Patterns to Follow

**Factory branch (mirror `paymentsProviderFactory`, keep the one-arg signature):**

```ts
// auth.module.ts — signature unchanged so BOTH bindings (auth + notifications) stay `inject: [APP_ENV]`
export function smsProviderFactory(env: Env): SmsProvider {
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER) {
    return new TwilioSmsProvider({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      from: env.TWILIO_FROM_NUMBER,
    });
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'No production SmsProvider is bound: StubSmsProvider delivers nothing and logs OTP codes in full. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER (#85) before running with NODE_ENV=production.',
    );
  }
  return new StubSmsProvider();
}
```

Why not the Stripe two-token shape (`STRIPE_CLIENT` + provider): that split exists because the SDK handle must be constructed exactly once and injected into an `@Injectable` class. Here there is no SDK handle — `fetch` is ambient — and a second token would force **both** module bindings to grow a second provider registration. The trio-presence check *is* the client construction.

**Provider skeleton (the narrow-injectable doctrine, applied to `fetch`):**

```ts
// twilio-sms.provider.ts — this file and auth.module.ts are the only two allowed to name Twilio
export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** E.164 number, or an alphanumeric sender ID (≤11 chars, one-way) — env.schema pins the shape. */
  from: string;
}

export class TwilioSmsProvider implements SmsProvider {
  constructor(
    private readonly config: TwilioConfig,
    /** Injectable so the spec runs without a network — the StripeClient doctrine. */
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    // lv, not the user's language: at request-otp time there may be no user row
    // yet, so there is no preference to read. Digits are digits in any language.
    await this.send(phoneE164, formatMessage('lv', 'sms.otp_code', { code }));
  }

  async send(phoneE164: string, body: string): Promise<void> { /* POST, see below */ }
}
```

**The send body** — form-encoded, Basic auth, bounded wait (OTP blocks a login request):

```ts
const res = await this.fetchFn(
  `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`,
  {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64')}`,
    },
    body: new URLSearchParams({ To: phoneE164, From: this.config.from, Body: body }),
    // sendOtp blocks the login request — auth answers 502 and releases the
    // cooldown on failure, so failing fast beats a hung fetch.
    signal: AbortSignal.timeout(SMS_HTTP_TIMEOUT_MS), // 10_000, module-level const with this comment
  },
);
```

(`URLSearchParams` as body sets `Content-Type: application/x-www-form-urlencoded` by itself.)

**Error mapping — the leak rule:** `auth.service.ts:195` logs `err.message` verbatim, and Twilio's own error `message` can echo the unmasked `To` number. So on non-2xx, parse the JSON best-effort and throw a **locally composed** message only: `` throw new Error(`twilio_error_${code ?? res.status}`) `` — never Twilio's text, never the body, never the phone. The numeric `code` + `more_info` URL is a complete diagnosis handle.

**Success log — the ledger feed** (`auth` domain like the stub, masked phone, `event` first, `at` last):

```ts
this.logger.log({
  event: 'auth.sms.twilio_sent',
  phone: maskPhone(phoneE164),
  segments: Number(json.num_segments) || 1, // "SMS spend €/week" reads this
  sid: json.sid,
  at: new Date().toISOString(),
});
```

Never log `Body` (it carries OTP codes and tracking links — only the *stub* logs bodies, deliberately, as the dev workflow).

**Env schema (the `.optional().transform().refine()` house shape, order load-bearing):**

```ts
TWILIO_ACCOUNT_SID: z.string().optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v))
  .refine((v) => v === undefined || v.startsWith('AC'), {
    message: 'TWILIO_ACCOUNT_SID must start with AC — the Account SID from console.twilio.com, not an API key or the auth token.',
  }),
TWILIO_AUTH_TOKEN: z.string().optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v)),
TWILIO_FROM_NUMBER: z.string().optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v))
  .refine((v) => v === undefined || /^\+[1-9]\d{6,14}$/.test(v) || /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/.test(v), {
    message: 'TWILIO_FROM_NUMBER must be an E.164 number (+371…) or an alphanumeric sender ID (≤11 chars, at least one letter).',
  }),
```

Plus, inside the **existing** `superRefine`, *above* the production gate (deliberate deviation from the production-only pattern, with this comment): a partial trio is a misconfiguration in every environment — in dev it silently binds the stub while you think you are testing Twilio; in production the factory's refusal would blame "no provider" when the real problem is one missing var. Emit one issue per missing key:

```ts
const twilioKeys = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'] as const;
const set = twilioKeys.filter((k) => env[k] !== undefined);
if (set.length > 0 && set.length < twilioKeys.length) {
  for (const k of twilioKeys.filter((k) => env[k] === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k],
      message: `${k} is missing: TWILIO_* must be set all together or not at all (a partial config silently binds the stub).` });
  }
}
```

Production completeness stays the **factory's** job (structural refusal) — the schema does not duplicate it.

---

## IMPLEMENTATION PLAN

### Phase 1: Shared catalog (packages/shared)

**Tasks:**
- Add `sms.otp_code` to `MESSAGES` (all three languages). Terse — SMS bill per segment; the LV string is deliberately diacritic-free so it stays GSM-7 (1 segment): lv `'Sakta Cab kods: {code}'` · ru `'Код Sakta Cab: {code}'` · en `'Sakta Cab code: {code}'`. The `satisfies` clause and `tests/i18n.test.ts` enforce parity with zero test edits.

### Phase 2: Env schema (services/api)

**Independent of:** Phase 1.

**Tasks:**
- Add the `TWILIO_*` trio to `env.schema.ts` per Patterns; add the all-or-nothing block to the superRefine; rewrite the stale "Unreachable while the stub SMS factory refuses production boot" comment on the `PUBLIC_TRACKING_BASE_URL` check (it becomes live the moment the trio is set in production).
- Extend `env.schema.spec.ts` with a `TWILIO_*` describe block.

### Phase 3: Provider + factory (services/api)

**Depends on:** Phases 1–2 (uses `formatMessage` + `env.TWILIO_*` types).

**Tasks:**
- `twilio-sms.provider.ts` per Patterns (config interface, injectable fetch, timeout const, leak-safe errors, segments log).
- Factory branch in `auth.module.ts` + docblock rewrite ("real provider binds when the trio is present (#85); until then production still refuses").
- Docblock touch-ups: `stub-sms.provider.ts` (three "#13" references → the real file / #85), `notifications.module.ts` ("two stub instances" → "two provider instances").
- Extend `auth.module.spec.ts` with the trio-present case.

### Phase 4: `.env.example` + validation

**Tasks:**
- Update the Twilio block comment: trio is all-or-nothing; value may be an alphanumeric sender (`SaktaCab`, ≤11 chars, no LV registration) on paid accounts or the trial number on trials; empty in dev keeps the console-log stub.
- Full gate + manual smoke with trial credentials.

---

## STEP-BY-STEP TASKS

### UPDATE `packages/shared/src/i18n.ts`

- **IMPLEMENT**: `'sms.otp_code'` in `lv` (`'Sakta Cab kods: {code}'`), `ru` (`'Код Sakta Cab: {code}'`), `en` (`'Sakta Cab code: {code}'`). Alphabetical/topical placement next to the other `sms.*` keys.
- **PATTERN**: `i18n.ts:16-21` — terse SMS keys, `{placeholder}` style.
- **GOTCHA**: keep the LV string diacritic-free on purpose (GSM-7, 1 segment) — add no trailing period-free inconsistency; the existing `sms.*` keys end with periods only when full sentences. Compile fails until ru/en carry the key (`satisfies`).
- **VALIDATE**: `pnpm --filter @taxi/shared test && pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #3 (no hardcoded user-facing strings)

### UPDATE `services/api/src/common/config/env.schema.ts`

- **IMPLEMENT**: the three fields + superRefine block per Patterns; rewrite the `:120-123` comment ("Unreachable while…" → "Live once TWILIO_* is set: this is what stops a production deploy texting localhost links").
- **PATTERN**: `env.schema.ts:72-79` (`STRIPE_SECRET_KEY` — the exact optional/transform/refine order), `:100-143` (superRefine issue style).
- **GOTCHA**: transform-to-`undefined` must precede the refine or the committed empty strings in `.env.example` fail a fresh checkout. The trio check goes **above** the `if (env.NODE_ENV !== 'production') return;` early-return — it applies to every environment (comment says why; see Patterns).
- **VALIDATE**: `cd services/api && npx jest env.schema`
- **SATISFIES**: AC #2

### UPDATE `services/api/src/common/config/env.schema.spec.ts`

- **IMPLEMENT**: `describe('envSchema TWILIO_*')`: full trio parses with values retained, in dev and production (expected); empty strings read as `undefined` so the stub binds — the `.env.example` case (edge); SID without `AC` prefix refused (failure); partial trio refused naming each missing key (failure); `TWILIO_FROM_NUMBER: 'SaktaCab'` accepted and a 12-char alpha / digit-only non-E.164 refused (edge).
- **PATTERN**: `env.schema.spec.ts:114-158` (the STRIPE block — `it.each` for the absent/empty pair), `prod()` helper for production cases.
- **VALIDATE**: `cd services/api && npx jest env.schema`
- **SATISFIES**: AC #2, test bar (≥1 expected + edge + failure)

### CREATE `services/api/src/features/auth/sms/twilio-sms.provider.ts`

- **IMPLEMENT**: per Patterns — `TwilioConfig`, `TwilioSmsProvider` with injectable `fetchFn`, `SMS_HTTP_TIMEOUT_MS = 10_000` module const, `send()` POSTing form-encoded To/From/Body with Basic auth + timeout signal, 2xx → parse JSON → `auth.sms.twilio_sent` log with `segments`, non-2xx → best-effort JSON parse → `throw new Error(\`twilio_error_${code ?? status}\`)`; `sendOtp()` delegates to `send()` with `formatMessage('lv', 'sms.otp_code', { code })`.
- **PATTERN**: `stripe-payments.provider.ts:15` (narrow injectable), `stub-sms.provider.ts` (Logger + maskPhone usage, docblock tone); logging per `.claude/references/logging-standard.md`.
- **IMPORTS**: `Logger` from `@nestjs/common`; `formatMessage`, type `SmsProvider` from `@taxi/shared`; `maskPhone` from `../phone-mask`. `Buffer` is fine here (API, not shared).
- **GOTCHA**: never put Twilio's `message`, the SMS body, or the raw phone in a thrown error — `auth.service.ts:195` logs `err.message` verbatim. Never log `Body`. `AbortSignal.timeout` throws a `TimeoutError` `DOMException` — it propagates as a throw, which is the correct seam behavior; no special-casing.
- **VALIDATE**: `cd services/api && npx jest twilio-sms`
- **SATISFIES**: AC #1

### CREATE `services/api/src/features/auth/sms/twilio-sms.provider.spec.ts`

- **IMPLEMENT**: fake `fetchFn` capturing `(url, init)` and returning canned `Response`s (`new Response(JSON.stringify({...}), { status })`).
  - (expected) `send()` POSTs the account-scoped URL with Basic auth of `sid:token`, form fields To/From/Body; resolves on 201; logs `segments` from `num_segments`.
  - (expected) `sendOtp()` sends the `lv` catalog body with the code interpolated (assert exact string from `formatMessage`).
  - (edge) alphanumeric `from` passes through untouched; `init.signal` is an `AbortSignal` (the timeout is wired).
  - (failure) 400 with `{ code: 21211, message: 'Invalid To number +37120000001' }` → rejects with message `twilio_error_21211`, and the thrown message contains **neither** the phone **nor** the body (the leak pin); non-JSON error body → `twilio_error_<status>`.
- **PATTERN**: `payments.module.spec.ts` title style; `stripe-payments.provider.spec.ts` for faking a provider surface.
- **VALIDATE**: `cd services/api && npx jest twilio-sms`
- **SATISFIES**: AC #1, test bar

### UPDATE `services/api/src/features/auth/auth.module.ts` (+ docblock touch-ups in `stub-sms.provider.ts`, `notifications.module.ts`)

- **IMPLEMENT**: factory branch per Patterns; rewrite the factory docblock (the boot-refusal rationale stays, "#13 replaces this factory" becomes "the trio binds `TwilioSmsProvider` (#85); until it is set, production refuses"). Update `stub-sms.provider.ts`'s three `#13` references and `notifications.module.ts`'s "two stub instances" wording.
- **PATTERN**: `payments.module.ts:35-47` — real-branch first, refusal second, stub last.
- **GOTCHA**: do NOT change the factory signature or either module's `inject: [APP_ENV]` binding — `auth.module.spec.ts:26-41` pins the binding by reflection and must keep passing unmodified.
- **VALIDATE**: `cd services/api && npx jest auth.module`
- **SATISFIES**: AC #1, AC #4

### UPDATE `services/api/src/features/auth/auth.module.spec.ts`

- **IMPLEMENT**: new case — `smsProviderFactory` returns `TwilioSmsProvider` whenever the trio is present, in every `NODE_ENV` including production (mirror `payments.module.spec.ts:13-19`'s "a client exists already means configured" comment: the schema's refines ran before the factory ever sees the values). Extend the `env()` helper to accept overrides (`(NODE_ENV, over?) => ({ NODE_ENV, ...over }) as Env`). Update the stale `#13` comment in the production-refusal case.
- **PATTERN**: `payments.module.spec.ts` — the exact three-case shape this file already follows.
- **VALIDATE**: `cd services/api && npx jest auth.module`
- **SATISFIES**: AC #1, AC #4, test bar

### UPDATE `.env.example`

- **IMPLEMENT**: rewrite the Twilio block comment: all three set together or none (schema enforces); `TWILIO_FROM_NUMBER` accepts an alphanumeric sender ID (`SaktaCab`, ≤11 chars — free, no registration in LV, paid accounts only) or an E.164 number (trial accounts must use their trial number); empty in dev = OTP + ride SMS fall back to the console-logging stub. Keys and empty values stay exactly as they are.
- **GOTCHA**: `.env.example` is the committed contract — no real values, ever.
- **VALIDATE**: `grep -A4 "Twilio" .env.example` reads correctly; fresh-checkout boot still works: `pnpm --filter @taxi/api dev` starts with the stub.
- **SATISFIES**: AC #2

### Manual E2E + gate

- **IMPLEMENT**: with a Twilio trial account (verify your own +371 number, enable Latvia in Messaging Geo permissions, use the trial number as `TWILIO_FROM_NUMBER`): set the trio in `.env`, `pnpm --filter @taxi/api dev`, `POST /auth/request-otp` for your number → real SMS arrives (trial prefix expected); then blank the trio → boot again → stub logs return. Optionally run one phone-channel ride to see a ride SMS. Confirm the factory's production refusal: `npx jest auth.module env.schema`.
- **VALIDATE**: `pnpm turbo run typecheck lint test build --force` from cleared dist (CI parity — `pnpm check` is NOT the gate). Set `REDIS_TEST_URL` (port per your `.env` `REDIS_PORT`, memory says 6381) so the Redis suites run. Check no other Claude session is mid-integration-run first (the suite `DROP DATABASE … WITH (FORCE)`s).
- **SATISFIES**: all ACs + Done definition

---

## TESTING STRATEGY

### Unit Tests

`twilio-sms.provider.spec.ts` (fake fetch — request shape, success log, leak-safe failures) · `auth.module.spec.ts` (factory branching incl. production) · `env.schema.spec.ts` (trio parsing, prefix, all-or-nothing).

### Integration Tests

No new ones. The existing `auth.integration.spec.ts` and notifications suites ARE the "both consumers work unchanged" proof: the harness overrides `SMS_PROVIDER` by token across the graph, `setup-env.ts` never loads `.env`, so jest always exercises the stub/recorder path and stays offline. A green existing suite is the acceptance evidence.

### Edge Cases

Empty-string trio (fresh checkout) → stub · partial trio → schema refusal naming the missing key · alphanumeric sender through schema and provider · Twilio 4xx with phone-bearing message → leak-free throw · non-JSON error body · timeout → throw (consumers already handle) · production without trio → boot refusal (unchanged behavior, re-pinned).

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`pnpm turbo run typecheck lint --force`

### Level 2: Unit Tests

`pnpm --filter @taxi/shared test` · `cd services/api && npx jest twilio-sms auth.module env.schema`

### Level 3: Integration Tests

`REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test` — full API suite; proves consumers unchanged. (Concurrent-session warning: the global setup drops the test DB with FORCE.)

### Level 4: Manual Validation

The Manual E2E task: one real OTP SMS on a trial account, stub fallback on blanked trio.

### Level 5: Full gate

`pnpm turbo run typecheck lint test build --force` — the Done definition.

---

## ACCEPTANCE CRITERIA

- [ ] AC #1 — `SmsProvider` (`sendOtp` + `send`) implemented against the real Twilio gateway inside the factory branch; a configured production env boots past the SMS gate
- [ ] AC #2 — `.env.example` ↔ `env.schema.ts` reconciled: schema knows all three `TWILIO_*` keys (prefix-refine + superRefine), empty example values still boot the stub
- [ ] AC #3 — gateway evaluation recorded (NOTES) before defaulting to Twilio; OTP copy in the shared catalog; success logs carry `segments` for the €/week ledger row
- [ ] AC #4 — both consumers work unchanged: zero edits in `auth.service.ts` / `ride-notifications.service.ts`; existing suites green
- [ ] No secrets or SMS bodies in logs or thrown errors; phones masked everywhere
- [ ] `pnpm turbo run typecheck lint test build --force` green

## COMPLETION CHECKLIST

- [ ] `git pull` + `git reflog -8` checked before branching (concurrent-sessions rule); branch from current `main`
- [ ] All tasks executed top-to-bottom, each VALIDATE run at the time
- [ ] Stale `#13` docblocks corrected (factory, stub ×2); stale env.schema `Unreachable…` comment corrected
- [ ] `.env.example` and `env.schema.ts` agree on the trio; `GOOGLE_MAPS_API_KEY` drift deliberately left (maps ticket)
- [ ] PR body links `Closes #85`

---

## OPEN QUESTIONS / ASSUMPTIONS

Flagged for Linards; the plan proceeds on the starred resolutions — override before execution if wrong:

1. ★ **Twilio confirmed as the pilot gateway** (the ticket's mandated evaluation, full table in NOTES). Short version: Messente is disqualified (€500/mo minimum), local LV operator gateways need a legal entity we don't have, BudgetSMS (€0.045/seg, no minimum) is the credible cheaper option but is an aggregator with weaker reliability guarantees on the *login* path. Twilio at $0.0801/seg costs euros at pre-pilot volume, and the swap stays one class + one factory line. If you'd rather start on BudgetSMS-class pricing immediately, the plan shape is identical — say so before execution.
2. ★ **Sender = alphanumeric `SaktaCab`** once on a paid account (free, no LV registration, no number rental; one-way is fine — nothing invites replies). Trial validation uses the trial number. If two-way SMS is ever wanted, buy a number ($1.15/mo) and just change the env var.
3. ★ **OTP language is fixed `lv`** — at request-otp time there may be no user row, so no preference exists to read. Looking up `users.language` by phone for returning users would put a DB read inside the provider or change the seam signature — deferred until evidence it matters.
4. ★ **No `twilio` SDK** — native fetch, injectable for tests. If SDK parity with Stripe is preferred, the swap is contained in one file (+1 dependency).
5. ★ **Trio all-or-nothing check runs in every env** (deviation from the production-gated house superRefine, reasoned in Patterns). If you want it production-only, delete the comment + move the block below the gate.
6. **Production boot remains blocked by the maps (and unset-Stripe) stubs after this ships** — assumed acceptable: the ticket is the *SMS* pre-pilot gate. The maps provider is its own ticket (and owns the `GOOGLE_MAPS_API_KEY` drift).

## NOTES (open canvas)

### The mandated gateway evaluation (2026-08-11)

| Option | €/SMS-segment to LV | Minimums / fees | Usable without SIA? | Verdict |
|---|---|---|---|---|
| **Twilio** | $0.0801 (~€0.074) — [first-party](https://www.twilio.com/en-us/sms/pricing/lv) | none; alpha sender free; PAYG | yes (self-serve, trial first) | **Pilot default** — decided vendor (seam docblock, 2026-07-06), keys already shaped in `.env.example`, best deliverability/docs on the *login-blocking* path |
| Messente (EE) | n/a | **€500/mo or 25k msg minimum** ([pricing](https://messente.com/pricing)) | — | Disqualified for pilot scale |
| BudgetSMS | **€0.045** flat LMT/Tele2/Bite — [first-party](https://www.budgetsms.net/sms-gateway-pricing/lv/latvia/) | none | yes | The post-pilot swap candidate (~40% cheaper); aggregator-grade deliverability is the risk to test *outside* the OTP path first |
| Sinch / Plivo | ~$0.057 / ~$0.064 (secondary source, unverified) | varies | sales-mediated | Not worth the onboarding at pilot volume |
| Infobip | ~$0.10 | enterprise onboarding | no | No |
| LV operator gateway (LMT etc.) | contract | contract | **no — needs a legal entity** | Revisit post-SIA; likely the true "cheaper Latvian gateway" the seam docblock anticipated |

**Segment math the €/week row will see** (UCS-2 — Latvian diacritics and Cyrillic force 70-char segments, 67 when multipart): OTP 1 seg (kept GSM-7 deliberately) · `booking_confirmed` 1 · `booking_confirmed_phone` ~2 (46 chars + ~46-char link) · `driver_assigned` ~2 · `driver_arrived` 1. So an app-channel ride ≈ 2 segments (~€0.15 Twilio), a phone-channel ride ≈ 5 (~€0.37). At 100 rides/week (70 app / 30 phone) ≈ 290 seg/wk ≈ **€23/wk ≈ €100/mo — SMS alone can eat the entire guardrail at modest pilot volume.** That is why `segments` goes into the success log now: the ledger row gets real numbers from day one, and the swap/copy decisions get made on evidence.

**Cost levers deliberately not pulled here** (product/copy decisions — log as follow-ups): GSM-7 transliteration of SMS copy ("Jusu taksometrs ir rezervets") halves the link-SMS segment count; a shorter tracking domain shrinks every link SMS; dropping the app-channel `booking_confirmed` SMS (the rider is *in* the app) halves app-ride spend. Any one of these roughly re-fits SMS under the guardrail at 100 rides/week on Twilio pricing.

### Design notes

- **Why the provider lives in `auth/sms/`**: the stub, the token, and the factory already live there, and root CLAUDE.md pins SDK/vendor knowledge to "the slice implementing the seam". Notifications consumes the same token through auth's exported factory — the deliberate-duplicate arrangement `notifications.module.ts`'s docblock documents. Moving the provider to a "sms" slice of its own would be a bigger refactor for zero behavior.
- **Why no result-union on the seam** (à la `PAYMENT_FAILURE_REASONS`): both consumers already treat any throw as the one failure mode with their own recovery (502+cooldown-release / error-log-and-continue). A failure taxonomy would be invented, not discovered — YAGNI until a consumer needs to discriminate.
- **Idempotency**: none. Twilio has no SMS dedupe; a crash between commit and send loses at most one SMS — the same accepted risk the #63 plan recorded for socket emits.
- **Trial-account limits** (manual validation): sends only to verified numbers, body prefixed with "Sent from your Twilio trial account", no alpha sender. All fine for the smoke test; upgrade before pilot.
- **Doc-drift left alone on purpose**: `GOOGLE_MAPS_API_KEY` in `.env.example` is unknown to the schema — same drift class as the trio this ticket fixes, but it belongs to the real-maps-provider ticket (the next production-boot gate). Don't fix it in this PR.

## CONFIDENCE

**9.5/10** for one-pass implementation. Every touched pattern has a verified in-repo template at file:line (`STRIPE_SECRET_KEY` for the env shape, `paymentsProviderFactory` + its spec for the factory, the stub for logging style), the seam and both consumers ship untouched, and the two subtle risks — err.message phone leaks and the `.optional().transform().refine()` ordering — are pinned with explicit tests. The residual 0.5: Twilio account realities (geo permissions, trial restrictions) are outside the repo and could add manual-validation friction, and `num_segments`'s exact value on a just-created message is asserted loosely (`|| 1` fallback) for that reason.

## AMENDMENTS

<!-- append-only after first approval; newest at the bottom -->
