# System review — the SMS provider switch, `'auto'` retired (#137)

## Meta

- **Plan reviewed**: `.claude/plans/sms-provider-switch-137.md`
- **Execution report**: `.claude/execution-reports/sms-provider-switch-137.md`
- **Review that ran on the work**: `.claude/code-reviews/pr-241-review.md` (3 Medium, 5 Low)
- **Merged**: `710b298` (squash), 2026-09-21 · PR #241 · base `325f8e7`
- **Date**: 2026-09-21

**Invocation note, recorded because it is itself a finding.** This review was invoked with one
argument (`$1` = the execution report, `$2` = empty). The skill's own guard caught it and named
which slot it got. It was not a user error — the reviewing session mis-invoked it, immediately
after `system-execution-report` had *silently* mis-bound its own argument. See L18 below.

---

## Overall alignment score: 9/10

Divergences D1–D7 are documented, reasoned, and mostly good-against-self-interest. Round 1's
divergence from a prescribed fix (M2 test-side rather than a `never` arm) was reasoned in writing
and proven equivalent at the reviewer's exact scenario. Nothing was silently de-scoped: the live
half of §5.4 is marked owed, not implied covered.

## Plan correctness: 5/10

**— the plan taught a false mechanism, and it entered at Task 8's GOTCHA.**

The plan stated, at four sites, that an integration test for AC #2 would be **green against a
deleted binding**. That is the reverse of the truth. The implementation reproduced it faithfully
into a brand-new source comment, and the plan's own VALIDATE step passed while it did so.

- `plan_defect:` an integration test asserting "ride SMS uses the selected provider" is green
  against a **deleted** `SMS_PROVIDER` binding
- `entered_at:` `.claude/plans/sms-provider-switch-137.md` — Task 8 GOTCHA; then the
  "Integration Tests" section, the "Why the metadata test rather than an integration test" section,
  and risk-register row **R8** (logged as **retired**, on the false claim)
- `reproduced_at:` `services/api/src/features/notifications/notifications.module.spec.ts:7-24`,
  shipped to PR #241 and caught by the review as **M1**
- `observed` correction, PR #241 round 1: deleting the provider block gives **28 failed of 28**
  (`Nest can't resolve dependencies of the RideNotificationsService`); forking `useFactory` to
  `(env) => smsProviderFactory(env)` gives **28 passed of 28** with the metadata spec red. The
  true claim is about the binding's *identity*, not its absence. Mechanism:
  `@nestjs/core/injector/module.js:344` — `Module.replace` is gated on `hasProvider`.

Per the skill's own rule, this is **not** scored as a `bad ❌` divergence: faithful reproduction of
a plan defect is adherence, which is exactly why the 9/10 above needs this second score beside it.

---

## Divergence analysis

### Round 1 — first-hand to the reviewing session

```yaml
divergence: M2 closed with a data-driven test instead of the reviewer's switch/never arm
planned: review prescribed `switch (env.SMS_PROVIDER)` with `default: { const unreachable: never = … }`,
  or logging `provider.constructor.name`
actual: a spec case reading the enum's options off a rejected parse, asserting every non-stub kind
  has a credential fixture, does not bind StubSmsProvider in dev, and does not throw in production
reason: both prescribed fixes change shipped source, which would have invalidated the empty-diff
  claim licensing five container probes as `observed` — and probes 1-3 exercise that exact control flow
classification: good ✅
justified: yes — proven equivalent at the reviewer's own scenario (fixture present, branch missing,
  `tsc` clean, new case red) and the trade was stated in the PR body rather than glossed
root_cause: none — a correct cost/benefit call the review explicitly left to the author
```

