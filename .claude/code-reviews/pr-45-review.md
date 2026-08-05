# PR #45 Review — `feat: ride request → upfront fixed quote via maps and pricing seams`

**Branch** `feature/api-rides-pricing` → `main` · **HEAD** `6ce9b8a` · **52 files, +4878 / −12**
**Reviewed with fresh eyes** (clean context + the read-only `code-reviewer` agent), against `CLAUDE.md`, `services/api/CLAUDE.md`, `packages/shared/CLAUDE.md` and `.claude/references/{ride-state-machine,realtime-events,logging-standard}.md`.

**Recommendation: request changes** — 0 Critical · 1 High · 5 Medium · 5 Low.

Nothing here needs redesign. The architecture, the money path and the contract seam are sound, and the validation gate is genuinely green. The one High is a handful of lines against an existing in-house pattern.

---

## Summary

A ride now exists and has a price, and the seams it rests on are real rather than sketched. `POST /rides` routes through `MapsProvider`, prices through `UpfrontFixed`, resolves the commission from `platform_config` at quote time, and persists the ride plus its fare lines in one transaction at the state machine's entry status.

**No hard-rule violations found.** Verified across the diff: money is integer cents end to end; the breakdown sums to the total by construction; the commission split cannot leak; `ride-entry.ts` is the only non-test file in the rides slice that names a ride status (grep-verified); `@taxi/shared` imports nothing from the workspace; no provider SDK escapes the geo slice; the rider identity comes from the JWT and survives a smuggled `riderId` at three levels.

Both flagged structural divergences hold up under scrutiny:

- **Creation as the machine's ENTRY, not a transition** — correct. `assertTransition(from, to)` has no `from` for a ride that does not exist, and `assertEntryStatus` makes the constraint structural (a TS assertion function) rather than conventional.
- **No new socket event** — correct, and stronger than the PR body claims: `rideStatusEventSchema.previousStatus` is already `.nullable().default(null)` (`packages/shared/src/realtime-events.ts:69`), so emitting `ride:status` on creation is contract-legal with no schema change. The catalog's own rationale for having no `ride:requested` is exactly this.

---

## Issues

### 🔴 Critical

None.

---

### 🟠 High

#### H1 · Availability · `services/api/src/features/geo/caching-maps.provider.ts:75-82`

**The cache writes unvalidated and reads validated.** `route()` stores `JSON.stringify(result)` straight from the provider and returns `result` unparsed, but the read path goes through `routeResultSchema.parse`, which requires `.int()` on `distanceMeters` and `durationSeconds`. Nothing guards `JSON.parse`, and nothing deletes a key that fails to parse.

