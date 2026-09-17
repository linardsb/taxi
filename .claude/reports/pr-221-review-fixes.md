# PR #221 — review fixes, round 1

**Review**: `.claude/code-reviews/pr-221-review.md` (round 1 — **approve**, two Mediums, three Lows),
posted as [comment 5719745770](https://github.com/linardsb/taxi/pull/221#issuecomment-5719745770).
That file is **untracked in the main checkout** and is not in this PR — see *Needs a human decision*.
**PR**: [#221](https://github.com/linardsb/taxi/pull/221) · branch `docs/pr-219-review`, base `main`.
**Head this pass started from**: `f43ff80`, based on `7ec3bd7`. The branch was `BEHIND` and `main`'s
protection is `strict`, so it was rebased onto `origin/main` = `8ebf2ba` first — a local
`git rebase origin/main`, not GitHub's *Update branch*, which merges and produces a head sha the
author never made (memory `taxi-update-branch-merges-not-rebases`). Post-rebase head before the fixes:
`76469e1`, one commit, conflict-free.
**Outcome**: **all five review findings fixed, nothing deferred**, plus **two found here** (F6, F7)
that the review did not raise. Two items need a human decision; neither blocks the merge.

## Triage

| # | Severity | Call | What |
|---|---|---|---|
| F1 | Medium | **Fix now** | `pr-219-review.md` — the Summary's "every figure" absolute, plus the two quoted counts it did not re-derive (`nineteen`, and `44-48` cited "once") |
| F2 | Medium | **Fix now** | `main`'s `pr-219-review-fixes.md:4-5` and `:179` — "not pushed and has no PR" is falsified by this PR |
| F3 | Low | **Fix now** | the PR body — two sentences describing a state that ended when #219 merged |
| F4 | Low | **Fix now** | `pr-219-review.md:5` — the one header fact with no anchor; and the Recommendation's live-sounding closing instruction |
| F5 | Low | **Fix now** | `pr-219-review.md` F5's *Why Low* — "never re-swept" is an absolute a `git log` census falsifies |
| F6 | Medium | **Fix now** | *Found here, not in the review*: all **ten** rows of the copy-sweep table in `pr-219-review-fixes.md` state a command that returns a different number than the row claims |
| F7 | Low | **Fix now** | *Found here, not in the review*: the F4 pointer row pairs a post-fix line number with a pre-fix one; no tree carries both |

Nothing was deferred. Every finding is a documentation claim inside two files this branch already
touches or must touch, each costs one to a few clauses, and the repo rule they all sit under —
*"a number or a guarantee in a comment, plan or PR body is a claim, not decoration"* — does not have a
"later" tier.

Two items are carried to the evolution loop rather than fixed here, because they are `piv-review-pr`
skill edits and not in this diff; see *Carried to the evolution loop*.

## Fixes

### F1 (Medium) — the "every figure" absolute and the two counts behind it

**What was wrong.** `pr-219-review.md:17` claimed *"I re-derived every figure and every git-dependent
claim in both files … and sixteen of sixteen reproduce exactly."* The pass covered every figure the
two files **assert**; one they **quote** — round 1's `GOTCHA` count, block-quoted at `:176` — went
through unaudited, and it is wrong. A second, smaller instance sat at `:227`, describing round 1 as
citing `app.json:44-48` once when it cites it twice.

**Three edits, matching the review's prescription.**

1. `:17` — the claim is now bound to what the pass did (*"every figure … the two files **assert**"*)
   and the exception is named inline, with the correct digit and who corrected it.
2. `:179` — the block quote of round 1's sentence is **left verbatim**; correcting a digit inside a
   quotation would falsify the citation. The correction is appended outside it, with both extractions
   and all four shas, and a sentence saying the surrounding scope argument is unaffected by the count.
3. `:227` — now states the range is cited **twice**, names both line numbers **with the sha they are
   into** (`:21` and `:50` at `150e711`), and gives the post-fix pair on `main` (`:24`, `:59`).
   Mixing the two anchors is the defect F7 below is about.

All three line numbers above are into `pr-219-review.md` **at `f43ff80`**, the head the review read;
the edits themselves move everything below them, which is why no post-fix line number is quoted.

No bullet was added to *Claims re-derived*, deliberately: that section's own "All sixteen reproduce
exactly" is a count of its top-level bullets, and adding one would have minted a fresh stale figure.

**Closing commands, run against the fixed tree.**

```
$ grep -c '^- ' <Claims re-derived section of pr-219-review.md>     → 16
$ grep -n "All sixteen reproduce exactly" .claude/code-reviews/pr-219-review.md
410:Every figure and git-dependent claim I opened in both files. **All sixteen reproduce exactly.**
```

✅ Still consistent — the section still holds exactly sixteen bullets, so `:410` is unchanged and true.

```
$ for s in a71a6b1 bd5193a 3998e9b origin/main; do
    git show $s:.claude/plans/driver-device-day-prep.md | grep -cE "GOTCHA"; done
18  18  18  18
$ git show 150e711:.claude/code-reviews/pr-218-review.md | grep -n "app.json:44-48"
21:...  50:...
```

✅ Both re-derived here, not inherited from the review.

### F2 (Medium) — `main` carries two sentences this PR falsifies

**What was wrong.** `.claude/reports/pr-219-review-fixes.md` landed on `main` at `8ebf2ba` saying, at
`:4-5` and again at `:179` (both **at `8ebf2ba`**, before this pass), that `docs/pr-219-review` is
*"not pushed and has no PR"*. This PR **is**
that branch, pushed, with a PR — so merging it makes `main`'s own text false. `:4-5` was unqualified
and carried no sha.

**What changed.** `:4-5` is now bounded to the pass that wrote it (*"which **at the time of this pass**
(at `f43ff80`) was not pushed and had no PR"*) and names #221. The *Needs a human decision* item at
`:179` is struck through and marked closed, with #221 named and the tense corrected.

**Why this file is in this PR at all.** It is on `main`, not on this branch — the rebase is what put it
in the tree. That rebase was compulsory: `main`'s protection is `strict` (up-to-date-before-merge), so
#221 could not merge while `BEHIND` regardless of this finding. The edit is free in the sense that the
branch had to move anyway.

**Closing command, run against the fixed tree.**

```
$ grep -rn "not pushed\|has no PR\|unpushed" .claude/reports/pr-219-review-fixes.md
5:`f43ff80`) was not pushed and had no PR — see *Needs a human decision* below. It is now
180:1. ~~**`docs/pr-219-review` is unpushed and has no PR.**~~ **Closed — it is
```

✅ Two hits, both now the bounded/struck form. No unqualified claim survives.

### F3 (Low) — the PR body describes a state that ended when #219 merged

**What was wrong.** Two sentences. The Validation section closed with *"#219's `BEHIND` state is a
two-way-diff artefact"* — #219 has no `BEHIND` state; it MERGED at 18:40:08Z as `8ebf2ba`. And the
Summary stated *"Verdict: request changes — one High (F1), two Mediums (F2, F3), six Lows (F4–F9)"*
with nothing marking it as the landed file's content rather than a live call.

**What changed.** The body was rewritten: the Summary now says this PR lands the round-1 record and
that #219 merged with all nine findings fixed; the Validation section names `8ebf2ba` and drops the
`BEHIND` sentence; *What changed* is re-derived for the new three-file diff. See *The PR body* below —
it was edited **after** the final commit, because the fixing commit moves the figures it states.

### F4 (Low) — the one header fact with no anchor, and a live-sounding instruction

**What was wrong.** The `**State**` header line read `**State**: OPEN, ready for review,
mergeStateStatus: BEHIND · all five checks pass` — bare present tense about a PR that is now MERGED
with its branch deleted, while every other header fact carries its sha. The Recommendation's closing
line (*"Fix the body with `gh pr edit 219 --body-file` … and this is an approve"*) reads as a standing
direction.

**The review's locator for this one is off by one.** The finding heads itself `pr-219-review.md:5`;
`:5` is the `**Round**` line. The `**State**` line is **`:6`** — `observed`,
`git show f43ff80:.claude/code-reviews/pr-219-review.md | grep -n '^\*\*State\*\*'` → `6`, and the
same at `150e711` and in the working tree, so it is not edit drift. The fix was anchored to the text
rather than to the number. Recorded rather than silently corrected, because a wrong pointer inside a
finding about unanchored header facts is the review's own F4 shape one level up.

**What changed.** The `**State**` line now reads `**State** (read 2026-09-17 at head `150e711`): …`.
The Recommendation
gains one clause naming it as the round-1 call at `150e711` and recording that #219's fix pass applied
all nine findings and #219 merged at `8ebf2ba`.

### F5 (Low) — "never re-swept" is falsified by four of the sixty-five

**What was wrong.** The report's own F5 set its severity on the repo's norm being *"a dated artifact
anchored by sha, **never re-swept after the branch moves**"*. Four of the 65 prior files have more than
one commit, two of them edited by #112 and #121 — the two tickets the same report cites as precedent.

**What changed.** The *Why Low* paragraph now leads with the leg that does the work (the anchor sha),
states the census as **61 of the 65 carry a single commit** with the command that produced it, names
all four exceptions and what each edit did, and keeps the conclusion on the narrower and true ground:
the repo re-sweeps a landed review when a *claim* in it is wrong, not when locators drift.

**Closing command, run against the fixed tree.**

```
$ grep -rn "never re-swept\|never re-sweep" .claude/ docs/
(no hits)
$ for f in $(git ls-tree --name-only origin/main .claude/code-reviews/); do
    n=$(git log --oneline origin/main -- "$f" | wc -l); [ "$n" -gt 1 ] && echo "$n  $f"; done
5  .claude/code-reviews/pr-110-review.md
3  .claude/code-reviews/pr-121-review-round3.md
2  .claude/code-reviews/pr-121-review.md
2  .claude/code-reviews/pr-147-review-round3.md
```

✅ The absolute is gone from the tree, and the four exceptions re-derive (total commits; minus the
landing commit gives the 4 / 2 / 1 / 1 post-landing figures the review's table states).

### F6 (Medium) — *found here*: all ten copy-sweep rows state a command that returns a different number

**What was wrong.** `pr-219-review-fixes.md` closes with a *copy sweep* table — the artifact
`CLAUDE.md` asks for so a reviewer *"diffs a list instead of trusting a sentence"*. Its framing line
said every row was `grep -rn … --include='*.md' .` **from the repo root**; three later rows widen to
`.claude/ docs/` instead. Either way the printed command is wider than the count beside it, and **no
tree produces any of those counts**, because they omit the report's own rows and the report is itself
a `.md` inside the searched scope.

`observed` at `8ebf2ba`, the merge commit that landed the file — stated → what the stated command returns:

| Retired thing | Row stated | The stated command returns |
|---|---|---|
| `nineteen` | 0 | **5** |
| `1087` / `1088` | 1 each | **4** each |
| `44-48` | 2 | **4** |
| `eas.json:11` | 0 | **2** |
| `zero hits` | 3 | **6** |
| `Every round-1 finding` | 2 | **4** |
| `exempt per #112` | 0 | **2** |
| `untracked` | 1 | **24** |
| `env:create` | 6 | **10** |
| `stub_sent` | 6 | **51** |

**Why it is a Medium and not a Low.** The *checks* were sound — the executable verifier at the end of
the same report asserts each retired value against `"$R1"` / `"$R2"` file-scoped, and all of those
still pass. What was wrong is the **printed command**, which was wider than the check it summarized. A
reader who runs the printed command gets a number the row denies, and the table's whole purpose is to
be re-runnable. It is the same defect class as the review's F1 one level up, and it is on `main`.

**What changed, and why not simply re-count.** Re-counting would state a repo-root figure that is
head-dependent on the very file stating it — any later edit to the report moves it, which is exactly
`taxi-report-restating-pr-body-figures`. Instead each row's **command was narrowed to the file the
check is about**, matching what the verifier runs; unrelated hits elsewhere are named per row with
their file. The stated → actual gap above is recorded in a note above the table, anchored at `8ebf2ba`,
so the correction names what it retires.

**Closing command, run against the fixed tree.**

```
$ R1=.claude/code-reviews/pr-218-review.md; R2=.claude/code-reviews/pr-218-review-round2.md
$ grep -c "nineteen" "$R1"                 → 0
$ grep -c "44-48" "$R1"                    → 0
$ grep -c "eas\.json:11" "$R1"             → 0
$ grep -c "1087" "$R2" ; grep -c "1088" "$R2"  → 1 ; 1
$ grep -c "zero hits" "$R2"                → 1
$ grep -c "Every round-1 finding" "$R2"    → 0
$ grep -c "exempt per #112" "$R1" ; … "$R2"    → 0 ; 0
```

✅ Every narrowed command returns what its row now states.

### F7 (Low) — *found here*: a post-fix line number paired with a pre-fix one

**What was wrong.** The F4 pointer row read *"`spikes/gps-harness/app.json:44-48` (twice — Summary
`:24` and F1 `:50`)"*. `:50` is the pre-fix line; `:24` is the **post-fix** one. Pre-fix the two sites
are `:21` and `:50`; post-fix the corrected range sits at `:24` and `:59`. **No tree carries `:24`
together with `:50`.**

**What changed.** The row now gives both pairs with the shas they are into, and a parenthetical
recording that the earlier pairing was mixed.

**A note for the round-2 reviewer, not a fix.** #221's review reproduced this `:24`/`:50` pairing and
supplied a mechanism for it — *"`:24` rather than `:21` because that pass worked from `7926ba1`, where
F5's three-line `**Locators**:` block had already pushed the Summary down"*. The tree falsifies that
mechanism: `observed`, `git show 7926ba1:.claude/code-reviews/pr-218-review.md | grep -n "44-48"` →
**21, 50**, identical to `150e711`. The Summary hit does not move at `7926ba1`; `:24` is post-fix. That
sentence is in `.claude/code-reviews/pr-221-review.md`, which is untracked in the main checkout and not
in this PR, so this pass cannot edit it — it is recorded here instead. It is the *"real output plus an
inferred mechanism"* shape the review itself names as the #121 trap.

**Closing command, run against the fixed tree.**

```
$ for s in 150e711 7926ba1 8ebf2ba; do
    git show $s:.claude/code-reviews/pr-218-review.md | grep -n '44-48' | cut -d: -f1; done
150e711 → 21 50    7926ba1 → 21 50    8ebf2ba → (none)
$ git show 8ebf2ba:.claude/code-reviews/pr-218-review.md | grep -n '42-47' | cut -d: -f1
24  59
```

✅ Both pairs re-derived here.

## The copy sweep — commands and hits

Each retired value and each retired **subject** from this pass, with the exact command and its output
against the fixed tree, so the next reviewer diffs a list rather than trusting a sentence
(`CLAUDE.md`). Run from the worktree root.

| Retired thing | Command | Hits | Status |
|---|---|---|---|
Every command below is **scoped to the file whose claim was retired** — the F6 lesson, applied to this
table. A repo-root grep returns more for most of these rows, because *this* report is also a `.md` and
has to name each value it retires; where that matters the cell says so.

| Retired thing | Command | Hits | Status |
|---|---|---|---|
| `never re-swept` (F5) | `grep -c "never re-swept\|never re-sweep" .claude/code-reviews/pr-219-review.md` | **0** | ✅ gone from the fixed file. Repo-wide the phrase returns **6**, every one of them in *this* report naming what F5 retired |
| *"every figure … in both files"* (F1) | `grep -c "every figure and every git-dependent claim" .claude/code-reviews/pr-219-review.md` | **1** — now bounded with `the two files **assert**` | ✅ bounded, not deleted |
| `nineteen` (F1) | `grep -n "nineteen" .claude/code-reviews/pr-219-review.md` | **3** — all three are the *corrected* form or the verbatim quote it corrects | ✅ kept deliberately: a correction has to name what it corrects |
| `not pushed` / `has no PR` / `unpushed` (F2) | `grep -c "not pushed\|has no PR\|unpushed" .claude/reports/pr-219-review-fixes.md` | **2** — one bounded to the pass that wrote it, one struck through and marked closed | ✅ no unqualified claim left. Line numbers deliberately omitted: they move with every later edit to that file |
| bare `**State**:` (F4) | `grep -c '^\*\*State\*\*: ' .claude/code-reviews/pr-219-review.md` | **0** — the only `**State**` line now carries `(read 2026-09-17 at head `150e711`)` | ✅ anchored |
| wide sweep commands (F6) | `grep -c 'grep -rn' .claude/reports/pr-219-review-fixes.md` | **1** — the correction note quoting the retired form. **0** in the table's ten rows, all narrowed to `"$R1"` / `"$R2"` | ✅ commands match their checks |
| `:24` paired with `:50` (F7) | ``grep -c 'Summary `:24` and F1 `:50`' .claude/reports/pr-219-review-fixes.md`` | **0** | ✅ gone |
| `510` (the PR body's size figure) | `grep -c '510' ` over both edited files | **0** — the figure lives only in the PR body, which no working-tree grep reaches | ⚠️ re-derived after the final commit; see *The PR body* |

**The subject sweep, not just the values.** `never re-swept` is retired as a *claim*, so the noun was
grepped too: `re-swept` / `re-sweep` across `.claude/` and `docs/` returns only the new bounded
sentence in `pr-219-review.md`. `nineteen` is retired as a *digit* but kept as a *quotation*, which is
why its three surviving hits are correct rather than stale.

## Validation

| What | Command | Result |
|---|---|---|
| Rebase onto the live base | `git rebase origin/main` in `wt-review219` | ✅ `Successfully rebased`, one commit, zero conflicts; `76469e1` on `8ebf2ba` |
| Fix verifier, fixed tree | the 42-assertion `verify-219.sh` reproduced in `pr-219-review-fixes.md`'s appendix (extract it between `#!/usr/bin/env bash` and `ALL FIX ASSERTIONS HOLD` — the line range moves with every edit to that file), run from the worktree root | ✅ **42 PASS, 0 FAIL**, `ALL FIX ASSERTIONS HOLD`, exit 0 — `observed`, this pass, re-run after every edit above |
| Every finding's closing command | the code blocks under each F above | ✅ all run against the **fixed** tree, outputs quoted inline |
| Full local gate | **not re-run** — reasoning below | inherited, corroborated, not re-observed here |
| CI on the pushed head | `gh pr checks 221` | see *The pushed commit* |

**Why the local gate was not re-run, stated rather than silently skipped.** This branch touches three
markdown files under `.claude/`, outside every package directory. `observed` — `turbo.json` declares
no `inputs` on any task and no `globalDependencies` key, so nothing under `.claude/**` can reach a
task's cache key; #221's own reviewer re-derived this independently and accepted the argument. Against
that, several `claude` sessions share this checkout and integration runs drop the shared test DB
(`taxi-concurrent-sessions`, `taxi-gate-hangs-on-red-api-suite`), so a re-run is net-negative and can
kill another session's gate. **CI is the real gate here**, and the force-push re-runs `check`,
`audit-diff` and `codeql` against the new base — which is the point of F2's fix being free.

## Carried to the evolution loop, not fixed here

Both are one-line `piv-review-pr` trigger changes, outside this diff. The review raised them itself as
*"not a finding"*.

1. **The guarantees pass is gated on a prior review round** (*"No prior report → first round, skip
   it"*), but the comparison it needs — `baseRefOid` against the base branch's live tip — needs no
   prior report. #221 is round 1, its base moved between push and review, and running the pass anyway
   is what returned F2.
2. **The numbers pass does not reach a figure inside a block quote.** `CLAUDE.md` says to re-derive a
   figure you are copying; a digit inside a quotation reads as attribution rather than as a claim,
   which is where F1's `nineteen` slipped — twice, since the review under F1 inherited it and #221's
   own review then inherited the `:24`/`:50` pairing (F7).

## Needs a human decision

1. **`.claude/code-reviews/pr-221-review.md` is untracked in the main checkout and is in no branch.**
   It is the review this report answers. Memory `taxi-pr-review-report-location` records exactly this
   failure five times over (#138–#142, landed late as #143), and #219's own fix report raised the same
   item one level down — which became F2 above. It needs its own `docs/pr-221-review` branch off
   `main` and a PR, or it orphans. **Not folded into this PR**, because a review must not ride the PR
   it reviews.
2. **The merge itself.** The loop ends at a green, ready PR (`taxi-merge-is-human-only`). #221 is now
   rebased onto `8ebf2ba`, so the `BEHIND` state that blocked it under `strict` protection is cleared.

## The pushed commit

*(filled in after the push — see the PR body for the re-derived diff size, which is set last because
the fixing commit moves it)*
