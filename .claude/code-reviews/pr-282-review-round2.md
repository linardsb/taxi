# PR #282 review, round 2: request changes

**PR** https://github.com/linardsb/taxi/pull/282 · docs(plans): arrival-announce protocol for blind riders (#259)
**Head** `30adbf4` · **Base** main @ `d6deaa62aec800702e4a6288def4078012a9f4ca`
**Reviewed** 2026-09-24. Plan line numbers are for `.claude/plans/arrival-announce-protocol-259.md` at `30adbf4`. Code citations are for `d6deaa6`, re-read for this round.

## Summary

The fix pass is good work. All 12 round-1 findings are addressed, and two of its departures from round 1's prescribed fixes are right where round 1 was wrong:
- **H1 (round 1)**: round 1 said to drop the driver reducer's `announce` effects. `ActiveRideProvider` wraps the root `Stack` (`apps/driver/src/app/_layout.tsx:25-31`), and nothing closes the ride when `/active-ride` unmounts. So the reducer is the only speaker that works on every screen, and silencing the screen Banners instead is the correct direction. Round 1's fix would have silenced a release heard off `/active-ride`.
- **H2 (round 1)**: keeping the seconds is right. `search-sheet.tsx:98-99` promises them.

One round-1 fix is itself the defect this round: **round 1's M1 prescribed `router.replace('/')` for the announce tap, and that route strands a warm driver on `/home` at `arrived`** (H1 below). Round 1 checked the cold start only. The fix pass implemented what it was told to.

**Counts**: Critical 0 · High 1 · Medium 1 · Low 6.

## High

**H1. The announce push tap sends a driver who is waiting at `arrived` to `/home`, and nothing routes back.**
- **Plan**: T14 `:647` has `onTap` dispatch and then "fall through to the existing `router.replace('/')`, the gate". T14 VALIDATE `:657` asserts `replace('/')` and "never `navigate('/active-ride')`", so the test locks the defect in.
- **Mechanism**, at `d6deaa6`:
  - `/` is `GateScreen` (`app/index.tsx:1`). The gate redirects at once from the cached `me.activeRideId` (`onboarding/gate-screen.tsx:22-27,46-53`). It does not re-read `/me`.
  - `useMe` loads `/me` once per sign-in (`onboarding/use-me.tsx:75-91`). It re-reads only after a profile or vehicle write, on the gate's Retry, or on presence's foreground refetch (`availability/use-presence.tsx:286-302`), which is async and lands after the gate has already redirected.
  - Accepting an offer never touches `me`: `offers/use-offers.tsx:135-137` calls `open` and `router.replace('/active-ride')`.
  - So for any ride accepted in this session, `me.activeRideId` is `null`. `nextRoute` returns `/home` (`onboarding-state.ts:18-19`).
  - The only routes into `/active-ride` are the offer accept, the force-assign `route_ride` effect (`active-ride-state.ts:409`) and the gate (`grep -rn "active-ride'" apps/driver/src`, excluding tests). `/home` has none. `push-registrar.tsx:41-44` already names this trap: "a screen with no active-ride affordance and nothing routing back short of a relaunch".
