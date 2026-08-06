# Implementation Report — `Idempotency-Key` on POST /rides

**Plan**: `.claude/plans/api-rides-idempotency.md`
**Branch**: `feature/api-rides-idempotency` (worktree `taxi-46-idempotency`, based on `c877ed1` = `origin/main`)
**Status**: COMPLETE

## Summary

`POST /rides` now requires a client-minted `Idempotency-Key` uuid header. The
server reserves `rides:idem:<riderId>:<key>` atomically with `SET NX EX` before
the rate limit, creates the ride, then overwrites the marker with the ride id;
a repeat inside the 24h window replays the same ride out of Postgres without
spending a Routes call, and a repeat landing while the first is still in flight
gets `409 idempotent_request_in_progress`. Any pre-commit failure releases the
key, so a maps outage or a single 429 does not burn the rider's key for a day.
The header name and key schema live in `@taxi/shared`; the API imports them and
never redeclares the literal.

## Tasks completed

**Phase 1 — the shared contract**
- Header constant + key schema → `packages/shared/src/idempotency.ts` (CREATE)
- Barrel export → `packages/shared/src/index.ts` (UPDATE)
- Contract tests → `packages/shared/tests/idempotency.test.ts` (CREATE)

**Phase 2 — the atomic KV primitive**
- `setIfAbsent` on the port → `services/api/src/common/kv/kv.store.ts` (UPDATE)
- `SET NX EX` impl → `services/api/src/common/kv/redis-kv.store.ts` (UPDATE)
- In-memory impl through `live()` → `services/api/test/harness.ts` (UPDATE)
- Live-Redis contract tests → `services/api/src/common/kv/redis-kv.store.spec.ts` (UPDATE)

**Phase 3 — service + controller**
- TTL / pending marker / key builder → `services/api/src/features/rides/rides.policy.ts` (UPDATE)
- `previewSplit` → `services/api/src/features/pricing/pricing.service.ts` (UPDATE)
- reserve / replay / release, `createRide`, `recordIdempotency` → `services/api/src/features/rides/rides.service.ts` (UPDATE)
- Pipe-accepting param decorator → `services/api/src/features/rides/idempotency-key.decorator.ts` (CREATE)
- Header binding → `services/api/src/features/rides/rides.controller.ts` (UPDATE)

**Phase 4 — tests, gap removal, docs**
- Unit tests → `services/api/src/features/rides/rides.service.spec.ts` (UPDATE)
- 11 header threads + 3 new cases → `services/api/src/features/rides/rides.integration.spec.ts` (UPDATE)
- `bookRide` header → `services/api/src/features/dispatch/dispatch.integration.spec.ts` (UPDATE)
- `NOT IDEMPOTENT` bullet deleted → `services/api/src/features/rides/index.ts` (UPDATE)
- One rules line → `services/api/CLAUDE.md` (UPDATE)

## Tests added

**`packages/shared/tests/idempotency.test.ts`** (3) — uuid round-trip (expected);
header constant is exactly the lowercase Express hands the server (edge); `''`,
`'book'` and a 36-char non-uuid rejected (failure).

**`redis-kv.store.spec.ts`** (2, live Redis) — `setIfAbsent` reserves once,
refuses to overwrite (the stored value is still the first one), and `ttl() > 0`
proving `EX` applied (expected); an expired key is reservable again, exercised
against a real 1s expiry rather than a fast-forward (edge).

