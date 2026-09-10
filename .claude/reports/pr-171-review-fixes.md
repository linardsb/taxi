# PR #171 — round-1 review fixes

**Review** `.claude/code-reviews/pr-171-review.md` (round 1, head `107bb3a5`, base `main` @ `6523573`) · **Date** 2026-09-10
**Scope chosen by Linards**: fix everything the review raised against this diff; log the four defects already merged on `main` (M1–M4) plus the skill-trigger note as issues; land the round-1 review of #171 in this same commit rather than in a further PR of its own.

Round 1 raised, against this PR, 0 Critical · 1 High · 2 Medium · 2 Low, and named 1 High · 1 Medium · 3 Low the report missed. **9 fixed here, 5 logged as issues, 1 premise refuted.**

Both fixed files are markdown artifacts; the review's own Validation section establishes that they are inert to the gate (see **Validation** below).

---

## One premise refuted, before anything else

**F5's second bullet says both external citations are stale. They are not — both resolve exactly.** The bullet reads "`ready.go` — … at lines **80-82** today, cited as `:89-93`" and "`AlertSuppression.qll` — … (65), (68), (77) … cited as `:62,65,97`".

`observed` 2026-09-10, fetching each file at the commit that last touched it on the default branch (`GET /repos/{owner}/{repo}/commits?path=…&per_page=1`, then `raw.githubusercontent.com` at that sha):

| Citation in the report | Claimed by the review | Re-derived |
|---|---|---|
| cli/cli `pkg/cmd/pr/ready/ready.go:89-93` | at 80-82 today | `:89` `if opts.Undo {`, `:90` `if pr.IsDraft {`, `:91` the `already "in draft"` message, `:92` `return nil`, `:93` `}` — **the report is exact**. Lines 80-82 are the *closed*-PR branch. Sha `3bb5f54` |
| `AlertSuppression.qll:62,65,97` | at 65, 68, 77 | `:62` `(?i)\blgtm\s*\[[^\]]*\]`, `:65` `(?i)(?<=^|;)\s*lgtm(?!\B|\s*\[)`, `:97` `(?i)\bcodeql\s*\[[^\]]*\]` — **the report is exact**. Sha `c207cfd` |

The file blob at `3bb5f54` hashes to `7b985a3ce2439a4fb87abfcfcf3ddd4ee1e2532e`, which is what the contents API returns for the default branch, so "today" and "at that sha" are the same content.

**The prescribed fix was applied anyway**, because it is right for a different reason than the one given: the anchors are unpinned in a permanent artifact, and the review misreading them is itself the evidence that an unpinned anchor into someone else's repo is not checkable. Both now carry the commit sha. The *"stale"* claim is retired here so a later session does not re-raise it.

This is the memory rule in `taxi-review-payoffs-are-claims` doing its job: the review's prescribed fix was probed against the source before being applied.

---

## Fixed

### F1 (High) · The PR could not merge and could not leave draft

`main` moved to `a4832ca` (#167 merged at 14:10:52Z) 41 minutes after this PR was opened, and #167's own fix pass had applied required status checks with `strict: true`. This branch was cut at `6d72261`, one commit before the `ci.yml` that defines `audit-diff`, `codeql` and `ready`, so two of the three required contexts could never report on this head and nothing existed to flip the draft.

**Fixed by** `gh pr update-branch 171`, run **after** the fix commit was pushed (order matters: `update-branch` writes a merge commit to the remote branch, so running it first would have rejected the push).

**Closing commands**, run against the final head — see **Validation**.

**Also fixed**: the PR body's "so it merges without a rebase" sentence and its `merge-base --is-ancestor` evidence. Both were sound at 13:29Z; neither survived the sibling merge. Replaced with what holds now.

### F2 (Medium) · The report shipped a prescription the fix pass rejected, unmarked

`.claude/code-reviews/pr-167-review.md:7` — a new **Dispositions** line in the header. It names the fixes report, the 14/2 split, which issue carries which deferred finding, and states in full that F3's fix part (1) was **rejected and is not prior art**, with the reason (it destroys the documented human bypass) and what closes F3(a) instead (F1's server-side checks).

