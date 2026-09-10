# PR #167 — round-1 review fixes

**Review** `.claude/code-reviews/pr-167-review.md` (round 1, head `a2ca2f8`, base `6d72261`) — landed separately on PR #171, posted as a comment on #167 on 2026-09-10.
**Fixed at** `a2ca2f8` + this commit · **Base unchanged** `6d72261` · **Date** 2026-09-10
**Scope chosen by Linards**: all code and prose defects; F1 applied as required status checks (strict); F8's guard added; F15 and F2 deferred to issues.

Round 1 raised 0 Critical · 5 High · 5 Medium · 6 Low. **14 fixed, 2 deferred to issues.**

---

## One prescription rejected, before anything else

**F3's proposed part (1) — a no-`needs` job running `gh pr ready --undo` at the start of every run — was NOT implemented.** The review offered it to close F3(a)'s window. It would destroy the control the same runbook depends on: the **Ready for review** button is the documented human bypass for the red-leaning first run (PR body deviation 3), and a job that re-drafts on every push undoes a human's override before any gate result exists. Round 1 proposed it without checking it against that bypass.

F3(a)'s window is instead closed **server-side** by F1's required status checks, which refuse the merge rather than fighting the draft state. F3's parts (2), (3) and (4) are implemented as written.

Recorded in the plan's AMENDMENTS so it is not re-proposed.

---

## Fixed

### F1 (High) · The stale "branch protection is unavailable" premise — **and the control itself**

The 403 was real while the repo was **private**; it went public the same day and the APIs opened. Applied rather than only re-documented.

- `docs/runbooks/pr-gate.md` intro rewritten: names *private* as the condition that changed, both observations with their dates.
- **New `docs/runbooks/pr-gate.md` §5** — the protection, what it closes that the flip cannot, what it costs, and the read-back command.
- `.claude/plans/…-report.md` AMENDMENTS entry.

**Closing command**, run against the fixed tree:

```
$ gh api repos/linardsb/taxi/branches/main/protection --jq '{strict:…,contexts:…,admins:…}'
{"admins":false,"contexts":["check","audit-diff","codeql"],"strict":true}
```

`ready` is deliberately **not** a required context: it consumes the other three and fails by design on a stale head (F3c). `enforce_admins: false` keeps Linards' one bypass.

**What the mechanism newly costs** (`observed` 2026-09-10, immediately after the PUT): `strict: true` put both open PRs into `mergeStateStatus: BEHIND` — #167 and #171 must be brought up to date with `main` before they merge. `gh pr update-branch <N>`, or rebase and force-push.

### F3 (High) · "ready always means this head passed" was false by three routes

