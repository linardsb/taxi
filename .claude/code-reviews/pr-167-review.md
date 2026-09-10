# PR #167 review — feat(ci): draft-by-default PRs with a no-model ready gate (#165)

**Head** `a2ca2f8` · **Base** `main` @ `6d72261868c6e24b2466761609e877ca6a90f977` · **Round** 1 · **Reviewed** 2026-09-10

**State at review**: OPEN, already ready (`ready_for_review` 12:21:42Z by linardsb on run 34472223208; the `a2ca2f8` run 34476424460 printed `already "ready for review"`, exit 0, head matches the PR head). Checks: `check`, `audit-diff`, `codeql`, `ready`, `CodeQL` green; **`SonarCloud Code Analysis` red** (F2).

**Dispositions** — `.claude/reports/pr-167-review-fixes.md`: **14 fixed, 2 deferred to issues** (#172 carries F15, #173 carries F2). **F3's fix part (1) was rejected and is not prior art.** That part proposed a no-`needs` first job re-drafting the PR at the start of every run; it would destroy the documented human bypass (the **Ready for review** button, PR body deviation 3) by undoing a human's override before any gate result exists. F3(a)'s window is closed server-side instead, by F1's required status checks. F3's parts (2)–(4) shipped as written. Recorded in the plan's AMENDMENTS.

**How this was reviewed**: fresh context after `/clear` in the authoring session; the deep pass ran in the `code-reviewer` agent, and every behavioural claim it made was reproduced here before it entered this report (the probe table under F4, the API calls under F1 and F6, the shell check under F7). Plan and implementation report read; the eight documented deviations are treated as decisions, not findings. No plan GOTCHA freezes any file this review asks to change. Every figure below is labelled `observed` (with the run or call that produced it), `derived` (arithmetic shown) or `expected`.

## Summary

The scripts and the Actions semantics are sound, and the live evidence is unusually complete: three token failure modes observed and written down with run ids, the flip observed on the PR timeline, and CodeQL's scope verifiable from the run log (`observed`, this review, run 34476424460's `codeql` job log: 287 files extracted under `apps/`, 244 under `services/`, 67 under `packages/`, 30 under `db/`, 0 under the fenced `app/` and `backend/`). The gate is green at the head with the Redis suites included.

What needs a decision or a change before merge:

- **The design premise moved inside this PR's own session.** The runbook justifies a client-side flip with "branch protection is unavailable on this plan, HTTP 403". That was observed on the private repo. The repo is public now, and today the same endpoints answer 404 "not protected" and an empty rulesets list (F1). Required status checks on `main` would close three of the routes below server-side.
- **Two absolute claims the shipped files contradict**: "ready always means this head passed" (F3) and "no session can suppress a finding / no model has a path to the flip" (F4, F5). Each has a small mechanical fix.
- **The red SonarCloud check** is documented but has to go before the next PR (F2).
- Four figures did not survive re-derivation (F6, F9, F10 and the payload count in F12). None changes a decision; all sit on shipped surfaces.

**Recommendation: request changes.** 0 Critical · 5 High · 5 Medium · 6 Low. F1 is Linards' call and reshapes F3 and F5 if taken; F3, F4, F5 are code fixes in this PR either way; F2 is an admin action outside the repo.

## Findings

### High

**F1 · The "no branch protection" premise is stale; it changed in this PR's session** — `docs/runbooks/pr-gate.md:11-13`, `.claude/plans/ci-no-model-pr-gate.md:24,38`. The 403 was observed on the private repo, where GitHub Free withholds protection. `observed` 2026-09-10 after the visibility flip: `gh api repos/linardsb/taxi/branches/main/protection` → HTTP 404 `Branch not protected`; `gh api repos/linardsb/taxi/rulesets` → `[]` (200); `rules/branches/main` → `[]`. Both features are open to this repo now. Required status checks (`check`, `audit-diff`, `codeql`; `strict: true`) with `enforce_admins: false` would gate the *merge* where no session or workflow edit can reach, keep the one human bypass the design wants, and close F3's three routes and most of F8 server-side; a ruleset "require workflows" rule, if the plan offers it, also closes F5's workflow-edit route. The draft flip can stay as the signal. Not applied by this review (a repo-settings change is Linards' decision); the runbook's intro needs rewriting either way, because it records a stale observation as current.

