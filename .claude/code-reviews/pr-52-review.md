# PR #52 Review — `feat(api,shared): idempotent POST /rides via a client-minted key (#46)`

**Branch** `feature/api-rides-idempotency` → `main` · **HEAD** `5d9ad8a` · **19 files, +1615 / −52**
**Reviewed with fresh eyes** (clean context + the read-only `code-reviewer` agent), against `CLAUDE.md`, `services/api/CLAUDE.md`, `packages/shared/CLAUDE.md`, `.claude/references/logging-standard.md`, and the ticket's own plan and implementation report.

**Recommendation: approve** — 0 Critical · 0 High · 3 Medium · 2 Low.

The mechanism is right and the gate is genuinely green. Every load-bearing claim in the PR body was re-run rather than taken: `setIfAbsent` really is one atomic round trip, the post-commit boundary really holds, the fake's expiry semantics really match Redis, and the live-Redis suites really executed. The three Mediums are one missing test and two missing doc bullets — all additive, none a change to shipped behaviour.

---

## Summary

`POST /rides` now requires a client-minted `Idempotency-Key`. The rider-scoped reservation is taken atomically before the rate limit, released on any pre-commit failure, and promoted to the ride id after the insert commits; a repeat inside 24 h replays out of Postgres with no paid Routes call, and a repeat landing mid-flight gets a 409.

**No hard-rule violations found.** Verified across the diff: money is integer cents throughout; `previewSplit` resolves the commission through `resolveCommissionPct()` against the `platform_config` row, never a literal or a default; the header name and key schema live in `@taxi/shared` and are not redeclared in the API (`grep -rn "'idempotency-key'" services/api/src` → nothing but two docstrings); `@taxi/shared` imports nothing from the workspace; this slice performs no state transition, so `assertTransition()` is not in play; no PII in any new log; `rides.service.ts` is 318 lines, under the cap.

Option B — a client-minted key rather than a server-side fingerprint — is the right call and the plan argues it properly: a pickup/destination/payment hash would merge two genuine airport runs 90 seconds apart *and* still double-book a rider who nudges the pin 15 m.

---

## Validation

Re-run by the reviewer from the worktree, from a cleared dist, with `DATABASE_URL` on the LAN IP and `REDIS_TEST_URL` set so the Redis suites run live rather than `describe.skip`ping:

```
COMPOSE_PROJECT_NAME=taxi REDIS_PORT=6381 \
DATABASE_URL=postgres://taxi:taxi@192.168.1.11:5432/taxi \
REDIS_TEST_URL=redis://127.0.0.1:6381 \
pnpm turbo run typecheck lint test build --force
```

| | result |
|---|---|
| **turbo** | **18/18 tasks successful**, 0 cached |
| typecheck | pass, all packages |
| lint | pass — **0 errors**, 4 warnings |
| `@taxi/shared` | 11 files pass (118 tests) |
| `@taxi/db` | 3 files pass |
| `@taxi/api` | **39 suites / 262 tests pass**, 0 skipped |
| build | pass |

Matches the PR body's numbers exactly. Two checks worth recording because a green gate could otherwise prove nothing here:

- **`redis-kv.store.spec.ts` PASSED, not skipped**, and Jest reported *no* skipped tests in the run. The `SET NX EX` primitive — the thing this whole PR rests on — was exercised against real Redis, not just the in-memory fake.
- **The PR's falsifiable greps both hold**: `'idempotency-key'` and `NOT IDEMPOTENT` each return nothing in `services/api/src`.

**Gate reproduction note (not a finding).** From a worktree the gate needs `COMPOSE_PROJECT_NAME=taxi REDIS_PORT=6381` exported. Without them, `services/api`'s `pretest` derives a new compose project from the worktree directory name and dies on `Bind for 0.0.0.0:5432 failed: port is already allocated`. The implementation report documents this; the first run here hit it exactly as described, and the stray container was cleaned up. Worth folding into the plan template, as the report suggests.

---

## Issues

### 🔴 Critical

None.

### 🟠 High

None. The post-commit boundary — the single most likely place for a High in a change like this — holds under a statement-by-statement trace. See *What's good* below.

---

### 🟡 Medium

#### M1 · Reliability · `rides.policy.ts:28`, consumed at `rides.service.ts:82-86`

**The `pending` marker and the settled ride-id mapping share one 24-hour TTL, so a process death inside the commit window strands the key for a full day.**

