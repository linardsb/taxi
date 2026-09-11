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
| Confidence | **High** for the cause, **Medium** for the exact fix. The mechanism is reproduced on demand against the live foreign listeners, and all three symptom strings are accounted for by it. The `'127.0.0.1'` host argument that closes it is reasoned from that probe and has not itself been through a gate run — the 11 green runs used the host-less form. |

> Two reds were captured and instrumented in this investigation; one of them caught the failing request in the act. Everything labelled `observed` names the run that produced it. Nothing here is inherited from #127, #157 or the issue body.

## Problem Description

`@taxi/api`'s integration specs intermittently redden or hang the full gate while the same suite run alone is green.

**Expected behaviour:** `pnpm turbo run typecheck lint test build --force` is deterministic for a given tree.

**Actual behaviour:** one supertest request, in whichever integration spec happens to be running, fails with `socket hang up` (or `Parse Error: Expected HTTP/, RTSP/ or ICE/`). Which spec it is varies between runs. The issue records six files; `notifications/tracking/tracking.integration` (run `r01`) is a seventh, which is the point — the subject is the class, not any named spec.

**Symptoms:**
- `socket hang up` / `ECONNRESET` on a single request, no pattern in which test.
- `Parse Error: Expected HTTP/, RTSP/ or ICE/` — **reproduced** (`x02`, `rides.integration` › "books for the authenticated rider, ignoring a smuggled riderId"). The client read bytes that were not an HTTP response at all, which is a stronger statement than a reset: the socket was carrying something else.
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
| `f01`–`f06` | full gate, fix applied, probes wired | X **pinned** | GREEN ×6, 79–98 s, `Tasks: 22 successful, 22 total` |
| `f07`–`f11` | full gate, fix applied, **probes unwired** | default | GREEN ×5, 74–76 s, 22/22 |
| `g00` | api alone, `REDIS_TEST_URL` set, **no** fix | default | GREEN, 76/76 suites, 721/721 tests |
| `g02` | api alone, `REDIS_TEST_URL` set, fix applied | default | GREEN, 76/76 suites, 721/721 tests, 19 binds |
| `g01` | api alone, `REDIS_TEST_URL` set, fix applied | default | **RED** — and *not* this defect, see below |
| `x01` | full gate, clean tree, **no** fix | default | **HUNG** — killed at 420 s; the stall variant, below |
| `x02` | full gate, clean tree, **no** fix | default | **RED** 87 s — `rides.integration`, `Parse Error: Expected HTTP/, RTSP/ or ICE/` |

Discarded, not counted: `r02`–`r04`, where the instrument itself failed `@taxi/api#lint` and turbo killed the test task mid-run.

**`g01` is a different fault and is worth recording separately.** It came back `Test Suites: 8 failed, 68 passed`, `Tests: 50 failed, 671 passed`, first failure `expected 201 "Created", got 409 "Conflict"` on `POST /drivers/me/vehicles`. A concurrent session working in `taxi-worktrees/wt-124` independently reported the same 409 burst across four integration specs in the same window and attributed it to this session's jest loop. `g02`, the identical command once the machine was quiet, is 721/721. So that is the shared-test-database collision `CLAUDE.md` already documents — *"integration runs are mutually destructive across sessions"* — not this issue. It is a **409 on a write**, where this issue is a **`socket hang up` on a connection**: the two are distinguishable at a glance, and conflating them is how #127 got its wrong diagnosis.

### The hang variant, captured — `x01`

The issue notes that a red run sometimes presents as a hang instead. `x01` caught one on a clean tree (harness reverted, no fix, the instruments present but **unwired**), and it is worth its own paragraph because it does **not** look like the reset variant:

