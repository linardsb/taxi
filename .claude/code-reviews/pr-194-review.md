# PR #194 review — `fix(api): the test harness listens once, on the loopback specifically (#193)`

**Head** `e6138ae` · **Base** `main` @ `bd13213a9904217bfdb3d53f7a48824127efcace` · **Round** 1
**Reviewed** 2026-09-11 · fresh context · `code-reviewer` agent dispatched · every finding reproduced before it was recorded

## Verdict

**Request changes** — Critical 0 · High 0 · Medium 2 · Low 7. The diagnosis holds, the fix is right, and
the evidence behind it is better than most of what lands here. What needs doing is one **moved line** and a
set of **comment and figure corrections**, one of which is a false cause this PR is the natural place to
retire.

**The root cause survives independent scrutiny, including an attempt to break it.** I reproduced the
routing half directly (Node 20.20.2, darwin), binding explicit ports:

| Probe (explicit port `P`, as the RCA's table is) | Result |
|---|---|
| foreign `127.0.0.1:P` listener, then a wildcard bind on `P` | bind **succeeds** on `:::P`; a connection to `127.0.0.1:P` is answered by the **foreign** socket |
| foreign `*:P` listener, then a loopback bind on `P` | bind succeeds; the connection is answered by **ours** |
| foreign `127.0.0.1:P` listener, then a loopback bind on `P` | **EADDRINUSE** |

All three rows of `docs/issues/issue-193.md:248-251` hold. I then tried to falsify the *selection* step —
whether an ephemeral bind can land on a port something already holds — and could not reproduce it in a
quiet range (FYI-1). That is a scoping result, not a refutation: `issue-193.md:144-145` records the failing
request's own port as `57621` (Spotify's) and `:137` records `x01`'s hung jest holding four ESTABLISHED
sockets into `brilliant-mcp` at `49262` while it was listening there. Two direct observations of the
outcome outweigh a negative result under conditions the RCA itself says are not the failing ones (api
alone: 0 in 6). The mechanism stands as written, and so does "converted, not eliminated".

---

## Routing

**AGENT FIXES**

- **F1** `services/api/test/harness.ts:540` — move `await app.listen(0, '127.0.0.1')` below the self-checks,
  to just before the `return` at `:565`. Diff given; prescribed fix already run green.
- **F2** `services/api/src/features/payments/payments.integration.spec.ts:66-68` — delete or replace a
  comment that blames a cause Nest's own source rules out.
- **F3** `services/api/src/test-harness.spec.ts:55` (the claim lives in the PR body) — "the bind counter
  reads 3" needs the clause "with the `server.listening` guard disabled", or drop the digit.
- **F4** `.claude/reports/api-gate-flake-193-report.md:6` — pre-rename branch name.
- **F5** `services/api/src/test-harness.spec.ts:82` — comment naming the control's two wildcard binds.
- **F6** `docs/issues/issue-193.md:257` (also `:269`, `:305`) — the post-fix bind figure is `17` for a tree
  that predates the new spec; as shipped it is 20, or 22 with Redis.
- **F9** `services/api/src/test-harness.spec.ts:1` — `node:` import prefix, and the
  `(expected)`/`(edge)`/`(failure)` name suffixes every sibling spec uses.

**HUMAN DECIDES**

- **F7** `services/api/scripts/mint-tracked-ride.ts:432` — `await app.listen(0)`, the same wildcard bind
  this PR retires, then a dial to `127.0.0.1`. One word to fix, and CLAUDE.md's "grep the noun, not the
  sentence" argues for doing it here; it is also out of diff and out of the gate, so it is a scope call.
- **F8** `services/api/test/app.e2e-spec.ts:15` — same class, in the unrun Nest scaffold. Fix the host, or
  delete the file if nothing runs it; deleting is a judgment call.

**HUMAN READS**

- `services/api/test/harness.ts:537` — the `createNestApplication` → `configure` → `init` → `listen` →
  self-check → `return` sequence through `:565`. The whole load-bearing change, every api integration spec
  depends on it, and F1 lives in its ordering.

**HUMAN TESTS**

- `services/api/test/harness.ts:540` — after F1 lands, re-run the gate from cleared output. F1 is a code
  change, so the PR's head-stamped validation stops describing the tree.

**FYI** — FYI-1 through FYI-5 below.

---

## Findings

### F1 — Medium · `listen()` runs before the self-checks, so a failed DI override hangs jest

`services/api/test/harness.ts:540`

