# #199 — a throwing `createTestApp` self-check closes the app instead of holding jest

**Issue** https://github.com/linardsb/taxi/issues/199 (PR #196 round-2 F1, the code half; runs B and C
there are reproduced below before the shape shipped) · **Base** `main` @ `fe1acfe` · **Branch**
`fix/harness-close-199`, main checkout (no other taxi session live: `ListAgents`, `ps` — 0 `turbo`/`jest`/
`vitest` processes before each run) · **Ran** 2026-09-14, 13:12–13:18 local (UTC+1 on this machine)

## What changed

`services/api/test/harness.ts` — both DI self-checks now sit in a `try`; the `catch` runs
`await app.close()` and rethrows the self-check's error. `close()` runs `onModuleDestroy` → `pool.end()`
and `RedisIoAdapter.close()` → `quit()` on the two ioredis clients the Redis-gated adapter spec opens in
`configure`, before `init()` — the pair nothing else ever quit after a throw. The listen stays last; its
comment now says why (nothing before it needs a port, and a throw before it never has a socket to release)
instead of describing a hazard the `catch` also covers.

**The masking decision** (#199's second item): a `close()` that throws inside the `catch` is caught
again, printed with `console.error` (tagged `createTestApp: app.close() after a failed self-check threw`),
and the **original** self-check error is rethrown. The self-check's message is the one that names the
defect ("override did not take"); a close failure on an app whose DI is already wrong is secondary.
Probe D below is the run of that path.

**Also in the PR, its own commit** — `apps/dispatch` session fixtures. The first gate on this change went
red at `require-role.test.tsx` "renders children for an allowed role": the `AuthSession` fixture in three
dispatch specs carried `expiresAt: '2026-09-14T12:00:00.000Z'`, and `session.ts:75` drops a session whose
`expiresAt <= now`. Main's last CI run (`fe1acfe`, run 34840844783) started at 11:57:43Z and finished at 12:01:15Z on
2026-09-14 (`gh run list --branch main`, `createdAt`/`updatedAt`), so its dispatch tests ran before
noon; this gate started at 12:13:59Z. So it is a time bomb, not a flake: `observed` 3 failures in 3 solo runs of that spec,
deterministic. `login-form.test.tsx:13`, `require-role.test.tsx:14`, `use-board.test.tsx:48` now read
`2099-01-01T00:00:00.000Z`, the value every driver and rider auth fixture already uses (`grep -rn
"expiresAt: '20" apps`, `observed` 2026-09-14: 8 `AuthSession` fixtures were already at `2099` — rider 4,
driver 3, dispatch `use-assign.test.tsx:21` — and the two driver `2026-09-04` hits are offer fixtures,
not sessions. `session.test.ts:18` defaults to the same `2026-09-14T12:00` but every `loadSession` call
in that file passes its own `NOW` of 2026-08-15, so it cannot expire on the wall clock and is untouched,
as is its deliberately expired case at `:42`). Unrelated to #199, required for any PR opened after noon UTC
today to pass CI.

## The mutation

`.claude/reports/pr-196-review-fixes-round2.md` recorded its probes on a script-mutated harness; same
here. `mutate.py <n> <no|close-throws>`, applied to `services/api/test/harness.ts`:

- `let probeCalls = 0;` at module scope before `createTestApp`;
- `if (resolvedQueue !== queue) {` → `probeCalls += 1; if (probeCalls === <n> || resolvedQueue !== queue) {`
  — the queue self-check throws on the process's n-th `createTestApp` call (n = 2 is `nodeB` in the
  Redis-gated block; n = 1 is the only app `test-harness.spec.ts` builds);
- with `close-throws`: after `await app.init()`, `app.close` is wrapped to run the real close and then
  throw `PROBE: close() threw` — the app IS closed, so the run can exit and show which error surfaces.

After each probe the file was restored from a saved copy of the fixed version and `cmp` confirmed it
(probe A restored to the fix from the unfixed head; `git diff --stat` after each: harness only).

## Probes

All from `services/api`, `COMPOSE_PROJECT_NAME=taxi`, `timeout 75 npx jest <spec>`; "Redis on" adds
`REDIS_TEST_URL=redis://localhost:6381` (`taxi-redis-1` Up, healthy, 6381). Wall = `date` before and after.

| Probe | Tree | Mutation | Spec | Result |
|---|---|---|---|---|
| A | `fe1acfe` head, unfixed | n = 2 | `redis-io.adapter.spec.ts`, Redis on | ❌ `2 failed, 3 passed, 5 total`, `Jest did not exit one second after the test run has completed.`, held to `timeout`: **exit 124, 75 s** (13:12:09–13:13:24). Two `DISPATCH_QUEUE_STORE override did not take`, one `TypeError: Cannot read properties of undefined (reading 'app')` from `afterAll`. The issue's row 1, to the digit. |
| B | fixed | n = 2 | same, Redis on | ✅ `2 failed, 3 passed, 5 total`, **exit 1, 4 s**, 0 "did not exit" lines. Same two throws, same `TypeError` (`nodeB` stays unassigned; the harness closed it). |
| C | fixed | n = 1 | `test-harness.spec.ts`, Redis off | ✅ `3 failed, 3 total`, **exit 1, 3 s**, 0 "did not exit" lines. |
| D | fixed | n = 1, close-throws | `test-harness.spec.ts`, Redis off | ✅ `3 failed, 3 total`, **exit 1, 3 s**. `console.error` line present once with `Error: PROBE: close() threw`; the three failures still report `DISPATCH_QUEUE_STORE override did not take` — the original is what surfaces, the close error is printed beside it. |

Logs: `probeA.log`–`probeD.log` in this session's scratchpad (not committed).

## Gate

`observed` — `record-gate.sh --clean` (`pnpm turbo run typecheck lint test build --force` from cleared
`dist`/`.next`), `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://localhost:6381`, on the fixed
harness + the three fixture edits, 13:16:16–13:18:22 local, exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     2m4.008s
```

    @taxi/api       Test Suites: 77 passed, 77 total · Tests: 724 passed, 724 total
    @taxi/dispatch  Test Files 27 passed (27)
    @taxi/driver    Test Suites: 41 passed, 41 total · Tests: 218 passed, 218 total
    @taxi/rider     Test Suites: 29 passed, 29 total · Tests: 140 passed, 140 total
    @taxi/db        Test Files 3 passed (3)
    @taxi/shared    Test Files 24 passed (24)

Not in the graph: `@taxi/config#{build,lint,test,typecheck}`, `@taxi/driver#build`, `@taxi/rider#build`
— the same six as the #196 stamps. Counts equal the #196 round-2 stamp at `bd733b0` (77 / 724), so the
Redis-gated block ran and the harness change added no test. The two earlier gates on this branch
(13:13:58, 25 s; 13:14:48, 38 s) were red on the dispatch time bomb only, before the fixture edit.

## Not done

- No shippable test proves the `close()` path: it needs a self-check forced to throw, which is what the
  mutation is for. Probes A–D are the evidence, as #199 asked.
- `CLAUDE.md`'s Redis-gated line (`33 / 582 / 615`) is still stale against `35 / 689 / 724` — left for
  `system-evolution-review`, as the #194/#196 fix reports did.
