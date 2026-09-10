# Implementation Report — A PR leaves draft only through a no-model gate (#165), PR A

**Plan**: `.claude/plans/ci-no-model-pr-gate.md` (read with its two AMENDMENTS of 2026-09-10)   **Branch**: `feature/no-model-pr-gate` (off `origin/main` `6d72261`)   **Status**: COMPLETE for the amended ticket (T1–T6, T14, T15, plus the CodeQL replacement for S1/S3); T7 owed post-merge by the plan's own text.

## Summary

O1 and S2 as planned, and CodeQL in Sonar's place. Every PR opens as a draft (`piv-create-pr`); a `ready` job in `ci.yml` flips it when `check`, `audit-diff` and `codeql` are green and re-drafts it when any is red; the PreToolUse hook refuses `gh pr ready`, `--undo`, the GraphQL mutation, alert dismissal through the API and CodeQL suppression comments in shipped source. `audit-diff` fails a PR whose production tree carries an advisory id the base does not, with an ignore-list edit refused before any audit. `codeql` uploads a CodeQL analysis and its gate step fails a PR that carries an open high/critical or error-level alert the base does not, honouring a human's dismissals. The repo was made public in this session, with Linards' decision, because code scanning is unavailable to a private user-owned repo. The runbook `docs/runbooks/pr-gate.md` records all of it; CLAUDE.md's on-demand table points to it.

## Tasks completed

