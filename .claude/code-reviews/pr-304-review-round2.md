# PR #304 review, round 2: feat(driver): show the dispatcher's booking note on the active ride (#303)

**Head** `38ad3ec` · **Base** main @ `da9c933` · reviewed 2026-09-29 · round 2 of round 1 (`pr-304-review.md`, head `579d434`). The live `origin/main` tip after `git fetch origin` is `da9c933`, equal to round 1's recorded base, so the guarantees pass does not fire. The fix-mechanism pass does.

**Verdict: approve.** H1 is closed, and I reproduced the proof myself: with the one-line fix reverted, the new integration case goes red on Nest's `ExceptionsHandler` line, and it goes green again with the fix restored. L1 and L2 are closed. There is one new Low (N1, wording).

## Summary

Round 1's High was that a failed ride insert still logged Dina's note, the pickup PIN and the tracking token. `createRide`'s catch rethrew the raw `DrizzleQueryError` (the error drizzle raises for a failed query, whose message lists every bound parameter), and Nest's default exception handler logs any error that is not an `HttpException` whole. The fix swaps that error for a bare `InternalServerErrorException` before rethrowing it. The swap is `rideFailureToThrow` in `ride-failure-reason.ts`, called at `rides.service.ts:318`. Nest does not log an `HttpException`, and the structured `ride.request.failed` line already records the SQLSTATE.

## Fix-mechanism pass (H1)

What the swap newly permits, checked one question at a time:

- **Does any caller depend on the raw error?** No. `grep -rn "DrizzleQueryError\|23505\|\.cause\b"` over `services/api/src` (spec files excluded) hits only `ride-failure-reason.ts` and `vehicles.repository.ts`, which has its own unique-violation handling on a different table. `request()`'s catch (`rides.service.ts:153-163`) still releases the idempotency key: it runs `kv.del` and rethrows whatever it receives, and the swapped error still reaches it.
- **Does a status change?** Only a `DrizzleQueryError` is swapped, and it was already a 500 (an unknown error). A `ServiceUnavailableException` from the quote, or any other `HttpException`, is returned as the same instance. That is pinned by `ride-failure-reason.spec.ts`. The 500 body's message changes case, from `Internal server error` to `Internal Server Error`. `grep -rni "internal server error"` over `apps`, `services/api/src` and `packages/shared/src` finds no reader apart from an unrelated SMS provider spec.
- **What is lost?** The query text, the constraint name and the stack no longer reach any log for this path. Only `query_failed:<SQLSTATE>` is kept. That is intended and documented in the helper's docblock and the fix report. An operator debugging a 23505 has the SQLSTATE and the `riderId` but not the constraint name.
- **Is there another path to a log?**
  - `RidesRepository.create` is the only insert into `rides` (`grep "insert(rides)"`, one hit). It runs inside a transaction, and drizzle also wraps the transaction's `begin` and `commit` queries in `DrizzleQueryError`.
  - The client is `drizzle(pool, { schema })` (`db/src/client.ts:10`). It has no `logger:` option, no pool `'error'` listener and no env flag that turns on query logging, so no successful insert logs its parameters through `console`.
  - `insertBookingAudit` carries the note in its parameters. The repository neither logs nor catches, and `BookingsService.auditFailed` logs `error.name` only.
  - The rider's `POST /rides` takes the same `createRide` catch.
- **Can the test pass vacuously?** No. It asserts `query_failed:23505` among the logged lines, and that string appears only when the real insert failed and `rideFailureReason`'s `instanceof` matched. The spies sit on `Logger.prototype`, which is the prototype of the `ExceptionsHandler` logger instance.

`observed`, in `wt-303` at `38ad3ec`, with `COMPOSE_PROJECT_NAME=taxi npx jest src/features/dispatch/bookings/bookings.integration.spec.ts -t H1`:

| Tree | Result |
|---|---|
| `rides.service.ts:318` reverted to `throw error;` | `Tests: 1 failed, 11 skipped, 12 total`. The logged `params:` line starts with the ride's order id, status, rider id and the `request` JSON (pickup address `Hanzas iela, Rīga`). |
| Restored (`git diff --quiet HEAD` true) | `Tests: 11 skipped, 1 passed, 12 total` |

