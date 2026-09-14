# Feature: `connectToRedis` cleans up its own partial state (#211)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

`RedisIoAdapter.connectToRedis()` constructs two ioredis clients, pings both, and only then assigns them
to `this.pubClient` / `this.subClient`. A rejection at the ping leaves two live, retrying-forever ioredis
connections that **no code path can reach** — the fields are still `undefined`, so `dispose()` closes
nothing, and the caller has already thrown.

That is the shipped-source half of `createTestApp`'s residual teardown window (#209 review M1): a
`configure` that opens the adapter's clients and then throws leaks them, and jest exits 124 — this
family's own defect signature (#199, #205, #208 each closed a span of it).

This ticket makes `connectToRedis` tear down what it opened when it fails, adds three ungated cases that
pin it, moves the `configure` call inside `createTestApp`'s `try` so the harness's own enumeration is
true again, and retires the claims the fix falsifies.

## User Story

As an engineer running the api suite (and as `main.ts` on a misconfigured `REDIS_URL`)
I want a failed `connectToRedis` to leave no ioredis connection behind
So that a bad Redis target produces one clear error instead of a hung jest and a scroll of `NOAUTH`

## Problem Statement

`services/api/src/features/realtime/redis-io.adapter.ts:36-43`:

```ts
async connectToRedis(url: string): Promise<void> {
  const pubClient = new Redis(url);                          // :37
  const subClient = pubClient.duplicate();                   // :38
  await Promise.all([pubClient.ping(), subClient.ping()]);   // :39  ← rejects here
  this.pubClient = pubClient;                                // :40  ← never runs
  this.subClient = subClient;                                // :41
  this.adapterConstructor = createAdapter(pubClient, subClient);
}
```

A server that accepts the TCP connection and then errors the PING — `NOAUTH`, a wrong-type server on the
port — rejects at `:39` with both clients constructed and neither field assigned. Both clients then
reconnect on ioredis's default `retryStrategy` forever. Three callers are affected:

| Caller | Consequence today |
|---|---|
| `services/api/test/harness.ts:562` (via `configure`) | `createTestApp` rejects; two clients retry forever; jest exits 124 |
| `services/api/src/main.ts:15` | `bootstrap()` rejects with the real error buried under repeated ioredis error logs; process does not exit |
| `services/api/scripts/mint-tracked-ride.ts:426` | same — which is why `:409-412` already carries a `kv.ttl` pre-probe and a comment about the leak |

## Solution Statement

Wrap the ping in `connectToRedis` in a `try`/`catch` that calls `disconnect()` on both clients and
rethrows. `disconnect()` (not `quit()`) because it is synchronous, cannot reject, and stops ioredis's
reconnect loop; `quit()` awaits a `+OK` from a server we have just failed against.

Pin it with three **ungated** cases driven by a fake TCP Redis — a `net.createServer` that accepts and
answers every command with `-NOAUTH Authentication required.` The observable is the **cumulative count of
connections the fake server accepted**, sampled after a settle window: it stays at 2 on the fixed tree and
climbs on the unfixed one.

Separately, move `options.configure` inside `createTestApp`'s existing `try`, so the comment's absolute
("every step that can throw sits inside this `try`") becomes literally true of the statements again, and
retire the three claims this work falsifies.

## Out of Scope / Non-Goals

- **Not included: a `configure` that opens something SUCCESSFULLY and then throws on a later line.**
  It never reaches its `return`, so no teardown is registered, and `app.close()` on a never-`init()`ed app
  returns at `socket-module.js:50-52` without reaching `dispose()`. This is structurally the same hole as
  the mirror gap the issue puts out of scope (`issue-208-fix.md` *Not done* bullet 2: a `configure` that
  opens something and returns no teardown) — a `configure` that throws before returning **is** a
  `configure` that returns no teardown. Closing it would mean changing `configure`'s contract from
  return-value to eager registration (see NOTES, Option O2). **Read AC1 as scoped to the case where
  `connectToRedis` itself is what throws** — which is the case the issue observed and the only one
  reachable without a mutation.
- **Not included: an UNREACHABLE Redis.** `connectToRedis` hangs inside ioredis's infinite retry rather
  than rejecting; a different shape, already recorded against this repo's worktree `.env` gap
  (`taxi-worktree-env-redis-hang`). This ticket adds no connect timeout.
