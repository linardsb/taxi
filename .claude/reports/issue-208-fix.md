# issue #208 — `createTestApp`'s last two teardown windows

Closes the two spans `.claude/reports/issue-205-fix.md` enumerated and left open: the statements past the
`try` (W1) and the pre-`registerModules()` span (W2). Both are now driven by shippable tests rather than
by a mutated `harness.ts`, which is the whole reason they could be closed this time and not in #205.

## What changed

**`services/api/test/harness.ts`** — two changes, one per window.

*W1.* `await app.listen(0, '127.0.0.1')` and the returned object (which resolves `DRIZZLE`) move **inside**
the existing `try`. The ordering is untouched — the listen still runs last, after both self-checks, for
#194 review F1's reason — but a rejection from either now takes the same `catch` that `init()` and the
self-checks take, instead of escaping with `ctx` unassigned and, past the listen, a socket still bound.

*W2.* `options.configure` may now return a teardown, which the `catch` runs after `app.close()`.
`app.close()` cannot cover this span itself: `SocketModule.close()` returns at its first line while
`this.applicationConfig` is unset (`node_modules/@nestjs/websockets/socket-module.js:49-52`), and that
field is assigned by `register()`, reached from `registerWsModule()` inside `registerModules()`
(`nest-application.js:79-94`). So an `init()` that rejects in `applyOptions()` → `httpAdapter.init()` →
the parser middleware (`nest-application.js:99-102`) never reaches `adapter.dispose()`, and whatever
`configure` opened survives. The returning callback is the only thing that knows what that was.

