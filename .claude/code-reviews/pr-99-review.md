# Code Review — PR #99 · `feat(api): harden the maps seam with spend controls and a counter (#94)`

**Reviewed at** `836ddf1` · **base** `origin/main` (`3752d2a`) · 19 files, +1890 / −91 · OPEN, MERGEABLE, not a draft.

> Base-ref note for anyone re-running this: the local `main` ref in the review worktree was two commits
> stale (`eb1fa3f`). `git diff main...HEAD` pulls in already-merged #87 follow-up commits and shows a
> larger diff. Use **`git diff origin/main...HEAD`** — that is the 19-file set reviewed here. In
> particular the anisotropic-cell paragraph in `notifications.policy.ts`, the spend-arithmetic table in
> the #87 plan, and the `€400 bill` line in `caching-maps.provider.ts` are all **pre-existing** and out
> of scope for this review.

## Summary

The slice does what it says. Two `CachingMapsProvider` facades over one `MAPS_PROVIDER_SOURCE` give the
seam caller attribution, a structural TTL split, and an asymmetric negative cache (on for `eta`, off for
`quote`) without touching a single line of `packages/shared` contract. Inside the seam: a `Promise.race`
timeout, write-path rounding, and closed-enum failure logging. On the consumer: a token-scoped throttle
placed after shape validation and before the database read.

The validation gate is green at 21/21 tasks and the PR body's numbers reproduce exactly. The reasoning in
the docblocks is unusually careful — every claim about the throttle says **bounds**, never **closes**,
which is exactly the failure mode `docs(api): correct the paid-call claims the #87 docblocks overstate`
exists to prevent.

No Critical or High issues. Two Mediums: one real code defect with a one-line fix, and one cross-surface
gap where the API gained a 429 that no client in the monorepo can render.

## Issues

### Medium

**M1 — A Redis write fault can swallow the very log line this ticket exists to add, and can turn a
billed success into a poisoned corridor.**
`services/api/src/features/geo/caching-maps.provider.ts:249-259` (failure path) and `:237-247` (success path)

```ts
} catch (error) {
  const reason = classify(error);
  if (this.negativeCache) {
    await this.kv.setWithTtl(failKey, reason, this.failureTtlSeconds);  // ← can throw
  }
  this.logFailure(reason, key, error);   // ← never runs if it does
  throw error;                           // ← and a Redis error replaces the real one
}
```

Both halves are **new in this PR** — `origin/main`'s `route()` had no `try`/`catch` at all, so the
restructuring introduced the ordering:

- **Failure path.** If the fail-key write throws, `geo.maps.route_failed` is never emitted — the only
  production signal that the provider is failing, lost precisely when it matters — and the caller sees a
  Redis error instead of `maps_route_timeout`.
- **Success path.** `setWithTtl(key, …)` sits *inside* the `try` and *before* the
  `geo.maps.route_fetched` line. If that write throws, a route call that **succeeded and was billed** is
  caught, classified `source_rejected` (a false attribution — the source did not reject), negative-cached
  for the `eta` caller so the corridor is dark for 60 s, and never counted. The paid-call counter, which
  is this ticket's deliverable, under-counts exactly when Redis is unhealthy.

*Trigger, stated honestly:* this needs a **partial** Redis fault — writes rejected, reads fine
(maxmemory `OOM` under `noeviction`, a replica gone `READONLY`, `MISCONF`). A total outage never reaches
here, because `assertWithinRateLimit`'s `INCR` (tracking) and the ride-idempotency `setIfAbsent`
(pricing) are both writes that fail first. So the reachable window is a transient or racy write fault,
not a sustained one — narrow, but not theoretical, and this service leans on Redis heavily.

*Minimal fix:* move `this.logFailure(reason, key, error);` above the `if (this.negativeCache)` block, and
emit the `route_fetched` line immediately after `parse()` rather than after the cache write. Then treat
both cache writes as best-effort, so a cache fault can never change a route call's outcome or its
attribution. One reorder plus two `.catch()`s; no behavioral risk on the healthy path.

