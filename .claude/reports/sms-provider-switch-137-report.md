# Implementation Report — the SMS provider switch, `'auto'` retired (#137)

**Plan**: `.claude/plans/sms-provider-switch-137.md`
**Branch**: `feature/sms-provider-switch-137` (worktree `~/taxi-worktrees/wt-137-switch`, off `origin/main` = `325f8e7`)
**Status**: COMPLETE

## Summary

`SMS_PROVIDER` is now a four-value enum defaulting to `'stub'`, and
`smsProviderFactory` is a pure switch on it with no credential-presence
branch — the shape `pushProviderFactory` already uses. The factory emits
`auth.sms.provider_bound` at every binding, so the bound vendor is readable
from the logs rather than from the first bill. `notifications.module.spec.ts`
pins that the ride-SMS path binds the same factory the OTP path does, which
module metadata is the only possible home for. The runbook gained the switch
procedure (§5.4), the selector line its §3 template was missing, and three
boot refusals moved from `expected` to `observed` with text taken from real
containers.

## Tasks completed

| Plan task | File | Action |
|---|---|---|
| 1 · selector types | `services/api/src/common/config/sms-env.schema.ts` | UPDATE |
| 2 · enum + migration message | `services/api/src/common/config/sms-env.schema.ts` | UPDATE |
| 3 · named-kind check sentinel | `services/api/src/common/config/sms-env.schema.ts` | UPDATE |
| 4 · factory as a pure switch + boot log + reworded refusal | `services/api/src/features/auth/auth.module.ts` | UPDATE |
| 5 · doc-comment rewrite | `services/api/src/features/auth/auth.module.ts` | UPDATE |
| 6 · stale trio-presence claim | `services/api/src/features/auth/sms/stub-sms.provider.ts` | UPDATE |
| 6b · a **sixth** stale claim the plan's enumeration missed | `services/api/scripts/mint-tracked-ride.ts` | UPDATE |
| 7 · spec update + 2 new cases | `services/api/src/features/auth/auth.module.spec.ts` | UPDATE |
| 8 · metadata pin for the ride-SMS binding | `services/api/src/features/notifications/notifications.module.spec.ts` | **CREATE** |
| 9 · spec update + 1 new failure case | `services/api/src/common/config/env.schema.spec.ts` | UPDATE |
| 10 · selector block + Twilio block + BulkGate comment | `.env.example` | UPDATE |
| 11 · §3 table row 224 + the missing template line | `docs/runbooks/hetzner-deploy.md` | UPDATE |
| 12 · boot-refusal table, filled from probe output | `docs/runbooks/hetzner-deploy.md` | UPDATE |
| 13 · the production boot proof | — | 5 probes run |
| 14 · §5.4 switch procedure | `docs/runbooks/hetzner-deploy.md` | **CREATE** (section) |
| 15 · the full gate | — | green |

Three commits on the branch, plan first: `7c3005a` (plan) · `50350fe` (code) ·
`7f6a008` (runbook + `.env.example`).

## Tests added

