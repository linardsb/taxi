# PR #241 review — retire the `auto` SMS selector, make `SMS_PROVIDER` a pure switch (#137)

**Head** `a38e56f` · **Base** `main` @ `325f8e7` · round 1 · reviewed 2026-09-21

**Recommendation: request changes — minor.** No critical or high issues, the gate is green on an
independent run that also exercised the Redis-gated suites the PR's own run skipped, and the change
closes three findings the #240 review left open (F5, F7, F9) plus the SMS half of F8 — whose other
half is L5 below, so it is not closed as stated. Two Mediums are worth fixing before
merge and both are cheap: **M1**, a brand-new comment whose load-bearing premise is false (reproduced
below — the opposite of what it claims happens), and **M3**, a production go/no-go string that no
test defends. Neither touches shipped behaviour.

One operational precondition is real and correctly documented: **the box needs `SMS_PROVIDER=twilio`
set in `/opt/taxi/.env` before this merges**, or the next deploy crash-loops. §5.4 carries it.

| Severity | Count |
|---|---|
| Critical | **0** |
| High | **0** |
| Medium | 3 — M1 false premise in a new comment · M2 no exhaustive arm · M3 uncovered log event |
| Low | 5 |

---

## Validation

`observed` — independent run at `a38e56f`, in `/Users/Berzins/taxi-worktrees/wt-137-switch`,
`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force`,
exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m27.922s
```

| Package | Result |
|---|---|
| `@taxi/api` | Test Suites 80 passed, 80 total · Tests **766 passed, 766 total** ✅ |
| `@taxi/dispatch` | Test Files 28 passed (28) · Tests 264 passed (264) ✅ |
| `@taxi/driver` | Test Suites 44 passed, 44 total · Tests 250 passed, 250 total ✅ |
| `@taxi/rider` | Test Suites 30 passed, 30 total · Tests 145 passed, 145 total ✅ |
| `@taxi/shared` | Test Files 24 passed (24) · Tests 231 passed (231) ✅ |
| `@taxi/db` | Test Files 3 passed (3) · Tests 17 passed (17) ✅ |

**This run set `REDIS_TEST_URL`; the PR body's did not.** That is the whole difference between the
two `@taxi/api` lines, and it reconciles exactly: the PR reports `39 skipped, 727 passed, 766 total`
across `2 skipped, 78 passed, 78 of 80` suites; `727 + 39 = 766` and `78 + 2 = 80`. So the PR body's
counts are right, its caveat is right, **and** the 39 gated tests pass rather than merely being
skipped — which the PR's own run could not show. Re-confirms CLAUDE.md's gated set at 39.

**PR checks**: `check`, `audit-diff`, `codeql`, `CodeQL`, `ready` — all pass. `mergeStateStatus CLEAN`.

**Base has not moved**: `baseRefOid` `325f8e7` equals the live `origin/main` tip `325f8e7`
(`git fetch origin && git rev-parse origin/main`). Round 1 with no prior report, so the guarantees
pass and the fix-mechanism pass both no-op by their own triggers.

---

## The numbers pass

Every figure in the PR body, re-derived at `a38e56f`:

| Claim | How it was checked | Verdict |
|---|---|---|
| Size table: PIV 1550/0/2, Config+docs 118/24/2, Tests 121/35/3, Source 137/82/3, Scripts 2/1/1 | `git diff --numstat 325f8e7...a38e56f` re-bucketed independently | ✅ all five exact |
| Sum 1928/142/11 | `git diff --shortstat` → `11 files changed, 1928 insertions(+), 142 deletions(-)` | ✅ |
| `max-lines` headroom 305 / 141 / 351 / 50 | `wc -l` at `a38e56f` | ✅ all four exact |
| Gate 22/22, exit 0, 1m27.755s, `short_gate` false, `dirty` false, head `a38e56f` | `.claude/last-gate.json` | ✅ matches the body field for field |
| Tests added: 8→10, 30→31, 0→1 = **+4 cases, +1 suite** | `grep -c "it("` at `325f8e7` vs `a38e56f` per file | ✅ |
| `git diff 50350fe..HEAD -- services/api/src services/api/scripts`, comments and blanks filtered, is **empty** | re-ran the filter | ✅ empty — the probed binary's behaviour *is* `a38e56f`'s |
| `git worktree list \| wc -l` prints **30** | re-ran | ✅ |
| Probe 3's premise: on `main`, probes 2 and 3 are byte-identical | on `main` the enum held `'auto'` and defaulted to it, so "no line" and `=auto` both resolve to `'auto'` and hit the same factory throw | ✅ sound |
| Probe 1's **two** `provider_bound` lines | `AuthModule` (`auth.module.ts:133-137`) and `NotificationsModule` (`notifications.module.ts:40-44`) each bind `smsProviderFactory` | ✅ mechanism confirmed |
| "the **four** commits after `50350fe`" | `git rev-list --count 50350fe..a38e56f` → **5** | ❌ **L4** |
| Image 389 MB at `50350fe` | image deleted after teardown; unverifiable now, consistent with the ~388 MB `pnpm deploy` runtime recorded before | not a finding |

**Attribution check.** The claim carrying the most weight is *"the schema's named-kind check already
guarantees a kind's whole group"* — it licenses deleting the factory's credential-presence branch and
writing bare `!` assertions. **It holds**, and the isolating condition is placement:
`env.schema.ts:298` calls `checkSmsCredentialGroups`, and the production gate
`if (env.NODE_ENV !== 'production') return;` is at `:300`. Above the gate, so the check fires in
every environment — exactly what the assertions need.

**Subject check** (grep the noun, not the sentence). Swept `.ts`/`.md`/`.yml`/`.example` across the
tree for surviving presence-as-selection claims, excluding `node_modules`/`dist`. **Zero survivors**
outside the PIV artifacts describing the retirement itself. D2/D7's "seven sites, not five" is borne
out; `dae738d`'s fix is real and comment-only, which is why the filtered diff above is still empty.

---

## Findings

### M1 (Medium) — the new spec's justifying premise is false; I reproduced the opposite

`services/api/src/features/notifications/notifications.module.spec.ts:10-16`:

> `test/harness.ts` calls `.overrideProvider(SMS_PROVIDER).useValue(sms)`, which resolves by token
> across the whole compiled graph, so `RideNotificationsService` would be handed a
> `RecordingSmsProvider` **whether this binding exists or not. Such a test is GREEN against a deleted
> binding** — the same defect class as #16's C1.

**`observed`** — I deleted the `SMS_PROVIDER` entry from `notifications.module.ts:40-44` in a clean
worktree at `a38e56f` and ran both suites. An integration test is **not** green against a deleted
binding; it cannot even build the graph:

```
Nest can't resolve dependencies of the RideNotificationsService
(?, NotificationsRepository, DRIVER_LOCATION_STORE, RealtimeService, APP_ENV).
Please make sure that the argument "SMS_PROVIDER" at index [0] is available
in the NotificationsModule module.

  at createTestApp (../test/harness.ts:537:21)

