# Runbook — the PR gate (#165)

Every PR opens as a **draft** and leaves draft only when CI says so. No model
has a path to the flip: the PreToolUse hook refuses `gh pr ready` (and its
GraphQL mutation, and `--undo`) in every Claude session, and `ci.yml`'s
`ready` job is the one thing that runs it. A human keeps exactly one bypass,
the **Ready for review** button in the GitHub UI, and §1 says when to press it.

Why this exists: every "STOP if red" in the PIV skills is prose a model obeys,
and the ledger of prose checks failing is long (#87, #107, the CLAUDE.md gate
line, three times). Branch protection is the normal answer and is unavailable
on this plan (`observed` in #165, 2026-09-10: HTTP 403 from the
branch-protection and rulesets APIs). CI is the no-model step the repo has.

Where a figure appears it is labelled `observed` (a run produced it — named),
`derived` (arithmetic shown, condition stated) or `expected` (not yet run),
per the root `CLAUDE.md` rule.

Sources of truth this document defers to: `.github/workflows/ci.yml` (the
jobs), `.github/scripts/audit-diff.sh` (the advisory diff),
`.github/scripts/codeql-gate.sh` (the alert diff),
`.claude/hooks/pre_tool_use.py` (the refusals), and the plan
`.claude/plans/ci-no-model-pr-gate.md`.

## 0 · What the gate is

```
push ──▶ ci.yml ──▶ check ──────┐
                ├─▶ audit-diff ─┼─▶ ready ──▶ gh pr ready          (all green)
                └─▶ codeql ─────┘        └──▶ gh pr ready --undo   (any red)
```

| Job | Runs on | What it proves |
|---|---|---|
| `check` | push to `main`, every PR | `pnpm turbo run typecheck lint test build` green with Redis present; unchanged by #165 |
| `audit-diff` | every PR | HEAD's `pnpm audit --prod` reports no advisory id the base does not (§2) |
| `codeql` | push to `main`, every PR | The PR's CodeQL analysis has no open high/critical (or error-level) alert the base does not (§3). On `main` it is the baseline only |
| `ready` | every PR, after the jobs above | Flips the PR to ready when every `needs` result is `success`; converts it **back to draft** and fails when any is `failure`, `cancelled` or `skipped` |

Two properties of `ready` that matter when reading a PR:

- **"Ready" means "this head passed."** A later push that goes red re-drafts
  the PR (`gh pr ready --undo`), so a green tick on an old head cannot carry a
  red one to merge.
- **One run per PR head.** `concurrency` cancels the in-flight run when a new
  head is pushed, and the cancelled run's `ready` job is skipped
  (`!cancelled()`), so an old run never touches the PR. Pushes to `main` are
  never cancelled.

Time from push to flip: about six minutes when green (`check` `observed`
313–361 s over the 8 `ci.yml` runs 34354276529 … 34462897943, read with
`gh run list` on 2026-09-10; `ready` starts after the slowest `needs` job and
takes seconds). `audit-diff` and `codeql` run beside `check`, not after it, so neither adds
to the wall clock: `observed` on PR #167's first run (34471269249,
2026-09-10) `check` 198 s, `codeql` 82 s, `audit-diff` 7 s (unchanged
lockfile, short-circuit), run wall 208 s. Locally `audit-diff` is 0.04 s for
an unchanged lockfile and 2.4 s for a changed one (`observed`, this session,
`6d72261`); the 7 s in CI is the checkout and pnpm setup around it.

Both diff jobs apply the same rule: **a PR may not add what the base does not
carry.** The backlog rides; growing it does not.

## 1 · A PR is stuck in draft

```bash
gh pr checks <N>            # which job is red, or still pending
gh run view <run-id> --log-failed
```

| What you see | What to do |
|---|---|
| A check still pending | Wait. Nothing flips a PR before its run ends. |
| `check` red | The gate is red at this head. Fix, push. The next run flips it if green. |
| `audit-diff` red | §2. |
| `codeql` red | §3, then the fix loop in §4. |
| `ready` red, every other job green | `ready` itself failed to talk to GitHub. `Resource not accessible by integration` means the `PR_READY_TOKEN` secret is missing or its PAT lacks pull-request write on this repo (§1.1); `Bad credentials` means it expired. Fix the secret, then re-run the job: `gh run rerun <run-id> --failed`. `gh pr ready` is idempotent (`observed` 2026-09-10 on PR #166: a second call prints `already "ready for review"` and exits 0), so a re-run after an undo works too. |
| A flake (the payments/customers integration suites under the full run are the known one) | `gh run rerun <run-id> --failed`. The re-run's `ready` job flips the PR if green. Do not push an empty commit to "kick" it; that is a second head and a second run. |
| A ready PR turned back into a draft | A later push went red. Read `gh pr checks`; the failing check is on the new head. |

### 1.1 The token the flip runs with

`github.token` cannot flip a draft. It is a GitHub App installation token,
and the `markPullRequestReadyForReview` / `convertPullRequestToDraft`
mutations are not open to it: `observed` 2026-09-10 on PR #167's first run
(34471269249), `ready` with `pull-requests: write` failed with `GraphQL:
Resource not accessible by integration (markPullRequestReadyForReview)`
while `check`, `audit-diff` and `codeql` were green. So the job runs `gh`
with a personal access token from a repository secret:

| Secret | Value | Notes |
|---|---|---|
| `PR_READY_TOKEN` | A PAT of Linards' with pull-request write on `linardsb/taxi` | GitHub → Settings → Developer settings → Personal access tokens. Fine-grained: repository access **only this repository**, permission **Pull requests: Read and write**; set an expiry and put the date in your calendar, an expired token leaves every PR a draft (fail closed, and `ready`'s log says `Bad credentials`). If the fine-grained token still answers `Resource not accessible by integration`, GraphQL support for fine-grained tokens is the reason; a classic token with the `repo` scope works and is account-wide, the same trade the deploy runbook accepts for `GHCR_TOKEN`. Then repo → Settings → Secrets and variables → Actions → `PR_READY_TOKEN`. |

