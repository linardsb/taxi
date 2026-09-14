# PR #203 review — fix(api): createTestApp closes the app when a self-check throws (#199)

**Head** `cedc2a0` · **Base** `main` @ `fe1acfe` · round 1 · reviewer: code-reviewer agent (fresh context) + this session's numbers and probe passes · 2026-09-14

## Summary

Two commits, five files. `services/api/test/harness.ts` (+49 −26) wraps the two DI self-checks in a `try`; the `catch` awaits `app.close()`, prints a close failure with `console.error`, and rethrows the original self-check error. Three `apps/dispatch` fixtures move `expiresAt` from today at noon UTC to 2099. The mechanism was traced through Nest 11 here (`close()` → `dispose()` → `SocketModule.close()` → `RedisIoAdapter.close(server)` → two `quit()`s) and probes A and B were re-run on this machine: the unfixed tree holds jest to timeout, the fixed tree exits in 3 s. The dispatch time bomb was reproduced at main's version of `require-role.test.tsx`. Five findings, all Low. **Recommendation: approve.** L3 and N1 are the two wording fixes worth a commit; L2 is a scope decision.

Counts: Critical 0 · High 0 · Medium 0 · Low 5.

## Findings

**L1 · Low · comment accuracy** — `services/api/test/harness.ts:544-547`
"whatever `configure` opened before `init()` … which only `RedisIoAdapter.close()` quits" holds only because `RealtimeGateway` registers an io server during `init()`. `SocketModule.close()` (`node_modules/@nestjs/websockets/socket-module.js:49-63`, read here) calls `adapter.close(server)` only for servers in `socketsContainer`, then `adapter.dispose()`; `RedisIoAdapter` has no `dispose()` override. A graph with no gateway would never quit the clients. Fix: one clause naming the dependency. Optional follow-up outside this PR: move the two `quit()`s to a `dispose()` override, which runs regardless of registered servers.

**L2 · Low · remaining gap, scope decision** — `services/api/test/harness.ts:539`
`await app.init()` sits outside the `try`. A rejecting `init()` (an `onModuleInit` failure, DB unreachable) leaves `configure`'s two ioredis clients open with #199's symptom. Moving that line into the `try` is safe: `NestApplication.init()` never sets `initializationPromise`, so `close()`'s `await this.initializationPromise` is `await undefined` (`nest-application-context.js:127`). It helps only once `registerModules()` has run, since `SocketModule.close()` returns early before that. Not in #199's stated scope. Flagged so leaving it is a decision, not an omission.

**L3 · Low · claim accuracy, report only** — `.claude/reports/issue-199-fix.md:29-31`
Two figures in the fixture paragraph do not match the tree. (a) "these 3 were the only `AuthSession` fixtures dated this year": `apps/dispatch/src/features/auth/session.test.ts:18` defaults `expiresAt` to `'2026-09-14T12:00:00.000Z'` too. It is safe, every `loadSession` call there passes `NOW` = 2026-08-15, so no code change. (b) "4 dispatch/driver/rider fixtures at `2099`": `grep -rn "expiresAt: '20" apps` finds 8 (rider 4, driver 3, dispatch `use-assign.test.tsx:21`); the driver `2026-09-04` hits are offer fixtures, not `AuthSession`. The PR body's own sentence ("every driver and rider `AuthSession` fixture already uses `2099`") is correct and does not inherit either figure. Fix: "8 at 2099; `session.test.ts:18` is dated the same day but every read passes its own `NOW`".

**N1 · Low · timestamp mislabelled** — PR body, What changed; `.claude/reports/issue-199-fix.md:26`
"Main's last CI run finished at 11:57:43Z" is the run's `createdAt`; it finished at `12:01:15Z` (`gh run list --branch main`, run for `fe1acfe`). The conclusion stands and is tighter than stated: that run was green, so its dispatch vitest completed inside the 137 s between 11:57:43Z and the noon expiry. Fix: "started at 11:57:43Z and finished 12:01:15Z; its dispatch tests ran before noon".

