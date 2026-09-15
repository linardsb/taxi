# PR #212 review — round 1

**Head** `c5cfee9` · **Base** `main` @ `fcea364` · `origin/main` live tip at review time: `fcea364` (unmoved — first round, guarantees pass not applicable)
**Verdict: approve.** 0 Critical, 0 High, 2 Medium, 5 Low. Every finding is prose; no code change is required to merge.

The shipped-source fix is correct, minimal and well-argued, and I confirmed it against the installed `ioredis@5.11.1` source rather than assuming it:

- `disconnect()` stops the reconnect loop in **every** reachable state. `closeHandler` reads `manuallyClosing` before it ever consults `retryStrategy` (`node_modules/ioredis/built/redis/event_handler.js:178-182`), and `disconnect()` clears a live `reconnectTimeout` first (`built/Redis.js:238-241`) — so the `'reconnecting'` state is covered too, not just the ready-check failure.
- **No unhandled rejection is introduced or left.** `Promise.all` attaches reactions to both inputs during its synchronous iteration, so when disconnecting the second client rejects its still-pending `ping` via `flushQueue(CONNECTION_CLOSED_ERROR_MSG)` (`event_handler.js:212-215`), that rejection lands on an already-attached handler. The report's claim is right.
- **`toBe(2)` is genuinely deterministic.** `duplicate()` is `new Redis({...this.options, ...override})` over already-parsed options (`Redis.js:266-268`), inheriting `lazyConnect: false` (`built/redis/RedisOptions.js:47`), so both clients dial eagerly exactly once; with `manuallyClosing` set a third connection is not reachable.
- The rethrow preserves the original error, satisfying the harness's "the original error is what names the defect" rule.

Figure hygiene on this PR is unusually good. I re-derived the size table (`13 + 216 + 1242 = 1471`, `1 + 21 + 17 = 39`) and the case counts (`grep -cE "^\s*it\("` → 12 + 5 = 17) and all three reconcile against `gh pr view`'s numstat. The two Mediums below are both in prose, and both are the *attribution* shape CLAUDE.md names after #87 and #107 — a run that happened, credited to a mechanism it did not isolate.

---

## Validation

`observed` — independent re-run at `c5cfee9` in this checkout, `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381`:

| Command | Result |
|---|---|
| `pnpm turbo run typecheck lint test build --force` | exit **0** — `Tasks: 22 successful, 22 total`, `Cached: 0 cached, 22 total`, `Time: 1m23.752s` |
| `@taxi/api` | `Test Suites: 77 passed, 77 total` · `Tests: 733 passed, 733 total` · 47.731 s |
| `@taxi/shared` / `@taxi/dispatch` / `@taxi/driver` / `@taxi/rider` / `@taxi/db` | 231 / 224 / 218 / 140 / 17 passed |
| `gh pr checks 212` | `check` · `audit-diff` · `codeql` · `CodeQL` · `ready` — all **pass** |
| `mergeStateStatus` | `CLEAN`; base unmoved since the PR opened |

The PR body's gate block reproduces exactly bar wall-clock (`1m27.134s` there, `1m23.752s` here — expected run-to-run variance, not a discrepancy). The known `@taxi/api` flake under the full gate did not appear.

---

## Findings

### F1 · Medium · `main.ts:15` never hung, so the `dist` probe stands for no production caller

**Sites:** PR body *Summary* ("through `main.ts:15` it is a `bootstrap()` that rejects **and cannot exit**"); PR body probe table (*Shipped `dist`* row); `.claude/reports/issue-211-fix.md:79` ("stands for `main.ts:15`, which no test reaches") and `:127-136`; the *Mechanism* bullet at `:157` ("It would also leave `main.ts` rejecting with two live clients holding the event loop"); `.claude/plans/connect-to-redis-partial-state-cleanup.md:50` and `:574`.

`services/api/src/main.ts:23` is `void bootstrap();` — **no handler on the returned promise.** Under Node's default `--unhandled-rejections=throw` the rejection is raised as an uncaught exception and the process dies before the leaked clients can matter.