**`rides.service.spec.ts`** (6 new, in a nested `idempotency` describe) —
repeated key replays with exactly one `pricing.quote` and one `rides.create`
(expected, AC#1); different keys create two distinct rides (edge, AC#2); same
key past `RIDE_IDEMPOTENCY_TTL_SECONDS` creates a new ride (edge, AC#3); a
repeat while the first is parked inside `pricing.quote` gets 409 and only one
ride is created (failure); a failed first attempt leaves the key absent and an
honest retry over the same store books (failure); `MAX_PER_WINDOW + 5` replays
charge no quota, so a new key is still served (edge).

**`rides.integration.spec.ts`** (3 new) — same key twice → both 201, identical
ride id, identical split, and exactly **one** `rides` row for that rider
(expected); missing header and `not-a-uuid` header both 400 with zero rows
(failure); two riders sharing one key get two different rides (edge).

**Mutation check.** With `InMemoryKeyValueStore.setIfAbsent`'s guard removed
(the store always reports "reserved"), 3 of the new unit tests fail — the
replay, the 409 and the quota case. The assertions bite on the actual bug, not
on incidental structure.

## Validation results

Gate, from a cleared dist with both env vars set:

```
COMPOSE_PROJECT_NAME=taxi REDIS_PORT=6381 \
DATABASE_URL=postgres://taxi:taxi@192.168.1.11:5432/taxi \
REDIS_TEST_URL=redis://localhost:6381 \
pnpm turbo run typecheck lint test build --force
```

**18/18 tasks successful.**

| | result |
|---|---|
| typecheck | pass (all packages) |
| lint | pass — 0 errors, 4 warnings, all pre-existing `getHttpServer()` `no-unsafe-argument` in four integration specs, untouched by this ticket |
| test — `@taxi/shared` | 11 files pass (118 tests, +3) |
| test — `@taxi/db` | 3 files pass |
| test — `@taxi/api` | 39 suites / **262 tests** pass, Redis suites live (not skipped) |
| build | pass |

Checklist greps: `grep -rn 'NOT IDEMPOTENT' services/api/src` → none;
`grep -rn "'idempotency-key'" services/api/src` → none.

## Deviations from the plan

1. **`replay()` returns `RideCreated | undefined`, not `RideCreated`.** The plan
   left the `!found` branch as a sketch while stating the intent ("falls through
   to a fresh create"). A method that must both return a ride and fall through
   needs the undefined; `request()` does `if (replayed) return replayed;` and
   otherwise drops into the create path. Documented in the code: on that path
   the key holds a stale ride id rather than `pending`, so two callers hitting
   it at once would both create. Left unhardened deliberately — rides are never
   deleted, so it is defensive-only, and guarding it would cost a second
   reservation round trip on every request.

2. **The `rides.create` test fake mints a fresh id per call** and a `Map` backs
   the `findWithQuote` fake, instead of the plan's constant `RIDE_ID`. The plan
   offered this as optional; without it, test #1's "identical ride id" assertion
   holds whether or not the replay path ever ran. Test #2 and #3 now assert
   distinct ids *and* call counts.

3. **`previewSplit` is duplication by design, not an extraction.** `quote()`
   keeps its own inline config read and `splitFare` call — routing it through
   `previewSplit` would double the (deliberately uncached)
   `PlatformConfigService.forCity` read on the hot path. Stated in the method's
   docstring so it does not read as copy-paste.

   Consequence worth naming: the replay recomputes the split from **current**
   `platform_config`, so a commission change inside the 24h window makes a
   replayed `split` differ from the one the original 201 returned. That is the
   plan's own logic applied consistently — it re-reads Postgres rather than
   replaying a frozen snapshot precisely so a replay returns the truth (the
   same argument it makes for returning the ride's *current* status after #10
   has dispatched it). The split is computed and persisted nowhere, and the
   settled split is #11's. No test can see this: config is static mid-run.

4. **Two extra tests beyond the plan's list.** A live-Redis expiry case on
   `setIfAbsent`, and an integration case proving the key is rider-scoped (two
   riders, one key, two rides) — the plan named that edge in its testing
   strategy but assigned it no task.

5. **A header was added to the 403 case** (`:251`) as well as the 11 the plan
   named. The guard rejects before the pipe, so it changes nothing; uniformity
   makes the 401 case's deliberate omission the only exception, and it now
   carries a comment saying why.

Decided in the plan and implemented as specified, recorded here so review does
not re-open them: **Q1** the header is required, not optional; **Q2** no request
fingerprint stored beside the ride id; **Q3** a 24h window; **Q4** a truly
concurrent repeat gets 409 rather than the ride id.

## Issues encountered

**`pretest` starts a second compose project from a worktree.** `services/api`'s
`pretest` runs `docker compose -f ../../docker-compose.yml up -d --wait db`, and
compose derives its project name from the compose file's directory — from
`taxi-46-idempotency/` that is a *new*, empty project competing for host port
5432, and this worktree has no `.env` to pin `REDIS_PORT`. Every api test run
here (and the gate itself) needs `COMPOSE_PROJECT_NAME=taxi REDIS_PORT=6381`
exported, which makes the compose call a verified no-op against the already
running `taxi` project. Not a code problem and not fixed here — worth knowing
before the next worktree run, and worth considering for the plan template.

**`@taxi/db` dist was missing in the fresh worktree**, so a direct
`pnpm --filter @taxi/api exec jest` failed in `globalSetup` before running
anything. `pnpm turbo run build --filter @taxi/db --filter @taxi/shared` fixes
it; the plan's per-task `pnpm --filter @taxi/api ...` validations assume a warm
dist, and after Phase 1 they also need `@taxi/shared` rebuilt or they report a
missing export that is really a stale build.

## Ready for the next step

All plan tasks are complete, every acceptance criterion is covered by a test,
and the gate is green. Next: `piv-commit`, then `piv-create-pr` (this report
fills the PR body), then `piv-review-pr`.