- `tracking.integration.spec.ts` took **81.8 s** against a normal 2-4 s, and **four consecutive tests each failed with `Exceeded timeout of 20000 ms`**. 4 x 20 s = 80 s, so the file's whole excess is those four stalls. `observed`.
- **No `socket hang up` anywhere in the run** (`grep -c` = 0), and no 409s — the four `409` matches in the log are UUID substrings and one dispatch test's duration, so this is not the cross-session database collision either.
- The suite then *finished* — `Tests: 4 failed, 35 skipped, 682 passed` — and jest printed **"Jest did not exit one second after the test run has completed."** That is what converts a red into a hang: with no `--forceExit`, turbo waits on a jest that will not leave. The issue is right to want that kept.
- Every other package passed (`rider` 140/140, `driver` 218/218).

**What this shows and what it does not.** It shows the hang is a red run plus a jest that cannot exit, not a separate disease — and that the same file can fail by *stalling* rather than by being reset. A stall fits the same shared-server churn (a connect that is accepted by nobody waits for the test timeout instead of getting an RST), but that is a reading, not a measurement: nothing here observed the stalled request's socket. The four stalls also cluster in this file's maps-seam tests, which is a pattern this investigation has not explained.

Two consequences for the fix:

1. AC #3's five clean runs must watch for **both** shapes. None of the eleven green runs with the change contains a stall, a reset or a parse error.
2. If the stall survives the fix, it is a second fault and deserves its own ticket rather than being folded into this one.

It also revises one earlier line: the per-teardown handle diff showing no accumulation (0-7, ending lower than it starts) remains true, and jest's exit-time complaint does not contradict it — handles held by four stuck requests appear *after* the last file's teardown, so they are a consequence of the failure, not evidence of the leak the issue went looking for.

## Root Cause

### Affected components

- **`services/api/test/harness.ts:525-527`** — `createTestApp` returns an app that has had `init()` but never `listen()`.
- **Ten spec files** build an app through it and never call `app.listen(0)`: `auth`, `customers`, `dispatch/bookings`, `drivers`, `drivers/push-token`, `geozones`, `ledger/earnings`, `notifications/tracking`, `payments`, `rides`. Nine of them issue HTTP requests.
- **`node_modules/supertest/lib/test.js:63`** — `if (!addr) this._server = app.listen(0);`
- **`node_modules/supertest/lib/test.js:143`** — `server.close(...)` once the response lands.

### Analysis

`request(ctx.app.getHttpServer())` is created once per file in `beforeAll`, but supertest builds a fresh `Test` for **every request**, and each `Test` checks `app.address()`. On an app that never listens, that is null every time, so supertest binds the shared Nest HTTP server to a new ephemeral port for the request (`lib/test.js:63`) and closes it again when the response lands (`:143`).

That alone is only churn. What turns churn into a failure is the second half: **`app.listen(0)` binds the WILDCARD address, and this machine has foreign processes holding listeners inside the ephemeral range.**

`observed` — every ephemeral-range listener on this machine (`lsof -nP -iTCP -sTCP:LISTEN`, range `net.inet.ip.portrange` 49152-65535):

| Port | Process | Bind |
|---|---|---|
| 49258, 49262 | `brilliant-mcp` (an unrelated MCP server, up 2 d 6 h, cwd `~/Desktop/Linards_current/ux-factory`) | `127.0.0.1` — **specific** |
| 57525, 57621 | `Spotify` | `*` — wildcard |
| 51483 | `limactl` | `127.0.0.1` — specific |
| 63262 | `rapportd` | `*` — wildcard |

A wildcard bind over a foreign **specific** listener SUCCEEDS, and then loses: the kernel routes a connection to `127.0.0.1:P` to the more specific socket. The test's request goes to the other process.

`observed`, run directly against the live squatters:

```
port 49262: bind SUCCEEDED on :::49262 despite a foreign listener
   connect to 127.0.0.1:49262 -> ESTABLISHED, no reply in 1.5 s   (a stall)
port 57621: bind SUCCEEDED on :::57621 despite a foreign listener
   connect to 127.0.0.1:57621 -> ESTABLISHED, no reply in 1.5 s   (a stall)
port 57525: bind SUCCEEDED on :::57525 despite a foreign listener
   connect answered by: "{\"type\":\"Tier1\",\"version\":\"1.0\"}\r\n"
```

