# PR #282 review fixes, round 1

**Review**: https://github.com/linardsb/taxi/pull/282#issuecomment-5821360300 (round 1, request changes, head `6108041`).

**Scope**: the PR is a single plan file, `.claude/plans/arrival-announce-protocol-259.md`. Every fix is a plan edit. No code changed and no code test ran. For each finding, the "test" is:
- the plan now specifying a failing-first test for the defect, and
- a `grep` showing the old claim is gone.

**Triage**: all 12 are fixed in this PR. None are deferred and none dismissed. No scope steer came with the review, and the reviewer recommends folding all of them in.

**Verification before editing**: every code citation in the review was re-read in `~/taxi-worktrees/wt-259` at `6108041`, whose code is `d6deaa6`. All 12 findings reproduce (`observed` 2026-09-24).

## Fixed

**Where the plan departs from the review's prescribed fix (H1, H2):**
- **H1.** The review said to drop the reducer `announce` effects and let the Banners speak. The driver app's root is a plain `Stack` (`app/_layout.tsx:28`), and `apps/driver/src` has no `BackHandler` or `usePreventRemove`. So hardware back from `/active-ride` pops to `/home` while `state.rideId` is still set (`derived` from the code, not run).
  - If the reducer effects were dropped, a release or cancel arriving on `/home` would go silent. Today it is spoken.
  - The plan keeps the app-wide reducer effect as the one speaker, and silences the screen's Banner with a new `announce={false}` prop.
- **H2.** The review said to make the Banner text `t(error)` alone. That drops the seconds the code promises the rider (`search-sheet.tsx:98-99`: "the rider is told how long").

| Code | Verified against the code | Plan change |
|---|---|---|
| H1 | `use-active-ride.tsx:160-161` announces with no platform check. The reducer `announce` sits at `active-ride-state.ts:216,224,230,244,260,319,350,369,379`, and the Banners at `active-ride-screen.tsx:95-99,103-113,166-172`. | T0: `Banner` gains `announce?: boolean`. P1–P4: those Banners get `announce={false}`. The `payment_changed` and `cancelled` effects gain `method`/`reason`, so they speak the Banner's exact text. A new "which speaker stays" rule. AC15, T23 (e3). Old :83 deleted, old :317 rewritten. |
| H1 (presence) | `presence-state.ts:135` «Bezsaistē» plus the `marked_offline` Banner. | **Kept, with the reason stated in T0.** The texts differ. `marked_offline` can land while `/active-ride` is up, where the home Banner is not mounted, so the announce is the only speaker there. |
| H2 | `search-sheet.tsx:103` ticks every 1 s. `:281-285` puts `cooldown` in the Banner `text`, and Banner's effect is keyed on `[text]`. | T0 P6: the countdown stays visible. The Banner is silent while its error came from a 429, and each 429 (`:182`, `:231`) announces once with `retryAfterSeconds`. Test: 3 s of fake timers gives one call containing `5`; past the countdown, still one; then an offline error is announced once. |
| H3 | The plan's `send` stored the result only on settle. | T11: `send` clears `result` first, with a test for two successes and two 429s. Driver side: T12's reducer effect speaks every newer `at` and T13's Banner is silent, so no `key` remount. |
| M1 | `gate-screen.tsx:25-27`, `active-ride-screen.tsx:77`, `push-registrar.tsx:32-44`. The gate reaches `/active-ride` through `nextRoute` (`onboarding-state.ts:18`). | T14: the announce tap dispatches, then calls `router.replace('/')`. T12: `lastAnnounceAt` resets only in `opened()` (`active-ride-state.ts:191-194`), and the same-ride branch `:184-190` keeps it. |
| M2 | `step_done` (`active-ride-state.ts:293-303`) sets `ride.status` itself. | T12: the notice is cleared in `step_done` when `to !== 'arrived'` and on a `status` event. A reducer test covers it. |
| L1 | `ride-lifecycle.service.spec.ts:183-190` (6 args); `driver-ride.spec.ts:106-111` (`toEqual(base)`); `push-registrar.test.tsx:44-49` (mock `{ open, state }`); deps at `push-registrar.tsx:58`. | T6 and T14 list each update. T12 requires `announceRequested` to be a stable `useCallback`. |
| L2 | Hits at the old :55, :547 and :721. | All three are rewritten. T0 lists the shipped comments to retire: `status-screen.tsx:67-78`, `search-sheet.tsx:126-128,299`, `auth/gate-screen.tsx:35`, and both `Banner.test.tsx` titles. |
| L3 | Both `Banner.test.tsx` files have tests at `:6` (iOS announces) and `:19` (Android does not, asserted at `:30`). | T0's VALIDATE is corrected. |
| L4 | `.prettierrc` has no `printWidth` (default 80). Measured with python: driver 93/83/96/95, push 58/71, rider 61/90/63/71/65/71/84. | T4: lv **404** (4×2 + 2×1 = 10). lv-rider 118 confirmed (2×2 + 5×1 = 9). The arithmetic and its condition are shown. |
| L5 | As described. | T12: `isNewer(at, last) = last === null \|\| at > last`, with a test for an older `at`. |
| L6 | The `realtime-events.ts:29-31` docblock claims a doc-sync check, and none exists. | T3 corrects the comment. |
| L7 | `offer-builder.ts:64` is `rideOfferSchema.parse({…})`. | D2 cites both legs. T8 step 2 asserts that the offer push's `data.offer` lacks `announceArrival`. |

