# PR #277 review fixes — round 1

**Review:** https://github.com/linardsb/taxi/pull/277#issuecomment-5811251088 (head `75091df`).
**Triage** (Linards, 2026-09-24): fix M1 M2 L1 L3 L4; L2 → #275's checklist; L5 informational.
**Fix commits:** `ff661dd` (M1), `163cf05` (M2), `54304c4` (L1, L3), `dfc6d6a` (plan/report amendments, L4). This report is committed after `dfc6d6a` and touches only `.claude/reports/`.

## Fixed

### M1 — driver Retry/Start resent a refused PIN

- **Was:** the banner's Retry called `step(pin)` with the refused digits, and Start was gated only on 4 digits. Each resend spent one of the 5 attempts. After a lock, both stayed live.
- **Fix:** `active-ride-state.ts` records `sentPin` on a pinned start, then `rejectedPin` on `pickup_pin_incorrect` and `pinLocked` on `pickup_pin_locked`. `pinSendable(state, pin)` is the single rule: the screen disables Start on it and the reducer drops a press that fails it. A `pickup_pin_*` banner has no Retry. Network and generic errors keep Retry, which still resends the typed PIN (E10). The digits stay in the field.
- **Tests:**
  - `active-ride-state.test.ts`: "a refused PIN is never resent; different digits are", "once locked, no PIN is sent, even after the banner is reloaded away", "a network failure does not mark the PIN refused".
  - `active-ride-screen.test.tsx`: the wrong-PIN test rewritten (no Retry, Start off on `9999`, on at `9998`), the locked test extended (no Retry, Start off with fresh digits), and a new E10 test on `network_error`.
- **Probes** (`observed`, 2026-09-24):
  - Screen restored to `75091df` and the reducer guard reverted to the schema-only check: `Tests: 4 failed, 58 passed, 62 total`. The network-error regression test passes on both, as it should.
  - E10 handler mutated to `step()`: `1 failed, 15 passed, 16 total`.
- **New failure mode of the mechanism:** the lock lives only in memory. After an app restart `pinLocked` is false, and the first Start gets a 409 `pickup_pin_locked` that sets it again. The server refuses a locked ride before counting, so no attempt is spent.

### M2 — rider PIN switch target and screen-reader reading

- **Fix:** `booking-screen.tsx`: the row is now a `Pressable` with `accessibilityRole="switch"`, label, hint, `accessibilityState={{ checked, disabled }}` and `onPress` toggling. The inner `Switch` has `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`. The visible hint has `accessibilityElementsHidden` + `importantForAccessibility="no"`.
- **Test** `booking-screen.test.tsx`:
  - the switch role resolves to `pickup-pin-row`, and exactly one element has that role;
  - the hint is present only with `includeHiddenElements`;
  - the row's `minHeight` is at least 44;
  - pressing the row checks it and persists `'1'`.
- **Probe** (`observed`): screen restored to `75091df`: `1 failed, 12 passed` (`Expected: "pickup-pin-row"`, `Received: undefined`).
- **Double toggle check** (`observed`): tapping the nested native `Switch` should not also fire the row's `onPress`. `react-native/Libraries/Components/Switch/Switch.js:257-258` sets `onStartShouldSetResponder={returnsTrue}` and `onResponderTerminationRequest={returnsFalse}`, so the Switch keeps the touch. This is a source read, not a device run.

### L1 — PIN verdict did not re-check status under the lock

- **Fix:** `lockPickupPin` also selects `status`. `start()` takes a verdict only when `gate?.status === from`. Otherwise it passes `open` to `transitionInTx`, which is conditional on `from` and returns nothing. The result is 409 `ride_transition_conflict` with cause `lost_race`, and no failure is charged.
- **Deviation from the review's fix:** the review asked for `ride_not_arrived`. The lost-race conflict was chosen instead because it is what actually happened, and because the driver reducer re-reads the ride on both codes (`active-ride-state.ts` `step_failed`), so no client needs the other code. It also kept the service at **499/500** lines.
- **Tests:**
  - `ride-lifecycle.service.spec.ts`: "a ride cancelled between the guard and the lock is a lost race, not a charged wrong PIN". Unfixed line: `Received message: "pickup_pin_incorrect"`, 1 failed.
  - `ride-pickup-pin.integration.spec.ts`: new case, **the review's scenario reproduced.** A holder takes the row lock, a wrong-PIN start blocks on it, then the holder commits `status = 'cancelled_by_rider'` and releases. Fixed: `9 passed` with 409 and `pickupPinFailures = 0`. Unfixed line: `Expected: "409 ride_transition_conflict"`, `Received: "422 pickup_pin_incorrect"`. Both `observed`, run alone with `COMPOSE_PROJECT_NAME=taxi`.
  - The first draft of this test used `rider(59)`, which collided with the spec's `dispatcher(59)` on `users_phone_unique`. It now uses `rider(70)`, which no other fixture in the file uses.