**N2 · Low · count precision** — PR body, What changed
"23 of the added lines are the two self-checks re-indented inside the `try`": 23 is the number of lines inside the `try`, of which 16 are byte-identical two-space shifts and 7 are comment lines rewrapped to the new width (`derived`, diff `-U0` of the harness hunk). Fix: "23 lines moved inside the `try`, 16 re-indented and 7 comment lines rewrapped".

## Numbers pass

| Claim | Source | Result |
|---|---|---|
| `+49 −26` harness, 5 files | `git diff --numstat origin/main..HEAD` | matches |
| Probe A: unfixed, n = 2, Redis on, hangs | re-run here, `timeout 30` | `observed` exit 124 at 30 s, `2 failed, 3 passed, 5 total`, one "did not exit" line |
| Probe B: fixed, n = 2, Redis on, exits | re-run here, `timeout 75` | `observed` exit 1, 3 s, same 5-test tally, zero "did not exit" lines; harness restored, `cmp` identical, tree clean |
| A vs B isolates the `try/catch` | same spec, same mutation, only the harness differs | attribution holds |
| Time bomb, `require-role.test.tsx` at main's version, deterministic | main's file copied in as a probe spec, vitest run once, removed | `observed` 1 failed ("renders children for an allowed role"), 2 passed |
| Gate `22 / 22`, api `77 / 724`, dispatch `224` | re-run here | `observed` below |
| Gate `1m24.327s` at `cedc2a0` | `.claude/last-gate.json` before this session's run | not re-checkable (overwritten by this run); counts agree with the report's `2m4.008s` run and with CI |
| "finished at 11:57:43Z" | `gh run list` | N1 |
| "23 re-indented" | diff arithmetic | N2 |
| fixture counts in the report | grep | L3 |
| Probes C and D | not re-run | inherited from the report; D is the only run of the masking branch |

Closing-keyword check: `Closes #199` is bare, unbackticked, and the only closing phrase; no other `#N` sits next to a keyword.

## Validation

`observed` — `record-gate.sh --clean` (`pnpm turbo run typecheck lint test build --force` from cleared `dist`/`.next`), `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://localhost:6381`, at `cedc2a0`, 12:40:11Z–12:41:43Z, exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m31.716s
```

    @taxi/api       Test Suites: 77 passed, 77 total · Tests: 724 passed, 724 total
    @taxi/dispatch  Test Files 27 passed (27) · Tests 224 passed (224)
    @taxi/driver    Test Suites: 41 passed · Tests: 218 passed
    @taxi/rider     Test Suites: 29 passed · Tests: 140 passed
    @taxi/db        Tests 17 passed (17)
    @taxi/shared    Tests 231 passed (231)

Not in the graph: `@taxi/config#{build,lint,test,typecheck}`, `@taxi/driver#build`, `@taxi/rider#build` — the same six as the PR's stamp.

CI on `cedc2a0`: `check` 2m48s, `audit-diff`, `codeql`, CodeQL, `ready` all green; PR is out of draft, `mergeStateStatus` CLEAN, base unmoved (`origin/main` = `baseRefOid` = `fe1acfe`), so the guarantees pass does not fire.

## What's good

- The listen stays after the checks, so the failure path never holds a bound socket, and the rewritten comment states that as a reason rather than a hazard.
- The original self-check error is the thrown value; the close error is printed beside it, not wrapped. Right call for a harness, and probe D ran that branch.
- Probes A–D are `observed` on both trees with the mutation recorded, so the review could repeat A and B without asking.
- `console.error` is the only console call under `services/api/test/`; no `no-console` rule in `packages/config/eslint/base.mjs`, and the logging standard governs app events, not test tooling.
- `use-board.test.tsx` runs under `vi.setSystemTime(2026-08-15)`, so its edit is consistency only; the two real-clock specs were the bombs and the report names the one it observed.

## Recommendation

**Approve.** No Critical, High or Medium. L3 and N1 are report and PR-body wording; N2 is optional; L1 is a one-clause comment; L2 is Linards's scope call and fine to leave for a follow-up issue.
