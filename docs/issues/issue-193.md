# Root Cause Analysis: GitHub Issue #193

## Issue Summary

- **GitHub Issue ID**: #193
- **Issue URL**: https://github.com/linardsb/taxi/issues/193
- **Title**: api: any integration spec can redden or hang the full gate while the suite alone is green — find the cross-spec leak
- **Reporter**: linardsb
- **Status**: OPEN

## Assessment

| Metric | Value | Reasoning |
|--------|-------|-----------|
| Severity | Medium | No production code is implicated and it has never been seen in CI (0 of 9 failures in 200 runs); the cost is a wasted local gate run per flake, plus the standing risk that a real regression gets dismissed as "the flake". |
| Complexity | Low | The change is one line in `test/harness.ts` plus removing nine now-redundant `app.listen(0)` calls. No `src` file moves. |
| Confidence | **Medium** | The *churn* is proven and the ordering hypothesis is refuted, both with captured runs. What is **not** proven is the final step — why one connection out of ~630 dies. The fix removes the churn rather than fixing that race, so it is a remedy by elimination. A human should read the "What is still open" section before the fix is treated as closed. |

> Two reds were captured and instrumented in this investigation; one of them caught the failing request in the act. Everything labelled `observed` names the run that produced it. Nothing here is inherited from #127, #157 or the issue body.

## Problem Description

`@taxi/api`'s integration specs intermittently redden or hang the full gate while the same suite run alone is green.

**Expected behaviour:** `pnpm turbo run typecheck lint test build --force` is deterministic for a given tree.

**Actual behaviour:** one supertest request, in whichever integration spec happens to be running, fails with `socket hang up` (or `Parse Error: Expected HTTP/, RTSP/ or ICE/`). Which spec it is varies between runs. The issue records six files; `notifications/tracking/tracking.integration` (run `r01`) is a seventh, which is the point — the subject is the class, not any named spec.

**Symptoms:**
- `socket hang up` / `ECONNRESET` on a single request, no pattern in which test.
- `Parse Error: Expected HTTP/, RTSP/ or ICE/` (reported historically; not reproduced here).
- Occasionally a hang instead of a failure — the repo has no `--forceExit`, so jest waits on open handles.

## Reproduction

**Steps:**
1. Worktree off `origin/main` (`bd13213`), `pnpm install`, `.env` copied, `COMPOSE_PROJECT_NAME=taxi`.
2. Clear every `dist` and `apps/dispatch/.next`.
3. `npx turbo run typecheck lint test build --force`.
4. Repeat. Roughly one run in five reddens.

**Reproduction verified: Yes** — 2 reds in 12 valid full-gate runs (`observed`, ledger below). Never reproduced with the api suite alone (0 reds in 6 runs, including 3 under synthetic 8-core CPU load).

### Run ledger

All runs in `/Users/Berzins/taxi-worktrees/wt-193`, branch `investigate/api-gate-flake-193`, base `origin/main` `bd13213`. "Order X" is the 76-file sequence jest chooses with no timing cache (size-descending); `p*` runs had it pinned by a custom sequencer.

| Run | What | Order | Verdict |
|---|---|---|---|
| `r01` | full gate | X | **RED** 180 s — `tracking.integration` › "a FRESH terminal ride is still viewable", `socket hang up` |
| `r05`–`r09` | full gate | default (timing cache) | GREEN ×5, 80–88 s |
| `r10`–`r11` | full gate | default | GREEN ×2 |
| `p01` | full gate | X **pinned** | **RED** 95 s — `rides.integration` › "refuses a driver token and an anonymous request", `socket hang up` |
| `p02`–`p04` | full gate | X **pinned** | GREEN ×3 |
| `a01`–`a03` | api suite alone | X | GREEN ×3, 43–46 s |
| `L01`–`L03` | api suite alone, 8 CPU hogs | default | GREEN ×3, 70–75 s |
| `b02` | api suite alone, candidate fix applied | default | GREEN, 40 s |
| `f01`–`f06` | full gate, candidate fix applied | X **pinned** | GREEN ×6, 79–98 s, `Tasks: 22 successful, 22 total` |

