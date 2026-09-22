# PR #265 review — round 3

**PR**: [#265](https://github.com/linardsb/taxi/pull/265) — *docs: run #15's offers / active-ride device pass on the emulator, and file what it found*
**Head** `1161bfd` · **Base** `main` @ `d6207be`
**Diff**: 5 files, +1,830 / −3 · documentation only, no shipped source · round-3 delta `c0f487d..1161bfd` is 2 commits, +192 / −32
**Reviewed**: 2026-09-22, fresh context; `code-reviewer` agent dispatched on the round-3 delta, each of its findings reproduced here before entering this report
**Verdict**: **request changes**: 1 High (F14, new), 3 Low (F15–F17). **No finding threatens a conclusion.** The device pass, #262 and #263, and the decision to leave #15 open all stand. The High concerns which gaps the #15 decision lists, not whether the pass ran.

---

## Summary

All six round-2 findings are closed, and each closure reproduces when re-run (table below). The
two-form citation grep returns 29 hits and all 29 resolve to the phrase they cite. The runbook,
the report and the PR body now agree on which build ran which step. The install time is 15:23:16Z,
and the pass's api log brackets it (first event after install 15:23:40.408Z, last pass-2 event
15:39:46.233Z). The fix pass also declined two of round 2's prescribed texts because they would
have assigned step 10 to a pass, and it was right to.

**One finding is new, and two rounds of review missed it (F14).** Step 7's unrun half has no
owner. `75da7be` changed step 7 from ✅ to partial in the runbook's step table. It did not change
the runbook's Outcome line, written one minute earlier, which still says force-assign passes. It
also did not change the report's §T11, the section that decides whether #15 closes. T11's
follow-up run leaves step 7 out, so following its recommendation would close #15 without step 7
being re-run.

The three Lows are wording. One absolute was added by the last commit, one fixes-report sentence says more than the runbook line it describes, and one duration (*"queued 53 min"*) is unsourced.

---

## Routing

**AGENT FIXES**

- **F14**: runbook `:382` Outcome; report §T11 `:410-427`; PR body line 10.
- **F15**: fixes report `:25`, fixes round 2 `:123`.
- **F16**: runbook `:384`, or fixes round 2 `:26`, `:79`.
- **F17**: report `:20`, `:234`; runbook `:380`; PR body `:124`.

**HUMAN DECIDES**, carried unchanged from rounds 1 and 2:

1. **I2's deliberate `assertTransition()` bypass** (report `:330`): five 2026-08 dev-DB rides retired by direct `UPDATE`. It is the first recorded exception to a hard rule. Linards decides whether to accept the precedent in writing.
2. **Where step 7's open question lives** (F14): add it to T11's follow-up session or file it as an issue. The report calls "something specific to the force-assign path" *"a live possibility"*, and that is a possible product defect.

**HUMAN TESTS**: step 13's banner, step 9's glance mode via `geo fix`, step 12 on the second AVD, #263's starvation half on a real device, and, after F14, **step 7's "opens" half**.

---

## Issues by severity

### F14 — High · step 7's unrun half is missing from the #15 decision, and the runbook says force-assign passes

`docs/runbooks/driver-device-day.md:382` · `.claude/reports/driver-15-offers-device-pass-report.md:410-424` · PR body line 10

Step 7 is partial on every surface that records the step itself. `observed` at `1161bfd`:

- the report's step table `:34`: *"⚠️ **partial — one half passed, one half unrun** … **Cause not isolated** … Something specific to the force-assign path is a live possibility and is not excluded"*
- the report's Status `:5`, AC1 `:391` and S2 `:373` (*"Left as an open question rather than explained away"*)
- the runbook's step table `:388` (⚠️) and its note `:390`
- the PR body's device table (*"Step 7 | ⚠️ partial"*) and its reviewer notes (*"Step 7 is marked partial, not green"*)

The two surfaces that summarise the pass say otherwise:

