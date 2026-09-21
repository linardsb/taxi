# Feature: SMS provider bake-off — the instrument, not the verdict (#137)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **Read this first.** #137's acceptance criterion is `observed` delivery results from real LMT,
> Tele2 and Bite handsets. **This machine has no LV handsets and no funded BulkGate / BudgetSMS
> accounts.** So this plan does not produce the verdict. It produces **everything a human with
> three SIMs and two funded accounts needs to run the bake-off in one sitting and fill in a
> scorecard** — two real seam implementations, a send script, a run sheet, and a scorecard with
> empty `observed` cells. #137 stays open after this loop; the PR must not close it.

## Feature Description

Before pilot SMS volume, #137 requires a delivery bake-off of two EU gateways (BulkGate, BudgetSMS)
against the shipped `TwilioSmsProvider` (#85), scored on real Latvian handsets, with a switch behind
the `SmsProvider` seam only if a cheaper provider matches on every reliability criterion.

The bake-off cannot be run without a send path per candidate. This ticket builds those send paths as
**real seam implementations** — not a throwaway curl script — because one of the five criteria is
"what a failed send looks like on the seam's result type", and that is only scorable against the code
that would actually ship. It then builds the instrument that drives them and the document that
records the result.

## User Story

As **Linards, running the pilot on a <€100/mo budget**
I want **the bake-off reduced to: fund two accounts, hold three phones, run one command, fill one table**
So that **the provider decision rests on delivery observed on LMT, Tele2 and Bite rather than on the €15.15-vs-$34.82 price gap alone — and so that switching, if the evidence supports it, is one env var.**

## Problem Statement

SMS is the largest line item in the pilot budget (`docs/epics/sakta-cab.architecture.md:77`), and
BulkGate is `observed` 2026-08-14 at €0.0311/segment against Twilio's $0.0715 (research §4.1). But
those are **"from" rates on cheapest-route pricing**, and a cheap LV route that strips the
alphanumeric sender, delays, or silently drops is not a cost problem on the OTP path — it is a login
outage. Research §4.1 is explicit: *"Price is the tiebreaker, not the criterion."*

Two things block the decision today:

1. **There is no way to send through BulkGate or BudgetSMS at all.** The only `SmsProvider`
   implementations are `TwilioSmsProvider` and `StubSmsProvider`.
2. **There is nothing to fill in.** No scorecard, no run sheet, no list of what must be true before a
   handset day is worth booking.

## Solution Statement

Ship the instrument in one gate-verifiable loop:

- **Two real seam implementations** — `BulkGateSmsProvider` and `BudgetSmsProvider` — mirroring
  `twilio-sms.provider.ts` exactly: config interface, injectable `fetchFn`, shared timeout constant,
  leak-free thrown errors, a `segments` success log for the €/week ledger row. Each ships expected +
  edge + failure specs, including the **leak pin** (`auth.service.ts:199` logs `err.message`
  verbatim; both vendors' error text can echo the destination number).
- **`env.schema.ts` learns two credential groups** (`BULKGATE_*`, `BUDGETSMS_*`), each all-or-none
  by superRefine, plus an `SMS_PROVIDER` selector enum mirroring `PUSH_PROVIDER` — because
  credential presence cannot disambiguate two funded accounts.
- **`smsProviderFactory` gains the selector branch** and keeps its production refusal unchanged. The
  one factory stays one factory: `notifications.module.ts:42` binds `SMS_PROVIDER` with auth's
  exported factory, and the comment there calls it "the ONE factory carrying the production
  boot-refusal."
- **`services/api/scripts/sms-bakeoff.ts`** — a manual instrument on the `mint-tracked-ride.ts`
  footing: not a test, excluded from `dist/`, held to typecheck+lint, refuses to spend without an
  explicit confirm flag, prints its own derived spend, and emits scorecard rows on stdout.
- **`docs/research/sms-bakeoff-scorecard.md`** — prerequisites, the run sheet, and the empty
  scorecard grid, `driver-device-day.md` shape.

The **switch** is not in this loop. It is one env var after the scorecard has numbers.

## Out of Scope / Non-Goals

- **Not included: the verdict, the switch, or the "reason recorded" branch of AC #2.** Both depend on
  handset results this machine cannot produce. #137 stays open; the follow-up loop writes one of them.
- **Not included: delivery receipts / DLR webhooks or polling.** #85 excluded them on the same
  reasoning (fire-and-forget is the seam contract) and nothing changed. BudgetSMS's `/pullDlr/` and
  BulkGate's advanced API both exist; the scorecard records them as a **vendor capability** row, not
  as wired behaviour.
- **Not included: SMS copy or template-length changes.** That is #136 (1-segment templates, short
  domain, shorter token) and it is `blocked:accounts` on the `sakta.lv` domain.
- **Not included: skipping SMS for app-booked riders.** That is #135.
- **Not included: widening the `SmsProvider` seam to a result type.** See Open Questions Q1 — the
  ticket's own wording calls a new provider "a second implementation of `SmsProvider`", and the
  criterion is to *observe* the error shape through the existing contract, not to change it.
- **Not changing:** `StubSmsProvider` behaviour (the dev workflow reads OTP codes from its log),
  `TwilioSmsProvider`, either consumer (`auth.service.ts`, `ride-notifications.service.ts`), the
  harness's `RecordingSmsProvider`, or the factory's production boot refusal.

## Feature Metadata

**Feature Type**: New Capability (instrument + two provider implementations)
**Estimated Complexity**: Medium — two providers are pattern-copies; the honesty of the scorecard and the run sheet is the hard part
**Primary Systems Affected**: `services/api` auth slice (`features/auth/sms/`), `common/config/env.schema.ts`, `services/api/scripts/`, `docs/research/`
**Dependencies**: no new npm packages (plain `fetch`, same as #85). Two funded vendor accounts and three LV SIMs are **run-time** prerequisites, not build-time ones.

## Related Work

**Implements**: [#137](https://github.com/linardsb/taxi/issues/137) — partially: the instrument, not the verdict. **Epic**: [#1](https://github.com/linardsb/taxi/issues/1), via [#13](https://github.com/linardsb/taxi/issues/13) (the deploy plan that filed this). Architecture: `docs/epics/sakta-cab.architecture.md:127` records #137/#135/#136 as the SMS-cost trio and the "Twilio trial through testing" sequencing — inherited, not re-decided.

**Back-references**:

- `.claude/plans/real-sms-provider-twilio.md` (#85) — the pattern this copies: injectable `fetch` over an SDK, the `.optional().transform().refine()` env trio with an all-or-none superRefine, the `segments` success log, and the leak-free-error doctrine. Its §NOTES named this bake-off as the follow-up.
- `.claude/plans/mint-tracked-ride-dev-script.md` — the manual-instrument script footing (not a test, out of `dist/`, typecheck+lint held).
- `.claude/plans/driver-device-day-prep.md` + `docs/runbooks/driver-device-day.md` (#141) — the shape for a hardware-blocked run sheet: Result table first, prerequisites, a steps table naming the signal per step, and a binary verdict rule.
- `docs/research/hosting-sms-cost-research.md` §4.1–§4.4 — the rates, the segment arithmetic, and the "run a delivery bake-off before switching" instruction this ticket discharges.

**Forward-references**:

- The switch-or-record loop (writes AC #2's branch, closes #137) — no ticket; #137 owns it.
- [#135](https://github.com/linardsb/taxi/issues/135), [#136](https://github.com/linardsb/taxi/issues/136) — the two volume levers. Independent of this plan; neither blocks it nor is blocked by it.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `services/api/src/features/auth/sms/twilio-sms.provider.ts` (all 91 lines) — **the template.** Every structural choice in the two new providers is copied from here: `SMS_HTTP_TIMEOUT_MS = 10_000` module const with its "sendOtp blocks a login request" rationale (`:6-9`), an exported `…Config` interface, constructor `(config, fetchFn: typeof fetch = fetch)`, `sendOtp()` delegating to `send()` with `formatMessage('lv', 'sms.otp_code', { code })` (`:35-40`), `AbortSignal.timeout` on the request (`:58`), a locally-composed throw that names no phone and no body (`:62-68`), and a success log carrying `segments` (`:73-79`).
- `services/api/src/features/auth/sms/twilio-sms.provider.spec.ts` (all 139 lines) — **the spec template.** `fakeFetch(status, body)` capturing `(url, init)` (`:11-19`), and at `:105-129` the **leak pin**: a 4xx whose `message` echoes `+37120000001` must still throw `twilio_error_21211`, asserted with both `not.toContain('+37120000001')` and `not.toContain('secret body')`.
- `services/api/src/features/auth/auth.service.ts:189-202` — **why the leak pin exists.** The `catch` logs `error: err.message` verbatim (`:199`) and answers 502. Anything a provider puts in a thrown `Error` lands in the log.
- `services/api/src/features/auth/auth.module.ts:13-41` — `smsProviderFactory`. The doc comment (`:13-22`) states the production-refusal reasoning; the refusal is `:35-39`. This is the only function to change for selection.
- `services/api/src/features/auth/auth.module.spec.ts` (all 61 lines) — the four cases that must keep passing, including `:45-60` which reads `Reflect.getMetadata('providers', AuthModule)` to pin that the module really binds `SMS_PROVIDER` to this factory and not to a `useClass`.
- `services/api/src/features/notifications/notifications.module.ts:14-18,42` — the **second** binding of `SMS_PROVIDER`, deliberately using auth's exported factory. Comment: "the ONE factory carrying the production boot-refusal; forking it would fork that guarantee." Any selection logic goes inside the factory, never beside it.
- `services/api/src/common/config/env.schema.ts:246-286` — the `TWILIO_*` trio: the `.optional().transform(empty → undefined).refine()` order at `:256-267` (the refine must see the transformed value) and the `TWILIO_FROM_NUMBER` shape refine at `:273-286`. `:286-294` — the `PUSH_PROVIDER` enum (the enum itself is `:294`) with its "a switch rather than credential-driven … the intent has to be stated" rationale, which is exactly why this ticket needs a selector. `:322-344` — the all-or-none superRefine for the trio, deliberately above the production gate, one issue per missing key.
- `services/api/src/features/push/push.tokens.ts:5` — `export const PUSH_PROVIDER = 'PUSH_PROVIDER'`. Precedent that an env var and a DI token may share a name in this repo.
- `packages/shared/src/seams/sms-provider.ts` (all 10 lines) — the seam. `sendOtp(phoneE164, code)` and `send(phoneE164, body)`, both `Promise<void>`, throwing on failure. **Unchanged this ticket.**
- `services/api/scripts/mint-tracked-ride.ts:1-45` — the manual-instrument docblock shape: what it does, why it exists, "NOT A TEST", why it is held to typecheck+lint, and a RUN CEILING section.
- `services/api/scripts/provision-dispatcher.ts:1-30` — the smaller script shape and the `pnpm --filter @taxi/api <script> <args>` invocation note ("no `--` separator — pnpm 10 forwards it literally").
- `services/api/tsconfig.build.json` — `"exclude": [… "scripts" …]`. This is what keeps the script out of `dist/` and therefore out of the 500-line `max-lines` cap.
- `packages/config/eslint/base.mjs:36` — `max-lines` at 500; `:39-57` the override block that turns it off, whose `files` array names `**/*.spec.ts` and `**/scripts/**` explicitly (`observed` 2026-09-20). So both new specs and the script are uncapped, and the comment there calls them "outside the rule, not merely lenient under it".
- `packages/shared/src/i18n/lv.ts:11-19` — the five `sms.*` templates. `sms.otp_code` is deliberately diacritic-free (GSM-7, 1 segment); `sms.driver_assigned` is the 2-segment UCS-2 worst case the bake-off must send.
- `docs/runbooks/driver-device-day.md` — the run-sheet shape to mirror: Result table at the top (§`## Result`), `## Setup`, a `## Steps` table with a "Signal" column naming *where* each signal appears, and `## Verdict` with a binary rule.

### New Files to Create

- `services/api/src/common/config/sms-env.schema.ts` — **added during implementation (2026-09-21, see AMENDMENTS 1).** The three credential groups' fields, the `SMS_GROUPS` table and `checkSmsCredentialGroups`. 264 lines (`observed`).
- `services/api/src/features/auth/sms/bulkgate-sms.provider.ts` — `BulkGateSmsProvider`, ~95 lines (`expected`).
- `services/api/src/features/auth/sms/bulkgate-sms.provider.spec.ts` — expected + edge + failure, incl. the leak pin.
- `services/api/src/features/auth/sms/budgetsms.provider.ts` — `BudgetSmsProvider`, ~95 lines (`expected`). **Filename note:** not `budgetsms-sms.provider.ts`; the vendor name already ends in "SMS" and the stutter reads as a typo.
- `services/api/src/features/auth/sms/budgetsms.provider.spec.ts` — expected + edge + failure, incl. the leak pin.
- `services/api/scripts/sms-bakeoff.ts` — the manual send instrument.
- `docs/research/sms-bakeoff-scorecard.md` — prerequisites + run sheet + empty scorecard.

### Files to Update

- `services/api/src/common/config/env.schema.ts` — spreads in `smsEnvFields` and calls `checkSmsCredentialGroups`, both from `sms-env.schema.ts`. **The fields and the check themselves live there, not here** (2026-09-21, AMENDMENTS 1): writing them inline took this file to 553 lines, past the 500-line `max-lines` error.
- `services/api/src/features/auth/auth.module.ts` — the selector branch inside `smsProviderFactory`.
- `services/api/src/features/auth/auth.module.spec.ts` — `SMS_PROVIDER: 'auto'` in the `env()` helper, plus new cases.
- `.env.example` — two commented credential blocks and the selector, matching the `TWILIO_*` block's tone.
- `services/api/package.json` — an `sms:bakeoff` script entry.

**Not** `turbo.json`. Checked: `globalEnv` is `DATABASE_URL, REDIS_URL, JWT_SECRET, OTP_PEPPER, API_PORT, REDIS_TEST_URL` and no task declares `TWILIO_*`. Nothing in the test path reads real SMS credentials — `twilio-sms.provider.spec.ts:5-9` uses a literal `CONFIG` and `auth.module.spec.ts:8-9` casts a plain object to `Env` — so the new groups need no passlist entry. The script runs under `pnpm --filter`, not under turbo, so turbo's strict-mode stripping never applies to it.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

**BulkGate Simple Transactional SMS** (all `observed` 2026-09-20 from the vendor's own docs):

- [Specification](https://help.bulkgate.com/docs/en/http-simple-transactional.html) — endpoint `https://portal.bulkgate.com/api/1.0/simple/transactional`; GET, POST form, or POST JSON. Required: `application_id`, `application_token`, `number`, `text`. Optional: `unicode` (**default false = 7-bit**), `sender_id`, `sender_id_value`, `country`, `schedule`, `duplicates_check`, `tag`.
- [POST JSON method](https://help.bulkgate.com/docs/en/http-simple-transactional-post-json.html) — the literal request body shape, including `"sender_id": "gText", "sender_id_value": "BulkGate"` for an alphanumeric sender.
- [Error types](https://help.bulkgate.com/docs/en/api-error-types.html) — errors return a **non-200** HTTP status matching the envelope's `code`. Envelope: `{"type":"invalid_phone_number","code":400,"error":"Invalid phone number","detail":null}`. Types: `unknown_identity` (401), `banned`, `invalid_numeric_sender`, `empty_message`, `invalid_phone_number` (400), `admin_not_found`, `no_recipients`, `blacklisted_number`, `low_credit`, `method_not_allowed`, `unknown_action`, `unsupported_api_version`, `unknown`.
- [API administration & tokens](https://help.bulkgate.com/docs/en/http-simple-api-administration.html) — where `application_id` / `application_token` are minted. Needed by the run sheet's prerequisites.
- Success envelope, quoted from the Specification page:
  ```json
  { "data": { "status": "accepted", "sms_id": "tmpde1bcd4b1d1",
              "part_id": ["tmpde1bcd4b1d1_1","tmpde1bcd4b1d1_2","tmpde1bcd4b1d1"],
              "number": "447700900000" } }
  ```

**BudgetSMS HTTP API** (`observed` 2026-09-20 from [HTTP API Specification V2.7](https://www.budgetsms.net/downloads/SMS-Gateway-HTTP-api.pdf), §2 Sending SMS, §3 Extra information, §4 testsms, §10 Error codes; the [Send SMS page](https://www.budgetsms.net/sms-http-api/send-sms/) is the same content without the response formats):

- Endpoint `https://api.budgetsms.net/sendsms/`, **HTTP GET only**, all parameters in the query string.
- Mandatory: `username` (alphanumeric), `userid` (numeric), `handle` (alphanumeric — this is the API secret), `msg`, `from`, `to`. Optional: `customid`, `price`, `mccmnc`, `credit` (each `1`/`0`).
- `to` is **E.164 without the `+`** and without a leading zero: `31612345678`. The seam hands us `+371…`.
- `from`: alphanumeric max 11 chars, `[a-zA-Z0-9]` only — **narrower than Twilio's**, which the repo's existing refine permits a space in.
- **Responses are plain text, and an error still comes back on a 200.** Literal: `OK 12345678` or `ERR 3001`. With `price=1`: `OK 1234567 0.055 1` where the trailing `1` is the **number of SMS parts**. With both `price=1` and `mccmnc=1`: `OK 1234567 0.055 1 20416`.
- "Be sure to always use URL encoding before making the HTTP call. Use UTF-8 encoding" — there is **no `unicode` parameter**; UTF-8 is assumed and error `2016` is "Invalid UTF-8 encoding".
- [testsms](https://www.budgetsms.net/sms-http-api/test-sms/) — `https://api.budgetsms.net/testsms/`, same parameters, "No credit will be deducted from your account and no SMS messages will be send." **This is the credential pre-flight the run sheet uses before spending anything.**
- §10 error codes: `1001` not enough credit · `2001`–`2017` request/encoding faults (`2003` alphanumeric sender >11 chars, `2008` text not OK, `2016` invalid UTF-8) · `3001` no route to destination · `4001`–`4007` system errors.

**Twilio** (unchanged, for the scorecard's third column):

- [Alphanumeric sender IDs](https://www.twilio.com/docs/messaging/services/services-send-messages#alphanumeric-sender-id) — Latvia needs no pre-registration, ≤11 chars, free, one-way. **Trial accounts cannot use them.**
- [Twilio SMS pricing, Latvia](https://www.twilio.com/en-us/sms/pricing/lv) — re-observe at run time; research §4.1's $0.0715 is `observed 2026-08-14`.

### Patterns to Follow

**Provider class shape** (from `twilio-sms.provider.ts`):

```ts
const SMS_HTTP_TIMEOUT_MS = 10_000;

export interface BulkGateConfig { applicationId: string; applicationToken: string; senderIdValue: string; }

export class BulkGateSmsProvider implements SmsProvider {
  private readonly logger = new Logger(BulkGateSmsProvider.name);
  constructor(
    private readonly config: BulkGateConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}
  async sendOtp(phoneE164: string, code: string): Promise<void> {
    await this.send(phoneE164, formatMessage('lv', 'sms.otp_code', { code }));
  }
  async send(phoneE164: string, body: string): Promise<void> { /* … */ }
}
```

**Leak-free error** (the doctrine, `twilio-sms.provider.ts:62-68`): throw a **locally composed**
string carrying only a vendor-stable diagnosis handle. Never the vendor's `error`/`message` text,
never the SMS body, never the raw phone.

**Success log** (`twilio-sms.provider.ts:73-79`): `event`, `phone: maskPhone(phoneE164)`, `segments`
(number — the €/week ledger row reads it), a vendor message id, `at`. **Never the body.**

**Env var** (`env.schema.ts:256-272`): `.optional()` → `.transform(v => (v === undefined || v === '' ? undefined : v))` → `.refine(...)`, in that order, so the refine sees the transformed value and an empty `.env.example` line still boots.

**Manual script** (`mint-tracked-ride.ts:1-45`): docblock states what it does, why it exists, "NOT A TEST … held to `typecheck` and `lint` so it cannot rot, and kept out of `dist/` by `tsconfig.build.json`", and a RUN CEILING paragraph.

---

## IMPLEMENTATION PLAN

### Phase 1: Config surface

The two credential groups and the selector. Everything downstream reads `Env`, so this is first.

### Phase 2: The two providers

**Depends on:** Phase 1 (each provider's `…Config` mirrors its env group).
**Independent of:** Phase 3 — the two providers do not reference each other and can be written in either order, or in parallel.

### Phase 3: Factory selection

**Depends on:** Phases 1 and 2.

### Phase 4: The instrument

**Depends on:** Phases 1–3.

### Phase 5: The scorecard and run sheet

**Depends on:** Phase 4 (the run sheet cites the script's actual flags and output shape).
**Note:** writing this phase before Phase 4 is the classic way to end up with a run sheet describing a script that was never built. Write the script first, then document what it does.

---

## STEP-BY-STEP TASKS

### CREATE `services/api/src/common/config/sms-env.schema.ts` — the BulkGate group

- **IMPLEMENT**: `BULKGATE_APPLICATION_ID`, `BULKGATE_APPLICATION_TOKEN`, `BULKGATE_SENDER_ID_VALUE`, each with the `.optional().transform(empty → undefined)` house pattern. Refine `BULKGATE_SENDER_ID_VALUE` to the **BulkGate** alphanumeric shape: `[A-Za-z0-9 ]{1,11}` with at least one letter, mirroring `TWILIO_FROM_NUMBER`'s second alternative (`:279-284`) — BulkGate's `gText` sender is an alphanumeric sender ID, never an E.164 number, so the number alternative is deliberately absent.
- **PATTERN**: `env.schema.ts:256-267` (the transform/refine order), `:273-286` (the shape refine and its message).
- **AS SHIPPED (2026-09-21, AMENDMENTS 1)**: these fields go into `sms-env.schema.ts`'s exported `smsEnvFields` object and are spread back into `envSchema` at the position they would have occupied. The `TWILIO_*` trio moved with them, as one concern. The composed schema is unchanged in shape and in every message it can emit.
- **IMPORTS**: none new.
- **GOTCHA**: the block comment must not claim these bind anything by presence — after this ticket, **presence no longer selects**. Say so: "presence makes the kind selectable; `SMS_PROVIDER` selects."
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3

### CREATE `services/api/src/common/config/sms-env.schema.ts` — the BudgetSMS group

- **IMPLEMENT**: `BUDGETSMS_USERNAME`, `BUDGETSMS_USERID`, `BUDGETSMS_HANDLE`, `BUDGETSMS_FROM`, same house pattern. Refine `BUDGETSMS_USERID` to `/^\d+$/` (the spec says numeric) and `BUDGETSMS_FROM` to `/^(?=.*[A-Za-z])[A-Za-z0-9]{1,11}$/`.
- **PATTERN**: same as above.
- **GOTCHA**: **`BUDGETSMS_FROM` must be stricter than `TWILIO_FROM_NUMBER`.** The Twilio refine permits a space (`[A-Za-z0-9 ]{1,11}`); BudgetSMS §2 documents "allowed: [a-z], [A-Z] and [0-9]" only, and a space earns error `2004`/`2003` at send time. Copying the Twilio regex verbatim is the bug this GOTCHA exists to stop.
- **GOTCHA**: this group is **four** vars, not three. The superRefine below must be written over a list, not hardcoded to a trio.
- **GOTCHA**: `BudgetSmsConfig.baseUrl` is **not** an env var and gets no schema entry. It is a constructor default the bake-off script overrides for `/testsms/`; putting it in the schema would make a test endpoint a production-configurable one. Same for the script's `BAKEOFF_LMT` / `BAKEOFF_TELE2` / `BAKEOFF_BITE` recipients — script-only, read directly, never in `envSchema`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3

### CREATE `services/api/src/common/config/sms-env.schema.ts` — the `SMS_PROVIDER` selector

- **IMPLEMENT**: `SMS_PROVIDER: z.enum(['auto', 'twilio', 'bulkgate', 'budgetsms']).default('auto')`. Document `'auto'` as **exactly today's behaviour** — the `TWILIO_*` trio binds Twilio, otherwise the stub, otherwise production refuses — so this change is additive and no existing `.env` moves.
- **PATTERN**: `env.schema.ts:286-294`'s `PUSH_PROVIDER` enum (the enum is `:294`), and quote its reasoning: a switch rather than credential-driven, "the intent has to be stated". Here that reasoning is forced rather than chosen — during the bake-off **two or three credential groups are funded simultaneously**, so presence cannot disambiguate.
- **GOTCHA**: the env var name `SMS_PROVIDER` collides with the DI token string `sms.tokens.ts:1`. That collision is the established repo arrangement (`push.tokens.ts:5` + `env.schema.ts:294` are both `PUSH_PROVIDER`); do not invent a third naming convention to avoid it.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3

### CREATE `services/api/src/common/config/sms-env.schema.ts` — the two superRefines, and UPDATE `env.schema.ts` to call them

- **IMPLEMENT**: generalise the existing `TWILIO_*` block into a table-driven loop and add the selector check, **both above `env.schema.ts:344`'s `if (env.NODE_ENV !== 'production') return;`**:

  **Corrected 2026-09-21 (AMENDMENTS 2) — the two-parallel-`as const`-records version this task
  first printed does not typecheck.** `Object.entries` widens the key to `string`, so `PREFIX[kind]`
  fails; and `keys` becomes a UNION of three readonly tuples, so `keys.filter(...)` errors with
  "this expression is not callable, signatures are not compatible". One typed record, not two:

  ```ts
  type SmsCredentialKey = 'TWILIO_ACCOUNT_SID' | /* … all ten … */ 'BUDGETSMS_FROM';
  export type SmsProviderKind = 'twilio' | 'bulkgate' | 'budgetsms';

  const SMS_GROUPS: Record<
    SmsProviderKind,
    { prefix: string; keys: readonly SmsCredentialKey[] }
  > = {
    twilio: { prefix: 'TWILIO_*', keys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'] },
    bulkgate: { prefix: 'BULKGATE_*', keys: ['BULKGATE_APPLICATION_ID', 'BULKGATE_APPLICATION_TOKEN', 'BULKGATE_SENDER_ID_VALUE'] },
    budgetsms: { prefix: 'BUDGETSMS_*', keys: ['BUDGETSMS_USERNAME', 'BUDGETSMS_USERID', 'BUDGETSMS_HANDLE', 'BUDGETSMS_FROM'] },
  };

  // All-or-none, EVERY environment - unchanged reasoning, now over three groups.
  for (const { prefix, keys } of Object.values(SMS_GROUPS)) {
    const present = keys.filter((k) => env[k] !== undefined);
    if (present.length === 0 || present.length === keys.length) continue;
    for (const k of keys.filter((k) => env[k] === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [k],
        message: `${k} is missing: ${prefix} must be set all together or not at all (a partial config silently binds the stub).`,
      });
    }
  }

  // An explicitly named kind must have its whole group. 'auto' demands nothing.
  if (env.SMS_PROVIDER !== 'auto') {
    const missing = SMS_GROUPS[env.SMS_PROVIDER].keys.filter((k) => env[k] === undefined);
    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMS_PROVIDER'],
        message: `SMS_PROVIDER=${env.SMS_PROVIDER} needs ${missing.join(', ')}.`,
      });
    }
  }
  ```

- **PATTERN**: `env.schema.ts:322-344`. Keep its two deliberate properties verbatim: the check runs in **every** environment, and it emits one issue **per missing key**.
- **AS SHIPPED (2026-09-21, AMENDMENTS 1)**: the loop and the selector check live in `sms-env.schema.ts` as `checkSmsCredentialGroups(env, ctx)`, and `env.schema.ts`'s superRefine calls it in one line. **The PLACEMENT stays the caller's**, which is why the GOTCHA below is still addressed to `env.schema.ts`.
- **GOTCHA — placement is load-bearing.** `:344` is `if (env.NODE_ENV !== 'production') return;`. Anything added below it fires **only in production**, and the dev misconfiguration this check exists to catch would then pass silently in the one environment where you would actually hit it. Both blocks go above that line.
- **GOTCHA — the existing message text is asserted verbatim and so is its ORDER.** `env.schema.spec.ts:216` matches `/TWILIO_AUTH_TOKEN is missing[\s\S]*TWILIO_FROM_NUMBER is missing/` — a regex that pins the two issues' **relative order**. The loop above preserves it because it iterates the declared key array; a refactor that sorts keys, iterates a `Map`, or collects into a `Set` breaks a green-looking test in a way the diff does not show. Keep the `TWILIO_*` message string byte-identical (`PREFIX.twilio` reproduces it).
- **GOTCHA**: `SMS_PROVIDER: 'twilio'` with a full trio must pass. `SMS_PROVIDER: 'auto'` with **no** groups set must still pass — that is a fresh dev checkout and the committed example template.
- **VALIDATE (extra)**: `pnpm --filter @taxi/api test -- env.schema` must stay at its existing count **plus** the new cases; a *drop* means the order regex stopped matching.
- **VALIDATE**: `pnpm --filter @taxi/api test -- env.schema`
- **SATISFIES**: AC #3

### CREATE `services/api/src/features/auth/sms/bulkgate-sms.provider.ts`

- **IMPLEMENT**: `BulkGateConfig { applicationId, applicationToken, senderIdValue }` and `BulkGateSmsProvider implements SmsProvider`. `send()` POSTs JSON to `https://portal.bulkgate.com/api/1.0/simple/transactional` with `Content-Type: application/json` and body `{ application_id, application_token, number: phoneE164, text: body, unicode: !isGsm7(body), sender_id: 'gText', sender_id_value: this.config.senderIdValue, country: 'lv' }`, under `AbortSignal.timeout(SMS_HTTP_TIMEOUT_MS)`. Add a module-local `isGsm7(text: string): boolean`. **Use this exact table** — do not retype it from memory, and do not substitute a regex range:

  ```ts
  // GSM 03.38 basic set + the extension table. LV diacritics (ā č ē ģ ī ķ ļ ņ š ū ž)
  // and all Cyrillic are deliberately absent — that absence is what selects UCS-2.
  const GSM7 = new Set(
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
      '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà' +
      '\f^{}\\[~]|€',
  );
  const isGsm7 = (text: string): boolean => [...text].every((c) => GSM7.has(c));
  ```

  Spot-check while implementing: `isGsm7('Sakta Cab kods: 482913')` is `true`; `isGsm7('Jūsu šoferis')` is `false` (`ū`, `š`); `isGsm7('Водитель')` is `false`. Non-2xx → best-effort JSON parse → `throw new Error(\`bulkgate_error_${type ?? res.status}\`)`. 2xx → parse `{ data: { sms_id, part_id } }` → log `auth.sms.bulkgate_sent` with `phone: maskPhone(...)`, `segments`, `smsId: data.sms_id`, `at`. **Plus `partId`, the RAW array (added 2026-09-21, AMENDMENTS 3):** the count is `expected`, and scorecard row 11 asks for the array itself, which nothing else in the run surfaces. Opaque vendor ids — no phone, no body. `sendOtp()` delegates to `send()` with `formatMessage('lv', 'sms.otp_code', { code })`.
- **PATTERN**: `twilio-sms.provider.ts` line-for-line. Reuse the same `SMS_HTTP_TIMEOUT_MS = 10_000` module const **and its comment's reasoning** (`:6-9`) — `sendOtp` blocks a login request.
- **IMPORTS**: `import { Logger } from '@nestjs/common'; import { formatMessage, type SmsProvider } from '@taxi/shared'; import { maskPhone } from '../phone-mask';`
- **GOTCHA — `unicode` must be DETECTED, not hardcoded, and this is the bake-off's validity at stake.** BulkGate is the only one of the three that needs the flag: Twilio auto-detects, and BudgetSMS assumes UTF-8 with no flag at all. Hardcoding `unicode: true` looks harmless — `sms.otp_code` renders 22 chars (`lv.ts:19`, `'Sakta Cab kods: {code}'` with a 6-digit code) and 22 ≤ 70, so it is 1 segment under UCS-2 exactly as under GSM-7's 160, no price change. **But segment count is not the variable that matters here; encoding is.** `sms.otp_code` is deliberately ASCII, so Twilio sends it GSM-7 while a hardcoded flag sends it UCS-2 — two different encodings can take different aggregator routes, and the OTP row of the scorecard would then be comparing a route difference with an encoding difference mixed in. Detect instead: `unicode: !isGsm7(body)` makes all three providers send the OTP as GSM-7 and every LV/RU template as UCS-2, which is both the production-correct behaviour and the only way the OTP row means anything.
- **GOTCHA — do not put `isGsm7` in `@taxi/shared`.** It is BulkGate's flag, not a cross-surface contract; the seam stays as it is. Module-local in this file, exported only if its spec needs it.
- **AS SHIPPED (2026-09-21, AMENDMENTS 3)**: it IS exported — not for the spec, which does not need it, but for `sms-bakeoff.ts`, whose `encoding` column and segment estimator must answer the same question this flag answers. The first draft duplicated the GSM 03.38 table into the script; two tables that have to agree are one table that will not. Still nothing in `@taxi/shared`, and the seam is unchanged.
- **GOTCHA — do not trust `part_id.length` as the segment count.** The documented success example returns **three** entries for what its own field names read as a 2-part message: `["tmpde1bcd4b1d1_1", "tmpde1bcd4b1d1_2", "tmpde1bcd4b1d1"]` — two suffixed ids plus the bare one. Count only entries matching `/_\d+$/`, and fall back to `1` when that count is zero (a single-part send may return just the bare id). The €/week ledger row reads this number. **Mark it `expected`, not `observed`** — the plan is reading a docs example, not a live response — and make "record the real `part_id` array for a known 2-segment message" a scorecard cell so the bake-off settles it.
- **GOTCHA — the leak.** `auth.service.ts:199` logs `err.message` verbatim, and BulkGate's error envelope carries `"error": "Invalid phone number"` alongside a `detail` field of unspecified shape. Throw only `bulkgate_error_<type>`; never interpolate `error`, `detail`, the body, or the phone.
- **VALIDATE**: `pnpm --filter @taxi/api test -- bulkgate`
- **SATISFIES**: AC #1, AC #4

### CREATE `services/api/src/features/auth/sms/bulkgate-sms.provider.spec.ts`

- **IMPLEMENT**: copy `fakeFetch` from `twilio-sms.provider.spec.ts:11-19`. Cases:
  - *(expected)* POSTs the transactional URL with `Content-Type: application/json`; the parsed body carries `application_id`, `application_token`, `number: '+37120000001'`, the text, `unicode: true`, `sender_id: 'gText'`, `sender_id_value`, `country: 'lv'`; resolves on 200.
  - *(expected)* logs `auth.sms.bulkgate_sent` with `segments: 2` from a `part_id` of `['x_1','x_2','x']`, the masked phone, `smsId`, **and not the body**.
  - *(edge)* a single-part success — `part_id: ['x']`, zero suffixed entries — logs `segments: 1`, not `0`.
  - *(edge)* an ASCII body (`formatMessage('lv', 'sms.otp_code', { code: '482913' })`) sends `unicode: false`; the LV `sms.driver_assigned` render sends `unicode: true`. This is the pin on the encoding confound — a hardcoded `true` passes every other case in this file.
  - *(edge)* `init.signal` is an `AbortSignal` (the timeout is wired).
  - *(failure)* **the leak pin.** A 400 body `{"type":"invalid_phone_number","code":400,"error":"Invalid phone number +37120000001","detail":null}` throws exactly `bulkgate_error_invalid_phone_number`, and assert `not.toContain('+37120000001')` **and** `not.toContain('secret body')` on `err.message`.
  - *(failure)* a non-JSON error body (`'<html>502</html>'`, status 502) falls back to `bulkgate_error_502`.
- **PATTERN**: `twilio-sms.provider.spec.ts:105-138` for the two failure cases, including the `.then(onOk → throw, e => e)` idiom that captures the rejection without swallowing a false pass.
- **GOTCHA**: `init.body` here is a **JSON string**, not a `URLSearchParams` — `JSON.parse(init.body as string)` before asserting fields. Copying Twilio's `form.get('To')` assertions verbatim will not compile.
- **VALIDATE**: `pnpm --filter @taxi/api test -- bulkgate`
- **SATISFIES**: AC #4

### CREATE `services/api/src/features/auth/sms/budgetsms.provider.ts`

- **IMPLEMENT**: `BudgetSmsConfig { username, userid, handle, from, baseUrl?: string }` and `BudgetSmsProvider implements SmsProvider`. `baseUrl` defaults to `'https://api.budgetsms.net/sendsms/'`; it exists **only** so the bake-off script can point one instance at `/testsms/` without the production class learning a test flag, and the factory never sets it. `send()` issues a **GET** to `this.config.baseUrl` with a `URLSearchParams` query of `username, userid, handle, msg: body, from, to: phoneE164.replace(/^\+/, ''), price: '1'`, under `AbortSignal.timeout(SMS_HTTP_TIMEOUT_MS)`. Read `await res.text()`; if it starts with `OK ` → split on whitespace → `[_, smsId, price, parts]` → log `auth.sms.budgetsms_sent` with `phone: maskPhone(...)`, `segments: Number(parts) || 1`, `smsId`, `at`. Otherwise → `throw new Error(\`budgetsms_error_${code}\`)` where `code` is the token after `ERR `, falling back to the HTTP status when the body matches neither prefix.
- **PATTERN**: `twilio-sms.provider.ts` for the class shape and the `errorCode()` best-effort helper idiom (`:83-91`) — here the helper parses a text line instead of JSON.
- **IMPORTS**: same three as BulkGate.
- **GOTCHA — `res.ok` is not the error check.** BudgetSMS returns `ERR nnnn` **in the body**, and the spec documents no non-200 status for it. An implementation that branches on `res.ok` will log a failed send as a success and charge the ledger a segment that was never sent. Branch on the `OK `/`ERR ` prefix; treat a non-2xx status as a separate fallback, not as the primary path. **This is the single most likely bug in this ticket.**
- **GOTCHA — strip the `+`.** The seam's contract is E.164 (`sms-provider.ts:6`, `phoneE164`); BudgetSMS §2 documents `to` as "No spaces, do not use the + before the international countrycode … Example: 31612345678". Passing `+371…` earns `2010`/`2011`.
- **GOTCHA — `price=1` is what produces the segment count.** Without it the success line is a bare `OK 12345678` and there is no parts field. With it: `OK 1234567 0.055 1`, parts last. Do **not** also pass `mccmnc=1` — it appends a fifth token and moves nothing, but it widens the parse for no benefit.
- **GOTCHA — the credential and the OTP both travel in the URL.** `handle` is the API secret and `msg` carries the OTP code, and this endpoint is GET-only, so both sit in the query string. Node's `fetch` does not log URLs and this provider must not either — but **record it as a scorecard row**, because it is a real difference from the other two and a reason to prefer them at equal reliability.
- **GOTCHA — the leak.** Same as BulkGate: throw `budgetsms_error_<code>` only. The raw response text is short and numeric, but it is still vendor text; do not interpolate it.
- **VALIDATE**: `pnpm --filter @taxi/api test -- budgetsms`
- **SATISFIES**: AC #1, AC #4

### CREATE `services/api/src/features/auth/sms/budgetsms.provider.spec.ts`

- **IMPLEMENT**: cases —
  - *(expected)* GETs `https://api.budgetsms.net/sendsms/` with a query carrying every mandatory param, `to` as `37120000001` (**no `+`**), and `price=1`; resolves on `OK 1234567 0.055 1`.
  - *(expected)* logs `auth.sms.budgetsms_sent` with `segments: 1` parsed from that line, the masked phone, and **not** the body.
  - *(edge)* `segments: 2` from `OK 1234567 0.110 2`.
  - *(failure)* **the `ERR`-on-200 pin.** A **200** response whose body is `ERR 3001` must **reject** with `budgetsms_error_3001`. Comment it as the pin it is: a `res.ok` implementation passes every other case in this file and fails only this one.
  - *(failure)* **the leak pin.** Assert the thrown message contains neither `+37120000001`/`37120000001` nor the SMS body, for both the `ERR` path and a 500 with an HTML body (`budgetsms_error_500`).
  - *(edge, beyond this list — added 2026-09-21)* a `baseUrl` override reaches `/testsms/` with the `handle` still in the query, so `--testsms` exercising the real request-building code is asserted rather than assumed.
- **PATTERN**: `twilio-sms.provider.spec.ts`'s `fakeFetch` and the `.then(onOk → throw, e => e)` capture.
- **GOTCHA**: assert the query by `new URL(calls[0].url).searchParams`, not by string matching — parameter order is an implementation detail and a string assertion pins it by accident.
- **VALIDATE**: `pnpm --filter @taxi/api test -- budgetsms`
- **SATISFIES**: AC #4

### UPDATE `services/api/src/features/auth/auth.module.ts`

- **IMPLEMENT**: inside `smsProviderFactory`, switch on `env.SMS_PROVIDER` before the existing logic. `'bulkgate'` → `new BulkGateSmsProvider({...})`; `'budgetsms'` → `new BudgetSmsProvider({...})`; `'twilio'` → the existing Twilio construction; `'auto'` → fall through to today's code path verbatim (trio → Twilio, else the production refusal, else the stub). Extend the doc comment (`:13-22`) to say that the selector exists because a bake-off funds several accounts at once, and that **the production refusal is unchanged**.
- **PATTERN**: the existing `:23-41`. Keep the refusal's exact message and its position — `auth.module.spec.ts:40` matches `/No production SmsProvider is bound/`.
- **GOTCHA**: `env.SMS_PROVIDER` values other than `'auto'` are only reachable once the superRefine has confirmed their credential group, so the non-null assertions on those env fields are load-bearing on that refine. State that in a comment — the same reasoning `auth.module.spec.ts:26-28` records for the trio ("the values are only present when they passed the schema's refines").
- **GOTCHA**: do **not** touch `notifications.module.ts`. It already imports this factory (`:3,42`) and inherits the branch for free. Its comment (`:14-18`) is the reason: forking the factory forks the boot-refusal guarantee.
- **VALIDATE**: `pnpm --filter @taxi/api test -- auth.module`
- **SATISFIES**: AC #3

### UPDATE `services/api/src/features/auth/auth.module.spec.ts`

- **IMPLEMENT**: add `SMS_PROVIDER: 'auto'` to the `env()` helper's base object so the existing four cases keep describing a realistic `Env`. Add: *(expected)* `'bulkgate'` with its group binds `BulkGateSmsProvider`; *(expected)* `'budgetsms'` with its group binds `BudgetSmsProvider`; *(edge)* `'bulkgate'` **wins over a present `TWILIO_*` trio** — the bake-off's whole point; *(failure)* `'auto'` in production with no trio still throws `/No production SmsProvider is bound/`.
- **PATTERN**: the file's existing four cases, including `:45-60`'s `Reflect.getMetadata` check, which needs no change.
- **GOTCHA**: the `env()` helper casts with `as Env`, so adding a field there is not type-checked against the schema. After editing, confirm `SMS_PROVIDER` is spelled the same as the schema key — a typo here produces four green tests against a field the factory never reads.
- **VALIDATE**: `pnpm --filter @taxi/api test -- auth.module`
- **SATISFIES**: AC #3

### UPDATE `.env.example`

- **IMPLEMENT**: after the Twilio block (`:91-97`), add a `SMS_PROVIDER=` line documenting the four values with `auto` as the default and today's behaviour, then two commented credential blocks — BulkGate (three keys, sender is `gText`-style alphanumeric ≤11) and BudgetSMS (four keys, `userid` numeric, `handle` **is a secret**, `from` alphanumeric ≤11 with **no spaces**). Note on the BudgetSMS block that it is the bake-off's `testsms` pre-flight target too.
- **PATTERN**: the Twilio block's tone at `:91-94` — what the value is, where it comes from, what happens when it is empty.
- **GOTCHA**: keys present with **empty** values, exactly like `TWILIO_*` at `:95-97`, so a fresh checkout boots into `auto` → stub with no schema complaint.
- **GOTCHA**: writing this edit through Bash will trip the PreToolUse hook, which matches command text rather than intent. Apply it with the Write/Edit tools by path.
- **VALIDATE**: `pnpm --filter @taxi/api test -- env.schema`
- **SATISFIES**: AC #3

### CREATE `services/api/scripts/sms-bakeoff.ts`

- **IMPLEMENT**: `sms:bakeoff` — sends the bake-off matrix and prints scorecard rows. Behaviour:
  1. **Argv and recipients FIRST** (`BAKEOFF_LMT`, `BAKEOFF_TELE2`, `BAKEOFF_BITE`, E.164). Refuse with a usage message if any is missing. **Order corrected 2026-09-21 (AMENDMENTS 4) — this task first listed the env parse as step 1**, and in that order a bare invocation throws a `ZodError` about `DATABASE_URL` instead of the usage message Level 4 step 1 asserts: nothing dotenv-loads for a plain script.
  2. Then parse `Env` through the real `envSchema`, so credentials are validated by the same rules production uses. Catch the `ZodError` and print the issues plus "run from a shell that sourced the root env file", rather than a raw stack.
  3. Build whichever of the three providers have credentials; skip and report the rest by name.
  4. **Dry-run by default.** Print the full matrix it *would* send — provider × operator × template — plus the derived spend, and exit 0. Only `--confirm` sends. BudgetSMS additionally supports `--testsms`. **It is a script concern, not a provider flag**: the script constructs `BudgetSmsProvider` with `baseUrl: 'https://api.budgetsms.net/testsms/'` (no credit, no SMS) instead of reaching into the provider. Nothing else in the matrix changes, so the pre-flight exercises the real request-building and response-parsing code — which is the point of having it. BulkGate and Twilio have no equivalent; `--testsms` silently covers BudgetSMS only, and the script must say so in its output rather than implying it pre-flighted all three.
  5. `--round N` labels the round in the output so three passes across the day stay distinguishable.
  6. Per send: record `sentAt` (ISO, to the second), call the provider, catch, and record either the success or the thrown `Error.message` — which is the **seam result-type evidence** criterion 5 asks for, observed through the real contract rather than described.
     **Where the success numbers come from (2026-09-21, AMENDMENTS 3).** The seam is `Promise<void>` and stays that way (Q1), so the vendor's message id and its OWN segment count reach the caller only through the provider's log line. Tee `Logger.prototype.log` before the loop and read the payload each send produced — the `mint-tracked-ride.ts` shape, where in-process capture yields objects rather than text to regex. `api result` becomes `ok <vendor id>` (matching the illustrative row below) and `api segments` carries what the API reported. **Filling that column from the script's own estimator instead would duplicate the dry run's guess and leave scorecard row 11 unfillable** — the one row designated to settle BulkGate's `expected` `part_id` rule. A `~` prefix marks the fallback where no log line was captured.
  7. Print a markdown table the operator pastes into the scorecard. **This exact shape** — the run sheet cites it, so an invented one makes the two documents drift:

     ```
     | round | provider | operator | template | sent at (UTC) | api result | api segments | received at | sender shown | body intact |
     |---|---|---|---|---|---|---|---|---|---|
     | 1 | bulkgate | LMT | otp_code | 09:14:02 | ok tmpde1bcd4b1d1 | 1 | | | |
     | 1 | bulkgate | LMT | driver_assigned | 09:14:04 | ok tmpde1bcd4b1e2 | 2 | | | |
     | 1 | bulkgate | Tele2 | otp_code | 09:14:06 | ERR bulkgate_error_low_credit | — | | | |
     ```

     **Row ORDER is provider → probe → operator, not the provider → operator → template this example happens to show** (settled 2026-09-21, AMENDMENTS 5). The column shape above is what the run sheet cites and is unchanged; the illustration's row order contradicts this plan's own twice-stated rule (NOTES "Order of the run", Appendix A "Probe order inside every round: OTP first"), under which a mid-round credit exhaustion must not be able to cost Tele2's and Bite's OTP.

     The three trailing columns are **deliberately empty** — they are the handset's half and only a person holding the phone can fill them. `api result` on failure is the thrown `Error.message` **verbatim**, which is the seam-result-type evidence criterion 5 asks for.
- **PATTERN**: `mint-tracked-ride.ts:1-45` for the docblock and the RUN CEILING section; `provision-dispatcher.ts:26-31` for argv handling and the usage message.
- **IMPORTS**: the two new providers, `TwilioSmsProvider`, `envSchema` from `../src/common/config/env.schema`, `formatMessage` from `@taxi/shared`, `Logger` from `@nestjs/common` (for the capture above).
- **AS SHIPPED (2026-09-21, AMENDMENTS 6) — the three providers are DEEP-imported, and `features/auth/index.ts` is NOT touched.** This task did not settle it. Exporting the concrete classes from the slice's public API would let any *module* construct a provider and skip the production boot-refusal — the guarantee `notifications.module.ts:14-18` protects by importing the factory instead. `mint-tracked-ride.ts` already deep-imports `otp.policy`, `caching-maps.provider`, `dispatch.policy` and `notifications.policy`, so a script reaching past `index.ts` is the established shape.
- **GOTCHA — this script spends real money on a real network.** That is why the default is a dry run and `--confirm` is required. Do not add a "just send it" convenience flag.
- **GOTCHA — the OTP body must be byte-identical across the three providers**, or a delivery difference is not attributable to the route. It is, and for a structural reason: all three `sendOtp()` implementations delegate to their own `send()` with the same `formatMessage('lv', 'sms.otp_code', { code })` call. Say so in the docblock so a reviewer does not have to re-derive it — and note the one place it was nearly not true: BulkGate's `unicode` flag, resolved by detection rather than a hardcoded `true` (see that provider's GOTCHA).
- **GOTCHA — three probes, not one, and they are not interchangeable.** Each isolates a different failure:
  1. `sms.otp_code` — GSM-7, 1 segment, **every round**. The login path, where a drop is an outage.
  2. LV `sms.driver_assigned` with a worst-case driver name — UCS-2, 2 segments (§4.2), **every round**. Where diacritics and concatenation break.
  3. RU `sms.driver_assigned` — UCS-2, 2 segments, **round 1 only**. Cyrillic is always UCS-2 (§4.2) and can route differently from Latin-with-diacritics; but it is an encoding question, not a time-of-day one, so one round answers it.

  The OTP is the only ASCII-safe message in the catalog, so it proves nothing about the other two, and they prove nothing about it.
- **GOTCHA — do not import anything from `dist/`.** `@taxi/shared` resolves through the built package, so run `pnpm --filter @taxi/shared build` before the script if `lv.ts` was touched in the same session.
- **GOTCHA — the spend figure in the docblock is `derived`, and its rates expire.** State the arithmetic and the date of the rates it uses, and say in the same breath that #137 instructs re-observing them at bake-off time. Do not print it as `observed`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #2

### UPDATE `services/api/package.json`

- **IMPLEMENT**: `"sms:bakeoff": "node -r ts-node/register -r tsconfig-paths/register scripts/sms-bakeoff.ts"` — byte-for-byte the runner the other two entries use (`services/api/package.json:16-17`). **Not `tsx`**: it is not a dependency of this package.
- **PATTERN**: the existing `mint:ride` / `provision:dispatcher` entries.
- **GOTCHA**: `lint` is already `eslint "{src,test,scripts}/**/*.ts"`, so the new script is linted with no config change, and `packages/config/eslint/base.mjs:39-57` lists `**/scripts/**` so `max-lines` is off for it (verified 2026-09-20) — a long docblock is safe.
- **VALIDATE**: `pnpm --filter @taxi/api sms:bakeoff` (no args → usage, exit non-zero)
- **SATISFIES**: AC #2

### CREATE `docs/research/sms-bakeoff-scorecard.md`

- **IMPLEMENT**: **copy Appendix A of this plan verbatim** into the file, then fill only the run-date header line. Nothing else. It is written out there precisely so it is not re-composed — the decisive/informational split, the `vendor docs` labels, the "not a rate" warning, the step order and the two legal verdict forms are the document's whole value and are what a paraphrase loses.
- **PATTERN**: `docs/runbooks/driver-device-day.md` — Result first, then Setup, then a Steps table with a Signal column, then a `## Verdict` with an explicit rule. Appendix A already has this shape.
- **GOTCHA — one file, in `docs/research/`, not split.** #137's AC names `docs/research/` for the scorecard, and a run sheet kept apart from the grid it fills is how a scorecard ends up recording numbers nobody can reproduce.
- **GOTCHA — Appendix A is the single source for the prerequisites, the step order and the verdict forms.** They are deliberately **not** restated in this task, in Level 4, or in Open Questions: a list that lives in two places goes stale on the first edit and the correction re-stales it (this repo has run that loop — `#212`). Level 4 keeps only the **spend arithmetic**, and Appendix A cites Level 4 for it rather than repeating the derivation. If you find yourself copying a prerequisite into a task bullet, don't — link the appendix section.
- **Decisions Appendix A encodes, recorded here because they are the plan's calls, not the runner's** (the wording itself is in the appendix, do not duplicate it):
  - *Twilio's alphanumeric sender is unscorable on a trial* (`env.schema.ts:269-272`, research §4.4) and **this does not block a switch** — the switch question is whether the *candidate* preserves `SaktaCab`, which the candidate's own cells answer. It blocks only the opposite conclusion: on a trial, "keep Twilio" is not a validated outcome, because a trial cannot reach unverified riders at all. Hence the appendix's two legal verdict forms.
  - *Delivery receipts are a vendor-capability row, not a result row.* Nothing here consumes a DLR (#85 excluded them). Provenance `vendor docs`, never `observed` — #137's "not vendor claims" is about delivery results, and blurring the two is what it forbids.
  - *Three sends is not a delivery rate.* `3/3`, never "100%": three observations catch a broken route, not a flaky one. Calling it a rate would be the #107 failure — correct arithmetic describing a case it does not describe.
  - *Two clocks.* Time-to-inbox is script `sent at` → the handset's own timestamp, both on network time; **sub-5 s differences are noise**, so no finer figure may be reported.
- **VALIDATE**: `diff <(sed -n '/^````markdown$/,/^````$/p' .claude/plans/sms-provider-bakeoff-137.md | sed '1d;$d') docs/research/sms-bakeoff-scorecard.md` is **EMPTY** (corrected 2026-09-21, AMENDMENTS 7 — this line first said "differs only in the run-date header line"). Appendix A already ships `**Run date:** —` placeholders and no run has happened; filling a date would be a figure under a heading no run produced. The IMPLEMENT line's "then fill only the run-date header" is void for the same reason — the run fills it.
- **SATISFIES**: AC #1, AC #5

### UPDATE `docs/research/hosting-sms-cost-research.md` §4.4

- **IMPLEMENT**: one line at the end of §4.4's Recommendation pointing at `sms-bakeoff-scorecard.md` as where the bake-off is run and recorded.
- **GOTCHA**: change nothing else in that file. Its rates and segment counts are `observed 2026-08-14` and carry their provenance; editing around them risks re-dating a figure no run re-produced.
- **VALIDATE**: `git diff --stat docs/research/hosting-sms-cost-research.md` shows 1–2 lines changed
- **SATISFIES**: AC #5

---

## TESTING STRATEGY

### Unit Tests

Jest, in `services/api`, colocated with the slice. Each new provider ships expected + edge + failure
per the repo rule, with the **leak pin** counted as a required failure case rather than an optional
one — it is the case that connects the provider to `auth.service.ts:199`.

Both providers are tested with an injected `fetchFn` and never touch the network, the same footing as
`twilio-sms.provider.spec.ts`. No `REDIS_TEST_URL`, no database: these specs run in the ungated set.

### Integration Tests

**None, and that is deliberate.** This ticket touches no socket, no room join and nothing under
`features/realtime`, so the delivery-order rule does not apply. The existing
`auth.integration.spec.ts` continues to run against the harness's `RecordingSmsProvider` via
`overrideProvider(SMS_PROVIDER)`, which is unaffected by a factory that is never called in that path.

The real integration test of this ticket is the bake-off itself, and it runs on handsets.

### Edge Cases

Every case names where it is verified.

| Edge case | Verified in |
|---|---|
| BudgetSMS returns `ERR 3001` on **HTTP 200** | `budgetsms.provider.spec.ts` — the `ERR`-on-200 pin |
| `to` reaches BudgetSMS without the leading `+` | `budgetsms.provider.spec.ts` — searchParams assertion |
| BulkGate single-part success (`part_id: ['x']`) logs `segments: 1`, not `0` | `bulkgate-sms.provider.spec.ts` |
| BulkGate 2-part `part_id` counts 2, not 3 | `bulkgate-sms.provider.spec.ts` |
| A vendor 4xx whose text echoes the destination number never reaches `err.message` | both provider specs — the leak pins |
| Non-JSON / HTML error body falls back to the HTTP status | both provider specs |
| Explicit `SMS_PROVIDER` beats a present `TWILIO_*` trio | `auth.module.spec.ts` |
| `SMS_PROVIDER='auto'` in production with no trio still refuses to boot | `auth.module.spec.ts` |
| `SMS_PROVIDER` naming a kind whose credentials are absent fails schema validation | env schema spec |
| Partial `BUDGETSMS_*` group (3 of 4) fails in every environment | env schema spec |
| Sender ID with a space passes the Twilio refine but fails the BudgetSMS one | env schema spec |
| **LV diacritics survive UCS-2 on each route** | **run sheet step — handset, `body intact` column.** No test framework reaches this; it is the bake-off's job |
| **Cyrillic survives UCS-2 on each route** | **run sheet step — handset, probe 3, round 1** |
| **Alphanumeric sender survives each LV operator's route** | **run sheet step — handset, `sender shown` column** |
| **BulkGate's real `part_id` for a known 2-segment message** | **run sheet step — script stdout; settles the `expected` count above** |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/api lint
pnpm --filter @taxi/api typecheck
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/api test -- bulkgate
pnpm --filter @taxi/api test -- budgetsms
pnpm --filter @taxi/api test -- auth.module
pnpm --filter @taxi/api test -- env.schema
```

The `-- <name>` filter genuinely narrows here — `observed` 2026-09-21, `pnpm --filter @taxi/api test -- twilio` printed `Ran all test suites matching twilio`, `Test Suites: 1 passed, 1 total`, `Tests: 6 passed`, 0.503 s. (It is jest, `testRegex` over `rootDir: src`. Do **not** carry this over to `@taxi/dispatch`, where the same flag shape silently runs all 28 vitest files.)

**But a narrow run is not an isolated run.** `services/api/package.json`'s jest block sets `globalSetup: <rootDir>/../test/global-setup.ts`, which drops the shared `taxi_api_test` database — a hardcoded name no worktree can isolate. So even a one-file run is mutually destructive with a concurrent session's suite. Check `git reflog -8` and `ps` first; one run at a time.

### Level 3: Integration Tests

```bash
COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test
```

Expect `39 skipped` without `REDIS_TEST_URL` (`observed` at #215's base `0cdb59c`, per root
CLAUDE.md), plus the new specs added to the passing count. One gate at a time — integration runs are
mutually destructive across sessions.

### Level 4: Manual Validation

**Almost none of #137's Level 4 is performable on this machine, and pretending otherwise is the
failure mode this section exists to avoid.** What *is* performable here:

1. **Dry run, no credentials.** `pnpm --filter @taxi/api sms:bakeoff` → usage message naming the three
   `BAKEOFF_*` recipients, exit non-zero. *Performable now.*
2. **Dry run, fake credentials.** Set all three groups to syntactically valid dummies in a scratch env
   → the script prints the full matrix and its derived spend and sends nothing. *Performable now —
   this is what proves the dry-run default actually defaults.*
3. **Boot refusal unchanged.** `NODE_ENV=production` with no SMS credentials and `SMS_PROVIDER` unset
   → the factory throws `No production SmsProvider is bound`. *Performable now, via the spec; the
   real boot needs the production-image probe recipe, which is out of scope here.*
4. **Schema refusal.** `SMS_PROVIDER=bulkgate` with an empty BulkGate group → boot fails naming the
   three missing keys. *Performable now.*

**Everything else is the bake-off, and it is owed to #137's own handset day** — not to a new ghost
issue. **The prerequisite list lives in Appendix A § Prerequisites and only there** — three LV SIMs, two
funded accounts, accounts the deploy is not using, a Twilio tier decision, the `BAKEOFF_*`
recipients. It is not repeated here, because a checklist in two files is a checklist that disagrees
with itself by the second edit. What *does* live here is the one thing the appendix cites back to:

- ~**€5** of credit spread across the three accounts. `derived` from §4.1's `observed 2026-08-14`
  rates over the matrix this plan prescribes. Per provider, across 3 operators:
  - OTP, 1 segment, 3 rounds → 3 × 3 × 1 = **9**
  - LV `driver_assigned`, 2 segments, 3 rounds → 3 × 3 × 2 = **18**
  - RU `driver_assigned`, 2 segments, 1 round → 3 × 1 × 2 = **6**
  - **33 segments per provider.**

  BulkGate 33 × €0.0311 = €1.03; BudgetSMS 33 × €0.045 = €1.49; Twilio 33 × $0.0715 = $2.36, which
  is €1.82–€2.36 across an EUR/USD range of 1.0–1.3 (the range §4.1 uses to avoid pinning an FX
  rate). **Total €4.33–€4.87.** Conditions it assumes: three rounds, the three probes above, an
  invalid-`to` failure probe per provider (free on BudgetSMS by its spec; `expected` free on the other two, not sourced — budget three segments), and
  §4.1's rates — which #137 says to re-observe at bake-off time. **Do not fund an even third each:**
  the per-provider costs differ (€1.03 / €1.49 / €2.36 worst case), so an even split under-funds
  Twilio by a third of its run. Fund ~€2 per account, which also leaves room for a retried round.

### Level 5: Additional Validation

None. No MCP server reaches a mobile network.

---

## ACCEPTANCE CRITERIA

**#137's own ACs, restated with what this loop can and cannot discharge.**

- [ ] **AC #1 — Scorecard exists in `docs/research/` with the grid, the criteria and the prerequisites.** The `observed` cells stay empty. *This loop.*
- [ ] **AC #2 — The instrument that fills it exists and is runnable by one person with three phones.** `sms:bakeoff`, dry-run by default, `--testsms` pre-flight, scorecard rows on stdout. *This loop.*
- [ ] **AC #3 — Switching is a config change.** Both providers bind through `smsProviderFactory` from `SMS_PROVIDER`; the production refusal on the stub is unchanged and re-pinned. *This loop.*
- [ ] **AC #4 — Both new providers ship expected + edge + failure specs**, the leak pin among them. *This loop.*
- [ ] **AC #5 — `hosting-sms-cost-research.md` §4.4 points at the scorecard.** *This loop.*
- [ ] **AC #6 — `observed` delivery results from real LMT / Tele2 / Bite handsets.** **Owed by #137's handset day — not gate-verifiable on this machine** (no LV SIMs, no funded vendor accounts, confirmed absent 2026-09-20). Do not mark this from a vendor claim, a dry run, or a `testsms` call.
- [ ] **AC #7 — Either the switch ships, or the reason not to is recorded.** **Owed by #137, after AC #6.** Conditional on results this loop cannot produce.
- [ ] All validation commands pass with zero errors — `pnpm turbo run typecheck lint test build --force` green.
- [ ] No regressions: `auth.module.spec.ts`'s four original cases, `auth.integration.spec.ts`, and the Twilio provider spec all pass untouched.
- [ ] `max-lines` clean: both providers under 500 lines of shipped source. The script is exempt by **two separate mechanisms, neither of which implies the other** — `packages/config/eslint/base.mjs:39-57` turns `max-lines` off for `**/scripts/**`, and `services/api/tsconfig.build.json`'s `scripts` exclusion keeps it out of `dist/`.

**#137 stays OPEN after this loop.** The PR body must not contain a closing keyword near `#137` —
backticks do not reliably prevent closure and prose near the number has closed an issue before
(`#132`). Write "Part of #137" and check `closingIssuesReferences` on the open PR.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] `pnpm turbo run typecheck lint test build --force` green from a cleared `dist/`
- [ ] The two leak pins fail when the fix is reverted (probe them — a review payoff is a claim)
- [ ] The `ERR`-on-200 pin fails against a `res.ok` implementation (same probe)
- [ ] Dry-run default verified by actually running it with dummy credentials
- [ ] Scorecard prerequisites list is complete enough that a day booked against it produces a full grid
- [ ] Every figure in the plan, the script docblock, the scorecard and the PR body re-derived, not inherited
- [ ] PR body does not close #137

---

## OPEN QUESTIONS / ASSUMPTIONS

**Q1 — Should the `SmsProvider` seam gain a result type?** #137 lists "what a failed send looks like
on the seam's result type" as a criterion, but the seam has no result type: both methods are
`Promise<void>` and throw (`sms-provider.ts:5-9`). **Assumption taken: no seam change.** The plain
reading is *observe the error shape through the existing contract*, and the ticket's own wording calls
a new provider "a second implementation of `SmsProvider`". Changing it would touch `@taxi/shared`,
both leak pins, `auth.service.ts:189-202`'s 502-and-release-cooldown path, and
`ride-notifications.service.ts:77,139`'s must-swallow catches — a contract change wearing a criterion's
clothes. If the bake-off shows the three providers' failures are genuinely indistinguishable through a
thrown `Error`, that is a finding for the follow-up loop, not a reason to widen the seam here.

**Q2 — `'auto'` as the default `SMS_PROVIDER`, or make the kind mandatory?** **Assumption taken:
`'auto'`**, defined as exactly today's behaviour, so this change is additive and no existing `.env`
or deployed config moves. The alternative — defaulting to `'twilio'` and requiring an explicit
`'stub'` in dev — is cleaner as a final state but breaks every checkout at once for a ticket whose
job is to *measure*, not to migrate. If the bake-off ends in a switch, the follow-up loop is the
right place to retire `'auto'`.

**Q3 — Which provider's failure wins if two are funded and one is down mid-run?** Not a question the
code answers: `SMS_PROVIDER` binds exactly one, and the script constructs all three directly rather
than through the factory. Stated so nobody reads the selector as a fallback chain. **There is no
failover, by design** — a silent fallback to a second vendor would make the scorecard unreadable.

**Q4 (ordering, answered worst-case) — what happens if the bake-off runs while the API is live on
the same credentials?** Worst case, not typical: the script sends from the same BulkGate/BudgetSMS
account a live deploy would use, so a `low_credit` / `1001` mid-run leaves **real riders' OTPs
failing**, not just the bake-off. `auth.service.ts:194` releases the resend cooldown on failure, so
riders retry into the same empty balance. **The run sheet must state that the bake-off runs against
accounts the production deploy is not using, or while the deploy is on Twilio** — and the
prerequisites list must carry it as a line item, not a footnote. **Carried, once:** it is a line item in Appendix A § Prerequisites,
which is the single source. An answer that changes what a deliverable must contain belongs in that
deliverable — not restated here, and not restated in the task.

**Q5 — is `sms.driver_assigned` still 2 segments at run time?** It is today (§4.2, `observed`
2026-08-14), but #136 exists to make it 1. If #136 lands first, the bake-off's UCS-2 worst case
becomes a 1-segment message and the concatenation path goes untested. **Assumption: #136 has not
landed** (it is `blocked:accounts` on the `sakta.lv` domain as of 2026-09-20). If it has, the script
must send a deliberately-padded 2-segment UCS-2 body instead of the live template, and say so.

---

## NOTES (open canvas)

### Why two real providers rather than one throwaway script

The cheaper-looking option is a standalone script that `curl`s three vendor APIs and never touches
`services/api/src`. It was rejected on one criterion: #137 asks what a failed send **looks like on
the seam's result type**. A script scores whatever error shape the script invents. Only the code that
would actually ship scores the thing being asked about — and the leak pin, which is the property that
matters most on the OTP path, exists only inside a real provider.

The cost of being wrong is bounded and small: if the bake-off keeps Twilio, two files of ~95 lines
each (`expected`) become dead code, and deleting them is a one-commit follow-up. If it switches, the
follow-up is one env var. The asymmetry favours building them.

### What the three-round matrix can and cannot say

| Question | Can the run answer it? |
|---|---|
| Does a route to LMT / Tele2 / Bite exist at all for this provider? | **Yes** — a 0/3 is decisive |
| Does `SaktaCab` survive as the sender on each operator? | **Yes** — visible on the handset |
| Do LV diacritics arrive intact? | **Yes** — probe 2, visible on the handset |
| Does Cyrillic arrive intact? | **Yes** — probe 3, round 1 only |
| Is time-to-inbox in seconds or in minutes? | **Yes**, to ±5 s (two clocks) |
| What does a failed send look like through the seam? | **Yes**, by inducing one: an invalid `to` per provider |
| Is the OTP row comparing routes rather than encodings? | **Yes, once `isGsm7` detection lands** — all three then send the ASCII OTP as GSM-7 and the LV template as UCS-2. A hardcoded BulkGate `unicode: true` would have made this row uninterpretable |
| Is the delivery rate 99% or 90%? | **No.** Three observations cannot separate those. Say so |
| Does the route degrade under pilot volume? | **No.** Nothing here is a load test |

The last two rows are why the verdict rule must be written **before** the run, not after. A scorecard
read after the fact will find a story in 27 messages.

### Order of the run, and why it is not obvious

Send OTP-shaped messages **first**, in every round. If credit runs out mid-round, the criterion that
survives is the one on the login path, which is the one #137 is actually protecting. The
`driver_assigned` template is the encoding stress test and can be re-run; a missing OTP result makes
the whole round uninformative.

### The BudgetSMS GET is a standing argument against it

`handle` is the API secret and `msg` carries the OTP, and the endpoint is GET-only, so both live in a
URL. Node's `fetch` does not log URLs, so the repo leaks nothing — but the URL exists at every hop
that terminates TLS and in any future proxy or trace. It is not disqualifying on its own; it belongs
on the scorecard as a row, so that a tie between BudgetSMS and BulkGate breaks on something other
than €0.014 a segment.

### Rates in this plan are inherited and must be re-derived

Every euro figure here descends from research §4.1's `observed 2026-08-14` table. #137's own body says
"Rates move; re-observe at bake-off time." The scorecard therefore carries a **rates** row with its
own observation date, and the €4.33–€4.87 estimate above is `derived` under stated conditions (three
rounds, the three probes, an FX range of 1.0–1.3, those rates), not a quote. When the PR body
restates it, re-derive it there rather than copying this line — and note that this figure already
moved once inside this plan, from €3.55–€3.99, when the RU probe was added. A figure that moved once
is exactly the kind that gets inherited stale.

---

## APPENDIX A — `docs/research/sms-bakeoff-scorecard.md`, ready to copy

The scorecard task's deliverable, written out so it is **copied rather than composed**. Everything
that makes it honest — the decisive/informational split, the `vendor docs` labels, the "not a rate"
warning, the two legal verdict forms — is load-bearing and survives only if it is not paraphrased.
Fill the run-date header; leave every `observed` cell blank.

````markdown
# SMS provider bake-off — scorecard (#137)

**Run date:** — · **Run by:** — · **Rates re-observed on:** — · **Twilio account tier:** trial / paid

Cells marked `observed` are **blank until the run**. A cell filled from a vendor's own page is
labelled `vendor docs` and is **not** evidence of delivery: #137 asks for handset results, "not
vendor claims", and blurring the two is the thing it forbids.

## Result

### Decisive rows — these settle the switch

| # | Criterion | Provenance | Twilio | BulkGate | BudgetSMS |
|---|---|---|---|---|---|
| 1 | Delivered to **LMT** (`n/3` rounds) | observed | | | |
| 2 | Delivered to **Tele2** (`n/3`) | observed | | | |
| 3 | Delivered to **Bite** (`n/3`) | observed | | | |
| 4 | Sender reads `SaktaCab` — LMT / Tele2 / Bite | observed | | | |
| 5 | LV diacritics intact (probe 2) | observed | | | |
| 6 | RU Cyrillic intact (probe 3, round 1) | observed | | | |
| 7 | 2-segment message arrives as **one** message | observed | | | |
| 8 | Failed send — the thrown `Error.message`, verbatim | observed | | | |

### Informational rows — context, never the deciding vote

| # | Criterion | Provenance | Twilio | BulkGate | BudgetSMS |
|---|---|---|---|---|---|
| 9 | Median time to inbox, OTP (±5 s — two clocks) | observed | | | |
| 10 | Median time to inbox, 2-segment probe | observed | | | |
| 11 | Segment count the API reported for row 7 | observed | | | |
| 12 | Rate per segment, re-observed today | observed | | | |
| 13 | Delivery receipts available | vendor docs | status callbacks | advanced API | `/pullDlr/` |
| 14 | EU processor | vendor docs | US by default | CZ | NL |
| 15 | Support in EU hours | vendor docs | | | |
| 16 | Credentials + body travel in the URL | code | no (POST form) | no (POST JSON) | **yes — GET only** |

**Row 11 settles an open `expected`.** The implementation counts BulkGate segments from `part_id`
entries matching `/_\d+$/`, because the vendor's documented example returns *three* ids for a
two-part message. Record the raw `part_id` array here, not only the count.

**Rows 1–3 are not a delivery rate.** Three observations catch a **broken** route, not a **flaky**
one — they cannot separate 99% from 90%. Write `3/3`; never write "100%".

**Row 9–10 precision.** Time-to-inbox is `sent at` (script stdout) → the handset's own SMS
timestamp. Both devices on network time, recorded to the second. **Differences under 5 s are clock
noise, not latency** — do not report a figure finer than that.

## Prerequisites

A day booked without all of these produces a partial scorecard.

- [ ] Three LV SIMs — **LMT**, **Tele2**, **Bite** — each in a phone whose SMS app shows per-message timestamps.
- [ ] **Accounts the production deploy is not using**, or a deploy bound to Twilio for the duration. Sharing them means a mid-run `low_credit` fails **real riders' OTPs**, and `auth.service.ts:194` releases the resend cooldown, so they retry straight into the same empty balance.
- [ ] Funded **BulkGate** account, application id + token minted. **No free dry-run exists** — the first proof these credentials work costs a segment.
- [ ] Funded **BudgetSMS** account — username, userid, handle. This one *does* have a free pre-flight: `/testsms/`.
- [ ] Twilio tier decided. On a trial, recipients must be console-verified and the sender is the trial number — see the Verdict rule.
- [ ] `BAKEOFF_LMT`, `BAKEOFF_TELE2`, `BAKEOFF_BITE` set to the three handsets in E.164.
- [ ] ~€2 credit per account (€4.33–€4.87 total, `derived` — see the plan's Level 4), so a retried round does not strand the run.

## Steps

Ordered so that a credential fault is found before it wastes a round. Fill the handset columns
within ~10 minutes of each round, while it is still obvious which message was which.

| # | Do | Signal appears in | Expect |
|---|---|---|---|
| 1 | `pnpm --filter @taxi/api sms:bakeoff` with no flags | stdout | The full matrix and its derived spend, **nothing sent**. This is what proves the dry-run default defaults |
| 2 | `--testsms` (BudgetSMS only) | stdout | `OK <id>` per handset, no credit deducted, no SMS |
| 3 | **One** BulkGate probe send to a single handset | stdout + that handset | `accepted` and a message arrives. BulkGate has no free dry-run, so this costs a segment and is the cheapest possible credential proof |
| 4 | Confirm Twilio tier; on a trial, verify the three numbers in the console | Twilio console | All three verified, or the run cannot reach them at all |
| 5 | **Round 1**, morning: `--confirm --round 1` | stdout + three handsets | Rows pasted into the table below; handset columns filled |
| 6 | **Round 2**, midday: `--confirm --round 2` | same | same |
| 7 | **Round 3**, evening: `--confirm --round 3` | same | same |
| 8 | One failure probe per provider — an invalid `to` | stdout | The thrown `Error.message` verbatim → row 8. **BudgetSMS documents no charge** on an `ERR` response (spec V2.7 §2: "no credit is deducted"), so `ERR 2010`/`2011` is free. BulkGate (400 `invalid_phone_number`) and Twilio (400 `21211`) reject at validation and are `expected` not to charge — **not sourced**, so budget for three segments rather than assuming zero |
| 9 | Re-open the three pricing pages | browser | Row 12, with today's date. §4.1's rates are `observed 2026-08-14` and #137 says they move |

**Probe order inside every round: OTP first.** If credit runs out mid-round, the criterion that
survives is the one on the login path — which is what #137 is protecting. The 2-segment probes are
the encoding test and can be re-run; a missing OTP result makes the whole round uninformative.

### Raw run log

Paste the script's rows here, unedited.

| round | provider | operator | template | sent at (UTC) | api result | api segments | received at | sender shown | body intact |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

## Verdict

**Switch to a candidate only if it matches Twilio on rows 1–7 and row 8 is legible.** Specifically:

- Any **0/3** on rows 1–3 disqualifies that provider outright.
- **Sender stripped** on any operator (row 4) disqualifies. An OTP from an unknown number is a trust
  cost and a support cost, not a cosmetic one.
- **Mangled text** (rows 5–6) disqualifies. Transliteration was ruled out in §4.2 and is not a remedy.
- A **split** 2-segment message (row 7) does not disqualify on its own — record it and decide.
- **Price (row 12) is the tiebreaker, never the criterion** (§4.1). It breaks a tie between
  qualifying candidates; it never promotes a failing one.

**On a trial Twilio account, the verdict has exactly two legal forms.** A trial cannot use an
alphanumeric sender and cannot reach unverified riders, so "keep Twilio" is not a validated outcome:

1. **"Switch to X"** — X qualified on rows 1–7. Twilio's unscorable sender cell does not block this:
   the question was whether the *candidate* preserves `SaktaCab`, and the candidate's own cells
   answered it.
2. **"No candidate qualified; Twilio must still be re-validated on a paid account before pilot."**

**This scorecard does not close #137 by itself.** #137 closes when the grid is filled and either the
switch has shipped or the reason not to is recorded here.
````


## AMENDMENTS

<!-- Append-only. Newest at the bottom. -->

### 2026-09-21 — implementation pass (`.claude/reports/sms-provider-bakeoff-137-report.md`)

Eight divergences, folded into the tasks above at the point each applies rather than only listed here.
Numbered so the task text can cite them.

1. **`env.schema.ts` split; `sms-env.schema.ts` added.** Writing the two credential groups, the selector
   and the generalised superRefine inline took that file from 395 to **553** lines, past the 500-line
   `max-lines` **error** — the gate could not go green as the plan was written. The split is line-budget
   only, the kind `format-message.ts` records in `@taxi/shared`: the fields are spread back into
   `envSchema` at the position they would have occupied, and the composed schema is unchanged in shape
   and in every message it can emit. `TWILIO_*` moved too, as one concern. Placement of the check stays
   in `env.schema.ts`, above the production gate, because that is the property the caller owns.
   *(Touches: New Files to Create, Files to Update, all four Phase-1 tasks.)*

2. **The superRefine snippet as printed did not typecheck.** Two parallel `as const` records plus
   `Object.entries` widens the key to `string` (`PREFIX[kind]` fails) and makes `keys` a union of three
   readonly tuples (`keys.filter` not callable). Rewritten as one typed `Record`. Behaviour identical,
   and the order property `env.schema.spec.ts:216`'s regex depends on is untouched — it rests on key
   order *within* a group's array.

3. **The script reads each send's result off the provider's log line, and BulkGate logs `partId`.**
   A first pass filled `api segments` from the script's own estimator, which duplicated the dry run's
   guess and left scorecard **row 11** unfillable — the row designated to settle BulkGate's `expected`
   `part_id` counting rule. The seam stays `Promise<void>` (Q1), so the vendor's count and id reach the
   caller only through the log; captured in-process. Consequences: `api result` is now `ok <vendor id>`,
   `BulkGateSmsProvider`'s success log gains the raw `partId`, and `isGsm7` is exported for the script's
   own encoding column rather than duplicating the GSM 03.38 table.

4. **Script step order: argv and recipients before the env parse.** The listed order makes a bare
   invocation throw a `ZodError` about `DATABASE_URL`, not the usage message Level 4 step 1 asserts.

5. **Send order is provider → probe → operator.** The task's illustrative table showed
   provider → operator → template, which contradicts this plan's own twice-stated OTP-first rule.
   Column shape — what the run sheet cites — is unchanged.

6. **`features/auth/index.ts` not touched; the script deep-imports the three providers.** Widening the
   slice's public API would let any module construct a provider and skip the production boot-refusal.

7. **The Appendix A diff is empty, not one line.** Filling a run date for a run that did not happen is
   the `observed`-without-a-run defect; the run fills the header.

8. **`SMS_HTTP_TIMEOUT_MS = 10_000` is now declared in three provider files.** Extracting it to a shared
   `sms.policy.ts` would mean editing `twilio-sms.provider.ts`, which Out of Scope forbids. Left as three
   literals that must agree — worth one line in a follow-up if `TwilioSmsProvider` is ever in scope again.

**What did NOT change:** the seam, `StubSmsProvider`, `TwilioSmsProvider`, both consumers,
`notifications.module.ts`, the harness's `RecordingSmsProvider`, and the factory's production
boot-refusal — all four of `auth.module.spec.ts`'s original cases pass untouched.

**Gate**, `observed` 2026-09-21 on the code tree this ticket's commit ships, via
`record-gate.sh --clean` (exit 0): `pnpm turbo run typecheck lint test build --force` → 22/22 tasks; `@taxi/api` `Tests: 39 skipped, 719 passed, 758 total`, `Test Suites: 2 skipped, 77
passed, 77 of 79 total`. Baseline at this branch's base `1c98ac8`, run alone: `39 skipped, 694 passed,
733 total`, `2 skipped, 75 passed, 75 of 77 total` — so +25 tests and +2 suites, exactly this ticket's
additions, and therefore no other suite moved.

**#137 stays OPEN.** AC #6 (handset results) and AC #7 (the switch, or the recorded reason) are
untouched by this loop.
