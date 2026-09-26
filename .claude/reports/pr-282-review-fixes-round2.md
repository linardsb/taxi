# PR #282 review fixes, round 2

**Review**: `.claude/code-reviews/pr-282-review-round2.md` on branch `docs/pr-282-review` (request changes, head `30adbf4`, base `d6deaa6`).

**Scope**: plan edits only, in `.claude/plans/arrival-announce-protocol-259.md` (`P` below), plus in-place corrections to the round-1 report. No code changed and no code test ran. The "test" for each finding is a failing-first case the plan now specifies, plus the sweep below.

**Triage**: all 8 fixed in this PR (H1, M1, L1–L6). None deferred, none dismissed. No scope steer came with the review, and every fix is a plan edit.

**Verification before editing** (`observed` 2026-09-26, in `~/taxi-worktrees/wt-259` at `30adbf4`, whose code is `d6deaa6`):
- H1: `GateScreen` redirects from `me` (`gate-screen.tsx:47-53`); `MeProvider` loads `/drivers/me` once per sign-in (`use-me.tsx:75-91`); the offer accept calls `open` then `router.replace('/active-ride')` and never touches `me` (`use-offers.tsx:135-137`); `nextRoute` returns `/home` for a null `activeRideId` (`onboarding-state.ts:18-19`); the only non-test `'/active-ride'` routes are `use-offers.tsx:137`, `use-active-ride.tsx:155` and `onboarding-state.ts:18`. Reproduces.
- M1: `search-sheet.tsx:281-285` appends the countdown to any `error` while `coolingDown`; «Use current location» is disabled only on `busy` (`:295`); `fillFromCurrentLocation` sets `location_unavailable` at `:257`; the cooldown is set only `if (err?.retryAfterSeconds)` (`:182`, `:231`); `api-client.ts:119-127` throws code `'generic'` with no seconds when the body fails `apiErrorBodySchema`. Both holes reproduce.
- L5: driver `Banner.tsx` effect is `:43-47` (`sed -n 38,50p`). L3/L4: `apps/driver/src/app/_layout.tsx:25-31` wraps the `Stack` at `:28` in `ActiveRideProvider`.

## Fixed

| Code | Plan change |
|---|---|
| H1 | T14 `onTap`: after `announceRequested`, **a held ride** (`rideStateRef.current.rideId` truthy) → `router.navigate('/active-ride')`; **none** (cold start) → `router.replace('/')`. The provider state is read through a ref kept current by an effect (the file's `tRef` pattern), so the handler deps stay stable. The "why not" for both routes is stated with the code. VALIDATE split into warm, stale tray entry, cold, and a ref rerender case. T23 (e4) adds the shade-tap step; traceability gains a warm-tap row. |
| M1 | T0 P6: one `rateLimited` flag, set only in the `retryAfterSeconds` branch (with the one direct announce), cleared at every `setError` (`:171,:181,:212,:230,:249,:257`). Banner `announce={!rateLimited}`, suffix only while `rateLimited && coolingDown`. VALIDATE: the "offline after a 429" case, which could not reach the cooldown window, is replaced by 429 → +1 s → location failure (two calls in total, none on later ticks), and a hole-2 case (429 with no seconds → one `generic` announce). |
| L1 | AC14: "unless the caller passes `announce={false}` (T0)". |
| L2 | T12: the clear is conditional on `notice === 'announce_requested'`; a GOTCHA states the shared slot and why it is cosmetic (`active-ride-screen.tsx:161-165`); a VALIDATE case pins that a `payment_changed` notice survives. |
| L3 | T0 `:328` scopes the back-to-`/home` claim to offer-entered rides and says a cold-start ride leaves the app on back. T23 (e3)'s back step enters its ride through an offer. |
| L4 | `app/_layout.tsx:28` → `apps/driver/src/app/_layout.tsx:28`. |
| L5 | driver `Banner.tsx:42-46` → `:43-47`. |
| L6 | Round-1 report's `live region` sweep row: `:908` moved to a note that it says `live-region`, which the grep does not match. |

**Departure from the review's H1 fix**: the review keys on `state.rideId === route.rideId`. The plan keys on "the provider holds any ride". Case the equality test misses: an announce entry for ride A left in the shade (tray entries are never dismissed, `push-registrar.tsx:39-44`) and tapped while the provider holds ride B. Under equality it falls to the gate and becomes the review's own "worse variant". Under "any ride held" it lands on B, and the reducer ignores A's dispatch (`state.ride?.id !== rideId`). Truthiness, not `!== null`, because the existing mock returns `state: {}` (`push-registrar.test.tsx:48`), whose `rideId` is `undefined`.

**Round-1 report corrected in place**: its `:52` (M1 "a warm tap refetches `/me`") is struck through and marked wrong with a pointer here; the `router.navigate('/active-ride')` sweep row is marked superseded; the L6 row as above.

## New failure mode of the High fix (skill step 4)

- **H1**: the fix reads provider state through a ref. A ref never updated after the first render keeps `rideId: null`, so every warm tap goes to the gate again, the defect this fixes. Test (T14 VALIDATE): render with `rideId: null`, rerender with a ride, fire the tap, expect `navigate('/active-ride')`. A single-render mock test would pass without the update effect.
- Residual, stated in T14's GOTCHA and not changed: a warm tap with **no** ride held goes to the gate, whose `me` cache may name an old ride; the gate's fetch then shows it ended. That is the path every non-offer tap takes today.

## Retired-claim sweep

Run in `wt-259` on 2026-09-26 on the final edit. PR body read with `gh pr view 282 --json body` before editing it.

| Command | Hits in the plan | Hits in the PR body |
|---|---|---|
| `grep -n "replace('/')" $P` | 654 (cold branch), 669 (warm: "no `replace`"), 671 (cold case), 765 (cold-start trace row). None claims a warm tap uses it. | 0 |
| `grep -n "never .navigate\|never \`navigate" $P` | 0 | 0 |
| `grep -n "every non-offer tap" $P` | 664 (the accepted residual for a no-ride warm tap). True. | 0 |
| `grep -n "refetch" $P` | 587 (T11 hook refetch, unrelated) | 0 |
| `grep -n "came from a 429" $P` | 0 | 0 |
| `grep -n "offline after a 429\|offline)" $P` | 367 (the sentence saying that case could not reach the window) | 0 |
| `grep -n "through the gate" $P` | 923 (round-1 amendment, now marked superseded) | 0. The round-1 section says "M1 is fixed in T14", true as history; a round-2 section is added |
| `grep -n "Banner.tsx:42" $P` | 204 (`:42-51`, the whole component in the reference list; still correct) | 0 |
| `grep -c "^### T" $P` | 21, unchanged | "21 task headings". Still true. |
| `grep -n "909\|two files" <body>` | — | "two files, +996 … +909 … +87": stale after this commit, re-derived and edited after push |

## Validation

- No local gate. The diff is one plan and two reports, and other sessions share the test DB, which a gate drops. Same call as round 1, which the round-2 reviewer accepted.
- The gate evidence is CI's `check` on the pushed head, named in the PR body. This report does not name the head: its own commit moves it.

## Needs a manual look

- T23 (e4), the shade tap, cannot run on `sakta224` until #14 gives Android an FCM config. T14's unit cases are the evidence until then (`expected` on device).
- T0's back claim stays `derived`; T23 (e3) runs it with an offer-entered ride.

## Deferred

None.