| Where | Says | Why it is wrong |
|---|---|---|
| runbook `:382` Outcome | *"accept, the four-step walk, the receipt, **force-assign**, reassignment and cold-start-mid-ride **all pass**. **Five steps stay owed**"* | Force-assign is step 7, marked ⚠️ six lines below. Six steps are not ✅: 4, 7, 9, 10, 12 and 13 |
| report §T11 `:413-424` | *"**Four things** are genuinely unrun"*, followed by five numbered items: 13's banner, 4 and 10's push halves, 12, 9, and #262/#263. The recommendation: *"#15 closes on a short follow-up run — step 13's banner, step 9, and step 12 … plus a decision on #263"* | Step 7 is in neither the list nor the follow-up run. The count says four and the list has five |
| PR body line 10 | *"§"the #15 decision" in the report names the **five gaps**"* | This inherits T11's list, so step 7 is missing here too |

**How it happened, `observed`** (`git log -S`): `b73732b` (16:38:51 +0100) wrote the Outcome
line when step 7 was still `✅*`. At that point *"force-assign … pass"* and *"five owed"* (4, 9,
10, 12, 13) were both true. `75da7be` (16:39:58 +0100, *"step 7 is partial, not green"*) changed
the table cell and the note beneath it and did not change the Outcome line above it. T11 was
written at `7831c9b` (16:08:05 +0100), before the second pass, and no later commit updated its
list. This is the case CLAUDE.md warns about: the cell was changed, but the claim was left in
the sentences that summarise it.

**Why High.** T11 is the section that decides whether #15 closes. PR body line 10 sends the
reader to it, and the runbook Outcome line is what a device-day session reads first. If the
follow-up session T11 recommends is run as written, #15 closes with step 7's "opens" half never
run. Its cause is recorded as an open question that could be a force-assign defect, and nothing
assigns it to anyone: no T11 item, no issue, and no row in the runbook's "— = unrun" legend,
which lists only 4, 9, 10 and 12. That is a claim a later ticket could de-scope work on, and
this skill's rubric rates that High. None of the other conclusions change.

**Fix**:
- Runbook `:382`: remove *force-assign* from the passing list, or write *"force-assign's
  no-card half"*, and change *"Five steps stay owed"* to *"Six steps are not green (4, 7, 9, 10,
  12, 13)"*.
- Report §T11: add *"Step 7's 'opens' half: the ride appeared only after a relaunch, cause not
  isolated (S2)"* to the list, add step 7 to the recommendation's follow-up run, and make the
  count match the list.
- Report §T11 Recommendation `:427`: it names only *"a decision on #263"*, but item 5 says #262 **and** #263 keep #15 open. Name both, or say why #262 does not block closing.
- PR body line 10: *"names the gaps"*, or the corrected count.
- Glyph check: none of these edits touches the ✅/❌ table, so AC8's **25** should hold. Re-run
  `grep -c '✅\|❌' docs/runbooks/driver-device-day.md` after the last runbook edit.
- Closing grep for the fixes report: `grep -n -F 'force-assign, reassignment' docs/runbooks/driver-device-day.md` → 0, and `grep -n 'step 7\|Step 7' .claude/reports/driver-15-offers-device-pass-report.md` shows a hit inside §T11.

---

### F15 — Low · the last commit replaced one false absolute with another

`.claude/reports/pr-265-review-fixes.md:25` · `.claude/reports/pr-265-review-fixes-round2.md:123`

`1161bfd` changed the F5 row to *"Run-environment row now **assigns every step but 10 to a
pass**"*. The Run environment row (report `:20`) assigns 1, 2, 3a, 3b, 5–8, 11 and 13. Steps 4,
9 and 12 are in no pass. Report `:63` says they are *"unrun in both passes"*, and runbook `:380`
says *"4, 9 and 12 ran on neither"*. Fixes round 2 `:123` then quotes the new wording as the
fixed state. `observed`: `sed -n 25p` prints the phrase. Found by the `code-reviewer` agent and
reproduced here.

**Fix**: *"assigns every step that ran to a pass, except 10"*.

### F16 — Low · the fixes report says runbook `:384` lists what only `:380` lists

`.claude/reports/pr-265-review-fixes-round2.md:26`, `:79` · `docs/runbooks/driver-device-day.md:384`

Fixes round 2 says *"Runbook `:380` and `:384` list each step's build explicitly: … 4, 9, 12 on
neither"*, and at `:79`: *"Both lines now list the steps"*. Runbook `:384` reads *"1, 2, 3a on
#224's APK; 3b, 5–8, 11, 13 on the #15 build; 10 not assigned to a pass:"*, with no 4, 9 or 12.
The runbook is not wrong: the table below `:384` shows those three as — (unrun). The fixes
report's description of it is. Found by the agent and reproduced from the runbook text quoted
in this review's F14 check.

