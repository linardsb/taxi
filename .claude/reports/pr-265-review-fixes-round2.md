# PR #265 — review round 2 fixes

**Review**: [round 2 comment](https://github.com/linardsb/taxi/pull/265#issuecomment-5782761031) — 1 High, 3 Medium, 2 Low (file: `.claude/code-reviews/pr-265-review-round2.md` on `docs/pr-265-review`)
**Branch**: `docs/plan-15-device-pass` · **worktree** `/Users/Berzins/taxi-worktrees/wt-15`
**Base at fix time**: `origin/main` `d6207be`, unmoved (`git fetch --prune`, 2026-09-22)
**Fixed**: 2026-09-22

**All six findings fixed.** Nothing deferred. No direction came with the review, so the review's own
routing was followed: all six are under AGENT FIXES. The two HUMAN items stay with Linards, as
round 1 left them: I2's `assertTransition()` bypass, and the manual tests §T11 names.

Two of the review's prescribed texts were **not** pasted as written, because they would have
re-assigned step 10, which the report deliberately leaves unassigned. See §"Where the prescribed fix
was changed".

---

## Fixed

Every closing command below was run against the fixed tree at 2026-09-22 19:49Z, before this file
was written.

| # | Sev | What was wrong | Fix | Closing command → output |
|---|---|---|---|---|
| F1 | High | Four bare `` `:NNN` `` citations into the runbook landed on the wrong line: plan `:108` (`:390`), `:242` (`:531`), `:550` (`:368`); report `:138` (`:434`) | → `:566-568`, `:700-701`, `:534`, `:600` | The review's two-form grep, `` grep -noE '(driver-device-day\.md\|\(\|`):[0-9]{3}' `` over the plan and the report → **29 hits, 29 resolve** to the phrase they cite (table below) |
| F5 | Med | The runbook §Result still said steps 1, 2, 3a ran on the #15 build (`:380`, `:384`); report `:248-249` still said T5 "is not run on this APK" | Runbook `:380` and `:384` list each step's build explicitly: 1, 2, 3a on #224's APK; 3b, 5–8, 11, 13 on the #15 build; 10 unassigned; 4, 9, 12 on neither. Report → *"no step that needs a ride payload is run on this APK"* | `grep -n -F` for `functional walk on the second`, `steps, on the #15 build`, `not run on this APK` over the four PR files → **0 each** |
| F4 | Med | Report `:61` (T3 "still `in queue`"), `:234` ("for the whole session"), `:36` (step 9's cause) described pass 1 only | T3 `[~]` → `[x]` with `completedAt` 15:22:03Z and the install time; `:234` → "the whole of pass 1"; `:36` → the runbook's cause (the `geo fix` velocity route, still `expected`) | `grep -n -F` for `` still `in queue` ``, `whole session`, `APK blocked the rest` → **0 each** |
| F11 | Med | The install time was settled as `16:23:16Z`. The host clock is BST, so it is **15:23:16Z** | Report `:20`; fixes report `:12-13`, `:25`, `:75-91` rewritten with the BST reading and its evidence (below) | `grep -n -F` for `16:23:16Z`, `1 h 01 m`, `Consistent.`, `ettled by evidence` over the four files → **0 each** |
| F12 | Low | Three greps in the round-1 fixes report were unscoped, and the report itself quoted the values they claimed were gone | Scoped with **`--exclude='pr-265-review*'`** (an executable scope, not the prose "outside this file") at `:22`, `:146-147`, `:173` | `grep -rn '§D3' --include='*.md' --exclude='pr-265-review*' .` → **1** (report:323). `grep -rn --exclude='pr-265-review*' 'records 9 packages' .` → **0**. `grep -rn -F 'location-task.ts:43-52' --include='*.md' --exclude='pr-265-review*' .` → **0** |
| F13 | Low | Report `:20` and fixes report `:47` credited 3b to I5's list, which names only 5–8, 11, 13; report `:63` said "the rest blocked by I5" | 3b is sourced by its own row; `:63` → "5–8, 11 and 13 blocked by I5", and 4, 9, 12 "unrun in both passes, each for its own row's cause" | `grep -n -F` for `each of those named by I5`, `the rest blocked by I5` → **0 each** |

**Why `--exclude` and not "outside this file".** This report is a second file that quotes the
same values. Scoped in prose as "outside this file", the round-1 greps would have been falsified
again the moment this file landed. The review and fixes report names all match `pr-265-review*`.

### F1 — all 29 hits, resolved at the fixed tree

`observed` 19:49Z, a Python resolver printing each hit's context next to the runbook line(s) it
names. The four fixed hits:

| Where | Cites | Runbook text at that line |
|---|---|---|
| plan:108 | `:566-568` | step 3 `yes \| sdkmanager …` / `google_apis;x86_64` / **`google_apis`, never `default`** |
| plan:242 | `:700-701` | *"… an `input tap` at exact / centre coordinates proves nothing about the 44 px touch-target rule"* |
| plan:550 | `:534` | *"It is **not a second run sheet**: … this section cites them by number"* |
| report:138 | `:600` | *"**`adb emu geo fix` alone does nothing**, and it fails silently with `OK`"* |

The other 25 are unchanged and resolve as well: `:362` ×3, `:709`, `:705`, `:360`, `:722`, `:534`,
`:693` ×2, `:352-364`, `:128`, `:178-182` ×2, `:111`, `:554`, `:719` ×2, `:245`, `:598` ×3,
`:700-701`, `:683`, `:698-699`.

### F11 — the evidence for BST

- **Re-runnable, in the repo**: `git log --format=%ci d6207be..c0f487d` → **20 of 20 commits at
  `+0100`**; `date '+%Z %z'` on the host → `BST +0100`.
- **Local only** (the pass's api log, in the author's session scratchpad): one event carries both
  clocks. Nest's prefix `22/09/2026, 16:24:20` with `event: 'dispatch.offer.sent'`,
  `at: '2026-09-22T15:24:20.152Z'`.
- **The install is bracketed** (same log and scratchpad): `driver-15.apk` mtime **15:23:05Z**, then
  the app's first `driver.presence.status_changed` at **15:23:40.408Z**. `15:23:16Z` lies between
  them. Read as UTC, `16:23:16Z` falls after the last event in pass 2's api log (**15:39:46Z**),
  so the app would have been installed after every step it ran.
- `derived`: 15:23:16 − 15:22:03.251 = **~73 s** after `completedAt` (the install stamp has no
  sub-second part, so 72.7–73.7 s). First pass-2 offer 15:24:20.152 − 15:23:16 = **~64 s** later.

The pass-split proof is untouched. It compares step 3a's `14:50:42Z` with `completedAt`
`15:22:03Z`, both true UTC, and uses no install time.

---

## Where the prescribed fix was changed

1. **F5's runbook text.** The review prescribed `:384` → *"(1, 2, 3a on #224's APK; the rest on
   the #15 build)"* and `:380` → *"the rest of the walk on the second"*. "The rest" puts step 10 on
   the #15 build, and the report's Run environment row says its pass is **not established**. It
   would also cover 4, 9 and 12, which ran on neither build. Both lines now list the steps.
2. **F13's `:63` text.** The review prescribed *"4, 9, 10, 12 not reached"*. That says step 10 did
   not run in pass 1, which is as unsourced as saying it did. Written as: 4, 9, 12 unrun in both
   passes, each for its own row's cause; step 10 unassigned (already on the line).
3. **F1, plan:108.** The review gave `:567-568`. Step 3 **begins** at `:566`
   (`3. yes | sdkmanager --licenses …`), so `:566-568` covers the step and its rule.

---

## Line counts held, so no citation moved

Every edit replaced text within its existing lines. `wc -l` before and after, **identical**
(`observed`): plan 846, report 439, runbook 831, round-1 fixes report 218. Citations into these
files from the plan, the report and the two review files (report `:188`, `:323`; fixes `:22`,
`:47`, `:75-91`) still point at the same lines.

**AC8 / F7's unit**: `grep -c '✅\|❌' docs/runbooks/driver-device-day.md` → **25** after the last
runbook edit; `origin/main` → **17**. The runbook edits are glyph-free, and the step table at
`:386-388` was not rebuilt.

---

## The new failure mode of F1's fix (the High)

The fix writes absolute line numbers into the only run sheet again. Any PR that inserts above
`:534` re-breaks them. That is round 1's mechanism, unchanged. Its guard is the plan's read-list
warning to grep the quoted phrase. What changes here is the **closing command**. Round 1's matched
only `driver-device-day.md:NNN`, so its "12/12 HIT" measured the pattern and not the defect. The
two-form pattern above also matches bare `` `:NNN` `` and `(:NNN`. Its remaining blind spot:
two-digit line numbers, and prose such as "line NNN". The review checked the prose forms at
`c0f487d`, and this pass added none.

---

## The sweep — every retired value and noun, as a list

Over the plan, the report, the runbook and the round-1 fixes report (`grep -n -F`, 19:49Z):

| Retired value / noun | Hits |
|---|---|
| `16:23:16Z` | 0 |
| `1 h 01 m` | 0 |
| `Consistent.` | 0 |
| `ettled by evidence` | 0 |
| `whole session` | 0 |
| `` still `in queue` `` | 0 |
| `APK blocked the rest` | 0 |
| `not run on this APK` | 0 |
| `each of those named by I5` | 0 |
| `the rest blocked by I5` | 0 |
| `functional walk on the second` | 0 |
| `steps, on the #15 build` | 0 |
| `` :434` `` · `` :390` `` · `` :531` `` · `` :368` `` | 1 each, all in the round-1 fixes report's F1 table, **"Was" column** (`:59-64`): the historical value, labelled as such |
| `UTC+3` | 1, fixes report `:87`, the bullet labelled *"The wrong premise"* |

**The PR body**: `gh pr view 265 --json body`, grepped for `16:23`, `whole session`, `in queue`,
`named by I5`, `#15 build`, `#15 APK`, `APK blocked`, `:434`, `:390`, `:531`, `:368` before the
edits. Three hits, all correct: `:9` "green on the real #15 build", `:104` (3b, 5, 6, 8, 11 on the
#15 build), and `:123` "sat in the EAS queue 53 minutes". The body still needs its size table,
file count, commit count and gate run re-derived after the push.

---

## Not fixed, and why

**Nothing deferred.** Carried unchanged, as the review routes them:

- **I2's deliberate `assertTransition()` bypass** (report `:330`). The precedent is Linards's to
  accept in writing.
- **The manual tests**: step 13's banner, step 9's glance mode via `geo fix`, step 12 on the second
  AVD, #263's starvation half on a real device. These keep #15 open.

---

## Validation

| Check | Result |
|---|---|
| Diff shape | 5 files (this report is the 5th), documentation only, **no shipped source** |
| Local full gate | **not run, deliberately**. The change is Markdown only and cannot move `typecheck`, `lint`, `test` or `build`. `ps` shows 20 `claude` processes on this machine, and integration runs collide across sessions (CLAUDE.md) |
| CI `check` on the pushed head | **the gate of record**. The run that gates this commit is named in the PR body after the push, not here, since a report cannot name the run its own commit triggers |