That last line is the whole issue in one string. Spotify answers with JSON. A Node HTTP client reading JSON where a status line should be reports exactly **`Parse Error: Expected HTTP/, RTSP/ or ICE/`**.

**Every symptom shape maps to one outcome of talking to the wrong process:**

| Shape | What the foreign socket did | Seen in |
|---|---|---|
| 20 s stall, then a hang | accepted and never replied | `x01` (`brilliant-mcp`) |
| `socket hang up` / `ECONNRESET` | reset the connection | `r01`, `p01` (port **57621** — Spotify's) |
| `Parse Error: Expected HTTP/` | replied in another protocol | `x02`; reproduced above on 57525 |

**The `x01` hang was caught still connected.** Its jest process survived the run by 18 minutes, and `lsof` found it holding four ESTABLISHED sockets — all to `127.0.0.1:49262`, all with their far end inside `brilliant-mcp` (pid 8133), which was simultaneously listening there. Four sockets, four tests that each timed out at 20 s, and four handles that stopped jest exiting. `observed`.

**Evidence chain (5 Whys):**

```
WHY does a gate run redden?
  → one supertest request never gets a valid HTTP response.
    evidence: p01 — {"ev":"cerr","code":"ECONNRESET","msg":"socket hang up",
              "path":"/rides","port":57621,"reused":false}

WHY? → the request reached a DIFFERENT PROCESS, not the test's own app.
    evidence: 57621 is Spotify's; x01's hung jest held 4 sockets into
              brilliant-mcp on 49262, which was listening there

WHY did it reach another process?
  → `app.listen(0)` binds the wildcard. Binding the wildcard over a foreign
    127.0.0.1 listener succeeds, and the kernel then routes 127.0.0.1 traffic
    to the more specific foreign socket.
    evidence: the three-port probe above

WHY does that get hit at all?
  → supertest re-binds per request when the app is not listening, so one run
    walks 630 ephemeral ports instead of 17.
    evidence: 630 binds/run, 623 from nine never-listening specs (a03)

WHY is the app not listening?
  → `createTestApp` stops at `init()`.
    evidence: services/api/test/harness.ts:525-527

ROOT CAUSE: the suite takes 630 wildcard ephemeral binds per run on a machine
whose ephemeral range contains permanent foreign listeners, and a bind that
lands on one silently hands the test's traffic to Spotify or an MCP server.
```

**This also explains the two properties that made the issue confusing.** It never happens in CI (`observed`: 0 of 9 failures in 200 runs) because a fresh runner has no Spotify, no MCP server, no limactl. And the api suite alone almost never does it, while the full gate does, because the gate's concurrent tasks consume ephemeral ports too and push the allocator further across the range.

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

**Scope:** local full-gate runs, **4 bad in 14** on a clean tree this session (`observed`: `r01` reset, `p01` reset, `x01` stall-into-hang, `x02` parse error). The api suite alone reproduced it **0 times in 6**, three of those against 8 saturating CPU hogs — so it needs the other turbo tasks running, not merely a loaded machine. The issue's #189 session recorded 3 of 7; that denominator is not comparable and is not combined.

**A causal story I proposed and then had to withdraw.** `x01` and `x02` failed back to back, and a peer session had just reported a database collision, so I wrote up a "contention window" in which a second Claude session raised the rate. Checking rather than assuming: `lsof -d cwd` on every live `turbo`/`jest`/`vitest` process returned `wt-193` for all of them, and `wt-124` had no file change in 40 minutes. The peer was idle. The two consecutive failures have no identified cause beyond variance, and the earlier quiet-machine screen that made them look special was itself broken — it grepped for `turbo run` and counted **this** session's gate, because the worktree path is not in that command line.

The bad runs do cluster (`r01` was the session's first run; `x01`/`x02` were consecutive) and this investigation has not explained the clustering.

All three symptom shapes have now been seen on a clean tree: a reset (`r01`, `p01`), a stall that becomes a hang (`x01`), and a parse error (`x02`).

**Not CI, so far.** `observed`: across the last 200 GitHub Actions runs (2026-08-11 to 2026-09-11; 190 success, 9 failure, 1 cancelled), `gh run view --log-failed` on all nine failures matches `socket hang up` or `Parse Error: Expected` **zero** times. The two recent `main` failures were `@taxi/dispatch#test` and a permissions error in the ready job. The mechanism is present on a runner too — the same 630 binds happen there — but the failure has never been recorded in CI. That fits a contention-sensitive fault: this machine runs the gate against a full desktop workload, a runner does not. It also means a green CI run is not evidence the fix worked; the five clean local runs in AC #3 are.

**Affected features:** none. No `src` file is implicated; this is entirely a test-harness defect.

**Severity justification:** Medium, not High: the workaround (re-run the gate) always works, and no shipped behaviour is at risk. It is not Low because the cost compounds — a flake indistinguishable from a real failure trains the reviewer to re-run rather than read, which is exactly how a genuine regression gets waved through.

**Data/security:** none.

## Proposed Fix

### Strategy

Make every test app listen **once**, and on **the loopback specifically**:

```ts
await app.listen(0, '127.0.0.1');
```

Both halves matter, and the second is the one that addresses the mechanism rather than the odds:

- **`once`** takes the run from 630 ephemeral binds to 17 — 37x fewer chances to land on a squatted port. That is a probability reduction, and on its own it would leave the fault in place.
- **`'127.0.0.1'`** removes the failure mode itself. A loopback-specific bind cannot silently lose the routing:

| Foreign listener | wildcard bind (today) | loopback bind (proposed) |
|---|---|---|
| specific, e.g. `brilliant-mcp` on `127.0.0.1:49262` | succeeds, then **loses** — traffic goes to them | **EADDRINUSE**, loud and immediate |
| wildcard, e.g. Spotify on `*:57621` | succeeds, then **loses** — traffic goes to them | succeeds and **wins** — traffic is ours |

`observed`: `listen(49262,'127.0.0.1')` → `EADDRINUSE`; `listen(57621,'127.0.0.1')` → succeeds, and a connection to `127.0.0.1:57621` then reaches our socket, not Spotify's. And the allocator cooperates — **400 consecutive `listen(0,'127.0.0.1')` calls produced 400 distinct ports and hit a squatted one 0 times.**

The nine `app.listen(0)` calls in specs then become redundant and should be deleted.

`observed` (`b02`, api suite alone with the change): **630 binds → 17** — exactly one per spec file that builds an app, 17 of them — with `Tests: 35 skipped, 686 passed, 721 total`, exit 0. 630 / 17 = 37x less of the churn the root cause is made of.

**Validation with the change in place — 11 consecutive green full gates**, each from cleared `dist`/`.next`, `Tasks: 22 successful, 22 total` every time:

| Runs | Setup | Result |
|---|---|---|
| `f01`-`f06` | order pinned to X (the order both reset-reds used), probes wired | GREEN x6, 79-98 s, **17 binds each** |
| `f07`-`f11` | default order, **probes entirely unwired** — the harness change is the only difference from stock | GREEN x5, 74-76 s |
| `g02` | api alone, `REDIS_TEST_URL` set | GREEN, 76/76 suites, 721/721 tests |

`f07`-`f11` are the cleaner half: their probe logs are **0 bytes**, so nothing but the one-line harness change was in play, and they run 74-76 s against the instrumented 79-98 s.

**The mechanical result is the one that carries this**, because it does not depend on luck: the churn the root cause is made of drops **630 binds to 17** on every instrumented run, with no test lost. That is reproduced on `b02`, `f01`-`f06` and `g02`.

**The probability is weaker than a pooled figure makes it look, and the pooled figure should not be used.** The probe `appendFileSync`s on every listen and close — about 1260 writes per run, in the hot path of the very bind storm under test — and it costs 4-32% wall time (`observed`: instrumented 79-98 s, uninstrumented 74-76 s). So instrumented and uninstrumented runs are not one population, and 11-from-14 pools them:

| Population | Clean tree | With the fix | P(that many greens by luck) |
|---|---|---|---|
| probes wired | 2 bad / 12 | 0 bad / 6 | (10/12)^6 = **0.33** |
| probes unwired | 2 bad / 2 | 0 bad / 5 | base rate degenerate — no figure |
| ~~pooled~~ | ~~4 / 14~~ | ~~0 / 11~~ | ~~(10/14)^11 = 0.025~~ — **withdrawn** |

Neither honest subset reaches the 1-in-40 that the pooled number claimed. Read the streak as consistent with the fix working, and let the bind count do the arguing.

Both figures measure the `once` half only — every one of those runs used the host-less `app.listen(0)`, so none of them tested the `'127.0.0.1'` argument that actually closes the mechanism.

### Files to modify

1. **`services/api/test/harness.ts`** (`createTestApp`, after `app.init()`)
   - Change: `await app.listen(0, '127.0.0.1');`
   - Reason: supertest's `serverAddress()` only binds when `app.address()` is null, so one listen per file makes every later request reuse the port and skip the `close()`. The explicit host is what stops a bind from silently losing its traffic to a foreign listener — see the table above. Note the 11 green validation runs used `app.listen(0)` **without** the host, so they measured the probability half only; the host argument is reasoned from the direct probe, not from those runs.

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
- **The gated half of `redis-io.adapter.spec.ts` needed its own run, and got one.** Its `nodeA`/`nodeB` apps at `:50`-`:51` sit inside `describeWithRedis`, which is `describe.skip` without `REDIS_TEST_URL`, so the two `app.listen(0)` calls most likely to throw under the fix were skipped by every other run here (all of which reported `2 skipped` suites / `35 skipped` tests). `observed` (`g02`, `REDIS_TEST_URL=redis://localhost:6381`, fix applied): **`Test Suites: 76 passed, 76 total`, `Tests: 721 passed, 721 total`, exit 0**, with **19** binds — 17 plus the two extra apps that file builds. Baseline `g00`, same command on a clean tree, is also 76/76 and 721/721, so the comparison is like for like.
  - One qualification on that run: the worktree's `createTestApp` also no-ops a second `listen`, so those two spec-side calls were absorbed rather than executed. The prescribed fix **deletes** them instead, which cannot throw — but the run validates the harness half, not the deletion half.
- `afterAll(() => ctx.app.close())` already exists in every spec that builds an app, and now also releases the listening socket.
- **The two halves of the fix carry different weight.** `once` is validated over 11 gates but only lowers the odds; `'127.0.0.1'` addresses the mechanism and has not been through a gate. Run it before closing.

### What is still open

Much less than before. The mechanism is identified and reproduced directly against the live squatters, so the three candidates this section previously listed are resolved: it was not a listen-backlog drop, not a TIME_WAIT collision, and not two supertest `Test`s overlapping. It was a foreign process.

What remains:

1. **The proposed `'127.0.0.1'` host argument has not itself been run through the gate.** The 11 green runs used the host-less `app.listen(0)`. `expected`, not observed.
2. **A squatter that appears mid-run is still unhandled.** `brilliant-mcp` opens ephemeral listeners while it runs; if one appears on a port a test app already holds, behaviour is untested.
3. **Whether other developer machines have the same shape.** This is machine-specific by nature — Spotify and an MCP server are not universal — which is exactly why CI has never seen it and why "works on CI" is no evidence either way.

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

**They are committed on this branch as files, but NOT wired in** — `services/api/package.json` and `turbo.json` are untouched, so jest never loads them and they are inert (`observed`: `f07`-`f11` ran with all three present and produced 0-byte probe logs). Any PR carrying the fix will carry these three files unless `piv-implement-issue` drops them deliberately. It should: keep only the bind-count assertion from Testing requirement #4, and delete the rest.

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
