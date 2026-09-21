# Feature: Shorter tracking links + trimmed LV/RU SMS templates, 1 segment (#136)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Bring the two linked rider SMS (`sms.driver_assigned`, `sms.booking_confirmed_phone`) from 2 billed
segments to 1 in **both LV and RU**, keeping full Latvian diacritics and Cyrillic. The segment cost is
the 44-character tracking link plus the polite framing, not the alphabet — transliteration to ASCII was
rejected (Linards, 2026-08-14).

Four changes, all needed together:

1. **Short domain** — `PUBLIC_TRACKING_BASE_URL` on a host of **≤10 characters** (`sakta.lv` = 8).
   #13 buys it; this ticket derives the budget and refuses a longer host at production boot.
2. **Shorter token** — `mintTrackingToken()` 16 bytes → 12 bytes (22 → 16 base64url chars, still 96 bits).
   Contract change: `trackingTokenSchema` shape-pins the length.
3. **Drop the polite framing and the scheme** — `Jūsu šoferis … Sekojiet līdzi: https://…` → `Šoferis … sakta.lv/…`.
4. **Get `?lang=` out of the SMS URL** — `trackingLink()` appends `?lang=ru` today (8 chars), which the
   research doc's RU count silently omitted. Replaced by a one-character path segment (`/t/` lv, `/r/` ru,
   `/e/` en) served by two Next.js rewrites — 0 extra characters, no wire-contract change.

Every variable in the rendered message is **bounded**, so the 1-segment property is a proof rather than a
sample: see *The character budget* below.

## User Story

As **Sakta Cab's operator paying the SMS bill**
I want **the two tracking-link SMS to fit one billed segment in Latvian and Russian**
So that **the pilot's largest cost line drops ~35% without the rider losing their own alphabet**

## Problem Statement

Latvian diacritics and Cyrillic force **UCS-2: 70 characters per segment**, not 160. Today
`sms.driver_assigned` renders at 105 characters LV and `sms.booking_confirmed_phone` at 90
(`observed`, segmenter run 2026-08-14, research §4.2) — both 2 segments, on every phone-booked ride.
Nothing in the tree measures this, so the next copy edit moves the bill silently.

## Solution Statement

Spend the character budget deliberately, bound every term that feeds it, and pin the result with a test:

- Ship `smsSegments()` in `@taxi/shared` — the first thing in the tree that can count a billed segment.
- Trim the fixed text of the two linked templates in all three catalogs.
- Shorten the token; move link-building into `@taxi/shared` and strip the scheme and the `?lang=` query.
- **Bound the two unbounded inputs** — driver name and ETA — so no input can exceed the budget.
- Derive a **host-length budget** from the binding worst case (RU `driver_assigned`) and enforce it at
  production boot, so the test's assumption is true where it bills.
- Keep a runtime `warn` as an assertion: with every term bounded it must never fire, so if it does, the
  derivation is wrong and that is worth an alarm.

## Out of Scope / Non-Goals

- **Not included: buying the domain.** #13 owns `PUBLIC_TRACKING_BASE_URL`'s value. This ticket ships
  the budget it must satisfy and a boot check that refuses a host over it.