`observed` 2026-09-14, a replica of `main.ts`'s exact shape (`void bootstrap()`, no catch) against the same fake `-NOAUTH` server the spec uses, both arms run back to back:

```
=== UNFIXED (void bootstrap(), no catch) ===
node:internal/process/promises:391
    triggerUncaughtException(err, true /* fromPromise */);
ReplyError: NOAUTH Authentication required.   { command: { name: 'info', args: [] } }
exit=1

=== FIXED ===
   …identical output…
exit=1
```

Both trees exit **1**, within a second, with identical output. Corroboration, since the conclusion rests on the runtime default: Node **v20.20.2**; no `unhandledRejection` **or** `uncaughtException` handler anywhere in `services/api/src` or `packages/*/src`, and Nest registers none during `NestFactory.create`; `services/api/Dockerfile:86` is `CMD ["node", "dist/main.js"]` with no `NODE_OPTIONS` and no `--unhandled-rejections` flag in `compose.prod.yml`, `deploy.yml` or the runbook.

The `dist` probe's exit **124** vs **0** is therefore a property of the *probe harness*, not of `main.ts`. The plan's own probe body (`:709-711`) shows why:

```js
a.connectToRedis(url)
 .catch((e) => console.log('rejected:', e.message))
 .finally(() => fakeServer.close());
```

It **catches** — which is exactly why its output begins `rejected:`. A caught rejection lets the process keep running, so the leaked clients hold the loop; `main.ts` never reaches that state.

**The probe's evidence survives; only what it stands for changes.** It genuinely proves the fix works on the *compiled adapter* — production bytes, not the harness — and that is worth having. What it cannot do is stand for a production **caller**, because neither of the two reaches this failure path today:

- `main.ts:23` — dies on the unhandled rejection first (above).
- `scripts/mint-tracked-ride.ts:427` — guarded. The `kv.ttl('mint:ride:probe')` pre-probe at `:414-424` reaches Redis through the app's own client *before* the adapter builds two more, and throws its own named error, so `connectToRedis` is never reached when Redis is broken this way. The report's own Level 4 step 3 observes exactly that: `mint:ride` against a fake `NOAUTH` server "exits **1** on its own, not 124". This PR deliberately keeps that pre-probe.

The caller that *does* reach it is `createTestApp`'s `configure` — which is where probe A observed exit 124, and it needs no dist run to stand for it.

**Fix (prose only, 3 edits):** rewrite the report's probe-table cell at `:79` to *"stands for the compiled adapter, not for a caller: `main.ts` dies on the unhandled rejection before the leak matters, and `mint-tracked-ride.ts`'s `kv.ttl` pre-probe fires before `connectToRedis` is reached. No production caller reaches this failure path today"*; correct the plan's caller rows at `:50` and `:574` the same way; drop the "cannot exit" clause from the PR body Summary and the *Mechanism* bullet's `main.ts` half. The report's prose at `:127-128` — "the only evidence that the fix works on production code rather than through the harness" — is **true and needs no change**. **The ticket's motivation is unaffected**: the harness caller is `observed`, and the fix is right regardless of which callers reach it.

Severity is Medium rather than High because it overstates blast radius rather than understating it: nothing downstream gets de-scoped on its strength. It is Medium rather than Low because it sits in the PR body — the most-read surface and the only one not in the working tree — and because `main.ts` is named as a caller in the issue lineage.

### F2 · Medium · The fake server's rationale names a command that never reaches the wire

**Sites:** `services/api/src/features/realtime/redis-io.adapter.spec.ts:445-451` (comment); `.claude/reports/issue-211-fix.md` *Mechanism, read rather than assumed* → "The ready check is why the fake server must reply per COMMAND".

The comment says ioredis "pipelines its ready-check `info` with whatever is in the offline queue, so a reply-per-chunk server answers `info` and leaves `ping` waiting forever". **The behaviour it describes is real; the mechanism is not.** Read against `ioredis@5.11.1`:

