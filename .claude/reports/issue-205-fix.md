# #205 — a rejecting `init()` closes the app, and the ioredis quits move to `dispose()`

**Issue** https://github.com/linardsb/taxi/issues/205 (PR #203 round 1: L2, and L1's optional follow-up)
· **Base** `main` @ `32fb6f7` · **Branch** `fix/adapter-dispose-205`, main checkout (no other live taxi
session: `ListAgents` lists three interactive peers, none on this repo; 0 `turbo`/`jest`/`vitest`
processes before each run) · **Ran** 2026-09-14, 14:41–14:50 local (UTC+1 on this machine)

## What changed

Three files, +108 −17 (`git diff --numstat`).

**`services/api/src/features/realtime/redis-io.adapter.ts`** (+19 −3) — the `close(server)` override is
gone; the two `quit()`s are now a `dispose()` override. `SocketModule.close()`
(`@nestjs/websockets/socket-module.js:49-63`) calls the adapter's `close()` once per io server in
`socketsContainer` and then `dispose()` unconditionally, so the quits no longer depend on a gateway
having registered a server. The inherited `dispose()` is a no-op (`AbstractWsAdapter`), so the override
displaces nothing. `close(server)` keeps the base implementation, whose `forceCloseConnections` early
return is inherited either way.

`dispose()` clears `pubClient`/`subClient` **before** quitting. That restores an idempotency the old
placement had for free: `SocketModule.close()` ends with `socketsContainer.clear()`, so a second
`app.close()` called `close(server)` for no server at all — but it does reach `dispose()` every time, and
`quit()` on an ended connection rejects. The harness's own failure path is exactly that shape (the
`catch` closes, then the spec's `afterAll` closes again).

**`services/api/test/harness.ts`** (+21 −14) — `await app.init()` moved inside the `try`, so a rejecting
`init()` takes the same `catch` as a failing self-check: `app.close()`, the close error printed if it
throws, the original rethrown. The paragraph L1 flagged is rewritten; it named a dependency
("a graph with no gateway would leave both clients open") that this change retires, and it now states the
residual window below instead. The `console.error` tag reads "failed init() or self-check".

**`services/api/src/features/realtime/redis-io.adapter.spec.ts`** (+68) — a Redis-gated
`RedisIoAdapter teardown` block, two cases, on a Nest app built from an **empty** module graph so that no
gateway registers an io server:

- *expected* — `app.close()` quits both clients. Red on the old adapter (probe E).
- *edge* — a second `app.close()` on the same app resolves. This one passes on both trees: it guards the
  idempotency the move would otherwise have dropped, rather than demonstrating the old defect.

The assertion waits for each client's `end` event (2 s bound) rather than reading `status` after
`close()`. `quit()` resolves on the server's `+OK` and the `ready` → `end` transition lands later —
`observed`: `status` was still `ready` immediately after an awaited `dispose()` and `end` within 100 ms,
in a throwaway spec run at 14:43 that also confirmed `app.close()` reaches `dispose()` on a gateway-less
graph (the override was wrapped with a counter; it logged one call). A synchronous `status` assertion was
written first and failed green-tree for this reason.

## The residual window, deliberately not closed

> **Superseded by #208 — both windows in this section are closed.** The section stays as the record of
> what #205's tree did; it is no longer a description of the harness. `.claude/reports/issue-208-fix.md`
> has the fix and the two attribution pairs that pin it.

A rejecting `init()` is covered only from `registerModules()` onward. Before that,
`SocketModule.close()` has no `applicationConfig` and returns at its first line, so `dispose()` is never
reached and `configure`'s clients survive the close. The uncovered span is three calls, not two:
`applyOptions()`, `await this.httpAdapter?.init?.()` (a no-op for Express) and the parser middleware —
`nest-application.js:99-102`, none of which touches an overridden provider. Probe D is that case,
`observed` still hanging on the fixed tree. Closing it would mean the spec owning its adapter's teardown
rather than the harness, which is a larger change than #205 asked for.

A second window sits one statement *past* the guard rather than before it. The `try` body ends at
`harness.ts:586`, so `await app.listen(0, '127.0.0.1')` (`:608`) and `db: app.get<Db>(DRIZZLE)` (`:619`)
are outside it. `NestApplication.listen()` rejects on a bind error (`nest-application.js:181-185`), and a
rejection from either statement leaves `ctx` unassigned with the app open — the same #199/#205 shape, one
statement further on. Enumerated rather than closed: it is unreachable in practice (port 0 does not
collide, and `DRIZZLE` resolves in every other spec), and moving the two statements inside the `try` is a
behavioural change to a harness every integration spec shares, with no probe in this pass exercising a
rejecting `listen()`. #206 review L2(a); the comment at `:599-607` no longer claims the `catch` covers it.

