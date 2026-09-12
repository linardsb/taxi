# Implementation Report: GitHub Issue #193

**Issue**: api: any integration spec can redden or hang the full gate while the suite alone is green
**URL**: https://github.com/linardsb/taxi/issues/193
**RCA**: `docs/issues/issue-193.md` (this branch, `239251d` → `40891c2`)
**Branch**: `fix/api-test-harness-listen-193` (opened as `investigate/api-gate-flake-193`) in `/Users/Berzins/taxi-worktrees/wt-193`

**Root cause** (from the RCA): `createTestApp` returned an app that had `init()` but
never `listen()`, so supertest bound the shared Nest server itself once per REQUEST —
630 wildcard ephemeral binds per suite run — and a wildcard bind over a foreign
`127.0.0.1` listener inside the ephemeral range succeeds and then loses the routing,
handing the test's request to that other process.

## Drift check

The RCA's "current code" snippets matched the tree at every site: `harness.ts`'s
`createTestApp` ended at `app.init()` (line 527 as stated), and all nine spec-side
`ctx.app.listen(0)` calls were present at the named files. The worktree was clean —
the RCA's warning that `harness.ts` there "carries a shortcut that must NOT land"
(the `app.listen` no-op) was already reverted, `observed`: `git status` empty,
`git diff origin/main...HEAD` showed only the RCA doc and the three instruments.
No re-investigation needed.

## Changes made

### 1. `services/api/test/harness.ts` — the fix

- `createTestApp` now ends `await app.listen(0, '127.0.0.1');` (line 539).
- A doc-comment paragraph on `createTestApp` saying why it listens, why the host
  argument is the half that matters, and that specs must not listen again.
- `connectClient` dials `http://127.0.0.1:${port}` instead of `http://localhost:${port}`
  (line 619). **Not in the RCA's file list** — see Deviations.

### 2. Nine spec-side `listen` calls deleted (seven files)

`dispatch.integration`, `driver-location.gateway`, `driver-presence.integration`,
`realtime.gateway`, `redis-io.adapter` (×3), `ride-lifecycle.integration`,
`ride-read.integration`. Each was `await ctx.app.listen(0);` (or `nodeA`/`nodeB`)
immediately after `createTestApp()`; a second `listen` throws. Every one of these
files reads its port from `getHttpServer().address()` on the next line, which the
harness bind now satisfies.

### 3. Three investigation instruments removed

`git rm` on `services/api/test/net-probe.ts`, `test/pinned-sequencer.cjs`,
`test/spec-probe-env.cjs` — committed on this branch by the investigation, never
wired into `package.json` or `turbo.json`, and the RCA asks for them to be dropped.
`services/api/package.json` and `turbo.json` needed no change; `observed`, both were
already stock.

### 4. `services/api/src/test-harness.spec.ts` — new, the AC #4 assertion

Three cases against the real `createTestApp`:

| Case | Asserts |
|---|---|
| expected | three supertest requests add **0** binds to the harness's server |
| edge | `address()` is `{ address: '127.0.0.1', family: 'IPv4' }` — loopback-specific, not the wildcard |
| failure | a bare non-listening `http.Server` takes **one bind per request** — the control that proves the counter is not vacuous, and the exact behaviour the nine specs had before this change |

It counts binds with `server.on('listening')` on the instance, **not** by patching
`net.Server.prototype`. Deliberate: `maxWorkers: 1` runs jest in-band, so a patched
prototype survives into every later spec file — which is the instrument defect the
RCA records at its line 350, where stacked wrappers manufactured a clean, plausible,
entirely false cross-spec-contamination result.

## Validation

All runs in `/Users/Berzins/taxi-worktrees/wt-193`, `COMPOSE_PROJECT_NAME=taxi`,
machine quiet (`observed`: no `turbo`/`jest`/`vitest` process outside this session
before each batch).

### The assertion pins both halves of the fix — `observed`

Reverting each half and re-running `src/test-harness.spec.ts` (then restoring):

