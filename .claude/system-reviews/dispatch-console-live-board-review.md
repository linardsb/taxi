# System Evolution Review — Dispatch console: live board (#18)

## Meta Information

- **Plan reviewed**: `.claude/plans/dispatch-console-live-board.md` (470 lines, 15 tasks, 5 phases)
- **Execution report**: `.claude/execution-reports/dispatch-console-live-board.md`
- **Also read**: `.claude/reports/dispatch-console-live-board-report.md`, `.claude/code-reviews/pr-117-review.md`,
  `.claude/skills/piv-plan-implementation/SKILL.md`, `.claude/skills/piv-implement/SKILL.md`,
  `.claude/skills/piv-create-pr/SKILL.md`
- **Date**: 2026-08-16
- **Outcome**: PR #117 merged `d82765a`; 100 files, +5,688/−503; issue #18 closed

## Overall Alignment Score: 8/10

The plan was followed closely and its hardest architectural calls — cadence over event-sourcing,
full-frame replace, pill-from-frame-receipt — were implemented as specified and survived adversarial
review intact. Ten deviations were documented and every one is justified. The two points lost are for
**one undocumented omission** (a declared UX state that was never built and never reported) and for the
**third consecutive recurrence of the numbers defect class**, which this plan had a control for that
did not fire.

This is not a score about code quality. The review found 11 Medium issues, but system review asks
whether the *process* produced them predictably — and mostly it did not: M2, M3, M6, M9, M10 are the
kind of defect that a careful implementation can ship and only adversarial review finds. Those are
review working as designed, not planning failing.

## Divergence Analysis

The ten reported deviations are individually sound and are not re-litigated here. Three matter at the
system level.

```yaml
divergence: The plan's board Error state was never built
planned: "Error: snapshot fetch fails while socket up → inline retry row (not full-screen)" (plan UX → States)
actual: login half implemented; board half absent. Banner + retry gated on `pill === 'offline'`,
        so connected-but-silent showed «Atjaunojas…» indefinitely with no age and no affordance
reason: not stated — the Deviations list does not mention it at all
classification: bad ❌
justified: no — not the omission (deferring to #19 was defensible), the SILENCE
root_cause: >
  piv-implement:98 instructs "re-read the plan's STEP-BY-STEP TASKS and TESTING STRATEGY and diff
  every named behavior against what actually shipped". The instruction exists, is correct, and was
  followed — but it ENUMERATES TWO SECTIONS, and the dropped item lived in a third (## UX —
  breadboard, states, friction audit). The control had the right shape and the wrong scope.
```

```yaml
divergence: PR body's size note cited wrong figures and drew a wrong conclusion
planned: plan COMPLETION CHECKLIST — "PR body: numbers carry provenance"; plan OPEN QUESTIONS —
         "Flag in the PR if it balloons past this"
actual: the flag was raised (control worked); the figures were wrong (+2,803 as a whole-path number
        when it was `src`; 12-of-20 files when it was 10-of-30) and supported a false claim
        ("the overshoot is dominated by tests") that the line split contradicts
reason: figures transcribed rather than recomputed
classification: bad ❌
justified: no
root_cause: >
  The existing control checks LABELLING, not correctness. Every figure in that note carried
  `observed` and was formatted per the rule — the rule was satisfied while the numbers were false.
  This is the same shape as #107 (a correctly-derived counterfactual printed as Observed). The class
  is not "missing provenance"; it is "provenance is cheap to satisfy and does not verify the number".
```

```yaml
divergence: Board live-status set hand-restated in three client predicates
planned: not specified — the plan named the api's status list but never said where it lives
actual: api held a private `LIVE_BOARD_STATUSES`; the wire schema used the full `RIDE_STATUSES`;
        the console re-derived the set in three independent predicates
reason: none needed at the time — the three agreed
classification: bad ❌ (latent)
justified: no
root_cause: >
  A CLAUDE.md hard rule already covers this ("Every cross-surface contract lives in packages/shared —
  never duplicate a type an app can import"), but the duplicated thing was a STATUS SET, not a type
  or schema, so it did not read as a contract. Planning never asked the question because the plan's
  task list is organized by file, and a contract that should exist in a file nobody is editing has
  no natural place to be noticed.
```

## Pattern Compliance