- The offline queue is written to the socket **only** in `readyHandler` (`event_handler.js:296-308`), which a failing ready check never reaches. The `ping` is rejected straight out of the offline queue by `recoverFromFatalError` → `flushQueue` (`Redis.js:560-564`). **The fake server never sees a `ping` at all**, so it cannot leave one waiting.
- What actually coalesces is the two handshake commands in `connectHandler` (`event_handler.js:60-73`): `CLIENT SETINFO LIB-NAME` is written synchronously, `CLIENT SETINFO LIB-VER` only after `getPackageMeta()` resolves — and `getPackageMeta` is memoised (`built/utils/index.js:349-375`): a real `fs.readFile` on a process's first call, a resolved microtask on every later one. That is precisely the cold-first-run / warm-runs-2-4 split the comment records having observed (1-of-4 rejected, 3-of-4 hung).
- `INFO` cannot share their chunk: it is sent only after `Promise.all(clientCommandPromises)` settles on both SETINFO replies (`event_handler.js:75-101`). An **under-replied SETINFO** is what leaves that `Promise.all` pending — that is the hang.

The `?? 1` / repeat-per-command implementation at `:452-453` is correct and should not change. Only the explanation should.

**Fix:** rewrite the comment and the report bullet to name the two `CLIENT SETINFO` writes as what shares a chunk once `getPackageMeta` is warm, and an un-replied SETINFO — not a waiting `ping` — as what stalls the handshake. Medium because the report files it under a heading that reads *"Mechanism, read rather than assumed"*, and because the next person debugging this helper will go looking on the wire for a `ping` that is never there.

### F3 · Low · The *Not done* bullet on an unreachable Redis is wrong — it rejects, it does not hang

`.claude/reports/issue-211-fix.md:212-214`: "An UNREACHABLE Redis. `connectToRedis` hangs inside ioredis's infinite retry rather than rejecting".

`observed` 2026-09-14, the same two-client shape against a closed port `127.0.0.1:6398`:

```
L1 rejected after 10.5s: MaxRetriesPerRequestError |
  Reached the max retries per request limit (which is 20).
  Refer to "maxRetriesPerRequest" option for details.
```

`maxRetriesPerRequest` defaults to **20** (`built/redis/RedisOptions.js:52`) and `closeHandler` flushes the offline queue with `MaxRetriesPerRequestError` on the 21st close (`event_handler.js:198-210`). Against an immediately-refused port that is ~10.5 s; where each attempt burns the 10 s `connectTimeout` it is longer, but it is bounded, not infinite. (The worktree-`.env` hang this bullet gestures at is a different code path — not `connectToRedis`.)

**Positive corollary the report misses:** because that path *rejects*, the new `catch` covers it too — both clients are disconnected on the `MaxRetriesPerRequestError`. The fix is broader than the report credits it. Worth saying, since the bullet currently reads as a gap the ticket left open.

### F4 · Low · `CLAUDE.md`'s Redis-gated line is now measurably wrong, and here is the measurement

The PR declines to re-measure it and says why, so this is **disclosed, not a bare deviation** — and the drift is overwhelmingly pre-existing (`feed712` is many tickets back; this PR contributes +3 to `passed`). But the reviewer is the one holding the measurement, so:

`observed` 2026-09-14 at `c5cfee9`, `env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test`, exit 0:

```
Test Suites: 2 skipped, 75 passed, 75 of 77 total
Tests:       39 skipped, 694 passed, 733 total
```

`CLAUDE.md` currently records `Tests: 33 skipped, 582 passed, 615 total` and `Test Suites: 2 skipped, 64 passed, 64 of 66 total`. Deltas: **+6 skipped, +112 passed, +118 total, +11 suites**. The paragraph's own warning ("This line has been wrong three times") now applies to the fourth time. A one-line edit closes it — and per that paragraph, re-observe the whole claim, not the digits.

### F5 · Low · The `?? 1` fallback in the fake server's command counter — no change required now

`redis-io.adapter.spec.ts:452`: `chunk.toString().match(/\*\d+\r\n/g)?.length ?? 1` assumes every `data` event holds whole command headers. A segment boundary falling inside a command's *arguments*, after its header was already counted, makes chunk 2 match nothing and the `?? 1` fallback writes a spurious extra `-NOAUTH` against an empty command queue. (The mirror case — a boundary inside a `*N\r\n` header — is compensated by the same fallback, correct by luck.)

