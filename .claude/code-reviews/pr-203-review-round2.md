# PR #203 review — fix(api): createTestApp closes the app when a self-check throws (#199) — round 2

**Head** `875abb0` · **Base** `main` @ `fe1acfe` · round 2 · reviewer: code-reviewer agent (fresh context) + this session's numbers, probe and fix-verification passes · 2026-09-14

## Summary

Round 1 approved with five Lows; the fix commit `875abb0` closed L1, L3, N1 and N2 and deferred L2 to #205. This round re-derived each closed finding from the tree rather than the fix report, re-ran probes B, C and D on the committed head (the masking branch, probe D, had only the author's run until now), and ran the gate on the clean checkout. Base unmoved (`origin/main` = `baseRefOid` = `fe1acfe`), so the guarantees pass does not fire. No plan file exists for #199, so the constraint pass is skipped. Two Lows in the code, two Lows in prose. **Recommendation: approve.**

Counts: Critical 0 · High 0 · Medium 0 · Low 4.

## Round-1 closures, re-derived

| Finding | Fix-report claim | Re-derived here |
|---|---|---|
| L1 comment precondition | four lines added at `harness.ts:548-551` | present (`git show 875abb0`); wording imprecise, see L1 below |
| L2 `init()` outside the `try` | deferred to #205 | #205 OPEN, carries L2 and the `dispose()` follow-up with a done-when |
| L3 fixture counts | 8 at `2099` before, 11 after; `session.test.ts:18` safe via `NOW` | `grep -rn "expiresAt: '20" apps`: 14 hits, 11 at `2099`; all four `loadSession` calls in `session.test.ts` pass `NOW` |
| N1 CI timestamps | started 11:57:43Z, finished 12:01:15Z | `gh run list --branch main`: run 34840844783, `createdAt` 11:57:43Z, `updatedAt` 12:01:15Z, `fe1acfe`, success |
| N2 line count | 22 inside the `try`, 14 shifted, 8 rewrapped comments, blank is context | tally script on the new file: 23 lines between `try {` and `} catch`, 14 two-space shifts of an old line, 1 blank, 8 other, all 8 comments; 53 added lines at HEAD |

No Critical or High was closed, so the fix-mechanism pass has nothing to re-open; the one shipped-source change in `875abb0` is four comment lines.

## Findings

**L1 · Low · comment names one gateway where either would do** — `services/api/test/harness.ts:548`
"That quit depends on `RealtimeGateway` registering its io server during `init()`." `SocketServerProvider.scanForSocketServer` keys the container on `{port, path}` (`node_modules/@nestjs/websockets/socket-server-provider.js:12-15`), and both `RealtimeGateway` (`realtime.gateway.ts:51`) and `DriverLocationGateway` (`driver-location.gateway.ts:38`) are bare `@WebSocketGateway()`, so they resolve to one server entry and `SocketModule.close()` calls `adapter.close(server)` once. Removing `RealtimeGateway` alone would still quit the clients. The next clause, "a graph with no gateway would leave both clients open", is the accurate one. Fix: "depends on an options-less `@WebSocketGateway()` (either of the two; they share one `{port, path}` server) registering during `init()`".

**L2 · Low · optional, outside the diff** — `apps/dispatch/src/features/auth/session.test.ts:18`
The last wall-clock-dated `AuthSession` default in `apps/` is still `2026-09-14T12:00:00.000Z`. Safe today because every `loadSession` call there passes `NOW` (round 1 L3 says so, and it holds), but one un-parameterised call away from the bomb this PR defused; the expired case at `:42` supplies its own value, so moving the default to `2099-01-01T00:00:00.000Z` changes no test's meaning. Take or leave; not required for merge.

**N1 · Low · a command citation that no longer reproduces its figure** — PR body, What changed, `cedc2a0` bullet
"49 insertions, 26 deletions, `git diff --numstat origin/main..HEAD`". At the current HEAD that command prints `53 26` (the round-1 commit added four lines). `git diff --numstat origin/main..cedc2a0 -- services/api/test/harness.ts` prints `49 26`, so the figure is right for the commit it sits under; the citation should name `cedc2a0`, not `HEAD`.

**N2 · Low · gate provenance** — PR body, `875abb0` bullet
"Gate on this head: `observed` `record-gate.sh --clean`, 12:58:09Z–12:59:36Z". The gate record that run left (`.claude/last-gate.json`, read at the start of this review) stamps `head cedc2a0`, `dirty: true`: it ran on the working tree that became `875abb0`, before the commit. CI at `875abb0` (run 34846713997, `check` green) and this review's gate on the clean commit (below) cover it. Wording: "on the tree committed as `875abb0`".

## Numbers pass

