# PR #206 review — quit the redis clients from `dispose()`, and close on a rejecting `init()` (#205)

**Head** `0763bc0` · **Base** `main` @ `32fb6f7` · round 1 · reviewer: `code-reviewer` agent (fresh context) + this session's numbers, probe and mechanism passes · 2026-09-14

Four files, +271 −17. The `close(server)` override becomes a `dispose()` override that clears both client
references before quitting; `await app.init()` moves inside the `try` that already closed the app on a
failing self-check; a Redis-gated `RedisIoAdapter teardown` block covers the gateway-less graph.

**Recommendation: approve.** No Critical, no High. Three Lows, all about claims rather than code: a test
comment the PR's own probe log refutes (L1), an incomplete enumeration of what is deliberately left
uncovered (L2), and a gate provenance sha that no reader can resolve (L3). Every mechanism claim in the
PR body, the report and the two rewritten comments was checked against `node_modules/@nestjs/**` and
holds. Four of the six probe rows were re-run here and reproduced to the digit.

## Issues

### L1 · Low · the edge case's comment describes a path this PR's own probe run disproves

`services/api/src/features/realtime/redis-io.adapter.spec.ts:263-265`

> `// The harness closes the app itself when `init()` or a self-check throws,`
> `// and the spec's `afterAll` then closes it again.`

It does not. When `createTestApp` throws, the caller's `ctx` is never assigned, so its `afterAll` throws
`TypeError` instead of closing the same app a second time — which is what `services/api/test/harness.ts:543`,
four lines of the same diff away, says: "`afterAll`'s `ctx.app.close()` **throws on top of it**". The two
comments cannot both be right.

`observed`, in this session's re-run of probe C (new adapter + new `harness`, `n = 2 after` mutation):

```
TypeError: Cannot read properties of undefined (reading 'app')
  > 59 |     await nodeB.app.close();
```

All 21 `app.close()` sites in `services/api` were read: every spec is `let ctx; beforeAll(ctx = await
createTestApp(…)); afterAll(() => ctx.app.close())`. The only double close in the repo is the new edge
case itself, at `:267` and `:269`.

**Keep the test.** The property is real — `sendCommand` rejects with `CONNECTION_CLOSED_ERROR_MSG` once
`status === 'end'` (`node_modules/ioredis/built/Redis.js:343-346`) — and `dispose()` now runs on every
close where `close(server)` did not, so without the ref-clearing a second close *would* reject. Only the
justifying scenario is wrong. **Fix:** state that nothing closes an app twice today, and that clearing the
references before the quit is what keeps a future second close (a spec closing in both `afterEach` and
`afterAll`, a `configure` callback that retains the app) from rejecting on an ended connection.

### L2 · Low · the "not closed, on purpose" enumeration is incomplete in two places

PR body, *Not closed, on purpose* · `.claude/reports/issue-205-fix.md:66-73` · `services/api/test/harness.ts:551-555, 598-604`

The PR states its residual window precisely, which is the right instinct. Two gaps in the statement:

**(a) The `try` ends at `:586`.** `await app.listen(0, '127.0.0.1')` (`:604`) and `db: app.get<Db>(DRIZZLE)`
(`:615`) sit outside it. `NestApplication.listen()` rejects on a bind error
(`node_modules/@nestjs/core/nest-application.js:180-185`), so a rejection there leaves `ctx` unassigned with
the app open — the same #199/#205 shape, one statement past the guard this PR adds. Practically
unreachable (port 0 does not collide; `DRIZZLE` resolves in every other spec), so this is not a leak to
chase. What makes it a finding is the comment at `:602-603`: "The `catch` above closes the app either way;
this order keeps the socket out of the failure path entirely." *Either way* is an absolute claim, and it is
false for those two statements. Pre-existing wording, but this PR is the one that enumerates the residual
windows and does not list it.

**(b) The pre-`registerModules()` span is three calls, not two.** `nest-application.js:95-103` runs
`applyOptions()` → `await this.httpAdapter?.init?.()` → `registerParserMiddleware()` → `registerModules()`.
The report and PR body both say "`applyOptions()` plus the parser middleware", omitting the http-adapter
init. It is a no-op for Express, so the conclusion (nothing in the span touches an overridden provider)
stands.

**Fix:** add (a) to the enumeration, or move `listen()` and the `DRIZZLE` resolution inside the existing
`try` — the ordering is unchanged and `app.close()` releases the bound socket
(`node_modules/@nestjs/platform-express/adapters/express-adapter.js:117-123`), which is the stronger
property, but then `:598-603`'s last clause has to stop saying the socket is out of the failure path. Fix
(b) with three words.

### L3 · Low · the gate's provenance sha does not resolve, and the sentence around it is wrong twice

PR body, *Validation* · `.claude/reports/issue-205-fix.md:106-136`

> "at the committed head `274dc0c`" … "The branch head is one commit past `274dc0c` and adds only this
> report … A report cannot stamp the commit that contains it; this is the nearest honest version."

