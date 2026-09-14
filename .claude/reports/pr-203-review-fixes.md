# PR #203 review fixes — round 1

**Review** — https://github.com/linardsb/taxi/pull/203#issuecomment-5664168305 (round 1, `.claude/code-reviews/pr-203-review.md` on `docs/pr-203-review`) · **Head reviewed** `cedc2a0` · PR state at start: OPEN, `main` = `origin/main` = `fe1acfe`, tree clean, no interrupted operation · 2026-09-14

## Triage

| # | Sev | Call | Where it landed |
|---|---|---|---|
| L1 | Low | **fixed** — one clause in the comment | `services/api/test/harness.ts` |
| L2 | Low | **deferred** — scope; #199 is the self-checks, `init()` is a different door | issue #205 (with L1's optional `dispose()` follow-up) |
| L3 | Low | **fixed** — two figures in the report | `.claude/reports/issue-199-fix.md:29-33` |
| N1 | Low | **fixed** — timestamp | report `:26`, PR body |
| N2 | Low | **fixed, with a different figure than the review's** | PR body |

No Critical or High, so the "what new failure mode does the mechanism have" line does not apply: L1 changes a comment, the rest are prose. No test is added; the one shipped-source hunk is four comment lines, and the gate below is the check that the file still compiles and lints.

## Fixes

### L1 — the comment credited `RedisIoAdapter.close()` without its precondition

**Wrong:** the `catch` comment said the two ioredis clients are quit by `RedisIoAdapter.close()`, which holds only because `RealtimeGateway` registers an io server during `init()`. `SocketModule.close()` calls `adapter.close(server)` once per server in `socketsContainer`, then `adapter.dispose()`; `RedisIoAdapter` does not override `dispose()` and the base is `async dispose() { }`.

**Fix:** four lines added after the `#199` sentence naming the dependency and what a gateway-less graph would do.

**Closing command**, `observed` 2026-09-14 after the edit:

```
$ sed -n 49,63p node_modules/@nestjs/websockets/socket-module.js
    async close() {
        if (!this.applicationConfig) { return; }
        const adapter = this.applicationConfig.getIoAdapter();
        if (!adapter) { return; }
        const servers = this.socketsContainer.getAll();
        await Promise.all(iterate(servers.values()).filter(({ server }) => server).map(async ({ server }) => adapter.close(server)));
        await adapter?.dispose();
        this.socketsContainer.clear();
    }
$ grep -n "dispose" node_modules/@nestjs/websockets/adapters/ws-adapter.js
32:    async dispose() { }
$ grep -n "dispose" services/api/src/features/realtime/redis-io.adapter.ts
(no output — no override)
$ grep -n "RealtimeGateway registering" services/api/test/harness.ts
547:  // That quit depends on `RealtimeGateway` registering its io server during
```

### L2 — `await app.init()` outside the `try` — deferred to #205

Real, and the review's safety argument (`initializationPromise` is never set by `NestApplication.init()`, so `close()` awaits `undefined`) was not re-read here because nothing in this PR acts on it. #205 carries the finding, the safety argument as the review stated it, and L1's optional `dispose()` move, with a done-when that names the probe. Not fixed here because #199's scope is the self-checks and a `close()` on a half-initialised graph is a different failure surface than the one probes A–D covered.

### L3 — two fixture figures in `issue-199-fix.md` did not match the tree

**Wrong:** (a) "these 3 were the only `AuthSession` fixtures dated this year" — `session.test.ts:18` defaults `expiresAt` to `2026-09-14T12:00:00.000Z` too; (b) "4 dispatch/driver/rider fixtures at `2099`" — there were 8.

**Fix:** the parenthesis now reads 8 at `2099` (rider 4, driver 3, dispatch `use-assign.test.tsx:21`), names the two driver `2026-09-04` hits as offer fixtures, and states why `session.test.ts:18` is safe: every `loadSession` call there passes its own `NOW`.