`await app.listen(0, '127.0.0.1')` sits between `app.init()` and the two self-checks that throw when a
`DISPATCH_QUEUE_STORE` or `PAYMENTS_PROVIDER` override does not take (`:548`, `:559`). Nothing catches those
throws, so the app is left **listening** with `ctx` unassigned, `afterAll`'s `ctx.app.close()` throws on top
of the real failure, and the open socket holds the process.

`observed` — queue self-check forced to throw, `npx jest src/test-harness.spec.ts`:

```
DISPATCH_QUEUE_STORE override did not take: [...]
TypeError: Cannot read properties of undefined (reading 'app')
Tests: 3 failed, 3 total
Jest did not exit one second after the test run has completed.
```

`observed` — the **same** forced throw with the listen removed (the pre-PR shape):

```
TypeError: Cannot read properties of undefined (reading 'app')
Tests: 3 failed, 3 total
```

No "did not exit" line. **The hang is a regression this PR introduces**, and it is the symptom class #193
exists to remove: a red self-check used to fail loudly in seconds and now produces a hung api suite — the
shape that cost this ticket an investigation. The Drizzle pool leaked on this path before too; the
listening socket is what turns the leak into a hang.

The multi-app case is worse in the same way: at `src/features/realtime/redis-io.adapter.spec.ts:48-49`, if
the **second** `createTestApp` throws, `nodeA` closes at `:56`, `:57` then throws on `nodeB`, and nodeB's
half-built listening app leaks.

Narrow trigger — a broken DI override is developer error, not a runtime path — hence Medium.

**Fix** — move the listen below the self-checks. Nothing between `init()` and the return needs a listening
server; both self-checks are `app.get()` calls.

```diff
   await app.init();
-  await app.listen(0, '127.0.0.1');

   // THE SELF-CHECK. [...]
@@
   }

+  await app.listen(0, '127.0.0.1');
+
   return {
     app,
```

`observed`, prescribed fix applied and the self-check restored, `npx jest` with `REDIS_TEST_URL`:
`Test Suites: 77 passed, 77 total`, `Tests: 724 passed, 724 total`, 41.912 s. And with the fix in place the
forced-throw probe gives the TypeError with **no** "did not exit". Verified in all three directions, not
prescribed on reasoning. A `try/catch` around `:548-563` calling `await app.close()` before rethrowing works
too, and is the better shape if `createTestApp` later grows work that needs the port.

### F2 — Medium · a comment blames a cause this PR's own RCA replaced

`services/api/src/features/payments/payments.integration.spec.ts:66-68`

```
    // `createTestApp` already calls `app.init()`; a second one re-runs
    // bootstrap and leaves the HTTP adapter in a state supertest reads as a
    // malformed response under parallel load.
```

`init()` cannot re-run bootstrap. `node_modules/@nestjs/core/nest-application.js:95-98`:

```js
    async init() {
        if (this.isInitialized) {
            return this;
        }
```

So the named mechanism is impossible — and the symptom it describes, *a malformed response*, is exactly
`Parse Error: Expected HTTP/, RTSP/ or ICE/`, which this PR has now explained properly. The comment records
the right symptom under a refuted cause, in the same service, in a spec that shares the `harness` this PR
fixes. The next person to hit a Parse Error will read it and go hunting a double-init that cannot happen.

Above the reviewing agent's Low because CLAUDE.md is explicit that retiring a bad claim means retiring its
**subject** and grepping the noun — and this is the noun, one directory away from the change.

**Fix** — replace with a pointer to the real invariant (`// #193: the harness listens; never listen or init
again here.`) or delete it, since `test/harness.ts:479-489` now documents it.

### F3 — Low · "the bind counter reads 3" describes a run the shipped spec cannot produce

PR body, *Manual check — the assertion fails when either half of the fix is reverted*:

> with no `listen` at all, the bind counter reads **3** — one per request — and two cases fail.

Two cases do fail. The counter is never read. `src/test-harness.spec.ts:55` asserts
`expect(server.listening).toBe(true)` **three lines before** `countBinds()` is called, so with the listen
removed case 1 short-circuits there.

`observed`, shipped spec + listen removed — first failure is the `listening` guard at `:55`, counter never
evaluated, `Tests: 2 failed, 1 passed, 3 total`.
`observed`, spec at `56ff412` (pre-guard) + listen removed — `PROBE binds=3`, `Tests: 2 failed, 1 passed`.

The digits are right; they were observed on the pre-guard spec. `git diff 6acff5f e6138ae --
services/api/src/test-harness.spec.ts` is exactly the addition of that guard, so the figure was taken
before it landed and not re-derived after. Worth naming precisely because this PR is otherwise scrupulous
about provenance.

