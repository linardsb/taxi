# PR #284 review fixes, round 1

**Review** `.claude/code-reviews/pr-284-review.md` (on `docs/pr-284-review`, `3eb1ec5`) · approve, four Lows.
**Base of this pass** `4eb9033`. PR open, `wt-260` clean apart from the untracked reference patch, no merge/rebase in progress, no other session with its cwd in `wt-260` (`lsof` on every `claude` pid).

## Triage

| Finding | Call | Why |
|---|---|---|
| F1 (Low) sub-50 m trip prints `0.0 km` beside a large €/km | fix now | Changes what a driver reads on the offer card; one-line guard in this PR's own code |
| F2 (Low) `observed` 727 comment made stale by this PR | fix now | This PR's fixture change made it false |
| F3 (Low) plan T5 still carries 489 | fix now | The plan ships in this PR |
| F4 (Low) PR body calls its own gate run dirty | fix now | The PR body is rewritten for this pass anyway |

Nothing deferred, nothing needs a manual look.

## Fixes

**F1.** `tripLabel` (`apps/driver/src/features/offers/offer-card-props.ts`) guarded only `distanceMeters === 0`. For 1–49 m, `toFixed(1)` prints `0.0` while the rate divides by the real metres. The guard is now `distanceMeters < 50`: 50 m is the first length that prints `0.1 km`. The docblock, plan D5, its reference snippet, the edge-case table and the implementation report now say "under 50 m".
- Tests (`offer-card-props.test.ts`): `it.each([40, 49])` omits the line; 50 m draws `Brauciens ~1 min · 0.1 km · €210.80/km` (`derived`: round(1054 × 1000 / 50) = 21 080 cents).
- Against the unfixed guard, `observed` 2026-09-26: 40 m and 49 m red, `Received: "Brauciens ~1 min · 0.0 km · €263.50/km"` and `"… €215.10/km"`; 50 m green. The 40 m case is the review's own input; the review's `€106.25/km` figure used a 425-cent net, this fixture's net is 1054, so the rate differs, the defect does not.
- Closing command, after the fix: `npx jest src/features/offers/offer-card-props.test.ts -t '#260'` in `apps/driver` → `7 passed` (all seven #260 cases, including the three new ones).

**F2.** `dispatch-notifier.spec.ts` comments: 727 → 739, 1,827 → 1,839, 2,927 → 2,939.
- Re-observed, not copied from the review: `console.log` on `overhead` added temporarily, `npx jest src/features/dispatch/dispatch-notifier.spec.ts -t BYTES` → `OVERHEAD 739` (2026-09-26T14:41Z), file then restored from git (`git checkout --`) before the edit. `derived`: 739 + 1 100 = 1 839 ≤ 2 048; 739 + 2 200 = 2 939 > 2 048, so both assertions keep their meaning.

**F3.** Plan T5 (`:312`) now reads "from 473 to 498 of 500 with the projection inline", matching `ride-row.ts:16`. Amendment added.

**F4.** PR body Validation now cites the clean-tree re-run below and names the untracked patch as the only untracked file; the "dirty tree" line is gone.

## Sweep (retired values and nouns)

Run in `wt-260` against the fixed tree, 2026-09-26:

| Command | Hits |
|---|---|
| `grep -n '727' / '1,827' / '2,927' services/api/src/features/dispatch/dispatch-notifier.spec.ts` | none |
| `grep -n 'zero-length\|=== 0'` plan, implementation report, `offer-card-props.ts` | none |
| `grep -n '489' .claude/plans/offer-card-trip-estimate-260.md` | `:20`, `:28`, `:319`, `:548`, `:554`, `:556`: each names 489 as the unshipped one-function `ride-trip.ts` variant, which is accurate history |
| `grep -n 'driver 284'` implementation report | `:61`, the implementation-time run, now followed by the round-1 re-run (driver 287) |
| PR body: `zero distance`, `284`, `dirty`, `727`, `489` | `:14` zero distance, `:20` dirty, `:31` 284, `:44` dirty: all rewritten in this pass; `:68` 489 is deviation 6's accurate history |

The plan's "Prototype evidence" rows (driver 284) are dated prototype runs, not this branch's figures, and stay.

## Validation

`observed` — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`, after clearing `shared`/`db`/`api` `dist` and `apps/dispatch/.next`, started 2026-09-26T14:42:59Z, exit 0:

| Check | Result |
|---|---|
| Turbo | 22 successful, 22 total, 0 cached, 1m32.494s |
| `@taxi/shared` | 279 passed (29 files) |
| `@taxi/db` | 17 passed (3 files) |
| `@taxi/dispatch` | 272 passed (30 files) |
| `@taxi/driver` | **287** passed (45 suites), was 284: +3 from F1 (two `it.each` cases and the 50 m case) |
| `@taxi/rider` | 176 passed (32 suites) |
| `@taxi/api` | 868 passed, 868 total (87 suites, Redis set, none skipped) |

The first attempt of this run (14:42:07Z) was red on `@taxi/driver#lint` only: prettier formatting in the new test. `prettier --write` on the three touched source files, then the run above. The tree it ran on is `d65e252` apart from two docs files written after it: this report, and the round-1 line appended to `offer-card-trip-estimate-260-report.md:61`.
