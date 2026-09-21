# PR #241 — review round 1 fixes

**Review** `.claude/code-reviews/pr-241-review.md` (posted as
[comment 5758629237](https://github.com/linardsb/taxi/pull/241#issuecomment-5758629237)) ·
**reviewed head** `a38e56f` · **fixed** 2026-09-21 · worktree `/Users/Berzins/taxi-worktrees/wt-137-switch`

Eight findings: 3 Medium, 5 Low. **Six fixed, one declined with reason, one filed as an issue.**
Nothing was deferred silently.

| # | Severity | Call | Where |
|---|---|---|---|
| M1 | Medium | **fixed** — and four more copies of the same false premise found by sweep | `notifications.module.spec.ts`, `notifications.module.ts`, plan ×3 |
| M2 | Medium | **fixed, test-side not source-side** (see the deviation below) | `auth.module.spec.ts` |
| M3 | Medium | **fixed** — 3 cases, not 1 | `auth.module.spec.ts` |
| L1 | Low | **split**: comment reworded (fixed); the `_failed` event **declined**, and the absence now pinned | `auth.module.ts` |
| L2 | Low | **fixed**, payoff re-verified rather than inherited | `sms-env.schema.ts` |
| L3 | Low | **fixed** | `auth.module.ts` |
| L4 | Low | **fixed** in the PR body, head-independent this time | PR body |
| L5 | Low | **filed** as [#242](https://github.com/linardsb/taxi/issues/242) | — |

---

## The one deviation from the review's prescribed fix

**M2.** The review offered two fixes: a `switch` with a `default: never` arm, or logging
`provider.constructor.name`. Both change `smsProviderFactory`'s shipped source. That would have
invalidated the PR body's claim that the filtered `50350fe..HEAD` diff over compiled source is
**empty** — the claim that licenses all five container probes as `observed` rather than requiring a
rebuilt image and a re-run, and probes 1-3 exercise exactly that control flow.

A third fix closes the same failure scenario with no shipped-source change: a case driven off the
enum's own option list. Proven equivalent below (probe C reproduces the review's exact scenario —
fixture present, factory branch missing — with `tsc` clean).

The `never` arm remains available and is strictly stronger at compile time. It is not free here,
and the trade is stated rather than glossed.

---

## M1 (Medium) — the false premise, and its four copies

### What was wrong

`notifications.module.spec.ts` claimed an integration test would be **green against a deleted
binding**. It is the reverse: a deleted binding is the loudest possible failure.

### Verified independently, not inherited from the review

The review reported this. Two independent checks were run here rather than taking it on trust.

**Mechanism, primary source** — `node_modules/@nestjs/core/injector/module.js:344-345`:

```js
replace(toReplace, options) {
    if (options.isProvider && this.hasProvider(toReplace)) {
```

`overrideProvider` merges into a module that already declares the token and never creates one.
Nothing `NotificationsModule` imports exports `SMS_PROVIDER` (`drivers`, `geo`, `platform-config`
and `realtime` export `DriverLocationService`/`DRIVER_LOCATION_STORE`, the three `MAPS_PROVIDER*`
tokens, `PlatformConfigService` and `RealtimeService` respectively), no `@Global()` module supplies
it, and `ride-notifications.service.ts:42` injects it non-optionally.

**Behaviour, `observed` 2026-09-21** — both mutations run in this worktree at `a38e56f`, each
reverted after:

| Mutation | `dispatch.integration.spec.ts` | `notifications.module.spec.ts` |
|---|---|---|
| `SMS_PROVIDER` provider block deleted | **28 failed, 28 total** — `Nest can't resolve dependencies of the RideNotificationsService (?, …). Please make sure that the argument "SMS_PROVIDER" at index [0] is available in the NotificationsModule module.` | red |
| `useFactory` forked to `(env) => smsProviderFactory(env)` | **28 passed, 28 total** | **1 failed, 1 total** |

Commands, both `cd services/api && COMPOSE_PROJECT_NAME=taxi npx jest <path>`.

The second row is what makes the metadata test worth having, and it is the argument the original
comment gave *second*. It is now the lead.

### The copies — grep the noun, not the sentence

The claim was written once and quoted five times. The sweep below is the list, not a feeling.

```
grep -rn "GREEN against"                     → 1 hit   (the spec)                       FIXED
grep -rn "whether this binding exists"       → 1 hit   (the spec)                       FIXED
grep -rn "across the whole compiled graph"   → 4 hits  (spec, module docblock, plan ×2) 2 FIXED, 2 out of diff
grep -rn "green against a deleted binding"   → 1 hit   (plan risk register R8)          FIXED — missed on the first pass
grep -rn "graph-wide"                        → 1 hit   (plan risk register R8)          FIXED
grep -rn "#16's C1"                          → 5 hits  (spec + plan ×2 in scope)        FIXED; 3 unrelated left
```

All run from the worktree root with `--include='*.ts' --include='*.tsx' --include='*.md'` and
**path-only** exclusion of `node_modules`, `dist`, `.next` (never `grep -v node_modules`, which eats
content lines). Full output: the sweep was re-run after the edits and every retired phrasing returns
**no hits** except the one restatement that quotes it to mark it retired.

**R8 is the instructive one.** It is a risk-register table row, two hundred lines from anything the
first four greps matched, and it carried the retired claim verbatim. Found only because the sweep
grepped the retired *value* rather than the topic word.

| Copy | File | Now |
|---|---|---|
| 1 | `notifications.module.spec.ts:7-24` | rewritten: identity leads, absence explained with the `Module.replace` gating, both mutations cited |
| 2 | `notifications.module.ts` docblock | precondition stated — it is *this entry* that puts the ride path under the harness, not the override's reach |
| 3 | plan, Task 8 GOTCHA | "green against a silently forked factory", with the correction marked |
| 4 | plan, "Integration Tests" section | same |
| 5 | plan, "Why the metadata test rather than an integration test" | rewritten with the two-row `observed` table above |
| 6 | plan, risk register R8 | restated; the retired wording quoted so a reader can see what changed |
| 7 | **PR body** | fixed in the `gh pr edit` at the end of this pass — no working-tree grep reaches it |

**Found and deliberately left** (out of this PR's diff, and accurate as written in two of three):
`services/api/test/harness.ts:552` and `.claude/plans/api-rides-pricing.md:758` both say "across the
whole compiled graph, **including providers a module does not export**" — the accurate narrow claim,
not the overgeneralisation. `.claude/plans/rider-comms-sms-tracking-page.md:292` carries the loose
phrasing for a shipped ticket; left as history.

---

## M2 (Medium) — exhaustiveness, driven off the enum

### What was wrong

`smsProviderFactory` is an `if` chain with no `default`. Adding a fifth kind and forgetting its
branch compiles clean: dev falls through to `bind(new StubSmsProvider())` while the boot line names
the new vendor, and production throws *"SMS_PROVIDER is stub"* at an operator who set it correctly.
`hetzner-deploy.md` §5.4 step 5's "two lines, both naming the new kind" rollback check **passes
while the stub is bound**.

### The fix

`auth.module.spec.ts` — "binds a real provider for every kind the enum lists (edge)". It reads the
enum's options back off a rejected parse (`invalid_enum_value` carries `options` even though
`{ message }` replaces the issue text), skips `'stub'`, and for each remaining kind asserts a
credential fixture exists, that dev does **not** bind `StubSmsProvider`, and that production does
**not** throw.

### Run against the unfixed shape — `observed` 2026-09-21

Three probes, all reverted after. Each is `cd services/api && npx tsc --noEmit -p tsconfig.json`
and/or `COMPOSE_PROJECT_NAME=taxi npx jest src/features/auth/auth.module.spec.ts`.

| Probe | Mutation | Result |
|---|---|---|
| A | `'vonage'` added to the enum only | **`tsc` red**: `sms-env.schema.ts(67,7): error TS2741: Property 'vonage' is missing … but required in type 'Record<SmsProviderKind, …>'` — L2's payoff, in the right file |
| B | + `SMS_GROUPS` entry, no factory branch, no fixture | `tsc` **clean**; the new case red: `Expected value: "vonage" / Received array: ["twilio", "bulkgate", "budgetsms"]` |
| C | + fixture, **only** the factory branch missing — the review's exact scenario | `tsc` **clean**; the new case red at `expect(smsProviderFactory(named)).not.toBeInstanceOf(StubSmsProvider)` |

Probe C is the one that matters: `tsc` is clean, so this test is the only thing standing between a
forgotten branch and a silently-bound stub.

**New failure mode this fix's mechanism introduces**: `selectableKinds()` depends on zod's
`invalid_enum_value` issue shape, so a zod major or a switch to `z.nativeEnum` would break it — it
**throws with a named reason** (`expected invalid_enum_value, got <code>`) rather than silently
returning an empty list and passing vacuously. That guard is the second `if` in the helper.

---

## M3 (Medium) — `auth.sms.provider_bound` had no test

### What was wrong

`observed` here, not taken from the review — `git grep -n provider_bound a38e56f -- services/api/src
services/api/test` returns **three hits and no assertion**: the emit at `auth.module.ts:56` and
prose comments at `auth.module.spec.ts:127` and `sms-env.schema.ts:218`.

Meanwhile `hetzner-deploy.md:422` hard-codes `grep -c auth.sms.provider_bound` and step 5 turns its
count into a live rollback decision. The repo's rule is ≥1 expected + 1 edge + 1 failure per
feature; this surface had zero.

### The fix — three cases, not one

| Case | Kind | Pins |
|---|---|---|
| `emits auth.sms.provider_bound naming the bound kind` | expected | the exact event string **and** `provider: 'bulkgate'` |
| `logs the kind and never a credential` | edge | the payload's exact key set `['at','event','provider']`, plus a direct assertion that the BulkGate application token does not appear |
| `emits nothing at any level when it refuses to boot` | failure | the refusal branch's deliberate silence, across `log`, `error` **and** `warn` (see L1) |

### Run against the unfixed shape — `observed` 2026-09-21

| Probe | Mutation | Result |
|---|---|---|
| D | event renamed to `auth.sms.provider_selected` | `1 failed, 13 passed` — the expected case red |
| E | `provider` key replaced by `senderId: env.BULKGATE_SENDER_ID_VALUE` | `2 failed, 12 passed` — expected **and** never-a-credential red |
| F | a `logger.log` added to the refusal branch, as "consistency" would | `1 failed, 13 passed` — the failure case red |
| G | **the review's own L1 suggestion**: `logger.error({ event: 'auth.sms.provider_bind_failed', … })` in the refusal branch | `1 failed, 13 passed` — the failure case red |

Probe E is the one worth noting: it is simultaneously the review's dropped-`provider`-key scenario
and a credential leak, and both cases caught it.

**Probe G is the one that changed the code.** The first version of `captureBootLog` spied only
`Logger.prototype.log`, and probe F — a `logger.log` in the refusal branch — was a mutation this
pass invented. The mutation the review actually proposed lands at **`error`** level, because
`logging-standard.md` puts `_failed` there. `observed`: with the log-only helper and probe G in
place, the suite is **`14 passed, 14 total`** — green through exactly the edit the case exists to
make visible, while the report, the commit message and the PR comment all already claimed it was
pinned. The same defect class this pass spent its Mediums retiring.

`captureBootLog` now spies `log`, `error` and `warn`, and the failure case is renamed to
`emits nothing at any level when it refuses to boot`. Re-run with the three-level helper: probe G
goes **`1 failed, 13 passed`**.

**New failure mode**: the helper silences three `Logger` methods globally. `mockRestore()` runs for
each in a `finally`, not a `catch`, so a throwing `run()` (the failure case throws by design) still
restores them rather than leaking a silenced logger into every later test in the file. The failure
case exercises that path.

---

## L1 (Low) — split: comment fixed, event declined

**Fixed**: the comment read *"ONE `event` name for every branch, including the refusal's absence of
one"*, which contradicts itself. It now reads "every branch THAT BINDS", and says why the refusal
emits none.

**Declined, with reason**: adding `auth.sms.provider_bind_failed`. The review's own framing is
*"consistency, not a gap … nothing is lost in the field"* — the throw propagates out of the Nest
factory, the bootstrap error prints, and a crash-looping container is self-evident. A log line
reading "bind failed" alongside a process that never finished booting is weaker evidence than the
crash itself.

Rather than leave that as an opinion, the absence is **pinned by a test** — at `log`, `error` and
`warn` — so a later "add the missing event for consistency" edit is a decision that turns a test
red, not a drive-by. The comment states the reason at the emit site.

**That claim was false when first written**, and probe G above is how it was caught: the pinning
test watched only `log`, while `auth.sms.provider_bind_failed` would land at `error`. Declining a
suggestion on the strength of a test that cannot see it is worse than declining it plainly.

---

## L2 (Low) — the selector union, derived

`SmsProviderSelector` is now `z.infer<typeof smsEnvFields.SMS_PROVIDER>` and `SmsProviderKind` is
`Exclude<SmsProviderSelector, 'stub'>` — the derivation `SmsCredentialKey` nine lines below already
argued for.

**The review's verified fix was re-run here rather than inherited**: `cd services/api && npx tsc
--noEmit -p tsconfig.json` → **exit 0, zero output** (`observed`). No cycle: `smsEnvFields` mentions
neither type.

**And its payoff was re-derived, not restated.** The review said the pre-fix error "lands in the
wrong file with no hint at the cause". Probe A above shows the post-fix error: **TS2741 at
`sms-env.schema.ts:67`, naming `Record<SmsProviderKind, …>` and the missing key** — in the file
holding both the enum and `SMS_GROUPS`.

That makes adding a vendor a three-link guided edit, which is now stated in both docblocks:
compiler forces the `SMS_GROUPS` entry (probe A) → M2's case forces a fixture (probe B) → M2's case
forces the factory branch (probe C).

---

## L3 (Low) — unused type parameter

`const bind = <P extends SmsProvider>(provider: P): P` → `(provider: SmsProvider): SmsProvider`.
All four call sites feed straight into a `SmsProvider` return; no caller observed the narrowed type.

---

## L4 (Low) — the PR body's commit count

`git rev-list --count 50350fe..a38e56f` prints **5**, not four. The count is being **removed**
rather than corrected, because it re-stales on every push — including this one. The replacement
phrasing is head-independent, and the claim it supported is re-established below on stronger
evidence.

---

## The claim these fixes had to preserve

The PR body licenses all five container probes as `observed` on one claim: the probed image was
built at `50350fe`, and nothing compiled has changed since. These fixes touch two compiled files.

**It is a chain of two links, and both are stated because one alone proves nothing.**

**Link 1 — image sha to reviewed head.** `git diff 50350fe..a38e56f -- services/api/src
services/api/scripts`, content lines only (blank lines and `//`, `*`, `/*`, `*/` lines dropped):
**0 surviving lines**, out of a raw diff of `1 file changed, 9 insertions(+), 6 deletions(-)`.
`observed` 2026-09-21, re-run here rather than inherited from the PR body or the review. Both shas
are immutable, so this link never re-stales.

**Link 2 — reviewed head to this branch's tip.** `services/api/tsconfig.build.json` excludes `test`,
`scripts` and `**/*spec.ts`, so `dist` holds shipped source only. `pnpm --filter @taxi/api build`
was run at `a38e56f` before any edit and the output copied aside; after the gate's own
`build --force` at the final state, each emitted file was byte-compared with `cmp`:

```
compared=158 differing=0
```

**158 emitted `.js` files, none differing.** `diff -r` over the whole tree reports six differences,
all non-executable: `env.schema.d.ts` and `sms-env.schema.d.ts` (L2 reorders the union in the
declaration), three `.js.map` files (comment edits move line offsets) and `tsconfig.build.tsbuildinfo`.

Chained: the probed binary's behaviour is `a38e56f`'s (link 1), and `a38e56f`'s emitted JS is this
tip's (link 2). So probes 1-5 remain `observed` against the behaviour this branch ships, and **no
rebuilt image is owed**.

Link 2 is a stronger instrument than the PR body's original filtered-diff claim, which could not
have survived this pass in any case: `services/api/src` contains `.spec.ts` files, and this pass
adds a substantial number of them. The PR body's wording is also changed from `50350fe..HEAD` to
`50350fe..a38e56f` — `HEAD` moves, so the original spelling was false by construction the moment
anything was pushed.

---

## Validation

`observed` — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run
typecheck lint test build --force`, run in `/Users/Berzins/taxi-worktrees/wt-137-switch`, exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m24.657s
```

    @taxi/api  Test Suites: 80 passed, 80 total
    @taxi/api  Tests:       770 passed, 770 total

**770, not 766 — and 0 skipped, not 39.** This run set `REDIS_TEST_URL`, so the gated suites ran;
the +4 are M2's one case and M3's three. The other five packages are reported only as part of
`22 successful, 22 total`: this session's capture kept the tail of turbo's output, not the whole of
it, so their per-package counts are **not** restated here. No file outside `services/api` was
touched by this pass.

**It took three gate runs.** The first was red — `Failed: @taxi/api#lint`, a single
`prettier/prettier` error in the new `captureBootLog` helper. `@taxi/api:test` also printed
`ELIFECYCLE` in that run with **no test summary at all** and an ioredis teardown stack, which is
turbo killing the sibling task, not a test failure. `npx prettier --write` on the five touched
files reformatted one (`auth.module.spec.ts`); `npx eslint` on all five then exited 0. The second
was green at `1m20.674s`; the third is the one quoted above, after probe G forced the
`captureBootLog` fix. The test totals are identical across the second and third — the fix widened
an existing case's reach rather than adding one.

Touched-suite runs along the way, `observed`, `COMPOSE_PROJECT_NAME=taxi npx jest` from
`services/api`:

- `src/features/auth src/features/notifications/notifications.module.spec.ts src/common/config` →
  `Test Suites: 9 passed, 9 total · Tests: 113 passed, 113 total`

---

## Not fixed

**L5** → [#242](https://github.com/linardsb/taxi/issues/242), `PUSH_PROVIDER` lacks the blank-line
`z.preprocess` wrapper the other two enums carry. Out of #137's diff and correctly documented as a
scope call in the code; #240's F8 predicted the inconsistency would move rather than close, and it
did.

**L1's `_failed` event** — declined above, with the absence pinned by a test rather than left as an
opinion.

---

## Still owed, unchanged by this pass

The merge precondition the review confirmed is real: **set `SMS_PROVIDER=twilio` in `/opt/taxi/.env`
on the box, after confirming the `TWILIO_*` trio is complete, restart, confirm `/health` — then
merge.** It is in the PR body and in `hetzner-deploy.md` §5.4's preamble. Nothing in this pass
changes it.

§5.4 steps 6-7's live half (one real OTP through a switched provider, and the live rollback) still
needs a funded vendor account and an LV SIM, and stays owed to #137's verdict loop.