Also unchanged: `close()`'s `await this.initializationPromise` (`nest-application-context.js:127`) is
`await undefined` here, because `NestApplication.init()` overrides the base and never assigns it. That is
what makes closing a never-initialised app safe at all; it was read in the #203 review and re-read here.

## The mutation

`mutate.py <n> <after|before>`, applied to `services/api/test/harness.ts` — the #199 recipe
(`.claude/reports/issue-199-fix.md`) pointed at `init()` instead of a self-check:

- `let probeCalls = 0;` at module scope before `createTestApp`;
- after `const app = moduleRef.createNestApplication();`, on the process's n-th call only, `app.init` is
  replaced. `after` runs the real `init()` and then throws (post-`registerModules`, the
  `onModuleInit`-failure shape the issue names); `before` rejects without running it (pre-
  `registerModules`).
- n = 2 is `nodeB` in the Redis-gated cross-node block, as in #199.

The anchor sits above `await app.init()` on both trees, so the same mutation applies to the fixed and the
unfixed harness. After each probe the file was restored from a saved copy and `cmp` confirmed it; the
final tree was `cmp`-verified against all three saved copies before the gate.

## Probes

All from `services/api`, `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381`
(`taxi-redis-1` Up, healthy, 6381), `npx jest src/features/realtime/redis-io.adapter.spec.ts`. Wall = `date`
either side. "did not exit" counts the `Jest did not exit one second after…` line.

| Probe | Adapter | Harness | Spec | Mutation | Result |
|---|---|---|---|---|---|
| A | old | old | old | n = 2 `after` | ❌ `timeout 45` → **exit 124, 45 s** (14:41:22–14:42:07). `2 failed, 3 passed, 5 total`, 1 "did not exit". Main's head, for the baseline. |
| B | new | **old** | new | n = 2 `after` | ❌ `timeout 45` → **exit 124, 45 s** (14:45:05–14:45:50). `2 failed, 5 passed, 7 total`, 1 "did not exit". |
| C | new | **new** | new | n = 2 `after` | ✅ **exit 1, 3 s** (14:45:54–14:45:57). `2 failed, 5 passed, 7 total`, 0 "did not exit". |
| D | new | new | new | n = 2 `before` | ❌ `timeout 45` → **exit 124, 45 s** (14:46:00–14:46:45). The residual window above. |
| E | **old** | new | new | none | ❌ `timeout 75` → **exit 124, 75 s** (14:43:41–14:44:56). `1 failed, 6 passed, 7 total`; the failure is `client still ready 2 s after close()`. |
| F | new | new | new | none | ✅ **exit 0, 4 s** (14:49:42–14:49:46). `7 passed, 7 total`, 0 "did not exit". |