The flip happens **as Linards**, which is what the PR timeline shows. A
missing or expired secret makes `ready` red, never green. A PAT's events can
start workflows (unlike `github.token`'s), but `ready_for_review` and
`converted_to_draft` are not in `pull_request`'s default activity types, so
the flip starts no run.

**The human bypass.** The **Ready for review** button on the PR page. Press it
when the gate is red for a reason the PR should not carry (§2's unfixable
advisory, §3's first-run state) and write one line in the PR body under
`## Notes for the reviewer` saying which check was red and why the flip is
right anyway. Nothing on a Claude session can press it: the hook refuses the
command text, and the GitHub UI is not a tool a session has.

**Why the model has no path.** `pre_tool_use.py` refuses any Bash command
matching `gh pr ready` or `markPullRequestReadyForReview`, with a message that
names #165 and this runbook. `observed` 2026-09-10 in this session, at
`6d72261` with the hook edited: payloads `gh pr ready 170`, `gh pr ready --undo
170` and the GraphQL mutation all exit 2 naming #165; `gh pr view 170 --json
isDraft`, `gh pr checks 170` and empty stdin exit 0; `cat .env` still exits 2.
REST has no un-draft endpoint, so those two routes are the whole surface.

## 2 · `audit-diff`

The rule is the **diff**, not a clean audit: HEAD may not report a `pnpm audit
--prod` advisory id that the base does not. The backlog rides.

| Figure | Value | Provenance |
|---|---|---|
| Backlog at `main` (`6d72261`) | 66 advisories over 1,013 production dependencies; 2 critical, 47 high, 18 moderate, 1 low; 1.6 s wall | `observed` 2026-09-10, `pnpm audit --prod --json` in the #165 PR A session at `6d72261`; the same 66 the plan session read at `800768f` |
| Pinning `lodash@4.17.20` alone | 5 new ids (GHSA-35jh-r3h4-6jhm high, GHSA-r5fr-rjxr-66jc high, GHSA-29mw-wpgm-hmr9, GHSA-f23m-r3pf-42rh, GHSA-xxjr-mmjv-4gpg moderate); 66 at base, 71 at HEAD; exit 1 in 2.4 s | `observed` 2026-09-10, scratch worktree off `6d72261` |
| Unchanged lockfile | exit 0 in 0.04 s without auditing | `observed`, same session |
| An added `ignore:` under `audit:` in `pnpm-workspace.yaml` | exit 1 in 0.06 s, before any audit | `observed`, same session |
| Registry unreachable | exit 1 with `audit output is not JSON`; pnpm retried for 2 min 21 s first | `observed`, same session, `npm_config_registry=http://127.0.0.1:9/` |
| Live CI runs (unchanged lockfile / new advisory / revert) | — | `expected`; PR A's own run and the throwaway PR of #165 T7 supply the URLs, recorded in PR A's body |

Run it locally before pushing a dependency change:

```bash
git fetch origin main
.github/scripts/audit-diff.sh origin/main      # -h prints the header
```

**A dependency you need carries an advisory with no fixed version.** The
script has no allow-list on purpose, and `audit.ignore`, `ignoreGhsas` and
`ignoreCves` edits are refused before the audit runs (§2 table, row 4): an
ignore entry in the same PR as the dependency is a suppression, not a fix.
The path is the button (§1) plus the line in the PR body naming the GHSA and
why it does not apply, so the exception is on the most-read surface and
reviewable. If the advisory is real and unfixable, the dependency is the
question, not the gate.

**Working the backlog down** is a separate chore, filed at PR A's merge
(`chore(deps): work down the pnpm audit --prod backlog, next critical first`).
Removing an advisory is always green here: the diff lists additions only.

## 3 · `codeql`

**Why the repo is public.** Code scanning on a private repo needs a GitHub
Code Security licence: $30 per active committer per month (`observed`
2026-09-10 on `github.com/features/security`), purchasable only by
organisations on Team or Enterprise, and the CodeQL CLI licence forbids CI
use on non-open-source code without one (`observed` on
`github/codeql-cli-binaries/LICENSE.md`, same day). On a user-owned private
repo the code-scanning endpoints answered 403 "not enabled" (`observed`, same
session). Linards chose public over an organisation licence, Semgrep, or no
SAST; `gh repo edit --visibility public` ran on 2026-09-10 after a
full-history scan (15 refs, 342 commits) found no secret, no dotenv file and
no key. Standard GitHub-hosted runners are free in public repositories
(`observed` on the Actions billing page), so CI minutes are no longer a
budget line.

**What the job does.** `github/codeql-action` v4 (`observed`: latest major on
the releases page, 2026-09-10), language `javascript-typescript`, `build-mode:
none`, default query suite (security-only, high precision). `paths-ignore`
drops the fenced anketa mini-project (`app`, `backend`: CLAUDE.md forbids a
session editing them, so a finding there could never be fixed by the loop
that reads it) and build outputs. The SARIF is always uploaded, which gives
the **Security › Code scanning** tab and the annotations on the PR's Files
tab. **Default setup must stay off** (`expected`: GitHub rejects an
advanced-setup SARIF while default setup is on; the repo shows
`not-configured`, `observed` this session, keep it so).

**The gate.** `.github/scripts/codeql-gate.sh --pr N --base BRANCH` runs
after the upload (the analyze step waits for processing by default,
`observed` in its `action.yml`). It lists the **open** alerts on
`refs/pull/N/merge` and on `refs/heads/BRANCH` through the REST API and fails
when the PR carries an alert at **high or critical security severity, or
`error` severity,** whose number the base does not. It is `audit-diff`'s rule
for alerts:

- an alert the base already has is the backlog and rides;
- an alert a human **dismissed** in the GitHub UI is not open and never
  counts; the gate honours the dismissal on the next run;
- medium and low alerts never block; they are on the tab and in the
  annotations for a human to read;
- a PR ref with no analysis is **red**, not green; a base with no analysis
  yet is treated as empty, with a warning.

| Case | Result | Provenance |
|---|---|---|
| Fixture: PR has #1 high, #3 critical (also on base), #4 high but dismissed, #5 error-level, #6 medium, #2 low; base has #3 and #9 | 2 new (#1, #5), exit 1, two `::error file=…,line=…` lines | `observed` 2026-09-10, `--pr-alerts`/`--base-alerts` fixtures in this session |
| Fixture: PR carries only the base's #3 and a medium | 0 new, exit 0 | `observed`, same session |
| Fixture: same PR list, empty base | 3 new (#1, #3, #5), exit 1 | `observed`, same session |
| Live: a PR ref with no analysis (`--pr 999`) | exit 1, "no CodeQL analysis for refs/pull/999/merge" | `observed`, same session, against this repo |
| Live: PR A's own run | — | `expected`; see the first-run state below |

**First-run state.** `main` has no CodeQL analysis until a push to `main`
runs the job, which happens when PR A merges. Until then the gate on any PR
treats every open alert at its severity as new. If the tree has none, PR A is
green on its own; if it has some, PR A stays a draft and the button (§1) is
the path, with the alerts named in its body. From the merge on, every PR
diffs against a real baseline.

**Where alerts show.** Security › Code scanning (the whole tree, filter by
branch or PR), and inline on the PR's Files tab. Listing them for a PR from a
terminal:

```bash
gh api --paginate "repos/linardsb/taxi/code-scanning/alerts?ref=refs/pull/<N>/merge&state=open&per_page=100" \
  --jq '.[] | "#\(.number) \(.rule.security_severity_level // .rule.severity) \(.rule.id) \(.most_recent_instance.location.path):\(.most_recent_instance.location.start_line)"'
```

**A finding that is wrong.** A human dismisses it on the alert page with a
reason (false positive, won't fix, used in tests); the next run is green
without touching the code. No session can do that: the hook refuses a
`PATCH …/code-scanning/alerts/N … dismiss` command and refuses `lgtm`/`codeql`
suppression comments in `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs` files
(`observed` 2026-09-10: the dismiss payload and an Edit adding the comment to
`rides.service.ts` exit 2 naming #165; a Write of this runbook mentioning the
forms, an alerts-list command, and an ordinary edit exit 0).

**Knobs, all in `ci.yml`, all Linards' call:** `queries: security-extended`
(more queries, lower precision), the `paths-ignore` list, and the severity
threshold in the gate (`high`/`critical`/`error` today).

## 4 · The fix loop

A red `codeql` is worked in `piv-fix-review-findings` §1.5: the feed is the
`gh api … code-scanning/alerts?ref=refs/pull/N/merge` command, the triage is
the skill's §1, and the rules are not negotiable inside a session: no
suppression comments, no dismissals, findings inside the PR's diff only,
never remove the feature to lower a count, at most 3 push-and-rescan cycles,
the re-scan is CI's `codeql` job on the pushed commit and never a local
scanner. A finding that is genuinely wrong gets one line in the PR body
under `## Notes for the reviewer`, not a suppression; the human then dismisses
it (§3).