**Closing commands**, `observed` 2026-09-14 on the fixed tree (the 3 this PR moved are now among the `2099` hits, so the fixed tree shows 11, the pre-PR tree 8):

```
$ grep -rn "expiresAt: '20" apps --include='*.ts' --include='*.tsx' | grep -v node_modules
apps/rider/src/features/auth/use-session.test.tsx:15:  expiresAt: '2099-01-01T00:00:00.000Z',
apps/rider/src/features/auth/gate-screen.test.tsx:22:  expiresAt: '2099-01-01T00:00:00.000Z',
apps/rider/src/features/auth/verify-screen.test.tsx:30:  expiresAt: '2099-01-01T00:00:00.000Z',
apps/rider/src/features/ride-status/use-ride-status.test.tsx:10:  expiresAt: '2099-01-01T00:00:00.000Z',
apps/driver/src/features/offers/offer-card-props.test.ts:48:    expiresAt: '2026-09-04T10:00:20.000Z',
apps/driver/src/features/auth/use-session.sign-out.test.tsx:89:  expiresAt: '2099-01-01T00:00:00.000Z',
apps/driver/src/features/auth/use-session.test.tsx:15:  expiresAt: '2099-01-01T00:00:00.000Z',
apps/driver/src/features/auth/verify-screen.test.tsx:29:  expiresAt: '2099-01-01T00:00:00.000Z',
apps/driver/src/features/push/route-notification.test.ts:16:  expiresAt: '2026-09-04T10:00:20.000Z',
apps/dispatch/src/features/override/use-assign.test.tsx:21:  expiresAt: '2099-01-01T00:00:00.000Z',
apps/dispatch/src/features/board/use-board.test.tsx:48:  expiresAt: '2099-01-01T00:00:00.000Z',
apps/dispatch/src/features/auth/login-form.test.tsx:13:  expiresAt: '2099-01-01T00:00:00.000Z',
apps/dispatch/src/features/auth/require-role.test.tsx:14:  expiresAt: '2099-01-01T00:00:00.000Z',
apps/dispatch/src/features/auth/session.test.ts:42:    saveSession(session({ expiresAt: '2026-08-15T11:59:00.000Z' }));
$ grep -n "NOW\|expiresAt ??\|loadSession(" apps/dispatch/src/features/auth/session.test.ts
12:const NOW = Date.parse('2026-08-15T12:00:00.000Z');
18:  expiresAt: over.expiresAt ?? '2026-09-14T12:00:00.000Z',
36:    const loaded = loadSession(NOW);
44:    expect(loadSession(NOW)).toBeNull();
51:    expect(loadSession(NOW)).toBeNull();
58:    expect(loadSession(NOW)).toBeNull();
```

Four `loadSession` calls, four pass `NOW`. `session.test.ts:18` is untouched.

### N1 — "finished at 11:57:43Z" was the run's start

**Wrong:** the report and the PR body called 11:57:43Z the finish; it is `createdAt`. The run finished at 12:01:15Z. The conclusion is unchanged and tighter: the run was green, so its dispatch vitest completed inside the 137 s before the noon expiry.

**Fix:** report `:26` and the PR body now give both timestamps, the run id, and the field each came from.

**Closing command**, `observed` 2026-09-14:

```
$ gh run list --branch main --limit 1 --json createdAt,updatedAt,headSha,conclusion,databaseId
[{"conclusion":"success","createdAt":"2026-09-14T11:57:43Z","databaseId":34840844783,"headSha":"fe1acfe277e08e420c13a552831adae767d350c6","updatedAt":"2026-09-14T12:01:15Z"}]
```

`updatedAt` is the last write to the run record; for a completed run that is its completion.

### N2 — "23 of the added lines are the two self-checks re-indented" — neither the PR's 23 nor the review's 16 + 7 reproduced

**Wrong:** the PR body said 23 added lines were the re-indented self-checks. The review said 23 lines sit inside the `try`, 16 byte-identical shifts and 7 rewrapped comment lines. Re-derived here from `git diff -U0 origin/main..HEAD -- services/api/test/harness.ts` (`observed`, hunk headers `-541,11 +541,22`, `-553,9 +564,21`, `-564,6 +587,6`):

