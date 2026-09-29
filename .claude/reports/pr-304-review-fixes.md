# PR #304 review fixes, round 1

Review: https://github.com/linardsb/taxi/pull/304#issuecomment-5893740784 (head `579d434`). PR state at start: OPEN. Worktree `wt-303` clean, no merge/rebase/cherry-pick in progress.

## Triage

| Code | Severity | Call |
|---|---|---|
| H1 | High | Fix now |
| L1 | Low | Fix now (the review recommends the same pass; two lines plus one test) |
| L2 | Low | Fix now (one report line) |

Nothing deferred, nothing needs a manual look.

## H1 — the note reached the error log on a failed ride insert

**What was wrong.** `RidesService.request`'s catch logged a sanitised `ride.request.failed` line, then rethrew the raw `DrizzleQueryError`. Nothing between it and the controller catches, and `services/api` has no exception filter, so Nest's default `ExceptionsHandler` logged the error whole: `Failed query: …\nparams: …`, which carries the note, the pickup PIN and the tracking token. The rider's `POST /rides` goes through the same catch.

**Fix.** `ride-failure-reason.ts` gains `rideFailureToThrow(error)`: a `DrizzleQueryError` becomes a bare `InternalServerErrorException` with no `cause` (Nest does not log an `HttpException`, and the SQLSTATE is already in `ride.request.failed`); any other error is returned unchanged. `rides.service.ts:318` throws `rideFailureToThrow(error)`. The import stays one line, so the file is still 497 lines (`observed`, `wc -l` after the fix).