The teardown runs on **every** failure, not only that span's. Deciding which span a failure fell in would
mean reading Nest's private init state; running it always is safe because `RedisIoAdapter.dispose()`
clears both references before quitting (#205), so a second pass after a `close()` that already disposed is
a no-op. Anything it throws is printed, never allowed to mask the original error — the same rule the
`close()` call already followed.

**`services/api/src/features/realtime/redis-io.adapter.spec.ts`** — `installAdapter` returns
`() => adapter.dispose()`, and a nested `createTestApp boot failures (#208)` block adds two Redis-gated
cases. **`services/api/src/test-harness.spec.ts`** — one ungated case for the socket half.

## Why a spec can drive this now, and could not in #205

#205's probes worked by rewriting `harness.ts` on disk with a python mutator, because neither failure was
reachable from a test: a port-0 `listen()` does not collide, and nothing could make `init()` reject.

`options.configure` is the opening. It runs **before** `init()` and is handed the app, so a spec can
replace `app.init` or `app.listen` on the instance and reproduce each failure exactly — no mutation, no
on-disk surgery, and the cases ship. `breakingConfigure(step)` in the adapter spec is that, parameterised
by which step to break; the clients' `end` events are started inside `configure`, because the clients do
not exist until `connectToRedis` resolves and that is already inside `createTestApp`.

## The three new cases

| Case | File | Breaks | Asserts |
|---|---|---|---|
| `quits the adapter when init() rejects before registerModules() (expected)` | `redis-io.adapter.spec.ts` | `app.init` rejects | both clients reach `end` |
| `quits the adapter when listen() rejects (edge)` | `redis-io.adapter.spec.ts` | `app.listen` rejects | both clients reach `end` |
| `releases the bound socket when the boot throws after listen() (failure)` | `test-harness.spec.ts` | real listen binds, then throws | the socket was listening, then is not, and `address()` is null |

The third is ungated and asserts the **socket**, not the clients: the first two never bind one (their
`listen` rejects), so neither can say anything about socket release. It records `listening` at the throw
rather than asserting inside the callback, because an `expect()` that throws in there is caught by the
harness and re-emerges as the boot error — the case would then fail for the wrong reason.

## Probes — two attribution pairs

Same recipe throughout: from `services/api`,
`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 timeout <n> npx jest
src/features/realtime/redis-io.adapter.spec.ts src/test-harness.spec.ts`. Each probe is the fixed harness
with **one** hunk reverted; the specs are identical in all four runs. "did not exit" counts the
`Jest did not exit one second after…` line.

| Probe | `harness.ts` | Result | Which case flips |
|---|---|---|---|
| **A** | W1 reverted (listen + return back outside the `try`), W2 fix kept | ❌ exit 124, `2 failed, 11 passed, 13 total`, 1 "did not exit" | the two W1 cases |
| **B** | W2 reverted (no teardown call in the `catch`), W1 fix kept | ❌ exit 124, `1 failed, 12 passed, 13 total`, 1 "did not exit" | the one W2 case |
| **Green (before)** | fixed | ✅ exit 0, `13 passed, 13 total`, 2.96 s, 0 "did not exit" | — |
| **Green (after restore)** | fixed | ✅ exit 0, `13 passed, 13 total`, 2.218 s, 0 "did not exit" | — |

All four `observed`, 2026-09-14. **A and B are each a genuine pair against the green run**: one hunk
differs, and exactly the cases that hunk is responsible for flip — A's two W1 cases with the W2 case still
green, B's one W2 case with both W1 cases still green. Neither probe reddens the other's case, which is
what makes them attributions rather than two ways of saying "something broke".

Probe size against the fixed file, `observed` via `diff --unified=0 … | grep -c '^+[^+]'` and `'^-[^-]'`:
**A is 3 hunks, +19 −19** — the same 19 lines, moved out of the `try` and re-indented, which is why the
two counts match; **B is 1 hunk, +0 −13** — the teardown `try` deleted outright.

**`app.close()` did not throw in any run.** `grep -c "app.close() after a failed boot threw"` over all
three logs is `0`, and so is the teardown's own error line. That matters because it is what pins W2's
mechanism: in probe B the harness *did* call `close()`, it *did* return normally, and both clients were
still `ready` 2 s later. A `close()` that ran cleanly and disposed nothing is only possible by the early
return at `socket-module.js:50-52` — the claim above, observed rather than assumed. Had `close()` thrown
instead, the teardown would have covered an error path and the same case would still have passed green,
which is the #206 L1 shape (a justifying scenario the run refutes) this check rules out.

Failure texts, verbatim:

```
A ● createTestApp network invariants (#193) › releases the bound socket when the boot throws after listen() (failure)
    expect(received).toBe(expected)   Expected: false   Received: true
A ● RedisIoAdapter teardown › createTestApp boot failures (#208) › quits the adapter when listen() rejects (edge)
    Received promise rejected instead of resolved
    Rejected to value: [Error: client still ready 2 s after close()]

B ● RedisIoAdapter teardown › createTestApp boot failures (#208) › quits the adapter when init() rejects before registerModules() (expected)
    Received promise rejected instead of resolved
    Rejected to value: [Error: client still ready 2 s after close()]
```

The exit-124 non-exit in both probes is the original defect's own signature — the leaked handles holding
jest open — not an artifact of the probe. `harness.ts` was restored from a saved copy after each and
`cmp`-verified against all three copies before the gate.

## Mechanism, read rather than assumed

- `SocketModule.close()` (`socket-module.js:49-63`) returns at `:50-52` without `applicationConfig`, and
  at `:54-56` without an adapter; only then does it reach `adapter.close(server)` per registered server
  and `adapter.dispose()` unconditionally.
- `applicationConfig` is assigned only in `SocketModule.register()` (`socket-module.js:23-24`), called
  from `NestApplication.registerWsModule()` (`nest-application.js:88-93`), called from
  `registerModules()` (`:80`). So the window is exactly `init()`'s `:99-102`.
- `NestApplication.listen()` rejects on a bind error through the `errorHandler` it registers at
  `nest-application.js:181-185`.
- `NestApplication.dispose()` (`:48-51`) runs `socketModule.close()` then `httpAdapter.close()`, so one
  `app.close()` releases both the clients and the socket — the property the third case asserts.
- `NestApplication.init()` never assigns `initializationPromise` (only `NestApplicationContext.init()`
  does, `:108`), so `close()`'s `await this.initializationPromise` is `await undefined` and closing a
  never-initialised app is safe. Re-read here, as in #205 and #203 — it is what makes W2's `close()` in
  the `catch` legal at all.

## Gate

See the PR body's Validation block for the stamp: it is `record-gate.sh --clean` on a clean tree at the
branch's source head, and this file is `.claude/`-only, which no gate task reads.

## Not done

- **`configure`'s teardown is opt-in, and only one caller needs it.** `installAdapter` returns one;
  `redis-io.adapter.spec.ts`'s CORS block installs an adapter that never calls `connectToRedis`, so it
  holds nothing and returns nothing. A future `configure` that opens a resource and forgets the teardown
  is back in W2 — a contract, not a guarantee. Enforcing it would mean the harness owning resources it
  cannot name.
- **No case covers a self-check throwing *after* a successful listen**, because nothing in the harness
  does that today — the two self-checks both precede the listen. The `DRIZZLE` half of W1 is covered by
  the third case only in shape (a throw after the bind), not by resolving `DRIZZLE` for real.
- `CLAUDE.md`'s Redis-gated line was already stale before this ticket (`33 skipped, 582 passed, 615
  total`) and is not re-measured here; #205's report has the last measurement.