- `274dc0c` was amended away. `git branch -r --contains 274dc0c` is empty and
  `gh api repos/linardsb/taxi/commits/274dc0c` returns 422 *No commit found*. The gate's provenance cites a
  sha no reader but this checkout can resolve.
- It is not an ancestor of the head: `git rev-parse 274dc0c^` and `git rev-parse HEAD^` are both `8e56fe6`.
  The head is an **amend** of `274dc0c`, not a commit on top of it.
- `git ls-tree -r --name-only 274dc0c -- .claude/reports/issue-205-fix.md` prints the path. `274dc0c`
  *did* contain the report, so "a report cannot stamp the commit that contains it" is refuted by the
  commit the sentence is about. The `274dc0c..HEAD` delta is 13 insertions and 5 deletions to that same
  file — the gate-stamp paragraph being rewritten.

The load-bearing part survives: `git diff --stat 274dc0c..HEAD` is the report alone, so no source line
differs between the gated tree and the head. **Fix:** cite `0763bc0` and paste the stamp below, which is
the same gate on the actual head — every figure reproduces.

### Notes (no change required)

**N1 — "SIGTERM reaches `app.close()`" is shorthand.** `.claude/reports/issue-205-fix.md:151-154`. The
signal path does not call `close()`: `listenToShutdownSignals`' `cleanup`
(`nest-application-context.js:199-227`) inlines `callDestroyHook` → `dispose()` (`:208`) →
`callShutdownHook`. It reaches `NestApplication.dispose()` → `socketModule.close()` → `adapter.dispose()`
all the same, so the substantive claim holds.

**N2 — "`end` within 100 ms (`observed`)"** (`issue-205-fix.md:53`, spec `:222-224`) names a 14:43
throwaway run with no surviving artifact. Nothing depends on the digit: the code's own bound is 2 s, and
probe E's failure message (`client still ready 2 s after close()`) is the only place the timing is read.

**N3 — the retired mechanism claim was swept correctly.** `grep -rn 'close(server)\|RedisIoAdapter\.close\|
no-op .dispose\|leave both clients open' .claude/ docs/ CLAUDE.md services/api/CLAUDE.md` and the same over
`services/api/src` + `test`: every surviving hit is either this PR's own new prose or a historical review /
fix report (`pr-194`, `pr-196`, `pr-203`, `issue-199`), which are records of what was true then. No
reference doc, no `CLAUDE.md` and no shipped comment states it as current. The one live-ish hit is
`.claude/plans/api-auth-realtime-gateway.md:825,987`, a shipped ticket's plan describing the `close()`
override it asked for — historical by the same reading.

## Validation

`observed` — `record-gate.sh --clean` (`pnpm turbo run typecheck lint test build --force` from cleared
`dist`/`.next`), `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://localhost:6381`, at **`0763bc0`**
(the head, not `274dc0c`), exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m23.286s
```

    @taxi/api       Test Suites: 77 passed, 77 total · Tests: 726 passed, 726 total
    @taxi/dispatch  Test Files 27 passed (27) · Tests 224 passed (224)
    @taxi/driver    Test Suites: 41 passed, 41 total · Tests: 218 passed, 218 total
    @taxi/rider     Test Suites: 29 passed, 29 total · Tests: 140 passed, 140 total
    @taxi/db        Test Files 3 passed (3) · Tests 17 passed (17)
    @taxi/shared    Test Files 24 passed (24) · Tests 231 passed (231)

Not in the graph: `@taxi/config#{build,lint,test,typecheck}`, `@taxi/driver#build`, `@taxi/rider#build` —
the six the PR body names, confirmed by this run's own dry-run diff.

CI on `0763bc0`: `check` 3m38s, `audit-diff`, `codeql`, CodeQL, `ready` — all green. PR is out of draft,
`mergeStateStatus` CLEAN. Base unmoved: `origin/main` live tip = `baseRefOid` = `32fb6f7`, so the
guarantees pass does not fire. No prior review round and no `.claude/plans/*205*`, so the fix-mechanism and
constraint passes do not either.

### Probes re-run here

Same recipe as the report: `services/api`, `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381
timeout <n> npx jest src/features/realtime/redis-io.adapter.spec.ts`. The `init()` mutation was rebuilt
from the report's description (module-scope counter; on the process's 2nd `createTestApp`, `app.init` runs
the real `init()` and then throws). Tree restored and `git status` verified clean after each.

| Probe | Adapter | `harness` | Mutation | Report says | This run |
|---|---|---|---|---|---|
| B | new | **old** | `after` | exit 124, 45 s, `2 failed, 5 passed, 7 total`, 1 "did not exit" | ✅ identical |
| C | new | **new** | `after` | exit 1, 3 s, `2 failed, 5 passed, 7 total`, 0 "did not exit" | ✅ exit 1, 4 s, same counts, 0 |
| D | new | new | `before` | exit 124, 45 s — the residual window | ✅ identical, 1 "did not exit" |
| E | **old** | new | none | exit 124, `1 failed, 6 passed, 7 total`, `client still ready 2 s after close()` | ✅ identical (`timeout 90` → 90 s) |
| F | new | new | none | exit 0, 4 s, `7 passed, 7 total` | ✅ identical |

