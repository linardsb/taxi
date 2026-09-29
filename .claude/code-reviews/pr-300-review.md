# PR #300 review, round 1: feat(dispatch): phone-order pickup options, announce badge, PIN read (#275)

**Head** `36df1f2` · **Base** main @ `a4ed925` · reviewed 2026-09-28 · first round (no earlier report, so the guarantees pass and the fix-mechanism pass do not apply; `origin/main` was `a4ed925` at review time, equal to the PR's `baseRefOid`)

**Verdict: approve, with one decision for Linards (M1).** No Critical or High findings. There is one Medium and four Lows. M1 is a scope question on the new PIN read rather than a defect in its mechanism. It is the one item worth settling before merge.

## Summary

Dina's phone form gets two checkboxes, «PIN kods» (pickup PIN) and «Šoferis pieteiksies balsī» (the driver announces arrival by voice). The board frame (the ride list the console redraws every 2 s) carries two new booleans, `announceArrival` and `pickupPinRequired`, and shows a badge for announce rides. A new `GET /rides/:rideId/pickup-pin`, for dispatcher and admin only, lets Dina read the PIN to a phone caller whose arrival SMS never came. The PR says openly that this reverses #258's "the PIN never reaches the dispatcher".

What I checked:
- Every changed source file was read in full, and the `code-reviewer` agent reviewed the same files independently. Each of its findings was checked before going in here. L1 was re-run as a mutation. The `bookingChannel` gate behind M1 and the `buildBoardState` callers (`dispatch.controller.ts:53` for REST, `board.service.ts:243` for the socket) were each confirmed by grep and read.
- The security path. `JwtAuthGuard` and `RolesGuard` are global (`app.module.ts:59-60`), and `RideLifecycleController` has no class-level `@Roles`, so the route's `@Roles('dispatcher', 'admin')` is the only one that applies. Status and PIN come from one `SELECT` (`ride-lifecycle.repository.ts:93-97`), so there is no gap between the check and the read. Neither log line carries the PIN.
- The claim that `pickupPinRequired` equals "has a PIN". `board-ride.ts:38-40` says the flag and the `pickup_pin` column are equal by construction. `rides.service.ts:271` is the only place a PIN is minted, and it mints if and only if `request.options.pickupPin` is set, so the claim holds.
- The retired #258 claims. I grepped `never|only|exclusiv` near `pin` across the api, shared, the apps, docs and references. The leftover hits either describe the new two carriers correctly (`ride.ts:439`, `realtime-events.ts:256`) or are method-scoped and still true (`notifications.repository.ts:72`, which is still used only by the SMS).
- The constraint pass. `grep -inE "do not modify|do not edit|read-only|no changes to|frozen"` on the plan returned nothing.

## Issues

### Medium

**M1 · scope of the PIN read · `services/api/src/features/rides/lifecycle/pickup-pin-read.service.ts:44-57`, `apps/dispatch/src/features/override/row-actions.tsx:68`.** Neither the endpoint nor the «Rādīt PIN» button checks `bookingChannel`, so Dina can read the PIN of an **app-booked** ride too. Every justification in the PR is about phone rides:
- the service docblock (`:18-20`): "a phone rider gets their PIN only in the arrival SMS";
- `row-actions.tsx:24-27`: "the arrival SMS is the phone caller's only copy";
- the plan's Q1 (`dispatch-phone-options-275.md:659-662`), which records the reversal but says nothing about channel.

An app rider has the PIN on their screen and gets no arrival SMS at all. At `a4ed925`, `ride-notifications.service.ts:146-149` returns before the SMS for `bookingChannel === 'app'` on both `accepted` and `arrived`, and sends the arrival push instead. That landed via #253's PR, and `git log origin/main --grep='#135'` lists it. So there is no recovery need for an app ride. Failure scenario: an app PIN ride reaches `arrived`, and the board offers «Rādīt PIN» on it. Someone rings the switchboard claiming to be that rider, and Dina reads out the one secret meant to stop a wrong-car pickup, with no reason in the product to do so. This is not a deviation from the plan, because the plan never scoped the read by channel. It is a gap in Q1: a decision nobody made. That puts it at Medium, and it is Linards' call.

**Fix, one of:**
- (a) Add `bookingChannel` to `findPickupPinTarget`'s select, answer `409 pickup_pin_not_phone` (or reuse `pickup_pin_not_set`) for a non-phone ride, and gate the button on `ride.bookingChannel === 'phone'`, which the frame already carries. Add one integration case: an app PIN ride at `arrived` gets 409.
- (b) Linards records that app rides are deliberately in scope, for example for a rider whose phone died at the kerb, and both docblocks and Q1 say so.

### Low

**L1 · test gap · `apps/dispatch/src/features/override/use-pickup-pin.ts:79`.** Deviation 2 (`clear()` bumps `latest.current` so a late response cannot repaint a closed dialog) has no test that fails without it. `observed`: with `latest.current += 1;` replaced by a comment, `npx vitest run --root apps/dispatch src/features/override/use-pickup-pin.test.tsx` → `Tests 6 passed (6)`, the same as unmutated. The only `clear()` case (`use-pickup-pin.test.tsx:143-159`) calls it after the response has already landed. **Fix:** start `reveal(A)` with a pending fetch, call `clear()`, resolve A, and assert `state` is `{ kind: 'idle' }`.

**L2 · test gap · `services/api/src/features/rides/lifecycle/ride-pickup-pin.integration.spec.ts`.** The route allows `admin` (Q6), but no case exercises it. `grep -n admin` on the spec returns nothing. A `@Roles` typo on `admin` would pass the gate. **Fix:** one `readPin(ride.id, admin.auth).expect(200)` in the L2 recovery case.

**L3 · error copy · `apps/dispatch/src/features/override/use-pickup-pin.ts:61-63`, `console.pin_error_not_arrived`.** The service answers `ride_not_arrived` for any status other than `arrived` (`pickup-pin-read.service.ts:54`), including `in_progress` and `cancelled`. The board lags by up to 2 s, so a click just after the driver started the ride shows «PIN var nolasīt, kad auto ir klāt.» ("once the car has arrived"), which is wrong for a ride already under way. **Fix:** reword it in all three languages to something like «PIN var nolasīt, kamēr auto gaida.» (while the car is waiting), or split the code.

**L4 · figure provenance · `.claude/reports/dispatch-phone-options-275-report.md`, "Full gate, final".** The report's "final" gate started at 14:39:48Z, 2m05s. The commit `36df1f2` is 14:45:22Z (`git log --format=%cI`: `15:45:22+01:00`), so that run was on the uncommitted tree. The PR body cites a different and later run: `.claude/last-gate.json` in `wt-275` has `head 36df1f2`, `dirty: false`, started 15:40:05Z, `elapsed 1m44.782s`. The counts are identical in both, and CI's `check` job reproduces them at the same head, so nothing is wrong except the label. The report calls a pre-commit run "final" while the run at the head is missing from it. **Fix:** add the 15:40Z recorded run to the report and relabel the 14:39Z one.

## Validation

| Check | Result | Provenance |
|---|---|---|
| CI `check` (`pnpm turbo run typecheck lint test build`) at `36df1f2` | `Tasks: 22 successful, 22 total`. api 91 suites / 927 tests, dispatch 32 / 302, shared 30 / 304, driver 46 / 357, rider 37 / 231, db 3 / 17 | `observed`, run 36445642185, job log |
| CI `audit-diff`, `codeql`, `CodeQL`, `ready` | pass | `observed`, `gh pr checks 300` |
| PR body gate block | matches `last-gate.json` (head `36df1f2`, clean) and CI's counts digit for digit | `observed` |
| `use-pickup-pin.test.tsx`, unmutated / L1 mutation | 6 passed / 6 passed | `observed`, this review |
| Local full gate | not re-run. CI's gate ran at the same head on the same base (`a4ed925` = live `origin/main`), and running a gate locally would collide with the other sessions using the shared test DB | — |
| PR figures: 43 files, +2267/−17 | equal to `gh pr view`'s `changedFiles`/`additions`/`deletions` | `observed` |
| "12 console keys" | 7 (`badge_announce_arrival`, `show_pin`, `show_pin_at`, `pin_title`, `pin_hint`, `pin_failed`, `pin_error_not_arrived`) + 5 (`booking_options`, two option labels, two hints) = 12 per language | `derived` from the diff |

## What is good

- The PIN never travels on a ride object. It has its own response schema, so every existing ride path (driver read, `complete`, `settle`, `RideCreated`) stays PIN-free, and #258's rule that a forgotten path strips the PIN rather than leaking it still holds.
- `boardFlagsOf` parses separately from the pickup, so a malformed `options` costs a row its badge, never the row. Both the REST board and the socket frame go through `buildBoardState`, so they cannot disagree.
- The leak checks are aimed well. The service spec asserts on every log call in `afterEach` (read, restore, then assert, after the first mutation leaked spy calls between cases). The board check walks the raw response body. The page test checks the DOM and `localStorage` after Escape.
- The Level 4 run found a real bug (Enter on a focused checkbox submitted the order without the PIN), fixed it, and pinned the fix with a test and a mutation.
- The reversal of #258 is named in the PR summary, the report, the plan's Q1 and an AMENDMENTS line in `pickup-pin.md`, and every surviving exclusivity sentence was rewritten.

## Recommendation

Approve. Settle **M1** first, since it is a product decision about who can hear a rider's PIN: option (a) is about ten lines plus one test, and option (b) is two docblocks and a Q1 line. L1 and L2 are one test each. L3 and L4 are text edits.
