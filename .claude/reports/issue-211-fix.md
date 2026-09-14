# issue #211 — `connectToRedis` cleans up its own partial state

**Plan**: `.claude/plans/connect-to-redis-partial-state-cleanup.md`
**Branch**: `fix/connect-to-redis-partial-state-211` (off `origin/main` at `fcea364`)

`RedisIoAdapter.connectToRedis()` constructed two ioredis clients, pinged both, and assigned them to
`this.pubClient` / `this.subClient` only afterwards. A rejection at the ping left two live, retrying
clients that **no code path could reach**: the fields were still `undefined`, so `dispose()` closed
nothing, and the caller had already thrown. Three callers were exposed — `harness.ts`'s `configure`
(jest exits 124), `main.ts:15`, and `scripts/mint-tracked-ride.ts:427`.

**Seen three times before this ticket, and closed none of them.** The first sighting is **#107 review
L2** — "Two ioredis clients leak if `connectToRedis` throws between creation and assignment — *noted,
no change required* … Residual is narrow". "Narrow" is the judgement that let it survive. **#116 review
H1** replicated the connection sequence without touching it, and **#209 review M1** finally observed the
exit-124 hang and filed this ticket.

## What changed

- `services/api/src/features/realtime/redis-io.adapter.ts` — the ping is wrapped in a `try`/`catch` that
  `disconnect()`s both clients and rethrows the original error. `disconnect()` rather than `quit()`: it is
  synchronous, cannot reject, and stops the reconnect loop, while `quit()` waits for a `+OK` from the
  server we have just failed against. 76 → 88 lines, inside the 500-line cap.
- `services/api/test/harness.ts` — `options.configure` moved inside `createTestApp`'s existing `try`, with
  `teardownConfigured` hoisted as `let … = undefined`. The `catch` is unchanged: `typeof … === 'function'`
  still guards it correctly when `configure` threw before returning. **No case flips on this hunk** — see
  probe B; it is a hardening, disclosed as one.
- `services/api/test/harness.ts` — the `try` comment's absolute is restored for the enumerated statements
  (`configure` now among them) with its limit stated beside it, and `configure`'s JSDoc gains a **third
  constraint** naming the residual gap: a `configure` that throws before returning never registers its
  teardown, so whatever it opened must clean itself up.
- `services/api/scripts/mint-tracked-ride.ts` — the `kv.ttl` pre-probe is **kept**; only the leak claim in
  its comment goes, replaced by the reason that survives (a named, actionable error instead of ioredis's
  bare `NOAUTH`).
- `.claude/reports/issue-208-fix.md` — *Not done* bullet 1 struck through and pointed here; bullet 2
  widened to name the case that stays open.

## The three new cases

All **ungated**, in a top-level `describe('RedisIoAdapter.connectToRedis failure (#211)')` at
`redis-io.adapter.spec.ts:406`. Ungated deliberately: a real Redis would ANSWER the ping, so
`REDIS_TEST_URL` is the one thing these cases must not have. They run against a fake `net` server that
accepts and then answers every command with `-NOAUTH`.

| Case | Drives | Asserts |
|---|---|---|
| `closes both clients when the PING rejects (expected)` | a bare adapter on an empty module graph | `accepted()` is **2** after 600 ms |
| `leaves the adapter holding nothing, so dispose() afterwards is a no-op (edge)` | same, then `dispose()` | resolves, and both private fields are `undefined` |
| `strands nothing when a configure fails at connectToRedis (failure)` | `createTestApp` → `configure` → `connectToRedis` → reject | rejects with `NOAUTH`; `accepted()` is **2** |

**The observable is the CUMULATIVE count of connections the fake server accepted**, not the live count.
ioredis closes the socket when the ready check fails and reconnects on a backoff, so a live count
oscillates 2 → 0 → 2 and reads 0 on **both** trees at a random sample.

`SETTLE_MS = 600` is `derived`: ioredis's default `retryStrategy` is `Math.min(times * 50, 2000)` ms, so a
leaked client reconnects at cumulative 50 / 150 / 300 / 500 ms — four attempts inside the window, i.e.
`2 + 2 clients × 4 = 10` against 2. **Condition**: the default strategy and a fake server that accepts
immediately. The first divergence is at ~50 ms, so 600 ms is ~12× the margin needed. `toBe(2)` is exact on
purpose — the fix stops the reconnect loop outright rather than slowing it, so an unexpected 3 is a real
defect, not a slow machine.

