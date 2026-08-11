# Implementation Report — harden the maps seam before a real provider is bound (#94)

**Plan**: `.claude/plans/harden-maps-seam-spend-controls.md`
**Branch**: `feature/harden-maps-seam-spend-controls`
**Status**: COMPLETE

## Summary

The maps seam now bounds its own spend, logs what it spends, and fails fast instead of hanging. Two `CachingMapsProvider` facades are bound over the one `MAPS_PROVIDER_SOURCE` — `MAPS_PROVIDER` (`quote`, 24 h TTL, pricing) and the new `MAPS_PROVIDER_ETA` (`eta`, 5 min TTL, the tracking page) — which carries the caller-attributed miss-path log, the structural TTL split, and the ability to run the negative cache on for `eta` and off for `quote`. Inside the seam: a `Promise.race` timeout, write-path rounding that stops a fractional Google duration from silently degrading every ETA to haversine, and closed-enum failure logging that makes a provider's free text structurally unable to reach a log line. The tracking page gained a token-scoped throttle applied after shape validation and before the database read. The CI-parity gate is green and the throttle was confirmed end-to-end against a running server; **one Level 4 manual step — observing the single `geo.maps.route_fetched` line on a live polled ride — is left for a human, for the reason given under "Level 4 manual validation" below.**

## Tasks completed

- Three env vars with bounds + docblocks → `services/api/src/common/config/env.schema.ts` (UPDATE)
- Committed defaults matching the schema exactly → `.env.example` (UPDATE)
- Throttle constants + key builder → `services/api/src/features/notifications/notifications.policy.ts` (UPDATE)
- Seam rewrite: caller namespacing, negative cache, timeout, rounding, structured logs → `services/api/src/features/geo/caching-maps.provider.ts` (UPDATE)
- `MAPS_PROVIDER_ETA` token → `services/api/src/features/geo/maps.tokens.ts` (UPDATE)
- Both facades bound over one source, with the `0` argument documented → `services/api/src/features/geo/geo.module.ts` (UPDATE)
- Barrel export + KNOWN GAPS truth-up → `services/api/src/features/geo/index.ts` (UPDATE)
- `KV_STORE` + `MAPS_PROVIDER_ETA` injection, `assertWithinRateLimit`, event rename, docblock rewrite → `services/api/src/features/notifications/tracking/tracking.service.ts` (UPDATE)
- Seam unit suite extended → `services/api/src/features/geo/caching-maps.provider.spec.ts` (UPDATE)
- Wiring assertions for both facades → `services/api/src/features/geo/geo.module.spec.ts` (UPDATE)
- Throttle unit suite → `services/api/src/features/notifications/tracking/tracking.service.spec.ts` (CREATE)
- Two rename-driven assertions + ordering-dependency comment → `.../tracking.integration.spec.ts` (UPDATE)
- Whole-units docblock, no type change → `packages/shared/src/seams/maps-provider.ts` (UPDATE)
- "NOTHING ENFORCES THAT CEILING YET" paragraph rewritten → `services/api/src/features/rides/rides.policy.ts` (UPDATE)
- Maps bullet + a sanitized-logging bullet → `services/api/CLAUDE.md` (UPDATE)
- AMENDMENTS entry → `.claude/plans/tracking-eta-maps-quantized-cache.md` (UPDATE)

## Tests added

`caching-maps.provider.spec.ts` — **14 passed**. Five existing cases updated for the new arity; one deliberately flipped (`rounds a fractional provider result…`, was `refuses to cache a result that breaks the seam contract`); eight added: still-refuses-broken-results, outage cached, negative cache expires and recovers, cached success outranks cached failure, timeout + negative-cache, quote/eta namespace separation, negative-cache-off retries the source, and the miss-path log's exact key set with a coordinate-freedom assertion.

`geo.module.spec.ts` — **6 passed**. Three added: both facades bound as factories on identical `inject` arrays, the two facades not sharing cache entries, and `the quote facade does not negative-cache` — built through the module's own factories, so a swapped argument in `geo.module.ts` fails here.

