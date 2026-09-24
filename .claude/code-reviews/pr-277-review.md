# PR #277 review — round 1

**Head** `75091df` · **Base** `main` @ `1129710` · **Reviewed** 2026-09-24 · `feature/pickup-pin-258`

Base has not moved: after `git fetch origin`, `git rev-parse origin/main` = `1129710`, the same sha the PR records. This is the first round, so the guarantees pass and the fix-mechanism pass do not apply. The constraint pass found nothing: grepping the plan for frozen or do-not-modify language returns no hits, so none of the fixes below breaks an acceptance criterion. The deviations listed in `.claude/reports/pickup-pin-report.md` are intentional and are not raised here. That includes the TalkBack skip of the disabled Start button (owed to #276) and the T11 unmount test that cannot fail.

## Verdict

**Approve, and fix M1 before merging.** There is no Critical and no High finding. All 5 checks are green and `mergeStateStatus` is `CLEAN`. The local gate is green at 22/22, and I re-ran the row-lock claim myself.

M1 is a design fault that the plan prescribed. The driver screen offers **Retry** in exactly the situation where retrying uses up the ride's 5 attempts.

## Issues

### M1 (Medium): Retry and Start resend a PIN the server just rejected, and each resend costs one of the 5 attempts

- **Where:**
  - `apps/driver/src/features/active-ride/active-ride-screen.tsx:166`: the error banner's Retry button calls `step(pin)` with the digits still in the field.
  - `:204`: Start is disabled only while there are fewer than 4 digits.
  - `active-ride-state.ts:246-249`: `step_pressed` checks only that the PIN is well-formed.
  - The server cannot tell the entry is a repeat. `pickupPinVerdict` counts it again (`ride-lifecycle.service.ts:136-137`).
- **Scenario:** the driver types `1234` and gets «Nepareizs PIN kods.» with a Retry button. Tapping Retry twice spends 3 of the 5 attempts on one wrong guess. Two more mistakes lock the ride, and cancelling is then the only way out.
- **After a lock:** Retry and Start stay live, and each tap is a guaranteed 409.
- The test "a wrong PIN shows its copy and Retry resends the typed PIN" asserts the current behaviour. The plan prescribed it, so this is a design correction, not an undocumented deviation.
- **Fix:**
  - Drop the Retry action from the banner for `pickup_pin_*` codes. Keep it for network and generic errors, which is the case E10 was written for.
  - Record the rejected PIN in the reducer on `step_failed` (for example a `rejectedPin` field), and keep Start disabled while the field still equals it. The digits can stay in the field so the driver corrects them instead of retyping.
  - On `pickup_pin_locked`, disable Start entirely.
  - Change the screen test to assert the new behaviour.
- **Evidence:** read, not run. The code path is short and has no branching that would change the outcome.

### M2 (Medium): The rider's PIN switch has a touch target and screen-reader problem

- **Where:** `apps/rider/src/features/booking/booking-screen.tsx:229-242`, and the matching assertion in `booking-screen.test.tsx`.
- **Problems:**
  - The 44 px `minHeight` is on a plain `View`, which cannot be pressed. Only the native `Switch` responds to touch, and on iOS that is 31 pt tall. The test measures the row, not the touch target, so it does not prove AC10.
  - The label `Text` is its own focus stop, so a screen-reader user hears the label once as text and again on the switch.
  - The hint is set both as `accessibilityHint` and as a visible `Text` under the row, so it is read twice.
  - Tapping the label does nothing.
- **Fix:** make the row a `Pressable` with:
  - `accessibilityRole="switch"` and `accessibilityState={{ checked, disabled }}`
  - the label and hint on the row itself
  - `onPress={() => pin.set(!pin.value)}`
  - the inner `Switch` and the visible hint hidden from the accessibility tree

  Then assert the row's role, state and size. The on-device size check stays with #276.
- **Why Medium:** CLAUDE.md makes screen-reader-excellent a launch differentiator for every rider screen.

### L1 (Low): The PIN verdict does not re-check the ride's status under the lock

- **Where:**
  - `ride-lifecycle.repository.ts` `lockPickupPin` selects only `pin` and `failures`.
  - `guardDriverStep` checks the status before the transaction starts (`ride-lifecycle.service.ts:125`).
- **Scenario:** the rider cancels between the guard and the lock. A wrong entry still adds a failure to the cancelled ride and returns 422 `pickup_pin_incorrect` instead of `ride_not_arrived`. The driver app does not reload the ride for `pickup_pin_*` codes (`active-ride-state.ts:287-290`), so the driver sees "wrong PIN" on a cancelled ride until the socket's cancel event arrives.
- The `open` path is safe, because `transitionInTx` only moves a ride that is still `arrived`.
- **Fix:** also select `status` in `lockPickupPin`, and return the `ride_not_arrived` conflict when it is not `from`.

### L2 (Low today; must be settled before #275): A phone rider has no second way to get their PIN

- **Where:** `ride-notifications.service.ts` `arrivalBody` is the only place the PIN reaches a phone rider. Nothing in `apps/dispatch` reads `pickupPin`.
- **Scenario:** the SMS provider fails at `arrived`. Dina sees `dispatch:sms_failed` but has nowhere to read the PIN, the driver cannot start, and the only way out is a cancel.
- Unreachable through the console today, because it hardcodes `pickupPin: false`. The API path is live and tested.
- **Fix:** record the recovery path on #275 before it ships. The options are a dispatcher-only PIN read or a resend-PIN SMS.

### L3 (Low): The lock-contention test counts lock waiters across the whole database

- **Where:** `ride-pickup-pin.integration.spec.ts:524-526` counts every backend with `wait_event_type = 'Lock'` in the current database.
- **Scenario:** a waiter from another session sharing `taxi_api_test` (the collision CLAUDE.md warns about) fills the count early. The test releases the holder before all 8 of its own starts are blocked, and the 5/3 split can then come out wrong. The failure mode is a flaky red run, not a false pass.
- **Fix:** narrow the count to this test's statements, for example `AND query ILIKE '%pickup_pin%'`, or join `pg_locks` on the `rides` relation.

### L4 (Low): The report's gate line names no head

- **Where:** `.claude/reports/pickup-pin-report.md` "Validation results" quotes 1m34s ("run 2").
- **Problem:** the PR body quotes a different run: 1m38.523s at `75091df`, from `record-gate.sh`, which does match `.claude/last-gate.json`. The report's per-package counts agree with the body, but its duration belongs to an earlier run at an uncommitted tree.
- **Fix:** stamp that run with its head, or quote the recorded run.

### L5 (Low, informational): Conflicts with PR #274

- **What:** `git merge-tree` against #274's head reports content conflicts in four files:
  - `active-ride-state.ts`
  - `ride-lifecycle.controller.ts`
  - `ride-lifecycle.service.spec.ts`
  - `rides.controller.ts`
- Whichever PR merges second must rebase and re-run the gate. `ride-lifecycle.service.ts` itself merges cleanly at 468 lines, under the 500-line cap (`observed`, `git show <merge-tree>:… | wc -l`).

## Validation

| Check | Result | Provenance |
|---|---|---|
| `pnpm turbo run typecheck lint test build --force`, dist and `.next` cleared, `REDIS_TEST_URL` set, head `75091df` | **22 successful, 22 total**, 0 cached, 1m32.023s, exit 0 | `observed`, this review |
| Tests per package | shared 273 · db 17 · dispatch 272 · rider 176 · driver 268 · api 840 in 86 suites | `observed`; identical to the PR body |
| CI | `check`, `audit-diff`, `codeql`, `CodeQL` and `ready` all pass; the PR is no longer a draft | `observed`, `gh pr checks 277` |
| Row-lock mutation: `.for('update')` removed from `lockPickupPin`, integration spec run alone | red: `Expected length: 5, Received length: 8` (8 × `422 pickup_pin_incorrect`), 1 failed and 7 passed; the file was restored and `git status` is clean | `observed`, this review |
| PR body size table | all 8 buckets and the total (55 files, +4836 / −115) re-derive exactly from `git diff --numstat origin/main..HEAD` | `observed` |
| `ride-lifecycle.service.ts` length | 497 lines | `observed`, `wc -l` |

## Numbers pass

- **Gate line:** `observed`. `.claude/last-gate.json` at `75091df` records the same task count, duration and per-package counts as the PR body.
- **Size table:** `observed`, re-derived; see Validation.
- **Row-lock split, 5 × 422 + 3 × 409:** `observed` in the gate, and the PR's "with the lock deleted, 8 × 422" reproduces.
- **Brute-force ceiling, 5 ÷ 10,000 = 0.05 % per ride** (`ride-lifecycle.policy.ts`): labelled `derived`, and the condition it assumes (a uniformly minted PIN, 5 distinct guesses) is stated. The row lock is what makes 5 a hard ceiling, and the mutation above shows that.
- **EAS 807 s:** `derived` from EAS's own `createdAt` and `completedAt` timestamps, which the body cites. Not re-checked.
- **Only gap:** L4.

## What is done well

- **The PIN is never on `rideSchema`.** `findWithQuote` returns it next to the ride rather than inside it, and only `riderRideSchema` carries it. A path someone forgets therefore drops the PIN instead of leaking it. Every other caller of `findWithQuote` reads only `.ride` or `.quote`, and every socket emit is parsed through `RT_EVENT_SCHEMAS`, which strips unknown keys.
- **A rejected attempt is committed before the error is thrown.** The transaction returns the verdict and the throw happens after the commit, and the unit test pins the order `begin → pin_failure write → commit`.
- **The concurrency test holds the lock itself.** It takes the row lock, waits until all 8 starts are blocked in `pg_stat_activity`, and only then lets go, so the test does not depend on timing luck.
- **The type system closes the old route.** `driverStep` now excludes `start`, so calling the unguarded path no longer compiles.
- **The state machine carries a note for the future.** `ride-state-machine.ts` says a release edge out of `arrived` must reset the failure counter in the same write.
- **The log never holds the PIN.** PIN rejections reuse `transition_rejected` with a closed `cause` union, and the manual run found 0 log lines containing a PIN.

## Recommendation

Approve. Fix M1 before merging, because each Retry tap spends one of the rider's 5 attempts. Fix M2 in this PR as well, under the rider screen-reader rule. L1 and L3 are one-line hardening. Record L2's decision on #275.

Next step: run `piv-fix-review-findings` on this report. A human reviews the code and this report, and merges.
