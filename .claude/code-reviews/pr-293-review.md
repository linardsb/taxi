# PR #293 review, round 1: arrival-announce protocol (#259)

**Head** `26ef638` · **Base** main @ `2718f39` · reviewed 2026-09-27 · first round (no earlier report, so the guarantees pass and the fix-mechanism pass do not apply)

**Verdict: request changes.** One High and two Mediums, all small, and all belong in this PR. The approach is sound, and the gate is green. The High is the PR's own open question: answer it here, not on #16.

## Summary

The backend is careful:
- the check order (404 owner, 409 not requested, 409 not arrived, then the INCR) is pinned by tests that were first run against mutated code;
- the event goes only to `driver:<id>`;
- one `at` is minted and reused by the socket, the push and the replay.

The driver reducer's dedupe (`isNewer(at)`) and the T0 speaker choice (the app-wide reducer effect speaks, the screen Banner stays silent) both hold up on reading, and T23 observed them on the emulator.

What is wrong:
- T0 makes the rider's status screen speak two false states on Android at every open (F1).
- Every driver ride read now fails when Redis fails (F2).
- The new switch component has no visible focus state (F3).

## Findings

### High

**F1 · `apps/rider/src/features/ride-status/status-screen.tsx:151` and `:167-169` · a blind Android rider hears two false states each time they open the status screen**

Before this PR, Android spoke none of the status screen's Banners. After T0, it speaks all of them, including the two that mount on the first frame before any data has arrived:
- `status-line`: `status` is `null` until the first read, so the line reads «Meklējam auto…» even when the car is already at `arrived`.
- `reconnecting`: `useRideStatus` starts with `connected: false, joined: false` (`use-ride-status.tsx:121`), so «Atjaunojam savienojumu…» mounts and speaks before the first join, when there has been no link to lose.

**Evidence:** `observed` by the author in T24 on `sakta224`. Opening `/book/status` at `arrived` spoke «Meklējam auto…», then «Atjaunojam savienojumu…», then «Auto ir klāt», all as `TYPE_ANNOUNCEMENT`. The code path above is deterministic, so this happens on every open, not only on that run.

**Why High and not Medium:** it is a false spoken status on the main booking flow, heard by exactly the riders this feature is for, at the moment they are standing at the kerb. iOS already spoke these, so this is old iOS debt too, but T0 is what brings it to Android, and the fix is small.

**Fix:**
- `status-line`: `announce={status !== null}`. Banner's effect is keyed on `[text, announce]`, so the first real status speaks once: the text changes and `announce` flips together.
- `reconnecting`: `announce={joinedOnce}`. `joinedOnce` is a hook flag set on the first `joined: true` and never cleared, so only a drop after a live link speaks.
- Tests: opening at `arrived` announces only the arrival line; a disconnect after a join announces the reconnecting copy once.

### Medium

**F2 · `services/api/src/features/rides/lifecycle/driver-ride.ts:118-121` · a Redis failure now 500s the driver's ride read at every status**

`readDriverRide` awaits `deps.announce.lastRequestedAt(rideId)` (a KV `GET`) on every driver `GET /rides/:rideId`, with no catch. Before this PR that read touched only Postgres; `joinRideRoom` is the one best-effort step there, and it is wrapped (`:94-104`). Neither JWT guard uses the KV store (`grep -rl KV_STORE services/api/src`), so this is a new dependency on the read. The app calls it on every socket `connect` and every foreground. `toDriverRide` throws the value away anyway except at `arrived` (`:42`).

**Evidence:** `observed`. I ran a throwaway spec in the PR's worktree: a ride at `accepted`, and a `lastRequestedAt` that rejects with `redis down`. `readDriverRide` rejected with `redis down` (1 passed, `expect(...).rejects`). The spec was deleted afterwards. The gate cannot see this, because the test setup swaps in `InMemoryKeyValueStore`.

**Fix:** read the KV only when `found.ride.status === 'arrived'`, and catch errors to `null` with a warn line (e.g. `ride.read.announce_replay_failed`). Add a unit case where `lastRequestedAt` rejects and the read still resolves, with `announceRequestedAt: null`.