Both fake-server traps are recorded as comments in the helper so the next person does not rediscover them:
the per-command reply (ioredis pipelines its ready-check `info` with the offline queue, and a
reply-per-chunk server HANGS rather than rejecting) and the live-vs-cumulative count.

## Probes

Recipe throughout, from `services/api`:
`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 timeout 60 npx jest
src/features/realtime/redis-io.adapter.spec.ts src/test-harness.spec.ts`. Each probe is the finished tree
with **one** hunk reverted; the specs are identical in all three runs. "did not exit" counts the
`Jest did not exit one second after…` line. All rows `observed` 2026-09-14 at this branch's head.

| Probe | Revert | Result | Which case flips |
|---|---|---|---|
| **A** | `redis-io.adapter.ts`'s `try`/`catch` (back to the bare `await Promise.all`) | ❌ exit **124**, `2 failed, 15 passed, 17 total`, 3.517 s, **1** "did not exit" | cases 1 and 3 |
| **B** | `harness.ts`'s `configure` move (call + `let … = undefined` hoist, reverted together) | ✅ exit **0**, `17 passed, 17 total`, 3.607 s, **0** "did not exit" | **none** |
| **Green** | — (finished tree) | ✅ exit **0**, `17 passed, 17 total`, 4.05 s, **0** "did not exit" | — |
| **Shipped artifact** | the same `try`/`catch`, applied to the compiled `dist` (gitignored) | unfixed → **exit 124**; fixed → **exit 0** | stands for `main.ts:15`, which no test reaches |

Probe A's failure text, verbatim, on both flipped cases:

```
● RedisIoAdapter.connectToRedis failure (#211) › closes both clients when the PING rejects (expected)
● RedisIoAdapter.connectToRedis failure (#211) › strands nothing when a configure fails at connectToRedis (failure)

    expect(received).toBe(expected) // Object.is equality

    Expected: 2
    Received: 10
```

The jest-level `10` matches the node-level figure the plan derived, exactly. Probe A reproduced twice
(a first run timed out in the tool at 120 s while jest hung — the same `2 failed, 15 passed, 17 total`
and 1 "did not exit" — and a second at `timeout 60` produced the 124).

**Probe size**, `observed` via `diff --unified=0 … | grep -c '^+[^+]'` / `'^-[^-]'`: **A is 1 hunk,
+1 −13** (the `try`/`catch` collapsed back to one line); **B is 2 diff hunks, +1 −6** — the call and its
hoist, which must revert together or the file does not compile (`error TS2454: Variable
'teardownConfigured' is used before being assigned.`), verified by `typecheck` passing on the reverted
tree.

**Case 2 stays green under probe A, and that is not a partial failure.** `dispose()` is already
`Promise.all([pub?.quit(), sub?.quit()])`, so with the fields never assigned it resolves as a no-op on the
unfixed tree too. Case 2's discriminating tree is **O2** (assign-before-ping), which this ticket does not
build — the case exists to stop a future O2 refactor, and its attribution pair would be an O2 probe.

**A and B are a genuine pair against the green run.** Probe A reddens only its own two cases and leaves
all 5 `test-harness.spec.ts` cases plus the other 10 adapter cases green; probe B reddens nothing at all.
Neither probe reddens the other's cases, which is what makes A an attribution rather than "something
broke".

**Neither harness masking message appeared in the green run.** `grep -c "app.close() after a failed boot
threw"` and `grep -c "the configure teardown after a failed boot threw"` are both **0**. That matters: a
`close()` that threw would mean the cases passed while covering an error path instead of the one they
name. The 6 `console.error`s in a green run are ioredis's own — exactly 2 per case, one per client, via
`Redis.silentEmit`, because neither client has an `error` listener. They appear on the unfixed tree too
and are not this suite's to silence.

**Probe B doubles as the before/after check on the harness move.** Task 6 changes which path case 3 takes:
before the move a rejecting `configure` never reaches `app.close()`; after it, the failure goes through the
`catch` and closes a never-`init()`ed real `AppModule`. Case 3 is green on both sides, which is what makes
"nothing flips" an observation rather than an assumption.