**Fix** — one clause, or drop the digit and keep "two cases fail", which is what the shipped spec shows.

### F4 — Low · the shipped report names the old branch

`.claude/reports/api-gate-flake-193-report.md:6` — `**Branch**: investigate/api-gate-flake-193`. The PR body
records the rename to `fix/api-test-harness-listen-193`. The report ships inside the PR, so this is the
first line a reader lands on.

### F5 — Low · the control case re-takes two wildcard binds per run

`services/api/src/test-harness.spec.ts:82-95` — the third case drives a non-listening bare `http.Server`
through supertest, which is the hazardous path by construction: 2 wildcard ephemeral binds per run, against
the 630 the PR removes.

Keep the case — it is what stops case 1 passing vacuously, and you cannot demonstrate per-request binding
without letting a bind happen. **The self-collision variant is refuted**: with 2000 loopback ports held by
listening sockets in the same process, 3000 wildcard ephemeral binds landed on one **0** times, so the
control cannot steal `createTestApp`'s own port.

**Fix** — a comment, no code change. If it ever reddens with `Parse Error: Expected HTTP/`, the reader needs
to know immediately that it is those two binds and not a return of #193.

### F6 — Low · the post-fix bind figure describes a pre-spec tree

`docs/issues/issue-193.md:257`, `:269`, `:305` — `630 → 17` and "Seventeen ports", `observed` on `b02`,
which predates `src/test-harness.spec.ts`. As shipped it is **20**: `derived` — 20 `createTestApp` call
sites (`observed`, grep over `services/api/src`), of which 2 sit inside `describeWithRedis` and skip by
default, so 18 app binds plus the control's 2 wildcard binds. With `REDIS_TEST_URL` set, 20 + 2 = **22**.

The two in-code figures are fine: `test/harness.ts:481-483` and `src/test-harness.spec.ts:10-12` say "630 …
where listening once costs one per app built", which stays true as files are added. **Fix** — one clause in
the doc. Consider having the spec's docblock point at `test/harness.ts`'s rather than restating the figure;
it is currently duplicated verbatim in two files, so a future correction will miss one.

### F7 — Low · the same wildcard bind survives in a dev script

`services/api/scripts/mint-tracked-ride.ts:432` — `await app.listen(0)`, then `baseUrl =
http://127.0.0.1:${address.port}` at `:441`. That is the PR's own mechanism verbatim: a wildcard bind, a
loopback dial. Low because the script is a hand-run instrument outside the gate, so nothing is
flaky-by-default. One word (`'127.0.0.1'`) fixes it, and `listen(0)` is precisely the noun CLAUDE.md tells
you to grep when retiring this claim.

### F8 — Low · same class, in the unrun Nest scaffold

`services/api/test/app.e2e-spec.ts:15-20` — `app.init()` then `request(app.getHttpServer())`: one wildcard
ephemeral bind per request. Not collected by the gate (`services/api/package.json:76` sets jest
`rootDir: "src"`), so exposure is limited to a hand-run `test:e2e`. Fix the host, or delete the file if
nothing runs it.

### F9 — Low · two house-style slips in the new spec

`services/api/src/test-harness.spec.ts:1-2` — `from 'net'` / `from 'http'` where every sibling uses the
`node:` prefix (`realtime.gateway.spec.ts:8`, `redis-io.adapter.spec.ts:3-4`, and five more). No lint rule
enforces it.

`:50`, `:67`, `:78` — the three cases are expected/edge/failure in substance, and the report says so at
`api-gate-flake-193-report.md:55-59`, but the names carry none of the `(expected)`/`(edge)`/`(failure)`
suffixes the siblings use (`redis-io.adapter.spec.ts:162,169,178`). The rule is met; the label that makes it
auditable at a glance is missing.

---

## FYI

- **FYI-1 · the selection step is load-dependent, which sharpens RCA item 2 rather than closing it.**
  `observed`: in a quiet ephemeral range an ephemeral bind never selected an occupied port — **18,000
  binds, 0 hits**, across five configurations (holder specific/wildcard × prober specific/wildcard,
  cross-process, 2000 ports held each; plus 1500 ports held as ESTABLISHED local ports with no listener),
  against a uniform-selection prediction of ~275–366 per cell. That does **not** contradict `p01` or `x01`,
  which are connect-side records of the real outcome; it bounds the conditions, and the RCA already names
  them (the fault needs the full gate; api alone is 0 in 6). What it does add is that `issue-193.md:320`'s
  "a squatter that appears mid-run is still unhandled" is narrower than it reads: `observed`, with ours
  bound first on `127.0.0.1:P`, a later wildcard squatter binds `:::P` and the connection is still answered
  by **ours**, and a later specific squatter gets `EADDRINUSE`. A squatter arriving after us cannot take
  our traffic on the HTTP path.
