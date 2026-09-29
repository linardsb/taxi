# PR #300 review, round 2: feat(dispatch): phone-order pickup options, announce badge, PIN read (#275)

**Head** `13f70d7` · **Base** main @ `a4ed925` · reviewed 2026-09-29 · round 2 (round 1 at head `36df1f2`, base `a4ed925`)

**Verdict: approve.** No Critical, High or Medium findings. All five round-1 findings are closed, and the two behavioural ones (M1, L1) were re-checked by mutation in this round. Three Lows remain, all prose.

## Summary

Round 1 raised one Medium and four Lows. Linards chose M1 option (a): the dispatcher PIN read is now phone-only. Four source commits (`343ab43`, `bfd637e`, `1c410f2`, `20655c0`) and two docs commits (`dd168f3`, `13f70d7`) close them. The fix report is `.claude/reports/pr-300-review-fixes.md`, and it has the per-finding sweep and the mutation outputs that `piv-fix-review-findings` requires.

What I checked:
- **Guarantees pass: skipped.** `origin/main` after `git fetch` is `a4ed925`, the same as round 1's recorded base, so the base has not moved.
- **Fix-mechanism pass.** Round 1 had no Critical or High, but I still asked of M1 what the new check newly permits:
  - `RideRowActions` has one caller (`ride-queue.tsx:135`), and `bookingChannel` is a required typed prop, so a missed caller fails typecheck.
  - `findPickupPinTarget` has one consumer, the service.
  - The console and the api both read the same `rides.bookingChannel` column, which never changes after booking, so they cannot disagree.
  - An app ride with no PIN still answers `pickup_pin_not_set`, as the docblock says.
  - The new `pickup_pin_not_phone` maps to the generic «try again» copy in the console. The fix report records that the UI cannot reach it, because the button is hidden on app rows.
  - `logRejected` takes only `rideId`, `actorId` and `cause`, so the new rejection cannot carry the PIN.
- **The `code-reviewer` agent** reviewed the fix delta independently. I confirmed its two findings by reading the lines (L1, L2 below).
- **Retired-claim sweep.** I grepped the added lines under `packages`, `services` and `apps` that mention both the dispatcher (or Dina) and the PIN but not the phone. The only hits are the controller and the `dispatcherPickupPinSchema` docblocks. Both are still true: the controller says "a phone caller's pickup PIN", and the schema says the read exists for "a phone rider". The miss is in the repository (L1).

## Round-1 findings

| Round 1 | Closed by | Verified this round |
|---|---|---|
| M1 PIN read open on app rides | `343ab43` (api), `bfd637e` (console) | `observed`: `bookingChannel === 'phone' &&` → `true &&` in `row-actions.tsx` → `ride-queue.test.tsx` `Tests 1 failed \| 11 passed (12)`; `if (ride.bookingChannel !== 'phone')` → `if (false as boolean)` in the service → `Tests: 1 failed, 4 passed, 5 total`. Both reverted: 12/12 and 5/5, tree clean. Same counts as the fix report. |
| L1 `clear()` in-flight test | `1c410f2` | The agent traced it: `fetch` is called before the first `await`, so the resolver exists before `clear()`. The fix report's mutation gives `1 failed \| 6 passed (7)`. Not re-run. |
| L2 admin role untested | `343ab43` | Read: `readPin(ride.id, admin.auth).expect(200)` at `ride-pickup-pin.integration.spec.ts:685`. Mutation not re-run: that needs the shared test DB. |
| L3 not-arrived copy | `20655c0` | Read: all three catalogs reworded. |
| L4 gate label | `dd168f3` | Read: the report lists the `36df1f2` run first and relabels the 14:39Z one. |

## Issues

### Low

**L1 · stale docblock · `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts:87-88`.** The docblock still says "Status and PIN only — nothing else is needed to decide, and nothing else should sit beside the PIN." Since `343ab43`, the select also returns `bookingChannel`, and the M1 check needs it. This is the one read that hands the PIN to someone other than the rider, so a false "only" here misleads anyone auditing it later. Dropping the column to "restore" the rule would fail typecheck, so this is not a leak risk. The fix report's sweep (`pr-300-review-fixes.md` §Sweep) did not cover this file. **Fix:** "Status, PIN and booking channel: the channel because only a phone ride's PIN may be read (PR #300 M1). Nothing else should sit beside the PIN."

**L2 · plan prose · `.claude/plans/dispatch-phone-options-275.md`.**
- `:520`: the breadboard reads `Board row (arrived, pickupPinRequired) : [Rādīt PIN] …` with no channel. That is now false for an app row.
- `:695`: the phone-index list is the one the plan's collision warnings send authors to. It lacks the indices the fixes added: driver 14, rider 89, and admin 88.

**Fix:** add "phone" to `:520`, and add those three indices to `:695`.

**L3 · figure provenance · PR body, "Manual run".** The Level 4 run (`8376`, `5203`, and the Enter-submits bug) names a date but no head. It ran before the M1 fix, which changed exactly when «Rādīt PIN» renders. Every ride it used was phone-booked, so every result still holds. But a reader cannot tell that the console run predates the phone gate. **Fix:** add "at `36df1f2`, before the round-1 fixes" to the heading line.

## Validation

| Check | Result | Provenance |
|---|---|---|
| CI `check` at `13f70d7` | `Tasks: 22 successful, 22 total`. api 91 suites / 928 tests, dispatch 32 / 303, shared 30 / 304, driver 46 / 357, rider 37 / 231, db 3 / 17 | `observed`, run 36450959638, job 109025723218 log |
| CI `audit-diff`, `codeql`, `CodeQL`, `ready` | pass | `observed`, `gh pr checks 300` |
| PR body gate block (`20655c0`, `1m41.746s`, counts) | matches `wt-275/.claude/last-gate.json` (head `20655c0`, `dirty: false`, exit 0) and CI's counts digit for digit | `observed` |
| "the two commits above it are docs only" | `git diff 20655c0..13f70d7 --stat`: 5 files, all under `.claude/` | `observed` |
| PR body diff stat: 44 files, +2472/−24 | `git diff a4ed925..13f70d7 --shortstat` and `gh pr view` agree | `observed` |
| M1 mutations (console, service) | red, then green on revert (table above) | `observed`, this review |
| Local full gate | not re-run. CI's gate ran at the same head on the same base (`a4ed925` = live `origin/main`), and about 30 Claude processes share the test DB | — |
| Constraint pass | not needed: no fix is prescribed beyond prose | — |

## What is good

- The phone-only check sits in both places that need it: the api (the guard) and the row button (so the case never shows). The integration case is round 1's own scenario, end to end: an app booking with a PIN, taken to `arrived`, refused with `409 pickup_pin_not_phone`.
- The new refusal logs its own `cause`, so the audit log never says a PIN ride has no PIN.
- The fix report re-observed two mutation counts that the new tests changed, and said plainly that one "3 of 4" figure is not comparable with its re-run. That is the provenance discipline CLAUDE.md asks for.
- The PR body was rewritten after the push: the refusal order, the phone-only gate, the gate block and the diff stat all match the pushed head.

## Recommendation

Approve. L1–L3 are text edits and can go in one docs commit on this PR, or be left. None of them blocks the merge.