| Harness line | Result |
|---|---|
| `await app.listen(0, '127.0.0.1')` (shipped) | 3 passed |
| `await app.listen(0)` — host dropped | **1 failed**: `address` was `"::"`, expected `"127.0.0.1"` |
| no `listen` at all — pre-fix | **2 failed**: `server.listening` was `false` at `:55`, `address()` null at `:71` |

`observed` 2026-09-12, re-run against the shipped spec for the PR #194 review (F3).
**The bind counter is never reached on the pre-fix row**: `:55`'s
`expect(server.listening).toBe(true)` guard was added after the figure above was first
taken, and it short-circuits case 1 three lines before `countBinds()` is read. An
earlier draft of this table and of the PR body read "bind count `3`" — true of the
pre-guard spec at `56ff412`, not of the one that ships.

Without this, the spec could have been green for the wrong reason. The failure case
is not decoration — it is the only thing that distinguishes "binds once" from "the
counter never fires".

### Test runs — `observed`

| Run | Command | Result |
|---|---|---|
| targeted | `test -- src/test-harness.spec.ts` | 3 passed, 2.8 s |
| socket paths | `test -- realtime.gateway driver-location.gateway driver-presence dispatch.integration ride-read` | 6 suites, 68 tests passed, 8.1 s |
| **api alone, Redis gate ON** | `REDIS_TEST_URL=redis://localhost:6381 … --filter @taxi/api test` | **77 suites / 724 tests passed**, exit 0, 39.3 s |
| api alone, Redis gate off | `--filter @taxi/api test` | 2 skipped / 75 passed of 77; 35 skipped / 689 passed / 724 total, 35.8 s |
| typecheck | `--filter @taxi/api exec tsc --noEmit` | exit 0 |
| lint | `--filter @taxi/api lint` | 0 errors, 12 warnings — `observed` to be the `origin/main` baseline by stashing this diff and re-running; the new spec contributes 0 |

`derived`: the RCA's Redis-gate baseline is 76 suites / 721 tests (`g00`, `g02`);
76 + 1 = 77 and 721 + 3 = 724, so the whole delta is this ticket's new spec and no
existing test moved.

**The Redis-gated run is the one that matters for the deletions.** `redis-io.adapter.spec.ts`
lines 50-51 were the two riskiest sites in the diff — two apps in one file, a custom
WebSocket adapter installed in `configure` — and they sit inside `describeWithRedis`,
so every run in the RCA's investigation skipped them. The RCA's own `g02` ran with the
worktree's no-op `listen` shortcut, which **absorbed** those calls rather than exercising
their deletion (RCA line 306 says so). The run above is the first to execute that block
with the calls actually gone.

### The review-fix head — the only gate stamped on a tree that contains F1