Unreachable in practice: the whole handshake is a few hundred bytes of small `socket.write`s over loopback, far under the MSS, and it did not fire across my two full runs plus the author's three probe runs. **Leave it.** If it ever flakes, accumulate per socket and count only complete headers, dropping the `?? 1`.

### F6 · Low · One rewrapped comment line runs 132 chars

`services/api/test/harness.ts:585` — `…plus, past the listen, a bound socket. \`afterAll\`'s \`ctx.app.close()\` then throws on top of it, nothing` sits at 132 chars in a block that otherwise wraps at ~80. Prettier does not reflow comment text, so lint is green and this is cosmetic. It reads as a hand-edit artefact from the Task 7 rewrite; rewrapping the two sentences costs nothing.

### F7 · Low · `new Redis(url)` and `.duplicate()` sit outside the `try` — audited, no defect found

`redis-io.adapter.ts:37-38`. If either constructor line ever threw, `pubClient` would leak unreachably — the same bug one line over, in a PR whose thesis is that exactly this class survived three reviews. I audited the throw path rather than inheriting the concern: `duplicate()` is `return new Redis({ ...this.options, ...override })` (`Redis.js:266-268`) over options already parsed by the `pubClient` constructor, and `new Redis(...)` defers connection rather than dialling synchronously. **No throw path found.** No change recommended — guarding it would be error handling for an impossible state, which the repo's KISS rule flags. Recorded so the next reviewer does not re-derive it.

---

## Refuted — raised by the `code-reviewer` agent, did not survive a probe

**A ref'd 2 s `disconnectTimeout` holding the event loop.** The agent read `AbstractConnector.disconnect()` arming a ref'd `setTimeout(…, disconnectTimeout)` (default 2000 ms, `RedisOptions.js:10`) cleared only by the stream's `close`, and inferred that disconnecting the second client while its ready-check `INFO` is in flight leaves that timer unclear for up to 2 s. It was labelled `derived` from a source read, not observed.

`observed` 2026-09-14, the fixed shape against the fake `-NOAUTH` server, sampling `process.getActiveResourcesInfo()` immediately after the `catch` runs:

```
[rejected] 0.012s: NOAUTH Authentication required.
[t+0.012s] {"SimpleShutdownWrap":2,"PipeWrap":2,"TCPSocketWrap":2,"Timeout":3}
[exit] at 0.014s
```