Discarded, not counted: `r02`–`r04`, where the instrument itself failed `@taxi/api#lint` and turbo killed the test task mid-run.

## Root Cause

### Affected components

- **`services/api/test/harness.ts:525-527`** — `createTestApp` returns an app that has had `init()` but never `listen()`.
- **Ten spec files** build an app through it and never call `app.listen(0)`: `auth`, `customers`, `dispatch/bookings`, `drivers`, `drivers/push-token`, `geozones`, `ledger/earnings`, `notifications/tracking`, `payments`, `rides`. Nine of them issue HTTP requests.
- **`node_modules/supertest/lib/test.js:63`** — `if (!addr) this._server = app.listen(0);`
- **`node_modules/supertest/lib/test.js:143`** — `server.close(...)` once the response lands.

### Analysis

`request(ctx.app.getHttpServer())` is created once per file in `beforeAll`, but supertest builds a fresh `Test` for **every request**, and each `Test` checks `app.address()`. On an app that never listens, that is null every time, so supertest binds the shared Nest HTTP server to a new ephemeral port for the request and closes it again when the response lands.

**Evidence chain (5 Whys):**

```
WHY does a gate run redden?
  → because one supertest request gets `socket hang up`.
    evidence: p01 probe — {"ev":"cerr","code":"ECONNRESET","msg":"socket hang up",
              "path":"/rides","port":57621,"reused":false}

WHY did that request fail?
  → not because it reused a stale pooled socket: `reused:false`, and the whole
    suite records ONE pooled reuse.
    evidence: a03 reuse=1, p01 reuse=1 over 630 binds
  → the socket was fresh, and the server it was aimed at had been bound 1 ms
    earlier and was closed in the same millisecond.
    evidence: p01, port 57621 — listen −1 ms, cerr 0 ms, srv-close 0 ms

WHY is a server being bound and closed around single requests at all?
  → because supertest binds per request when the app is not listening.
    evidence: supertest/lib/test.js:63 and :143

WHY is the app not listening?
  → because `createTestApp` stops at `init()`.
    evidence: services/api/test/harness.ts:525-527

ROOT CAUSE: the api suite bind/unbind-cycles one shared HTTP server 630 times
per run, in bursts of ~111 binds/second, and under full-gate contention one of
those short-lived connections does not survive.
    evidence: a03 — 630 binds, 630 distinct ports, 623 of them (98.9%) from the
              nine never-listening specs; p01 — 80 binds in the 0.719 s around
              the failure, and rides.integration alone doing 115 binds in 2.1 s
              at a median 8 ms apart
```