### The shipped artifact

`main.ts:15` is the caller no test covers, so the jest probes say nothing about it. The dist run is this
ticket's only evidence that the fix works on production code rather than through the harness. `observed`
2026-09-14, scratchpad `probe-dist-adapter.js` against `services/api/dist` after
`pnpm --filter @taxi/api build`, with the fix removed from the compiled output for the unfixed arm
(`dist` is gitignored, so the tracked tree stayed clean; restored and `cmp`-verified afterwards):

| Tree | Printed | Exit |
|---|---|---|
| unfixed | `rejected: NOAUTH Authentication required.`, then **46** `connect ECONNREFUSED` reconnects in 15 s | **124** (killed by `timeout 15`) |
| fixed | `rejected: NOAUTH Authentication required.` | **0**, within a second of the rejection |

Both trees print the same rejection, so **the rejection is not what differs — only whether the process can
leave**. `process.getActiveResourcesInfo()` sampled right after the rejection is NOT the observable: it
reads identically on both trees, because the disconnects have not propagated yet. The exit code is.

## Mechanism, read rather than assumed

- **`disconnect()` vs `quit()`.** `disconnect()` closes the stream immediately and, called without an
  argument, does not reconnect — it is synchronous and returns `void`, so it cannot reject and needs no
  nested `try`. `quit()` sends `QUIT` and awaits `+OK`, which a server that just errored the PING may never
  send. The failure-path rule at `harness.ts:642-664` (the original error is always what is rethrown) is
  satisfied by a bare `catch { …; throw err }` for exactly that reason.
- **No unhandled rejection is possible.** `Promise.all` subscribes to both inputs immediately, so the
  slower client's later rejection already has a handler attached. `disconnect()` on a client with an
  in-flight command rejects that command into the same attached handler. **Worst case: the caller sees
  whichever client failed first, and nothing is unhandled.** No `.catch(() => {})` is needed and none was
  added.
- **Why clean in place rather than assign before the ping.** Assigning first makes the clients *reachable*
  by `dispose()`, but in the case that matters nothing reaches them: `configure` has already thrown, no
  teardown was returned, and `app.close()` on a never-`init()`ed app returns at `socket-module.js:50-52`
  without reaching `dispose()`. It would also leave `main.ts` rejecting with two live clients holding the
  event loop. Case 2 is what pins this.
- **The ready check is why the fake server must reply per COMMAND.** ioredis pipelines its ready-check
  `info` with whatever is in the offline queue once the process is warm, so a reply-per-`data`-event server
  answers `info` and leaves `ping` waiting forever — a hang, not a rejection. `observed` during planning:
  reply-per-chunk rejected on the first run of a process and hung on runs 2-4 (4/4, both trees).