| Hunk | Added | Of which inside the `try` | Shifted 2 spaces, otherwise identical | Comment lines rewrapped |
|---|---|---|---|---|
| 1 (`+541,22`) | 22 = 10 new comment + `try {` + 11 | 11 | 8 (2 comment + 6 code) | 3 |
| 2 (`+564,21`) | 21 = 11 + 10 (`} catch` … `throw err`) | 11 | 6 (code) | 5 |
| 3 (`+587,6`) | 6 (listen comment) | 0 | — | — |
| total | **49** | **22** | **14** | **8** |

The blank line between the two checks is byte-identical in both trees, so `-U0` treats it as context; it is the 23rd line inside the `try` but not an added line. 14 + 8 = 22. The review's 16 + 7 = 23 counted the blank and misassigned two rewrapped lines as shifts. Tally script: the 23 lines between `try {` and `} catch (err)` in the new file, each tested for "starts with two spaces and the remainder is a line of the old file" — 14 yes, 1 blank, 8 no (the 8 are all comment lines: 3 from the queue block, 5 from the payments block).

**Fix:** the PR body now says 22 lines moved inside the `try`, 14 re-indented, 8 rewrapped, blank line is context.

## Chasing the copies

Per retired value, `grep -rn` on the working tree after the edits, `observed` 2026-09-14. The PR body is not in the tree; its hits are listed from `gh pr view 203 --json body` before the edit and are the ones the body edit below removes.

| Value / noun | Command | Hits after fix |
|---|---|---|
| `11:57:43` | `grep -rn "11:57:43" .claude/reports/issue-199-fix.md .claude/code-reviews/ services/api/test/harness.ts` | report `:26` only, now paired with `finished at 12:01:15Z` |
| `finished at` | same files | report `:26` only, correct |
| `23 of the added` | same files | none |
| `4 dispatch/driver/rider` | same files | none |
| `dated this year` | same files | none |
| PR body | `gh pr view 203 --json body \| grep -n '11:57:43\|23 of the added'` | body lines 7 and 10 before the edit; edited with `gh pr edit --body-file` after the push (see below) |

The round-1 review file (`.claude/code-reviews/pr-203-review.md`, on `docs/pr-203-review`) quotes the old figures as findings; it is the record of what was reviewed and is not edited.

## Validation

`observed` — `record-gate.sh --clean` (`pnpm turbo run typecheck lint test build --force` from cleared `dist`/`.next`), `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://localhost:6381`, on the fixed tree, 12:58:09Z–12:59:36Z, exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m24.688s
```

    @taxi/api       Test Suites: 77 passed, 77 total · Tests: 724 passed, 724 total
    @taxi/dispatch  Test Files 27 passed (27) · Tests 224 passed (224)
    @taxi/driver    Test Suites: 41 passed · Tests: 218 passed
    @taxi/rider     Test Suites: 29 passed · Tests: 140 passed
    @taxi/db        Tests 17 passed (17)
    @taxi/shared    Tests 231 passed (231)

Same counts as the review's run and the PR stamp; the harness change is comment-only, and `redis-io.adapter.spec.ts` ran under `REDIS_TEST_URL` (api `77 / 724`, the Redis-on figure).

## Deferred

- #205 — L2 (`init()` outside the `try`) and L1's optional `dispose()` override.

## Manual look

None. Nothing user-facing; no fix needs a hand test.

## Pushed

One commit on `fix/harness-close-199`, `fix(api): PR #203 round 1 — name the gateway the harness close depends on (#199)`, carrying the two edited files and this report. Its sha is not written here because this file is inside the commit it would name; it is the head of PR #203 after the push and the commit the PR body's What changed lists last. PR body edited after the push with `gh pr edit --body-file`: N1's timestamps, N2's line count, and the new commit's bullet.