```yaml
divergence: the L1 decline was published before the test behind it could see the event it declined
planned: decline `auth.sms.provider_bind_failed` on the reviewer's own framing, with the refusal
  branch's silence pinned so a later "add it for consistency" edit goes red
actual: the pinning test spied only `Logger.prototype.log`; a `_failed` state lands at `error`.
  `observed` — with the log-only helper and the reviewer's exact suggested edit in place, the suite is
  **14 passed of 14**: green through precisely the mutation the case existed to catch
reason: the red probe used a mutation this session invented (`logger.log(...)`) rather than the one
  the reviewer named (`logger.error(...)`). The claim was already in the fixes report, the commit
  message and the PR comment when the gap was found
classification: bad ❌
justified: no
root_cause: missing validation — `piv-fix-review-findings` §2 requires a red probe but does not
  require it to be the *named* mutation
```

This one matters out of proportion to its size: it is **M1's own defect class — a guarantee stated
wider than the mechanism behind it — reproduced inside the fix for L1**, in the same pass that was
retiring it. Resolved at `2be90a4`: the helper now spies `log`, `error` and `warn`, the case is
renamed `emits nothing at any level when it refuses to boot`, the same mutation gives 1 failed / 13
passed, and the report says the claim was false rather than widening the helper quietly.

```yaml
divergence: the probe-evidence claim was a two-link chain stated as one link
planned: (PR body, pre-review) "git diff 50350fe..HEAD over compiled source, comments filtered, is
  empty" — licensing all five container probes as `observed`
actual: round 1's first replacement proved only dist(a38e56f) == dist(tip) and concluded the probes
  stand. Both links are now stated: `50350fe..a38e56f` filtered leaves 0 content lines, and
  a38e56f → tip is 158 emitted `.js` files byte-compared, 0 differing
reason: the original spelling used `HEAD`, which moves; and round 1 touched compiled files, so a
  filtered source diff stopped being the right instrument
classification: bad ❌ (caught pre-merge)
justified: no
root_cause: the #107 shape — a correctly-run measurement credited to a claim wider than it covers
```

### Implementation phase — inherited from the execution report, not re-verified here

| # | Divergence | Classification | Root cause |
|---|---|---|---|
| D1 | Migration message leads with the constraint, not the retirement | good ✅ | plan assumption wrong — a custom zod `message` replaces the whole string for *every* rejected value |
| D2 / D7 | Stale trio-presence claim at **seven** sites, not the plan's five | good ✅ | plan enumeration incomplete; the sweep regex wanted two words adjacent that sit forty characters apart |
| D3 | Boot log via one local `bind()` helper, not four inlined calls | good ✅ | plan permitted either |
| D4 | Refusal table written *after* the probes, not predicted and replaced | good ✅ | correct refusal of a pattern this repo has shipped twice |
| D5 | Runbook's "first seven / first six" positional refs became named rows | good ✅ | plan assumption wrong — splitting a row invalidated the positions |
| D6 | Probe 5 re-run; its first run exited upstream of the selector and proved nothing | good ✅ | plan named two failure modes for that probe; this was a third |

D4 and D6 are good against self-interest and worth naming: D4 refuses "write predicted message text
intending to replace it", D6 reports a probe that passed for the wrong reason rather than banking it.

---

## Pattern compliance

- [x] **Followed codebase architecture** — VSA respected; `notifications` reaches into `auth` only
      through `features/auth/index.ts`, unchanged by this slice.
- [x] **Used documented patterns** — `smsProviderFactory` mirrors `pushProviderFactory`; the seam
      interfaces in `packages/shared` are untouched; no direct SDK imports outside the slice.
- [x] **Applied testing patterns correctly** — ≥1 expected + 1 edge + 1 failure for the new
      `auth.sms.provider_bound` surface (three cases). Every round-1 case was run against the
      unfixed shape first; seven probes, each reverted.
- [x] **Met validation requirements** — `pnpm turbo run typecheck lint test build --force` 22/22 at
      `2be90a4`, `@taxi/api` 80 suites / 770 tests, 0 skipped. CI green on the merged head.
- [x] **Numbers carry provenance** — every PR-body figure re-derived at the final head in a single
      `gh pr edit` after the push, which is why none re-staled a second time.
- [ ] **Guarantees in comments matched their mechanisms** — two failed (M1's, and L1's fix). Both
      caught pre-merge; both are the same class.

---

## System improvement actions