- **This is the normal case.** T14 keeps the push quiet while the app is active, so every announce tap brings the app back from the background with the `me` cache from sign-in. The driver hears the notice from T12's reducer, but is on `/home`. They cannot see the Banner or reach «Sākt braucienu» without relaunching.
- **Worse variant.** A driver who cold-started during ride A and then accepted ride B has `me.activeRideId = A`. The tap runs the gate's `open(A)`. That is the different-ride `opened()` branch (`active-ride-state.ts:191-194`), which drops B from the provider, and the fetch then reports A as completed.
- **The fix report's `:52` is wrong.** It says a warm tap "refetches `/me`" and is accepted because "every non-offer tap already does this". The gate does not refetch, and today no non-offer push is tapped mid-ride.
- **Fix (T14)**: after `announceRequested(rideId, at)`, route on what the provider holds.
  - If the provider's `state.rideId === route.rideId`, call `router.navigate('/active-ride')`. That is safe: `/active-ride` redirects only when `rideId` is null (`active-ride-screen.tsx:77`).
  - Otherwise (a cold start), call `router.replace('/')`. `me` is fresh on a cold start, and the replay leg delivers the notice at `loaded`, as the plan already says.
  - Read the provider state through a ref, so the handler effect's deps (`push-registrar.tsx:58`) stay stable. L1 of round 1 still applies.
  - VALIDATE: split the case. Warm (the mock at `push-registrar.test.tsx:44-49` returns `state: { rideId }` equal to the push's) → `navigate('/active-ride')`. Cold (`rideId: null`) → `replace('/')`. Add a T23 step: background the app at `arrived`, tap the announce notification from the shade, and confirm by `uiautomator dump` that `/active-ride` is showing.
  - Correct T14 `:647` and the fix report's `:52`.
- **What this fix newly permits**: a warm tap for a ride the provider holds but that has already ended lands on `/active-ride`'s ended Banner. That screen is the right one, and the notice is already dropped by T12's `status === 'arrived'` guard.

## Medium

**M1. P6's rule for silencing the error Banner doesn't match the announce that replaces it.**
- **Plan**: T0 P6 `:340`. The Banner is silent "while its error came from a 429", and "each 429 (`:182`, `:231`)" announces once with `err.retryAfterSeconds`.
- **Hole 1: a later error during the cooldown still ticks.** `search-sheet.tsx:281-285` appends the countdown to *any* `error` while `coolingDown`. «Use current location» is disabled only on `busy` (`:290-296`), so `fillFromCurrentLocation` can set `rider.book.location_unavailable` mid-cooldown (`:247-258`). That error did not come from a 429, so under P6 its Banner announces, and its text changes every second. That is round 1's H2 again, by another route. The plan's "offline after a 429" test cannot reach it, because the field does not search while cooling down (`:111`).
- **Hole 2: a 429 with no seconds.** `:182` and `:231` set the cooldown only `if (err?.retryAfterSeconds)`. A 429 whose body fails `apiErrorBodySchema` has no seconds and the code `'generic'` (`auth/api-client.ts:119-127`). If the implementer keys "came from a 429" on `err.status`, that Banner is silent and nothing speaks.
- **Fix (T0 P6)**: one flag, set in the `retryAfterSeconds` branch where the one-off announce is made, and cleared by every `setError`. The Banner is silent and carries the countdown suffix only while the flag is set. Add a test: a 429 with `retryAfterSeconds: 5`, then +1 s, then a location failure. Expect exactly one announce of the location text, and no further calls on later ticks.

## Low

- **L1. AC14 (`:854`) contradicts the new prop.** It says "a new or changed `Banner` text is spoken" in both apps. After T0, a Banner with `announce={false}` is not. Add "unless the caller passes `announce={false}` (T0)".
- **L2. The notice slot is shared.** T12 `:595` puts `'announce_requested'` into the single `notice` slot, overwriting a `payment_changed` notice the driver has not dismissed. The payment pill still shows the method (`active-ride-screen.tsx:161-164`), so this is cosmetic. Say so in T12's GOTCHA, and make the `:599` clear conditional on `notice === 'announce_requested'`, which its wording implies.
- **L3. Back does not always reach `/home`.** T0 `:328` is true for a ride entered through an offer (`/home` → `/offer`, replaced by `/active-ride`). After a cold start the gate's `<Redirect>` replaces `/`, so back leaves the app instead. The conclusion holds either way, because the screen unmounts while the provider lives on. T23 (e3) should say the ride is entered by accepting an offer, or it may not reach `/home`.
- **L4. Path at `:328`.** `app/_layout.tsx:28` is `apps/driver/src/app/_layout.tsx:28`. The line is right.
- **L5. Driver Banner lines at `:319`.** The effect and its guard are at `apps/driver/src/components/Banner.tsx:43-47`, not `:42-46`. The rider's `:52-56` is exact.
- **L6. Sweep table.** The fix report lists plan `:908` as a `grep -n "live region"` hit. `:908` says `live-region`, which that grep does not match. The conclusion is unchanged.

## Fix-mechanism pass (round 1's Highs and Mediums)

| Round-1 finding | New mechanism | What it newly permits | Result |
|---|---|---|---|
| H1 | Screen Banners `announce={false}`; reducer effects carry `method`/`reason` | A Banner rendered with no reducer announce would go silent | **Holds.** Every path that sets `ended` also emits `announce`: `active-ride-state.ts:216,224,230,260,319,350,369,379`. After a reload, terminal state returns only through `loaded`/`load_failed`, both of which announce. P1: `event.ride` is in scope at `:244`, `paymentMethodLabel` is at `receipt.tsx:26-35`, the runner has `tRef` (`use-active-ride.tsx:161`), and the Banner text is the same expression (`active-ride-screen.tsx:146,169`). P3: the Banner uses `reason ?? ''` then `.trim()` (`:108-110`), and `:230` has `reason: null`, so it matches. |
| H2 | 429 Banner silent, one direct announce | A later error inherits or escapes the silence | **Hole**: M1 above. |
| H3 | `send` clears `result` first | Banner unmounts mid-request | **Holds.** null → unmount → mount, and Banner's effect runs on mount. The focus move is `expected` and deferred to T24 (c); I agree with that. |
| M1 | Announce tap → `router.replace('/')` | Warm tap routes from a stale `me` cache | **Defect**: H1 above. Round 1 prescribed this fix. |
| M2 | Clear notice in `step_done` too | Clearing a notice that isn't the announce | Holds, modulo L2. |

Also checked and correct: P7 (every current-id quote failure renders the Banner, `booking-draft.ts:116-124` and `booking-screen.tsx:202-219`; the hook's announce also fired for stale ids that showed no Banner, so dropping it removes a wrong utterance); the same-ride `open` branch keeps `notice` and `lastAnnounceAt` (`active-ride-state.ts:184-190`); `isNewer` string order (`at` is made once by `toISOString()` and never re-serialised).

## Validation

| Check | Result | Provenance |
|---|---|---|
| CI `check` (full gate) at `30adbf4` | pass, `Tasks: 22 successful, 22 total` | `observed`: run 36054733545, job 107818740468, `headSha` 30adbf4 |
| PR body totals (api 863, shared 276, driver 278, rider 176, dispatch 272, db 17) | match the job log line for line | `observed`: grep of that log |
| `audit-diff`, `codeql`, CodeQL, `ready` | pass | `observed`: `gh pr checks 282` |
| PR body "+909 / +87, two files" | 909 and 87 | `observed`: `git diff --numstat origin/main..HEAD` |
| "21 task headings" | 21 | `observed`: `grep -c "^### T"` |
| Fix report's retired-claim sweep | reproduces, except L6 | `observed`: each grep re-run at `30adbf4` |
| Local gate | not run | Plan-only diff; CI ran the gate at this head, and a local run drops the shared test DB under live sessions. |
| Base moved since round 1 | no: `origin/main` = `d6deaa6` = round 1's recorded base | guarantees pass skipped |
| Constraint pass | no frozen-file GOTCHA; the H1 fix keeps AC7 and AC15 true | `grep -in "do not modify\|…\|frozen"` → 0 hits |

## What's good

- The fix pass re-derived every finding against the code before editing, and it rejected two of round 1's prescribed fixes with code evidence. Both rejections are correct.
- T0's caller audit is now a named table with a stated rule for which speaker stays, and it found P7, which round 1 missed.
- Each fix names its own failure mode and a test that pins it. The H3 focus-move risk is labelled `expected`, not claimed.
- Every figure in the PR body reproduces.

## Recommendation

**Request changes.** Fix H1 in T14 (warm tap navigates to `/active-ride` when the provider holds the ride) and M1 in T0 P6, and fold in the Lows. All are plan edits. After that the plan is ready to implement.