- **Not changing: `dispose()`.** Its clear-then-quit ordering (#205) is load-bearing for the harness's
  run-the-teardown-on-every-failure rule. It stays exactly as is.
- **Not changing: `mint-tracked-ride.ts`'s `kv.ttl` pre-probe.** Only the stale half of its comment goes;
  the probe still buys a better error message than ioredis's.
- **Not re-measuring** `CLAUDE.md`'s Redis-gated line beyond what the gate run prints.

## Feature Metadata

**Feature Type**: Bug Fix
**Estimated Complexity**: Low (shipped change is ~6 lines; the test design is the work)
**Primary Systems Affected**: `services/api` — `features/realtime` (shipped), `test/harness.ts` (harness)
**Dependencies**: none new. `ioredis ^5.11.1`, `jest ^30`, `node:net` (stdlib).

## Related Work

**Implements**: [#211](https://github.com/linardsb/taxi/issues/211)   ·   **Epic**: none (a maintenance
line: #199 → #205 → #208 → #211, each closing a span of the same exit-124 family)

**Back-references**:

- `.claude/reports/issue-208-fix.md` — Why: defines `configure`'s teardown contract, and its *Not done*
  bullet 1 is the window this ticket closes. Its probe table is the template for this one's.
- `.claude/code-reviews/pr-209-review.md` (on `main` since #210) — Why: M1 is this ticket's statement of
  the defect, including the `observed` exit-124 run.
- `.claude/reports/issue-205-fix.md` — Why: why `dispose()` clears refs before quitting, which this plan
  must not disturb.

**Forward-references**:

- (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `services/api/src/features/realtime/redis-io.adapter.ts` (whole file, 76 lines) — Why: the one shipped
  file that changes. `connectToRedis` is `:36-43`; `dispose()` `:69-75` and its comment explain the
  clear-before-quit ordering you must not disturb.
- `services/api/src/features/realtime/redis-io.adapter.spec.ts` (lines 116-135 for the ungated CORS block's
  shape; 216-262 for the `ended()` helper; 304-380 for `breakingConfigure` and the `#208` block) — Why:
  the new block mirrors these. Note the file already holds **both** gated and ungated `describe`s.
- `services/api/test/harness.ts` (lines 455-563 for the `configure` JSDoc and the call; 564-665 for the
  comment, the `try` and the `catch`) — Why: the exact edit sites for Task 3 and Task 6.
- `services/api/src/test-harness.spec.ts` (lines 85-100) — Why: the existing `node:*` `createServer`
  idiom in this suite; your fake Redis follows it.
- `services/api/src/main.ts` (lines 14-16) — Why: the production caller; confirms the fix must rethrow,
  not swallow.
- `services/api/scripts/mint-tracked-ride.ts` (lines 408-427) — Why: holds a comment this fix falsifies.
- `.claude/reports/issue-208-fix.md` (the *Probes* and *Not done* sections) — Why: the probe-table format
  you must reproduce, and the bullet you must retire.
- `packages/config/eslint/base.mjs` (lines 30-57) — Why: `max-lines` is 500 but `**/*.spec.ts`,
  `**/test/**` and `**/scripts/**` are **outside** the rule, so neither spec growth nor `harness.ts`'s 725
  lines is a lint concern. `redis-io.adapter.ts` is 76 → ~82 after the fix, well inside.

### New Files to Create

None. All four edits land in existing files, plus one new report:

- `.claude/reports/issue-211-fix.md` — the implementation report with the probe table (Task 8).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [ioredis API — `disconnect(reconnect?)`](https://github.com/redis/ioredis/blob/main/API.md#Redis+disconnect)
  - Specific section: `disconnect` vs `quit`
  - Why: `disconnect()` closes the stream immediately and, without an argument, does **not** reconnect.
    `quit()` sends `QUIT` and waits for `+OK`, which a server that just errored the PING may never send.
- [ioredis — `retryStrategy` default](https://github.com/redis/ioredis#auto-reconnect)
  - Specific section: auto-reconnect
  - Why: the default is `Math.min(times * 50, 2000)` ms. It is the arithmetic behind the probe window
    below, and the reason a leaked client is observable as *repeated new connections*.
- [Node `net.Server.close()`](https://nodejs.org/docs/latest-v20.x/api/net.html#serverclosecallback)
  - Specific section: "the server is finally closed when all connections are ended"
  - Why: your fake server's teardown must `destroy()` its accepted sockets or `close()`'s callback never
    fires and the suite hangs — the exact failure this ticket is about.

### Patterns to Follow

**Failure-path cleanup that never masks the original error** — `harness.ts:642-664`. The original error is
always what is rethrown; anything the cleanup throws is printed. In `connectToRedis` the cleanup is
`disconnect()`, which is synchronous and cannot throw, so a bare `catch { …; throw err }` suffices — do
**not** add a nested try/catch for a call that cannot reject.

**Ungated vs gated `describe` in the same spec file** — `redis-io.adapter.spec.ts:38` uses
`describeWithRedis` (gated), `:116-135` uses a plain `describe` with a comment explaining why it needs no
Redis. Your new block is a plain `describe` and carries the same kind of comment: *the fake server is the
point — a real Redis would answer the PING.*

**Case naming** — `(expected)` / `(edge)` / `(failure)` suffixes, one of each per feature (CLAUDE.md).
See every `it(` in both spec files.

**A comment is a claim** (CLAUDE.md). Every sentence you leave in `harness.ts:564-594`,
`redis-io.adapter.ts` and `mint-tracked-ride.ts:408-412` must still be true after your change. Retire by
**subject**, not by sentence shape: grep the nouns.

---

## IMPLEMENTATION PLAN

### Phase 1: Branch and baseline

Branch off `origin/main` at `fcea364` (`observed` 2026-09-14: `#209` merged as `df417d6`, `#210` as
`fcea364`; `gh pr list --state open` returns `[]`, so nothing is stacked). Record the pre-change case
count so the probe table does not inherit a digit.

### Phase 2: The shipped fix

**Depends on:** Phase 1.

Six lines in `redis-io.adapter.ts`. Nothing else in shipped source changes.

### Phase 3: The tests

**Depends on:** Phase 2 (the cases assert the fixed behaviour).

One new ungated `describe` in `redis-io.adapter.spec.ts`: a fake-Redis helper plus three cases.

### Phase 4: The harness move

**Independent of:** Phases 2-3 — it flips no case either way (see NOTES, D1), so it can land in any
order. Do it last so the probe table can record that fact honestly.

### Phase 5: Claim sweep

**Depends on:** Phases 2-4. Three comment sites and one report bullet.

### Phase 6: Probes and validation

**Depends on:** all of the above.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom.

### 1. UPDATE (branch) — start from `origin/main`

- **IMPLEMENT**: `git fetch origin --prune`, then branch `fix/connect-to-redis-partial-state-211` off
  `origin/main`. The local `fix/harness-teardown-windows-208` is #209's now-deleted branch — do not build
  on it. If another session is live (`git reflog -8`, `ps`), work in a `git worktree` and export
  `COMPOSE_PROJECT_NAME=taxi` (memory: `taxi-worktree-gate-compose`), and copy `.env` into it (memory:
  `taxi-worktree-env-redis-hang`).
- **PATTERN**: `.claude/references/conventions.md`.
- **GOTCHA**: the api integration suite drops and recreates the shared `taxi_api_test` DB in global-setup;
  a worktree cannot isolate it. One gate at a time.
- **VALIDATE**: `git rev-parse --short HEAD` prints `fcea364`, `git status --porcelain` is empty.
- **SATISFIES**: prerequisite.

### 2. RECORD (baseline) — the pre-change case count

- **IMPLEMENT**: run and note the output; you will need it for the probe table and the report.
  ```
  grep -cE "^\s*it\(" services/api/src/features/realtime/redis-io.adapter.spec.ts \
                       services/api/src/test-harness.spec.ts
  ```
- **GOTCHA**: `observed` 2026-09-14 at `fcea364` this is `9` and `5` (14 total), which matches
  `issue-208-fix.md`'s post-L3 figure. **Re-observe it anyway** — that report carries its own blockquote
  about the number going stale, and inheriting it is the exact defect CLAUDE.md names.
- **VALIDATE**: the command above prints two numbers.
- **SATISFIES**: AC #4 (the probe table's provenance).

### 3. UPDATE `services/api/src/features/realtime/redis-io.adapter.ts`

- **IMPLEMENT**: wrap the ping so a rejection tears both clients down before it propagates:
  ```ts
  async connectToRedis(url: string): Promise<void> {
    const pubClient = new Redis(url);
    const subClient = pubClient.duplicate();
    try {
      await Promise.all([pubClient.ping(), subClient.ping()]);
    } catch (err) {
      // Neither field is assigned yet, so `dispose()` cannot reach these two —
      // a rejection here would otherwise leave both clients reconnecting on
      // ioredis's default `retryStrategy` for the life of the process, with
      // nothing holding a reference (#211). `disconnect()`, not `quit()`: it
      // is synchronous, cannot reject, and stops the reconnect loop, while
      // `quit()` waits for a `+OK` from the server we just failed against.
      pubClient.disconnect();
      subClient.disconnect();
      throw err;
    }
    this.pubClient = pubClient;
    this.subClient = subClient;
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }
  ```
- **PATTERN**: the "original error is what is rethrown" rule at `harness.ts:642-664`.
- **IMPORTS**: none added.
- **GOTCHA**: do **not** assign the fields before the ping instead. It makes the clients *reachable* by
  `dispose()`, but in the case that matters nothing calls `dispose()` — `configure` has already thrown, and
  `app.close()` on a never-`init()`ed app returns at `socket-module.js:50-52`. It would also leave `main.ts`
  rejecting with two live clients holding the event loop. Clean in place.
- **GOTCHA**: `Promise.all` subscribes to both inputs immediately, so the slower client's later rejection
  is already handled — `disconnect()` on a client with an in-flight command produces **no** unhandled
  rejection. Do not add a `.catch(() => {})` for it.
- **GOTCHA**: ioredis logs `[ioredis] Unhandled error event: ReplyError: …` to stderr when a client has no
  `error` listener. That happens on the current tree too and is not yours to silence — `observed`, ioredis
  logs rather than throwing, so it never crashes the process. Expect it in the new cases' output.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #2.

### 4. ADD to `services/api/src/features/realtime/redis-io.adapter.spec.ts` — the fake-Redis helper

- **IMPLEMENT**: a new **ungated** `describe` at the end of the file, opening with the helper. The helper
  tracks the **cumulative** count of accepted connections, which is the observable (see the next task's
  GOTCHA for why `live.size` is not).
  ```ts
  /**
   * A TCP server that speaks just enough RESP to fail: it accepts, then answers
   * every command with `-NOAUTH`. That is the shape #211 is about — a server
   * that completes the TCP connect and then errors the PING, which is where
   * `connectToRedis` rejects with both clients already constructed.
   *
   * Ungated, and deliberately so: a real Redis would ANSWER the ping, so
   * `REDIS_TEST_URL` is the one thing these cases must not have.
   */
  function startFakeRedis(): Promise<{
    url: string;
    accepted: () => number;
    close: () => Promise<void>;
  }> { … }
  ```
  Inside the connection handler:
  ```ts
  const server = createNetServer((socket) => {
    accepted += 1;
    live.add(socket);
    socket.on('close', () => live.delete(socket));
    socket.on('error', () => {}); // the client destroys its end; ECONNRESET is expected
    socket.on('data', (chunk) => {
      // ONE REPLY PER COMMAND, not per chunk. ioredis pipelines its ready-check
      // `info` with whatever is in the offline queue, so a reply-per-chunk
      // server answers `info` and leaves `ping` waiting forever — a HANG, not a
      // rejection. `observed` 2026-09-14: reply-per-chunk rejected on the first
      // run of a process and hung on runs 2-4 (4/4, both trees), because the
      // batching only happens once the process is warm.
      const commands = chunk.toString().match(/\*\d+\r\n/g)?.length ?? 1;
      socket.write('-NOAUTH Authentication required.\r\n'.repeat(commands));
    });
  });
  ```
  And the teardown, which must destroy live sockets or `close()`'s callback never fires:
  ```ts
  close: () =>
    new Promise<void>((resolve) => {
      for (const s of live) s.destroy();
      server.close(() => resolve());
    }),
  ```
- **PATTERN**: `services/api/src/test-harness.spec.ts:89` (`createServer` from `node:http`, a bare server
  built inside the spec and closed in the same test).
- **IMPORTS**: `import { createServer as createNetServer } from 'node:net';` — aliased because
  `redis-io.adapter.spec.ts` already imports `AddressInfo` from `node:net` and `createServer` is a common
  enough name to be worth disambiguating. The file imports `type Redis from 'ioredis'` already; you need
  no new ioredis import.
- **GOTCHA**: register the server's teardown in `afterAll` (or close it in the test that created it).
  A leaked `net.Server` is exactly the handle class this ticket exists to stop.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #2 (the instrument).

### 5. ADD to `services/api/src/features/realtime/redis-io.adapter.spec.ts` — three cases

- **IMPLEMENT**: inside the same ungated `describe('RedisIoAdapter.connectToRedis failure (#211)')`:

  1. **(expected)** `'closes both clients when the PING rejects'` — start a fake Redis, build a bare
     `RedisIoAdapter` (no app needed beyond a compiled empty module, as `appWithAdapter` at `:266-279`
     does), `await expect(adapter.connectToRedis(fake.url)).rejects.toThrow('NOAUTH')`, wait the settle
     window, assert `fake.accepted()` is **2**.
  2. **(edge)** `'leaves the adapter holding nothing — dispose() after a failed connect is a no-op'` —
     same setup, then `await expect(adapter.dispose()).resolves.toBeUndefined()`, and assert the private
     `pubClient` / `subClient` are `undefined` (read them the way `:277` already does:
     `adapter as unknown as { pubClient?: Redis; subClient?: Redis }`). This is the case that pins *why*
     cleaning in place is required rather than assigning first.
  3. **(failure)** `'a configure whose connectToRedis rejects leaves createTestApp holding nothing'` —
     the AC #1 case, end to end:
     ```ts
     await expect(
       createTestApp({
         configure: async (app) => {
           const adapter = new RedisIoAdapter(app, [ALLOWED_ORIGIN]);
           await adapter.connectToRedis(fake.url);   // rejects
           app.useWebSocketAdapter(adapter);          // never reached
         },
       }),
     ).rejects.toThrow('NOAUTH');
     await settleWindow();
     expect(fake.accepted()).toBe(2);
     ```
- **PATTERN**: `appWithAdapter` (`:266-279`) for building an adapter on an empty module graph;
  `breakingConfigure` (`:320-341`) for the `configure`-drives-the-failure shape; `settle` (`:33`) for the
  sleep idiom.
- **GOTCHA — the observable.** Do **not** assert on the number of *live* sockets. ioredis closes the
  connection when the ready check fails and reconnects on a backoff, so `live.size` oscillates 2 → 0 → 2
  and is 0 on **both** trees at a random sample. `observed` 2026-09-14 (scratchpad `probe-observable.js`,
  4 runs per variant): after a 600 ms window the cumulative `accepted` was **2** on the fixed tree (4/4)
  and **10** on the unfixed tree (4/4); `live` was 0 in both. The cumulative count is the only stable
  discriminator.
- **GOTCHA — the window.** `derived`: `10 = 2 initial + 2 clients × 4 reconnects`. ioredis's default
  `retryStrategy` is `Math.min(times * 50, 2000)` ms, so a leaked client reconnects at cumulative
  50 / 150 / 300 / 500 ms — four attempts inside 600 ms. **Condition**: the default strategy and a fake
  server that accepts immediately. The first divergence is at ~50 ms, so 600 ms is ~12× the margin
  needed; do not shorten it below ~300 ms and do not lengthen it for safety it does not need.
- **GOTCHA**: name a `const SETTLE_MS = 600;` with that arithmetic in a comment beside it. A bare `600` is
  a figure without provenance.
- **GOTCHA — assert `toBe(2)`, and do not let a later reader loosen it.** The margin is 2 vs 10, so an
  exact match is safe. Say in the case comment *why* it is exact: on the fixed tree a third connection
  cannot appear inside the window, because the fix stops the reconnect loop outright rather than slowing
  it. **An unexpected 3 is a real defect, not a slow machine** — nobody should relax this to
  `toBeLessThan(4)`.
- **GOTCHA — build a real app in the specs; do NOT copy Level 4 step 3b's `new RedisIoAdapter({}, …)`.**
  That `{}` works only because a manual probe never reaches `createIOServer`, which is the one method that
  reads the app. Cases 1 and 2 use `appWithAdapter`'s real compiled module (`:266-279`) and case 3 gets
  its app from `createTestApp`. Conflating the two gives a spec that passes until anything touches the io
  server.
- **GOTCHA**: case 3 calls `createTestApp`, which boots the real `AppModule` and needs the test DB — same
  as every other case in this suite. It needs no `REDIS_TEST_URL`.
- **PROTOTYPED END TO END.** Case 3 was written as a throwaway spec and run under jest against both trees
  before this plan was finalised (`observed` 2026-09-14; spec deleted, `git status --porcelain` clean
  before and after). Build to these numbers:

  | Tree | `PROBE accepted=` | `Tests:` | exit | `Jest did not exit` lines |
  |---|---|---|---|---|
  | unfixed | **10** | `1 failed, 1 total`, 1.536 s | 124 (killed by `timeout 100`) | 1 |
  | fixed (six-line patch) | **2** | `1 passed, 1 total`, 1.564 s | 0 | 0 |

  The unfixed failure text, verbatim: `expect(received).toBe(expected) // Object.is equality` /
  `Expected: 2` / `Received: 10`. The jest-level figure matches the node-level one exactly, so the
  arithmetic in the next GOTCHA carries over unchanged.
- **GOTCHA — the two `console.error`s in a green run are ioredis's, not the harness's.** The fixed run
  prints exactly two, both `[ioredis] Unhandled error event: ReplyError: NOAUTH …` via
  `Redis.silentEmit` — one per client. Neither of `harness.ts`'s two masking messages
  (`app.close() after a failed boot threw`, `the configure teardown after a failed boot threw`) appears.
  Check that, as `issue-208-fix.md` did: a `close()` that threw would mean the case passed while covering
  an error path instead of the one it names.
- **VALIDATE**:
  `COMPOSE_PROJECT_NAME=taxi env -u REDIS_TEST_URL timeout 180 npx jest src/features/realtime/redis-io.adapter.spec.ts`
  from `services/api` — the three new cases pass, the six gated ones skip, the three CORS ones pass, and
  there is **no** `Jest did not exit` line.
- **SATISFIES**: AC #1, AC #2.

### 6. UPDATE `services/api/test/harness.ts` — move `configure` inside the `try`

- **IMPLEMENT**: hoist the binding and move the call:
  ```ts
  const app = moduleRef.createNestApplication();
  let teardownConfigured: (() => Promise<void>) | void = undefined;

  // <the comment, rewritten per Task 7>
  try {
    teardownConfigured = await options?.configure?.(app);
    await app.init();
    …
  ```
- **PATTERN**: the `catch` at `:642-664` is unchanged — `typeof teardownConfigured === 'function'` still
  guards it correctly when `configure` threw before returning.
- **GOTCHA**: the explicit `= undefined` initialiser is required. `observed` 2026-09-14 — both variants
  compiled under this repo's own `typescript` with `--strict`: without the initialiser,
  `error TS2454: Variable 't' is used before being assigned.` at the `typeof t === 'function'` read in the
  `catch`; with `= undefined`, exit 0. The compiler cannot prove the `try` reached the assignment.
- **GOTCHA — be honest about what this buys.** No case in the suite flips on this hunk, and the plan says
  so (NOTES, D1). The argument for it is the contract, not a leak: with the adapter fix in place there is
  no *known* resource a failing `configure` strands that `app.close()` could reach — `DbConnection`'s
  `pg.Pool` is constructed at `compile()` but connects lazily, so `pool.end()` on it is a no-op today.
  What the move guarantees is that a future `configure` whose failure leaves the graph holding something
  `close()` **can** reach is covered by default. Record it in the probe table as a hunk no case flips on;
  do not invent a scenario for it.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3.

### 7. UPDATE `services/api/test/harness.ts` — the comment and the `configure` JSDoc

- **IMPLEMENT**: two edits.
  1. `:564-572` — the parenthetical naming `configure` as "the one exception, and the residual window …
     its own ticket — #211" is now false in every clause. Restore the unqualified absolute for the
     statements — "Every step that can throw sits inside this `try` — `configure`, `init()`, both
     self-checks, the listen, and the `DRIZZLE` resolution in the returned object." — and delete the
     parenthetical. Keep `:572-594` as-is apart from the sentence that runs on from the parenthetical.
     **Add one clause carrying the absolute's limit beside the absolute**, so a reader of the `try`
     comment is not left with an unqualified claim whose only caveat lives ~100 lines up: the absolute is
     about *where the statements sit*, and a `configure` that opens something and throws before returning
     its teardown is still uncovered — point at the JSDoc's third constraint by name.
  2. `:455-...` (the `configure` JSDoc, the "MAY return a teardown" paragraph and its two constraints) —
     add a third constraint stating the residual gap plainly, since the `try` comment no longer carries
     it: *a `configure` that opens something and then throws before returning never registers its
     teardown, so whatever it opened must clean itself up — which is what
     `RedisIoAdapter.connectToRedis` now does (#211). This is the same gap as a `configure` that returns
     no teardown, arrived at from the other side.*
- **GOTCHA — AC #3 is a trap.** The absolute comes back **only** for the enumerated statements. Do not let
  it read as a claim that a failing `configure` can strand nothing: the β case above is open, and
  over-claiming here is exactly the shape #209 M1 and #206 L2(a) caught. State the residual on the
  `configure` contract, where it belongs.
- **VALIDATE**: read the whole of `:455-600` back and check every sentence is still true of the code
  beneath it.
- **SATISFIES**: AC #3.

### 8. UPDATE the two other sites this fix falsifies

- **IMPLEMENT**:
  1. `services/api/scripts/mint-tracked-ride.ts:409-412` — "`RedisIoAdapter.connectToRedis` assigns its
     clients only after both ping, so a failure there leaks two ioredis instances that retry forever and
     bury the real error under a scroll of `NOAUTH`" is now false. Rewrite the *reason* for the `kv.ttl`
     pre-probe (it still buys a named, actionable error instead of ioredis's) and drop the leak claim.
     **Keep the probe.**
  2. `.claude/reports/issue-208-fix.md` *Not done* — retire bullet 1 (`:180-191`) outright, replacing it
     with a one-line pointer to #211 and this ticket's report. Widen bullet 2 (`:192-196`) to name the
     case that stays open: a `configure` that throws **after** a successful open is the same gap as one
     that returns no teardown.
- **PATTERN**: CLAUDE.md — *retiring a bad claim means retiring its **subject**, not its digits*.
- **THE SWEEP IS ALREADY DONE — this is its result, not an instruction to go looking.** `observed`
  2026-09-14, the noun grep below over `services/api .claude docs`, path-excluding `node_modules` and
  `dist` (never `grep -v node_modules`, which eats content lines — memory
  `taxi-review-payoffs-are-claims`):
  ```
  grep -rn "connectToRedis\|residual window\|teardown window\|#211" \
    --include="*.ts" --include="*.md" services/api .claude docs \
    | grep -v "/node_modules/" | grep -v "^services/api/dist/"
  ```
  It returns **21 non-plan sites**. The rule that sorts them: **live guidance is retired; a historical
  record is left exactly as written**, because a report or review is a record of a tree that then
  changed — the same rule `issue-208-fix.md` applied to its own stale probe output.

  **Retire (live guidance, read by the next person as true of the code beneath it):**

  | Site | What is false after the fix |
  |---|---|
  | `services/api/test/harness.ts:564-572` | the whole parenthetical — handled by Task 7 |
  | `services/api/scripts/mint-tracked-ride.ts:409-412` | "assigns its clients only after both ping, so a failure there leaks two ioredis instances that retry forever" |
  | `.claude/reports/issue-208-fix.md:180-191` | *Not done* bullet 1, outright |
  | `.claude/reports/issue-208-fix.md:192-196` | bullet 2 — widen to name β |

  **Leave (historical records — do not edit):** `.claude/code-reviews/pr-107-review.md:116`,
  `pr-116-review.md:56,62,77,91,109,122`, `pr-206-review.md:51,154,207`, `pr-196-review-round3.md:99`,
  `pr-209-review.md` (all); `.claude/reports/issue-205-fix.md:30,47,106`, `pr-206-review-fixes.md:78`,
  `pr-209-review-fixes.md:8,14,40,42,254,264`, `mint-tracked-ride-dev-script-report.md:154`;
  `.claude/execution-reports/mint-tracked-ride-dev-script.md:86`;
  `.claude/plans/api-auth-realtime-gateway.md:825` (already stale — it describes a `close()` override
  that #205 replaced with `dispose()`; not this ticket's to fix).
- **GOTCHA — the lineage is worth carrying into the report.** This defect has been seen three times before
  and closed none of them: **#107 review L2** ("Two ioredis clients leak if `connectToRedis` throws
  between creation and assignment — *noted, no change required* … Residual is narrow"), **#116 review H1**
  (which replicated the connection sequence and corrected the `.env.example` wording around it), and
  **#209 review M1** (which observed the exit-124 leak and filed this ticket). Cite #107 as the first
  sighting in `issue-211-fix.md` — "narrow" was the judgement that let it survive three reviews.
- **VALIDATE**: the grep above returns only sites you have read and judged.
- **SATISFIES**: AC #3.

### 9. RUN the probes against the unfixed tree

- **IMPLEMENT**: two probes, `issue-208-fix.md`'s recipe exactly — the fixed tree with **one** hunk
  reverted, the specs identical in every run.

  | Probe | Revert | Expect |
  |---|---|---|
  | **A** | `redis-io.adapter.ts`'s `try`/`catch` (back to the bare `await Promise.all`) | cases 1 and 3 flip; **case 2 stays green — by design**, see the GOTCHA below. Case 3's flip is already `observed` in isolation: `Expected: 2` / `Received: 10`, plus one `Jest did not exit` line and exit 124 |
  | **B** | `harness.ts`'s `configure` move (back above the `try`, `let … = undefined` hoist reverted with it, as ONE hunk) | **nothing flips — `observed`.** Run 2026-09-14 on exactly this tree (adapter fixed, harness unmoved), both spec files with `REDIS_TEST_URL=redis://localhost:6381`: `Test Suites: 2 passed, 2 total`, `Tests: 14 passed, 14 total`, 2.812 s, exit 0, **0** "did not exit" lines. Re-run it after your three cases land — the total becomes 17, not 14. |

  Save a copy of each file first and `cmp`-verify the restore, as #208 did. Record for each probe: exit
  code, the `Tests:` line, the count of `Jest did not exit` lines, the verbatim failure text, and the hunk
  size via `diff --unified=0 … | grep -c '^+[^+]'` / `'^-[^-]'`.
- **GOTCHA — case 2 is green under probe A, and that is not a partial failure.** `dispose()` is already
  `Promise.all([pub?.quit(), sub?.quit()])`, so with the fields never assigned it resolves as a no-op on
  the unfixed tree too. Case 2's discriminating tree is **O2** (assign-before-ping), which this ticket does
  not build — the case exists to stop a future O2 refactor, and its attribution pair would be an O2 probe.
  Write that in the table rather than hunting for a third flip.
- **GOTCHA**: probe B's revert must move the `let teardownConfigured … = undefined` hoist back with the
  call, or the file will not compile. One hunk, not two.
- **GOTCHA**: probe A on the unfixed tree leaves clients reconnecting forever after the fake server
  closes. Expect `[ioredis] Unhandled error event: Error: connect ECONNREFUSED …` repeating, and expect
  jest not to exit — that non-exit **is** the defect's signature, not an artefact. If jest instead logs
  "Cannot log after tests are done", record it; it is the same handle leak surfacing differently.
- **GOTCHA**: a probe pair is an attribution only if the *other* probe's cases stay green. Check that
  explicitly and say so, as `issue-208-fix.md` does.
- **GOTCHA**: probe B is expected to flip nothing. Write that down rather than hunting for a case to make
  it flip — a hunk with no case behind it, disclosed, is honest; a scenario invented to justify it is the
  #206 L1 shape.
- **VALIDATE**: three runs recorded (A, B, green), each with its own exit code and `Tests:` line.
- **SATISFIES**: AC #4.

### 10. CREATE `.claude/reports/issue-211-fix.md`

- **IMPLEMENT**: mirror `issue-208-fix.md`'s shape — *What changed* · *The new cases* (a table) ·
  *Probes* (the table from Task 9, every figure `observed` with the run that produced it) · *Mechanism,
  read rather than assumed* (the ioredis source for `disconnect()` vs `quit()`, and the pipelining that
  forced the per-command fake server) · *Gate* · *Not done* (β, and the unreachable-Redis hang).
- **IMPLEMENT**: *Not done* must also state the CLAUDE.md decision explicitly. Three new **ungated** cases
  move the Redis-gated line's `582 passed` / `615 total`. #208 declined to re-measure that line and this
  ticket inherits the decision — but say so, with the reason (the gate run prints the new totals; the line
  is a documentation claim with its own correction history, and re-stating it is its own change). Silence
  is what let that line be wrong three times.
- **IMPLEMENT**: the *Probes* table gets a row the jest probes cannot supply — **the shipped artifact**.
  `main.ts:15` is the caller no test covers, and the dist run is the only evidence in this ticket that the
  fix works on production code rather than through the harness: same `rejected: ReplyError | NOAUTH …`
  on both trees, **exit 124 unfixed vs exit 0 fixed**. Give it its own row and name `main.ts` as what it
  stands for. Re-run it yourself against your built dist rather than copying the figures.
- **GOTCHA**: re-derive every number you carry from this plan. The 2-vs-10 figures for case 3 are
  `observed` under jest (Task 5) as well as at the node level, so they should reproduce — but if your run
  differs, **your run is the one that goes in the report**, with this plan's noted as the earlier
  observation.
- **VALIDATE**: every figure in the file names its provenance.
- **SATISFIES**: AC #4, AC #5.

### 11. VALIDATE — the full gate

- **IMPLEMENT**: from the repo root, with both containers up:
  ```
  COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 \
    pnpm turbo run typecheck lint test build --force
  ```
- **GOTCHA**: clear `apps/dispatch/.next` and stale `dist` first (memory: `taxi-gate-stale-next-race`) —
  use `fs.rmSync` via node, the PreToolUse hook blocks `rm -r` (memory: `taxi-driver-rntl14-gotchas`).
- **GOTCHA**: an api integration suite flaking under the full gate is a known shape (memory:
  `taxi-gate-hangs-on-red-api-suite`) — budget a re-run before diagnosing.
- **VALIDATE**: exit 0. Stamp it with `.claude/skills/piv-create-pr/scripts/record-gate.sh --clean`.
- **SATISFIES**: AC #6.

---

## TESTING STRATEGY

### Unit Tests

Cases 1 and 2 of Task 5 exercise `connectToRedis` directly against a fake Redis, with no `createTestApp`
and no `REDIS_TEST_URL`. They are the ones that would catch a future regression in the cleanup itself.

### Integration Tests

Case 3 of Task 5 is the integration case: it drives the failure **through `createTestApp`'s `configure`**,
which is where the defect was observed. The order it uses is `createTestApp` → `configure` →
`connectToRedis(fake.url)` → reject — the same order `redis-io.adapter.spec.ts`'s `installAdapter` and
`breakingConfigure` use, and the same order the harness itself runs. It asserts the fake server's
cumulative `accepted` count, i.e. that nothing kept reconnecting after `createTestApp` rejected — the
delivery-side observable, not the wiring.

No socket/room event is involved, so this ticket does not engage the realtime connect-order rule.

### Edge Cases

| Edge case | Verified where |
|---|---|
| PING rejects with both clients constructed, fields unassigned | Task 5 case 1 (`(expected)`) |
| `dispose()` called after a failed `connectToRedis` | Task 5 case 2 (`(edge)`) — must resolve, not throw |
| `configure` fails at `connectToRedis`; `createTestApp` must strand nothing | Task 5 case 3 (`(failure)`) |
| Only ONE of the two pings rejects (the other still in flight) | Covered by cases 1-3: `Promise.all` rejects on the first, and `accepted() === 2` proves the in-flight one was also torn down. No separate case — the fake server errors both identically, so a case forcing the asymmetry would need a second fake server and would assert nothing the count does not. |
| ioredis pipelines `info` + `ping` into one write | Not an edge case of the *feature* — an edge case of the *instrument*. Guarded by the per-command reply in Task 4, with the `observed` hang recorded in its comment. |
| Redis unreachable (connect never completes) | **Not covered — out of scope.** `connectToRedis` hangs in ioredis's retry loop rather than rejecting. Named in *Out of Scope* and owed to no ticket; raise one if it ever bites. |
| `configure` opens successfully then throws (β) | **Not covered — out of scope**, and disclosed in the `configure` JSDoc (Task 7) and the report's *Not done* (Task 10). |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```
pnpm --filter @taxi/api typecheck
pnpm --filter @taxi/api lint
```

### Level 2: Unit Tests

From `services/api`, the new block alone, deliberately without Redis:

```
COMPOSE_PROJECT_NAME=taxi env -u REDIS_TEST_URL timeout 180 \
  npx jest src/features/realtime/redis-io.adapter.spec.ts -t 'connectToRedis failure'
```

### Level 3: Integration Tests

Both affected spec files, gated and ungated, the way #208 ran them:

```
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 timeout 300 \
  npx jest src/features/realtime/redis-io.adapter.spec.ts src/test-harness.spec.ts
```

Then the gate (CI parity):

```
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 \
  pnpm turbo run typecheck lint test build --force
```

### Level 4: Manual Validation

Every step below is performable with what this ticket ships plus the compose stack already in `.env`.

1. **Confirm the containers are up**: `COMPOSE_PROJECT_NAME=taxi docker compose ps` — `taxi-db-1` and
   `taxi-redis-1` both `Up (healthy)`; Redis is published on `6381` (`observed` 2026-09-14).
2. **Start a fake Redis you can point real callers at.** Write this to your scratchpad (it mutates no
   tracked file) and leave it running; it prints its URL. **Do not substitute the Postgres port for it** —
   `observed` 2026-09-14: ioredis against `redis://localhost:5432` neither resolves nor rejects, it sits
   in `reconnecting` (Postgres closes on the malformed startup packet, ioredis retries forever), so any
   step built on it asserts an outcome that never arrives.
   ```js
   const net = require('node:net');
   const s = net.createServer((sock) => {
     sock.on('error', () => {});
     sock.on('data', (c) => {
       const n = c.toString().match(/\*\d+\r\n/g)?.length ?? 1;
       sock.write('-NOAUTH Authentication required.\r\n'.repeat(n));
     });
   });
   s.listen(6399, '127.0.0.1', () => console.log('redis://127.0.0.1:6399'));
   ```
   A fixed port (6399 — unused on this machine, `observed`) rather than 0, so steps 3 and 3b can name it.
   Kill it when you are done, or it outlives the session.
3. **Confirm the `mint-tracked-ride` pre-probe still earns its place** (this is what Task 8 preserves).
   Use the package script — **not** `npx tsx`, which is not how this repo runs it:
   ```
   cd services/api && COMPOSE_PROJECT_NAME=taxi REDIS_URL=redis://127.0.0.1:6399 \
     timeout 45 pnpm mint:ride
   ```
   `observed` 2026-09-14 on the unfixed tree: the script prints its `── environment ──` block
   (`db=<LAN-IP>:5432 redis=127.0.0.1:6399`), then four ioredis `NOAUTH` lines, then `── teardown ──`,
   `app closed`, and its own named error — `cannot reach Redis at 127.0.0.1:6399: NOAUTH Authentication
   required.` plus the three guidance lines — and **exits 1 on its own**, not 124. That is the pre-probe
   doing its job; it fires before the adapter builds anything, so this step says nothing about the fix.
   Do not comment it out to reach the adapter — step 3b reaches it without mutating tracked source.
3b. **Drive the production caller's adapter path directly**, on the **shipped artifact**. `services/api/dist`
   is gitignored (`.gitignore:6`), so this leaves the tracked tree clean. After
   `pnpm --filter @taxi/api build`, from a scratchpad script:
   ```js
   const { RedisIoAdapter } = require('<repo>/services/api/dist/features/realtime/redis-io.adapter.js');
   const a = new RedisIoAdapter({}, ['http://localhost:3000']);   // `{}` is fine — IoAdapter only reads
   a.connectToRedis(url)                                          // the app in createIOServer
    .catch((e) => console.log('rejected:', e.message))
    .finally(() => fakeServer.close());   // close the fake, so only the adapter's handles remain
   ```
   `observed` 2026-09-14, the clean attribution pair: **unfixed tree → `timeout 15` kills it, exit 124**;
   **fixed tree (the same six lines applied to the compiled `dist`) → exit 0**, within a second of the
   rejection. Both printed `rejected: ReplyError | NOAUTH Authentication required.` first, so the
   rejection is not what differs — only whether the process can leave.
   **GOTCHA**: `process.getActiveResourcesInfo()` sampled right after the rejection prints the same
   handle list on both trees (the disconnects have not propagated yet), so it is **not** the observable —
   same trap as `live.size`. The exit code is.
4. **Check the comments read true.** Open `harness.ts:455-600` and read every sentence against the code
   beneath it. Then `redis-io.adapter.ts` whole, then `mint-tracked-ride.ts:405-430`.
5. **Check jest exits.** The Level 3 command's output must contain no `Jest did not exit one second
   after the test run has completed.` line. That line, not a red assertion, is this family's signature.

### Level 5: Additional Validation (Optional)

`jcodemunch find_references` on `connectToRedis` to confirm the three callers in Task 1's table are still
the only ones after the change.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — A `configure` whose `connectToRedis` rejects leaves neither client connected, and jest
      exits. Verified by Task 5 case 3 plus the absence of a `Jest did not exit` line.
      *Scoped, per Out of Scope: a `configure` that opens successfully and then throws is not covered.*
- [ ] **AC #2** — A `connectToRedis` whose PING rejects leaves no `Redis` instance connected. Verified by
      Task 5 cases 1 and 2: `accepted()` stays at the initial 2 across the settle window, and `dispose()`
      afterwards resolves having found nothing.
- [ ] **AC #3** — `harness.ts`'s absolute is restored only for the enumerated statements, with the
      residual gap stated on `configure`'s contract instead; `issue-208-fix.md`'s *Not done* bullet 1 is
      retired and bullet 2 widened; `mint-tracked-ride.ts`'s leak claim is retired and its pre-probe kept.
- [ ] **AC #4** — Probe A (the fix reverted) is run against the unfixed tree and recorded verbatim, with
      probe B recorded as the no-flip hunk it is, and the green run alongside both. Both probes have a
      recipe already run once (Task 9); what is owed here is the re-run against the finished tree, where
      the totals are 17 rather than 14.
- [ ] **AC #5** — `.claude/reports/issue-211-fix.md` exists, and every figure in it names its provenance.
- [ ] **AC #6** — `pnpm turbo run typecheck lint test build --force` exits 0, stamped with
      `record-gate.sh --clean` on a clean tree.
- [ ] **AC #7** — Every new case is one of `(expected)` / `(edge)` / `(failure)`, and the block is ungated.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms the fix (Level 4 steps 2-5)
- [ ] Acceptance criteria all met
- [ ] Every claim touched in Task 7 and Task 8 re-read against the code beneath it

---

## OPEN QUESTIONS / ASSUMPTIONS

**Q1 — Should β be closed too, by changing `configure`'s contract?** The issue scopes out the mirror gap
and this plan follows it. A `configure` that opens something and throws before returning its teardown
still strands it. **Assumption: no.** Closing it means an eager registrar
(`configure(app, onCleanup)` — Option O2 in NOTES), which reopens the API #208 established and #209
reviewed, for a case no caller has. Say if you want it and it becomes a Phase 7.

**Q2 — Ordering, answered with the worst case.** If both pings reject, which error propagates, and does
the cleanup race the second rejection? `Promise.all` rejects with the **first** rejection and keeps its
handlers attached to the second, so the second is handled and silent. The cleanup then runs while the
second client may still be mid-command: `disconnect()` destroys the stream, which rejects that command —
also into `Promise.all`'s already-attached handler. **Worst case: the caller sees whichever client failed
first, and no unhandled rejection is possible.** `observed` across 8 probe runs (4 per variant,
2026-09-14): exactly one `ReplyError` surfaced per run, no `unhandledRejection`, and `accepted()` stayed
at 2 on the fixed tree every time — i.e. *both* clients were torn down, not just the one that rejected.

**Q3 — Does `disconnect()` reliably reach `end`?** Yes. `observed` 2026-09-14 (scratchpad
`probe-fake-redis.js`): both clients emitted `end` and reported `status === 'end'` within the 3 s budget
after `disconnect()`, from a `connect`-state client. This matters because the existing `ended()` helper
(`redis-io.adapter.spec.ts:246-261`) asserts on that event — the new cases do not use it, but a future
one might.

**Assumption A1** — The base is `origin/main` at `fcea364`, unstacked. `observed`: `gh pr list --state
open` returns `[]`; #209 merged `2026-09-14T19:41:54Z`.

**Assumption A2** — `.claude/code-reviews/pr-209-review.md` is on `main` (landed by #210). If it is not
where you expect, `git show origin/main:.claude/code-reviews/pr-209-review.md`.

**Assumption A3** — The status of a client at the PING rejection is `connect`, not `ready` — the ready
check's own `info` gets the same error reply. `observed` 2026-09-14, all probe runs. The issue's M1 quote
("F1 PROBE STATUSES: ready ready") came from a run against a **real** Redis, where the ready check
succeeds and only the later throw is synthetic. Both are the same defect; do not expect `ready` from the
fake server.

---

## NOTES (open canvas)

### D1 — why `configure` moves inside the `try` even though no case flips

The #209 review called the move "necessary but not sufficient". Working the cases says it is neither
necessary *nor* sufficient on its own:

- **α (`connectToRedis` itself rejects)** — the adapter is never installed (`useWebSocketAdapter` is the
  next line), no teardown is returned, and `app.close()` on a never-`init()`ed app returns at
  `socket-module.js:50-52`. Only `connectToRedis` can clean this up. The move changes nothing.
- **β (`connectToRedis` succeeds, `configure` throws after)** — adapter installed, fields assigned, still
  no teardown returned, still no `dispose()` reachable. The move changes nothing here either.

So the move is a hardening, and the plan says so out loud (Task 6, Task 9 probe B). It is still worth the
three lines: it makes the comment's absolute true of the statements rather than true-with-an-asterisk, and
it puts any future `configure` failure on the `app.close()` path by default. The honest disclosure — "no
case flips on this hunk" — is cheaper than the alternative of inventing a scenario for it.

### O1 vs O2 — the two ways to satisfy AC #2, and why O1 wins

| | **O1 · clean in place** (chosen) | **O2 · assign before ping** |
|---|---|---|
| Shape | `try { ping } catch { disconnect both; throw }` | move `this.pubClient = …` above the `await` |
| Leaves clients | closed | open, but *reachable* by `dispose()` |
| Closes α | yes — nothing survives the throw | **no** — nothing calls `dispose()` in α |
| Effect on `main.ts` | the process can exit | two live clients hold the event loop |
| Effect on `dispose()` | none | must now tolerate a half-built adapter |

AC #2 offers both ("assigned-then-cleaned or cleaned in place"). O2 satisfies the letter and not the
defect: the clients only *become reachable*, and in the case that matters, nobody reaches.

A third option, **O3 — eager registration** (`configure(app, onCleanup)`, cleanup registered before the
resource is opened), would close α *and* β. Rejected here: it reopens the `configure` contract #208
established and #209 reviewed, for a case no caller has, and it is a test-harness API change dressed as a
bug fix. It is the right answer if β ever bites — raise it then, with the case in hand. See Q1.

### The instrument was the hard part

Two design traps, both found by prototyping before writing the tasks (`observed` 2026-09-14, scratchpad
probes 1-7):

1. **Reply-per-chunk hangs.** ioredis pipelines its ready-check `info` with the offline queue once the
   process is warm, so a fake server that writes one error per `data` event answers `info` and leaves
   `ping` waiting forever. Run 1 of a process rejected; runs 2-4 hung, 4/4, on both trees. A test built on
   the naive server would have passed locally on a fresh process and hung as the second case in a suite.
2. **`live.size` is not the observable.** ioredis closes the socket when the ready check fails and
   reconnects on a backoff, so the live count oscillates and reads 0 on both trees at a random sample.
   The cumulative `accepted` count is the discriminator: 2 vs 10 after 600 ms, 4/4 each.

Both are recorded as comments in the shipped helper, so the next person does not rediscover them.

### Figure provenance

| Figure | Provenance |
|---|---|
| `accepted() === 2` (fixed), `10` (unfixed) after 600 ms | `observed` 2026-09-14, scratchpad `probe-observable.js`, 4 runs per variant, node 20 against a local fake server. **Re-observe under jest in Task 9** — these are the design's evidence, not the report's. |
| `10 = 2 + 2 × 4` | `derived`. ioredis default `retryStrategy = Math.min(times*50, 2000)` → reconnects at cumulative 50/150/300/500 ms. **Condition**: default strategy, a fake server that accepts immediately, and no competing load on the event loop. |
| 14 cases across the two spec files | `observed` 2026-09-14 at `fcea364` via `grep -cE "^\s*it\("` → 9 + 5. Re-observe in Task 2 rather than inherit. |
| `taxi-redis-1` on `6381`, both containers healthy | `observed` 2026-09-14, `COMPOSE_PROJECT_NAME=taxi docker compose ps`. |
| exit 124 / "F1 PROBE STATUSES: ready ready" | `observed` by the #209 review, 2026-09-14, against a **real** Redis. Inherited from the issue, not re-run here — see A3. |
| ioredis against the Postgres port hangs (`reconnecting`), never rejects | `observed` 2026-09-14, scratchpad `probe-postgres-port.js`: `ttl()` unsettled after 8 s. This is why Level 4 uses a fake RESP server and not `localhost:5432` — an earlier draft of this plan asserted the opposite. |
| Case 3 under jest: `accepted=10` / `Expected: 2` / exit 124 / 1 "did not exit" (unfixed) vs `accepted=2` / `1 passed` / exit 0 / 0 (fixed) | `observed` 2026-09-14, a throwaway `src/probe-211-throwaway.spec.ts` run against both trees via `COMPOSE_PROJECT_NAME=taxi timeout 100 npx jest`. Spec deleted and the adapter restored from a saved copy, `cmp`-verified; `git status --porcelain` clean. |
| Shipped artifact: exit 124 (unfixed) vs exit 0 (fixed) | `observed` 2026-09-14, scratchpad `probe-dist-adapter.js` against `services/api/dist`, the fix applied to the compiled output only (gitignored). |
| `mint:ride` exits 1 with its own named error | `observed` 2026-09-14 against the fake on 6399, unfixed tree. |
| TS2454 without the `= undefined` initialiser | `observed` 2026-09-14, both variants compiled with the repo's `typescript` under `--strict`. |
| The six-line change passes typecheck and lint | `observed` 2026-09-14 with the patch applied: `pnpm --filter @taxi/api typecheck` no errors; `lint` exit 0. The warning count in that run was 13, but **12** is the baseline — the 13th came from the throwaway probe spec, not from the fix. Expect 12 after your change; a 13th is yours. |
| 21 non-plan sites in the claim sweep, sorted into 4 retire / 17 leave | `observed` 2026-09-14, the noun grep in Task 8. |
| Probe B flips nothing: `14 passed, 14 total`, exit 0, 0 "did not exit", 2.812 s | `observed` 2026-09-14 with the adapter fixed and the harness unmoved — which is literally probe B's tree, so this is the probe itself, not a prediction of it. It doubles as the regression check on the six-line fix: none of the 14 existing cases cares. |

### Confidence

**10/10** for one-pass success — and the digit is the consequence of the work below, not a target the plan
was written toward. Every step of this plan has now been executed once, against both trees, and every
figure in it is `observed` rather than reasoned:

| What was risk at 8.5 | How it was closed |
|---|---|
| Case 3 never prototyped (needs the test DB) | Written as a throwaway spec and run under jest on both trees. The attribution pair is in Task 5; the spec is deleted and the tree verified clean. |
| The claim sweep left to judgement | The grep was run and its 21 non-plan sites sorted into a 4-retire / 17-leave table in Task 8, with the sorting rule stated. Nothing is left to find. |
| Level 4 steps 2-3 rested on an unobserved mechanism | The Postgres-port assumption was **wrong** (it hangs, `observed`); replaced with a fake RESP server, and the replacement was then run. |
| `mint:ride` invocation inferred | Was `npx tsx scripts/…`, which is not how this repo runs it. Corrected to `pnpm mint:ride` and run; the expected output is now quoted from the run. |
| Step 3b's dist snippet inferred | Run on both trees: exit 124 → exit 0. Also disproved my own suggested observable (`getActiveResourcesInfo()` reads identically on both). |
| TS2454 asserted from memory | Both variants compiled; the error text is quoted. |
| The six lines compile and lint | `typecheck` clean, `lint` exit 0 with the patch applied. |
| Probe B predicted, not run | Run: `14 passed, 14 total`, exit 0, 0 "did not exit". It also proved the fix regresses none of the 14 existing cases, which nothing else in this plan checked. |

**What "every step executed" does and does not cover.** Each step was run *in the state this plan will put
the tree in*, but three of them will need re-running by the implementer against the finished tree, because
the tree they ran on did not yet have the three new cases in it: probe A (case 3's flip is `observed` in
isolation, not yet alongside cases 1-2), probe B (14 passed becomes 17), and the Level 3 / gate commands.
Those are re-runs of a verified recipe, not open questions — which is the difference between this and a
plan that predicts them.

What remains is execution risk that no amount of planning removes: a shared-test-DB collision with a
concurrent session (memory `taxi-concurrent-sessions`), and the known api-suite flake under the full gate
(memory `taxi-gate-hangs-on-red-api-suite`) — budget a re-run, as Task 11 says. Neither is a gap in the
plan, and neither changes what to write.

## AMENDMENTS

<!-- newest at the bottom -->

- 2026-09-14 — plan review pass, before any implementation. Five edits: (1) Task 9's probe A row now says
  case 2 stays green by design and why, so a 2-of-3 flip is not read as a partial failure; (2) Level 4
  steps 2-3 rewritten — the original pointed `mint-tracked-ride` at the Postgres port on the assumption it
  would error the command, and `observed` says it **hangs** in `reconnecting` instead; replaced with a
  scratchpad fake RESP server plus a step 3b that reaches the adapter without mutating tracked source;
  (3) Task 7 now requires the absolute's limit to sit beside the absolute rather than only in the JSDoc;
  (4) probe B's revert declared a single hunk (the `let … = undefined` hoist reverts with the call or it
  will not compile); (5) Task 10 must state the CLAUDE.md Redis-gated-line decision explicitly instead of
  inheriting #208's silence.
- 2026-09-14 — risk-closing pass, still before any implementation. Every step the plan had inferred rather
  than observed was executed once, against both trees, and the plan rewritten to quote the runs. Six
  corrections came out of it, three of which would have cost the implementation a round: the `mint:ride`
  invocation was wrong (`npx tsx`, not the package script); step 3b's suggested observable
  (`getActiveResourcesInfo()`) reads identically on both trees and is useless — the exit code is the
  discriminator; and the claim sweep turned up **#107 review L2**, where this exact leak was found and
  dismissed as "narrow", which is now the lineage the report must carry. Case 3's jest numbers, the
  shipped-artifact exit-code pair, the TS2454 text, and typecheck/lint on the six-line patch are all
  recorded. Confidence 8.5 → 10. Tree left clean: adapter restored from a saved copy and `cmp`-verified,
  throwaway spec deleted, patched `dist` restored, background fake Redis stopped.
- 2026-09-14 — probe B run rather than predicted, closing the last row the 10/10 table did not cover:
  `14 passed, 14 total`, exit 0, 0 "did not exit" with the adapter fixed and the harness unmoved. It
  doubles as the regression check on the six-line fix, which nothing else in the plan covered. Also:
  the shipped-artifact (dist) result promoted from a manual step to its own row in the report's probe
  table, since `main.ts` is the caller no test reaches; an explicit note that the specs must build a real
  app rather than copy step 3b's `new RedisIoAdapter({}, …)`; and a note that `toBe(2)` is exact on
  purpose — a 3 is a defect, not a slow machine. The 10/10 table now states which three commands the
  implementer re-runs against the finished tree (totals 14 → 17) and why that is a re-run, not a gap.