Every gate below ran before the PR #194 review. F1 moved a line in `test/harness.ts`,
so none of them describes the tree that now ships. `observed` 2026-09-12,
`record-gate.sh --clean` at `5aa4159` with `COMPOSE_PROJECT_NAME=taxi` and
`REDIS_TEST_URL=redis://localhost:6381`, exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m28.912s
```

`@taxi/api` `77 passed, 77 total` suites / `724 passed, 724 total` tests — identical
counts to the pre-review head, which is the point: F1 changes when the harness binds,
not what any test asserts. The 1m28.912s sits with the review's own 1m27.808s and the
author's 1m29.665s, all three `record-gate.sh --clean`; the 74–78 s batches below used
the plain clearing script, and that gap is still unexplained and still not load-bearing.
An earlier run of this same source at `80bafe6`, before PR #194's squash-merge forced a
re-branch off `main`, gave 1m30.276s.

### Five consecutive full gates from cleared output — AC #3

`node clear-output.js` removes every `dist`, `.next` and `.turbo` before each run
(a node script, not `rm -r`, which the repo's PreToolUse hook refuses), then
`COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force`.

Ten gates ran, in two batches. **Batch 2 is the AC #3 evidence**; batch 1 is
supporting, because I edited two comments (no executable change) between its
second and third run, so its first two ran on a tree that is not byte-identical
to the shipped one.

| Run | Tree | Exit | Wall | Tasks |
|---|---|---|---|---|
| `b1` | `6acff5f` | 0 | 76 s | 22 successful, 22 total |
| `b2` | `6acff5f` | 0 | 74 s | 22 successful, 22 total |
| `b3` | `6acff5f` | 0 | 75 s | 22 successful, 22 total |
| `b4` | `6acff5f` | 0 | 74 s | 22 successful, 22 total |
| `b5` | `6acff5f` | 0 | 74 s | 22 successful, 22 total |
| `g1`–`g2` | pre-edit | 0 | 78 s, 76 s | 22/22 each |
| `g3`–`g5` | `6acff5f` | 0 | 75 s each | 22/22 each |

`observed`, batch 2, identical in all five runs: `@taxi/api:test` `35 skipped,
689 passed, 724 total` in 38.5–39.5 s; `@taxi/driver:test` 218/218;
`@taxi/rider:test` 140/140. `6acff5f` is `git write-tree` on the staged worktree,
checked before the batch and again after — unchanged.

**The committed tree is not `6acff5f`.** It differs in three files, none of which
was re-gated, and the delta is stated here rather than hidden behind a re-run:

- `.claude/reports/api-gate-flake-193-report.md` — this file. It cannot be
  identical, because the ledger above could not be written until the gates it
  records had finished. No turbo task reads it: `turbo.json` declares no `inputs`
  key, so each task hashes its own package directory, and `.claude/` sits outside
  every package.
- `docs/issues/issue-193.md` — the RCA's superseded claims struck in place. Same
  reasoning; `docs/` is in no package.
- `services/api/src/test-harness.spec.ts` — **one added assertion**,
  `expect(server.listening).toBe(true)` at the head of the first case, which pins
  "0 binds" to "already listening" rather than to "nothing was observed". This one
  is a real package file. `observed` after the edit: the spec is 3 passed (1.1 s)
  and `@taxi/api lint` is unchanged at 0 errors / 12 warnings. It adds an
  assertion to a passing test and touches nothing the other 76 suites read, so it
  was not worth invalidating a ten-gate ledger; if a reviewer disagrees, one gate
  settles it.

**None of the three symptom shapes appeared.** `observed`: `grep -c -E "socket
hang up|Parse Error: Expected|Exceeded timeout of|did not exit one second|
ECONNRESET|EADDRINUSE"` returns **0** on each of the ten gate logs. The api
suite's wall time is worth its own line, because a stall can hide inside a green
run: `x01`'s stall showed up as one spec file taking 81.8 s against a normal 2–4 s,
and here the whole suite lands in a 1.0 s band across five runs.

**No probability is offered for the streak, deliberately.** The RCA withdrew
exactly that move — its `(10/14)^11 = 0.025` pooled instrumented and uninstrumented
runs, which are not one population — and the honest pre-fix denominator for an
uninstrumented run on a clean tree is 2 bad in 2, which is degenerate. Ten for ten
is what happened; the argument that the mechanism is gone is the assertion in
`src/test-harness.spec.ts` and the revert probes above, not the colour.

## Deviations from the RCA

**D1 — `connectClient` now dials `127.0.0.1`, not `localhost`.** Not in the RCA's
"Files to modify". The app now binds loopback **IPv4** only, and `observed` on this
machine `dns.lookup('localhost')` returns `::1` first. Node 20's `autoSelectFamily`
is `true` by default (`observed`), so socket.io reaches us either way — this is
hardening, not a fix for a break. It stands on its own because Happy Eyeballs reaches
whoever answers `::1` **first**, which is the same wrong-process hole the loopback
bind closes on the HTTP path. One line, in the harness, same ticket.

**D2 — the AC #4 assertion is a new spec file, not a probe kept from the investigation.**
The RCA left the form open ("keep only the bind-count assertion … delete the rest").
The instance-scoped `'listening'` listener is the deviation worth naming: the
investigation's probe patched the global prototype, and under `maxWorkers: 1` that is
how it produced a false result once already.

**No other deviation.** The harness line, the nine deletions and the three instrument
removals are exactly as prescribed.

## What this does NOT claim