**M2 — The new 429 reaches a tracking page that renders it as "the system is down."**
`apps/dispatch/src/app/t/[token]/page.tsx:63` · `apps/dispatch/src/features/tracking/tracking-map.tsx:52`

`GET /track/:token` can now answer 429 with `{ message, retryAfterSeconds }`. No client in the repo
handles it (`grep -rn "429\|retryAfterSeconds\|TOO_MANY" apps/` → zero hits), and `apps/dispatch` is
untouched by this PR:

- **SSR** (`page.tsx:61-63`) branches 404 → not-found, 410 → expired, then `else if (!res.ok) failure =
  'api_down'`. A 429 on initial load renders the full-page **"connection lost"** screen — the rider is
  told the platform is down when the ride is fine and the throttle is working as designed. The retry link
  on that screen is a full reload, which immediately spends another request.
- **The poll island** (`tracking-map.tsx:52`) degrades more honestly — `setOffline(true)`, last known data
  kept and stamped — but keeps polling at `POLL_MS = 5_000` with **no backoff**, so `retryAfterSeconds` is
  computed server-side for nobody.

This also falsifies a claim the PR adds: the new `TRACKING_VIEW_MAX_PER_WINDOW` docblock says the limit
"breaks visibly (a 429 on the page)". It does not — the shipped page has no 429 state, so what a rider
sees is a network error.

