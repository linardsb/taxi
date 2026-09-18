# System review — the #225 → #227 worklets pin loop

## Meta information

- **Plan reviewed:** `.claude/plans/expo-worklets-peer-225.md` — **does not exist**. That absence is the
  subject of this review, not an obstacle to it. Divergences below are measured against **issue #225's
  body**, the de-facto plan the implementation worked from.
- **Execution report:** `.claude/execution-reports/expo-worklets-peer-225.md` (a reconstruction; its own
  provenance block says so)
- **Date:** 2026-09-18
- **Ledger read first**, as the skill requires: 2 open rows, **L17** and **L18**. Both are applied by
  this review — see *System improvement actions*. L18's class **recurred inside this loop**, `observed`.

## Overall alignment score: 9/10

Against issue #225 as the de-facto plan. Every divergence is justified, each is recorded in the PR body
with its reason, and the one that changed the answer (the causal chain) was found by tracing rather than
by accepting the ticket's version. The missing point is not a divergence: a 418-line guard test decided
in flight beside a 4-line fix is the largest judgment call in the loop, and no artifact recorded it
before the diff arrived.

**The score is close to meaningless here and should be read as such.** Adherence to a plan that does not
exist cannot be scored, and the skill's own warning applies with full force — #87 and #107 both scored
9/10 and produced the only two defects that ever reached `main`.

**Plan correctness: 6/10** — issue #225's causal chain is wrong. It names `expo-router`'s *optional*
`react-native-reanimated: "*"` peer as the source; the load-bearing declaration is
`react-native-drawer-layout@4.2.10`'s **required** `">= 2.0.0"`, reached via `@react-navigation/drawer`.
Entered at the issue body; **not reproduced** — the implementation caught it and the PR body states the
correction. The 6 is for the artifact, not for the loop: this is the fact-verification step working.

## Divergence analysis

```yaml
divergence: causal chain corrected — required peer, not the optional one
planned: "#225: expo-router's optional `react-native-reanimated: \"*\"` forced the float"
actual: "react-native-drawer-layout@4.2.10's required `>= 2.0.0`, via @react-navigation/drawer"
reason: the optional peer would have permitted "don't install it"; the required one rules that out
classification: good ✅
justified: yes
root_cause: plan_defect (inherited from the issue), caught at implementation
plan_defect: the issue's stated mechanism
entered_at: issue #225 body
reproduced_at: nowhere — corrected in PR #227's body before the fix was chosen
```

```yaml
divergence: two packages pinned, where the ticket titles one
planned: "#225 is titled for react-native-worklets being outside expo-modules-core's range"
actual: react-native-reanimated@4.5.1 AND react-native-worklets@0.10.1, both from bundledNativeModules.json
reason: pinning worklets alone leaves reanimated 4.6.0 with a violated 0.12.x peer and its own C++ wrong
classification: good ✅
justified: yes
root_cause: missing context in the ticket — it named the symptom's package, not the pair
```

```yaml
divergence: a 418-line guard test no option in the ticket asked for
planned: "O1 — two lines of pnpm.overrides"
actual: two lines of overrides plus 418 lines of guard test and two devDependencies
reason: O2's one real benefit was bringing the pair under `expo install --check`; the guard does that in
  the gate on every PR instead of when someone types the command
classification: good ✅
justified: yes
root_cause: no planning step existed in which to record a scope decision of this size
```

```yaml
divergence: O2 and O3 not taken
planned: "#225 offered three lettered options"
actual: O1 only
reason: under node-linker=hoisted the overrides already collapse each package to one version in one root
  node_modules, so O2 adds two unused dependencies and still lets the `*` spec float
