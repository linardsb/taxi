---
name: system-evolution-review
description: Performs a meta-level review of how well an implementation followed its plan, classifying divergences and recommending AI-Layer improvements. Use after an execution report exists to find bugs in the process, not the code.
argument-hint: "[plan-file] [execution-report-file] — or a free-form scope for a project-wide review"
arguments: [plan, report]
---

# System Review

Perform a meta-level analysis of how well the implementation followed the plan and identify process improvements.

## Purpose

**System review is NOT code review.** You're not looking for bugs in the code - you're looking for bugs in the process.

**Your job:**

- Analyze plan adherence and divergence patterns
- Identify which divergences were justified vs problematic
- Surface process improvements that prevent future issues
- Suggest updates to AI-Layer assets (CLAUDE.md, plan templates, skills)

**Philosophy:**

- Good divergence reveals plan limitations → improve planning
- Bad divergence reveals unclear requirements → improve communication
- Repeated issues reveal missing automation → create skills

## Context & Inputs

**Check both arguments before you read anything.** They are POSITIONAL — plan first, execution
report second — and getting one argument instead of two is the common failure: `$plan` silently
receives the report and `$report` resolves to empty. If either is missing, or if `$plan` points
into `.claude/execution-reports/` (which means they were passed in one slot or reversed), say
which you got and ask — do not guess. Correct form:

```
/system-evolution-review .claude/plans/<feature>.md .claude/execution-reports/<feature>.md
```

**A first argument that does not end in `.md` is a word-split sentence, not a plan path** — this file's
own project-wide run got `$plan`="the", `$report`="whole" (2026-09-04, ledger L12). Test that suffix
before reading anything; if it fails, do not ask — run project-wide: scope from the sentence you were
invoked with, `.claude/system-reviews/*.md` plus `.claude/execution-reports/*.md` read in place of the
pair, and every later `$plan`/`$report` naming those two sets.

