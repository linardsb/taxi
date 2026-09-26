# PR #284 review, round 1: approve

**PR** https://github.com/linardsb/taxi/pull/284 · feat: offer card shows trip duration and net €/km (#260)
**Head** `4eb9033` · **Base** main @ `d14759ab969797baeea6fa6a673410d4d4abdea4`
**Reviewed** 2026-09-26, detached at `4eb9033` in a separate worktree. First round, so the guarantees and fix-mechanism passes do not apply. The base is current: `origin/main` is `d14759a`, the same sha as `baseRefOid`.

## Summary

The PR keeps the route's distance and duration that `PricingService.quote` already computed, stores them in two nullable `rides` columns, carries them on `ride:offer` as `trip`, and draws one line on the driver's offer card: trip minutes, km and the driver's net per routed km. The approach is sound and the contract is backwards-compatible in both directions:
- `rideOfferSchema` is a plain (non-`.strict()`) object, so an old driver binary ignores the new key.
- `trip` is `.nullable().default(null)`, so a new binary reading an older api still draws the card, without the line.
- `satisfies RideOffer` in `offer-builder.ts` turns a dropped `trip` into a compile error despite that default.

`RidesRepository.create` is the only shipped `insert(rides)`, its `trip` input is required, and its only caller takes `trip` from `pricing.quote()`. So every ride created from this PR on stores the pair, and it is written once and never updated, which is why `toTrip`'s "both or none" guard cannot meet a half-written pair from shipped code.

No Critical, High or Medium findings. Four Lows, all optional.

## Findings

### Low

**F1 · Low · a trip under 50 m prints "0.0 km" beside a very large €/km** — `apps/driver/src/features/offers/offer-card-props.ts:63`
The guard catches only `distanceMeters === 0`. For 1–49 m, `(d / 1000).toFixed(1)` prints `0.0`, while the rate divides by the real metres. `derived` for a 40 m route with a 425-cent net: `round(425 × 1000 / 40)` = 10 625 cents, so the card reads `Brauciens ~1 min · 0.0 km · €106.25/km`. It is reachable: nothing in `rideRequestSchema` refuses a pickup and destination a few metres apart (a mis-set destination), and the stub rounds straight-line metres × winding factor. AC4 scoped only the zero case, so this is an unruled edge, not a deviation.
Fix: treat `distanceMeters < 50` like zero (the line is omitted), and add a 49 m edge case beside the zero-distance test at `offer-card-props.test.ts:124`.

**F2 · Low · a comment labelled `observed` states a figure this PR made false** — `services/api/src/features/dispatch/dispatch-notifier.spec.ts:167,179,184`
The comments say the empty-address push is `observed` 727 units, and derive `727 + 1,100` and `727 + 2,200` from it. This PR adds `trip: null` to the fixture at `:45`, and the notifier copies the whole offer into the push, so the JSON gains `,"trip":null` (12 B). `observed` at `4eb9033`, with a temporary `console.log` on `overhead` in that test, restored afterwards: **739**. The test still passes because it reads `overhead` at run time (739 + 1 100 = 1 839 ≤ 2 048; 739 + 2 200 = 2 939 > 2 048), so only the prose is wrong. It is still the class of defect CLAUDE.md names: a figure under an `observed` label that no run of the current code produces.
Fix: 727 → 739 in all three comments (1,827 → 1,839; 2,927 → 2,939), or drop the literal and point to the live `overhead`.

**F3 · Low · the plan's T5 text still carries the retired 489 figure** — `.claude/plans/offer-card-trip-estimate-260.md:312`
T5 says the projections "were split out when #260's columns took the repository to 489 of 500". Amendment `:554` and report deviation 6 retire 489 (the unshipped `ride-trip.ts` variant) in favour of 473 → 498, and the shipped docblock (`ride-row.ts:16`) says 473 → 498. The plan ships in this PR and is the next reader's source, so the subject survives there.
Fix: reword `:312` to "473 to 498 of 500 with the projection inline", as `ride-row.ts:16` does.