**F2 · `SonarCloud Code Analysis` is a red check on the PR** — outside `ci.yml` and `ready.needs`; documented as deviation 8 with the action on Linards. `observed`: `gh pr checks 167` → `fail`; the public SonarCloud API answers `Project doesn't exist` for this key, so what it is red on is not readable from here. Not a code change: disable automatic analysis for `linardsb_taxi` on sonarcloud.io or uninstall the app. Do it before this merges: every later PR otherwise carries a red X that `ready` ignores, and a red check people learn to skip is the failure `audit-diff.sh`'s own header names ("ignored by day two"). (The review skill's rule makes a red check finding #1; it sits second here only because F1 is the larger decision.)

**F3 · "ready always means this head passed" is false by three routes** — `.github/workflows/ci.yml:121-122`, `docs/runbooks/pr-gate.md:42-44`.
- (a) *The window.* Head A green, PR flipped. Push head B: the PR stays ready, and mergeable, until B's run reaches `ready`, after `check` (`observed` 195–206 s on the three of this PR's four runs that finished on attempt 1; on 34472223208, which ran to attempt 4, `ready` completed 2 692 s after the run was created). Nothing re-drafts on `synchronize`; `--undo` runs last (`ci.yml:146`). The plan's Q2 accepts this ("the state self-corrects when B finishes"); the shipped sentence says "always" without that condition. `gh pr merge` is not refused by the hook and no skill names it, so a session can merge inside the window.
- (b) *A run that never fires.* `ci.yml:6-12` documents #52 sitting with zero check runs. That head sits under a ready PR with nothing to re-draft it.
- (c) *A stale re-run.* `ready` never compares the run's head with the PR's head. The runbook's own remedy (`gh run rerun <run-id>`, §1) on an older run re-tests head A's merge commit with the original payload (the plan's T4 GOTCHA (b) already records that re-runs read the original payload), joins concurrency group `ci-N`, cancels a live run for head B, and flips PR N at head B untested. `derived` from the code; not exercised on this PR because it would flip the real PR.
- Fix, four parts, each small: (1) a first job with no `needs` (`if: github.event_name == 'pull_request'`, same `GH_TOKEN`) running `gh pr ready --undo`, so the PR is a draft while its head is under test; `--undo` on a draft is a no-op (`observed` in gh's source, cli/cli `pkg/cmd/pr/ready/ready.go:89-93` pinned at `3bb5f54`, the commit that last touched the file: `already "in draft"`, return nil) and `converted_to_draft` starts no run; keep it out of `ready.needs`. (2) In `ready`, before the `case`: compare `${{ github.event.pull_request.head.sha }}` with `gh pr view --json headRefOid`; on mismatch print an error and exit 1 without touching the PR. (3) Reword both surfaces to what holds: "ready means the head CI last finished testing passed". (4) `piv-review-pr` Phase 1 compares `headRefOid` with the green run's `headSha` (done for this review: run 34476424460 head `a2ca2f8` = PR head), and the hook refuses `\bgh\s+pr\s+merge\b` since the skills say a human merges. Only F1 or (4) covers (b).

**F4 · Both new hook guards are bypassed by the tool they do not inspect** — `.claude/hooks/pre_tool_use.py:51,58-59,129-145`. Guard 4 reads Bash command text only; guard 5 reads Bash text for dismissal and Edit/Write content for the comment form. `observed` 2026-09-10, payload files against the hook at `a2ca2f8` (`uv run .claude/hooks/pre_tool_use.py < payload.json`):

| Route | Payload | Exit |
|---|---|---|
| Guard 4, Write then run | Write `flip.sh` whose content is the flip command | 0 |
| | Bash `bash flip.sh` | 0 |
| | Bash `gh api graphql -f query=@q.graphql` | 0 |
| Guard 4, control | Bash with the flip command in its text | 2 |
| Guard 5 comment, Bash write | `sed -i` inserting `// lgtm[js/sql-injection]` into `rides.service.ts` | 0 |
| | `cat >> rides.service.ts <<'EOF'` with `// codeql[js/sql-injection]` | 0 |
| | `python3 -c "open('…rides.service.ts','a').write('// lgtm[…]')"` | 0 |
| Guard 5 comment, casing | Edit adding `// LGTM[js/sql-injection]` to a `.ts` | 0 |
| Guard 5 comment, bare form | Edit adding `// lgtm` to a `.ts` | 0 |
| Guard 5 comment, control | Edit adding `// lgtm[js/sql-injection]` to a `.ts` | 2 |
| Guard 5 dismiss, flag first | `gh api -f state=dismissed -X PATCH …/code-scanning/alerts/3` | 0 |
| Guard 5 dismiss, variable | `for n in 3 4 5; do gh api -X PATCH …/alerts/$n -f state=dismissed; done` | 0 |
| Guard 5 dismiss, body in file | `gh api -X PATCH …/alerts/3 --input body.json` | 0 |
| Guard 5 dismiss, control | `gh api -X PATCH …/alerts/3 -f state=dismissed …` | 2 |

The Write-then-run route is not an evasion a session must invent: the plan (`:205`, `:297`) and the project memory instruct sessions to put guarded phrases in files written with the Write tool, and this review did exactly that for its probes. The Bash-write route is the primary edit path under bypass-permissions mode. The casing and bare-`lgtm` rows matter because CodeQL's matcher is broader than the hook's: `observed` in `github/codeql` `shared/util/codeql/util/suppression/AlertSuppression.qll:62,65,97` pinned at `c207cfd`, the commit that last touched the file, the regexes are `(?i)\blgtm\s*\[…\]`, `(?i)(?<=^|;)\s*lgtm(?!\B|\s*\[)` (bare `lgtm` at comment start suppresses the line) and `(?i)\bcodeql\s*\[…\]`. So `// LGTM[…]` and `// lgtm` are live suppressions the hook allows. The runbook's "No model has a path to the flip" (`:3-5`), "those two routes are the whole surface" (`:114`) and "No session can do that" (`:219`) are not true as guarantees.
- Fix: run `PR_READY_FLIP` and `ALERT_DISMISS` over Write/Edit/MultiEdit text too (reuse the `texts` list at `:142-143`), for every path except `.md`; run `SUPPRESSION_COMMENT` over Bash text too; make it `re.IGNORECASE` and add the bare form `(//|/\*|;)\s*lgtm\b`; anchor the dismiss pattern on the PATCH rather than the order of words (`code-scanning/alerts.*?(state=dismissed|(-X|--method)\s*PATCH|--input)|((-X|--method)\s*PATCH|state=dismissed).*?code-scanning/alerts`, `re.I|re.S`). Then rewrite the three runbook sentences to say what the hook checks (command text and written-file text) and that CI, or branch protection under F1, is the control.

**F5 · The gate, the hook and the classic `repo` PAT are all reachable from the PR's own tree** — `.github/workflows/ci.yml:139`, `.claude/hooks/pre_tool_use.py:46`, `docs/runbooks/pr-gate.md:92`. Security. `pull_request` runs the PR branch's copy of `ci.yml`, same-repo branches receive secrets, and the only path fence in the hook is the anketa's. `observed`: an Edit of `ci.yml` changing `ready.needs` to `[check]` exits 0; an Edit of `pre_tool_use.py` replacing the guard-4 call with `if False:` exits 0 (the plan's own T1 GOTCHA notes the hook is live on save, so the edited copy governs the next call). A session can therefore make `codeql-gate.sh` exit 0, extend `paths-ignore` over the file with the alert, or add a step to `ready` that reads `GH_TOKEN`, push, and let the PR's own run flip it. That token is a classic `repo`-scope PAT of Linards' (`docs/runbooks/pr-gate.md:92`, the secret's own row — a repository secret's scope is not readable from outside repo settings, so this is the runbook's statement, not a measurement made here), which reaches every repository of the account, private ones included, from a file any branch can rewrite in a public repo. High rather than Critical because the only pushers are Linards and his sessions; the blast radius is still wrong.
- Fix: narrow the PAT to `public_repo` now that the repo is public (`expected`: it is `repo`'s public-only subset and the draft mutation needs write on this public repo; one re-run of `ready` verifies). Add a fence in the hook for Edit/Write/MultiEdit on `.github/workflows/`, `.github/scripts/`, `.claude/hooks/` and `.claude/settings.json`, same shape and message as the anketa fence, and say in the runbook that a hook guarding itself is a mitigation, not a guarantee. Server-side closure is F1.

### Medium

**F6 · `codeql-gate.sh` "a PR ref with no analysis is red, not green" held only before the repo's first upload** — `.github/scripts/codeql-gate.sh:29-36,91-103`; `docs/runbooks/pr-gate.md:190-191,198`; PR body's `--pr 999` bullet. `observed` 2026-09-10 after this PR's uploads: `code-scanning/alerts?ref=<ref>&state=open` answers `[]` for `refs/pull/999/merge`, `refs/pull/166/merge`, `refs/heads/feature/no-model-pr-gate` and `refs/heads/does-not-exist`. The 404 `no analysis found` the script keys on no longer occurs, so the exit-1 branch and the base `::warning` branch are dead code (the `a2ca2f8` run printed no warning although `main` has 0 analyses). The `--pr 999` observation was real at the time; the cause inferred from it ("GitHub answers no analysis found for that ref") was state-dependent. Practical exposure is small because the `analyze` step (`wait-for-processing` default true) fails the job first, but three surfaces state a guarantee the code cannot deliver. Fix: before listing alerts, count `code-scanning/analyses?ref=<ref>` (`observed`: 4 for `refs/pull/167/merge`, latest `results_count` 0; 0 for `refs/pull/999/merge`; 0 for `refs/heads/main`); 0 on the PR ref → exit 1, 0 on the base → the warning.

**F7 · `codeql-gate.sh` fails open when its own counts line is missing or malformed** — `.github/scripts/codeql-gate.sh:118-128`. `new=$(… awk '{print $5}')` then `[ "$new" -gt 0 ]`: with `$new` empty the test errors (status 2), the `if` is false, and line 128 prints "no new alert" and exits 0. `observed`: `new=""; if [ "$new" -gt 0 ]; then …; else …; fi` takes the else branch. `set -u` does not catch a set-but-empty variable, and `-e` is not the missing half: `errexit` is suspended for a command in an `if` condition, so it would not fire here either, and plan `:153` records not using `-e` as deliberate ("the scripts call commands whose non-zero exit is data"). `set -u` is the whole mechanism. The report (`:97`) records this exact class biting during development (`jq -n` without `-r` → empty counts → exit 0 on a failing fixture); the cause was fixed, the fail-open shape was not. Fix, after line 122: `case "$new" in ''|*[!0-9]*) echo "::error::codeql-gate could not parse its counts line: '$counts' (#165)"; exit 2 ;; esac`.

**F8 · `gh pr create` without `--draft` passes the hook** — `.claude/hooks/pre_tool_use.py:51`; plan `:607`. `observed`: exit 0. The plan rejects this guard because it "would also refuse the throwaway probes", but the plan's own T7 (`:334`) opens its probe with `--draft`, so the cost it names does not exist. Consequence beyond F3(a): a born-ready PR whose run's `ready` job fails on the token cannot be undone (the failure observed on run 34471798333, that time on a draft), so it stays ready with nothing passed. A documented decision, re-opened because its rationale is refuted by its own plan; Linards decides. Fix: refuse `\bgh\s+pr\s+create\b` unless `--draft` or `\s-d\b` is present, naming #165.

**F9 · The audit backlog breakdown does not sum to its total** — `.github/workflows/ci.yml:60-61`, `docs/runbooks/pr-gate.md:123`, report `:69`, PR body. "66 advisories: 2 critical, 47 high, 18 moderate, 1 low" sums to 68. `observed` 2026-09-10, `pnpm audit --prod --json` from `6d72261`'s lockfile alone: `.advisories | length` = 66; by advisory severity 2 critical / **46** high / **17** moderate / 1 low = 66; pnpm's `metadata.vulnerabilities` = 2 / 47 / 18 / 1 = 68, a different counter. The plan's NOTES table attributes the breakdown to `metadata.vulnerabilities` correctly; every downstream copy dropped the qualifier. Fix: name the counter or drop the breakdown (the gate diffs ids and never reads severity).

**F10 · "about six minutes" / "`check` observed 313–361 s" was stale the day it shipped** — `.claude/skills/piv-create-pr/SKILL.md:130-131`, `docs/runbooks/pr-gate.md:50-53`, plan Level 4 step 1. Re-derived: 313–361 s is run wall (`createdAt`→`updatedAt`), not the `check` job, which was 285–321 s in the three of those runs read here (34462897943, 34373346365, 34354866213). All eight predate the visibility flip. This PR's four post-flip runs: `check` 198 / 203 / 195 / 206 s (`observed`, runs 34471269249, 34471798333, 34472223208, 34476424460), about 3.5 min; run wall 208–216 s on the three that finished on attempt 1 — 34472223208 ran to attempt 4 and its wall is **2 693 s** (`createdAt` 11:36:51Z → `updatedAt` 12:21:44Z), because its `ready` job did not start until 12:21:39Z. The PR body's "head-independent" is true; the condition that changed is the repo's visibility (`expected` mechanism, not isolated here: public repos get larger hosted runners). Fix: cite this PR's runs and drop or date the pre-flip range.

### Low

**F11 · Three small text-match gaps and two false positives in the hook** — `pre_tool_use.py:51,58`. `convertPullRequestToDraft` is not in the flip alternation although the comment says re-drafting is CI's (`observed`, exit 0; fail-closed direction). `ALERT_DISMISS` with `DOTALL` blocks a read (`gh api …/alerts/3 --jq .dismissed_reason`) and `PR_READY_FLIP` blocks a grep for the phrase (this review's line-number grep was refused once). Accepted cost in this repo; F4's PATCH-anchored pattern removes the first false positive.

**F12 · Hook payload count disagrees across surfaces**: PR body "12 payload files + empty stdin" then enumerates 12 including stdin; report `:31` says "thirteen payload files" over a 12-row table. The session scratchpad is gone, so neither is re-derivable. Pick one.

**F13 · `CLAUDE.md:84` on-demand row omits `.github/scripts/codeql-gate.sh`**, which the runbook's own sources-of-truth list includes. Written from T15 before the CodeQL amendment.

**F14 · `codeql-gate.sh:73` merges stderr into the JSON stream** (`2>&1`). A `gh` warning on a successful call breaks `jq -s` and the script exits 2. Fail-closed; mention only.

**F15 · Stacked PRs always diff against an empty CodeQL base** — the `codeql` job itself runs on every PR (`ci.yml:86`, no job-level `if`); it is the *push* trigger that is `main`-only (`ci.yml:4-5`) and the gate *step* that is PR-gated (`:112`), so a feature-branch base never has a `refs/heads/<branch>` analysis; today that reads as `[]` (F6), so every gated open alert on a stacked PR is new. Harmless while the tree has zero alerts (`observed` on #167); the day it has one, every stacked PR is red until the bypass. Fall back to `main`'s analysis when the base has none, or say so in runbook §3.

**F16 · The base audit never reads the repo's `.npmrc`** — `audit-diff.sh:76-77,91,94`. The base audit runs in a temp dir, the head audit at the root. The suppression guard greps `.npmrc` for ignore keys but not for an added `registry=` line, which is the larger lever (a quieter registry makes HEAD report fewer ids and the diff is empty). Add `^\+.*registry` to the guard's pattern.

**Fork PRs** (asked of the agent; no finding): secrets are withheld on `pull_request` from forks, so `ready` fails on `GH_TOKEN` and the PR stays a draft; `ready` checks nothing out; no `pull_request_target` anywhere. One asymmetry worth a runbook line: a fork PR opened ready cannot be re-drafted by CI.

## Numbers pass

| Figure (surface) | Provenance claimed | Re-derived |
|---|---|---|
| Gate at `061fa4b`: 22/22, 1m31.998s, api 35 skipped / 681 passed (PR body) | observed | Re-run at `a2ca2f8` below: 22/22, api 716/716 with Redis. Holds. |
| 66 advisories, 2/47/18/1, 1,013 deps (ci.yml, runbook, report, body) | observed | 66 and 1,013 hold; the breakdown is a different counter (F9) |
| `check` 313–361 s, "about six minutes" (skill, runbook, plan) | observed, head-independent | Run wall, pre-flip; this PR's `check` 195–206 s (F10) |
| Run figures 198/7/82 · 203/80/12 · 206/85/8/5 s (body, runbook) | observed | `gh run view` job timestamps agree to the second |
| Flip at 12:21:42 as linardsb, no run started (body, runbook, ci.yml) | observed | Timeline: one `ready_for_review` 12:21:42Z linardsb; the run list has nothing between 11:36 and 12:23 |
| CodeQL: 0 open alerts on the PR ref (body) | observed | API: 0 open on `refs/pull/167/merge`, 4 analyses, latest `results_count` 0 |
| `--pr 999` → exit 1 "no CodeQL analysis" (body, report, runbook) | observed | True at the time; the same call answers `[]` now (F6) |
| Branch protection 403, "unavailable on this plan" (runbook, plan) | observed | 404 "not protected" and `[]` rulesets today (F1) |
| Hook: 12 blocked/allowed (body) vs thirteen (report) | observed | Not re-derivable (F12); the four controls re-run here behave as claimed |
| 15 refs, 342 commits scanned (body, plan) | observed | 16 refs / 345 commits today; the delta is this branch's ref and three commits. Consistent. |
| `audit-diff.sh` 0.072 s / 2.765 s (body) vs 0.036 s / 2.4 s (report, runbook) | observed, different runs | Both labelled with their run; not contradictory |
| `!cancelled()` runs `ready` on a red `needs` job; `--undo` re-drafts | expected (T7 owed) | Not observed by any run yet; the body says so |
| CodeQL `paths-ignore` drops `app`/`backend`, keeps `apps/` (ci.yml, runbook) | expected | `observed` in run 34476424460's log: 0 files under `app/` or `backend/`, 287 under `apps/` |

`inherited-figures.sh` (PR body vs report, runbook, plan) flags the gate figures as copied from the `061fa4b` run; closed by the re-run below.

## Validation

`observed` — `record-gate.sh --clean` with `REDIS_TEST_URL=redis://127.0.0.1:6381`, at `a2ca2f8`, main checkout, exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m31.195s
```

| Package | Result |
|---|---|
| @taxi/api | Test Suites 76 passed / 76 · Tests 716 passed / 716 (Redis suites ran: 0 skipped) |
| @taxi/dispatch | 27 files · 224 tests passed |
| @taxi/driver | 41 suites · 214 tests passed |
| @taxi/rider | 30 suites · 143 tests passed |
| @taxi/shared | 24 files · 231 tests passed |
| @taxi/db | 3 files · 17 tests passed |

Not in the graph (no such script; the known legitimate absences): `@taxi/config#*`, `@taxi/driver#build`, `@taxi/rider#build`.

CI at `a2ca2f8` (run 34476424460, head matches the PR head): `check` 206 s, `codeql` 85 s, `audit-diff` 8 s, `ready` 5 s, all green. Hook probes (`observed`, this review): **14** tabulated under F4; further probes named in prose under F5 (2), F8 (1) and F11 (3). No single total is claimed — the earlier "21" was not re-derivable from this document.

## What is good

- The diff rule ("a PR may not add what the base does not carry") applied identically to advisories and alerts, with the backlog riding, is the right gate for a tree with 66 open advisories; the ignore-list guard closes the obvious same-commit bypass.
- Every ambiguity in the scripts resolves closed: not-JSON audit output, a missing secret, an API error, a cancelled run, a fine-grained token. Each was observed and named with its run id, not reasoned about.
- `ready` checks nothing out, so PR code never executes beside the PAT (F5 is about editing the job, not running code in it).
- `paths-ignore` does what it says, and the run log proves it.
- The alerts-API-over-SARIF decision (deviation 2) is argued from the one case that matters, a human dismissal, and the discarded version is recorded with its reason.
- The report caught its own `jq -n` bug with the fixture run before it shipped, and says so.
- The concurrency group is right: PR number for PRs (cancel), SHA for pushes (never cancel), and the comment explains the asymmetry.
- Provenance labels sit on nearly every figure, which is what made the numbers pass tractable.

## Owed after merge (documented, not findings)

T7's red and revert `audit-diff` runs; the backlog chore issue (runbook §2 says "filed at PR A's merge"; `gh issue list` finds none yet); #165's body still names Sonar.