classification: good ✅
justified: yes
root_cause: none — options were evaluated and the rejection is written down
```

## Pattern compliance

- [x] **Followed codebase architecture** — the guard lives in `apps/driver` beside #220's
      `build-config.test.ts`, the surface with an `eas.json` and the one that breaks first.
- [x] **Used documented patterns (CLAUDE.md)** — every figure in the PR body carries provenance, and the
      review's numbers pass independently confirmed 10 of 11. The one it could not reach is labelled as
      relayed, not as the review's own.
- [x] **Applied testing patterns correctly** — expected + edge + failure cases, and the case that
      reproduces #225 reads `expo-modules-core`'s range from the installed manifest rather than
      restating a digit that can move. `max-lines` does not apply: `.test.ts` is uncapped (#112).
- [x] **Met validation requirements** — `Tasks: 22 successful, 22 total`, CI `35351299067` at `e0e0f3e`.
- [ ] **Left a planning artifact** — the one row that fails, and the ticket.

## System improvement actions

Two apply slots, and the ledger's two open rows take both, as the skill directs ("top-ranked items are
the default candidates … ahead of anything newly discovered of equal weight"). Neither was invented here.

### ✅ Applied — L18: the word-split argument hazard, in the two skills still unguarded

**Recurrence, `observed` in this loop, in the file the row names.** Invoking
`system-execution-report` with `the #225 → #227 worklets pin loop, reconstructed from PR #227's body and
.claude/code-reviews/pr-227-review.md` rendered **`Plan file: the`** — the sentence was split on
whitespace, `$plan` took the first word and everything after it was discarded. The skill's next
instruction is to stop if `$plan` is empty, so the failure does not even announce itself: `the` is
truthy, and a session that did not notice would have read a nonexistent plan path and reported on it.

Applied to both remaining declarations, following `opportunity-scan:27`'s "read `$ARGUMENTS` as prose,
not as positional slots":

- `system-execution-report` — a shape test on `$plan` (`.md` suffix → path; present but no suffix →
  word-split sentence, recover the whole invocation; empty → the existing case), with the observed #229
  rendering quoted as the evidence.
- `piv-fix-review-findings` — the same test on `$review`, and an explicit note that `$scope` is
  free-form by design, so "fix F1 and F3, defer the rest" arrives as `$review`="fix", `$scope`="F1".

**A third case was folded in, because this loop is the one that found it.** `system-execution-report`
had no behaviour for *a well-formed plan path to a file that never existed* — the shape this loop is.
The skill now says: report `Plan file: none`, name the de-facto plan (usually the issue body), measure
divergences against it, and do not invent a file to fill the slot.

Verify at HEAD:
`grep -c "word-split" .claude/skills/{piv-fix-review-findings,system-execution-report,system-evolution-review}/SKILL.md`
→ `1`, `2`, `1` — all three `arguments:`-declaring skills now guarded (`grep -n "^arguments:"
.claude/skills/*/SKILL.md` → those same three files).

### ✅ Applied — L17: `piv-validate` called `pnpm check` the gate

`pnpm check` is `typecheck lint test`. CLAUDE.md's gate and `.github/workflows/ci.yml` both run
`typecheck lint test build --force`. The skill named the wrong command in three places (`:10`, `:25`,
`:86`) — including the one code block a reader copies.

This is not a naming quibble. **Two of the four signatures in the skill's own step 3 cannot fire under
the command step 1 named**: the TS6053 stale-`.next` race needs `next build` to be running, and a
package whose `build` is broken while its tests pass is invisible without `build`. The skill shipped a
diagnosis section for failures its own gate could not produce.

Applied: step 1 runs the parity command; the opening paragraph states plainly that `pnpm check` is not
the gate and says what it omits; the task-count check (`Tasks: N successful, N total`, and
`record-gate.sh` for any number that will be quoted) and the worktree `COMPOSE_PROJECT_NAME=taxi` prefix
are named at the point of use. The timeout cap moves from ~5 to ~10 min, because `--force` rebuilds
every package.

Verify at HEAD: `grep -n "pnpm turbo run typecheck lint test build --force"
.claude/skills/piv-validate/SKILL.md` → 32; `grep -n "pnpm check" …` → 14, 17, 100, **all three now the
correction itself** rather than an instruction to run it.

### ⏭ Recommended, not applied — A1: `piv-plan-implementation` has no entry condition

**This is #229's actual question and it cannot be closed by an agent.** Nothing in
`piv-plan-implementation` says when a ticket is too small for a plan. There is no "skip this skill if …"
clause, no minimum, no escape hatch — so skipping it is an undocumented judgment call that leaves no
record either way. #227 skipped it and nothing anywhere states that as a decision (execution report Q1).

The shape of a remedy, once Linards answers, is **one line in `piv-plan-implementation`** naming the
class that may skip and requiring a sentence in the PR body saying so — not a CLAUDE.md paragraph, which
this ledger's *Accepted risks* section already records as not firing. Ledger row A1; not applied,
because writing the rule before the decision is made is how a preference becomes a standard nobody
chose.

### ⏭ Recommended, not applied — A2: a review finding copied into an issue is a figure, and is inherited

**#229's own premise is false at `main`, and this is the fourth instance of the repo's signature
defect.** The issue states:

> `.claude/plans/` and `.claude/reports/` carry nothing for #225 or #227
> (`ls .claude/plans .claude/reports | grep -i '225\|227'` — no match, `observed` 2026-09-18)

That command **returns `pr-227-review-fixes.md`** at `cde27af` (`observed` 2026-09-18, in
`~/taxi-worktrees/wt-229`). The claim was true of the review's head `6226549`; the fixes report landed in
commit `9ad789e`, *after* the review ran and before the merge. The issue inherited the review's L6
sentence, restamped it `observed` with the day's date, and did not re-run it against the head a reader
would check it at.

The class is exactly #87's and #107's — *a figure flows plan → report → PR body and is inherited, not
audited*. What is new is the **surface**: CLAUDE.md names plan, implementation, report and PR body, and
`inherited-figures.sh` reads those. **A GitHub issue is none of them**, is not in the working tree, and
is written by the same loop that wrote the review it copies from. Every deferral in this repo travels
that path.

Not applied: it belongs in `piv-review-pr`'s deferral step (re-run any command a finding quotes before
pasting it into a tracker issue), and that is a third skill edit in a loop whose budget is 1–2. Ledger
row A2, ranked above A1 because it has a mechanism and needs no decision from Linards.

## Key learnings

**What worked well**

- The review's numbers pass caught nothing wrong because there was nothing wrong — 10 of 11 figures
  independently confirmed, the eleventh honestly labelled as unreachable. The discipline is holding on
  the surfaces it covers.
- The PR body absorbed the plan's job well enough that a cold reconstruction was possible at all. That
  is a real property of *this* body, not of PR bodies.
- A fix that destroys its own reproduction got a substitute check rather than a shrug:
  `pr-227-review-fixes.md` fed #225's shipped versions into the real walk before and after its edits and
  required byte-identical output. Reusable; currently recorded in one report only.

**What needs improvement**

- **A deferral carries a claim, and nobody re-runs it.** → action item **A2** above, not left here.
- **The loop has no stated entry condition for planning.** → action item **A1** above, pending Linards.
- **`system-execution-report`'s stop-guard assumed a cold session and a missing plan were the same
  problem.** They are not: a loop with no plan is the loop most worth a report. → folded into the L18
  apply, live in the skill now, not a prediction.

**For next implementation**

- A ticket that skips the plan should say so in one sentence in the PR body, with the reason. That costs
  nothing and makes A1 answerable from the record instead of from memory.
- **One observation, with its own caveat.** PR #230 (issue #228, this session) also shipped with no plan
  and no implementation report — a single-file test change whose whole argument is in the file and the
  PR body. That is a second instance of the class in one day, which makes it data. It is **not**
  independent evidence that the omission is correct: the same session made both calls, and a session
  agreeing with itself is not a second opinion.

## Ledger

`.claude/system-reviews/REMEDY-LEDGER.md` updated in this pass: **L17 and L18 moved to closed** with the
greps above, **A1 and A2 appended** as open rows, and L18's recurrence column incremented to 1 for the
`observed` firing in this loop. The rows are the record; the checkmarks in this document are not.
