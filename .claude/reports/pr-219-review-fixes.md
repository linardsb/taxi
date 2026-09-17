# PR #219 — review fixes, round 1

**Review**: `.claude/code-reviews/pr-219-review.md` (round 1 — request changes, one High, two Mediums,
six Lows). That file lives on branch `docs/pr-219-review`, which **at the time of this pass** (at
`f43ff80`) was not pushed and had no PR — see *Needs a human decision* below. It is now
[#221](https://github.com/linardsb/taxi/pull/221), which lands that file and carries this correction.
**PR**: [#219](https://github.com/linardsb/taxi/pull/219) · branch `docs/pr-218-review`, base `main`.
**Head this pass started from**: `7926ba1` — GitHub's *Update branch* merge of `main` into the branch,
made after the review was written at `150e711`. The review's findings were re-checked against `7926ba1`,
not inherited from `150e711`.
**Outcome**: all nine findings fixed, nothing deferred. One further defect (F10) was found while applying
F3 and fixed in the same pass.

## Triage

| # | Sev | Call | Why |
|---|---|---|---|
| F1 | High | **Fix now** | The PR body is the surface a human reads before merging, and it describes a different PR. One `gh pr edit`. |
| F2 | Medium | **Fix now** | An absolute claim this PR's own merge falsifies. One clause, at the claim site. |
| F3 | Medium | **Fix now** | The constraint pass ran on 1 of 9 findings and missed the one case it exists to catch. Two edits plus a re-run of the pass. |
| F4 | Low | **Fix now** | Four wrong pointers in a report whose own subject is wrong pointers. |
| F5 | Low | **Fix now** | One header clause per file; sha-anchored so the clause cannot itself go stale. |
| F6 | Low | **Fix now** | An `observed` total with no command behind it, in the one bullet arguing the raw diff misleads. |
| F7 | Low | **Fix now** | A rule citation that sends the next reader to #112 for an exemption #112 does not grant. |
| F8 | Low | **Fix now** | The Summary and the F-table disagree about F1. |
| F9 | Low | **Fix now (stated, not re-rated)** | See below — the re-rating cascades into the PR title and a posted comment on a merged PR for no change in verdict. |
| F10 | — | **Fix now** | Found here, not in the review: round 1 said the plan has *nineteen* `GOTCHA`s. It has eighteen, at every sha. |

Nothing deferred, nothing filed as an issue: every finding is a clause or a citation inside two files
this PR exists to land.

## What was fixed

Two files changed, both under `.claude/code-reviews/`: `pr-218-review.md` (round 1) and
`pr-218-review-round2.md` (round 2).

### F1 (High) — the PR body

Rewritten with `gh pr edit 219 --body-file`. Four claims corrected: the file count and size figure,
the inverted verdict, the single posted-comment link (there are three on #218 — `5715582096` round 1,
`5716087200` round 2, `5716100986` the M2 correction), and the Validation anchor, which covered only
the half of this PR that round 1 reviewed.

**The size figures are deliberately not restated here.** They move with the commit that carries these
fixes, and a report quoting them is stale by construction (memory `taxi-report-restating-pr-body-figures`,
#212). The body was edited **after** the push, from `git diff --numstat origin/main..origin/docs/pr-218-review`
at the pushed head — a command that is head-current whenever the next reader runs it, which is the
check to re-run rather than a digit to compare against.

### F2 (Medium) — the mirror sweep's scope

`pr-218-review-round2.md`: *"Nothing cites it by line"* is now bounded to the tree the grep ran in
(`bd5193a`), with a following paragraph saying that round 1 and round 2 both cite the runbook by line
and that #219 puts them on `main` — so the result is true of what #218 ships and stops being true of
the repo the moment #218's own review lands. **No locator count is written into either file**: this
pass's own edits move it.

### F3 (Medium) — the constraint pass

Two edits in round 1, one in round 2.

1. **F5's Fix now leads with the in-plan remedy** (one sentence in §0 saying the edit stays
   uncommitted) and carries its own constraint pass. The `eas env:create` prescription is demoted to
   *the rejected alternative*, cited to the plan's `DECIDED` bullet at
   `.claude/plans/driver-device-day-prep.md:555-565` @ `a71a6b1` (`:566-…` @ `bd5193a`, `:573-586` on
   `main` — all three given, because the report is anchored at `a71a6b1` and the plan has moved twice
   since).
2. **F2's constraint pass records its own scope and the wider re-run.** It read `GOTCHA` bullets only
   and was the report's only pass. Re-run at the anchor over all three bullet kinds — 18 `GOTCHA`,
   3 `DECIDED`, 9 `PATTERN` — exactly one finding is hit: F5.
3. **Round 2's F5 row** now names which half of round 1's prescription was contra-plan: the lead one.

### F4 (Low) — four pointers

| Was | Now | Checked by |
|---|---|---|
| `spikes/gps-harness/app.json:44-48` — **twice**, in the Summary and in F1. Pre-fix both sites sit at `:21` and `:50` (identical at `150e711` and `7926ba1`); post-fix the corrected range sits at `:24` and `:59`. *(An earlier draft of this row paired the post-fix `:24` with the pre-fix `:50`, which no tree carries — corrected in [#221](https://github.com/linardsb/taxi/pull/221).)* | `:42-47` at both sites | `grep -n '"extra": {'` → 42; `grep -n '"owner"'` → 47; `git show 7926ba1:"$R1" \| grep -n '44-48'` → 21, 50 |
| `apps/driver/eas.json:11` (F5 header) | `:10`, with the `env` block as `:9-11` | `git show a71a6b1:apps/driver/eas.json \| grep -n EXPO_PUBLIC_API_URL` → 10 |
| `auth.otp.stub_sent` (`:20`), `auth.sms.stub_sent` (`:33`) reading as `stub-push.provider.ts` | named as `auth/sms/stub-sms.provider.ts`, with a sentence saying why the bare form resolved against the wrong file | `grep -n` in `stub-sms.provider.ts` → 20, 33 |
| *"an untracked home at `.env.example:53`"* | the **key** has a home in the committed (tracked) env template; the untracked file is `.env`, ignored at `.gitignore:14`; and `:53` carries `localhost`, not a LAN address | `git ls-files --error-unmatch` succeeds; `.gitignore:14` |

Round 1's Summary claim — *"all but two (F7, F8) land exactly"* — was the copy this finding created,
and now says the count covers the PR's claims and that four of this report's own pointers missed.

### F5 (Low) — locator anchors

A `**Locators**:` line on each header: round 1's point into the runbook's **231**-line version at
`a71a6b1`, round 2's into the **289**-line version at `bd5193a`, each with the `git show` that
reproduces it. Both are sha-anchored, so the clause cannot go stale as `main` grows; neither states
`main`'s current count, which would.

### F6 (Low) — the lockfile totals

`1087 → 1088` is **withdrawn**, not replaced with a guess: it reproduces under no extraction tried
here or in the review. The delta the bullet exists to make — one package added, none removed — keeps
its place, now with the extraction printed beside it:

```
git show <sha>:pnpm-lock.yaml | awk '/^packages:/{f=1;next} /^snapshots:/{f=0} f && /^  [^ ]/' | wc -l
```

→ **1649** @ `b690e91`, **1650** @ `a71a6b1` (`observed`). This is *an* extraction named, not *the*
correct total: the review lists four candidate key-set definitions over the same file and they differ.
Naming which one produced the digits is the whole of `CLAUDE.md`'s provenance rule here. The bullet
also now states that the lockfile is byte-identical at round 2's head (`git diff a71a6b1 bd5193a --
pnpm-lock.yaml` is empty), which is what makes a figure derived at `a71a6b1` valid in a round-2 report.

### F7 (Low) — the 500-line cap

`#112` dropped as the reason. The cap does not reach markdown because it binds shipped source a
package build compiles (`CLAUDE.md:60`); #112's named exemptions are `.spec`/`.test`, `test/`/`tests/`
and `scripts/`, and a PIV artifact is in none of them and needs none.

### F8 (Low) — "every round-1 finding is closed"

Now *"Eight of round 1's nine findings are closed outright … F1's second half — the `:46` row — is
not, and carries into M1 below."* F1's row in the F-table is marked `◑` with a one-line legend above
the table.

### F9 (Low) — L1's grade

**Stated, not re-rated**, and the choice is the finding's own second option. L1 now answers the
comparison head-on: the only thing separating it from round 1's F3/F6 (same failure mode, graded
Medium twice) and from M1's rejection of the "a correct note sits elsewhere" defence is that L1's cell
carries *"see the two notes below"* **inside the text being read**, where F3's, F6's and M1's `:46`
row carry nothing referring the reader onward. The paragraph says plainly that if that distinction
does not persuade, the grade that should move is L1's upward, not round 1's downward.

Re-rating was rejected on cost, not on merit: it would move round 2's header count, the PR title and
comment `5716087200` on a **merged** PR, for no change in verdict — #218 shipped L1's fix in `9eb1527`
either way.

### F10 — found while applying F3, not in the review

Round 1 read *"The plan's nineteen `GOTCHA`s"*. `git show a71a6b1:.claude/plans/driver-device-day-prep.md
| grep -c '^- \*\*GOTCHA'` → **18**, and 18 at `bd5193a` and `7ec3bd7` too, so it was never nineteen.
Corrected to eighteen, with the count now derived in the text from a printed command.

## The copy sweep — commands and hits

Each retired value and each retired **subject**, grepped in the file whose claim was retired.
`R1` = `.claude/code-reviews/pr-218-review.md`, `R2` = `.claude/code-reviews/pr-218-review-round2.md`,
the two files this pass edits and the two the executable verifier at the end of this report asserts
against (`nchk … "$R1"`). Hits elsewhere in the repo are named in the cell and are different subjects.

> **Corrected in [#221](https://github.com/linardsb/taxi/pull/221)** — found there, not in #221's
> review. As first written, **all ten rows** stated a wide command (`grep -rn … --include='*.md' .`
> from the repo root, or over `.claude/ docs/`) beside a count that command **does not produce**,
> because the count omitted this report's own rows and this report is a `.md` inside the searched
> scope. `observed` at `8ebf2ba` (the merge that landed this file) — stated → what the stated command
> returns: `nineteen` 0 → **5**; `1087`/`1088` 1 each → **4** each; `44-48` 2 → **4**; `eas.json:11`
> 0 → **2**; `zero hits` 3 → **6**; `Every round-1 finding` 2 → **4**; `exempt per #112` 0 → **2**;
> `untracked` 1 → **24**; `env:create` 6 → **10**; `stub_sent` 6 → **51**.
>
> The *checks* were sound and all still pass — the executable verifier below asserts each retired
> value against `"$R1"` / `"$R2"` file-scoped, `42 PASS, 0 FAIL`. What was wrong is the **printed
> command**, which was wider than the check it summarized, so a reader who runs it gets a number the
> row denies. That is precisely what `CLAUDE.md` means by making the sweep checkable rather than a
> feeling. Each command below has been narrowed to the file its check is about; the counts themselves
> did not move.

| Retired thing | Command | Hits | Action |
|---|---|---|---|
| `nineteen` (F10) | `grep -c "nineteen" "$R1"` | **0** after the fix | — |
| `1087` / `1088` (F6) | `grep -c "1087" "$R2"`, `grep -c "1088" "$R2"` | **1** each — the withdrawal sentence itself | kept deliberately: the withdrawal has to name what it withdraws |
| `44-48` (F4) | `grep -n "44-48" "$R1"` | **0** after the fix; **2** before it, at `:21` (Summary) and `:50` (F1) — identical at `150e711` and `7926ba1`. One unrelated hit elsewhere in the repo, `pr-147-review-round3.md:44`, a `compose.prod.yml` range | both sites corrected to `:42-47`, now at `:24` and `:59` |
| `eas.json:11` (F4) | `grep -c "eas\.json:11" "$R1"` | **0** after the fix | — |
| `zero hits` (F2) | `grep -c "zero hits" "$R2"` | **1** — the bounded round-2 claim. Elsewhere: `pr-65-review.md` (1), `pr-99-review.md` (2), different subjects | — |
| `Every round-1 finding` (F8) | `grep -c "Every round-1 finding" "$R2"` | **0** after the fix. Elsewhere: `pr-65-review-round2.md` (1), `pr-147-review-round2.md` (1), both other PRs | — |
| `exempt per #112` (F7) | `grep -c "exempt per #112" "$R1"`, same for `"$R2"` | **0** / **0** after the fix | — |
| `untracked` (F4) | `grep -c "untracked" "$R1"` | **1** — the corrected sentence | the word is common repo-wide (18 other `.md` at `8ebf2ba`); all are other PRs' housekeeping notes, different subjects |
| `env:create` (F3, the **subject**, not a digit) | `grep -c "env:create" "$R1"`, same for `"$R2"` | **1** each — round 1 (demoted, fixed) and round 2's F5 row (fixed). Four more sit elsewhere on `main`: `driver-device-day-prep.md` (1), `pr-218-review-fixes.md` (2), `docs/runbooks/driver-device-day.md` (1) | see the row below — each of the four **opened and read**, not judged from the grep line |
| ↳ the four on `main` | `sed -n` at each hit | `driver-device-day.md:73-84` names it *"the other place the value could live"* and says the plan kept the committed block deliberately, citing the bullet; `driver-device-day-prep.md:1409` records that the bullet's choice stands; `pr-218-review-fixes.md:20` and `:96` both say the review's `env:create` is the alternative the plan weighed and rejected | all four describe the **rejected** alternative — none prescribes it, so there is no claim to retire. The grep *line* alone reads like a prescription (it is the command, quoted); the surrounding sentence is what settles it |
| ↳ `pr-218-review-fixes.md:20`,`:96` cite the plan at `:566-577` | `git show 7ec3bd7:.claude/plans/…` | that range is the `DECIDED` bullet at `bd5193a`, its anchor; on `main` the bullet is `:573-586` | **left alone deliberately** — a dated artifact already on `main`, correct at its own anchor and outside this PR's diff |
| `stub_sent` (F4 subject) | `grep -c "stub_sent" "$R1"` | **6**, all in round 1; the three outside the fixed bullet are about `driver.push.stub_sent` only and name their file. The token is common across the repo's plans and reports (51 `.md` hits at `8ebf2ba`), all different subjects | — |

## Validation

| What | Command | Result |
|---|---|---|
| Fix verifier, fixed tree | `bash verify-219.sh` (42 assertions, reproduced in the appendix) | ✅ **42 PASS, 0 FAIL**, `ALL FIX ASSERTIONS HOLD`, exit 0 |
| Fix verifier, **unfixed** tree | same script after `git checkout -- <the two files>` | ✅ **13 PASS, 29 FAIL**, exit 29 — the 13 that pass are the primary-source facts (source line numbers, lockfile key counts, runbook line counts), which are true of the tree regardless of what the reports say. Every assertion about report *content* fails. |
| Full gate | `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`, in this worktree at the fixed tree | ✅ exit 0 · **22 successful, 22 total**, 0 cached, **1m20.694s**; `@taxi/api` 733 passed / 77 suites; zero `Failed:` lines. Run at `7926ba1` with the two fixed files and this report in the tree (`git status --porcelain` captured with the run). The first, cold run of the same command took 2m10.636s; the quoted one is the second, which is the one whose exit status was captured. |
| CI on the PR | `gh pr checks 219` | queued behind the previous push's run when this was written, so no result is copied here. The PR's own checks at the head you are reading are the authority; the prior two heads on this branch (`150e711`, `7926ba1`) both completed `success`. |

The gate needed `pnpm install --frozen-lockfile` in this worktree first (a fresh worktree has no
`node_modules`, and `turbo` is not on PATH without it) — `Done in 12.5s using pnpm v10.33.2`,
`reused 1470, added 1676`.

**Why a gate run at all, when the diff is two markdown files.** Because the alternative is to inherit
the review's figure from `3998e9b`, which is the defect F1 item 4 is about, one level up. `turbo.json`
declares no `inputs` and no `globalDependencies`, so no task's cache key can see `.claude/**` and the
result is not *informative* about these files — but it is observed at this head rather than copied
from another one, and this head (`7926ba1`) is a merge commit no previous run covered.

## Needs a human decision

1. ~~**`docs/pr-219-review` is unpushed and has no PR.**~~ **Closed — it is
   [#221](https://github.com/linardsb/taxi/pull/221).** At the time of this pass, `f43ff80` — the
   review this report answers —
   existed only in the worktree `/Users/Berzins/taxi-worktrees/wt-review219`. Five reviews orphaned
   this way before (#138–#142, landed late as #143), and a round-2 reviewer cannot cross-check this
   report against a review they cannot read. It needed its own PR off `main`, the way #219 is one;
   #221 is that PR, and #221's own round-1 review raised this paragraph as its F2.
2. **This worktree now holds a copy of the main checkout's local environment file.** It was needed for
   the gate (`@taxi/db#test` cannot reach the docker postgres without it, and turbo then kills every
   sibling task — memory `taxi-stop-hook-checks-main-repo`). It is gitignored, so it cannot ride into
   a commit, and it is left in place because a round-2 review of this PR would need it again. Delete
   `/Users/Berzins/taxi-worktrees/wt-review218/` with `git worktree remove` when the PR lands and it
   goes with it.
3. **The two shipped reports were posted verbatim as comments on #218**, which is merged. Comments
   `5715582096` and `5716087200` now differ from the corrected files — in F4's four pointers, F6's
   withdrawn totals, F10's count. Round 2's own precedent for this is comment `5716100986`: post the
   correction as its own comment rather than editing the original. Not done here, because posting to
   a merged PR is outward-facing and was not asked for.

## Commit

`075edc6` — *docs(reviews): apply PR #219's round-1 findings F1-F9, plus F10 (#141)*, three files,
`+381 −22` against its parent `7926ba1`. Pushed to `origin/docs/pr-218-review`; PR #219 updated,
still **OPEN** and not a draft, `closingIssuesReferences` empty (nothing closes an issue on merge).

**F1's closing evidence, run after the push** — `gh pr edit 219 --body-file` applied at 2026-09-17,
then `gh pr view 219 --json body`:

- file count and size figure: now *"Three files … +1225"*, re-derived by
  `git diff --numstat origin/main..origin/docs/pr-218-review` at the pushed head — the command, not a
  digit copied from anywhere.
- verdict: the Summary now leads with round 2's **approve** as the standing verdict and marks round 1
  superseded.
- comments: all three linked (`5715582096`, `5716087200`, `5716100986`).
- Validation: anchored at the gate run in this worktree, not at `a71a6b1`, which covered only round 1.

This paragraph could not be written until `075edc6` had a sha, so it is a later commit — and every
commit after a body edit re-stales the body's numstat. The loop ends only one way: the **last** thing
done on the branch is edit → commit → push → re-derive → `gh pr edit`, with no commit after it. The
body states the figures for this branch's final head, and the command it names re-derives them at
whatever head the reader is on (`taxi-report-restating-pr-body-figures`, #212).

## Appendix — the verifier

`observed` output above. The script, verbatim:

```bash
#!/usr/bin/env bash
# Closing evidence for the PR #219 review fixes. Run from the PR's worktree root.
# Every assertion is a command whose output the report quotes.
cd "$(git rev-parse --show-toplevel)" || exit 1
R1=.claude/code-reviews/pr-218-review.md
R2=.claude/code-reviews/pr-218-review-round2.md
pass=0; fail=0
chk() { # chk <label> <pattern> <file>
  if grep -qF -- "$2" "$3"; then printf 'PASS  %s\n' "$1"; pass=$((pass+1));
  else printf 'FAIL  %s\n' "$1"; fail=$((fail+1)); fi
}
nchk() { # nchk <label> <pattern-that-must-be-gone> <file>
  if grep -qF -- "$2" "$3"; then printf 'FAIL  %s\n' "$1"; fail=$((fail+1));
  else printf 'PASS  %s\n' "$1"; pass=$((pass+1)); fi
}
eq() { # eq <label> <expected> <actual>
  if [ "$2" = "$3" ]; then printf 'PASS  %s (%s)\n' "$1" "$3"; pass=$((pass+1));
  else printf 'FAIL  %s (want %s, got %s)\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}

echo "--- F2 · the mirror-sweep claim is bounded to the tree it ran in"
chk  "F2 names bd5193a at the claim"  'in #218'"'"'s own tree at `bd5193a`' "$R2"
chk  "F2 says the review branch falsifies it" 'stops being true of the' "$R2"
nchk "F2 absolute form gone"          'returns **zero hits**. Nothing cites it' "$R2"

echo "--- F3 · F5 carries its own constraint pass, leading with the in-plan remedy"
chk  "F5 leads with the uncommitted sentence" '**Fix**: one sentence in §0 saying the edit stays **uncommitted**' "$R1"
chk  "F5 cites the DECIDED bullet at this anchor" 'driver-device-day-prep.md:555-565` at this report'"'"'s anchor `a71a6b1`' "$R1"
chk  "F5 marks env:create contra-plan" '**contra-plan**' "$R1"
chk  "R2 F5 row names the lead half"   'round 1'"'"'s own **lead** prescription' "$R2"
eq   "DECIDED bullet really opens at plan :555 @a71a6b1" "555" \
     "$(git show a71a6b1:.claude/plans/driver-device-day-prep.md | grep -n 'DECIDED — the value lives in the committed' | cut -d: -f1)"
eq   "…and at :566 @bd5193a" "566" \
     "$(git show bd5193a:.claude/plans/driver-device-day-prep.md | grep -n 'DECIDED — the value lives in the committed' | cut -d: -f1)"

echo "--- F4 · the four pointers resolve"
eq   "app.json extra opens at :42" "42" \
     "$(grep -n '"extra": {' spikes/gps-harness/app.json | cut -d: -f1)"
eq   "app.json owner at :47" "47" \
     "$(grep -n '"owner"' spikes/gps-harness/app.json | cut -d: -f1)"
chk  "R1 summary uses :42-47"          'spikes/gps-harness/app.json:42-47`, the config' "$R1"
chk  "R1 F1 body uses :42-47"          'spikes/gps-harness/app.json:42-47` — the' "$R1"
nchk "no :44-48 left in R1"            'gps-harness/app.json:44-48' "$R1"
eq   "EXPO_PUBLIC_API_URL at eas.json :10 @a71a6b1" "10" \
     "$(git show a71a6b1:apps/driver/eas.json | grep -n 'EXPO_PUBLIC_API_URL' | cut -d: -f1)"
chk  "F5 header cites :10 / :9-11"     'apps/driver/eas.json:10` (the `env` block, `:9-11`)' "$R1"
eq   "auth.otp.stub_sent is in stub-sms.provider.ts:20" "20" \
     "$(grep -n 'auth.otp.stub_sent' services/api/src/features/auth/sms/stub-sms.provider.ts | cut -d: -f1)"
eq   "auth.sms.stub_sent is in stub-sms.provider.ts:33" "33" \
     "$(grep -n 'auth.sms.stub_sent' services/api/src/features/auth/sms/stub-sms.provider.ts | cut -d: -f1)"
chk  "R1 names stub-sms.provider.ts"   'auth/sms/stub-sms.provider.ts:20' "$R1"
chk  "R1 says env template is tracked" '**tracked**; the untracked file is' "$R1"
nchk "untracked-home premise gone"     'already has an untracked home' "$R1"
chk  "R1 summary flags its own four"   'four of them missed, opened by PR #219' "$R1"

echo "--- F5 · locator anchors on the header of both files"
chk  "R1 header states 231 @a71a6b1"   '**231**-line' "$R1"
chk  "R2 header states 289 @bd5193a"   '**289**-line' "$R2"
eq   "runbook really is 231 @a71a6b1"  "231" "$(git show a71a6b1:docs/runbooks/driver-device-day.md | wc -l | tr -d ' ')"
eq   "runbook really is 289 @bd5193a"  "289" "$(git show bd5193a:docs/runbooks/driver-device-day.md | wc -l | tr -d ' ')"

echo "--- F6 · the lockfile totals are withdrawn and the extraction is printed"
chk  "R2 withdraws 1087 -> 1088"       'are withdrawn rather than re-guessed' "$R2"
chk  "R2 prints the extraction"        'awk '"'"'/^packages:/{f=1;next}' "$R2"
eq   "packages keys @b690e91" "1649" \
     "$(git show b690e91:pnpm-lock.yaml | awk '/^packages:/{f=1;next} /^snapshots:/{f=0} f && /^  [^ ]/' | wc -l | tr -d ' ')"
eq   "packages keys @a71a6b1" "1650" \
     "$(git show a71a6b1:pnpm-lock.yaml | awk '/^packages:/{f=1;next} /^snapshots:/{f=0} f && /^  [^ ]/' | wc -l | tr -d ' ')"
eq   "lockfile unchanged a71a6b1..bd5193a" "" \
     "$(git diff --name-only a71a6b1 bd5193a -- pnpm-lock.yaml)"

echo "--- F7 · the 500-line cap is cited to CLAUDE.md, not to #112"
nchk "no '#112 exempts PIV artifacts'" 'PIV artifacts are exempt per #112' "$R1"
chk  "cites CLAUDE.md:60"              'a package build compiles (`CLAUDE.md:60`)' "$R1"

echo "--- F8 · the closed-count matches the table"
nchk "absolute 'Every round-1 finding is closed' gone" 'Every round-1 finding is closed' "$R2"
chk  "eight of nine"                   'Eight of round 1'"'"'s nine findings are closed outright' "$R2"
chk  "F1 row marked half-closed"       '| F1 | High | ◑ |' "$R2"
chk  "legend for the mark"             '`◑` = one of the finding'"'"'s two named sites closed' "$R2"

echo "--- F9 · L1's grade carries its reason"
chk  "L1 answers the M1 comparison"    'when round 1 graded the same failure mode' "$R2"
chk  "L1 names the pointer distinction" 'pointer, and it is the only one.' "$R2"

echo "--- F10 (found while applying F3) · the GOTCHA count"
eq   "plan GOTCHAs @a71a6b1" "18" \
     "$(git show a71a6b1:.claude/plans/driver-device-day-prep.md | grep -c '^- \*\*GOTCHA')"
chk  "R1 says eighteen"                'The plan'"'"'s eighteen `GOTCHA`s were read' "$R1"
nchk "nineteen gone"                   'nineteen' "$R1"

echo
printf '%s PASS, %s FAIL\n' "$pass" "$fail"
[ "$fail" -eq 0 ] && echo 'ALL FIX ASSERTIONS HOLD'
exit "$fail"
```
