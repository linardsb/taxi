# PR #293 review fixes, round 1

**Review:** https://github.com/linardsb/taxi/pull/293#issuecomment-5856760999 (head `26ef638`, request changes: F1 High, F2 and F3 Medium, F4 to F9 Low).
**Triage:** all nine fixed in this PR, as the review recommends. Nothing deferred, so no epic ticket or issue was edited.
**Base of this pass:** `26ef638`, a clean worktree matching origin.

## Fixed

Each finding lists its test, whether that test was run against the unfixed code first, and the closing command. All closing runs were on 2026-09-27, against the fixed tree.

### F1 (High): the status screen spoke two false states on opening

- **Fix:**
  - `status-screen.tsx`: the status line gets `announce={status !== null}`. The reconnecting Banner gets `announce={linkAttempted}`.
  - `useRideStatus` gains `linkAttempted`, which is set by any of three things:
    - a landed join;
    - a read that fails on the live epoch (checked after the `disposed || readEpoch !== epoch` guard, so a superseded read tells nothing);
    - a socket `connect_error`. This is the case the review's two signals miss: when REST is up and the socket server is down, `connect` never fires and no read fails.
  - `linkAttempted` is reset in the effect cleanup, so another ride starts silent.
- **Probe with the finding's own input.** The review describes the input as a transition: open with `status: null, connected: false, joined: false`, then go to `arrived`. The unit test was run on the unfixed screen and spoke `["Meklējam auto…", "Atjaunojam savienojumu…", <arrival line>]`, which is T24's device sequence. On the fixed screen it speaks only the arrival line.
- **Tests:**
  - `status-screen.test.tsx`, 4 cases:
    - opening at `arrived` speaks only the arrival line;
    - opening at `requested` still speaks the search line once (the text is the same, so only the `announce` flip runs the effect);
    - a drop after a live link speaks the reconnecting line once;
    - a first link that never comes up speaks it once.
    - On unfixed code 3 of these failed and 1 passed. The drop case passes on both, which is the regression it guards.
  - `use-ride-status.test.tsx`, 5 cases:
    - the first frame is `false`;
    - a landed join sets it;
    - a failed first join read sets it;
    - a failed mount read sets it;
    - `connect_error` sets it;
    - a new `rideId` resets it.
    - On the unfixed hook all 5 failed.
    - A second mutation removed only the cleanup reset, and the `rideId` case failed.
- **The failure mode this fix's mechanism introduces:** the gate could silence a real outage, or carry one ride's state into another. Those are exactly the failed-first-join, failed-mount-read, `connect_error` and `rideId` cases above.
- **Closing command:** `npx jest src/features/ride-status` in `apps/rider`. Result: 4 suites, 57 passed.
- **Manual test owed:** re-run T24's "open `/book/status` at `arrived`" step on `sakta224` under TalkBack against this source. No emulator was running this session (`adb devices` listed none), so the device claim stays with T24's pre-fix run, and the unit tests above stand in for it. That is a reduced claim, not an equivalent one.

### F2 (Medium): a Redis failure 500'd the driver's ride read at every status