**Failure scenario — reproduced, not hypothesised.** A provider returning fractional metres (exactly what a real Google Routes response does, landing with #13/#16):

```
1st call (cache MISS): {"distanceMeters":10234.5,"durationSeconds":1187.4,"polyline":"abc"}
cached bytes:          {"distanceMeters":10234.5,"durationSeconds":1187.4,"polyline":"abc"}
2nd call THREW:        ZodError -> expected "integer"
```

The first caller is served fine; **every subsequent request for that corridor throws a raw 500 until the 24 h TTL expires**, and the busiest routes are precisely the ones that cached. Retrying re-reads the same poisoned key — there is no recovery short of a Redis flush. The `v1` key segment does not help: this is not a shape change, it is a value the write path accepted and the read path rejects.

Latent today (`StubMapsProvider` rounds, so nothing fractional is produced) — but it arrives with the real provider, and `caching-maps.provider.spec.ts:68` currently pins the throw as correct behaviour, so it will survive that change.

**Minimal fix** — still never serves garbage, so the "parse, don't cast" rationale in the docblock is preserved:

```ts
if (hit !== null) {
  const parsed = routeResultSchema.safeParse(JSON.parse(hit)); // wrap JSON.parse too
  if (parsed.success) return parsed.data;
  await this.kv.del(key);   // poisoned entry — fall through and re-route
}
```

Belt and braces: parse on **write** as well, so a non-conforming provider fails at the source rather than one request later. Update `caching-maps.provider.spec.ts:68` to assert recovery (source called once, valid result returned, key rewritten) instead of the throw.

---

### 🟡 Medium

> **A note on grading.** M1 and M2 both have cost arguments that are *latent behind the production stub* — `mapsProviderSourceFactory` throws under `NODE_ENV=production`, so no paid Routes call is reachable on the code as merged. They are graded on what is reachable today, with the trigger named. H1 is graded High because it needs no attacker and no new code path beyond the provider swap that is already planned.

#### M1 · Cost / abuse · `services/api/src/features/rides/rides.controller.ts:25-31` — **gate: must land before #13 binds a paid provider**

`POST /rides` has no rate limit. Confirmed by grep: no throttler exists anywhere in `services/api/src`; the only rate limiting in the repo is the hand-rolled `incrWithTtl` pattern in the auth slice.

**Reachable today** (real, but low impact at ≤10-driver pilot scale with nothing dispatching): one authenticated rider looping the endpoint writes unbounded `rides` + `ride_fare_lines` rows — each persisting the whole `RideRequest` into `rides.request` jsonb, with `addressPointSchema.address` carrying no `.max()` (`packages/shared/src/schemas/geo.ts:12`, pre-existing, not introduced here), so Express's 100 kb body limit is the only ceiling on row size — plus one Redis key per distinct route, each pinned for 24 h.

**The part that costs euros, and why the cache does not save you:** `COORD_PRECISION = 4` is ~11 m. A rider varying coordinates by more than that gets a **fresh cache key, hence a fresh paid Routes call, every single request**. The `<€100/mo` guardrail that `CachingMapsProvider` exists to protect is defeated by any hostile rider with a for-loop the moment #13 lands.

**Minimal fix** — reuse the in-house pattern, no new dependency:

```ts
// top of RidesService.request, BEFORE the maps call, so a throttled request costs nothing
const n = await this.kv.incrWithTtl(`rides:rate:${riderId}`, WINDOW_SECONDS);
if (n > MAX_PER_WINDOW) throw new HttpException({ message: 'too_many_requests' }, HttpStatus.TOO_MANY_REQUESTS);
```

exactly as `services/api/src/features/auth/auth.service.ts:133-156` does.

#### M2 · Ordering · `services/api/src/features/pricing/pricing.service.ts:37, 43, 46`

The route call happens **before** the commission config read:

```
:37  const route  = await this.maps.route(...)               // the paid call
:43  const quote  = await this.strategy.quote(...)           // reads ride_tariffs; throws if missing
:46  const config = await this.platformConfig.forCity(...)   // throws if missing
```

Both DB reads throw hard with no fallback — correct, that is the config-not-constant rule. But on a fresh environment where the seed did not run, or a city added without a `platform_config` row, **every request spends a route call and then 500s**. `RidesService` is careful to reject `vehicleCount` and past `scheduledFor` before spending anything (asserted at `rides.service.spec.ts:133-158`); this layer gives half of that back.

**Minimal fix:** hoist line 46 above line 37. One line, costs nothing, covers the likelier of the two misconfigurations. The tariff read lives inside the strategy, so hoisting that too is a larger change — reasonable as a follow-up.

#### M3 · Correctness · `services/api/src/features/rides/rides.service.ts:53-72`

The request is not idempotent, and both side effects run **after** the transaction has committed.

**Failure scenario:** the rider double-taps "Book". Two rides are created, both at `requested`, both with distinct `orderId`s — and #10 will dispatch both, sending two cars to one kerb. The second tap is *cheap*, because the route is already cached, so nothing naturally deduplicates it. The same shape appears if `joinRideRoom`/`emitToRide` throws: the ride is already committed, the rider gets a 500 with no ride id, and the natural reaction is to retry — double-booking again.

**Minimal fix (two small independent changes):**
- Dedupe on `riderId` + a short Redis key derived from pickup/destination/paymentMethod (~60 s TTL), or accept an `Idempotency-Key` header; return the existing ride on a repeat.
- Wrap lines 64-72 in `try/catch`, log `ride.request.notify_failed`, and still return `{ ride, split }` — a notification failure must not fail an already-committed ride.

#### M4 · Test coverage · `services/api/src/features/pricing/tariff.repository.ts:35-39`

The no-fallback throw — the load-bearing "a rate is config, there is no fallback" guarantee — **has no direct test**. `upfront-fixed.strategy.spec.ts:84-98` rejects from a *mocked* `forCategory`, so the real `if (!row) throw` never executes. A refactor that returned a zero-rate default instead of throwing would keep that spec green and start pricing rides at €0.00.

The asymmetry is the argument: its exact sibling `platform-config.repository.ts:27-30` **is** directly exercised, with an empty-row fake, at `platform-config.service.spec.ts:50-56`. Per the repo rule that each feature ships an expected + edge + failure case mirroring the slice, this failure case is the one that is missing.

**Minimal fix:** mirror the platform-config spec — build `new TariffRepository(dbReturning([]))` against the same `select → from → where → limit` fake and assert `/No ride_tariffs row/`.

#### M5 · Logging · `services/api/src/features/rides/rides.service.ts:74-84` · `services/api/src/features/pricing/pricing.service.ts:61-70`

Both slices log only the success state; there is no `_failed` counterpart anywhere on the ride-request path, which `.claude/references/logging-standard.md` lists among the standard states.

**Failure scenario:** production starts 500-ing on `POST /rides` (missing tariff row, maps provider down, H1's poisoned cache). The only trace is Nest's default exception log — no `riderId`, no category, no route — nothing to correlate, and no way to tell "one rider, one corridor" from "everything is down". Every field needed is already in scope at the throw site.

**Minimal fix:** `try/catch` in `RidesService.request` logging `ride.request.failed` with `riderId`, `category`, `reason`, `at`, then rethrowing — keeping the same no-PII discipline the success log already follows. Pairs naturally with M3's second change.

---

### 🔵 Low

- **L1 · `services/api/src/features/geo/index.ts:18`** — the barrel exports `mapsProviderSourceFactory`, but nothing imports it from there; `geo.module.spec.ts:2` imports it from `./geo.module` directly. An unused symbol widening the slice's public API. Drop it from the barrel; keep `GeoModule` and the two tokens.
- **L2 · `services/api/src/features/rides/rides.service.ts:37-49`** — nothing bounds pickup/destination to the service area. `latLngSchema` only checks the coordinates are valid on Earth, so a Rīga rider can book Sydney → Reykjavík and the stub will quote it. Zone *resolution* is #10's; a service-area *rejection* is a different and cheaper thing. Either a bounding-box guard or an explicit `KNOWN GAPS` line.
- **L3 · `services/api/src/features/rides/index.ts:4-19`** — `rideOptions` (`childSeat`, `femaleDriver`) are parsed, defaulted and persisted into the `request` jsonb, but nothing reads them. Every other inert field in this slice has a `KNOWN GAPS` entry; this one doesn't. One line, so the next reader knows it's deferred to #10 rather than wired.
- **L4 · `services/api/src/features/rides/rides.repository.ts:17-22`** — `CreateRideInput.status` is typed `RideStatus` (all 14) and narrowed at runtime by `assertEntryStatus`. Since `entryStatusFor` already returns `RideEntryStatus`, typing the field as `RideEntryStatus` would let the compiler reject a mid-lifecycle status at the call site, runtime assertion still guarding non-TS callers. Purely a tightening — current code is correct.
- **L5 · PR body accuracy** — the body says the 3 lint warnings are "all pre-existing". The *pattern* is (it matches the auth and drivers integration specs), but the instance at `rides.integration.spec.ts:54` is **new**, introduced by this PR. Not a defect, and consistent with house style — just worth stating accurately.

---

## Validation

Independently re-run, not taken from the PR body. **`pnpm turbo run typecheck lint test build --force` from a cleared `dist`: GREEN, 18/18 tasks, exit 0.**

| Check | Result |
|---|---|
| turbo tasks | **18 successful / 18 total**, 0 cached |
| api jest | **152 passed**, 11 skipped, 25 of 26 suites (the skip is pre-existing) |
| shared vitest | **111 passed**, 9 files |
| db vitest | **16 passed**, 3 files |
| lint | **0 errors**, 3 warnings (`no-unsafe-argument` on `getHttpServer()` — see L5) |
| typecheck · build | clean across all packages |

Every figure in the PR body checks out.

**This is the post-merge state, not just a branch result** — `origin/main` is an ancestor of HEAD (`git rev-list --count HEAD..origin/main` = 0), so no merge is pending that could change it.

Three runtime checks a read-only pass cannot perform:

1. **No migration drift.** Re-running `drizzle-kit generate` reports *"No schema changes, nothing to migrate"* with a clean working tree — migration `0005` matches `db/src/schema/ride-tariffs.ts` exactly, and the journal entry is sequential.
2. **Money invariants hold under fuzzing.** 20,000 randomized tariff × route combinations: the breakdown summed to the total **every time**, the total never fell below the minimum fare, and `splitFare` leaked no cent at any whole percentage 0–100. Zero violations.
3. **H1 reproduced** against the built `CachingMapsProvider` — see the transcript in H1 above.

**Environment note for anyone re-running this:** `localhost:5432` on this machine is a Homebrew postgres (plus an ssh tunnel on `*:5432`), **not** the compose container — `role "taxi" does not exist`. Every db-touching command above ran with `DATABASE_URL=postgres://taxi:taxi@192.168.1.11:5432/taxi` (the container's LAN IP, confirmed serving `inet_server_addr 172.22.0.2`). The compose Redis is on **6381**. A connection failure here is the environment, not a regression.

---

## What's genuinely good

- **The `MAPS_PROVIDER_SOURCE` / `MAPS_PROVIDER` two-token split is the best decision in the PR.** Overriding the *source* keeps the real `CachingMapsProvider` in the test graph, which is the only arrangement where `expect(ctx.maps.routeCalls - before).toBe(1)` (`rides.integration.spec.ts:154`) proves anything at all about the `<€100/mo` guardrail. The sanctioned deep import in `test/harness.ts:23-25` is flagged rather than quietly done.
- **`geo.module.spec.ts:28-43` asserts what the module *binds*, not only what the factory *does*.** Both production-guard tests would pass just as happily against a `useClass: StubMapsProvider` registration with the factory sitting there as dead code — and production would still boot the stub. Very few codebases catch that.
- **`assertEntryStatus` as a TS assertion function** (`ride-entry.ts:36-46`) turns "a ride may only be created at an entry status" from a comment into a structural property. Combined with `RIDE_ENTRY_STATUSES` being the single place naming a status, the entry-vs-transition divergence from #9 is not merely documented — it's enforced.
- **Config-not-constant is proven by tests that fail if anyone regresses it.** `pricing.service.spec.ts:86-97` moves only a config row and asserts the split follows; `tariff.test.ts:34-44` asserts `baseCents` is *required*, with a comment saying outright that if the test ever needs changing, someone has added a default. The Level-4 smoke test (`UPDATE platform_config SET commission_pct = 12`, no restart) closes the loop.
- **Parse-at-every-boundary is applied consistently** — DB rows, cache entries and socket payloads are all parsed, never cast. The two-layer money invariant (`assertFareQuoteConsistent` in the service, `fareSplitSchema`'s refinement inside `splitFare`) means a rogue strategy fails loudly rather than silently shorting a driver.
- **Log hygiene** — `pricing.service.ts:61-70` deliberately carries distance and duration but no coordinates or addresses, with a comment naming the standard it obeys. Easy to get wrong; got right.
- **The E.164 range docblock** at `rides.integration.spec.ts:11-17` turns a painful debugging session into a note that saves the next person the same afternoon. Worth keeping as a house pattern.

---

## Probed and found clean

Recorded so they are not re-litigated:

- **`routeCacheKey` collisions** (`caching-maps.provider.ts:26-38`) — unreachable. Each point renders as one `|`-free `lat,lng` token, so token count equals point count and the sequence is unambiguous (`from` first, `to` last). `toFixed` avoids the float-text problem the docblock names, and `(-0).toFixed(4)` is `"0.0000"`, so there is no negative-zero split either. Pinned from both ends by `caching-maps.provider.spec.ts:59-66` and `rides.integration.spec.ts:161-166`.
- **Breakdown / total consistency** (`upfront-fixed.strategy.ts:39-62`) — the total is *literally* the sum of the three rounded lines, so `isFareQuoteConsistent` cannot be false for any input; each line is a `Math.round` of a product of integers, so no float escapes. `int4` overflow on `rides.total_cents` is unreachable (worst case ~10⁷ cents). Confirmed empirically by the 20k fuzz above.
- **Commission split** (`money.ts:40-42`, `commission.ts:78-88`) — `driverNetCents` derived by subtraction, sum re-checked by `.refine()` at every parse boundary. No leak at any pct, including 0.
- **Smuggled `riderId`** — verified end to end. Zod 3 strips unknown keys under default `strip` mode, so `.omit({riderId: true})` drops it at the pipe, and `rides.service.ts:37` re-parses `{...body, riderId}` with the server's value. Proven at three levels, including a live attacker/victim case at `rides.integration.spec.ts:195-213`.
- **Transaction boundary** (`rides.repository.ts:65-105`) — the fare-lines insert is inside the same `tx`, so a failure rolls the ride back. `toRide`'s `rideSchema.parse` also runs inside the transaction, so a jsonb round-trip that failed to re-hydrate rolls back rather than orphaning a row. `scheduledFor` survives: `Date → JSON.stringify → ISO string → z.coerce.date() → Date`.
- **Emitted `ride:status` payload** parses against `RT_EVENT_SCHEMAS` (`realtime.service.ts:68`) — `previousStatus`/`reason` are `.nullable().default(null)`, `at` is `toISOString()` satisfying `z.string().datetime()`. No reachable parse failure.
- **Seed idempotency** (`db/src/seed/riga.ts:144-153`) — `onConflictDoUpdate` on `[cityId, category]` matching the unique index, deterministic per-category UUIDs, re-runs converge. Iterating `RIDE_CATEGORIES` rather than `Object.keys(TARIFFS)` makes a new category fail **typecheck** instead of silently under-seeding.
- **Production guard** (`geo.module.ts:17-24`) — throws under `NODE_ENV=production`, and the binding itself is asserted, not just the factory.
- **Payment lock** — `paymentMethod` is written once at creation with no update path in this PR, so `isPaymentMethodLocked()` cannot be bypassed here.

---

## Recommendation

**Request changes.** The blocking work is small and well-shaped:

1. **H1** — guard the cache read, delete the poisoned key, flip the spec to assert recovery. A few lines.
2. **M1** — rate-limit `POST /rides` with the auth slice's existing `incrWithTtl` pattern. **This one is a hard gate on #13**: it must land before a paid Routes provider is bound, or the `<€100/mo` guardrail is defeated by a for-loop.
3. **M2** — one-line reorder in `PricingService.quote`.

M3–M5 and the Lows can reasonably be batched or deferred with a named owner.

**Advisory, not blocking:** this PR edits `services/api/CLAUDE.md` and `.claude/references/realtime-events.md`. Per the root `CLAUDE.md`, `rules-check-drift` is worth a pass before merging anything that changes stated rules. Both edits look accurate against the code as written.

Natural next step: `piv-fix-review-findings` on this report, then re-run the gate.