**B versus C** and **E versus F** are genuine attribution pairs — one file differs in each, and the
outcome flips. That is the discipline CLAUDE.md asks for, applied to a behavioural claim. Probe A (main's
head baseline, 5 tests) was not re-run; the PR body already marks it as the baseline rather than a pair.

### Figures audit

| Figure | Source | Verdict |
|---|---|---|
| `+271 −17`, four files | `git diff --numstat origin/main..HEAD` | `observed`, matches |
| Gate `22/22`, `0 cached`, api `77 / 726` and all five sibling counts | re-run here at `0763bc0` | `observed`, every figure reproduces |
| `Time: 1m23.233s` | report's run at `274dc0c` | not re-checkable (`.claude/last-gate.json` overwritten); this run's `1m23.286s` agrees |
| `726 = 724 + 2`, `derived` | #203's review stamp at `cedc2a0` = api `77 / 724`; `git diff --stat cedc2a0..32fb6f7` = four `.claude/` docs + `harness.ts` +4 | condition stated and true; the arithmetic and the inheritance both hold |
| six tasks "not in the graph" | this run's dry-run diff | `observed`, same six |
| probes B/C/D/E/F | re-run here | `observed`, reproduced |
| `end` within 100 ms | 14:43 throwaway run, no artifact | N2 — load-bearing for nothing |
| gate at `274dc0c` | amended-away sha | L3 |
| `37 skipped, 689 passed, 726 total` (the stale `CLAUDE.md` line, deferred) | report's `env -u REDIS_TEST_URL` run | not re-run; `689 + 37 = 726` is consistent with this run's 726 |

## Mechanism, verified against source

Every load-bearing claim was read in `node_modules`, not inferred:

- `AbstractWsAdapter.dispose()` is `async dispose() { }` (`@nestjs/websockets/adapters/ws-adapter.js:32`),
  so `override` is valid and displaces a no-op.
- `SocketModule.close()` (`socket-module.js:49-63`) returns early without `applicationConfig` (`:50-52`) or
  without an adapter (`:54-56`), then calls `adapter.close(server)` once per **registered** server
  (`:58-60`), then `await adapter?.dispose()` **unconditionally** (`:61`), then `socketsContainer.clear()`
  (`:62`). `:60` is the only call to an adapter's `close(server)` in all of `@nestjs`, so `dispose()`'s
  reachability strictly contains it — nothing is lost by dropping the override.
- Ordering is preserved: both before and after, the quits land after every io server closes and before
  `httpAdapter.close()` (`nest-application.js:48-51`). That matters —
  `@socket.io/redis-adapter`'s own `close()` issues `punsubscribe`/`unsubscribe` on the sub client, which
  would go to a dead connection if the quits had moved earlier. They did not.
- `NestApplication.init()` (`nest-application.js:95-111`) never assigns `initializationPromise`; only
  `NestApplicationContext.init()` does (`:108`). So `close()`'s `await this.initializationPromise`
  (`nest-application-context.js:127`) is `await undefined`, which is exactly what makes moving
  `await app.init()` inside the `try` safe. This was the PR's key safety claim and it is correct.
- `Promise.all([pub?.quit(), sub?.quit()])` subscribes to both eagerly, so a `sub` rejection is handled
  even when `pub` rejects first — no unhandled rejection.

## What's good

- **The attribution pairs are built properly.** B-versus-C isolates the `harness` change to one differing
  file; E-versus-F isolates the adapter. Both flip. Applying the "numbers are claims" discipline to a
  behavioural claim, with the control run rather than assumed, is the thing #87 and #107 were missing.
- **The `initializationPromise` claim was verified, not assumed** — it is the non-obvious fact the whole
  harness change rests on, and it is stated precisely enough to re-check in one grep.
- **The ref-clearing is right for the right reason**, and clearing *before* the `await` rather than after
  is what makes the window zero-width.
- **The residual window is stated rather than papered over**, in the code comment as well as the report,
  with the probe that observed it. L2(a) is an addition to that list, not a contradiction of it.
- **The spec's premise is structurally enforced**: an empty module graph is the only way to exercise the
  no-gateway path, and the comment at `:207-212` says why the existing cross-node block cannot.
- **The RED first gate is reported**, with the rule, the message and the rewrite. A pass that hides its
  red intermediate is how a lint hole ships.
- The `ended()` helper asserting on the `end` event after an explicitly rejected synchronous `status` read
  is the difference between a test that passes for the right reason and one that passes on timing.

## Recommendation

**Approve.** Validation is green at the head, CI is green, the change matches its stated intent, and every
mechanism claim survives a read of the Nest source. L1 and L3 are each a one-commit wording fix and are
the two worth taking: L1 because a comment refuted by the PR's own probe log is exactly the inherited-claim
failure CLAUDE.md warns about, L3 because a gate stamp that names an unreachable sha cannot be audited by
anyone else. L2(a) is a scope call — enumerate it or move the two statements inside the `try`.