- **Fix:** `readDriverRide` reads the KV only when the snapshot is `arrived`, through `readAnnounceReplay`. That function catches any error to `null` and logs `ride.read.announce_replay_failed` with the same shape as `ride.read.join_failed`.
- **Tests:** `driver-ride.spec.ts`, 3 cases:
  - `accepted` with a rejecting `lastRequestedAt` resolves and never calls it. This is the review's verbatim input.
  - `arrived` with a rejecting read resolves with `announceRequestedAt: null` and logs the warn.
  - `arrived` with a resolving read replays the `at`.
  - The first two failed on unfixed code (observed, together with F4's: `3 failed, 33 passed`).
- **Closing command:** `npx jest src/features/rides/lifecycle/driver-ride.spec.ts src/features/rides/lifecycle/arrival-announce` in `services/api`. Result: 3 suites, 43 passed.

### F3 (Medium): no visible focus state on either `/book` switch

- **Fix:** `PreferenceSwitch` gets `NameRow`'s pattern: `focused` state, `onFocus`/`onBlur`, and `outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 2`.
- **Test:** `preference-switch.test.tsx` (new) checks that there is no outline before focus, the outline on focus, no border, and that the outline is gone on blur. It failed on unfixed code.
- **Closing command:** `npx jest src/features/booking` in `apps/rider`. Result: 58 passed.

### F4 (Low): a failed replay write spent the window and reached no one

- **Fix:** the `setWithTtl` call is wrapped the same way the emit is. A failure logs `ride.arrival_announce.replay_write_failed`, and the request carries on to the socket and the push.
- **Test:** `arrival-announce.service.spec.ts` rejects `setWithTtl` once, then checks that the request resolves `{ok: true}` and that the emit and the push each ran once. It failed on unfixed code.
- **Closing command:** same run as F2.

### F5 (Low): the request was parsed before the ownership check

- **Fix:** `findAnnounceTarget` returns `request` raw. `ArrivalAnnounceService` parses it with `rideRequestSchema` only after the 404 owner check. The service spec's stub now returns a stored request in the same shape.
- **Test:** `arrival-announce.integration.spec.ts` sets a real row's `request` jsonb to `{}`, then sends another rider's request, which must get a 404.
  - On unfixed code this was `expected 404 "Not Found", got 500` from a `ZodError` (observed). That is the review's input, run end to end.
  - A service unit test could not have failed on the old code, because the parse lived in the repository.
- **Closing command:** same run as F2. The integration file passed.

### F6 (Low): the release-edge comment omitted the announce keys

- **Fix:** the `arrived` row's comment in `ride-state-machine.ts` now also requires deleting `rides:announce:last:<rideId>` and `rides:announce:rate:<rideId>`. Both prefixes are copied from `arrival-announce.policy.ts:22,26`.
- **Test:** none; this is a comment only.

### F7 (Low): the announce notice replaced an undismissed `payment_changed` notice

- **Choice:** the docblocks were corrected, and the behaviour was kept. At the kerb the rider's request is the notice that matters. The payment change was spoken once, and the pill still shows the operative method. A separate state field would have needed a second dismiss action in a reducer that is at 488 of 500 lines.
- **Fix:** `announceNotice` and `clearStaleAnnounce` now state the replacement.
- **Test:** `arrival-announce.test.ts` checks that `payment_changed`, then a request, gives `announce_requested` with the notice effects, and that leaving `arrived` then gives `null`. It pins the existing behaviour, so it passes on old code by design.
- **Closing command:** `npx jest src/features/active-ride/arrival-announce.test.ts` in `apps/driver`. Result: 20 passed.

### F8 (Low): a stale event count

- **Fix:** `realtime-events.ts:22` now reads "all 10 events", changed from 9.

### F9 (Low): the report's shared baseline was wrong

- **Fix:** the report now reads `291 → 300`, with the review as its source. The report's gate section still quotes run 2 at `72b79d3`; the review says nothing depends on that, and the post-fix gate is recorded below.

## Gate

The command was `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 bash .claude/skills/piv-create-pr/scripts/record-gate.sh --clean`. It ran on the fixed tree (uncommitted, on `26ef638`) and exited 0. The committed source is that same tree. All figures are `observed`:

| | |
|---|---|
| Tasks | 22 successful, 22 total, 0 cached, 1m35.0s |
| @taxi/api | 89 suites, 913 passed (was 908: +3 `driver-ride`, +1 service, +1 integration) |
| @taxi/rider | 37 suites, 231 passed (was 221: +4 screen, +5 hook, +1 switch, in a new suite) |
| @taxi/driver | 46 suites, 341 passed (was 340: +1) |
| @taxi/shared | 300 passed (unchanged) |
| @taxi/dispatch | 278 passed |
| @taxi/db | 17 passed |

The "was" figures are the review's re-observed run at `26ef638`. The deltas are `derived` from the tests listed above.

**Two red runs came before the green one:**
- **Run 1:** `@taxi/api#lint` failed on `{} as never` in my F5 test (`no-unnecessary-type-assertion`). I fixed the test.
- **Run 2:** `@taxi/api#build` failed with `ENOTEMPTY ... rmdir services/api/dist/features/auth`. This was environment, not code. The implementation session's two `nest start --watch` dev servers were still running on ports 3041 and 3042, from 12:56 and 13:00 BST. They rebuilt `dist` on every edit and raced the clean build. I stopped both, and run 3 was green.

## Copy sweep

For each retired value or noun, the `grep -n` below was run over the plan, the implementation report, and the PR body as fetched before this pass.

| Pattern | Hits before the pass | Action |
|---|---|---|
| `296 → 300` | report `:76` | corrected to 291 (F9) |
| `all 9 events` | plan `:399` | kept: this plan step describes the edit from 9 to 10 |
| `first-frame\|first frame` | report `:196`, PR body `:92` | report: marked fixed, with the device re-run owed. PR body: open question replaced by the answer |
| `Open question` | PR body `:92` | replaced |
| `shipped source` | PR body `:60` | rewritten: rider and api source changed after the Level 4 runs (see below) |
| `lastRequestedAt` | plan `:467,482` | `:482` marked superseded by F2; `:467` still true |
| `findAnnounceTarget` | plan `:454` | marked superseded by F5 |
| `payment_changed. notice keeps` | plan `:593` | reworded for F7 |
| gate counts `908`, `221`, `340`, `1m47.5s` | PR body Validation | replaced with this pass's gate |
| `72 files`, `+3460` | PR body | re-derived after the commit |

**The Level 4 runs and the new source:**
- Only comments changed in the driver source (`arrival-announce.ts` docblocks), so T21 and T23 still cover the driver's behaviour.
- T22 (API over curl) exercised only paths the fixes leave as they were, when Redis is healthy.
- T24 ran on rider source that F1 and F3 changed. Its device re-run is owed (see F1).
