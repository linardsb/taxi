# PR #221 review — round 1

**PR**: [#221](https://github.com/linardsb/taxi/pull/221) · docs(reviews): PR #219 round 1 — request changes, one High, two Mediums, six Lows
**Head** `f43ff80` · **Base** `main` @ `7ec3bd7` · base live tip `8ebf2ba` — **moved**, see F2
**Round**: 1 (no prior report) — the fix-mechanism pass does not apply
**State** (read 2026-09-17 at head `f43ff80`): OPEN, ready for review, `mergeStateStatus: BEHIND`, `mergeable: MERGEABLE` · all five checks pass — but see the Validation table: they completed **before** the base moved
**Verdict**: **Approve** — two Mediums, three Lows. No Critical, no High, no hard-rule violation.
**Every figure the PR body states reproduces exactly; two figures the shipped file quotes do not.**

## Summary

This PR ships one file, `.claude/code-reviews/pr-219-review.md` (+510) — the round-1 review of
[#219](https://github.com/linardsb/taxi/pull/219), on its own branch off `main` so the reviewed PR's
next commit cannot sweep the review into the PR it reviews (memory `taxi-pr-review-report-location`,
#148). It is the third link in a chain: #218 shipped the runbook, #219 reviewed #218, this reviews #219.

**Every figure the report asserts reproduces.** I re-derived twenty-three claim groups across the file
and the PR body — twenty-one reproduce exactly; the other two are F1 below (*Claims re-derived*
lists all of them). The twenty-one include the four pointer **corrections** the report raises as its own F4,
which matter more than it claims: #219's fix pass applied all four to `pr-218-review.md`, and that
file is now on `main`. A wrong correction would have shipped to the default branch. None is wrong —
`auth/sms/stub-sms.provider.ts:20`/`:33`, `app.json:42-47`, `eas.json:10` at `a71a6b1`, and the
tracked-not-untracked env template all resolve exactly as stated.

**F1 is the pair of figures the report did not re-derive, and both are wrong.** The Summary claims *"I
re-derived every figure and every git-dependent claim in both files"*. Its F3 then block-quotes round
1's *"The plan's **nineteen** `GOTCHA`s were read"* and argues from it. The plan has **eighteen**, at
every sha, under two independent extractions. A second, smaller one sits in the adjacent finding: its
F4 item 2 describes round 1 as citing the stale `app.json:44-48` once, and it cites it **twice**.
#219's fix pass caught both — the first as its own F10 — and `main` is already corrected, so nothing
wrong shipped. What does not hold is the review's headline claim about itself, and a quoted digit is
exactly what `CLAUDE.md` says to re-derive rather than inherit.

**The second Medium is the base move, and the trigger that exists to catch it did not fire.**
`origin/main` went `7ec3bd7` → `8ebf2ba` after this PR's CI ran; that move *is* #219 merging. #219
carried `.claude/reports/pr-219-review-fixes.md`, which states twice that `docs/pr-219-review` "is
**not pushed and has no PR**". This PR is that branch, pushed, with a PR. Merging it makes `main`'s
own text false — the exact shape the report under review raises as its F2 against #219, with this PR
as the sibling.

**F3 and F4 are staleness, one line each.** The PR body still describes #219 as an open PR with a
live request-changes verdict; #219 merged at 18:40:08Z with all nine findings fixed. The report's
`**State**` header line is the one header fact carrying no anchor.

**F5 is a second absolute a grep falsifies.** The report's own F5 rests its Low on the repo "never"
re-sweeping a landed review; a census of all 65 prior files finds four that were, two of them edited
by #112 and #121 — the two tickets this same report cites as precedent. Its conclusion survives on
the other leg, so this is a Low.

**No finding here changes a verdict, and nothing the report asserts on its own authority is wrong.**
The two Mediums are a quoted figure and a base move; the three Lows are one clause each. No plan
governs this PR — a review artifact is not a planned slice — so the constraint pass does not apply,
and there is no implementation report to check deviations against, which is expected for this kind of
branch rather than a gap.

## Findings

> **Code convention, because this is three reviews deep.** Bare **F1–F5** are *this* review's
> findings. The findings *inside* the file under review are always written **its F3**, **the report's
> F5**, and so on. Line numbers bare of a filename are into
> `.claude/code-reviews/pr-219-review.md` at `f43ff80`.

### F1 — Medium · `.claude/code-reviews/pr-219-review.md:17` (the Summary) and `:176` (its F3)

**"I re-derived every figure … in both files" is falsified by two counts the report quotes and
reasons from. Both are wrong, and #219's fix pass caught both — not the review.**

The report's headline claim, `:17-18`:

> **The reports' facts hold.** I re-derived **every figure and every git-dependent claim in both
> files** rather than reading them, and **sixteen of sixteen reproduce exactly**

Its F3 then quotes round 1's constraint pass to argue the pass was scoped too narrowly, at `:176`:

> It runs a constraint pass once, under F2 (`:112-114`), and scopes it to GOTCHAs — *"The plan's
> **nineteen** `GOTCHA`s were read"*.

`observed` — the source sentence at `150e711`, `pr-218-review.md:112`, does read *"The plan's nineteen
`GOTCHA`s were read"*. **The plan has eighteen.** Two independent extractions over
`.claude/plans/driver-device-day-prep.md` agree, at four shas each:

```
git show <sha>:.claude/plans/driver-device-day-prep.md | grep -cE "GOTCHA"        → 18
git show <sha>:.claude/plans/driver-device-day-prep.md | grep -c '^- \*\*GOTCHA'  → 18
```

`a71a6b1`, `bd5193a`, `3998e9b`, `origin/main` — **18 at every one**, so there is no head at which
nineteen was ever right.

**Who caught it.** #219's fix pass, as its own F10: *"Found here, not in the review: round 1 said the
plan has **nineteen** `GOTCHA`s. It has eighteen, at every sha."* `main`'s
`pr-218-review.md:121` now reads *"eighteen"*, with the extraction printed at `:131`. So nothing wrong
shipped — but the review's principal claim about itself did not hold, and the implementer closed the
gap the reviewer opened. That is the second time in this one chain: the report's own F3 records
the same shape, its round-1 mis-prescription *"caught by the implementer and never reached the tree"*.

**A second, smaller instance of the same under-count, in the adjacent finding.** The report's F4 item
2 (`:227`) says round 1 "cites `spikes/gps-harness/app.json:44-48`" — singular. `observed` —
`git show 150e711:.claude/code-reviews/pr-218-review.md | grep -n "app.json:44-48"` returns **two**
lines, `:21` (the Summary) and `:50` (F1's precedent range). The report names only the F1 one. #219's
fix pass found both: its table at `pr-219-review-fixes.md:76` reads *"(twice — Summary `:24` and F1
`:50`)"* — `:24` rather than `:21` because that pass worked from `7926ba1`, where F5's three-line
`**Locators**:` block had already pushed the Summary down. Both are closed on `main`, which carries
`:42-47` at `:24` and `:59` (`observed`). Same shape, one severity lower: a count in the report came
up short, and the pass downstream of it did the counting.

**Why the figure was missed, and why that is the point.** It is not a figure the report *asserts* —
it is one it **inherits inside a block quote** and then builds an argument on. `CLAUDE.md` names this
exact path: *"Numbers flow plan → implementation → report → PR body, and are inherited, not audited.
Re-derive a figure you are copying."* A quoted digit reads as someone else's claim and slips the
numbers pass, which is why the rule says to re-derive it anyway.

**Why Medium.** Nothing downstream moves: its F3's argument is about the pass's *scope* (GOTCHAs only,
1 of 9 findings), and it holds identically at 18. The digit is quoted, not asserted, and `main` is
already correct. It is a Medium rather than a Low because the falsified sentence is the report's
`## Summary` headline — the one a reader uses to decide how far to trust the **493** lines below it
(`derived`: `510 − 17`) — and
because the word is "every", which is the class of absolute the report itself raises twice against
#219 (its F2's *"Nothing cites it by line"*, its F5's *"never re-swept"* → F5 below).

**Fix**: three clauses. At `:176`, *"nineteen — the plan has eighteen at every sha, corrected in
#219's fix pass as F10"*. At `:227`, *"cites it twice, in the Summary and in F1"*. At `:17`, bound the
claim to what was done — *"every figure the two files assert; one figure they quote, round 1's
`GOTCHA` count, I passed through unaudited"* — or drop "every" and keep "sixteen of sixteen", which
is exact and needs no qualification.

**A note on how this was found, since it bears on the next round.** Both instances surfaced the same
way: by asking what #219's *fix pass* caught that the review did not, rather than by re-reading the
review. `piv-review-pr` asks that question only from round 2 (*the fix-mechanism pass*). Applied one
level up — this PR lands a review whose subject already has a fix report on `main` — it is available
at round 1 and it is what returned both items here. The independent `code-reviewer` pass reached the
`GOTCHA` count too, from the plan rather than from the fix report; the `:44-48` under-count came only
from the fix-report comparison.

### F2 — Medium · `main`'s `.claude/reports/pr-219-review-fixes.md:4-5` and `:179`

**Merging this PR falsifies a claim `main` already carries, in two places, and the claim is about
this PR's own branch.**

`origin/main` is `8ebf2ba` (`observed`, `git rev-parse origin/main` after `git fetch --prune`).
`baseRefOid` on the PR is `7ec3bd7`. The single commit between them is #219's merge, at
2026-09-17T18:40:08Z — **3 h 35 min 30 s** after the last of this PR's five checks completed at
15:04:38Z (`derived`: `18:40:08 − 15:04:38`; `observed` per-check completions from
`gh api …/commits/f43ff80/check-runs`, the five running 15:01:57Z–15:04:38Z, `check` itself at
15:04:32Z). It added three files, one of which is the fix report answering the very review this PR
lands.

That file says, at `:4-5` (its header, the first thing a reader sees):

> That file lives on branch `docs/pr-219-review` at `f43ff80`, which is **not pushed and has
> no PR** — see *Needs a human decision* below.

and again at `:179`:

> 1. **`docs/pr-219-review` is unpushed and has no PR.** `f43ff80` — the review this report answers —
>    exists only in the worktree `/Users/Berzins/taxi-worktrees/wt-review219`.

`observed` — `git show origin/main:.claude/reports/pr-219-review-fixes.md | grep -n "not pushed\|has no PR"`.
This PR is branch `docs/pr-219-review` at head `f43ff80`, pushed, with a PR. Both sentences are false
the moment it merges, and `:4-5` is unqualified and unanchored — no sha, no "at the time of this pass".

**This is the guarantees-pass shape, and the trigger did not fire.** `piv-review-pr` gates that pass
on comparing the live tip against the base recorded in a *prior* review round, and says "No prior
report → first round, skip it". This is round 1, so by the letter the pass is skipped. But the
exposure is identical: a first-round PR whose base moved between push and review has the same broken
relationship, and both sides stay green because only the relationship broke. The comparison needed
here — `baseRefOid` (`7ec3bd7`) against the live tip (`8ebf2ba`) — needs no prior report at all. I ran
the pass anyway; F2 — this finding — is what it returned. (Worth carrying to the evolution loop rather than fixing in
this PR.)

**What softens it.** `:179` is a *Needs a human decision* item that **asks for this PR** — "It needs
its own PR off `main`, the way #219 is one." So this is a to-do being completed with its own text not
struck through, not a break nobody saw coming. A reader who follows `:179` reaches the PR that closes
it. That is why this is Medium and not High: no verdict moves, nothing in the reviewed tree is wrong,
and the falsified sentence points at its own remedy.

**The fix is free, because the branch has to move anyway.** `observed` —
`gh api repos/linardsb/taxi/branches/main/protection --jq '.required_status_checks'` returns
`"strict": true` with contexts `check`, `audit-diff`, `codeql`. Strict means up-to-date-before-merge,
so #221 **cannot merge while `BEHIND`** regardless of this finding; the branch must take `8ebf2ba`
and CI must re-run.

**Fix**: fold a one-clause edit into that same update. At `:4-5` — *"…which at the time of this pass
was not pushed and had no PR; it is now [#221](https://github.com/linardsb/taxi/pull/221)"*. At
`:179` — mark the item done and name the PR. Prefer a local `git rebase --onto origin/main` and a
force-push over GitHub's *Update branch*, which **merges** and produces a head sha the author never
made (memory `taxi-update-branch-merges-not-rebases`). Order the finish per
`taxi-report-restating-pr-body-figures`: edit → commit → push → re-derive the numstat → `gh pr edit`,
because the fixing commit moves the `+510` the body states.

### F3 — Low · the PR body, `## Summary` line 3 and `## Validation` final paragraph

**Two sentences describe a state that ended 3 h 35 min after CI ran.**

1. The Validation section closes:

   > Also `observed`: `git merge-tree --write-tree origin/main` against #219's head exits 0 with no
   > conflict markers, so **#219's `BEHIND` state** is a two-way-diff artefact and not a revert of #218.

   #219 has no `BEHIND` state. `observed` — `gh pr view 219` → `state: MERGED`, `mergedAt:
   2026-09-17T18:40:08Z`, `mergeCommit: 8ebf2ba`; its timeline carries `head_ref_deleted`. The
   underlying derivation was sound and is now moot.

2. The Summary reads *"Verdict: **request changes** — one High (F1), two Mediums (F2, F3), six Lows
   (F4–F9)"* with nothing marking it as the landed file's content rather than a live call. All nine
   were fixed and #219 merged: `main`'s `pr-219-review-fixes.md` records *"all nine findings fixed,
   nothing deferred"*, plus an F10 the fix pass found on its own.

**Also, and this one is fine**: *"the full gate at `3998e9b`, whose tree is `main`'s content at
`7ec3bd7`"*. The tree identity is exact — `observed`, `git rev-parse 3998e9b^{tree}` and
`7ec3bd7^{tree}` are both `1674ada2822518d8982dfa010548ef3f7110e4d4` — and the sha anchor is what
keeps the sentence true now that `main` is `8ebf2ba`. Noted only because a reader skimming
"`main`'s content" without the anchor would draw the wrong conclusion.

**Why Low and not the High the report under review assigned #219's equivalent.** Apply that report's
own discriminator: does a human reading only the body get the right answer about what they are
merging? Here, yes. One file, `+510`, at `f43ff80` — `observed`, `git diff --numstat
origin/main...f43ff80` → `510  0  .claude/code-reviews/pr-219-review.md`. All three exact. #219's F1
was a *wrong* file count, an *inverted* verdict and a `+271` no reachable state produces. This is a
stale surrounding paragraph on a PR whose own diff claims are correct, and it cannot mislead a merge
decision.

**Fix**: one `gh pr edit 221 --body-file` on the same pass as F1 — say #219 merged at `8ebf2ba` with
all nine findings fixed, and that this PR lands the round-1 record rather than a pending verdict.

### F4 — Low · `.claude/code-reviews/pr-219-review.md:5`

**The one header fact with no anchor is the one that has since changed.**

> **State**: OPEN, ready for review, `mergeStateStatus: BEHIND` · all five checks pass

Every other fact in that header is anchored: `**Head** 150e711`, `**Base** main @ b690e91 · base live
tip 7ec3bd7`, `**Round**: 1`. The `State` line is a bare present tense about a PR that is now MERGED
with its branch deleted.

The report's own F5 makes the case that a review is a dated artifact anchored by sha and never
re-swept, and that the anchor on the header line is what a reader needs — the norm across the **65**
prior files in `.claude/code-reviews/` (`observed`: `git ls-tree 150e711 .claude/code-reviews/` → 67
`.md`, minus the two #219 adds). That argument covers the locators and it covers this line too, once
the line says when it was true. The same applies to the Recommendation's closing instruction —
*"Fix the body with `gh pr edit 219 --body-file` … and this is an approve"* — which reads as a live
direction to a merged PR.

**Why Low, and the counter-argument stated.** `**Head** 150e711` sits two lines above and a fair
reader takes the whole header as "as of that head". Nothing downstream depends on the line. It earns
a line only because the report raises this exact shape twice against #219 — F2's unscoped absolute
and F5's unanchored locators — so the standard it argues for is the one to hold it to.

**Fix**: `**State** (at `150e711`): OPEN, ready for review, …`, and one clause on the Recommendation
naming it as the round-1 call rather than a standing one. Or decline it on F5's own reasoning and say
so — both are defensible, which is why this is not a merge gate.

### F5 — Low · `.claude/code-reviews/pr-219-review.md:274-276` (its F5's *Why Low*)

**The severity of the report's own F5 is set by an absolute claim about all 65 prior review files, and four of them
contradict it — two of the four edited by the very tickets the report cites elsewhere.**

> **Why Low.** Both headers carry their anchor sha on line 4, which is what a reader needs, and the
> repo's norm across the **65** prior `.md` files in `.claude/code-reviews/` is exactly this — a dated
> artifact anchored by sha, **never re-swept after the branch moves** … Raising it higher would invent
> a standard the repo does not hold.

`observed` — `git log --oneline origin/main -- <file>` over every `.md` in that directory. **Four have
more than one commit**, and three of the four were edited specifically to correct a landed review:

| File | Post-landing commits | What they did |
|---|---|---|
| `pr-110-review.md` | **4** | `b130e27` *"fix the review's own tally and two pins (#108)"*; `f14867a` *"finish the review tally fix `b130e27` started (#108)"*; then `efefcd8` and `7d6c52b` from **#112** — *"re-derive the swept-file count"* |
| `pr-121-review.md` | 1 | `9713cb5` *"retire the Redis diagnosis **where it survived**"* |
| `pr-121-review-round3.md` | 2 | `9713cb5` again, plus `5df2c72` *"count the i18n keys L1 was actually about, not lines"* |
| `pr-147-review-round3.md` | 1 | `7db9d51` — a round-3 addendum |

**The steelman, stated because it is strong.** The precise clause is "never re-swept *after the branch
moves*", and none of those four edits tracks branch movement — they retire wrong claims and re-derive
wrong counts. Under that narrow reading the sentence survives. But it is offered as a norm "across the
65 prior files", and a reader takes "never re-swept" as "these files are not edited after they land".
Four are.

**Why it earns a line anyway.** It is the one claim in the report that *sets a severity* rather than
supporting a fact, and it sets it by asserting a standard "the repo does not hold" — while the repo
demonstrably holds the adjacent one: a landed review **is** corrected when a claim in it turns out to
be wrong. Two of the counter-examples come from tickets this same report cites as precedent — **#112**
in F7, and **#121**, whose Redis retirement (`9713cb5`) is the subject of `CLAUDE.md`'s longest
paragraph and of F1's own *"that is the #121 trap"*.

**The conclusion survives, which is why this is Low.** Its F5's first leg — the anchor sha on line 4 is
what a reader needs — carries the Low on its own, and a locator with a stated anchor is a different
object from a claim that became false. Nothing downstream moves.

**Fix**: bound it to what the log shows — *"the repo re-sweeps a landed review when a claim in it is
wrong (`9713cb5`, `b130e27`), not when locators drift; 61 of the 65 prior files have a single
commit"* — or drop the norm sentence and rest *Why Low* on the anchor alone, which is the leg that
does the work.

## Validation

| What | Command | Result |
|---|---|---|
| CI on this PR | `gh pr checks 221` | ✅ 5/5 — `CodeQL`, `audit-diff`, `check`, `codeql`, `ready`, all completed by **15:04:38Z**, i.e. **before #219 merged at 18:40:08Z** — stale against live `main`; GitHub never re-runs on base movement (`taxi-parallel-prs-share-files`) |
| Merge against the **live** tip | `git merge-tree --write-tree origin/main f43ff80` | ✅ exit 0, tree `2ca0bde`, zero conflict markers — probed, not inferred from the tick |
| Diff size | `git diff --numstat origin/main...f43ff80` | ✅ `510  0  .claude/code-reviews/pr-219-review.md` — the body's `+510` and "one file" both exact |
| Base drift | `git rev-parse origin/main` after `git fetch --prune` | `8ebf2ba` ≠ `baseRefOid` `7ec3bd7` — **moved**; the move is #219 merging → F2 |
| Merge gate | `gh api repos/linardsb/taxi/branches/main/protection` | `required_status_checks.strict: true`, contexts `check`, `audit-diff`, `codeql` — **#221 cannot merge while `BEHIND`**; the branch must take `8ebf2ba` and CI re-runs |
| Full local gate | **not re-run** — reasoning below | inherited from the PR body, corroborated, not re-observed here |

**Why I did not re-run the local gate, stated rather than silently skipped.** This PR adds one
markdown file under `.claude/code-reviews/`, outside every package directory. `observed` —
`turbo.json` declares **no** `inputs` on any task and **no** `globalDependencies` key; `globalEnv` is
six variables (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `OTP_PEPPER`, `API_PORT`, `REDIS_TEST_URL`),
none reaching `.claude/**`. No task's cache key can see the file. CI's `check` is green at this head,
and `merge-tree` against the live tip is clean. Against that, four `claude` processes share this
checkout and integration runs drop the shared test DB (`taxi-concurrent-sessions`), so a re-run is
net-negative and risks killing another session's gate.

**So the body's gate digits are inherited, not observed by me** — and they corroborate:
`22 successful, 22 total` matches the repo's known gate task count, and `@taxi/api 733 passed / 77
suites` reconciles with `CLAUDE.md`'s `39 skipped + 694 passed = 733` over `77` once `REDIS_TEST_URL`
is set, which the body's command sets. The anchor the body gives is exact: `3998e9b`'s tree **is**
`7ec3bd7`'s, both `1674ada2822518d8982dfa010548ef3f7110e4d4` (`observed`). `8ebf2ba` adds only three
`.claude/` files on top, so the neutrality argument carries to the live tip unchanged.

## Claims re-derived, not inherited

Every figure and git-dependent claim I opened, in the PR body and in the file it lands.
**Twenty-three groups: twenty-one reproduce exactly, two do not.** The two that do not are both F1 and are
listed last; nothing else below is a finding.

- **The body's diff claim.** `git diff --numstat origin/main...f43ff80` → `510  0
  .claude/code-reviews/pr-219-review.md`. One file, `+510`, exact.
- **The body's gate anchor.** `3998e9b^{tree}` == `7ec3bd7^{tree}` == `1674ada2822518d8982dfa010548ef3f7110e4d4`.
  The tree identity the whole validation argument rests on is exact.
- **`turbo.json`'s cache neutrality.** No `inputs`, no `globalDependencies`; `globalEnv` is the six
  variables listed above. Re-derived here, not inherited from the body.
- **Its F1's numstat.** `git diff --numstat b690e91 150e711` → `502/0` round 2, `364/0` round 1 = **+866**.
  The report's correction to the `+271` in #219's body is right.
- **Its F1's first-commit claim.** `git show --numstat d0493d2` → `364  0
  .claude/code-reviews/pr-218-review.md`, added in one go.
- **Its F1's zero-force-push claim**, which is what licenses "no pushed state produces +271".
  `gh api repos/linardsb/taxi/issues/219/timeline --paginate` →
  `head_ref_force_pushed` count **0**. Exact.
- **Its F4 item 1 — the silent file switch, and it is real.** `stub-push.provider.ts` is **33** lines;
  `:20` is `export class StubPushProvider implements PushProvider {`, `:25` is
  `event: 'driver.push.stub_sent',`, `:33` is `}`. The two `auth.*` events are elsewhere:
  `auth/sms/stub-sms.provider.ts:20` is `event: 'auth.otp.stub_sent',` and `:33` is
  `event: 'auth.sms.stub_sent',`. Both sets of line numbers coincide, exactly as described.
- **Its F4 item 2 — the precedent range.** `spikes/gps-harness/app.json`: `"extra": {` at **42**,
  `"projectId"` at 44, `"owner"` at **47**. The cited `:44-48` misses the opening two lines; the
  report's `:42-47` is right.
- **Its F4 item 3 — the off-by-one.** `git show a71a6b1:apps/driver/eas.json | grep -n EXPO_PUBLIC_API_URL`
  → **10**. Line 11 is `},`. Real at the head round 1 was written against, not post-hoc drift.
- **Its F4 item 4 — tracked, not untracked.** The committed env template is tracked
  (`git ls-files --error-unmatch` succeeds); its `:53` reads `EXPO_PUBLIC_API_URL=http://localhost:3001`
  — localhost, not the LAN address its F5 objects to; `.gitignore:14` ignores the plain local file. All
  three halves of the correction hold.
- **Its F5's runbook growth.** `git show <sha>:docs/runbooks/driver-device-day.md | wc -l` → **231**
  (`a71a6b1`) → **289** (`bd5193a`) → **322** (`7ec3bd7` and `8ebf2ba`). Exact, and `main` is still 322.
- **Its F5's "65 prior files".** `git ls-tree 150e711 .claude/code-reviews/` → **67** `.md`; minus #219's
  two adds = **65**. Exact, and correctly scoped to *prior*.
- **Its F7's rule citation.** `CLAUDE.md:60` is the VSA bullet carrying *"**Max 500 lines per file of
  shipped source** — what each package's build compiles"* and naming `.spec`/`.test`, `test/`/`tests/`
  and `scripts/` as #112's exemptions. Both the quote and the line number are exact, so its F7's objection
  stands on the right text.
- **The 30-assertion verifier.** `.claude/reports/pr-218-review-fixes.md:236-304` holds **27** `chk` +
  **3** `nchk` = 30, identical at `3998e9b` and at `origin/main`. The count survives #219's merge.
- **Its F2's prediction, now fired.** It said "the moment #219 merges, `main` holds the first line-number
  references into that runbook that have ever existed in it". `observed` at `origin/main` —
  `git grep -c -E "driver-device-day\.md:[0-9]" origin/main -- '*.md'` → round 2 **6**, round 1 **8**,
  the fixes report **1** = **15**. It came true. The fix pass also bounded the sentence: *"Nothing
  cites it by line"* no longer appears in `main`'s round-2 file.
- **The report's own count of itself.** "All sixteen reproduce exactly" — the *Claims re-derived*
  section holds exactly **16** top-level bullets. D2's arithmetic also checks: `4792 + 4192 + 232 =
  9216 = 96²`.
- **#217 touched exactly one file.** `git show --stat b690e91` → `docs/runbooks/hetzner-deploy.md`
  alone, `1 file changed, 156 insertions(+), 14 deletions(-)`. Exact, so the no-overlap conclusion
  round 1 drew from it holds.
- **The 65-file re-sweep census** — run because its F5's severity rests on it. `git log --oneline
  origin/main -- <file>` over all 67 `.md` in `.claude/code-reviews/`: **61** of the 65 prior files
  have a single commit, **4** have more (→ F5). The `65` and the general shape of the norm are right;
  the word "never" is not.
- **Linked-issue states.** #218 MERGED 14:48:41Z at `7ec3bd7`; #219 MERGED 18:40:08Z at `8ebf2ba`;
  #220 OPEN; #141 OPEN, untouched by all three branches, as the body says.

- **The four `nudge_*` line refs.** `git show 150e711:services/api/src/features/drivers/drivers.service.ts`
  at 346, 355, 369, 380 → `driver.push.nudge_skipped`, `nudge_skipped`, `nudge_sent`, `nudge_failed`.
  All four exact, in that order.
- **Its F9's three quotes at `bd5193a`.** `docs/runbooks/driver-device-day.md:196` is step 5's row,
  `:223-224` is the *"treat one gap just over 12 s as a re-read; the ❌ is a stream that goes quiet and
  stays quiet"* note, and `:259` is *"**Any ❌ on 4, 5, 7 or 8 means the fix did not land.**"* All
  three exact, so its F9's grading argument rests on the right text.
- **First of the two that do not reproduce → F1.** Round 1's *"The plan's **nineteen** `GOTCHA`s were
  read"*, block-quoted by the report at `:176`. `git show <sha>:.claude/plans/driver-device-day-prep.md
  | grep -cE "GOTCHA"` → **18**, and `grep -c '^- \*\*GOTCHA'` → **18**, at `a71a6b1`, `bd5193a`,
  `3998e9b` and `origin/main`. Two extractions, four shas, no head at which nineteen holds. Already
  corrected on `main` by #219's fix pass (its F10).
- **Second → F1 as well.** The report's F4 item 2 (`:227`) describes round 1 as citing
  `app.json:44-48` once. `git show 150e711:.claude/code-reviews/pr-218-review.md | grep -n
  "app.json:44-48"` → **two** hits, `:21` and `:50`. #219's fix pass counted both
  (`pr-219-review-fixes.md:76`) and `main` now carries `:42-47` at `:24` and `:59`.

**The `code-reviewer` agent's pass, and what I did with it.** It ran without Bash — file reads and
greps only — and labelled its own verdicts `observed` / `derived` / `unopenable` accordingly, naming
what it could not reach rather than guessing. It reached the same `GOTCHA` count independently, from
the plan rather than from the fix report, which is the stronger form of agreement: two routes, one
answer. Its one item I had not run — the `:44-48` double citation — **was re-run here before entering
this report** (`taxi-review-payoffs-are-claims`), and it holds, which is why it is in F1 as evidence
rather than as a fourth Low. Nothing else it returned was new; every other line corroborated a group
I had already opened. Its own sha-gap discharges are sound, and I checked that too rather than taking
it: `observed`, `git diff --name-only a71a6b1 7ec3bd7` returns five files — the plan, two fix reports,
the implementation report and the runbook. No `services/api/src`, no `apps/driver/eas.json`, so the
blobs it read at `7ec3bd7` are the ones round 1 cited at `a71a6b1`.

**Not verified, so it is not mistaken for checked.** The `npm view eas-cli version` → `24.7.0` figure
is time-dependent and I did not re-run it. The report's own gate run and the `~55` `file:line` claims
it credits to the `code-reviewer` agent are that report's `observed`, not mine — I re-derived the
sixteen groups above instead of the full set.

## What is good

- **Four corrections that had already shipped, all four right.** The report's F4 is rated one Low on
  the grounds that none changes a conclusion. That undersells it: #219's fix pass applied all four to
  `pr-218-review.md`, which merged to `main` at `8ebf2ba` — `observed` on `main` at `:24` and `:59`
  (`app.json:42-47`), `:186` (`eas.json:10`, `:9-11`), `:193` (tracked, and `.gitignore:14` for the
  untracked one) and `:313` (`auth/sms/stub-sms.provider.ts:20`, `:33`). Had any been wrong, the
  defect would now sit on the default branch inside a file whose own subject is wrong pointers. I
  opened all four independently and every one resolves — including the hardest, the
  `stub-push`/`stub-sms` switch that is undetectable by reading because line 20 and line 33 exist in
  both files and both hold plausible content.
- **A falsifiable prediction, made before it fired, and correct.** Its F2 did not say "this claim is
  unscoped"; it said what would make it false and when. #219 merged and it happened, to the locator.
  Predictions that can be checked after the fact are rarer in this repo's review history than
  findings that cannot.
- **Its F1 refuses to name a cause it cannot evidence.** *"I am not naming a cause either; that is the
  #121 trap, real output plus an inferred mechanism"* — with the `head_ref_force_pushed` count
  actually run to bound what can be claimed. That is the exact discipline `CLAUDE.md` asks for,
  applied against the reviewer's own instinct rather than cited at someone else.
- **The severity disagreement with the agent is stated, not resolved silently.** Its F9 keeps the agent's
  finding, refuses its Major, gives the discriminator, and says which of the two gradings has to move.
  `taxi-review-payoffs-are-claims` applied to an agent's *severities*, not just its facts.
- **"Not verified, so it is not mistaken for checked."** Naming what was left unchecked — the
  `192.168.1.11` lease, the unrun EAS cloud build — is scarcer than naming what was checked, and it
  is what lets the next round know where to look.
- **The separation worked, and this PR is the documented remedy for the gap it left.**
  `pr-219-review-fixes.md:179` asked for exactly this PR. F2 above is the cost of that asking having
  been written down in a file that then merged first.
- No hard rule is in scope: one markdown file under `.claude/`, no money, no ride status, no
  contract, no seam, no source. The 500-line cap binds shipped source a package build compiles
  (`CLAUDE.md:60`), which markdown is not.

## Recommendation

**Approve.** No Critical, no High; validation passes; the diff matches the intent the body states.
The check with the most at stake here was the four pointer corrections that had already reached
`main` through #219's fix pass — all four are right, and any one of them wrong would have been a High
in a file on the default branch whose own subject is wrong pointers.

Neither Medium blocks. **F2 costs nothing extra**: `main`'s protection is `strict`, so this branch
has to take `8ebf2ba` before it can merge anyway — fold the two-clause edit to
`pr-219-review-fixes.md` into that same update, rebase rather than *Update branch*, and re-derive the
`+510` after the commit that carries it. **F1 is two clauses** inside the shipped file, and the wrong
digit it names is already corrected on `main`, so it cannot mislead anyone who follows the file to its
subject. F3 is one `gh pr edit`; F4 and F5 are one clause each.

Worth saying plainly, since the chain now runs three reviews deep: **only F1 and F5 are about the
reviewed file's own reasoning.** F2, F3 and F4 exist because `main` moved between this PR being
pushed and being read — a property of reviewing a review a base-move later, not a defect in the work.
And F1 and F5 are the same defect twice: an absolute ("every figure", "never re-swept") that a grep
falsifies, in a report whose thesis is that absolutes must be bounded to their evidence. Neither
changes a conclusion, which is why both stay below High.

Next: `piv-fix-review-findings` on this report, then re-validate.

---

**One note for the evolution loop, not a finding.** `piv-review-pr`'s guarantees-pass trigger is
gated on a prior review round ("No prior report → first round, skip it"), but the comparison it needs
— `baseRefOid` against the base branch's live tip — is available on round 1 without one. This PR is
round 1, its base moved between push and review, and F2 is what running the pass anyway returned.
The same is true of F1 in a different direction: the numbers pass says "Re-derive a figure you are
copying", and a figure **inside a block quote** reads as attribution rather than as a claim, which is
where this one slipped. Both are one-line trigger changes, not prose.