The counts were audited, not copied: `git show origin/main:.claude/reports/pr-167-review-fixes.md` exists and says "14 fixed, 2 deferred to issues"; its `### F…` headings enumerate F1, F3, F4, F5, F8, F11, F6, F7, F14, F16, F9, F10, F12, F13 = **14**, with F2 and F15 under *Deferred*. F3 **is** among the 14 — parts (2)–(4) shipped and only part (1) was rejected, so the line says "F3's fix part (1)", never "F3". `gh issue view 172` → "codeql-gate: a stacked PR always diffs against an empty CodeQL base (#165 F15)"; `gh issue view 173` → "Turn off SonarCloud automatic analysis…(#165 F2)". Both mappings confirmed.

**Closing command**, run against the fixed tree, 2026-09-10:

```
$ grep -n '^\*\*Dispositions\*\*' .claude/code-reviews/pr-167-review.md
7:**Dispositions** — `.claude/reports/pr-167-review-fixes.md`: **14 fixed, 2 deferred to issues** (#172 carries F15, #173 carries F2). …
```

### F3 (Medium) · F10's wall range failed re-derivation by F10's own method

`:73` (F10) and `:33` (F3(a)). The old text gave "wall 208–216 s (`observed`, runs …)" over four named runs and described three of them; run 34472223208 went to attempt 4.

Re-derived here rather than inherited — `gh run view 34472223208 --json createdAt,updatedAt,attempt,jobs`, `observed` 2026-09-10:

```
attempt   4
created   2026-09-10T11:36:51Z
updated   2026-09-10T12:21:44Z          → wall 2 693 s
check     11:36:54Z → 11:40:09Z         → 195 s   (the report's figure, exact)
ready     12:21:39Z → 12:21:43Z         → 2 692 s after createdAt
```

`derived`: 12:21:44 − 11:36:51 = 44 min 53 s = **2 693 s** for the wall; 12:21:43 − 11:36:51 = **2 692 s** for the window to `ready` completing. The review quoted 2 693 s for both; the second is 2 692 s and is written as such.

F10 now reads "`check` 198 / 203 / 195 / 206 s …; run wall 208–216 s on the three that finished on attempt 1 — 34472223208 ran to attempt 4 and its wall is **2 693 s** …". F3(a) carries the same qualifier with its own 2 692 s figure.

**Closing commands**:

```
$ grep -c '2 693 s' .claude/code-reviews/pr-167-review.md   → 1   (line 73, F10)
$ grep -c '2 692 s' .claude/code-reviews/pr-167-review.md   → 1   (line 33, F3(a))
```

### F4 (Low) · The report's probe count disagreed with its own table

`:132`. "21 payloads" replaced with what the document supports: **14** tabulated under F4 (rows at `:42-55` post-fix, `:40-53` in the reviewed file), plus the probes named in prose under F5 (2 — the `ci.yml` and `pre_tool_use.py` Edits), F8 (1 — `gh pr create` exit 0) and F11 (3 — `convertPullRequestToDraft` exit 0, and the two false positives). That enumerates to 20, not 21, so **no total is claimed** and the sentence says so. The 14 matches this PR's body ("reproduced over 14 payloads"), which needed no change.

It also now carries `observed`, which it lacked under a heading called *Validation*.

**Closing command**:

```
$ grep -n 'Hook probes' .claude/code-reviews/pr-167-review.md
132:… Hook probes (`observed`, this review): **14** tabulated under F4; further probes named in prose under F5 (2), F8 (1) and F11 (3). No single total is claimed — the earlier "21" was not re-derivable from this document.
```

### F5 (Low) · Three provenance slips

**(a) The PAT scope parenthetical** — `:60`. "(`observed`: the gh session here carries `repo, workflow`)" measured a *different* token: the review session's own gh auth, not the `PR_READY_TOKEN` repository secret, whose scope is not readable from outside repo settings. Replaced with the runbook row that actually documents it, labelled as a statement rather than a measurement. F5's conclusion is unchanged and its header already anchored `docs/runbooks/pr-gate.md:92` — verified present at `a2ca2f8` (`git show a2ca2f8:docs/runbooks/pr-gate.md | grep -n classic` → `92:| PR_READY_TOKEN | A **classic** PAT of Linards' with the repo scope | …`).

**(b) The two external line numbers** — `:36`, `:57`. Both now pinned to the commit that last touched the file. See **One premise refuted** above for why the *reason* given was wrong and the *fix* right.