- **(2) The stale re-run (F3c) — fixed in code.** `.github/workflows/ci.yml`: `ready` gains `HEAD_SHA` and a first step comparing it with `gh pr view --json headRefOid`, exiting 1 **without touching the PR** on mismatch.
- **(3) Both surfaces reworded** to what holds — *"the head CI last finished testing passed"* — in `ci.yml`'s `ready` docblock and runbook §0, each stating the window and pointing at §5.
- **(4) `gh pr merge` refused by the hook.** The skills all say a human merges; nothing enforced it.
- **(a) and (b)** — the push-to-run window and a head that never gets a run (#52) — are closed by F1, and the runbook now says which control closes which.

**Closing commands:**

```
$ grep -n "headRefOid\|HEAD_SHA" .github/workflows/ci.yml
154:      HEAD_SHA: ${{ github.event.pull_request.head.sha }}
164:          live=$(gh pr view "$PR" --repo "$GITHUB_REPOSITORY" --json headRefOid -q .headRefOid)
165:          if [ "$live" != "$HEAD_SHA" ]; then
$ grep -rn "always means" .github/workflows/ci.yml docs/runbooks/pr-gate.md
  (no hits)
$ python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml')); print(list(d['jobs']), d['jobs']['ready']['needs'], len(d['jobs']['ready']['steps']))"
['check', 'audit-diff', 'codeql', 'ready'] ['check', 'audit-diff', 'codeql'] 2
```

Guard logic exercised both ways locally (`observed`): `live=bbbb` vs tested `aaaa` → exit 1, refused; `live=aaaa` vs `aaaa` → proceed. The `gh pr view … --json headRefOid` call shape returns this PR's real head.

**What this fix's mechanism newly permits:** the guard is fail-closed — an empty or unexpected `live` fails the string comparison, so the step exits 1 and the PR is left untouched (`observed` in the local probe: `live=""` and `live=bbbb` both refuse). The one behaviour change to note: on a stale re-run the job now exits **before** the `--undo` branch, so a stale red run no longer re-drafts. That is correct — the current head's own run decides — and the failed `ready` check attaches to the old head, not the PR's.

`observed` live at `6d0351f` (run 34485378247, job 102899451589): the step printed `head confirmed: 6d0351fd4bd12b95e760afea1b9db04cd2d063fc` and the job went on to the green branch, printing `already "ready for review"` and exiting 0. Only the success branch has been exercised by a real run; the refusal branch is `observed` locally, not in CI.

### F4 (High) · Both hook guards were bypassed by the tool they did not inspect

`.claude/hooks/pre_tool_use.py`, rewritten around a shared `_guarded_texts()`:

- Guards 4 and 5 now read **Bash command text and write-tool text** (`Edit`/`MultiEdit`/`Write`/`NotebookEdit`), for every path except `.md`. `.md` stays exempt so this runbook and the skills can document the phrases — the exemption is deliberate and named in the docstring.
- `SUPPRESSION_COMMENT` is `re.IGNORECASE` and covers the **bare** form, because CodeQL's own matcher does (`AlertSuppression.qll` uses `(?i)\blgtm\s*\[…\]`, `(?i)(?<=^|;)\s*lgtm(?!\B|\s*\[)`, `(?i)\bcodeql\s*\[…\]`).
- `ALERT_DISMISS` is anchored on the **PATCH**, in either word order, and covers `--input` — which also removes the false positive that blocked a plain read.

### F5 (High) · The gate, the hook and the PAT were reachable from the PR's own tree

- **New guard 6, `GUARD_FENCE`**: write-tool edits to `.github/workflows/`, `.github/scripts/`, `.claude/hooks/` and `.claude/settings.json` are refused, same shape and message as the anketa fence. `.claude/settings.local.json` is deliberately **not** fenced — it is the user's own config.
- The runbook now states plainly, in the intro and in §1 and §3, that **a hook guarding its own file is a mitigation, not a boundary**, and that §5 is the control a branch cannot rewrite.
- Narrowing the PAT to `public_repo` is left to Linards (**manual, below**).

### F8 (Medium) · `gh pr create` without a draft flag

Refused, naming #165. The plan declined this guard because it would block T7's throwaway probes; T7's own text opens with `--draft`, so that cost does not exist.

### F11 (Low) · Text-match gaps

`convertPullRequestToDraft` added to the flip pattern (the comment already said re-drafting is CI's; the pattern did not). The PATCH-anchored dismiss pattern removes the read false positive.

### Closing evidence for F4, F5, F8, F11 — 44 payloads, run against both hooks

`scratchpad/hooktest.py`, `observed` 2026-09-10. **Against the shipped (unfixed) hook: 20 failures**, each one a hole the review named:

| Route | Old | New |
|---|---|---|
| flip written into a `.sh` / `.py` then run | allowed | **blocked** |
| `convertPullRequestToDraft` mutation | allowed | **blocked** |
| `gh pr merge` (command, and written into a script) | allowed | **blocked** |
| `gh pr create` without `--draft` | allowed | **blocked** |
| dismiss with the flag before the URL / in a loop / via `--input` / `--method PATCH` | allowed | **blocked** |
| suppression comment via `sed -i`, heredoc, `python3 -c` | allowed | **blocked** |
| suppression comment `UPPERCASE` / bare form | allowed | **blocked** |
| write to `ci.yml`, a gate script, the hook, `settings.json` (relative and absolute) | allowed | **blocked** |
| **read** an alert's `dismissed_reason` | *blocked* (false positive) | **allowed** |

**Against the installed hook: 44 payloads, 0 failures**, including every pre-existing guard (dotenv, `rm -rf`, the anketa fence), the `.md` exemption, `.claude/settings.local.json`, an ordinary source edit, a doc under `.github/`, and empty stdin failing open.

**Live end-to-end through the real tool path** (not the harness): an `Edit` on `.github/workflows/ci.yml` changing `ready.needs` to `[check]` — the exact weakening F5 demonstrated — was refused by the installed hook, and `ci.yml` was unchanged afterwards (`grep -n "needs: \["` → `147: needs: [check, audit-diff, codeql]`). A Bash command containing the merge phrase was refused the same way.

### What these fixes' mechanisms newly permit — probed, one hole found and closed

`scratchpad/mechtest.py`, `observed`:

| Probe | Result |
|---|---|
| **F8 fail-open**: `mkdir -d tmp && gh pr create …` — an unrelated `-d` satisfying the draft check | **was `allowed` — a real hole introduced by the fix.** Closed: the draft flag is now searched in the same command segment as the create (`CMD_SPLIT`), and the probe is `BLOCKED` |
| F4 cost: a PATCH and an alerts **read** in one script | `BLOCKED` — `DOTALL` matches across commands. Fail-closed, accepted |
| F4 cost: a `.sh` naming the flip in a comment | `BLOCKED`. Fail-closed, accepted; `.md` is the escape hatch |
| F5 limit: `sed -i` on a fenced path | `allowed` — Bash is not a write tool. **Documented, not closed**, in the hook docstring and runbook |

### F6 (Medium) · "a PR ref with no analysis is red" had become dead code

Once the repo had any upload, the alerts endpoint stopped answering 404 `no analysis found` and began answering `[]` for a never-analysed ref — identical to a clean one — so the exit-1 branch could not fire and *unscanned* would have read as *clean*.

`.github/scripts/codeql-gate.sh` gains `analyses()`, which counts `code-scanning/analyses?ref=` **before** listing alerts. The 44-branch is kept as belt-and-braces.

**Closing commands, live against this repo:**

```
$ .github/scripts/codeql-gate.sh --pr 167 --base main --repo linardsb/taxi   → exit 0
::warning::no CodeQL analysis on refs/heads/main yet; …
codeql-gate: no new alert … (0 open on the PR, 0 at the gate's severity, 0 open on the base)
$ … --pr 999 …   → exit 1   ::error::no CodeQL analysis for refs/pull/999/merge
$ … --pr 171 …   → exit 1   (a real PR whose run had not finished)
```

Both branches the review called dead are now reachable: `--pr 999` is red again, and the base warning fires because `main` genuinely has 0 analyses (`observed`: analyses per ref — `refs/pull/167/merge` 4, `refs/pull/999/merge` 0, `refs/heads/main` 0, `refs/heads/does-not-exist` 0).

### F7 (Medium) · The counts line failed **open**

An absent or malformed `COUNTS` line left `$new` empty; `[ "" -gt 0 ]` errors with status 2, the `if` takes the else branch, and the script printed "no new alert" and exited **0**.

**Regression test, run against the unfixed code first** (`observed`) — a copy of each script with the `COUNTS` prefix sabotaged, fed the fixture where 2 alerts *should* be reported:

```
unfixed   exit=0  "no new alert at high/critical or error on …"     ← green on unreadable output
fixed     exit=2  "could not parse its counts line: '' (#165)"
```

All four counters are validated, not just `new`.

### F14 (Low) · stderr merged into the JSON stream

`fetch()` captured `2>&1`, so a `gh` warning on a successful call would break `jq -s` and exit 2. stderr now goes to its own file.

**F6/F7/F14 no-regression**: the 7 fixture cases still behave — 2-new → exit 1; backlog-only → exit 0; empty base → exit 1 with 2 new; not-JSON → 2; not-an-array → 2; no args → 2; one fixture only → 2. `bash -n` clean.

### F16 (Low) · The base audit never reads `.npmrc`

The base audit runs in a temp dir with no `.npmrc`; the head audit runs at the repo root with one. An added `registry=` line points the head audit at a **different** registry — a quieter one reports fewer ids and the diff comes back empty. A larger lever than any ignore list, and structural to the script's step 3.

`^\+[^#]*registry\s*=` added to the suppression guard (now a single `SUPPRESSION_RE`, used by both the test and the report line, which were duplicated).

**Test, unfixed vs fixed**, end-to-end in a scratch worktree with the lockfile touched and `registry=https://quiet.example/` appended to `.npmrc` (`observed`):

```
unfixed   exit=1 in 72s   ::error::head audit output is not JSON (registry error?)   ← passed the guard; red only incidentally, because the host happened to be unreachable
fixed     exit=1 in  0s   ::error::an audit ignore list or registry changed in this PR…
                          8:+registry=https://quiet.example/
```

A *real* quieter registry would have returned valid JSON with fewer ids, and the unfixed script would have been **green**. Regex probe: added `registry=` and `@scope:registry=` blocked, ignore keys blocked, a commented-out line and a *removed* line allowed. No false positive on this PR: `audit-diff.sh origin/main` → exit 0, short-circuit (lockfile unchanged).

### F9 (Medium) · The audit breakdown did not sum to its total

Re-derived from `6d72261`'s lockfile alone (`observed` 2026-09-10), not inherited:

| Counter | Value | Sum |
|---|---|---|
| `.advisories` map — **what the gate diffs** | 2 critical / **46** high / **17** moderate / 1 low | **66** |
| `metadata.vulnerabilities` — a different counter | 2 / 47 / 18 / 1 | 68 |

`.metadata.dependencies` = 1013 holds.

**Surfaces swept** (`grep -rn '47 high'`): `.github/workflows/ci.yml:61` ✅ corrected and both counters named · `docs/runbooks/pr-gate.md:123` ✅ corrected, counter named · `.claude/plans/…:316` ✅ inline marker + AMENDMENTS · `.claude/reports/…-report.md:69` ✅ line kept with a correction block beneath it, so the claim has a subject · **PR body** ✅ rewritten · **issue #165's own body** ❌ **missed by this sweep** — it carries the same counts as a severity table (`critical | 2 advisories`, `high | 47 advisories`) rather than the `2/47/18/1` string the grep looked for. Found by #175 M4's re-sweep on 2026-09-10 and corrected in place with a block beneath the table. Grepping the string, not the noun, is what let it through.

### F10 (Medium) · "about six minutes / `check` 313–361 s" was stale the day it shipped

Re-derived (`observed` 2026-09-10, `gh run view` job timestamps on PR #167's four runs):

| Run | wall | `check` |
|---|---|---|
| 34471269249 | 208 s | 198 s |
| 34471798333 | 213 s | 203 s |
| 34472223208 | **2693 s** | 195 s |
| 34476424460 | 216 s | 206 s |

`check` is **195–206 s**; push-to-flip about **3.5 min**. 313–361 s was run **wall** over 8 runs that all predate the repo going public. Run 34472223208's wall is 2693 s because it sat between the PAT retries — a second reason to cite the job, not the wall.

**Surfaces swept** (`grep -rn '313'`): `.claude/skills/piv-create-pr/SKILL.md:130-131` ✅ the live surface a future run reads · `docs/runbooks/pr-gate.md:50-53` ✅ corrected, with a note naming the retired claim · `.claude/plans/…:226,523,585` ✅ inline markers + AMENDMENTS · `.claude/reports/…:69` ✅ correction block · **PR body** ✅ rewritten.

### F12 (Low) · The payload count disagreed across surfaces

The table's nine rows carry **12 payloads** (three in row 1, two in row 7) — 11 files plus one empty-stdin case. Neither "thirteen" (report) nor "12 payload files + empty stdin" (PR body) matched it. The session's scratchpad is gone, so the on-disk file count is **not re-derivable**; the report now says so rather than picking a number.

### F13 (Low) · `CLAUDE.md` on-demand row

`.github/scripts/codeql-gate.sh` added; the row now also names branch protection as a trigger.

---

## Deferred — logged as issues

| Finding | Issue | Why deferred |
|---|---|---|
| **F15** (Low) · a stacked PR always diffs against an empty CodeQL base | **#172** | Harmless while the tree has 0 gated alerts (`observed`). Becomes real at the first one. Two options costed in the issue. |
| **F2** (High) · `SonarCloud Code Analysis` is a red check | **#173** | **Not a code change** — disable automatic analysis on sonarcloud.io or uninstall the app. Outside `ci.yml` and outside `ready.needs`. Do it before the next PR opens. |

## Needs a human

1. **#173 — the SonarCloud red check.** The only finding from round 1 that this branch cannot close.
2. **Narrow `PR_READY_TOKEN` to `public_repo`.** F5's remaining half. The secret holds a classic `repo`-scope PAT that reaches every repository of the account, private ones included. `public_repo` is its public-only subset and the repo is public now; one re-run of `ready` verifies. Not done here — rotating a secret is Linards'.
3. **Both open PRs are `BEHIND`** now that `strict: true` is on (#167, #171). Update before merging.
4. **Merge order matters exactly once.** `pull_request` runs the PR branch's own `ci.yml`, so a branch cut before this ticket produces only the `check` job — and the three required contexts never report. `observed` 2026-09-10: `gh pr checks 171` lists `check` and `SonarCloud` only, no `audit-diff`, `codeql` or `ready`, because `docs/pr-167-review` was cut from `6d72261`. **Merge #167 first** (its branch carries the jobs, and its run at `6d0351f` reported all three green), then `gh pr update-branch 171`. Documented in runbook §5; not a defect, but it would read as a stuck PR. Found by re-checking #171 after applying protection, not before.

---

## Validation

`observed` — `record-gate.sh --clean` with `COMPOSE_PROJECT_NAME=taxi` and `REDIS_TEST_URL=redis://127.0.0.1:6381`, main checkout, **exit 0**:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m30.912s
```

| Package | Result |
|---|---|
| @taxi/api | 76 suites / 76 · **716 tests passed / 716** (Redis suites ran: 0 skipped) |
| @taxi/dispatch | 27 files · 224 tests |
| @taxi/driver | 41 suites · 214 tests |
| @taxi/rider | 30 suites · 143 tests |
| @taxi/shared | 24 files · 231 tests |
| @taxi/db | 3 files · 17 tests |

Not in the graph (the known legitimate absences): `@taxi/config#*`, `@taxi/driver#build`, `@taxi/rider#build`.

The feature itself has no test framework (hooks, workflows, shell), so it was run instead: 44 hook payloads + 5 mechanism probes, 7 `codeql-gate.sh` fixture cases + 3 live runs, 2 `audit-diff.sh` end-to-end runs + a 7-line regex probe, `bash -n` on both scripts, and a YAML parse of `ci.yml`.

## Files changed

`.github/workflows/ci.yml` · `.github/scripts/codeql-gate.sh` · `.github/scripts/audit-diff.sh` · `.claude/hooks/pre_tool_use.py` · `docs/runbooks/pr-gate.md` · `CLAUDE.md` · `.claude/skills/piv-create-pr/SKILL.md` · `.claude/plans/ci-no-model-pr-gate.md` · `.claude/reports/ci-no-model-pr-gate-report.md`

Repo settings (not in the diff): required status checks on `main`.