**F4 · Low · the PR body calls its own gate run dirty, then says no source file was dirty** — PR body, Validation
"(dirty tree — this run covers uncommitted changes `4eb9033` does not contain.)" is followed by "No source file is dirty", the only dirty path being the untracked plan patch. Both can be read as true, but the first sentence claims the run covered code the commit lacks. This review's clean run at `4eb9033` (below) gives the same counts, so the ambiguity no longer matters for the evidence.
Fix: cite this review's clean run, or reword to "untracked plan patch only; no tracked file dirty".

## Numbers pass

Every figure in the PR body and report was checked for provenance:

| Figure | Provenance | Check |
|---|---|---|
| Gate 22/22, shared 279 · db 17 · dispatch 272 · driver 284 · rider 176 · api 868 | `observed` | Reproduced exactly by this review's run (below) |
| `rides.repository.ts` 408, down from 473 | `observed` | `wc -l` at `4eb9033`: 408; `git show origin/main:… \| wc -l`: 473 |
| 498 with the projection inline | `observed` in the plan's prototype 1 (worktree since deleted) | Not re-runnable; labelled as the plan's figure, not this branch's |
| `€0.90/km`: round(1054 × 1000 / 11655) = 90 | `derived` | 1240 − 15% = 1054 net; 1 054 000 / 11 655 = 90.43 → 90 |
| `€1.06/km` at 0% override | `derived` | 1 240 000 / 11 655 = 106.39 → 106 |
| `~18 min` | `derived` | ceil(1049 / 60) = ceil(17.48) = 18 |
| `mint:ride` 7954 m / 716 s | `observed` + `derived` | 7954 / 1000 / 40 × 3600 = 715.86 → 716 |
| Null-trip rides 57 → 57, total 57 → 58 | `observed` (dev DB) | Not re-run; consistent with an additive migration with no default |
| `trip` adds 57 B worst case, 12 B null (plan) | `derived` | `,"trip":{"distanceMeters":999999,"durationSeconds":99999}` = 57 chars; `,"trip":null` = 12 |
| Mutation table | `observed` | Not re-run; each result names a test and an error code that exist at `4eb9033` |

No derived figure sits under an Observed heading. The one stale `observed` figure is F2, which is outside the PR body and report.

## Validation

`observed` — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`, clean tree at `4eb9033` after clearing `shared`/`db`/`api` `dist` and `apps/dispatch/.next`, exit 0:

| Check | Result |
|---|---|
| Turbo | 22 successful, 22 total, 0 cached, 2m27.8s |
| `@taxi/shared` | 279 passed (29 files) |
| `@taxi/db` | 17 passed (3 files) |
| `@taxi/dispatch` | 272 passed (30 files) |
| `@taxi/driver` | 284 passed (45 suites) |
| `@taxi/rider` | 176 passed (32 suites) |
| `@taxi/api` | 868 passed, 868 total (87 suites, Redis set, none skipped) |
| CI on the PR | `check`, `audit-diff`, `codeql`, `CodeQL`, `ready` all pass |

## What is done well

- `satisfies RideOffer` closes the hole that `.default(null)` would otherwise open, and the report's mutation table proves the compile error and three runtime tests go red when `trip` is dropped, and records honestly that the legacy-null test cannot catch it.
- "Both or none" is argued in the column comment, the schema docblock and `toTrip`, and a half-written pair reads as no trip, never a zero that would hide the rate.
- The rate uses the per-driver `split.driverNetCents`, integer cents rounded once before `formatEur`, so a commission override changes the €/km, as the 0% test pins.
- The row-projection move to `ride-row.ts` leaves `rides.repository.ts` at 408, with room for the next ticket, and `ride-row.ts` is imported only inside the rides slice.
- Deviation 5 (force-assign's `trip` reaches no driver) was found and AC3 amended rather than claimed.

## Notes (not findings)

- `packages/shared/src/i18n/lv.ts` is at 495 of 500 lines. The next ticket adding Latvian strings will need to split it.
- The emulator + TalkBack pass was skipped (documented). How TalkBack reads `~` and `/km` in the new line is unverified.
- Owed after merge: the stored-trip criterion on #134 (plan T12 step 4).

## Recommendation

**Approve.** No Critical, High or Medium findings; the gate is green on a clean tree and matches the PR body's counts. F1–F4 are optional; F1 and F2 are the ones worth a small follow-up commit.