**Fix**: append *"; 4, 9, 12 unrun"* to `:384` (this adds no glyph), or narrow the fixes report's
sentence.

### F17 — Low · "queued 53 min" has no source and no arithmetic

report `:20`, `:234` · runbook `:380` · PR body `:124`

The only EAS fields printed anywhere in the PR are `createdAt` 14:14:57.231Z and `completedAt`
15:22:03.251Z. That is 67 m 06 s from submission to completion (`derived`). Separating queue
time from build time needs a `startedAt`, which no file prints (`observed`: `grep -rn startedAt`
over the five files → 0). Round 2 checked the 53 min by working backwards from it (*"≈ 15:08Z
build start"*) and did not source it. That is the review's miss as well. Nothing depends on the
split. The pass-split proof uses `completedAt` only.

**Fix**: print EAS `startedAt` and mark the figure `observed`, or restate it as *"67 min from
submission to completion"* (`derived`).

---

## Round-2 closure — re-derived, not read

| # | Closing evidence re-run at `1161bfd` | |
|---|---|---|
| F1 | Two-form grep `(driver-device-day\.md\|\(\|`):[0-9]{3}` over the plan and report → **29 hits**. A resolver printed each hit next to the runbook line(s) it names, and all 29 resolve. The four fixed ones: plan:108 → `:566-568` (step 3 + *"`google_apis`, never `default`"*), plan:242 → `:700-701`, plan:550 → `:534`, report:138 → `:600`. The fixes report's list of the other 25 matches hit for hit | ✅ |
| F4 | `still \`in queue\``, `whole session`, `APK blocked the rest` → 0 each over the four files. T3 `[x]` with `completedAt` and install time; `:36` names the `geo fix` route | ✅ |
| F5 | `functional walk on the second`, `steps, on the #15 build`, `not run on this APK` → 0 each. Runbook `:380`/`:384` list each step's build and match the report's Run environment row | ✅ |
| F11 | `16:23:16Z`, `1 h 01 m` → 0; PR body `16:23` → 0. `git log --format=%ci origin/main..HEAD` → **22 of 22 at `+0100`**. Local api log: first event after install `driver.presence.status_changed` **15:23:40.408Z**, last pass-2 event **15:39:46.233Z**, both as the fixes report states | ✅ |
| F12 | With `--exclude='pr-265-review*'`: `§D3` → 1 (report:323); `records 9 packages` → 0; `location-task.ts:43-52` → 0 | ✅ |
| F13 | `each of those named by I5`, `the rest blocked by I5` → 0; `:20` sources 3b by its own row | ✅ |

**The declined prescriptions.** The fix pass did not use round 2's *"the rest on the #15 build"*
(F5) or *"4, 9, 10, 12 not reached"* (F13). Both would have placed step 10, which the report
deliberately leaves unassigned, so the fix pass was right to decline them. Its `:566` start for
plan:108 is also better than round 2's `:567`.

---

## Fix-mechanism pass (round 3)

Round 2 raised one High, F1.

- **F1.** The fix rewrote four absolute line numbers into the runbook, which grows. **Line counts
  held**: `wc -l` at `c0f487d` and at `1161bfd` is 846 / 439 / 831 / 218 for the plan, report,
  runbook and round-1 fixes report (`observed`). Every edit replaced text inside existing lines,
  so no citation moved. The mechanism's weak point is unchanged and documented: any future
  insertion above `:534` breaks the citations again, and the plan's read-list tells the reader
  to grep the quoted phrase instead. The fixes report names what the new closing command still
  cannot see (two-digit line numbers, and prose such as "line NNN").
- **F12's `--exclude` scope** is an improvement over round 2's prescribed *"outside this file"*,
  for the reason the fixes report gives: a second fixes file that quotes the same values would
  break the prose scope again, and the glob covers both review files and both fixes files.
- **F5's fix** added one new absolute to the runbook: *"4, 9 and 12 ran on neither"*. It is true.
  Each of the three is unrun in both passes, and the report's step rows give each one its own cause.

---

## Validation