**F3 · `apps/rider/src/features/booking/preference-switch.tsx:36-45` · no visible focus state on either `/book` switch**

The root CLAUDE.md requires a visible focus state on every interactive element. `PreferenceSwitch` is new in this PR and now drives two rows (the pickup PIN and «Šoferis pieteiksies balsī»), but its `Pressable` has no focused style. A keyboard, switch-access or D-pad user sees nothing when focus lands on either row. The gap came from #258's PIN row (`git show origin/main:apps/rider/src/features/booking/booking-screen.tsx` has no `onFocus`). The plan's "Touch targets & focus" section (plan line 290) does not mention a focus state, so this is an undocumented divergence, not a documented deviation. `NameRow`, the row just below, has the pattern (`profile/name-row.tsx:18,27,47`).

**Fix:** copy `NameRow`: `useState` focused, `onFocus`/`onBlur`, and `outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 2` (no layout shift). Add a test that the style is applied on focus.

### Low

**F4 · `services/api/src/features/rides/lifecycle/arrival-announce.service.ts:97-101` · a failed replay write spends the window and reaches no one.** `setWithTtl` runs after the INCR and outside any try. If it throws, the rider gets a 500, the socket emit and the push never run, and a retry within 20 s gets 429. That breaks the docblock's promise that "only an accepted request spends the window". **Evidence:** `observed` with a throwaway spec in which `setWithTtl` rejects once: the request rejects, `emitToDriver` and `sendPush` are never called, and an immediate retry is 429 (1 passed; the spec was deleted afterwards). **Fix:** wrap the SET as the emit is wrapped (warn `ride.arrival_announce.replay_write_failed`) and carry on to the live legs.

**F5 · `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts:84` · the whole request is parsed before the ownership check.** `findAnnounceTarget` runs `rideRequestSchema.parse(request)` before the service compares `riderId` (`arrival-announce.service.ts:61`). A stored request that no longer parses answers any rider with a 500 instead of the 404, which breaks the 404 parity. This needs a legacy row plus the ride's uuid, so the risk is small. **Evidence:** read, not run (no such row exists to run against). **Fix:** return `riderId` and the raw `request`, check the owner, then parse; or parse `request.options` alone.

**F6 · `services/api/src/features/rides/lifecycle/driver-ride.ts:42` with `packages/shared/src/ride-state-machine.ts:148-150` · the replay is gated on status, not on the current driver.** It is safe today: a request needs `arrived`, and `arrived` has no release edge. The state-machine comment lists what a future release edge must reset (`pickup_pin_failures`), but not `rides:announce:*`. If someone adds that edge, the new driver inherits the old driver's replay for up to 600 s, and the old rate window with it. **Fix:** add both keys to that comment.

**F7 · `apps/driver/src/features/active-ride/arrival-announce.ts:66` and `:81-86` · the announce notice overwrites an undismissed `payment_changed` notice.** `announceNotice` sets `notice: 'announce_requested'` whatever the current notice is. `clearStaleAnnounce` then sets it to `null` when the ride leaves `arrived`. The payment warning disappears although the driver never dismissed it. That contradicts the docblock's "A `payment_changed` notice keeps its own lifetime". It is minor: the payment pill always shows the operative method, and the change was spoken once. **Evidence:** read, not run. **Fix:** give the announce notice its own state field, or correct the docblock. Add a reducer case for the sequence either way.

**F8 · `packages/shared/src/realtime-events.ts:22` · a stale count.** The docblock still says "all 9 events". The catalog, its test (`tests/realtime-events.test.ts:579`) and `realtime-events.md` all say 10. This PR edited the same docblock (the doc-sync paragraph) and left the 9 as it was. **Fix:** 9 → 10.