| Claim | Source | Result |
|---|---|---|
| harness `53 26` at HEAD; `49 26` at `cedc2a0` | `git diff --numstat` | `observed`, both |
| 22 = 14 + 8 inside the `try`, blank is context | tally script | `observed`, matches |
| CI run for `fe1acfe` 11:57:43Z → 12:01:15Z | `gh run list` | `observed`, matches |
| "any PR opened after that is red at `require-role.test.tsx`" | PR #204 (docs branch off `fe1acfe`), run 34845293424 | `observed`: `check` failed at 12:49:28Z on exactly "renders children for an allowed role", dispatch `1 failed, 26 passed (27)` |
| `session.ts:75` drops at or past expiry | `sed -n 75p` | `Date.parse(expiresAt) <= nowMs`, matches |
| 11 of 14 `expiresAt: '20` hits at `2099` | grep | `observed` |
| `Closes #199` the only closing reference | `closingIssuesReferences` | `[199]` |
| `#196` round-2 stamp at `bd733b0` = api `77 / 724` | `.claude/reports/pr-196-review-fixes-round2.md:56,216` | matches |
| `console.error` the only console call under `services/api/test/`; no `no-console` rule | grep | `observed`: one hit, `harness.ts:586`; no rule in `packages/config/eslint/` |
| Probe A (unfixed hang, 75 s) | round 1 re-ran it | inherited from round 1, `observed` there |
| Probes B, C, D | re-run here, see below | `observed` |
| "the `console.error` line appears once" (probe D) | `probeD.log` | `observed`: emitted once; the tag string occurs twice in the log because jest echoes the source line in its code frame |

## Probes, repeated on `875abb0`

Mutation as `issue-199-fix.md` records it (script rebuilt from that description, in this session's scratchpad), from `services/api`, `COMPOSE_PROJECT_NAME=taxi`, `timeout 75 npx jest <spec>`; the file restored from a saved copy and `cmp`-identical after each; `git status` clean at the end.

| Probe | Mutation | Spec | Result |
|---|---|---|---|
| B | n = 2 | `redis-io.adapter.spec.ts`, Redis on (6381) | `2 failed, 3 passed, 5 total`, exit 1, 3 s, 0 "did not exit" lines, one `TypeError … reading 'app'` from `afterAll` |
| C | n = 1 | `test-harness.spec.ts`, Redis off | `3 failed, 3 total`, exit 1, 3 s, 0 "did not exit" lines |
| D | n = 1, close-throws | `test-harness.spec.ts`, Redis off | `3 failed, 3 total`, exit 1, 3 s; `console.error` emitted once with `Error: PROBE: close() threw`; all three failures report `DISPATCH_QUEUE_STORE override did not take` |

D is the masking branch: the original self-check error surfaces, the close error is printed beside it. Now `observed` by someone other than the author.

## Validation

`observed` — `record-gate.sh --clean` (`pnpm turbo run typecheck lint test build --force` from cleared `dist`/`.next`), `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://localhost:6381`, at `875abb0`, tree clean (`dirty: false` in the record), 13:10:14Z–13:11:38Z, exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m23.596s
```

    @taxi/api       Test Suites: 77 passed, 77 total · Tests: 724 passed, 724 total
    @taxi/dispatch  Test Files 27 passed (27) · Tests 224 passed (224)
    @taxi/driver    Test Suites: 41 passed · Tests: 218 passed
    @taxi/rider     Test Suites: 29 passed · Tests: 140 passed
    @taxi/db        Tests 17 passed (17)
    @taxi/shared    Tests 231 passed (231)

Not in the graph: `@taxi/config#{build,lint,test,typecheck}`, `@taxi/driver#build`, `@taxi/rider#build`, the same six as the PR's stamp.

CI on `875abb0`: `check` 3m29s, `audit-diff`, `codeql`, CodeQL, `ready` all green; PR out of draft, `mergeStateStatus` CLEAN.

## What's good

- The success path is byte-for-byte the same control flow: the `try` body is two `app.get()` calls and two identity comparisons, and the only other throw possible inside (an unregistered token) is also a wiring defect worth closing on.
- `close()` on an `init()`ed, never-listened app was traced through Nest 11 and socket.io: the http server's not-running close error is delivered to a callback that socket.io ignores, both ioredis clients are quit, and the promise resolves. No throw, no hang, which probes B–D show.
- No `createTestApp` caller other than the Redis-gated adapter spec passes a `configure` that opens anything, so the fix covers every resource `app.close()` is asked to release.
- The reports re-derive their corrected figures and print the closing commands; N2's second correction (22, not 23) came from a tally rather than an edit of the digit.

## Next

- L1 is a one-clause comment edit; N1 and N2 are PR-body wording. None blocks merge. L2 is optional and outside the diff.
- PR #204 (round 1's report) is red on the time bomb this PR removes; it needs main to carry #203 before its `check` can pass.

## Recommendation

**Approve.** No Critical, High or Medium. Ready for Linards to merge.
