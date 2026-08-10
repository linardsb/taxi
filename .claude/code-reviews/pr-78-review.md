# PR #78 Review — fix(api): close the double-assignment hole at both ends (#61)

**Verdict: APPROVE** · 0 Critical · 0 High · 0 Medium · 1 Low
**Reviewed by**: fresh-context `code-reviewer` agent over the full PR tree (isolated worktree at head `9978321`), plus independent validation. Documented deviations in `.claude/reports/api-dispatch-close-double-assignment-report.md` honored as intentional.

## Summary

Both guards land on the durable truth and hold against every race the reviewer could construct except the one the PR explicitly documents and defers (the ms-wide accept-time seam, in KNOWN GAPS with sign-off). Verified specifically:

- **Guard A** (presence gate): the rides-table check is genuinely inside the UPDATE's WHERE; the only production writers of `drivers.status = 'online'` are `setOnlineIfEligible` and the lifecycle-owned `releaseFromRide` — no bypass path exists. The `hasActiveRide` follow-up read can only mislabel the 409, never produce a wrong write.
- **`ACTIVE_DRIVER_RIDE_STATUSES` boundaries**: `complete()` and every post-acceptance cancel release the driver in-transaction, so `completed`/cancelled statuses are correctly outside the set; the shared test pins the set to a *derivation* from the machine, and no twin list exists in the api.
- **Guard B** (one live card): `findDriverIdsWithLiveOffers`'s predicate exactly matches `acceptOffer`'s — a card counted busy is precisely a card still acceptable. No starvation (a skip burns no attempt; the ride stays `requested`; unclaimed alert is deduped) and the geozone-queue path degrades correctly (busy head skipped without demotion).
- **Tests**: chain B's test fails with the fix removed (verified during implementation); chain A's e2e test replays the issue's five-step chain over real HTTP; the AC #2 revoke statement restores the mode-switch proof; phone namespaces collide with nothing; the rides-spec `LIKE '+371240%'` cleanup cannot touch another file's rows.

## Issues by severity

### Low

1. **Tripwire comment overstates its signal** — `services/api/src/features/dispatch/index.ts:32-33` (paired comment `dispatch.service.ts:238-243`).
   KNOWN GAPS presents `dispatch.assign.driver_not_claimed` as the seam tripwire, but the warn also fires on the now-benign chain-A path (driver `offline` at accept after a mid-offer disconnect) — the PR's own chain-A e2e test drives exactly that firing. An operator can't tell the benign cause from the double-commit cause from the log line alone.
   **Fix (either, one line)**: qualify the KNOWN GAPS bullet ("fires benignly on a mid-offer-disconnect accept too"), or add the driver's current status to the warn payload so `offline` (ordinary) and `on_ride` (double-commit) are distinguishable. Advisory — fine to fix in this PR or as a follow-up.

## Validation

| Check | Result |
|---|---|
| turbo typecheck + lint + build (17 tasks, isolated worktree) | ✅ pass |
| `@taxi/shared` tests | ✅ 127 pass |
| `@taxi/db` tests | ✅ 17 pass |
| `@taxi/api` jest, `REDIS_TEST_URL` set (Redis suites on) | ✅ 48 suites / 382 tests pass |
| Full gate `pnpm turbo run typecheck lint test build --force` on this exact commit (pre-push, main checkout) | ✅ 20/20 tasks |

Environmental note: one red turbo run in the review worktree was a host-port collision (a second compose project racing the main repo's postgres for 5432), not the PR — the gate was re-assembled without the compose pretest and is fully green.

## What's good

- The consistency test pins `ACTIVE_DRIVER_RIDE_STATUSES` to a derivation from the state machine, not a copy of itself — the strongest anti-rot shape for a shared status set.
- The AC #2 revoke statement is exactly the "test passing for the wrong reason" catch the plan demanded.
- The parallel-worker blast radius (six pre-existing test failures) was root-caused to the architecture's own single-sweeper assumption and fixed at that level (`maxWorkers: 1` + the one missing ride-retirement), with the reasoning written where the next person will look.
- The residual seam is narrowed, named, and bounded in KNOWN GAPS rather than papered over.

## Recommendation

Approve and merge. The single Low is a wording/observability nit, fixable whenever convenient.
