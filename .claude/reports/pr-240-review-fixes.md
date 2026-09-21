# PR #240 review round 1 — fixes (#137)

**Review** `.claude/code-reviews/pr-240-review.md` · **Base** `main` @ `1c98ac8` (unmoved) ·
**Applied** 2026-09-21

**All fourteen findings fixed. Nothing deferred, nothing dropped as noise.** The review's own
recommendation was F1–F4 before merge with F5–F7 as a follow-up commit and F8–F14 optional; the
whole set was taken instead, because every fix is small, the PR is not merged, and a follow-up PR
would cost a second PIV loop for polish. Linards confirmed the scope and chose F6's shipped-source
option before any code changed.

No sha is named in this file: it is contained in the commit it would describe, so a sha here is
stale the moment it lands and the correction re-stales it (#212). The PR body names the pushed head,
where it can be true.

---

## Validation

`observed` — `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` in
`/Users/Berzins/taxi-worktrees/wt-137`, from a cleared `dist/` and `apps/dispatch/.next`, exit 0,
`1m32.327s`:

| | Before (implementation pass) | After (this round) |
|---|---|---|
| Tasks | 22 successful, 22 total | 22 successful, 22 total · 0 cached |
| `@taxi/api` tests | 39 skipped, 719 passed, 758 total | **39 skipped, 723 passed, 762 total** |
| `@taxi/api` suites | 2 skipped, 77 passed, 77 of 79 | 2 skipped, 77 passed, 77 of 79 |
| Lint | 0 errors, 12 warnings | 0 errors, 12 warnings |

**+4 tests, no new suite** — one each for F5, F6, F8 and F10. The 39 skipped are the documented
Redis-gated set, unchanged at both ends.

Delta against the branch's base, **re-derived rather than adjusted**: 723 − 694 = **29**, and
`grep -cE '^\s*it\('` per file gives 8 (bulkgate) + 9 (budgetsms) + 4 (auth.module — this ticket's
cases; the file holds 8) + 8 (`env.schema.spec.ts`'s `#137` describe block) = 29. Both routes agree.

`max-lines` clean. Largest touched shipped file `env.schema.ts` 351, then `sms-env.schema.ts` 274,
`bulkgate-sms.provider.ts` 149, `budgetsms.provider.ts` 135, `auth.module.ts` 119.
`scripts/sms-bakeoff.ts` is 610 and exempt by both mechanisms the review verified.

---

## Fixed

Each row's pin was run **against the unfixed code** before the fix was accepted. A regression test
nobody has watched fail is a decoration.

### F1 (Medium) — the scorecard could not vote on the OTP-in-URL risk

`docs/research/sms-bakeoff-scorecard.md` Verdict. Row 16 sat under *"Informational rows — context,
never the deciding vote"*, so a BudgetSMS that went 3/3, kept `SaktaCab` and won on price would have
been prescribed a switch with the OTP-in-URL exposure never entering the decision.

**Fix**: a Verdict bullet that gives row 16 a vote and forbids a blank. Before writing "Switch to
BudgetSMS" the runner must record either *disqualified on row 16* or *accepted, with the
compensating control named* — a shortened OTP TTL, or BudgetSMS bound for notification SMS and never
for the OTP path. Mirrored into the plan's Appendix A (below).

**Closing command**, run 2026-09-21 against the fixed tree:
`grep -n 'row 16' docs/research/sms-bakeoff-scorecard.md` → hits at the informational table and in
the Verdict.

### F2 (Medium) — "a fourth costs another ~€1.45" was wrong and unlabelled

`services/api/scripts/sms-bakeoff.ts`. `~€1.45` is 33/3 — the three-round total divided by three,
which silently re-adds the round-1-only RU probe.

**Re-derived, not inherited.** `observed` — a `--round 4` dry run prints 6 rows and
`budgetsms: 9 segments`, `bulkgate: 9 segments`, `twilio: 9 segments`, so it is **9 per provider**.
At §4.1's rates: BulkGate 9 × €0.0311 = 0.2799; BudgetSMS 9 × €0.045 = 0.405; Twilio
9 × $0.0715 = $0.6435, which is €0.495 at EUR/USD 1.3 and €0.6435 at 1.0. Totalled from **unrounded**
components, the way the three-round figure ten lines above is: 1.1799 and 1.3284 → **€1.18–€1.33**.

**Fix**: that range, labelled `derived`, with the condition named (9 segments, OTP + LV only, RU is
`onlyRound: 1`) and the FX range stated.

**Propagation, checked not assumed**: `git grep -n '1\.45'` over `services/api/scripts`,
`docs/research`, the plan and the implementation report → **no hits**. The bad figure never spread;
it lived in that one docblock line.

### F3 (Medium) — the success-path leak pins missed the wire spelling

Both success-path assertions said `not.toContain('+37120000001')`. BudgetSMS strips the `+` on the
wire, and BulkGate's `ACCEPTED` fixture echoes the vendor's own unprefixed `number`.

**Reproduced on both providers before fixing:**

| Provider | Injected leak | Unfixed assertion | Fixed assertion |
|---|---|---|---|
| BudgetSMS | `to: phoneE164.replace(/^\+/, '')` in the success log | `7 passed, 7 total` ❌ blind | `1 failed, 6 passed` ✅ |
| BulkGate | `number: json.data?.number` (the fixture's own field) in the success log | `8 passed, 8 total` ❌ blind | `1 failed, 7 passed` ✅ |

Both providers restored afterwards; `git diff` on each is empty.

**Fix**: drop the `+` from both, with a comment saying why the unprefixed spelling catches both
forms. The ERR-path assertion already got this right and is untouched.

### F4 (Medium) — the PR body described a 27-send matrix

`observed` — dry runs print 9 rows for round 1 and 6 for round 2, and round 3 has round 2's shape:
9 + 6 + 6 = **21 sends per provider**. The RU probe is `onlyRound: 1`.

**Fix**: PR body only — the script docblock and the implementation report were already correct. The
body's own spend line (3 × (3 + 6 + 2) = 33) already baked RU-once in, so the sentence contradicted
arithmetic three paragraphs below it. Applied at the pushed head, after the commit, so the body
describes the tree it links to.

### F5 (Medium) — the production boot refusal named the wrong vendor

`services/api/src/features/auth/auth.module.ts`. An operator who funds BulkGate, sets all three
`BULKGATE_*` vars and forgets `SMS_PROVIDER` gets `'auto'`, skips both new branches, and dies
pointing at Twilio — the likeliest misconfiguration this PR introduces, because its premise is that
credential presence stopped selecting.

**Fix**: the message names both exits, and says explicitly that a complete `BULKGATE_*`/`BUDGETSMS_*`
group does **not** bind on its own. The docblock's "the production refusal is unchanged" is narrowed
to the condition, which is what is actually unchanged.

**New test**: `auth.module.spec.ts` — production + full `BULKGATE_GROUP` + `'auto'` asserts the
refusal fires, names `SMS_PROVIDER=bulkgate|budgetsms`, and still names `TWILIO_ACCOUNT_SID`.

**Pin proven**: reverting the message to its old text → `1 failed, 7 passed, 8 total`.

### F6 (Medium) — `/testsms/`'s response shape was assumed in three places and sourced in none

`services/api/src/features/auth/sms/budgetsms.provider.ts`. `startsWith('OK ')` — with the trailing
space — is right for `/sendsms/`, and the free pre-flight reroutes that same parser to `/testsms/`,
whose reply this PR sources nowhere. A bare `OK` would make every pre-flight row read
`budgetsms_error_200` on the one step that exists to prove the credentials work, and the only step
that is free.

**Fix** (Linards chose this option over the docs-only one): `text !== 'OK' && !text.startsWith('OK ')`.

**Its own new failure mode, named and pinned rather than left to be found**: a bare `OK` on
`/sendsms/` now logs a success with `smsId` undefined and `segments` 1. A test asserts exactly that
shape, so the widening's cost is recorded rather than discovered.

**Pin proven**: reverting the parser → `1 failed, 8 passed, 9 total`, and the `ERR`-on-200 pin stayed
green throughout, which is the property the widening had to preserve.

**Copies chased**: the provider comment now says the bare `OK` is accepted and why; the run sheet's
step 2 no longer promises `OK <id>` per handset and asks the runner to record the real reply; the
override test's comment says the four-token body is `/sendsms/`'s shape, not `/testsms/`'s.

### F7 (Medium) — `docs/runbooks/hetzner-deploy.md` was not updated

The same shape as #14's `PUSH_PROVIDER`, which the runbook itself records as having reached `main`
unnoticed.

**Fix**: three rows in the production env table (`SMS_PROVIDER`, the `BULKGATE_*` group, the
`BUDGETSMS_*` group — the last naming the GET-only exposure and pointing at scorecard row 16), plus
a row in the boot-refusal table.

**The boot-refusal table's count is a claim and was not inherited.** Its prose said *"All seven were
`observed` on 2026-09-03"*. The new row has **not** been observed — no image has been booted since —
so the prose now reads "the first seven were observed" and the eighth is labelled `expected`, with
what *is* observed stated precisely: `env.schema.spec.ts` observes the message; nothing has observed
that it stops the container. The existing `no TWILIO_* at all` row was updated too, since F5 changed
the message it quotes.

### F8 (Low) — a blanked `SMS_PROVIDER=` line refused to boot everywhere

`.default()` fires on `undefined` only. The repo has both shapes and this copied the one whose hazard
is documented against the one that exists to prevent it.

**Fix**: the `z.preprocess((v) => (v === '' ? undefined : v), …)` wrapper `ALLOW_STUB_MAPS_PROVIDER`
already uses.

**New test**: `SMS_PROVIDER: ''` parses to `'auto'`; `'  '` still throws, so the widening stops
where it should.

**Pin proven**: reverting the preprocess →
`Invalid enum value. Expected 'auto' | 'twilio' | 'bulkgate' | 'budgetsms', received ''`,
`1 failed, 38 passed, 39 total`.

**Scope note**: `PUSH_PROVIDER` is the un-wrapped precedent and is **left alone** — it is outside
#137's diff. The review asked for one shape applied to both enums; applying it to the field this PR
introduces is the half that belongs here, and the comment says so rather than leaving the
inconsistency unexplained.

### F9 (Low) — `SmsCredentialKey` was hand-listed where the compiler could derive it

**Fix**: `type SmsCredentialKey = Exclude<keyof typeof smsEnvFields, 'SMS_PROVIDER'>;`

**Verified independently, not inherited from the review.** `npx tsc --noEmit -p tsconfig.json` →
exit 0, no output, so the forward reference is legal.

**And the payoff was tested, not asserted** — a review's stated payoff is a claim like its figures.
Renaming `smsEnvFields.BUDGETSMS_FROM` to `BUDGETSMS_SENDER` while leaving `SMS_GROUPS` naming the
old key:

| `SmsCredentialKey` | errors reported **in `sms-env.schema.ts` itself** |
|---|---|
| derived (the fix) | `sms-env.schema.ts(71,7): error TS2322: Type '"BUDGETSMS_FROM"' is not assignable to type 'SmsCredentialKey'` |
| hand-listed (before) | **none** — the group check silently stops covering the renamed key |

### F10 (Low) — `errorCode` did not enforce the guarantee its caller advertises

The caller's comment says "only the code crosses", and `auth.service.ts` logs `err.message` verbatim.

**Fix**: `/^\d{1,6}$/` on the extracted token, the shape check both siblings already do. The bound is
six, not four, so a fifth digit does not silently become `budgetsms_error_200`.

**New test**: an `ERR` body whose second token is not numeric falls back to the status.

**Pin proven**: reverting the shape check →
`budgetsms_error_account-suspended-37120000001` — vendor text carrying a phone number, in the message
that gets logged. Exactly the leak the guarantee denies.

### F11 (Low) — the script re-implemented `maskPhone`, and `BAKEOFF_*` shape was unchecked

Fixed in the review's order: the shape check first, because it is what makes the mask swap safe —
`maskPhone` and the local copy diverge only on input without a `+`.

**Fix**: a script-local `/^\+[1-9]\d{6,14}$/` check beside the presence check (the plan's GOTCHA
forbids putting handsets in `envSchema`, and this is compatible with that), then `maskPhone`
imported and `maskRecipient` deleted.

**Proven** `observed`: with `BAKEOFF_TELE2=37125000002` — the `+` omitted — the script prints
`not E.164 (+371… , no spaces or dashes): BAKEOFF_TELE2` and exits **1**, with no matrix and nothing
sent. Good handsets still exit **0** and mask as `+371*****001`, unchanged output.

Without this, a handset typed without the `+` is stripped-and-sent by BudgetSMS, passed raw by
BulkGate and rejected by Twilio — one scorecard row that is a script artefact attributed to a vendor,
on a day that cannot be re-run cheaply.

### F12 (Low) — the "RUN CEILING" claim covered only our own limiter

**Fix**: the sentence now scopes the limiter claim to `OTP_MAX_REQUESTS_PER_HOUR` (which is what the
reasoning actually establishes) and states separately that the vendors' own throttles are **not
sourced**, that round 1 fires 27 sends back to back, and that a vendor 429 would arrive as an `ERR`
row indistinguishable from a delivery failure in row 8.

### F13 (Low) — `EUR_PER_USD_RANGE` was named backwards

**Fix**: `USD_PER_EUR = { cheapest: 1.3, dearest: 1.0 }`, with a docblock saying the fields name the
euro cost that comes out rather than the rate.

**Deliberately NOT changed**: the printed `(EUR/USD 1.3–1.0)` label and the docblock's "an EUR/USD of
1.3". `EUR/USD 1.3` is correct FX notation for 1 EUR = 1.3 USD — only the identifier read backwards,
and "fixing" the label would have made it wrong. `observed`: `costLabel` still prints
`$0.64 = €0.49–€0.64`, unchanged.

### F14 (Low) — the test helper named a hazard and did not close it

**Fix**: `({ NODE_ENV, SMS_PROVIDER: 'auto', ...over }) satisfies Partial<Env> as Env`.

**Verified independently**: introducing `SMS_PROVDER` under that form gives
`error TS2561: Object literal may only specify known properties, but 'SMS_PROVDER' does not exist in
type 'Partial<…>'. Did you mean to write 'SMS_PROVIDER'?` — so the key is checked, not just the
value. Restored; `tsc --noEmit` exit 0.

---

## Numbers and guarantees: the sweep, as commands and hits

A retired figure's copies do not contain the word that was fixed, so the sweep is by **value** and by
**subject**. Each line ran against the fixed tree on 2026-09-21; the hits are what came back.

| Retired | Command | Hits |
|---|---|---|
| `~€1.45` | `git grep -n '1\.45' -- services/api/scripts docs/research .claude/plans/sms-provider-bakeoff-137.md .claude/reports/sms-provider-bakeoff-137-report.md` | **none** — it never propagated |
| `EUR_PER_USD_RANGE` | `git grep -n 'EUR_PER_USD'` | **none** |
| `maskRecipient` | `git grep -n 'maskRecipient'` | **none** |
| `OK <id>` per handset | `git grep -n 'OK <id>'` | scorecard step 2 (rewritten), plan Appendix A (mirrored), the amendment that retires it — no stale copy |
| the old boot message | `git grep -n 'No production SmsProvider is bound'` | `auth.module.ts` (new text), 3 spec matches on the unchanged `/No production SmsProvider is bound/` prefix, runbook row (updated), plan task line (amended), plus `.claude/plans/real-sms-provider-twilio.md`, `.claude/plans/api-payments-ledger.md` and `.claude/code-reviews/pr-147-review.md` — **historical records of closed tickets, deliberately left** |
| `719` / `758` / `+25 tests` | the implementation report, the plan tail, the PR body | all three carried them; all three re-derived at the new head |

**Three surfaces carried figures my own fixes moved**, and each was corrected at the new head rather
than adjusted arithmetically:

- `.claude/reports/sms-provider-bakeoff-137-report.md` — its gate block is now labelled as the
  implementation pass's and superseded in place, and the baseline delta re-derived to +29/+2 by two
  independent routes.
- `.claude/plans/sms-provider-bakeoff-137.md` — the tail's gate figures, plus two task instructions
  that F5 and F14 made false (*"keep the refusal's exact message"*, *"the helper casts … so adding a
  field is not type-checked"*). Both retired in a dated `## AMENDMENTS` entry rather than edited out
  of the task text, which is the historical record of what was planned.
- **the PR body** — the surface no working-tree grep can reach and the first a reviewer reads.
  Rewritten after the push, against the pushed head.

**Appendix A stays byte-identical to the shipped scorecard.** The plan makes that a VALIDATE step,
and F1 and F6 both edit the scorecard, so both were mirrored. `observed`, the plan's own command:
`diff <(sed -n '/^````markdown$/,/^````$/p' .claude/plans/sms-provider-bakeoff-137.md | sed '1d;$d') docs/research/sms-bakeoff-scorecard.md`
→ **empty**.

---

## Not done, and why

- **`PUSH_PROVIDER`'s empty-string hazard (F8's other half).** Outside #137's diff. The review asked
  for one shape across both enums; this PR fixes the enum it introduces and the comment names the
  other as the un-wrapped precedent. Worth a one-line follow-up whenever `env.schema.ts`'s push
  section is in scope.
- **`SMS_HTTP_TIMEOUT_MS` in three provider files** (the implementation pass's D8). Unchanged:
  extracting it means editing `twilio-sms.provider.ts`, which Out of Scope forbids. The review
  checked the constraint and agreed it binds.
- **The eighth boot gate has not been observed.** It is labelled `expected` in the runbook. Observing
  it needs a production-env image boot, which is a runbook exercise and not something this PR's gate
  can reach.

## Needs a human look

- **The `/testsms/` reply shape is still unsourced.** F6 makes both plausible shapes pass, so the
  pre-flight can no longer report a false credential fault — but nothing here establishes what the
  endpoint actually returns. The run sheet now asks the runner to record it. That is the honest
  state, not a fix.
- **Row 16's verdict is now a required decision, not a resolved one.** F1 makes the scorecard refuse
  to hide the OTP-in-URL exposure; it does not decide it. Whether BudgetSMS is disqualified or
  accepted with a compensating control is Linards' call on bake-off day.

---

**#137 stays open.** Nothing in this round touches AC #6 (handset results) or AC #7 (the switch, or
the recorded reason).
