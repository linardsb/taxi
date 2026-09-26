# PR #282 review, round 1: request changes

**PR** https://github.com/linardsb/taxi/pull/282 · docs(plans): arrival-announce protocol for blind riders (#259)
**Head** `6108041` · **Base** main @ `d6deaa62aec800702e4a6288def4078012a9f4ca`
**Reviewed** 2026-09-24. Plan line numbers are for `.claude/plans/arrival-announce-protocol-259.md` at `6108041`. Code citations are for `d6deaa6`.

## Summary

The PR adds one file: the implementation plan for #259. There is no code change, so this reviews the plan as a spec that one implementation pass will execute. The architecture is sound:
- The flag is revealed only after accept, and the data model enforces that.
- One `at` key dedupes the socket, push and replay legs.
- The replay gives Android a delivery path before FCM exists.

The findings are in T0, the "Banner speaks on Android" fix. T0 is right about the rider's `arrived` banner (R11). But it switches on Android speech for **every** Banner in both apps, and its caller audit (plan :317) ends at "which is the intent" without checking the callers. Two callers speak twice or on every tick once T0 lands (H1, H2). Separately, the rider's re-request, the case the friction audit budgets for, gives no spoken confirmation (H3). All the fixes are edits to the plan.

**Counts**: Critical 0 · High 3 · Medium 2 · Low 7.

## High

**H1. T0 extends the driver app's double announcements to Android, and plan :83/:317 say otherwise.**
- The reducer's `announce` effect runs `announceForAccessibility` on both platforms (`use-active-ride.tsx:160-161`, no platform check). After T0 the Banner does too, so each event below speaks twice on TalkBack:
  - `payment_changed`: `active-ride-state.ts:244`, and the Banner at `active-ride-screen.tsx:166-172`
  - `released`: `:224/:260/:319/:369`, and `ended-banner` at `active-ride-screen.tsx:103-113`
  - `cancelled`: `:230/:379`, and `ended-banner`
  - `completed_title` with no split: `:216/:350`, and the Banner at `active-ride-screen.tsx:95-99`
- Plan :83 calls `payment_changed` iOS-only. Plan :317 says the one-announcer rule "already holds on iOS", which is false for the driver app. T23(b) counts utterances only at `arrived`, so the device run cannot catch this.
- **Fix**: in T0, remove the reducer `announce` wherever a Banner renders the same copy. The `completed_title` case keeps its announce only on the Receipt path, which has no Banner. `active-ride-state.test.ts` changes with it. Rewrite :83 and :317 to match, and add a T23 step that counts `TYPE_ANNOUNCEMENT`s on release, cancel and payment change.
- `presence-state.ts:135` («Bezsaistē») plus the `marked_offline` Banner (`home-screen.tsx:73`) is the same pattern with two different texts. Include it in the audit.

**H2. After T0, the rider's rate-limit countdown speaks every second on Android.**
- `features/places/search-sheet.tsx:103` ticks `cooldown` every 1 s. `:281-285` puts it in the error Banner's `text` (`${t(error)} ${t('rider.book.retry_in', { seconds: cooldown })}`).
- Banner's announce effect is keyed on `[text]` (`Banner.tsx:52-56`). So every tick is a new announcement, for the whole `retryAfterSeconds`, on the address screen a blind rider navigates by ear.
- This already happens on iOS. T0 makes it happen on TalkBack too.
- **Fix**: add the caller to T0's audit. The Banner text becomes `t(error)` alone, and the countdown moves to a separate `Text` that does not announce. Add a test: advance fake timers N s and expect exactly one announce.