`observed` — `it(` counted per changed spec file at `origin/main` vs this
head (`scripts` in the scratchpad; **not** subtracted from the plan's stated
totals, which it inherited from PR #240's body):

| File | Before | After | Delta |
|---|---|---|---|
| `features/auth/auth.module.spec.ts` | 8 | 10 | +2 |
| `common/config/env.schema.spec.ts` | 30 | 31 | +1 |
| `features/notifications/notifications.module.spec.ts` | 0 | 1 | +1 (new suite) |
| **Total** | **38** | **42** | **+4 cases, +1 suite** |

The cases:

- **expected** — `binds Twilio when SMS_PROVIDER names it`: rewritten, its old
  premise (trio presence) no longer selects anything.
- **edge, the P1 regression** — a production env with a complete `TWILIO_*`
  trio **and** a complete `BULKGATE_*` group and `SMS_PROVIDER=stub` now
  **throws**. Before the retirement that identical env bound Twilio silently.
- **edge, the P2 dev change** — a complete trio in development with no
  selector binds the **stub**, pinned so the changed dev ergonomics is a
  decision rather than a surprise.
- **failure** — the production refusal names `SMS_PROVIDER` and the three
  selectable kinds, and asserts the "a complete credential group does NOT bind
  on its own" clause.
- **failure** — `SMS_PROVIDER=auto` throws matching `/'auto' was retired \(#137\)/`,
  **and** `SMS_PROVIDER=vonage` throws matching the constraint clause (see
  deviation D1).
- **edge** — `NotificationsModule` binds `SMS_PROVIDER` to `smsProviderFactory`
  with `inject: [APP_ENV]`, by identity.

**AC #2's revert-and-go-red proof was performed**, not assumed: with
`notifications.module.ts`'s `SMS_PROVIDER` provider entry deleted, the new spec
failed at `notifications.module.spec.ts:36` on `expect(sms?.useFactory).toBe(smsProviderFactory)`;
binding restored (`git diff` on that file empty), suite green again.

## Validation results

**The full gate**, `observed` — from a cleared `services/api/dist`,
`packages/shared/dist`, `db/dist` and `apps/dispatch/.next`, in the worktree:

```
COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     2m25.345s
```

`@taxi/api` — `Test Suites: 2 skipped, 78 passed, 78 of 80 total`,
`Tests: 39 skipped, 727 passed, 766 total`. The 39 skipped are the
`REDIS_TEST_URL`-gated suites, which this run did not set; CI does.

`@taxi/api` lint: **0 errors**, 12 warnings — all pre-existing
`no-unsafe-argument` on `App` in integration specs, none in a changed file.

`max-lines` headroom (cap 500, shipped source): `sms-env.schema.ts` 302
(was 274), `auth.module.ts` 141 (was 119), `env.schema.ts` 351 (unchanged),
`notifications.module.ts` 50 (unchanged). Specs are uncapped (#112).

### Level 4 — the production boot proof

The gate never boots under `NODE_ENV=production`, so this is the only
verification of what the ticket changes. Image `taxi-api:switch137`, **389 MB**,
built from `services/api/Dockerfile` at this branch's head, on network
`taxi_default` against the shared `taxi-db-1` / `taxi-redis-1` and a scratch
`sms137` database. All five `observed` 2026-09-21. Everything torn down after:
containers removed, database dropped, image deleted, shared stack still healthy.

| # | Env | Baseline on `main` | Result | Verdict |
|---|---|---|---|---|
| 1 | `SMS_PROVIDER=bulkgate` + complete **fake** `BULKGATE_*` | D — boots, **zero** SMS lines in the whole log | Boots. `/health` **HTTP 200**. `Nest application successfully started`. **2** `auth.sms.provider_bound` lines, both `provider: 'bulkgate'` | ✅ E8 |
| 2 | no `SMS_PROVIDER` line at all | A — factory throw | Exit 1, the **reworded** factory throw (quoted below) | ✅ E7, E9 |
| 3 | `SMS_PROVIDER=auto` | B — **byte-identical to A** | Exit 1, a **`ZodError`**, `code: "invalid_enum_value"`, raised at `app-config.module.js:24` inside `ConfigModule.forRoot`'s `validate` — **no longer identical to probe 2** | ✅ E1, AC #4 |
| 4 | `SMS_PROVIDER=bulkgate`, group incomplete | C — `ZodError`, three issues | Same three issues, unchanged | ✅ E6 |
| 5 | `sms:bakeoff` dry run, sourced shell | n/a | Reaches the matrix, `0 segments total`, `DRY RUN — nothing was sent` | ✅ E10 |

**Probe 2, verbatim** (ANSI stripped) — thrown by `smsProviderFactory`, so
production only:

```
ERROR [ExceptionHandler] Error: No production SmsProvider is bound: SMS_PROVIDER is stub
(or unset, which defaults to stub), and StubSmsProvider delivers nothing and logs OTP codes
in full. Set SMS_PROVIDER to twilio, bulkgate or budgetsms together with that kind's whole
credential group — TWILIO_* (#85), BULKGATE_* or BUDGETSMS_* (#137). A complete credential
group does NOT bind on its own. Then run with NODE_ENV=production.
    at InstanceWrapper.smsProviderFactory [as metatype] (/app/dist/features/auth/auth.module.js:56:15)
```

**Probe 3, verbatim** — a different layer from probe 2, which is the whole
point of the probe:

```
ERROR [ExceptionHandler] ZodError: [
  { "received": "auto", "code": "invalid_enum_value",
    "options": [ "stub", "twilio", "bulkgate", "budgetsms" ],
    "path": [ "SMS_PROVIDER" ],
    "message": "SMS_PROVIDER must be one of: stub | twilio | bulkgate | budgetsms. 'auto' was
                retired (#137) — name the provider outright; 'stub' delivers nothing and
                production refuses it." }
]
    at Object.validate (/app/dist/common/config/app-config.module.js:24:59)
```

On `main` probes 2 and 3 are byte-identical; here they are **DIFFERENT**
(asserted mechanically in the probe script), which is what proves the
migration message is wired rather than dead text.

**Probe 4, verbatim** — three issues, and note the last one:

```
"BULKGATE_APPLICATION_TOKEN is missing: BULKGATE_* must be set all together or not at all
 (a partial config silently binds the stub)."
"BULKGATE_SENDER_ID_VALUE is missing: BULKGATE_* must be set all together or not at all
 (a partial config silently binds the stub)."
"SMS_PROVIDER=bulkgate needs BULKGATE_APPLICATION_TOKEN, BULKGATE_SENDER_ID_VALUE."
```

The runbook's row for this case **predicted** a message naming all three
`BULKGATE_*` keys. The container names **two** — only the keys actually
missing, since this probe set `BULKGATE_APPLICATION_ID`. The row now carries
the run's text and says why it lists two. That gap is exactly what the
`expected` → `observed` move exists to catch.

## Deviations from the plan

**D1 — the migration message leads with the constraint, not the retirement.**
The plan suggested `` `SMS_PROVIDER=auto was retired (#137): name the provider outright — …` ``.
Shipped instead: `SMS_PROVIDER must be one of: stub | twilio | bulkgate | budgetsms. 'auto' was retired (#137) — name the provider outright; 'stub' delivers nothing and production refuses it.`
**Why**: a custom `message` replaces zod's whole string for **every** rejected
value, not only `'auto'` — so the plan's wording would tell an operator who
typed `SMS_PROVIDER=vonage` that `'auto'` was retired, which is false for that
input. `env.schema.spec.ts:508` already tests exactly that value with a bare
`.toThrow()`, so it would have stayed green while the message said the wrong
thing. The new spec case pins **both** halves: `/'auto' was retired/` for
`'auto'`, and the constraint clause for `'vonage'`. AC #4 is still satisfied —
the message names the retirement and all four legal values.

**D2 — a sixth stale trio-presence claim, fixed.** The plan's Task 6 GOTCHA
enumerated the phrase as surviving in **five** places and said to expect zero
hits after Tasks 1-5 and 9-10. A sixth exists:
`services/api/scripts/mint-tracked-ride.ts:773` told the reader that a set
`TWILIO_*` trio binds the real provider and to "Unset it" — advice that no
longer works, since unsetting the trio does not change the binding. Corrected
to name `SMS_PROVIDER`. **Why in scope**: AC #6 says *no surviving text
anywhere*, and CLAUDE.md's rule is to grep the subject rather than the
sentence. A seventh, `.env.example:114` ("a fresh checkout boots into auto →
stub"), was fixed in the same sweep.

**D3 — the boot log is emitted through one local `bind()` helper**, not
inlined before each `return`. The plan explicitly permitted either ("or once
via a small local helper — either is fine, one `event` name"). Chosen because
it keeps the four call sites to one line of logging each and makes the single
`event` name structurally true rather than conventionally so.

**D4 — Tasks 12 and 13 executed in the order 13 → 12.** The plan lists the
refusal-table edit before the boot probes, but Task 12's own VALIDATE step
says "after Task 13". Writing predicted message text with the intent of
replacing it is the #107 defect; the table was written once, from probe output.

**D5 — the runbook preamble's "first seven / first six" became named rows.**
Not a plan task. Splitting one refusal row into two (Task 12) invalidated
those positional references — "the first seven" no longer denoted the set
whose provenance is 2026-09-03. They now name the six rows this loop did not
touch. Left as a positional reference, the paragraph would have silently
mis-attributed two new `observed` rows to a 2026-09-03 boot that never saw them.

**D6 — probe 5 was run twice, and the first run proved nothing.** The first
attempt exited 1 on `missing: BAKEOFF_LMT, BAKEOFF_TELE2, BAKEOFF_BITE`. That
recipient gate is at `sms-bakeoff.ts:232` and runs **before**
`envSchema.parse` at `:261`, so the run never reached the selector at all —
its exit code said nothing about E10. Re-run with placeholder handset numbers
(still no `--confirm`, so still a dry run spending nothing), it reached the
matrix and printed `0 segments total`. **The plan named two failure modes for
this probe; this is a third it did not.** A second variant confirms Q1's
hazard: with `SMS_PROVIDER=auto` in the environment the script exits 1 through
its own "run from a shell that sourced the root env file" handler, quoting the
migration message.

**No UX states were declared or built.** The plan has no UX section and this
ticket ships no user-facing surface — the only new output is a server log line
and runbook prose. Recorded explicitly because an omitted state is invisible in
a diff.

**Nothing in the plan was skipped.** All 15 tasks, all 10 ACs, all 10 edge
cases E1-E10 (E1 spec + probe 3 · E2, E3, E6 specs · E4, E5 new spec cases ·
E7, E9 probe 2 · E8 probe 1, two lines observed · E10 probe 5).

## Issues encountered

**The worktree needed `pnpm install` and a `@taxi/shared` + `@taxi/db` build
before `npx tsc` said anything useful.** A fresh worktree carries no
`node_modules`, so the first typecheck returned ~40 `TS2307: Cannot find
module '@taxi/shared'` errors that masked the two real ones. The signal after
building: exactly two `'auto'` sites, both in `auth.module.spec.ts` (18, 104).
Worth noting that **typecheck did not flag `auth.module.ts` at all** — the
retired branch was a credential-presence test, not a comparison against
`'auto'`, so the type change could not reach it. The plan's "let typecheck
enumerate the call sites" is true for the specs and not for the factory.

**Migration skew**: `db/migrations` last file is `0010_smooth_white_queen.sql`.
This ticket adds no migration.

**Q1's pre-step is owed on the box and is not in this diff.** Before this PR
merges, `/opt/taxi/.env` must get `SMS_PROVIDER=twilio` (a value already valid
before the retirement, so the change is a no-op on the day), after
`ssh <box> "grep -c '^TWILIO_[A-Z_]*=..*' /opt/taxi/.env"` prints **3**.
Merging first means a crash-looping container and a down API. This is written
into §5.4's preamble and belongs in the PR body.

**Local env files on other checkouts will break, by design.** Any `.env` still
carrying `SMS_PROVIDER=auto` — #240's committed template said so — now fails
every `pnpm test` with the migration message. That is the message doing its
job; the PR body should say so, so it reads as expected rather than as
breakage. Two other Claude sessions share this repo.

**Not performable here, and not de-scoped silently**: §5.4 steps 6 and 7's
live half — one real OTP to a handset through a switched provider, and the
live rollback under real traffic. Both need a funded vendor account and an LV
SIM (#137 is `blocked:hardware`). They are marked **owed to the verdict loop**
in §5.4's own text rather than implied to be covered.

## Ready for the next step

Working tree clean, three commits on `feature/sms-provider-switch-137`.
**The PR must not close #137** — the verdict half is still open, so keep
closing keywords away from `#137` in the body.

Next: `piv-commit` (nothing outstanding), then `piv-create-pr`, then
`piv-review-pr`.