Test Suites: 1 failed, 1 total
Tests:       28 failed, 28 total      ← dispatch.integration.spec.ts
```

The mechanism the agent pass identified and this run confirms: `@nestjs/core`'s
`Module.replace(token, …)` is gated on `this.hasProvider(token)`, so `overrideProvider` only merges
into modules that **already declare** the token — it never creates one. With the entry gone, nothing
supplies `SMS_PROVIDER` to `NotificationsModule` (`auth.module.ts:139` exports only
`AuthTokenService`; none of the four imported modules export it; no `@Global()` supplies it), and
`ride-notifications.service.ts:42` injects it non-optionally.

**What survives.** The test itself is sound and its *other* stated proof holds — I confirmed
`expect(sms?.useFactory).toBe(smsProviderFactory)` at `:33` goes red on deletion (`1 failed, 1 total`).
And the conclusion — metadata is the only home for this assertion — is still **true**, just for the
reason the comment gives second rather than first: the override masks **identity**, so an integration
test can prove the token resolves but never that it resolves to *this* factory rather than a
same-shaped local fork carrying no production boot-refusal. Lines 22-24 already say exactly that.

**Why Medium**: CLAUDE.md's hard rules make a guarantee in a comment a claim, not decoration, and
this is a brand-new comment asserting a test-harness behaviour that is the reverse of the truth. A
future reader trusting it would conclude the integration suite is blind to a deleted binding when it
is in fact the loudest possible failure.

**Fix**: delete the "GREEN against a deleted binding" sentence and the "#16's C1" analogy, which does
not apply once its premise goes. Promote the identity argument at `:22-24` to the lead.

---

### M2 (Medium) — no exhaustiveness arm, and `bind()` logs the *requested* selector, not the bound one

`services/api/src/features/auth/auth.module.ts:54-109`. Three `if` branches, then the production
throw, then `return bind(new StubSmsProvider())` — no `default`/`never` arm. Separately,
`bind()` at `:57` logs `provider: env.SMS_PROVIDER`, the value that was *asked for*, never the class
that was actually constructed. Today they coincide because TypeScript narrows the residue to `'stub'`.

**Failure scenario** — add a fifth kind to the enum (`sms-env.schema.ts:234`) and to `SMS_GROUPS`
(`:57-82`), which is precisely what the bake-off exists to make likely, and forget the factory branch.
Nothing fails to compile: `SMS_GROUPS` is `Record<SmsProviderKind, …>` so the compiler forces *that*
entry, but nothing forces a factory branch.

- **Dev/test**: falls past `:70-99` → `:109` binds `StubSmsProvider` → the log line reads
  `provider: 'vonage'`. A line naming a vendor that did not bind.
- **Production**: `:105` throws *"SMS_PROVIDER is stub (or unset, which defaults to stub)"* — false,
  sending the operator to check a variable they already set correctly.
- **Operationally**: `docs/runbooks/hetzner-deploy.md:420-429` step 5 makes "two lines, both naming
  the new kind" the rollback decision for a live vendor switch. Under fall-through that check
  **passes while the stub is bound** — silent mis-selection, the exact class this PR exists to kill.

**Not a regression**: `push.module.ts:16-26` is the same shape and is the repo's precedent, so the PR
body's "structurally the same function as `pushProviderFactory`" is accurate. What makes it worth
raising here is that the precedent has two values and no roadmap, while this enum has four and a
ticket whose whole purpose is adding and switching more.

**Fix**: `switch (env.SMS_PROVIDER)` with the production check inside `case 'stub'` and
`default: { const unreachable: never = env.SMS_PROVIDER; throw new Error(...); }`. Cheaper
alternative that closes the worse half on its own: have `bind()` log `provider.constructor.name`
alongside the selector, so the two can never disagree silently.

---

### M3 (Medium) — `auth.sms.provider_bound` has no test, and the runbook greps it as a go/no-go

**`observed`** — grepping `provider_bound` across `services/api/src` and `services/api/test` returns
three hits and **no assertion**: the emit at `auth.module.ts:56`, a prose comment at
`auth.module.spec.ts:127`, and a prose comment at `sms-env.schema.ts:218`.

That string is load-bearing operationally. `docs/runbooks/hetzner-deploy.md:422` hard-codes
`grep -c auth.sms.provider_bound`, and step 5 turns its count into the rollback decision during a
live production vendor switch. A rename, a dropped `provider` key, or a level change breaks the
documented procedure with nothing red anywhere. The repo's rule is ≥1 expected + 1 edge + 1 failure
per feature; this new surface has zero.

**Fix**: one case in `auth.module.spec.ts` — spy on `Logger.prototype.log`, call
`smsProviderFactory(env('development', { ...BULKGATE_GROUP, SMS_PROVIDER: 'bulkgate' }))`, assert
`expect.objectContaining({ event: 'auth.sms.provider_bound', provider: 'bulkgate' })`. Cheap, and it
pins the exact string the runbook greps.

---

### L1 (Low) — the production refusal emits no event, and its comment contradicts itself

`auth.module.ts:100-108` is the one branch with no log line.
`.claude/references/logging-standard.md` names `_failed` as a standard state, so
`auth.sms.provider_bind_failed` at `error` level would pair with `provider_bound`. Mitigating: the
throw propagates out of the Nest factory, the bootstrap error prints, and a crash-looping container
is self-evident — nothing is lost in the field. This is consistency, not a gap.

The comment at `:42-44` — *"ONE `event` name for every branch, including the refusal's absence of
one"* — is self-contradictory as written. Reword to "…for every branch that binds; the refusal
deliberately emits none, because the thrown error is the signal."

---

### L2 (Low) — the selector union is hand-written eighteen lines above a paragraph arguing not to

`sms-env.schema.ts:21-28`: `SmsProviderKind` and `SmsProviderSelector` restate by hand the same four
literals the `z.enum` at `:234` lists. What makes it worth raising is the **internal inconsistency** —
`SmsCredentialKey` at `:42` is *derived* from `smsEnvFields`, under a nine-line comment (`:30-41`)
arguing that hand-writing it "would let `smsEnvFields` and `SMS_GROUPS` drift apart silently." Same
hazard, reasoned correctly, then not applied one declaration earlier.

Low because drift is currently caught: adding a value to the enum alone makes `Env['SMS_PROVIDER']`
un-assignable at the `env.schema.ts:298` call site. But the error lands in the wrong file with no
hint at the cause.

**Fix, verified** — I applied the derivation and ran `npx tsc --noEmit -p tsconfig.json` in
`services/api`: **exit 0, zero output**. No cycle, because `smsEnvFields` mentions neither type.
Restored afterwards.

```ts
export type SmsProviderSelector = z.infer<typeof smsEnvFields.SMS_PROVIDER>;
export type SmsProviderKind = Exclude<SmsProviderSelector, 'stub'>;
```

---

### L3 (Low) — unused type parameter on `bind()`

`auth.module.ts:54`: `const bind = <P extends SmsProvider>(provider: P): P => …`. All four call sites
feed straight into a `return` typed `SmsProvider`; no caller observes the narrowed type.
`(provider: SmsProvider): SmsProvider` says the same thing.

---

### L4 (Low) — the PR body says "four commits after `50350fe`"; there are five

`git rev-list --count 50350fe..a38e56f` prints **5**: `7f6a008` (runbook), `4bdd11a` (report),
`dae738d` (the D7 comment fix), `a00238e` (report), `a38e56f` (report). Categories are right
(runbook ×1, report ×3, doc comment ×1); only the count is wrong, and it was correct when written.

The figure re-staled itself, and the fifth commit is `a38e56f`, whose own subject is **"docs(reports):
drop the commit count, which restaled itself (#137)"** — the count was retired in the report and the
copy left in the PR body, the surface CLAUDE.md singles out as *"the most-read surface and the only
one not in the working tree."*

**The claim it supports is TRUE and independently verified**: the filtered `50350fe..a38e56f` diff
over `services/api/src` and `services/api/scripts` is empty, so the probed binary's behaviour is
`a38e56f`'s regardless of the count. Blocks nothing.

**Fix**: `gh pr edit 241` — "the commits after `50350fe`", head-independent so it cannot re-stale a
third time.

---

### L5 (Low) — #240's F8 was applied to one enum, so the inconsistency moved rather than closed

`sms-env.schema.ts:224-232` wraps `SMS_PROVIDER` in `z.preprocess((v) => (v === '' ? undefined : v), …)`,
closing #240's F8 here and citing `ALLOW_STUB_MAPS_PROVIDER` (`env.schema.ts:219-224`). The comment
at `:230-231` explicitly leaves `PUSH_PROVIDER` (`env.schema.ts:263`) un-wrapped as outside #137's
diff — a defensible, documented scope call, so **not** drift. Raised only because #240's F8 predicted
it: *"Pick one and apply it to both enums, or the inconsistency just moves."* A blanked
`PUSH_PROVIDER=` line still refuses to boot everywhere with a generic enum error. Follow-up issue,
not a change to this PR.

---

## Checked and clear

- **Constraint pass.** The plan's only read-only marker is `ride-notifications.service.ts` (plan
  `:200`). It is not in the changed-file list. Nothing recommended above breaks an AC.
- **The named-kind guarantee holds for all four values.** `:274-284` (all-or-none) catches partial
  groups in every environment, skipping `set.length === 0`; `:293-304` (named-kind) covers exactly
  that skipped case. Together a named kind's group is un-partially-satisfiable. `stub` is correctly
  exempt — it is not a key of `SMS_GROUPS`, enforced by the `Record<SmsProviderKind, …>` annotation
  at `:57`, so `SMS_GROUPS[env.SMS_PROVIDER]` at `:294` cannot be `undefined`. Pinned at
  `env.schema.spec.ts:441-453` and `:473-495`.
- **The production refusal is reachable and correct.** `:100` is the residue after the three kind
  branches; the message names all three selectable kinds and correctly no longer offers the
  `TWILIO_*` trio as an alternative route. Pinned at `auth.module.spec.ts:96-103` and `:134-151`.
- **The custom enum message** leads with the constraint and lists the legal values, so it stays true
  for `vonage` as well as `auto` — both pinned (`env.schema.spec.ts:398-400` for the constraint text).
  The reasoning at `:239-243` checks out: a failing enum aborts the object parse so a `superRefine`
  would never run, and `{ invalid_type_error }` is not consulted for `invalid_enum_value`. D1 is
  accurate.
- **The new spec pins what it claims** — `toBe` on identity, both module and spec importing through
  `../auth`'s barrel so the reference is the same object. Only its *justification* is wrong (M1).
- **The boot log's name** parses as `domain=auth` / `component=sms` / `action_state=provider_bound`,
  carries `event` and `at`, and logs the kind only — no sender ID, token or application id, per the
  standard's never-log list.
- **VSA boundary.** `notifications.module.ts` reaches into the auth slice for `smsProviderFactory`
  and `SMS_PROVIDER`; both come through `services/api/src/features/auth/index.ts`, the declared
  public API, **unchanged** by this PR. Its export comment reads *"the ONE factory carrying the
  production boot-refusal; forking it would fork that guarantee"* — so the spec's claim that
  `auth/index.ts` "says so where it exports this one" is accurate. Nothing imports past the barrel,
  and `AuthModule` still does not export `SMS_PROVIDER`.
- **No behaviour change for `bulkgate`/`budgetsms`** that the bake-off depends on: same group shapes
  (BulkGate 3 keys, BudgetSMS 4), same config objects, `baseUrl` still deliberately unset, and
  `scripts/sms-bakeoff.ts` selects by credential presence independently of the selector, so it still
  runs all three against one environment.
- **#240's F5, F7, F9 closed.** F5 — `auth.module.ts:107` no longer offers the trio, and
  `auth.module.spec.ts:105` pins the exact case #240 asked for. F7 — the runbook now carries §5.4,
  the `SMS_PROVIDER` line §3's template was missing, and §8.3's three SMS refusals labelled
  `observed` 2026-09-21. F9 — `SmsCredentialKey` is now the derivation the #240 reviewer verified.
- **D5 is closed and verifiable.** §8.3's preamble names the six untouched rows instead of using
  positional references; grepping `first seven`/`first six`/`first five` returns only an unrelated
  rclone line at `:560`.
- **Template consistency.** `.env.example:111` commits `SMS_PROVIDER=stub` (fresh checkout boots);
  §3's dotenv template carries `SMS_PROVIDER=twilio` (production-correct). Deliberate, each right
  for its context.
- **No `any`, no `@ts-ignore`, no `eslint-disable` of `max-lines`.** Money, ride state machine and
  `@taxi/shared` contracts untouched. Every shipped source file well under the 500-line cap.

---

## What's good

**The regression is pinned as a test, not a paragraph.** `auth.module.spec.ts:105-120` asserts that
production + a complete Twilio trio + a complete BulkGate group + `SMS_PROVIDER=stub` is a boot
failure — that exact `Env` bound Twilio silently under #240. With `:79` ("an explicitly named kind
beats a present `TWILIO_*` trio") and `:122` ("binds the stub in dev even with a complete trio"),
presence-based selection cannot be reintroduced without a red test. Most changes of this shape test
only that the new path works.

**The migration outage was found and neutralised before it happened.** §5.4's pre-step identifies the
only way this change takes production down and makes the remedy free, because `SMS_PROVIDER=twilio`
was already valid pre-retirement. The `grep -c` guard catches a two-of-three box *before* the
retirement rather than during it. It lives in the runbook because "a PR body nobody re-reads at
deploy time is not a control" — the correct reason.

**`SMS_GROUPS` as a table** is what makes BudgetSMS's fourth key un-forgettable, and the "key order
is load-bearing" note at `:47-52` names the exact regex that depends on it — the kind of comment that
stops a sorting "cleanup".

**D4 and D6 are good against self-interest.** D4: the refusal table was written *after* the probes
rather than predicted and replaced, and the PR names that as the defect this repo has shipped twice.
D6: probe 5's first run exited at `sms-bakeoff.ts:232`, upstream of the selector at `:261`, so it
proved nothing — reporting a probe that passed for the wrong reason, and re-running it, is exactly
the behaviour the numbers rules are trying to produce.

**Owed work is named, not implied covered**: §5.4 steps 6-7's live half is marked owed to #137's
verdict loop, and the PR states it implements the switch's *mechanics*, not #137's verdict.

---

## Recommendation

**Request changes — minor.** Fix **M1** (delete the false sentence, promote the identity argument
already present) and **M3** (one logger-spy case pinning the string the runbook greps). Both are
small and neither touches shipped behaviour.

**M2** is a judgement call for the author: latent today, but the PR's own premise is that more kinds
are coming, and the fall-through would make runbook step 5 pass while the stub is bound. Either the
`never` arm or logging `provider.constructor.name` closes it.

L1–L5 are follow-up material. L4 is worth a `gh pr edit` — one phrase, no commit. L5 is best done as
a one-line issue against `PUSH_PROVIDER`; L2's fix is verified to compile if you want it now.

**Merge ordering is a real precondition, already documented**: set `SMS_PROVIDER=twilio` in
`/opt/taxi/.env` on the box (after confirming the `TWILIO_*` trio is complete), restart, confirm
`/health` — *then* merge. Skipping it takes the API down at the next deploy, not at the first SMS.
