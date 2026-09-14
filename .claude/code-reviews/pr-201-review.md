# PR #201 review — fix(api): e2e spec boots through createTestApp, so jest exits (#200)

**Head** `8db2c3d` · **Base** `main` @ `0c844af` · round 1 · reviewer: code-reviewer agent (fresh context) + this session's numbers pass · 2026-09-14

## Summary

One file, `services/api/test/app.e2e-spec.ts`, +27 −22. The spec now boots through `createTestApp` instead of a raw `AppModule`, which removes the last Nest boot in the repo that constructed ioredis clients, and the hand run exits. The root cause named in the PR body (three ref'd 2 s ioredis `disconnectTimeout`s armed on already-closed streams) was re-derived here step by step against the installed ioredis and isolated in a standalone script; it holds. Three findings, none above Medium, all wording in the docblock. **Recommendation: approve after F1.**

Counts: Critical 0 · High 0 · Medium 1 · Low 2 · FYI 1.

## Findings

### AGENT FIXES

**F1 · Medium · provenance** — `services/api/test/app.e2e-spec.ts:10-16`
The docblock states the mechanism as fact with no `observed`/`derived` tag (the harness's own docblock tags its figures, `test/harness.ts:482`), and "the earlier dumps went empty while jest waited" is imprecise: the #200 dump was not empty at t+0 (two 6379 sockets and the server), it was empty from t+500 ms on. Fix: tag the mechanism `observed` (#200, this PR's body), and say "empty from t+500 ms on".
*The agent's prescribed wording is refused.* It proposed "(observed … on the dev box, where 6379 accepts the TCP connect but never answers INFO)", on the premise that "against a responsive Redis the clients are `ready` long before `afterEach`". Run before entering the report: against taxi's own Redis on 6381 (connect→ready 5 ms standalone) the same three timers and the same non-exit line appear, because the app lives about 10 ms after the Redis TCP connect (`DEBUG=ioredis:redis`, timestamps: `connect` 11:02:29.652–.655, `quit` written .662–.666, the ready-check `info` written .666 for one client and never for the other two). The condition is the app's lifetime, not the box. The docblock should say that.

**F2 · Low · accuracy** — `services/api/test/app.e2e-spec.ts:20-21`
"Not collected by the gate" overstates: `lint` is `eslint "{src,test,scripts}/**/*.ts"` (`services/api/package.json:15`) and `typecheck` is `tsc --noEmit` on a `tsconfig.json` with no `include`, so both see this file; only the test *run* skips it (jest `rootDir` is `src`). The phrase is inherited from the pre-PR comment. Fix: "Not run by the gate (lint and typecheck do see it)".

**F3 · Low · proportion** — `services/api/test/app.e2e-spec.ts:5-22`
18 lines of ioredis internals over a one-assertion smoke spec; the 2 s default, the connector's timer and the Node 20 handle semantics go stale silently on a dependency bump and are #200's RCA, not this spec's contract. Fix: keep why-the-harness, the symptom, and a pointer to #200 / PR #201 for the mechanism. Folded into F1's rewrite.

### FYI

**N1** — `test:e2e` shares `taxi_api_test` with the main suite (`test/global-setup.ts` drops and recreates it) and has no `pretest` compose bring-up, so it must not run concurrently with a gate. Pre-existing, unchanged by this PR, and already the rule for every integration run (`CLAUDE.md`, "one gate at a time").

### HUMAN READS

None load-bearing: no shipped source, no money, no ride state, no contract. The one thing worth a human glance is the PR body's Root cause section, because it is the record #200 asked for and will be inherited by anything that cites it.

## Docblock chain, verified against the installed ioredis 5.11.1 (agent, read-only)

| claim | where | holds |
|---|---|---|
| three `useFactory` providers each `new Redis(url)` | `kv.module.ts:11`, `dispatch.module.ts:64`, `drivers.module.ts:46`; stores at `redis-kv.store.ts:10`, `redis-dispatch-queue.store.ts:24`, `redis-driver-location.store.ts:55` | yes |
| `app.close()` sends QUIT, `disconnect()` on reject | `redis-kv.store.ts:84-90` and siblings | yes |
| QUIT writable at status `connect`, sets `manuallyClosing` | `Redis.js:358-361`, `:427-428`; `Command.js:349` | yes, so the close handler flushes with CONNECTION_CLOSED instead of scheduling a reconnect |
| flushed ready check → `recoverFromFatalError` → `disconnect(true)` → `connector.disconnect()` | `event_handler.js:86-89` → `Redis.js:560-563` → `Redis.js:246` | yes |
| ref'd 2 s timer cleared only by the stream's `close` | `AbstractConnector.js:13-24`; default `disconnectTimeout: 2000` at `redis/RedisOptions.js:10`; `StandaloneConnector.js` never nulls `this.stream` | yes |
| `_getActiveHandles()` lists no timers | timers stopped being libuv handles in Node 11; CI and the Dockerfile pin Node 20 | yes |

## Numbers pass (reviewer-run, 2026-09-14)

Every figure in the PR body was re-derived at `8db2c3d` in the wt-200 worktree, not read off the body.

| claim in the PR body | provenance | reviewer's check |
|---|---|---|
| ioredis 5.11.1, Node 20.20.2 | observed | `node -e "require('ioredis/package.json').version"` → 5.11.1; `node -v` → v20.20.2 |
| 3 ref'd 2000 ms timers from `AbstractConnector.js:17` at t+0 | observed | the `setTimeout` wrapper printed 3 stacks (6379 run); 2 at t+0 and 3 at t+300 ms (6381 run) |
| ready check outstanding when QUIT is sent | observed | `DEBUG=ioredis:redis` with timestamps, origin/main's spec, 6381: no client reaches `ready`; `quit` written 4–14 ms after `connect`, `info` after `quit` or never |
| the timer is the holder, not the socket | observed, isolated | standalone `node` script against 6381: `quit()` at status `ready` → exit 2 ms later; at status `connect` → 2004 ms and 2005 ms; only the quit timing varied |
| wall 5.0 s before / 3.0 s after, jest `Time:` ≈ 1 s | observed | reviewer's own pair: before 5.01 s / 4.98 s, after 3.03 s / 3.00 s, non-exit line printed ×2 / absent ×2 |
| difference 2.0 s = one `disconnectTimeout`, three concurrent | derived | 5.0 − 3.0 = 2.0; the three timers arm within 12 ms of each other (.664–.676) and expire together |
| `_getActiveHandles()` lists no timers on Node 20 | observed | the constructor-name probe printed no `Timeout` at any tick while `getActiveResourcesInfo()` printed `Timeout` ×2–3 in the same window |
| 6381 shows the same tail, so NOAUTH is a symptom | observed | the 6381 runs print the non-exit line with no ioredis error output |
| `git diff --stat`: 1 file, +27 −22 | observed | `gh pr view 201` → additions 27, deletions 22, changedFiles 1 |

**Subject check.** The issue's two candidates were "the ioredis `quit()`s still draining after `close()` resolves" and "the http server's close". Neither is the holder: sockets and server are gone by t+250 ms in every probe. The PR retires both subjects and names a third; the docblock and the body say the same thing. The commit body's 3.2 s / 5.7 s pair is labelled in the PR body as the transform-cache-cold first runs; both pairs were produced by runs.

**Production shutdown, for the record.** A long-lived process reaches `ready` ~5 ms after connect and its `quit()` exits in 2 ms (observed, standalone), so this mechanism does not touch a normal shutdown. Only a Redis that is down at shutdown leaves the 2 s tail (`quit()` resolves at status `reconnecting`, exit 2004 ms later), inside ioredis's own `quit()` path; the PR's reviewer note calls it out of scope correctly.

## Validation

| check | result | provenance |
|---|---|---|
| `pnpm turbo run typecheck lint test build --force` at `8db2c3d` | 22 successful, 22 total, exit 0, 1m26.262s | observed — `record-gate.sh --clean`, `.claude/last-gate.json` in wt-200 (`head` = `8db2c3d`, `short_gate` false, `dirty` false) |
| CI on the PR head | `check` pass 3m34s, `audit-diff` pass, `codeql` pass, `CodeQL` pass, `ready` pass; PR flipped ready | observed — `gh pr checks 201` |
| hand-run `npx jest --config ./test/jest-e2e.json` at `8db2c3d` | 1 passed, exit 0, no non-exit line, wall 3.03 s / 3.00 s | observed, 2 runs |
| same at origin/main's spec | 1 passed, exit 0, non-exit line printed, wall 5.01 s / 4.98 s | observed, 2 runs |
| `npx eslint test/app.e2e-spec.ts` | 0 problems | observed |
| not in the graph | `@taxi/config#{build,lint,test,typecheck}`, `@taxi/driver#build`, `@taxi/rider#build` | from the gate record; unchanged from prior PRs |

Base moved? Live `origin/main` = `0c844af` = the PR's `baseRefOid`; first round, so the guarantees pass does not apply. No implementation report exists for this branch; the PR body carries the root cause and evidence, which is the right place for a one-file fix with an investigation attached.

## What is good

- Removes the last raw `AppModule` boot in the repo; every Nest app under test now goes through the one place that swaps the Redis-dialling providers.
- The spec is the exact shape of `src/test-harness.spec.ts`, including the `as Server` cast that keeps `no-unsafe-argument` quiet.
- The RCA retired the issue's two candidate subjects with a run each, and named the instrument that was blind (`_getActiveHandles()` on Node 20), which is the reusable part.

## Recommendation

**Approve after F1** (F2 and F3 fold into the same docblock edit). `gh pr review` is refused on this repo; this report is posted as a comment.