**Does `instanceof DrizzleQueryError` still match in the production image?** The `code-reviewer` agent raised this and could not check it. The gate never builds the `pnpm deploy` runtime tree, so if `services/api` and `@taxi/db` loaded different `drizzle-orm` copies there, the swap would stop matching and H1 would come back in production only. `observed`: `pnpm --filter @taxi/api deploy --prod --legacy <scratch>` (the Dockerfile's command, without `--frozen-lockfile`, from the same lockfile), then `realpath(require.resolve('drizzle-orm'))` from the deploy root and from `node_modules/@taxi/db` both give `<scratch>/node_modules/drizzle-orm/index.cjs`, `same: true`. Refuted, no finding.

The red run also shows that the pickup and destination addresses and the rider id were in the leaked parameters. The fix covers them too, because it drops the whole message.

## Round 1 findings

| Code | Round 1 | Status | Evidence |
|---|---|---|---|
| H1 | High, note/PIN/token in the `ExceptionsHandler` log | Closed | Probe above. The fix report has a per-finding grep table and the closing commands. |
| L1 | Low, 280 literal in two schemas | Closed | `DISPATCHER_NOTE_MAX` is exported from `ride.ts`, and `customer.ts` imports it (`customer.ts` already imported from `./ride`, so no new cycle). The new test compares both schemas at the cap and one over. |
| L2 | Low, two line counts in the report | Closed | The report's `:18` is dated. `wc -l rides.service.ts` = 497 at `38ad3ec`. |

## Issues

### Low

**N1 · the fix is attributed to the wrong catch · the PR body's round-1 H1 bullet (body line 83) and the plan's new amendment (`.claude/plans/driver-booking-note-303.md:577`).** Both say "`ride.request`'s catch rethrows `rideFailureToThrow(error)`". The rethrow is in `createRide`'s catch, the one that logs `ride.request.failed` (`rides.service.ts:318`), not in `RidesService.request` (`:153-163`), which rethrows unchanged. A reader who goes to `request()` finds `throw error;` and could conclude the fix is missing. Fix: write "`createRide`'s catch (the `ride.request.failed` one)" in both places.

### Outside this PR (not a finding against it)

**The same `ExceptionsHandler` mechanism applies to every other query that binds personal data.** The `code-reviewer` agent pointed out the clearest case: `BookingsService.book` runs `findUserByPhone`, `findOrCreateUser`, `fillEmptyDisplayName` and `findOrCreateCustomer` (`bookings.service.ts:45-63`) before `rides.request`. They bind the caller's phone number and name. If one of them fails (a statement timeout, a failover), the raw `DrizzleQueryError` reaches Nest's handler, which logs the phone number. This leak predates #303, and H1's probe observed the mechanism, but I have not run it on this path. The general fix is one global exception filter that swaps any `DrizzleQueryError` for a bare 500, the same way `rideFailureToThrow` does here. Whether and where to track it is Linards' call. No issue has been filed.

## Numbers pass

| Figure | Where | Provenance | Checked |
|---|---|---|---|
| 28 files, +3249 / −14 at `38ad3ec` | PR body | observed | `git diff --stat origin/main..HEAD` and `gh pr view` both give 28, 3249, 14 |
| 24 files, +3037 / −11 and its bucket table | PR body | observed at `579d434`, labelled so | unchanged from round 1, where it was checked |
| api 955 = 951 + 1 + 3 | PR body, fix report | derived | one new integration case plus three `rideFailureToThrow` cases in the diff. This gate gives 955. |
| shared 308 = 307 + 1 | PR body, fix report | derived | one new case in `schemas-customer.test.ts`. This gate gives 308. |
| Gate 22/22, 1m43.884s | PR body, fix report | observed | a named run. This review's run took 1m48.821s. Two different runs, not a defect. |
| `rides.service.ts` 497 lines | PR body, fix report, report `:18` | observed | `wc -l` 497 |
| L1 probe `2 failed \| 10 passed (12)` | fix report | observed | not re-run. The mutation and the test file both match the diff. |

Retired-claim sweep: `grep -n "closes those too\|never appeared\|never reaches a log\|no log line"` over the plan and the report returns nothing. In the PR body, "never appeared in the API log" is now limited to successful bookings.

## Validation

`observed`, `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` in `wt-303` at `38ad3ec`. The run started from cleared `dist` and `apps/dispatch/.next` and exited 0:

| Check | Result |
|---|---|
| Tasks | 22 successful, 22 total, 0 cached, 1m48.821s |
| `@taxi/api` | 955 / 955, 92 suites |
| `@taxi/shared` | 308 / 308, 30 files |
| `@taxi/driver` | 361 / 361, 46 suites |
| `@taxi/rider` | 231 / 231, 37 suites |
| `@taxi/dispatch` | 303 / 303, 32 files |
| `@taxi/db` | 17 / 17, 3 files |
| CI at `38ad3ec` | `check`, `audit-diff`, `codeql`, `CodeQL` and `ready` all pass |

## What is done well

- The first version of the test mocked the error. The fix pass replaced it with a real Postgres unique violation, which also answers whether `instanceof DrizzleQueryError` matches `@taxi/db`'s error. A mocked test could not answer that.
- The test spies on every `Logger` level, not only `error`, and it checks the token as well as the note.
- The fix stays net zero in a file at 497 of 500 lines, and its docblock names the one status-preserving case it must not break. A test pins that case.
- The retired-claim sweep was done by subject across the plan, the report and the PR body, with the grep table in the fix report.

## Recommendation

Approve. N1 is a two-place wording fix and can go in the same commit as anything else, or not at all.
