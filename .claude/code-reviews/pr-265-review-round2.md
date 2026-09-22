# PR #265 review — round 2

**PR**: [#265](https://github.com/linardsb/taxi/pull/265) — *docs: run #15's offers / active-ride device pass on the emulator, and file what it found*
**Head** `c0f487d` · **Base** `main` @ `d6207be`
**Diff**: 4 files, +1,670 / −3 · documentation only, no shipped source · round-2 delta `6eec024..c0f487d` is 4 commits, +272 / −45
**Reviewed**: 2026-09-22, fresh context, detached worktree at the PR head; `code-reviewer` agent dispatched on the round-2 delta, each of its findings reproduced here before entering this report
**Verdict**: **request changes** — 1 High (F1, reopened), 3 Medium (F4 and F5 reopened, F11 new), 2 Low. **No finding threatens a conclusion.** The device pass, the two filed defects and the decision to leave #15 open all stand. What is still wrong is where the text says which build ran which step, and where four citations point.

---

## Summary

The fix pass closed most of round 1 properly, and it checked the evidence rather than quoting it.
All 18 distinct `driver-device-day.md:NNN` targets resolve to the phrase they cite. The `§D3` /
`9` phantom is gone from every live sentence. The byte-identity argument enumerates the right key
set, and the tick count is 25 against 17. Every F10 row reopens correctly. N1 and N2 are real
catches that round 1 missed. The fix pass was also right that round 1 got two F10 rows wrong.

**Three round-1 findings are not closed, and the fixes report says they are** (*"All ten findings
fixed"*, `.claude/reports/pr-265-review-fixes.md:8`):

1. **F1 (High), reopened.** Four more citations into the runbook are broken. They are written as a
   bare `` `:NNN` `` without the file name, so the closing grep for `driver-device-day.md:NNN`
   could not see them. **Round 1's own F1 table had the same blind spot**, so the miss started
   in the review.
2. **F5 (Medium), reopened.** The claim that steps 1, 2 and 3a ran on the #15 build was removed
   from the report and the PR body. It survives in the **runbook's §Result table**, which is the
   surface CLAUDE.md sends every device-day session to. Round 1 missed this copy too.
3. **F4 (Medium), reopened.** Three report lines still describe the state after pass 1 only.

**One new Medium came from a premise round 1 supplied (F11).** The fix pass settled the
`16:23:16` install time as UTC by ruling out Rīga time. The machine that ran the pass is on BST,
so the install was **15:23:16Z**. The pass's own api log shows it.

The two Lows are one sentence moved by the commit that recorded it, and one attribution to the
wrong list.

---

## Routing

**AGENT FIXES** — mechanical, one commit:

- **F1** — plan `:108` → `:567-568`; plan `:242` → `:700-701`; plan `:550` → `:534`; report `:138` → `:600`. Then re-run the sweep with a pattern that matches bare `` `:NNN` `` too (below).
- **F5** — runbook `:380`, `:384` and report `:248-249`: say which build ran steps 1, 2 and 3a.
- **F4** — report `:61` (T3), `:234`, `:36`.
- **F11** — report `:20` and fixes report `:25`, `:75-91`: `16:23:16Z` → `15:23:16Z`.
- **F12** — fixes report `:22`, `:147`, `:173`: scope the three unscoped greps to "outside this file".
- **F13** — report `:20`, `:63`, fixes report `:47`: 3b is sourced by its own row, not by I5's list.

**HUMAN DECIDES** — carried from round 1, still open, correctly left open by the fix pass:

1. **I2's deliberate `assertTransition()` bypass** (`.claude/reports/driver-15-offers-device-pass-report.md:330`): five 2026-08 dev-DB rides retired by direct `UPDATE`. It is the first recorded exception to a hard rule. Linards decides whether to accept the precedent in writing.

**HUMAN TESTS** — unchanged from round 1: step 13's banner, step 9's glance mode via `geo fix`, step 12 on the second AVD, #263's starvation half on a real device.

---

## Issues by severity

### F1 — High, reopened · four citations into the runbook still land on the wrong line

`.claude/plans/driver-15-offers-device-pass.md:108`, `:242`, `:550` · `.claude/reports/driver-15-offers-device-pass-report.md:138`

The runbook is already named in the surrounding sentence, so these cite it as a bare
`` `:NNN` ``. `observed` at `c0f487d`:

| Cited | In | Should point at | Now resolves to | Correct at head |
|---|---|---|---|---|
| `:434` | report:138 | *«`adb emu geo fix` alone does nothing»* | blank | **`:600`** |
| `:390` | plan:108 | the `google_apis`-not-`default` rule, §"Setup, once" step 3 | the ⚠️ step-7 note in §Result | **`:567-568`** |
| `:531` | plan:242 | *"an `input tap` at exact centre coordinates proves nothing about the 44 px…"* | `## Emulator route` | **`:700-701`** |
| `:368` | plan:550 | the cite-§Steps-by-number rule | blank | **`:534`** |

The same mechanism, the same file and the same consequence as round 1's F1: a reader following
report `:138` for the `geo fix` finding lands on a blank line. Round 1 rated F1 by what each broken
citation costs, not by how many there were, so four instead of thirteen does not lower it.

**Why the closure missed them.** The fixes report's closing list at `:176-177` (*"Remaining
`driver-device-day.md:NNN` citations across plan and report, all re-checked"*) is complete **for
that pattern**. It is the pattern that is incomplete. Round 1's F1 table was built with the same
pattern and has the same gap, which is why its count read *"13+"*.

**The sweep is now complete, `observed`.** Every bare `` `:NNN` `` or `(:NNN` in the plan and the
report was resolved: the four above are the only broken ones (plan `:338`, `:358` and the
`stub-sms` ranges are correct). The other forms were checked too: the `(NNN)` headings in plan
`:198`, every `line NNN` / `lines NNN` in the plan and report, the runbook's own added text
(its only bare citations are the `stub-sms` `:35`/`:37`, both correct), and the PR body
(`:178-182`, `:245`, `:361`, `:362`, all correct).

**Fix**: the four targets above. Then make the closing command match both forms and resolve
every hit (`observed`: 29 hits at `c0f487d`, the four broken ones among them):

```
grep -noE '(driver-device-day\.md|\(|`):[0-9]{3}' \
  .claude/plans/driver-15-offers-device-pass.md \
  .claude/reports/driver-15-offers-device-pass-report.md
```

---

### F5 — Medium, reopened · the runbook still says steps 1, 2 and 3a ran on the #15 build

`docs/runbooks/driver-device-day.md:380`, `:384` · `.claude/reports/driver-15-offers-device-pass-report.md:248-249`

The runbook's §Result for this pass:

> `:380` | App | Two passes: #224's `bcd04c21…` … then the **#15 build `e1afc69a…`**. The a11y
> legs ran on the first, **the functional walk on the second** |
>
> `:384` §Level 4 steps, **on the #15 build:**
>
> | # | 1 | 2 | 3a | 3b | … | — | ✅ | ✅ | ✅ | ✅ | …

The fixes report's own proof (`:93-96`) says steps 1, 2 and 3a *"cannot be on the #15 APK"*:
step 3a's artifact is `14:50:42Z` and the build completed at `15:22:03Z`. The report (`:20`,
`:63`) and the PR body now say so. The runbook, the only copy of the run sheet, still says
otherwise. This is the retired claim surviving on a third surface, which is what CLAUDE.md
means by retiring the subject and not the digits.

The report has one more copy. `:248-249` still says *"the functional pass (T5) is not run on
this APK"*, the absolute that F5 narrowed at `:188` two screens earlier. `:188-190` now says
steps 1, 2 and 3a *are* taken from it.

`observed`, the noun sweep: `grep -n '#15 build\|#15 APK\|on the #15'` over the runbook, the
report and the live PR body. Every other hit is correct, including the runbook's `:382`
*"functional core is green on the #15 build"* (core = 3b onward, as the PR body defines it).

**Why only Medium**: steps 1, 2 and 3a touch no ride payload, and step 3b on the #15 build
signed in and rendered a card, so their outcomes very likely hold there too. What is false is
the provenance.

**Fix**: runbook `:384` → *"§Level 4 steps (1, 2, 3a on #224's APK; the rest on the #15 build):"*;
`:380` → *"…the a11y legs and steps 1, 2, 3a on the first, the rest of the walk on the second"*.
Report `:248-249` → *"…so no step that needs a ride payload is run on this APK"*.

---

### F4 — Medium, reopened · three report lines still describe pass 1 only

`.claude/reports/driver-15-offers-device-pass-report.md:61`, `:234`, `:36`

Round 1's F4 named the Tasks-completed list and the surrounding prose as what the second pass had
not revisited, and asked for one sweep rather than per-line fixes. The fix pass restated the
three lines round 1 quoted (`:5`, `:63`, AC1). These three are the same class:

| Line | Says | The report elsewhere |
|---|---|---|
| `:61` T3 | *"[~] … **still `in queue` ~50 min later**; the pass ran on #224's APK instead"* | `:20`: completed `15:22:03Z`, installed, pass 2 on it. `:30`: 3b ✅ *"on the #15 APK"* |
| `:234` | *"The #15 build sat in the EAS queue **for the whole session**."* | It did not: pass 2 ran on it from 15:24Z (see F11) |
| `:36` step 9 | unrun because *"the card legs ran before it and **the APK blocked the rest**"* | True of #224's APK only. Pass 2 on the #15 APK did not reach step 9 for a different reason. The runbook at `:396` gives it (*"9 needs the `geo fix` velocity route"*). The Status header at `:5` promises a named cause for each unrun step |

**Fix**: `:61` → `[x] T3 APK — … completedAt 15:22:03Z, installed 15:23:16Z; pass 1 ran on #224's
APK while it queued, pass 2 on this build`. `:234` → *"…for the whole of pass 1"*. `:36` → the
runbook's cause.

---

### F11 — Medium · the fix pass settled the install time in the wrong timezone

`.claude/reports/driver-15-offers-device-pass-report.md:20` · `.claude/reports/pr-265-review-fixes.md:25`, `:75-91`

Round 1 could not tell whether `16:23:16` was UTC or local. The fix pass settled it:

> Read as **local** (Rīga is UTC+3 in September), `16:23:16` = `13:23:16Z` — **before the build
> was even submitted**. Impossible.
> Read as **UTC**, it is 1 h 01 m after `completedAt`. Consistent.
> So `16:23:16Z`

The arithmetic is right. The premise is wrong, because the machine that ran the pass is not on
Rīga time. `observed`:

- **In the repo, where anyone can re-run it**: `git log --format=%ci d6207be..c0f487d` shows all
  **20** commits on this branch at **`+0100`**.
- **In the pass's own api log** (the author's session scratchpad, local only), one event carries
  both clocks, Nest's local-time prefix and the ISO `at` field:

  ```
  [Nest] 89296  - 22/09/2026, 16:24:20     LOG [DispatchService] Object(10) {
    event: 'dispatch.offer.sent',
    at: '2026-09-22T15:24:20.152Z'
  ```

  That shows local time is UTC+1 directly, without inference.
- **Pass 2's events, from the same log**: `dispatch.offer.sent` **15:24:20.152Z**;
  `driver.presence.claimed_for_ride` (the presence claim on step 3b's accept) **15:24:27.657Z**;
  `accepted → arriving` **15:24:58.215Z**; `dispatch.assign.forced` (step 7) **15:28:27.675Z**.
  File mtimes agree: `driver-15.apk` **15:23:05Z**, `n2-card.png` 15:24:27Z,
  `n17-card-cash-before-switch.png` 15:36:40Z.

Read the fix pass's way, the #15 APK was installed at 16:23:16Z, and every pass-2 step ran about
an hour **before** the app was on the emulator. Read as BST, `16:23:16` = **15:23:16Z**. That is
73 s after `completedAt` `15:22:03Z` (`derived`: 15:23:16 − 15:22:03), 11 s after the APK file
landed, and 64 s before the first pass-2 offer. It also fits the report's own *"queued 53 min"*
(`derived`: submitted 14:14:57Z + 53 min ≈ 15:08Z build start, done 15:22:03Z).

**Round 1 supplied the wrong premise.** Its F5 said *"read as local it precedes the 'still in
queue' observation"*, which holds only for UTC+3. The fix pass took over that frame and did the
arithmetic correctly inside it.

**What it does not touch.** The pass-split proof compares step 3a's `14:50:42Z` with
`completedAt` `15:22:03Z`. Both are true UTC, one from the api log and one from EAS, and neither
uses the install time. The PR body contains no `16:23` (`observed`, `gh pr view 265 --json body`).

**Why Medium.** Round 1 left `16:23:16` ambiguous but true. The fix pass made it unambiguous and
false. It then closed a question routed to a human as *"Settled by evidence, not by wording"*.
Nothing downstream is scoped on the install time.

**Fix**: report `:20` → *"installed **15:23:16Z** (16:23:16 BST, the host clock; `observed`: the
api log's first pass-2 event, `dispatch.offer.sent`, is 15:24:20.152Z)"*. Fixes report `:25` and
`:75-91` → replace the UTC conclusion. Keep the EAS timestamps and the pass-split proof, which
are right.

---

### F12 — Low · three unscoped closing greps are falsified by the file that records them

`.claude/reports/pr-265-review-fixes.md:22`, `:147`, `:173`

`observed` at `c0f487d`:

| Command, as the fixes report gives it | Claimed | Returns |
|---|---|---|
| `grep -rn '§D3' --include='*.md' .` (`:22`, `:173`) | 1 | **4**: report:323, and fixes report `:22`, `:158`, `:173` |
| `grep -rn 'records 9 packages'` (`:22`) | 0 | **2**: fixes report `:22`, `:159` |
| `grep -rn -F 'location-task.ts:43-52' --include='*.md'` (`:147`) | 0 | **4**: fixes report `:105`, `:141`, `:146`, `:167` |

Each was presumably run before the fixes report was written, and the report then quoted the retired
value while recording the result. This is round 1's F7 shape: a claim moved by the commit that
recorded it. **The substance holds.** No live sentence uses any of the three values, and the
three-file sweep table at `:156-171` is scoped correctly and reproduces 14 of 14.

**Fix**: add *"outside this file"* to each.

---

### F13 — Low · steps are credited to I5's list, which does not name them

`.claude/reports/driver-15-offers-device-pass-report.md:20`, `:63` · `.claude/reports/pr-265-review-fixes.md:47` · commit `c0f487d`'s message

> `:20` pass 2 owns steps 3b, 5, 6, 7, 8, 11, 13 — **each of those named by I5** as blocked on the old APK

I5 (`:332`) names *"steps 5–8, 11 and 13"*. 3b is not in it. 3b's pass-2 placement is still
sourced, by its own row at `:30` (*"✅ **on the #15 APK**"*). The claim is right but the citation
points to the wrong place. It matters here only because `c0f487d` exists to enforce *"every
element of the precise claim is sourced"*.

`:63` has the same shape in pass 1: *"3b server-only, **the rest blocked by I5**"*. The rest
includes 4, 9, 10 and 12, and their own rows give other causes (FCM, the `geo fix` route, the
second AVD).

**Fix**: *"…named by I5, or (3b) by its own row"*; `:63` → *"5–8, 11, 13 blocked by I5; 4, 9, 10,
12 not reached"*. Optionally, after F11, the api log's ISO timestamps (15:24:20Z onward) source
the pass-2 placement directly, without I5.

---

## Round-1 closure — re-derived, not read

| # | Closing evidence re-run at `c0f487d` | |
|---|---|---|
| F1 | 18 of 18 `driver-device-day.md:NNN` targets print the cited phrase; the plan's `(NNN)` headings at `:198` resolve. **4 bare `` `:NNN` `` citations do not** | **reopened (High)** |
| F2 | `:361`, `:362` carry the 2026-09-22 outcome; row `:360` (#14's) untouched | ✅ |
| F3 | `:178-182` reads *"`observed` 2026-09-17: 14 packages"*; `§D3` absent from every live sentence | ✅ |
| F4 | Status header, AC1 (8 ✅ + 3 partial = 11; 14 − 11 = 3 unrun) and T5 agree with the step table. **`:61`, `:234`, `:36` do not** | **reopened (Medium)** |
| F5 | Report `:20`, `:63`, `:188` and the PR body's row are correct; split proven from `completedAt` (31 m 21 s after 3a). **Runbook `:380`, `:384` and report `:249` are not**; timezone half → F11 | **reopened (Medium)** |
| F6 | `git diff -U0 4e6ffb68 c0f487d -- lv.ts`: `sms.` ×2, `console.` ×6, `push.` ×2, `rider.` ×2, no `driver.` key; the five name-composing files unchanged | ✅ |
| F7 | `grep -c '✅\|❌'`: **25** at head, **17** at `d6207be` | ✅ |
| F8 | `stub-sms.provider.ts`: `sendOtp()` `:17-28` logs `auth.otp.stub_sent` at `:22`; `send()` `:30-41`, event `:35`, `body` `:37` | ✅ |
| F9 | `.gitignore:25` = `.claude/last-gate.json`; the reviewable CI equivalent is named | ✅ |
| F10 | `offer-card.tsx:60` guard and `:111-115`; `push.module.ts:16-26`; `location-task.ts:43-53`; `home-screen.tsx` 101–111; `schemas/auth.ts:15`; `driver-ux-evidence.md:104`; both `gate-screen.tsx` paths exist | ✅ |
| N1, N2 | runbook `:245` and `:516` corrected | ✅ |

**Where round 1 was wrong, conceded.** The fixes report is right on both rows it disputed. At
`6eec024` the plan gave `gate-screen.tsx` with **no** path (`:442`), not a wrong one. The
accept-timer citation was plan `:159`, not `:158`. Round 1 also missed F1's bare citations, F5's
runbook copy and F11's premise. Each of those is the review's miss before it was the fix pass's.

---

## Fix-mechanism pass (round 2)

For each High round 1 raised, the question is what its fix newly permits, not only whether its
repro passes.

- **F1.** The fix re-derived absolute line numbers into a file that grows. The fix pass said so and
  put a grep-the-phrase warning into the plan's read-list entry (`:198`). The mechanism needs no
  further change. **The closure does**: its closing command matched one citation form out of two,
  so "12/12 HIT" measured the pattern, not the defect. I also checked citations **outside this
  PR** into the runbook past the insertion point: 16 hits, all in historical review and fix
  reports for PRs #226, #233 and #235. Those are point-in-time records pinned to their own heads,
  already stale before this PR. Not a finding.
- **F3** now cites `:178-182`, above the insertion, so it does not move.
- **F5** was Medium, but its fix is the one that introduced a new false figure (F11), by replacing
  an ambiguous true value with a precise false one.

The fixes report carries a per-finding closing command for every row, as
`piv-fix-review-findings` §2/§4 requires. That is why these gaps can be checked at all. Three
findings are reopened because their closing commands could not see the defect (F1's pattern) or
covered fewer surfaces than the claim (F4, F5).

---

## Validation

| Check | Result |
|---|---|
| CI `check` @ `c0f487d` | ✅ pass, 3m45s: run [35771752002](https://github.com/linardsb/taxi/actions/runs/35771752002), `head_sha` `c0f487d`, 19:07:44Z → 19:11:29Z (`observed`, `gh api …/runs/35771752002/jobs`) |
| CI `audit-diff` · `codeql` · `CodeQL` · `ready` | ✅ ✅ ✅ ✅ |
| CI @ `b96553a` (the fixes report's cited run) | ✅ run 35768875089, `head_sha` `b96553a`, `check` 18:41:49Z → 18:45:30Z = 3m41s, as stated |
| `mergeStateStatus` | `CLEAN` |
| Base | round 1 recorded `d6207be`; live `origin/main` after `git fetch --prune` = `d6207be`. **Base unmoved, guarantees pass skipped** |
| Local full gate | **not re-run, deliberately.** The delta is four Markdown files and no source, CI ran the gate at this exact sha, and integration runs collide across sessions (`ps -axo pid,command \| grep -c '[c]laude'` → 19 at review time) |

---

## The numbers pass

| Figure | Where | Verdict |
|---|---|---|
| `846 + 439 + 218 + 167 = 1,670` added, 3 deleted, 4 files, 20 commits | PR body | ✅ `git diff --numstat`, `git rev-list --count` |
| three deletions at runbook `:245`, `:361`, `:362` | PR body | ✅ |
| round 1's `1,441` / 3 files / 16 commits at `6eec024` | PR body | ✅ matches round 1's header |
| `check` 3m45s, run 35771752002 at `c0f487d` | PR body | ✅ |
| *"The four commits since are Markdown-only"* | PR body | ✅ `git diff --name-only 6eec024 c0f487d` → 4 `.md` files |
| 3a `14:50:42Z` is 31 min before `completedAt` `15:22:03Z` | PR body, report | ✅ 31 m 21 s |
| 15 vs 14 drifted packages, *"+1 of new drift"* | PR body, report `:323` | ✅ as a net count, see FYI |
| AC1 11 of 14, 3 unrun | report | ✅ 8 + 3 = 11, 14 − 11 = 3 |
| tick count 17 → 25 | report | ✅ |
| F1's *"12/12 HIT"*, *"all re-checked"* | fixes `:21`, `:176-177` | ⚠️ **F1**: true for one citation form, 4 broken in the other |
| **`installed 16:23:16Z`**, **`1 h 01 m after completedAt`** | report `:20`, fixes `:89` | ❌ **F11**: 15:23:16Z, 73 s after |
| **repo-wide `§D3` → 1, `records 9 packages` → 0, `location-task.ts:43-52` → 0** | fixes `:22`, `:147`, `:173` | ❌ **F12**: 4, 2 and 4 |

---

## FYI — checked, nothing to do

- **"+1 of new drift"** is a net figure. The report does not record the 15 package names, so it
  cannot show that the runbook's 14 are a subset. Round 1 prescribed this wording (*"one package
  has drifted since 2026-09-17"*), so the imprecision is the review's. *"Net +1"* would be exact
  if the line is touched again.
- **The fixes report's `ps` count of 19** is word-for-word round 1's figure, which is the shape of
  an inherited number. It re-observes as 19 at this review, so it stands.
- **The countdown starts at exactly 20** (report T7.2): `offer-builder.ts:61` → `offer-state.ts:204`
  is right. The line that makes it exact, `use-offers.tsx:173`
  (`durationMs: offer.expiresAt.getTime() - offer.sentAt.getTime()`), is not cited. That is a gap
  in the citation, not an error. Found by the `code-reviewer` agent, reproduced here.

---

## What's good

- **The sweep is a list, not a sentence.** Fourteen retired values, each with a `grep -F` count,
  scoped to named files. That is the artifact CLAUDE.md asks for, and 14 of 14 reproduce. It is
  also what made F1's gap findable: the closing command was written down, so its pattern could be
  checked.
- **N1 and N2 came from grepping the value instead of the topic.** If the fix pass had fixed the
  report's `location-task.ts:43-52` and stopped, the runbook's copy would still state the same
  wrong range, in the only run sheet. Round 1 missed both.
- **The fix pass disputed the review with evidence**, and both disputed rows reproduce as it says.
- **`c0f487d` asked the new-failure-mode question of the fix pass's own work** and withdrew
  step 10's pass-2 assignment because nothing sourced it. F13 applies the same standard one step
  further, and the author set that standard.
- **The EAS timestamps are real evidence.** `createdAt` and `completedAt` from the GraphQL API
  turned the pass split from an inference about countdown seconds into a comparison of two UTC
  instants. F11 concerns only the third timestamp, which EAS does not provide.

---

## Recommendation

**Request changes.** The rubric puts a High at request changes, and F1 is reopened at the
severity round 1 gave it: four citations into the only run sheet still land on the wrong line.
Every fix is a text edit, and none changes a conclusion. The pass stands, #262 and #263 are
real, and #15 should stay open as §T11 argues.

Suggested order: **F1** (four targets, plus a closing grep that matches both forms) → **F5**
(runbook first, it is the surface device-day sessions read) → **F4** → **F11** → **F12**, **F13**.
Re-derive the PR body's size table after the push, as the fix pass did last time.

---

*Reviewed with `piv-review-pr`, round 2. Fresh context, detached worktree at `c0f487d`. Every
round-1 closing command was re-run against the tree, and the `code-reviewer` agent reviewed the
round-2 delta. Each of its five findings reproduced and is folded in above: two as reopened
round-1 findings (F1, F5), the rest merged with findings found here (F4, F12, F13).*