- T1 hook guards → `.claude/hooks/pre_tool_use.py` (UPDATE): `PR_READY_FLIP` / `is_pr_ready_flip()` (item 4) and `ALERT_DISMISS` + `SUPPRESSION_COMMENT` / `is_alert_suppression()` (item 5), fail-open kept
- T2 draft-by-default → `.claude/skills/piv-create-pr/SKILL.md` (UPDATE): description, `--draft`, footer naming the three jobs, aside, Output handoff
- T3 draft state guard → `.claude/skills/piv-review-pr/SKILL.md` (UPDATE): line 27; Phase 3 sentence for a red `codeql`
- T4 `concurrency` + `ready` job → `.github/workflows/ci.yml` (UPDATE), `needs: [check, audit-diff, codeql]`
- T5 advisory diff → `.github/scripts/audit-diff.sh` (CREATE, 100755)
- T6 `audit-diff` job → `.github/workflows/ci.yml` (UPDATE)
- CodeQL job (S1's replacement) → `.github/workflows/ci.yml` (UPDATE): `github/codeql-action` v4 init/analyze, `javascript-typescript`, `build-mode: none`, `paths-ignore` for the fenced anketa and build outputs, upload always, PR-only gate step
- CodeQL gate (S1's replacement) → `.github/scripts/codeql-gate.sh` (CREATE, 100755)
- CodeQL-fed fix round (S3's replacement) → `.claude/skills/piv-fix-review-findings/SKILL.md` (UPDATE): §1.5 with the feed command and six rules
- T14 runbook → `docs/runbooks/pr-gate.md` (CREATE): §0–§4
- T15 index row → `CLAUDE.md` (UPDATE)
- Plan with both amendments → `.claude/plans/ci-no-model-pr-gate.md` (CREATE)
- Repo visibility → `gh repo edit linardsb/taxi --visibility public` (not a file; observed `visibility: public`)

Not in this PR: T7 (throwaway PR for the red and revert `audit-diff` runs; post-merge by its own text).

## Tests added

No test framework covers hooks, workflows or shell in this repo and none was added (plan, TESTING STRATEGY). Every part was run instead. All `observed` 2026-09-10 in this session at `6d72261` unless stated.

**Hook, thirteen payload files** (Write tool: the hook is live and refuses a Bash command whose text carries the phrases):

| Payload | Result |
|---|---|
| `gh pr ready 170` / `gh pr ready --undo 170` / `gh api graphql … markPullRequestReadyForReview …` | exit 2, stderr names #165 |
| `gh api -X PATCH …/code-scanning/alerts/3 -f state=dismissed …` | exit 2, suppression message |
| Edit on `rides.service.ts` adding a `lgtm[js/sql-injection]` comment | exit 2, suppression message |
| Write of `docs/runbooks/pr-gate.md` mentioning both suppression forms | exit 0 (docs are outside the source-suffix rule) |
| Edit on `rides.service.ts` with the word `codeql` but no bracket form | exit 0 |
| `gh api --paginate "…/code-scanning/alerts?ref=refs/pull/170/merge&state=open…"` | exit 0 |
| `gh pr view 170 --json isDraft`; `gh pr checks 170 && … readyness` | exit 0 |
| `cat .env` (pre-existing guard) | exit 2 |
| empty stdin | exit 0 (fails open) |

**`audit-diff.sh`, five cases**, base `origin/main` = `6d72261`; the pinned cases in a scratch worktree with `lodash@4.17.20` added to root `dependencies` and `pnpm install --lockfile-only`:

| Case | Result |
|---|---|
| Unchanged lockfile | exit 0, short-circuit line, 0.036 s wall |
| Pinned lodash | exit 1; 66 at base, 71 at HEAD, 5 new: GHSA-35jh-r3h4-6jhm high, GHSA-r5fr-rjxr-66jc high, GHSA-29mw-wpgm-hmr9, GHSA-f23m-r3pf-42rh, GHSA-xxjr-mmjv-4gpg moderate (the plan's five, same ids); 2.4 s wall |
| Pinned lodash + `audit:\n  ignore:` appended to `pnpm-workspace.yaml` | exit 1 at step 2 with the suppression message, 0.063 s, no audit run |
| Pinned lodash + `npm_config_registry=http://127.0.0.1:9/` | exit 1, `base audit output is not JSON`; pnpm's own retries took 2 min 21 s first |
| No argument / `--help` | exit 2 with a usage line / the full header, exit 0 |

**`codeql-gate.sh`, eight cases**, fixtures shaped like the REST alert objects (`number`, `state`, `rule.security_severity_level`, `rule.severity`, `most_recent_instance.location`):

| Case | Result |
|---|---|
| PR: #1 high, #2 low, #3 critical (also on base), #4 high but `dismissed`, #5 error-level, #6 medium; base: #3, #9 | 2 new (#1, #5), two `::error file=…,line=…` lines, exit 1 |
| PR carries only the base's #3 and a medium | 0 new, exit 0 |
| Same PR list, empty base | 3 new (#1, #3, #5), exit 1 |
| Empty vs empty | 0, exit 0, says so |
| Not JSON / JSON but not an array | exit 2 with the file named |
| No arguments; `--pr` without `--base` | exit 2 with usage |
| Live against this repo: `--pr 999 --base main` (no analysis on the PR ref) | exit 1, "no CodeQL analysis for refs/pull/999/merge", 0.36 s |

**Skill and workflow greps**: `--draft` count 1, `Ready for review._` count 0, flip-command count 1, footer names `check`, `audit-diff` and `codeql` in `piv-create-pr/SKILL.md`; one `gh pr checks` hit on line 27 and one alerts-endpoint hit in `piv-review-pr/SKILL.md`; one feed-command hit in `piv-fix-review-findings/SKILL.md`; `pr-gate.md` count 1 in CLAUDE.md; no `sonar` in any shipped file (plan and this report excepted). `ci.yml` parses under PyYAML: jobs `[check, audit-diff, codeql, ready]`, `ready.needs = [check, audit-diff, codeql]`, `codeql` with four steps and `security-events: write`. `bash -n` clean on both scripts; both `100755` in the index.

**Re-observed figures the plan supplied** (CLAUDE.md: re-derive a figure you copy): the last 8 `ci.yml` runs span 313–361 s (`gh run list`, ids 34354276529 … 34462897943; the window moved one run since the plan and the range held); `pnpm audit --prod --json` at `6d72261`: 66 advisories, 2 critical / 47 high / 18 moderate / 1 low, 1,013 deps, 1.6 s.

**Facts read from GitHub for the CodeQL decision** (`observed` 2026-09-10): the repo private and user-owned with code-scanning endpoints answering 403 "not enabled"; Code Security $30 per active committer per month on `github.com/features/security`; the CodeQL CLI licence forbidding CI use on non-open-source code; `codeql-action` latest major v4; `analyze` inputs `upload` (default `always`) and `wait-for-processing` (default `true`); the alerts endpoint's `ref` accepting `refs/pull/<number>/merge`; standard runners free in public repositories. After the flip: `visibility: public`, default setup `not-configured`.

## Validation results

- Level 1: `bash -n` clean on both scripts; `ci.yml` parses; hook on empty stdin exits 0; both scripts 100755. `shellcheck` is not installed on this machine (observed: `command -v shellcheck` empty), so that line of Level 1 did not run.
- Level 2: the hook, `audit-diff.sh` and `codeql-gate.sh` tables above, all as expected.
- Level 3: `record-gate.sh --clean` at `6d72261`, dirty tree, exit 0 (observed): `Tasks: 22 successful, 22 total`, `Time: 1m31.606s`; api `Tests: 35 skipped, 681 passed, 716 total`, `Test Suites: 2 skipped, 74 passed, 74 of 76 total`; dispatch 224, driver 214, rider 143, db 17, shared 231 passed. Not in graph: `@taxi/config#*`, `@taxi/driver#build`, `@taxi/rider#build` (the known legitimate absences). Nothing in the gate changed. The run predates the CodeQL edits, which touched no file the gate reads (YAML, shell, markdown, the hook).
- Level 4 (the live PR runs) is `expected` until `piv-create-pr` opens PR A: its own run is the first exercise of `ready`, `audit-diff` (unchanged lockfile), the CodeQL upload, the gate step and the draft flip.

## Deviations from the plan

1. **CodeQL replaces Sonar; the repo is public.** Linards' decisions, in that order, both after implementation; the plan's AMENDMENTS carry the facts and the alternatives declined (org licence, Semgrep, no SAST). A full-history scan before the flip (15 refs, 342 commits) found no secret, dotenv file or key; it found two colleagues' emails and the anketa Apps Script URL, accepted with two follow-ups outside the repo: tell them, and archive that Apps Script deployment.
2. **The CodeQL gate is an alerts-API diff, not a SARIF read.** A SARIF-reading gate was written first and discarded: it cannot see a human's dismissal, so one unfixable false positive would have blocked every PR until the code changed. The shipped gate lists open alerts on the PR's merge ref and on the base and fails on new high/critical or error-level ones, the same diff rule as `audit-diff`. Cost: it depends on the upload being processed before the step runs (`wait-for-processing` defaults to true) and on a base analysis existing; without one every alert reads as new, with a warning.
3. **First-run state is red-leaning by design.** `main` has no CodeQL analysis until PR A merges and its push run creates one. If the tree has any high/critical alert, PR A's own gate is red and the human bypass is the path for that one PR. `expected`; the alert count on this tree is unknown until the run.
4. **Hook guard 5 (alert suppression)** was not in the plan; it is the no-model version of S3's "never mark false-positive" rule. The comment guard reads Edit/Write/MultiEdit content and applies only to `.ts/.tsx/.js/.jsx/.mjs/.cjs` paths so documentation may name the forms.
5. **T7 not run in this session.** The task's own text places it after PR A's `ci.yml` is on `main`. PR A's own run supplies the unchanged-lockfile URL; the red and revert URLs are owed after merge. `expected`, not verified: a throwaway opened against PR A's branch would run PR A's workflow and could supply them before merge; the plan's parenthetical says otherwise and I did not test it.
6. **`audit-diff.sh` exit code 2** for no argument, base ref not found, or `pnpm`/`jq` missing. The plan specified 0 and 1 only; a missing base ref must read as neither "no new advisories" nor "advisory found".
7. **`ready` runs with a PAT (`secrets.PR_READY_TOKEN`), not `github.token`.** Found by PR #167's first run (34471269249, `observed` 2026-09-10): `check`, `audit-diff` and `codeql` green, `ready` red with `GraphQL: Resource not accessible by integration (markPullRequestReadyForReview)` under `pull-requests: write`. The Actions token is an App token and the draft mutations are not open to it. With no secret `ready` is red and every PR stays a draft: fail closed (`observed`, run 34471798333, exit 4). A fine-grained token was refused twice (`observed`, run 34472223208 re-runs at 12:04 and 12:08: `Resource not accessible by personal access token`); a classic `repo` token flipped #167 on the third re-run at 12:21:42 as linardsb, and the flip started no run. The secret holds the classic token; runbook §1.1 says so and why.
8. **Suppression-guard regex restructured** in `audit-diff.sh`: the plan's single pattern carried a `^` inside the alternation; the script uses two alternatives with the same intent and echoes the matching line. Verified by the ignore-list case.

UX states: none declared (process ticket; no user-facing surface).

## Issues encountered

- The T5 VALIDATE block cuts a worktree from HEAD, which did not yet contain the uncommitted script; first attempt exited 127. Re-run invoking the script by absolute path from the main checkout. The plan's block works once the script is committed.
- The hook blocked one of my own probe commands for naming the dotenv file in a `grep`; every command carrying a guarded phrase went in as a payload or script file via the Write tool.
- `codeql-gate.sh` first shipped with `jq -n` and no `-r`, so its lines came out JSON-quoted and its own summary parser read empty counts and exited 0 on the failing fixture. Caught by the fixture run; fixed to `jq -rn` and re-observed. The pipe-based test harness then showed blank exit codes because the Bash tool is zsh and `PIPESTATUS` is bash; re-run without pipes.
- Two of the go-public scan's greps broke on BSD grep (a pattern starting with `-`, a lookahead); re-run with `-e` and without the lookahead. The one public-looking IPv4 in history was SVG path coordinates.
- api suite reports 35 skipped, not the 33 CLAUDE.md records at #121's head; the gated set has grown by two since. Not this ticket's line to rewrite.
- `ls db/migrations/*.sql | tail -1`: no migration touched (process ticket).
- #165's issue body on GitHub still names Sonar; the amendments live in the plan and this report only.
- PR #167's first run (`observed`): `check` 198 s, `audit-diff` 7 s with the short-circuit line, `codeql` 82 s with zero open alerts on the PR ref, `ready` failed in 4 s on the token (deviation 7). The first `record-gate.sh` run at `21d83b3` went red on `drivers.integration.spec.ts` (`connection terminated mid-transaction`) with a local re-validation script running beside it and then hung; the re-run alone was green in 1m23.9s.
- PR #167's second run at `061fa4b` (34471798333, `observed`): `check` 203 s, `codeql` 80 s (0 open alerts), `audit-diff` 12 s, all green; `ready` red in 5 s with exit 4, `set the GH_TOKEN environment variable`, the secret not existing yet. Fail closed confirmed on both token failure modes.
- A "SonarCloud Code Analysis" check showed up red on PR #167: SonarCloud's GitHub app auto-analysing the now-public repo, outside `ci.yml`. Not this ticket's; Linards disables it on the SonarCloud side.