- **FYI-2 · two different "eleven green gates" figures sit in the PR body**, one of them explicitly
  excluded: the RCA's eleven (host-less `app.listen(0)`) and this PR's ten-plus-the-recorded-run. Both are
  labelled correctly and `issue-193.md:316` keeps them apart. Named only because a later reader grepping
  "eleven green gates" lands on whichever comes first.
- **FYI-3 · two different nines, too.** `src/test-harness.spec.ts:81`'s "the nine integration specs" means
  the nine never-listening HTTP-issuing specs (`issue-193.md:95`), not the nine deleted call sites across
  seven files (`:289`). "The nine never-listening specs" would remove the collision.
- **FYI-4 · `CLAUDE.md`'s Redis-gated line** quotes `33 skipped, 582 passed, 615 total`; `observed` at
  `e6138ae` it is `35 skipped, 689 passed, 724 total`. The PR logs this and correctly declines to act here.
- **FYI-5 · `.claude/skills/piv-validate/SKILL.md:51`** still tells the next session to re-run a hung suite
  with `--forceExit`, the flag this issue rules out — on #193's stall shape it would have produced a silent
  pass. Also logged, also deferred. FYI-4 and FYI-5 both belong in a `system-evolution-review`.

## Checked and clean

Four risks I went looking for and did not find, recorded so the next round does not re-spend the time.

- **No app leaks.** 20 `createTestApp` call sites across 18 spec files, 20 matching closes, each in an
  `afterAll` of the same `describe` as its `beforeAll` — including all three in `redis-io.adapter.spec.ts`
  (`:48,49` → `:56,57` and `:148` → `:159`). `app.close()` does tear the socket down:
  `@nestjs/platform-express/adapters/express-adapter.js:117-123` ends in `httpServer.close(resolve)`. All
  seven socket files also `afterEach(closeClients)` before the app close, so the clients-first ordering
  that keeps `close()` from waiting on a live connection holds everywhere.
- **No double-bootstrap from `init()` then `listen()`.** `nest-application.js:95-98` early-returns when
  `isInitialized`; `:174-178` calls `init()` only `if (!this.isInitialized)`. Lifecycle hooks run once.
  `configure` still runs before `init()` (`harness.ts:538`), so a `useWebSocketAdapter` lands before
  `registerWsModule` and never trips the "adapter will NOT be applied" warning.
- **Nothing depended on the app not listening.** All seven port readers run after `createTestApp` returns;
  `grep -rn '\.listen('` over `services/api/src` and `services/api/test` leaves only `main.ts:21`,
  `harness.ts:540` and F7's script; no `http://localhost` dial survives in the api test path.
- **Placement and length are right, not merely tolerated.** `services/api/package.json:76` sets jest
  `rootDir: "src"`, so a spec in `test/` would never be collected — `src/test-harness.spec.ts` is the only
  place it can live, with `src/db-schema.spec.ts` as precedent. `packages/config/eslint/base.mjs:47-56`
  turns `max-lines` off for `**/*.spec.ts` and `**/test/**`, so `harness.ts` at 635 lines and the 97-line
  spec are both outside the rule, with no `eslint-disable` anywhere in `services/api` bar one justified
  case. `tsconfig.build.json:3` excludes `**/*spec.ts`, so the new spec never reaches `dist`.

## Validation

Run from `/Users/Berzins/taxi-worktrees/wt-193` at `e6138ae`, `COMPOSE_PROJECT_NAME=taxi`.

| Check | Command | Result |
|---|---|---|
| CI-parity gate | `record-gate.sh --clean`, `REDIS_TEST_URL` set | ✅ exit 0 · `22 successful, 22 total` · 1m27.808s |
| api, Redis on | `npx jest` + `REDIS_TEST_URL` | ✅ `77 passed, 77 total` suites · `724 passed, 724 total` |
| api, Redis off | `env -u REDIS_TEST_URL npx jest` | ✅ `2 skipped, 75 passed, 75 of 77` · `35 skipped, 689 passed, 724 total` · 38.892 s |
| the new spec alone | `npx jest src/test-harness.spec.ts` | ✅ `3 passed, 3 total` · 1.047 s |
| GitHub checks | `gh pr view 194` | ✅ check · audit-diff · codeql · ready · CodeQL all SUCCESS |
| `Closes #193` | `closingIssuesReferences` | ✅ resolves to `[193]` |

