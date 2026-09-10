# Runbook — the PR gate (#165)

Every PR opens as a **draft** and leaves draft only when CI says so. `ci.yml`'s
`ready` job is the one thing that runs the flip, and the PreToolUse hook
refuses the routes a Claude session would otherwise take to it. A human keeps
exactly one bypass, the **Ready for review** button in the GitHub UI, and §1
says when to press it.

**What the hook does and does not guarantee.** It matches *text* — a Bash
command's text and the text a write tool puts in a file — against a list of
patterns. That stops the direct routes and every accident. It is not a
capability boundary: a session that writes the flip into a script and runs the
script, or edits the hook, or edits `ci.yml`, is not matching any pattern
(`observed` 2026-09-10, PR #167 review F4/F5). Treat the hook as the thing that
makes the wrong move require deliberate effort, and CI plus branch protection
as the controls that actually hold.

Why this exists: every "STOP if red" in the PIV skills is prose a model obeys,
and the ledger of prose checks failing is long (#87, #107, the CLAUDE.md gate
line, three times). Branch protection is the normal answer. It was refused
while the repo was **private** (`observed` in #165, 2026-09-10: HTTP 403 from
the branch-protection and rulesets APIs on GitHub Free); the repo went public
later the same day and both APIs opened up (`observed` 2026-09-10 after the
flip: 404 `Branch not protected`, and `[]` from `/rulesets`). Required status
checks on `main` are therefore available and are the server-side half of this
design — see §5.

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

- **"Ready" means "the head CI last finished testing passed."** Not "the PR's
  current head passed". A later push that goes red re-drafts the PR (`gh pr
  ready --undo`), but only once that push's own run reaches `ready` — about
  3.5 min. In that window the PR keeps the state the previous head earned, and
  is mergeable. Nothing re-drafts on `synchronize` **by choice**: a job that
  re-drafted every push would silently undo the human bypass above before any
  gate result existed. Close the window server-side with required status checks
  (§5), not with a re-draft job (#165, PR #167 review F3).
- **The `ready` job refuses a head that is no longer the PR's.** It compares
  the run's `head.sha` with `gh pr view --json headRefOid` and exits without
  touching the PR when they differ — a `gh run rerun` of an OLD run replays the
  original payload, joins the same concurrency group, cancels the live run and
  would otherwise flip the PR at a head it never tested (F3c).
- **One run per PR head.** `concurrency` cancels the in-flight run when a new
  head is pushed, and the cancelled run's `ready` job is skipped
  (`!cancelled()`), so an old run never touches the PR. Pushes to `main` are
  never cancelled.
- **A head with no run at all** is the one case nothing here catches: #52 sat
  with zero check runs (see `ci.yml`'s `workflow_dispatch` comment). Only
  required status checks (§5) refuse a merge in that state.

Time from push to flip: **about 3.5 minutes** when green — `check` `observed`
195–206 s over PR #167's four runs (34471269249, 34471798333, 34472223208,
34476424460, 2026-09-10), `ready` starting after the slowest `needs` job and
taking seconds. `audit-diff` and `codeql` run beside `check`, not after it, so
neither adds to the wall clock: `observed` on the first of those runs, `check`
198 s, `codeql` 82 s, `audit-diff` 7 s (unchanged lockfile, short-circuit), run
wall 208 s. Locally `audit-diff` is 0.04 s for an unchanged lockfile and 2.4 s
for a changed one (`observed`, this session, `6d72261`); the 7 s in CI is the
checkout and pnpm setup around it.

> An earlier draft of this section said "about six minutes, `check` `observed`
> 313–361 s". That range was **run wall**, not the `check` job, and every run in
> it predated the repo going public. Re-derived on PR #167's own runs it is
> 195–206 s (#165, PR #167 review F10).

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
| `ready` red, every other job green | `ready` itself failed to talk to GitHub. Read its log: `set the GH_TOKEN environment variable`, exit 4, means the `PR_READY_TOKEN` secret does not exist (`observed` run 34471798333); `Resource not accessible by integration` means it holds the Actions token (`observed` run 34471269249); `Resource not accessible by personal access token` means a fine-grained token, which this mutation refuses (`observed` run 34472223208, §1.1); `Bad credentials` means it expired (`expected`). Fix the secret (§1.1), then re-run the job: `gh run rerun <run-id> --failed`. `gh pr ready` is idempotent (`observed` 2026-09-10 on PR #166: a second call prints `already "ready for review"` and exits 0), so a re-run after an undo works too. |
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
| `PR_READY_TOKEN` | A **classic** PAT of Linards' with the `repo` scope | GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic). Set an expiry and put the date in your calendar: an expired token leaves every PR a draft (fail closed; `ready`'s log says `Bad credentials`, `expected`). Then repo → Settings → Secrets and variables → Actions → `PR_READY_TOKEN`. **A fine-grained token does not work here**: `observed` 2026-09-10, run 34472223208, two re-runs with a fine-grained token (repository access set to this repo, Pull requests: Read and write, per Linards) both answered `GraphQL: Resource not accessible by personal access token (markPullRequestReadyForReview)`; the third re-run with a classic `repo` token flipped #167 at 12:21:42. A classic `repo` token is account-wide, the same trade the deploy runbook accepts for `GHCR_TOKEN`; it lives only in this repo's secrets and one job reads it. |

The flip happens **as Linards**, which is what the PR timeline shows
(`observed` on #167: `ready_for_review by linardsb`). A missing or expired
secret makes `ready` red, never green. A PAT's events can
start workflows (unlike `github.token`'s), but `ready_for_review` and
`converted_to_draft` are not in `pull_request`'s default activity types, so
the flip starts no run.

**The human bypass.** The **Ready for review** button on the PR page. Press it
when the gate is red for a reason the PR should not carry (§2's unfixable
advisory, §3's first-run state) and write one line in the PR body under
`## Notes for the reviewer` saying which check was red and why the flip is
right anyway. Nothing on a Claude session can press it: the hook refuses the
command text, and the GitHub UI is not a tool a session has.

**What the hook refuses.** `pre_tool_use.py` refuses the flip phrases — `gh pr
ready`, `--undo`, `markPullRequestReadyForReview`, `convertPullRequestToDraft`
— in a Bash command's text **and** in the text an Edit/Write/MultiEdit puts
into a non-`.md` file, with a message that names #165 and this runbook. It also
refuses `gh pr create` without `--draft`. `observed` 2026-09-10: the flip
payloads, a `Write` of a shell script containing the flip, and a bare `gh pr
create` all exit 2 naming #165; `gh pr view --json isDraft`, `gh pr checks`,
a `.md` write naming the phrases, and empty stdin exit 0; `cat .env` still
exits 2.

**What it does not refuse**, and why that is fine: the hook reads text, so a
session that edits `ci.yml`, `pre_tool_use.py` or the gate scripts is outside
every pattern. The hook now fences writes to `.github/workflows/`,
`.github/scripts/`, `.claude/hooks/` and `.claude/settings.json` for the same
reason it fences the anketa — but **a hook guarding its own file is a
mitigation, not a guarantee**, since the fence itself is one edit away. The
control that holds is §5's required status checks, which live in repo settings
where no branch can rewrite them.

## 2 · `audit-diff`

The rule is the **diff**, not a clean audit: HEAD may not report a `pnpm audit
--prod` advisory id that the base does not. The backlog rides.

| Figure | Value | Provenance |
|---|---|---|
| Backlog at `main` (`6d72261`) | 66 advisory ids over 1,013 production dependencies; 2 critical, 46 high, 17 moderate, 1 low | `observed` 2026-09-10, `pnpm audit --prod --json` at `6d72261`, re-derived in the PR #167 review: `.advisories \| length` = 66 and the per-id severities sum to 66. **Not** `metadata.vulnerabilities`, a separate counter that reads 2/47/18/1 and sums to 68 — earlier copies of this row mixed the two (F9). The gate diffs ids and never reads severity. |
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
  yet is treated as empty, with a warning. "Has this ref been analysed?" is
  asked of the `code-scanning/analyses` endpoint, not inferred from an empty
  alert list: once the repo has any upload at all, the alerts endpoint answers
  `[]` for a never-analysed ref exactly as it does for a clean one, so the
  404 the script originally keyed on stops firing and "unscanned" would read
  as "clean" (#165, PR #167 review F6).

| Case | Result | Provenance |
|---|---|---|
| Fixture: PR has #1 high, #3 critical (also on base), #4 high but dismissed, #5 error-level, #6 medium, #2 low; base has #3 and #9 | 2 new (#1, #5), exit 1, two `::error file=…,line=…` lines | `observed` 2026-09-10, `--pr-alerts`/`--base-alerts` fixtures in this session |
| Fixture: PR carries only the base's #3 and a medium | 0 new, exit 0 | `observed`, same session |
| Fixture: same PR list, empty base | 3 new (#1, #3, #5), exit 1 | `observed`, same session |
| Live: a PR ref with no analysis (`--pr 999`) | exit 1, "no CodeQL analysis for refs/pull/999/merge" | `observed` 2026-09-10 in the PR #167 review session, against this repo, **after** the analyses-count fix. The same call was exit 1 before this repo's first upload and would have been exit 0 between the two (F6); the row now describes the fixed script. `--pr 171` (a real PR whose run had not finished) is exit 1 by the same branch. |
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
without touching the code. The hook refuses the routes a session would take
instead: a `PATCH` to `…/code-scanning/alerts/N` carrying `state=dismissed` in
any word order or via `--input`, and the `lgtm`/`codeql` suppression comment
forms — case-insensitively, including bare `lgtm`, which CodeQL also honours —
in both Bash command text and write-tool text for non-`.md` files (`observed`
2026-09-10: the dismiss payloads, `sed -i` and a heredoc appending the comment
to `rides.service.ts`, and `// LGTM[…]` / `// lgtm` edits all exit 2 naming
#165; a Write of this runbook mentioning the forms, an alerts-list command,
and an ordinary edit exit 0).

This is text matching, not a capability boundary — see the note in the intro.
It makes suppression a deliberate act rather than a convenient one; the
control that a session cannot rewrite is §5.

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

## 5 · Branch protection on `main`

The client-side half of this design (draft state, the hook) lives in files a
branch can rewrite. The server-side half lives in repo settings, which no
branch, workflow or session can reach. Both are needed: the flip is the
*signal*, protection is the *control*.

**Live since 2026-09-10** (`observed`, `PUT /repos/linardsb/taxi/branches/main/protection`,
then read back):

| Setting | Value | Why |
|---|---|---|
| `required_status_checks.contexts` | `check`, `audit-diff`, `codeql` | The three gate jobs. `ready` is deliberately **not** required: it is the signal that consumes these, and it fails by design on a stale head |
| `required_status_checks.strict` | `true` | A PR must be up to date with `main` before it merges, so a green run always describes a tree containing today's `main` |
| `enforce_admins` | `false` | Linards keeps one bypass, matching the **Ready for review** button in §1. A control with no human override is a control that gets deleted the first time it is wrong |
| `allow_force_pushes` / `allow_deletions` | `false` | — |

**What this closes that the flip cannot.** A merge is refused unless the three
checks are green *on the PR's current head*, which removes the window in §0
(green head A, push head B, merge before B's run finishes), the head that never
got a run at all (#52), and every route that goes through editing `ci.yml`, the
gate scripts or the hook — because those live in the branch and this does not.

**What it costs.** `strict: true` means a PR that falls behind `main` must be
updated before it merges; both PRs open when this landed went to
`mergeStateStatus: BEHIND` immediately (`observed` 2026-09-10: #167 and #171).
Update with `gh pr update-branch <N>`, or rebase and force-push the branch.

**Reading it back:**

```bash
gh api repos/linardsb/taxi/branches/main/protection \
  --jq '{strict:.required_status_checks.strict,contexts:.required_status_checks.contexts,admins:.enforce_admins.enabled}'
```

Before the repo went public this was HTTP 403 on GitHub Free; see the intro for
why the "unavailable on this plan" note in earlier drafts was true when written
and is not now.
