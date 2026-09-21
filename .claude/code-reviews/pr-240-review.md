# PR #240 review — SMS bake-off instrument and two SmsProvider candidates (#137)

**Head** `248e066` · **Base** `main` @ `1c98ac8` · **Reviewed** 2026-09-21 · Round 1

**Recommendation: approve.** No critical or high issues. The gate is green, every figure in the PR
body reproduced against a run I did myself, and the two behaviours the plan called most likely to
break silently are both correctly implemented *and* pinned by tests that fail when reverted — I ran
one of those reverts. Fourteen findings below: seven Medium, seven Low, none blocking — every one
of the seven Mediums is documentation, an error message, a figure or test strength, not shipped
correctness.

The base has **not** moved. `git fetch origin && git rev-parse origin/main` → `1c98ac8`, the same sha
the PR records. First round, so the guarantees pass does not apply.

---

## Validation

`observed` — `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` in
`/Users/Berzins/taxi-worktrees/wt-137` at `248e066`, exit 0, `1m30.649s`:

| Package | Result | Matches PR body |
|---|---|---|
| Tasks | 22 successful, 22 total · 0 cached | ✅ |
| `@taxi/api` | Suites 2 skipped, 77 passed, 77 of 79 · Tests 39 skipped, 719 passed, 758 total | ✅ |
| `@taxi/dispatch` | 28 files, 264 tests | ✅ |
| `@taxi/driver` | 44 suites, 250 tests | ✅ |
| `@taxi/rider` | 30 suites, 145 tests | ✅ |
| `@taxi/shared` | 24 files, 231 tests | ✅ |
| `@taxi/db` | 3 files, 17 tests | ✅ |
| Lint | 0 errors, 12 warnings | ✅ |

CI agrees: `check`, `audit-diff`, `codeql`, `CodeQL` and `ready` all green.

Run without `REDIS_TEST_URL`, which is why 39 are skipped — the documented gated set, unchanged at
both ends of this diff.

---

## The numbers pass

Every figure in the PR body and the implementation report was re-derived. One is wrong (**F2**);
one sentence misdescribes a matrix whose arithmetic is right (**F4**). Everything else holds.

