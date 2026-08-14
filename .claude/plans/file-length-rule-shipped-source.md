# Feature: scope the ~500-line rule to shipped source, and make it executable

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

**All line numbers and counts in this plan were measured against `origin/main` at `085ef88`** (`Merge pull request #111`). The working tree this plan was written in sat at `bea4222`, two merges behind, where `mint-tracked-ride.ts` is still 898 lines. Re-verify any pin before editing.

## Feature Description

CLAUDE.md:61 ends with `Max ~500 lines per file`. Ten files in the repo exceed it. Nine of them are test
files or a test harness; the tenth is `services/api/scripts/mint-tracked-ride.ts` at 1414 lines, which is
what #112 was opened about.

This ticket resolves #112 by **option B-broad**: the rule is amended to bind the source each package
actually builds, and specs / `test/` / `tests/` / `scripts/` move outside it. Then — the part neither
option A nor option B contained — the amended rule is wired to `max-lines` in eslint, so it fails the
validation gate instead of relying on a reviewer noticing.

## User Story

As the sole maintainer of this repo
I want the file-length rule to say something true and to be checked by the gate
So that a reviewer never again has to decide, per PR and inconsistently, whether it applies

## Problem Statement

Three separate problems, and only the first is the one #112 names.

**1. The rule is false as written.** `Max ~500 lines per file` is unconditional. Ten files break it
(measured, `origin/main`):

| lines | file | why it is over |
|---|---|---|
| 1414 | `services/api/scripts/mint-tracked-ride.ts` | dev instrument |
| 857 | `services/api/src/features/dispatch/dispatch.integration.spec.ts` | spec |
| 789 | `services/api/src/features/notifications/tracking/tracking.integration.spec.ts` | spec |
| 676 | `services/api/src/features/rides/lifecycle/ride-lifecycle.integration.spec.ts` | spec |
| 668 | `services/api/src/features/rides/lifecycle/ride-lifecycle.service.spec.ts` | spec |
| 614 | `services/api/src/features/payments/payments.integration.spec.ts` | spec |
| 608 | `services/api/src/features/drivers/drivers.integration.spec.ts` | spec |
| 539 | `services/api/src/features/geo/caching-maps.provider.spec.ts` | spec |
| 508 | `services/api/test/harness.ts` | test harness |
| 502 | `services/api/src/features/auth/auth.service.spec.ts` | spec |

Provenance: `observed` — `git show origin/main:<path> | wc -l`, run over every `.ts`/`.tsx` tracked on
`origin/main`. Every one of the ten sits inside what `services/api/tsconfig.build.json` already excludes:
`["node_modules", "test", "dist", "scripts", "**/*spec.ts"]`. The largest **shipped** file in the whole
repo is `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` at **447**.

**2. Reviewers have already applied the rule two different ways, in consecutive PRs.**

- `.claude/code-reviews/pr-107-review.md:150-152` filed the 880-line script under *"Acknowledged, not
  issues"*: *"The rule sits inside CLAUDE.md's VSA bullet and governs slice source; this is neither a
  slice nor shipped code."*
- `.claude/code-reviews/pr-110-review.md:109-114` (D1) filed the same file, now 1414 lines, under
  **HUMAN DECIDES**: *"the rule is unconditional."*

Same rule, same file, opposite readings, three weeks apart. That is the actual defect: the boundary
exists in reviewers' heads and is re-litigated per PR.