**Found while re-deriving, not in the review:**
- **P7.** `use-quote.ts:56` announces «Cenu neizdevās aprēķināt», and `booking-screen.tsx:212-219` shows the error Banner. Both render only on `/book`. T0 drops the hook's failure announce.
- **The driver's #259 notice** had the same mount dependency. T12 now speaks it from the reducer, and T13's Banner is silent.
- **In passing**: Out of Scope said the `ui-decisions.md` entry was T19. It is T17.

**Checked and not changed:**
- `presence-state.ts:303` carries the banner and never sets a new one.
- `use-book-ride.ts:66` and the status line are distinct messages in sequence. T24 (b) records them.
- T23 (e3) does not stage P1 on device. It needs a method switch between the offer and the first read, and the method locks at accept. The unit test is the evidence.

## New failure modes of the High fixes (skill step 4)

- **H1.** The Banner and the reducer effect now hold two expressions of the same copy, and they can drift. Test (T0 VALIDATE): a `use-active-ride.test.tsx` case asserts that the runner speaks the Banner's exact text for `payment_changed` and `cancelled`.
- **H2.** A silence flag left over from a 429 could mute the next, different error. Test (T0 P6): an offline failure after a 429 is announced once.
- **H3.** Clearing `result` unmounts the rider's Banner for the round trip, which moves TalkBack focus if focus was on it. This is `expected`, not run. T11's GOTCHA states it, and T24 (c) records where focus lands. The driver side has no remount.
- **M1** (not a High): through the gate, a warm tap refetches `/me`. Offline, the driver lands on the gate's error Banner until Retry. Every non-offer tap already does this, so it is accepted.

## Retired-claim sweep

Run in `wt-259` on 2026-09-24, on the final edit. `P` is the plan. A hit number is a plan line.

| Command | Hits in the plan | Hits in the PR body |
|---|---|---|
| `grep -n "live region" $P` | 127 (R11 history), 351–352 (T0's retire list), 795 (T23 c: "the live region is gone"), 900 and 908 (amendments). None claims the live region speaks. | 1, "the rider app's `Banner` live region never fired". Still true. |
| `grep -n "402" $P` | 908 only ("404, not 402") | 0 |
| `grep -n "iOS-only\|iOS only" $P` | 0 | 0 |
| `grep -n "already holds" $P` | 0 | 0 |
| `grep -n "at !== \|!== state.lastAnnounceAt" $P` | 0 | 0 |
| `grep -n "router.navigate('/active-ride')" $P` | 647, in the "**Not** …" sentence only | 0 |
| `grep -n "T19)" $P` | 0 | 0 |
| `grep -n "drop the reducer effect\|drop all four\|drop both" $P` (the first draft's H1 fix) | 0 | 0 |
| `grep -n "key={" $P` (the first draft's H3 driver fix) | 0 | 0 |
| `grep -n "P5" $P` (the first draft's presence fix) | 0 | 0 |
| `grep -n 'on iOS\|iOS announce' $P` | 89 (the old iOS double), 326 ("already do so on iOS"), 873 (R1′, push on iOS). None claims Banner is iOS-only. | 0 |
| `grep -c "^### T" $P` | 21, unchanged | "21 task headings". Still true. |

## Validation

- No local gate. The diff is one `.md` plan plus this report, and other sessions are live on the shared test DB, which a gate drops.
- The gate evidence is CI's `check` on the pushed head. The PR body names that run. This report does not, because its own commit moves the head it would cite.
- An intermediate head, `f47399d`, carried the first draft of these fixes (CI run 36053579558, `check` pass). The advisor pass then found the H1 and H2 inversions above, and the final head supersedes it.

## Needs a manual look

- The P1–P4, P6 and P7 fixes change shipped a11y behaviour in both apps. They are executed and device-checked in T0 and T23 (e3), not here.
- The claim that back pops to `/home` mid-ride is `derived` from the code. T23 (e3) now runs it: back, then a release, then one utterance is expected.
- R12 (a focused-node double read) is still `expected`, and T23 (e2) measures it.

## Deferred

None.