| Claim | How it was checked | Verdict |
|---|---|---|
| Gate figures — 22 tasks, seven packages' counts | re-ran the gate at `248e066` | ✅ exact |
| Lint "0 errors, 12 warnings, all pre-existing `no-unsafe-argument` on integration specs" | classified all 12 from the gate log: every one is `@typescript-eslint/no-unsafe-argument`, every one on an `*.integration.spec.ts`, none in a file this PR touches | ✅ |
| Baseline `694 passed / 733 total` at `1c98ac8` | not re-run, but discharged without one: `0cdb59c` (CLAUDE.md's recorded observation) **is** an ancestor of `1c98ac8`, and `git diff --name-only 0cdb59c..1c98ac8 -- 'services/api/**/*.spec.ts'` returns **zero files**, so the count cannot have moved | ✅ inherits validly |
| Delta "+25 tests, +2 suites = 8 + 7 + 3 + 7" | counted `it(` per file: bulkgate 8, budgetsms 7, auth.module +3, env.schema +7 | ✅ |
| Size table, six buckets → +3010 / −60 | against `git diff --numstat 1c98ac8..248e066`. Note the "api source" bucket silently also carries `package.json`'s +1 (580 + 1 = 581) | ✅ |
| Spend `33 segments/provider`, `€4.33–€4.87` | 3 × (3 + 6 + 2) = 33; 1.0263 + 1.485 + 1.8150 = 4.3263 and + 2.3595 = 4.8708 — derived from **unrounded** components, which is why it is 4.33 and not 4.34 | ✅ |
| Line counts 351 / 264 / 149 / 112 / 574, and "`env.schema.ts` was 395" | `wc -l`, and `git show 1c98ac8:…/env.schema.ts \| wc -l` = 395 | ✅ |
| Script `max-lines`-exempt "by two separate mechanisms" | `packages/config/eslint/base.mjs:47-57` (`**/scripts/**` → `max-lines: off`) and `services/api/tsconfig.build.json:3` (`exclude: […, "scripts", …]`) | ✅ both real |
| D4 "the scorecard diff is empty" | ran the plan's own command at `:485` — empty | ✅ |
| "Six pins were probed" | spot-probed the one the plan calls the single most likely bug: reverted the `ERR`-on-200 check to `if (!res.ok)`, ran the suite → **`2 failed, 5 passed, 7 total`**, exactly the report's row. Restored; `git status` clean | ✅ reproduced |
| Level 4 steps 1–2, `--round 2`, `--testsms` | re-ran all four with dummy credentials. Step 1: usage naming all three `BAKEOFF_*`, exit 1. Step 2: the 9-row matrix, `GSM-7`/`UCS-2`/`UCS-2`, 45 segments total (15/provider), `DRY RUN — nothing was sent`. `--round 2` → 27 total (9/provider), RU dropped. `--testsms` → BudgetSMS only, both skips named. No credential in any output; recipients masked | ✅ |
| "A fourth round costs another ~€1.45" | re-derived — see **F2** | ❌ |

---

## Findings

### F1 (Medium) — the scorecard structurally excludes the OTP-in-URL risk from its own verdict

`docs/research/sms-bakeoff-scorecard.md:35` — row 16, *"Credentials + body travel in the URL —
**yes — GET only**"* — sits under the header at `:24`: *"Informational rows — context, never the
deciding vote"*. That header is what excludes it. The Verdict's gate is "switch to a candidate only
if it matches Twilio on rows 1–7 and row 8 is legible", so row 16 cannot reach the decision by
construction, not by an oversight in a list.

**Failure scenario**: BudgetSMS goes 3/3 on delivery, keeps `SaktaCab`, keeps the diacritics and
wins row 12 on price. The prescribed verdict is "Switch to BudgetSMS" — and the fact that every
OTP, which *is* the sign-in credential, plus the `handle` API secret land in BudgetSMS's access
logs and at every TLS-terminating hop never enters the decision at all.

`budgetsms.provider.ts:71-74` scored the risk honestly. The scorecard then put it in the table that
cannot vote. Since the scorecard is the artefact that will actually make the vendor decision, that
is the one place the exclusion matters.

**Fix**: a Verdict bullet naming row 16 — either disqualifying, or an accepted risk with the reason
and a compensating control written down (shorter OTP TTL, or BudgetSMS bound for notification SMS
and never for OTP).

---

### F2 (Medium) — "A fourth costs another ~€1.45" is wrong, and unlabelled

`services/api/scripts/sms-bakeoff.ts:75`.

The RU probe is `onlyRound: 1` (`:269`), so a fourth round is OTP (1 seg) + LV `driver_assigned`
(2 seg) = 3 segments × 3 operators = **9 segments per provider**, not the 11 you get from averaging
33/3. At §4.1's rates: BulkGate 9 × €0.0311 = €0.28; BudgetSMS 9 × €0.045 = €0.41; Twilio
9 × $0.0715 = $0.64 → €0.50 at FX 1.3, €0.64 at FX 1.0. **Total €1.18–€1.33.**

`~€1.45` is 33/3 — the three-round total divided by three, which silently re-adds the RU probe. It
also carries no provenance label and no FX case, in a docblock where the paragraph ten lines above
does both correctly.

**Checked for propagation**: it has not spread. The plan (`:600-604`), the implementation report
(`:116-118`) and the PR body all carry the correct 33-segment / €4.33–€4.87 derivation. This one
line is the only instance.

**Fix**: "A fourth costs another €1.18–€1.33, `derived` — 9 segments each (OTP + LV only; the RU
probe is round-1-only) at §4.1's rates, EUR/USD 1.3–1.0."

---

### F3 (Medium) — the success-path leak pins miss the destination number, reproduced

`services/api/src/features/auth/sms/budgetsms.provider.spec.ts:78` and
`bulkgate-sms.provider.spec.ts:92` both assert `not.toContain('+37120000001')` — the **`+`
spelling**. BudgetSMS's wire form drops the `+` (`budgetsms.provider.ts:64`), and BulkGate's own
`ACCEPTED` fixture literally contains `number: '37120000001'`.

**Reproduced, not inferred.** I added `to: phoneE164.replace(/^\+/, '')` — the full unmasked
destination number — to BudgetSMS's success log line and re-ran its suite:
**`7 passed, 7 total`**, green. The pin whose name says "never the body" and whose comment claims
the masked phone does not catch a raw phone number in the same payload. Restored; `git status`
clean.