`tracking.service.spec.ts` (new) — **5 passed**. At-the-limit success, 429 with `retryAfterSeconds >= 1`, the throttled request spending zero database reads and zero route calls, window expiry, and a malformed token rejected before it can mint a rate key.

`tracking.integration.spec.ts` — **12 passed**, unchanged except the two rename-driven assertions. The `routeCalls` delta assertions passed untouched, which is what proves the namespace split did not break the shared-source counter.

## Validation results

- **CI-parity gate**: `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` → **21/21 tasks successful**.
- `@taxi/api`: 54 suites, 455 tests passed. `@taxi/shared`: 18 files. `@taxi/dispatch`: 4 files. `@taxi/db`: 3 files. No skipped suites (`REDIS_TEST_URL` was set).
- Lint: 0 errors, 7 warnings — all pre-existing `no-unsafe-argument` warnings in integration specs, none in changed code.
- Per-task doc checks: `NOTHING ENFORCES THAT CEILING YET` → 0; `MAPS_PROVIDER_ETA` in `services/api/CLAUDE.md` → 1; `track_eta_failed` in the #87 plan → 1; `^MAPS_` in `.env.example` → 4; no surviving `track_eta_fallback` anywhere.

**Round 2 — after the PR #99 review fixes (`1ce2548`).** The figures above are the original implementation run and are left as the record of it; these supersede them for anyone re-running the gate:

- Same gate command → **21/21 tasks successful**. `@taxi/api`: 54 suites, **458 tests** passed (455 + 3: two for M1's best-effort cache writes, one key-set case for `geo.maps.route_failed`). Lint unchanged at 0 errors / 7 pre-existing warnings.
- Fixed: M1 (a Redis write fault could drop `geo.maps.route_failed`, or misattribute a billed success as `source_rejected` and negative-cache it), L1 (`errorName` logged raw despite a docblock claiming it could not carry a coordinate — now `safeErrorName`), L2 + M2's docblock half (the viewer-count and burst figures, and the false "breaks visibly" claim), L3 (the suite's ordering trap, now cleared and asserted).
- Deferred to **#100**: M2's client work in `apps/dispatch`, and L4's config-level negative-cache kill switch.
- **Step 3 below is unchanged by round 2** — still open for a human.

### Level 4 manual validation — partially performed

**Performed:**
- The dev server boots clean with the three new vars against the real `.env`, both facades bound, `/health` → 200.
- **Step 5 (throttle), live**: 130 sequential `GET /track/:token` → exactly **120 × 404 then 10 × 429**, body `{"message":"too_many_requests","retryAfterSeconds":58}`. The 404s (not 200s) are correct and are themselves the ordering proof — the throttle sits before the database read, so an unknown-but-shape-valid token still consumes budget. Log shape confirmed: `ride.notifications.track_view_throttled` with `tokenPrefix`, `attempts`, `at`. One Redis key minted, token-scoped.
- **Step 4 (no coordinates)**: `grep -cE '5[67]\.[0-9]{3}|2[34]\.[0-9]{3}'` over the whole server run → **0**.

**Not performed — steps 2, 3, 6, 7.** All need an active ride with a tracking token, and the dev database has none: tokens are minted by the booking flow, not the seed, so producing one means the full OTP → book → dispatch → accept → GPS-ping chain (sockets included) plus two server restarts at different `MAPS_ROUTE_TIMEOUT_MS`. That is interactive work for a human at a running system. Every assertion those steps make is covered automatically: one paid call across two polls in a cell by `tracking.integration.spec.ts`'s `a sub-cell move is a cache hit…`; the `geo.maps.route_fetched` key set, `caller` and coordinate-freedom by the new unit case; timeout, negative-cache serve/expire, and the quote/eta asymmetry by the seam and module specs. **Step 3 — observing the single `geo.maps.route_fetched` line on a live polled ride — remains for a human to confirm.**

## Deviations from the plan

