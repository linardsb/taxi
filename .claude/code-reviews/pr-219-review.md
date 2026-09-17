# PR #219 review — round 1

**PR**: [#219](https://github.com/linardsb/taxi/pull/219) · docs(reviews): PR #218 rounds 1 and 2 — round 2 approves, three Mediums, six Lows
**Head** `150e711` · **Base** `main` @ `b690e91` · base live tip `7ec3bd7` — **moved**, see below
**Round**: 1 (no prior report) — the fix-mechanism pass does not apply
**State** (read 2026-09-17 at head `150e711`): OPEN, ready for review, `mergeStateStatus: BEHIND` · all five checks pass
**Verdict**: **Request changes** — one High, two Mediums, six Lows. No Critical, no hard-rule
violation. **The High is entirely in the PR body; the two shipped files are factually sound.**

## Summary

This PR ships the two code-review reports for [#218](https://github.com/linardsb/taxi/pull/218), on
their own branch off `main` so the reviewed PR's next commit cannot sweep the review into the PR it
reviews (memory `taxi-pr-review-report-location`, #148). That separation worked exactly as intended
and is the right call.

**The reports' facts hold.** I re-derived every figure and every git-dependent claim the two files
**assert**, rather than reading them, and **sixteen of sixteen reproduce exactly** — both size tables,
the icon byte arithmetic, the four `nudge_*` line refs, M2's pointer-paragraph locator and its 3/7
straddle, the 231→289 runbook growth, the 30-assertion verifier, `turbo.json`'s cache neutrality, the
Nest default log levels the whole run sheet rests on. One figure they **quote** rather than assert —
round 1's `GOTCHA` count, block-quoted in F3 below — I passed through unaudited, and it is wrong: the
plan has **eighteen**, not nineteen, at every sha (corrected on `main` by #219's fix pass, its F10).
The `code-reviewer` agent independently opened ~55
more `file:line` claims and found the same: everything resolves but the pointers in F4 below. The
full list is in *Claims re-derived*.

**F1 gates merge and is not in the diff.** The PR body describes a different pull request from the
one on offer: one file where there are two, `+271` where no commit on this branch produces anything
but `+364` then `+866`, and the verdict **request changes** where the PR's own title and its newest
file say **approve**. `CLAUDE.md` names the PR body as "the most-read surface and the only one not in
the working tree", and this is the surface a human reads before merging. One
`gh pr edit --body-file` closes it.

**The two Mediums are both about a claim's scope rather than its facts.** F2: round 2 asserts nothing
in the repo cites the runbook by line number, and merging this PR is what makes that false — by
adding fourteen such locators, six of them in the sentence making the claim. F3: round 1 ran its
constraint pass on one of nine findings, and the finding it skipped is the one whose lead fix is the
option the plan had already weighed and rejected.

**The base moved and it costs nothing.** #218 merged at `7ec3bd7` on 2026-09-17T14:48:41Z, after both
rounds were written. The `git diff --numstat origin/main..150e711` view is alarming — 16 files, −2761
— because this branch predates #218 and that is a two-way diff, not a merge. The three-way merge is
clean: `git merge-tree --write-tree origin/main 150e711` exits 0 with no conflict markers
(`observed`). Nothing here reverts #218.

## Findings

### F1 — High · the PR body (`## Summary`, `## What changed`, `## Validation`)

**The body describes a one-file, request-changes PR. The PR is a two-file, approve PR.**

Four separate claims, each wrong at head `150e711`:

**1. The file count and the size figure.** The body reads:

> ## What changed
> One file, `.claude/code-reviews/pr-218-review.md` (+271).

`observed` — `git diff --numstat origin/main..150e711`, this branch's own additions:

```
502	0	.claude/code-reviews/pr-218-review-round2.md
364	0	.claude/code-reviews/pr-218-review.md
```

Two files, **+866**. And the round-1 file alone is **+364**, not +271: `d0493d2` is the branch's
first commit and adds it at `364/0` in one go (`git show --numstat d0493d2`), and the PR has **zero**
force-pushes (`gh api repos/linardsb/taxi/issues/219/timeline`, `head_ref_force_pushed` count `0`).

**Stated at the strength the evidence supports**: no commit on this branch, and no pushed state of
it, produces +271. A pre-push amend leaves no timeline trace, so I cannot say the figure never
existed in a working tree — only that nothing reachable from the PR returns it. I am not naming a
cause either; that is the #121 trap, real output plus an inferred mechanism.

**2. The verdict is inverted.** The body's Summary says:

> Verdict: **request changes** — one High, five Mediums, three Lows.

That is round 1's verdict, and round 1 was superseded by round 2 **in this same PR**. Round 2's own
header line 9 reads `**Verdict**: **Approve** — three Mediums, six Lows`, and the PR *title* says so
too. The title was updated when `b462fb0` landed; the body was not.

**Steelmanned, because it is not all one defect.** The title is correct, and the Summary paragraph is
explicitly scoped ("The round-1 review report … Verdict: request changes"), so a careful reader can
reconstruct it. `## What changed` has no such scope — it is a flat claim about this PR's diff and it
is wrong on file count, file set and digit under any reading.

**3. The posted-comment pointer is one of three.** The body cites
[comment 5715582096](https://github.com/linardsb/taxi/pull/218#issuecomment-5715582096) as where the
review was posted. That is round 1. `gh api repos/linardsb/taxi/issues/218/comments` returns three
(`observed`): `5715582096` (round 1, 13:57:21Z), `5716087200` (round 2, 14:29:42Z) and `5716100986`
(the M2 site-3 correction, 14:30:31Z). A reader following the body's link sees the withdrawn verdict.

**4. The Validation anchor predates half the content.** The body prints:

> `observed` — the reviewed PR's gate, re-run at its head `a71a6b1` … exit 0, `22 successful, 22
> total`, `1m30.122s`.

`a71a6b1` was #218's head when **round 1** was written. Round 2's own gate ran at `bd5193a`
(`1m30.405s`, its Validation table), and #218 merged at `3998e9b`. The figure is real — I reproduced
its shape at `3998e9b` below — but it is offered as this PR's validation while covering only the half
of it that round 1 reviewed.

**Fix**: one `gh pr edit 219 --body-file <file>`. Restate `## What changed` as *"Two files,
`pr-218-review.md` (+364) and `pr-218-review-round2.md` (+502) — +866"*; give the Summary both
verdicts with round 2's standing; link all three comments; and anchor Validation at `bd5193a` (round
2's run) or re-run at `3998e9b`, saying which. Per memory `taxi-report-restating-pr-body-figures`,
re-derive after the commit carrying the edit — though here the edit moves no file, so the numstat is
stable.

**Why High and not Medium.** It is body-only and nothing in the tree is wrong. But the discriminating
question is whether a human reading only the body gets the right answer about what they are merging,
and they do not: they would expect one file and a request-changes review and get two files and an
approval. A phantom figure on the most-read surface is the defect class that has cost this repo three
tickets (#87, #107, #121), and `CLAUDE.md` singles the PR body out by name for it. It is also a
one-command fix, which is why it gates merge cheaply rather than expensively.

### F2 — Medium · `.claude/code-reviews/pr-218-review-round2.md:392-395`

**An absolute claim that merging this PR falsifies, with six of the fourteen counter-examples written
by the sentence making it.**

The passage:

> The mirror sweep round 2 owns — refs *into* the runbook by line number, whose line count moved +58
> in the same commit — is clean: `grep -rn "driver-device-day\.md:[0-9]" --include='*.md' .` returns
> **zero hits**. Nothing cites it by line.

The sweep is real and its result is right for the tree it ran in. `observed` — `git grep -c -E
"driver-device-day\.md:[0-9]" bd5193a -- '*.md'` returns nothing, and the same grep at live main
`7ec3bd7` also returns nothing. Round 2's Validation says it ran *"in the main checkout"* (`:345`),
which at that moment was on `feature/driver-device-day-prep` and so held no review file. The command
and its result are consistent.

What is wrong is the **generalisation**. "Nothing cites it by line" is scoped to the repo; the
evidence is scoped to one tree, and the tree is named eighty lines away in a different section.
`observed` at this PR's head — `git grep -c -E "driver-device-day\.md:[0-9]" 150e711 -- '*.md'`:

```
150e711:.claude/code-reviews/pr-218-review-round2.md:6
150e711:.claude/code-reviews/pr-218-review.md:8
```

Fourteen locators across the two files this PR adds. The moment #219 merges, main holds the first
line-number references into that runbook that have ever existed in it — six of them in the file
denying they exist.

This is the guarantees-pass shape the skill names: an absolute claim that a sibling merge invalidates,
where both sides stay green because only the *relationship* broke. Here the sibling is this PR.

**Fix**: bound the sentence to its evidence — *"nothing in #218's own tree cites it by line; this
review branch will, and its locators are anchored at `bd5193a`"* — and name that tree at the claim
rather than in Validation. F5 is the other half of the same thought.

**Constraint pass**: no plan governs this PR — it is a review artifact, not a planned slice — so the
pass does not apply. `grep -in "do not modify\|do not edit\|read-only\|no changes to\|frozen"` over
`.claude/plans/driver-device-day-prep.md` returns nothing touching either review file.

### F3 — Medium · `.claude/code-reviews/pr-218-review.md:180-185` (F5's Fix) and `:112-114`

**Round 1's constraint pass ran on one finding of nine, and the finding it skipped is the one whose
lead fix is the option the plan had already weighed and rejected.**

F5 prescribes, as its first and recommended remedy:

> move it to an EAS-side project variable — `npx eas-cli env:create --environment preview --name
> EXPO_PUBLIC_API_URL --value http://<ip>:3001` — and drop the `env` block

`.claude/plans/driver-device-day-prep.md:573-586` is a **DECIDED** bullet that rejects exactly that
(`observed`):

> **DECIDED — the value lives in the committed `env` block and the operator edits it before each
> build.** The alternative is EAS environment variables (dashboard or `eas env`), and it is rejected
> here: it adds a second place to look, an account-scoped step nobody can review in a diff, and a way
> for the build to pick up a stale value invisibly.

**The mechanism is visible in round 1's own text.** It runs a constraint pass once, under F2
(`:112-114`), and scopes it to GOTCHAs — *"The plan's nineteen `GOTCHA`s were read"*. That quote is
round 1's sentence as written; the digit in it is wrong. **The plan has eighteen** — `grep -cE
"GOTCHA"` and `grep -c '^- \*\*GOTCHA'` both return 18 over
`.claude/plans/driver-device-day-prep.md` at `a71a6b1`, `bd5193a`, `3998e9b` and `origin/main`, so
there is no head at which nineteen held. #219's fix pass corrected it as its own F10 and `main` now
reads *"eighteen"*. The scope argument below is about which *kinds* of constraint the pass reached
and is unaffected by the count. A `DECIDED`
bullet is structurally out of that pass's reach, and the skill's prescribed grep
(`do not modify|do not edit|read-only|no changes to|frozen`) does not match "is rejected here"
either. The other eight findings got no pass at all. `piv-review-pr` says the pass is per proposed
fix — *"For each proposed fix, grep the plan"* — and that a fix breaking the PR's own decisions gets
an issue, not an inline recommendation.

**Round 1's fallback was the right answer and is what landed.** Its closing sentence — *"Failing
that, one sentence in §0 saying the edit stays uncommitted closes it"* — is credited by name in the
plan's amendment at `:583`: *"**Added 2026-09-17 (PR #218 review F5)**: that Setup line must also say
the edit stays **uncommitted** … The decision above is unchanged; only its day-0 instruction is
completed."* So no harm reached the tree.

**Round 2 had the evidence and did not close the loop.** Its F5 row (`:385`) marks the outcome
*"✅ **departure argued and correct**"* and cites the very bullet (`:566-577`, the pre-`b2421ad`
range), and *What is good* praises the implementer for treating a weighed-and-rejected alternative as
a constraint. Both are true. Neither records that the thing departed from was the reviewer's own lead
prescription, so a reader of the F-table learns the implementer chose well, not that the review
pointed the wrong way first.

**Why Medium.** Nothing broke: the implementer caught it, the plan records why, and round 2 verified
the landed fix. But the constraint pass is the skill step that exists to prevent precisely this, it
ran on 1 of 9 findings, and the one case it would have caught is the one it skipped — in a PR whose
own thesis is that a review must not carry a claim its source contradicts.

**Fix**: in round 1, demote `env:create` to the alternative and lead with the §0 sentence, citing
plan `:573-586`; widen the constraint pass past `GOTCHA` to `DECIDED`/`PATTERN` bullets and run it
per finding. In round 2, one clause in the F5 row naming which half of round 1's prescription was
contra-plan.

### F4 — Low · four pointers in `.claude/code-reviews/pr-218-review.md` that do not cover what they cite

Round 1's Summary claims *"roughly thirty `file:line` claims were opened and checked against source,
and all but two (F7, F8) land exactly"* (`:29-31`), and files F7 and F8 as Lows for pointers that
stop short of their subject. Its own text commits that class four times. All four `observed` at the
anchors below.

**1. A silent file switch, `:276-277`** — the sharpest of the four, because it is undetectable by
reading:

> `driver.push.stub_sent` (`stub-push.provider.ts:25`), `auth.otp.stub_sent` (`:20`),
> `auth.sms.stub_sent` (`:33`)

The bare `:20` and `:33` read as the same file. `services/api/src/features/push/stub-push.provider.ts`
is 33 lines long, so both resolve: `:20` is `export class StubPushProvider implements PushProvider {`
and `:33` is the closing `}`. The two `auth.*` events are in a different file —
`services/api/src/features/auth/sms/stub-sms.provider.ts:20` and `:33`. The line numbers coincide, so
a reader chasing either lands on real code and never learns they are in the wrong file. This sits in
*Claims checked and confirmed*, the section that by construction nobody audits.

**2. F1's precedent range, `:50-56`** — in the only High. It quotes the `"extra": { "eas": {
"projectId": … } }` block plus `"owner"` and cites `spikes/gps-harness/app.json:44-48`. `"extra":`
opens at **`:42`**; `:44-48` runs `projectId` → `}` → `},` → `"owner"` → `}`, so the quoted opening
two lines are outside it. **Round 1 cites the stale range twice, not once** — `observed`, at
`150e711`: `git show 150e711:.claude/code-reviews/pr-218-review.md | grep -n "app.json:44-48"`
returns `:21` (the Summary) and `:50` (this precedent range). Both are closed on `main`, which
carries `:42-47` at `:24` and `:59`. The implementer landed the corrected range unprompted:
`docs/runbooks/driver-device-day.md:133` cites `spikes/gps-harness/app.json:42-47`.

**3. F5's header, `:165`** — cites `apps/driver/eas.json:11` for `"EXPO_PUBLIC_API_URL":
"http://192.168.1.11:3001"`. At round 1's own anchor `a71a6b1` that string is at **`:10`**; `:11` is
`},` (`git show a71a6b1:apps/driver/eas.json`). Not post-hoc drift — an off-by-one at the head the
report was written against. The range forms elsewhere are right: the fixes report's verifier asserts
`apps/driver/eas.json 9,11` and the runbook says `eas.json:9-11`, both of which contain it.

**4. F5's premise, `:171`** — *"The value already has an untracked home at `.env.example:53`"*.
That file is **tracked** (`git ls-files --error-unmatch .env.example` succeeds; `CLAUDE.md`'s
Commands block opens with `cp .env.example .env`, and the plan at `:577-578` calls it
"the committed env template"). The untracked file is `.env`, ignored at `.gitignore:14`.
And `:53` holds `http://localhost:3001` — the **key** has a home there, the LAN value F5 objects to
does not. The comment at `:50-52` is real and does explain the bundle-time inlining, so that half
stands.

**Why one Low rather than four.** None changes a conclusion. F1's argument needs the precedent file
to commit both keys, which it does; F5's prescribed fix is `eas env:create`, not `.env.example`,
and F5 itself says two paragraphs later that an EAS cloud build never sees the invoking shell's
environment — so the `.env` path could not have been the alternative anyway.

**Fix**: give `stub-sms.provider.ts` its own filename; `:42-47` for the precedent; `:10` or `:9-11`
for the URL; strike "untracked" or say *"its live counterpart `.env` is untracked"*.

### F5 — Low · both files' `docs/runbooks/driver-device-day.md:NNN` locators

**Fourteen locators are anchored at runbook versions that no longer exist, and neither file says so
next to them.**

Round 1 is written against a **231**-line runbook (`a71a6b1`), round 2 against a **289**-line one
(`bd5193a`). Main's is **322** — `9eb1527` added 33 more applying round 2's own M1/M2/L1–L6.
`observed`, `git show <sha>:docs/runbooks/driver-device-day.md | wc -l`: 231 → 289 → 322.

Spot-checked against main (`observed`, `sed -n 'NNNp'`):

| Cited | Report's subject | What sits there in main |
|---|---|---|
| R1 `:46` | the *does NOT need* table row | the same row, reworded by F1's own fix — **resolves** |
| R1 `:174` | step 7 | cleartext-manifest prose |
| R2 `:192` | step 1 | the `### 4 — Telling a transport fault` heading |
| R2 `:196` | step 5's Expect cell | a blank line |
| R2 `:236-237` | the nudge-family note | F3's `clientAt`/`at` note |

**Why Low.** Both headers carry their anchor sha on line 4, which is what a reader needs, and that
anchor is the leg this Low rests on. The repo's norm across the **65** prior `.md` files in
`.claude/code-reviews/` is close to it — **61 of the 65 carry a single commit** (`observed`:
`git log --oneline origin/main -- <file>` over each of the 67 `.md` at `origin/main`, minus #219's
two adds). It is not *never* re-swept: **four** have more than one, and each was edited to correct a
*claim* rather than to chase branch movement — `pr-110-review.md` (four post-landing commits, two of
them #112 re-deriving the swept-file count), `pr-121-review.md` and `pr-121-review-round3.md`
(`9713cb5`, retiring the Redis diagnosis), `pr-147-review-round3.md` (a round-3 addendum). Locator
drift after the branch moves is the narrower thing this finding is about, and nothing in the log
shows a sweep for that, so raising it higher would still invent a standard the repo does not hold.
Internally the locators are consistent: round 2's `:259`/`:260-261` map to main's `:292`/`:293-294` under a uniform
+33, and round 1's `:201` maps to the same `:292` under its +91.

It earns a line because round 2 *itself* raised a materially identical case as M2 site 3 — a dated
review artifact whose locator stopped pointing at its subject. The difference round 2 leaned on was
that the decision there rested on the wrong fact; here the header states the anchor.

**Fix**: one clause on line 4 of each file — *"locators into `docs/runbooks/driver-device-day.md` are
at this head's 231-line version"* (289 for round 2).

### F6 — Low · `.claude/code-reviews/pr-218-review-round2.md`, the lockfile bullet

**An `observed` count with no command behind it, and four extractions do not reach it.**

> diffing the distinct `name@version` key sets between the two blobs gives **added
> `expo-build-properties@57.0.20`, removed nothing, 1087 → 1088** (`observed`).

The load-bearing half reproduces **exactly** and settles what it was raised to settle — `+49 −11` on
the raw diff looks like several packages moving and is not. `observed`, extracting `name@version`
keys from both blobs and diffing the sets: added `expo-build-properties@57.0.20`, removed nothing.

The absolute totals do not reproduce under any reading I tried, all of them +1 and none of them 1087:

| Extraction | base → head |
|---|---|
| every `^  <key>:` line, peer suffixes stripped | 1657 → 1658 |
| the `packages:` section alone | 1649 → 1650 |
| the `snapshots:` section alone | 1649 → 1650 |
| unique package **names**, version dropped | 1372 → 1373 |

Neither figure is wrong on its face — they are different key-set definitions over one file — but the
report names no command, so the next reader cannot tell which was meant. `CLAUDE.md`'s provenance
rule asks an `observed` figure to name the run that produced it, and this is the one bullet whose
whole point is that the raw diff misleads.

**Fix**: print the extraction beside the digits, or drop the totals and keep the delta and the
package name, which are all the argument needs.

### F7 — Low · `.claude/code-reviews/pr-218-review.md:351`

**The 500-line cap is waved off with an exemption #112 does not grant.**

> the 500-line cap does not bind (`eas.json` is 17 lines; PIV artifacts are exempt per #112).

`CLAUDE.md:60` reads: *"**Max 500 lines per file of shipped source** — what each package's build
compiles … `.spec`/`.test` files (`.ts`/`.tsx`), `test/`/`tests/` and `scripts/` are **outside the
rule and uncapped** (#112)."* Markdown under `.claude/` is in none of those three categories. The
conclusion is right — the cap does not reach a `.md` file, because it is not shipped source a build
compiles — but the reason given is an exemption that does not exist, and #112 is cited for it.

Worth a line rather than nothing because it is a rule citation in a review, and the next review that
inherits it will reach for #112 on a file the ticket never covered. Round 2 is 502 lines, which is
the kind of file that makes someone go looking.

**Fix**: *"the cap does not reach markdown — it binds shipped source a package build compiles
(`CLAUDE.md:60`)"*, and drop #112.

### F8 — Low · `.claude/code-reviews/pr-218-review-round2.md:10`

**"Every round-1 finding is closed" overstates what the report's own table says.**

Round 1's F1 header names **two** sites: *"`apps/driver/app.json` (no `extra.eas`) +
`docs/runbooks/driver-device-day.md:46`, `:83-85`"*. M1 exists partly because the second was not
closed — *"The same fix left the `:46` row describing the pre-`init` world"*, *"the row F1 rewrote
still cites the code path that same fix disables"*. The F-table cell is transparent (*"The `:46` row
half is incomplete → M1"*); the Summary line is not, and the Summary is what gets skimmed.

**Fix**: mark F1 ◑ in the table, or *"eight of nine fully closed; F1's runbook half carries into M1"*.

### F9 — Low · `.claude/code-reviews/pr-218-review-round2.md:225-246` (L1) against `:44-93` (M1)

**L1 is graded Low using the defence M1 refuses, and it is the one round-2 finding that fails M1's
own stated criterion.**

M1 sets the yardstick: *"**Why Medium, not High.** … **No ❌ on 4, 5, 7 or 8 can be produced by
this**"*, and in the same finding rejects the "a correct note sits elsewhere" defence: *"The note at
`:229-231` states both paths correctly — the row does not, and the row is what a reader consults"*.

L1 both fails the criterion and is granted that defence. It concedes the failure — *"But the ✅/❌
column is filled in from the cell"* — then rates Low because *"The cell does say 'see the two notes
below', and the note is unambiguous about which wins"*. `observed` at `bd5193a`: the cell says *"no
`clientAt` gap > 12 s"* (`:196`) and the note says *"treat one gap just over 12 s as a re-read; the ❌
is a stream that goes quiet and stays quiet"* (`:223-224`), under a rule at `:259` making step 5
binary. A 13 s gap read against the cell produces a ❌ that means "the fix did not land".

Round 1 graded that same failure mode — a false ❌ on step 5 — **Medium twice**, as F3 and F6. Same
step, same rule, different grade in the next round.

**Rated Low here, against the `code-reviewer` agent's Major, and the disagreement is worth stating.**
The agent is right that one of the two gradings has to move. It is Low rather than Major because the
mitigation is not merely "a note elsewhere": the cell carries an explicit pointer to it, which M1's
`:46` row does not, and because this is a grading inconsistency inside a superseded round whose
verdict (approve) is unaffected either way. #218 shipped L1's fix in `9eb1527` regardless.

**Fix**: re-rate L1 Medium, or state why a cell carrying a pointer to its own note is materially less
able to produce a false ❌ than F3's and F6's unguarded cells were.

## Validation

| What | Command | Result |
|---|---|---|
| Full gate | `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` at `3998e9b` (= main's content) | ✅ exit 0 · **22 successful, 22 total**, 0 cached, **1m30.86s**; `@taxi/api` 733 passed / 77 suites |
| CI on this PR | `gh pr checks 219` | ✅ 5/5 — `CodeQL`, `audit-diff`, `check`, `codeql`, `ready` |
| Merge is clean | `git merge-tree --write-tree origin/main 150e711` | ✅ exit 0, tree `76a2db2`, no conflict markers |
| Base drift | `git rev-parse origin/main` after `git fetch --prune` | `7ec3bd7` ≠ `baseRefOid` `b690e91` — **moved**; #218 merged at 14:48:41Z |

**Why the gate ran where it did.** This PR adds two files under `.claude/code-reviews/`, outside
every package directory, and `turbo.json` declares **no** `inputs` on any task and **no**
`globalDependencies` key (`observed`; `globalEnv` is six variables, none reaching `.claude/**`). No
task's cache key can see them, so main's gate result carries to the merged tree unchanged. The run
above is at `3998e9b`, whose tree is `7ec3bd7`'s content. This is round 2's own neutrality argument,
re-derived here rather than inherited.

## Claims re-derived, not inherited

Every figure and git-dependent claim I opened in both files. **All sixteen reproduce exactly.**
Nothing below is a finding.

- **Round 1's size table.** `git diff --shortstat b690e91 a71a6b1` → `12 files changed, 1887
  insertions(+), 34 deletions(-)`, matching `1349 + 231 + 198 + 30 + 29 + 49 + 1 = 1887`.
- **Round 2's size table.** `git diff --shortstat b690e91 bd5193a` → `13 files changed, 2299
  insertions(+), 34 deletions(-)`, and every bucket reconciles against `--numstat`: plan 1401,
  runbook 289, implementation report 198, fixes report 302, siblings 30, `apps/driver` config 29,
  lock 49, `CLAUDE.md` 1.
- **The icon arithmetic, to the byte.** The base blob's first 17 bytes are the literal ASCII
  `\x89PNG\r\n\x1a\n` (`5c78 3839 504e 47…` — backslash, x, 8, 9…); the head blob's first 8 are the
  real signature `8950 4e47 0d0a 1a0a`; `cmp` over both 683-byte tails reports identical. `git
  cat-file -s` gives 700 and 691, and `700 − 17 + 8 = 691`. A header repair, exactly as claimed.
- **The four `nudge_*` line refs.** `drivers.service.ts` lines 346, 355, 369, 380 hold
  `nudge_skipped`, `nudge_skipped`, `nudge_sent`, `nudge_failed` — all four exact, and the
  `back_online` one L3 names is the first of them.
- **M2 site 3's locator, the sharpest claim in either file.** The pointer paragraph (*"The run sheet
  has moved to…"*) occupies `driver-toggle-off-mid-ride-held.md:731-736` (`observed`), and `:737-746`
  — the range the implementation report cited — starts one line past it on the *"Still blocked on
  hardware"* sentence and runs into the api integration command. The 3-inside/7-past straddle stated
  by the correction commit `150e711` is exact.
- **The 231 → 289 growth**, and `docs/runbooks/rider-a11y-walkthrough.md` = **168**, the comparator
  M2 cites. `231 − 168 = 63`, `289 − 168 = 121`, `289 − 231 = 58` all reconcile.
- **The 30-assertion verifier, by count and by run.** The appendix block at
  `.claude/reports/pr-218-review-fixes.md:236-304` holds **27** `chk` plus **3** `nchk` = 30.
  Extracted verbatim (`sed -n '237,303p'`) and run at `3998e9b`: **30 PASS, 0 FAIL, `ALL CITATIONS
  RESOLVE`, exit 0** (`observed`) — so it survives not only `bd5193a` but the two further commits
  #218 landed after round 2. Per memory `taxi-review-payoffs-are-claims` this is the claim I most
  expected to slip, and it holds.
- **`npm view eas version` → `0.1.0`; `npm view eas-cli version` → `24.7.0`.** Both exact today.
- **#217 touched exactly one file.** `git show --stat b690e91` → `docs/runbooks/hetzner-deploy.md`
  alone, `156 insertions(+), 14 deletions(-)`. Round 1's no-overlap conclusion holds.
- **D2's arithmetic.** `4792 + 4192 + 232 = 9216 = 96²`.
- **L2's collision probability.** `git log --all --since="30 days ago"` over `apps/driver/app.json`
  and `eas.json` returns three distinct pre-merge commits — `a71a6b1`, `602d5fb` (#15), `3d2e874`
  (#14) — as stated.
- **L1's and M1's own quotes.** `bd5193a:259` is *"Any ❌ on 4, 5, 7 or 8 means the fix did not
  land"*; `:196` and `:223-224` are the cell and note F9 quotes; `:229-231` states both the
  `unavailable` and `no_project` paths correctly, which is what makes M1's point land on the `:46`
  row rather than the note.
- **The lockfile conclusion.** Added `expo-build-properties@57.0.20`, removed nothing (F6 concerns
  only the absolute totals).
- **`turbo.json` declares no `inputs` and no `globalDependencies`.**
- **The claim every step's primary signal rests on — that `ping_accepted` actually prints.** All four
  legs hold (`observed`): `driver-location.service.ts:76` is `this.logger.debug({`; `main.ts:7` is
  `NestFactory.create(AppModule)` with no options; `grep -rn "setLogLevels\|logLevels"` over
  `services/api/src` returns nothing; and
  `node_modules/@nestjs/common/services/console-logger.service.js:12-19` is
  `['log','error','warn','debug','verbose','fatal']`, so `debug` is on by default. If it were not,
  the whole run sheet would be unreadable and both rounds would have passed it.
- **Both rounds really were posted, and #220 exists.** Comments `5715582096`, `5716087200`,
  `5716100986` on #218; [#220](https://github.com/linardsb/taxi/issues/220) is OPEN with the title
  M3 describes.

**The `code-reviewer` agent's pass, and what I did with it.** It opened ~55 further `file:line`
claims across both reports and found every one resolving except the four now in F4. Per memory
`taxi-review-payoffs-are-claims` **each of its findings was re-run here before entering this
report**: its two Majors became F3 (confirmed against the plan bullet at `:573-586`) and F9 (kept,
downgraded to Low with the disagreement stated); its citation pattern became F4; its "every finding
closed" note became F8. The one item it could not settle without Bash — F5's `eas.json:11` — I
checked at `a71a6b1` and it is a real off-by-one, so it entered F4 rather than being dropped. It also
independently confirmed the Nest and `eas-build-post-install` derivations above.

Not verified, so it is not mistaken for checked: round 1's *"§0 prints `192.168.1.11` on `en1`"* is
machine- and lease-dependent and I did not re-run it; and the EAS cloud build, correctly labelled
`expected` throughout both files, stays unrun for the reason they give.

## What is good

- **The separation is the point and it worked.** #218's five subsequent commits could not touch these
  files, because they live on a branch off `main`. That is memory `taxi-pr-review-report-location`
  applied correctly on the first try, in a session that also had to keep #218 moving.
- **Round 2's fix-mechanism pass is the real thing, not a heading.** M1 exists because someone asked
  what F1's own fix newly *permits* — `eas-cli init` writes the projectId, the projectId is the guard
  `registerPushToken` returns on, so the fix makes a permission dialog appear that could not appear
  before. That is the question `piv-review-pr` asks by procedure and almost nothing answers by
  finding.
- **Both departures from round 1's prescriptions are argued, and F2's really is better than what was
  asked for.** `nudge_*` as a superset survives a token existing; `reason: 'no_token'` would not. The
  report says which half of the prescription it kept and why.
- **M3 went to an issue instead of an inline fix, for the documented reason.** The root remedy
  contradicts the PR's own task heading at `driver-device-day-prep.md:607`, which is the case the
  constraint pass says to file rather than recommend.
  [#220](https://github.com/linardsb/taxi/issues/220) carries it — and F3 above is the same rule
  applied one finding earlier, where it was not run.
- **M2's fix instruction was followed to the letter, which is the part that usually is not.** M2 told
  the author to re-derive the size figure *after* the commit carrying the edit
  (`taxi-report-restating-pr-body-figures`). `9eb1527` applied M2 **and** the runbook edits in one
  commit, taking it 289 → 322 — the exact trap. `observed` at main: the implementation report reads
  **322** at `:22` and `:167`, and D8 now enumerates both contributions, `+58` for F1–F9 and `+33`
  for M1/L1–L4/L6. The figure survived its own fix, which is what the instruction was for.
- **Round 2 corrected its own M2 arithmetic in a separate commit** (`150e711`) and posted the
  correction to #218 as its own comment rather than quietly editing. The straddle it now states is
  precise, and I reproduced it.
- **The agent's findings were each re-run before entering round 2**, with one downgraded on severity
  and its proposed command carried as `expected` rather than adopted. That is
  `taxi-review-payoffs-are-claims` followed rather than cited — and I have applied the same rule to
  the agent's findings on *these* files, including refusing one of its severities.
- No hard rule is in scope: two markdown files under `.claude/`, no money, no ride status, no
  contract, no seam, no source of any kind. The 500-line cap binds shipped source a package build
  compiles (`CLAUDE.md:60`), which markdown is not — see F7 on the reason round 1 gives for the same
  conclusion.

## Recommendation

**Request changes**, on F1. The two files this PR exists to land are factually sound, and their
citation accuracy is the highest I have seen in this repo's review history — the ~55 `file:line`
claims the agent opened plus the sixteen figure groups I re-derived, four wrong pointers between
them and no wrong facts. What
cannot merge as it stands is the body: it promises one file and a request-changes verdict and
delivers two files and an approval, with a size figure nothing reachable from the PR produces.

F2 and F3 are each a clause and a citation, and neither changes a verdict — F3's mis-prescription was
caught by the implementer and never reached the tree. F4–F9 are one line each.

Fix the body with `gh pr edit 219 --body-file`, add F2's scope clause and F3's citation, and this is
an approve. **That is the round-1 call at `150e711`, not a standing direction** — #219's fix pass
applied all nine findings and #219 merged at `8ebf2ba`.

Next: `piv-fix-review-findings` on this report, then re-validate.
