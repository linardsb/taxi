# Feature: Jev claim check for PR bodies (log-only)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

A dev script, `claim-check.mjs`, that runs beside `inherited-figures.sh` in `piv-create-pr` Phase 2.5. Code finds
the claim sentences in a draft PR body and the exact lines behind every `file:line` it cites. TypeSafe's Jev model
then answers up to four narrow questions per sentence:

- **provenance** (Noul, a yes/no probability): the sentence, its heading, its section intro or its table column
  header labels a figure `observed`, but no run that produced it is named. This is #302's literal question.
- **not measured** (Noul): a figure presented as `observed` that no run could measure: a counterfactual, a
  prediction, or a value computed from other figures. This is the core of the #107 defect. Planning probes showed
  that `provenance` alone flags #107's measured sibling rows as well (0.90–0.91), while this question separates
  them (0.90 against 0.05–0.10).
- **worst case** (Noul): a figure that varies by case is given without saying which case it describes.
- **citation** (Choice, one of a fixed set of options): for each resolvable `file:line`, do the exact cited lines
  at `HEAD` `supports`, `contradicts` or `not_established` what the sentence says about them.

A fourth check uses **no model at all.** Code lists every sentence that claims an extreme (`worst case`,
`best case`, `upper bound`, …) under "re-derive by hand". This is the #87 defect: a figure called the worst case
that was really the best case. The planning probes showed it is not visible to a sentence-level judgement (see
"Observed API behaviour").

It **never blocks**. It prints verdicts with their probabilities plus a paste-ready `<details>` block for the PR
body, and it always exits 0 except on a usage error. The block in the PR body is the log. For the first 10 PRs,
each review compares its findings with it.

## User Story

As the author of a PR body (Linards, or the agent running `piv-create-pr`)
I want a second reader to flag figures labelled `observed` with no run, figures with no stated case, extreme-case
claims, and `file:line` citations whose lines do not say what the body claims
So that prose claims get a check before review. Today typecheck, lint and tests cannot read them, and the author
is the only check.

## Problem Statement