- **Not included: lever 1** (#135, skip rider SMS for app-booked rides). Independent; either order works.
- **Not changing: `trackingViewSchema`.** Adding rider `language` to the wire payload was the obvious way
  to drop `?lang=`; rejected — see NOTES → Rejected alternatives.
- **Not changing:** `sms.booking_confirmed`, `sms.driver_arrived`, `sms.otp_code` (already 1 segment),
  the tracking page's rendering, the rate limiter, `driverFirstName()` (the page shares it), or the
  `?lang=` switcher links **on** the page.
- **Not included: a segment count on the `sms_sent` log line.** The ledger reads `kind` + `channel`; the
  provider already reports `num_segments` (`twilio-sms.provider.ts:76`).
- **Not included: a second link shortener or a redirect service.** The domain is the shortener.

## Feature Metadata

**Feature Type**: Enhancement
**Estimated Complexity**: Medium — small diffs, but four surfaces and a contract change with 8 call sites
**Primary Systems Affected**: `packages/shared` (schema, catalogs, segmenter, link builder), `services/api`
(notifications slice, env schema), `apps/dispatch` (rewrites)
**Dependencies**: none new — no library, no migration

## Related Work

**Implements**: [#136](https://github.com/linardsb/taxi/issues/136) · **Epic**: [#1](https://github.com/linardsb/taxi/issues/1);
architecture `docs/epics/sakta-cab.architecture.md` (§ *Hosting decision revised (2026-08-16)*, line 130:
"#13 buys the short domain #136 needs")

**Back-references**:

- `.claude/plans/rider-comms-sms-tracking-page.md` — Why: #63 built every file this ticket edits —
  `trackingLink()`, the catalogs, `trackingTokenSchema`, the `/t/[token]` page.
- `.claude/plans/deploy-hetzner-environment.md` (lines 49–51) — Why: #13's plan already records "buy a
  short domain… lever 2 needs `sakta.lv`-length"; this plan turns that prose into a number.
- `docs/research/hosting-sms-cost-research.md` §4.2–4.3 — Why: the source of every figure here, **and the
  source of one this plan corrects** (see Correction below).

**Forward-references**:

- (none yet) — #135 (lever 1) is independent, not downstream.

---

## Correction to the inherited figures (read before trusting §4.3)

Research §4.3 gives trimmed RU `driver_assigned` as **59 chars → 1 segment**. Reproducing it:
fixed text 20 + `Янис` 4 + `LV-1234` 7 + `7` 1 + `sakta.lv/t/` 11 + token 16 = **59**. The arithmetic is
right and the count is reproducible — but it **omits the `?lang=ru` that `trackingLink()` actually
appends** (`services/api/src/features/notifications/sms-templates.ts:18`,
`return language === 'lv' ? url : \`${url}?lang=${language}\`;`), which is 8 characters on every
non-Latvian link. Pinned by an existing assertion:
`ride-notifications.service.spec.ts:170` — ``expect(sent[0]!.body).toContain(`/t/${TOKEN}?lang=ru`)``.

`derived`, at the issue's own worst-case name (*Aleksandrs*, 10) with `plate='LV-1234'` and a 1-digit ETA:
20 + 10 + 7 + 1 + 11 + 16 + **8** = **73 > 70** → still 2 segments. The doc's own recipe does not reach
1 segment in Russian. That is why change 4 exists and is not optional.

**The LV row is unaffected** — lv is the one language `trackingLink()` sends without the query.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `packages/shared/src/schemas/tracking.ts` (lines 10–19) — Why: `trackingTokenSchema`, the regex and the
  doc comment that both state 22.
- `packages/shared/src/i18n/lv.ts` (lines 1–19) — Why: the reference dictionary; `MessageKey` derives from
  it, and the file header already explains the segment economics.
- `packages/shared/src/i18n/ru.ts` (lines 8–15), `packages/shared/src/i18n/en.ts` (lines 8–14) — Why: the
  two catalogs pinned to `lv` by `satisfies`.
- `packages/shared/tests/i18n.test.ts` (lines 53–65) — Why: `formatMessage`'s expected-output assertion
  hardcodes the full LV `driver_assigned` string; it breaks on the trim and must be updated.
- `packages/shared/tests/tracking.test.ts` (lines 8, 21–43) — Why: `VALID_TOKEN` and the length cases.
- `packages/shared/src/index.ts` — Why: flat barrel, one `export *` per module; two new modules go here.
- `packages/shared/src/money.ts` — Why: the shape to copy for a pure, zod-free, Node-free shared module.
- `services/api/src/features/notifications/sms-templates.ts` (whole file, 29 lines) — Why: `trackingLink()`
  moves out of here to `@taxi/shared`; `driverFirstName()` stays and gains a bounded sibling.
- `services/api/src/features/notifications/tracking/tracking.service.ts` (lines 42–50, 115) — Why:
  `mintTrackingToken()`'s 16 bytes, and the page's untruncated use of `driverFirstName`.
- `services/api/src/features/notifications/ride-notifications.service.ts` (lines 50–156) — Why: both send
  paths, and `etaToPickup` (lines 144–156) which the ETA bound clamps.
- `services/api/src/features/notifications/ride-notifications.service.spec.ts` (lines 155–175, 244–260) —
  Why: the three assertions that pin `?lang=` behaviour and the `driver_assigned` body.
- `services/api/src/common/config/env.schema.ts` (lines 303–310, 364–375) — Why: where
  `PUBLIC_TRACKING_BASE_URL` is declared and the production `superRefine` block the host budget joins,
  directly under the localhost check it mirrors.
- `apps/dispatch/next.config.ts` (whole file, 5 lines) — Why: currently empty; the two rewrites land here.
- `apps/dispatch/src/app/t/[token]/page.tsx` (lines 22–52, 160–170) — Why: `langFrom(searchParams)` is what
  the rewrites feed; the switcher links stay `?lang=`.
- `apps/dispatch/src/features/tracking/tracking-map.tsx` (line 99) — Why: the island polls the **absolute**
  path `` `/t/${token}/data` ``, so it keeps working under a rewritten `/r/<token>` browser URL. Confirm
  before assuming.
- `packages/shared/src/schemas/vehicle.ts` (line 7) and `packages/shared/src/schemas/user.ts` (line 15) —
  Why: the two schema bounds the budget is built on (`plate.max(10)`, `displayName.max(120)`).
- `.claude/references/logging-standard.md` (lines 3–16) — Why: `domain.component.action_state`, and the
  "never log" list the new `warn` must respect.
- `docs/research/hosting-sms-cost-research.md` §4.4 — Why: the Twilio trial setup Phase 0 uses (free
  credit, sends only to numbers verified in the console — Atis, Dina, Linards).

### New Files to Create

- `packages/shared/src/sms-segments.ts` — GSM-7/UCS-2 billed-segment counter + the single-segment limits.
- `packages/shared/src/tracking-link.ts` — `trackingLink()`, `TRACKING_PATH_BY_LANGUAGE`,
  `TRACKING_LINK_HOST_MAX_CHARS`, `SMS_DRIVER_NAME_MAX_CHARS`, `SMS_ETA_MAX_DISPLAY_MINUTES`.
- `packages/shared/tests/sms-segments.test.ts` — unit tests for the counter itself.
- `packages/shared/tests/sms-budget.test.ts` — **the AC #1 test**: every linked template, every language,
  at the maximum of every bound, asserted at 1 segment and at an exact length.
- `packages/shared/tests/tracking-link.test.ts` — link shape, scheme stripping, path-per-language.
- `services/api/src/features/notifications/sms-templates.spec.ts` — `driverFirstName` / `smsDriverName`
  (the file's header claims "the unit spec exercises these directly"; no such spec exists today).
- `apps/dispatch/src/app/t/tracking-rewrites.test.ts` — matches a **real minted link** against the rewrite
  table, so the api's output and the dispatch app's routing are pinned to each other.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [3GPP TS 23.038 — SMS Data Coding Scheme](https://www.etsi.org/deliver/etsi_ts/123000_123099/123038/)
  - Specific section: §6.2.1 GSM 7 bit Default Alphabet, §6.2.1.1 extension table
  - Why: the exact basic + extension character sets `smsSegments()` must encode. Extension characters
    (`^{}\[~]|€`) cost **two** septets; every other listed character costs one.
- [Next.js — `rewrites`](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites)
  - Specific section: "Rewrite parameters" / query strings in `destination`
  - Why: `destination: '/t/:token?lang=ru'` is the whole of change 4 on the dispatch side. Confirm the
    browser URL stays `/r/:token` (rewrite, not redirect) and that the param reaches `searchParams`.
- [Node `crypto.randomBytes`](https://nodejs.org/api/crypto.html#cryptorandombytessize-callback) and
  [`Buffer.toString('base64url')`](https://nodejs.org/api/buffer.html#buftostringencoding-start-end)
  - Why: 12 bytes → exactly 16 base64url characters, no padding (12 is divisible by 3).
- [Twilio — Send an SMS with curl](https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource)
  - Why: Phase 0's spike sends two messages without touching repo code.

### Patterns to Follow

**Enum-pinned record** (CLAUDE.md: a set that must stay 1:1 with an enum is a compile-pinned `Record`,
never a prose list — the #63 precedent is `TRACKING_STATE_BY_STATUS`):

```ts
// packages/shared/src/tracking-link.ts
export const TRACKING_PATH_BY_LANGUAGE: Record<Language, string> = {
  lv: 't',
  ru: 'r',
  en: 'e',
};
```

Adding a fourth `Language` then fails typecheck here **and** fails the dispatch rewrite test.

**Production-only boot gate** — mirror the block directly above it (`env.schema.ts:364–375`): compute,
compare, `ctx.addIssue` with `path`, and a message that says what to do, not just what is wrong.

**Structured log** (`logging-standard.md`): `domain.component.action_state`, always `event` + `at` +
the id. Existing neighbours in this file: `ride.notifications.sms_sent`, `…sms_send_failed`,
`…sms_alert_emit_failed`. The new one is `ride.notifications.sms_multi_segment`.
**Never the body** — it carries the rider's tracking link and the driver's name.

**Test naming**: every spec title ends `(expected)` / `(edge)` / `(failure)`, the convention in
`tracking.test.ts` and `i18n.test.ts`.

---

## The character budget (the arithmetic everything else serves)

UCS-2 single segment = **70 characters** (`observed` from the standard, not a run: TS 23.038 §6.2.3 —
140 octets / 2). Any Latvian diacritic or Cyrillic letter in the *fixed* text makes the whole message
UCS-2 regardless of the variables, so LV and RU templates are UCS-2 **by construction** and no input can
make them GSM-7. EN is pure ASCII → GSM-7, 160 septets, never at risk.

Every term is a **bound**, not a sample. That is the difference between this table and research §4.3's:

| Component | Max | Kind | Provenance / enforcement |
|---|---|---|---|
| RU fixed text `Водитель {…}, {…}, ~{…} мин {…}` | 19 | constant | `derived` — count of the non-placeholder characters |
| LV fixed text `Šoferis {…}, {…}, ~{…} min {…}` | 18 | constant | `derived`, same |
| EN fixed text `Driver {…}, {…}, ~{…} min {…}` | 17 | constant | `derived`, same |
| driver first name | 10 | **bound** | enforced by `smsDriverName()` — over 10, it renders `<initial>.` (2–3 chars). `SMS_DRIVER_NAME_MAX_CHARS` |
| plate | 10 | **bound** | `observed` — `packages/shared/src/schemas/vehicle.ts:7`, `z.string().min(2).max(10)`. Latvian plates are 7 (`AB-1234`); 10 is the schema ceiling. `'—'` (no vehicle) is 1. |
| ETA | 2 | **bound** | enforced by clamping the display to `SMS_ETA_MAX_DISPLAY_MINUTES = 99`. `'?'` (no position) is 1, cheaper. |
| host | 10 | **bound** | `TRACKING_LINK_HOST_MAX_CHARS`, refused at production boot. `sakta.lv` is 8. |
| `/` + path + `/` | 3 | **bound** | `TRACKING_PATH_BY_LANGUAGE` values are single characters, asserted in `tracking-link.test.ts` |
| token | 16 | constant | `derived` — `randomBytes(12).toString('base64url')`, 12 ÷ 3 × 4 |

**Host budget, derived from the binding case (RU `driver_assigned`):**

```
70 − (19 fixed + 10 name + 10 plate + 2 eta + 3 path + 16 token)
  = 70 − 60
  = 10 characters of host
```

→ `TRACKING_LINK_HOST_MAX_CHARS = 10`. `sakta.lv` is **8**. `saktacab.lv` is 11 and is refused at boot.

**Why this is a proof, not a sample.** The rendered length is strictly additive —
`fixed + |name| + |plate| + |eta| + |host| + 3 + 16` — and monotone in each term. Maximising each term
independently therefore maximises the total, so a single test case at every maximum covers **all** inputs.
There is no input outside the table's rows.

**Worst-case renders at the host ceiling (10)** — the numbers `sms-budget.test.ts` pins exactly:

| Template | Chars at every bound | Encoding | Limit | Segments | Spare |
|---|---|---|---|---|---|
| RU `driver_assigned` | 19+10+10+2+10+3+16 = **70** | UCS-2 | 70 | **1** | **0** |
| LV `driver_assigned` | 18+10+10+2+10+3+16 = **69** | UCS-2 | 70 | **1** | 1 |
| EN `driver_assigned` | 17+10+10+2+10+3+16 = **68** chars / **69** septets | GSM-7 | 160 | **1** | 91 |
| LV `booking_confirmed_phone` | 30 + 29 = **59** | UCS-2 | 70 | **1** | 11 |
| RU `booking_confirmed_phone` | 26 + 29 = **55** | UCS-2 | 70 | **1** | 15 |
| EN `booking_confirmed_phone` | 21 + 29 = **50** | GSM-7 | 160 | **1** | 110 |

The RU row has **zero** spare at the host ceiling — by construction, since the ceiling was derived from it.
At the real `sakta.lv` (8) the two binding renders are **RU 68** and **LV 67**, with 2 and 3 spare; EN is
66 characters against a 160-septet limit and never binds. Both host figures are
`derived`; the test asserts the 10-char-host column, because that is what the boot gate permits.

The LV/RU rows are in **characters**, the right unit: UCS-2 bills 70 UTF-16 code units and every character
in those templates costs one. The EN row carries both because GSM-7 bills **septets** and `~` sits in the
extension table at 2 septets. `smsSegments()` does that arithmetic. EN `booking_confirmed_phone` has no
extension character, so 50 = 50.

**Cost** (`derived`, inherited from research §4.3 and **not re-derived here** — its assumptions are
430 rides/mo at the PRD's month-3 target, 30% phone-booked with no evidence behind that share, and
~100 OTPs/mo, also assumed): with lever 1 (#135) applied, 745 → 487 segments/mo, €23.17 → €15.15 at
BulkGate rates. **Without** #135 this ticket alone moves 1,347 → 1,089 segments (`derived`: 129 phone
rides × 2 segments saved = 258), €41.89 → €33.87 (rate €0.03110/segment, `derived` from the doc's own
745 → €23.17). Both are `expected` until a real month bills.

---

## IMPLEMENTATION PLAN

### Phase 0: Settle the linkification assumption BEFORE writing code

**Depends on:** nothing. **Blocks:** Phases 2–5.

Dropping `https://` buys 8 of 70 characters and is the one decision no test in the tree can check. It is
settled in ten minutes with the Twilio trial, before a single string moves — not discovered at Level 4
after four surfaces have changed.

**Tasks:**

- Send the two proposed bodies to a verified handset and look at them
- Record the result in this plan's AMENDMENTS, then take the branch the result dictates

### Phase 1: The segmenter (`packages/shared`)

**Independent of:** Phase 0 — the counter is right regardless of which branch Phase 0 takes, so it can be
built while waiting for a handset. Nothing downstream of it may land until Phase 0 reports.

Nothing in the tree can count a billed segment. Everything below asserts through this.

**Tasks:**

- `smsSegments()` + the single-segment and concatenated limits
- Its own unit tests, including a known-2-segment string and an extension character

### Phase 2: The contract changes (`packages/shared`)

**Depends on:** Phase 0 (the templates differ by branch) and Phase 1 (the budget test imports the counter)

**Tasks:**

- `tracking-link.ts`: `trackingLink()` moved out of the api, the language path record, the two budget
  constants
- `trackingTokenSchema` 22 → 16
- Trim the six catalog entries (2 templates × 3 languages)
- The AC #1 budget test; update `i18n.test.ts` and `tracking.test.ts`

### Phase 3: The api (`services/api`)

**Depends on:** Phase 2 (imports the new exports from `@taxi/shared`)
**Independent of:** Phase 4 — different packages, no shared file.

**Tasks:**

- `mintTrackingToken()` 16 → 12 bytes
- `smsDriverName()` and the ETA clamp — the two bounds
- Private `sendSms` carrying the multi-segment assertion `warn`
- The host-budget boot gate in `env.schema.ts`
- Update the specs that pin 22 chars and `?lang=`

### Phase 4: The dispatch app (`apps/dispatch`)

**Depends on:** Phase 2 (`trackingLink`, `TRACKING_PATH_BY_LANGUAGE`)

**Tasks:**

- Two rewrites in `next.config.ts`; the test that matches a real minted link against them
- Update the two test fixtures holding a 22-char token

### Phase 5: Docs and the figures that flow out

**Depends on:** Phases 1–4

**Tasks:**

- Correct research §4.2–4.3 (the 22-char statements and the RU count that omitted `?lang=ru`)
- `docs/runbooks/hetzner-deploy.md` env table: the host-length constraint and the new boot-gate row

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

Run the `packages/shared` steps from the repo root. After **every** `packages/shared/src` edit, rebuild
before running anything downstream — apps and the api import shared from `dist`, so a targeted test after
a src-only edit is green on a change that has not landed.

### SPIKE Phase 0 — does a bare `sakta.lv/r/…` linkify on a real handset?

- **IMPLEMENT**: no repo code. Using the Twilio trial credentials already in `.env` and Linards' verified
  number (research §4.4), send the two proposed bodies verbatim:

  ```bash
  # LV — the exact string the LV catalog will hold, rendered at the budget
  BODY_LV='Šoferis Aleksandrs, ABCD-12345, ~99 min sakta.lv/t/tttttttttttttttt'
  BODY_RU='Водитель Aleksandrs, ABCD-12345, ~99 мин sakta.lv/r/tttttttttttttttt'
  for B in "$BODY_LV" "$BODY_RU"; do
    curl -fsS -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json" \
      --data-urlencode "To=$VERIFIED_NUMBER" \
      --data-urlencode "From=$TWILIO_FROM_NUMBER" \
      --data-urlencode "Body=$B" \
      -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["num_segments"], d["status"])'
  done
  ```

  Check three things on the handset: (a) is `sakta.lv/r/…` rendered as a **tappable link**; (b) does the
  Latvian and Cyrillic text render correctly, not as `?????`; (c) does Twilio report `num_segments` = 1
  for both — an independent check on `smsSegments()` before it is written.
- **GOTCHA**: `sakta.lv` need not be registered. Linkification is a client-side text-pattern decision and
  does not resolve DNS — tapping the link will fail, and that is not what this step measures.
- **GOTCHA**: the trial sends **only** to numbers verified in the Twilio console. An unverified `To` fails
  with a 21608, which is a credentials problem, not a linkification answer.
- **GOTCHA**: iOS Messages and Google Messages linkify differently. If only one handset is available, say
  which in the AMENDMENTS entry — the claim is then about that client, not about "SMS clients".
- **VALIDATE**: both messages received; record for each: tappable yes/no, glyphs correct yes/no,
  `num_segments`. Write the result into this plan's AMENDMENTS **before** starting Phase 2.
- **DECISION**: this is the only branch point in the plan.
  - **Linkifies** → proceed exactly as written.
  - **Does not linkify** → take fallback C (NOTES → *If the scheme has to come back*): restore `https://`
    in `trackingLink()`, keep **all** of changes 1, 2 and 4 and the `booking_confirmed_phone` trim (still
    1 segment in all three languages with the scheme — `derived`: RU 55+8 = 63 ≤ 70), and drop
    `driver_assigned` from AC #1, which stays at 2 segments. The ticket's saving halves from 258 to 129
    segments/mo; it does not vanish. Amend AC #1 and the issue before continuing.
- **SATISFIES**: A2 — the one assumption nothing else can test.

### CREATE `packages/shared/src/sms-segments.ts`

- **IMPLEMENT**: `SMS_GSM7_SINGLE_SEGMENT_CHARS = 160`, `SMS_UCS2_SINGLE_SEGMENT_CHARS = 70`, the
  concatenated limits (153 / 67), and `smsSegments(body: string): number`. Algorithm: walk the string; if
  every character is in the GSM-7 basic set, cost 1 septet each; if in the extension set, 2; if any
  character is in neither → UCS-2, and the count is `body.length` (UTF-16 **code units**, which is what
  the 70/67 limits are in). Then: `≤ single ? 1 : Math.ceil(n / concatenated)`.
- **PATTERN**: `packages/shared/src/money.ts` — pure, dependency-free, no zod.
- **IMPORTS**: none.
- **GOTCHA**: the GSM-7 basic table includes `£ ¥ è é ù ì ò Ç Ø ø Å å Δ Φ Γ Λ Ω Π Ψ Σ Θ Ξ Æ æ ß É Ä Ö Ñ Ü
  § ¿ ä ö ñ ü à` — non-ASCII characters that are **still GSM-7**. A naive `/^[\x00-\x7F]*$/` test is wrong
  in both directions: it rejects `ä` (which is GSM-7) and accepts the backtick `\x60` (which is **not**).
  Latvian `ā č ē ģ ī ķ ļ ņ š ū ž` are correctly absent. Write the table out as a string literal.
- **GOTCHA**: no Node globals. `eslint.config.mjs` puts only `globals.es2022` in scope and
  `tsconfig.build.json` runs `types: []`, so `Buffer`/`process` fail typecheck, not merely lint.
- **GOTCHA**: `body.length` counts UTF-16 code units, so a non-BMP character counts 2. That is the right
  answer for the 70-character limit; a surrogate pair straddling a concatenated-segment boundary is a real
  edge the standard handles by shortening the segment. Not modelled — say so in the doc comment. No
  catalog string contains one.
- **VALIDATE**: `pnpm --filter @taxi/shared test` (after the next task adds its spec).
- **SATISFIES**: AC #1

### CREATE `packages/shared/tests/sms-segments.test.ts`

- **IMPLEMENT**: (expected) 70 Cyrillic characters → 1, 71 → 2; (expected) 160 ASCII → 1, 161 → 2;
  (edge) the extension-table cost as a BOUNDARY PAIR — 158 ASCII + `'€'` → 1 segment (160 septets) and
  159 + `'€'` → 2 (161). **Shipped as a pair rather than as the plan's "`'€'` alone → 2 septets":** a
  function returning segments cannot report septets, and the pair fails if `€` ever costs one. That is
  why the file holds **6 cases, not the TESTING STRATEGY's 7**; (edge) `''` → 1;
  (failure) one `'ā'` among 200 ASCII characters flips the whole body to UCS-2 → 3 segments
  (`derived`: 201 > 70, `ceil(201/67) = 3`); (edge) `'ä'` among ASCII stays GSM-7 → 1 segment, the
  assertion that catches a naive ASCII-only encoding test.
- **PATTERN**: `packages/shared/tests/money.test.ts` — plain vitest, explicit imports, no globals.
- **IMPORTS**: `{ describe, expect, it } from 'vitest'`; `'../src/sms-segments'`.
- **GOTCHA**: build the long fixtures with `'x'.repeat(n)`, not pasted literals — a literal miscounted by
  one asserts the wrong boundary and still passes.
- **GOTCHA**: cross-check at least one case against Phase 0's `num_segments` from Twilio. If they
  disagree, Twilio is right and the table is wrong.
- **VALIDATE**: `pnpm --filter @taxi/shared test -- sms-segments`
- **SATISFIES**: AC #1

### CREATE `packages/shared/src/tracking-link.ts`

- **IMPLEMENT**: move `trackingLink` here from the api and rewrite it:

  ```ts
  // EXPORTED, and not inlined into trackingLink as this plan first had it: the
  // production boot gate must measure exactly what the SMS carries, and two
  // regexes that have to agree are a way to be off by one and refuse a domain
  // that actually fits.
  export function trackingLinkHost(baseUrl: string): string {
    return baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }

  export function trackingLink(baseUrl: string, token: string, language: Language): string {
    const path = TRACKING_PATH_BY_LANGUAGE[language];
    return `${trackingLinkHost(baseUrl)}/${path}/${token}`;
  }
  ```

  Plus `TRACKING_PATH_BY_LANGUAGE` (per Patterns), `TRACKING_LINK_HOST_MAX_CHARS = 10`,
  `SMS_DRIVER_NAME_MAX_CHARS = 10`, `SMS_ETA_MAX_DISPLAY_MINUTES = 99`. Write the budget derivation out in
  the file header — the four constants are one calculation and must be read as one.
- **PATTERN**: `packages/shared/src/commission.ts` — a pure module whose header explains the rule, not just
  the signature.
- **IMPORTS**: `import type { Language } from './enums';`
- **GOTCHA**: this lives in `@taxi/shared` and **not** in the api because it is a cross-surface contract
  (CLAUDE.md): the api mints the link, the dispatch app must route it, and the two must agree. Keeping it
  api-side is what made the api↔dispatch round trip untestable.
- **GOTCHA**: `baseUrl` is a validated `z.string().url()`, so it always has a scheme and may or may not
  have a trailing slash. Both `.replace` calls are load-bearing; `new URL(baseUrl).host` would silently
  drop a path prefix if one is ever configured.
- **GOTCHA**: the path values are **one character each** and the budget depends on it. The next task
  asserts that; do not lengthen one for readability without re-deriving `TRACKING_LINK_HOST_MAX_CHARS`
  (`/ru/` instead of `/r/` puts RU at 71 at the host ceiling — over; see Q3).
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #1, AC #3

### CREATE `packages/shared/tests/tracking-link.test.ts`

- **IMPLEMENT**: (expected) `trackingLink('https://sakta.lv', 't'.repeat(16), 'lv')` → `sakta.lv/t/tttt…`
  and the `ru`/`en` cases → `/r/`, `/e/`; (edge) a trailing slash in `baseUrl` produces no `//`;
  (edge) an `http://` base is stripped too; (failure) the result contains neither `'http'` nor `'?lang='`;
  (failure) **every** value of `TRACKING_PATH_BY_LANGUAGE` is exactly 1 character and all values are
  distinct — the assertion the budget rests on; (expected) `link.length` equals
  `host + 1 + 1 + 1 + 16`, written as that arithmetic rather than a literal.
- **PATTERN**: `packages/shared/tests/tracking.test.ts`.
- **VALIDATE**: `pnpm --filter @taxi/shared test -- tracking-link`
- **SATISFIES**: AC #1, AC #3

### UPDATE `packages/shared/src/schemas/tracking.ts`

- **IMPLEMENT**: regex `{22}` → `{16}`, message `'expected 16-char base64url tracking token'`, and rewrite
  the doc comment at lines 10–15 — 16 base64url chars from `randomBytes(12)`, 96 bits, shortened in #136
  for the segment budget, with a pointer to `tracking-link.ts` for the rest of the URL contract.
- **CORRECTED post-review (PR #245 F3)**: this task originally said the token was *"rate-limited by
  `TRACKING_VIEW_MAX_PER_WINDOW`"*, and the docblock shipped saying so. **It is not.**
  `trackingViewRateKey` keys the window on the token, so it bounds polling of a KNOWN token and gives
  every guess at an unknown one a fresh window — as `notifications.policy.ts` already states. The 96 bits
  are the whole defence against guessing. Do not restore the old wording: it is the sentence that would
  license cutting the token again.
- **GOTCHA**: `TRACKING_PATH_BY_LANGUAGE` goes in `tracking-link.ts`, **not** here — this file is schemas,
  and a `Record` of route segments is not one.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck` (`test` still red until the fixtures move — expected).
- **SATISFIES**: AC #3

### UPDATE `packages/shared/src/i18n/lv.ts`, `ru.ts`, `en.ts`

- **IMPLEMENT**: exactly six values, no key changes:

  | key | lv | ru | en |
  |---|---|---|---|
  | `sms.booking_confirmed_phone` | `Jūsu taksometrs ir rezervēts. {link}` | `Ваше такси забронировано. {link}` | `Your taxi is booked. {link}` |
  | `sms.driver_assigned` | `Šoferis {driver}, {plate}, ~{eta} min {link}` | `Водитель {driver}, {plate}, ~{eta} мин {link}` | `Driver {driver}, {plate}, ~{eta} min {link}` |

  Also update the `lv.ts` file header (lines 8–9): it says "SMS bill per 160-char segment", which is the
  GSM-7 number and wrong for this catalog. Replace with the UCS-2 70 and a pointer to
  `tests/sms-budget.test.ts`.
- **GOTCHA**: `tests/i18n.test.ts:19-28` pins placeholder **sets** identical across languages per key.
  `{driver} {plate} {eta} {link}` must all survive in all three, and `{link}` in
  `booking_confirmed_phone`.
- **GOTCHA**: the trailing period after `min`/`мин` is **deliberately gone** — it buys 1 character and the
  budget table is computed without it (fixed 18 LV / 19 RU). Putting it back makes RU **71** at the host
  ceiling. Do not "fix" the punctuation.
- **GOTCHA**: `sms.booking_confirmed` (the non-phone variant) keeps `Jūsu taksometrs ir rezervēts.`
  unchanged — the `_phone` variant now differs from it by exactly `' {link}'`. Intended, not a slip.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck` — the `satisfies` clause in `i18n.ts` catches a key
  typo here.
- **SATISFIES**: AC #1

### UPDATE `packages/shared/tests/i18n.test.ts` and `tests/tracking.test.ts`

- **IMPLEMENT**: `i18n.test.ts` lines 55–65 — expected string becomes
  `'Šoferis Jānis, AB-1234, ~4 min https://t.example/abc'`; leave every other case alone.
  `tracking.test.ts` — `VALID_TOKEN` → a 16-char base64url string (e.g. `'Ab3_-6qhTGplK0vw'`, count it) and
  its comment; retitle the first case to say 16; **add a failure case asserting a 22-char token is now
  rejected**, because the cut-over is a deliberate behaviour change and must be pinned.
- **GOTCHA**: `i18n.test.ts`'s `link` argument is `https://t.example/abc` and exercises `formatMessage`,
  not the budget. Do not turn it into a budget test; that is `sms-budget.test.ts`.
- **GOTCHA**: `tracking.test.ts`'s `.slice(1)` / `+ 'A'` cases still work (15 and 17 chars). Verify by
  reading, not by assuming.
- **VALIDATE**: `pnpm --filter @taxi/shared test -- i18n tracking`
- **SATISFIES**: AC #1, AC #2, AC #3

### CREATE `packages/shared/tests/sms-budget.test.ts` — **the AC #1 test**

- **IMPLEMENT**: a table over `LANGUAGES × ['sms.driver_assigned', 'sms.booking_confirmed_phone']`
  rendered with `formatMessage` **at the maximum of every bound**: driver `'A'.repeat(SMS_DRIVER_NAME_MAX_CHARS)`,
  plate `'A'.repeat(10)` (the `vehicleSchema` ceiling — import the schema and read
  `.max` rather than hardcoding, if zod exposes it cleanly; otherwise write `10` with the file:line in a
  comment), `eta: SMS_ETA_MAX_DISPLAY_MINUTES`, and the link from the **real** `trackingLink()` with a
  host of `'x'.repeat(TRACKING_LINK_HOST_MAX_CHARS)`. For each: assert `smsSegments(body) === 1`
  **and** `body.length` equals the exact figure from the budget table (RU 70, LV 69, EN 68, and the three
  `booking_confirmed_phone` rows).

  The length assertion is the one that matters long-term: `TRACKING_LINK_HOST_MAX_CHARS` is itself
  derived, so a future character added to the RU fixed text reddens the segment assertion and the tempting
  fix is to widen the constant — which moves the guarantee with nothing objecting. Pinning the length makes
  the derivation executable instead of commentary.

  Add a header comment stating the monotonicity argument (rendered length is additive and monotone in each
  term, so maxima compose) — that is what makes one case per row a proof rather than a sample.
- **IMPORTS**: `formatMessage` from `'../src/format-message'`, `smsSegments` from `'../src/sms-segments'`,
  `trackingLink` and the constants from `'../src/tracking-link'`.
- **GOTCHA**: the host fixture must be `TRACKING_LINK_HOST_MAX_CHARS` characters, **not** the literal
  `'sakta.lv'`. The test asserts the budget the boot gate enforces; hardcoding the real 8-char domain would
  pass with 2 characters of slack the gate does not require, and the test would stop being the guard.
- **GOTCHA**: no import from `services/api`. Shared imports from nothing in the workspace — which is now
  free, since `trackingLink` lives here.
- **VALIDATE**: `pnpm --filter @taxi/shared test -- sms-budget` → 6 passing. Then **prove the test bites,
  both halves**: (1) restore `Sekojiet līdzi: ` to the LV `driver_assigned` value and re-run — the LV
  segment assertion must go red (`derived`: 69 + 16 = 85 > 70); (2) change
  `TRACKING_LINK_HOST_MAX_CHARS` to 11 and re-run — the **length** assertions must go red even though a
  naive segment-only test would too, so record which assertion fails in each case. Revert both.
- **SATISFIES**: AC #1

### UPDATE `packages/shared/src/index.ts`

- **IMPLEMENT**: `export * from './sms-segments';` and `export * from './tracking-link';` — next to
  `./money` (pure utilities), not among the schemas.
- **VALIDATE**: `pnpm --filter @taxi/shared build`, then **resolve the symbols at runtime**, not by
  grepping `index.d.ts`: that file is an `export *` barrel and carries only module names, so the plan's
  original `grep -c "smsSegments\|trackingLink" … dist/index.d.ts` returns **0** on a correct build
  (`observed`). Use
  `node -e "const s=require('./packages/shared/dist'); console.log(typeof s.smsSegments, typeof s.trackingLink, s.TRACKING_LINK_HOST_MAX_CHARS)"`.
  **Do not skip it** — downstream reads `dist`, and a src-only change is invisible to it.
- **SATISFIES**: AC #3

### UPDATE `services/api/src/features/notifications/tracking/tracking.service.ts`

- **IMPLEMENT**: `randomBytes(16)` → `randomBytes(12)`; rewrite the doc comment at lines 42–47 (12 bytes /
  16 chars / 96 bits) and say why (#136's segment budget).
- **GOTCHA**: `notifications.policy.ts:91` also says "unlimited shape-valid 22-char tokens" in the
  rate-limit rationale. Same sweep, same commit.
- **GOTCHA**: line 115 uses `driverFirstName` for the **page**, untruncated. It must not become
  `smsDriverName` — the page has no character budget and abbreviating a name there is a regression.
- **VALIDATE**: `node -e "console.log(require('node:crypto').randomBytes(12).toString('base64url').length)"`
  → `16`.
- **SATISFIES**: AC #2

### UPDATE `services/api/src/features/notifications/sms-templates.ts`

- **IMPLEMENT**: delete `trackingLink` (it lives in `@taxi/shared` now) and add the bounded sibling:

  ```ts
  export function smsDriverName(displayName: string | null): string {
    const first = driverFirstName(displayName);
    return first.length <= SMS_DRIVER_NAME_MAX_CHARS
      ? first
      : `${[...first][0] ?? ''}.`;
  }
  ```

  Header comment: why an abbreviation and not a truncation — `Konstantīn` is a mangled name, `K.` is a
  recognised form, and the rider identifies the car by plate anyway. Note that it fires only above 10
  characters and that `driverFirstName` is deliberately untouched for the page.
- **IMPORTS**: `SMS_DRIVER_NAME_MAX_CHARS` from `@taxi/shared`.
- **GOTCHA**: `[...first][0]`, not `first[0]` — a surrogate-pair initial would otherwise be sliced into a
  lone surrogate, which is a broken glyph on the handset and a UCS-2 code unit that still costs 1.
- **GOTCHA**: `driverFirstName` returns `'—'` for a null name; 1 character, so it passes through unchanged.
- **VALIDATE**: covered by the new spec below.
- **SATISFIES**: AC #1, AC #4 (A3 — the name bound)

### CREATE `services/api/src/features/notifications/sms-templates.spec.ts`

- **IMPLEMENT**: (expected) `smsDriverName('Jānis Bērziņš')` → `'Jānis'`; (edge) `smsDriverName(null)` →
  `'—'`; (failure) `smsDriverName('Konstantīns Ozoliņš')` → `'K.'`; **(the bound)** for a set of inputs
  including `'A'.repeat(120)` (the `userSchema.displayName` ceiling) and a name whose first character is a
  surrogate pair, assert `smsDriverName(x).length <= SMS_DRIVER_NAME_MAX_CHARS` — this is the assertion
  that makes the budget total; (edge) `driverFirstName` keeps its untruncated behaviour on the same
  19-character input, so the page's contract is pinned beside the SMS one.
- **PATTERN**: `notifications.policy.spec.ts` — plain jest, no Nest module, pure function calls.
- **GOTCHA**: `services/api` runs **jest**, not vitest. `import { describe, expect, it } from 'vitest'`
  will typecheck-fail. Copy the import style from `notifications.policy.spec.ts`.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- sms-templates`
- **SATISFIES**: AC #1, AC #4 (A3 — the name and ETA bounds)

### UPDATE `services/api/src/features/notifications/ride-notifications.service.ts`

- **IMPLEMENT**: three changes.
  1. Import `trackingLink` from `@taxi/shared` instead of `./sms-templates`; swap `driverFirstName(card.name)`
     at line 122 for `smsDriverName(card.name)`.
  2. Clamp the ETA in `etaToPickup` (lines 144–156):
     `return Math.min(SMS_ETA_MAX_DISPLAY_MINUTES, estimateEtaMinutes(...))`, with a comment that the
     clamp is display-only, the value is already an estimate, and a >99-minute pickup ETA means dispatch
     assigned a driver 41 km away — a bug the SMS should not spend two segments reporting.
  3. A private `sendSms(rideId, kind, phone, body)` that calls `smsSegments(body)`, emits
     `ride.notifications.sms_multi_segment` at `warn` when `> 1`, then `await this.sms.send(phone, body)`
     and `this.logSent(...)`. Both call sites (lines 70–76 and 137–138) route through it. Warn payload:
     `event`, `rideId`, `kind`, `segments`, `at`. **Never** `body`, `link`, `driver` or an unmasked phone.
- **GOTCHA**: the warn is an **assertion, not a budget backstop**. With `smsDriverName`, the ETA clamp, the
  plate schema bound and the host boot gate, no input can exceed one segment — so this firing in
  production means the derivation is wrong. Say that in the comment; it changes how the line is triaged.
- **GOTCHA**: `sendSms` must stay **inside** each method's existing `try`. Moving the send out breaks the
  file's structural "NEVER THROWS" guarantee, which is why an SMS failure cannot fail a booking.
- **GOTCHA**: extend the class comment (lines 22–36) with one line naming the segment budget and
  `sms-budget.test.ts`, or the next reader learns the budget only from the warn.
- **GOTCHA**: the file is 211 lines; `max-lines` is 500. No split needed.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- ride-notifications`
- **SATISFIES**: AC #1, AC #4 (A3 — the name and ETA bounds)

### UPDATE `services/api/src/features/notifications/ride-notifications.service.spec.ts`

- **IMPLEMENT**: (a) line 162's ``not.toContain('?lang=')`` stays and now passes for a stronger reason —
  add a sibling asserting the `lv` body contains `` `/t/${TOKEN}` ``; (b) line 170's
  ``toContain(`/t/${TOKEN}?lang=ru`)`` → ``toContain(`/r/${TOKEN}`)`` plus ``not.toContain('?lang=')``;
  (c) `TOKEN` and any other 22-char fixture → 16 chars; (d) line 256's ``toMatch(/~\d+ min/)`` survives the
  trim unchanged — **verify by reading the new LV template, do not assume**; (e) a new edge case: a driver
  position 60 km from pickup renders `~99 min`, not `~144 min` (the clamp); (f) a new failure case: a
  body forced over one segment emits `ride.notifications.sms_multi_segment` and **still sends** — the
  assertion must not become a gate.
- **PATTERN**: the file's `build()` fixture factory and its `warned.mockRestore()` pattern (around line 240).
- **GOTCHA**: `expect(body).toContain('Jānis')` / `not.toContain('Bērziņš')` at lines 251–252 test the name
  helper, and `'Jānis'` is 5 characters so `smsDriverName` returns it unchanged. Leave them.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- ride-notifications`
- **SATISFIES**: AC #1, AC #4

### UPDATE the remaining 22-char sites in `services/api`

- **IMPLEMENT**: `tracking.service.spec.ts:18-19` (comment + `TOKEN` → 16 a's);
  `tracking.integration.spec.ts:282` (`/^[A-Za-z0-9_-]{22}$/` → `{16}`); `notifications.policy.ts:91`
  (prose "22-char"); `scripts/mint-tracked-ride.ts` — read it and check whether it asserts a length.
- **PATTERN**: CLAUDE.md — grep the **noun**, not the sentence form.
- **VALIDATE**: `grep -rn "randomBytes(16)\|{22}" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v "/dist/"`
  → empty.
- **SATISFIES**: AC #3

### UPDATE `services/api/src/common/config/env.schema.ts`

- **IMPLEMENT**: in the production block, directly **after** the localhost check (line 375), add the host
  budget gate: strip the scheme and any trailing slash from `PUBLIC_TRACKING_BASE_URL`, compare
  `.length > TRACKING_LINK_HOST_MAX_CHARS`, `ctx.addIssue` on path `['PUBLIC_TRACKING_BASE_URL']` with a
  message naming the limit, the actual length, and **why** ("the linked rider SMS must fit one billed
  UCS-2 segment — #136; `sakta.lv` is 8"). Extend the field's doc comment (lines 300–305).
- **PATTERN**: the localhost check immediately above — identical structure, and its comment names the
  ticket that made it live. Do the same.
- **IMPORTS**: `TRACKING_LINK_HOST_MAX_CHARS` from `@taxi/shared` — already a dependency
  (`services/api/package.json:37`); confirm it is exported from the built `dist`, not just `src`.
- **GOTCHA**: production-only, **below** the `if (env.NODE_ENV !== 'production') return;` at line 344. Dev
  and CI run `http://localhost:3000` (host `localhost:3000` = 14 characters) and must keep booting.
- **GOTCHA**: strip the scheme **and** any trailing slash. `https://sakta.lv/` → `sakta.lv` (8), not 9.
  An off-by-one here refuses a domain that actually fits.
- **GOTCHA — this changes a FIXTURE, not just its own cases.** `env.schema.spec.ts`'s `prod()` helper
  sets `PUBLIC_TRACKING_BASE_URL: 'https://track.example.com'`, a 17-character host, and **every
  production case in that file** goes through it. The gate refuses it, so the fixture moves to
  `https://sakta.lv` and the whole file then runs under a different base URL. Expect that in the diff.
- **VALIDATE**: find the spec covering the localhost gate
  (`grep -rln "PUBLIC_TRACKING_BASE_URL" services/api/src/common services/api/test`) and add **three**
  cases: `https://sakta.lv` accepted, `https://saktacab.lv` (11) refused with the new message, and a
  trailing slash not counted (`https://sakta.lv/` is 8, not 9). A fourth — "dev still boots on the
  14-character `localhost:3000`" — was written and then dropped: the file's existing "leaves the
  localhost default alone outside production" case already asserts exactly that, and its comment now
  says so.
- **SATISFIES**: AC #1 (makes the budget true in production)

### UPDATE `apps/dispatch/next.config.ts`

- **IMPLEMENT**:

  ```ts
  async rewrites() {
    return [
      { source: '/r/:token', destination: '/t/:token?lang=ru' },
      { source: '/e/:token', destination: '/t/:token?lang=en' },
    ];
  }
  ```

  Comment: these are the SMS link shapes (#136) — a rewrite, not a redirect, so the short URL is what the
  rider sees and no round trip is spent; `lv` needs none because `/t/[token]` already defaults to it
  (`page.tsx:30`). Point at `TRACKING_PATH_BY_LANGUAGE` as the source of truth.
- **GOTCHA**: the polling island fetches the **absolute** path `` `/t/${token}/data` ``
  (`tracking-map.tsx:99`), so it resolves correctly from a `/r/<token>` browser URL. **Read that line and
  confirm it is still absolute before relying on this.** If it were relative, `/r/<token>/data` would 404
  and the page would show its offline banner forever — with the server-rendered first frame intact, so it
  would look like a working page that never updates.
- **GOTCHA**: the in-page language switcher (`page.tsx:167`) keeps emitting `?lang=`. Correct — the budget
  applies to the SMS, not to a link tapped on a page the rider already has open.
- **VALIDATE**: `pnpm --filter @taxi/dispatch build`, then the test below and Level 4 step 3.
- **SATISFIES**: AC #1

### CREATE `apps/dispatch/src/app/t/tracking-rewrites.test.ts`

- **IMPLEMENT**: the api↔dispatch round trip, minus Next's own matcher. For every `Language`:
  build a real link with `trackingLink('https://sakta.lv', 't'.repeat(16), lang)` from `@taxi/shared`,
  take its path (`link.slice('sakta.lv'.length)`), then
  - for `lv`: assert **no** rewrite source matches it, **and** that
    `apps/dispatch/src/app/t/[token]/page.tsx` exists on disk (`node:fs.existsSync`) — the lv path is
    served by a real route, and this is what proves it;
  - for every other language: assert **exactly one** rewrite whose `source`, converted to a regex
    (`:token` → `[^/]+`), matches the path, and whose `destination` carries `lang=<that language>`.

  Also assert the rewrite list has no entry for a language not in `LANGUAGES`.
- **PATTERN**: `apps/dispatch/src/features/override/assign-state.test.ts` — plain vitest over a pure value.
- **GOTCHA**: `rewrites()` may return an array or `{ beforeFiles, afterFiles, fallback }`. Handle the array
  form the config actually returns and assert the shape, so a later switch to the object form fails loudly
  rather than silently matching nothing.
- **GOTCHA**: this test is what closes the api↔dispatch gap, and it closes it **because** `trackingLink`
  moved into `@taxi/shared`. It could not be written while the function lived in `services/api` — apps do
  not import the api. What remains untested is Next's `:param` matching, which is library behaviour.
- **GOTCHA**: **file-filter trap** — `pnpm --filter @taxi/dispatch test -- <name>` silently runs all 28
  files. Target one with `npx vitest run --root apps/dispatch src/app/t/tracking-rewrites.test.ts`.
- **VALIDATE**: `npx vitest run --root apps/dispatch src/app/t/tracking-rewrites.test.ts`
- **SATISFIES**: AC #1, AC #3 — and it is what closes the api↔dispatch gap

### UPDATE the dispatch 22-char fixtures

- **IMPLEMENT**: `apps/dispatch/src/features/tracking/tracking-live.test.tsx:26` `TOKEN` → 16 chars and its
  comment; check `tracking-page.test.tsx:98` (it asserts a `?lang=ru` switcher href — that is the in-page
  switcher and stays) and any other token fixture the grep finds.
- **VALIDATE**: `npx vitest run --root apps/dispatch src/features/tracking`
- **SATISFIES**: AC #3

### UPDATE `docs/research/hosting-sms-cost-research.md`

- **IMPLEMENT**: §4.2 lines 193 and 198 (22 chars → 16, and `~44-character link` → the new arithmetic);
  §4.3's lever-2 table and its three numbered changes — add change 4 and **state the correction
  explicitly** rather than editing the 59 silently: the RU row's 59 omitted the `?lang=ru` that
  `trackingLink()` appended, the corrected worst case is this plan's budget table, and the fix is the path
  segment. Keep every label accurate — the new rows are `derived`, not `observed`; no segmenter run
  produced them, the AC #1 test does.
- **PATTERN**: CLAUDE.md — retire the **subject**, not the digits. Grep `22`, `?lang`, `44-character`,
  `saktacab` across the doc.
- **GOTCHA**: this doc is the origin of #13's and #135's figures too. Do not touch §5 or the lever-1 row.
- **VALIDATE**: `grep -n "22 base64url\|22-char\|44-character" docs/research/hosting-sms-cost-research.md`
  → **NOT empty, and it must not be.** Stating the correction rather than overwriting the 59 requires the
  figures it corrects to stay visible. Every surviving hit must be past-tense or explicitly labelled
  pre-#136 — read them, do not count them. `observed`: 3 hits, all in the baseline narrative.
- **SATISFIES**: AC #5

### UPDATE `docs/runbooks/hetzner-deploy.md`

- **IMPLEMENT**: the `PUBLIC_TRACKING_BASE_URL` env row (line 215) gains the ≤10-character host constraint
  and why; the boot-gate failure table (line 711) gains a row for the new refusal message. Line 238's
  example (`https://dispatch.example.lv`, host 19) now refuses to boot — replace it.
- **IMPLEMENT (third edit, not in this plan's first draft)**: the dotenv template's neighbouring
  `CORS_ORIGINS=https://dispatch.example.lv` too, and §2.2's prose. `PUBLIC_TRACKING_BASE_URL` **IS** the
  dispatch app's own public origin (§2.2, `env.schema.ts:306`), so leaving the two on different domains
  tells a reader to point SMS links at a host the dispatch app is not served from. Say the consequence
  outright, because it is #13's to act on: **the 10-character gate constrains the dispatch app's domain**,
  not a separate tracking host.
- **GOTCHA**: this runbook is the only copy of the deploy procedure. Read the surrounding rows and match
  their column style exactly.
- **VALIDATE**: `grep -n "TRACKING" docs/runbooks/hetzner-deploy.md` and read every hit.
- **SATISFIES**: AC #5

---

## TESTING STRATEGY

### Unit Tests

- `packages/shared`: the segmenter (7 cases), the link builder (6), the budget proof (6), the amended token
  and i18n tests.
- `services/api`: `sms-templates.spec.ts` (5, including the `smsDriverName` bound), the amended
  `ride-notifications` cases plus the clamp and the multi-segment assertion, the env-schema pair.
- `apps/dispatch`: the minted-link → rewrite round trip.

### Integration Tests

**No new integration test, and this is a deliberate call.** Nothing here touches a socket, a room join or
`features/realtime`, so the #16 rule forcing a delivery-ordered integration test does not apply. The
existing `tracking.integration.spec.ts` already exercises mint → store → `GET /track/:token` end to end;
its token-shape assertion at line 282 moves to 16 and that path is what proves a 12-byte token still
round-trips through Postgres and the rate limiter. Run the whole file, not just that case.

### Edge Cases

| Edge case | Verified where |
|---|---|
| Driver first name over 10 chars (`Konstantīns`) | `sms-templates.spec.ts` — returns `'K.'`; the budget therefore holds |
| Driver name at the schema ceiling (120 chars) | `sms-templates.spec.ts` — the length bound assertion |
| Name whose first character is a surrogate pair | `sms-templates.spec.ts` — `[...first][0]`, no lone surrogate |
| Plate at the schema ceiling (10) | `sms-budget.test.ts` — it is the budgeted value |
| No vehicle → plate `'—'`, no position → `eta: '?'` | Existing `ride-notifications.service.spec.ts` cases; both 1 char, strictly cheaper |
| ETA over 99 minutes | `ride-notifications.service.spec.ts` — clamped to `~99 min` |
| Driver with no name → `'—'` | `sms-templates.spec.ts` |
| A 22-char token arriving after the cut-over | `packages/shared/tests/tracking.test.ts` — asserts rejection |
| `baseUrl` with a trailing slash or `http://` | `tracking-link.test.ts` |
| A path value longer than 1 character | `tracking-link.test.ts` — the budget's path term |
| Production boot with an 11-char host | env-schema spec |
| `/r/<token>` reaching the page **and** the island's poll continuing | Level 4 step 3 **only**. `tracking-rewrites.test.ts` pins the api's link shape to the rewrite table; Next's own `:param` matching and the running server are not covered by any test. Do not read the green config test as coverage of the runtime. |
| A bare `sakta.lv/r/…` linkifying in a real SMS client | **Phase 0**, before any code. Nothing in the tree can test it; the fallback is written into the spike's DECISION. |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm turbo run typecheck lint --force
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
npx vitest run --root apps/dispatch src/app/t src/features/tracking
```

### Level 3: Integration Tests

```bash
docker compose up -d --wait
COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test
```

Then the gate (CI parity, one at a time across sessions):

```bash
COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
```

Expect `39 skipped` in `@taxi/api` without `REDIS_TEST_URL` — re-observe the count rather than inheriting
it; the baseline is `39 skipped, 694 passed, 733 total` at `0cdb59c`, and this ticket adds api cases.

### Level 4: Manual Validation

Phase 0 has already answered the linkification question. These three confirm the shipped code behaves the
way the spike's message did. All are performable with what this ticket ships plus the existing dev stack:
`services/api/scripts/mint-tracked-ride.ts` produces the booked phone-channel ride steps 1–3 need (read
its usage header first) — **no new script is owed**.

1. **The rendered body, measured.** Boot the api against local compose with
   `PUBLIC_TRACKING_BASE_URL=http://sakta.lv` and the stub SMS provider. Run `mint-tracked-ride.ts` for a
   `phone`-channel ride with a Russian-language rider, drive it to `accepted`, and read the
   `ride.notifications.sms_sent` line and the stub provider's logged body. **Expected**: the body contains
   `sakta.lv/r/` and a 16-char token, no `https://`, no `?lang=`. Count it:
   `node -e "const {smsSegments}=require('./packages/shared/dist');console.log(smsSegments(process.argv[1]))" '<body>'`
   → `1`.
2. **The bounds hold at runtime.** Re-run with the driver's `display_name` set to `Konstantīns Bērziņš`
   and the driver's position ~60 km from pickup. **Expected**: the body reads `Šoferis K., …, ~99 min …`,
   `smsSegments` → 1, and **no** `ride.notifications.sms_multi_segment` line. That absence is the point —
   the warn is an assertion, and it firing here would mean the budget is wrong.
3. **The rewrite serves the page.** `pnpm --filter @taxi/dispatch dev`, open
   `http://localhost:3000/r/<the token from step 1>`. **Expected**: the page renders in Russian, the browser
   URL stays `/r/<token>` (no redirect), and the position timestamp advances — proving the island's
   `/t/<token>/data` poll still resolves. Watch the network tab for that request specifically; a 404 there
   is the failure mode that still looks like a working page.

### Level 5: Additional Validation (Optional)

`grep -rn "22\b" --include="*.ts" --include="*.tsx" --include="*.md" . | grep -v node_modules | grep -v "/dist/" | grep -iE "token|base64url|char"`
— the noun-grep CLAUDE.md asks for; run it last, after the docs edits. **It does not come back empty and
should not be driven to empty.** The pattern is broad enough to catch `22/80/443` firewall ports, a `22:21`
timestamp, `CX22`, `2022–2026`, and `at 22 chars the OTP is 1 segment` in `bulkgate-sms.provider.ts`
(that is `sms.otp_code`'s own length, which this ticket does not touch). **Read every hit and triage it**;
the AC is "nothing live and wrong survives", not "the grep prints nothing".

---

## ACCEPTANCE CRITERIA

- [x] **AC #0** (Phase 0) — **MET on two substitute oracles, not on a handset.** Leg (a) is the only leg
      the branch point turns on, and it is `observed`: a bare `sakta.lv/r/…` linkifies, is tappable and
      opens the right URL in **Google Messages** on an Android 16 emulator, and is detected by
      **`NSDataDetector`**, the class iOS builds its link detection on. The branch that result dictates is
      the one already taken, so no shipped line changed. Leg (b) (glyphs) is weakly answered and leg (c)
      (a vendor's own `num_segments`) is not answered at all — neither gates the branch. Evidence, and
      what it does not cover: AMENDMENTS, 2026-09-21.
- [x] **AC #1** (issue AC 1) — MET, 7 cases green. `packages/shared/tests/sms-budget.test.ts` asserts
      1 billed segment **and an exact render length** for `sms.driver_assigned` and `sms.booking_confirmed_phone` in LV, RU and EN at
      the **maximum of every bound**, with the monotonicity argument written in the file. The test was
      proved to bite twice: once by restoring the old framing, once by widening
      `TRACKING_LINK_HOST_MAX_CHARS`. Both results recorded. **`observed` 2026-09-21**: bite 1 reddens
      the LV row only, on the LENGTH assertion (`length of 69 but got 85`); bite 2 reddens **all 7**, every
      one on length — and at host 11 five of the six bodies still bill one segment, so a segment-only
      test would have caught one row in six.
- [x] **AC #2** (issue AC 2) — MET, premise re-verified 2026-09-21 (both queries re-run this session).
      The token cut-over is documented. `observed` 2026-09-21: the `Deploy`
      workflow has **zero runs** (`gh run list --workflow=deploy.yml` → empty; the workflow exists, so the
      query is not vacuous) and #13 is OPEN with its `/health`-200 criterion unmet, so the set of live
      22-char links is empty and a hard cut is safe. Tokens are per-ride and a ride's page expires
      `TRACKING_TERMINAL_GRACE_SECONDS` after it ends. **If #13 deploys before this merges**, this becomes
      wrong: fall back to `/^[A-Za-z0-9_-]{16}$|^[A-Za-z0-9_-]{22}$/` and file the removal ticket.
- [x] **AC #3** (issue AC 3) — MET. `trackingTokenSchema` ships at 16 with tests in `@taxi/shared`, and
      every consumer is checked: the api tracking service + 3 specs + the policy comment, the dispatch
      `/t/[token]/data` route + 2 test fixtures, the research doc. Level 5's grep is **triaged, not
      empty** — see that step for why driving it to empty would be the wrong outcome.
- [x] **AC #4** — MET. The 1-segment property is **total**, not sampled: `smsDriverName` bounds the name
      (asserted against a 120-char input), the ETA is clamped, the plate is bounded by `vehicleSchema`, and
      the host by the boot gate. `ride.notifications.sms_multi_segment` exists as the assertion that this
      reasoning is right, and does not gate the send.
- [x] **AC #5** — MET. Research §4.2–4.3 and the Hetzner runbook carry the corrected figures, with the
      `?lang=ru` omission named rather than quietly overwritten. The runbook took a third edit the plan
      had not listed — see that task.
- [x] Production boot refuses a `PUBLIC_TRACKING_BASE_URL` host over 10 characters, with a message naming
      the reason; dev and CI on `localhost:3000` are unaffected.
- [x] `pnpm turbo run typecheck lint test build --force` green. **Re-observed at `5e515a1`** after PR
      #245's review round 1 added tests, which staled the first figures here: 22 successful / 22 total,
      0 cached, exit 0, 1m31.041s; `@taxi/api` 786 passed, 786 total, nothing skipped (this run sets
      `REDIS_TEST_URL`, as CI does — the earlier `39 skipped, 746 passed, 785 total` was a run without it,
      and 746 + 39 + 1 new case = 786).
- [ ] Level 4 steps 1–3 performed and recorded. **PARTIAL — step 3 only.** It ran by `curl` against
      `next dev` rather than a browser: `/r/<token>` returns 200 with an empty `redirect_url` (a rewrite,
      not a redirect), renders Russian, and `/t/<token>/data` resolves from that URL. **Steps 1–2 were not
      run** — they need the API booted and `mint-tracked-ride.ts` driving a ride to `accepted`; what they
      add over `ride-notifications.service.spec.ts` is the repository-row wiring. The measurement half is
      covered by four bodies rendered through the built `dist`; see the report's Level 4 table.

---

## COMPLETION CHECKLIST

- [ ] Phase 0 ran and its result is in AMENDMENTS **before** any catalog string moved — **NO, and this
      one stays unticked.** It ran after every catalog string had moved, and on substitute oracles. It
      confirmed the branch already taken, so nothing was rebuilt — had it gone the other way, the cost
      would have been fallback C rather than a rewrite
- [x] All tasks completed in order
- [x] Each task validation passed immediately
- [x] `packages/shared` rebuilt before any downstream run — **and its exports resolved from `dist` at
      runtime**, because the plan's `dist` grep recipe reads an `export *` barrel and returns 0
- [x] All validation commands executed successfully — with the two greps read rather than driven to
      empty (Level 5, and the research doc's)
- [x] Full test suite passes (unit + integration) — `tracking.integration.spec.ts` is NOT Redis-gated and
      ran: 13 passed, so the 16-char token round-trips through real Postgres
- [x] No linting or type checking errors
- [ ] Manual testing confirms feature works — **Level 4 step 3 only** (by `curl`, not a browser); steps
      1–2 not run
- [ ] Acceptance criteria all met — **9 of 10**; AC #0 closed on substitute oracles, the Level 4 line is open
- [ ] Every figure in the PR body re-derived from the working tree, not copied from this plan — for
      `piv-create-pr`. The three base test counts (231 shared / 264 dispatch / 733 api) are `derived`
      from per-file `it(` counts against `origin/main`; keep the label on them, and put no numstat size
      table in the body — the commit that lands it moves the numbers it quotes.

---

## OPEN QUESTIONS / ASSUMPTIONS

Every question that threatened one-pass implementation has been closed. What remains is one deployment
dependency and two reversible calls, both now forced by arithmetic rather than taste.

**A1 — `sakta.lv` (8) is the domain #13 buys.** This is a *deployment* dependency, not an implementation
one: the budget test uses a synthetic 10-character host and the boot gate enforces the ceiling, so nothing
in this ticket waits on the purchase. If #13 has committed to something longer, the gate refuses the deploy
with a message naming the limit — which is the intended failure, and the budget table shows which row
breaks first (RU `driver_assigned`, at zero spare).

**A2 — bare `host.tld/path` linkifies. CLOSED by Phase 0 — after the code rather than before it, and on
substitute oracles rather than a handset (AMENDMENTS, 2026-09-21).** Industry SMS guidance treats
scheme-less branded links (`acme.co/bf30`) as the normal form and carriers prefer them to shorteners, but
that is guidance, not a client-behaviour observation, so the spike is the evidence. If it fails, fallback C
keeps changes 1, 2 and 4 and the `booking_confirmed_phone` trim — the saving halves from 258 to 129
segments/mo rather than vanishing.

**A3 — the driver-name bound. CLOSED.** Was the plan's largest hole: `users.display_name` is `text` and
`userSchema.displayName` is `.max(120)`, so a budgeted test proved nothing about real inputs.
`smsDriverName()` now bounds it — the first name when it fits, `<initial>.` when it does not. With the ETA
clamp, the plate schema bound and the host boot gate, **every** term in the render is bounded and the
1-segment property is a proof over all inputs, not a sample at chosen ones.

**Q1 — should the host-length gate refuse boot, or only warn? DECIDED: refuse.** It mirrors the localhost
check beside it, and a boot warn is a warn nobody reads while the whole ticket is a cost control. The cost
of being wrong is asymmetric but recoverable: a too-long domain blocks a deploy with a message saying
exactly what to do. One-line reversal if that trade reads wrong in review.

**Q2 — #135 (lever 1) and this ticket, in either order.** Neither blocks the other. Worst case is a **merge
conflict in `ride-notifications.service.ts`**, not a behavioural one: #135 edits the send condition at
lines 63–68, this routes lines 70–76 through `sendSms`. Adjacent hunks in the same method. Whichever lands
second rebases and re-runs the api suite.

**Q3 — `/r/` or `/ru/`? DECIDED by arithmetic: `/r/`.** `/ru/` costs 1 character, which at the host ceiling
of 10 puts RU `driver_assigned` at **71 > 70** — it works only if the host is ≤9, and the gate permits 10.
Single-character paths are the only ones that hold at the budget the gate enforces, which is why
`tracking-link.test.ts` asserts every value is exactly 1 character.

---

## NOTES (open canvas)

### Rejected alternatives for getting the language out of the SMS URL

The correction above establishes that `?lang=ru` (8 characters) must go. The RU `driver_assigned`
arithmetic at the bounds (fixed 19 + name 10 + plate 10 + eta 2 = 41, plus host 10 and token 16 = 67
before the path segment, against a 70 limit — so **3 characters** are left for the path and any marker):

| Option | Path + marker | RU total | Verdict |
|---|---|---|---|
| Keep `?lang=ru` | `/t/` + 8 = 11 | **78** | Fails by 8. The status quo. |
| Shorten to `?l=ru` | `/t/` + 5 = 8 | **75** | Fails by 5. |
| Valueless `?ru` | `/t/` + 3 = 6 | **73** | Fails by 3. The near miss that looks like it works. |
| `/t/ru/<token>` catch-all | 6 | **73** | Fails by 3. |
| `/ru/<token>` rewrite | 4 | **71** | Fails by 1 — see Q3. |
| **`/r/<token>` rewrite** | 3 | **70** | **Chosen** — 0 characters over today's `/t/`. |
| `language` in `trackingViewSchema` | 3 | **70** | Rejected — see below. |

The last two are arithmetically identical, which is what settles it: the contract change buys nothing.

**Why not add `language` to `trackingViewSchema`.** It was the first answer and it is wrong here:

1. `packages/shared/src/schemas/tracking.ts:41-45` states the invariant in so many words: *"Deliberately
   exposes NO rider PII: driver, vehicle, position, ETA and the dispatch phone are the whole payload."* A
   rider's language preference is a rider attribute. A ticket scoped to "trim two strings and shorten a
   token" is not the ticket that amends a deliberate privacy boundary on a shared wire contract.
2. It has a tail costed at zero. `generateMetadata` (`page.tsx:34-41`) reads the language from
   `searchParams` **before** any fetch. Either the tab title renders `lv` while the body renders `ru`, or a
   second `cache: 'no-store'` fetch is added per page load. Neither is in the ticket.
3. It spans five files across three packages to buy the same 3 characters two lines of `next.config.ts`
   buy.

### Why the scheme goes, and what happens if it cannot

`https://` is 8 of 70 UCS-2 characters — 11% of the budget for information every SMS client infers.
Research §4.3 hedged ("either drop the scheme, or keep it only with both the short domain and the short
token"); at the bounds that hedge is already decided — with **both** changes and `https://`, RU is 78.
There is no configuration where the scheme survives on `driver_assigned`.

**If the scheme has to come back (fallback C).** `derived`, at the host ceiling: `booking_confirmed_phone`
is 59 LV / 55 RU / 50 EN, so `+8` leaves 67 / 63 / 58 — **all still 1 segment**. Only `driver_assigned`
fails. So a negative Phase 0 result costs the `driver_assigned` half of the ticket and keeps the rest:
129 segments/mo saved instead of 258, €41.89 → €37.88 instead of €33.87 (`derived`, same €0.03110/segment).
Changes 1, 2 and 4 all still ship — the short token and the path segment are what make the *remaining*
headroom real, and they cost nothing to keep.

### Why the segmenter and the link builder ship rather than living in tests

The AC only needs a test, and test-only helpers would be uncapped by `max-lines` and invisible to
consumers. But the runtime assertion needs the counter, and the dispatch round-trip test needs the link
builder — a test in `apps/dispatch` cannot import from `services/api`. Moving `trackingLink` into
`@taxi/shared` is what turns R3 from "two halves nobody compares" into one pinned contract, and it is
where CLAUDE.md puts a cross-surface contract anyway. ~100 lines across two modules, zero dependencies, in
a package that already ships `money.ts` and `commission.ts` for the same reason.

### What this ticket deliberately does not measure

The saving is `derived` from research §4.3's assumptions (430 rides/mo, 30% phone-booked, ~100 OTPs), and
two of those three have no evidence behind them — the doc says so itself. Nothing becomes `observed` until
a real month bills. The honest claim after merge is *"both linked templates render one segment at every
bound"* (`observed`, from the test), not *"the SMS bill fell 35%"*.

### Sequencing note

Phase 0 exists because A2 was the only irreducible risk and it is answerable in ten minutes with hardware
that already exists — so it runs before four surfaces change, not after. Phase 1 lands the segmenter before
any catalog string moves, which is what turns this plan's budget table from prose into an executable claim.
That ordering is the difference between these figures and #107's.

## AMENDMENTS

- 2026-09-21 — created.
- 2026-09-21 — risk pass before implementation. Added Phase 0 (linkification spike + fallback C) closing
  A2; `smsDriverName()` and the ETA clamp closing A3, which makes the 1-segment property a proof over all
  inputs rather than a sample; moved `trackingLink()` into `@taxi/shared` so the api↔dispatch round trip is
  testable, closing R3; decided Q1 (refuse) and Q3 (`/r/`, forced by the host ceiling). Budget table
  recomputed at the host ceiling of 10 rather than at `sakta.lv`'s 8 — RU `driver_assigned` is 70 with
  zero spare by construction, 68 at the real domain.
- 2026-09-21 — **SUPERSEDED by the final entry: Phase 0 ran the same day, on substitute oracles, and
  confirmed this branch. Kept because its reasoning — why the build did not block on it — still stands.**
  **Phase 0 NOT RUN. Implemented on the A2 branch (scheme dropped) under a stated
  assumption, not on evidence.** The spike needs a verified handset and a person looking at it; neither is
  available to an agent session. **AC #0 is UNMET** and is Linards' to close — the two `curl` bodies are in
  the SPIKE task above, unchanged, and both render correctly against the shipped catalogs (see the
  implementation report's Level 4 table for the four real bodies at `sakta.lv`).

  **Why this did not block the build.** Phase 0's only branch point is whether `trackingLink()` keeps
  `https://`. Everything else in the plan ships on either branch, so a negative result costs one line, not
  a rewrite: restore the scheme in `packages/shared/src/tracking-link.ts` (`trackingLinkHost` stops
  stripping it, or the template re-adds it), drop the two `driver_assigned` rows from
  `sms-budget.test.ts`'s `EXPECTED_LENGTH`, and amend AC #1. `booking_confirmed_phone` stays 1 segment in
  all three languages with the scheme (`observed` through the built `dist` at the real 8-char host: LV
  57 + 8 = 65, RU 53 + 8 = 61, **EN 48 + 8 = 56** — all three, not the two this line used to name — all
  ≤ 70), so the saving drops to **129 segments/mo, worst case**, rather than vanishing.

  The arithmetic, since this line asserted the figure without it (PR #245 F10): as shipped the saving is
  2 linked templates × 1 segment × **129 phone rides/mo**, = 258; with the scheme back
  `booking_confirmed_phone` keeps its saving on all 129 rides and `driver_assigned` loses its own (LV 75
  / 2 seg, RU 76 / 2 seg, `observed`), so 129 × 1 + 129 × 0 = 129. **Worst case, not the only case**: EN
  `driver_assigned` renders 74 characters with the scheme and stays 1 segment on GSM-7's 160 septets, so
  the true figure sits between 129 and 258 on a language mix nothing here predicts. The 129 rides/mo is
  `derived` in research §4.3 from a 30% phone-booked share **which §4.3 itself labels evidence-free**;
  everything above inherits that.

  **What to run before merging.** The `curl` pair against a verified number; check (a) tappable, (b) glyphs
  not `?????`, (c) `num_segments` = 1 — and cross-check (c) against `smsSegments()`, which now says 1 for
  every body in the Level 4 table. Record the handset(s) used: iOS Messages and Google Messages linkify
  differently, so one handset makes the claim about that client, not about "SMS clients".

- 2026-09-21 — **implementation pass; the plan above was edited in place where it had become wrong.** Five
  task lines now differ from the draft and each says why at the point of use: `trackingLinkHost` is
  exported rather than inlined (the boot gate must measure what the link builder emits); the `dist` grep
  recipe returns 0 on a correct build and was replaced by a runtime resolve; `env.schema.spec.ts`'s
  `prod()` fixture host had to move, which touches every production case in that file, and the gate task
  gained a third case and lost a fourth as redundant; the runbook took a third edit
  (`CORS_ORIGINS` + §2.2, because the tracking base URL **is** the dispatch origin and the 10-character
  ceiling therefore constrains #13's domain choice); and both the research §4.3 and the Level 5 greps are
  documented as **not** empty, because stating a correction requires the figures it corrects to stay
  visible and the Level 5 pattern catches firewall ports and years.

  Two counts came in one over the plan: `sms-budget.test.ts` ships **7** cases (the six table rows plus an
  explicit zero-spare RU edge) and `sms-templates.spec.ts` ships **6** against the TESTING STRATEGY's 5
  (`driverFirstName`'s untruncated-for-the-page case is its own). `sms-segments.test.ts` ships **6**
  against 7 — see its task. `scripts/mint-tracked-ride.ts` was read as the task asked: it prints
  `${token.length} chars` and asserts no length, so it needed no edit.

  Full deviation list, with the reasoning for each:
  `.claude/reports/short-tracking-links-sms-136-report.md` → *Deviations from the plan* (D1–D9).

- 2026-09-21 — **Phase 0 RAN — after the code, not before it, and on two substitute oracles instead of a
  handset. The bare link linkifies; the branch already taken is the branch the evidence dictates, so no
  shipped line changed.** AC #0's leg (a) is closed; legs (b) and (c) are not, and are named below.

  **Oracle 1 — Google Messages, Android 16 emulator.** AVD `sakta224` (API 36 `google_apis` x86_64, the SDK
  [#224](https://github.com/linardsb/taxi/issues/224) installed), build `sdk_gphone64_x86_64:16/BE2A.250530.026.F3`,
  default SMS app `com.google.android.apps.messaging`. Each body injected with `adb emu sms send` — no SMS
  account, no credit, no carrier — then opened in the thread and tapped. `observed` 2026-09-21:

  | body (token `Ab3-_xYz01234567`, host `sakta.lv`) | rendered as | tap produced |
  |---|---|---|
  | EN `Driver Aleksandrs, ABCD-12345, ~99 min sakta.lv/e/…` | underlined link | `capturedLink=https://sakta.lv/e/Ab3-_xYz01234567` |
  | LV `Šoferis …, ABCD-12345, ~99 min sakta.lv/t/…` | `Š` correct, underlined link | `capturedLink=https://sakta.lv/t/Ab3-_xYz01234567` |
  | RU `Водитель …, ABCD-12345, ~99 мин sakta.lv/r/…` | Cyrillic correct, underlined link | `capturedLink=https://sakta.lv/r/Ab3-_xYz01234567` |

  **The tap is the evidence, not the underline.** Each of the three produced
  `ActivityTaskManager: START … act=android.intent.action.VIEW dat=https://sakta.lv/… cmp=com.android.chrome/…`
  in `logcat`, and Chrome came to the foreground. Messages also attached a link-preview card to all three
  (visible in each bubble), which is consistent with it having parsed a URL out of the body — but that is
  an inference about Bugle's internals, not something this run isolated. The tap carries the argument.

  **Oracle 2 — `NSDataDetector(.link)` on macOS 15.7.3 Foundation**, the class iOS's link detection is
  built on (`swift` one-shot, `observed` 2026-09-21). All six shipped bodies — `driver_assigned` and
  `booking_confirmed_phone` × LV/RU/EN — return exactly one link match, spanning `sakta.lv/<path>/<token>`.
  Two controls behave: the same body with `https://` restored matches the same span, and a bare `sakta.lv`
  matches on its own. Its UTF-16 lengths re-measure the report's Level 4 table independently at the real
  8-character host — `driver_assigned` LV 67 / RU 68 / EN 66, `booking_confirmed_phone` LV 57 / RU 53 /
  EN 48 — the same six numbers, arrived at by a different route.

  **What the substitutes do NOT close.** Leg (b), glyph fidelity, is weak evidence only: the emulator
  console builds the PDU itself, so a correct `Š` and correct Cyrillic there is not a carrier's UCS-2 round
  trip. Leg (c) is not answered at all — a vendor's own `num_segments` needs a funded account, and this
  tree has no SMS provider credentials; `smsSegments()` therefore still has no independent oracle, and the
  in-tree counts stand on `sms-segments.test.ts` plus PR #245's re-derivation. Both are cheaper to pick up
  on [#137](https://github.com/linardsb/taxi/issues/137)'s bake-off day, which needs a funded account and
  three LV SIMs anyway, than to block this ticket on. The emulator image is also missing
  `libtextclassifier3_jni_*.so`, so what linkified was Messages' fallback path rather than the on-device
  smart-linkify model — a real phone carries the model on top of that path, not instead of it.

  **One consequence, and it belongs to [#13](https://github.com/linardsb/taxi/issues/13).** The two clients
  disagree about the scheme they infer: Google Messages navigates to **`https://`**, Foundation resolves to
  **`http://`**. Whatever ends up serving `sakta.lv` must therefore answer port 80 with a redirect, or an
  iOS-side tap lands on a dead port. `Caddyfile` today has exactly one site block and it is the API's, so
  nothing serves the tracking host yet — that wiring is #13's, not this ticket's.
