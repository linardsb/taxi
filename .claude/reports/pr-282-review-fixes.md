# PR #282 review fixes, round 1

**Review**: https://github.com/linardsb/taxi/pull/282#issuecomment-5821360300 (round 1, request changes, head `6108041`).
**Scope**: the PR is a single plan file, `.claude/plans/arrival-announce-protocol-259.md`. Every fix is a plan edit. No code changed, so no code test ran. For each finding, the "test" is:
- the plan now specifying a failing-first test for the defect, and
- a `grep` showing the old claim is gone.

**Triage**: all 12 fixed in this PR. None deferred, none dismissed. No scope steer came with the review, and the reviewer recommends folding all of them in.

**Verification before editing**: every code citation in the review was re-read in `~/taxi-worktrees/wt-259` at `6108041`, whose code is `d6deaa6`. All 12 findings reproduce. `observed` 2026-09-24.

## Fixed

| Code | Verified against the code | Plan change |
|---|---|---|
| H1 | `use-active-ride.tsx:160-161` announces with no platform check. The reducer `announce` sits at `active-ride-state.ts:216,224,230,244,260,319,350,369,379`, and the matching Banners at `active-ride-screen.tsx:95-99,103-113,166-172`. `presence-state.ts:135` («Bezsaistē») plus the `marked_offline` Banner, whose text also says «bezsaistē». | T0 gains a caller audit table, P1–P5, each with its fix. P4 keeps `completed_title` only when `ride.split` is set. P5 skips the announce for `marked_offline` only. Named test flips: `active-ride-state.test.ts:114`, `:373`. New AC15 and T23 (e3). :83 is deleted and :317 is rewritten. |
| H2 | `search-sheet.tsx:103` ticks every 1 s. `:281-285` puts `cooldown` in the Banner `text`. The Banner effect is keyed on `[text]` (rider `Banner.tsx:52-56`). | T0 P6: the Banner text becomes `t(error)`, the countdown moves to a sibling `Text`, and a fake-timer test expects exactly one announce. |
| H3 | As described. The plan's `send` stored the result only on settle. | T11: `send` clears `result` first. A test for two successes and two 429s expects two announces each. T13: `key={state.lastAnnounceAt}` on the driver Banner, plus a test. |
| M1 | `gate-screen.tsx:25-27`, `active-ride-screen.tsx:77`, `push-registrar.tsx:32-44`. The gate reaches `/active-ride` through `nextRoute` (`onboarding-state.ts:18`). | T14: the announce tap dispatches, then `router.replace('/')`. T12: `lastAnnounceAt` resets only in `opened()` (`active-ride-state.ts:191-194`), and the same-ride branch `:184-190` keeps it, so the tap is not re-fired by the replay. |
| M2 | `step_done` (`active-ride-state.ts:293-303`) sets `ride.status` itself, and its comment says the following `ride:status` is a no-op. | T12: the notice is cleared in `step_done` when `to !== 'arrived'` and on a `status` event. A reducer test covers it. |
| L1 | `ride-lifecycle.service.spec.ts:183-190` (6 args), `driver-ride.spec.ts:106-111` (`toEqual(base)`), `push-registrar.test.tsx:44-49` (mock `{ open, state }`), deps at `push-registrar.tsx:58`. | T6 and T14 list each update. T12 requires `announceRequested` to be a stable `useCallback`. |
| L2 | Hits at the old :55, :547 and :721. | All three are rewritten to the T0 mechanism. T0 also lists the shipped comments that still reason about the live region: `status-screen.tsx:67-78`, `search-sheet.tsx:126-128,299`, `auth/gate-screen.tsx:35`, and both `Banner.test.tsx` titles. |
| L3 | Both `Banner.test.tsx` files have tests at `:6` (iOS announces) and `:19` (Android does not, asserted at `:30`). | T0's VALIDATE is corrected: only `:19` goes red first. |
| L4 | `.prettierrc` has no `printWidth` (default 80). Measured with python: driver 93/83/96/95, push 58/71, rider 61/90/63/71/65/71/84. | T4: lv **404** (4×2 + 2×1 = 10). lv-rider 118 confirmed (2×2 + 5×1 = 9). The arithmetic and its condition are shown. |
| L5 | As described. | T12: `isNewer(at, last) = last === null \|\| at > last`, with a test for an older `at`. |
| L6 | The docblock at `realtime-events.ts:29-31` claims a doc-sync check. The plan's own GOTCHA found none. | T3 corrects the comment instead of keeping the rule. |
| L7 | `offer-builder.ts:64` is `rideOfferSchema.parse({…})`. | D2 now cites both legs. T8 step 2 asserts the offer push's `data.offer` lacks `announceArrival`. |

**Found while re-deriving H1, not in the review:**
- **P7.** `use-quote.ts:56` announces «Cenu neizdevās aprēķināt», and `booking-screen.tsx:212-219` shows the error Banner for the same failure. T0 drops the hook's failure announce.
- **In passing.** Out of Scope said the `ui-decisions.md` entry was T19. It is T17.

**Checked and not changed:**
- `presence-state.ts:303` carries the banner and never sets a new one, so its Banner does not re-fire.
- `use-book-ride.ts:66` and the status line speak two distinct messages in sequence. T24 (b) records the utterances.
- T23 (e3) does not stage P1 (`payment_changed`) on device. It needs a method switch between the offer and the first read, and the method locks at accept. The evidence for P1 is T0's unit test.

## Retired-claim sweep

Run in `wt-259` on 2026-09-24, after the edits. `P` is the plan.

| Command | Hits in the plan | Hits in the PR body |
|---|---|---|
| `grep -n "live region" $P` | :127 (R11 history), :331 (P6: "no live region"), :341 (the T0 retire list), :774 (T23 c: "the live region is gone"), :877 (amendment history). None claims the live region speaks. | 1: "the rider app's `Banner` live region never fired". Still true. |
| `grep -n "402" $P` | :883, in the amendment ("404, not 402") only | 0 |
| `grep -n "iOS-only\|iOS only" $P` | 0 | 0 |
| `grep -n "already holds" $P` | 0 | 0 |
| `grep -n "at !== \|!== state.lastAnnounceAt" $P` | 0 | 0 |
| `grep -n "router.navigate('/active-ride')" $P` | :627, in the "**Not** …" sentence only | 0 |
| `grep -n "T19)" $P` | 0 | 0 |
| `grep -n 'on iOS\|iOS announce' $P` | :89 (the old iOS double, now fixed), :322 (the audit's "already do so on iOS"), :850 (R1′, push on iOS). None is a Banner-is-iOS-only claim. | 0 |
| `grep -c "^### T" $P` | 21, unchanged | "21 task headings". Still true. |
| `wc -l $P` | 884 | "+818 lines" is stale after this commit; the body is updated with the new diff size. |

## Validation

- No local gate. The diff is one `.md` plan plus this report, and other sessions are live on the shared test DB, which a gate drops.
- The gate evidence is CI's `check` job on the pushed head. The PR body names that run. This report does not, because its own commit would move the head it cites.
- `observed`: `git diff --stat` before this report showed 1 file changed, +91 −25, in the plan only.

## Needs a manual look

- The P1–P7 fixes change shipped a11y behaviour in both apps. They are executed and device-checked in T0 and T23 (e3), not here.
- R12 (a focused-node double read) is still `expected` and is measured in T23 (e2).

## Deferred

None.