1. **Branched off `origin/main`, not the current branch.** The session opened on `feature/tracking-eta-maps-quantized-cache`, which is 0 ahead / 6 behind `origin/main` — already merged. Stacking would have put this ticket on a merged branch. Verified first that none of those 6 commits touch this plan's files (they are the dispatch vitest runner plus docs), so the plan's line references were still accurate. `pnpm install` was rerun for the changed lockfile.
2. **Expected value corrected: `{10234.5, 1187.4}` rounds to `{10235, 1187}`, not `{10234, 1187}`.** `Math.round` breaks ties toward +Infinity. The plan's task text stated 10234. Noted in the test.
3. **The negative-cache recovery test gained a step.** The plan's sequence (fail → advance → succeed) passes even if serving a cached failure re-writes the fail key — and `setWithTtl` *resets* the expiry, so that bug would let a 5 s poll hold a 60 s memory open forever, turning a transient blip into a permanent outage. A blocked call now sits between the failure and the `advance()`, so the test can actually fail on it. The implementation puts the `failed !== null` throw above the try block, and the behavior is commented at both sites.
4. **Two docblocks truth-upped beyond Phase 5's list**, both falsified by the `MAPS_PROVIDER` → `MAPS_PROVIDER_ETA` swap: `notifications.module.ts`'s "`GeoModule` supplies `MAPS_PROVIDER`…" and `geo/index.ts`'s attribution of #87's road ETA to `MAPS_PROVIDER` (the plan's index.ts task covered only the KNOWN GAPS paragraph below it).
5. **One extra bullet in `services/api/CLAUDE.md`**, on sanitized failure logging and the eta-on/quote-off asymmetry. The plan sanctioned "at most one" addition; this is it.
6. **`caching-maps.provider.spec.ts`'s `CountingProvider` now takes an optional inner provider.** Lets every scripted source (failing, hanging, fixed-shape) still be counted, so `routeCalls` means the same thing in every case rather than only the stub-backed ones.
7. **`MAPS_ROUTE_TIMEOUT_MS` is documented as shared by both callers**, in `.env.example` and the env schema. The first draft grouped it under a tracking-page header, which is the exact misreading the plan's Level 4 step 6 warns about in bold: an operator lowering it to bound tracking latency also fails every pricing quote, i.e. every booking. `.env.example` is the file an operator edits, so the framing matters there most. The `grep -c '^MAPS_' → 4` check counts vars and could not have caught it.
8. **Corrected a pre-existing stale clause in `geo/index.ts`.** Its docblock credited "#10" with injecting `MAPS_PROVIDER` for driver→pickup ETAs. `pricing.service.ts` is in fact the only remaining injector — `etaToPickup` in `ride-notifications.service.ts` is still `estimateEtaMinutes` (haversine), which the plan lists as out of scope. The clause is now accurate and names that thread as still open. Not caused by this ticket, but I would have re-signed it otherwise.

Constructor argument order follows the plan positionally (`inner, kv, caller, ttlSeconds, failureTtlSeconds, timeoutMs`). An options object was considered for the three adjacent numbers and rejected: the plan's own mitigation — the `the quote facade does not negative-cache` case, built through the module's factories — catches a swap directly, and it is now in place.

## Issues encountered

- **Worktree compose collision.** `pnpm test`'s pretest brought up a worktree-scoped `taxi-tracking-eta-db-1` and collided on port 5432 with the shared `taxi-db-1`. Removed the stray project and used `COMPOSE_PROJECT_NAME=taxi` throughout, as the repo's worktree note prescribes.
- **Worktree `.env` points Redis at the auth-required local instance** (the known 6379 shadowing). The dev server needed `REDIS_URL=redis://localhost:6381` to boot; not a code issue and nothing was changed for it.
- Four prettier errors on first lint (line wrapping only), fixed with `prettier --write` on the changed files.

## Ready for the next step

All plan tasks are complete and the CI-parity gate is green. Next: `piv-commit`, then `piv-create-pr` (body carries `Closes #94`), then `piv-review-pr`.
