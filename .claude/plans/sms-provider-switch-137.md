# Feature: the SMS provider switch — retire `'auto'`, make the flip a documented two-minute operation (#137)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **Read this first — three framing facts.**
>
> 1. **#137's first loop already shipped.** PR #240 merged `2026-09-21T08:52:06Z` as `325f8e7` on
>    `main`: `BulkGateSmsProvider`, `BudgetSmsProvider`, the `SMS_PROVIDER` selector, the
>    `sms:bakeoff` script and `docs/research/sms-bakeoff-scorecard.md` with empty `observed` cells.
>    Its plan is `.claude/plans/sms-provider-bakeoff-137.md` **on main** (977 lines). This plan is
>    the follow-up that plan's **Q2** names: *"If the bake-off ends in a switch, the follow-up loop
>    is the right place to retire `'auto'`."*
> 2. **This plan is candidate-independent and needs no handset results.** Nothing here reads the
>    scorecard. The verdict decides which value `SMS_PROVIDER` takes on the box; it does not change
>    a line of this diff. The work is executable today.
> 3. **The working tree is NOT the tree this plan describes.** `observed` —
>    `git rev-list --left-right --count HEAD...origin/main` → `6	14` on branch
>    `feature/driver-device-day-prep`. Every `file:line` below is read from **`origin/main`**, via
>    `git show origin/main:<path>`. Implement from a worktree off `origin/main`, not from this
>    checkout.

## Feature Description

#240 introduced `SMS_PROVIDER` with an `'auto'` value defined as "exactly pre-#137 behaviour": the
`TWILIO_*` trio binds Twilio, otherwise the stub, otherwise production refuses. That was the right
call for a change whose job was to *measure* rather than migrate — no deployed config had to move.

It is the wrong call the moment a second vendor account is funded, which is the state the bake-off
creates. Under `'auto'`, an operator who adds a complete `BULKGATE_*` group and forgets the selector
gets **Twilio, silently** — no error, no log line, no boot refusal, and every OTP billed at the
rate the bake-off existed to escape.

This loop retires `'auto'`, making `smsProviderFactory` a pure switch on a stated intent —
structurally identical to `pushProviderFactory` (`services/api/src/features/push/push.module.ts:16-26`),
which this repo already settled on for exactly this shape. It adds the boot log line that makes the
bound provider visible in every environment, pins that the ride-SMS path binds the same factory the
OTP path does, and writes the runbook procedure that turns "switch to X" into an ordered, reversible
operation with a named rollback.

## User Story

As **the operator deploying Sakta Cab after the bake-off**
I want **the API to state which SMS vendor it bound, and to refuse to boot rather than guess**
So that **a switch is a config line I can verify from the logs and reverse in one edit — and a
forgotten one fails loudly at deploy instead of quietly billing Twilio for the whole pilot.**

## Problem Statement

Three concrete defects, all introduced or left open by #240, all invisible to the gate:

**P1 — `'auto'` silently prefers Twilio over a funded candidate.** `auth.module.ts:63-77`
(`origin/main`) falls through to the trio-presence branch for both `'twilio'` and `'auto'`. Post
bake-off the likely `.env` has *two* complete groups. `'auto'` picks Twilio and says nothing.
`auth.module.spec.ts:108-123` already tests the adjacent case (a funded group with **no** Twilio
trio → production refusal, message names both exits) — but with the trio **present** there is no
refusal to reach, because Twilio binds. That is the gap.

**P2 — nothing anywhere names the bound provider.** No log, no health field. `TwilioSmsProvider`,
`BulkGateSmsProvider` and `BudgetSmsProvider` each log their own *sends*, so you learn the binding
from the first SMS — after money has moved. On the dev side the same gap has teeth in reverse: a
developer with real `TWILIO_*` values in `.env` and no selector will, after this change, get the
stub. Without a boot line that is a silent regression; with one it is a visible fact.

**P3 — the runbook's copy-paste template omits `SMS_PROVIDER` entirely.**
`docs/runbooks/hetzner-deploy.md:224` documents the variable in the §3 table, but the dotenv
template at `:232-251` (lines 246-248 carry the Twilio trio) has no `SMS_PROVIDER` line. A box built
from that template runs on the schema default. That is harmless while the default is `'auto'` and
becomes a **failed deploy** the moment the default is anything else — which is what this loop does.
The ordering that avoids it is the single most important thing this plan produces.

## Solution Statement

Five changes, in strict order:

1. **`SMS_PROVIDER: z.enum(['stub', 'twilio', 'bulkgate', 'budgetsms']).default('stub')`** —
   `'auto'` gone, `'stub'` named outright, mirroring `PUSH_PROVIDER`
   (`env.schema.ts:263`, `origin/main`). `'auto'` gets a **custom enum message naming the
   migration**, because zod's own message says what is legal and not what to do.
2. **`smsProviderFactory` becomes a pure switch** — three named branches, then the production
   refusal, then the stub. No credential-presence test survives: the schema's named-kind check
   (`sms-env.schema.ts:262-273`) already guarantees a named kind's whole group.
3. **A boot log line** — `auth.sms.provider_bound`, emitted by the factory.
4. **`notifications.module.spec.ts`** (new) — pins that the ride-SMS module binds `SMS_PROVIDER`
   to auth's `smsProviderFactory`, which is the only thing making #137's AC #2 ("OTP + ride SMS
   both go through it") structurally true. The integration `harness` overrides the token in both
   modules, so no integration test can ever catch this; module metadata is the only place it lives.
5. **Runbook §3 + a new §5.4 switch procedure** — the env table row rewritten, the dotenv template
   given its missing line, the boot-refusal table (`:721-725`) updated, and an ordered, reversible
   switch procedure with the **pre-step that makes the retirement a no-op on the box**.

**The migration is zero-downtime if and only if it is ordered.** `SMS_PROVIDER=twilio` is *already*
accepted by the code on `main` and already binds `TwilioSmsProvider` — so setting it on the box
**before** this PR's image deploys changes nothing on the day and makes the retirement invisible.
Doing it after means a crash-looping container. See Q1.

## Out of Scope / Non-Goals

- **Not included: the verdict, the scorecard's cells, or which vendor wins.** Unchanged from #240:
  that needs three LV SIMs and two funded accounts this machine does not have. #137 stays open.
  **This PR must not close it** — keep closing keywords away from `#137` (see
  `.claude/references/conventions.md`; a bare `#137` in prose has closed an issue before).
- **Not included: sending a live SMS through a switched provider.** That is the verdict loop's
  step, performed with funded credentials. The runbook procedure this plan writes is what that
  loop executes; writing it is not performing it.
- **Not included: removing `TwilioSmsProvider`, `BulkGateSmsProvider` or `BudgetSmsProvider`.**
  Whichever two lose stay bound-able — that is the rollback path, and deleting the loser is a
  separate cleanup after the pilot has run on the winner for a month.
- **Not included: a fallback/failover chain.** Re-stated because retiring `'auto'` will look like
  the moment to add one. #240's Q3 settled it: a silent switch to a second vendor makes the
  scorecard unreadable and the €/week ledger wrong. Exactly one provider binds.
- **Not included: a `/health` field naming the provider.** The boot log is enough and does not
  widen a public, unauthenticated endpoint with vendor information. Noted because it is the
  obvious adjacent idea.
- **Not included: `PUSH_PROVIDER` changes.** It is the precedent being copied, not a thing to
  refactor alongside. It is un-`preprocess`ed and #240 deliberately left it alone.