**H3. A rider who presses the request button again hears nothing.**
- The problem is at plan :512-518. `send` stores `{ forStatus, value }` only when the request settles, and `shown` is derived from that.
- A second successful press stores `'sent'` again. The Banner's `text` is unchanged, so its `[text]` effect does not fire and nothing is spoken. The same happens for two 429s in a row.
- The friction audit (:292, "+1 per re-request") budgets for this exact case, and for this rider the spoken confirmation is the only feedback.
- **Fix**: clear `result` when `send` starts, so the Banner unmounts and mounts again, or key the Banner on a per-send counter. Add to T11: two successes give two announce calls.
- The driver side has a milder form. A second request while the notice is up changes neither `notice` nor the text, so the driver gets the haptic only. Consider `key={lastAnnounceAt}` on the T13 Banner.

## Medium

**M1. Tapping an announce push can strand a cold-started driver on `/home`.**
- Plan :581 has `onTap` call `announceRequested(...)` and then `router.navigate('/active-ride')`.
- On a cold start `state.rideId` is null until the gate opens the ride (`gate-screen.tsx:25-27`). Until then `/active-ride` redirects to `/home` (`active-ride-screen.tsx:77`), and nothing routes back.
- `push-registrar.tsx:32-44` documents this same trap for offers. Every non-offer tap already does `router.replace('/')`, the gate, for this reason.
- **Fix**: for `announce`, dispatch and then `router.replace('/')`, as the other kinds do. The reducer ignores the dispatch while `state.ride?.id !== rideId`, and on a cold start the replay leg delivers the notice at `loaded`.

**M2. The notice survives «Sākt braucienu» on the normal path, not only when the socket is down.**
- T12 (:540) clears `announce_requested` on "a `status` event that leaves `arrived`".
- `step_done` (`active-ride-state.ts:293-303`) moves `ride.status` to `in_progress` itself. Its comment says the `ride:status` that follows "will ... be a no-op". So the socket event arrives when the state is no longer `arrived`, and a "leaves `arrived`" rule never fires.
- Result: «Pasažieris jūs meklē: izkāpiet…» stays on screen while the driver drives, until they dismiss it.
- **Fix**: clear the notice in `step_done` when `to !== 'arrived'`, or render the T13 Banner only while `ride.status === 'arrived'`. Add a reducer test for step_done from `arrived` with the notice up.

## Low

- **L1. T6, T12 and T14 break existing specs that the plan does not list.**
  - `ride-lifecycle.service.spec.ts:183-190` constructs the service with 6 arguments.
  - `driver-ride.spec.ts:106-111` expects `toEqual(base)`, which gains `announceRequestedAt`.
  - The `useActiveRide` mock at `push-registrar.test.tsx:44-49` lacks `announceRequested`.
  - T12 should also require `announceRequested` to be a stable `useCallback`. It joins the handler effect's deps (`push-registrar.tsx:58`), and an unstable one reinstalls the notification handler on every render.
- **L2. The plan still says "Android live region" after T0 removes it.**
  - It does so at :55, :547 and :721. :721 expects a non-announcement subtype, while :724 requires `TYPE_ANNOUNCEMENT`.
  - Align all four on the T0 mechanism.
- **L3. Wrong citation at :318.** In both `Banner.test.tsx` files, `:8` and `:21` are `spyOn` lines. The test at `:6` pins that iOS **does** announce. Only the test at `:19` (asserting at `:30`) pins absence on Android.
- **L4. The lv line figure at :395 is wrong (`derived`, conclusion unchanged).**
  - Prettier's default `printWidth` is 80 (`.prettierrc` sets none).
  - As single lines, 4 of the 6 driver/push entries measure 93, 83, 96 and 95 columns, so they wrap. The two push entries measure 58 and 71.
  - That gives 4×2 + 2×1 = 10 lines, so 394 + 10 = **404**, not 402. Still under 500.