### Applied this loop (2 slots, per CLAUDE.md)

**1 — L18, the ledger's open word-split item, which recurred in this very loop.**
`arguments: [plan]` on `system-execution-report` bound `$plan` to the literal string `PR` from the
sentence "PR #241 — the SMS provider switch slice…", and the skill rendered **"Plan file: PR"**.
Logged 2026-09-04 against this exact file; unapplied since. Both remaining unguarded skills now read
`$ARGUMENTS` as prose, the in-repo pattern from `opportunity-scan:27`.

- `.claude/skills/system-execution-report/SKILL.md` — `arguments:` key removed; prose guard added
  naming the 2026-09-21 recurrence.
- `.claude/skills/piv-fix-review-findings/SKILL.md` — `arguments:` key removed; prose guard added.
- Verify: `grep -n "^arguments:" .claude/skills/*/SKILL.md` → **1 hit**
  (`system-evolution-review`, which carries its own guard text and caught this loop's mis-invocation).

**2 — R1, the VALIDATE shape that let the plan defect through.**
`.claude/skills/piv-plan-implementation/SKILL.md`, under the task template's `VALIDATE` bullet:

> **When a GOTCHA claims test A catches a mutation AND test B does not, VALIDATE runs BOTH under that
> mutation and records both results.**

A step of the shape "revert X, watch A go red" proves only the half you already believed. Chosen over
R2 because this is the defect that reached `main`'s source comments and propagated to five sites,
where R2's was self-caught in-session.

- Verify: `grep -n "runs BOTH under that" .claude/skills/piv-plan-implementation/SKILL.md` → 1 hit.

### Recommended, not applied — logged in the ledger

- **R2** (ranked first for the next slot) — `piv-fix-review-findings` §2 should require the red probe
  to use the mutation the **finding names**, not a same-shaped substitute. This loop's L1 false claim
  is the whole argument for it.
- **R4** — the `dist` byte-compare as a reusable "did this change behaviour?" instrument. One use is
  not a pattern; logged rather than promoted.
- **L17** — carried forward, unchanged: `piv-validate` still calls `pnpm check` "the gate".

### No CLAUDE.md addition proposed

What failed here was validation *shape*, which lives in skills. Per the repo's own lesson that prose
added to CLAUDE.md does not fire while skill edits do, both applied remedies are skill edits
deliberately.

---

## Key learnings

**What worked well**

- **The sweep-as-a-list rule earned its place for the first time.** Four greps came back clean;
  `R8` — a risk-register row two hundred lines from any of them — was found only by grepping the
  retired *value*. PR #150 followed this rule for digits and still missed the sentence three times.
- **Reviewer findings were re-run, not inherited** — mechanism at primary source, then behaviourally,
  both directions. L2's prescribed fix re-typechecked; M3's grep re-run at `a38e56f`.
- **The figure-ordering discipline held**: edit → commit → push → re-derive → one `gh pr edit`. L4's
  count was *removed* rather than corrected, so it could not re-stale a third time.

**What needs improvement — each with an action item, per this skill's own rule**

- *A red probe proves the test catches YOUR mutation, not the one you were asked about.* → **R2**,
  ledger row, ranked first for the next apply slot. Not left as a learning.
- *A VALIDATE step that confirms one half of a two-halved claim is not validation.* → **applied**
  this loop as slot 2.
- *Declared positional `arguments:` split prose invocations.* → **applied** this loop as slot 1.
- *A measurement can be correct and still be credited to a claim wider than it covers* (the two-link
  chain). → **accepted risk — not worth a control**, because the repo already carries the general
  rule ("when a figure credits a mechanism, say what was held constant to isolate it", CLAUDE.md)
  and this instance was caught by applying it. A third recurrence should promote it to a row.

**For next implementation**

- When a plan asserts *why* a test shape was chosen, treat the assertion as a claim with a repro,
  not as rationale prose. It will be copied verbatim into a source comment.
- Re-derive the PR body last, once, after the final push — it is the only surface no working-tree
  grep reaches.
