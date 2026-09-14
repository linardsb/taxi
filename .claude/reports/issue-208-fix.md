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
cases. **`services/api/src/test-harness.spec.ts`** — two ungated cases: the socket half, and (added by
#209 review L3) the masking guarantee.

## Why a spec can drive this now, and could not in #205

#205's probes worked by rewriting `harness.ts` on disk with a python mutator, because neither failure was
reachable from a test: a port-0 `listen()` does not collide, and nothing could make `init()` reject.

`options.configure` is the opening. It runs **before** `init()` and is handed the app, so a spec can
replace `app.init` or `app.listen` on the instance and reproduce the **state** each failure leaves the app
in — no mutation, no on-disk surgery, and the cases ship. `breakingConfigure(step)` in the adapter spec is
that, parameterised by which step to break; the clients' `end` events are started inside `configure`,
because the clients do not exist until `connectToRedis` resolves and that is already inside
`createTestApp`.

**The state, not the span** (#209 review L5). Replacing `app.init` wholesale means its body never runs, so
the `:99-102` window itself is never entered. Both that and a rejection inside it leave
`applicationConfig` unset, which is the only state `close()` reads here (`socket-module.js:50`), so the
two are indistinguishable to everything the case asserts. The case is therefore evidence that the
teardown *closes* the window, not evidence about *where* the window is — the where is established
independently, by the *Mechanism* source read below.

## The four new cases

| Case | File | Breaks | Asserts |
|---|---|---|---|
| `quits the adapter when init() rejects before registerModules() (expected)` | `redis-io.adapter.spec.ts` | `app.init` rejects | both clients reach `end` |
| `quits the adapter when listen() rejects (edge)` | `redis-io.adapter.spec.ts` | `app.listen` rejects | both clients reach `end` |
| `releases the bound socket when the boot throws after listen() (failure)` | `test-harness.spec.ts` | real listen binds, then throws | the socket was listening, then is not, and `address()` is null |
| `rethrows the boot error when the teardown path throws too (failure)` | `test-harness.spec.ts` | `app.init` rejects; `close()` and the teardown both throw on top | `createTestApp` rejects with the BOOT error, and both teardown errors were printed instead |

The third is ungated and asserts the **socket**, not the clients: the first two never bind one (their
`listen` rejects), so neither can say anything about socket release. It records `listening` at the throw
rather than asserting inside the callback, because an `expect()` that throws in there is caught by the
harness and re-emerges as the boot error — the case would then fail for the wrong reason.

The fourth was added by #209 review L3: the masking guarantee ("anything thrown by the teardown path —
`close()` or the `configure` teardown — is printed and the ORIGINAL is rethrown") had no case, so both
`catch` blocks were unexecuted by the suite. It is **ungated**: a throwing teardown needs no adapter and no
clients, and the point is that these lines run on every suite run rather than only where `REDIS_TEST_URL`
is set. `app.close` is wrapped rather than replaced — the real close still runs, so the app the case
abandons holds nothing open; a stubbed-out close would test the guarantee by leaking the thing the
guarantee exists to release.

## Probes — two attribution pairs

Same recipe throughout: from `services/api`,
`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 timeout <n> npx jest
src/features/realtime/redis-io.adapter.spec.ts src/test-harness.spec.ts`. Each probe is the fixed harness
with **one** hunk reverted; the specs are identical in all four runs. "did not exit" counts the
`Jest did not exit one second after…` line.

All four rows below were run at `ed3a0dd`, where the two spec files held **13** cases. The #209 review
fixes added a fourteenth (the masking case), so a re-run today totals 14 — see the note under the failure
texts.

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

> **The two `client still ready 2 s after close()` lines above are a record of a run against a tree that
> no longer exists.** #209 review L1 replaced the `ended()` helper's rejecting timer with one that
> resolves with the live status, so a re-run of probe B now reddens the same case with
> `Received: ["ready", "ready"]` against `Expected: ["end", "end"]` instead. `observed` 2026-09-14 on the
> fixes commit: `1 hunk, +0 −13`, `EXIT=124`, `Tests: 2 failed, 12 passed, 14 total`, 1 "did not exit",
> both W1 cases still green. Two cases flip under probe B now rather than one — the second is the new
> masking case (below), which deletes along with the teardown call it asserts on; the W1 pair staying
> green is what still makes it an attribution. The quoted output is left as-is: it is what that run
> printed.

### Probes C1 and C2 — the masking guarantee (#209 review L3)

Same recipe, one hunk each, against `src/test-harness.spec.ts` alone (the new case is ungated, so no
`REDIS_TEST_URL`). Each removes one masking `try`/`catch` wrapper and leaves the call it wrapped.

| Probe | `harness.ts` | Result | Which case flips |
|---|---|---|---|
| **C1** | the `configure` teardown's guard removed (`+1 −8`) | ❌ exit 1, `1 failed, 4 passed, 5 total` — `Expected substring: "probe: boot failed"` / `Received message: "probe: teardown boom"` | the new masking case |
| **C2** | `app.close()`'s guard removed (`+1 −8`) | ❌ exit 1, `1 failed, 4 passed, 5 total` — `Expected substring: "probe: boot failed"` / `Received message: "probe: close boom"` | the new masking case |
| **Green** | fixed | ✅ exit 0, `14 passed, 14 total` across both spec files, 2.355 s | — |

Both `observed` 2026-09-14. Each probe makes the error the harness is supposed to swallow escape and mask
the boot error, which is the exact defect the guarantee names; the four pre-existing cases in the file stay
green in both. Sizes `observed` via the same `diff --unified=0` counts. `harness.ts` restored from a saved
copy after each and `cmp`-verified.

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

- ~~**A `configure` that THROWS is the residual window, and this PR does not close it.**~~ **Closed by
  #211** — `connectToRedis` now disconnects both clients when the ping rejects, and the `configure` call
  moved inside the `try`. See `.claude/reports/issue-211-fix.md`. The half that stays open is the next
  bullet.
- **`configure`'s teardown is opt-in, and a `configure` that never returns one strands what it opened.**
  Two ways to get there, and they are the same gap from opposite sides: a `configure` that opens a
  resource and simply forgets the teardown, and a `configure` that opens one **successfully and then
  throws before its `return`** — #211 closed only the case where the open itself is what throws.
  `installAdapter` returns a teardown; `redis-io.adapter.spec.ts`'s CORS block installs an adapter that
  never calls `connectToRedis`, so it holds nothing and returns nothing. Either way it is back in W2 — a
  contract, not a guarantee. Enforcing it would mean the harness owning resources it cannot name, or
  changing `configure`'s signature to register cleanups eagerly (`configure(app, onCleanup)`), which #211
  weighed and declined for a case no caller has.
- **No case covers a self-check throwing *after* a successful listen**, because nothing in the harness
  does that today — the two self-checks both precede the listen. The `DRIZZLE` half of W1 is covered by
  the third case only in shape (a throw after the bind), not by resolving `DRIZZLE` for real.
- `CLAUDE.md`'s Redis-gated line was already stale before this ticket (`33 skipped, 582 passed, 615
  total`) and is not re-measured here; #205's report has the last measurement.
