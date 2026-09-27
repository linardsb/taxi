# PR #295 review, round 1 (post-merge): driver live regions replaced by announcements (#279)

**Head** `493df80` · **Base** main @ `43078db` · merged as `f02d255` (2026-09-27 19:22Z) · reviewed 2026-09-27 · first round (no earlier report, so the guarantees pass and the fix-mechanism pass do not apply)

**Verdict: follow-up needed.** The PR is merged, so "request changes" does not apply. There are two Highs and three Mediums:
- F1 is an issue-tracking error: reopen #279.
- F2–F5 go in one follow-up fix PR, with F6 and F7 folded in.

## Summary

The mechanism is right. #259 R11 observed that live regions never reach TalkBack, so switching to `announceForAccessibility` is the correct move. The shared `useAnnounceChange` hook is small and correct:
- It records the last value even while disabled, so re-enabling does not replay a stale value.
- `EarningsCard` announces exactly what it did before. Every transition gives the same result, including spinner → number, number → «—» → number, and number → spinner → number.

What is wrong:
- Merging auto-closed #279, but #279's own acceptance criteria are not met (F1).
- The `pathname === '/home'` gate cannot tell a buried home screen from the top one. The app does stack home screens, because both of its routes back to home use `router.replace` (F2).
- The earnings total still speaks from underneath other screens (F3).
- The vehicle form's error announcements miss a second failed Save (F4), and several at once probably cut each other off on iOS (F5).

## Findings

### High

**F1 · issue #279 · merging closed an issue whose primary acceptance is unmet**

#279's title and acceptance section cover something else. It is about offer countdown ticks («Atlikušas 15 s») being spoken after the offer has expired: observed 19.7 s card read, and ticks spoken at 17:16:08 and 17:16:19 against expiry at 17:16:02. The live-regions work reached #279 as a comment folded in on 2026-09-27 11:52Z. The PR's `Closes #279` closed the whole issue at 19:22:25Z.

