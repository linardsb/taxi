# PR #304 review, round 1: feat(driver): show the dispatcher's booking note on the active ride (#303)

**Head** `579d434` · **Base** main @ `da9c933` · reviewed 2026-09-29 · first round (no earlier report, so the guarantees pass and the fix-mechanism pass do not apply; `origin/main` was `da9c933` at review time, equal to the PR's `baseRefOid`)

**Verdict: request changes, one High (H1).** The PR says the note never reaches a log line (AC8) and that the new `rideFailureReason` "closes" the PIN and tracking-token leak too. It does not. A failed ride insert still logs the note, in full, through Nest's default exception handler. The rest of the PR is sound. There are two Lows.

## Summary

Dina's phone-booking note is trimmed once in `BookingsService` (blank → null), written in the ride's own insert into a new nullable `rides.dispatcher_note`, returned by `findWithQuote` as a sibling of `ride`, and projected only by `toDriverRide` inside `DISPATCHER_NOTE_VISIBLE_STATUSES` (accepted, arriving, arrived, in_progress). The driver's active-ride screen shows it as one screen-reader stop and re-checks the same status set on the client.

What I checked:
- Every changed source file in full. The `code-reviewer` agent reviewed the same files independently; its one High matched a leak I had already reproduced (below), and its Low was checked by grep before going in here.
- **Every way a `rides` row leaves the API.** Every mapper lists its fields explicitly (`toRide`, `toAwaiting`, `toTransitioned`, `toNotifiable`, the board map, the lifecycle, settlement, customers and drivers selects). None spreads a row or uses `select *`. The one spread, `...snap.ride` in `findForRider` (`rides.service.ts:257`), spreads a `Ride`, which has no note. The note never enters the `request` jsonb, because `bookings.service.ts:37` splits it off, so the offer card and board flags cannot reach it.
- **Transition responses.** Only `readDriverRide` passes the note. `POST /arriving|arrived|start` return nothing the driver app uses as a ride (`use-active-ride.tsx`'s `post_step` dispatches `step_done` without reading the body), and `complete` goes through `toDriverRide` without a note, which is correct because `completed` is outside the window. The note survives each step in the in-memory ride, and the client gate hides it at the end.
- **Input cap vs output schema.** The booking body is `z.string().max(280)` (`customer.ts:128`), trimming only shortens, and blank becomes null, so every stored note parses under the driver's `min(1).max(280)`. See L1 for the coupling.
- The constraint pass: `grep -inE "do not modify|do not edit|read-only|no changes to|frozen"` on the plan hits only line 93, which records the new source file as an amendment. Nothing blocks H1's fix.

## Issues

### High

**H1 · the note still reaches the error log on a failed ride insert · `services/api/src/features/rides/rides.service.ts:318` (`throw error;`), `:163`.**

In plain words: if the database refuses the ride insert, the whole query, including Dina's note ("Ratiņkrēsls, neredzīgs"), the pickup PIN and the tracking token, is printed to the API's error log.

Mechanism:
- `rideFailureReason` cleans only the structured `ride.request.failed` line. `createRide`'s catch then rethrows the raw `DrizzleQueryError` (the error drizzle raises for a failed query, whose message is `Failed query: …\nparams: …`), and `request()`'s catch rethrows it again.
- `BookingsController.book` → `BookingsService.book` → `RidesService.request` has no try around it, and `services/api` registers no exception filter (`main.ts` has none; no `@Catch`, `APP_FILTER` or `useGlobalFilters` in `src/`).
- So the error reaches Nest's default `ExceptionsHandler`. In `@nestjs/core` 11.1.27, `BaseExceptionFilter.handleUnknownError` ends with `BaseExceptionFilter.logger.error(exception)` for any error that is not an `HttpException` (`node_modules/@nestjs/core/exceptions/base-exception-filter.js:51-53`, read in this worktree).

`observed` (run in `services/api` at `579d434`): a `DrizzleQueryError` built with params `['x', 'Ratiņkrēsls, neredzīgs']` and passed to `new Logger('ExceptionsHandler').error(err)`, which is the call the handler makes, printed:

```
ERROR [ExceptionsHandler] DrizzleQueryError: Failed query: insert into "rides" (...) values ($1,$2)
params: x,Ratiņkrēsls, neredzīgs
```

What this probe does and does not show: it runs the handler's logging call directly, not a full HTTP request with a failing insert. The route from `createRide` to the handler was confirmed by reading the code above, not by a run.

Failure scenario: Dina books with a note; the insert fails with a unique clash on `tracking_token` or `order_id`, a dropped connection, or SQLSTATE 22001. `ride.request.failed` logs `query_failed:<code>`, and the next line is the query with the note, the PIN and the token. The same applies to the rider's `POST /rides` (PIN and token).

Why the PR's evidence did not catch it: the device pass's `grep … = 0` covered successful bookings only, and `ride-failure-reason.spec.ts` tests the helper, not the rethrow, so it passes with or without this leak.

The claim to retire, by subject: AC8's checkbox in the report (`driver-booking-note-303-report.md:85`), the report's deviation line "the fix closes those too" (`:93`), the plan amendment (`:572`), and the PR body's **Log leak fix** bullet and its "the fix closes those too" note.

**Fix.** `rides.service.ts` is at 497 of 500 lines, so keep it net zero there:
1. In `ride-failure-reason.ts`, add a helper that returns what to throw: for a `DrizzleQueryError`, a bare `new InternalServerErrorException()` with no `cause` (Nest does not log `HttpException`s, and the sanitised `ride.request.failed` line already records the SQLSTATE); any other error unchanged. Replace `throw error;` at `:318` with `throw <helper>(error);`.
2. Add a test that forces a failed insert (`jest.spyOn(RidesRepository.prototype, 'create')` rejecting with a `DrizzleQueryError` whose params carry the note), spies on `Logger.prototype.error`, and asserts no logged argument contains the note. An integration case through `POST /dispatch/bookings` covers the handler itself; a unit case on `RidesService` does not.
3. Probe it as the PR probed the other leaks: remove the fix, show the test red, restore it, show it green.

### Low

**L1 · the 280 cap is a literal in two schemas that must agree · `packages/shared/src/schemas/ride.ts:338`, `packages/shared/src/schemas/customer.ts:128`.** They agree today (see Summary). If a later ticket raises the console cap in `customer.ts` only, every note over 280 characters fails `driverRideSchema` on the driver's read and the active-ride screen shows its error state. Fix: export `DISPATCHER_NOTE_MAX = 280` from shared and use it in both.

**L2 · the report states two line counts for `rides.service.ts` · `.claude/reports/driver-booking-note-303-report.md:18` says 496, `:54` says 497.** `observed`: `wc -l` at `579d434` gives 497. The 496 predates the AC8 import. Make `:18` read 497, or date it.

## Numbers pass

| Figure | Where | Provenance | Checked |
|---|---|---|---|
| 24 files, +3037 / −11 | PR body | observed | matches `gh pr view` |
| Buckets 576 + 103 + 1 + 1848 + 509 = 3037 | PR body | derived | per-file additions of the other 20 files sum to 509 |
| Gate 22/22; api 951/92, driver 361/46, rider 231/37, shared 307/30, db 17/3, dispatch 303/32 | PR body | observed | reproduced exactly by this review's gate (below) |
| Gate time 1m45.55s (PR body) vs 2m6.6s (report) | both | observed | two different runs, both named; not a defect |
| 931 + 17 = 948, + 3 = 951; 17 = 1 + 14 + 1 + 1 | report | derived | arithmetic holds and matches this gate's 951 |
| `rides.service.ts` 497 lines | PR body, report `:54` | observed | `wc -l` 497; see L2 for `:18` |
| "The note's text never appeared in the API log" | PR body | observed | true for the run described (successful bookings); does not support AC8 for the failure path, see H1 |

## Validation

`observed` — `pnpm turbo run typecheck lint test build --force` in a clean worktree at `579d434`, from cleared `dist` and `apps/dispatch/.next`, with `REDIS_TEST_URL=redis://localhost:6381` and `COMPOSE_PROJECT_NAME=taxi`, exit 0:

| Check | Result |
|---|---|
| Tasks | 22 successful, 22 total, 0 cached, 3m20.315s |
| `@taxi/api` | 951 passed / 951, 92 suites, none skipped |
| `@taxi/driver` | 361 / 361, 46 suites |
| `@taxi/rider` | 231 / 231, 37 suites |
| `@taxi/shared` | 307 / 307, 30 files |
| `@taxi/dispatch` | 303 / 303, 32 files |
| `@taxi/db` | 17 / 17, 3 files |
| CI | `check`, `audit-diff`, `codeql`, `CodeQL`, `ready` all pass |

## What is done well

- The note is written in the ride's own insert, so a failed audit write cannot lose it, and the unit test checks the call order with `invocationCallOrder` rather than asserting it in prose.
- Keeping the note as a sibling of `ride` on `findWithQuote` (the `pickupPin` pattern), never on `Ride`, keeps it out of every rider, dispatcher and settlement projection by construction.
- The window is enforced on the server and in the app from one shared set, pinned by content and by identity. Both leak probes were planted, shown red, and reverted.
- Finding the `ride.request.failed` leak at all was good work beyond the plan; H1 is the second half of the same leak.

## Recommendation

Request changes. Fix H1 (net-zero lines in `rides.service.ts`, one test, one probe) and correct the four AC8 surfaces it names. L1 and L2 can go in the same pass.
