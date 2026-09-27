# PR #296 review, round 1: docs(reviews): PR #295 round 1 (post-merge)

**Head** `6bf8133` · **Base** main @ `f02d255` · reviewed 2026-09-27 · first round (no earlier report, so the guarantees pass and the fix-mechanism pass do not apply)

**Verdict: request changes.** Two Highs, no Mediums, three Lows.
- F1 is infrastructure and is not caused by this diff: the `ready` check is red on a bad token, so the PR cannot leave draft.
- F2 is in the report itself: its F2 names two of the routes that stack home screens, and at least two more exist. The fix it prescribes would pass its own test and still leave homes stacking.

## Summary

The PR lands one file, `.claude/code-reviews/pr-295-review.md`, the post-merge review of #295. I checked every citation and figure in it against `f02d255`. Almost all of it holds:
- Every `file:line` citation points at the code it describes.
- The library mechanism behind its F2 is right. expo-router's stack sends `REPLACE` to its vendored `StackRouter`, which swaps the top route for a new one. `react-native-screens` 4.26.2 has `ENABLE_FREEZE = false`, which means buried screens keep running.
- Its numbers pass is correct.

The problem is scope. The report says "both routes back to home call `router.replace('/home')`", and its fix changes those two call sites. There are more.

## Findings

### High

**F1 · CI `ready` job · `PR_READY_TOKEN` is rejected, so this PR stays a draft**

`ready` (run 36344672253, job 108691875128) fails at its first step. The `gh pr view` call gets `HTTP 401: Bad credentials`. `check`, `audit-diff` and `codeql` are green on this head, so the diff is not the cause.

Timeline (`observed`):
- The last `ready` that worked was #295's run 36332522523, on `493df80`. Its `check` job finished at 16:18:34Z.
- This run failed at 19:34:38Z.
- `gh secret list` shows the secret was last set 2026-09-10T12:21:21Z.

The token has expired or been revoked. From here I cannot tell which. Every PR opened after it failed will stay a draft, including the PR that lands this report.

**Fix (Linards):** regenerate the PAT, run `gh secret set PR_READY_TOKEN`, then re-run the failed `ready` job. A re-run with the current secret fails again. The job's head check still passes on a re-run, because this PR's head has not moved.

**F2 · `.claude/code-reviews/pr-295-review.md`, its F2 and Recommendation 2 · the report names two stacking routes, there are at least four, and the prescribed fix leaves the others**

The report says "Both routes back to home call `router.replace('/home')`", and it then prescribes three things:
- `dismissTo('/home')` "at both call sites";
- a test that asserts it "at both call sites";
- "In every case exactly one home remains."

On `f02d255`, these also land on home.

| Path | Source | Stacks? |
|---|---|---|
| Home → "Add vehicle" → vehicle → documents → Done | `home-screen.tsx:54` push, `vehicle-screen.tsx:101` `replace('/onboarding/documents')`, `onboarding/documents-screen.tsx:23` `router.replace('/home')` | **yes**, `home \| home` (`observed`, reducer) |
| A push-notification tap with no ride and no card | `push-registrar.tsx:53` and `:72`: `router.replace('/')`. The gate (`app/index.tsx` → `GateScreen`) then renders `<Redirect href={nextRoute(…)}>` (`gate-screen.tsx:47`), which resolves to `/home` for an onboarded driver | **yes**, `home \| home` from `home \| earnings` (`observed`, reducer) |
| `/offer` or `/active-ride` rendered with nothing held | `offer-screen.tsx:16` and `active-ride-screen.tsx:84`: `<Redirect href="/home" />` | `home \| home` if reached (`observed`, reducer, from `home \| offer`). Whether the app reaches it is `derived`: both redirects are conditional |