- **Not changing:** any provider implementation, either consumer (`auth.service.ts`,
  `ride-notifications.service.ts`), `StubSmsProvider`'s behaviour, the `SmsProvider` seam
  (`packages/shared/src/seams/sms-provider.ts` — still `Promise<void>` + throw, #240 Q1), the
  `RecordingSmsProvider` override in `test/harness.ts:548`, or `scripts/sms-bakeoff.ts` (it
  constructs providers directly and never calls the factory — `scripts/sms-bakeoff.ts:96-101`).

## Feature Metadata

**Feature Type**: Refactor + hardening (a selector migration with a documented operational procedure)
**Estimated Complexity**: Low–Medium — the code diff is small and mechanical; the *ordering* and the
runbook are the parts that can be got wrong, and the boot proof is the only real verification
**Primary Systems Affected**: `services/api` config (`common/config/sms-env.schema.ts`), auth slice
(`features/auth/auth.module.ts`), notifications slice (new spec), `.env.example`,
`docs/runbooks/hetzner-deploy.md`
**Dependencies**: none new. zod `^3.25.76` (`services/api/package.json:45`) already present.

## Related Work

**Implements**: [#137](https://github.com/linardsb/taxi/issues/137) — the switch half's *mechanics*,
not its verdict. **Epic**: [#1](https://github.com/linardsb/taxi/issues/1), via
[#13](https://github.com/linardsb/taxi/issues/13).

**Back-references**:

- `.claude/plans/sms-provider-bakeoff-137.md` (**on `origin/main`**) — Why: this plan executes its
  Q2. Its Q1 (no seam result type) and Q3 (no failover) are inherited unchanged.
- `.claude/plans/deploy-hetzner-environment.md` — Why: owns `docs/runbooks/hetzner-deploy.md`, the
  §3 env table and the boot-refusal table this plan edits.
- `.claude/plans/real-sms-provider-twilio.md` (#85) — Why: established the all-or-none group check
  and the production boot refusal that survive here.
- `docs/research/sms-bakeoff-scorecard.md` — Why: its **Verdict** section is the input to the
  *other* follow-up loop, and its row 16 (BudgetSMS credentials travel in the URL) is a decision
  the switch procedure must surface before `SMS_PROVIDER=budgetsms` is ever set in production.

**Forward-references**:

- (none yet) — the verdict loop will link back here when it fills the scorecard.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**Read every one of these from `origin/main`** (`git show origin/main:<path>`), not from the
working tree — this branch is 14 commits behind and four of these files do not exist on it.

- `services/api/src/common/config/sms-env.schema.ts` (whole file, 274 lines) - Why: the file this
  plan edits most. Lines 17-20 are the two selector types; 192-218 the `SMS_PROVIDER` field and its
  `preprocess` wrapper; 234-273 `checkSmsCredentialGroups`, whose named-kind branch at 262 is a
  one-word change.
- `services/api/src/features/auth/auth.module.ts` (lines 15-88) - Why: the factory being rewritten.
  The doc comment at 15-39 is four paragraphs about `'auto'` and must be rewritten, not patched.
  Note lines 41-45: the non-null assertions are documented as resting on the schema, which is
  exactly the property that lets the Twilio branch drop its presence test.
- `services/api/src/features/push/push.module.ts` (lines 8-38) - Why: **the pattern to mirror,
  exactly.** A named-kind enum defaulting to `'stub'`, a factory that switches on it, a production
  refusal naming the variable and the ticket, `useFactory` + `inject: [APP_ENV]`. 38 lines total —
  read all of it.
- `services/api/src/features/auth/auth.module.spec.ts` (whole file, 141 lines) - Why: 7 lines
  mention `'auto'`. The `env()` helper at 17-18 and its `satisfies Partial<Env>` comment (10-16)
  explain why a typo'd key is a TS2561 rather than a green test. Lines 125-140 are the metadata
  test that Task 8 mirrors into the notifications slice.
- `services/api/src/common/config/env.schema.ts` (lines 250-301) - Why: where `smsEnvFields` is
  spread (255), `PUSH_PROVIDER`'s declaration (263) and the `superRefine` (297-301) whose placement
  above `if (env.NODE_ENV !== 'production') return;` is load-bearing.
- `services/api/src/common/config/env.schema.spec.ts` (lines 350-510) - Why: the `#137` describe
  block. 3 lines mention `'auto'` (372, 374, 377, 414). Line 407-417 is the blanked-line edge case
  that must keep passing with the new default.
- `services/api/src/features/notifications/notifications.module.ts` (whole file, 50 lines) - Why:
  the second `SMS_PROVIDER` binding. Its doc comment at 13-20 explains why the duplicate binding is
  deliberate and why `overrideProvider` still catches both — read it before writing Task 8's spec.
- `services/api/src/common/config/app-config.module.ts` (whole file, 26 lines) - Why: `envFilePath:
  ['../../.env', '.env']` and "@nestjs/config never overwrites variables already in process.env".
  This is why a stale repo-root env file breaks a local run after the retirement, and why the box's
  real environment always wins.
- `services/api/test/harness.ts` (lines 454-462, 530, 546-549) - Why: `overrideProvider(SMS_PROVIDER)`
  resolves by token across the whole compiled graph. **This is why no integration test can verify
  the binding** and Task 8 must be a metadata test.
- `services/api/src/features/auth/sms/stub-sms.provider.ts` (line 9) - Why: a stale claim —
  "bound when the `TWILIO_*` trio is set" — that this change falsifies.
- `services/api/src/features/notifications/ride-notifications.service.ts` (lines 42, 70, 137) -
  Why: the two `this.sms.send(...)` call sites that AC #2's "ride SMS" means. Read-only here.
- `docs/runbooks/hetzner-deploy.md` (§3 at 196-263; the dotenv template at 232-251; the refusal
  table at 716-725 — and its preamble at 712-714, which already records the SMS refusal as
  unobserved and asks for exactly the boot this plan performs; §5.1-5.3 at 306-363) - Why: the three regions Tasks 10-12 edit. §5.2 is the rollback the switch procedure
  points at.
- `compose.prod.yml` (lines 31-54) - Why: **`env_file: .env` at line 33.** The whole host env file
  is handed to the api container, so new credentials need no compose change. `environment:` (34-48)
  overrides it and contains no SMS key, so nothing shadows the selector. This is the fact behind
  "the switch is one env var".

### New Files to Create

- `services/api/src/features/notifications/notifications.module.spec.ts` - The metadata pin that
  ride SMS binds the same factory as OTP (AC #2).

### Files to Update

- `services/api/src/common/config/sms-env.schema.ts` - selector types, enum, message, one-word
  refine change, and the doc comments that describe `'auto'`.
- `services/api/src/features/auth/auth.module.ts` - factory rewrite, boot log, new refusal message,
  rewritten doc comment.
- `services/api/src/features/auth/auth.module.spec.ts` - 7 `'auto'` lines; two new cases.
- `services/api/src/common/config/env.schema.spec.ts` - 3 `'auto'` lines; one new failure case.
- `services/api/src/features/auth/sms/stub-sms.provider.ts` - one stale comment line (9).
- `.env.example` - the `SMS_PROVIDER` block (99-107) and the Twilio block's fallback sentence (92-93).
- `docs/runbooks/hetzner-deploy.md` - §3 table row 224, the dotenv template, the refusal table
  721-725, and a new §5.4.

**Who reads the selector — a closed list.** `observed`, unbounded
`git grep -ln 'SMS_PROVIDER' origin/main -- services/api packages` returns twelve files, but only
**five** read the *environment variable*: `env.schema.ts` (spreads the field), `sms-env.schema.ts`
(declares and checks it), `auth.module.ts` (switches on it), plus `env.schema.spec.ts` and
`auth.module.spec.ts`. `scripts/sms-bakeoff.ts` parses the schema but never branches on the
selector. The remaining six — `auth.service.ts`, `auth/index.ts`, `sms/sms.tokens.ts`,
`notifications.module.ts`, `ride-notifications.service.ts`, `test/harness.ts` — use the **DI token**
of the same name (`sms.tokens.ts` is one line: `export const SMS_PROVIDER = 'SMS_PROVIDER';`). The
collision is deliberate and documented at `sms-env.schema.ts:203-206`; do not "disambiguate" it.

**Task-runner env passlist: no change needed, and here is why.** `observed` — `turbo.json`'s
`globalEnv` is `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `OTP_PEPPER`, `API_PORT`,
`REDIS_TEST_URL`; the `test` task declares no `env` of its own. `SMS_PROVIDER` is absent today and
stays absent: no test reads it from the process environment — the specs construct `Env` objects
directly or call `envSchema.parse(dev({...}))` — so strict-mode stripping leaves integration boots
on the schema default, which after this change is `'stub'`, which is what a test wants. Adding it to
`globalEnv` would put a value nobody reads into the cache key. Stated because #240 faced the same
question and a reviewer will ask.

`observed` — `git grep -c` over `origin/main` finds **26 lines** mentioning `auto` across six
files: `sms-env.schema.ts` 8, `auth.module.spec.ts` 7, `auth.module.ts` 4, `env.schema.spec.ts` 3,
`.env.example` 2, `hetzner-deploy.md` 2. Not every one is the selector (`auto` appears inside other
words); read each. Treat 26 as the **search set**, not the edit count.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [zod 3 — custom error messages on `z.enum`](https://zod.dev/ERROR_HANDLING?id=customizing-errors)
  - Specific section: per-schema `params` vs `errorMap`
  - Why: the migration message depends on which param zod actually honours for an out-of-range
    enum value. See GOTCHA on Task 2 — one of the two obvious spellings is a silent no-op, and it
    is the one whose name sounds right.
- `.claude/references/logging-standard.md` (lines 1-16)
  - Specific section: `domain.component.action_state`, and the always/never-log lists
  - Why: Task 4 adds an event. Domain `auth`, component `sms`. **Never log a credential** — the
    line names the *kind*, never a value from a credential group.
- `.claude/references/conventions.md`
  - Specific section: issue-closing keywords
  - Why: this PR must **not** close #137.
- `docs/research/sms-bakeoff-scorecard.md` — **Verdict** section
  - Why: its two legal verdict forms are what §5.4 is the procedure for. Row 16 (BudgetSMS
    GET-only) is a precondition §5.4 must state before `budgetsms` is bound in production.

### Patterns to Follow

**A provider factory (`push.module.ts:16-26`, `origin/main`) — copy this shape:**

```ts
export function pushProviderFactory(env: Env): PushProvider {
  if (env.PUSH_PROVIDER === 'expo') {
    return new ExpoPushProvider({ accessToken: env.EXPO_PUSH_ACCESS_TOKEN });
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'No production PushProvider is bound: StubPushProvider delivers nothing. Set PUSH_PROVIDER=expo (#14) before running with NODE_ENV=production.',
    );
  }
  return new StubPushProvider();
}
```

The message names **the variable, the value, the ticket and the consequence**. Match that register.

**A stated-intent selector (`env.schema.ts:263`, `origin/main`):**

```ts
PUSH_PROVIDER: z.enum(['stub', 'expo']).default('stub'),
```

`'stub'` is a *named kind*, not an absence. That is the whole idea being copied.

**A module-metadata pin (`auth.module.spec.ts:125-140`, `origin/main`):**

```ts
const providers = Reflect.getMetadata('providers', AuthModule) as {
  provide?: unknown; useClass?: unknown; useFactory?: unknown; inject?: unknown[];
}[];
const sms = providers.find((p) => p.provide === SMS_PROVIDER);
expect(sms?.useFactory).toBe(smsProviderFactory);
expect(sms?.inject).toEqual([APP_ENV]);
expect(sms?.useClass).toBeUndefined();
```

**A structured log (`stub-sms.provider.ts:19-24`):** `event`, the identifying fields, `at` as an
ISO string. Phones masked via `maskPhone`. Nothing here logs a phone, so only `event`/`at` apply.

---

## IMPLEMENTATION PLAN

### Phase 1: The selector

Retire `'auto'` in the schema. Everything else follows from the type change — do this first and let
`typecheck` enumerate the call sites.

**Tasks:** selector types, the enum + migration message, the one-word refine change, comment rewrites.

### Phase 2: The factory

**Depends on:** Phase 1 (the `'auto'` branch cannot go until the type does).

**Tasks:** pure switch, boot log, new refusal message, doc-comment rewrite.

### Phase 3: Specs

**Depends on:** Phase 2.

**Tasks:** update the two existing specs, add the notifications metadata pin, add the migration-message
and stub-in-production cases.

### Phase 4: Config surfaces and docs

**Independent of:** Phase 3 — different files, no shared symbol. Safe to interleave; keep the
commits separate.

**Tasks:** `.env.example`, runbook §3 table + template, the refusal table, the new §5.4.

### Phase 5: The boot proof

**Depends on:** Phases 1-4 (needs a built image and the finished refusal messages).

**Tasks:** build the production image and boot it four ways. The gate never runs under
`NODE_ENV=production`, so this is the only verification of the thing this ticket changes.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom.

**Before Task 1** — create a worktree off `origin/main`, because this checkout is 14 behind and two
other Claude sessions share the tree:

`observed` — `git worktree list` already carries `~/taxi-worktrees/wt-137` on
`feature/sms-provider-bakeoff-137` (the merged PR #240). Use a **different** path and branch name;
the two below do not collide with anything in that list.

```bash
git fetch origin --prune
git worktree add ~/taxi-worktrees/wt-137-switch -b feature/sms-provider-switch-137 origin/main
cp .env ~/taxi-worktrees/wt-137-switch/.env     # a worktree without one HANGS a REDIS_TEST_URL gate

# THIS PLAN IS UNTRACKED. A worktree does not carry untracked files — copy it, first thing:
cp .claude/plans/sms-provider-switch-137.md ~/taxi-worktrees/wt-137-switch/.claude/plans/
```

**Then commit the plan on the feature branch before writing any code**, so the evidence in BASELINE
travels with the PR the way #240's plan did. A 1232-line artifact carrying four production boots
that nobody will re-run cheaply has exactly one failure mode: it stays untracked in a checkout that
is 14 commits behind, and is lost. Five review reports orphaned that way already (#138-#142, landed
late as #143).

Run everything DB-touching in that worktree with `COMPOSE_PROJECT_NAME=taxi`.

### UPDATE `services/api/src/common/config/sms-env.schema.ts` — the two selector types

- **IMPLEMENT**: `SmsProviderKind` stays `'twilio' | 'bulkgate' | 'budgetsms'` (it is the key type
  of `SMS_GROUPS`, and `'stub'` has no credential group). `SmsProviderSelector` becomes
  `'stub' | SmsProviderKind`. Rewrite both doc comments (17, 19): `'auto'` no longer exists, and
  `'stub'` is "the kind that delivers nothing and that production refuses".
- **PATTERN**: `sms-env.schema.ts:16-20`, `origin/main`.
- **GOTCHA**: do **not** add `'stub'` to `SmsProviderKind`. `SMS_GROUPS` is
  `Record<SmsProviderKind, {prefix, keys}>` (49-52) and would then demand a credential group for
  the stub — which has none, so there is nothing to put in `keys`.
- **VALIDATE**: `cd services/api && npx tsc --noEmit -p tsconfig.json 2>&1 | head -30` — expect
  errors, listing exactly the `'auto'` sites Tasks 2-9 fix. That list is the work.
- **SATISFIES**: AC #1

### UPDATE `services/api/src/common/config/sms-env.schema.ts` — the enum and the migration message

- **IMPLEMENT**: `z.enum(['stub', 'twilio', 'bulkgate', 'budgetsms'], { message: … }).default('stub')`
  inside the existing `z.preprocess` wrapper (207-218). The message must name the retirement, the
  replacement values, and the ticket — zod's default message lists the legal values but says nothing
  about `'auto'` specifically, and `'auto'` is the one value a real deploy will actually contain.
  Suggested: `` `SMS_PROVIDER=auto was retired (#137): name the provider outright — stub | twilio | bulkgate | budgetsms. 'stub' delivers nothing and production refuses it.` ``
- **PATTERN**: `env.schema.ts:263` for the enum shape; keep #240's `preprocess` and the comment at
  208-215 explaining it (the blanked-line reason is unchanged, only the default value moves).
- **IMPORTS**: none new.
- **GOTCHA — two of them, both verified, both silent if got wrong:**
  1. `{ invalid_type_error: '…' }` is **ignored** for an out-of-range enum value. `observed`, node
     REPL against this tree's zod 3.25.76: `z.enum([...], {invalid_type_error:'X'}).parse('auto')`
     still throws `Invalid enum value. Expected 'stub' | …, received 'auto'`. `{ message: '…' }`
     and `{ errorMap }` both work. Use `{ message }`.
  2. **A failing enum short-circuits the object's `superRefine` entirely.** `observed`, same probe:
     with `SMS_PROVIDER: 'auto'` the object-level `superRefine` did **not** run and the only issue
     raised was the enum's. So the migration message **cannot** live in
     `checkSmsCredentialGroups` — code there would never execute. It must be on the enum.
  3. A custom `message` **replaces** zod's whole default string, so the legal values are no longer
     listed for you. List them in the message yourself (the suggestion above does).
- **VALIDATE**:
  ```bash
  cd services/api && node -e "
  const {z}=require('zod');const {envSchema}=require('./src/common/config/env.schema');" \
    || true   # the schema is TS; assert through the spec instead:
  npx jest src/common/config/env.schema.spec.ts 2>&1 | tail -20
  ```
  (Task 7 adds the assertion; until then expect the three `'auto'` cases to fail — that is correct.)
- **SATISFIES**: AC #1, AC #4

### UPDATE `services/api/src/common/config/sms-env.schema.ts` — the named-kind check

- **IMPLEMENT**: `checkSmsCredentialGroups`, line 262: `if (env.SMS_PROVIDER !== 'auto')` becomes
  `if (env.SMS_PROVIDER !== 'stub')`. Update the comment at 259-261 — `'stub'` demands no group
  because it *has* none, which is a different reason from `'auto'`'s "it is today's behaviour".
- **PATTERN**: unchanged control flow; only the sentinel moves.
- **GOTCHA**: `SMS_GROUPS[env.SMS_PROVIDER]` at 263 narrows to `SmsProviderKind` off this guard. If
  the guard is wrong the index is `undefined` at runtime and `.keys` throws a `TypeError` at boot
  — typecheck catches it only because `SmsProviderSelector` is exactly `'stub' | SmsProviderKind`.
  Do not widen either type "just in case".
- **VALIDATE**: `cd services/api && npx tsc --noEmit -p tsconfig.json 2>&1 | grep sms-env` → empty
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/auth/auth.module.ts` — the factory

- **IMPLEMENT**: replace the body of `smsProviderFactory` (46-87) with a pure switch:
  `'twilio'` → `TwilioSmsProvider`, `'bulkgate'` → `BulkGateSmsProvider`, `'budgetsms'` →
  `BudgetSmsProvider`, then `NODE_ENV === 'production'` → throw, then `new StubSmsProvider()`.
  The Twilio branch now uses non-null assertions on the trio like the other two, for the same
  documented reason (41-45). Add the boot log immediately before each `return`, or once via a small
  local helper — either is fine, one `event` name:
  ```ts
  logger.log({ event: 'auth.sms.provider_bound', provider: env.SMS_PROVIDER, at: new Date().toISOString() });
  ```
  with `const logger = new Logger('smsProviderFactory');` at module scope.
- **PATTERN**: `push.module.ts:16-26` for the switch and refusal; `stub-sms.provider.ts:19-24` for
  the log object's shape.
- **IMPORTS**: add `Logger` to the existing `@nestjs/common` import (currently `{ Module }`, line 1).
- **GOTCHA**:
  - **Log the kind, never a credential.** `provider: env.SMS_PROVIDER` only. Not the sender ID, not
    a masked token, not the application id. `logging-standard.md`'s never-log list.
  - **This line is emitted TWICE per boot.** `observed` at plan time, not inferred: a throwaway
    Nest probe registering the real `SMS_PROVIDER` token with a counting wrapper around the real
    `smsProviderFactory`, in two sibling modules fed `APP_ENV` by a `@Global()` config module —
    the exact shape of `auth.module.ts:110-114` and `notifications.module.ts:41-45` — printed
    `factory invocations at boot : 2` and two distinct `StubSmsProvider` objects. Run twice, same
    result; probe deleted. Two identical lines are correct and are the operator-visible evidence
    that both SMS paths bound the same vendor. Say so in the comment; a reader who assumes it is a
    bug will "fix" it by exporting auth's binding, which `notifications.module.ts:18-20` explains
    gives away the production refusal.
  - **If you ever assert the two instances are distinct, `{ strict: true }` is mandatory.**
    `observed` in the same probe: `app.select(M).get(SMS_PROVIDER)` returns the **same object** for
    both modules (non-strict resolution walks the container), while
    `app.select(M).get(SMS_PROVIDER, { strict: true })` returns two. A test written without the
    flag asserts the opposite of what it reads as.
  - **The refusal message must change.** It currently offers the `TWILIO_*` trio as an alternative
    to `SMS_PROVIDER` ("*Either* set … *or* set …", line 84). After this change the trio is not an
    alternative to anything — `SMS_PROVIDER` is always required. A message left as-is sends an
    operator to set three variables that will not bind. New message must say: production reached
    the stub; set `SMS_PROVIDER` to `twilio`, `bulkgate` or `budgetsms` together with that group's
    credentials (#85, #137).
- **VALIDATE**: `cd services/api && npx jest src/features/auth/auth.module.spec.ts 2>&1 | tail -25`
- **SATISFIES**: AC #1, AC #2, AC #3

### UPDATE `services/api/src/features/auth/auth.module.ts` — the doc comment

- **IMPLEMENT**: rewrite lines 15-39. Three of its four paragraphs describe `'auto'` and
  trio-presence-as-selection; both are gone. Keep what survives and is still load-bearing: why the
  stub is refused in production (the OTP *is* the credential, lines 19-23), that this is a
  selection and never a failover (28-31), and the non-null-assertion reasoning (41-45). Add one
  sentence recording what `'auto'` was and why it went, so the next reader does not re-propose it.
- **PATTERN**: the register of `push.module.ts:8-15` — short, names the ticket, names the
  consequence of the refusal.
- **GOTCHA**: this is the comment the reviewer will read first. A number or guarantee in it is a
  claim (CLAUDE.md). Do not write "one env var" without saying which file it lives in on the box.
- **VALIDATE**: `cd services/api && npx eslint src/features/auth/auth.module.ts`
- **SATISFIES**: AC #6

### UPDATE `services/api/src/features/auth/sms/stub-sms.provider.ts` — the stale claim

- **IMPLEMENT**: line 9 says the real implementation is "bound when the `TWILIO_*` trio is set".
  False after this change. Replace with: bound when `SMS_PROVIDER` names it.
- **PATTERN**: n/a — a one-line correction.
- **GOTCHA**: **grep the subject, not the sentence.** CLAUDE.md's rule: retiring a bad claim means
  retiring its subject. The subject here is *trio-presence-as-selection*. `observed` on
  `origin/main`, the phrase survives in **five** places: `.env.example:101`,
  `hetzner-deploy.md:224`, `sms-env.schema.ts:194`, `auth.module.ts:16-19`,
  `stub-sms.provider.ts:9`. Tasks 1-5 and 9-10 cover four; this is the fifth. Re-run
  `git grep -nE "trio (is set|binds)|trio-presence"` before committing and expect **zero** hits.
- **VALIDATE**: `git grep -nE "trio (is set|binds)|trio-presence" -- services/api docs .env.example` → empty
- **SATISFIES**: AC #6

### UPDATE `services/api/src/features/auth/auth.module.spec.ts`

- **IMPLEMENT**: the `env()` helper (17-18) default becomes `SMS_PROVIDER: 'stub'`. Update the
  comment at 10-16 (it explains why `'auto'` was the realistic default). Then, per case:
  - "provides the stub outside production" (40-45) — unchanged behaviour, still passes.
  - "binds the Twilio provider whenever the trio is present" (47-56) — **this case's premise is
    gone.** Rewrite as "binds Twilio when `SMS_PROVIDER` names it", passing
    `{ ...TRIO, SMS_PROVIDER: 'twilio' }`.
  - "lets an explicitly named kind beat a present `TWILIO_*` trio" (76-91) — keep; it is now the
    ordinary case rather than the edge, but it still pins the property that matters.
  - "refuses to boot in production" (93-106) — drop the `'auto'` half (101-105), keep the first.
  - "names BOTH exits when a funded candidate group is present but unselected" (108-123) — the
    message no longer has two exits. Rewrite to assert the new message names `SMS_PROVIDER` and
    the three selectable kinds.
  - **ADD (edge, the case P1 names):** `{ ...TRIO, ...BULKGATE_GROUP, SMS_PROVIDER: 'stub' }` under
    `NODE_ENV: 'production'` **throws** — where before the retirement the identical env bound
    Twilio silently. This is the regression test for the defect this loop exists to close.
  - **ADD (edge):** `{ ...TRIO }` with no selector, `NODE_ENV: 'development'` → `StubSmsProvider`.
    The dev-ergonomics change from P2, pinned so it is a decision rather than a surprise.
- **PATTERN**: the file's own `satisfies Partial<Env> as Env` helper — keep it; it is what makes a
  mistyped key a TS2561 instead of a green test.
- **GOTCHA**: `smsProviderFactory` now logs. Jest will print two lines per case unless the Nest
  `Logger` is quieted. Check whether the suite already silences it; if not, leave the noise rather
  than adding a global mock — a spec that mocks the logger cannot assert Task 4's event, and a
  later ticket may want to.
- **VALIDATE**: `cd services/api && npx jest src/features/auth/auth.module.spec.ts 2>&1 | tail -25`
- **SATISFIES**: AC #3, AC #4

### CREATE `services/api/src/features/notifications/notifications.module.spec.ts`

- **IMPLEMENT**: one describe, mirroring `auth.module.spec.ts:125-140`: read
  `Reflect.getMetadata('providers', NotificationsModule)`, find the entry whose `provide` is
  `SMS_PROVIDER`, assert `useFactory` **is** `smsProviderFactory` (identity, not a same-shaped
  function), `inject` equals `[APP_ENV]`, and `useClass` is undefined. One sentence in the
  comment saying why this is the only possible home for the assertion.
- **PATTERN**: `auth.module.spec.ts:125-140` verbatim in shape.
- **IMPORTS**: `Reflect` metadata needs `reflect-metadata` already loaded — it is, via Nest's own
  imports in the sibling spec; mirror that file's import list exactly.
  `import { smsProviderFactory, SMS_PROVIDER } from '../auth';` — the same path
  `notifications.module.ts:3` uses, not a deep import.
- **GOTCHA**: **do not write this as an integration test.** `test/harness.ts:548` calls
  `.overrideProvider(SMS_PROVIDER).useValue(sms)`, which resolves by token across the whole
  compiled graph (`harness.ts:552-555` says so) — so a `RecordingSmsProvider` would be injected
  into `RideNotificationsService` whether or not the module binds the factory at all. An
  integration test here is **green on a broken binding**. This is the same class of defect as
  #16's C1: a test that pins the wiring it replaced.
- **VALIDATE**: `cd services/api && npx jest src/features/notifications/notifications.module.spec.ts 2>&1 | tail -20`
  — then **revert `notifications.module.ts`'s `SMS_PROVIDER` provider entry (41-45) and re-run: it
  must go red.** A metadata test that passes against a deleted binding pins nothing. Restore after.
- **SATISFIES**: AC #2

### UPDATE `services/api/src/common/config/env.schema.spec.ts`

- **IMPLEMENT**: in the `#137` block (350-510):
  - 372-377 "defaults to auto…" → "defaults to stub…", asserting `'stub'`.
  - 407-417 the blanked-line edge — keep; update the expected value at 414 from `'auto'` to
    `'stub'`. The `'  '` (whitespace) case at 417 must still throw.
  - **ADD (failure):** `SMS_PROVIDER: 'auto'` throws, and the thrown message **matches the
    migration text** — e.g. `/SMS_PROVIDER=auto was retired/`. Without this assertion the custom
    message is untested and a later refactor silently reverts to zod's generic one.
  - 423-437 named-kind-needs-its-group cases — unaffected, re-run to confirm.
- **PATTERN**: the block's existing `dev({...})` helper.
- **GOTCHA**: `env.schema.spec.ts` is **510 lines** on `origin/main` (`observed`, `wc -l`). The
  `max-lines` cap is 500 for *shipped source*; `.spec.ts` files are **outside the rule and
  uncapped** (#112, CLAUDE.md). Adding cases here is fine; do not "fix" the length.
- **VALIDATE**: `cd services/api && npx jest src/common/config/env.schema.spec.ts 2>&1 | tail -25`
- **SATISFIES**: AC #4

### UPDATE `.env.example`

- **IMPLEMENT**: `SMS_PROVIDER=auto` (line 107) → `SMS_PROVIDER=stub`. Rewrite the comment block
  (99-106): `'auto'` is retired; `'stub'` logs the OTP to the console and production refuses it;
  naming a kind demands that kind's whole group. Fix line 101's trio-binds sentence. Also fix the
  Twilio block's line 92-93 ("Empty in dev: OTP + ride SMS fall back to the console-logging stub")
  — after this change they fall back because `SMS_PROVIDER=stub`, not because the trio is empty.
- **PATTERN**: the file's existing comment style — a `# ---` header, then the reasoning.
- **GOTCHA**: **the `PreToolUse` hook blocks Bash commands whose TEXT contains dotenv-style
  strings.** Edit this file with the Write/Edit tools by path. Do not `sed`, `cat >` or heredoc it,
  and do not put its contents in a commit message written with `-m`; use `-F` from the scratchpad.
- **VALIDATE**: `git diff --stat -- .env.example` and read the diff by eye — this file is not
  linted.
- **SATISFIES**: AC #5

### UPDATE `docs/runbooks/hetzner-deploy.md` — §3 table row and the missing template line

- **IMPLEMENT**: two edits in §3 (196-263):
  1. Row 224: default `auto` → `twilio` (the box's current real binding), and rewrite the cell.
     `'auto'` is retired; the value is **required in production** in the same sense
     `PUSH_PROVIDER` is (row 216 is the wording to mirror); `stub` is refused at boot. Keep the
     "selection, never failover" sentence — it is still true and still worth saying.
  2. The dotenv template (232-251): add `SMS_PROVIDER=twilio` immediately after the three
     `TWILIO_*` lines (246-248). **It is absent today** (`observed`) — this is defect P3, and a box
     built from the template as it stands will refuse to boot after this change.
- **PATTERN**: row 216 (`PUSH_PROVIDER` | `expo` | "**Required in production** (#14)…").
- **GOTCHA**: the template is a fenced ```dotenv block. Same hook constraint as the previous task —
  write by path.
- **VALIDATE**: `grep -n 'SMS_PROVIDER' docs/runbooks/hetzner-deploy.md` → at least one hit inside
  the fenced template block, and `sed -n '230,255p'` reads as a complete, copyable file.
- **SATISFIES**: AC #5

### UPDATE `docs/runbooks/hetzner-deploy.md` — the boot-refusal table

- **IMPLEMENT**: the table at 716-725. Its preamble (712-714) already states that the SMS refusal
  is observed only at schema level and that nobody has confirmed it stops the container — "Boot the
  image before the next deploy and move it into the observed set." Task 13 is that boot; discharge
  the sentence rather than leaving it standing — **the text is already in this plan's BASELINE
  section (probe C), captured from a real container on `origin/main`**, so Task 13 only has to
  confirm it has not moved rather than produce it from nothing.
  Rows 721-725: Row 722's trigger ("no `TWILIO_*` at all, `SMS_PROVIDER` unset or
  `auto`") and its quoted message are both wrong after this change. Replace with three rows:
  `SMS_PROVIDER=auto` → the migration message (a `ZodError`, every environment);
  `SMS_PROVIDER=stub` or unset, `NODE_ENV=production` → the new factory refusal;
  `SMS_PROVIDER=<kind>` with an incomplete group → the existing named-kind message (row 725,
  unchanged, but re-label it `observed` once Task 13 has actually produced it).
- **PATTERN**: the table's existing two-column trigger/message shape.
- **GOTCHA**: row 725 is currently labelled `expected`. Task 13's boot proof turns it and the two
  new rows into `observed` — **paste the messages the container actually printed**, not the ones
  this plan predicts. A figure or quotation under an Observed label that no run produced is the
  defect (#107).
- **VALIDATE**: after Task 13, every row in the table carries a provenance label and every
  `observed` one quotes a message from that run's log.
- **SATISFIES**: AC #5, AC #7

### CREATE `docs/runbooks/hetzner-deploy.md` §5.4 — "Switch the SMS provider"

- **IMPLEMENT**: a new subsection after §5.3 (351-363). The ordered procedure:
  1. **Preconditions** — the scorecard's verdict is recorded and names this vendor; the account is
     funded with more than one month's segments; for `budgetsms` specifically, scorecard row 16
     (credentials and every message body travel in the URL, GET-only) has been read and accepted.
  2. **Add the group** to `/opt/taxi/.env`. Do not remove the outgoing vendor's group — it is the
     rollback.
  3. **Flip** `SMS_PROVIDER` to the new kind.
  4. `docker compose -f docker-compose.yml -f compose.prod.yml up -d --wait api` — `--wait` fails
     the command on a crash loop rather than leaving one running (compose 5.1.0).
  5. **Verify from the log, before any rider does**: `docker compose logs api | grep
     auth.sms.provider_bound` → **two** lines, both naming the new kind. Two, because `AuthModule`
     and `NotificationsModule` each bind. **One line means only one SMS path switched** and is the
     signal to roll back.
  6. **One live OTP** to a handset, checking sender and body.
  7. **Rollback**: flip `SMS_PROVIDER` back, `up -d --wait api`, re-check the two log lines. No
     image change, so §5.2's image rollback is not involved — say so, since that is the procedure
     an operator would otherwise reach for.
- **PATTERN**: §5.1/§5.2's numbered-command shape, each step with its verification.
- **GOTCHA**: steps 6 and 7 are **executable only with a funded account**, which this machine does
  not have. They are documented here and **performed by the verdict loop** — mark them as such in
  the text. Steps 1-5 and the rollback mechanics are verifiable now (Task 13 covers 4-5 with fake
  credentials). Do not write the section as if it has been run end to end.
- **VALIDATE**: read §5.4 against the §3 table — every variable it names must exist in the table
  with the same spelling.
- **SATISFIES**: AC #5, AC #8

### VALIDATE — the production boot proof

- **IMPLEMENT**: not a code change. Build the image and boot it four ways under
  `NODE_ENV=production` (recipe in Level 4 below). Record each container's first error or its
  `auth.sms.provider_bound` lines. Paste those strings into the runbook's refusal table (Task 12)
  and into the implementation report.
- **PATTERN**: the seven-gate probe in `docs/runbooks/hetzner-deploy.md` §8.3, and #147's approach.
- **GOTCHA**: **the gate never boots anything under `NODE_ENV=production`** — `typecheck lint test
  build` all run in dev/test. Everything this ticket changes about production behaviour is
  invisible to a green gate. Also: bind mounts for the probe need a `$HOME` path, not the
  scratchpad. Paths inside the runtime image are under `node_modules/@taxi/db/dist/…` since the
  `pnpm deploy` runtime.
- **VALIDATE**: four probes, four recorded outcomes — see Level 4.
- **SATISFIES**: AC #7

### VALIDATE — the full gate

- **IMPLEMENT**: from a cleared `dist/` and `apps/dispatch/.next`, in the worktree.
- **VALIDATE**:
  ```bash
  cd ~/taxi-worktrees/wt-137-switch
  node -e "const fs=require('fs');for(const p of ['services/api/dist','packages/shared/dist','apps/dispatch/.next']){fs.rmSync(p,{recursive:true,force:true})}"
  COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
  ```
  Expect **22 tasks**. A stale `apps/dispatch/.next` makes the gate go red in ~25 s on a TS6053 in
  dispatch typecheck — that is the race, not the code. An `@taxi/api` integration suite that flakes
  under the full gate and passes alone is the known shared-test-DB collision: re-run, do not
  diagnose. A hang past ~3 min with no output flushed is the same family.
- **SATISFIES**: AC #3, AC #6

---

## TESTING STRATEGY

### Unit Tests

Jest, in `services/api`, colocated with the slice. Four files:

| File | Change | Cases |
|---|---|---|
| `auth.module.spec.ts` | update + 2 new | expected: each named kind binds its provider · edge: named kind beats a present trio · edge: **trio + funded group + `stub` in production throws** (the P1 regression) · edge: trio present, no selector, dev → stub · failure: production refusal message names `SMS_PROVIDER` and the three kinds |
| `notifications.module.spec.ts` | **new** | edge: `NotificationsModule` binds `SMS_PROVIDER` to `smsProviderFactory` with `inject: [APP_ENV]` |
| `env.schema.spec.ts` | update + 1 new | expected: default is `'stub'` · edge: a blanked line reads as unset · **failure: `'auto'` throws with the migration message** |
| — | unchanged | the named-kind-needs-its-group cases (423-437) must still pass untouched |

`observed` baseline to compare against, from PR #240's merged head: `@taxi/api` `Tests: 39 skipped,
723 passed, 762 total`, `Test Suites: 2 skipped, 77 passed, 77 of 79 total` (without
`REDIS_TEST_URL`). This plan adds one suite and roughly 4-6 tests; state the exact delta in the
report by counting `it(` per changed file, not by subtracting totals.

### Integration Tests

**None, deliberately — and this is a finding, not an omission.** `test/harness.ts:548` overrides
`SMS_PROVIDER` by token across the whole compiled graph, so every integration test injects
`RecordingSmsProvider` regardless of what the factory would return. An integration test asserting
"ride SMS uses the selected provider" is **green against a deleted binding**. The metadata test in
Task 8 is the only assertion that can fail for the right reason, and Task 8's VALIDATE step requires
proving it by reverting the binding.

The existing integration suites still matter as a regression check — they boot the real
`AppModule`, so a schema that refuses to parse under `NODE_ENV=test` fails all of them at once.
That is the signal to watch for after Phase 1.

### Edge Cases

Every case names where it is verified.

| # | Edge case | Verified in |
|---|---|---|
| E1 | `SMS_PROVIDER=auto` in an existing env file | `env.schema.spec.ts`, new failure case; **and** Level 4 probe 3 |
| E2 | Blanked line `SMS_PROVIDER=` | `env.schema.spec.ts:407-417`, expected value updated |
| E3 | Whitespace-only `'  '` | `env.schema.spec.ts:417`, unchanged — must still throw |
| E4 | Trio + funded BulkGate group + no selector, production | `auth.module.spec.ts`, **new** — the P1 regression |
| E5 | Trio present, no selector, development | `auth.module.spec.ts`, **new** — the P2 dev-ergonomics change |
| E6 | Named kind with an incomplete group | `env.schema.spec.ts:423-437`, unchanged |
| E7 | `SMS_PROVIDER=stub` under `NODE_ENV=production` | Level 4 probe 2 — the factory refusal, in a real container |
| E8 | Both SMS paths bound to the same kind | Task 8 metadata test; **and** a plain `pnpm --filter @taxi/api dev` boot against the local stack, which must print `auth.sms.provider_bound` **twice**. The factory logs at instantiation regardless of `NODE_ENV`, so this needs no container — probe 1 reproduces it but is not its only source |
| E9 | A box whose `.env` has no `SMS_PROVIDER` line at all (today's likely state) | Level 4 probe 2 — identical to E7, since the default is `'stub'`. **This is the deploy-day failure**, and Q1 is its answer |
| E10 | `sms:bakeoff` still runs after the selector change | Level 4 probe 5. **Read its GOTCHA first** — an unsourced shell exits 1 on `DATABASE_URL` before the selector is ever reached, and a shell sourced from an un-migrated env file exits 1 on the migration message. Neither is the script being broken |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
cd ~/taxi-worktrees/wt-137-switch
pnpm --filter @taxi/api lint
pnpm --filter @taxi/api typecheck
```

`max-lines` headroom, `observed` on `origin/main` via `wc -l`: `env.schema.ts` 351,
`sms-env.schema.ts` 274, `auth.module.ts` 119, `notifications.module.ts` 50. The cap is 500 for
shipped source. `auth.module.ts` gains a `Logger` and loses a branch — net near zero; nothing here
approaches the cap. Specs are uncapped (#112).

### Level 2: Unit Tests

```bash
cd ~/taxi-worktrees/wt-137-switch/services/api
npx jest src/common/config/env.schema.spec.ts src/features/auth/auth.module.spec.ts src/features/notifications/notifications.module.spec.ts
```

### Level 3: Integration Tests

```bash
cd ~/taxi-worktrees/wt-137-switch
cp /Users/Berzins/Desktop/taxi/.env .env       # a worktree without one HANGS the gate silently
docker ps --filter name=taxi-redis-1 --format '{{.Names}} {{.Status}}'   # must be Up first
node -e "const fs=require('fs');for(const p of ['services/api/dist','packages/shared/dist','apps/dispatch/.next']){fs.rmSync(p,{recursive:true,force:true})}"
COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
```

One gate at a time across sessions — global-setup drops the shared `taxi_api_test` database and the
name is hardcoded, so a worktree does not isolate it. Check `git reflog -8` and `ps` first.

### Level 4: Manual Validation

**The production boot proof. This is the only verification of what this ticket changes** — the gate
never boots under `NODE_ENV=production`.

All five probes are performable on this machine **now**: constructing a provider does not dial its
vendor, so schema-valid fake credentials boot successfully and send nothing.

**The recipe below is not improvised — it is the one `#147` proved out and this session
re-confirmed.** `observed` 2026-09-21: docker `29.2.1`, network **`taxi_default`** exists,
`taxi-db-1` and `taxi-redis-1` are Up and healthy, and `docker exec taxi-db-1 psql -U taxi -d
postgres` answers. Six mechanical traps, every one of which has cost a session before:

| Trap | The rule |
|---|---|
| Unset vs empty | An "unset" case is `grep -v` over a base file into a variant file — **never** a `-e VAR=` override. For an enum, empty and unset are different cases and the preprocess at `sms-env.schema.ts:216` treats them differently |
| Bind mounts | Only work from a `$HOME` path. The `/private/tmp/...` scratchpad fails with a mount error. **`--env-file` is read by the docker CLI, not the VM, so it IS fine from the scratchpad** |
| Env-file name | Name it `prod-vars.list`, not a dotenv-ish name — the `PreToolUse` hook matches command **text** |
| Waiting | `curl -fsS --retry 30 --retry-delay 1 --retry-all-errors --retry-connrefused`. A foreground `sleep` loop is blocked |
| Hook batching | Put the whole thing in a file and run `bash <scratchpad>/probe.sh`, so the hook sees one path instead of the env-var text |
| Runtime paths | The image is `pnpm deploy` output — migrations live at `node_modules/@taxi/db/dist/migrate-run.js`, and `CMD` is `node dist/main.js` |

```bash
# 0 · build (root context; layer cache makes a rebuild seconds)
cd ~/taxi-worktrees/wt-137-switch
docker build -f services/api/Dockerfile -t taxi-api:switch137 .

# 1 · scratch database on the shared compose Postgres
docker exec taxi-db-1 psql -U taxi -d postgres -c 'CREATE DATABASE sms137'

# 2 · base env file -> <scratchpad>/prod-vars.list
#     Take every gated variable from docs/runbooks/hetzner-deploy.md §3's table.
#     Values that matter: JWT_SECRET and OTP_PEPPER 64 hex and DIFFERENT;
#     PUBLIC_TRACKING_BASE_URL an https origin; ALLOW_STUB_MAPS_PROVIDER true;
#     GOOGLE_MAPS_API_KEY any non-empty; PUSH_PROVIDER expo; STRIPE key empty;
#     DATABASE_URL -> postgres://taxi:taxi@db:5432/sms137 ; REDIS_URL -> redis://redis:6379
#     (hostnames `db` and `redis` resolve on the taxi_default network, not localhost —
#      localhost:5432 and :6379 are shadowed on this machine by a brew Postgres and a tunnel)

# 3 · migrate once, with the image itself
docker run --rm --network taxi_default --env-file <scratchpad>/prod-vars.list \
  taxi-api:switch137 node node_modules/@taxi/db/dist/migrate-run.js

# 4 · a probe: boot, wait, read, tear down
docker run -d --name p1 --network taxi_default -p 127.0.0.1:3901:3001 \
  --env-file <scratchpad>/p1.list taxi-api:switch137
curl -fsS --retry 30 --retry-delay 1 --retry-all-errors --retry-connrefused \
  http://127.0.0.1:3901/health
docker logs p1 2>&1 | grep -c auth.sms.provider_bound      # expect 2
docker rm -f p1

# 5 · a refusal probe reads the logs of a container that exited
docker run --name p2 --network taxi_default --env-file <scratchpad>/p2.list taxi-api:switch137
docker logs p2 2>&1 | tail -20                              # the message, verbatim
docker rm -f p2

# 6 · after all probes
docker exec taxi-db-1 psql -U taxi -d postgres -c 'DROP DATABASE sms137'
docker rmi taxi-api:switch137
```

Variant files are `grep -v` over the base: `grep -v '^SMS_PROVIDER' prod-vars.list > p2.list`.

Each probe has a **baseline** already recorded below (BASELINE section) — the same env run against
`origin/main`. Compare against it; a probe whose result did not move where the table says it should
is the finding.

**Run probe 1 detached (`-d`) and the rest in the foreground.** A successful boot does not exit —
that is a seven-minute hang, `observed` this session.

| # | SMS variables | Baseline on `main` | Expected after | Record |
|---|---|---|---|---|
| 1 | `SMS_PROVIDER=bulkgate` + three fake-but-valid `BULKGATE_*` (`BULKGATE_SENDER_ID_VALUE=SaktaCab`) | **D** — boots, zero SMS lines in the whole log | Boots. `/health` 200. | The **two** `auth.sms.provider_bound` lines, both `provider: "bulkgate"` — E8 |
| 2 | `SMS_PROVIDER` absent entirely | **A** — factory throw, text in BASELINE | Refuses, **reworded** factory throw | The new refusal, verbatim → runbook table — E7, E9 |
| 3 | `SMS_PROVIDER=auto` | **B** — byte-identical to A | Refuses with a **`ZodError`**, from `validate`, **no longer identical to probe 2** | The migration message, verbatim → runbook table — E1 |
| 4 | `SMS_PROVIDER=bulkgate`, one `BULKGATE_*` omitted | **C** — `ZodError`, three issues, text in BASELINE | Unchanged | Confirm it still matches C → runbook row 725, relabelled `observed` — E6 |
| 5 | (host, not the image) `pnpm --filter @taxi/api sms:bakeoff` with **no** `--confirm`, **from a shell that sourced the root env file** | not applicable | Dry run, prints the matrix, spends nothing | That the selector change did not break the script — E10 |

**Probe 3 is the one that proves the migration message is wired.** On `main` probes 2 and 3 produce
**byte-identical** output (`observed`, A and B below). If they are still identical after the change,
`'auto'` never reached the enum and the message is dead text.

Probe 1's **two** log lines are the point of the exercise: one line would mean only one of the two
SMS paths switched, which is precisely the failure §5.4 step 5 teaches the operator to watch for.

**Probe 1 is the only probe with an infrastructure dependency, and it is the one most likely to fail
for a reason unrelated to #137.** Probes 2-4 refuse inside `ConfigModule.forRoot`'s `validate`
(`app-config.module.ts:20`) before anything dials Postgres, so they need no database at all. Probe 1
boots the whole app and needs a `DATABASE_URL` and `REDIS_URL` reachable **from inside the
container** — and on this machine `localhost:5432` is shadowed by a brew Postgres and `6379` by an
ssh tunnel, so use the LAN IP of the docker Postgres, not `localhost`. If probe 1 will not start,
get E8 from a plain `pnpm --filter @taxi/api dev` boot instead and let probe 1 prove only what is
unique to it: that a production container **boots** with a candidate selected.

**GOTCHA on probe 5.** `scripts/sms-bakeoff.ts:261` calls `envSchema.parse(process.env)` and
**nothing dotenv-loads for a plain script** — its own comment at :210 says so, and its failure text
at :265 tells you to "run from a shell that sourced the root env file". Two consequences, both of
which look like this change breaking the script and are not: an **unsourced** shell exits 1 on
`DATABASE_URL` long before the selector matters, and a shell sourced from an env file still carrying
the retired value exits 1 on the migration message — which is Q1's hazard doing its job. Migrate
your own env file first, then run probe 5.

**Not performable here, and not this ticket's:** sending a live SMS through a switched provider and
confirming the sender on a handset. That needs a funded account and an LV SIM. §5.4 documents it;
the verdict loop performs it.

### Level 5: Additional Validation (Optional)

`git grep -nE "trio (is set|binds)|trio-presence|'auto'" -- services/api docs .env.example` — the
stale-claim sweep from Task 6's GOTCHA. Every surviving hit must be a deliberate historical
reference ("`'auto'` was retired in…"), never a live description of behaviour.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — `SMS_PROVIDER` accepts exactly `stub | twilio | bulkgate | budgetsms`, defaults to
      `'stub'`, and `smsProviderFactory` switches on it with no credential-presence branch.
- [ ] **AC #2** — `NotificationsModule`'s `SMS_PROVIDER` binding is pinned to `smsProviderFactory`
      by a test that goes **red** when the binding is removed (proven by reverting it once).
- [ ] **AC #3** — a production env with a complete `TWILIO_*` trio, a complete `BULKGATE_*` group
      and no selector **throws** at boot. Before this change the same env bound Twilio silently.
- [ ] **AC #4** — `SMS_PROVIDER=auto` throws with a message naming the retirement and the four legal
      values, asserted in `env.schema.spec.ts` and `observed` from a real container (probe 3).
- [ ] **AC #5** — `.env.example` and `docs/runbooks/hetzner-deploy.md` §3 agree on the variable, the
      §3 dotenv template **contains** `SMS_PROVIDER`, and §5.4 gives an ordered switch with a
      rollback.
- [ ] **AC #6** — no surviving text anywhere describes `TWILIO_*` presence as selecting a provider
      (Level 5 sweep clean).
- [ ] **AC #7** — the runbook's boot-refusal table quotes messages **produced by probes 2-4**, each
      labelled `observed`, none predicted — and probes 2 and 3 no longer produce identical output,
      which on `main` they do (`observed`, BASELINE A vs B). Row 725's `expected` label goes, using
      probe 4's text; the preamble sentence at `:712-714` asking for that boot goes with it.
- [ ] **AC #8** — §5.4 step 5 names the two-log-lines check, and marks steps 6-7 as owed to the
      verdict loop rather than performed.
- [ ] **AC #9** — `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force`
      green, 22 tasks, from a cleared `dist/`.
- [ ] **AC #10** — the PR does **not** close #137.

No AC here is unverifiable on this machine. The two steps that are (a live send, a handset check)
are deliberately de-scoped into §5.4's text and belong to #137's verdict loop.

---

## COMPLETION CHECKLIST

- [ ] Worktree created off `origin/main`, `.env` copied in, `taxi-redis-1` Up
- [ ] All tasks completed in order; each task's VALIDATE passed immediately
- [ ] Task 8's revert-and-go-red proof actually performed, and the binding restored
- [ ] Five Level 4 probes run; messages pasted verbatim into the runbook, labelled `observed`
- [ ] Level 5 stale-claim sweep clean
- [ ] Full gate green from a cleared `dist/`, 22 tasks
- [ ] Every figure in the report and the PR body **re-derived**, not copied from this plan
- [ ] PR body's issue reference keeps closing keywords away from `#137`

---

## RISK REGISTER

Every risk that argued against a one-pass implementation, what was done about it, and what is left.
`retired` means evidence was produced at plan time and is recorded above; `controlled` means it
cannot be eliminated but has a named, executable control; `accepted` means it is real, small and
deliberately not spent on.

| # | Risk | Status | Evidence / control |
|---|---|---|---|
| R1 | The "two `auth.sms.provider_bound` lines" check in §5.4 could be false, teaching the operator a check that fails on a correct switch | **retired** | `observed` — Nest probe, `factory invocations at boot : 2`, run twice, faithful sibling-module shape. Task 4 GOTCHA carries it |
| R2 | The migration message might not render — `z.enum` ignores some error params | **retired** | `observed` — `{ message }` works on zod 3.25.76, `{ invalid_type_error }` is silently ignored. Task 2 GOTCHA 1 |
| R3 | The message might be put where it can never fire | **retired** | `observed` — a failing enum short-circuits the object `superRefine`, so it must live on the enum. Task 2 GOTCHA 2 |
| R4 | The Q1 pre-step could itself cause an outage if the box's Twilio trio is incomplete | **retired** | Inference stated (a running box under `'auto'` + production must already have a trio) **and** a one-command check added to Q1, §5.4's preamble and the PR body |
| R5 | The boot probe recipe could fail for reasons unrelated to #137 and burn the session | **retired** | Not merely re-confirmed — **run**. Four production boots against `origin/main`, image built at 389 MB, refusals and a successful boot all captured verbatim. See BASELINE. The recipe is inline in Level 4 with its six traps |
| R15 | Probe 1 might not be performable without a funded vendor account | **retired** | `observed` — probe D booted with a complete **fake** BulkGate group and stayed Up. Construction does not dial the vendor |
| R16 | Runbook row 725 might stay `expected` for a fourth ticket | **retired** | `observed` — probe C produced the exact `ZodError`; the text is in BASELINE and Task 12 pastes it |
| R17 | P2 ("nothing names the bound provider") might be overstated | **retired** | `observed` — `grep -ic sms` over a full successful production boot log returns **0** |
| R6 | A new env var might need a `turbo.json` passlist entry; strict mode strips undeclared vars silently | **retired** | `observed` — `globalEnv` read; no test reads the selector from the process environment, so no entry is needed and adding one would pollute the cache key |
| R7 | Probe 5 could read as "the selector change broke the bake-off script" | **retired** | `observed` — the script parses `process.env` and dotenv-loads nothing; both of its failure modes are named in Level 4's probe-5 GOTCHA |
| R8 | An integration test for AC #2 would be green against a deleted binding | **retired** | `harness.ts:548` overrides the token graph-wide; Task 8 is a metadata test whose VALIDATE step requires proving it goes red |
| R9 | Line references in this plan could be stale, sending the implementer to the wrong hunk | **retired** | Every reference re-read from `origin/main` and corrected once (the §3 template is 232-251, not 232-278; the refusal table 716-725) |
| R10 | The gate cannot see anything this ticket changes — it never boots under `NODE_ENV=production` | **controlled** | Level 4's four container probes are mandatory, not optional, and AC #7 will not pass on predicted messages. This is inherent to the repo, not to this ticket |
| R11 | A shared-test-DB collision or a stale `.next` turns the gate red for unrelated reasons | **controlled** | Level 3 names both signatures and says re-run rather than diagnose; the worktree instruction and `COMPOSE_PROJECT_NAME=taxi` are in the pre-Task-1 block |
| R12 | Other local checkouts (two concurrent sessions) break on their next test run once `'auto'` is retired | **controlled** | Expected and loud — the migration message is the fix instruction. Q1 requires saying so in the PR body so it reads as designed rather than as breakage |
| R13 | The live half of §5.4 (steps 6-7) is written but never executed, so a real switch meets an untested procedure | **accepted** | Needs a funded account and an LV SIM. Steps 1-5 and the rollback mechanics are covered by probes 1-2; the live steps are explicitly marked as owed to the verdict loop, in the text itself |
| R14 | The winner's live rollback under real traffic is untested | **accepted** | Same constraint. §5.4 states it rather than implying coverage |

R13 and R14 are the only residual risks, they are the same constraint (`blocked:hardware` on #137),
and both are **out of this ticket's scope by construction** — see Out of Scope.

---

## BASELINE — four production boots, observed at plan time

**The switch loop's Level 4 probes are not speculative: the same recipe was run against
`origin/main` (`325f8e7`) before this plan was finished.** Image `taxi-api:v137base`, built from
`services/api/Dockerfile` at **389 MB** (the runbook's `pnpm deploy` figure holds), on network
`taxi_default` against the live `taxi-db-1` / `taxi-redis-1`, with a scratch database `sms137`
created and dropped. All four `observed` 2026-09-21. Everything was torn down afterwards: container
removed, database dropped, image deleted, worktree removed, tree clean.

These are the **before** side of the comparison. The implementer's job is to produce the **after**
and show it differs where this plan says it should.

| Probe | Env | Result on `main` today | After this change |
|---|---|---|---|
| **A** | no `SMS_PROVIDER` line, no Twilio trio | **refuses** — factory throw | still refuses, **new message** |
| **B** | `SMS_PROVIDER=auto`, no trio | **refuses, byte-identical to A** | refuses with the **migration message**, a `ZodError`, from a different layer |
| **C** | `SMS_PROVIDER=bulkgate`, group incomplete | **refuses** — `ZodError` | unchanged |
| **D** | `SMS_PROVIDER=bulkgate`, complete **fake** group | **boots** — `Nest application successfully started` | boots, **plus two `auth.sms.provider_bound` lines** |

**A and B, verbatim** (identical; ANSI stripped):

```
ERROR [ExceptionHandler] Error: No production SmsProvider is bound: StubSmsProvider delivers
nothing and logs OTP codes in full. Either set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
TWILIO_FROM_NUMBER (#85), or set SMS_PROVIDER=bulkgate|budgetsms together with that group of
credentials (#137) — a complete BULKGATE_*/BUDGETSMS_* group does NOT bind on its own. Then run
with NODE_ENV=production.
    at InstanceWrapper.smsProviderFactory [as metatype] (/app/dist/features/auth/auth.module.js:49:15)
```

That A and B are **identical** is the plan's `'auto'`-reaches-the-same-refusal claim, confirmed from
a container rather than a spec. After the change they must **differ**: A keeps a (reworded) factory
throw, B becomes a `ZodError` raised during `ConfigModule.forRoot`'s `validate` — an earlier layer.
If they are still identical after the change, the migration message is not wired.

**C, verbatim** — three issues, and this is the text **runbook row 725 has been waiting for**:

```
ERROR [ExceptionHandler] ZodError: [
  { "code": "custom", "path": ["BULKGATE_APPLICATION_TOKEN"],
    "message": "BULKGATE_APPLICATION_TOKEN is missing: BULKGATE_* must be set all together or not at all (a partial config silently binds the stub)." },
  { "code": "custom", "path": ["BULKGATE_SENDER_ID_VALUE"],
    "message": "BULKGATE_SENDER_ID_VALUE is missing: BULKGATE_* must be set all together or not at all (a partial config silently binds the stub)." },
  { "code": "custom", "path": ["SMS_PROVIDER"],
    "message": "SMS_PROVIDER=bulkgate needs BULKGATE_APPLICATION_TOKEN, BULKGATE_SENDER_ID_VALUE." }
]
```

The runbook's own preamble at `:712-714` says the SMS refusal is observed only at schema level, that
nobody has confirmed it stops the container, and asks whoever next boots the image to "move it into
the observed set". **It does stop the container, and here is the text.** Task 12 discharges that
sentence rather than leaving it standing for a fourth ticket.

**D — two findings, both load-bearing for this plan:**

1. **A production container boots with a candidate selected and fake-but-schema-valid credentials.**
   `Nest application successfully started`, and the container stayed Up. Constructing a provider
   does not dial its vendor, so Level 4 probe 1 is performable with no funded account — which is
   the whole reason this ticket's verification is not blocked on the handset day.
   **What D proves is that the boot is REACHABLE, not that probe 1 passes.** Probe 1's actual new
   content — the two `auth.sms.provider_bound` lines — is precisely the thing D could not show,
   because on `main` the factory does not log. D retires the infrastructure risk; it does not
   pre-validate the post-change path, and nothing here should be read as if it did.
2. **`grep -ic sms` over D's full boot log returns `0`.** A complete, successful production boot
   today names the bound SMS vendor **nowhere**. That is problem P2, measured rather than asserted,
   and it is the case for Task 4's boot log.

**One mechanical note for Level 4:** probe D **does not exit**. A successful boot runs forever, so
run the boot probes with `-d` plus a `curl` health check and `docker logs`, and only the refusal
probes in the foreground. Getting this backwards costs a seven-minute hang — `observed`, this
session.

---

## OPEN QUESTIONS / ASSUMPTIONS

**Q1 (ordering, answered worst-case) — what happens on the box when the retirement deploys?**

Worst case, not typical: `/opt/taxi/.env` today most likely has **no** `SMS_PROVIDER` line at all —
the §3 dotenv template omits it (`observed`, defect P3) — and a complete `TWILIO_*` trio. Under
`'auto'` that boots and binds Twilio. The moment the retirement image starts, the default is
`'stub'`, `NODE_ENV=production` is set by `compose.prod.yml:35`, and the factory throws. The
container crash-loops; the previous container is already gone; **the API is down** until someone
edits the file. `up -d --wait` fails the deploy step loudly rather than leaving a broken stack
running, so the workflow reports it — but the outage is real and starts at the deploy, not at the
first SMS.

**The remedy is ordering, and it is free.** `SMS_PROVIDER=twilio` is **already valid on `main`**
(`sms-env.schema.ts:217` lists it; `auth.module.ts:63-77` binds Twilio for it, identically to
`'auto'` when the trio is present). So:

1. **Check the box has a complete trio first** — see the paragraph below. It is one command.
2. **Before merging this PR**, set `SMS_PROVIDER` to `twilio` in `/opt/taxi/.env` and
   `up -d --wait api`. Behaviour is unchanged, verifiable by the API still answering `/health`.
3. Then merge and deploy. The retirement is a no-op on the box.

**Step 1 is not ceremony: the pre-step is safe only if the trio is complete.** Naming a kind makes
that kind's whole group required in every environment (`sms-env.schema.ts:262-273`), so setting the
selector on a box with two of three Twilio variables would cause exactly the outage the pre-step
exists to prevent — and would do it *before* the retirement, when nobody is watching for it. The
inference says it is fine: under `'auto'` with `NODE_ENV=production` (set by `compose.prod.yml:35`)
a box lacking the trio would already be refusing to boot, so a **running** box has one. An inference
stated is worth more than an inference assumed, and the check costs nothing:

```bash
ssh <box> "grep -c '^TWILIO_[A-Z_]*=..*' /opt/taxi/.env"   # must print 3
```

Carry this check into §5.4's preamble and the PR body, not only here.

This must appear **in the PR body and in §5.4's preamble**, not only here — a plan nobody re-reads
at deploy time is not a control. The same hazard applies to every developer's local env file and to
the two other Claude sessions sharing this checkout: their `.env` says `SMS_PROVIDER=auto` if #240's
template was copied, and their next `pnpm test` will fail with the migration message. That is the
message doing its job, but say so in the PR body so it reads as expected rather than as breakage.

**Q2 — `'stub'` as the default, or no default at all?** **Assumption taken: default `'stub'`**,
mirroring `PUSH_PROVIDER` (`env.schema.ts:263`). A required value with no default reads cleaner but
breaks every jest run and every CI job at once: `.github/workflows/ci.yml` sets no SMS variable
(`observed` — its only `env:` entry on the `check` job is `REDIS_TEST_URL`), and
`app-config.module.ts:20` parses the schema on every app boot including tests. The default is what
keeps a fresh checkout working, and production still refuses it, so it costs nothing in safety.

**Q3 — should a custom message be attached to `'auto'` at all, or is zod's default enough?**
**Assumption taken: custom.** zod's own text — `Invalid enum value. Expected 'stub' | 'twilio' |
'bulkgate' | 'budgetsms', received 'auto'` (`observed`) — is legible but does not say that `'auto'`
*used to be* legal, which is the one thing the reader needs. Note the constraint that forced the
implementation: a failing enum short-circuits the object's `superRefine`, so the message cannot
live with the other SMS checks in `checkSmsCredentialGroups`. Verified, not assumed — see Task 2's
GOTCHA 2.

**Q4 — does retiring `'auto'` change dev behaviour for someone with real Twilio credentials?**
**Yes, and it is the point.** Today a `.env` with the trio and no selector sends real SMS in
development. After this change it binds the stub. Without Task 4's boot log that is a silent
regression — you would think you were testing Twilio. With it, `auth.sms.provider_bound`
`provider: "stub"` is printed twice at every boot. E5 pins the behaviour; the log makes it visible.
Anyone who wants the old behaviour sets `SMS_PROVIDER=twilio`, which is one line and now says what
it means.

**Q5 — is this loop worth running before the verdict exists?** **Yes**, and the reasoning is worth
recording because the opposite is the obvious position. The defect being closed (P1) was *created*
by #240 and is live now: the repo currently ships a selector whose default silently prefers Twilio
over a funded candidate. Waiting for the verdict means the window in which someone funds BulkGate
and gets billed by Twilio is exactly the window in which the bake-off is being run. The switch
procedure is also the thing that makes the handset day's outcome actionable the same afternoon
rather than a week later.

**Q6 — what if the verdict is "no candidate qualified"?** Then nothing here is wasted: `'auto'` is
still retired, the box still states `SMS_PROVIDER=twilio` explicitly, §5.4 is still the procedure
for the paid-account Twilio re-validation the scorecard's Verdict section demands, and the two
candidate providers stay bound-able for a re-run. **There is no open issue for that
re-validation** (`observed` — `gh issue list --state open` returns #137, #136, #135, #123, #13 as
the only SMS-adjacent ones). The verdict loop should file it; this loop does not, because it is
not this loop's AC.

---

## NOTES (open canvas)

### The design, and the two alternatives rejected

**D1 — mirror `PUSH_PROVIDER`: enum with `'stub'`, default `'stub'`, production refuses. ✅ TAKEN.**

The repo already made this decision once, for push, on identical reasoning: a provider whose
selection cannot be read off credential presence must be stated. `pushProviderFactory` is 11 lines.
After this change `smsProviderFactory` is the same function with three named branches instead of
one. That symmetry is worth more than any cleverness — the next person to add a fourth SMS vendor
has a shape to copy, and the two factories fail the same way for the same reason.

**D2 — keep `'auto'`, but make it refuse when more than one complete group is present. ❌**

Genuinely attractive: it closes P1 exactly (ambiguity is the trigger), costs no migration, breaks
no existing env file, and needs no runbook ordering step. Rejected on the steady state rather than
the transition. After the switch you cancel the losing account, leaving exactly one funded group —
at which point `'auto'` goes quiet again and binds it implicitly. Intent is once more unrecorded,
and the next person to add a second group for a re-test gets a boot refusal they have no context
for. It solves the ambiguous case and leaves the unambiguous-but-wrong case exactly as it is:
someone who funds BulkGate, removes Twilio and forgets they ever chose anything.

It also cannot produce the property §5.4 step 5 depends on — a log line naming a *stated* kind. You
would be logging an inferred one, which is a weaker claim.

**D3 — required, no default. ❌** Cleanest end state, wrong cost. See Q2.

### Why the metadata test rather than an integration test

This is the plan's one genuinely non-obvious testing call, and it is worth stating because the
instinct runs the other way. "Ride SMS goes through the selected provider" *sounds* like exactly
what an integration test is for: book a ride, accept it, assert the recorded SMS. That test is easy
to write, passes today, and would pass with `notifications.module.ts`'s entire `SMS_PROVIDER`
provider block deleted — because `harness.ts:548` overrides the token graph-wide and Nest resolves
`RideNotificationsService`'s `@Inject(SMS_PROVIDER)` from the override either way.

The general shape: **a test whose subject is a binding cannot use a `harness` that replaces
bindings.** #16's C1 is the same defect from the other direction — a socket test with a handler map
in place of a socket, green while no event was ever delivered. The check that Task 8's VALIDATE
demands (revert the binding, watch it go red) is the only thing that distinguishes the two cases,
and it takes thirty seconds.

### What the boot proof can and cannot say

| Question | Does probe 1-5 answer it? |
|---|---|
| Does a production container boot with `SMS_PROVIDER=bulkgate`? | **Yes** — probe 1, with fake credentials, because construction does not dial |
| Do both SMS paths bind the same kind? | **Yes** — two `auth.sms.provider_bound` lines, probe 1 |
| Does an un-migrated box refuse loudly? | **Yes** — probe 2, and the message goes in the runbook |
| Is the migration message the one an operator will actually see? | **Yes** — probe 3, from the container, not from a spec |
| Does BulkGate accept our credentials? | **No.** Nothing here contacts a vendor. That is the bake-off's job and it costs a segment |
| Will the sender read `SaktaCab` on LMT? | **No.** Handset day |
| Is the switch reversible in production? | **Partly** — the mechanics are probe 1 + probe 2 with the values swapped; the *live* rollback with real traffic is untested and says so in §5.4 |

### Figures in this plan, and their provenance

Every number below is `observed` at `origin/main` = `325f8e7`, from the command named. Re-derive
before copying any of them into the report or the PR body — inherited figures are the repeated
defect here (#87, #107, #212), and a figure that survives re-observation is still not licence to
rewrite the sentence around it.

| Figure | Provenance |
|---|---|
| Branch is 14 behind main | `observed` — `git rev-list --left-right --count HEAD...origin/main` → `6	14` |
| 26 lines mention `auto` across 6 files | `observed` — `git grep -c` over the six paths; **lines**, not occurrences, and not all are the selector |
| `env.schema.ts` 351 · `sms-env.schema.ts` 274 · `auth.module.ts` 119 · `notifications.module.ts` 50 · `env.schema.spec.ts` 510 · `auth.module.spec.ts` 141 | `observed` — `git show origin/main:<f> \| wc -l` |
| zod `{message}` works on `z.enum`, `{invalid_type_error}` does not | `observed` — node REPL, zod 3.25.76, four spellings probed |
| A failing enum short-circuits the object `superRefine` | `observed` — same probe; the refine's `console.log` did not fire for `'auto'` and did for `'stub'` |
| `@taxi/api` baseline 723 passed / 762 total, 77 of 79 suites | `observed` — PR #240's body at `5e6545c`, **inherited**; re-run before quoting |
| 22 gate tasks | `observed` — PR #240's body; also CLAUDE.md's figures-gate count |
| `.env` reaches the container via `env_file` | `observed` — `compose.prod.yml:33`, and `environment:` (34-48) contains no SMS key |
| The §3 dotenv template omits `SMS_PROVIDER` | `observed` — `hetzner-deploy.md:232-251`; the Twilio trio is at 246-248, followed only by the two `STRIPE_*` lines |
| The factory runs **twice** per boot, so the log line appears twice | `observed` 2026-09-21 — throwaway Nest probe, real token + real factory + counting wrapper, two sibling modules under a `@Global()` config module: `factory invocations at boot : 2`, run twice. Probe deleted |
| `select(M).get(token)` returns the SAME object for both modules; `{ strict: true }` returns two | `observed` — same probe, both spellings run |
| `turbo.json` `globalEnv` needs no `SMS_PROVIDER` entry | `observed` — `globalEnv` is `DATABASE_URL, REDIS_URL, JWT_SECRET, OTP_PEPPER, API_PORT, REDIS_TEST_URL`; the `test` task declares no `env` |
| The bake-off script parses `process.env` and dotenv-loads nothing | `observed` — `scripts/sms-bakeoff.ts:261` + its own comment at :210 and failure text at :265 |
| Probe infrastructure is live | `observed` 2026-09-21 — docker 29.2.1, network `taxi_default`, `taxi-db-1` + `taxi-redis-1` Up and healthy, `psql -U taxi` answers |

### Confidence, and what earns it

**9.5 / 10 for one-pass implementation.**

The missing half-point is R13/R14, and it is one thing, not two: §5.4 steps 6-7 — the live send and
the live rollback — cannot be executed on this machine, so that half of the procedure ships
written-but-unrun. That is #137 being `blocked:hardware`, not a gap in this plan, and no amount of
planning retires it. It is why those steps are marked **owed** rather than claimed.

Everything else was **measured, not reasoned about**. Ten facts, each with the command that produced
it, none inherited:

| What could have gone wrong at implementation time | How it was settled here |
|---|---|
| zod ignores the error param you reach for first | `{ message }` works, `{ invalid_type_error }` is silently ignored — four spellings probed |
| The migration message put where it can never fire | A failing enum short-circuits the object `superRefine` — probed both ways |
| §5.4 teaches a log check that is false | `factory invocations at boot : 2`, Nest probe in the faithful sibling-module shape, run twice |
| A distinctness test written without `{ strict: true }` asserts the opposite of what it reads as | Both spellings run; non-strict returns one object, strict returns two |
| A new env var silently stripped by turbo strict mode | `globalEnv` read; no entry needed, and one would pollute the cache key |
| Probe 5 misread as the change breaking the bake-off script | The script parses `process.env` and dotenv-loads nothing — its own source says so at :210 |
| The boot probe recipe failing for unrelated reasons | **Four production boots actually run** against `origin/main`; refusals and a successful boot captured verbatim |
| Probe 1 not performable without a funded account | Probe D booted on a complete **fake** credential group and stayed Up |
| P2 overstated | `grep -ic sms` over a full successful production boot log → **0** |
| Stale line references sending the implementer to the wrong hunk | Every one re-read from `origin/main`; two corrected |

On top of that the diff is small and mechanical, with an in-repo template to copy line for line
(`push.module.ts`, 38 lines) and a project rule that already prescribes the shape
(`services/api/CLAUDE.md`: *"A dev-only seam stub must THROW at boot under `NODE_ENV=production`
rather than serve silently — see the `SMS_PROVIDER` factory"*). The one test that is easy to write
wrongly (AC #2) carries both its failure mode and its proof procedure. The deploy hazard has a free
ordering remedy, and that remedy's own precondition has a one-command check.

### Housekeeping noticed while planning, not in scope

`.claude/plans/sms-provider-bakeoff-137.md` exists **untracked** in the main checkout at 855 lines,
while `origin/main` carries a 977-line version of the same path. The untracked copy is a stale
pre-merge draft. Deleting it is a one-line cleanup for whoever is next in that tree — not this
ticket's, and not done here because it is someone's working file.

Eight untracked `pr-*-review.md` files sit in `.claude/code-reviews/` including `pr-240-review.md`,
whose PR is merged. That is the orphan pattern: a review that belongs to no branch has to land in a
`docs/` PR or it is lost. Also not this ticket's.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. -->
