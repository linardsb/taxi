# PR #235 review — round 1

**Head** `96c51f3` · **Base** `main` @ `414bada` · **Reviewed** 2026-09-20 · **Round** 1 (no prior report)

`docs(runbooks): #141's verdict rests on #224's emulator run, not a phone` — 6 files, +1827 −20.
**No shipped source.** 1793 of the 1827 additions are four previously-orphaned review reports landed
unchanged; the reviewable edit is 34 lines across two documents.

Guarantees pass **skipped**: first round, and the base has not moved — `git fetch origin && git
rev-parse origin/main` → `414bada`, identical to the PR's `baseRefOid` (`observed` 2026-09-20).
Fix-mechanism pass **skipped**: no prior round.
No implementation report exists for this branch (`.claude/reports/` holds
`emulator-oracle-141-report.md`, which is #224's, not this PR's) — reviewed against the PR body, the
commit messages and the plan instead.

## Verdict: request changes

**One High, three Medium, four Low.** No Critical.

The verdict flip itself is correct and I could not break it. I re-swept the runbook independently of
the PR body's own check — all 30 `phone` hits and all 24 `#141` hits at head, plus the four stale
passages at base — and **no claim that #141 is open or that a phone is owed survives**. §Result backs
every one of the three new factual assertions in §Verdict, digit for digit.

H1 is the reason for the verdict: **this PR shifts ten runbook anchors it did not sweep**, in the
same file it does sweep, past a tripwire that names this exact pass. All ten resolved at `414bada`
and none resolves at `96c51f3` — `observed`, both sides, below. The fix is mechanical.

---

## Issues

### H1 — High · `.claude/plans/emulator-oracle-141.md:830-835` · the anchor register this PR was told to re-derive, and didn't

`:825-836` is the anchor-translation register PR #233's M2 produced. It maps pre-#224 line numbers to
current ones and labels the right column **"Today:"**, then closes with a tripwire set deliberately:

> **The next pass that edits §Result re-derives this mapping rather than adding another +20 to it.**

This pass edits §Result — hunk 2 rewrites the §Result note (`@@ -31,10 +37,9 @@`) and hunk 1 adds six
lines above it, moving `## Result` itself from `:13` to `:19`. The mapping was not re-derived.

**All ten entries resolved at the base and none resolves at head** (`observed` 2026-09-20,
`sed -n "<n>p"` on `git show 414bada:docs/runbooks/driver-device-day.md` vs the head worktree):

| Register "Today" | Subject | At `414bada` | At `96c51f3` | Correct now |
|---|---|---|---|---|
| `:13` | `## Result` | ✅ `## Result` | ❌ *"the other passes in §Also on this day…"* | `:19` |
| `:53` | the *"mostly worked"* sentence | ✅ | ❌ *"ceiling, and Expo SDK 57 needs 26.4…"* | `:58` |
| `:57` | `## What this day does NOT need` | ✅ | ❌ *"**When a phone exists:**…"* | `:62` |
| `:106` | `### 1 — Boot the stack` | ✅ | ❌ *"moving often, not on the day…"* | `:111` |
| `:242` | step 5's row | ✅ | ❌ the §Steps header row | `:247` |
| `:253` | *Which timestamp, and why 12 s* | ✅ | ❌ *"(`…driver-toggle-off-mid-ride-held.md`…"* | `:258` |
| `:266` | *"The 12 s is `derived`…"* | ✅ | ❌ *"read both ends: a `clientAt` gap check…"* | `:271` |
| `:302` | *"Why step 7's window is 2 minutes"* | ✅ | ❌ *"(`fix-throttle.ts:9`…"* | `:309` |
| `:310` | `## Verdict` | ✅ | ❌ *"in the **broken** app is **C + 60 s**…"* | `:317` |
| `:331` | `## Also on this day` | ✅ | ❌ *"be resolved, because at that point…"* — **inside §Verdict** | `:345` |

Three things make this High rather than Medium:

1. **The `:331` row inverts the rule it serves.** The GOTCHA reads *"Insert nothing above `:290`
   (§Verdict) and nothing inside §Also on this day (`:311`)"* — two section boundaries, and the
   register is how a later pass locates them. At head both are misplaced: §Verdict is `:317`, not
   `:310`, and §Also on this day is `:345`, not `:331`. A pass following the register protects
   `:331`–`:344` (which is actually §Verdict, and which the rule permits editing) and treats `:345`+
   as clear — which is the section the rule actually protects. The rule does not merely stop being
   enforceable; it points the other way. `:813`'s *"append after `:322`, at the very end of the
   file"* is stale on the same axis (the file is 660 lines), though that predates this PR.
2. **It falsifies the PR's own completeness claim.** The body and commit `9ab6b2f` both say the
   anchors *"shift with this edit (+5 to +7, per hunk). Each is re-pointed and re-read."* Neither
   holds for these ten. And `+5 to +7` does not cover the file: `## Also on this day` moved **+14**
   (331 → 345), because the hunks above it sum to +14, not +7.
3. **`:835` is now self-contradicting.** It asserts *"`:186`'s `:13-22` still spans the Result heading
   and field table and needed none"* — but this PR changed `:186` to `` `:19-28` ``. The register's
   prose and the citation it describes now disagree inside one file.

**Fix** — either re-derive the ten with the right column above, or take the register's own advice and
delete the translation layer (`:830-836`) now that it has gone stale twice in three PRs, leaving
`:811-824`'s pre-#224 anchors marked as the historical record they already are. Either way, `:835`'s
`:13-22` → `:19-28`.

### M1 — Medium · PR body §Validation, the residual-claims line

> `residual phone-requirement claims after the edit: one hit, and it is the new sentence saying the
> phone leg *is not* owed`

This sits under a heading reading *"Doc-accuracy checks, since typecheck and lint cannot read prose
(`observed`)"*, and it is **the only check covering the PR's entire purpose**. It states a count and
names no command, so it cannot be reproduced or falsified — which is what `CLAUDE.md`'s provenance
rule exists to prevent (*"`observed` (name the run that produced it)"*). Its two siblings on the same
list do name theirs.

**Probed at head (`observed` 2026-09-20 at `96c51f3`, worktree `wt-141close`):**

| Pattern | Hits | Where |
|---|---|---|
| `phone` | 30 | throughout — it is a phone run sheet |
| `on a phone` | 3 | `:41`, `:333`, `:340` — all new, all benign |
| `Only a phone` | 0 | retired (1 at `414bada`) |
| `still owed` | 0 | retired (1 at `414bada`) |
| `close #141` | 1 | `:381` — **not** the sentence the body describes |
| `is not owed` / `not owed` / `owed by` | 1 | `:337` — the described sentence |

Only the last row lands on the sentence the body names, and those patterns match the **negation**
("it is not owed by #141"), so by construction they cannot detect a surviving positive claim. Every
pattern that *could* falsify the claim returns 0 or 3, not 1.

**The conclusion is right** — I verified it the long way (see Validation). **Fix:** print a command
that can fail, e.g.
`grep -in "only a phone\|still owed\|does not close #141\|is Linards' call" docs/runbooks/driver-device-day.md`
→ `0`.

### M2 — Medium · `docs/runbooks/driver-device-day.md:194-195` · a "has never run" the #224 run retired

> **The cloud build is `expected`, not `observed`.** It has never run: it needs Linards's Expo
> credentials and a build credit.

False at head, and contradicted three times in the same file — `:25` (the APK under test is *"EAS
build `bcd04c21-…` on commit `4e6ffb68`"*), `:473` (Gate 2, *"one EAS build"*, ✅ `observed`
2026-09-18), `:628-630` (*"the first green build is `bcd04c21-…`, **1199 s** … against `edcc579b-…`
which died at `lintVitalRelease`"*). The plan agrees at `:1149-1150`: *"Retired 2026-09-18 by running T7.
EAS granted a build on the free tier … so neither the login nor the credit was ever the
constraint."*

**Pre-existing, not introduced here** — identical at `414bada` (`grep -c "It has never run"` → 1 on
both sides), and outside the PR's stated scope of four phone-requirement passages. Raised anyway
because it is the same defect class the PR exists to remove, falsified by the same #224 run the PR
cites, in the file the PR already opens.

**Fix (optional here, or a follow-up):** replace with an `observed` line naming the two 2026-09-18
builds and citing §The build blocker — cleared. `:200`'s *"Budget one failed build anyway"* is now
`observed` (`edcc579b`) rather than precautionary and is worth saying so.

### M3 — Medium · `.claude/plans/emulator-oracle-141.md:714`, `:742`, `:780` · three more stale anchors, and the "seven sites" count

Three live runbook citations written as bare `` `:NNN` `` — invisible to
`grep -rn "driver-device-day.md:"`, including the plan's own VALIDATE sweep at `:841`. They carry
pre-#224 values and sit in T8/T9/T10, so `:829`'s *"every anchor in this GOTCHA and in the paragraph
above it"* disclaimer does not cover them:

| Plan line | Cites | Claims it is | At head `:NNN` is | Correct now |
|---|---|---|---|---|
| `:714` | `:233` | *the note (Which timestamp, and why 12 s)* | `## Steps` | `:258` |
| `:742` | `:222` | *the step 5 row* | §4's blockquote | `:247` |
| `:742` | `:233` | *and its note* | as above | `:258` |
| `:780` | `:35` | *"'Mostly worked' is not a result — the runbook says so"* | *"`pm grant` + `appops set`…"* | `:58` |

**Already stale at `414bada`** (these are pre-#224 numbers), so the staleness is inherited. What is
**this PR's** is the completeness claim built on top of it: the body says the plan *"cites the runbook
by line at **seven sites**"*. With these three and the ten in H1, seven is not the count. The previous
fix pass caught the analogous bare `:302` at `:179` and said so; this pass did not extend the same
search.

**Fix:** re-point the four values in place (text-matched at head, not arithmetic-shifted), and drop or
qualify "seven sites".

### L1 — Low · `.claude/plans/emulator-oracle-141.md:174` · off-by-two, shifted rather than re-read

`:170-173` blockquotes **two** runbook lines and `:174` attributes them to `` `:111-113` ``. At head
that text is at `:113-114`; `:111` is the `### 1 — Boot the stack` heading and `:112` is blank, so the
range starts two lines early and covers only the first of the two quoted lines.

The same off-by-two existed at base (`:106-108` for text at `:108-109`), so this is the one anchor the
pass moved by arithmetic (+5) rather than by re-reading — which is what the body claims was done
("re-pointed and then **re-read against the text it originally named**"). The PR body's own table
papers over it by describing `:111-113` as *"`### 1 — Boot the stack`"*, which is `:111` only.

The other six resolve exactly. **Fix:** `:111-113` → `:113-114`.

### L2 — Low · PR body §3 header, and commit `9ab6b2f` · a digit on the wrong noun

The header says **"ten shifted anchors re-pointed"**; its own body two sentences later says **"six
distinct anchors"** and **"ten line numbers"**, and it closes **"All ten `observed` resolving"**. The
commit repeats it: *"Ten runbook anchors … Each is re-pointed and re-read: `:19-28`, `:62-77`,
`:111-113`, `:271`, `:309`, `:323-326`"* — six listed, called ten.

Ten is the count of **distinct line numbers** (19, 28, 62, 77, 111, 113, 271, 309, 323, 326). There
are **6 distinct anchors across 7 citation sites**; the body's own sentence has it right. Worth
correcting precisely because a real ten-anchor set exists in this file — the register in H1 — and it
is the one that was *not* re-pointed.

**Fix:** "six anchors re-pointed across seven sites", in both places.

### L3 — Low · PR body §"Nothing here is a fix pass on PR #233's review"

> `apps/rider`'s `ios` scoping, `apps/rider/src/locales-config.test.ts` and
> `.claude/reports/pr-233-review-fixes.md` are all on `main` already (`observed`, `git cat-file -e
> origin/main:<path>` for each).

`git cat-file -e` is cited "for each", but the first item is not a path and that command cannot
observe it — `apps/rider/locales/lv.json` existed before M1 and `cat-file -e` succeeds either way.

The claim is **true**: `git show origin/main:apps/rider/locales/{lv,ru,en}.json` all three carry the
key under `"ios"` (`observed`), and `pr-233-review-fixes.md` on `main` records M1–M5, L1–L7 plus an
N1 all ✅. Only the named method is weaker than the sentence it supports.

**Fix:** drop `ios` scoping from the `cat-file -e` list, or cite a check that reaches it.

### L4 — Low · `.claude/code-reviews/pr-227-review.md:356-357` · the one landed report that reads as current

> **File the `:app:lintVitalRelease` ticket.** No open issue covers it (`gh issue list`, 26 open,
> `observed`) and it is the remaining blocker on #141, #14, #16 and #4.

Both halves are false at `414bada`: the ticket exists and is closed (**#232**, cited as fixed and
guarded at `docs/runbooks/driver-device-day.md:615-620`), and #141 is closed.

That is fine as history — except `pr-227-review.md:3` is the **only** one of the four carrying no read
date (`**Head** … · **Base** … · **Round** 1`). `pr-221-review.md:6` has *"(read 2026-09-17…)"*,
`pr-226-review.md:3` and `pr-233-review.md:3` both have *"**Reviewed** …"*, which is why their
`#141 OPEN` lines read correctly as snapshots.

**Fix:** add `· **Reviewed** 2026-09-18` to `pr-227-review.md:3`. One header field; the report stays
the unaltered record the PR intends to land.

### L5 — Low (informational) · PR body §Validation, the gate figures

`Tasks: 22 successful, 22 total` / `2m28.124s` / `694 passed, 733 total` are **author-reported** from a
local worktree run and are **not re-observed** here: five other `claude` processes are live on this
checkout and integration runs are mutually destructive across sessions (global-setup drops the shared
test DB), so re-running the local gate was the riskier act, not the safer one.

They are corroborated, not verified — CI's `check` job ran the same command green on this exact head
(below), 22 matches the repo's documented `turbo --dry=json` count, and `39 skipped / 694 passed / 733
total` plus `2 skipped / 75 passed / 75 of 77` match `CLAUDE.md`'s re-observation at `0cdb59c` digit
for digit. No action — recorded so a later round does not inherit them as re-observed.

---

## Validation

| Check | Result | Provenance |
|---|---|---|
| `check` (the CI-parity gate) | ✅ `pnpm turbo run typecheck lint test build`, 3m37s | `observed` — run `35502077083`, job `106055505755`, at head `96c51f3` |
| `codeql` | ✅ 1m22s | `observed` — same run |
| `CodeQL` | ✅ 3s | `observed` |
| `audit-diff` | ✅ 8s | `observed` |
| `ready` | ✅ 6s | `observed` — PR is out of draft |
| `mergeStateStatus` | `CLEAN` | `observed` — `gh pr view 235` |
| Local gate | not re-run | deliberate — see L5 |

The diff touches no file any package compiles, lints or tests, so a green gate says only that nothing
regressed. That is the whole claim a documentation change can make, and the PR body says so itself.

**Doc-accuracy checks I ran** (`observed` 2026-09-20 at `96c51f3`, worktree `wt-141close`; base side
from `git show 414bada:…`):

| Check | Result |
|---|---|
| The four reconciled passages were *all* of them at base | ✅ `grep -iE "only a phone\|still owed\|does not close\|close #141\|Linards' call"` on `414bada` → exactly 4 passages: `:4`+`:8` (header), `:34-36` (§Result note), `:326` (§Verdict), `:367` (§Emulator route). No fifth. |
| No surviving "#141 is open / a phone is owed" claim | ✅ all 24 `#141` hits and all 30 `phone` hits read at head |
| §Result table backs the new §Verdict text | ✅ Date `2026-09-18`; *"All eight steps ✅ on an emulator"*; *"Steps 4, 5, 7 and 8 — the four the §Verdict rule makes binary — all pass"* — matches `:333-334` exactly |
| The six re-pointed anchors resolve | ✅ 5 of 6 exactly (`:19-28`, `:62-77`, `:271`, `:309`, `:323-326`); `:111-113` off by two — **L1** |
| The plan's runbook citations are fully enumerated | ❌ 7 claimed; 3 more bare ones at `:714`/`:742`/`:780` (**M3**) and 10 in the register (**H1**) |
| Register anchors, base vs head | ❌ 10/10 resolve at `414bada`, 0/10 at `96c51f3` — **H1** |
| `grep -c "Expect"` tripwire | ✅ 2 at `414bada`, 2 at `96c51f3` |
| `480 + 517 + 363 + 433 = 1793`; `1793 + 7 + 27 = 1827` | ✅ matches `additions` |
| Four reports absent from `main` before landing | ✅ `git cat-file -e origin/main:<path>` → absent, all four |
| Landed reports are head-anchored | ✅ all four carry head/base shas; 3 of 4 carry a read date — **L4** |
| #234 exists, OPEN, defect re-verified | ✅ at `414bada`: one production write (`board-state.ts:127`), reads only in a different slice (`tracking/tracking-map.tsx:75,227`), rest test fixtures |
| #141 state | ✅ `CLOSED` / `COMPLETED` at `2026-09-20T09:21:26Z`, closed directly — `closingIssuesReferences` is `[]` |
| No closing keyword near `#234` or `#141` | ✅ PR body and **both** commit messages swept — #234 stays open on merge |
| PR #233's 12 findings are on `main` | ✅ `pr-233-review-fixes.md` verdict table: M1–M5, L1–L7, N1 all ✅; rider `ios` scoping present in all three locale files on `main` |

**Constraint pass.** `grep -in "do not modify\|do not edit\|read-only\|no changes to\|frozen\|do not
widen"` over the plan and the runbook: the runbook's own **"Do not widen this sheet"** (`:16`) is the
only constraint this edit is under, and it holds — the edit adds prose and a ticket link, no steps,
and the line is preserved. The plan's two `do not edit` GOTCHAs target `eas.json`'s `distribution` and
`app.json`'s cleartext entry, neither of which this PR touches. **Passes** — H1 is not an AC conflict,
just an unswept anchor set.

---

## What's good

- **The four reconciled passages are genuinely all of them.** I looked for a fifth at base and there
  isn't one. The edit distinguishes cleanly between "the phone leg is no longer owed *by #141*" and
  "the phone leg is still wanted by #4 and #14" — the distinction that makes this edit correct rather
  than merely convenient.
- **The sheet is not retired, and says so at the top** (`:12`), with §Verdict's binary rule still
  governing later runs and an explicit reopen condition (`:340`). A closing edit that leaves the
  reopen path open is the harder and better version.
- **The closure is graded, not asserted.** §Emulator route § *What an emulator can and cannot prove
  here* is untouched apart from its closing sentence, `:369` still says the grade "has not changed",
  and §Result records the step-1 method divergence instead of rounding it into a clean ✅. The PR
  closes an issue without upgrading the evidence behind it, and does not pretend otherwise.
- **A deferral that named no ticket now names one** (#234), with the defect re-verified for the
  filing rather than inherited from the deferral's wording — its `lastSeenAt` tally reproduces exactly
  at `414bada`.
- **Head-anchored historical records left alone on purpose**, with the reason stated (PR #233's M2).
  That is the right call and the opposite of what a tidy-up instinct would do.
- **The PR body pre-empts the obvious misreading** — that landing `pr-233-review.md` implies its
  findings are owed here — and backs the rebuttal with the fixes report already on `main`.
- **Landing the four orphans at all.** `pr-221`, `pr-226`, `pr-227` and `pr-233` were on no branch and
  would have died with the working tree. That is the #143 failure mode caught before it repeated.

---

## Recommendation

**Request changes** — on H1 alone. It is caused by this PR, it trips a tripwire the file set for
exactly this pass, and one of its ten rows now points a future editor into a section the same GOTCHA
forbids. The fix is ten line numbers or one deletion.

Worth taking in the same pass since they are all line numbers in the same two files: **M3** (four
values) and **L1** (one value). **M1** is a one-line PR-body amend that makes the PR's own check
falsifiable. **L2**, **L3** and **L4** are one edit each and can ride along or be dropped. **M2** is
pre-existing and out of scope — fix it here or file it, your call, but it should not gate the merge.

Nothing here argues against the substance. The verdict flip is internally consistent, correctly
graded, and backed by §Result.

**One note for whoever merges:** this PR exists because four review reports were written into the main
checkout and orphaned. This report is the fifth — written to the main checkout, which is on
`feature/driver-device-day-prep` and not this PR's branch, so it cannot be swept in. It still needs a
`docs/` PR of its own, or it orphans the same way.
