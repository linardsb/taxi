# System Review — `mint:ride`, the live tracked-ride paid-call instrument

**Plan reviewed**: `.claude/plans/mint-tracked-ride-dev-script.md`
**Execution report**: `.claude/execution-reports/mint-tracked-ride-dev-script.md`
**Issue / PR**: #94 · [#107](https://github.com/linardsb/taxi/pull/107), merged `8f83b4a`
**Date**: 2026-08-13
**Prior review, same failure mode**: `.claude/system-reviews/tracking-eta-maps-quantized-cache-review.md` (#87)

## Overall Alignment Score: 9/10

Ten divergences, all documented, all justified. Hard rules clean. The one defect that reached `main`
was **not a divergence** — the implementation reproduced the plan faithfully, and the plan was wrong.

**The score is high for the same reason the defect shipped**, and that is the most important sentence in
this document. An alignment metric rewards fidelity to the plan. A false claim that originates *in* the
plan and is copied forward accurately scores 10/10 on adherence. **This instrument is structurally blind to
the failure mode that has now produced the only two defects to reach `main` in consecutive tickets.**
#87 scored 9/10 with the identical shape.

## The headline: a remedy that did not match its own diagnosis

#87's review diagnosed the root cause exactly right:

> `root_cause: MISSING VALIDATION — no gate anywhere in the loop checks a prose claim against the code it describes. typecheck/lint/test cannot see a comment.`

The action taken was:

> `[x] Add a hard rule that a quantitative claim in a comment, plan, or PR body is a checkable assertion — show the derivation, and name which case a figure describes.`

**The diagnosis was "no gate exists." The remedy was prose in CLAUDE.md** — not a gate, and the same class
of artifact that failed.

**How this was verified, and how far the evidence actually goes** — this document argues for provenance, so
it owes its own:

- **Primary evidence (`observed`): the three loop skills were read.** `piv-plan-implementation` (512 lines),
  `piv-implement` (135) and `piv-review-pr` (93, pre-this-PR) contain **no instruction of any kind** about
  quantitative claims, provenance, or verifying a figure. Searching each for `number|claim|arithmetic|figure|observed`
  returns only unrelated hits — issue numbers, `file:line` references, a PR-number argument hint.
- **Corroborating (`observed`, at `8f83b4a`, before this PR):**
  ```
  grep -rilE "quantitative|provenance|counterfactual" .claude/skills/   → no matches
  ```
- **Two limits on that grep, stated because they matter:**
  1. **It will still return empty after this PR merges.** The `piv-review-pr` numbers pass added here
     implements the concept without using any of those three words. The grep therefore cannot distinguish
     *"no gate exists"* from *"a gate exists that doesn't use this vocabulary"* — **it is not a regression
     check**, and must not be re-run later as one.
  2. A keyword grep is a weak instrument for "contains no instruction about X" in the first place. It is
     cited as corroboration for the reading above, not as the basis of the claim.

The rule lives in exactly one place — CLAUDE.md prose — and every executable step of the loop is silent on
it. It was never wired into anything that runs.

#107 then shipped `30` under a column headed **Observed** while the script quoted that very rule four lines
below the offending figure.

### The mechanism was predicted, filed as a learning, and given no action item

#87's review, under *Key Learnings → what needs improvement*:

> *"A plan's numbers are inherited, not audited. The implementer copied `~15 s` from the plan; the reviewer re-derived it and found it wrong. Nothing between those two points would have."*

#107 reproduced this verbatim, one ticket later:

| | #87 | #107 |
|---|---|---|
| Claim originates | plan | `plan.md:447` |
| Implementer | copied `~15 s` into docblocks | copied `30` into script + report |
| Gate that checked it | none | none |
| Who caught it | the reviewer, re-deriving | the reviewer, re-deriving |
| Reached `main`? | yes | yes |

The prediction was correct and inert. **A learning without an action item is a prediction, not a control.**
That is itself a process defect: this skill's output format has a `Key Learnings` section that can absorb a
finding and discharge the feeling of having addressed it. The strongest insight from #87 went there.

## Why a careful session shipped it anyway — a rule defect, not sloppiness

The implementing session was demonstrably disciplined: 10 documented deviations, constants imported rather
than retyped, two AC branches explicitly marked "implemented but never exercised," an 880-line overrun
justified with arithmetic against sibling files. This is not a session that was cutting corners.

AC #7 reads *"Every number in the report is either an imported policy constant or shown with its arithmetic,
and the summary names the heading it describes."* It was marked **MET**, and **that marking was defensible**:

- `30 = 6 cells × 5 polls` — true arithmetic, shown.
- The heading case (due north, best case for spend) — named, at length, correctly.

The rule demands *arithmetic* and *which case*. It never asks:

1. **Provenance** — did a run produce this, or did I compute it?
2. **Attribution** — which mechanism is being credited, and what was held constant to isolate it?

Both false parts of H1 live precisely in that hole. The number was arithmetically sound, correctly derived
from an assumption, and printed under a heading claiming observation, crediting a mechanism the experiment
could not isolate. **The rule was satisfied in form while the claim was false.**

This reframes the fix. "Follow the rule harder" is not available — the rule was followed. The rule is
incomplete.

## Divergence Analysis

```yaml
divergences_1_through_10:
  summary: pre-flight quote-corridor clear · ping at cell 0 exactly · diagnostics before
           socket adapter · cancel over the wire · driver left offline · per-cell shape
           assertion · MOVE_CONFIRM capped · env overrides · OTP ceiling · 880 lines
  classification: good ✅ (all ten)
  justified: yes
  root_cause: plan assumptions met reality; each documented in place with reasoning
  note: the reviewer independently credited #2–#7 as honest self-disclosure rather than
        flagging them. Deviation reporting is the healthiest part of this loop.
```

```yaml
divergence: none — the implementation matched the plan exactly
planned: report the unquantized counterfactual as 30; a 5× reduction attributable to #87's ETA grid
actual: printed 30 under "Observed"; credited #87's grid in four further lines of prose
reason: inherited from plan.md:447,449 without re-derivation
classification: bad ❌ (the claim, not the code)
justified: no
root_cause: MISSING VALIDATION — unchanged from #87. The remedy applied after #87 was prose
            in CLAUDE.md; no executable step in the loop was modified, so nothing new could
            catch it. Compounded by a RULE DEFECT: the rule requires arithmetic + case,
            not provenance + attribution, so AC #7 could be marked MET truthfully.
```

```yaml
divergence: the first review-fix pass was incomplete
planned: (n/a — review-fix phase)
actual: corrected the figure on four surfaces, verified with `grep "30 → 6"`, reported all
        four consistent; four lines of prose attribution ("the quantized cache this script
        measures") survived, one of them in the PR body
reason: verification targeted the number's sentence form rather than the claim's subject
classification: bad ❌
justified: no
root_cause: MISSING VALIDATION — `piv-fix-review-findings` has no instruction on how to
            verify a claim was actually retired. Caught on a second pass, before merge.
```

## Pattern Compliance

- [x] **Followed codebase architecture** — no slice violated; the script is a non-slice instrument.
- [x] **Used documented patterns** — contracts imported from `@taxi/shared`, no provider SDK import, no
      money in the script, phones masked, ride status changed only via `POST /rides/:rideId/cancel`
      through `assertTransition` (deviation 4, an explicit hard-rule win over the spec's direct write).
- [x] **Applied testing patterns correctly** — no jest tests, deliberately and per the plan's Non-Goals;
      four in-run self-checks substitute, and the positive control was genuinely exercised.
- [~] **Met validation requirements** — the CI-parity gate was green and Level 4 was genuinely performed
      (this was the whole point of the ticket). **AC #7 was marked MET while violated**, which is the
      finding above: the AC could not detect its own violation.

## System Improvement Actions

Prioritised. **CLAUDE.md and `piv-review-pr` are the two to act on now**; the rest are logged.

**Update CLAUDE.md:** ← ACT ON THIS

- [ ] Amend the existing numbers rule with the missing clause. Do **not** restate it — it was followed.
      Suggested replacement for the current bullet:

  > **A number or a guarantee in a comment, plan or PR body is a claim, not decoration.** Every figure
  > carries its **provenance**: `observed` (name the run that produced it), `derived` (show the arithmetic
  > **and** state the condition it assumes), or `expected` (not yet run). A figure under an **Observed**
  > heading that no run produced is the defect, regardless of whether its arithmetic is correct. When a
  > figure credits a mechanism, say what was held constant to isolate it — if nothing was, it is not
  > evidence for that mechanism. #87 shipped a best-case interval labelled worst-case; #107 shipped a
  > correctly-derived counterfactual labelled observed, and its arithmetic was sound — showing the
  > arithmetic is necessary and not sufficient.

**Update `piv-review-pr`:** ← ACT ON THIS

- [ ] Add an explicit **numbers pass** to the review step: enumerate every figure in the PR body and
      report, and ask of each — *which run produced this?* A figure that cannot name one is `derived` and
      must say so. This review caught H1 by doing exactly this ad hoc; making it a step makes it
      repeatable rather than dependent on reviewer instinct. **The reviewer is currently the only actor in
      the loop who re-derives anything** — that is the single highest-leverage place to put the gate.

**Update `piv-plan-implementation`:** — logged

- [ ] A plan's quantitative claims must carry provenance at authoring time. `30` entered at the plan stage,
      was inherited twice, and was audited only at review. Catching it at review works; catching it at
      authoring prevents it. (Also still open from #87: Level 4 manual steps must be *performable with what
      the ticket ships*.)

**Update `piv-fix-review-findings`:** — logged

- [ ] After retiring a claim, grep for the claim's **subject** (`quantiz`, `grid`, `#87`), not the figure's
      sentence form, and re-read every hit. A claim survives as a verb (*"the quantized cache this script
      **measures**"*) long after its number is gone.
- [ ] Enumerate the claim's surfaces before fixing. This review cited three; there were four. **The PR body
      is the most-read surface and the easiest to miss because it is not in the working tree.**
- [x] The PR-state guard added after #87 **worked** — confirmed #107 `OPEN` before any edit. Prior action
      items do land when they modify an executable step.

**Update `system-evolution-review` (this skill):** — logged

- [ ] `Key Learnings` absorbs findings that deserve action items. #87's sharpest insight went there and
      stayed inert for one ticket. Suggested rule: **any learning phrased as a recurring mechanism must
      either become an action item or be explicitly marked "accepted risk, not worth a control."**
- [ ] The alignment score cannot see plan-inherited defects — faithful reproduction of a wrong plan scores
      10/10. Consider scoring plan *correctness* separately from plan *adherence*, or the metric will keep
      reading 9/10 through consecutive shipped defects.

## Key Learnings

**What worked well:**

- **Deviation reporting is the healthiest part of this loop, two tickets running.** Ten divergences
  documented with reasoning, and the reviewer credited rather than flagged them.
- **Prior action items land when they touch an executable step.** The `piv-fix-review-findings` PR-state
  guard from #87 fired correctly this session. The contrast with the CLAUDE.md rule — same review, same
  date, one wired into a skill and one written as prose — is close to a controlled experiment on which
  kind of remedy survives.
- **Triage-before-fixing paid for itself again.** The review offered two fixes and named H1 a judgement
  call; both were declined in favour of a third path drawn from the file's own `NAME THE HEADING`
  precedent. Option (b) would have rewritten the measuring instrument, unverifiably, to fix a label.
- **The instrument found a real environment defect before it measured anything.**

**What needs improvement:**

- **The loop still has no gate on prose.** Unchanged since #87, now with two shipped defects behind it.
  typecheck, lint, test and build all pass while a report asserts something no run produced.
- **Numbers flow downhill unaudited: plan → implementation → report → PR body.** Four surfaces, one
  origin, zero re-derivations before the reviewer.
- **A rule that is satisfiable in form is not a control.** AC #7 was truthfully marked MET over a false
  claim. Any check phrased as "show your work" is passed by showing *some* work.
- **Verification tends to match the shape of the last fix, not the claim.** Both the implementing session
  and my own review-fix pass checked the thing that was salient (arithmetic; the numeral) rather than the
  thing that was asserted (provenance; the attribution).

**For next implementation:**

- Act on the two starred items above and nothing else — CLAUDE.md's provenance clause and the
  `piv-review-pr` numbers pass. Per CLAUDE.md, 1–2 suggestions, not all of them.
- Fix the environment defects (Redis URL on 6379 vs compose's 6381; the 5-runs/hour OTP cap). They block a
  live re-run of `mint:ride`, and therefore block #108.
- When #108 is planned, its "would be 30" figure needs provenance from the start — it holds only if the
  jitter offsets differ at the **4th** decimal, where the corridor key renders. That is precisely the class
  of claim this review exists to stop shipping unlabelled.