On `f02d255`, `apps/driver/src/features/offers/offer-card.tsx:56-65` still has no expiry or staleness guard. Its last change is #284, which did not touch the countdown. The following are therefore all undone and now untracked:
- the countdown acceptance, with its three test cases;
- the TalkBack re-run;
- the D2 checkbox (the earnings link's loading and failed-first-load states).

A blind driver is still told «15 s left» for an offer that is gone.

**Fix:** reopen #279 with a comment that the live-regions part shipped in #295 and the countdown acceptance and D2 re-run remain. Do not open a new issue.

**F2 · `apps/driver/src/features/availability/home-screen.tsx:88`, with `use-offers.tsx:145` and `use-active-ride.tsx:165` · the "only while home is on top" gate is defeated by stacked home screens**

The PR body says the rank "is spoken only while home is the top screen". That holds only while exactly one home screen is mounted.

Both routes back to home call `router.replace('/home')`: `use-offers.tsx:145` on offer expiry or decline, and `use-active-ride.tsx:165` on `route_home`. expo-router's Stack sends `REPLACE` straight to the stock `StackRouter` (`layouts/StackClient.js` overrides only `PUSH`, `NAVIGATE` and `PRELOAD`). That router swaps the top route for a **new** `home` route, so the old home stays in the stack.

- **Stack growth — `observed`** at reducer level, `StackRouter` from expo-router 57.0.17. Sequence: `navigate('offer')`, then `replace('home')`, twice, then an offer → ride → home cycle. Result: `home | home | home | home`.
- **Buried homes stay live — `derived`.** `react-native-screens` 4.26.2 has `ENABLE_FREEZE = false`, and nothing in `apps/driver` calls `enableFreeze`, so buried screens keep rendering and running effects. `usePathname()` is global, so every mounted home passes `'/home'` at once.
- **Consequence — `expected`, not run on a device.** Assuming nothing pops the stack, after N offers or rides that end in `replace('/home')` there are N+1 homes. Each rank change is then spoken N+1 times, and N+1 `useEarnings` pollers run.

The same stacking already doubled `EarningsCard` before this PR. This PR adds the queue rank to it and states a guarantee it does not keep.

The new home test (`home-screen.test.tsx:195-219`) simulates "another screen on top" by changing the global pathname mock. That is the same assumption the gate makes, so the test cannot fail on this.

**Fix:** remove the stacking at its source. Replace both `router.replace('/home')` calls with `router.dismissTo('/home')` (a `POP_TO` action). Reducer check (`observed`, stock `StackRouter`, `POP_TO` home):

| Stack before | Stack after |
|---|---|
| `home \| offer` | `home` (the original key) |
| `home \| active-ride` | `home` (the original key) |
| `active-ride` (cold start into a ride) | one new `home` |

In every case exactly one home remains, and the duplicate pollers go away. Pin it with a test that asserts `dismissTo` rather than `replace` at both call sites.

Gating on focus is the alternative:
- `useIsFocused` is exported by expo-router (`build/exports.d.ts:20`).
- The global `expo-router` mock in `apps/driver/jest.setup.ts:134` would need it added.
- It leaves the stack and the pollers growing, so it is the weaker fix.

### Medium

**F3 · `apps/driver/src/features/availability/earnings-card.tsx:23` and `apps/driver/src/features/earnings/earnings-screen.tsx:15-21` · the earnings total still speaks from underneath other screens**

`QueuePosition` was gated so it would not "talk over the offer countdown or the arrival calls". `EarningsCard` sits in the same hidden home and is not gated. The new `EarningsScreen` doc comment relies on it on purpose.

Scenario: a ride completes, and the next 60 s poll changes the total while `/offer` is on screen. The total is spoken over the offer. On iOS a new announcement interrupts the current one (`expected`).

This predates the PR, but the PR's own reasoning applies to it, and the PR now depends on it.

**Fix:** gate `EarningsCard` the way `QueuePosition` is gated, with `announce={pathname === '/home'}` (safe once F2's fix leaves one home). Give `EarningsScreen` its own `useAnnounceChange(today === NO_EARNINGS ? null : today)`. Each screen then speaks what it shows, and F6's comment caveats go away.

**F4 · `apps/driver/src/features/onboarding/vehicle-screen.tsx:65-88` with `apps/driver/src/components/TextField.tsx:36` · a second failed Save is silent**

`validate()` sets the same `t('driver.error.invalid_field')` string again in the same state update. No `TextField` gets a changed `error` prop, so the hook stays silent.

Example: the driver fixes the plate but leaves the year wrong, then taps Save. The plate error clears, which is not announced, and the year error is unchanged, so nothing is spoken. The driver has pressed a button and heard no response.

Evidence, `derived` from code: `TextField.test.tsx`'s own expected case pins that a repeated identical error is not re-announced. Login and verify are not affected, because each clears its error with `setError(null)` across an `await`.

**Fix:** see F5. One announcement per failed Save, made by the screen, covers both findings.

**F5 · `apps/driver/src/components/TextField.tsx:24-25, :36` · several field errors at once probably cut each other off on iOS (`expected`)**

When make, model and year fail together, three `announceForAccessibility` calls fire in the same commit. On iOS each new announcement interrupts the previous one, so VoiceOver probably speaks only the last field. That undercuts the docstring's reason for the label prefix ("the label says which"). The PR body already lists this ordering as unobserved on both platforms, so this finding only states what follows from it.

**Fix:** in forms, have the screen make one combined announcement per failed Save, naming the failing labels. Let `TextField` announce on its own only when used alone, for example through an opt-out prop that forms set.

### Low

**F6 · `apps/driver/src/features/earnings/earnings-screen.tsx:17-20` · two claims in the new doc comment are off**

- "offline a change here is not spoken at all" is contradicted by `use-earnings.ts:42-44`: home also refreshes whenever the app returns to the foreground, online or not.
- "the spoken total can trail this screen's by up to 60 s" gives one direction only. The two timers are independent, so home can also fetch first. It then speaks a total this screen does not show yet, for up to 60 s. This is `derived`, on the same two-timer assumption as the original claim.

The PR body repeats both claims. If F3's fix lands, delete the paragraph.

**F7 · `apps/driver/src/features/offers/queue-position.tsx:10` · the docblock says `QueuePosition` renders "beside the offer card"**

The only caller is `home-screen.tsx:86`. The sentence predates the PR, but it sits in the docblock the PR rewrote.

## Numbers pass

| Figure (PR body) | Provenance check |
|---|---|
| Gate `22 successful, 22 total` at `493df80` | Confirmed: the CI `check` job log for that run shows `Tasks: 22 successful, 22 total`. |
| `@taxi/driver` 46 suites, 348 tests | Reproduced: my `--filter=@taxi/driver...` run on `f02d255` shows the same. |
| Mutation check `1 failed, 8 passed, 9 total`, then `9 passed` | Reproduced exactly on `f02d255`. It proves the pathname gate is wired, not that it is sufficient (F2). |
| `11 files changed, 219 insertions(+), 53 deletions(-)` | Matches the PR metadata. |
| "up to 60 s" trail | `derived` and labelled as such; it gives one direction only (F6). |
| "nothing in production calls `DispatchQueueStore.leave()`" | Holds: grep of `services/api/src` finds only the two store implementations, the interface, and comments. |

## Validation

| Check | Result |
|---|---|
| CI on `f02d255` (main, post-merge) | success (`observed`, `gh run list --branch main`) |
| Merged tree vs gated head | `git diff 493df80 f02d255` is empty, so the tree is byte-identical to what CI gated (`observed`) |
| `pnpm turbo run typecheck lint test build --force --filter=@taxi/driver...` on `f02d255` | `Tasks: 7 successful, 7 total`; driver `Test Suites: 46 passed`, `Tests: 348 passed` (`observed`). This is driver-scoped, not the full gate: the PR touches only `apps/driver`. |

## What is good

- **The mechanism choice follows evidence.** The hook's docstring cites the #259 R11 run that justifies it.
- **The extraction fits the codebase's structure.** One hook with three callers across two slices moved into `@/components`, and the deep import is gone.
- **The tests assert exact `mock.calls` arrays,** so a duplicate or replayed announcement fails them. Each suite has an expected, an edge and a failure case, and each asserts the live region is gone.
- **The PR body labels its own figures honestly.** Everything about speech is marked `derived`, and "Unobserved orderings" names F5's risk in advance.
- **The Earnings screen scope cut is argued in the open,** not buried.

## Recommendation

1. **Reopen #279** with a comment separating what #295 shipped from what remains: the countdown acceptance and the D2 re-run.
2. **Open one follow-up fix PR** covering:
   - F2: `dismissTo('/home')` at both call sites, plus a test;
   - F3: gate `EarningsCard`, and give `EarningsScreen` its own announcer;
   - F4 and F5: one announcement per failed Save from the form;
   - F6 and F7: comment fixes.
3. Device ear-checks stay owed on #279's TalkBack re-run.