`setIfAbsent(key, RIDE_IDEMPOTENCY_PENDING, RIDE_IDEMPOTENCY_TTL_SECONDS)` writes the in-flight lock with the same 86 400 s window the resolved mapping gets at `rides.service.ts:249`. Nothing shortens it.

Failure scenario — a Railway rolling restart (#13), an OOM kill, or an LB timeout landing in the sub-second window between `rides.create` committing and `recordIdempotency` running:

1. `rides.create` commits. A `requested` row with a null `driverId` exists.
2. The process dies before the mapping write. The key is still `pending`.
3. `DispatchSweeper.tick()` picks the row up — `findAwaitingDispatch` filters on exactly `status = 'requested' AND driver_id IS NULL` (`rides.repository.ts:151-159`, verified) — and dispatches a car.
4. The rider never received a 201, so they hold no ride id. Every retry with that key hits `replay()` → `stored === 'pending'` → `409` (`rides.service.ts:184-194`), **for 24 hours**.

A car reaches a kerb for a rider whose app shows a failed booking — the harm #46 exists to prevent, arriving through a different door. The milder variant is a crash *before* commit: no ride, but the key is dead for a day, and the user story's "flaky LTE hop" retry is exactly the case meant to reuse it.

`recordIdempotency`'s docstring does justify a stuck `pending` — *"The rider already has the ride id from the 201, and a 409 is strictly better than a duplicate car."* That is sound for the case it was written for: a Redis blip on the mapping write, after the 201 is already on its way. It does not hold when the process is gone and no 201 was ever sent. The gap is a correct argument applied outside its case, and neither the plan's edge-case list nor the report's deviations mention process death.

**Fix — the constraint comes first.** Any short pending TTL must comfortably exceed the worst-case first-request duration (config read + Routes call + the two-table transaction); if it doesn't, a slow first request lets a second reserve and #46 is back.

- (a) Add `RIDE_IDEMPOTENCY_PENDING_TTL_SECONDS = 120` beside the existing constant and pass it at `rides.service.ts:85`. `recordIdempotency` already promotes the key to the full window, so this is one constant plus one argument. Document the "must exceed worst-case request duration" constraint in its docstring, in the style the other policy constants use.
- (b) Leave it and add a `KNOWN GAPS` bullet in `services/api/src/features/rides/index.ts` naming the crash-window residue.

For a <10-driver pilot, (b) is a defensible KISS call. **Either is fine; carrying it silently is not.** This is a judgement call for the author, not a mechanical fix.

#### M2 · Testing / money path · `pricing.service.ts:91-95`

**`previewSplit` — a deliberate duplicate of the commission path — ships with no test that it reads `platform_config` rather than a literal.**

`pricing.service.spec.ts` already guards this invariant for `quote()` and says why: *"This test exists to catch a regression to a constant: if it ever needs a CODE edit to pass, someone has hardcoded the commission again."* `previewSplit` re-implements the same three lines and inherits no such guard. `grep -n previewSplit services/api/src/features/pricing/pricing.service.spec.ts` → **no matches** (verified).

Neither existing test would catch a hardcoded percentage:

- `rides.service.spec.ts:88` fakes `previewSplit` outright — it returns a canned split and never touches `PricingService`.
- `rides.integration.spec.ts:296`, `expect(two.split).toEqual(one.split)`, compares a `quote()`-produced split against a `previewSplit()`-produced one. **The seeded `commission_pct` is 15, so a `previewSplit` hardcoded to 15 % passes this assertion identically.** It cannot distinguish the config read from a constant.

Deviation 3 documents *why* the duplication exists (avoiding a doubled uncached `forCity` read on the hot path — defensible). It doesn't document that the duplication left a tested invariant untested. That's an undocumented consequence, not a re-litigation of the settled decision — and it is the one place this PR touches the "commission is never a literal" hard rule.

**Fix** — one case in `pricing.service.spec.ts`, reusing the existing `build()` harness:

```ts
it('resolves the preview split from the config row, not a constant (edge)', async () => {
  const { service, routeCalls } = build({ commissionPct: 12 });
  const split = await service.previewSplit(1_300);
  expect(split.commissionPct).toBe(12);
  expect(split.commissionCents).toBe(156);
  expect(split.commissionCents + split.driverNetCents).toBe(1_300);
  expect(routeCalls()).toBe(0); // the replay path spends no paid call
});
```

The `routeCalls() === 0` line is worth keeping — it pins the other reason `previewSplit` exists.

#### M3 · Documentation · `rides.service.ts:74-89`

**The replay path is entirely unthrottled, and that consequence is recorded nowhere.**

`replay()` returns at `:89`, before `assertWithinRateLimit` at `:99`. **The ordering itself is correct** and should not change — the plan argues it at length (the cap bounds paid Routes calls; a replay reaches none; charging it would throttle exactly the rider this feature protects) and `rides.service.spec.ts:379` pins it.

What's missing is the other half of the sentence. There is no global throttler in the app (`grep -rn "Throttler" services/api/src services/api/package.json` → nothing, verified), so an authenticated rider looping one key issues unbounded replays, each costing three Postgres reads that nothing bounds: `rides`, `ride_fare_lines`, and `platform_config` via `previewSplit` — the last deliberately uncached. Before this PR, every path through `POST /rides` was covered by `RIDE_REQUEST_MAX_PER_WINDOW`; now one isn't. `services/api/CLAUDE.md:16` states the standing rule as *"Paid-call spend is bounded from both ends… A new ride-creating path needs both"*, and the file that lists accepted gaps doesn't say this path is bounded on one end only.

**Fix** — a `KNOWN GAPS` bullet in `services/api/src/features/rides/index.ts`, in the register the four existing bullets use. Something like: *"A REPLAY IS UNTHROTTLED. The reservation sits above the rate limit because a replay spends no paid Routes call; the consequence is that a repeated key costs unbounded Postgres reads. Accepted for the pilot: it needs a valid rider JWT and buys an attacker nothing a fresh key would not."* If that framing stops being true under load, a separate and much larger replay cap is the escalation — not a change to the ordering.

---

### 🔵 Low

#### L1 · Logging · `rides.service.ts:186`

`ride.request.in_progress` is a state with no verb. `logging-standard.md:8` specifies `action_state` as "verb + state", and every example (`offer_sent`, `offer_expired`, `match_failed`, `transition_rejected`) and every sibling in this file (`created`, `failed`, `throttled`, `notify_failed`, `replayed`, `idempotency_write_failed`, `replay_missing`) carries one. **Fix:** `ride.request.replay_conflicted`, or `replay_in_progress`.

#### L2 · Accuracy of the PR body · not a code issue

The PR body and the implementation report both describe the 4 lint warnings as *"in integration specs this ticket did not touch"* / *"four integration specs, untouched by this ticket"*. Two of the four **are** touched by this PR: `rides.integration.spec.ts` (+120) and `dispatch.integration.spec.ts` (+3).

The substantive claim survives — `getHttpServer` appears nowhere in the code diff, so the warning *lines* are pre-existing and this PR introduces no new warning. Only the wording is wrong. Flagged because "untouched by this ticket" is the kind of claim a future reviewer will take at face value.

---

## What's good

**The post-commit boundary claim holds — traced statement by statement, not accepted.** After `rides.create` at `:128`:

- `recordIdempotency` (`:247-258`) wraps its `await` in try/catch and only logs. Cannot throw.
- `notifyRider` (`:294-317`) wraps both realtime calls. The non-obvious part is *why* that's sufficient: `joinRideRoom` and `emitToRide` both return `void` synchronously — had either returned a promise, the un-awaited rejection would have escaped the catch entirely. The comment at `:297-299` names this and is accurate.
- The `logger.log` at `:139-149` dereferences `ride.createdAt.toISOString()`. Safe, because `toRide` runs `rideSchema.parse` with `z.coerce.date()`, so `createdAt` is a real `Date` and not a driver-returned string or null.

Worth naming as an observation rather than a defect: **the boundary is enforced by a comment plus the swallowing discipline of the two methods below it, not by structure.** `createRide`'s catch (`:152-164`) rethrows anything, so a future post-commit statement that throws would reach the outer catch, delete the reservation, and hand the rider a retry that books a second car. Nothing can today. Nothing stops tomorrow — worth a thought if this method grows.

**Every pre-commit throw path releases the reservation, and the 409 path correctly does not.** Body rejections fire before any reservation exists; the 429 and both `createRide` failures sit inside the try and reach `kv.del` at `:110`. Critically, the 409 is thrown from *outside* that try — a request landing on someone else's live reservation must never delete it, and the structure makes that impossible rather than merely unlikely. The `.catch(() => undefined)` on the release is right too: if Redis is the thing that's down, a throw there would replace the real error with a Redis one.

**`setIfAbsent` is genuinely one atomic round trip.** `redis-kv.store.ts:36` is a single `SET key val EX ttl NX`, compared against `'OK'` rather than coerced. `redis-kv.store.spec.ts` asserts the *declined* call changed nothing (`get(key) === 'first'`) — which is what separates a correct `NX` from an implementation that returns `false` while still writing. The in-memory fake goes through `live()`, not `store.has()`, so an expired key is reservable, matching Redis — and that's the only reason AC #3 can pass at all.

**The `rides.create` fake minting a fresh id per call (deviation 2) is the best decision in the test suite.** With the plan's constant `RIDE_ID`, `expect(second.ride.id).toBe(first.ride.id)` would hold whether or not the replay path ever ran, and every idempotency test would have passed on the bug. It fixes a real hole in the plan.

**The tests bite on the bug.** The integration `expect(rows).toHaveLength(1)` scoped to the rider is the assertion that would have caught #46 end to end. The concurrency test is real — it parks the first request inside `pricing.quote` with a deferred promise and asserts both the 409 *and* `countOf('rides.create') === 1`. The release test rebuilds a second service over the *same* store, testing the key's lifetime rather than the instance's. All three of the plan's flagged silent-failure GOTCHAs were handled: distinct keys in the route-cache test, valid headers on the 400 body cases so `malformed` still tests the body, and the 401 case left header-less with a comment saying why.

**Contract discipline is clean.** `IDEMPOTENCY_KEY_HEADER` and `idempotencyKeySchema` sit in `packages/shared/src/idempotency.ts` as a transport contract beside `money.ts`, `zod` is the only import, the type is `z.infer` rather than a twin, and both integration specs import the constant. The `createParamDecorator` workaround is correct and documented — `@Headers` really is the one built-in param decorator that takes no pipes — and the `unknown` return type is the right call, since typing it `string` would hide the missing-header case from the compiler. A missing or malformed header produces a real 400 (`validation_failed`), proven with a zero-row assertion.

Also correct: `rideIdempotencyKey` is rider-scoped, so a guessed uuid can't reach someone else's ride (with an integration test); `RIDE_IDEMPOTENCY_PENDING = 'pending'` is documented as deliberately not-a-uuid so a marker can never be mistaken for a ride id; the `KeyValueStore` port gained exactly one method with a real caller and no speculative siblings; `index.ts` lost only the `NOT IDEMPOTENT` docstring bullet and no export; `services/api/CLAUDE.md` gained one accurate line. i18n/a11y are N/A — backend only.

**Documented deviations were treated as decisions, not findings.** All five in the report check out, and the settled questions (required header, no fingerprint, 24 h window, 409 over the ride id) were not re-litigated here.

---

## Noted, not blocking

- **The plan's Level 5 manual curl loop was not run** — the author discloses this. The three integration tests cover the same path including the one-row assertion, so it's a gap in the record rather than in the coverage. Worth doing once a server is up for #16.
- **The author's mutation check was not independently re-run** (it would mean mutating a worktree another session may hold). Verified by inspection instead: the assertions are call-counts and row-counts, not bare id equality, so they do discriminate.
- **`git blame` is broken in this worktree** — `blame.ignoreRevsFile` points at a `.git-blame-ignore-revs` that doesn't exist on this branch. It comes from the unmerged #50/#51 lint work, not this PR. Same for the older lint config on this branch.

---

## Recommendation

**Approve.** No Critical, no High, a genuinely green CI-parity gate with the live-Redis suites actually running, and the hard rules hold. The implementation is correct where it counts: the reservation is atomic, the release paths are right, and the commit boundary — the place this could most easily have gone wrong — is sound.

The three Mediums are all additive and none change shipped behaviour: **M2** is ~8 lines of test on the money path and is the one I'd land before the next slice, **M3** is a `KNOWN GAPS` bullet, and **M1** is a genuine judgement call between a second constant and a documented gap — the author's to make, and "document it" may well be right for a <10-driver pilot. **L1** is a one-word rename.

`#16` must send this header before the rider app can book, and `#13` should not deploy without it.