| Check | Result |
|---|---|
| CI `check` @ `1161bfd` | ✅ run [35777127601](https://github.com/linardsb/taxi/actions/runs/35777127601), `head_sha` `1161bfd`, conclusion success, `check` 19:57:40Z → 20:01:24Z = 3m44s (`observed`, `gh api …/runs/35777127601/jobs`) |
| CI `audit-diff` · `codeql` · `CodeQL` · `ready` | ✅ ✅ ✅ ✅ |
| `mergeStateStatus` | `CLEAN`, not draft |
| Base | round 2 recorded `d6207be`; live `origin/main` after `git fetch` = `d6207be`. **Base unmoved, guarantees pass skipped** |
| Local full gate | **not re-run, deliberately.** The delta is five Markdown files with no source, CI ran the gate at this sha, and integration runs collide across sessions (`ps -axo command \| grep -c '[c]laude'` → 24) |

---

## The numbers pass

| Figure | Where | Verdict |
|---|---|---|
| `846 + 439 + 160 + 218 + 167 = 1,830` added, 3 deleted, 5 files | PR body | ✅ `git diff --numstat origin/main..HEAD` |
| 22 commits | PR body | ✅ `git rev-list --count` |
| *"The six commits since are Markdown-only"* (since `6eec024`) | PR body | ✅ 6 commits; `git diff --name-only 6eec024 1161bfd` → 5 `.md` files |
| `check` 3m44s at `1161bfd` | PR body | ✅ |
| rounds 1 and 2 superseded: `1,441`/3/16 at `6eec024`, `1,670`/4/20 at `c0f487d` | PR body | ✅ match both review headers |
| tick count **25** vs **17** | fixes round 2, AC8 | ✅ |
| line counts 846 / 439 / 831 / 218 unchanged | fixes round 2 | ✅ |
| 29 of 29 citations resolve | fixes round 2 | ✅ |
| install **15:23:16Z**, ~73 s after `completedAt`, ~64 s before the first offer | report `:20`, fixes | ✅ `derived`; 15:23:16 − 15:22:03.251 = 72.7 s, and 15:24:20.152 − 15:23:16 = 64.2 s |
| 22 of 22 commits `+0100` (fixes report says 20 of 20 over `d6207be..c0f487d`) | fixes round 2 | ✅ scoped to its range, still true at head |
| *"Five steps stay owed"* | runbook `:382` | ❌ **F14**: six are not green |
| *"Four things are genuinely unrun"* | report `:413` | ❌ **F14**: the list below it has five items, and step 7 makes six |
| *"the five gaps"* | PR body line 10 | ❌ **F14** |
| *"queued 53 min"* | report `:20`, runbook `:380`, PR body | ⚠️ **F17**: 67 min submit→complete is `derived`; the queue share is unsourced |
| *"20 `claude` processes"* | fixes round 2 `:159` | no provenance word. Re-observed as 24 now, and it is a point-in-time count. FYI only |

---

## What's good

- **Every closing command reproduced exactly**, including the counts. Round 2 found three
  closures that could not see their own defect. This round found none.
- **The fix pass pushed back on the review where the review was wrong.** Two prescribed texts
  would have placed step 10. The fix pass wrote the precise version and explained why in
  §"Where the prescribed fix was changed".
- **The BST evidence is layered.** There is a re-runnable repo check (commit offsets), a
  single log event that shows both clocks, and an install time bracketed by two events 24 s
  apart. That is stronger than round 2 asked for.
- **The fix pass kept line counts fixed on purpose and checked them with `wc -l`**, so no citation
  from any other file could move. This closes the F1 failure mode for this round's edits.

---

## Recommendation

**Request changes.** F14 is a High under this skill's rubric: the section that decides whether
#15 closes leaves out a partial step whose cause could be a force-assign defect, and the run
sheet says that step passed. It is a text fix: one runbook line, the T11 list and its
recommendation, and one clause in the PR body. The three Lows can go in the same commit.

Suggested order: **F14** (runbook `:382` first) → **F15**, **F16**, **F17** → re-run the ✅/❌
count (**25** expected) → re-derive the PR body's size table after the push. The HUMAN DECIDES
item on step 7 (a T11 follow-up item or a filed issue) can be decided before or after the fix
pass. The fix needs only the wording either way.

*Reviewed with `piv-review-pr`, round 3. Fresh context. Every round-2 closing command was re-run
at `1161bfd`, the 29 citations were resolved by a script, the local api log was read for the
F11 bracket, and the `code-reviewer` agent reviewed the round-3 delta.*
