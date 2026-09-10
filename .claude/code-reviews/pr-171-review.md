# PR #171 review — docs(reviews): land the round-1 review report for PR #167

**Head** `107bb3a5` · **Base** `main` @ `6523573f094c7e3dc515a456b68c75a8b128c100` · **Round** 1 · **Reviewed** 2026-09-10

**State at review**: OPEN, **draft**, `mergeStateStatus: BEHIND`. Checks: `check` pass (3m21s), `SonarCloud Code Analysis` pass. `audit-diff`, `codeql` and `ready` **did not run** — see F1. `main`'s tip moved to `a4832ca` since this PR was cut: #167 merged at 14:10:52Z, 41 minutes after #171 was opened (13:29:05Z).

**How this was reviewed**: fresh context. The diff is one file, and that file is a set of claims about code, so this is mostly a claims-and-numbers pass. Every `file:line` anchor in the report was resolved against the tree at `a2ca2f8`; every run figure re-derived from `gh run view` job timestamps; F9 re-run independently from the base lockfile; the CodeQL scope counts recounted from the job log; both external-repo citations fetched from source. The deep pass ran in the `code-reviewer` agent over the report plus all eight files it cites, materialised at `a2ca2f8` — and **every finding it returned was reproduced here before entering this report**; two were dropped as over-readings and are named at the end. No plan is loaded (this is an artifact PR, not a ticket), so the constraint pass is skipped. No prior review exists for #171, so the guarantees pass is not triggered — but the base *did* move, and F1 is what that movement broke.

## Summary

**The report is accurate.** Every anchor resolves to the line its finding describes. The four `check` durations re-derive to the second. F9 reproduces to the digit on an independent run. The CodeQL extraction counts recount exactly. All fourteen of F4's probe rows fall out of the regexes without needing to trust the run. The severity counts match the findings list. This is the artifact the review skill is meant to produce, and landing it is right.

What needs doing before it merges:

- **The PR cannot merge and cannot leave draft** (F1). The fix pass applied the report's own F1 as required status checks; this branch was cut before the `ci.yml` that produces two of those three contexts, so they will never report. One command clears it.
- **One prescription in the report was rejected by the fix pass**, and the report carries no marker saying so (F2). It is prior art a later session will re-propose.
- Three figure defects in the report, all of the class the report itself audits (F3, F4, F5).

Separately, the review missed one **High-severity hole in `audit-diff.sh`** that is still open on `main` (M1). It is not a defect in this diff and does not block it; it wants an issue.

**Recommendation: request changes** — F1 blocks the merge mechanically, F2 changes what the artifact teaches. Against this PR: 0 Critical · 1 High · 2 Medium · 2 Low. Missed by the report, for follow-up: 1 High · 1 Medium · 3 Low.

## Findings — against this PR

### High

**F1 · The PR body's merge claim is false now, and the PR is unmergeable and unflippable** — PR body ("Branched from `6d72261` … so it merges without a rebase"). True when written; invalidated 41 minutes later by a sibling merge, which is the guarantees-pass failure mode exactly.

`observed` 2026-09-10:

- `gh api repos/linardsb/taxi/branches/main/protection` → `required_status_checks: {strict: true, contexts: [check, audit-diff, codeql]}`, `enforce_admins: false`. The fix pass **applied** the report's own F1.
- `gh pr view 171 --json mergeStateStatus` → `BEHIND` — `strict: true` refusing an out-of-date head.
- `gh run view 34482925044 --json jobs` at head `107bb3a5` → **one job, `check`**. `audit-diff`, `codeql` and `ready` are absent.
- `git show origin/docs/pr-167-review:.github/workflows/ci.yml | grep -E "^  [a-z-]+:"` → `check:` only. The same on `origin/main` → `check:`, `audit-diff:`, `codeql:`, `ready:`.