- **`dispose()` is untouched.** Its clear-then-quit ordering (#205) is load-bearing for the harness's
  run-the-teardown-on-every-failure rule.

## Gate

`observed` — `record-gate.sh --clean` at `2e0c756` on a clean tree, with
`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381`, exit **0**:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m23.883s

@taxi/api        Test Suites: 77 passed, 77 total   Tests: 733 passed, 733 total
@taxi/shared     Test Files 24 passed (24)          Tests 231 passed (231)
@taxi/dispatch   Test Files 27 passed (27)          Tests 224 passed (224)
@taxi/driver     Test Suites: 41 passed, 41 total   Tests: 218 passed, 218 total
@taxi/rider      Test Suites: 29 passed, 29 total   Tests: 140 passed, 140 total
@taxi/db         Test Files 3 passed (3)            Tests 17 passed (17)
```

The `@taxi/api` figures are the **`REDIS_TEST_URL`-set** run, in which nothing skips. They are not
comparable with `CLAUDE.md`'s gated line, which measures `env -u REDIS_TEST_URL` — see *Not done*.
**The known api-suite flake under the full gate did not appear.** The gate ran clean four times in this
pass — once plain (exit 0, 1m36.409s) and three times under `record-gate.sh --clean` as the branch was
reshaped into its final two commits. No re-run was budgeted or needed.

Level 1, `observed` at this head: `pnpm --filter @taxi/api typecheck` clean; `pnpm --filter @taxi/api lint`
**0 errors, 12 warnings** — the same 12 as the pre-change baseline, so the change adds none.

Case count, `observed` via `grep -cE "^\s*it\("`: `redis-io.adapter.spec.ts` 9 → **12**,
`test-harness.spec.ts` **5** unchanged. 14 → **17** across the two files.

Level 4 step 3, `observed`: `mint:ride` against a fake `NOAUTH` server on 6399 still prints its
`── environment ──` block, then `── teardown ──`, `app closed`, and its own named error — `cannot reach
Redis at 127.0.0.1:6399: NOAUTH Authentication required.` plus the three guidance lines — and **exits 1 on
its own**, not 124. The pre-probe Task 8 preserved still earns its place.

## Not done

- **β — a `configure` that opens something SUCCESSFULLY and then throws on a later line.** It never
  reaches its `return`, so no teardown is registered, and `app.close()` on a never-`init()`ed app returns
  at `socket-module.js:50-52` without reaching `dispose()`. Structurally the same hole as a `configure`
  that returns no teardown, arrived at from the other side — which is why `issue-208-fix.md`'s *Not done*
  bullet 2 was widened to name it rather than a new bullet being added. Closing it means changing
  `configure`'s contract from return-value to eager registration (`configure(app, onCleanup)`), which
  reopens the API #208 established and #209 reviewed, for a case no caller has. Raise it if it ever bites.
  **AC #1 is scoped to the case where `connectToRedis` itself is what throws** — the case #209 M1 observed
  and the only one reachable without a mutation.
- **An UNREACHABLE Redis.** `connectToRedis` hangs inside ioredis's infinite retry rather than rejecting —
  a different shape, already recorded against this repo's worktree `.env` gap. This ticket adds no connect
  timeout.
- **`CLAUDE.md`'s Redis-gated line is not re-measured here.** Three new **ungated** cases move its
  `582 passed` / `615 total`, and the gate run prints the new totals. #208 declined to re-measure and this
  ticket inherits the decision — but says so, rather than leaving it silent: that line is a documentation
  claim with its own correction history (wrong three times), and re-stating it is its own change with its
  own re-observation owed. Silence is what let it be wrong.
- **Only one of the two pings rejecting** gets no separate case. `Promise.all` rejects on the first and
  `accepted() === 2` proves the in-flight one was torn down too; the fake server errors both identically,
  so forcing the asymmetry would need a second fake server and would assert nothing the count does not.

## Acceptance criteria

| AC | Status | Evidence |
|---|---|---|
| **#1** — a `configure` whose `connectToRedis` rejects strands neither client, and jest exits | ✅ | case 3; **0** "did not exit" in the green run |
| **#2** — a `connectToRedis` whose PING rejects leaves no `Redis` connected | ✅ | cases 1 and 2: `accepted()` stays at 2, `dispose()` afterwards finds nothing |
| **#3** — the absolute restored for the statements only, residual stated on `configure`'s contract; `issue-208-fix.md` bullet 1 retired, bullet 2 widened; `mint-tracked-ride.ts`'s leak claim retired, probe kept | ✅ | `harness.ts:576-581` + the JSDoc's third constraint; `issue-208-fix.md:180-191`; `mint-tracked-ride.ts:409-413` |
| **#4** — probe A run and recorded verbatim, probe B recorded as the no-flip hunk it is, green run alongside | ✅ | *Probes*, all at 17 cases |
| **#5** — this file exists and every figure names its provenance | ✅ | every figure is `observed` (with its run) or `derived` (with its condition) |
| **#6** — the gate exits 0, stamped `--clean` | ✅ | *Gate* |
| **#7** — every new case is `(expected)` / `(edge)` / `(failure)`, and the block is ungated | ✅ | `describe` at column 0, `:406`; 3 passed under `env -u REDIS_TEST_URL` |

`connectToRedis`'s caller set is unchanged, `observed` via the Task 8 noun grep: the definition, `main.ts:15`,
`mint-tracked-ride.ts:427`, and the spec file — the same three callers as the plan's table.

## Deviations from the plan

Nine, all disclosed. None changes what the ticket does.

1. **The three case names differ from the plan's quoted strings.** Task 5 quoted them without the
   `(expected)` / `(edge)` / `(failure)` suffixes AC #7 requires — the plan is internally inconsistent
   there. The suffixes are appended and two names shortened:
   `'leaves the adapter holding nothing, so dispose() afterwards is a no-op (edge)'` and
   `'strands nothing when a configure fails at connectToRedis (failure)'`.
2. **Cases 1 and 2 use a new `bareAdapter()` rather than `appWithAdapter` (`:271-284`).** The plan named
   `appWithAdapter` as the builder, but it is scope-captured inside the **gated** `describeWithRedis` block
   and hardcodes `REDIS_TEST_URL!` — unreachable and unusable from an ungated block. `bareAdapter()` (`:484-493`)
   follows its pattern (a real compiled empty module, not `new RedisIoAdapter({}, …)`) and takes no URL.
   Same reason: `ALLOWED_ORIGIN`, `ended`, `allEnded` and `END_BUDGET_MS` are captured in that block too, so the new
   block declares its own `FAKE_ORIGIN`.
3. **The fake server is closed in a per-case `try`/`finally`, not an `afterAll`.** Task 4's GOTCHA allowed
   either. `finally` was chosen because `toBe(2)` throwing is exactly what probe A produces: with the close
   after the assertion, probe A would leak a `net.Server` on top of the ioredis clients and its "did not
   exit" line would stop being attributable to the adapter — which is the whole point of the pair.
4. **The apps built in cases 1 and 2 are closed in the same `finally`.** Not in the plan; same reasoning.
5. **`node:net`'s import is merged into the existing one** (`import { createServer as createNetServer,
   type AddressInfo, type Socket } from 'node:net'`) rather than added as a second line. The file already
   imported `AddressInfo` from `node:net`, and the inline-`type` form is the house idiom (`:3`, `:7-11`). The alias
   the plan asked for is kept.
6. **Probe B measures as 2 diff hunks, +1 −6, not "one hunk".** `diff --unified=0` splits it because the
   hoist and the call sit ~30 lines apart. The plan's actual requirement — that they revert *together* or
   the file will not compile — is met and verified by `typecheck` passing on the reverted tree.
7. **Probe A was run twice.** The first run hung past the tool's 120 s ceiling while jest would not exit —
   the defect's own signature — so the `timeout`-derived exit code never printed. A re-run at `timeout 60`
   produced exit 124 with an identical `Tests:` line. Both runs are the same observation; the second is
   what the table quotes.
8. **The `try` comment's paragraph is split in two** (`harness.ts:576-584`) rather than left as one block.
   Task 7 said to keep `:572-594` as-is apart from the sentence running on from the deleted parenthetical;
   deleting that parenthetical left an over-long line, and prettier does not reflow comments, so a `//`
   break was inserted at the seam. **No claim changed** — the absolute and its limit are now one
   paragraph, the consequences-of-a-throw text the other.
9. **The sleep helper is `settleLeak()`, not the plan's `settleWindow()`.** Naming only. It sits in the
   same file as `settle()` (`:33`), which waits for a different thing — a pub/sub round trip, not a leak
   window — and the two should not read as interchangeable.

**Also**: this file doubles as the PIV implementation report rather than a separate
`connect-to-redis-partial-state-cleanup-report.md`. The plan designates it as such (Task 10), and this
maintenance line (#199 → #205 → #208 → #211) names its reports `issue-N-fix.md`.

**Checked for omissions, not just changes.** Every declared task shipped: the plan has no UX section and
no loading/empty/error/offline states to tick, and every *Testing strategy* row is either implemented
(cases 1-3, the instrument's per-command reply) or explicitly out of scope in both the plan and *Not done*
above (β, an unreachable Redis, the one-ping-only asymmetry). Level 4's five manual steps were all run;
Level 5's optional `jcodemunch find_references` was covered by the Task 8 noun grep instead, which returns
the same caller set.

## Issues encountered

- **No migration was added**, so no schema skew to record. `ls db/migrations/*.sql | tail -1` is unchanged
  by this branch.
- **The api suite's known flake under the full gate did not appear.** Both gate runs (the plain one and the
  stamp) were green on the first pass; no re-run was budgeted or needed.
- **The plan's Level 4 step 3 reproduced exactly**, including `mint:ride` exiting 1 rather than 124 — so
  Task 8's rewrite of that comment did not disturb the probe it describes.
