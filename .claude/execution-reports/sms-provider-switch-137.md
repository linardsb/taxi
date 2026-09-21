# Execution report — the SMS provider switch, `'auto'` retired (#137)

**Merged** `710b298` (squash), 2026-09-21T10:48Z · PR [#241](https://github.com/linardsb/taxi/pull/241) ·
base `325f8e7`

**Scope note, stated first because it bounds everything below.** This report is written from the
session that ran the **review-fix phase** (round 1), not the implementation phase. The
implementation's own divergences (D1–D7) are **inherited from
`.claude/reports/sms-provider-switch-137-report.md` and attributed, not re-derived** — a cold
session can see what changed but not why. Everything under "Round 1" is first-hand.

## Meta

- **Plan**: `.claude/plans/sms-provider-switch-137.md`
- **Implementation report**: `.claude/reports/sms-provider-switch-137-report.md`
- **Review**: `.claude/code-reviews/pr-241-review.md` (3 Medium, 5 Low, "request changes — minor")
- **Round-1 fixes report**: `.claude/reports/pr-241-review-fixes.md`
- **Follow-up filed**: [#242](https://github.com/linardsb/taxi/issues/242)
- **#137 deliberately left OPEN** — this slice shipped the switch's *mechanics*; the bake-off
  verdict needs funded accounts and LV SIMs.

### Files added

- `services/api/src/features/notifications/notifications.module.spec.ts`
- `.claude/plans/sms-provider-switch-137.md`
- `.claude/reports/sms-provider-switch-137-report.md`
- `.claude/reports/pr-241-review-fixes.md`

### Files modified

- `services/api/src/common/config/sms-env.schema.ts`
- `services/api/src/common/config/env.schema.spec.ts`
- `services/api/src/features/auth/auth.module.ts`
- `services/api/src/features/auth/auth.module.spec.ts`
- `services/api/src/features/auth/sms/stub-sms.provider.ts`
- `services/api/src/features/notifications/notifications.module.ts`
- `services/api/scripts/mint-tracked-ride.ts`
- `.env.example`
- `docs/runbooks/hetzner-deploy.md`

**Lines changed**: `+2483 −147` across 13 files (`git diff --shortstat 325f8e7 710b298`,
`observed`). Shipped source is `+166 −87` across four files; the plan and the two reports are 78%
of the insertions.

## Validation results

Final gate, `observed` — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm
turbo run typecheck lint test build --force` at `2be90a4`, exit 0:

| Check | Result |
|---|---|
| Syntax & linting | ✅ `22 successful, 22 total`, `0 cached`, `1m24.657s` |
| Type checking | ✅ included in the 22 |
| Unit + integration tests | ✅ `@taxi/api` **80 suites, 770 tests passed, 0 skipped** |

CI on the merged head: `check`, `codeql`, `CodeQL`, `audit-diff`, `ready` — all pass.

**The 0 skipped matters.** Both local runs set `REDIS_TEST_URL`, so the 39 Redis-gated tests ran
rather than being skipped. `766 → 770` is round 1's four new cases.

**Three gate runs, not one.** Run 1 red: `Failed: @taxi/api#lint`, a single `prettier/prettier`
error in a new test helper. `@taxi/api:test` printed `ELIFECYCLE` with **no test summary at all**
plus an ioredis teardown stack in that same run — turbo killing the sibling, not a test failure, and
exactly the signature CLAUDE.md's stop-hook note describes. Run 2 green. Run 3 green, after a
self-caught defect (below).

**The gate is blind to what this slice changed.** It never boots under `NODE_ENV=production`. Five
container probes were the real verification, run at implementation time.

## What went well

**The regression is a test, not a paragraph.** `auth.module.spec.ts` pins that production + a
complete Twilio trio + a complete BulkGate group + `SMS_PROVIDER=stub` is a boot *failure* — the
exact `Env` that silently bound Twilio under #240. Presence-based selection cannot be reintroduced
without something going red.

**The migration outage was found and neutralised before it happened.** §5.4's pre-step identifies
the only way the change takes production down, and the remedy is free because `SMS_PROVIDER=twilio`
was already valid pre-retirement. It lives in the runbook, not only the PR body, on the stated
reason that "a PR body nobody re-reads at deploy time is not a control."

**Round 1's red-probe discipline held.** Every new case was run against the unfixed shape before it
was trusted — seven probes, each reverted. Two of them changed the outcome rather than confirming
it (probes C and G).

**The reviewer's findings were re-run rather than inherited.** M1's mechanism was confirmed at
primary source (`@nestjs/core/injector/module.js:344`, `Module.replace` gated on `hasProvider`) and
then behaviourally, both directions. L2's prescribed fix was re-typechecked here rather than
trusting the review's "exit 0". M3's grep was re-run at `a38e56f` rather than restated.

**One deviation from a prescribed fix, reasoned and cheap.** M2 was closed test-side instead of with
a `switch`/`never` arm, specifically to keep the empty-diff claim that licenses five container
probes as `observed`. Proven equivalent at the reviewer's exact scenario with `tsc` clean.

## Challenges encountered

**A false mechanism claim survived plan → implementation → its own VALIDATE step.** See the first
divergence below; it is the loop's most instructive failure.

**The probe-evidence claim was a two-link chain stated as one link.** The PR body licensed all five
container probes on "the filtered diff since the image sha is empty" — true at the time, and
unmaintainable the moment round 1 touched compiled files. Worse, round 1's first replacement proved
only `dist(a38e56f) == dist(tip)` and concluded the probes stand, which is the #107 shape: a
correctly-run measurement credited to a claim wider than it covers. Both links are now stated,
and the second uses a stronger instrument (158 emitted `.js` files byte-compared with `cmp`,
0 differing) than any source diff could.

**Figures re-staled twice inside one pass.** L4 was a commit count that had already been retired in
the implementation report and left in the PR body; correcting it would have re-staled it a third
time, so it was *removed* and its claim re-established head-independently. The size table, the
`max-lines` row, the gate block and the tests-added line then all moved again when round 1's own
follow-up commit landed.

**A shared checkout with ~30 worktrees and many live sessions.** Handled by working in the existing
`wt-137-switch` worktree with `COMPOSE_PROJECT_NAME=taxi`, and by `git fetch --prune` + a PR-state
re-check immediately before each push.

## Divergences from plan

### Round 1 — first-hand

**The plan taught a false mechanism, and its own validation step could not catch it**

- **Planned**: the plan's Task 8 GOTCHA, its "Integration Tests" section, its "Why the metadata test"
  section and risk-register row `R8` all stated that an integration test for AC #2 would be
  **green against a deleted binding**. Task 8's VALIDATE step was "delete the binding, watch the
  metadata test go red."
- **Actual**: false. `overrideProvider` merges into a module that already declares the token and
  never creates one, so deleting the binding makes `dispatch.integration.spec.ts` fail to build the
  graph — **28 failed of 28**. What the harness actually masks is the binding's *identity*: forking
  `useFactory` to `(env) => smsProviderFactory(env)` leaves that suite at **28 passed of 28** while
  the metadata test goes red.
- **Reason**: the VALIDATE step checked only that the metadata test goes red on deletion. It does.
  The step never ran the integration suite under the same mutation, so the half of the claim that
  was wrong was never executed. The claim then propagated into a brand-new source comment, where
  the reviewer caught it.
- **Type**: Plan assumption wrong — and a validation step that confirms one half of a two-halved
  claim.

**A retired claim survived four greps and was found only by grepping its value**

- **Planned**: the repo rule says to chase a retired claim's copies.
- **Actual**: four greps (`GREEN against`, `whether this binding exists`, `across the whole compiled
  graph`, `#16's C1`) came back clean-ish; `R8` — a risk-register table row two hundred lines from
  any of them — was found only by `grep -rn "green against a deleted binding"`, the retired *value*.
- **Reason**: the copies do not share the phrasing of the sentence you fixed. Writing the sweep as
  an executable list rather than a felt confidence is what surfaced it.
- **Type**: Better approach found.

**A claim was published in three surfaces before it was true** (self-caught)

- **Planned**: declining L1's `auth.sms.provider_bind_failed` on the reviewer's own framing, with
  the refusal branch's silence pinned by a test so a later "add it for consistency" edit goes red.
- **Actual**: the pinning test spied only `Logger.prototype.log`, while a `_failed` state lands at
  **`error`** per `logging-standard.md`. `observed`: with the log-only helper and the reviewer's
  exact suggested edit in place, the suite is **14 passed of 14** — green through precisely the
  mutation the case existed to catch. The claim was already in the fixes report, the commit message
  and the PR comment.
- **Reason**: the red-probe run for that case used a mutation *this pass invented*
  (`logger.log(...)`) rather than the one the reviewer proposed (`logger.error(...)`). A red probe
  proves the test catches *that* mutation, not the named one.
- **Type**: Security/correctness concern about the process — it is M1's own defect class (a
  guarantee stated wider than the mechanism behind it) reproduced inside the fix for L1.
- **Resolution**: helper now spies `log`, `error` and `warn`; case renamed
  `emits nothing at any level when it refuses to boot`; same mutation now gives 1 failed, 13 passed.
  `2be90a4` carries the fix and says so rather than widening the helper quietly.

### Implementation phase — inherited, attributed

Full text in `.claude/reports/sms-provider-switch-137-report.md`; summarised here so the evolution
review has them in one place. **Not re-verified by this session.**

| # | Divergence | Type (as reported) |
|---|---|---|
| D1 | Migration message leads with the constraint, not the retirement — a custom zod `message` replaces the whole string for *every* rejected value | Better approach found |
| D2 / D7 | The plan put the stale trio-presence claim at five sites; it was **seven**, one inside a file the loop had already edited | Plan assumption wrong |
| D3 | Boot log goes through one local `bind()` helper rather than four inlined calls (plan permitted either) | Other |
| D4 | The refusal table was written *after* the probes, not predicted and replaced | Better approach found |
| D5 | Runbook preamble's "first seven / first six" positional references now name rows | Plan assumption wrong |
| D6 | Probe 5's first run exited upstream of the selector and proved nothing; re-run past that gate | Plan assumption wrong |

D4 and D6 are good against self-interest and worth keeping: D4 refuses the "write predicted message
text intending to replace it" pattern this repo has shipped twice, and D6 reports a probe that
passed for the wrong reason rather than banking it.

## Skipped items

**§5.4 steps 6–7's live half** — one real OTP to a handset through a switched provider, and the live
rollback under real traffic. Needs a funded vendor account and an LV SIM; #137 is
`blocked:hardware`. Marked **owed to the verdict loop** in §5.4's own text rather than implied
covered. Not a silent de-scope.

**L1's `auth.sms.provider_bind_failed`** — declined, not deferred, on the reviewer's own framing
("consistency, not a gap"); the absence is now pinned by a test that can actually see it.

**L5** — real but out of #137's diff. Filed as [#242](https://github.com/linardsb/taxi/issues/242)
rather than fixed here, because `PUSH_PROVIDER` is outside this slice and #240's F8 had already
predicted the inconsistency would move rather than close.

## Recommendations

Ranked; the first is the one worth acting on now.

**R1 — a VALIDATE step must exercise every half of the claim it validates.**
`piv-plan-implementation` writes VALIDATE steps of the shape "revert X, watch Y go red." That proves
Y catches the deletion of X. It says nothing about a *second* claim in the same paragraph ("and the
integration suite would not"), which is exactly the half that was false here. Suggested change to
the plan skill: when a GOTCHA asserts that test A catches a mutation and test B does not, the
VALIDATE step must run **both** under that mutation and record both results.

**R2 — a red probe must use the mutation the finding names, not one you invent.**
`piv-fix-review-findings` §2 already says "run the new test against the unfixed code and watch it
fail." It does not say the mutation must be the reviewer's, and that gap is what let the L1 claim
ship. Suggested one-line addition: *when a finding names a specific edit, the red probe is that
edit — a same-shaped substitute proves the test catches your mutation, not theirs.*

**R3 — record the sweep as an executable list, which the skill already asks for and which worked.**
`R8` was found by the list discipline and would not have been found without it. No change needed;
worth noting as the rule earning its place for the first time in this repo's history (PR #150
followed it for digits and still missed the sentence three times).

**R4 — the `dist` byte-compare is a reusable instrument for "did this change behaviour?"**
`services/api/tsconfig.build.json` excludes specs, so `dist` is shipped source only. Building before
and after a comment/type-only pass and `cmp`-ing every emitted `.js` is a stronger, cheaper answer
than any filtered source diff — it survives spec additions, comment edits and type-only changes, all
of which break a `git diff` filter. Candidate for `.claude/references/` if a second slice needs it.
**Not** proposed as a rule yet: one use is not a pattern.

**R5 — no CLAUDE.md addition proposed.** The repo's numbers rules already cover what went wrong
here; what failed was the *validation shape*, which lives in skills. Per the AI-layer lesson that
prose added to CLAUDE.md does not fire while skill edits do, R1 and R2 are written as skill edits
deliberately.