**Remedy ledger — read FIRST, before the four artifacts:**
`.claude/system-reviews/REMEDY-LEDGER.md` — every prior review's recommended-but-unapplied remedies,
with status. Two things to do with it: (1) check whether any open item's *class* recurred in the loop
you are reviewing — a recurrence of a logged item is a finding in itself, at higher severity than a new
one (#87 logged the Level-4 item, #94 paid for it); (2) its top-ranked items are the default candidates
for this review's 1–2 apply slots, ahead of anything newly discovered of equal weight — the queue exists
because "first candidate for the next loop's apply slot" once sat unapplied for seven loops (#86 → #150).

You will analyze four key artifacts:

**Plan Skill:**
Read this to understand the planning process and what instructions guide plan creation.
`.claude/skills/piv-plan-implementation/SKILL.md`

**Generated Plan:**
Read this to understand what the agent was SUPPOSED to do.
Plan file: $plan

**Execute Skill:**
Read this to understand the execution process and what instructions guide implementation.
`.claude/skills/piv-implement/SKILL.md`

**Execution Report:**
Read this to understand what the agent ACTUALLY did and why.
Execution report: $report

## Analysis Workflow

### Step 1: Understand the Planned Approach

Read the generated plan ($plan) and extract:

- What features were planned?
- What architecture was specified?
- What validation steps were defined?
- What patterns were referenced?

### Step 2: Understand the Actual Implementation

Read the execution report ($report) and extract:

- What was implemented?
- What diverged from the plan?
- What challenges were encountered?
- What was skipped and why?

### Step 3: Classify Each Divergence

For each divergence identified in the execution report, classify as:

**Good Divergence ✅** (Justified):

- Plan assumed something that didn't exist in the codebase
- Better pattern discovered during implementation
- Performance optimization needed
- Security issue discovered that required different approach

**Bad Divergence ❌** (Problematic):

- Ignored explicit constraints in plan
- Created new architecture instead of following existing patterns
- Took shortcuts that introduce tech debt
- Misunderstood requirements

### Step 4: Trace Root Causes

For each problematic divergence, identify the root cause:

- Was the plan unclear, where, why?
- Was context missing, where, why?
- Was validation missing, where, why?
- Was manual step repeated, where, why?

### Step 5: Generate Process Improvements

Based on patterns across divergences, suggest:

- **CLAUDE.md updates:** Universal patterns or anti-patterns to document
- **Plan skill updates:** Instructions that need clarification or missing steps
- **New skills:** Manual processes that should be automated
- **Validation additions:** Checks that would catch issues earlier

## Output Format

Save your analysis to: `.claude/system-reviews/[feature-name]-review.md`

### Report Structure:

#### Meta Information

- Plan reviewed: [path to $plan]
- Execution report: [path to $report]
- Date: [current date]

#### Overall Alignment Score: \_\_/10

Scoring guide:

- 10: Perfect adherence, all divergences justified
- 7-9: Minor justified divergences
- 4-6: Mix of justified and problematic divergences
- 1-3: Major problematic divergences

**The adherence score is blind to plan-inherited defects** — a false claim born in the plan and copied
forward faithfully scores as adherence, not as a defect. #87 and #107 both scored 9/10 and produced the
only two defects that ever reached `main`.
When a defect originated in the plan and was reproduced faithfully, say so beside the score and classify
it as a plan defect (`bad ❌`, root cause at the plan/skill level); do not let adherence absorb it.

#### Divergence Analysis

For each divergence from the execution report:

```yaml
divergence: [what changed]
planned: [what plan specified]
actual: [what was implemented]
reason: [agent's stated reason from report]
classification: good ✅ | bad ❌
justified: yes/no
root_cause: [unclear plan | missing context | etc]
```

#### Pattern Compliance

Assess adherence to documented patterns:

- [ ] Followed codebase architecture
- [ ] Used documented patterns (from CLAUDE.md)
- [ ] Applied testing patterns correctly
- [ ] Met validation requirements

#### System Improvement Actions

Based on analysis, recommend specific actions:

**Update CLAUDE.md:**

- [ ] Document [pattern X] discovered during implementation
- [ ] Add anti-pattern warning for [Y]
- [ ] Clarify [technology constraint Z]

**Update Plan Skill ($plan):**

- [ ] Add instruction for [missing step]
- [ ] Clarify [ambiguous instruction]
- [ ] Add validation requirement for [X]

**Create New Skill:**

- [ ] A new skill for [manual process repeated 3+ times]

**Update Execute Skill:**

- [ ] Add [validation step] to execution checklist

#### Key Learnings

**What worked well:**

- [specific things that went smoothly]

**What needs improvement:**

- [specific process gaps identified]

**For next implementation:**

- [concrete improvements to try]

**Rule for this section: a learning phrased as a recurring mechanism is not allowed to rest here.**
It either becomes an action item (applied now, or a ranked row in the ledger) or is explicitly marked
**"accepted risk — not worth a control, because …"**. #87's sharpest insight ("a plan's numbers are
inherited, not audited") went into Key Learnings with no action item, and #107 reproduced it verbatim.
A learning without an action item is a prediction, not a control.

#### Update the ledger (mandatory last step)

Before finishing, update `.claude/system-reviews/REMEDY-LEDGER.md`:

- **Append** every "recommended, not applied" item from this review as a ranked row (origin, class,
  status).
- **Close** each item this review applied — move it to the closed section with the grep that verifies
  it exists at HEAD. An "acted on" checkbox in the report body is not the record; the ledger row is.
- **Increment** the recurrence column of any open item whose class fired again in this loop.

A remedy with no ledger row and no repo reference can be deleted silently and stay "applied" in an old
report forever — that is how `record-gate.sh` and `inherited-figures.sh` were deleted with no review
noticing (ledger L2).

## Important

- **Be specific:** Don't say "plan was unclear" - say "plan didn't specify which auth pattern to use"
- **Focus on patterns:** One-off issues aren't actionable. Look for repeated problems.
- **Action-oriented:** Every finding should have a concrete asset update suggestion
- **Suggest improvements:** Don't just analyze - actually suggest the text to add to CLAUDE.md or skills
