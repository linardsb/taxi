# PR #265 — review round 1 fixes

**Review**: [round 1 comment](https://github.com/linardsb/taxi/pull/265#issuecomment-5780568696) — 2 High, 4 Medium, 4 Low
**Branch**: `docs/plan-15-device-pass` · **worktree** `/Users/Berzins/taxi-worktrees/wt-15`
**Base at fix time**: `origin/main` `d6207be` — unmoved since the review recorded it
**Fixed**: 2026-09-22

**All ten findings fixed, plus two the review did not catch** (round 2 reopened F1, F4 and F5: `pr-265-review-fixes-round2.md`). Nothing deferred. No conclusion in
the PR changed: every defect was bookkeeping, exactly as the review said.

Two of the review's own rows did **not** reproduce and were fixed differently — see §"Where the
review was itself wrong". One finding (F5's timezone half) was routed to a human, and this pass
settled it **wrongly**, as UTC; round 2's F11 corrected it to BST — see §"F5's timezone".

---

## Fixed

| # | Sev | What was wrong | Fix | Closing command, run against the fixed tree |
|---|---|---|---|---|
| F1 | High | 12 citations into `driver-device-day.md` pointed into the 164 lines this same PR inserted | Each **re-derived by grepping its quoted phrase at head**, never by adding an offset — four were already 2–7 lines low against `origin/main`, so no offset exists | ✅ 12/12 HIT — see §F1 table below |
| F3 | High | Plan + report + PR body cite a **`§D3` that does not exist**, with a baseline of **9** that appears nowhere in the repo; D4 reported a +6 deviation that is really **+1** | `§D3` → `:178-182`; `9` → **14** (`observed` 2026-09-17, the runbook's own figure); D4 restated as +1 of new drift | `grep -rn '§D3' --include='*.md' --exclude='pr-265-review*' .` → **1 hit, and it is the correction itself** (report:323, "a §D3 that does not exist"). `grep -rn --exclude='pr-265-review*' 'records 9 packages' .` → **0**. Both exclude the review and fixes reports, which quote the retired values |
| F2 | Med | The runbook's §"Also on this day" listed as **owed** two rows this same PR records as **done** | Marked done in place, one clause each. **Row 1 (#14's) untouched**, as the review required | `sed -n '361,362p'` → both rows now carry their 2026-09-22 outcome and point at §"The offers / active-ride pass (#15)" |
| F4 | Med | Status header, AC1 and T5 all described the state after **pass 1**, contradicting the report's own step table 380 lines below | All three restated **from the step table**, which is now named as the source of truth. AC1: `4 of 13 … other 9` → **11 of 14 … other 3** | `grep -c '4 of 13\|the other 9'` → **0**. Arithmetic: 8 ✅ + 3 partial = 11 carry an artifact; 14 − 11 = 3 unrun (steps 4, 9, 12) |
| F5 | Med | «Every row below says which [APK]» was false for 13 of 14 rows; the absolute *"No #15 step result is taken from this APK"* is contradicted by steps 1, 2, 3a; `16:23:16` was the one timestamp with no timezone | Run-environment row now **assigns every step to a pass**; `:188` narrowed to *"No step requiring a ride payload"*; `16:23:16` → **`15:23:16Z`** (this pass first wrote it as UTC; round 2's F11 corrected it — the host clock is BST) | Settled wrongly here, corrected in round 2 — see §"F5's timezone" |
| F6 | Med | The byte-identity argument the report invites the reader to run enumerates the wrong key set (`sms.*` or `console.*`) | Enumerated in full: `sms.` ×2, `console.` ×6, **`push.` ×2**, **`rider.` ×2**, all #17/#135 rider work | `git diff -U0 4e6ffb68 HEAD -- packages/shared/src/i18n/lv.ts` → prefixes are exactly those four; **no changed line defines a `driver.` key**. Conclusion unchanged and still true |
| F7 | Low | `Tick count 17 → 24` was `observed`-true at `86b6871` and moved by two later commits in this same PR; carried no provenance word | **`17 → 25`**, with `observed` + the exact command + the two revisions compared. **Edited last**, after the runbook settled | `grep -c '✅\|❌' docs/runbooks/driver-device-day.md` → **25** at the final tree; `git show origin/main:…` → **17**. F2's and N1's runbook edits were written glyph-free and **asserted** not to move this unit |
| F8 | Low | The plan sends the next runner to `auth.sms.stub_sent` (the SMS-**body** event) to read an **OTP code** | → `auth.otp.stub_sent`, `sendOtp()` at `:17-28`; the neighbouring `send()` at `:30-41` named as the tracking-link path so the two cannot be confused again | `sed -n '17p;22p;30p;35p'` → `sendOtp()` :17 logs `auth.otp.stub_sent` :22; `send()` :30 logs `auth.sms.stub_sent` :35. Exact |
| F9 | Low | The report names `.claude/last-gate.json` as the check, and it is **gitignored** — no GitHub reviewer can run it | Says so, **and names the reviewable equivalent**: CI's `check` job by `head_sha`, which is public and moves with the head | `sed -n '25p' .gitignore` → `.claude/last-gate.json`. Confirmed gitignored |
| F10 | Low | 13 off-by-N citations and wording nits | All fixed, each **re-opened at head** rather than inherited | See §F10 below — two rows did not reproduce |

### The new failure mode these two High fixes introduce

Required for a High: the repro proves the old failure is gone, not that the mechanism is safe.

**F1 and F3 both write absolute line numbers into a living file.** `driver-device-day.md` is the
only copy of the run sheet and CLAUDE.md routes every device-day session to it, so the next PR
that inserts above `:534` re-breaks all twelve F1 citations, and one above `:178` re-breaks F3.
The fix restores correctness at this head; it does not make the citations durable.

Guarded by an instruction rather than a test, since no gate reads Markdown: the plan's runbook
read-list entry now carries a warning naming this failure and telling the next reader to grep
the quoted phrase instead of trusting the number. That is the same recipe the F1 table below
records, promoted from this report into the artifact a future session actually opens.

**A third unsourced claim, found by the same reasoning and fixed here:** the pass-split I added
for F5 assigned step 10 to pass 2. Steps 5–8, 11 and 13 are named by I5 as blocked on the old
APK, and 3b's own row puts it on the #15 APK, so they are established. Step 10 is **not** in I5's list, its passing
half needs no ride payload, and its evidence carries no timestamp — so its pass is now recorded
as not established rather than asserted. Replacing a false absolute with a precise claim is only
a gain if every element of the precise claim is sourced.

### F1 — every citation re-derived, then re-checked at the fixed tree

`observed` 2026-09-22 18:39:38Z, `sed -n '<line>p' docs/runbooks/driver-device-day.md | grep -F '<phrase>'`:

| Was | Now | Phrase it must resolve to | |
|---|---|---|---|
| `:368` | **`:534`** | *"not a second run sheet"* | HIT |
| `:390` | **`:554`** | `### Setup, once` | HIT |
| `:434` | **`:598`** | `### Injecting a position` | HIT |
| `:519` | **`:683`** | `### Running the steps on an emulator` | HIT |
| `:527` | **`:693`** | the `10.0.2.2` NAT-alias rule | HIT |
| `:531` | **`:700-701`** | the 44 px touch-target divergence | HIT |
| `:535` | **`:698-699`** | dump → `bounds` → `input tap` | HIT |
| `:541` | **`:705`** | *"`uiautomator dump` fails … running countdown"* | HIT |
| `:545` | **`:709`** | *"An `adb` tap cannot win the offer countdown."* | HIT |
| `:548` | **`:719`** | the `system_locales lv-LV` line | HIT |
| `:558` | **`:722`** | `### Gates 2 and 3, as run` | HIT |
| `(367)` | **`(531)`** | `## Emulator route` | HIT |

Unchanged because they were already correct, and re-checked: `:19`, `:78`, `:111`, `:128`, `:233`,
`:245`, `:352`, `:360`, `:362`, `:363`, `:178-182`.

### F5's timezone — settled wrongly here, corrected in round 2 (F11)

The review could not decide whether `16:23:16` was UTC or local. This pass took "local" to mean
Rīga time, ruled it out, and wrote UTC. The host clock is **BST (UTC+1)**, so the install was
**15:23:16Z**. The EAS timestamps are right and still prove the pass split. `observed` 2026-09-22, build `e1afc69a-95db-417c-97ee-69a1a9fd5d8c`:

```
status      FINISHED
createdAt   2026-09-22T14:14:57.231Z
completedAt 2026-09-22T15:22:03.251Z
```

- **The wrong premise (round 1's, taken over here)**: "local" = Rīga, UTC+3, which puts the install
  before the build was submitted. The host is not on Rīga time.
- **Round 2 (F11), `observed`**: every commit on this branch carries `+0100`, and the api log pairs Nest's local `16:24:20` with `at: 15:24:20.152Z`.

So **`15:23:16Z`**: ~73 s after `completedAt` (`derived`: 15:23:16 − 15:22:03.251), before pass 2's first offer at 15:24:20Z.

This also gives the **pass split a hard proof rather than an inference**: step 3a's own artifact is
`dispatch.offer.expired` at **`14:50:42Z`**, which is **31 minutes before the #15 build finished**.
Steps 1, 2 and 3a therefore cannot be on the #15 APK — which is what the PR body's device table
claimed. The review argued this from the countdown seconds in two screenshots; the build timestamp
settles it outright.

### F10 — each row re-opened at head

| Cited | Corrected to | |
|---|---|---|
| `offer-card.tsx:113` (plan ×2) | `:111-115` — `<Text>` opens 111, `testID` 113, content 115 | fixed |
| `push.module.ts:16-27` | `:16-26` — 27 is blank, `@Module` at 28 | fixed |
| `location-task.ts:43-52` | `:43-53` — the ternary's `: speed` is on 53 | fixed **in two places**, see N2 |
| `home-screen.tsx` lines 96–110 | 101–111; 96–100 is its comment | fixed |
| `stub-sms.provider.ts:28-37` | see F8 / N1 | fixed |
| *"`auth.schemas` docblock"* | `packages/shared/src/schemas/auth.ts:15` — no `auth.schemas` file exists | fixed |
| runbook *"660+ lines"* | 667 at `d6207be`, **831** at head, with this PR's own +164 named as the cause | fixed |
| report I5 *"a **transitive** import"* | `schemas/ride.ts:20` imports `trackingTokenSchema` **directly**; what is transitive is the **change** | fixed |
| report T7.2's predicate | now quotes the separate `s <= 0` guard (`offer-card.tsx:60`) that excludes s = 0 — without it the predicate gives 9, not 8 | fixed |
| report «(85%)» | named as rendered from `commissionPct` (100 − 15); `766/901` labelled a consistency check, not the derivation | fixed |

---

## Where the review was itself wrong

Two F10 rows did not reproduce. Both still needed an edit — a different one.

1. **«`gate-screen.tsx` under `features/auth/`»** — the plan gives **no path at all** (`:442`, bare
   `` `gate-screen.tsx` ``). `grep -n 'features/auth' <plan>` → **0 hits**. The review reported a
   wrong path; the real defect is a **missing** one, and it matters because two files carry that
   name: `apps/driver/src/features/onboarding/gate-screen.tsx` (meant here) and
   `apps/rider/src/features/auth/gate-screen.tsx`. Fixed by naming both.
2. **«plan:158 §"Accept timer 20–30 s"»** — it is at plan:**159**, and it cites
   `docs/research/driver-ux-evidence.md`, not the runbook. Its real heading is
   `### 5.1 Accept timer: longer is safer and reduces cancellations` at `:104`, with the 20–30 s
   figure in the body. Fixed with the file, the line and the true heading.

---

## Found while sweeping — not in the review

Both are the **same defect class as F8/F10**, surfaced by grepping the retired *value* rather than
the topic word, and both are inside this PR's diff.

- **N1 — `docs/runbooks/driver-device-day.md:245`** cited `stub-sms.provider.ts:28-37` with
  *"`body` at `:35`"*. `observed`: `body` is at **`:37`**; `:35` is the **event name**; `send()`
  spans **`:30-41`**. This is F8's twin, in the only copy of the run sheet, on the line that tells
  the next runner how to read a tracking token. Corrected.
- **N2 — `docs/runbooks/driver-device-day.md:516`** carried the **same** `location-task.ts:43-52`
  range as the report. It is an **added** line in this PR's diff (`git diff origin/main...HEAD`
  line 164 of the hunk), so it is in scope. Corrected to `:43-53`.

N2 is the point of the advisor's rule: fixing the report's copy and stopping would have left the
runbook's copy stating the same wrong range. `grep -rn -F 'location-task.ts:43-52' --include='*.md' --exclude='pr-265-review*' .`
→ **0 hits** repo-wide now, outside the review and fixes reports that quote it.

---

## The sweep — every retired value, as a list

Run at the fixed tree over the plan, the report and the runbook. This is the checkable artifact the
repo rule asks for, not a sentence claiming a sweep happened.

| Retired value / noun | `grep -rn -F` hits | |
|---|---|---|
| `§D3` | **1** — report:323, the correction itself (*"a §D3 that does not exist"*) | expected |
| `records 9 packages` | 0 | clean |
| `4 of 13` | 0 | clean |
| `the other 9` | 0 | clean |
| `17 → 24` | 0 | clean |
| `660+ lines` | 0 | clean |
| `transitive import` | 0 | clean |
| `offer-card.tsx:113` | 0 | clean |
| `lines 96–110` | 0 | clean |
| `location-task.ts:43-52` | 0 (was **2** — report **and** runbook, see N2) | clean |
| `push.module.ts:16-27` | 0 | clean |
| `auth.schemas` | 0 | clean |
| `sms.* or` | 0 | clean |
| `:28-37` | 0 (was 2 — plan **and** runbook, see N1) | clean |

Repo-wide, not just these three files: `grep -rn '§D3' --include='*.md' --exclude='pr-265-review*' .`
→ the single correction line above (the exclude drops the review and fixes reports, which quote it). The phantom section is retired everywhere it ever appeared.

Remaining `driver-device-day.md:NNN` citations across plan and report, all re-checked:
`:19 :111 :128 :178 :245 :352 :360 :362 :534 :598 :683 :693 :698 :700 :705 :709 :719 :722`.

---

## Not fixed — and why

**Nothing was deferred.** Every finding in the review is fixed. Three things the review routed
elsewhere are recorded here rather than actioned:

- **I2's deliberate `assertTransition()` bypass** (review §"HUMAN READS") — five 2026-08 rides
  retired to `cancelled_by_system` by direct `UPDATE` on the **dev** DB. No shipped code changed,
  and the report already states the justification. But *no direct status writes* is a hard rule in
  CLAUDE.md and this is the first recorded exception, so the **precedent is Linards's to accept in
  writing**, not mine to normalise in a fix pass. Left exactly as the report has it.
- **The manual tests §T11 names** — step 13's one-time payment-change banner, step 9's glance mode,
  step 12's second AVD, and #263's *starvation* half on a real device. These are the reason #15
  stays open; they are not review findings.
- **AC7's money reconciliation** — re-derived again here: `901 | 15 | 135 | 766`; `135 + 766 = 901`;
  15% of 901 = 135.15 → 135. Integer cents throughout. Holds. No edit needed.

---

## Validation

| Check | Result |
|---|---|
| Diff shape | 4 files (this report is the 4th), documentation only, **no shipped source** |
| Local full gate | **not run, deliberately** — see below |
| CI `check` on the pushed head | **the gate of record.** The two fix commits `a0b48c0` and `b96553a` were gated by [run 35768875089](https://github.com/linardsb/taxi/actions/runs/35768875089) — `head_sha` `b96553a`, conclusion **success**, `check` pass 3m41s, with `audit-diff`, `codeql`, `CodeQL` and `ready` green (`observed` via `gh api`). Any commit after `b96553a` — including the one that added this sentence — raises its own run; read the PR's checks for the head of the moment, never this line |
| F7's unit at the final tree | `grep -c '✅\|❌' docs/runbooks/driver-device-day.md` → **25**; `origin/main` → **17** |

**Why the local gate was not re-run.** The change is four Markdown files and no source — it cannot
move `typecheck`, `lint`, `test` or `build`. CLAUDE.md §"Concurrent Claude sessions" makes
integration runs mutually destructive across sessions, and `ps` shows **19** `claude` processes on
this checkout. Re-running would risk another session's gate to re-derive a result CI holds at the
pushed sha. Recorded as a deviation, not skipped silently — the same call the review itself made,
for the same reason.

**The PR body was re-derived after the push, not before.** Its size table, file count, commit count
and gate sha all move with these commits; writing them from the pre-commit tree is the
`taxi-report-restating-pr-body-figures` trap. Order run: edits → commit → push → re-derive →
`gh pr edit`.