**F9 · `.claude/reports/arrival-announce-protocol-259-report.md` "Tests added" · the shared baseline is wrong.** The report says shared went 296 → 300. The base is 291: `observed` in the PR #290 round-1 review at `main`'s previous head, and #292 is docs-only. The diff adds 9 new `it` blocks and renames 1 (`git diff origin/main -- packages/shared/tests`), and 291 + 9 = 300 (`derived`). The 300 is right; only the starting figure is wrong. The report's gate section also quotes run 2 at `72b79d3`, while the PR body quotes `26ef638`. The source is the same at both (`git diff --stat 72b79d3 26ef638` touches only the plan and the report), and my run reproduced the counts, so nothing depends on it.

## Answer to the PR's open question

Fix it here (F1). It is a regression T0 brings to Android, on the flow this ticket exists for, and the fix is two props, a hook flag and two tests. A follow-up on #16 would leave Android riders hearing «Atjaunojam savienojumu…» at every open until it lands.

## Numbers pass

| Figure | Where | Verdict |
|---|---|---|
| Gate 22/22 at `26ef638`, 1m47.5s, counts dispatch 278 · driver 340 · rider 221 · db 17 · shared 300 · api 908 | PR body | `observed`, and re-observed: `.claude/last-gate.json` in the PR worktree records it at `26ef638`, `dirty: false`. My run reproduced every count (below) |
| 72 files, +3460 / −252 | PR body | `observed`, and re-observed with `git diff --stat origin/main..HEAD` |
| 13 keys in each language | PR body | re-counted: EN 13; LV 6 (`lv.ts`) + 7 (`lv-rider.ts`) = 13; RU 13 |
| 9 → 10 events | PR body | matches `RT` and the catalog test (F8 is the one stale docblock) |
| `active-ride-state.ts` 488, `booking-screen.tsx` 296 → 270, i18n line counts | report | re-observed with `wc -l`, all equal |
| "`git diff --stat 748d3b9 26ef638` touches only the plan and the report" | PR body | re-observed. Also: source is unchanged from `72b79d3` (12:57 BST) onwards, so T24 (13:02–13:05 BST, Metro) and T21 (EAS from `748d3b9`) both ran on the shipped source |
| T21 909.5 s | report | `derived`, and labelled that way; 12:00:17.9 → 12:15:27.4 = 909.5 s ✅ |
| Two added lines matching `blind`, neither a contract, log or copy string | report | re-observed ✅ |
| Shared 296 → 300 | report | wrong base (F9) |
| "No check reads `realtime-events.md`" (docblock rewrite) | diff | confirmed: only the hand-listed catalog test names the file, in a comment; no script or workflow reads it |

## Validation

`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force`, from cleared `dist` and `apps/dispatch/.next`, at `26ef638` (run in the PR's own worktree, which was clean at that head). Exit 0. `observed`:

| Package | Result |
|---|---|
| Tasks | 22 successful, 22 total · 1m48.418s |
| @taxi/api | 908 passed |
| @taxi/shared | 300 passed |
| @taxi/dispatch | 278 passed |
| @taxi/driver | 340 passed |
| @taxi/rider | 221 passed |
| @taxi/db | 17 passed |

CI on the PR: `check`, `audit-diff`, `codeql`, `CodeQL`, `ready` all pass.

## What is done well

- **Check order, tested against broken code first.** The INCR-before-status mutation turns the "off `arrived` leaves the window unspent" case red, and 404 parity plus the driver-token 403 are pinned end to end.
- **Only the assigned driver hears it.** `emitToDriver`, not the ride room. The integration spec asserts that driver B and the rider receive nothing for 500 ms, and the `emitToRide` mutation turns it red.
- **The offer-hides-the-flag check cannot pass on an empty push.** It asserts `data.offer` exists before asserting the flag is absent.
- **One dedupe rule for three delivery routes.** The socket event, the push and the replay all carry the same `at`, and `announceNotice` is the one place that turns them into one buzz and one spoken line. `opened()` and `assigned` reset `lastAnnounceAt`, so a new ride starts clean.
- **T0's speaker rule was checked on a device.** Hardware back to `/home`, then a release, was spoken exactly once (T23 e3).

## Recommendation

**Request changes:** F1, F2 and F3 before merge. F4–F9 are small and sit in the same files, so fold them into the same fix pass rather than filing issues. Next: `piv-fix-review-findings` on this report, then the gate.