**Every figure in the PR body that can be re-run reproduced exactly.** The non-Redis counts match to the
digit and the 38.892 s wall time sits inside the quoted 38.482–39.520 s band. My `record-gate.sh` run
landed at 1m27.808s against the author's 1m29.665s — the same band, well away from the 74–78 s the
plain-script batches reported. That is weak support for the PR's own guess that the script's dry run and
per-task log reads explain the gap; weak, because my run also carried the Redis suites, so it does not
isolate the overhead either. The PR flags the discrepancy itself and calls it non-load-bearing, which is
right.

One figure I could not re-verify: the `grep -c` over the ten gate logs returning 0 for the failure
signatures. The logs are not in the tree. The PR is explicit that only the recorded block is head-stamped,
so that is a stated limitation, not a finding.

Also confirmed: `git diff --name-only bd13213..e6138ae` is exactly the 11 files GitHub lists, and
`services/api/package.json` and `turbo.json` are untouched against the base — the PR's "both were already
stock" holds. The three investigation probes are absent from `HEAD:services/api/test`; they do not appear in
the net diff because they were added and deleted on the same branch, so there is nothing to review there.

## What's good

- **The diagnosis is correct and it is the hard kind.** Two prior issues on this flake named the wrong
  cause. This one names a mechanism outside the repository entirely, reproduces it against the live
  squatters, and it survives an active attempt to falsify it from a clean context — all three rows of the
  table hold, and the one result that looked like a contradiction turned out to bound the conditions the
  RCA had already identified.
- **The evidence is stronger than the PR claims, which is the right direction to err.** `git diff 6acff5f
  e6138ae` touches two docs and seven lines of the new spec, so `test/harness.ts` and all seven modified
  spec files in the ten frozen-tree gates are **byte-identical** to the shipped head. "None of them is the
  head this PR ships" is literally true and materially under-sells it. `6acff5f` is a real, resolvable tree
  object carrying `await app.listen(0, '127.0.0.1');` at the same line 540 — provenance a reviewer can
  actually check, which is rare.
- **The withdrawn probability claim.** Pooling instrumented and uninstrumented runs was caught and retired
  by the author, with the reason recorded (the probe's ~1260 `appendFileSync`s sit in the hot path of the
  bind storm under test, 4–32% wall cost). Declining to offer a number is the correct move and the hard
  one. The withdrawn contention-window story at `issue-193.md:219` is the same discipline a second time.
- **The assertion was mutation-tested before anyone asked.** `api-gate-flake-193-report.md:77-81` reverts
  each half and records what goes red. That is the step this repo has been burned by skipping.
- **The counter is an instance listener, not a prototype patch**, with the reason given: `maxWorkers: 1`
  runs jest in-band, so a patched `net.Server.prototype` would survive into every later spec file — which
  is exactly how the investigation's own probe once manufactured a clean, plausible, entirely false result
  (`issue-193.md:353`). The deviation is logged with that reasoning.
- **The vacuity traps are closed from both sides** — `expect(server.listening).toBe(true)` pins "0 binds"
  to a listening server, and case 3 proves the counter fires at all. Both carry a comment naming the trap.
- **`35 ≠ 33` in CLAUDE.md** spotted, labelled a quotation rather than a measurement, and scoped out.
  Confirmed: 35 is right at this head.
- **The deletions are consistent and complete**, and all seven files' `address()!.port` reads still work
  precisely because `createTestApp` listens before returning.

## Recommendation

**Request changes**, on a short list:

- **F1** — move `harness.ts:540` below the self-checks, then re-run the gate (it is a code change).
- **F2** — retire the false double-init comment at `payments.integration.spec.ts:66-68`.
- **F3–F6, F9** — one clause or one line each. For F6, grep the noun: `grep -rn "17 binds\|Seventeen\|630"`.
- **F7, F8** — your call on scope. F7 is one word, and it is the same noun this PR is retiring.

Nothing here touches the diagnosis or the shape of the fix, both of which are sound. One follow-up worth
considering separately, not in this PR: `TestApp` could carry `port: number`, which would delete the
`(ctx.app.getHttpServer() as { address(): AddressInfo | null }).address()!.port` incantation from seven
files, and the double cast at `driver-presence.integration.spec.ts:49` with it.

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01N5PsMTVxFiNEkDxeJxcxzC