- **L5. The dedupe is `at !== lastAnnounceAt`** (:538-539). A push for an older request that lands after a newer socket event fires the notice and haptic again. Compare with `at > lastAnnounceAt`, which works because `toISOString` strings sort chronologically. Treat `null` as older.
- **L6. T3 (:356) keeps the rule that `RT` stays the first `as const` block** "for" a doc-sync check that `realtime-events.ts:29-31` names. The plan's own GOTCHA (:363) found that no such check exists, and so did this review. T3 should correct the stale comment, not keep a rule for a check that does not run.
- **L7. D2's evidence cites only the socket parse.**
  - The offer's **push** leg (`dispatch-notifier.ts:72-99`, `JSON.stringify(wire)`) is not parsed by `RealtimeService`. It is clean only because `offer-builder.ts:64` builds the offer through `rideOfferSchema.parse`, and the plan never cites that line.
  - T8 checks the socket payload only. Also assert that the `offer` JSON in `ctx.push.sent` lacks `announceArrival`, and cite `offer-builder.ts:64` under D2.

## Validation

| Check | Result | Provenance |
|---|---|---|
| CI `check` (full gate) at `6108041` | pass, 22/22 tasks | `observed`: run 36050502407, job 107804560504 |
| Per-package totals in the PR body (api 863, shared 276, driver 278, rider 176, dispatch 272 tests, db 17) | match the CI log line for line | `observed`: grep of that job's log |
| `audit-diff`, `codeql`, CodeQL, `ready` | pass | `observed`: `gh pr checks 282` |
| Local gate | not run | The diff is one `.md` file, and CI ran the gate at this exact head. A local run would drop the shared test DB under other live sessions. |
| R5 (plan :125): lv split | reproduced: 344 keys, `2a276af52559cb83` before and after; 494 → 394 and 109 lines | `observed`: T1's script run on a scratch copy of `d6deaa6`'s `lv.ts`, hashed with T1's `tsx` one-liner |
| PR body "21 task headings" | 21 | `observed`: `grep -c "^### T"` |
| `googleServicesFile` absent in both apps | 0 matches in each | `observed` |
| Base moved since last round | first round; `origin/main` = `baseRefOid` = `d6deaa6` | guarantees and fix-mechanism passes skipped |

**Numbers pass.**
- The plan labels its figures well. Observed runs are named (R5, R6, R11, R7's build id and 807 s). Derived figures state their condition: the 20 s window "3 a minute" rests on `redis-kv.store.ts` setting the TTL only on first INCR, which the reviewer agent confirmed there and in the harness store. The 20 s and 600 s themselves are marked `expected`.
- The one wrong figure is L4.
- Confidence 9/10 is marked `expected`. The three Highs are unrun-code defects of exactly the kind its stated caveat names.

**Constraint pass.** No fix above conflicts with a plan AC or GOTCHA. H1/H2 widen T0 and support AC9/AC14 ("no added status announcement"; one `TYPE_ANNOUNCEMENT`), which T0 as written would break on the driver's other screens.

## What's good

- **D2 is structural.** The flag exists only on the assigned driver's read, the offer schema has no `request`, and every emit is schema-parsed. T8 checks it on the wire.
- **One idempotence key across three legs**, and the replay gives Android a working path today. The rooms reasoning ("Why the driver room") is right: T8's mutation pairs a red negative with a green positive and says which one pins the room.
- **Risky refactors were run and reverted during planning, with hashes**, and R5 reproduces exactly.
- **R11 is a real defect found by measurement.** The planner discarded two stale-bundle runs instead of reporting them.
- **The GDPR framing (D1) and the CSN p. 172 horn ruling (D5)** are decided with sources, and the reversal cost is stated.
- All other citations the reviewer agent checked are correct: roughly 60 `file:line` references across shared, api and both apps.

## Recommendation

**Request changes.** Fold H1–H3 into T0/T11/T13 (widen T0's caller audit into a named list with fixes, and add the re-request announcement), fix M1/M2 in T12/T14, and correct the Lows in passing. Every fix is a plan edit, and none needs new research. Merging the plan unchanged would have the implementation pass ship a TalkBack regression in the same PR that fixes TalkBack.
