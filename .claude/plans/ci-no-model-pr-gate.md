# Feature: A PR leaves draft only through a no-model gate (#165)

The following plan should be complete, but validate documentation and codebase patterns and task sanity before you start implementing. Pay special attention to the names of existing scripts, hook functions and skill phases; edit in place, do not fork copies.

> **Provenance (2026-09-10).** Every `path:line` below was read against branch `fix/pr-154-deferred-lows` at `800768f`, whose tree equals `main` (`6d72261`) for every file this plan touches (`git diff 6d72261 800768f --stat -- .github .claude/hooks .claude/skills docs/runbooks CLAUDE.md` is empty; the branch changes driver/api/shared code only). Every figure carries `observed` (run named), `derived` (arithmetic and condition shown) or `expected`. Nothing here was implemented; one throwaway probe PR (#166) was opened and closed during planning, see NOTES.

## Feature Description

Four process changes that make CI, not a model, the only path from draft to ready:

- **O1** `piv-create-pr` opens every PR as a draft; a new `ready` job in `ci.yml` flips it after the gate jobs pass; the PreToolUse hook refuses `gh pr ready` from any Claude session.
- **S1** A SonarQube Cloud quality gate runs as a CI job on every PR, keyed to the PR number. Blocked on Linards' accounts (`blocked:accounts`); ships last.
- **S2** An `audit-diff` CI job fails a PR whose production dependency tree carries an advisory the base does not.
- **S3** `piv-fix-review-findings` gains a script that turns a PR's Sonar findings into its existing triage list, plus the no-suppression rules.

## User Story

As **Linards, reviewing PRs a model wrote**
I want **"ready for review" to mean the CI gate passed at this head, enforced by something that cannot rationalise**
So that **the prose "STOP if red" rules that failed on #87, #107 and the CLAUDE.md gate line stop being the last line of defence.**

## Problem Statement

Every "STOP if red" in the PIV skills is prose the model obeys, and the ledger of prose checks failing is long. Branch protection is the normal tool and is unavailable here (`observed` in the ticket, 2026-09-10: HTTP 403 from the branch-protection and rulesets APIs on this private plan). CI already runs on every PR and is the no-model step the repo has.

## Solution Statement

Draft-by-default plus a CI job with `pull-requests: write` that runs `gh pr ready` when every gate job is green (and `gh pr ready --undo` when one is red), a hook that removes the model's own path to the flip, and two new gate jobs (Sonar, audit-diff) feeding the same `needs`. The human keeps one path: the "Ready for review" button in the GitHub UI, documented as the only bypass.

## Out of Scope / Non-Goals

- **Not included: working down the 66 existing advisories** (`observed` below). The diff rule lets the backlog ride. The `next` critical in dispatch is the first thing a follow-up looks at; file it when S2 merges.
- **Not included: Archon or any workflow engine; Semgrep, CodeQL, gitleaks, eslint security plugins.** Ticket "Not in this ticket".
- **Not included: coverage upload to Sonar.** No `lcov` report is fed on day one; see R3 in NOTES for what that does to the gate.
- **Not included: Sonar's monorepo mode** (one Sonar project per workspace package). One project over the whole repo, free plan.
- **Not changing: the `check` job**, its Redis service, or the gate command. `record-gate.sh`, `inherited-figures.sh` and Phase 2.5 of `piv-create-pr` stay as they are.
- **Not changing: `deploy.yml`.**
- **Not adding: a required-status-checks rule.** That is branch protection, which is what is unavailable.

## Feature Metadata

**Feature Type**: Process / CI enhancement
**Estimated Complexity**: Medium (four small parts, one blocked on accounts, all validated only by live PR runs)
**Primary Systems Affected**: `.github/workflows/ci.yml`, `.claude/hooks/pre_tool_use.py`, `.claude/skills/piv-create-pr`, `.claude/skills/piv-fix-review-findings`, `.claude/skills/piv-review-pr`, `docs/runbooks/`, `CLAUDE.md`
**Dependencies**: GitHub Actions (`actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4` already in use), `gh` on the runner (preinstalled on `ubuntu-latest`), `SonarSource/sonarqube-scan-action` (S1), `pnpm audit` (S2), `curl` + `jq` (S3)

## Related Work

**Implements**: [#165](https://github.com/linardsb/taxi/issues/165)   ·   **Epic**: none (process ticket; no architecture doc; the decisions it inherits are in the ticket body and CLAUDE.md's figure rules)

**Back-references** (plans this builds on):

- `.claude/plans/file-length-rule-shipped-source.md` - Why: the last plan that edited `pre_tool_use.py`'s neighbour rules; same fail-open shape.
- `.claude/skills/piv-create-pr/SKILL.md` Phase 2.5 and `scripts/` - Why: the pattern for a script that lives beside a skill and is referenced from an executable path (ledger L2).
- `.claude/plans/deploy-hetzner-environment.md` - Why: `docs/runbooks/hetzner-deploy.md` is the runbook style (`observed`/`derived`/`expected` tables) the new sibling mirrors.

**Forward-references**:

- (to file at S2 merge) "chore(deps): work down the `pnpm audit --prod` backlog, `next` critical first"
- (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `.github/workflows/ci.yml` (all 50 lines) - Why: the only workflow the new jobs join. `on:` is `push: [main]`, `pull_request`, `workflow_dispatch` (lines 3-13). The `check` job (16-50) is left untouched; the new jobs sit after it at the same indentation. There is no top-level `permissions:` block, and the repo's Actions default is read-only (`observed` 2026-09-10: `gh api repos/linardsb/taxi/actions/permissions/workflow` → `default_workflow_permissions: read`), so the `ready` job must declare `pull-requests: write` itself.
- `.claude/hooks/pre_tool_use.py` (all 123 lines) - Why: the hook to extend. Pattern: a compiled regex constant, a `BLOCKED_*_MESSAGE` constant (lines 43-55), an `is_*` predicate (`is_dangerous_rm` 78-87, `is_anketa_write` 90-95), one `if` in `main()` (98-121) printing to stderr and `sys.exit(2)`. Everything fails open (`except Exception: sys.exit(0)`, lines 118-119). The docstring (lines 5-17) numbers the guards; add the fourth there. `ENV_DUMP` (lines 31-36) matters for the implementer: a Bash **command** whose text contains `printenv`, `process.env` or `echo … $…TOKEN` is refused, so write scripts with the Write tool, never a heredoc.
- `.claude/skills/piv-create-pr/SKILL.md` (lines 92-130) - Why: Phase 3 is the `gh pr create` call to make `--draft` (line 99), the body footer `_Ready for review._` (line 116), the "Use `--draft` if…" aside (line 121) and the Output handoff sentence (lines 129-130). Phase 2.5 (56-90) is the pattern for referencing a script from a skill so its deletion shows in a diff.
- `.claude/skills/piv-review-pr/SKILL.md` (line 27) - Why: the state guard "`DRAFT` → review direction, don't approve/block" becomes wrong the moment every PR opens as a draft. Phase 3 (lines 36-40) is where a red `sonar` check gets folded into the review.
- `.claude/skills/piv-fix-review-findings/SKILL.md` (all 117 lines) - Why: the skill S3 feeds. Its input is "a code-review file or description of issues" (line 12); the script's output must be that. Rules go after §1 Triage (lines 39-52) as a new section; the report location is `.claude/reports/pr-{N}-review-fixes.md` (line 115).
- `.claude/skills/piv-create-pr/scripts/record-gate.sh` (lines 1-80) - Why: the shell style to mirror: long header comment that doubles as `--help` (line 60), `set -uo pipefail`, `root=$(git rev-parse --show-toplevel)`, explicit exit codes, no colour.
- `.claude/references/conventions.md` (lines 23-34) - Why: PR body rules the draft footer must still satisfy (`## Summary`, `## What changed`, `## Validation`, the footer line).
- `docs/runbooks/hetzner-deploy.md` (lines 1-22, 121-143, 500-545) - Why: runbook voice; §1.4 is the shape of a "where the secret lives" table; §8.3 shows how a gate is documented with `observed` runs named.
- `CLAUDE.md` (line 83) - Why: the on-demand context table gets a row for the new runbook.
- `turbo.json` - Why: nothing in this ticket adds a turbo task or reads a new env var through turbo; confirmed so the strict-env passlist needs no change. `SONAR_TOKEN` is read by the scan action, not by any task.
- `package.json` (root) - Why: `packageManager: pnpm@10.33.2` is what `pnpm/action-setup@v4` installs; no `pnpm.auditConfig` exists today (`observed`: grep for `auditConfig|ignoreCves|ignoreGhsas` in `package.json`, `pnpm-workspace.yaml` finds nothing).

### New Files to Create

- `.github/scripts/audit-diff.sh` - S2: the advisory diff, runnable locally and in CI. Mode 100755.
- `sonar-project.properties` - S1: project key, sources, tests, exclusions.
- `.claude/skills/piv-fix-review-findings/scripts/sonar-findings.sh` - S3: Sonar Cloud API → findings list. Mode 100755.
- `docs/runbooks/pr-gate.md` - the runbook the AC asks for (sibling of `hetzner-deploy.md`, not a section in it: that runbook is about the box).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [GitHub Actions: `pull_request` event](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#pull_request)
  - Default activity types and the fact that draft PRs fire them.
  - Why: the `ready` job runs on the same event the gate already uses; no `ready_for_review` type is needed.
- [GitHub Actions: `GITHUB_TOKEN` and event recursion](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow)
  - "events triggered by the GITHUB_TOKEN will not create a new workflow run"
  - Why: `gh pr ready` from the job cannot loop.
- [GitHub Actions: `needs` context and `always()`/`cancelled()`](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/accessing-contextual-information-about-workflow-runs#needs-context)
  - `needs.<job>.result`, the `needs.*.result` object filter, and why `!cancelled()` beats `always()` for a job that must not run on a cancelled run.
  - Why: the `ready` job decides between flip and undo from the results of every gate job.
- [`gh pr ready`](https://cli.github.com/manual/gh_pr_ready)
  - `--undo`; `observed` 2026-09-10 on PR #166: a second `gh pr ready` on an already-ready PR prints `! … is already "ready for review"` and exits 0 (idempotent).
- [`pnpm audit`](https://pnpm.io/cli/audit)
  - `--prod`, `--json`, exit 1 when advisories are found, `--ignore-registry-errors`, and the ignore settings (`audit.ignore` in `pnpm-workspace.yaml` from pnpm 11.16; legacy `auditConfig.ignoreGhsas` / `auditConfig.ignoreCves`; `--ignore <GHSA>`).
  - Why: the diff rule and the suppression guard (T8).
- [SonarQube Cloud: subscription plans](https://docs.sonarsource.com/sonarqube-cloud/administering-sonarcloud/managing-subscription/subscription-plans.md) and [pricing](https://www.sonarsource.com/plans-and-pricing/)
  - `observed` 2026-09-10 (research pass): Free column: "Analysis of private projects: Up to 50k LOC"; "Pull request analysis: Only if the target branch is the main branch"; "Branch analysis: Only main branch analysis". Pricing page: Team "Starts at $34 monthly" (the docs' AI answer box said $32; the page says $34 twice). "Used LOC calculation … excluded from your LOC count: Test code. Files excluded from analysis. Code in unsupported languages. Comments or blank lines."
  - Why: S1's two limits go into the runbook as `observed` with the date read; `sonar.tests` files are free.
- [`SonarSource/sonarqube-scan-action`](https://github.com/SonarSource/sonarqube-scan-action)
  - `observed` 2026-09-10: latest release **v8.2.1** (2026-07-15), `runs: node24`, default scanner 8.1.0.6389. "`SONAR_TOKEN` … mandatory secret for all use cases. `SONAR_HOST_URL` … not needed for SonarQube Cloud." `fetch-depth: 0` is "recommended for improving the relevancy of reporting". Extra parameters go through `with: args:` as `-Dsonar.*` flags; "In version 6 … we no longer support the full bash syntax" in `args`. The Sonar JS analyser embeds its own Node on Linux x64.
  - Why: the `sonar` job (T12).
- [SonarQube Cloud: pull request analysis](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/pull-request-analysis.md)
  - Scanners auto-detect `sonar.pullrequest.key`, `.branch`, `.base` on GitHub Actions; manual values override.
  - Why: no PR parameters in the workflow.
- [Parameters not settable in the UI](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/analysis-parameters/parameters-not-settable-in-ui.md)
  - "`sonar.qualitygate.wait` — Forces the analysis step to poll the server instance and wait for the Quality Gate status. This setting will fail the pipeline if the quality gate fails. Default `false`"; `sonar.qualitygate.timeout` default 300 s. `sonar.sources` and `sonar.tests`: "Wildcards … are not allowed"; `sonar.tests` has no default.
  - Why: one pinned action instead of two (D1).
- [`SonarSource/sonarqube-quality-gate-action`](https://github.com/SonarSource/sonarqube-quality-gate-action)
  - `observed`: v1.2.1 (2026-08-05); exits 1 on `ERROR`, `WARN` and timeout; neither README calls the other deprecated. The ticket names this action; T12 uses `sonar.qualitygate.wait=true` instead, same exit semantics, one action fewer (D1).
- [Excluding files based on patterns](https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/project-analysis/setting-analysis-scope/excluding-files-based-on-patterns.md)
  - "A code file is either a source or a test code; it cannot be both (If this is the case, the scanner will fail the analysis with an error message.)" — `File <fileName> can't be indexed twice`. Worked example for colocated tests: `sonar.sources` and `sonar.tests` both `src`, then **both** `sonar.exclusions=src/**/test/**/*` and `sonar.test.inclusions=src/**/test/**/*`. "`sonar.exclusions` — Defines the source files (non-test files) to be excluded"; "if there is an overlapping, then exclusion patterns have precedence over inclusion patterns."
  - Why: T11 must put the spec patterns in `sonar.exclusions` as well as `sonar.test.inclusions`, or the first scan fails.
- [JavaScript/TypeScript analysis](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/languages/javascript-typescript-css.md)
  - tsconfig auto-discovery from the project root unless `sonar.typescript.tsconfigPaths` is set; `node_modules`, `dist` and `.d.ts` excluded by default.
- [Automatic analysis](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/automatic-analysis.md)
  - "if you wish to use a CI-based analysis on a project, you must ensure that automatic analysis is turned off for that project." Toggle: project **Administration › Analysis Method**.
  - Why: prerequisite 3.
- [SonarQube Cloud Web API: issues](https://sonarcloud.io/web_api/api/issues), [hotspots](https://sonarcloud.io/web_api/api/hotspots), [qualitygates](https://sonarcloud.io/web_api/api/qualitygates)
  - `observed` 2026-09-10 against the public project `tarkovtracker-org_TarkovTracker`, PR key `833`: `GET /api/issues/search?componentKeys=K&pullRequest=N&resolved=false&ps=500` returns `{total, paging{pageIndex,pageSize,total}, issues[{key, rule, severity, type, component, line, message, status, impacts[{softwareQuality,severity}], effort}]}`; `GET /api/hotspots/search?projectKey=K&status=TO_REVIEW` returns `{paging, hotspots[{key, ruleKey, securityCategory, vulnerabilityProbability, component, line, message, status}]}`; `GET /api/qualitygates/project_status?projectKey=K&pullRequest=N` returns `{projectStatus{status, conditions[{metricKey,status,actualValue,errorThreshold}]}}`. `component` is `K:relative/path`. The host is `https://sonarcloud.io/api/…`; `https://api.sonarcloud.io/api/issues/search` answered 403 the same day.
  - `observed` from `GET /api/webservices/list` (research pass): `issues/search` `ps` max 500 (`ps=501` → error); `statuses`, `severities`, `types` deprecated in favour of `issueStatuses`, `impactSeverities` (`INFO, LOW, MEDIUM, HIGH, BLOCKER`), `impactSoftwareQualities`; `resolved` still current. **`hotspots/search` on Cloud lists no `pullRequest` parameter** (`fileUuids, files, hotspots, onlyMine, p, projectKey, ps, resolution, sinceLeakPeriod, status` only); the call with `pullRequest=833` answered 200, so the parameter is ignored, not rejected. Auth: "`Authorization: Bearer <token>`" is the documented scheme; `-u token:` also answers 401 on a bad token.
  - Why: T8 scopes hotspots by the PR's changed files itself, and uses the Bearer header.

### Patterns to Follow

**Hook guard (mirror `is_dangerous_rm`, `pre_tool_use.py:78-87`):**

```python
PR_READY_FLIP = re.compile(r"\bgh\s+pr\s+ready\b|markPullRequestReadyForReview")

BLOCKED_PR_READY_MESSAGE = (
    "BLOCKED: `gh pr ready` is CI's to run, never a model's (#165).\n"
    "A PR leaves draft only when ci.yml's `ready` job sees every gate job green.\n"
    "If it is stuck: read the failing check on the PR, fix, push. A human can\n"
    "flip it in the GitHub UI; that path is documented in docs/runbooks/pr-gate.md."
)


def is_pr_ready_flip(tool_name: str, tool_input: dict) -> bool:
    if tool_name != "Bash":
        return False
    return bool(PR_READY_FLIP.search(tool_input.get("command", "")))
```

The GraphQL alternation closes the other route to the same flip (`gh api graphql … markPullRequestReadyForReview`); REST has no un-draft endpoint. `--undo` is caught by the same regex, on purpose: re-drafting is CI's too.

**Script header (mirror `record-gate.sh:1-60`):** a comment block that states the defect the script exists for, the invocation forms, the exit codes, and what it does NOT catch; `-h|--help` prints the block with the same `awk` one-liner. `set -uo pipefail` (not `-e`: the scripts call commands whose non-zero exit is data, `pnpm audit` above all).

**Skill ↔ script reference (mirror `piv-create-pr/SKILL.md:56-66`):** the skill names the script path in a fenced command so a deletion shows in a diff and the prose has an executable step (memory: remedies that add prose alone do not fire).

**Runbook figures (mirror `hetzner-deploy.md:9-12`):** every number labelled `observed` (run named), `derived` (arithmetic and condition) or `expected`.

**Naming:** jobs are lower-kebab (`check`, `ready`, `sonar`, `audit-diff`); scripts are kebab `.sh`; hook predicates are `is_<thing>`; messages are `BLOCKED_<THING>_MESSAGE`.

**Error output in CI steps:** `echo "::error::…"` before `exit 1` so the reason is on the PR's check line, not only in the log.

---

## IMPLEMENTATION PLAN

Ship as three PRs, in this order: **PR A** = Phase 1 + Phase 2 (O1 + S2, the two `ci.yml` edits reviewed together), **PR B** = Phase 3 (S3), **PR C** = Phase 4 (S1, after the three prerequisites). Phase 5 (runbook + CLAUDE.md row) lands in PR A and is amended in PR C. PR A is self-validating: it opens as a draft under the edited skill and its own run of the edited `ci.yml` flips it.

### Phase 1: O1, draft until the gate says so

**Tasks:** hook guard (T1), `piv-create-pr` edits (T2), `piv-review-pr` guard (T3), `ready` job + concurrency (T4).

### Phase 2: S2, audit-diff

**Independent of:** Phase 1 (separate job; the only coupling is `ready.needs`, set in T4 to include `audit-diff` from the start because both land in PR A).

**Tasks:** script (T5), job (T6), throwaway validation (T7).

### Phase 3: S3, the Sonar-fed fix loop

**Independent of:** Phases 1, 2 and 4 for writing and for validation against a public project. End-to-end validation against this repo's own PR waits on Phase 4.

**Tasks:** script (T8), skill rules (T9), `piv-review-pr` wiring (T10).

### Phase 4: S1, SonarQube Cloud gate

**Depends on:** Linards' three prerequisites (organisation + repo import + GitHub app; `SONAR_TOKEN` secret; Automatic Analysis off). Until then this phase is not mergeable: a `sonar` job with no token is red on every PR, and `ready` would never fire.

**Tasks:** `sonar-project.properties` (T11), `sonar` job and `ready.needs` (T12), stacked-PR case (T13).

### Phase 5: Runbook and index

**Tasks:** `docs/runbooks/pr-gate.md` (T14, in PR A; S1 section filled in PR C), CLAUDE.md row (T15).

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order within its phase. Each task is atomic and independently testable.

### T1 · UPDATE `.claude/hooks/pre_tool_use.py`

- **IMPLEMENT**: add `PR_READY_FLIP`, `BLOCKED_PR_READY_MESSAGE` and `is_pr_ready_flip()` per Patterns; call it in `main()` after `is_anketa_write`; add item 4 to the docstring ("4. The draft→ready flip — `gh pr ready` and its GraphQL mutation. CI's `ready` job is the only path (#165)."). Keep the fail-open `except`.
- **PATTERN**: `pre_tool_use.py:78-87` (predicate), `:43-55` (messages), `:98-121` (`main`).
- **GOTCHA**: the hook is live the moment the file is saved, in this session too. Validate with payload **files**, not inline JSON: a command whose text contains `printenv` or `cat .env` is refused by the existing guards before the payload reaches the script (`observed` 2026-09-10, this planning session).
- **VALIDATE**:
  ```bash
  S=$(mktemp -d)
  printf '%s\n' '{"tool_name":"Bash","tool_input":{"command":"gh pr ready 170"}}' > "$S/ready.json"
  printf '%s\n' '{"tool_name":"Bash","tool_input":{"command":"gh pr ready --undo 170"}}' > "$S/undo.json"
  printf '%s\n' '{"tool_name":"Bash","tool_input":{"command":"gh api graphql -f query=mutation{markPullRequestReadyForReview(input:{pullRequestId:\"x\"}){clientMutationId}}"}}' > "$S/gql.json"
  printf '%s\n' '{"tool_name":"Bash","tool_input":{"command":"gh pr view 170 --json isDraft"}}' > "$S/view.json"
  for p in ready undo gql; do uv run .claude/hooks/pre_tool_use.py < "$S/$p.json" 2>&1 | grep -q '#165' && echo "$p: blocked, names #165" || echo "$p: FAIL"; done
  uv run .claude/hooks/pre_tool_use.py < "$S/view.json"; echo "view exit=$? (expect 0)"
  ```
  Expected: three "blocked, names #165" lines, `view exit=0`. Before the edit the same three exit 0 (`observed` 2026-09-10 for `ready` and `gql`).
- **SATISFIES**: AC "A Claude session running `gh pr ready` is refused by the PreToolUse hook, with a message naming this ticket."

### T2 · UPDATE `.claude/skills/piv-create-pr/SKILL.md`

- **IMPLEMENT**:
  1. Line 3 `description`: "…opens the PR as a draft; CI's `ready` job flips it when the gate is green (#165)…".
  2. Phase 3 (line 99): `gh pr create --draft --base "{base}" …`.
  3. Body footer (line 116): replace `_Ready for review._` with `_Opened as a draft; CI's `ready` job flips it when `check`, `audit-diff` and `codeql` are green (#165). A red job leaves it here with the failing check on the PR._` (amended 2026-09-10: `codeql` where this said `sonar`; see AMENDMENTS)
  4. Delete the aside on line 121 ("Use `--draft` if the work isn't ready…"); replace with: "Never run `gh pr ready`; the hook refuses it and CI owns the flip. If the PR stays a draft, the failing check is the next finding."
  5. Output (lines 129-130): "Report the PR number + URL, base ← head, and: **'Draft. CI flips it ready in about six minutes when green (`observed` 313–361 s over the last 8 `ci.yml` runs on 2026-09-10); then run `piv-review-pr <number>`, then a human approves.'**"
- **PATTERN**: the existing phrasing; keep the skill general (it says so at line 40).
- **GOTCHA**: `conventions.md:28` requires the "Generated with Claude Code" footer; the draft sentence goes above it, not in its place.
- **VALIDATE**: `grep -n -- '--draft' .claude/skills/piv-create-pr/SKILL.md | wc -l` → `1`; `grep -c 'Ready for review\._' .claude/skills/piv-create-pr/SKILL.md` → `0`; `grep -c 'gh pr ready' .claude/skills/piv-create-pr/SKILL.md` → `1`.
- **SATISFIES**: AC "A PR opened by `piv-create-pr` is a draft."

### T3 · UPDATE `.claude/skills/piv-review-pr/SKILL.md` line 27

- **IMPLEMENT**: replace the `DRAFT` clause with: "`DRAFT` → every PR opens as one (#165). `gh pr checks {N}` says why it still is: checks pending → review anyway and say so; a red check → that check is finding #1 (Critical if it is `check`, High otherwise), and the review does not wait for the flip."
- **PATTERN**: same table row, same sentence shape.
- **VALIDATE**: `grep -n 'gh pr checks' .claude/skills/piv-review-pr/SKILL.md` → one hit on the guard line.
- **SATISFIES**: AC 1 (the review loop must not stall on a draft that CI has not yet flipped).

### T4 · UPDATE `.github/workflows/ci.yml` — `concurrency` + job `ready`

- **IMPLEMENT**: after `on:` add
  ```yaml
  # One run per PR head. A green run for an OLD head must not flip a PR whose
  # NEW head is still being tested (#165); cancelling the old run also stops it
  # spending minutes on a tree nobody will merge. Pushes to main are never
  # cancelled: each is a merge that should get its own baseline.
  concurrency:
    group: ci-${{ github.event.pull_request.number || github.sha }}
    cancel-in-progress: ${{ github.event_name == 'pull_request' }}
  ```
  and after the `check` job (still inside `jobs:`):
  ```yaml
    # The only path from draft to ready (#165). No model runs this: the hook
    # refuses `gh pr ready` in every Claude session, and the GitHub UI button is
    # the documented human bypass (docs/runbooks/pr-gate.md). Red anywhere in
    # `needs` converts the PR back to a draft, so "ready" always means "this
    # head passed". `!cancelled()` rather than `always()`: a cancelled run must
    # not touch the PR; the run that cancelled it will.
    ready:
      needs: [check, audit-diff]   # S1 adds `sonar` (#165 PR C)
      if: ${{ !cancelled() && github.event_name == 'pull_request' }}
      runs-on: ubuntu-latest
      permissions:
        pull-requests: write
      env:
        GH_TOKEN: ${{ github.token }}
        PR: ${{ github.event.pull_request.number }}
        RESULTS: ${{ join(needs.*.result, ' ') }}
      steps:
        - run: |
            case "$RESULTS" in
              *failure*|*cancelled*|*skipped*)
                gh pr ready --undo --repo "$GITHUB_REPOSITORY" "$PR"
                echo "::error::gate results: $RESULTS. PR #$PR stays a draft (#165)."
                exit 1 ;;
              *)
                gh pr ready --repo "$GITHUB_REPOSITORY" "$PR" ;;
            esac
  ```
- **PATTERN**: the comment-heavy style of the existing `check` job (`ci.yml:15-21`).
- **GOTCHA**: (a) `pull_request` runs use the workflow file from the PR's merge ref, so PR A's own run exercises this job. (b) `gh pr ready` on an already-ready PR exits 0 (`observed` 2026-09-10, PR #166), so no `draft ==` condition is needed and a re-run after an undo works; a condition on `github.event.pull_request.draft` would read the **original** event payload on a re-run and skip. (c) `GITHUB_TOKEN`-triggered events never start a new run, so no recursion. (d) The `check` job runs on `push` too; `ready` and `audit-diff` are `pull_request`-only, and a skipped `needs` entry on `push` leaves `ready` skipped, which is the intent.
- **VALIDATE**: `gh workflow view CI --yaml >/dev/null` is not a linter; use `python3 -c 'import yaml,sys; yaml.safe_load(open(".github/workflows/ci.yml"))'` (PyYAML is available under `uv run --with pyyaml python -c …` if the system python lacks it) for syntax, then the live check in T7/Level 4 step 1.
- **SATISFIES**: AC 1 ("a green run … marks it ready; a red run leaves it a draft").

### T5 · CREATE `.github/scripts/audit-diff.sh` (mode 100755)

- **IMPLEMENT**: `audit-diff.sh <base-ref>` — exits 1 when HEAD's `pnpm audit --prod` reports an advisory id the base's does not; 0 otherwise. Steps, in order:
  1. Short-circuit: `git diff --quiet "$base" HEAD -- pnpm-lock.yaml` → print "pnpm-lock.yaml unchanged vs <base>; identical trees cannot differ in advisories" and exit 0. This is the "unchanged lockfile is green in under a minute" edge case and is exact: both audits would query the same registry at the same moment for the same lockfile. (Two-dot diff, not three-dot: CI checkouts are shallow and have no merge base.)
  2. Suppression guard: `git diff "$base" HEAD -- package.json pnpm-workspace.yaml .npmrc | grep -E '^\+.*(ignoreGhsas|ignoreCves|audit\.ignore|^\+\s+ignore:)'` → `::error::` "an audit ignore list changed in this PR; that is a suppression, not a fix (#165)"; exit 1. Without this, a PR could add a vulnerable dependency and its GHSA to `audit.ignore` in one commit and read as green.
  3. Base audit on the lockfile alone: `git show "$base:pnpm-lock.yaml" > "$tmp/base/pnpm-lock.yaml"`, then `(cd "$tmp/base" && pnpm audit --prod --json > "$tmp/base.json")`. `observed` 2026-09-10: a directory holding only `pnpm-lock.yaml` (from `origin/main`) audits to the same 66 advisory ids as the full checkout, in ~1.4 s; no `node_modules`, no `package.json` needed.
  4. Head audit: `pnpm audit --prod --json > "$tmp/head.json"` at the repo root.
  5. Both files must satisfy `jq -e '.advisories | type == "object"'`; otherwise `::error::` "audit output is not JSON (registry error?)" and exit 1. A registry outage is red, not green: the same rule the ticket sets for Sonar.
  6. `comm -13 <(jq -r '.advisories|keys[]' base | sort) <(jq -r '.advisories|keys[]' head | sort)` → the new ids. For each print `  <github_advisory_id>  <severity>  <module_name>@<findings[0].version>  <title>`; exit 1 if any.
  Ignore `pnpm audit`'s own exit code (1 whenever advisories exist, which is always here). Clean the temp dir with `rm -r -- "$tmp"` on `EXIT`.
  (amended 2026-09-10, as shipped) Exit **2** for no argument, a base ref that does not resolve, or `pnpm`/`jq` missing: neither 0 nor 1 may describe a missing base. Step 2's pattern is two alternatives, `^\+.*(ignoreGhsas|ignoreCves|audit\.ignore)` and `^\+\s+ignore:` (the single pattern above carries a `^` inside its group), and the matching line is echoed to stderr.
- **PATTERN**: `record-gate.sh:1-60` header + `--help`; `set -uo pipefail`.
- **GOTCHA**: write the file with the **Write tool**. A Bash heredoc carrying `rm -rf` or `process.env` text is refused by the hook, and `rm -rf` in the script body is unnecessary anyway (`rm -r` on a temp dir you own). The id keys are npm's numeric advisory ids (`observed`: `1116251`…); `github_advisory_id` is the human label. `--prod` is decided from the lockfile's per-importer sections, so the lockfile-only base dir filters correctly (`observed`: 66 with and without the manifests; 78 without `--prod`).
- **VALIDATE** (local, three cases; `observed` numbers from this planning session at `800768f`):
  ```bash
  .github/scripts/audit-diff.sh origin/main; echo "same lockfile exit=$? (expect 0, short-circuit line)"
  # failure case, in a scratch worktree so the checkout stays clean:
  git worktree add -q /tmp/ad-probe HEAD && cd /tmp/ad-probe \
    && jq '.dependencies = {"lodash":"4.17.20"}' package.json > p && mv p package.json \
    && pnpm install --lockfile-only --silent && git commit -qam 'probe: lodash 4.17.20' \
    && .github/scripts/audit-diff.sh origin/main; echo "pinned exit=$? (expect 1, five lodash lines: GHSA-35jh-r3h4-6jhm high, GHSA-r5fr-rjxr-66jc high, three moderate)"
  cd - && git worktree remove --force /tmp/ad-probe
  ```
  The five-advisory figure is `observed` 2026-09-10 in a scratch package pinning `lodash@4.17.20` alone; in the worktree the count may be five or more if lodash's own transitive tree pulls more.
- **SATISFIES**: AC "`audit-diff` … goes red (failure) … green despite the backlog (expected) … green in under a minute (edge)".

### T6 · UPDATE `.github/workflows/ci.yml` — job `audit-diff`

- **IMPLEMENT**:
  ```yaml
    # No new advisories (#165). The backlog rides (66 at 800768f, observed
    # 2026-09-10: 2 critical, 47 high, 18 moderate, 1 low); a PR may not grow it.
    # Base = the target branch's tip, audited from its lockfile alone; head =
    # the PR merge ref actions/checkout gives us, i.e. what would land.
    audit-diff:
      if: github.event_name == 'pull_request'
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: pnpm/action-setup@v4
        - run: git fetch --no-tags --depth=1 origin "+refs/heads/${GITHUB_BASE_REF}:refs/remotes/origin/${GITHUB_BASE_REF}"
        - run: .github/scripts/audit-diff.sh "origin/${GITHUB_BASE_REF}"
  ```
- **GOTCHA**: `actions/checkout` is depth-1 on the merge ref; without the fetch, `origin/main` does not exist in the runner's clone. `pnpm/action-setup@v4` reads `packageManager` from the root `package.json` (10.33.2). No `pnpm install`: audit needs only the lockfile.
- **VALIDATE**: PR A's own run: job `audit-diff` green with the short-circuit line in its log (PR A does not touch the lockfile), under 60 s wall. Record the run URL in PR A's body.
- **SATISFIES**: AC edge case (unchanged lockfile, under a minute).

### T7 · Throwaway PR for the two remaining `audit-diff` cases

- **IMPLEMENT**: after PR A's `ci.yml` is on `main` (or on PR A's branch, opening the throwaway against that branch is not an option: `audit-diff` runs from the base's workflow file only on `main`; open it against `main` after merge). Branch `probe/audit-diff-165` off `main`: pin `lodash@4.17.20` in the root `package.json` `dependencies`, `pnpm install --lockfile-only`, commit, `gh pr create --draft`. Expect `audit-diff` red with the lodash lines and the PR left a draft (run URL 1). Push a commit reverting the pin; expect green and the PR flipped ready (run URL 2). Run URL 3 is PR A's own unchanged-lockfile run (T6). Then `gh pr close --delete-branch`.
- **GOTCHA**: the throwaway will be flipped ready by the second run; that is the flip working, not a problem. Close it in the same session.
- **VALIDATE**: the three run URLs, each with its job conclusion, pasted into PR A's body (the AC says the PR body; PR A is the one that carries S2).
- **SATISFIES**: AC failure + expected cases.

### T8 · CREATE `.claude/skills/piv-fix-review-findings/scripts/sonar-findings.sh` (mode 100755)

- **IMPLEMENT**: `sonar-findings.sh --pr N [--project KEY] [--no-diff-filter]`. `KEY` defaults to `sonar.projectKey` read from `sonar-project.properties` at the repo root (absent → usage error naming T11). Token: `SONAR_TOKEN` from the environment, sent as `-H "Authorization: Bearer $SONAR_TOKEN"`; unset → warn "no SONAR_TOKEN: anonymous, public projects only" and send no header. Host `https://sonarcloud.io`. Calls, all with `jq`:
  1. `GET /api/qualitygates/project_status?projectKey=K&pullRequest=N` → first line `Quality gate: <status>` and one line per condition with `status != OK`.
  2. `GET /api/issues/search?componentKeys=K&pullRequest=N&resolved=false&ps=500&p=<p>` until `p*500 >= paging.total` → `F<i> (<impacts[0].severity> <impacts[0].softwareQuality>, <type>) <path>:<line> — <rule>: <message>` where `<path>` is `component` with the `K:` prefix stripped; fall back to the legacy `severity` when `impacts` is empty.
  3. `GET /api/hotspots/search?projectKey=K&status=TO_REVIEW&ps=500&p=<p>` → `H<i> (<vulnerabilityProbability> probability, hotspot) <path>:<line> — <ruleKey>: <message>`. Cloud's `hotspots/search` has no `pullRequest` parameter (`observed` above), so this is the whole project's TO_REVIEW set…
  4. …filtered, together with the issues, to the PR's changed files: `gh pr view N --json files --jq '.files[].path'` (the repo the script runs in). This is also the skill rule "no touching findings outside the PR's diff", enforced before a model sees the list. `--no-diff-filter` skips it (public-project validation, or a project that is not this repo).
  Output is markdown: a `# Sonar findings for PR N (K): <n> issues, <m> hotspots (<f> of each dropped as outside the diff)` header, then the lines; nothing else on stdout. HTTP errors: print the API's `errors[].msg` and exit 2. Exit 0 with zero findings is a valid answer and says so.
- **PATTERN**: `record-gate.sh` header/`--help`; the findings shape is what `piv-fix-review-findings` §1 triages ("a description of issues", line 12) and matches the F-codes the output style uses.
- **GOTCHA**: never `echo` the token (the hook refuses the command text, and it must not land in a log). `api.sonarcloud.io` answers 403 for these paths (`observed`); use `sonarcloud.io/api`. PR analyses on Sonar Cloud are purged after inactivity, so the public-project validation picks a **current** PR key from the list endpoint rather than hardcoding `833`. `ps` above 500 is rejected. A hotspot the PR did not touch but whose file it did will appear; that is acceptable and the skill's diff rule (line-level) still applies to the fix.
- **VALIDATE** (no account needed):
  ```bash
  K=tarkovtracker-org_TarkovTracker
  N=$(curl -s "https://sonarcloud.io/api/project_pull_requests/list?project=$K" | jq -r '.pullRequests[0].key')
  env -u SONAR_TOKEN .claude/skills/piv-fix-review-findings/scripts/sonar-findings.sh --pr "$N" --project "$K" --no-diff-filter; echo "exit=$?"
  env -u SONAR_TOKEN .claude/skills/piv-fix-review-findings/scripts/sonar-findings.sh --pr 1 --project no_such_project_165 --no-diff-filter; echo "exit=$? (expect 2, message: Project 'no_such_project_165' doesn't exist)"
  ```
  Expected: the warning on stderr, `Quality gate: OK` (or the PR's real status), the header, zero or more `F`/`H` lines, exit 0. `observed` 2026-09-10 with `curl` by hand: PR `833` had `total: 0` issues, `0` hotspots, gate `OK` with four conditions.
- **SATISFIES**: AC "`piv-fix-review-findings` ingests a PR's Sonar findings through the script".

### T9 · UPDATE `.claude/skills/piv-fix-review-findings/SKILL.md`

- **IMPLEMENT**: new section between §1 and §2, "## 1.5 A Sonar-fed round (#165)":
  - Feed: the fenced command `.claude/skills/piv-fix-review-findings/scripts/sonar-findings.sh --pr {N}` (the executable reference, per the Phase 2.5 pattern); paste its output as the review input.
  - Rules, verbatim from the ticket: no `NOSONAR` or `// sonar-ignore`; never mark a finding false-positive or won't-fix in Sonar; touch only findings inside this PR's diff; never remove the feature to lower a count; at most **3** push-and-rescan cycles, then stop and hand to the human; the re-scan is CI's `sonar` job on the pushed commit, never a local scanner. A finding that is genuinely wrong gets one line in the PR body under `## Notes for the reviewer` ("Sonar disputed: `<rule>` at `<file:line>` — <why>"), not a suppression.
  - The report file rule (line 115) applies unchanged; add "round `sonar-<n>`" to the naming.
- **VALIDATE**: `grep -n 'sonar-findings.sh' .claude/skills/piv-fix-review-findings/SKILL.md` → one fenced hit; `grep -c NOSONAR` → 1.
- **SATISFIES**: AC "its prose carries the no-suppression rules".

### T10 · UPDATE `.claude/skills/piv-review-pr/SKILL.md` Phase 3

- **IMPLEMENT**: one sentence after "A red suite is a finding in itself." (line 40): "If the PR's `sonar` check is red, run `.claude/skills/piv-fix-review-findings/scripts/sonar-findings.sh --pr {N}` and fold each line in as a finding at Sonar's severity (#165)."
- **VALIDATE**: `grep -c 'sonar-findings.sh' .claude/skills/piv-review-pr/SKILL.md` → `1`.
- **SATISFIES**: gives S3 an executable entry point from the review side (memory: prose-only remedies do not fire).

### T11 · CREATE `sonar-project.properties`  (PR C, blocked on accounts)

- **IMPLEMENT**:
  ```properties
  sonar.projectKey=linardsb_taxi
  sonar.organization=linardsb
  sonar.sourceEncoding=UTF-8
  # Shipped source only: the same basis as CLAUDE.md's max-lines rule and the
  # 23,976-line figure in #165 (observed 2026-09-10 at 800768f).
  sonar.sources=apps/rider/src,apps/driver/src,apps/dispatch/src,services/api/src,packages/shared/src,db/src
  sonar.tests=apps/rider/src,apps/driver/src,apps/dispatch/src,services/api/src,services/api/test,packages/shared/tests,db/tests
  # A file is a source OR a test, never both: the scanner fails with "can't be
  # indexed twice" otherwise. Same patterns in both lines, per Sonar's own
  # colocated-tests example; exclusions win where they overlap inclusions.
  sonar.test.inclusions=**/*.spec.ts,**/*.spec.tsx,**/*.test.ts,**/*.test.tsx,services/api/test/**,packages/shared/tests/**,db/tests/**
  sonar.exclusions=**/*.spec.ts,**/*.spec.tsx,**/*.test.ts,**/*.test.tsx,services/api/test/**,packages/shared/tests/**,db/tests/**,**/node_modules/**,**/dist/**,**/.next/**,**/.expo/**,**/coverage/**,**/*.d.ts,**/scripts/**
  ```
  Replace `linardsb_taxi` / `linardsb` with whatever the Sonar organisation and project were created as (Q5).
- **GOTCHA**: sources and tests overlap by directory here (specs are colocated: `observed` 76 spec files under `services/api/src`, 41 `apps/driver/src`, 30 `apps/rider/src`, 27 `apps/dispatch/src`; `packages/shared/tests` 24, `db/tests` 3, `services/api/test` is the harness). Sonar's rule (`observed` on the excluding-files page, research pass): a file in both sets **fails the analysis**; the documented fix is the same pattern list in `sonar.exclusions` and `sonar.test.inclusions`, which is what the block above does. `sonar.sources`/`sonar.tests` take no wildcards, only paths. Test code, excluded files, comments and blank lines are outside the billed LoC, so the `**/scripts/**` exclusion keeps the count on the ticket's 23,976 basis (Sonar's own number will still differ: it counts statements its way). tsconfig discovery is automatic from the root; do not set `sonar.typescript.tsconfigPaths` unless the scan is slow (R2).
- **VALIDATE**: the `sonar` job on PR C; then on the Sonar project page read the LoC figure and write it into the runbook as `observed` (T14).
- **SATISFIES**: AC "Sonar's quality gate is a check on the PR"; the runbook's LoC line.

### T12 · UPDATE `.github/workflows/ci.yml` — job `sonar`; add it to `ready.needs`  (PR C)

- **IMPLEMENT**:
  ```yaml
    # SonarQube Cloud quality gate, keyed to the PR (#165). Free plan: PR
    # analysis exists only against main, so a PR against any other base is RED
    # here, not skipped — a skip would be a loophole (open against a branch,
    # retarget after ready). On push to main it refreshes the baseline the PR
    # analyses compare "new code" against.
    sonar:
      runs-on: ubuntu-latest
      steps:
        - name: Free-plan rule — PR analysis only against main
          if: github.event_name == 'pull_request' && github.base_ref != 'main'
          run: |
            echo "::error::Sonar PR analysis is only available against main on the free plan; retarget this PR to main (#165)."
            exit 1
        - uses: actions/checkout@v4
          with:
            fetch-depth: 0          # blame + new-code detection need history
        - uses: pnpm/action-setup@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: pnpm
        - run: pnpm install --frozen-lockfile   # type-aware TS rules read node_modules
        # v8.2.1 = latest release on 2026-09-10 (observed, research pass). PR key,
        # branch and base are auto-detected on GitHub Actions. The wait flag makes
        # THIS step fail on a red gate, which is what the ticket's second action
        # (sonarqube-quality-gate-action) does with one more moving part (D1).
        - uses: SonarSource/sonarqube-scan-action@v8.2.1
          env:
            SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          with:
            args: >
              -Dsonar.qualitygate.wait=true
              -Dsonar.qualitygate.timeout=600
  ```
  and `ready.needs: [check, audit-diff, sonar]`.
- **GOTCHA**: `args` since v6 is not full bash syntax: plain `-D` flags only. No `SONAR_HOST_URL` for Cloud. Do not merge PR C until `SONAR_TOKEN` exists and Automatic Analysis is off: Cloud fails CI-based analyses while Automatic Analysis is on ("these CI-based analyses will fail and cause a failure in your build process", `observed` on the automatic-analysis page), and a missing token makes every PR permanently draft. `pnpm install` here is not the gate's install: no build, no test. The timeout is raised from the 300 s default because the report is processed server-side after a 50k-line first upload; `expected`, drop back to the default once the first two runs show the real wait.
- **VALIDATE**: PR C's own run: `sonar` green, the Sonar check on the PR, `ready` flips. Record run URL and the analysis URL in PR C's body.
- **SATISFIES**: AC 1 and 2.

### T13 · Stacked-PR case  (PR C)

- **IMPLEMENT**: a throwaway pair: branch `probe/sonar-base-165` off `main` (push, no PR) and `probe/sonar-stacked-165` with one empty commit on top; `gh pr create --draft --base probe/sonar-base-165`. Expect the `sonar` job's first step red with the retarget message, the PR a draft. Close, delete both branches.
- **VALIDATE**: run URL in PR C's body, labelled the free-plan case.
- **SATISFIES**: AC "A PR that targets a non-main branch stays a draft".

### T14 · CREATE `docs/runbooks/pr-gate.md`  (PR A; S1 sections filled in PR C)

- **IMPLEMENT**: sections: §0 what the gate is (the four jobs and `ready`, one diagram line); §1 a PR is stuck in draft (read `gh pr checks N`; fix and push; re-run for a flake; the human bypass is the "Ready for review" button in the GitHub UI, and why the model has no path; what `--undo` means when a ready PR turns draft again); §2 `audit-diff` (the backlog figure with its run; what to do when a needed dependency carries an unfixable advisory: the button, plus a line in the PR body; `audit.ignore` is refused by the script); §3 Sonar (plan **Free** with its two limits as `observed` with the date read; where `SONAR_TOKEN` lives: repo Actions secret for CI, and for the local script an exported `SONAR_TOKEN` in the shell that starts Claude, never in a file the hook would refuse; the LoC figure Sonar reports, `expected` until PR C reads it; Automatic Analysis off); §4 the remediation loop pointer to the skill. Every figure labelled.
- **PATTERN**: `hetzner-deploy.md:1-22` (voice), `:121-143` (secret table), `:500-545` (gate table with named runs).
- **VALIDATE**: `grep -c -E 'observed|derived|expected' docs/runbooks/pr-gate.md` ≥ the number of digits-bearing claims (by eye; the figure scripts do not read runbooks).
- **SATISFIES**: AC "a runbook records: the Sonar plan and its two limits, where the token lives, the LoC figure, and what to do when a PR is stuck in draft."

### T15 · UPDATE `CLAUDE.md` line 83 table

- **IMPLEMENT**: add the row `| CI / the PR gate / a PR stuck in draft | \`docs/runbooks/pr-gate.md\` (#165) — \`.github/workflows/ci.yml\`, \`.github/scripts/audit-diff.sh\`, \`.claude/hooks/pre_tool_use.py\` |`.
- **VALIDATE**: `grep -c 'pr-gate.md' CLAUDE.md` → `1`.
- **SATISFIES**: the runbook is discoverable from the place every session loads.

---

## TESTING STRATEGY

There is no test framework for hooks, workflows or shell scripts in this repo, and none is added. Every part is validated by running it: the hook against payload files (T1), the scripts against known inputs (T5, T8), and the workflow against its own PRs (T6, T7, T12, T13). The `pnpm turbo run typecheck lint test build --force` gate still runs before each PR (nothing in it changes; a green gate proves no regression, not this feature).

### Unit Tests

- Hook: four payloads, three blocked with `#165` in stderr, one allowed (T1). Also the three pre-existing guards still fire: `cat .env` payload → exit 2 (`observed` today, keep it so).
- `audit-diff.sh`: same-lockfile → 0 with the short-circuit line; pinned lodash → 1 with the GHSA lines; an ignore-list edit → 1 with the suppression message (add `audit:\n  ignore:\n    - GHSA-35jh-r3h4-6jhm` to `pnpm-workspace.yaml` in the probe worktree and rerun).
- `sonar-findings.sh`: public project, no token → exit 0 with header; bad project key → exit 2 with the API's message (`observed`: `Project '…' doesn't exist`).

### Integration Tests

The live PR runs are the integration tests. Name them in each PR body with the run URL and the job conclusion:

| Case | Where |
|---|---|
| Draft on open, flipped on green | PR A's own run (Level 4 step 1) |
| Red leaves/returns draft | T7's first run |
| Unchanged lockfile, under a minute | PR A's `audit-diff` job |
| New advisory red, revert green | T7 |
| Sonar check on the PR, keyed to N | PR C |
| Non-main base red | T13 |

### Edge Cases

- **Re-run after an undo**: the `ready` job has no `draft` condition, so a re-run flips it (T4 gotcha b). Verified by T7's second run if the first is re-run rather than pushed; otherwise `expected`.
- **Push while a run is in flight**: `concurrency` cancels the old run; `!cancelled()` keeps its `ready` job from touching the PR. `expected`; observe on PR A by pushing twice within a minute and checking the first run shows cancelled with `ready` skipped.
- **Push to `main`**: `audit-diff`, `ready` skipped; `check` (and `sonar`, PR C) run. Observe on the merge of PR A.
- **`workflow_dispatch`**: no PR; `ready` skipped by the event condition. `expected`.
- **Registry outage during `audit-diff`**: red with the not-JSON message, not green (T5 step 5). Not reproducible on demand; `expected`.
- **A PR that adds an ignore entry**: red at step 2 before any audit runs (unit test above).
- **A dependency removed on the PR** (fewer advisories): green; `comm -13` only lists additions.
- **Sonar gate with no coverage report**: `observed` on the public project that its gate showed only four conditions (duplication, bugs, smells, vulnerabilities) with no coverage condition; if this repo's default gate does include `new_coverage`, the first PR C run is red and the fix is Linards editing the gate in Sonar's UI, not a model (R3).

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
bash -n .github/scripts/audit-diff.sh .claude/skills/piv-fix-review-findings/scripts/sonar-findings.sh
command -v shellcheck >/dev/null && shellcheck .github/scripts/audit-diff.sh .claude/skills/piv-fix-review-findings/scripts/sonar-findings.sh
uv run --with pyyaml python -c 'import yaml; yaml.safe_load(open(".github/workflows/ci.yml")); print("ci.yml parses")'
uv run .claude/hooks/pre_tool_use.py < /dev/null; echo "hook on empty stdin exit=$? (expect 0: fails open)"
git ls-files -s .github/scripts/audit-diff.sh .claude/skills/piv-fix-review-findings/scripts/sonar-findings.sh | awk '{print $1, $4}'   # expect 100755 both
```

### Level 2: Unit Tests

T1, T5 and T8's VALIDATE blocks, verbatim.

### Level 3: Integration Tests

```bash
.claude/skills/piv-create-pr/scripts/record-gate.sh --clean   # the repo gate, unchanged; must stay green
```
Then the live PR runs in the table above.

### Level 4: Manual Validation

Every step is performable with what this ticket ships and the repo's live GitHub.

1. **O1 flip.** From the feature branch run `piv-create-pr`. `gh pr view --json isDraft --jq .isDraft` → `true`. `gh run watch` the CI run (`expected` about 6 min: `check` `observed` 313–361 s over the last 8 runs; `ready` starts after it). Then `isDraft` → `false`. Record the run URL.
2. **Hook.** T1's VALIDATE block; then, in the same session, ask Claude to run `gh pr ready <N>` and confirm the refusal text names #165.
3. **audit-diff.** T6 (PR A's run) and T7 (throwaway, two runs). Three URLs in PR A's body.
4. **Sonar (PR C).** T12's run; the "SonarCloud Code Analysis" check appears on the PR; the analysis URL contains `pullRequest=<N>`. T13's stacked case. Read the LoC figure off the Sonar project page and write it into the runbook.
5. **Sonar-fed loop (after PR C).** On any later PR with a red `sonar` check, run `sonar-findings.sh --pr N`, fix one finding, push, confirm the re-scan is CI's and the PR flips when green.

### Level 5: Additional Validation (Optional)

`gh pr checks <N> --watch` shows the four checks and their timing; useful for the "under a minute" claim on `audit-diff`.

---

## ACCEPTANCE CRITERIA

- [ ] A PR opened by `piv-create-pr` is a draft; green `check` + `audit-diff` (+ `sonar` after PR C) marks it ready; red leaves or returns it to draft with the failing check on the PR (T1–T4, T7).
- [ ] Sonar's quality gate is a CI job and a check on the PR, keyed to the PR number; a non-main base is red (T11–T13). **Owed by PR C after the three prerequisites; O1/S2/S3 do not wait for it.**
- [ ] `audit-diff`: pinned-advisory PR red; pin removed green despite the 66-advisory backlog; unchanged lockfile green in under a minute; the three run URLs are in PR A's body; throwaway PR closed and branch deleted (T5–T7).
- [ ] `gh pr ready` (and its GraphQL mutation, and `--undo`) from a Claude session is refused with a message naming #165 (T1).
- [ ] `piv-fix-review-findings` ingests Sonar findings through `sonar-findings.sh`, and its prose carries the six no-suppression rules; `piv-review-pr` calls the script when `sonar` is red (T8–T10).
- [ ] `docs/runbooks/pr-gate.md` records the Sonar plan and its two limits, where the token lives, the LoC figure Sonar reports (`expected` until PR C), and the stuck-in-draft procedure including the human bypass (T14, T15).
- [ ] Every figure in each PR body carries `observed`/`derived`/`expected` and names its run; `inherited-figures.sh` run per Phase 2.5.
- [ ] The repo gate (`pnpm turbo run typecheck lint test build --force`) is green on each PR; nothing in it changed.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order (T1–T10, T14–T15 for PRs A and B; T11–T13 for PR C)
- [ ] Each task validation passed immediately
- [ ] Level 1–4 run; the live-run table filled with URLs
- [ ] Throwaway PRs closed, probe branches deleted (`git ls-remote --heads origin 'probe/*'` empty)
- [ ] Acceptance criteria all met, or owed to PR C by name
- [ ] Follow-up issue filed for the advisory backlog

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Q1 — `--undo` on red (assumed yes).** The ticket says a red run "leaves" a draft; this plan also converts a *ready* PR back to draft when a later push goes red, so "ready" always means "this head passed". Cost: a flaky suite (memory: the payments/customers integration flake under the full run) re-drafts a PR until a re-run is green. Worst case if **not** included: a PR flipped ready on head A stays ready while head B is red, and a human merges B on the strength of A. Strike the `--undo` branch in T4 if you want the ticket's literal one-way flip.
- **Q2 — `concurrency` cancel-in-progress on PRs (assumed yes).** Closes the stale-green race in T4's comment. Worst case if not included: head A's green run flips the PR ready after head B was pushed; with Q1 the state self-corrects when B finishes, without Q1 it does not.
- **Q3 — suppression guard in `audit-diff.sh` (assumed yes).** The ticket's rule is "no advisory id the base does not report"; a same-PR `audit.ignore` entry defeats it. Worst case if not included: a model adds a vulnerable dependency and its GHSA to the ignore list in one commit and the job is green.
- **Q4 — PR split (assumed A = O1+S2, B = S3, C = S1).** The ticket allows one per part; A bundles the two `ci.yml` edits so they are reviewed as one workflow.
- **Q5 — Sonar organisation and project key.** Placeholders `linardsb` / `linardsb_taxi` in T11; whatever Linards creates wins. Sonar's GitHub import names the key `<org>_<repo>` by default.
- **Q6 — where the local `SONAR_TOKEN` lives for S3.** Assumed: exported in the shell that starts Claude (the Bash tool inherits it), documented in the runbook. The hook refuses any command text that reads a `.env`-named file, so a dotfile is not an option for the script; the macOS keychain (`security find-generic-password … -w`) is the alternative if an exported secret in every shell reads worse.
- **A1 — draft PRs are available on this private repo.** `observed` 2026-09-10: probe PR #166 opened with `--draft`, `isDraft: true`; `gh pr ready` → exit 0, `isDraft: false`; second `gh pr ready` → exit 0 with "already"; `--undo` → exit 0, `isDraft: true`; closed with `--delete-branch`. The ticket's premise held without a plan upgrade.
- **A2 — `pull_request` runs use the PR's copy of `ci.yml`.** Standard GitHub behaviour; PR A validates itself. `expected` until PR A's run.
- **A3 — the Sonar plan facts** were read twice on 2026-09-10 (the ticket, and this plan's research pass, which quotes the subscription-plans page verbatim in CONTEXT REFERENCES). The implementer re-reads the two Sonar pages on the day PR C is written, because both are pricing pages and pricing pages move.
- **D1 — `sonar.qualitygate.wait=true` instead of `sonarqube-quality-gate-action`.** The ticket names the action; the scanner flag is documented to "fail the pipeline if the quality gate fails", which is the same guarantee from one pinned action instead of two. If a second step is wanted for its separate check line on the PR, `SonarSource/sonarqube-quality-gate-action@v1.2.1` after the scan step is the drop-in (exits 1 on ERROR, WARN and timeout).
- **A4 — a draft PR fires `pull_request` runs.** GitHub's docs have no sentence either way (research pass); `observed` 2026-09-10: draft PR #166 started CI run 34462897943 on open. Without this the whole design is moot, so it is recorded as observed, not assumed.
- **A5 — hotspot scoping.** Cloud's `hotspots/search` ignores `pullRequest` (T8). The script filters by the PR's file list, so a hotspot in a touched file that predates the PR can appear in the list; the skill's diff rule then applies at line level. Acceptable; noted so nobody "fixes" it by scoping to the PR's new lines and losing hotspots the PR introduced in existing files.

## NOTES (open canvas)

**What was actually observed this session (2026-09-10, `800768f`)**

| Fact | Provenance |
|---|---|
| `pnpm audit --prod --json`: 66 advisories over 1,013 prod deps; `metadata.vulnerabilities` = critical 2 · high 47 · moderate 18 · low 1; exit 1; 1.38 s wall | `observed`, full checkout |
| Same 66 ids from a directory holding only `pnpm-lock.yaml` (from `origin/main`); with `pnpm-workspace.yaml` added, still 66; without `--prod`, 78 | `observed`, scratch dirs |
| Base (`origin/main`) vs head id sets identical (`comm` empty); lockfile unchanged on this branch | `observed` |
| Pinning `lodash@4.17.20` alone adds 5 ids: GHSA-35jh-r3h4-6jhm (high), GHSA-r5fr-rjxr-66jc (high), GHSA-29mw-wpgm-hmr9, GHSA-f23m-r3pf-42rh, GHSA-xxjr-mmjv-4gpg (moderate) | `observed`, scratch package |
| Shipped `.ts/.tsx` under `apps/ services/ packages/ db/`, spec/test/scripts/`.d.ts`/dist/.next/.expo dropped, blank and `//`/`/*`/`*` lines removed: **23,976** lines over 390 files; 53,599 with spec and test files kept | `observed`; equals the ticket's figure, re-derived with the command in this session's log |
| Last 8 `ci.yml` runs: 313–361 s each (ids 34354124913 … 34460135710) | `observed`, `gh run list` |
| Actions default workflow permission: `read` | `observed` |
| Hook today: `gh pr ready` payload → exit 0; GraphQL mutation payload → 0; `cat .env` payload → 2 | `observed` |
| Draft PR support, `gh pr ready` idempotency, `--undo`: PR #166 | `observed`; its CI run 34462897943 started on open, which is the evidence for A4 (a draft fires `pull_request`) and nothing else: the PR was closed before the run finished |
| pnpm 10.33.2 `audit` reads only `pnpm-lock.yaml` (`AUDIT_NO_LOCKFILE` otherwise), keys advisories by numeric id with `github_advisory_id` beside, exits 1 iff any advisory (`--json`); pnpm 11 rewrote audit (GHSA-keyed bulk endpoint, no `cves`, nullable `patched_versions`) | `observed` in pnpm's source at tag `v10.33.2` and the audit docs (research pass); re-observe T5's shape on any pnpm major bump |
| Sonar Cloud API shapes and the `api.sonarcloud.io` 403 | `observed` against a public project |
| `gh` 2.83.1 · pnpm 10.33.2 · node 20.20.2 · uv 0.9.18 · jq 1.7.1 | `observed` |

**Why `ready` reads `needs.*.result` instead of relying on `needs` alone.** A job with plain `needs:` runs only when every dependency succeeded, so the undo branch could never execute. `!cancelled()` runs it on failure too but not when the run itself was cancelled by `concurrency`, which is the one case where the *old* run must stay silent.

**Why the base audit uses the lockfile alone.** `git archive` of every manifest was the first draft; the lockfile-only dir gave the same 66 ids, so the script does the smaller thing. If a future pnpm needs the manifests, the symptom is a parse error at step 5, which is red, not green.

**Why not gate `sonar` on the token's presence.** `secrets.*` is not available in a job-level `if`, and a skip is the loophole the ticket names. The ordering (prerequisites → PR C) is the control.

**R1 — Sonar free-plan facts are pricing-page facts.** The ticket read them on 2026-09-10; PR C re-reads them. If PR analysis against `main` turns out to need the Team plan, the decision in the ticket ("above 50k it is the Team plan") becomes "for PR analysis at all it is $34/month" and Linards decides; the rest of this plan does not move.

**R2 — Sonar analysis time on this tree.** `expected` 3–8 min for 24k source + 30k test lines with type-aware TS rules; unknown until PR C. If it dominates the wall clock, `sonar.javascript.node.maxspace` and dropping `pnpm install` (losing type-aware rules) are the two knobs, both Linards' call.

**R3 — the default quality gate and coverage.** No coverage is uploaded. On the public project the gate showed no coverage condition, which suggests "no data" is not a failure; if this project's default gate differs, PR C's first run is red on `new_coverage` and the fix is a gate edit in Sonar's UI by a human.

**Rejected: a `ready_for_review` trigger.** Not needed; the flip is a side effect of the existing `pull_request` run, and `GITHUB_TOKEN` events start no run anyway.

**Rejected: refusing `gh pr create` without `--draft` in the hook.** The skill is the only thing that opens PRs in a session; a hook that pattern-matches `gh pr create` would also refuse the throwaway probes this plan needs. If a non-draft PR ever appears from a session, that is the moment to add it.

## AMENDMENTS

- 2026-09-10 (PR #167's first run) — **T4's token assumption was wrong.** `github.token` with `pull-requests: write` cannot run the draft mutations: `observed` run 34471269249, `ready` red with `GraphQL: Resource not accessible by integration (markPullRequestReadyForReview)` while the three gate jobs were green. The job now reads `secrets.PR_READY_TOKEN`, a PAT of Linards' with pull-request write on this repo (runbook §1.1); no secret means `ready` red and the PR a draft. The `permissions: pull-requests: write` block is gone with it. The same run gave the first live figures: `check` 198 s, `audit-diff` 7 s (short-circuit), `codeql` 82 s with zero open alerts on the PR ref.
- 2026-09-10 (same session, after the Sonar removal) — **CodeQL replaces Sonar, by Linards.** CodeQL is unavailable to a private user-owned repo (`observed`: code-scanning endpoints answered 403 "not enabled"; the docs require a Code Security licence, $30 per active committer per month on `github.com/features/security`, purchasable only by Team/Enterprise organisations; the CodeQL CLI licence forbids CI use on non-open-source code without one). Linards chose to **make the repo public** over an org licence, Semgrep, or dropping SAST. Before the flip a full-history scan over 15 refs and 342 commits found no secret, no dotenv file, no key; it did find two colleagues' emails and the anketa Apps Script URL, which Linards accepted (tell them; archive the Apps Script deployment). `gh repo edit --visibility public` ran in this session (`observed`: `visibility: public`, default-setup `not-configured`, Actions free on public repos per the billing page). What replaces S1/S3 in PR A: a `codeql` job (`github/codeql-action` v4, `javascript-typescript`, `build-mode: none`, `paths-ignore` for the fenced anketa and build outputs, upload always) whose gate step is `.github/scripts/codeql-gate.sh`, applying the audit-diff rule to alerts (the PR may not add an open high/critical or error-level alert the base does not carry; dismissals honoured because dismissed is not open); `ready.needs` is `[check, audit-diff, codeql]`; hook guard 5 refuses alert dismissal through the API and `lgtm`/`codeql` suppression comments in shipped source; `piv-fix-review-findings` §1.5 carries the feed command and the six no-suppression rules; `piv-review-pr` Phase 3 points at it; the runbook's §3 is CodeQL and §4 the fix loop. A SARIF-reading gate was written first and discarded: it could not see a human's dismissal, so one unfixable false positive would have blocked every PR. Known first-run state: the base has no analysis until a push to `main` runs the job, so PR A's own `codeql` gate treats every open alert as new; the human bypass is the path for that one PR if the tree has any.
- 2026-09-10 (after PR A's implementation, before its PR) — **Sonar removed from the ticket by Linards.** S1 (T11–T13, PR C) and S3 (T8–T10, PR B) are dropped; PR A (O1 + S2, T1–T7, T14–T15) is the whole of #165. `ready.needs` stays `[check, audit-diff]`; the runbook has no Sonar section; AC 2, AC 5 and the Sonar clauses of AC 6 are void; the `sonar-findings.sh` and `sonar-project.properties` files are never created. The body above is left as written for the record.
- 2026-09-10 (same session, before first execution) — research pass folded in: scan action pinned to v8.2.1 with `sonar.qualitygate.wait` (D1); `sonar.exclusions` now carries the spec patterns because Sonar fails on a file that is both source and test; `sonar-findings.sh` gained `--no-diff-filter` and a changed-files filter because Cloud's `hotspots/search` has no `pullRequest` parameter; Bearer auth; A4/A5 added.