**Test.** `bookings.integration.spec.ts`, "keeps Dina's note out of every log when the ride insert fails". It books one ride, reads its `tracking_token`, then books a second with the note `'Ratiņkrēsls, neredzīgs'` (the review's text) while the `RidesRepository` instance's `create` passes the first ride's token to the real insert. Postgres refuses it with a unique violation, so the error is a real `DrizzleQueryError` from `@taxi/db`'s drizzle, not one the test built. `Logger.prototype` `log`, `error`, `warn`, `debug`, `verbose` and `fatal` are all spied. Asserts a 500, a body without the note, that `query_failed:23505` was logged, and that no logged argument contains the note or the token. The review's own probe called the handler's logging line directly; this one runs the HTTP route through Nest's handler. The first version of this test (commit `5feea26`) mocked `create` to reject with a hand-built error; it was replaced after the check below.

**Does `instanceof DrizzleQueryError` match a real error?** A mocked error proves nothing if `@taxi/db` loads a different `drizzle-orm` instance from `services/api`. `observed`: `require.resolve('drizzle-orm')` from `services/api` and from `db` both realpath to `node_modules/drizzle-orm/index.cjs`, and both packages are CommonJS. The real-failure test settles it anyway: `query_failed:23505` is logged only when `rideFailureReason`'s `instanceof` matched. `grep -rn "Interceptor\|APP_INTERCEPTOR\|useGlobalInterceptors" services/api/src` is empty, so no request-logging interceptor sits on this path.

**Probe, `observed`** (`npx jest src/features/dispatch/bookings/bookings.integration.spec.ts -t H1`, 2026-09-29):
- Mocked-error version, before the fix (tree at `579d434` + the test): `Tests: 1 failed, 11 skipped`; the failing string contains `params: x,Ratiņkrēsls, neredzīgs Error: Failed query: insert into "rides" …`, the `ExceptionsHandler` line. With the fix: 12/12 for the file.
- Real-failure version, fix removed: `Tests: 1 failed, 11 skipped`; the logged `params:` line ends `…,phone,CS5EjeUGMb_7L0q0,,7954,716,Ratiņkrēsls, neredzīgs` (the clashing token, then the note). Fix restored (`git diff --quiet HEAD` on `rides.service.ts`): `Tests: 11 skipped, 1 passed`.

**New failure mode of the mechanism.** Swapping the error could turn a client-fault or upstream status (a 4xx, or the quote's 503) into a 500, and it drops the query text from the logs for good. The first is guarded: only `DrizzleQueryError` is swapped (and the real-failure test shows the `instanceof` does match a real one), pinned by three cases in `ride-failure-reason.spec.ts` (a 500 with no `cause` and no note in its response; a `ServiceUnavailableException` returned as the same instance; a plain `Error` and a string returned unchanged). The second is intended: the SQLSTATE in `ride.request.failed` is what is kept.

## L1 — the 280 cap was a literal in two schemas

**Fix.** `DISPATCHER_NOTE_MAX = 280` exported from `packages/shared/src/schemas/ride.ts`, used by `driverRideSchema.dispatcherNote` and `dispatcherBookingBodySchema.dispatcherNote` (`customer.ts`). `grep -rn "max(280)" packages/shared/src` now hits only the override `reason` fields, which are a different cap.

**Test.** `schemas-customer.test.ts`, "accepts exactly the note length the driver's read accepts": at `DISPATCHER_NOTE_MAX` and at one over, the booking body and `driverRideSchema.shape.dispatcherNote` must agree, and the driver side must accept the cap.

**Probe, `observed`** (`npx vitest run tests/schemas-customer.test.ts`): with the console cap raised alone to `max(281)`, `Tests 2 failed | 10 passed (12)`: the new test and the existing "rejects a dispatcher note over 280 characters". So the existing test already caught this exact mutation; the new one is what still holds if the cap is later changed on purpose through the constant. Restored: `Tests 12 passed (12)`.

## L2 — two line counts for `rides.service.ts`

Report `:18` now reads "496 lines at T7, before the AC8 import; 497 at `579d434`". `wc -l` after this pass: 497.

## Retired claims, by subject

AC8 claimed the note never reaches a log line; the "closes those too" sentence claimed the PIN and token leak was closed. Both were half true. Sweep, run on the fixed tree:

| `grep -n` pattern | Plan | Report | PR body (fetched with `gh pr view 304 --json body`) |
|---|---|---|---|
| `closes those too` | 0 | 0 (was `:93`, rewritten) | `:85` → rewritten |
| `no dedicated test` | 0 | `:93`, now "had no dedicated test at `579d434`; the review-fix pass adds one" | `:87` → rewritten |
| `rideFailureReason` | `:323` (pre-implementation gotcha, historical), `:572` → sentence added that it closed only the structured line | `:93`, amended | `:22` (**Log leak fix** bullet) → rewritten |
| `never appeared in the API log` | 0 | 0 | `:77` → qualified: successful bookings only |
| `496` | `:198`, `:205`, `:566`, `:570` (dated probe-pass records, left as history) | `:18` → L2 | 0 |
| AC8 checkbox | — | `:85`, amended | — |

A new plan amendment (2026-09-29, PR #304 review round 1) records H1 and L1.

## Validation

`observed` — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` in `wt-303`, from cleared `dist` and `apps/dispatch/.next`, exit 0, 2026-09-29, on the final tree (the real-failure test):

| Check | Result |
|---|---|
| Tasks | 22 successful, 22 total, 1m43.884s |
| `@taxi/api` | 955 / 955, 92 suites |
| `@taxi/shared` | 308 / 308, 30 files |
| `@taxi/driver` | 361 / 361, 46 suites |
| `@taxi/rider` | 231 / 231, 37 suites |
| `@taxi/dispatch` | 303 / 303, 32 files |
| `@taxi/db` | 17 / 17, 3 files |

Derived: api 951 + 1 integration case + 3 `rideFailureToThrow` cases = 955; shared 307 + 1 = 308. Suite counts unchanged because every new case went into an existing file. Replacing the mocked test with the real-failure one kept the count.

Earlier runs on this pass: the mocked-error tree was green (22/22, 1m56.831s, same counts). The first run on the real-failure test was red, `Failed: @taxi/api#typecheck`, `TS2322` at `bookings.integration.spec.ts:294` (`tracking_token` is nullable; jest's transform does not typecheck, so the file-level run was green); narrowed, then the run above.
