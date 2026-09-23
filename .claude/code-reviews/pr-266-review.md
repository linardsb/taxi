# PR #266 review — round 1

**PR**: [#266](https://github.com/linardsb/taxi/pull/266) — *docs(reviews): PR #265 rounds 1 and 2 — round 2 requests changes, one High reopened, three Mediums*
**Head** `b6ea12d` · **Base** `main` @ `d6207be` (live `origin/main` = `efebad7`, #265's squash merge)
**Diff**: 3 files, +1,179 / −0 · documentation only (three review reports), no shipped source
**Reviewed**: 2026-09-23, fresh context, read from the PR's worktree at `b6ea12d`, no checkout
**Verdict**: **approve**, 0 Critical, 0 High, 1 Medium (F1), 1 Low (F2). Fix F1 before merging: it is a `gh pr edit`, and the title becomes the squash commit on `main`.

---

## Summary

The three reports are sound as records. Their arithmetic reproduces, the round-3 citations I
re-ran against `1161bfd` resolve (one range is 2 lines off, F2), each file is byte-identical to
the comment posted on #265 (`observed`: `diff` of each file at `b6ea12d` against its comment body,
the only difference being the trailing newline `jq` adds), and every head sha they pin
(`6eec024`, `c0f487d`, `1161bfd`) is still fetchable: each is an ancestor of
`refs/pull/265/head` = `5e0e636` (`observed`, `git merge-base --is-ancestor`). The reports
therefore stay checkable after #265's branch deletion.

**What is wrong is the PR's own description (F1).** The title, the size table, the verdict and
the validation paragraph all describe the branch at `4d9dd66`, before round 3 was committed
(`b6ea12d`, +244 lines). Nothing in the body mentions round 3, its High (F14), or that #265 has
since merged.

---

## Issues by severity

### F1 — Medium · the title and body describe two of the three reports

PR title and body · `.claude/code-reviews/pr-265-review-round3.md` (the unmentioned file)

| Body says | At head `b6ea12d` (`observed`) |
|---|---|
| title: *"PR #265 rounds 1 and 2 — round 2 requests changes…"* | three rounds; the latest verdict is round 3's: request changes, 1 High (F14), 3 Low |
| *"`observed` at `4d9dd66`: 546 + 389 = 935 added, 0 deleted, 2 files, 3 commits"* | true at `4d9dd66`; at head `git diff --numstat origin/main...HEAD` gives 546 + 389 + 244 = **1,179**, 3 files, **4** commits |
| What-changed table: two rows | three files; `pr-265-review-round3.md` has no row |
| Validation: *"#265's gate at its head `c0f487d`, which round 2 reviewed"* | round 3 reviewed `1161bfd` (run 35777127601, per its own §Validation) |
| *"Base `d6207be`, unmoved since round 1"* | true of #265 through all three rounds. Not stale, but #266 itself is now `BEHIND` `efebad7`, which is #265's merge (2026-09-23T07:04:06Z). The body does not say that #265 has merged |

The `4d9dd66` figures carry their sha, so they are not false. They describe a commit that is no
longer the head, and the title is what lands on `main`. This is the report-restating-PR-body
failure in the other direction: the body was not re-derived after the last commit.

**Worth one line in the new body:** #265 merged at `5e0e636`, a round-3 fix commit no review
round saw. Its F14 closure does hold on `main` (`observed`): runbook `:382` now reads *"Six steps
are not green (4, 7, 9, 10, 12, 13)"*, `grep -F 'force-assign, reassignment'` → 0, and report
§T11 carries step 7 at `:423` and `:429`. Without this line, a reader of #266 sees round 3's
High with no record of how it ended.

**Fix**: `gh pr edit 266` — title → *"docs(reviews): PR #265 rounds 1–3 — round 3 requests
changes, one High (step 7 unowned)"*; add the round-3 row to the table; re-derive the numstat at
the head; add a round-3 brief and the merge line above; cite round 3's run (`1161bfd`,
run 35777127601) in the validation paragraph alongside `c0f487d`.

### F2 — Low · round 3 cites §T11's count line 2 lines low

`.claude/code-reviews/pr-265-review-round3.md:67`, `:208` (and the range at `:35`, `:53`)