**B versus C is the attribution pair**: same adapter, same spec, same mutation, and the harness is the
only file that differs — so the `try` placement is what turns the hang into a 3 s exit, not the adapter
change. A is not that pair (it predates the new spec, which is why its total is 5 and B/C's is 7); it is
the "at main's head" baseline and reproduces #199's row 1 shape on the `init()` path.

**E is the adapter half's pair**: only the adapter differs from F, and the new *expected* case is red
without it. E also hangs, and what holds it open is the four clients of the block's two gateway-less apps
(two each, and the *edge* case's app leaks them while still passing its own assertion). nodeA's and
nodeB's are quit even on the old adapter, because those apps do register a server.

Logs `probeA.log`, `probeB.log`, `probeC.log`, `probeD.log`, `probeP4-red.log` (= E), `probeF.log` in this
session's scratchpad, not committed.

## Gate

`observed` — `record-gate.sh --clean` (`pnpm turbo run typecheck lint test build --force` from cleared
`dist`/`.next`), `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://localhost:6381`, on a **clean**
tree at `12d106d`, 15:22:15–15:23:47 local, exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m31.367s
```

    @taxi/api       Test Suites: 77 passed, 77 total · Tests: 726 passed, 726 total
    @taxi/dispatch  Test Files 27 passed (27) · Tests 224 passed (224)
    @taxi/driver    Test Suites: 41 passed, 41 total · Tests: 218 passed, 218 total
    @taxi/rider     Test Suites: 29 passed, 29 total · Tests: 140 passed, 140 total
    @taxi/db        Test Files 3 passed (3) · Tests 17 passed (17)
    @taxi/shared    Test Files 24 passed (24) · Tests 231 passed (231)

Not in the graph: `@taxi/config#{build,lint,test,typecheck}`, `@taxi/driver#build`, `@taxi/rider#build` —
the same six as #199's and #203's stamps.

`726 = 724 + 2`, `derived`, on the condition that 724 still holds at this branch's base. It does: 724 is
#203's review stamp at `cedc2a0`, and `git diff --stat cedc2a0..32fb6f7` is four `.claude/` docs plus
`services/api/test/harness.ts` — whose whole change is the 4-line L1 comment clause this PR retires. No
test file moved, so the count carries and the two new cases are the entire delta. Suite count is
unchanged at 77 because they went into an existing file. The Redis-gated block ran (it is
`describe.skip` otherwise), so 726 is the with-Redis total, not the CI-equivalent one.

**This stamp replaces the one this report shipped with, whole rather than by the digit** (#206 review
L3). That one named `274dc0c`, a sha amended away before the push: it resolves in no clone but the
authoring checkout (`gh api repos/linardsb/taxi/commits/274dc0c` → 422 *No commit found*,
`git branch -r --contains 274dc0c` empty), so its gate could not be audited by anyone. The two sentences
around it were false as well — `274dc0c^` and `HEAD^` were both `8e56fe6`, making the head an **amend**
of it rather than a commit on top, and `git ls-tree 274dc0c -- .claude/reports/issue-205-fix.md` prints
the path, so "a report cannot stamp the commit that contains it" was refuted by the commit it described.
The counts themselves always held; three earlier runs of this pass reported the same 22/22 and the same
six package totals, at `32fb6f7` dirty (`1m22.01s`), at `274dc0c` (`1m23.233s`) and on the #206-fix tree
before it was committed (`1m33.89s`).

"Clean" is reader-checkable without the gate script's own record, which `.gitignore:25` keeps out of the
repo: `record-gate.sh` prints a `(dirty tree — this run covers uncommitted changes … does not contain.)`
line under the stamp whenever `git status --porcelain` is non-empty, and the run above printed none.

`12d106d` is pushed and resolvable, and the gate above ran on it with nothing uncommitted. The only
commit after it on this branch is the docs commit carrying this paragraph and
`.claude/reports/pr-206-review-fixes.md`: `git diff --stat 12d106d..HEAD` is those two `.claude/` files
and nothing else, and no task in the gate's graph reads `.claude/`.

The first gate of this pass (14:46:54–14:47:50, 53.683 s) was **RED**, `Failed: @taxi/api#lint`, on
`redis-io.adapter.ts` `await-thenable`: "Unexpected iterable of non-Promise values passed to promise
aggregator" for `Promise.all(clients.map((c) => c?.quit()))` over a `(Redis | undefined)[]`. Rewritten to
the array-literal form the deleted `close()` already used — `Promise.all([pub?.quit(), sub?.quit()])` —
which the rule accepts. Probe F and the gate above are on that version.

## Production

`src/main.ts:19` calls `app.enableShutdownHooks()`, so SIGTERM reaches `app.close()` and now the quits
through `dispose()`. Production always has `RealtimeGateway` in the graph, so `close(server)` reached them
before too; the change makes that independent of the graph rather than adding a guarantee. `expected` —
no production shutdown was run for this.

## Not done

- No shippable test covers the *harness* half: forcing `init()` to reject needs the mutation, as in #199.
  Probes A–D are the evidence. **Retired by #208**: `configure` runs before `init()` and is handed the
  app, so replacing `app.init` from a spec drives the same failure with no mutation at all.
- The residual pre-`registerModules()` window stays open, `observed` in probe D and stated in the
  harness comment. **Closed by #208**, along with the listen/`DRIZZLE` window past the `try`.
- `CLAUDE.md`'s Redis-gated line (`33 skipped, 582 passed, 615 total`, 2 skipped suites) is still stale —
  now against **`37 skipped, 689 passed, 726 total`** and `Test Suites: 2 skipped, 75 passed, 75 of 77
  total`. `observed`, `env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi npx jest` in `services/api`,
  14:50:16–14:50:56, exit 0. The two new cases raise the *skipped* count, not the passed one — both sit in
  a `describeWithRedis` block — and the skipped-suite count stays 2, because
  `redis-io.adapter.spec.ts` still has its ungated CORS describe. Left for `system-evolution-review`, as
  #194, #196 and #199 did.