*Failure scenario:* share-trip (#17) reuses one token across viewers, so 11 concurrent viewers is
11 × 12 = 132 req/min against a 120/min budget. Every viewer — not just the eleventh — then sees the
banner intermittently as the fixed window rolls.

*Why Medium and not High:* the throttled request is cheap by design (no DB read, no route call), so there
is no spend or availability amplification; the fixed window is never extended by continued polling, so it
clears within 60 s; share-trip is not shipped; and `mapsProviderSourceFactory` (`geo.module.ts:22`)
refuses to boot under `NODE_ENV=production`, so none of this is reachable today.

*Minimal fix (follow-up, not a merge blocker):* a `res.status === 429` branch in both files — an i18n
`page.too_many_viewers` string instead of `api_down`, and a poll delay honoring `retryAfterSeconds`.
Either that, or soften the docblock to say what actually renders. Worth filing against #13/#16 alongside
the in-flight coalescing this PR already defers there.

### Low

**L1 — `geo.maps.route_failed` carries the only provider-controlled value in the seam and is the one log
without a key-set test.**
`services/api/src/features/geo/caching-maps.provider.ts:299-319` · spec at `caching-maps.provider.spec.ts:351-392`

`errorName: error.name` is provider-controlled — `name` is a writable own property on any `Error`
instance, so an adapter that sets `err.name = "route 56.9,24.1 failed"` puts a coordinate in a log line.
`geo.maps.route_fetched` got an exact-key-set assertion plus a coordinate-freedom check; `route_failed`
got neither (`grep -n route_failed` in the seam spec → zero hits). The `services/api/CLAUDE.md` bullet
this PR adds claims the sanitization is *structural*; today that claim rests on a docblock.

*Minimal fix:* one case mirroring spec lines 374-381 against a `source_rejected` failure — pin
`Object.keys(payload).sort()` to `['at','caller','cell','errorName','event','reason']` and assert no
value stringifies to a coordinate fragment. The `failingSource` helper is already in the file.

**L2 — The throttle docblock gives one figure without naming its case.**
`services/api/src/features/notifications/notifications.policy.ts:59-85`

"120/min is 10 concurrent viewers at full poll rate" is the steady-state ceiling with zero headroom, and
the repo rule is to give the worst case or say which one it is. Two corrections:

- The window is **fixed**, not sliding (`incrWithTtl` sets the TTL only when absent), so a
  boundary-aligned burst passes **~240 requests in a ~60 s span**. That is the number an operator sizing
  spend needs.
- The effective steady ceiling is **9 viewers, not 10**: each page *load* spends one extra
  `GET /track/:token` from the SSR fetch at `page.tsx:57`, on top of the island's 12/min. Ten viewers
  opening the shared link inside one window is 10 + 120 = 130 → the last ones get 429.

*Minimal fix:* amend the docblock. No code change.

**L3 — The tracking integration suite acquired an order dependency, documented but not removed.**
`services/api/src/features/notifications/tracking/tracking.integration.spec.ts:657-664`

The comment is honest about it: `failNext()` now leaves a live negative-cache entry in the shared
`InMemoryKeyValueStore`, which the file never resets and never `advance()`s, so the key lives 60 real
seconds. It is safe *only* because that case is currently last. Whoever appends the next case that routes
the same `eta` corridor gets a negative-cached throw instead of a source call, and a `routeCalls` delta
assertion fails for a reason that looks nothing like the cause. A documented trap is still a trap.

*Minimal fix:* `advance()` past the failure TTL at the end of that case, or reset the shared store in an
`afterEach`.

**L4 — The `eta` negative cache has a code-level kill switch but no config-level one.**
`services/api/src/common/config/env.schema.ts` (`MAPS_ETA_FAILURE_TTL_SECONDS`)

`CachingMapsProvider` treats `failureTtlSeconds: 0` as "disable entirely" and the `quote` facade uses
exactly that, but the env var is `.positive()`, so the `eta` facade's negative cache cannot be turned off
from configuration. If it ever misbehaves against a real provider, switching it off needs a deploy.

*Minimal fix (optional):* `.nonnegative()` on that one var, with the docblock stating that `0` disables it.

## Validation

Run from the review worktree at `836ddf1`:
`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`

| Check | Result |
|---|---|
| Turbo gate (typecheck · lint · test · build) | **21/21 tasks successful**, 0 cached, 55.4 s, exit 0 |
| `@taxi/api` tests | **54 suites / 455 tests passed**, 0 skipped (`REDIS_TEST_URL` set) |
| Lint (`@taxi/api`) | **0 errors, 7 warnings** — one `no-unsafe-argument` per integration spec, all seven pre-existing, none in changed code |
| PR body's reported numbers | Reproduce exactly (21/21, 54/455, 0 errors / 7 warnings) |
| Level 4 manual | Partially performed by the author; **step 3 remains open** — see recommendation |

Claims spot-checked independently rather than taken from the PR body:

- `MAPS_ROUTE_TIMEOUT_MS`'s `.max(30_000)` genuinely clears the ceiling it cites: `rides.policy.ts:51` is
  `RIDE_IDEMPOTENCY_PENDING_TTL_SECONDS = 120`, and `pricing.service.ts:42` makes exactly **one** route
  call per quote — worst case 30 s against a 120 s window.
- The harness overrides `MAPS_PROVIDER_SOURCE` (`test/harness.ts:407`), not `MAPS_PROVIDER`, so both
  facades decorate the one `CountingMapsProvider` and the `routeCalls` spend assertion still sees every
  paid call across both. This is the PR's central claim and it holds.
- `geo.module.spec.ts:118` (`the quote facade does not negative-cache`) is built through
  `providerFor(token).useFactory!(…)` — the module's own factory — so a swapped positional argument in
  `geo.module.ts` fails there. That is the stated mitigation for the six-positional-argument constructor,
  and it is real.
- The deliberately flipped write-path test did **not** narrow the guarantee `services/api/CLAUDE.md`
  states as law. `caching-maps.provider.spec.ts:197` (`still refuses a genuinely broken result`) pins NaN,
  negative and missing-field results as rejected, not written to the success key, and negative-cached as
  `contract_violation`.
- The throttle cannot leave a key without a TTL: `redis-kv.store.ts:55-61` is an atomic Lua `INCR` +
  `EXPIRE`-if-`TTL < 0`. The 429 body shape matches the existing convention in `rides.service.ts:299-309`
  exactly, and no endpoint in this codebase sets a `Retry-After` header, so its absence is consistent
  rather than an omission.
- `Math.round`'s effect on money is nil: `distanceMeters` reaches a fare only through
  `Math.round((perKmCents × distanceMeters) / 1000)` in `upfront-fixed.strategy.ts` (unchanged), so a
  ≤0.5 m shift is sub-cent — and strictly better than the previous behavior, which threw on every call.
- `Promise.race` is correct on the point usually got wrong: `race` attaches handlers to both promises, so
  the losing `inner.route()` rejecting after the race settles cannot produce an unhandled rejection, and
  `clearTimeout` in `finally` handles the inverse.

## What's good

- **The `caller` constructor argument instead of a fourth `route()` parameter.** It buys the log field,
  the key namespaces and the per-caller negative cache at once, with zero `packages/shared` churn — and
  `caching-maps.provider.ts:20-32` argues the case rather than asserting it.
- **The negative-cache asymmetry is enforced, not just documented.** `geo.module.ts:60-73` explains the
  literal `0` where the `0` is, names the concrete harm (a transient Routes 5xx blocking one
  pickup→destination pair for the whole TTL on the path that earns money), and states the condition under
  which to revisit it — and `geo.module.spec.ts:118-145` proves it through the module's own factories.
- **The negative-cache recovery test earns its keep.** `caching-maps.provider.spec.ts:242-250` inserts a
  *blocked* call between the failure and `kv.advance()`, so the test fails if serving a cached failure
  ever re-wrote the fail key. Without that step the sequence passes with the "transient blip becomes
  permanent outage" bug present. Deviation #3 in the report is real and load-bearing.
- **Write-path rounding caught a real contract mismatch, not a hypothetical one.** Google documents
  `duration` as `"1187.400s"`; against `.int()` that would have thrown on every call, been swallowed by
  `roadEta`'s catch, and silently pinned every ETA on the platform to haversine while the page kept
  answering 200.
- **The prose is disciplined about what it does not do.** `caching-maps.provider.ts:160-165`, the throttle
  docblock, `geo/index.ts`'s KNOWN GAPS and the PR body all say the throttle **bounds** the
  concurrent-burst path and does not close it, and all name in-flight coalescing as still absent. The
  `track_eta_fallback` → `track_eta_failed` rename also fixes a real taxonomy violation ("fallback" is a
  noun, not a state).

## Recommendation

**Approve — merge after M1.** No Critical or High issues, the gate is green, the diff matches the
ticket's intent, and every deviation in `.claude/reports/harden-maps-seam-spend-controls-report.md` is an
intentional, argued decision rather than drift.

M1 is worth doing before merge only because it is a one-line reorder plus two `.catch()`s on a defect
that drops this ticket's own deliverable — not because it blocks anything reachable today. M2 belongs
with #13/#16 where the client work is already queued. L1–L4 are cheap and can ride along or wait.

**The one thing a human still has to do:** Level 4 step 3 — load a live polled ride and confirm a
**single** `geo.maps.route_fetched` line per cell crossing rather than one per poll. That is this
ticket's own success condition, it is the check #87 could not perform at all because the counter did not
exist, and the author correctly declined to fake it (the dev database has no tracking token — tokens are
minted by the booking flow, not the seed). Everything else in Level 4 is covered by automated cases,
mapped case-by-case in the implementation report.

---
*Reviewed with fresh eyes in a clean context (`piv-review-pr`), with the deep pass dispatched to the
`code-reviewer` agent. Posted as a comment rather than a formal approval: this is a solo repo and Linards
authors every PR, so `gh pr review --approve` is refused by GitHub.*
