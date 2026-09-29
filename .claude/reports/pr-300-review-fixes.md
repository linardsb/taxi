# PR #300 review fixes, round 1

Review: https://github.com/linardsb/taxi/pull/300#issuecomment-5873979837 (head `36df1f2`, base `a4ed925`).
Triage (Linards, 2026-09-28): M1 option (a), phone only; fix L1–L4 in this PR. Nothing deferred.

## Commits

| sha | finding | files |
|---|---|---|
| `343ab43` | M1 api, L2 | `ride-lifecycle.repository.ts`, `pickup-pin-read.service.ts`, `pickup-pin-read.service.spec.ts`, `ride-pickup-pin.integration.spec.ts` |
| `bfd637e` | M1 console | `row-actions.tsx`, `ride-queue.tsx`, `ride-queue.test.tsx` |
| `1c410f2` | L1 | `use-pickup-pin.test.tsx` |
| `20655c0` | L3 | `i18n/lv.ts`, `ru.ts`, `en.ts` |
| the docs commit on top of `20655c0` | L4, M1/L3 prose | plan, `pickup-pin.md`, `ride-state-machine.md`, the implementation report, this file. Docs only: no file the gate compiles or tests. |

## Fixed

**M1 · the PIN read was open on app-booked rides.** `findPickupPinTarget` now selects `rides.bookingChannel` (the column `ride-notifications.service.ts` reads to skip the app SMS). `PickupPinReadService` answers `409 pickup_pin_not_phone` after the PIN check and before the status check; it logs the rejection with its own cause, so the audit log never says a PIN ride has no PIN. `RideRowActions` takes `bookingChannel` and shows «Rādīt PIN» only when it is `'phone'`.
- Tests: service spec case "app ride … 409 pickup_pin_not_phone"; integration refusal case books an app PIN ride with `book(appRider.auth, { pickupPin: true })`, accepts, `toArrived`, and expects `409 pickup_pin_not_phone` (the review's own scenario); `ride-queue.test.tsx` asserts no «Rādīt PIN» on an app ride at `arrived` with a PIN.
- Mutations (`observed`, 2026-09-28, each reverted and re-run green):
  - channel check replaced by `if (false as boolean)` in the service → service spec `1 failed, 4 passed, 5 total`; integration `1 failed, 11 passed, 12 total` with `Expected: "409 pickup_pin_not_phone"`, `Received: "200 undefined"`.
  - `bookingChannel === 'phone' &&` replaced by `true &&` in `row-actions.tsx` → `ride-queue.test.tsx` `1 failed | 11 passed (12)`.
- The console hook maps `pickup_pin_not_phone` to the generic `console.pin_failed`. No new key: the channel never changes and the button is hidden on app rows, so the console reaches that code only if the frame and the api disagree.

**L1 · `clear()` orphaning an in-flight read had no failing test.** New case: `reveal(A)` pending, `clear()`, resolve A, await the reveal promise, assert `{ kind: 'idle' }`.
- Mutation: the review's exact edit, `latest.current += 1;` commented out (`use-pickup-pin.ts:79`) → `Tests 1 failed | 6 passed (7)`, the new case red. Unmutated: 7 passed.

**L2 · no case exercised the admin role.** The `dispatcher()` helper takes a role; the L2 recovery case reads the PIN as `dispatcher(88, 'admin')` and expects 200.
- Mutation: the review's failure, `@Roles('dispatcher', 'admin')` → `@Roles('dispatcher')` at `ride-lifecycle.controller.ts:143` → `Tests: 1 failed, 11 passed, 12 total`. Unmutated: `12 passed, 12 total`.

**L3 · "once the car has arrived" was wrong past `arrived`.** `console.pin_error_not_arrived` now reads «PIN var nolasīt, kamēr auto gaida.» / «PIN можно получить, только пока машина ждёт.» / "The PIN can be read only while the car is waiting." The plan's copy table and breadboard carry the new LV text. The code stays `ride_not_arrived` (one code, reworded, as the review offered).

**L4 · the report's "final" gate predated the commit.** The report now lists the run at `36df1f2` (`last-gate.json`: started 15:40:05Z, `dirty: false`, `1m44.782s`, the run the PR body cited) first, and relabels the 14:39:48Z run as "before the commit". Its counts are unchanged, and the report points here for the post-fix gate.

## Gate after the fixes

`observed` — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 record-gate.sh --clean` at `20655c0`, `dirty: false`, started 2026-09-28T16:21:03Z, exit 0, `Tasks: 22 successful, 22 total`, `0 cached, 22 total`, `elapsed 1m41.746s`.

| package | before (`36df1f2`) | after (`20655c0`) | delta, derived |
|---|---|---|---|
| api | 91 suites, 927 | 91 suites, 928 | +1: the M1 service case. The integration additions are asserts inside existing cases (file stays at 12). |
| dispatch | 32 files, 302 | 32 files, 303 | +1: the L1 case. The M1 queue assert sits inside the existing «Rādīt PIN» case. |
| shared | 30, 304 | 30, 304 | 0 |
| driver | 46, 357 | 46, 357 | 0 |
| rider | 37, 231 | 37, 231 | 0 |
| db | 3, 17 | 3, 17 | 0 |

The first gate at the pre-amend head `7a7c227` failed in 25 s on `@taxi/shared#lint` (prettier: the longer RU string crossed the line width). That was mine; formatted and amended into `20655c0`.

## Earlier mutation counts, re-observed at the fixed tree

The new cases change two counts the implementation report and PR body quoted from `36df1f2` (`observed`, 2026-09-28, each reverted):

- **Stale guard**: `if (requestId === latest.current) setState(next);` → `setState(next);` → `Tests 2 failed | 5 passed (7)`: the Q3 stale-response case and the new L1 case. Was 1 of 6.
- **Rejection log carries the PIN**: `logRejected` given `pin: ride?.pin` (through a module-level stash) → `Tests: 2 failed, 3 passed, 5 total`: the M1 app-ride case and the `arriving` case, the two rejections where a PIN exists. The report's earlier "3 of 4" came from a mutation it does not spell out, so this is a re-run of the same idea, not the same edit; the counts are not comparable.

## Sweep of retired claims

Run in `wt-275` after the edits (`grep -nE "<pattern>"` over the plan, `pickup-pin.md`, the implementation report, `pickup-pin-read.service.ts`, `row-actions.tsx`, `use-pickup-pin.ts`):

| pattern | remaining hits | verdict |
|---|---|---|
| `pickup_pin_not_set` | plan :39, :306, :311, :320, :331, :346, :571, :639; report :53, :55; service :15, :50, :62, :63 | every refusal list (:39, :311, :571/E7a, :639/AC7, report :53, :55) now also names `pickup_pin_not_phone`; the rest describe the no-PIN branch, still true |
| `only.*copy` | row-actions :26; plan :212, :227, :313 | all say the SMS is the *phone* rider's copy, still true |
| `PIN ride at .arrived` | row-actions :25; plan :15, :572, :638; report :13, :55 | :25, :638, report :13 now say phone; plan :15 is about a phone rider |
| `927`, `302` | report :79, :83 | the pre-fix table, labelled as the `36df1f2` runs; post-fix counts are here |
| `36df1f2` | report :73, :74 | the L4 relabel |
| `kad auto ir klāt` | none | retired |
| `final` | report :74 | the "was called final" note |
| `of 4 red`, `of 6)` | report T11, T21 lines | labelled "at `36df1f2`"; T21 carries the 2-of-7 figure, T11 points here |

Outside that list: `.claude/references/ride-state-machine.md:15` said "a dispatcher or admin can read the PIN at `arrived`" with no channel limit; it now says a phone-booked ride's PIN, and names the 409. Checked and left as is because they are still true: `ride.ts:439-442` and `realtime-events.ts:256` (name the two carriers, no channel claim), `ride-lifecycle.controller.ts:139` ("a phone caller's pickup PIN"), and the integration spec docblock :35.

PR body: "Every read …" block, the refusal order (`404`, `409 pickup_pin_not_set`, `409 ride_not_arrived`), "«Rādīt PIN» appears only on a PIN ride at `arrived`", the Summary's "at `arrived` only, for dispatcher and admin", the gate block (`36df1f2`, 302, 927, 1m44.782s) and the diff stat all go stale with these commits. They are rewritten after the push, and the diff stat is re-derived from the pushed head.

## Deferred

None.

## Manual look

None needed for these fixes; the Level 4 console run is unaffected except that «Rādīt PIN» no longer appears on app rides (covered by `ride-queue.test.tsx`).