`pull_request` runs the **PR branch's** copy of `ci.yml`, and this branch was cut at `6d72261`, one commit before #167's `ci.yml` landed. Two of the three required contexts can never report on this head, and `ready` — the job that flips the draft — does not exist on it. The PR is blocked except by the admin bypass, and nothing will take it out of draft on its own.

This is not a surprise: it is the merge-order trap `e0c7a0a` documented in runbook §5, **naming #171 as the observed case**, and the fixes report already records that `strict: true` put both #167 and #171 into `BEHIND`. It is still the live state of this PR, and the artifact being landed is the one surface that does not mention it.

- **Fix**: `gh pr update-branch 171`. Merging `a4832ca` in brings the new `ci.yml`; the next run produces all three contexts plus `ready`, which flips the draft. Then re-check `gh pr checks 171`.
- **Also fix**: the PR body's "so it merges without a rebase" sentence and its `merge-base --is-ancestor` evidence. Both were sound at 13:29Z; neither is now.

### Medium

**F2 · The report ships a prescription the fix pass rejected, with no disposition marker** — report `:34` (F3's fix part (1)), header `:3`. `.claude/reports/pr-167-review-fixes.md` opens with a section headed *"One prescription rejected, before anything else"*: F3's part (1) — a no-`needs` job running `gh pr ready --undo` at the start of every run — was **not** implemented, because it destroys the documented human bypass (the **Ready for review** button, PR body deviation 3): a job that re-drafts on every push undoes a human's override before any gate result exists. The rejection lives in the plan's AMENDMENTS and the fixes report. The report being landed states the prescription confidently, with its own `observed` citation from gh's source, and carries nothing.

Failure scenario: a session greps `.claude/code-reviews/` for prior art on the draft gate, finds F3(1) with an observed citation and no counter-note, and re-proposes it. That is the inheritance path `CLAUDE.md` names for figures — a claim flows plan → report → the next ticket and is inherited, not audited.

- **Fix**: one line in the report header — `**Dispositions**: `.claude/reports/pr-167-review-fixes.md` — 14 fixed, 2 deferred to issues (#172 F15, #173 F2), F3's fix part (1) rejected (it would destroy the human bypass).`

**F3 · F10's own wall range fails re-derivation by F10's own stated method** — report `:71`, restated at `:31`. F10 defines run wall as `createdAt`→`updatedAt`, and its whole subject is that a previous figure conflated that with the `check` job. Its replacement figure then does the reverse.

`observed` — `gh run view <id> --json createdAt,updatedAt,jobs`, all four named runs:

| Run | `check` job | Run wall (`createdAt`→`updatedAt`) | Attempts |
|---|---|---|---|
| 34471269249 | 198 s | 208 s | 1 |
| 34471798333 | 203 s | 213 s | 1 |
| 34472223208 | 195 s | **2 693 s** | **4** |
| 34476424460 | 206 s | 216 s | 1 |

The four `check` figures re-derive exactly — 198 / 203 / 195 / 206, to the second. "wall 208–216 s (`observed`, runs …)" names four runs and describes three: run 34472223208 is `11:36:51Z`→`12:21:44Z`, twelve times the top of the stated range, because it ran to attempt 4 and its `ready` job did not start until 12:21:39Z. The same understatement sits in F3(a), where the window between a push and its run reaching `ready` is given as "(`observed` 195–206 s on this PR's four runs)" — for that run the window to `ready` completing was 2 693 s.

No decision rides on it (the runbook cites the `check` figures, which are right), but it is the report's own bar: a figure under `observed` that one of its own named runs contradicts.

- **Fix**: "`check` 198 / 203 / 195 / 206 s across four runs; wall 208–216 s on the three single-attempt runs (34472223208 ran to attempt 4 and spans 2 693 s)". Same qualifier in F3(a).

### Low

**F4 · The report's own probe count disagrees with its table — F12's class, in the document that raises F12** — report `:130`. "Hook probes: 21 payloads, tabulated under F4 and F5." F4's table holds **14** data rows; F5 names **2** Edit probes in prose and has no table. Adding every probe named anywhere else (F8's one, F11's three) reaches 19–20, not 21, so the total is not re-derivable from the document, which is the same "pick one" state F12 files against #167's surfaces. It also carries no provenance label, under a heading called `Validation`. #171's PR body says "reproduced over 14 payloads", which matches the table and not the report.

- **Fix**: "14 tabulated under F4; further probes named in F5, F8 and F11" — or drop the total.

**F5 · Three provenance slips, none of which changes a conclusion**

- **`:58`, F5's PAT scope.** "That token is a classic `repo`-scope PAT of Linards' (`observed`: the gh session here carries `repo, workflow`)." A repository secret's scope is not readable from outside repo settings; the measurement the label points at is of a *different* token, the review session's own gh auth. The substance is sourced — `pr-gate.md:92` documents `PR_READY_TOKEN` as "A **classic** PAT of Linards' with the `repo` scope" — so F5's conclusion stands. Cite that line and drop the parenthetical.
- **`:34`, `:55`, external line numbers.** Both substances verified here (`observed` 2026-09-10, fetching each file's default branch): `cli/cli` `ready.go` — `if pr.IsDraft { … "is already \"in draft\"" … return nil }`, at lines **80-82** today, cited as `:89-93`; `AlertSuppression.qll` — `"(?i)\\blgtm\\s*\\[[^\\]]*\\]"` (65), `"(?i)(?<=^|;)\\s*lgtm(?!\\B|\\s*\\[)"` (68), `"(?i)\\bcodeql\\s*\\[[^\\]]*\\]"` (77), verbatim as quoted, cited as `:62,65,97`. Unpinned anchors in a permanent artifact, and the `AlertSuppression.qll` one justified a shipped code change. Cite a commit sha or permalink.
- **`:14`, unlabelled figures.** Line 7 promises every figure below is labelled `observed` / `derived` / `expected`. The Summary's extraction counts (287 / 244 / 67 / 30 / 0) carry "this review:" instead, and only the 287/0 subset is labelled, at `:105`. They are correct (recounted below); the label is missing on the surface a reader reads.

## What the report missed

Not defects in this diff, and none blocks it. They matter because a reader will take this report's coverage as the coverage. Each was reproduced here.

**M1 (High) · `audit-diff.sh`'s suppression guard is unreachable whenever the lockfile is unchanged — still open on `main`.** `observed` — `.github/scripts/audit-diff.sh:70-82` at `a2ca2f8`, and unchanged at `origin/main` (`:70-73` short-circuit, `:76` guard):

```
# 1. Short-circuit on an unchanged lockfile.
if git diff --quiet "$base" HEAD -- pnpm-lock.yaml; then
  echo "pnpm-lock.yaml unchanged vs $base; identical trees cannot differ in advisories"
  exit 0
fi

# 2. Suppression guard: an ignore list edited in this PR is red, not a fix.
```

A PR that adds `pnpm.auditConfig.ignoreGhsas` to the root `package.json` and nothing else changes no lockfile, so it exits 0 at `:73` and the guard never runs. A later PR adds the vulnerable dependency: the ignore list is now in the base, so no `^\+` line matches and the guard passes again; the head audit at the repo root (`:94`) reads the ignore list and drops the GHSA, the base audit in `$tmp/base` (`:91`) has only a lockfile and reports it, and `comm -13` therefore finds no new id. Green.

The filtering half is **`observed`**, not reasoned — three `pnpm audit --prod --json` runs over `6d72261`'s lockfile in bare temp dirs, one file added each time, picking `GHSA-p293-qw3h-jr36` (one of the two criticals):

| Temp dir contents | `advisories` length |
|---|---|
| lockfile + `package.json` with `pnpm.auditConfig.ignoreGhsas: [GHSA-p293-qw3h-jr36]` | **65** |
| lockfile + `pnpm-workspace.yaml` with `auditConfig.ignoreGhsas: [GHSA-p293-qw3h-jr36]` | **65** |
| lockfile alone (control) | **66** |

Both spellings work on pnpm 10, and neither file touches `pnpm-lock.yaml`. Both are in the guard's own `git diff` path list — the guard would catch either, if it ran.

The same-commit variant the design was written against *is* closed, because adding a dependency changes the lockfile — so the report's own "the ignore-list guard closes the obvious same-commit bypass" (`:134`) is correctly scoped and not the defect. Two other surfaces are not: `audit-diff.sh:19-23` ("is red before any audit runs") and `pr-gate.md:168` ("exit 1 in 0.06 s, before any audit", `observed`), neither of which names the lockfile condition. The report files F16 about a narrower hole in the same three lines, which is why a reader will read this area as audited.

- **Suggested**: `gh issue create` — move the suppression guard above the short-circuit, and qualify both prose surfaces. Two-line change.

**A note on the guarantees-pass trigger, found by running it.** The skill detects a moved base by comparing Phase 1's `baseRefOid` with the `**Base** … @ <sha>` in the previous round's report. `gh pr view 171 --json baseRefOid` returns `6523573` **after** `main` had already moved to `a4832ca` — the field is pinned at PR creation and does not track the base tip. So round 2 of this PR will compare `6523573` with the `6523573` in this header, find them equal, and skip the guarantees pass — on the PR whose only High finding *is* a guarantee broken by a base move. The trigger needs `git rev-parse origin/<baseRefName>` (or `mergeStateStatus == BEHIND`) beside it.

**M2 (Medium) · The same 313–361 s range carries two different `observed` provenance strings.** `pr-gate.md:51-52`: "313–361 s over the 8 `ci.yml` runs 34354276529 … 34462897943". `plan:585`: "Last 8 `ci.yml` runs: 313–361 s each (ids 34354124913 … 34460135710)". Both endpoints differ, and the runbook's upper bound `34462897943` is PR #166's run (`plan:588`), which post-dates the plan's window — so the runbook's eight runs cannot be the plan's eight, yet the range agrees to the second. That is the inherited-figure-with-fresh-provenance pattern. F10 corrects what the figure *means* and that it is stale, and reads three runs, but never notices that its two provenance strings disagree; a reader who applies F10 lands a corrected number on an unverified run set.

**M3 (Low) · A fourth surface carries the absolute F4 disproves, and F4's fix list omits it** — `ci.yml:118-119` at `a2ca2f8`, still `ci.yml:121` on `main`: "No model runs this: the hook refuses `gh pr ready` in every Claude session." F4's remediation names "the three runbook sentences" only, and F3 already cites the adjacent `:121-122` for the other absolute, so the lines were read. The fixed hook's own docstring (`pre_tool_use.py:26-30`, `:221-222`) now says the opposite in plain terms — writing a command into a script and running it "matches no pattern here", and the `.md` exemption "is also the escape hatch, and it is deliberate". `ci.yml`'s comment is the one surface left claiming otherwise.

**M4 (Low) · F9's surface list is incomplete** — it says "every downstream copy dropped the qualifier" and enumerates `ci.yml:60-61`, `pr-gate.md:123`, the implementation report and the PR body. It omits `plan:315-316`, the T6 IMPLEMENT block, which carries the same unqualified `2 critical, 47 high, 18 moderate, 1 low` and is the block `ci.yml`'s comment was copied from. Applying F9 from this list leaves the bad breakdown in the tree — the exact "grep the noun, read every hit" failure `CLAUDE.md` describes.

**M5 (Low) · Two supporting sentences are wrong where their findings are right.**

- **F15 `:83`** — "`codeql` runs on push to `main` only". The `codeql` job (`ci.yml:86`) has no job-level `if` and runs on every PR; only the *push trigger* is main-only (`:4-5`) and only the gate *step* is PR-gated (`:112`). The runbook's own table says "push to `main`, every PR". F15's conclusion — a feature-branch base never has a `refs/heads/<branch>` analysis — is correct.
- **F7 `:65`** — "there is no `-e`" is listed as part of the fail-open. It is not: `errexit` is disabled for a command in an `if` condition, so `set -e` would not catch this, and `plan:153` records not using `-e` as deliberate ("the scripts call commands whose non-zero exit is data"). `set -uo pipefail` at `codeql-gate.sh:43` is confirmed; the `set -u` half is the whole mechanism.

## Numbers pass

Every figure in the diff and the PR body, and what produced it.

| Figure (surface) | Provenance claimed | Re-derived |
|---|---|---|
| 1 file, 145 insertions, 0 deletions (PR body) | observed | `gh pr view 171` → additions 145, deletions 0, changedFiles 1. Holds |
| Branched from `6d72261`, ancestor of `main` @ `6523573`, merges without a rebase (PR body) | observed | `git merge-base` → `6d72261`; `--is-ancestor` → 0. **Arithmetic holds, conclusion does not** (F1) |
| Report head `a2ca2f8`, base `6d72261` (report `:3`, PR body table) | observed | `gh pr view 167 --json baseRefOid` → `6d72261868…`. Holds |
| 0 Critical · 5 High · 5 Medium · 6 Low (report `:20`, PR body) | observed | F1–F5 High, F6–F10 Medium, F11–F16 Low. Holds |
| `check` 198 / 203 / 195 / 206 s (report `:71`) | observed | Job timestamps agree to the second. Holds |
| Run wall 208–216 s over four runs (report `:71`) | observed | Three of four; the fourth is 2 693 s (F3) |
| Window to `ready` 195–206 s on four runs (report `:31`) | observed | Same three-of-four (F3) |
| Run figures 198/7/82 · 203/80/12 · 206/85/8/5 s (report `:97`) | observed | All twelve agree to the second. Holds |
| Flip at 12:21:42Z as linardsb (report `:5`, `:99`) | observed | `issues/167/timeline` → one `ready_for_review`, `2026-09-10T12:21:42Z`, `linardsb`. Holds |
| 21 hook payloads (report `:130`) | *unlabelled* | Not re-derivable from the document; the table has 14 (F4) |
| 66 advisories; by-advisory 2/46/17/1; `metadata.vulnerabilities` 2/47/18/1 = 68; 1 013 deps (report F9) | observed | Independently re-run here — `pnpm audit --prod --json` from `6d72261`'s lockfile alone in a bare temp dir: `advisories` length **66**; by severity **{critical 2, high 46, moderate 17, low 1}** = 66; `metadata.vulnerabilities` **{critical 2, high 47, moderate 18, low 1}** = 68; `totalDependencies` **1 013**. Every digit holds |
| CodeQL extracted 287 `apps/` · 244 `services/` · 67 `packages/` · 30 `db/` · 0 `app/` · 0 `backend/` (report `:14`, `:107`) | *unlabelled at `:14`* | Run 34476424460's `codeql` job log (job 102868186767): each file appears on two lines (`Extracting` + `Done extracting`), so 574/488/134/60 halve to **287 / 244 / 67 / 30**; `app/` and `backend/` absent. Holds exactly |
| 35 skipped + 681 passed = 716 (report `:93`, `:121`) | observed | Arithmetic holds; the 716-with-Redis run corroborates |
| `cli/cli ready.go:89-93`, `AlertSuppression.qll:62,65,97` (report `:34`, `:55`) | observed | Substance verbatim-correct; line numbers stale (F5) |

**Anchor pass** — every `file:line` in the report, checked against the tree at `a2ca2f8`. **All resolve**: `ci.yml:6-12` (#52's zero check runs), `:60-61` (the 66/2/47/18/1 comment), `:121-122` ("always means this head passed"), `:139` (`PR_READY_TOKEN`), `:146` (`--undo` last); `pre_tool_use.py:51` (`PR_READY_FLIP`), `:58-59` (`ALERT_DISMISS`, `SUPPRESSION_COMMENT`), `:129-145` (both dispatchers), `:142-143` (the `texts` list); `codeql-gate.sh:29-36`, `:73` (`2>&1` into the JSON stream), `:91-103` (the rc 44 branches), `:118-128` (the `awk` / `-gt` fail-open); `audit-diff.sh:76-77, 91, 94`; `CLAUDE.md:84`; plan `:24`, `:38`, `:205`, `:297`, `:334`, `:607`.

**F4's fourteen probe rows** were not re-executed, but all fourteen fall out of the source at `a2ca2f8` and every one is right:

- `is_pr_ready_flip` opens with `if tool_name != "Bash": return False` (`:131-133`), so every write-tool route to the flip is exit 0 by construction — the three Guard-4 rows.
- `SUPPRESSION_COMMENT = re.compile(r"\b(lgtm|codeql)\s*\[")` (`:59`) has no `re.IGNORECASE` and requires `\[`, so `// LGTM[…]` and bare `// lgtm` pass — and against the CodeQL regexes fetched above, both are live suppressions.
- `is_alert_suppression`'s Bash arm reads only `ALERT_DISMISS`, its write arm only `SUPPRESSION_COMMENT` (`:136-147`), so a comment written by `sed -i`, a heredoc or `python3 -c` passes — the three Bash-write rows.
- `ALERT_DISMISS = r"code-scanning/alerts/\d+.*dismiss"` (`:58`) requires the path *before* the word, so the flag-first ordering passes; `\d+` does not match `$n`, so the loop passes; `--input body.json` carries no later "dismiss", so it passes — the three dismiss rows. The three controls match their patterns.

Two more, the report's load-bearing ones, hold exactly:

- **F7's fail-open** — `codeql-gate.sh:122` is `new=$(… awk '{print $5}')`, `:124` is `[ "$new" -gt 0 ]`. Empty `$new` → test status 2 → `if` false → `:128-129` print "no new alert" and exit 0. `set -uo pipefail` (`:43`) does not catch a set-but-empty variable.
- **F8's refutation** — `plan:607` rejects a `--draft` guard because it "would also refuse the throwaway probes this plan needs", and `plan:334`, the plan's own probe, opens with `gh pr create --draft` (as does T13 at `:441`). The rationale is refuted by the plan carrying it.

`grep -in "do not modify|do not edit|read-only|no changes to|frozen"` over the plan: no GOTCHA freezes any file, matching the report's own statement.

## Validation

Documentation only — one markdown file, no source, no config, no test.

`observed` — CI run **34482925044** at head `107bb3a5`, the exact PR head, `check` green in 3m21s. That job is the full CI-parity gate: `pnpm turbo run typecheck lint test build` with `REDIS_TEST_URL: redis://localhost:6379`, a Redis service and a reachability probe (`git show origin/docs/pr-167-review:.github/workflows/ci.yml`, lines 16-50). It tested the merge with `main` at `6523573`; the post-`update-branch` run is what will actually gate.

`observed` — merge preview run locally: worktree at `a4832ca` (`main`'s tip) with this PR's file applied, `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://127.0.0.1:6381`, `pnpm turbo run typecheck lint test build --force`, exit 0:

```
 Tasks:    22 successful, 22 total
Cached:    0 cached, 22 total
  Time:    2m24.745s
```

`@taxi/api`: Test Suites 76 passed / 76 · Tests 721 passed / 721 (Redis suites ran, 0 skipped).

The file is inert to the gate — `turbo.json` declares no `globalDependencies`, and no package's build, lint or typecheck reaches `.claude/**` markdown — so this is a check on `main`, not on the diff. Stated as such rather than as evidence about the change.

## What is good

- **The anchors are right.** Twenty-plus `file:line` references across six files, every one landing on the line its finding describes. That is the part of a review report that rots fastest and it is the part done best here.
- **F9 reproduces to the digit** on an independent run — 66 / {2, 46, 17, 1} / {2, 47, 18, 1} / 1 013 — and names the right cause: two counters in the same JSON, with the qualifier that every downstream copy dropped.
- **The CodeQL scope figures survive a hostile re-derivation.** Pulling the `codeql` job log back and counting unique paths gives 287 / 244 / 67 / 30 and nothing under `app/` or `backend/` — the four numbers printed, to the file.
- **The four `check` durations and all twelve per-job figures re-derive to the second.** The report re-derived #167's figures rather than inheriting them, which is what `CLAUDE.md` asks and what two previous tickets did not do.
- **F8 is the best finding in it**: a documented decision re-opened because the plan's own probe refutes the rationale the plan gave for it. That is the reading a fresh-eyes pass exists for.
- **F4's probe table** is the right shape for a guard bypass — routes, payloads, exit codes, controls in the same table — which is what made it checkable from source without re-running anything.
- **F5 is correctly held at High rather than Critical**, with the blast-radius reasoning stated rather than asserted.
- The Numbers pass separates *claimed provenance* from *re-derived* and records the rows that **held** as well as the ones that did not, which is what makes the failures credible.
- Landing the report **off `origin/main` rather than onto the reviewed branch** is the correct call, and the PR body explains why with the five-orphan history behind it.

## What changed since the report's head (context, not findings)

The report is pinned at `a2ca2f8` and dated, so none of this is a defect in it. It matters only to a reader who opens the file cold:

- #167 **merged** at 14:10:52Z (`a4832ca`), after the fix pass closed 14 of the 16 findings.
- **F1 was applied**, not just re-documented: `main` now has required status checks (`check`, `audit-diff`, `codeql`, `strict: true`, `enforce_admins: false`).
- **F2 and F15 are issues**: #173 (SonarCloud) and #172 (stacked-PR CodeQL base). `gh pr checks 167` no longer lists SonarCloud.
- **F13 is fixed** — `CLAUDE.md`'s on-demand row now names `.github/scripts/codeql-gate.sh`.
- **F6's premise moved again**: `refs/heads/main` now has 1 CodeQL analysis (0 at review time). `refs/pull/999/merge` still answers `[]`, so the dead-branch finding stands.
- The "owed after merge" backlog-advisories chore issue still does not exist (`gh issue list --state all`).

## Two agent findings dropped

Recorded so they are not re-raised. The `code-reviewer` agent proposed both; neither survived reproduction here.

- **F3(a)'s citation of the plan's Q2 is fine.** The agent read the quoted clause as belonging to a counterfactual branch and named Q1 as the right surface. `plan:562` does carry "with Q1 the state self-corrects when B finishes" verbatim, describing the shipped configuration (Q1 *was* included), and that is what F3(a) says it says.
- **"Four figures did not survive re-derivation" is not a miscount.** The agent counted five contradicted rows in the Numbers pass. The fifth is the branch-protection row, which the Summary handles a paragraph earlier as a *premise* rather than a figure. Defensible as written.

## Recommendation

**Request changes.**

1. `gh pr update-branch 171`, then confirm `gh pr checks 171` shows `check`, `audit-diff`, `codeql`, `ready`, and that `ready` flips the draft (F1).
2. Fix the PR body's "merges without a rebase" sentence (F1).
3. Add the disposition line to the report header (F2).
4. Qualify the wall range in F10 and F3(a) (F3).
5. Optional, same commit: the probe count at `:130` (F4) and the three provenance slips (F5).
6. Separately: `gh issue create` for M1, the `audit-diff.sh` ordering hole, which is open on `main` today.

Nothing here argues against landing the report. It is a good artifact; it needs one command and four lines.