- **The RCA's 11 green gates do not validate what ships here.** Every one of them
  (`f01`–`f11`) used the host-less `app.listen(0)`; the shipped line is
  `listen(0, '127.0.0.1')`. Those runs are `observed` evidence for a **different**
  diff — the `once` half only. Only the five gates above carry the shipped change.
- **The withdrawn pooled probability is not repeated.** The RCA struck `(10/14)^11 = 0.025`
  for pooling instrumented and uninstrumented runs; it is not used here, and neither is
  any success-streak probability. Five greens is the acceptance criterion, not a proof.
- **The mechanism is converted, not eliminated.** Against a foreign **specific**
  `127.0.0.1` listener the new bind fails loudly with `EADDRINUSE` in `beforeAll`
  instead of silently answering from the wrong process. That is a new red shape, and
  five clean gates do not exercise it — no squatter was present on a bound port during
  any run here. Loud-and-immediate beats silent-and-wrong, which is the point; it is
  not the same as the failure being gone.
- **The added spec shifts jest's file order.** The sequencer sorts by size with no
  timing cache, so these gates did not run the RCA's "order X" and are not comparable
  to `f01`–`f06` on that axis.

### AC #4 — no `--forceExit`

`observed`, repo-wide grep excluding `node_modules`: the string appears in no
jest config, no package script and no CI workflow. The four hits are prose —
three in `docs/issues/issue-193.md`, one in `.claude/skills/piv-validate/SKILL.md:51`.

## Observations for elsewhere (not changed here)

**`piv-validate` points the next session at the forbidden flag.** `SKILL.md:51`
says that when the gate hangs with sockets open, "re-run those alone with
`--forceExit`". That is triage advice, not shipped config, so AC #4 is intact —
but it is the exact flag this issue rules out, and following it on `x01` would
have turned the stall shape into a silent pass and destroyed the only signal.
Worth a line in `system-evolution-review`; changing a skill from inside a fix PR
is how remedies get lost (per the #87 precedent, skill edits fire later and prose
edits do not fire at all).

`CLAUDE.md`'s Redis-gated line says `33 skipped, 582 passed, 615 total` /
`2 skipped, 64 passed, 64 of 66 total`, observed at #121's head `feed712`. The
skipped count is now **35**, not 33 — `observed` in the ungated run above, where
this diff changes no skipped test. The rest of that line is `derived`, not observed:
subtracting this ticket's new spec (3 passing tests in 1 suite, 0 skipped) from the
`observed` `35 skipped / 689 passed / 724 total` and `2 skipped / 75 passed / 77 total`
gives `35 / 686 / 721` and `2 / 74 / 76` for `origin/main` `bd13213` — on the
assumption that the spec is the only delta, which the Redis-gated arithmetic above
independently supports. So the gated set has grown by 2 tests and the suite by 106
since #121. That `CLAUDE.md` line is flagged there as having been wrong three times,
so this is reported rather than edited in this PR — its subject is the gated-suite
count, not this defect.

## Next

`piv-commit`, then `piv-create-pr`. The issue closes on merge.

**The branch was renamed** `investigate/api-gate-flake-193` →
`fix/api-test-harness-listen-193`. `investigate/` is not one of the prefixes
`.claude/references/conventions.md` allows, and the mirror rule puts a `fix:`
branch under `fix/`. It was local-only (`observed`: `git ls-remote --heads origin
'investigate/*'` returns nothing), so nothing is orphaned.

**Commit as three, not one** — conventions asks for one atomic concern each:

1. `fix(api): the test harness listens once, on the loopback specifically (#193)`
   — `test/harness.ts`, the nine spec-side deletions, `src/test-harness.spec.ts`.
2. `chore(api): drop the #193 investigation probes (#193)` — the three instruments.
3. `docs(reports): the #193 implementation report, and the RCA's open claims closed (#193)`
   — this file and the `issue-193.md` strikes.

Put `Fixes #193` **unbackticked, once**, in commit 1 only. A backticked
`Closes #N` merges without closing the issue, and prose near a bare `#N` has
closed one by accident — keep the keyword away from every other `#193` in the
bodies.