### L3 — lock-waiter count spanned the whole database

- **Fix:** the poll adds `AND query ILIKE '%pickup_pin%'`. Both the lock read and the unlocked increment name `pickup_pin_*` columns. The new L1 case uses the same filter.
- **Probes** (`observed`):
  - with the lock: `8 passed, 8 total`;
  - `.for('update')` deleted: `Expected length: 5`, `Received length: 8`. The narrowed filter still counts this test's waiters, and the mutation stays red. Restored.
- **Reduced claim:** no waiter from another session was reproduced. The fix narrows the count to this test's statement text. It does not prove that a concurrent session's waiter is now excluded. A second session running this same spec at the same time would still match.

### L4 — report gate line named no head

- **Fix:** `pickup-pin-report.md` "Validation results" now quotes the recorded run (`record-gate.sh --clean`, `.claude/last-gate.json`, head `75091df`, 1m38.523s). It says the earlier 1m34s was at an uncommitted tree, and points here for the gate after the fixes.

## Deferred

- **L2 (Low):** appended as a checklist line under "Review carry-over" on #275, which is open and is the dispatch-console PIN ticket (`gh issue edit 275 --body-file`, 2026-09-24).
- **L5 (informational):** conflicts with #274 in four files. Whichever PR merges second rebases and re-runs the gate. `ride-lifecycle.service.ts` grew from 497 to 499 lines this round. The review measured the merged file at 468 lines, so the estimate is 468 + 2 = 470 (`derived`, assuming both added lines merge cleanly). Re-measure at the rebase.

## Needs a manual look

- **Device, driver (M1):** the plan-report row (d) proved AC9 by pressing Retry after a PIN banner, and that banner no longer has Retry. Owed on the next driver build:
  - a wrong PIN shows no Retry, and Start is disabled until the digits change;
  - the corrected PIN via Start reaches «Brauciens notiek»;
  - after 5 wrong entries, Start stays disabled.
- **Device, rider (M2):** check on iOS VoiceOver and Android TalkBack that the row is one stop reading label, state and hint once, and that a tap on the native switch toggles exactly once. Owed to #276, with the rest of the on-device a11y legs.

## Validation

`observed`: `REDIS_PORT=6381 COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 record-gate.sh --clean` at `dfc6d6a`, not dirty, exit 0, 2026-09-24T09:43:47Z–09:45:40Z.

- Tasks: **22 successful, 22 total**, 0 cached, 1m52.803s.

| Package | Tests | Change from `75091df` |
|---|---|---|
| shared | 273 | 0 |
| db | 17 | 0 |
| dispatch | 272 | 0 |
| rider | 176 | 0 (one test rewritten) |
| driver | 272 | +4 (3 reducer, 1 E10 screen) |
| api | 842 in 86 suites | +2 (1 unit, 1 integration) |

## Sweep for stale copies

Commands run in the worktree after the amendments. Hits listed are the ones still standing, each correct as it now reads.

- **Retry resending the PIN.** `grep -n "Retry resends\|Retry resend\|resends the" .claude/plans/pickup-pin.md .claude/reports/pickup-pin-report.md`:
  - plan:201 is the generic/offline case, still true;
  - plan:600 is amended;
  - plan:679 is E10, the network case, still true;
  - plan:743 is AC9, amended;
  - report:115 is row (d), annotated as predating M1;
  - report:145 is amended.
  - PR body: lines 20 and 67 had it; rewritten in this round's `gh pr edit`.
- **Service length 497.** `grep -n "497" …`:
  - plan:830 and report:73/129 now carry 499;
  - PR body line 69: 497 → 499.
- **Gate duration 1m34.** `grep -n "1m34" …`: report:53 only, now framed as the superseded run. PR body: none.
- **Waiter query.** `grep -n "wait_event_type" …`: plan:479, amended with the L3 filter. PR body: none.
- **Switch row.** `grep -n "minHeight: 44\|44 px row" …`:
  - plan:203 and plan:525 are amended with an M2 note beneath;
  - plan:833 and report:137 are still true, because the 44 px row is now the pressable;
  - report:47 is amended;
  - PR body line 78: rewritten.