The process exits **14 ms** after start. The three `Timeout`s in the sample are the probe's own unref'd 100/1500/2500 ms sampling timers, which never fired — nothing held the loop. Refuted. (Recording it because #200 established that a ref'd `disconnectTimeout` is a real handle class in this repo; it just is not reachable here.)

---

## Checked, no issue

- **Only one of the two pings rejecting.** No unhandled rejection (above), and the surviving client is torn down by the same `catch`. The decision not to add a fourth case is sound: `accepted() === 2` already proves it.
- **`teardownConfigured` in `test/harness.ts:574` and `:669`.** `typeof … === 'function'` is correct on every path — `configure` absent → `undefined`; throws before returning → still `undefined` (skipped, and honestly documented as gap β at `:519-526`); returns `void` → `undefined`; returns a function → runs exactly once, after `app.close()`. No double-teardown: the only teardown in the tree is `adapter.dispose()`, idempotent since #205. Moving `configure` inside the `try` changes the *path* for a failing `configure` — it now reaches `app.close()` on a never-`init()`ed app — but not the ordering, and `ExpressAdapter.close()` resolves rather than throws on a server that never listened, matching the report's observation of zero masking messages.
- **`SETTLE_MS = 600`.** Two real-time sleeps, ~1.2 s added against a 1m24 s gate. The derivation checks out: cumulative reconnects at 50 / 150 / 300 / 500 ms give 4 attempts per client inside the window, `2 + 2×4 = 10` — exactly what probe A observed.
- **Probe head-independence.** The PR's argument for `redis-io.adapter.spec.ts` rests on probe A's log citing `506 |`, `507 |`, `556 |`. Those are the leading context lines of jest's two code frames around the `toBe(2)` assertions at `:508` and `:558`, and they still read verbatim. There is also a simpler proof the body does not use: `git show --stat c5cfee9` touches **only** `.claude/reports/issue-211-fix.md`, so no `services/` file moved after `2e0c756`.
- **Retired-claim sweep.** `git grep -n "connectToRedis"` over the tracked tree returns one surviving present-tense leak claim, `.claude/execution-reports/mint-tracked-ride-dev-script.md:86` — and the plan enumerates it explicitly under *"Leave (historical records — do not edit)"*. Deliberate and consistent with what #208 did to its own stale probe output.
- **Standards.** 500-line cap ✅ (`redis-io.adapter.ts` 88 lines; `harness.ts` 737, `redis-io.adapter.spec.ts` 563 and `scripts/mint-tracked-ride.ts` are all in the exempt set per #112). No `eslint-disable`, `@ts-ignore` or `@ts-expect-error` in any changed file. VSA ✅ — the fix stays inside `features/realtime/`. Nothing added to or duplicated from `packages/shared`. Money / `assertTransition()` / payment-method lock / provider seams untouched. The `adapter as unknown as { pubClient?: Redis; subClient?: Redis }` cast at `:530-533` reaches private fields from a spec, which is the only way to assert "holds nothing", and is typed optional to match the declarations — acceptable. Tests ✅ 1 expected + 1 edge + 1 failure, mirroring the slice, ungated for a stated reason.
- **Guarantees pass** — not applicable. First round, and `origin/main` is still `fcea364`, the base this PR was cut from.

---

## What's good

- **The mechanism choice is argued, not asserted.** `disconnect()` over `quit()` because it is synchronous, cannot reject, and does not wait for a `+OK` from a server that just failed — and the code comment names the *invariant* (`dispose()` cannot reach unassigned fields) rather than restating the statement below it.
- **The test's observable is the non-obvious correct one.** Cumulative `accepted()` rather than a live connection count, with the reason recorded: a live count oscillates 2 → 0 → 2 and reads 0 on *both* trees at a random sample. That is the difference between a test and a coin flip.
- **The fake server closes in `finally` for an attribution reason, not tidiness** — a red `toBe(2)` must not add a `net.Server` to the "jest did not exit" signature the revert probe reads. That is thinking about what the *probe* measures, not just what the test asserts.
- **`toBe(2)` is exact, with an explicit "do not relax this to `toBeLessThan(4)`"** and the argument for why a 3 would be a real defect rather than a slow box.
- **Probe B is disclosed as a hardening that flips nothing**, in the *What changed* bullet rather than buried — and no scenario was invented to justify it.
- **The residual gap is named rather than papered over.** `configure`'s new third constraint states plainly that a `configure` throwing before its `return` registers no teardown, and `issue-208-fix.md` bullet 2 was widened rather than a new bullet invented.
- **`mint-tracked-ride.ts:409-413` retires only the leak claim and keeps the pre-probe for the reason that survives** — a named, actionable error instead of ioredis's bare `NOAUTH`. Surgical claim-retirement of exactly the kind CLAUDE.md asks for.
- **The lineage is carried, not buried.** Naming #107 L2's *"noted, no change required … Residual is narrow"* as the judgement that let this survive two more reviews is the most useful sentence in the PR body.

---

## Recommendation

**Approve.** Validation is green end to end and independently reproduced; the shipped-source change is 13 lines, correct against the ioredis source, and pinned by three discriminating ungated cases plus a genuine revert probe.

F1 and F2 are worth landing before merge — both are one-paragraph prose edits with no code change, and both are the attribution shape this repo has now shipped to `main` twice (#87, #107). F1 in particular lives in the PR body, which is the surface a rebase never sweeps. F3 and F4 are one-line corrections. F5, F6 and F7 need no action.

Next: `piv-fix-review-findings` on F1–F4, then re-run the gate. A human reviews the code and this review, and merges.