Round 3 places *"Four things are genuinely unrun"* at report `:413` and the list at `:413-424`.
At `1161bfd` (`observed`, `git show 1161bfd:… | grep -n`): the sentence is at **`:411`**, item 5
starts at `:423` and runs to `:425`, and the recommendation is at `:427` (correct as cited).
The finding does not change.

**Fix**: none in the file. It is byte-identical to the comment posted on #265, and editing it would
make the landed record differ from what was posted. This entry is the correction: `:413` → `:411`;
`:413-424` → `:411-425`; §T11 as a whole is `:404-431` (heading to the line before
`## Validation results`).

---

## Validation

| Check | Result |
|---|---|
| CI `check` @ `b6ea12d` | ✅ run [35780123367](https://github.com/linardsb/taxi/actions/runs/35780123367), `head_sha` `b6ea12d`, `pull_request`, 20:24:55Z → 20:28:30Z = 3m35s (`observed`, `gh api …/jobs`) |
| `audit-diff` · `codeql` · `CodeQL` · `ready` | ✅ ✅ ✅ ✅ |
| `mergeStateStatus` | `BEHIND`, not draft. `git merge-tree --write-tree origin/main HEAD` → clean: #265 added no file under `.claude/code-reviews/` |
| Base | no prior `pr-266-review*.md`, so this is round 1 and the guarantees pass and the fix-mechanism pass do not apply. Base did move (`d6207be` → `efebad7`); see F1 |
| Local full gate | **not run.** The diff is three Markdown files, CI ran `typecheck lint test build` at this exact sha, and integration runs collide across sessions |
| `code-reviewer` agent | **not dispatched**, a deviation from Phase 4. Its rubric (TypeScript, contracts, state machine, money, slices) has nothing to check in three review reports. What they do contain, figures and citations, I re-ran below |
| Constraint pass | skipped: no plan or implementation report for this PR |

---

## The numbers pass

| Figure | Where | Verdict |
|---|---|---|
| 546 + 389 = 935, 2 files, 3 commits at `4d9dd66` | PR body | ✅ at that sha; ❌ as the PR's size, **F1** |
| round 1: `842 + 434 + 165 = 1,441` | round 1 header, numbers pass | ✅ sum |
| round 2: `846 + 439 + 218 + 167 = 1,670` | round 2 | ✅ sum |
| round 3: `846 + 439 + 160 + 218 + 167 = 1,830`, 3 deleted, 22 commits | round 3 | ✅ `git diff --numstat d6207be 1161bfd`, `git rev-list --count` = 22 |
| install 72.7 s after `completedAt`, 64.2 s before the first offer | round 3 `:205` | ✅ 15:23:16 − 15:22:03.251; 15:24:20.152 − 15:23:16 |
| 67 m 06 s submit → complete | round 3 F17 | ✅ 14:14:57.231 → 15:22:03.251 |
| round 3 F14: Outcome *"force-assign … all pass. Five steps stay owed"*; §T11 *"Four things"* over five items; F15's *"assigns every step but 10"*; F16's `:384` list without 4, 9, 12 | round 3 | ✅ each quoted text present at `1161bfd` (runbook `:382`, `:384`; report T11; fixes `:25`) |
| *"Four things"* at report `:413` | round 3 | ⚠️ **F2**: `:411` |
| *"all 20 commits carry `+0100`"*; *"concedes two of round 1's F10 rows"* | PR body | ✅ round 2 `:173-174`, `:274-277` |

---

## What's good

- **The reports correct themselves in writing.** Round 2 concedes two of round 1's F10 rows and
  names three of round 1's misses as the review's own. Round 3 does the same for round 2's
  unsourced *"53 min"* (F17). A later reader can see where each round was wrong.
- **Every closure is re-run, not read.** Rounds 2 and 3 each carry a closure table with the
  command and its count, so this round could check them.
- **The PR lands the reports verbatim.** Each file matches its #265 comment byte for byte, so the
  record on `main` is the review that was posted. As the body says, #138–#142's reports were
  orphaned until #143.

---

## Recommendation

**Approve.** No Critical or High issues, CI green at the head, and the reports do what the PR
claims. Fix **F1** before merging: the title becomes the commit subject on `main`, and the body is
the only place a reader learns that round 3 exists and that #265 merged with its F14 fixed. F2 needs
no edit.

*Reviewed with `piv-review-pr`, round 1. Fresh context; round 3's citations re-resolved at
`1161bfd`, sha reachability checked against `refs/pull/265/head`, F14's closure checked on `main`.*