**3. Nothing enforces it.** Checked and confirmed absent: no `max-lines` or `max-lines-per-function` in
`packages/config/eslint/base.mjs`, `services/api/eslint.config.mjs`, `db/eslint.config.mjs`,
`packages/shared/eslint.config.mjs`, `apps/dispatch/eslint.config.mjs`, `apps/admin/eslint.config.mjs`;
no line-count check in `.claude/hooks/pre_tool_use.py` or `.claude/hooks/stop_check.py`. The rule is
prose only. Per `taxi-piv-remedies-need-an-executable-step`, prose-only remedies in this repo have a
track record of not firing (#87).

## Solution Statement

1. Amend `CLAUDE.md:61` so the cap binds **shipped source** — the set each package's build compiles —
   and states plainly that dev instruments are outside it and uncapped.
2. Propagate the amended rule to the three **live** surfaces that restate it, so no surface contradicts
   the rules file: `.claude/agents/code-reviewer.md:46`, `.claude/skills/vertical-slice-audit/SKILL.md:151`,
   `docs/build-playbook.md:156`. The first of these is the one that matters most — it is the agent
   `piv-review-changes` and `piv-review-pr` dispatch, i.e. the surface that actually runs on every PR.
3. Add `max-lines: ['error', { max: 500 }]` to `packages/config/eslint/base.mjs`, with an override
   switching it off for the dev-instrument globs, so the amended rule is a gate failure rather than a
   reviewer's judgement.
4. Mirror the same two config entries into `apps/dispatch/eslint.config.mjs` and
   `apps/admin/eslint.config.mjs`, which do **not** consume the shared base (they extend
   `eslint-config-next` only). Without this, CLAUDE.md would claim enforcement across a set the gate
   does not cover.
5. Prove the gate actually fires, by making it fail on purpose once and reverting.
6. Close the loop on `.claude/code-reviews/pr-110-review.md` D1.

**Why 2 is not optional.** `taxi-piv-remedies-need-an-executable-step` records that #87 ran both a
CLAUDE.md prose edit and a skill edit, and *only the skill edit survived*. A rules-file amendment whose
own review agent still carries the old sentence is that failure reproduced — the amendment would be
overruled by the surface that runs.

## Out of Scope / Non-Goals

- **Not splitting `mint-tracked-ride.ts`.** Option A was considered and rejected (see NOTES). The file
  stays at 1414 lines.
- **Not capping dev instruments at a looser bound.** This was offered and declined: specs, `test/` and
  `scripts/` get **no** length cap at all. The amendment must not imply otherwise (see the wording
  GOTCHA in Task 1) — the issue's trajectory concern is therefore only partly answered, and that is a
  recorded, deliberate call, not an oversight.
- **Not touching any of the ten over-length files.** They become compliant by amendment, not by edit.
- **Not rewriting historical artifacts.** **25** files cite the old `~500` phrasing (`observed` at base
  `085ef88`; the earlier 23 was measured in the pre-merge `bea4222` tree — the #110 merge added
  `.claude/code-reviews/pr-110-review.md` and `.claude/reports/mint-ride-sub-cell-jitter-report.md`).
  Note this is a *different* survey from Task 0's, which counts over-length source files, not prose
  citations:

  ```bash
  grep -rln -iE "500 lines|~500|≤500|500-line" \
    .claude/code-reviews/ .claude/plans/ .claude/reports/ .claude/execution-reports/ \
    | grep -v file-length-rule | wc -l     # → 25 at 085ef88
  ```

  Run in the post-review tree this returns **26**: `pr-113-review.md` quotes the "500-line rule" in its
  own title and its filename does not match the `file-length-rule` filter. The 25 is pinned to the base,
  as labelled.

  These are dated records that were true when written —
  CLAUDE.md's "retire the subject" rule governs *live* claims, not the archive. **Only
  `pr-110-review.md` gets a resolution line**, because its D1 is an open item this ticket closes.
  The distinction that decides each file: does anything read it to make a future decision? Reviews,
  reports and executed plans do not; the three surfaces in Tasks 2–4 do.
- **Not adding a lint script to `apps/rider` / `apps/driver`.** Neither has an eslint config or a `lint`
  script at all; both are `typecheck`-only. That is a real gap in the gate's reach — recorded as Open
  Question #1, and the amendment is phrased so it neither hides the gap nor goes false when it closes.
- **Not adding `max-lines-per-function`** — though it is the better complexity proxy, and this is the
  most defensible thing left on the table. Measured (`observed`, crude brace scan at `085ef88`): the
  largest function in shipped source is `settle()` at **122** lines, and the next four are 116, 112,
  106, 91 — so a 150–200 cap would bind today with real headroom. `main()` in the exempted script is
  **348**, ~2.9× the largest shipped function, which is the signal a file-level rule misses entirely.
  Deferred anyway: it is a second unrequested rule, a second number to defend, and a second escape
  hatch — and #112 asked for one decision, not a linting programme. Worth its own ticket.

## DECISION RECORD

#112 exists to hold a decision, so the decision is recorded here as the artifact rather than left
implied by the plan's shape.

**Decided**: 2026-08-14, by Linards, on a closed ticket with no PR open — the condition #112 set
("decided **cold** rather than under pressure from an open PR").

| | |
|---|---|
| **Chosen** | **B-broad** — the ~500-line rule binds *shipped source*; specs, `test/`/`tests/` and `scripts/` move outside it — **plus** an executable `max-lines` gate, which was in neither option as #112 framed them. |
| **Declined — A (split)** | The review's three seams leave ~1010 lines in one file (Task 0 audits this); a compliant split needs 5 files. It fixes one file's number and none of the four underlying problems. |
| **Declined — B-narrow (`scripts/` only)** | The literal option B. Would amend the rule and leave it false about nine other files. |
| **Declined — a looser cap on dev instruments** | Offered during the decision and turned down. `scripts/`, `test/` and specs are **uncapped**, deliberately. |

**What the decision rests on, and what it doesn't.** Three measured findings moved it, all reproducible
at base `085ef88` (Task 0 re-verifies them): option A never reached compliance as scoped; nothing
enforced the rule anywhere; and `pr-107-review.md:150-152` and `pr-110-review.md:109-114` reached
*opposite* conclusions about the same file under the same rule, three weeks apart. That last one is the
actual defect — the boundary lived in reviewers' heads. One argument was checked and **discarded**
rather than used: "the file is long because the numbers rule mandates provenance prose" is false (33%
comments against the largest shipped file's 30.6%; 888 code lines alone is 1.8× the cap).

**Amended after the decision, before implementation**: the `eslint-disable max-lines` guard in Task 2.
A gate that one comment can switch off for a whole file is not executable, which is the property the
decision was actually buying. Not a change of direction — a gap in the chosen direction.

**Known and accepted**: the trajectory concern #112 closes on is **not** solved. See NOTES.

## Feature Metadata

**Feature Type**: Refactor (rules + tooling; no product code changes)
**Estimated Complexity**: Low
**Primary Systems Affected**: `CLAUDE.md`, `.claude/agents/code-reviewer.md`,
`.claude/skills/vertical-slice-audit/`, `docs/build-playbook.md`, `packages/config/eslint`,
`apps/dispatch`, `apps/admin`
**Dependencies**: none new — `max-lines` is a core ESLint rule, already available

## Related Work

**Implements**: https://github.com/linardsb/taxi/issues/112 (`Closes #112`)   ·   **Epic**: none — this is a
standalone rules ticket raised out of a review.

**Back-references**:

- `.claude/code-reviews/pr-110-review.md` (D1) — Why: the finding this ticket resolves; supplies the
  "three clean seams" claim that Task 0 audits.
- `.claude/code-reviews/pr-107-review.md:150-152` — Why: the same exemption argument, accepted
  informally on the prior PR. The inconsistency between the two is the case for an explicit boundary.
- `.claude/plans/mint-ride-sub-cell-jitter.md` — Why: #108, the ticket that grew the file 898 → 1414.

**Forward-references**:

- (none yet) — a follow-up for `apps/rider`/`apps/driver` lint coverage is a candidate.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `CLAUDE.md` (line 61) - Why: the single line being amended. Read the surrounding "Hard rules" bullets
  first — they are dense, evidence-citing, and the amendment must match that register.
- `packages/config/eslint/base.mjs` (all 37 lines) - Why: the file getting the rule. Its header docblock
  states an explicit convention — *"Whatever a package needs on top (extra globals, a rule it turns off)
  goes in that package's own config, not here (#53)"*. The dev-instrument override is **not** a
  per-package need; it is part of the rule's own definition, so it belongs in the base. Say so in the
  comment.
- `services/api/eslint.config.mjs` - Why: shows the `tseslint.config(...base, {...})` spread order. Also
  its `package.json` lint glob is `"{src,test,scripts}/**/*.ts"` — it *does* lint `scripts/`, which is
  why the override is required rather than optional.
- `apps/dispatch/eslint.config.mjs` and `apps/admin/eslint.config.mjs` - Why: both use
  `defineConfig([...nextVitals, ...nextTs, globalIgnores([...])])` and **never import the shared base**.
  This is the finding that makes Tasks 3–4 necessary; verify it still holds before implementing.
- `services/api/tsconfig.build.json` - Why: `exclude: ["node_modules", "test", "dist", "scripts",
  "**/*spec.ts"]` is the machine-readable shipped/dev boundary the amendment points at. `db` and
  `packages/shared` draw the same line the other way round, with `include: ["src"]`.
- `.claude/agents/code-reviewer.md` (line 46, under `### 3. Architecture compliance (VSA)`) - Why: the
  most important file in this ticket. It carries `- Max ~500 lines per file.` and is the agent
  `piv-review-changes` / `piv-review-pr` dispatch — the surface that runs on every PR. Read the
  surrounding bullets: they are one clipped line each, and the replacement must match.
- `.claude/skills/vertical-slice-audit/SKILL.md` (line 151, critical principle 4) - Why: restates the
  rule in a parenthetical — *"In this repo the max-500-lines-per-file rule from CLAUDE.md still
  applies"*.
- `docs/build-playbook.md` (line 156) - Why: condensed restatement of the hard rules — `≤500 lines/file`.
- `.claude/code-reviews/pr-110-review.md` (lines 109-114) - Why: D1, the finding being closed.

### New Files to Create

- (none)

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [ESLint — `max-lines`](https://eslint.org/docs/latest/rules/max-lines)
  - Specific section: Options (`max`, `skipBlankLines`, `skipComments`, `skipTrailingComments`)
  - Why: defaults are `skipBlankLines: false`, `skipComments: false`. Keep both false — the repo's rule
    has always been about total file size, and this file is 33% comments (see NOTES); a
    `skipComments: true` cap would be a different rule wearing the same number.
- [ESLint — Configuration files: cascading and `files`](https://eslint.org/docs/latest/use/configure/configuration-files#specifying-files-and-ignores)
  - Specific section: how a later config object's `rules` override an earlier one for matching `files`
  - Why: the dev-instrument override must be ordered **after** the object that sets `max-lines`, and
    both must sit inside the array `base.mjs` exports so the spread `...base` preserves that order.

### Patterns to Follow

**eslint base config — every rule carries its reason as a comment** (`packages/config/eslint/base.mjs:25-33`):

```js
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // The omit-by-rest idiom (`const { x: _drop, ...rest } = obj`) is
      // legitimate; the base-ESLint default for this option is `false`, which
      // flags it.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
```

Match this: a rule that is not self-evident gets a comment saying why, with the ticket number.

**CLAUDE.md hard rules — a claim names its evidence** (`CLAUDE.md`, the numbers bullet). Amended text
that says "enforced" must be enforced everywhere it implies, and where it is not, it says so.

---

## IMPLEMENTATION PLAN

### Phase 0: Audit the inherited claim

The review's "three clean seams" is a number nobody checked. Confirm it before the plan's rationale
rests on it.

### Phase 1: Amend the rule, everywhere it is stated

**Depends on:** Phase 0 (the audit is the rationale the amendment cites).

Tasks 1–4. CLAUDE.md is the rule; the code-reviewer agent, the vertical-slice-audit skill and the build
playbook are three places that restate it. All four move together or the repo contradicts itself.

### Phase 2: Make it executable

**Depends on:** Phase 1 (the config must enforce exactly what the prose now says).

**Independent of:** Phase 1's Tasks 2–4 in the mechanical sense — the eslint edits do not read those
files. Sequenced after them only so the prose is settled before it is encoded; a parallel loop could
take Tasks 2–4 and Tasks 5–7 in separate worktrees if that helps.

### Phase 3: Prove the gate fires, and close the loop

**Depends on:** Phase 2.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom.

### 0. VERIFY the seam arithmetic and the file survey

- **IMPLEMENT**: From a fresh worktree on `origin/main`, reproduce the three figures this plan's
  rationale rests on:
  1. `wc -l services/api/scripts/mint-tracked-ride.ts` → expect **1414**
  2. the ten-file survey table above → expect exactly ten `.ts`/`.tsx` files over 500, all inside
     `tsconfig.build.json`'s exclude set, largest shipped **447**
  3. the review's three seams → geometry+guards `[104-210]` ≈ **107**, report+assertions `[1049-1345]`
     ≈ **297**, leaving *"the run"* at **1414 − 107 − 297 ≈ 1010** — still 2× the cap
- **GOTCHA**: (3) is the load-bearing one. `.claude/code-reviews/pr-110-review.md:111` asserts three
  *clean* seams without stating their sizes; splitting on them as written leaves a ~1010-line file, so
  option A as scoped never reached compliance. If your measurement disagrees with 1010, **stop and
  re-scope** — the recommendation in NOTES depends on it.
- **GOTCHA**: use `wc -l`, not a line-splitting script. Splitting on `\n` yields 1415 for a
  newline-terminated file; that off-by-one is how a plan ships a figure one past the truth.
- **VALIDATE**:
  ```bash
  git ls-tree -r origin/main --name-only \
    | grep -E '\.(ts|tsx)$' \
    | while read f; do n=$(git show "origin/main:$f" | wc -l); [ "$n" -gt 500 ] && echo "$n $f"; done \
    | sort -rn
  ```
- **SATISFIES**: AC #1

### 1. UPDATE `CLAUDE.md` (line 61)

- **IMPLEMENT**: Replace the VSA bullet's trailing `Max ~500 lines per file.` with a scoped, enforced,
  honestly-bounded version. Proposed text — adjust prose, keep every factual clause:

  ```markdown
  - Vertical Slice Architecture inside every app/service: one folder per feature owning
    routes/service/schemas/tests; `index.ts` is the slice's public API. **Max 500 lines per file of
    shipped source** — what each package's build compiles — enforced by `max-lines` in every package
    that runs eslint. Specs, `test/`/`tests/` and `scripts/` are **outside the rule and uncapped** (#112).
  ```
- **GOTCHA — write the invariant, not the census.** No file names, no line counts, no package
  enumeration in this bullet. Every such figure is guaranteed to drift, and `mint-tracked-ride.ts`'s is
  drifting *by design* — this ticket deliberately leaves dev instruments uncapped, so writing "1414"
  into the rules file would pin a number whose growth was just declined. PR #111, one commit before this
  ticket's base, was `docs: correct CLAUDE.md's short-gate figure` — a stale CLAUDE.md number being
  fixed. Do not add two more. The census belongs in the PR body and this plan, dated and with
  provenance. "Every package that runs eslint" is still the right phrasing — a two-app enumeration
  drifts worse — but be precise about *why*, because it is not self-maintaining: the sentence stays true
  only as long as any newly-added lint config carries the rule. Tasks 6–7 exist precisely because
  `apps/dispatch` and `apps/admin` added eslint **without** consuming the shared base, so a future
  `apps/rider` lint script could falsify this sentence on the day it lands. That is Open Question #1,
  not a property of the wording.
- **GOTCHA — the wording trap.** Do **not** write that dev instruments "answer to a trajectory check",
  or that their growth is "a review call, not a gate", or any phrase implying some other mechanism
  bounds them. Nothing does. The second phrasing is the trap one notch quieter — it asserts review
  covers this, and the Problem Statement above proves review does not (`pr-107` and `pr-110` reached
  opposite conclusions on the same file). `outside the rule and uncapped` is the whole honest claim.
- **GOTCHA**: `~500` becomes `500`. The tilde was honest for a rule a human eyeballed; once a gate
  enforces an exact integer, a soft-looking bound misdescribes it.
- **GOTCHA**: keep the sentence inside the existing VSA bullet. Promoting it to its own bullet changes
  what the rule is attached to, and the whole B-broad argument is that its placement inside VSA was
  always meaningful.
- **PATTERN**: the surrounding hard rules — assertive, evidence-citing, ticket-numbered.
- **VALIDATE**: `grep -n "500 lines" CLAUDE.md` → one hit, on the VSA bullet; and
  `grep -nE "trajectory check|review call|1414|447|apps/rider" CLAUDE.md` → no hits.
- **SATISFIES**: AC #2, AC #3

### 2. UPDATE `.claude/agents/code-reviewer.md` (line 46)

- **IMPLEMENT**: Replace `- Max ~500 lines per file.` under `### 3. Architecture compliance (VSA)` with
  the scoped version, matching the sibling bullets' clipped register:

  ```markdown
  - Max 500 lines per file of shipped source. Specs, `test/`/`tests/` and `scripts/` are outside the
    rule and uncapped — do not flag them for length.
  ```
- **GOTCHA — this is the load-bearing task.** This agent is dispatched by `piv-review-changes` and
  `piv-review-pr`; it is the surface that runs on every PR. Left unedited it would keep flagging exempt
  files, and the human would keep adjudicating — which is problem #2 in the Problem Statement, still
  unfixed after a rules amendment that claims to fix it. Per
  `taxi-piv-remedies-need-an-executable-step`, the skill/agent surface is the one that survives; the
  CLAUDE.md prose is the one that historically did not.
- **IMPLEMENT (second bullet, same section)**: add the escape-hatch guard —

  ```markdown
  - Flag any `eslint-disable` of `max-lines`: the length gate is the one rule a single comment can
    switch off for a whole file, so a disable must be argued in the PR body, never silent.
  ```
- **GOTCHA**: the `do not flag them for length` clause is not padding. Without it the agent can read the
  exemption as "mention it but don't block", which is exactly the behaviour #110 D1 produced.
- **GOTCHA — why the second bullet is load-bearing.** `/* eslint-disable max-lines */` is one line at
  the top of a file and makes the gate optional wherever someone puts it. The repo currently uses
  `eslint-disable` exactly twice (`observed` — `apps/dispatch/.../tracking-map.tsx:244` and
  `stripe-payments.provider.spec.ts:45`), both `-next-line` and both naming a specific rule, so the
  convention is already right — it is just not encoded anywhere. Without this, "enforced by `max-lines`"
  is true of the config and false of the repo the first time someone reaches for the hatch.
- **VALIDATE**: `grep -n "500" .claude/agents/code-reviewer.md` → one hit, with `shipped source` on it;
  `grep -n "eslint-disable" .claude/agents/code-reviewer.md` → the new bullet.
- **SATISFIES**: AC #4

### 3. UPDATE `.claude/skills/vertical-slice-audit/SKILL.md` (line 151)

- **IMPLEMENT**: In critical principle 4 ("Coupling beats LOC"), replace the parenthetical
  `(In this repo the max-500-lines-per-file rule from CLAUDE.md still applies — note violations, but
  score coupling, not length.)` with a scoped equivalent: the 500-line rule applies to shipped source
  only; specs, `test/`/`tests/` and `scripts/` are exempt; still score coupling, not length.
- **GOTCHA**: leave the rest of principle 4 alone. "Coupling beats LOC" is the skill's own judgement and
  is unaffected by this ticket — only the parenthetical's scope is wrong.
- **VALIDATE**: `grep -n "500" .claude/skills/vertical-slice-audit/SKILL.md`
- **SATISFIES**: AC #4

### 4. UPDATE `docs/build-playbook.md` (line 156)

- **IMPLEMENT**: In the rules summary list, change
  `- VSA: slice owns routes/service/schemas/tests; \`index.ts\` = public API; ≤500 lines/file` to
  `; ≤500 lines/file of shipped source (specs, test/, scripts/ exempt)`.
- **GOTCHA**: this file is a condensed restatement of CLAUDE.md's hard rules — keep it condensed. One
  clause, not the full amendment.
- **VALIDATE**: `grep -n "500" docs/build-playbook.md`
- **SATISFIES**: AC #4

### 5. UPDATE `packages/config/eslint/base.mjs`

- **IMPLEMENT**: Add `max-lines` to the existing `rules` object, then append a new config object that
  turns it off for dev instruments. The override must come **after** the object that sets the rule, as
  the last two elements of the array `base.mjs` exports.

  Note what this does *not* require: every package does `tseslint.config(...base, { languageOptions: … })`,
  so a package's own object always lands after your override — and `services/api/eslint.config.mjs` even
  carries its own `rules` block. That is fine and needs no restructuring, because no package config sets
  `max-lines`, so nothing later re-enables it on the exempt set. Only the two entries' order relative to
  *each other* matters.

  ```js
    {
      rules: {
        // ... existing rules unchanged ...
        // CLAUDE.md's file-length rule, made executable (#112). Counts blank and
        // comment lines: the cap has always been about total file size, and a
        // `skipComments` variant would be a different rule wearing the same number.
        'max-lines': ['error', { max: 500, skipBlankLines: false, skipComments: false }],
      },
    },
    {
      // Dev instruments are outside the rule, not merely lenient under it — see
      // CLAUDE.md's VSA bullet. This mirrors what each package's build already
      // excludes (`services/api/tsconfig.build.json`), so the gate and the build
      // draw the same shipped/dev line. Part of the rule's definition rather than
      // a per-package need, so it lives here despite the header's #53 convention.
      files: [
        '**/*.spec.ts', '**/*.spec.tsx',
        '**/*.test.ts', '**/*.test.tsx',
        '**/test/**', '**/tests/**', '**/scripts/**',
      ],
      rules: { 'max-lines': 'off' },
    },
  ```
- **IMPORTS**: none new.
- **GOTCHA**: both `.spec.ts` (54 files) and `.test.ts`/`.test.tsx` (22 + 3) naming conventions are in
  use, and the test directory is `test/` in `services/api` but `tests/` in `db` and `packages/shared`.
  All six globs are needed; omitting `**/*.test.ts` leaves a trap that fires the first time a vitest
  suite passes 500.
- **GOTCHA**: `services/api`'s lint glob is `"{src,test,scripts}/**/*.ts"` — `scripts/` **is** linted, so
  without `**/scripts/**` this task alone turns the gate red on `mint-tracked-ride.ts` at 1414.
- **PATTERN**: `packages/config/eslint/base.mjs:25-33` — comment the non-obvious rule.
- **VALIDATE**: `pnpm --filter @taxi/api lint && pnpm --filter @taxi/db lint && pnpm --filter @taxi/shared lint`
- **SATISFIES**: AC #5, AC #6

### 6. UPDATE `apps/dispatch/eslint.config.mjs`

- **IMPLEMENT**: Append the same two entries (rule, then override) to the `defineConfig([...])` array,
  after `globalIgnores([...])`. Comment: *"same cap as the shared base (#112); this app extends
  `eslint-config-next` and does not consume `@taxi/config/eslint/base.mjs`."*
- **GOTCHA**: this app does **not** import the shared base — confirm before assuming Task 5 covered it.
  If you skip this, `CLAUDE.md`'s "enforced by `max-lines` wherever eslint runs" becomes false for two
  of the four web surfaces, which is the same species of untrue claim this ticket is fixing.
- **GOTCHA**: keep it after `globalIgnores` so `.next/**` generated files are already excluded; a
  generated file tripping a 500-line cap is a false positive that would get the rule disabled.
- **VALIDATE**: `pnpm --filter @taxi/dispatch lint`
- **SATISFIES**: AC #6

### 7. UPDATE `apps/admin/eslint.config.mjs`

- **IMPLEMENT**: Identical change to Task 6.
- **VALIDATE**: `pnpm --filter @taxi/admin lint`
- **SATISFIES**: AC #6

### 8. VERIFY the gate actually fires

- **IMPLEMENT**: Prove the rule is live rather than merely present. Temporarily append ~60 blank lines
  to `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` (447 → ~507), run
  `pnpm --filter @taxi/api lint`, and confirm a `max-lines` **error** naming that file. Then revert with
  `git checkout --` and confirm lint is green again. Do the same once against a spec file to confirm the
  override holds — a spec at 857 lines must **not** error. **Then repeat the induced failure against a
  file in `apps/dispatch` or `apps/admin`** — Tasks 6–7 are the only place the rule could be present in
  the file yet inert (see the confidence note), so `services/api` alone does not prove them.
- **GOTCHA**: an eslint rule you add but never see fail is an unverified claim. This is the only step
  that distinguishes "configured" from "enforcing", and the positive control (spec stays silent) is what
  distinguishes "enforcing" from "enforcing on the wrong set".
- **GOTCHA — measure the boundary, do not confirm it.** Assumption #1 predicts `max: 500` means 500
  passes and 501 errors. Treat that as the hypothesis under test: record the boundary you actually
  observe, and if it differs, correct Assumption #1 and the headroom figure rather than the cap.
- **GOTCHA**: headroom on the largest shipped file is **53 lines** (`derived` — 500 − 447, and 447 is
  `observed` at base `085ef88`). That is thin; note it in the PR body so the next ticket touching
  `ride-lifecycle.service.ts` is not surprised.
- **VALIDATE**: record all three outcomes — the induced failure's exact message, the observed boundary,
  and the clean re-run — in the execution report.
- **SATISFIES**: AC #7

### 9. UPDATE `.claude/code-reviews/pr-110-review.md`

- **IMPLEMENT**: Append a resolution line under D1: decided on #112 as B-broad, the rule now binds
  shipped source and is enforced by `max-lines`, the file is unchanged. Note that the review's "three
  clean seams" would have left ~1010 lines in one file — the audit from Task 0.
- **GOTCHA**: do not rewrite D1 itself. It was an accurate finding under the rule as it stood; the
  append records the outcome.
- **GOTCHA**: do **not** sweep the other 24 dated artifacts citing `~500` (25 in the sweep set at
  `085ef88` less this one, the only member the ticket touches) — see Out of Scope.
- **VALIDATE**: `grep -n -A3 "D1 ·" .claude/code-reviews/pr-110-review.md`
- **SATISFIES**: AC #8

### 10. RUN the validation gate

- **IMPLEMENT**: `pnpm turbo run typecheck lint test build --force`, with `COMPOSE_PROJECT_NAME=taxi` if
  running from a worktree.
- **GOTCHA**: Redis-backed suites are opt-in — set `REDIS_TEST_URL` to match your `REDIS_PORT` (6381
  locally) or the run is short by the suites that need it.
- **VALIDATE**: green, all packages.
- **SATISFIES**: AC #9, AC #10 (write the PR body from re-derived figures at this point, not from this
  plan's tables — see AC #10)

---

## TESTING STRATEGY

There is no product code here, so the "tests" are the gate itself plus the induced-failure control.

### Unit Tests

None added. No runtime behaviour changes; no slice is touched.

### Integration Tests

None added. The existing suite is the regression check — it must stay green, proving the eslint change
did not alter what compiles or runs.

### Edge Cases

These are the cases Task 8's control must cover:

1. **A shipped file at exactly 500** — passes (`max` is inclusive of the limit; `max-lines` errors above
   it). Confirm the boundary rather than assuming it.
2. **A shipped file at 501** — errors. This is the induced failure.
3. **An 857-line spec** — silent. The override works.
4. **`scripts/mint-tracked-ride.ts` at 1414** — silent, and `services/api` lints `scripts/` explicitly,
   so this is a genuine test of the `**/scripts/**` glob rather than a vacuous one.
5. **`services/api/test/harness.ts` at 508** — silent via `**/test/**` (singular), and any `db` or
   `shared` file under `tests/` silent via `**/tests/**` (plural). Both directory spellings exist.
6. **A `.test.tsx` file in `apps/dispatch`** — silent, and covered by Task 6's copy of the override, not
   Task 5's.

### Manual Validation

- `pnpm --filter @taxi/api lint` after the induced 507-line file → one `max-lines` error, right file.
- Same command after `git checkout --` → green.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm turbo run lint --force
```

### Level 2: Unit Tests

```bash
pnpm turbo run typecheck test --force
```

### Level 3: Integration Tests

```bash
docker compose up -d --wait
REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test
```

### Level 4: Manual Validation

The induced-failure control from Task 8, both directions, plus the spec-stays-silent positive control.

### Level 5: The gate

```bash
pnpm turbo run typecheck lint test build --force     # CI parity; COMPOSE_PROJECT_NAME=taxi in a worktree
```

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — The three figures in Problem Statement are re-measured **at base `085ef88`** and
      recorded in the execution report with their commands: 1414 lines; ten files over 500, all in the
      build's exclude set, largest shipped 447; the review's three seams leaving ~1010 in one file. If
      `origin/main` has moved past `085ef88` by implementation time, re-measure at the new base and
      **update the figures rather than the expectation** — "expect exactly ten" is a claim about
      `085ef88`, not a law.
- [ ] **AC #2** — `CLAUDE.md`'s VSA bullet binds 500 lines to shipped source and names the enforcement
      mechanism.
- [ ] **AC #3** — The amended bullet is invariant-shaped: it states dev instruments are uncapped, and
      contains **no** file name, **no** line count, **no** package enumeration, and **no** clause
      implying any other mechanism bounds their length. Verified by
      `grep -nE "trajectory check|review call|1414|447|apps/rider" CLAUDE.md` returning nothing.
- [ ] **AC #4** — All three live restatements agree with the amended rule:
      `.claude/agents/code-reviewer.md`, `.claude/skills/vertical-slice-audit/SKILL.md`,
      `docs/build-playbook.md`. The code-reviewer bullet explicitly tells the agent not to flag exempt
      files for length, **and** to flag any `eslint-disable` of `max-lines`. No surface that runs still
      carries the unconditional rule.
- [ ] **AC #5** — `max-lines` is `['error', { max: 500, skipBlankLines: false, skipComments: false }]`
      in `packages/config/eslint/base.mjs`, with a comment giving its reason and ticket.
- [ ] **AC #6** — The rule + override are present in the shared base **and** in
      `apps/dispatch/eslint.config.mjs` and `apps/admin/eslint.config.mjs`, which do not consume the base.
- [ ] **AC #7** — The gate is demonstrated to fire and to stay silent on the exempt set: the induced
      failure's message, the observed 500/501 boundary, and the clean re-run are all quoted in the
      execution report. A run that was never made to fail does not satisfy this.
- [ ] **AC #8** — `pr-110-review.md` D1 carries a resolution line; the original finding is unedited; no
      other dated artifact is swept.
- [ ] **AC #9** — `pnpm turbo run typecheck lint test build --force` is green, and **no file was edited
      to make it green** — the ten over-length files are byte-identical to base.
- [ ] **AC #10** — Every figure in the PR body carries `observed` / `derived` / `expected` and, where
      derived, its arithmetic. No figure is copied from this plan without being re-derived (CLAUDE.md:
      numbers are inherited, not audited — #87 and #107 both shipped on that).

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Induced-failure control run in both directions and recorded
- [ ] Acceptance criteria all met
- [ ] `Closes #112` in the PR body, with the decision and its rationale stated there

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions:**

1. `max-lines` counts a file's physical lines the same way `wc -l` does, so the 447 → 53-line headroom
   figure is right. Task 8's boundary check is what settles it — treat 500-passes/501-errors as the
   hypothesis, record the boundary observed, and if it is off-by-one adjust this assumption and the
   headroom figure rather than the cap.
2. The shipped/dev boundary is the one each package's build already draws. `services/api` draws it by
   `exclude`, `db` and `packages/shared` by `include: ["src"]`. `apps/dispatch` and `apps/admin` have no
   `tsconfig.build.json`, so for them the glob list is the definition, not a mirror of one. This is a
   real asymmetry — the amendment's phrase "what each package's build compiles" is exact for
   `services/api` alone, and motivational for the other four. For `db` and `packages/shared` the gate is
   *stricter* than the build, not equal to it: their lint scripts explicitly name `drizzle.config.ts` /
   `vitest.config.ts`, which `max-lines` therefore caps while `include: ["src"]` compiles neither
   (`observed` — package.json lint scripts and `tsconfig.build.json`). Harmless today, all being tiny.

   One gap checked and found empty: the eslint override exempts `**/*.test.ts`, but `services/api`'s
   build excludes only `**/*spec.ts` — so for api the glob list is nominally *broader* than the build's
   exclude set. In fact **zero** `.test.ts`/`.test.tsx` files exist under `services/api` (`observed` —
   all 25 sit in `apps/dispatch` (4), `db/tests` (3), `packages/shared` (18), each already outside its
   package's build). The two sets agree today; if a `*.test.ts` is ever added under `services/api/src`,
   the glob is the source of truth and the build set is the motivation.

3. The three live restatements in Tasks 2–4 are the complete set **inside this repo**. The sweep also
   covered user-global `~/.claude/skills/` and `~/.claude/agents/` and found no hit on this rule — the
   `500` matches there are Cloudflare docs and `piv-slice-epic`'s unrelated "500–1500 lines of change"
   ticket-sizing guidance. So nothing outside the repo needs a follow-up.

**Open questions — neither blocks:**

1. `apps/rider` and `apps/driver` run no eslint at all (6 TS files between them, all small), so the gate
   does not reach them. The amendment is worded to stay true either way ("every package that runs
   eslint"), but the gap is real. Worth its own ticket, or is `typecheck`-only deliberate for the Expo
   apps?
2. `.claude/plans/mint-ride-sub-cell-jitter.md` is **untracked** in the `bea4222` working tree while
   #110 is merged and `pr-110-review.md` cites that file's `AMENDMENTS` by line number. #108's plan
   artifact is stranded on an unrelated branch. Not this ticket's subject — flagged so it does not get
   lost.

## NOTES (open canvas)

### Why B-broad, and what option A actually cost

The decision was taken cold, as #112 asked. Three findings moved it:

**Option A never reached compliance as scoped.** `pr-110-review.md:111` names "three clean seams" and
gives no sizes. Measured:

| seam | range | lines |
|---|---|---|
| jitter geometry + guards | 104–210 | ~107 |
| report + assertions | 1049–1345 | ~297 |
| *"the run"* (remainder) | — | **~1010** |

Provenance: `derived` — seam ranges read off the file's symbol outline on `origin/main`; the remainder
is `1414 − 107 − 297`. A three-way split on the review's own seams leaves a file 2× over the cap. Making
A work needs 5 files, because `main()` alone is 348 lines:

```
geometry.ts  ~107 · harness.ts ~162 · run.ts ~324 · report.ts ~297 · main.ts ~348 (+ teardown ~66)
```

That is a genuinely bigger restructure than the ticket describes — and it carries two costs the review
did not price. `Logger.overrideLogger(capture)` is a **module-load side effect** that must run before
`NestFactory.create`; splitting turns an obvious top-to-bottom ordering into an import-order contract
between files, in the one script whose whole purpose is to be trustworthy about what it observed. And it
invalidates ~9 `mint-tracked-ride.ts:NNNN` pins across `pr-110-review.md` (A2, A3, A4, A5, A6, A7, R1,
R2, R3) plus `.claude/references/mint-tracked-ride-dev-script.md` — pins that #108 already broke and
repaired once (finding A7 was exactly a stale pin).

**The rule was already being applied inconsistently.** `pr-107-review.md:150-152` and
`pr-110-review.md:109-114` reach opposite conclusions about the same file under the same rule. Neither
reviewer was wrong; the rule was ambiguous. A restructure fixes one file and leaves the ambiguity, which
means the next borderline file gets litigated again.

**The exemption is not being invented — it is being written down.** All ten over-length files sit inside
what the build already excludes. B-broad makes the rule *true as lived*; B-narrow (exempt `scripts/`
only) would have amended the rule and left it false about nine files.

### An argument checked and discarded

"The file is long because CLAUDE.md's numbers rule mandates provenance prose." Measured:

| file | total | code | comment | comment share of non-blank lines |
|---|---|---|---|---|
| `mint-tracked-ride.ts` | 1414 | 888 | 433 | 32.8% |
| `ride-lifecycle.service.ts` | 447 | 286 | 126 | 30.6% |

Provenance: `observed` — classifier over both files on `origin/main` (block comments counted through
their closing `*/`); shares are `derived` from those counts over `code + comment`, i.e. excluding blank
lines (`433 / 1321`, `126 / 412`) — the same denominator rule for both rows. 33% against the largest shipped
file's 30.6% is not an outlier. This is a two-file comparison, not a repo-wide norm. **Code alone is 888 lines, 1.8× the cap.** This argument does not support the exemption and
should not appear in the PR body as though it does.

### The trajectory concern, honestly

#112 closes with: *"a dev instrument that grows ~57% per ticket touching it will be back regardless of
which rule it is measured against."* The figure checks out — 898 → 1414 is +516 lines, **+57.5%**
(`derived`), across the two tickets that have touched the file (#94 created it, #108 grew it; `git log`
shows exactly two commits on that path before the #108 branch).

**This plan does not solve that.** A looser dev-instrument cap was offered and declined, so `scripts/`
is uncapped. What ships is a gate on *shipped* source and a rule that no longer pretends to cover the
script. If `mint-tracked-ride.ts` reaches 2000 lines, nothing mechanical will say so — and after Task 2
the review agent is explicitly told not to flag it, so realistically **nobody** will, not "a reviewer
will". That is the accepted residual risk of B-broad, stated plainly here because the amendment itself
is deliberately silent on it: `outside the rule and uncapped` is the honest claim, and any warmer
phrasing ("a review call", "watched by the trajectory check") would be a mechanism that does not exist.

### The propagation finding, and why it nearly sank the plan

The first draft of this plan treated the amendment as a one-line CLAUDE.md edit. A proper sweep of
`.claude/skills/`, `.claude/agents/` and `docs/` found three live restatements — and one of them is
`.claude/agents/code-reviewer.md:46`, the agent every PR review dispatches. Amending CLAUDE.md while
that file still says `Max ~500 lines per file` would have produced precisely the #87 shape recorded in
`taxi-piv-remedies-need-an-executable-step`: the prose edit that does not fire, overruled by the skill
surface that does. The eslint gate would have enforced the new rule on shipped source while the review
agent kept flagging the exempt files — two mechanisms disagreeing, which is worse than the one
ambiguous rule this ticket set out to fix. Tasks 2–4 exist because of that sweep, and Task 2 is the
single highest-value edit in the ticket.

### Concurrent-session note

Five worktrees are live (`taxi-100`, `taxi-jitter`, `taxi-shortgate`, `taxi-tracking-eta`, plus the main
checkout on `feature/dev-env-redis-doc` at `bea4222`, two merges behind `origin/main`). Implement in a
**fresh worktree off current `origin/main`**, and run anything DB-touching with
`COMPOSE_PROJECT_NAME=taxi`. This plan file was written in the `bea4222` tree; it needs to land on the
implementation branch.

**Confidence: 9.5/10** for one-pass success. Ten tasks, none larger than a few lines; no product code
changes; every figure measured at a named base rather than inherited; and the one genuine unknown —
`max-lines`' exact boundary behaviour at 500 — is isolated into Task 8's control with a stated fallback
that adjusts the plan's figure rather than the deliverable.

The residual 0.5 is `apps/dispatch`/`apps/admin`. `eslint-config-next`'s flat-config shape is the one
place a rule can be present in the file and still not take effect — `defineConfig` + spread arrays + a
trailing `globalIgnores` is exactly the ordering that silently swallows a later `rules` object if it
lands in the wrong position. That is why Task 8's induced failure is mandatory rather than advisory, and
why it must be run against a **dispatch or admin** file too, not only against `services/api`.

## AMENDMENTS

<!-- newest at the bottom; leave empty until this plan has been executed -->