**(c) The Summary's unlabelled extraction counts** — `:13`. Line 7 of the report promises every figure below is labelled. The 287 / 244 / 67 / 30 / 0 counts carried "this review:" instead. Now `` `observed`, this review, run 34476424460's `codeql` job log ``, which is the run the #171 review re-derived them from and matches the label already at `:107`.

Note for the next round: the #171 review anchors these counts at `:14`, `:34`, `:55`, `:58`, `:71`, `:130`. In the file at `107bb3a5` they are at `:11`, `:34`, `:55`, `:58`, `:71`, `:130` — the Summary anchor was one paragraph off (`:14` is blank). Every other anchor resolved. Post-fix the file is 2 lines longer above the Summary (the **Dispositions** line plus its blank), so those become `:13`, `:36`, `:57`, `:60`, `:73`, `:132` — verified by `grep -n`, not by arithmetic alone.

**Closing commands**:

```
$ grep -c 'repo, workflow' .claude/code-reviews/pr-167-review.md   → 0
$ grep -c '3bb5f54'        .claude/code-reviews/pr-167-review.md   → 1
$ grep -c 'c207cfd'        .claude/code-reviews/pr-167-review.md   → 1
$ grep -n 'observed`, this review, run 34476424460' … → 13
```

### M5a (Low, in-diff) · F15's supporting sentence about when `codeql` runs

`:85`. "`codeql` runs on push to `main` only" is false: the job has no job-level `if` and runs on every PR. `observed` at `a2ca2f8` — `ci.yml:4-5` is `push: branches: [main]`, `ci.yml:86` is `codeql:` with `runs-on`/`permissions` and no `if`, and the gate *step* is PR-gated at `:112`. Rewritten to name all three. F15's conclusion — a feature-branch base never has a `refs/heads/<branch>` analysis — is unchanged and correct.

Filed by the review under *"What the report missed"*; it is in fact a defect in this diff, so it was fixed rather than logged.

### M5b (Low, in-diff) · F7's "there is no `-e`"

`:67`. Listing the absent `-e` as part of the fail-open is wrong: `errexit` is suspended for a command in an `if` condition, so `set -e` would not have fired on `[ "$new" -gt 0 ]` either. `observed` — `.claude/plans/ci-no-model-pr-gate.md:153` records not using `-e` as deliberate: "`set -uo pipefail` (not `-e`: the scripts call commands whose non-zero exit is data, `pnpm audit` above all)". Rewritten to say `set -u` is the whole mechanism. F7's finding and its prescribed `case` guard are unchanged.

### Housekeeping · The round-1 review of #171 lands in this commit

`.claude/code-reviews/pr-171-review.md` was written into the main checkout (correctly — see the `taxi-pr-review-report-location` memory) and therefore belonged to no branch. Linards' call: land it here rather than open a further PR that would itself want a review. The file is unmodified from what the review session wrote; it is a pinned artifact and its own findings are answered by this report, not by editing it.

---

## Logged as issues — not fixed here

All five are outside this diff. M1–M4 are already merged on `main`; the fifth is a skill defect.

| # | Issue | What |
|---|---|---|
| M1 (High) | [#174](https://github.com/linardsb/taxi/issues/174) | `audit-diff.sh`'s suppression guard sits **below** the unchanged-lockfile short-circuit, so a two-PR bypass (add `ignoreGhsas` in one PR, the vulnerable dep in the next) is green. The filtering half was **re-run independently while filing the issue** rather than copied — `observed` 2026-09-10, pnpm 10.33.2, three fresh temp dirs over `6d72261`'s lockfile: 65 / 65 / 66, with `GHSA-p293-qw3h-jr36` absent from the two ignore-list dirs and present in the control. The issue names both runs and which one produced which column |
| M2 (Medium) | [#175](https://github.com/linardsb/taxi/issues/175) | The same 313–361 s range carries two different `observed` provenance strings (`pr-gate.md:51-52` vs `plan:585`), whose run sets cannot both be right |
| M3 (Low) | [#175](https://github.com/linardsb/taxi/issues/175) | `ci.yml:121` still carries the absolute the #167 review's F4 disproves; the fixed hook's own docstring says the opposite |
| M4 (Low) | [#175](https://github.com/linardsb/taxi/issues/175) | `plan:315-316` still carries the unqualified `2/47/18/1` breakdown F9 retired on four other surfaces |
| — | [#176](https://github.com/linardsb/taxi/issues/176) | `piv-review-pr`'s guarantees-pass trigger compares a `baseRefOid` that is pinned at PR creation, so it never fires on a moved base — reproduced, not reasoned |

M2, M3 and M4 are combined into one issue because each is a one- to three-line prose edit on the same tree and they will be swept together.

**#176 reproduced**, `observed` 2026-09-10 after `main` had moved:

```
$ gh pr view 171 --json baseRefOid --jq .baseRefOid
6523573f094c7e3dc515a456b68c75a8b128c100
$ git rev-parse origin/main
a4832cab0ec0af4e84d451c91cba36b53a345a04
```

Round 2 of this PR would compare `6523573` with the `6523573` in round 1's header, find them equal, and skip the guarantees pass — on the PR whose only High **is** a guarantee broken by a base move.

---

## Nothing needs a human look

No manual test is owed. Every change is prose in two markdown artifacts, and every claim in them was re-derived here rather than inherited.

One decision already taken by Linards and recorded above: M1 is a real High that stays open on `main` until #174 is worked, and this PR does not close it.

---

## The retired-value sweep

Every value and noun retired above, the exact `grep -n` run, and its hits. Run 2026-09-10 against the fixed worktree at `docs/pr-167-review`, and against `origin/main` for the surfaces no worktree grep can reach. `git grep` over `origin/main` covered `.claude/**`, `docs/**` and `.github/**`.

| Retired | Command | Hits in the report | Hits on `origin/main` | Hits in the PR body | Hits in the #167 comment |
|---|---|---|---|---|---|
| `21` (probe count) | `grep -rn '21 payload\|21 probe'` | 0 | 0 | 0 — the body already said 14 | **1** |
| `208–216` (wall over four runs) | `grep -rn '208–216'` | 1, inside the corrected sentence at `:73` | 0 | 0 | **1** |
| `195–206` as the F3(a) window | `grep -rn '195–206'` | 2 — `:33` corrected, `:97` is the `check` job range and is right | 3 — `plan:226`, `:525`, `:587`, all the `check` job and all correct | 0 | **1** |
| `repo, workflow` | `grep -rn 'repo, workflow'` | 0 | 0 | 0 | **1** |
| `ready.go:89-93` unpinned | `grep -rn 'ready.go:89-93'` | 1, now carrying `3bb5f54` | 0 | 0 | **1** |
| `AlertSuppression.qll:62` unpinned | `grep -rn 'AlertSuppression.qll:62'` | 1, now carrying `c207cfd` | 0 | 0 | **1** |
| "push to `main` only" (the noun, not the digits) | `grep -rn 'push to \`main\` only'` | 0 | 0 | 0 | **1** |
| "there is no `-e`" | `grep -rn 'there is no \`-e\`'` | 0 | 0 | 0 | **1** |
| `this review: 287` (unlabelled figures) | `grep -rn 'this review: 287'` | 0 | 0 | 0 | **1** |
| `1 file changed, 145 insertions` (PR body figure these commits invalidate) | `git diff --shortstat origin/main...origin/docs/pr-167-review` | — | — | rewritten to **3 files changed, 596 insertions(+), 0 deletions** at head `2e4e434`; `gh pr view 171` agrees (596 / 0 / 3) | — |

The `195–206` row is the one that needed reading rather than counting: the same digits are correct in three places on `main` and in one place in the report, and wrong in exactly one — the F3(a) window sentence, where they described a `check` duration as if it were the window to `ready`. Retiring the digits everywhere would have been the wrong sweep.

**The last column is the surface a working-tree grep cannot reach, and it held every one of the nine.** The round-1 review of #167 was posted as a comment on that PR (`issues/167/comments`, id `5618963984`, 22 553 characters) as well as landed as a file, and that copy is the more-read of the two. `observed` — `gh api repos/linardsb/taxi/issues/comments/5618963984 --jq .body` piped through the same greps: 1 hit each for all nine retired items.

It is not edited. A round-1 review comment is a timestamped artifact and rewriting it silently would be worse than leaving it. Instead a reply on #167 ([comment `5621664129`](https://github.com/linardsb/taxi/pull/167#issuecomment-5621664129)) names all nine as superseded — **seven in its table, and the two pinned external anchors in the bullets below it** — plus the rejected F3 part (1), and points at the corrected file. That reply is the closing evidence for this row.

The distinction is not pedantry: "tabulates all nine" is what this sentence said first, and it does not re-derive from the reply, whose table has seven data rows (`observed` — `gh api …/comments/5621664129 --jq .body | grep -c '^| '` → 8, one of which is the header). That is F4's defect — a count that does not fall out of the surface it describes — committed inside the paragraph that files it.

---

## Validation

Documentation only — three markdown artifacts, no source, no config, no test.

**The gate was not re-run for this commit, and here is why that is not a gap.** `turbo.json` declares no `globalDependencies`, and no package's `build`, `lint` or `typecheck` input reaches `.claude/**` markdown, so these files are inert to `pnpm turbo run typecheck lint test build`. The #171 review established the same and also ran the merge preview against `main`'s tip `a4832ca` with this PR's file applied — `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://127.0.0.1:6381`, `--force`, exit 0, `22 successful, 22 total` in 2m24.745s, `@taxi/api` 76 suites / 721 tests with the Redis suites included. That run is evidence about `main`, not about this diff, and is not restated here as if it were.

CI is the gate that matters for F1, because F1 *is* about which CI contexts exist on this head. Closing state, `observed` 2026-09-10 after `gh pr update-branch 171` — run **34498130572** at head `7ab7c51`, the merge commit:

```
$ gh pr checks 171
CodeQL       pass  3s
audit-diff   pass  9s
check        pass  3m32s
codeql       pass  1m9s
ready        pass  5s

$ gh pr view 171 --json isDraft,mergeStateStatus,headRefOid
draft=false  merge=CLEAN  head=7ab7c51
```

All three required contexts (`check`, `audit-diff`, `codeql`) now report on this head, `ready` ran and flipped the draft on its own, and `mergeStateStatus` went `BEHIND` → `BLOCKED` → `CLEAN`. `SonarCloud Code Analysis` is absent, as expected after #173 was actioned.

Job figures for this run, `derived` from `gh run view 34498130572 --json createdAt,updatedAt,jobs` timestamps:

| | Window | Seconds |
|---|---|---|
| `check` | 15:50:49Z → 15:54:21Z | 212 |
| `codeql` | 15:50:50Z → 15:51:59Z | 69 |
| `audit-diff` | 15:50:50Z → 15:50:59Z | 9 |
| `ready` | 15:54:24Z → 15:54:29Z | 5 |
| run wall | 15:49:13Z → 15:54:29Z | **316** |

`check` at 212 s sits just above the 198–206 s band F10 records for #167's four post-flip runs; the wall at 316 s is larger than the 208–216 s band because this run queued for 96 s before any job started (`createdAt` 15:49:13Z, first job start 15:50:49Z), which is the same `createdAt`-vs-job distinction F3 exists to keep straight. One run is not a range — this is a single `observed` point, not a replacement band.

This commit adds only this section, so the head moves past run 34498130572 and its own run re-confirms the same four contexts. The evidence above is about `7ab7c51`, and is not restated as being about a later head.

---

## Files changed

| File | Change |
|---|---|
| `.claude/code-reviews/pr-167-review.md` | **9 findings, 9 lines rewritten, 2 lines inserted** — the two counts agree at 9 by coincidence, not by construction, so both are stated. Findings: the **Dispositions** header line (F2); the wall qualifier in F10 and F3(a) (F3); the probe count (F4); three provenance slips (F5a/b/c); F15's `codeql`-trigger sentence (M5a); F7's `-e` sentence (M5b). F5b is one finding across two lines (the `ready.go` pin at `:36` and the `AlertSuppression.qll` pin at `:57`), and the Dispositions line is an insertion, not a rewrite — which is why the two ways of counting land in the same place from different directions. `observed` — `diff -u` of the file at `107bb3a` against the file at `2e4e434`: **11 added, 9 removed**; `git diff --numstat origin/main...origin/docs/pr-167-review` reports `147 0` because the whole file is new to `main` |
| `.claude/code-reviews/pr-171-review.md` | added, unmodified — the round-1 review this report answers |
| `.claude/reports/pr-171-review-fixes.md` | this file |