`inherited-figures.sh` states in its own header (`.claude/skills/piv-create-pr/scripts/inherited-figures.sh:23-26`)
that it cannot catch "a correct number under a wrong label (#87), a correctly-derived counterfactual printed as
Observed (#107), or a prose claim with no numeral in it at all". These are judgements about meaning, and grep
cannot make them.

There is a live example of a stale citation today. `CLAUDE.md` cites `test/harness.ts:454,541` for the
`KV_STORE` override. At `HEAD` `da9c933`, `:454` is `push: RecordingPushProvider;`. The override is at `:546`
and the construction at `:534`. `observed`: `grep -n KV_STORE services/api/test/harness.ts`, and
`git show HEAD:services/api/test/harness.ts | sed -n 454p`, both run 2026-09-29.

## Solution Statement

- **Language and dependencies:**
  - It is one Node 20 ES module (`.mjs`) with no dependencies.
  - It uses the built-in `fetch`, `AbortSignal.timeout` and `AbortSignal.any`. `observed`:
    `typeof AbortSignal.any` is `function` on local `v20.20.2`, and CI pins `node-version: 20` (`ci.yml:50`).
  - It makes plain HTTP calls to `POST https://api.typesafe.ai/v1/systemone`.
  - There is no SDK, because the API is small enough to call with `fetch` (the probes below).
- **Code does the selection:**
  - It splits the body into sentences, and treats each table row as one unit that carries its column header row.
  - It keeps a unit only if it has a figure, a provenance word or a `file:line`.
  - It resolves each citation through `git ls-files` and reads the lines with `git show HEAD:<path>`.
  - It lists extreme-case claims deterministically.
- **Jev does the judging.** One request goes out per unit, holding that unit's applicable questions. The state is
  named JSON: `{sentence, heading, section_intro?, table_header?, cited?}`. `section_intro` is the paragraph that
  introduces the list or table the unit sits in. In PR #300's Validation block, the `observed` and the run live
  in bold lead-in paragraphs, not in headings.
- **Log, never block:**
  - The script prints its verdicts and a `<details>` block for the PR body.
  - A missing key, an HTTP error, a timeout, a network failure or the 30 s budget running out each becomes a
    printed `note:`, and the script exits 0.
- **The gate runs the offline tests.** `.claude/skills/piv-create-pr/scripts/` becomes a private workspace package
  whose only script is `test: node --test`. So `pnpm turbo run typecheck lint test build --force` runs the offline
  suite locally and in CI, without touching the fenced `ci.yml`.
- **Calibration:**
  - A 50-row labelled JSONL file, taken from past `.claude/code-reviews/` verdicts, is scored by an `--eval` mode.
  - The results go into this ticket's PR body, with the model id and the date.

## Out of Scope / Non-Goals

- **Not blocking.** Nothing reads its exit code, and a flag does not stop `gh pr create`. Promotion to blocking
  happens after 10 PRs of logs, in a later ticket, and only if the log "stops surprising us" (#302).
- **Not the product seam.** There is no `packages/shared/src/seams/` interface and no `services/api` code; that is
  #271. This is a dev script, not shipped source.
- **Not the implementation report or plan.** It checks only the PR body. `inherited-figures.sh` already covers
  copying between surfaces.
- **Not judging arithmetic.** Jev 1.13's jaggedness page lists arithmetic as unreliable. The #87 case is routed to
  a human by the deterministic list instead.
- **Not tuning thresholds.** Probabilities are always printed. `0.5` is only the display cut for "flag", and the
  eval reports the other cuts.
- **Not adding lint or typecheck for `.claude/`.** The new package defines only `test`. `record-gate.sh` will list
  its absent `typecheck`, `lint` and `build` under `tasks_not_in_graph`. Those three absences are legitimate and
  must be named in the PR body.
- **Not changing** `inherited-figures.sh`, `record-gate.sh` or `.github/workflows/ci.yml` (the last is fenced by
  `pre_tool_use.py:115-116`).

## Feature Metadata

**Feature Type**: New Capability (dev tooling)
**Estimated Complexity**: Medium
**Primary Systems Affected**:
- `.claude/skills/piv-create-pr/`: the script, its test, the labelled set, its `package.json`, and the SKILL.md
  Phase 2.5 text.
- `pnpm-workspace.yaml` and `pnpm-lock.yaml`.
- `.claude/skills/piv-review-pr/SKILL.md`: one paragraph.
- `CLAUDE.md`: one stale citation.

**Dependencies**:
- TypeSafe HTTP API, with the model pinned to `jev-1.13.0`.
- Node ≥ 20.3, for `AbortSignal.any`.
- `git`.
- `TYPESAFE_API_KEY` in the user environment. `observed`: it is set in this shell; only the name was listed.

## Related Work

**Implements**: #302 · **Epic**: there is no architecture doc. This is Jev build order step 1 of 5 (label
`jev-order:1`). Next come #303, then #271 (the product Jev seam), then #272. #302 states that it has no dependency
on #271's seam.

**Back-references**:
- `.claude/skills/piv-create-pr/scripts/inherited-figures.sh` is the sibling check. It names the gap this ticket
  fills (`:23-26`).
- `.claude/skills/piv-create-pr/SKILL.md:48-53` (Phase 2.5, ledger L2) sets the rule: a script is referenced from
  the skill so that deleting it shows in a diff.
- `.claude/code-reviews/pr-93-review.md:91-112` (M1): #87's best-case interval labelled as the worst case.
- `.claude/code-reviews/pr-107-review.md:43-72` (H1): #107's counterfactual printed as Observed.

**Forward-references**:
- (none yet). A "promote to blocking" ticket is created only after the 10-PR log, following the rule against
  follow-up issue sprawl.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `.claude/skills/piv-create-pr/SKILL.md` (lines 44-86, Phase 2.5): the section to extend. Its heading says
  "(blocking)". The new script must be carved out of that in words.
- `.claude/skills/piv-create-pr/scripts/inherited-figures.sh` (all 151 lines): the style to mirror.
  - A long header comment says what the script does, **what it does not catch**, and its exit codes.
  - A missing input is a printed `note:`, not a usage error (`:36-40`).
  - It checks files with `-f`, not `-r` (`:65-67`).
- `.claude/skills/piv-create-pr/scripts/record-gate.sh` (lines 1-40): prints a paste-ready block ("Paste it; do
  not retype it"). It derives the gate's task count by a dry run, so adding a package does not break a
  hardcoded number. `observed`: grep finds no literal `22` in it or in `.github/scripts/*.sh`.
- `.claude/skills/piv-review-pr/SKILL.md` (lines 79-100, "The numbers pass"): the comparison paragraph goes here.
- `.claude/hooks/pre_tool_use.py`:
  - `:47-52` and `:178-182`: `ENV_DUMP` blocks any **Bash command text** containing `process.env`,
    `os.environ`, `printenv`, or `echo …$…KEY`.
  - `:170-172`: the Write tool is checked only by **path**. So the script source may contain
    `process.env.TYPESAFE_API_KEY`, but no Bash `VALIDATE` line may.
  - `env -u TYPESAFE_API_KEY node …` matches none of the patterns and is allowed.
- `pnpm-workspace.yaml`: four globs today (`apps/*`, `services/*`, `packages/*`, `db`). Add one explicit path.
- `turbo.json`: the `test` task has `dependsOn: ["^build"]`. The new package has no workspace dependencies, so
  this is a no-op for it. `globalEnv` does not list `TYPESAFE_API_KEY` or `CLAIM_CHECK_LIVE`, so turbo's strict
  env mode strips both. **That is intended**: the live tests SKIP under the gate, which has no key in CI anyway,
  and the offline tests build their own spawn env.
- Review reports that supply labelled rows (Task 6):
  - `.claude/code-reviews/pr-107-review.md:43-72`: H1, the provenance positive.
  - `.claude/code-reviews/pr-128-review.md:149-156`: L2, a figure with no provenance.
  - `.claude/code-reviews/pr-128-review.md:188-200`: "What I re-derived and found true", the negatives.
  - `.claude/code-reviews/pr-206-review.md:162-175`: "Figures audit", with both positives and negatives.
  - `.claude/code-reviews/pr-154-review.md:263` (F9) and `:303` (F13).
  - `.claude/code-reviews/pr-196-review-round3.md:66`: F2, `file:line` figures pointing at a moved tree
    (citation positives).
  - `.claude/code-reviews/pr-116-review.md:53,130`.
  - Search further with
    `grep -niE "^#+ .*(figure|provenance|arithmetic|claim|observed|derived|worst)" .claude/code-reviews/*.md`.
    That grep gives 69 headings across 45 of 98 files (`observed` 2026-09-29 at `da9c933`). Do not use the
    issue's 53/38/81, which came from a different regex over an older tree. Either count is an upper bound on
    candidates, not a count of findings.
- The original defect text, recovered from git (`observed` 2026-09-29):
  - **#107**: the first commit of `.claude/reports/mint-tracked-ride-dev-script-report.md`, a table under the
    header `| Quantity | Expected | **Observed** |`, row `| unquantized counterfactual | 30 | **30** |`.
  - **#87**: the first commit of `.claude/plans/tracking-eta-maps-quantized-cache.md:336`:
    "page polls every 5 s; at the policy's own 25 km/h city average a driver crosses a ~100 m cell every ~15 s →
    worst-case ~1 paid call per 15 s per active ride *with a real provider*, vs 1 per 5 s without quantization".
- `CLAUDE.md` ("Commands" section, the paragraph beginning "This line has been wrong three times"): the stale
  `test/harness.ts:454,541`.

### New Files to Create

- `.claude/skills/piv-create-pr/scripts/package.json`: a private workspace package with only a `test` script.
- `.claude/skills/piv-create-pr/scripts/claim-check.mjs`: the script. Target ≤ 450 lines. `scripts/` is outside
  `max-lines` (#112), and no eslint runs here.
- `.claude/skills/piv-create-pr/scripts/claim-check.test.mjs`: the `node:test` suite.
- `.claude/skills/piv-create-pr/scripts/claim-check-labelled.jsonl`: 50 labelled rows.
- `.claude/reports/jev-claim-check-eval-<date>.md`: the eval output (Task 7).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [HTTP API](https://docs.typesafe.ai/api.md): the request fields `state`, `model` and `questions`; the response
  field `answers[id]`; status codes 401, 422, 429 and 529.
- [Noul](https://docs.typesafe.ai/primitives/noul.md): `criteria: {"true": …, "false": …}`. Use a 0.5 threshold
  when both errors cost the same.
- [Choice](https://docs.typesafe.ai/primitives/choice.md): the response carries `choice`, `probabilities` and
  `confidence`.
- [Citation check cookbook](https://docs.typesafe.ai/cookbooks/citation_check.md):
  - A string match runs first, and a missing quote is decided in code with no model call.
  - Then one Choice. We rename `says_nothing` to `not_established` to follow #302.
- [Models](https://docs.typesafe.ai/models.md):
  - Pin `jev-1.13.0`.
  - Context is 64k tokens per request.
  - Input costs $0.042 per million tokens.
  - English is the primary language.
- [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md): arithmetic, counting and dates
  are unreliable, and large irrelevant states degrade accuracy. That is why each request covers one unit, and why
  no question asks Jev whether arithmetic is right.

### Observed API behaviour (planning probes, 2026-09-29, `jev-1.13.0`, from the session scratchpad)

**Transport** (curl):

| Probe | Result |
|---|---|
| Two Nouls on an invented #107-shaped sentence | HTTP 200. 433 input tokens, 0.315 s wall. |
| `Authorization: Bearer bogus` | **HTTP 401**, `{"detail":{"error_type":"authentication_error","message":"Cannot authenticate…"}}` |
| No `Authorization` header | **HTTP 403**, not the 401 the docs list, `{"detail":{"error_type":"authentication_error","message":"Must supply an API key!…"}}` |
| Citation Choice on hand-typed `cited.text` | `supports` 0.87. **Not evidence of anything:** the text was not the file's real content. This is why code, never the body, supplies the cited lines. |

**Question design** (`probe3.mjs`–`probe9.mjs` in the session scratchpad; Node `fetch`, one request per row;
wall times 209–428 ms; input tokens 407–723). Headings are the **real** ones recovered from git unless the row
says *invented*. #107's table sits under `### Level 4 — manual validation (the point of the ticket)`, and its
intro paragraph is `**Step 3 — observed, `CELLS=6`, `POLLS_PER_CELL=5`:**` (`13cf8b0`). #87's plan:336 sits under
`## NOTES (open canvas)`.

| Case | Question (final text, Task 3) | p | Reading |
|---|---|---|---|
| #107 counterfactual row, with heading, intro and header | provenance | 0.94 | true positive |
| #107 measured rows (`caller:'eta'` 6; views 30), same context | provenance | 0.90, 0.91 | flagged: the intro names no command or sha, so by the repo rule this is arguably correct, but it is **not #107's defect** |
| #107 counterfactual row | **not_measured** | **0.90** | true positive |
| #107 measured rows | **not_measured** | **0.05, 0.10** | true negatives: this question isolates #107 |
| "The reduction is 5× (30 → 6) …" under `## Validation — observed` (*invented*) | not_measured | 0.76 | true positive |
| PR #300 Validation lead paragraph (*abridged*: names the command, sha and `record-gate.sh`) | provenance / not_measured / worst_case | 0.04 / 0.05 / 0.04 | true negatives |
| PR #300 mutation bullets (5 rows), with their bold `observed` intro as `section_intro` | provenance | 0.17–0.40 | under 0.5; **0.40 is the closest call** in the set |
| same 5 bullets | not_measured / worst_case | 0.06–0.16 / 0.04–0.10 | true negatives |
| pr-206 row "Gate `22/22` … re-run here at `0763bc0`" | provenance | 0.08–0.09 | true negative (older provenance text) |
| pr-206 row "`726 = 724 + 2`, `derived`" | worst_case | 0.08 | true negative |
| #93 M1's worst case "~7.7 s … against 3.8 due N/S and 6.8 due E/W" (*paraphrased*) | worst_case | 0.04 | true negative |
| #87 plan:336, real heading | worst_case | 0.16 | correctly **not** flagged: it names "worst-case" |
| #87 `notifications.policy.ts:38` "~15 s at the speed above" | worst_case | 0.36–0.43 | under 0.5: "at the speed above" names a condition |

**Real PR bodies put most figures in code blocks.** PR #300's gate counts are in a fenced block and an
**indented** (4-space) block, and both are verbatim `record-gate.sh` output. The finder drops fenced and indented
code alike (Task 2). That output is already guaranteed by the script that printed it.


**Three framings for a "#87 detector" were tried and all rejected** (these probes used an *invented* heading, `## Spend`; the real-heading `worst_case` row above agrees):

| Framing | #87 plan:336 | Correct worst-case sentence (#93 M1) | Verdict |
|---|---|---|---|
| "fails to show why it is that case" | 0.26 | 0.20 | misses #87 |
| "computed from a single scenario" | 0.64 / 0.77 | **0.72** | no separation |
| "only one scenario has a number" | 0.10 / 0.09 | 0.29 | misses #87 |

The reading is that #87's sentence does compute a second scenario ("vs 1 per 5 s"). Its defect, an ignored
longitude axis, is **not in the sentence**. So no sentence-level judgement can see it, and the plan routes
extreme-case claims to a human in code (Task 2). These are six-case probes, one row each. They are evidence about
the question design, not a measure of accuracy. The eval (Task 7) is the measure.

### Patterns to Follow

**Script header** mirrors `inherited-figures.sh:1-43`. It covers the purpose, usage lines, what it catches, a
paragraph titled **"What this does NOT catch, stated so it is not oversold"**, and the exit codes. That paragraph
lists:
- Arithmetic. The extreme-case list sends that to a human, but it does not judge it.
- A claim with no figure, no provenance word and no citation.
- A citation that cannot be resolved uniquely, which is reported `unresolved` and never judged.
- Any unit the 30 s budget cut off, which is listed.

**Missing input is a note** (`inherited-figures.sh:36-40,87-94`). The only non-zero exit is **2 for usage**: no
body path, or a path that is not a regular file.

**Paste-ready output** (`record-gate.sh:16-18`).

**Naming**: kebab-case script names, `--flag` options.

---

## IMPLEMENTATION PLAN

### Phase A: Package and script

- Task 1: the package wiring.
- Tasks 2–4: the finder, the client and the eval.

### Phase B: Tests

**Depends on:** Phase A (Task 5).

### Phase C: Labelled set and eval

**Independent of:** Phase B (Tasks 6–7 need only Task 4).

### Phase D: Wiring text and the stale citation

**Depends on:** Phase A (Tasks 8–11).

---

## STEP-BY-STEP TASKS

### Task 1. CREATE `.claude/skills/piv-create-pr/scripts/package.json` and UPDATE `pnpm-workspace.yaml`

- **IMPLEMENT**:
  - `package.json`:

    ```json
    { "name": "@taxi/pr-scripts", "private": true, "type": "module", "scripts": { "test": "node --test" } }
    ```

  - Append `  - ".claude/skills/piv-create-pr/scripts"` to `pnpm-workspace.yaml`.
  - Run `pnpm install`, then commit the `pnpm-lock.yaml` importer entry. CI uses `--frozen-lockfile`
    (`ci.yml:52`) and fails without it.
- **PATTERN**: the existing `packages/*` entries.
- **GOTCHA**:
  - `observed` in a scratch workspace (the session scratchpad `ws/`, pnpm 10.33.2 plus turbo ^2.5):
    - pnpm lists a package under a dot directory (`.claude/skills/x/scripts`).
    - `turbo run test --force` runs it.
    - `node --test` with no arguments finds `*.test.mjs` and runs it.
  - The lockfile change makes `audit-diff.sh` run both audits rather than short-circuit. The new package has no
    dependencies, so it adds no advisory.
  - The gate's task count goes from 22 to 23. That is `derived`: today's `observed` 22 (`turbo --dry=json`, tasks
    with a command, at `da9c933`), plus one `test` task. `record-gate.sh` derives it at run time. Quote the count
    it prints, not this one.
  - `record-gate.sh` will also list `@taxi/pr-scripts#typecheck`, `#lint` and `#build` under
    `tasks_not_in_graph`. They are legitimate; name them in the PR body.
  - **CodeQL scans `.claude/`.** `paths-ignore` (`ci.yml:111-117`) lists only `app`, `backend` and build
    outputs. The script reads a file and sends its contents with `fetch`, which is the shape of
    `js/file-access-to-http`. That query is `expected` to be medium severity and a warning, and
    `codeql-gate.sh:24-25` blocks only `high`/`critical` security severity or `rule.severity == "error"`. So an
    alert from it should show on the PR without blocking it. Two steps:
    - Pass git only paths that are **exact entries of `git ls-files`**, as the `HEAD:<path>` argument (it cannot
      start with `-`) via `execFileSync` with an argv array and no shell. That leaves nothing for
      `js/command-line-injection` or `js/second-order-command-line-injection` to bind to.
    - If the `codeql` job still holds the PR in draft, the fix is **not** the model's. `ci.yml` is fenced
      (`pre_tool_use.py:115-116`), and dismissing an alert is a human's call (the hook's `ALERT_DISMISS`). Stop
      and name the alert id in the PR for Linards.
- **VALIDATE**:
  - `pnpm ls -r --depth -1 | grep pr-scripts` shows the path.
  - `pnpm turbo run test --filter @taxi/pr-scripts --force` exits 0. Before Task 5 it runs zero tests and still
    exits 0 (`observed`: `node --test` in an empty directory on v20.20.2 prints `# tests 0` and exits 0). So count
    the tests after Task 5; don't rely on the exit code.
  - `npx turbo run typecheck lint test build --dry=json | jq '[.tasks[] | select(.command != "<NONEXISTENT>")] | length'`
    prints 23.
- **SATISFIES**: the fix for R1. The gate runs the offline tests.

### Task 2. CREATE `.claude/skills/piv-create-pr/scripts/claim-check.mjs`: CLI, finder, resolver, extreme list

- **IMPLEMENT**:
  - `#!/usr/bin/env node`, then `chmod +x`. The header comment follows "Patterns to Follow".
  - Usage:
    - `claim-check.mjs <draft-body.md> [--threshold 0.5]`
    - `claim-check.mjs --eval <labelled.jsonl> [--threshold 0.5]`
  - `findClaims(markdown) → [{line, heading, sectionIntro?, tableHeader?, sentence, figures: bool, provenanceWord: bool, extreme: bool, citations: [{raw, path, from, to}]}]`:
    - Drop fenced code blocks, **and indented code blocks**. A run of lines indented by 4+ spaces (or a tab) is
      code only if **all** of these hold:
      - it follows a blank line or a closing fence;
      - the last non-blank line before it is not a list item;
      - none of its lines starts with a list marker (`-`, `*`, `+`, `1.`).

      This drops PR #300's per-package gate counts, which follow a closing fence. It keeps a third-level bullet
      such as `    - At abc1234: 3 of 4 red`, which a looser rule would drop silently.
    - Track the nearest preceding `#` heading text.
    - Track `sectionIntro`: the last plain paragraph (not a list item, table row or heading) seen since that
      heading, carried by the list items and table rows that follow it. The #107 table's intro is
      `**Step 3 — observed, …:**`. PR #300's bullets carry `**Mutation checks** (`observed`; …):` and
      `**Manual run**, … (`observed`)`.
    - A table row (`|…|`, skipping `|---|` separators) is one unit. Its `tableHeader` is the first row of the
      same table. This carries #107's case: the word `Observed` appeared only in the column header.
    - Split other lines into sentences at `. `, `? ` or `! ` followed by an uppercase letter or a backtick. Do not
      split inside backticks.
    - **figure**: a digit that is not part of `#\d+`, a 7–40 hex sha, an ISO date, a `file:line`, or a version
      (`v20.20.2`, `jev-1.13.0`).
    - **provenanceWord**: `\b(observed|derived|expected)\b`, case-insensitive, in the sentence, heading,
      section intro or table header.
    - **extreme**: `\b(worst|best)[- ]case\b|\b(upper|lower) bound\b|\bat (most|least)\b|\bworst\b`,
      case-insensitive, **and** `figures`.
    - Keep a unit if it has a figure, a provenance word or a citation.
  - **Which questions to ask, per unit, decided in code:**
    - `provenance` **and** `not_measured` only if the unit, its heading, its section intro or its table header
      contains `observed`.
    - `worst_case` only if the unit has a figure **and is not `extreme`**. An extreme claim names its case
      already; it goes to the hand list instead.
    - `citation_<n>` for each resolved citation.
    - A unit with no questions is never sent.
  - **Citation regex**: `` `?([\w./-]+\.[a-z]{1,5}):(\d+)(?:[-–](\d+))?((?:,\d+)*)`? ``. A comma list gives one
    citation per number.
  - `resolveCitation(c, gitFiles, readAtHead)` → `{status:'ok', path, lines:'a-b', text}` or
    `{status:'unresolved', reason}`:
    - A path containing `/` must be an exact or unique-suffix match in `git ls-files`.
    - A bare basename must match exactly one file.
    - Zero or several matches, `to < from`, a range wider than 60 lines, or a line past EOF → `unresolved`.
    - Text comes from `git show HEAD:<path>` via `execFileSync`, so only committed content leaves the machine.
      The working tree holds untracked `__DO_NOT_ADD_TO_GITHUB/`.
  - Run git from `git rev-parse --show-toplevel`.
  - Exports: `findClaims`, `resolveCitation`, `QUESTIONS`, `checkBody`, `evalSet`, `formatReport`.
  - `main()` runs only when `import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href`. `realpathSync`
    is needed because macOS `/tmp` and `/var` are symlinks to `/private/…`, and a symlinked argv never matches.
- **IMPORTS**: `node:fs` (`readFileSync`, `statSync`, `realpathSync`), `node:child_process` (`execFileSync`),
  `node:url` (`pathToFileURL`).
- **GOTCHA**:
  - Write this file only with the Write tool. The hook blocks Bash text containing `process.env`.
  - An `unresolved` citation never reaches Jev. That is the cookbook's string-match step.
- **VALIDATE**:
  - `node .claude/skills/piv-create-pr/scripts/claim-check.mjs; echo "exit=$?"` prints the usage line and `exit=2`.
  - `gh pr view 300 --json body -q .body > <scratchpad>/pr300.md`, then
    `env -u TYPESAFE_API_KEY node .claude/skills/piv-create-pr/scripts/claim-check.mjs <scratchpad>/pr300.md; echo "exit=$?"`.
    Expect a `note:` about the missing key, the units it would have sent with their question ids, the extreme
    list, and `exit=0`.
- **SATISFIES**: #302 "Code finds the sentences and the cited lines", "Pass the exact cited lines, not the whole
  file". This is R2's fix: the extreme list.

### Task 3. ADD the Jev client and report to `claim-check.mjs`

- **IMPLEMENT**:
  - Constants:
    - `BASE = process.env.CLAIM_CHECK_BASE_URL ?? 'https://api.typesafe.ai'`
    - `TIMEOUT_MS = Number(process.env.CLAIM_CHECK_TIMEOUT_MS ?? 10_000)`, per request
    - `BUDGET_MS = Number(process.env.CLAIM_CHECK_BUDGET_MS ?? 30_000)`, for the whole run
    - `MODEL = 'jev-1.13.0'`
    - The three env vars are test seams, and the header names them.
  - Send one `POST ${BASE}/v1/systemone` per unit, with headers `Authorization: Bearer <key>` and
    `Content-Type: application/json`.
  - Pass `signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), budget.signal])`. `budget` is one
    `AbortController` aborted by a `setTimeout(BUDGET_MS)` that is `unref()`'d and cleared at the end. Cleared,
    because a ref'd timer keeps the process alive (see the memory on jest open handles).
  - Run a worker pool with concurrency 6. There are no retries.
  - State: `{sentence, heading}`, plus `section_intro` when present, plus `table_header` for table rows, plus
    `cited: {path, lines, text}` on a
    citation question. A unit with both Noul questions and citations sends **one request per citation**, holding
    only that citation's `cited`, and a separate request for the Nouls. This keeps one cited block per state.
  - `QUESTIONS`, exported and used verbatim by the eval and the live tests. Every Noul text here is the one probed
    (`probe6.mjs` for `provenance` and `worst_case`, `probe8.mjs`/`probe9.mjs` for `not_measured`):

    ```js
    export const QUESTIONS = {
      provenance: { type: 'noul',
        instructions: 'The `sentence` labels a figure `observed`, either in its own text, in its `heading`, in its `section_intro` (the paragraph that introduces the list or block it sits in), or in the `table_header` column its figure sits under. Does the sentence, its heading and its section_intro together fail to name the run that produced the figure: a command, a CI run, a commit sha, or a dated session? A figure that is computed from other figures, or is a counterfactual, was not produced by a run.',
        criteria: { true: 'Labelled observed, and no producing run is named, or the figure is computed or counterfactual rather than measured',
                    false: 'The producing run is named, or the figure is not labelled observed' } },
      not_measured: { type: 'noul',
        instructions: 'The `sentence` presents a figure as `observed` (in its text, `heading`, `section_intro` or `table_header` column). Is that figure something no run could have measured directly: a counterfactual (what would have happened otherwise), a prediction, or a value computed from other figures?',
        criteria: { true: 'A counterfactual, prediction or computed value presented as observed',
                    false: 'A quantity a run could count or measure directly, such as a count of events, a status code, a test total or a duration' } },
      worst_case: { type: 'noul',
        instructions: 'Does the `sentence` state a figure that varies by case (a duration, an interval, a size, a cost, a count that depends on conditions) without saying which case it describes: best, worst, typical, or a named condition?',
        criteria: { true: 'A case-dependent figure with no case or condition named',
                    false: 'The case or condition is named, or the figure does not vary by case (an exact count of a fixed thing, an id, a date, a status code, a test result)' } },
      citation: { type: 'choice',
        instructions: 'How do the `cited.text` lines (the exact lines at `cited.path` `cited.lines`) relate to what the `sentence` says about that location?',
        criteria: { supports: 'The lines state what the sentence says they contain or do, or directly imply it',
                    contradicts: 'The lines state the opposite, or show the sentence is false about them',
                    not_established: 'The lines do not address what the sentence asserts about them, either way' } },
    };
    ```

  - **Failures**, each a `note:`, with the exit code always 0:
    - No key: one note, then the "would send" list, and no network call.
    - Non-2xx: `HTTP <status> <detail.error_type>`. Branch on `!res.ok`, since a missing header gives 403
      (`observed`).
    - `TimeoutError` or `AbortError`, or a fetch `TypeError`: the reason. A budget abort is reported as
      `budget 30 s exhausted`, with the list of units that were not judged.
    - All requests failed: one summary line, "Jev unavailable: N of N requests failed, first: …", and no verdict
      table.
  - **Report** (stdout), in this order:
    1. A table: `L<line>  <question>  <verdict>  <p>  "<sentence, first 100 chars>"`. Flags come first: a Noul at
       or above the threshold, or a Choice of `contradicts` or `not_established`. Then everything else, with its
       probability.
    2. **"Extreme-case claims: re-derive by hand"**: every `extreme` unit with its line. This list is printed even
       when the key is missing, because it needs no model.
    3. Unresolved citations, with their reasons.
    4. A totals line:
       `units N · questions Q · flagged F · extreme E · unresolved U · failed X · model <response model field> · head <short sha> · <ISO date>`.
    5. The paste-ready block
       `<details><summary>Claim check (log-only, #302): F flagged, E to re-derive</summary>` … `</details>`,
       holding items 1–4.
- **GOTCHA**:
  - A Noul answer has no `confidence` field, so print `noul` as `p`. For a Choice, print `choice` and
    `probabilities[choice]`.
  - `fetch` is global. Do not import `node-fetch`.
- **VALIDATE**:
  - `node .claude/skills/piv-create-pr/scripts/claim-check.mjs <scratchpad>/pr300.md; echo "exit=$?"`, with the key
    present: expect the table, the lists, the totals and `exit=0`.
  - Then with `CLAIM_CHECK_BASE_URL=http://127.0.0.1:9`, a closed port: expect "Jev unavailable" and `exit=0`.
- **SATISFIES**: #302 "Log, do not block", and R3's fix: the worst-case wall time is bounded by `BUDGET_MS`.

### Task 4. ADD `--eval` to `claim-check.mjs`

- **IMPLEMENT**:
  - Rows have the shape
    `{id, question: 'provenance'|'not_measured'|'worst_case'|'citation', state, label: true|false|'supports'|'contradicts'|'not_established', source, basis}`.
  - Send each row's frozen `state` with the named `QUESTIONS` entry. Do not re-read the cited lines through
    `git show`, because the row's commit has since moved on.
  - Print, for each Noul question, the true positives, false positives, false negatives and true negatives at
    thresholds 0.3, 0.5, 0.7 and 0.9. Print a 3×3 matrix for citation.
  - List every miss by `id` and `p`.
  - Finish with a provenance line:
    `observed <ISO date> · model <response model field> · <N> rows · labelled-set blob <git hash-object>`.
  - The eval uses `BUDGET_MS = 120_000`, because 50 rows are meant to finish, and says so in the header.
- **VALIDATE**: after Task 6,
  `node .claude/skills/piv-create-pr/scripts/claim-check.mjs --eval .claude/skills/piv-create-pr/scripts/claim-check-labelled.jsonl; echo "exit=$?"`.
- **SATISFIES**: #302 "Results on the 50-sentence labelled set recorded in the PR body, with provenance".

### Task 5. CREATE `.claude/skills/piv-create-pr/scripts/claim-check.test.mjs`

- **IMPLEMENT**: use `node:test` and `node:assert/strict`.
  - Spawn the script **asynchronously**: `const c = spawn(process.execPath, [script, body], { cwd: tempRepo, env })`,
    collect stdout, then `const [code] = await once(c, 'close')`. **Never `spawnSync`** in a test that talks to an
    in-process stub. `spawnSync` blocks the parent's event loop, so the stub cannot answer. `observed` in the
    scratchpad's `deadlock.mjs` on v20.20.2: `spawnSync` gave **3050 ms `TimeoutError`**, and async `spawn` gave
    **148 ms `ok`**, against the same in-process server with a 3 s child timeout. Under `spawnSync`, tests 5, 6 and 9
    would go red, and test 10 would pass for the wrong reason.
  - Build `env` in the file from a copy of `process.env`, deleting `TYPESAFE_API_KEY` and the `CLAIM_CHECK_*`
    vars first.
  - Make temp git repos with `git -c user.email=t@t -c user.name=t commit`, because CI has no git identity.
  - **Offline tests, run by the gate:**
    1. *Parsing, expected*:
       - `"Gate took 58 s (observed)."` is kept, with `provenance` and `worst_case` asked.
       - `"See #302."` is dropped.
       - `"Merged in da9c933 on 2026-09-29."` is dropped.
    2. *Parsing, edge*:
       - A table row is one unit, and carries its `tableHeader` and `sectionIntro`. The #107 row, whose own cells
         hold no `observed`, still gets `provenance` and `not_measured` asked because of its header.
       - An indented 4-space block after a closing fence (PR #300's per-package counts) is dropped.
       - A 4-space nested bullet (`    - At abc1234: 3 of 4 red`) under a 2-space bullet is **kept**.
       - A list item under `**Mutation checks** (`observed`; …):` carries that paragraph as `sectionIntro`.
       - A fenced code block is ignored.
       - A heading `## Validation — observed` is attached to a sentence under it.
       - `harness.ts:454,541` gives two citations.
    3. *Extreme list, R2*: #87's plan:336 sentence (verbatim, from Context References) is `extreme`, is on the
       hand list, and does **not** get `worst_case` asked. The same list prints when there is no key.
    4. *Citation, edge*: in a temp repo holding `a/x.ts` and `b/x.ts`:
       - `a/x.ts:2` → ok, with exactly line 2.
       - `x.ts:2` → unresolved (ambiguous).
       - `a/x.ts:999` → unresolved.
       - `a/x.ts:1-100` → unresolved (range wider than 60).
    5. *Expected, stubbed*: a `node:http` stub on port 0 returns `provenance` 0.96. Spawn with
       `CLAIM_CHECK_BASE_URL` set to it and `TYPESAFE_API_KEY=dummy`. The sentence is flagged, the `<details>`
       block is present, and the exit status is 0.
    6. *Edge, stubbed*: the stub returns 0.04. The sentence is not flagged, but is listed with `p 0.04`.
    7. *Failure, key missing*: prints a `note:` and exits 0, and **the stub's request counter is 0**.
    8. *Failure, API down*: base URL set to a port the test just bound and closed. Expect "Jev unavailable" and
       exit 0.
    9. *Failure, 403*: the stub replays the `observed` 403 body. Expect a `note:` and exit 0.
    10. *Failure, budget (R3)*: the stub never responds. With `CLAIM_CHECK_TIMEOUT_MS=20000` and
        `CLAIM_CHECK_BUDGET_MS=300`, the process exits 0, prints `budget … exhausted`, and lists the unjudged units.
        It must finish in **under 10 s wall**, measured with `Date.now()` around the async spawn.
        - The wide margin is deliberate. A shared CI runner under a full turbo gate can stall for seconds.
        - The property being tested is "the budget fires, not the per-request timeout". So without the budget,
          the run takes ≥ 20 s, and the gap between the two outcomes is 10 s or more.
        - The stub must `destroy` its open sockets in `after()`.
    11. *Usage*: no argument → exit 2. A directory → exit 2.
  - **Live tests, opt-in.** `const live = Boolean(process.env.TYPESAFE_API_KEY) && process.env.CLAIM_CHECK_LIVE === '1'`,
    and `{ skip: live ? false : 'set CLAIM_CHECK_LIVE=1 with TYPESAFE_API_KEY' }`. These three use real,
    recovered text:
    - L1 *expected*: the #107 counterfactual row, with its real heading, `section_intro` and `table_header`
      (Context References) → `provenance` ≥ 0.5 (probe: 0.94) and `not_measured` ≥ 0.5 (probe: 0.90). Also send
      the measured sibling row `` | `geo.maps.route_fetched` `caller:'eta'` | 6 | **6** | `` with the same
      context → `not_measured` < 0.5 (probe: 0.05). The pair pins the separation.
    - L2 *edge*: the pr-206 row "`726 = 724 + 2`, `derived` …" → the question set in code is `['worst_case']`
      (no `observed`), and `worst_case` < 0.5 (probe: 0.08). This is the "a `derived` figure that shows its
      arithmetic is not flagged" case.
    - L3 *failure*: a real key with a closed-port base URL gives a note and exit 0.
- **GOTCHA**:
  - **Test 7 claims the no-key path makes no call, so run it under the mutation and record both results.**
    Delete the no-key early return. Test 7 must go red on the counter; tests 5–6 must stay green. Put both in the
    report.
  - Mutation for test 10: set the budget timer to 60 s. Test 10 must go red, because the run then waits out the
    20 s per-request timeout. Test 8 must stay green.
  - Close every stub server in `after()`, or `node --test` hangs the gate.
  - Turbo's strict env strips `CLAIM_CHECK_LIVE` and the key, so live tests always SKIP under the gate. That is
    intended; say so in the PR body.
- **VALIDATE**:
  - `pnpm --filter @taxi/pr-scripts test`: 11 pass, 3 `# SKIP` (`expected`, the count of cases listed here).
  - `CLAIM_CHECK_LIVE=1 node --test .claude/skills/piv-create-pr/scripts/claim-check.test.mjs`: 14 pass.
  - Both mutation runs, with both halves recorded.
- **SATISFIES**: #302 Acceptance "Tests: expected / edge / failure". Also R1 (the gate runs them) and R3 (test
  10).

### Task 6. CREATE `.claude/skills/piv-create-pr/scripts/claim-check-labelled.jsonl` (50 rows)

- **IMPLEMENT**:
  - **Target mix** (`expected`; if the sources run short, say so in the report):

    | Question | Positives | Negatives |
    |---|---|---|
    | `provenance` | ≥ 6 | ≥ 6 |
    | `not_measured` | ≥ 5 | ≥ 5 |
    | `worst_case` | ≥ 6 | ≥ 6 |
    | `citation` | ≥ 4 `contradicts` or `not_established` | ≥ 4 `supports` |

    The rest go wherever the sources supply best.
  - **Each label is the review's verdict, not the implementer's opinion.**
    - `basis` quotes the review line, and `source` is `pr-N-review.md:line`.
    - Positives come from finding headings.
    - Negatives come from ✅ or "matches" rows in the "re-derived and found true", "Figures audit" and "Claims
      audit" tables.
    - A row whose review verdict does not map to exactly one label is **left out**, not guessed.
  - **Use the original text:**
    - From a PR body, with `gh pr view N --json body`. If the sentence was rewritten after review, take the
      review's quotation and set `"quoted_by_review": true`.
    - From a report or plan, with `git log --all -- <path>`, then `git show <sha>:<path>` at the sha the review
      names.
  - Rows keep the surface's heading and, for table rows, its `table_header`.
  - Citation rows freeze `cited.text` from `git show <reviewed sha>:<path>`.
  - **Required rows:**
    - `p-107`: the #107 counterfactual row, with its heading, intro and header, question `provenance`, label
      `true`.
    - `m-107` and `m-107-eta`: the same counterfactual row and the measured `caller:'eta'` row, question
      `not_measured`, labels `true` and `false`. Basis: pr-107-review.md H1.
    - `c-harness-454`: CLAUDE.md's sentence, with line 454 at `da9c933`. Label `not_established`.
    - `w-87`: #87's plan:336 sentence, question `worst_case`, label `false`. It does name a case. Its real defect
      is covered by the extreme list and test 3.
- **GOTCHA**:
  - The repo is public, and TypeSafe receives these rows. Take sources only from public `.claude/code-reviews/`,
    PR bodies and reports, and never from `__DO_NOT_ADD_TO_GITHUB/`.
  - Before committing, `grep -nE '\+371|@[a-z]' <file>` must print nothing.
- **VALIDATE**:
  - `wc -l` is 50.
  - `jq -c . <file> >/dev/null && echo valid`.
  - `jq -r .question <file> | sort | uniq -c` shows the mix. Put it in the report.
  - `jq -r .source <file> | grep -v '^pr#' | cut -d: -f1 | sort -u | while read f; do test -f ".claude/code-reviews/$f" || echo "MISSING $f"; done`
    prints nothing. PR-body rows use the source form `pr#N-body`.
- **SATISFIES**: #302 "Label 50 sentences by hand first".

### Task 7. RUN the eval and record it

- **IMPLEMENT**:
  - Run Task 4's command once.
  - Save its stdout to `.claude/reports/jev-claim-check-eval-<date>.md`, under a heading naming the command, the
    date, the model from the response, and the head sha.
  - Every figure the PR body quotes from it is `observed` and names that file.
  - Poor precision or recall is recorded, not fixed by editing `QUESTIONS`: that would fit the questions to the
    test.
  - A question may change only if a row shows that the **question** is ambiguous. That change goes under
    Divergences, with before and after results, both labelled "same set, not held out".
- **VALIDATE**: the report's provenance line contains `jev-1.13.0` and `git rev-parse --short HEAD`.
- **SATISFIES**: #302 Acceptance, bullet 3.

### Task 8. UPDATE `.claude/skills/piv-create-pr/SKILL.md` Phase 2.5

- **IMPLEMENT**:
  - Rename the heading to
    `## Phase 2.5 — Generate the validation block, find the inherited figures (blocking), then the claim check (log-only)`.
  - Change "Two scripts" to "Three scripts".
  - Add `.claude/skills/piv-create-pr/scripts/claim-check.mjs <draft-body.md>` to the command block.
  - Add one paragraph:
    - **`claim-check.mjs` is log-only (#302): it never blocks and always exits 0, and a missing key or a failed
      call is a note.**
    - Paste its `<details>` block under `## Validation`. For the first 10 PRs, that block is the log each review
      compares against.
    - Re-derive every line in its **extreme-case list** by hand before opening the PR. That list is where #87's
      shape lands, because no sentence-level judgement can see it.
  - Change "neither script" to "none of the scripts". To the bullet "A right number under a wrong label", add:
    "claim-check lists extreme-case claims for you but does not judge them".
- **GOTCHA**:
  - Keep "(blocking)" attached only to `record-gate.sh` and `inherited-figures.sh`.
  - The file is not fenced (`pre_tool_use.py:115-116`).
- **VALIDATE**: `grep -c "claim-check.mjs" .claude/skills/piv-create-pr/SKILL.md` is ≥ 2, and
  `grep -n "log-only" .claude/skills/piv-create-pr/SKILL.md` finds the paragraph.
- **SATISFIES**: #302 Acceptance "referenced from Phase 2.5".

### Task 9. UPDATE `.claude/skills/piv-review-pr/SKILL.md` "The numbers pass"

- **IMPLEMENT**: add one paragraph after the "Enumerate every figure" list:
  - "If the PR body carries a **Claim check (log-only, #302)** block, compare it with your figure findings. Add a
    `### Claim-check comparison` line to the report with these counts:
    - flags you confirmed;
    - flags you rejected;
    - your figure findings it missed.
  - "This is the 10-PR log #302 needs before the check may block. Its flags are not findings until you re-derive
    them."
- **VALIDATE**: `grep -n "Claim-check comparison" .claude/skills/piv-review-pr/SKILL.md`.
- **SATISFIES**: #302 "compare it with what the PR review later found".

### Task 10. UPDATE `CLAUDE.md`: stale `harness.ts:454,541`

- **IMPLEMENT**:
  - Re-run `grep -n "overrideProvider(KV_STORE)\|new InMemoryKeyValueStore()" services/api/test/harness.ts` at
    the implementing head.
  - Replace **only** the digits. At `da9c933` the new digits are `534,546`.
  - Do not touch the sentence around them; CLAUDE.md's own paragraph warns against that.
- **VALIDATE**:
  - `grep -o 'harness.ts:[0-9,]*' CLAUDE.md` prints the new digits.
  - Run `sed -n` on each of those lines of `harness.ts`, which must show the construction and the override.
- **SATISFIES**: adjacent scope, folded in. The frozen `c-harness-454` row is unaffected.

### Task 11. UPDATE `.claude/skills/piv-validate/SKILL.md:36`: the gate's task count

- **IMPLEMENT**:
  - The line says `Tasks: 22 successful, 22 total` at 2026-09-18's head. It is dated, so it is not false, but it is
    the living instruction a reader compares a run against.
  - Append one clause: "; 23 since #302 added `@taxi/pr-scripts#test`". Quote the count `record-gate.sh` actually
    printed in Task 1 or Level 3, not this plan's `expected` 23.
  - Leave `docs/issues/issue-193.md`'s `22`s alone; they are history.
  - `observed`: `git grep` over `docs/runbooks`, `CLAUDE.md`, `.claude/references`, `.claude/skills` and other
    living `*.md` found only this line and `issue-193.md`.
- **GOTCHA**: after merge, the memory file `taxi-pr-figures-gate-scripts.md` ("gate task count … (22)") goes
  stale. That is the planning session's memory, not a repo file. Name it in the PR body's reviewer notes so the
  next session updates it; do not edit `~/.claude` from the implementation.
- **VALIDATE**: `grep -n "23 since #302" .claude/skills/piv-validate/SKILL.md`.
- **SATISFIES**: keeps the gate's stated task count true after Task 1 changes it.

---

## TESTING STRATEGY

### Unit Tests

Offline tests 1–4 cover pure parsing and resolution, using temp git repos. There is no mocking of `git`.

### Integration Tests

- Offline tests 5–11 spawn the real script against a `node:http` stub, across the same process boundary the skill
  uses: the body file exists, then `node <script> <file>` runs, then it calls out.
- Live L1–L3 run against the real API, opt-in.
- There is no socket or realtime surface.

### Edge Cases

| Edge case | Verified in |
|---|---|
| `observed` only in a table column header (#107) | test 2, live L1 |
| `observed` only in a bold lead-in paragraph (PR #300) | test 2 (`sectionIntro`) |
| Indented 4-space gate-output block dropped | test 2 |
| Counterfactual separated from measured rows under the same `Observed` header | live L1 (pair), labelled rows `m-107`, `m-107-eta` |
| Fenced code ignored; heading carries `observed` | test 2 |
| `:454,541` comma list | test 2 |
| Extreme-case claim is listed, not model-judged (#87) | test 3 |
| Ambiguous basename, past EOF, range wider than 60 | test 4 |
| Low probability logged, not flagged | test 6 |
| No key → zero requests | test 7, plus its mutation run |
| 403 on a missing header | test 9 |
| Never-responding API bounded by the budget | test 10, plus its mutation run |
| Derived figure with arithmetic not flagged | live L2, plus the labelled set |
| Body with zero claim units | Level 4 step 3 |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

- `node --check .claude/skills/piv-create-pr/scripts/claim-check.mjs && node --check .claude/skills/piv-create-pr/scripts/claim-check.test.mjs`
- No eslint covers `.claude/` (there is no root `eslint.config.*`, `observed`), so match the siblings by eye.

### Level 2: Unit Tests

- `pnpm --filter @taxi/pr-scripts test`
- `CLAIM_CHECK_LIVE=1 node --test .claude/skills/piv-create-pr/scripts/claim-check.test.mjs`

### Level 3: Integration Tests

- `.claude/skills/piv-create-pr/scripts/record-gate.sh --clean`
  - It runs the full gate, which now includes `@taxi/pr-scripts#test`. Confirm it by name in turbo's per-task
    results.
  - Quote the task count it prints (`expected` 23).

### Level 4: Manual Validation

1. `gh pr view 128 --json body -q .body > <scratchpad>/pr128.md`, then run the script on it. Record the verdicts
   for the "`i18n.ts` dropped 454 → 47" sentence, if it is still in the published body.
2. Write a scratch body with CLAUDE.md's `harness.ts:454,541` sentence and run it. `:454` must not be `supports`,
   because the real line is `push: RecordingPushProvider;`.
3. Run it on a body with no digits and no provenance words. Expect `units 0`, exit 0, and no request. Check with
   `CLAIM_CHECK_BASE_URL=http://127.0.0.1:9`: no "unavailable" note may appear, because nothing was sent.
4. Dogfood. This ticket's PR runs the script in Phase 2.5, and its block is log entry 1 of 10.

---

## ACCEPTANCE CRITERIA

- [ ] AC1: `claim-check.mjs` is in `.claude/skills/piv-create-pr/scripts/`, and Phase 2.5 references it by path.
- [ ] AC2: tests cover #302's three cases, each both offline and live:
  - expected: tests 5 and L1;
  - edge: tests 6 and L2;
  - failure: tests 7–10 and L3.
- [ ] AC3: the gate runs the offline suite, shown by `@taxi/pr-scripts#test` in `record-gate.sh`'s results.
- [ ] AC4: exit code 0 on every path except usage (2). Wall time is bounded by `BUDGET_MS` (test 10).
- [ ] AC5: cited lines come only from `git show HEAD:<path>`, capped at 60 lines. Unresolvable citations are
  never sent.
- [ ] AC6: extreme-case claims are listed for re-derivation by hand, with no model (test 3).
- [ ] AC7: the 50-row set is committed. The eval results are in the PR body, with the model from the response,
  the date, the head sha and the report path.
- [ ] AC8: `piv-review-pr` asks for the comparison.
- [ ] AC9: no key material in the diff. `git diff origin/main | grep -ciE "bearer [a-z0-9_-]{20,}"` prints `0`,
  and the new files are read by eye.

---

## COMPLETION CHECKLIST

- [ ] Tasks 1–11 in order. Task 6 may run in parallel with Task 5.
- [ ] Every VALIDATE run, with its output in the report.
- [ ] Both mutation runs recorded, both halves.
- [ ] Level 4 steps 1–3 run.
- [ ] `record-gate.sh --clean` green, with `short_gate` false.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Q1: who sets the labels.** Resolved by Linards on 2026-09-29: from review verdicts. A `basis` quote backs
  each label, ambiguous rows are left out, and he spot-checks the file in the PR.
- **Q2: where the log lives.** Resolved: the `<details>` block in the PR body.
  - A gitignored file dies with its worktree.
  - A tracked file written after the commit trips Phase 1's clean-tree check on the next PR.
- **Q3 (was R2): #87.** Resolved by design. Three probe framings could not separate #87 from a correct worst-case
  sentence (see the probe table), because #87's defect is not in its sentence. The extreme list sends every such
  claim to a human deterministically. That covers #87's shape, but it is a routing guarantee, not detection.
- **Q4 (was R3): timing.**
  - Worst case: every request hangs. Wall time is `BUDGET_MS` = **30 s** plus Node start-up (`derived`,
    assuming the budget abort fires). Before the budget, it would have been 10 s × ⌈60/6⌉ = 100 s for a 60-unit
    body.
  - Typical: about 0.2–0.4 s per request (`observed`, 7 probes).
  - Test 10 pins the bound.
- **Q5: cost.** It is not a risk. Derived from the probes' `observed` 407–723 input tokens per request, rounded up
  to 750:
  - the eval is 50 × 750 = 37.5k tokens;
  - a 60-unit body at ~1.5 requests per unit is 90 × 750 = 67.5k tokens.
  - At $0.042 per million tokens (docs), each is under $0.01.
- **Q7: false-positive rate on real bodies.** The closest call in the probes is 0.40 (`provenance`, a PR #300
  mutation bullet). If the first logged PRs show `provenance` flagging well-sourced bullets, that is the log doing
  its job. The 10-PR comparison (Task 9) measures it. The threshold is not tuned in this ticket.
- **Q6 (was R1): gate coverage.** Resolved by Task 1. The gate cannot run the live tests, which need a key CI does
  not have. They stay opt-in, and skip visibly.

## NOTES (open canvas)

**Why Node and not bash.**
- Sentence splitting that respects backticks, JSON requests, a worker pool, and a stub HTTP server for tests are
  each a few lines in Node and fragile in bash with `jq` and `curl`.
- `node:test` needs no install.
- What the new script shares with its bash siblings is the header discipline and the exit semantics, not the
  language.

**Why one request per unit.** The jaggedness page warns about large states with irrelevant detail. Per-unit state
stays small, and the probe token counts show the overhead is negligible.

**What the probes taught.**
- Jev said `supports` at 0.87 on text that was not the file's real content, so code must supply the cited lines.
- Jev correctly declined to flag #87's sentence under three framings: the sentence does name a case and a
  comparison. The defect lay in an axis the sentence never mentions. That is the line between what a sentence
  judgement can see and what needs a re-derivation, and the extreme list sits on that line.

**Promotion path (not this ticket).** After 10 PRs, the `Claim-check comparison` lines give confirmed, rejected
and missed counts per question. The blocking decision and threshold come from those alone.

## AMENDMENTS

- 2026-09-29: resolved the three risks from the first draft.
  - R1: the offline tests enter the gate through a workspace package (verified in a scratch workspace).
  - R2: #87 is routed through a deterministic extreme-case list, after three probe framings failed to separate it.
  - R3: a 30 s total budget, pinned by test 10.
  - Also added `table_header` to state, because #107's `Observed` sat in a column header. The first draft's state
    would have missed #107.
  - The live tests use recovered original text instead of invented sentences.
- 2026-09-29, second pass:
  - Re-probed with the real headings recovered from git.
  - Probed PR #300's Validation block. That found three things:
    - `section_intro` is needed, because the `observed` label lives in bold lead-ins.
    - The finder must drop indented code blocks.
    - `provenance` alone flags #107's measured rows (0.90–0.91). That led to adding `not_measured`, which
      separates them (0.90 against 0.05–0.10).
  - Test 10's bound was widened to 10 s against a 20 s per-request timeout, so CI load cannot fail it.
  - Task 1's VALIDATE was corrected: `node --test` with no tests exits 0.
  - Added Task 11 for `piv-validate`'s task count.
  - Q1 answered.
  - Tests spawn asynchronously; `spawnSync` deadlocks against the in-process stub (`observed`, `deadlock.mjs`).
  - The indented-code rule was tightened so nested bullets are kept.
  - Added the CodeQL gotcha to Task 1.