Reducer check (`observed`): run with node against `node_modules/expo-router/build/react-navigation/routers/StackRouter.js` from expo-router 57.0.17 (the lockfile's version), with the driver's flat root-stack route names from `apps/driver/src/app/`.

| Sequence | `REPLACE` (today) | `POP_TO` (the report's fix) |
|---|---|---|
| `home` → PUSH `onboarding/vehicle` → REPLACE `onboarding/documents` → home | `home \| home` | `home` (original key) |
| `home \| earnings` → REPLACE `index` → home | `home \| home` | `home` (original key) |
| `home \| offer` → home | `home \| home` | `home` (original key) |
| Control: `login \| verify` → REPLACE `index` → home | `login \| home` | `login \| home` |

`POP_TO` works on every path, but only if every path uses it. Two of the extra paths go through `<Redirect>`, which is expo-router's own component. It calls `router.replace` internally, from a focus effect (`build/link/Redirect.js:34-37`). Changing the call sites the report names does not reach those paths. The gate's redirect and the two conditional screen redirects would have to be swapped for a `dismissTo` of their own.

The prescribed test would also pass while stacking continues. It pins the two named call sites, not the stack. It also needs `dismissTo` added to `mockRouter` in `apps/driver/jest.setup.ts:128-133`. The report mentions extending that mock only for `useIsFocused`.

This finding is High because the follow-up PR will be built from the report. That PR could do exactly what the report says, pass its own test, and repeat #295's mistake: stating that home is the only top screen when it is not.

**Fix:** amend the report's F2 before merge.
- List all the paths in the table above.
- Drop "both" and "exactly one home remains", or limit them to the routes they cover.
- Reassess the focus-gate alternative. The report calls it the weaker fix because it leaves the pollers growing. It is also the only one of the two that does not depend on finding every route to home.
- Amend the matching bullet in Recommendation 2.

### Low

**F3 · the report's F3 fix · `EarningsCard` has no `announce` prop**

The fix says to gate `EarningsCard` "the way `QueuePosition` is gated, with `announce={pathname === '/home'}`". `EarningsCard` takes `({ body }: { body: string | null })` (`earnings-card.tsx`), so the fix has to add the prop and pass it to `useAnnounceChange` as its second argument. The comment at `earnings-screen.test.tsx:117` relies on the ungated card as well, and would need changing. Name both in the fix.

**F4 · the report's F4 · the silent second Save applies to client-side validation only**

The finding is right as far as it goes. Server-side errors are re-announced, because a passing `validate()` calls `setErrors({})` (`vehicle-screen.tsx:76`) before the save's `await` (`:97`, `:100`). The finding should say that its scope is client-side validation, so the fix does not re-engineer a path that already works.

**F5 · the report's F1 and Recommendation 1 · the reopen has already happened**

Issue 279 was reopened at 19:44:23Z (`observed`, issue timeline). The reopen comment names exactly the remainder this report lists: the countdown acceptance with its three test cases, the TalkBack re-run, and D2's two states. The report still reads "Reopen #279" as an open action, so once merged it will describe something already done. Add one line recording the reopen.

## Numbers pass

Every figure in the report, and which run backs it:

| Figure | Check |
|---|---|
| #295 merged as `f02d255` at 19:22Z | `observed`: `gh pr view 295` → `mergedAt 2026-09-27T19:22:23Z` |
| Issue 279 closed at 19:22:25Z | `observed`: the issue timeline `closed` event is `2026-09-27T19:22:25Z` |
| #279 comment folded in at 11:52Z | `observed`: comment `createdAt 2026-09-27T11:52:47Z` |
| `22 successful, 22 total` at `493df80` | `observed`: run 36332522523's log has `Tasks: 22 successful, 22 total` |
| `46` suites, `348` tests | Matches #295's body and the CI run on the same tree. I did not re-run it this round |
| Mutation check `1 failed, 8 passed, 9 total`, then `9 passed` | Not re-run this round. The report says it reproduced this |
| `11 files changed, 219 insertions(+), 53 deletions(-)` | `observed`: `gh pr view 295` → `changedFiles 11, additions 219, deletions 53` |
| `git diff 493df80 f02d255` empty | `observed`: empty. `43078db..f02d255` is the single squash commit |
| Stack growth `home \| home \| home \| home` | Mechanism re-derived from the vendored `StackRouter` `REPLACE` branch. My own sequences (F2) reproduce stacking |
| `ENABLE_FREEZE = false`, `useIsFocused` at `build/exports.d.ts:20` | `observed` in the npm tarballs for react-native-screens 4.26.2 (`src/core.ts:26`) and expo-router 57.0.17 |
| "up to 60 s" and the offline claim | The report's F6 is correct. `use-earnings.ts:42-44` refreshes on foreground whether the driver is online or not |

## Validation

| Check | Result |
|---|---|
| CI `check` on `6bf8133` | success (`observed`, run 36344672253) |
| CI `audit-diff`, `codeql`, CodeQL | success (`observed`) |
| CI `ready` | **failure**, HTTP 401 (F1) |
| Local gate | Not run. The diff is one Markdown file under `.claude/code-reviews/`, which no typecheck, lint, test or build task reads. CI's `check` is the gate for this head |
| Citations in the landed report | All `file:line` references checked against `f02d255` (code-reviewer agent, read-only). All confirmed |

## What is good

- **Its central F2 mechanism is right, and it is shown at reducer level** rather than asserted. That made it possible to extend the finding in one step.
- **Its F1 is right**, and the reopen it asked for has already been done with a precise comment.
- **It labels its own provenance.** The stacking is `observed`, the buried-screen liveness is `derived` and the device consequence is `expected`, each stated separately.
- **It keeps the follow-up to one PR**, with no new issues.

## Recommendation

1. **F1:** Linards rotates `PR_READY_TOKEN`, then re-runs `ready` on this PR and on any other PR opened since.
2. **F2:** amend the landed report's F2 and Recommendation 2 to cover every route to home, then push. F3–F5 are one-line edits to the same file and can go in the same commit.
3. Merge after `ready` is green.
