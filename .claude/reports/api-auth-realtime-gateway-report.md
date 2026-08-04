# Implementation Report — API auth (SMS OTP → JWT → role guards) + Socket.IO realtime gateway

**Plan**: `.claude/plans/api-auth-realtime-gateway.md`
**Branch**: `feature/api-auth-realtime-gateway` (cut from `4df9b5e`, the plan's stated baseline)
**Status**: COMPLETE — `pnpm check` green (15/15 tasks)

## Summary

Two vertical slices shipped in `services/api`: `auth` (phone-first OTP identity — Redis-backed
codes, hashed at rest, rate-limited, exchanged for a JWT) and `realtime` (a Socket.IO gateway that
verifies the JWT in the handshake and places each socket only in the rooms its role allows). Along
the way the api gained the cross-cutting plumbing every later ticket inherits — `src/common/`
(env config, Drizzle, a Redis KV port, a zod pipe) — and its first DB-backed jest harness.
All 26 tasks were executed. 34 api tests + 11 new shared tests pass; the live server was
manually exercised end to end, including the cross-node Redis adapter suite.

## Tasks completed

**Phase 1 — contracts & environment**
- Task 0 strict mode → `services/api/tsconfig.json` (UPDATE) — free, as the plan predicted
- Task 1 auth contracts → `packages/shared/src/schemas/auth.ts` (CREATE)
- Task 2 `userRoom` + `RT_EVENT_SCHEMAS` → `packages/shared/src/realtime-events.ts` (UPDATE)
- Task 3 barrel + tests → `packages/shared/src/index.ts`, `tests/auth.test.ts` (CREATE), `tests/realtime-events.test.ts` (UPDATE)
- Task 4 `migrateDb()` → `db/src/migrate.ts` (CREATE), `db/src/index.ts` (UPDATE)
- Task 5 dependencies → `services/api/package.json` (UPDATE)
- Task 6 env surface → `docker-compose.yml`, `.env.example`, `turbo.json` (UPDATE)

**Phase 2 — cross-cutting plumbing** (all CREATE)
- Tasks 7–11 → `src/common/config/{env.schema,app-config.module}.ts`, `src/common/db/db.module.ts`,
  `src/common/kv/{kv.store,redis-kv.store,kv.module}.ts`, `src/common/zod-validation.pipe.ts`

**Phase 3 — `auth` slice** (all CREATE)
- Tasks 12–16 → `auth.repository.ts`, `otp.policy.ts`, `phone-mask.ts`, `auth-token.service.ts`,
  `sms/{sms.tokens,stub-sms.provider}.ts`, `auth.service.ts`, `auth.controller.ts`, `auth.module.ts`,
  `guards/{jwt-auth,roles}.guard.ts`, `decorators/{public,roles,current-user}.decorator.ts`, `index.ts`

**Phase 4 — `realtime` slice** (all CREATE)
- Tasks 17–18 → `room-policy.ts`, `realtime.gateway.ts`, `realtime.service.ts`, `redis-io.adapter.ts`,
  `realtime.module.ts`, `index.ts`

**Phases 5–6 — harness, tests, wiring, docs**
- Task 19 → `test/{test-db,setup-env,global-setup,harness}.ts` (CREATE), jest config + `pretest` (UPDATE)
- Tasks 20–21 → `auth.service.spec.ts`, `auth.integration.spec.ts`, `room-policy.spec.ts`,
  `realtime.gateway.spec.ts`, `redis-io.adapter.spec.ts` (CREATE)
- Task 22 → `app.module.ts`, `app.controller.ts`, `main.ts` (UPDATE)
- Tasks 23–24 → `.claude/references/realtime-events.md`, `services/api/CLAUDE.md` (UPDATE)
- Task 25 → full gate

## Tests added

| File | Cases | Result |
|---|---|---|
| `packages/shared/tests/auth.test.ts` | 11 — schema round-trips, wire-vs-domain override asserted both ways, signup-role restriction, `RT_EVENT_SCHEMAS` smoke | pass |
| `services/api/src/features/auth/auth.service.spec.ts` | 10 — one SMS per request, no plaintext at rest, cooldown, hourly throttle, attempt burn, TTL not extended, wrong-vs-expired indistinguishable | pass |
| `services/api/src/features/auth/auth.integration.spec.ts` | 10 — full OTP round trip against real Postgres, no row before verify, idempotent re-sign-in, **privilege escalation blocked**, `/health` public, 400/401/403 paths | pass |
| `services/api/src/features/realtime/room-policy.spec.ts` | 6 — all four roles, `canJoin(driver, dispatchRoom) === false`, no impersonation, ride rooms closed | pass |
| `services/api/src/features/realtime/realtime.gateway.spec.ts` | 5 — handshake rejection (no token / junk token), room placement over a live socket, driver absent from dispatch board, server-orchestrated ride emit, `Date` payload throws | pass |
| `services/api/src/features/realtime/redis-io.adapter.spec.ts` | 2 — cross-node fan-out, cluster-wide `socketsJoin` (opt-in) | pass with `REDIS_TEST_URL` |

Both slices carry ≥1 expected + 1 edge + 1 failure case, named in the titles (AC #4).

## Validation results

| Level | Command | Result |
|---|---|---|
| 1 | `pnpm --filter @taxi/api typecheck && lint` | **pass**, 0 errors (1 pre-existing-style `no-unsafe-argument` warning on supertest's `getHttpServer()`) |
| 1 | `@taxi/shared` / `@taxi/db` typecheck | **pass** |
| 2 | `pnpm --filter @taxi/shared test` | **pass** — 85 tests (74 pre-existing + 11 new) |
| 2 | `pnpm turbo run test --filter @taxi/api` | **pass** — 32 tests, Redis suite skipped, no open handles |
| 3 | `pnpm check` | **pass — 15/15 tasks**, after fixing a pre-existing `@taxi/db` clock bug in a separate commit (see Issues 1) |
| 4 | live server | **pass** — `/health` 200 under the global guard; request → `{"expiresInSeconds":300,"resendAfterSeconds":60}`; resend → 429; verify → full session; socket no-token → `unauthorized`, authed → socket id; log shows `rooms_joined ["user:<id>","driver:<id>"]` with **no** `dispatch:` room; phone masked `+371*****001` |
| 5 | `REDIS_TEST_URL=… pnpm turbo run test --filter @taxi/api` | **pass** — 34 tests, `RedisIoAdapter` green rather than skipped |
| 5 | `redis-cli KEYS 'otp:*'` | **pass** — `otp:code:` present after request, gone after verify; `otp:rate:` survives (by design) |
| — | `pnpm --filter @taxi/api test:e2e` | **pass** (after a fix — see Deviation 12). Not part of `pnpm check`, but my change had broken it. |

## Deviations from the plan

1. **Task 22 (wiring) executed before Tasks 19–21 (tests).** `createTestApp()` boots the real
   `AppModule`; no spec can run until `AppModule` imports the new modules. Same content, earlier slot.
2. **Added `services/api/test/test-db.ts` (not in the plan's file list).** Jest's `globalSetup` runs in
   its own process and never sees `setupFiles`, so deriving the test-DB URL in both places risked them
   disagreeing about which database to `DROP`. One module, imported by both.
3. **`createTestApp()` gained two options.** `controllers` mounts a test-only `ProbeController`, and
   `configure` runs before `app.init()`. Both were forced: the app ships **no** non-`@Public()` route, so
   the plan's "a guarded probe route (or any non-`@Public()` route) → 401" had nothing to point at — my
   first attempt used an unknown path and got 404, because Nest resolves routing *before* guards. The
   `configure` hook exists because a WebSocket adapter must be installed before `init()`.
4. **Plan-internal contradiction resolved in favour of the GOTCHA.** Task 15 step 4 says "`kv.del` **both**
   keys" on success; the same task's GOTCHA says burning or verifying "clears the resend cooldown but
   **NOT** the hourly counter — that is deliberate". I implemented the GOTCHA (only the code key is
   deleted) since it carries the reasoning, and verified it live: `otp:rate:` survives a successful verify.
5. **`handleConnection` is `async` and awaits `client.join()`.** The plan's version leaves a floating
   promise — `join()` returns a `Promise` under the Redis adapter — which is both a lint warning and a
   real ordering hazard for cluster room membership.
6. **`JwtModule.signOptions.expiresIn` needs a cast.** `ms` types it as a template-literal union
   (`'30d' | '2h' | …`) that no env-sourced `string` can satisfy statically; cast to
   `JwtSignOptions['expiresIn']` with the reasoning in a comment. Not anticipated by the plan.
7. **`REDIS_TEST_URL` added to `turbo.json` `globalEnv`.** The plan's Task 6 lists four vars and omits
   this one — so turbo's strict env mode silently stripped it and the opt-in Redis suite stayed *skipped*
   even when the variable was set. Exactly the failure mode the plan's own Task 6 GOTCHA warns about.
8. **The gateway spec issues tokens directly instead of inserting dispatcher rows.** The gateway never
   queries the database — identity comes from the JWT alone — so the plan's `insertUser` fixture would
   have been dead weight. `insertUser` is still used by the auth integration spec, where the row matters.
9. **Added `RolesGuard` coverage (driver on `@Roles('admin')` → 403).** Not in the plan; the probe
   controller made it nearly free, and `RolesGuard` otherwise shipped with zero tests.
10. **`OTP_RATE_WINDOW_SECONDS` is a named constant** rather than an inline `3600`, matching the rest
    of `otp.policy.ts`.
11. **Fixed `test/jest-e2e.json`, which the plan scoped out.** The plan says `test/app.e2e-spec.ts` "is
    **not** run by the gate" and leaves it alone — true, but that spec boots `AppModule`, which now
    validates the environment through `AppConfigModule`, so it died with a `ZodError` on missing
    `REDIS_URL`/`JWT_SECRET`. It had no env setup of its own because `globalSetup`/`setupFiles` live in
    the package.json jest block, not this config. Added the same three keys (pointing at the harness
    files) — the spec itself is untouched and passes. Leaving a suite I broke red because the gate
    doesn't run it would just hand a reviewer a false positive.
12. **`RedisKeyValueStore.onModuleDestroy` guards `quit()` with a `disconnect()` fallback.** `quit()`
    rejects when Redis is unreachable, and an exception in a destroy hook aborts the remaining shutdown
    hooks — including the pg pool's. Not in the plan.
13. **The compose comment does not blame an SSH tunnel.** The plan's Risk 7 / Open Question 3 attribute
    the `:6379` conflict to an SSH tunnel; `docker ps` shows it is actually other projects' containers
    (`vtv-redis-1` → 6379, `merkle-email-hub-redis-1` → 6380). The mitigation (`${REDIS_PORT:-6379}`,
    6381 verified free) is unchanged and correct — only the stated cause was wrong.

## Issues encountered

1. **`@taxi/db`'s `updated_at` test failed — pre-existing bug, fixed in a separate commit (approved).**
   Reproduced on this branch *before* any edit. Cause: `rides.updatedAt` mixed two clocks —
   `defaultNow()` is the **Postgres** clock, `.$onUpdate(() => new Date())` is the **Node** clock — so
   any skew between them makes `updated_at` land before `created_at`.

   Diagnosis took three passes, and the first two were wrong, so the numbers here are the trustworthy
   ones: measuring via `docker compose exec` reported 150–260 ms, but that was **exec latency, not
   skew**. Measured properly from Node over a direct connection (round trip 1–3 ms), the real skew is
   **~65–73 ms**, and Docker Desktop **re-imposes it about a minute after any correction** — a
   privileged-container `date -s` converged it to −4 ms and it was back to +63 ms shortly after. So it
   is neither a measurement artifact nor something fixable from inside a container.

   Fix (migration `0003_updated_at_trigger.sql`): a `BEFORE UPDATE` trigger makes the **database** own
   `updated_at` on both paths, and `.$onUpdate(() => new Date())` is removed from `rides` and
   `platform_config`. Postgres has no `ON UPDATE` clause and Drizzle 0.44 cannot take `sql\`now()\`` in
   `$onUpdate` (it maps the return value through the column's driver mapper — verified, it throws
   `value.toISOString is not a function`), so a trigger is the only route. This is a real production
   fix, not a local workaround: two api nodes with disagreeing clocks would hit the same bug.
   `drizzle-kit check` passes, the dev database is migrated, and all 14 `@taxi/db` tests pass **with
   the skew still present**.

   Kept as its **own commit**, separate from the #7 work — the plan's Non-Goals rule `db` migrations
   out of this ticket, so it should be reviewable (and revertable) on its own.
2. **Risk 1 (stale `dist`) fired exactly as predicted.** The api's first typecheck after Phase 3 reported
   14 "has no exported member" errors until `@taxi/shared` was rebuilt. The plan's guard and the
   `pnpm turbo run` discipline are earning their keep; the global-setup guard is in place for next time.
3. **My first Level 4 attempt failed on `role "taxi" does not exist`** because I passed
   `DATABASE_URL=…@localhost:5432/…` explicitly. On this machine `localhost:5432` is shadowed by a local
   Postgres; the working value is the LAN IP already exported in the shell. Re-run without the override,
   everything passed. Note `.env.example` still documents the `localhost` form, which does not work here —
   pre-existing and out of scope, but worth knowing.
4. **Redis runs on 6381**, per the plan (`REDIS_PORT=6381 docker compose up -d --wait redis`).
   Root `.env` was not edited — a pre-tool hook blocks access to it — so both Level 4 and Level 5 were
   driven with inline env vars, which `@nestjs/config` honours over the file anyway.
5. **`test:e2e` still prints "Jest did not exit one second after the test run".** The suite passes.
   `--detectOpenHandles` reports no leaked handle, and a probe confirmed the KV destroy hook fires and
   `quit()` resolves; the message only appears when Redis is actually reachable (a dead port exits
   clean), so it is the graceful close's socket teardown tripping jest's one-second timer. Cosmetic,
   in a suite outside the gate — noted rather than chased further.

## Open Questions — proceeding on the plan's defaults

The plan flags five decisions for you. `/piv-implement` was invoked without answers, so each was built
as the plan recommends; none is hard to reverse, but say the word on any:

1. **No client-initiated room joins** — structurally impossible, not merely refused.
2. **`userRoom()` widens the documented room set to four** — additive, documented in Task 23.
3. **CI does not run the Redis adapter suite** — it needs a service container in `ci.yml`; deliberately
   outside this ticket's blast radius.
4. **No refresh tokens / revocation** — a stolen token is valid until `JWT_EXPIRES_IN` (30d).
5. **Only `rider`/`driver` self-sign-up** — dispatcher/admin rows must pre-exist (#20).

## Ready for the next step

`piv-commit` → `piv-create-pr` (body carries `Closes #7`) → `piv-review-pr`.

**Commit the `db` clock fix separately** from the #7 slices — `db/migrations/0003_updated_at_trigger.sql`,
`db/migrations/meta/{_journal.json,0003_snapshot.json}`, `db/src/schema/{rides,platform-config}.ts`.

**Decide the PR base first.** This branch was cut from `chore/close-6-outer-loop` (the plan's stated
baseline `4df9b5e`, and where the verified-green gate came from), which is pushed but not yet merged
into `main`. A PR against `main` will therefore also show that chore commit. Either let the chore PR
merge and rebase, or open this one with `chore/close-6-outer-loop` as its base.
