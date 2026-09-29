# PR #300 review fixes, round 2

Review: `.claude/code-reviews/pr-300-review-round2.md` (on `docs/pr-300-review`, head `b3780e3`). Round 2 reviewed PR head `13f70d7`. Verdict: approve, with three prose Lows. All three are fixed in one docs commit, and none was deferred.

## Fixed

**L1 · `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts:85-90`.** The `findPickupPinTarget` docblock said "Status and PIN only". It now says "Status, PIN and booking channel", explains that the channel is there because only a phone ride's PIN may be read (PR #300 M1), and keeps "Nothing else should sit beside the PIN". The change is to a comment only, so no test can detect it.

**L2 · `.claude/plans/dispatch-phone-options-275.md`.**
- `:520`: the breadboard row is now `Board row (arrived, phone, pickupPinRequired)`.
- `:695`: the phone-index list now reads drivers 11–14, admin 88, riders 83/89. Each index was checked against the spec: `onlineDriver(14)` at `ride-pickup-pin.integration.spec.ts:721`, `rider(89)` at `:720`, `dispatcher(88, 'admin')` at `:685`.
- The sweep found the same channel-less claim in two more places, and both are fixed:
  - `:15` (Summary): "on a PIN ride at `arrived`" is now "on a phone-booked PIN ride at `arrived` (phone only since PR #300 M1)".
  - `:436` (T19 test spec): "appears only for `status: 'arrived', pickupPinRequired: true`" now adds "on a phone booking (PR #300 M1)".

**L3 · PR body, "Manual run".** The review suggested "at `36df1f2`, before the round-1 fixes". That is not quite right:
- The run is stamped `~14:31–14:38Z` (`dispatch-phone-options-275-report.md:90`).
- `36df1f2` was committed at `2026-09-28T15:45:22+01:00`, which is 14:45Z (`git log`).
- `36df1f2` also contains the Enter-key fix that the run found.

So the run used the uncommitted tree that became `36df1f2`. The heading now gives the time, names that tree, says the run came before the round-1 fixes, and notes that every ride it used was phone-booked.

## Sweep (retired phrases, run against the fixed tree)

The search covered `services`, `packages` and `apps` (`*.ts`, `*.tsx`), plus the plan, `dispatch-phone-options-275-report.md`, `pr-300-review-fixes.md`, and the PR body (fetched with `gh pr view 300 --json body`).

| `grep -F` pattern | Hits after the fix |
|---|---|
| `PIN only` | `pickup-pin-read.service.ts:22` and plan `:15` both say "gets their PIN only in the arrival SMS". Different subject, still true. |
| `pickupPinRequired)` | Plan `:520` (fixed). The other hits are spec `expect(...)` lines. |
| `drivers 11–13` | none |
| `rider 83.` | none |
| `Rādīt PIN\|PIN ride` (`grep -E`) | Plan `:15` and `:436` (fixed). Plan `:578` (E13) and `:620` are still true: one says the button is absent, the other describes a phone ride. Report `:13` and PR body `:32` already say "phone-booked". |

## Validation

- `npx tsc --noEmit` in `services/api` exited 0 (`observed`, 2026-09-29).
- `npx eslint src/features/rides/lifecycle/ride-lifecycle.repository.ts` exited 0 (`observed`). The file is 266 lines, under the 500-line cap.
- The full gate was **not run locally**. The only source change is a comment, and about 28 Claude processes share the integration test DB. CI's `check` job runs the full gate on the pushed head.