**Per-file bind counts** (`observed`, a03, attributed by the probe environment's start/end intervals):

| Binds | Spec | Listens? |
|---|---|---|
| 140 | `drivers/drivers.integration` | no |
| 128 | `payments/payments.integration` | no |
| 116 | `rides/rides.integration` | no |
| 106 | `notifications/tracking/tracking.integration` | no |
| 70 | `customers/customers.integration` | no |
| 24 | `auth/auth.integration` | no |
| 21 | `drivers/push-token.integration` | no |
| 11 | `ledger/earnings.integration` | no |
| 7 | `dispatch/bookings/bookings.integration` | no |
| 1 each (7 files) | the specs that do call `listen(0)` | yes |

623 + 7 = 630. The seven files that listen once cost one bind each; the nine that do not cost 623 between them.

### Ruled out here, with the evidence

**The issue's leading hypothesis — a leaking predecessor spec — is refuted.**

The issue asked for the spec execution order on a red run and a green one, and stated the kill condition itself: *"If the predecessor is the same on both, this hypothesis is dead."*

- Order was captured on every run by a custom jest `testEnvironment` that records each file's start and end.
- `r01` (RED, full gate) and `a01`/`a02`/`a03` (GREEN, api alone) ran the identical 76-file sequence, byte for byte — `observed`, no divergence at any index.
- Stronger: `p01`–`p04` were all pinned to that same order by a custom `testSequencer` and run as full gates. `p01` reddened; `p02`, `p03`, `p04` did not. **Same order, same tree, same command — one red, three green.**
- The two reds failed in *different* specs at *different* positions (`tracking` 3rd in `r01`, `rides` 4th in `p01`), and each failing spec's predecessor also ran, in the same position, on green runs.

Order is not irrelevant — it is not the cause. Jest's sequencer sorts by file size with no timing cache and by recorded duration with one, so the order genuinely does change between runs of one tree (`observed`: `r01` vs `r05` diverge at index 0). Order X front-loads the three heaviest integration specs into the window where turbo is still building every other package, which plausibly raises the failure rate — but it does not determine it.

**Keep-alive socket reuse is not the cause.** Node 20 was a live suspect: `http.globalAgent.keepAlive` is `true` and its pool is process-global, which in band (`maxWorkers: 1`) is shared by all 76 files. It is not the mechanism here:
- The failing request's socket was not pooled (`reused:false`, p01).
- The whole suite records **one** pooled reuse per run (a03, p01).
- Ports do not recycle: 630 binds over 630 **distinct** ports, and zero ports bound by more than one spec file (a03).
- `http.Server.close()` on Node v20.20.2 destroys idle keep-alive connections, so supertest's per-request close empties the pool as it goes. `observed` — direct probe: pooled socket `destroyed=false` before `close()`, `destroyed=true` after.

**A leaked server or socket surviving a spec is not the cause.** The probe environment snapshots `process._getActiveHandles()` at every file's teardown. Across the three fully instrumented runs the live count spans 0–7 over all 76 files and ends **lower** than it starts (`observed`: r01 and p01 open at 6 and end at 2; a03 opens at 4 and ends at 0). Nothing accumulates.

**Load alone is not sufficient.** Three api-alone runs against 8 saturating CPU hogs took 70–75 s instead of 43 s and all passed (`L01`–`L03`).

**Not re-investigated**, per the issue: Redis (#127), fixed-port collision, the `db`/`api` DROP race, the #157 listener leak.

## Impact Assessment

**Scope:** local full-gate runs, roughly 1 in 5 (`observed`: 2 of 12 valid runs this session; the issue records 3 of 7 in the #189 session — the two denominators are not comparable and are not combined).

**Not CI, so far.** `observed`: across the last 200 GitHub Actions runs (2026-08-11 to 2026-09-11; 190 success, 9 failure, 1 cancelled), `gh run view --log-failed` on all nine failures matches `socket hang up` or `Parse Error: Expected` **zero** times. The two recent `main` failures were `@taxi/dispatch#test` and a permissions error in the ready job. The mechanism is present on a runner too — the same 630 binds happen there — but the failure has never been recorded in CI. That fits a contention-sensitive fault: this machine runs the gate against a full desktop workload, a runner does not. It also means a green CI run is not evidence the fix worked; the five clean local runs in AC #3 are.

**Affected features:** none. No `src` file is implicated; this is entirely a test-harness defect.

**Severity justification:** Medium, not High: the workaround (re-run the gate) always works, and no shipped behaviour is at risk. It is not Low because the cost compounds — a flake indistinguishable from a real failure trains the reviewer to re-run rather than read, which is exactly how a genuine regression gets waved through.

**Data/security:** none.

## Proposed Fix

### Strategy

Make every test app listen once, so supertest never binds. One line in the harness, and the nine `ctx.app.listen(0)` calls in specs become redundant.

`observed` (`b02`, api suite alone with the change): **630 binds → 17** — exactly one per spec file that builds an app, 17 of them — with `Tests: 35 skipped, 686 passed, 721 total`, exit 0. 630 / 17 = 37x less of the churn the root cause is made of.

**Validation run with the change in place** — `f01`-`f06`, six consecutive full gates, order pinned to X (the order both reds used), each from cleared `dist`/`.next`: **6 green**, 79-98 s, `Tasks: 22 successful, 22 total`, and **17 binds on every one of the six**.

Read that honestly. At this session's `observed` red rate of 2 in 12, six consecutive greens happen by luck about a third of the time (`derived`: (10/12)^6 = 0.33), so the colour is supportive, not conclusive. What is conclusive is mechanical and repeated six times: the bind/unbind churn the root cause is made of is gone, 630 to 17, with no test lost.

### Files to modify

1. **`services/api/test/harness.ts`** (`createTestApp`, after `app.init()`)
   - Change: `await app.listen(0);`
   - Reason: supertest's `serverAddress()` only binds when `app.address()` is null. One listen per file makes every later request reuse the already-bound port and skip the `close()` entirely.

2. **The seven spec files that call `ctx.app.listen(0)` themselves — nine call sites** (`dispatch.integration`, `ride-lifecycle.integration`, `ride-read.integration`, `driver-presence.integration`, `driver-location.gateway`, `realtime.gateway`, `redis-io.adapter` — the last has three)
   - Change: drop the now-duplicate call — a second `listen()` throws `Listen method has been called more than once without closing` (`observed`, run `b01`).
   - Reason: the harness owns it now. `redis-io.adapter.spec.ts` has three call sites across two apps and a third `ctx`, so it needs all of them.

3. **`services/api/test/harness.ts`** (doc comment on `createTestApp`)
   - Change: say why the app listens — the next person to write an integration spec needs to know that `request(ctx.app.getHttpServer())` on a non-listening app costs a bind per request.

### Alternative approaches

- **`agent: false` on every supertest chain** — opts out of pooling. Rejected: pooling is not the mechanism (`reused:false`), and it touches every call site.
- **`--forceExit`** — explicitly excluded by the issue, and correctly: it hides the hang variant without touching the cause.
- **Retry the failing request** — hides a real signal and leaves the 630 binds in place.
- **Raise `testTimeout`** — the failure is a reset, not a timeout.

### Risks and considerations

- A listening app holds a port for the whole file. Seventeen ports across a whole run, against 630 bind/unbind cycles today — strictly less pressure on the ephemeral range, not more.
- `createTestApp`'s `configure` hook installs custom WebSocket adapters before `init()`; listening after `init()` does not disturb that — `observed` for `realtime.gateway.spec.ts`, `driver-location.gateway.spec.ts` and `redis-io.adapter.spec.ts`'s **ungated** block (`b02`, `f01`-`f06`).
- **The gated half of `redis-io.adapter.spec.ts` has not been exercised under the change.** Its `nodeA`/`nodeB` apps at `:50`-`:51` sit inside `describeWithRedis`, which is `describe.skip` without `REDIS_TEST_URL`; every run in this investigation reported `2 skipped` suites / `35 skipped` tests, so those two `app.listen(0)` calls — the two most likely to throw under the fix — have never run. CI sets the variable, so the first PR run is where that would surface. `expected`, not observed: `REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test` settles it in one run, and is Testing requirement #3.
- `afterAll(() => ctx.app.close())` already exists in every spec that builds an app, and now also releases the listening socket.
- **This does not prove the final link.** It removes the conditions rather than fixing the race. If the flake survives, the next candidate is named below.

### What is still open

Why one of ~630 short-lived connections is reset has not been established. The captured evidence narrows it to a connection made 1 ms after its server was bound, on a fresh socket, with the close landing in the same millisecond. Remaining candidates, in order:

1. **A listen-backlog or accept-queue drop** under the burst — untested; needs client-side source-port and `connect`-level instrumentation.
2. **A TIME_WAIT 4-tuple collision.** The p01 ledger shows server ports advancing by 2 (57619, 57621, 57623 ...), and that is exactly what the allocator does: `observed`, a standalone probe binds `listen(0)` and connects back six times and gets `srv:54351/cli:54352`, `srv:54353/cli:54354`, and so on — server binds and client source ports come from one sequential range, `net.inet.ip.portrange` 49152-65535 on this machine. `derived`: that range holds 65535 - 49152 + 1 = 16384 ports; one api suite run takes 630 server binds plus 630 client sockets = 1260 of them, 7.7% of the range, and under the full gate every other package's tests and builds draw from the same range concurrently. Repeated runs therefore wrap it. Testable by recording `socket.localPort` on connect and checking a failing port against the run's earlier client ports.
3. **Two supertest `Test`s overlapping on the shared server**, where the first one's `close()` destroys the second's idle socket. `ledger/earnings.integration.spec.ts:69` is the one `Promise.all` over supertest chains in a never-listening spec; `ride-lifecycle.integration.spec.ts:660` and `dispatch.integration.spec.ts:1218,1260` have the same shape but in specs that do listen, so they are safe today.

### Testing requirements

1. **Fix works** — `pnpm turbo run typecheck lint test build --force` from cleared output, 5 consecutive greens (issue AC #3).
2. **No regression** — `pnpm --filter @taxi/api test` green alone: 721 tests, 2 suites skipped without `REDIS_TEST_URL`.
3. **Edge** — `redis-io.adapter.spec.ts` with `REDIS_TEST_URL` set, since it creates two apps and installs a custom adapter.
4. **The mechanism actually went away** — assert the bind count, not just the colour. Without an assertion this regresses silently the next time someone writes a spec that skips `listen`.

### Validation commands

```bash
cd <worktree> && COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test
COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force   # x5
```

## Investigation instruments

Three files, worktree-only, written for this investigation. They are **not** part of the proposed fix; `piv-implement-issue` should decide whether any of them land (the bind counter is the one worth keeping, as the AC #4 assertion above).

| File | What |
|---|---|
| `services/api/test/spec-probe-env.cjs` | jest `testEnvironment` delegating to `jest-environment-node`; records file order, duration, pid and the live-handle diff at each teardown. |
| `services/api/test/net-probe.ts` | `setupFiles` hook recording every `listen`/`close`, every `Agent.reuseSocket`, and every client request error. |
| `services/api/test/pinned-sequencer.cjs` | `testSequencer` that pins file order to a list, so red and green can be compared with order held constant. |

Also modified in the worktree: `services/api/package.json` (`testEnvironment`, `setupFiles`, `testSequencer`) and `turbo.json` (`SPEC_PROBE_LOG`, `PINNED_ORDER` in `globalEnv`).

**`test/harness.ts` in the worktree carries a shortcut that must NOT land.** To test the candidate without editing nine spec files, `createTestApp` replaces `app.listen` with a resolved no-op after listening once. That silently swallows a real double-listen. The fix should delete the nine spec-side calls instead and leave `app.listen` alone.

**One instrument defect is worth recording, because it nearly shipped a false figure.** The first `net-probe.ts` wrapped `net.Server.prototype.listen` on every `setupFiles` run. The prototype is process-global but jest gives each spec file its own **copy** of `process.env`, so the wrappers stacked and each layer reported a different spec name for the same event. That manufactured "6952 binds over 630 ports, 629 bound by more than one spec file" — a clean, plausible, entirely false cross-spec-contamination result. The real figures are 630 binds on 630 distinct ports and zero cross-spec ports. The probe now patches once per process and carries no spec name at all; attribution is done by timestamp against the environment's start/end records.

## Next Steps

1. Review this RCA — in particular the Medium confidence and "What is still open".
2. `/piv-implement-issue 193` to apply the harness change, drop the nine now-duplicate `app.listen(0)` calls, and add the bind-count assertion.
3. `/piv-commit`, then five consecutive clean gate runs from cleared output before the issue is closed.
