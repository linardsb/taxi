# PR #194 — review fix pass (round 1)

**Review** `.claude/code-reviews/pr-194-review.md` (ships on PR #195, branch `docs/pr-194-review`)
**Reviewed head** `e6138ae` · **Fix head** `80bafe6` · **Base** `main` @ `bd13213`
**Worktree** `/Users/Berzins/taxi-worktrees/wt-193` · **Ran** 2026-09-12

## Verdict

All nine findings fixed, including both **HUMAN DECIDES** items (F7, F8). Two FYIs deferred to a
`system-evolution-review`; one (FYI-3) closed incidentally by F9. Nothing was dropped as noise.

Two things the review did not have, both from grepping the **value** rather than the noun:

- **F3 had a second copy** — the same false "bind count `3`" claim sat in
  `.claude/reports/api-gate-flake-193-report.md:80`, which ships inside the PR. The review named only
  the PR body.
- **F6 had four more stale sites** than the review's `:257`/`:269`/`:305` — `:159`, `:245`, `:263`
  and `:307` all carried the pre-spec figure too.

## Gate

`observed` — `record-gate.sh --clean` at `80bafe6`, `COMPOSE_PROJECT_NAME=taxi`,
`REDIS_TEST_URL=redis://localhost:6381`, exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m30.276s
```

    @taxi/dispatch  Test Files 27 passed (27)
    @taxi/dispatch  Tests 224 passed (224)
    @taxi/driver  Test Suites: 41 passed, 41 total
    @taxi/driver  Tests: 218 passed, 218 total
    @taxi/rider  Test Suites: 29 passed, 29 total
    @taxi/rider  Tests: 140 passed, 140 total
    @taxi/db  Test Files 3 passed (3)
    @taxi/db  Tests 17 passed (17)
    @taxi/shared  Test Files 24 passed (24)
    @taxi/shared  Tests 231 passed (231)
    @taxi/api  Test Suites: 77 passed, 77 total
    @taxi/api  Tests: 724 passed, 724 total

Test counts are identical to the pre-review head, which is the point: F1 changes *when* the harness
binds, not what any test asserts.

**One commit lands after this gate** — the docs-only commit carrying this report and the head-stamp
note in `api-gate-flake-193-report.md`. No source file moves in it.

## Fixed

### F1 — Medium · `listen()` ran before the self-checks

`services/api/test/harness.ts` — `await app.listen(0, '127.0.0.1')` moved from between `init()` and the
self-checks to just before the `return`, with a comment naming why so it is not moved back.

**Verified in both directions**, queue self-check forced to throw (`if (true && resolvedQueue === queue)`),
`npx jest src/test-harness.spec.ts`:

| Tree | Result |
|---|---|
| unfixed (`listen` above the checks) | run finished `1.453 s`, **`Jest did not exit one second after the test run has completed.`** — process killed at 90 s, `exit=124` |
| fixed (`listen` below) | `exit=1` in `1.514 s`, `Tests: 3 failed, 3 total`, **zero** "did not exit" lines (`grep -c` → 0) |

The `TypeError: Cannot read properties of undefined (reading 'app')` appears on both rows and is
correct to: it is `afterAll` firing with `ctx` unassigned, which is the pre-PR shape.

**What this fix does not do.** It removes the hang, not the leak. A throwing self-check still leaves an
`init()`ed app with a live Drizzle pool and `ctx` unassigned; the listening socket was only what turned
that leak into a hang. `redis-io.adapter.spec.ts:48-49`'s multi-app case is unchanged in the same way —
nodeB still leaks, now without a socket. The review's `try/catch` alternative would fix both, and is the
better shape if `createTestApp` later grows work that needs the port; it was **not** taken here because
the prescribed move is the version that has been run green across 77 suites, and this repo has been
burned by a prescribed fix that killed a working path (#154 F17).

**The new failure mode this mechanism introduces**, in one line: anything later inserted between
`init()` and the new listen position that reads `server.address()` now silently gets `null`. That is
already covered — `src/test-harness.spec.ts:55`'s `expect(server.listening).toBe(true)` fails on exactly
that tree, `observed` below under F3. No new test needed.

### F2 — Medium · a comment blamed a refuted cause

`services/api/src/features/payments/payments.integration.spec.ts:66-70` — the double-`init()` explanation
replaced with a pointer to the real invariant and the reason the old one was impossible.

`observed`, the claim is now mine rather than inherited —
`grep -n -A4 "async init()" node_modules/@nestjs/core/nest-application.js`:

```
95:    async init() {
96-        if (this.isInitialized) {
97-            return this;
98-        }
```

Closing command: `grep -rn "double-init\|re-runs.*bootstrap" docs/ .claude/ services/api` → **no hits**
(run 2026-09-12 against the fixed tree).

### F3 — Low · "the bind counter reads 3" describes a run the shipped spec cannot produce

Fixed in **two** places: the PR body, and `.claude/reports/api-gate-flake-193-report.md:80`, which the
review did not have.

`observed` 2026-09-12, shipped spec, `npx jest src/test-harness.spec.ts`:

| Harness line | Result |
|---|---|
| no `listen` at all | `Tests: 2 failed, 1 passed, 3 total` — case 1 fails at `expect(server.listening).toBe(true)` (`:55`), **`Received: false`**; case 2 at `:71`, `Received has value: null`. `countBinds()` never evaluated. |
| `await app.listen(0)` — host dropped | `Tests: 1 failed, 2 passed, 3 total` — `"address": "::"` against expected `"127.0.0.1"` at `:71` |

The second row confirms the other half of the PR body's sentence, which was correct as written.

### F4 — Low · the shipped report named the old branch

`.claude/reports/api-gate-flake-193-report.md:6` now reads
`` `fix/api-test-harness-listen-193` (opened as `investigate/api-gate-flake-193`) ``. The sweep found a
second copy the review did not name — `docs/issues/issue-193.md:48` — given the same rename clause. The
third hit (`api-gate-flake-193-report.md:241`) already documents the rename and is correct as is.

### F5 — Low · the control case re-takes two wildcard binds per run

`services/api/src/test-harness.spec.ts:79-88` — comment only, no code change, as the review prescribed.
Names the 2 deliberate wildcard binds, why the case has to keep them, and what to conclude if it ever
reddens with `Parse Error: Expected HTTP/`.

### F6 — Low · the post-fix bind figure described a pre-spec tree

**Measured, not derived.** A probe appending one line per `net.Server.prototype.listen` call, wired into
jest `setupFiles`, then removed:

| Run | Ephemeral binds | Composition | Suite |
|---|---|---|---|
| `env -u REDIS_TEST_URL npx jest` | **20** | 18 loopback app binds + 2 wildcard control binds | `35 skipped, 689 passed, 724 total`, exit 0 |
| `REDIS_TEST_URL=redis://localhost:6381 npx jest` | **22** | 20 loopback app binds + the same 2 | `77 suites, 724 passed, 724 total`, exit 0 |

Host attribution came from the probe directly: the 2 non-app binds are the only ones recorded with no
host argument, which is supertest's `serverAddress()` re-binding the control's bare server.

`derived` and consistent: 20 `createTestApp` call sites across 18 spec files (`observed`, grep over
`services/api/src`; a 21st hit discounted as a comment), of which exactly 2 — `redis-io.adapter.spec.ts:48`
and `:49` — sit inside `describeWithRedis`. The third call site in that file, `:148`, is in a plain
`describe` at `:115` and always runs, which the review's arithmetic did not spell out. Reconciles with
`b02`'s 17 (+1 for the new spec's app = 18) and `g02`'s 19 (17 + 2 gated; +1 = 20).

**The probe's own defect is worth recording**, because it reproduced #193's instrument trap by a
different route. The first version held state on `globalThis`. Jest soft-deletes globals between test
files, so the already-patched guard read `undefined` and re-wrapped `listen` once per spec file — 77
layers — giving `RangeError: Maximum call stack size exceeded` and **17 failed suites / 185 failed
tests**, which looks exactly like a code regression. Moving the marker to a `Symbol.for` on `net.Server`
(a core module object, not reset) fixed it. `issue-193.md:380` records the same stacked-wrapper failure
arrived at through per-file `process.env` copies.

Applied to `docs/issues/issue-193.md`: `:159`, `:245`, `:296`, `:332` retired to "one per app built" or
the shipped figure; a new **Bind count as shipped** subsection carries the table above; `:257` and `:290`
keep their `17` **because they are `observed` records of named runs** (`b02`, `f01`–`f06`) and rewriting
a run record would be falsifying it — `:257` gains a pointer to the new subsection instead.

### F7 — Low · the same wildcard bind in a dev script *(HUMAN DECIDES — taken)*

`services/api/scripts/mint-tracked-ride.ts:432` — `await app.listen(0)` → `await app.listen(0, '127.0.0.1')`,
plus a comment naming why the host is there. Taken because CLAUDE.md's "grep the noun, not the sentence"
makes this the exact noun the PR retires.

**Coverage is compile-only**: the script is a hand-run instrument outside the gate, so `typecheck`, `lint`
and `build` cover it and nothing executed it. Stated rather than implied.

### F8 — Low · same class, in the unrun Nest scaffold *(HUMAN DECIDES — host fixed, file kept)*

`services/api/test/app.e2e-spec.ts` — `await app.listen(0, '127.0.0.1')` added after `init()`, with a
comment. **Not deleted**: deletion is the irreversible half of that finding, and the file turns out to
work.

`observed`, `npx jest --config ./test/jest-e2e.json`: `Test Suites: 1 passed, 1 total`,
`Tests: 1 passed, 1 total`, exit 0 — so `/` does still return `Hello World!` and this is live scaffold,
not dead. It is not collected by the gate (`services/api/package.json` sets jest `rootDir: "src"`); it
runs only under the `test:e2e` script, which exists.

**One pre-existing defect found and left alone**: that run ends with `Jest did not exit one second after
the test run has completed.` `observed` by stashing this change and re-running with zero `app.listen`
calls in the file — the line is there too. It is a Drizzle pool, not the socket, and it predates this PR.
Out of scope; worth an issue.

### F9 — Low · two house-style slips

`services/api/src/test-harness.spec.ts:1-2` — `'net'`/`'http'` → `'node:net'`/`'node:http'`.
`:50`, `:67`, `:78` — case names gained the `(expected)`/`(edge)`/`(failure)` suffixes the siblings use.

**Also closes FYI-3**: `:81`'s "the nine integration specs" now reads "the nine never-listening
integration specs", removing the collision with the nine deleted call sites at `issue-193.md:289`.

## Deferred

| Item | Where | Why |
|---|---|---|
| **FYI-4** — `CLAUDE.md`'s Redis-gated line quotes `33 skipped, 582 passed, 615 total`; at this head it is `35 skipped, 689 passed, 724 total` | `CLAUDE.md` | Editing the repo's own rules file from inside a fix PR is the wrong seam, and CLAUDE.md's own note on that line says to re-observe the **whole claim**, not swap the digit. `system-evolution-review`. |
| **FYI-5** — `.claude/skills/piv-validate/SKILL.md:51` still prescribes `--forceExit` for a hung suite | skill | The flag this issue rules out; on #193's stall shape it produces a silent pass. A skill edit, which is the remedy kind that actually fires later. `system-evolution-review`. |
| `TestApp` could carry `port: number` | seven spec files | The review's own "not in this PR". A clean follow-up; deletes the `address()!.port` incantation and the double cast at `driver-presence.integration.spec.ts:49`. |
| `app.e2e-spec.ts` never exits | `services/api/test/` | Pre-existing, `observed` above. Not this PR's diff. |

## The retired-value sweep

`grep -n` per retired value and noun, run 2026-09-12 against the **fixed** tree
(`docs/ .claude/ services/api`, `*.md` + `*.ts`, this report itself excluded — it quotes every
retired value) and against the **live PR body**
(`gh pr view 194 --json body`), which no working-tree grep reaches.

| Pattern | Working tree | PR body | Verdict |
|---|---|---|---|
| `Seventeen` | 0 hits | 0 hits | retired |
| `17 binds` | `issue-193.md:290` | 0 hits | **kept** — `f01`–`f06` run record |
| `binds → 17` | `issue-193.md:257` | 0 hits | **kept** — `b02` run record, now pointing at the shipped figure |
| `binds to 17` | 0 hits | 0 hits | retired |
| `instead of 17` | 0 hits | 0 hits | retired |
| `bind counter reads` | 0 hits | `:38` | **fixed in the body** (see PR-body edit below) |
| `double-init` / `re-runs.*bootstrap` | 0 hits | 0 hits | retired (F2) |
| `nine integration specs` | 0 hits | 0 hits | retired (F9 / FYI-3) |
| `investigate/api-gate-flake-193` | `issue-193.md:48`, `report:6`, `report:241` | `:57` | **all three carry the rename clause**; the body's names it explicitly |
| `630` | 17 hits | `:9` | **all correct** — either the pre-fix figure (unchanged) or the "one per app built" phrasing, which stays true as spec files are added. The two in-code copies (`harness.ts:482`, `test-harness.spec.ts:10`) are the per-app-built form and need no edit. |
| `listen(0)` | 26 hits | `:9`, `:38`, `:53` | **`services/api` is clean** — the only three `.listen(` calls left are `harness.ts:564` and `mint-tracked-ride.ts:432` (both loopback) and `main.ts:21` (production, wildcard on purpose). Remaining hits are RCA prose describing the pre-fix state, and seven `.claude/plans/*.md` lines from earlier tickets that record what those tickets did at the time — run records, left alone. |

`observed` — the full `.listen(` sweep, `grep -rn "\.listen(" services/api --include="*.ts"` minus
`node_modules`, at the fixed tree:

```
services/api/test/harness.ts:564:  await app.listen(0, '127.0.0.1');
services/api/scripts/mint-tracked-ride.ts:432:    await app.listen(0, '127.0.0.1');
services/api/src/main.ts:21:  await app.listen(env.API_PORT);
```

## Needs a human look

- **F1's shape is a choice, not a forced move.** The `try/catch` + `await app.close()` alternative fixes
  the pool leak as well as the hang. It was not taken because it has never been run; the move has.
  If `createTestApp` ever grows work between the self-checks and the return that needs a port, that is
  the version to switch to.
- **`app.e2e-spec.ts`'s non-exit** — pre-existing, but the file is live, so it is a real (small) hole.
- **FYI-4 and FYI-5** — both are `system-evolution-review` input, not fixes. Worth running that loop.