The error-path assertion at `budgetsms.provider.spec.ts:147` already gets this right
(`not.toContain('37120000001')`), so this is one character of consistency in two places.

**Fix**: drop the `+` from both success-path assertions.

---

### F4 (Medium) — the PR body describes a 27-send matrix; the script sends 21

PR body, *What changed*: "three probes … × three operators × three rounds".

`sms-bakeoff.ts:269` gives the RU probe `onlyRound: 1` and `:271` filters on it. `observed` from the
dry runs: round 1 prints 9 rows (15 segments/provider), round 2 prints 6 (9 segments/provider). So
it is 9 + 6 + 6 = **21 sends per provider, not 27**.

The PR body's own spend line already has this right — `3 × (3 + 6 + 2) = 33` bakes RU-once in — so
the sentence contradicts the arithmetic three paragraphs below it. The **script docblock and the
implementation report are both correct**; this is the PR body alone, which is the surface not in
the working tree and the one a reader reaches first.

**Fix**: "…× three rounds, with the RU probe in round 1 only — 21 sends per provider."

---

### F5 (Medium) — the production boot refusal names the vendor the operator did not fund

`services/api/src/features/auth/auth.module.ts:76`: *"Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
and `TWILIO_FROM_NUMBER` (#85)"*.

**Failure scenario**: an operator funds BulkGate, sets all three `BULKGATE_*` vars, forgets
`SMS_PROVIDER=bulkgate`, deploys with `NODE_ENV=production`. `SMS_PROVIDER` defaults to `'auto'`,
both new branches are skipped, the trio test fails, and the deploy dies pointing at Twilio.

This is the likeliest misconfiguration the PR introduces, precisely because its own premise is that
credential presence no longer selects. The comment at `auth.module.ts:33-35` — "**The production
refusal is unchanged**" — is true of the *condition* and no longer true of the message's *coverage*:
under `auto` there are now three ways out, not one.

**Fix**: extend the message with "…or set `SMS_PROVIDER=bulkgate|budgetsms` together with that
group's credentials (#137)", and add the case to `auth.module.spec.ts`: production + full
`BULKGATE_GROUP` + `SMS_PROVIDER: 'auto'` → throws.

---

### F6 (Medium) — `/testsms/`'s response shape is assumed in three places and sourced in none

`budgetsms.provider.ts:88` treats anything not starting with `OK ` — with the trailing space — as a
failure. Correct and well-argued for `/sendsms/`. `--testsms` reroutes the same parser at
`/testsms/` (`sms-bakeoff.ts:414`), and nothing in this PR sources that endpoint's reply:

- `budgetsms.provider.spec.ts:101` mocks it as `'OK 1234567 0.000 1'` — the **`/sendsms/` shape**,
  fabricated by the test, so the green case pins the URL override and nothing about the response.
- `sms-bakeoff-scorecard.md:68` (run sheet step 2) expects "`OK <id>` per handset".
- Every other vendor claim in this PR carries a spec citation (§2 for the `+` strip, §10 for the
  error list, V2.7 §2 for the free `ERR`). This one carries none.

**Failure scenario**: if `/testsms/` answers a bare `OK`, `startsWith('OK ')` is false,
`errorCode()` returns `undefined`, and every pre-flight row reads `budgetsms_error_200`. The runner
concludes their credentials are broken on the one step designed to prove they are not — and this is
the **only** step of the bake-off validatable for free, so it is the step most likely to be trusted
unverified.

**Fix**, either: cite the spec section for the `/testsms/` reply next to the mock; or
`if (text !== 'OK' && !text.startsWith('OK '))`, which leaves the `ERR`-on-200 pin intact.

---

### F7 (Medium) — `docs/runbooks/hetzner-deploy.md` is not updated

This PR adds a selector and seven env vars, and a **new boot-refusal condition**: `SMS_PROVIDER` set
to a kind whose group is incomplete fails `envSchema.parse`, which is a boot failure. Neither the
runbook's production env table (`:221-223`, today listing only the `TWILIO_*` trio) nor its
boot-refusal table (`:712`) mentions any of it.

The runbook records why this matters at `:699-702`: the seventh boot gate, `PUSH_PROVIDER`, "reached
`main` with #14 … and the rebase" missed it. Same shape.

Not in the plan's *Out of Scope*, so an undocumented gap rather than a deviation. Medium and not
High only because every new var is optional and defaults to pre-change behaviour, so no existing
deploy moves — which is exactly the property that makes it easy to forget later.

**Fix**: three rows in the env table (`SMS_PROVIDER` = `auto`, plus the two optional groups), one
row in the boot-refusal table.

---

### F8 (Low) — `SMS_PROVIDER` has two precedents in this repo, and picks the one whose hazard is documented

`sms-env.schema.ts:206`: `z.enum([...]).default('auto')`. `.default()` fires on `undefined` only, so
a blanked line (`SMS_PROVIDER=`) in a hand-edited env file refuses to boot in *every* environment
with a generic enum error.

Not a fresh-checkout trap — `.env.example:107` commits `SMS_PROVIDER=auto`, and a pre-#137 env file
has no line at all, so "no existing config moves" holds. The reason to raise it is that the repo
has **both** shapes, and the one it did not copy exists specifically for this:

- `env.schema.ts:263` `PUSH_PROVIDER: z.enum(['stub','expo']).default('stub')` — identical, shipped.
- `env.schema.ts:219` `ALLOW_STUB_MAPS_PROVIDER` wraps in
  `z.preprocess((v) => (v === '' ? undefined : v), …)`, with a comment naming this exact hazard:
  *"a blanked line in a hand-written env file delivers '', which would otherwise refuse to boot in
  EVERY environment with a generic enum message"*.

Pick one and apply it to both enums, or the inconsistency just moves. Also unpinned either way:
`env.schema.spec.ts`'s "the template commits all seven keys empty" case tests the seven *credential*
keys; `SMS_PROVIDER: ''` is not among them.

---

### F9 (Low) — `SmsCredentialKey` is hand-listed where the compiler could derive it

`sms-env.schema.ts:23-33` lists the ten keys that `smsEnvFields` (`:80`) declares again, with
nothing linking them. Because `SmsEnvValues` is `Partial<Record<SmsCredentialKey, string>>`,
renaming or dropping a key in `smsEnvFields` leaves the parsed env structurally assignable and the
group check silently stops covering it — no typecheck error.

**Fix, verified**: `type SmsCredentialKey = Exclude<keyof typeof smsEnvFields, 'SMS_PROVIDER'>;` —
I applied it and ran `npx tsc --noEmit -p tsconfig.json`: **exit 0, zero output**. No circularity
(type aliases are order-independent, and `smsEnvFields`' inferred type does not reference
`SMS_GROUPS`). Restored.

---

### F10 (Low) — `errorCode` does not enforce the guarantee its caller advertises

`budgetsms.provider.ts:109`. The comment at `:91` says "only the code crosses", but `errorCode`
returns `text.split(/\s+/)[1]` with no shape check, while both siblings validate what they extract
— `twilio-sms.provider.ts:87` (`typeof json.code === 'number'`) and `bulkgate-sms.provider.ts:145`
(`typeof json.type === 'string'`). Any HTTP-200 body beginning `ERR ` puts its second
whitespace-delimited token verbatim into `Error.message`, which `auth.service.ts` logs.

Low, not Medium: whitespace-splitting bounds the token to one word, so the realistic leak is
remote. The defect is a guarantee the file states and does not enforce, in the one provider whose
siblings both do.

**Fix**: `const code = text.split(/\s+/)[1]; return /^\d{1,6}$/.test(code ?? '') ? code : undefined;`

---

### F11 (Low) — the script re-implements `maskPhone`, and `BAKEOFF_*` shape is unchecked

`sms-bakeoff.ts:567` `maskRecipient` duplicates `services/api/src/features/auth/phone-mask.ts:5`.
They agree exactly on E.164 input (`+371*****001`) and diverge without the `+`:
`maskRecipient('37120000001')` → `3712*****001`, four leading digits visible, where `maskPhone`
gives `********001`. The script already deep-imports from `src/` (three providers, `isGsm7`), so
importing `maskPhone` costs nothing and no GOTCHA forbids it.

Same root cause: `BAKEOFF_LMT` / `_TELE2` / `_BITE` are checked only for truthiness (`:206`), while
every credential in the same script goes through the real `envSchema`. A recipient typed without
the `+` is accepted, then **stripped-and-sent by BudgetSMS, passed raw by BulkGate, rejected by
Twilio** — one scorecard row that is a script artefact attributed to a vendor, on a day that cannot
be re-run cheaply. Plan GOTCHA `:264` forbids putting these in `envSchema`; a script-local
`/^\+[1-9]\d{6,14}$/` check beside the presence check is compatible with that.

---

### F12 (Low) — the "RUN CEILING" claim covers only our own limiter

`sms-bakeoff.ts:72-75`: "the ceiling is vendor credit, not a rate limit". The reasoning given is
correct but narrower than the claim — it establishes only that `OTP_MAX_REQUESTS_PER_HOUR` is not
touched (true: the script calls `send()`, never `requestOtp`). Round 1 fires 27 sends back to back
with no delay across three vendors whose own throttles are not cited. A vendor 429 mid-round shows
up as an `ERR` row indistinguishable from a delivery failure in row 8.

**Fix**: scope the sentence to our own limiter, or cite the three vendors' limits.

---

### F13 (Low) — `EUR_PER_USD_RANGE` is named backwards

`sms-bakeoff.ts:122`. `1.3` is USD per EUR, and `costLabel` (`:538`) correctly **divides** by it
(`observed`: `$1.07 = €0.82–€1.07`). The arithmetic is right; the name says the reciprocal, and
`{ low: 1.3, high: 1.0 }` reads as a descending range because `low`/`high` name the resulting euro
cost rather than the rate. `USD_PER_EUR` with the fields as `cheapest`/`dearest` would say what it
is.

---

### F14 (Low) — the test helper names a hazard and does not close it

`auth.module.spec.ts:15-16`. The comment above says a typo in the `SMS_PROVIDER` **key** "would
leave the cases below green against a field the factory never reads", and then the helper casts
with `as Env`, which is what permits exactly that.

Note the fix has to be on the whole literal, not the value — `SMS_PROVIDER: 'auto' satisfies
Env['SMS_PROVIDER']` type-checks the *value* and so does nothing about a mistyped *key*. What works,
**verified**: `({ NODE_ENV, SMS_PROVIDER: 'auto', ...over } satisfies Partial<Env>) as Env`. I
introduced the typo `SMS_PROVDER` under that form and `tsc` exited 2 with
`TS2561: … 'SMS_PROVDER' does not exist in type 'Partial<…>'. Did you mean to write
'SMS_PROVIDER'?`. Restored.

---

## Checked and clear

Recorded so the next round does not re-derive them:

- **The production boot cannot regress.** `checkSmsCredentialGroups` now runs over three groups
  instead of one, in every environment, but a Hetzner env with `TWILIO_*` complete and the other two
  absent yields zero issues (`set.length === keys.length` → continue; `set.length === 0` →
  continue), and an absent `SMS_PROVIDER` defaults to `auto` → the Twilio branch. Pinned by
  `env.schema.spec.ts` ("accepts a named kind once its whole group is present", which parses a full
  `prod()` env) and `auth.module.spec.ts` ("binds the Twilio provider whenever the trio is present",
  which includes `NODE_ENV: 'production'`).
- **The non-null assertions in `smsProviderFactory` are load-bearing on the schema, not on luck.**
  `APP_ENV` is `envSchema.parse(process.env)`, and the named-kind check runs *above* the production
  gate. Walked all 4 × 2 × 2 combinations of selector × credentials × `NODE_ENV`: no path reaches a
  provider constructed with `undefined`, and no path binds the stub under `NODE_ENV=production`.
- **No leak on the fetch-rejection path**, which no spec covers and which matters most for
  BudgetSMS, whose secret and OTP body are in the URL. `observed` on Node v20.20.2: a rejected
  `fetch` to a URL carrying a secret gives `message: "fetch failed"` and
  `cause: getaddrinfo ENOTFOUND …`; the secret appears in neither, nor in a depth-6 `util.inspect`.
  So `sms-bakeoff.ts:571`'s `console.error(err)` and `sendOne`'s `ERR ${err.message}` are both
  clean. Worth knowing it holds by undici's behaviour rather than by anything in this repo.
- **The `--confirm` gate is airtight.** The only `send()` call is downstream of `if (!confirm)
  return`; `selectProviders` only constructs. `--round --confirm` gives `Number('--confirm') = NaN`
  → exit 1 before anything sends. Every parsing mistake fails toward dry run.
- **The order-sensitive regex survives the refactor.** `env.schema.spec.ts:216` pins
  `TWILIO_AUTH_TOKEN` before `TWILIO_FROM_NUMBER`; the new loop iterates `SMS_GROUPS[kind].keys`
  literally and `Object.values` preserves declaration order. Green in the gate.
- **The `TWILIO_*` field definitions and every message they emit moved byte-identically** in the D1
  split — checked against the removed hunk. The group message is now built from `prefix =
  'TWILIO_*'`, which reproduces the original string exactly.
- **All-or-none is complete over empty strings.** All ten credential keys carry the `'' →
  undefined` transform, so a blank line reads as absent — which is what the committed template
  needs.
- **Q4's shared-account hazard is carried into the shipped artefact**, not just the plan:
  `sms-bakeoff-scorecard.md:53`, as the plan said it must be, and only there.
- **The cross-file citations resolve**: `bulkgate-sms.provider.ts:112`'s "row 11" and
  `budgetsms.provider.ts:73`'s "row 16" both point at the rows they describe.
- **All eight deviations (D1–D8) are documented and dated** in the plan's `## AMENDMENTS`, and each
  is a decision rather than a slip. D6's "extracting `SMS_HTTP_TIMEOUT_MS` would mean editing
  `twilio-sms.provider.ts`, which Out of Scope forbids" is correct — I checked the constraint before
  considering the obvious refactor, and it is binding, so no such recommendation appears above.

---

## What's good

- **The `ERR`-on-200 branch** (`budgetsms.provider.ts:88`) is the bug this ticket was most likely to
  ship, and it is both avoided and pinned. Reverting it to `res.ok` turns the suite red in the exact
  shape the report claims — I ran it.
- **Encoding detected, not hardcoded** (`bulkgate-sms.provider.ts:85`). The reasoning in the comment
  is the right one and not the obvious one: the segment count is identical either way, so a cost
  argument would have permitted the bug; what it would have broken is the attributability of the OTP
  row. `bulkgate-sms.provider.spec.ts:121` holds it, and would not survive a hardcoded `true`.
- **`countParts` labelled `expected`, not `observed`**, with the vendor's own
  three-ids-for-two-parts example quoted, the raw `part_id` logged alongside the count, and
  scorecard row 11 designated to settle it. Provenance discipline working as intended.
- **The leak-free throws** in both providers, each with the concrete reason (`auth.service.ts` logs
  `err.message` verbatim) rather than a general principle — and each pinned by a spec asserting the
  phone and body are *absent* from the message. F3 narrows one of those assertions; it does not
  undo them.
- **`BUDGETSMS_FROM` held stricter than `TWILIO_FROM_NUMBER`**, with a test proving the two genuinely
  differ rather than asserting the strictness in prose. Generalising the hardcoded trio into
  `SMS_GROUPS` also caught the real asymmetry — BudgetSMS has four keys — and the fourth is pinned
  specifically.
- **Selection is explicitly not failover**, said in the factory comment, the plan's Q3 and the PR
  body. Right call, right places.
- **The report is unusually honest about its own figures**: it names the shared-`taxi_api_test`
  collision that produced a bad first baseline, shows the failures did not move the total, refuses
  to put a sha in a file the commit contains, and declines to fill the scorecard's run date —
  precisely the `observed`-without-a-run defect CLAUDE.md warns about.

---

## Recommendation

**Approve.** Nothing here is a safety or correctness blocker.

Worth doing before merge, in order: **F1** (the scorecard is what will make the vendor decision and
it currently cannot see the OTP-in-URL risk), **F2** (the repo's recurring defect class, and the
correction is one line), **F3** (two characters, and the pin is the property this PR most advertises)
and **F4** (one sentence in the PR body). F5–F7 are a natural follow-up commit on this branch;
F8–F14 are polish and can ride along or be dropped.

#137 correctly stays open — AC #6 and AC #7 need handsets and funded accounts, the PR body says so,
and `gh pr view 240 --json closingIssuesReferences` returns `[]`, confirmed just now.

---

*Written by `piv-review-pr` with the `code-reviewer` agent. Every behavioural finding above was run
before it entered this report; the two prescribed fixes that are typed (F9, F14) were applied and
type-checked, and the worktree was restored clean after each probe.*