- [x] **Followed codebase architecture** — vertical slices throughout, `index.ts` public APIs, no
      cross-slice reach-around. The one cycle risk (auth↔board, from the review's own suggested M4 fix)
      was caught and avoided.
- [x] **Used documented patterns** — leaflet island pattern reused from `tracking-map.tsx`; `pollBusy`
      ref-gate mirrors the tracking page; background-process shape mirrors `DispatchSweeper` including
      the no-auto-start-under-test rule; `RT_EVENT_SCHEMAS` extended with no special-casing.
- [x] **Applied testing patterns correctly** — every slice ships expected/edge/failure; assertions go
      through rendered output and catalog lookups rather than mock call counts; the `listOnline`
      contract fixture runs against both the fake and real Redis.
- [~] **Met validation requirements** — the gate was green and honestly reported. Level 4's drill
      figures were never independently reproduced (the review said so; still true), and the drill was
      not re-run after the fix round.
- [x] **Hard rules** — no money in the diff, no direct status write, `assertTransition` not bypassed,
      one-way `shared →` flow intact, no provider SDK imports, every shipped file under 500 lines,
      zero `any`/`@ts-ignore`/`eslint-disable`.
- [~] **Cross-surface contract rule** — violated in spirit by the hand-restated status set (above),
      now fixed.

## System Improvement Actions

### Update Execute Skill (`piv-implement`) — ACTING ON THIS

The re-read instruction at `:98` enumerates two plan sections. The plan has more sections that declare
*behavior*, and the omission landed in one of them. Widen the scope:

> **Before filling Deviations**: re-read the plan's **STEP-BY-STEP TASKS**, **TESTING STRATEGY**,
> **UX → States** and **ACCEPTANCE CRITERIA**, and diff every *named* behavior, state and test case
> against what actually shipped. Tick each declared state (loading / empty / error / offline) per
> surface — **a state you did not build is a divergence even though nothing in the diff shows it**,
> and that asymmetry is why omissions get reported at zero while changes get reported at ten.

### Update `piv-create-pr` — ACTING ON THIS

Phase 2 already runs `git diff --stat`, but any *per-path or decomposed* figure in the body is
hand-composed, and that is where the defect has now landed three times. Make the numbers machine-produced:

> **Any size, count or per-path figure in the PR body must be produced by a command run NOW, against
> the final commit, and the command must appear beside the figure.** Never transcribe one from the
> plan, the implementation report, a review, or an earlier draft of the body — those are the four
> places it has been wrong before. If a figure is a decomposition, print every bucket and its sum so
> the arithmetic is checkable (`477 + 62 + 94 + 485 = 1,118`). A label like `observed` asserts where a
> number came from; it does not assert the number is right, and #87/#107/#117 were all correctly
> labelled and wrong.

### Update CLAUDE.md — RECOMMENDED, NOT ACTED ON

The numbers rule could name the review as a link in the chain (a review finding's arithmetic is
inherited too — #117's M1 gave a mislabelled api split, and the first rewrite reproduced it one level
down). **Deliberately not doing this now**: `taxi-piv-remedies-need-an-executable-step` records that
#87 ran both a skill edit and a CLAUDE.md prose addition, and only the skill edit survived to fire.
CLAUDE.md already carries two paragraphs on this class; a third is the least likely thing to change
behavior. The `piv-create-pr` edit above encodes the same lesson where it executes.

### Create New Skill — NO

Nothing here is a manual process repeated 3+ times. The gaps are scope errors in two existing skills.

### Validation additions — CONSIDERED, REJECTED FOR NOW

A lint rule or CI check that recomputes PR-body figures was considered. Rejected: the figures live on
GitHub, not in the tree, so the check would need the API, and it would fire after the body is written.
The `piv-create-pr` edit prevents rather than detects, at a fraction of the cost.

## Key Learnings

**What worked well**

- **The plan's NOTES section did real work.** Four architectural rejections (event-sourcing,
  same-origin proxy, on-change emission, hand-rolled reconnection) were argued in the plan with their
  costs, and all four held under review. Writing down *what was rejected and why* is what let the
  review confirm the design instead of relitigating it.
- **The one control that fired was the one with a number attached.** "Flag in the PR if it balloons
  past this" produced an actual flag. Vague quality instructions do not self-report; a threshold does.
- **Deferring cosmetics to `ui-decisions.md` kept the build moving** — zero cosmetic debates appear
  anywhere in the artifacts.
- **The review round was worth its cost.** 11 Mediums on a slice whose whole point is truthfulness
  under failure, two of which (M2, M7) were defects in exactly that property. A merge without it would
  have shipped a board that can silently show stale data on the reconnect path its own AC exercises.

**What needs improvement**

- **Omissions are structurally under-reported.** Ten changes reported, one drop missed. Reporting
  scales with what you touched; nothing scales with what you didn't.
- **A checklist item can be satisfied and false.** "Numbers carry provenance" was ticked truthfully
  while the numbers were wrong. Controls that check form need a companion that checks substance.
- **"Cross-surface contract" is read too narrowly** — as types and schemas, not as sets of values.
  The status-set duplication passed every existing check.

**For next implementation**

1. When the plan declares UX states, bind each to a task in the COMPLETION CHECKLIST — an unowned
   state is one nobody notices is missing.
2. Recompute every figure at PR time from a command, after the final commit.
3. When a plan names a set of enum values that two surfaces both need, put it in `packages/shared` in
   the same task that first uses it — not after a review points out that three predicates agree by
   coincidence.
