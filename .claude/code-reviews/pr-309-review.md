# PR #309 review, round 1: gate drivers on admin approval, `/admin` driver routes (#20, PR 1 of 4)

**Head** `8456efe` · **Base** main @ `0f0897e` · reviewed 2026-09-30 · first round, so the base-moved check does not apply (live `origin/main` = `0f0897e` = `baseRefOid`)

## Summary

The approval gate is sound where the PR says it is:
- The go-online `UPDATE`'s WHERE decides whether a driver can go online.
- Accept and force-assign each take an in-transaction `FOR UPDATE` just before `claimDriver`, which keeps the rides → drivers lock order.
- `setApproval` re-reads the driver's rides after taking the row lock, so it catches an offline driver who still holds an accepted ride (#61 chain A).

There is one gap, M1, which this PR itself introduces. Reassign's pre-flight (the check it makes before committing anything) was not taught about approval. Reassigning to an unapproved driver therefore commits the release, and only then does `forceAssign` refuse. The ride has lost its car and Dina sees an error. The PR body's revocation window also states a best case as a bound (M2).

No Critical or High issue. **Recommendation: approve after M1 and M2**, both small.

## Issues

### Medium

**M1: reassigning a ride to an unapproved driver strands the ride**
- **Where:** `services/api/src/features/dispatch/reassign.service.ts:103-104`.
- **What happens:** the pre-flight checks only that the incoming driver exists. Its own comment (`:98-102`, #120 review M2) says it exists to stop `forceAssign` failing after the release has committed. This PR adds exactly such a late failure: `force-assign.service.ts:71` now throws `driver_not_approved`.
- **Scenario:**
  1. Dina opens the override picker.
  2. An admin rejects driver X.
  3. Dina reassigns ride R from Y to X.
  4. The release commits: R goes back to `requested` and Y is released.
  5. `forceAssign` answers 409, and Dina reads «Šoferis nav apstiprināts — piešķirt nevar» as "nothing happened".
  6. In fact the ride has lost Y, and the cascade will not offer it back to Y.
- **`observed`:** I added a probe to `reassign.service.spec.ts`: `matchAttributes: [{ …, approvalStatus: 'pending' }]` and `forceAssignError: ConflictException('driver_not_approved')`, expecting `events` to equal `[]`. Running `npx jest src/features/dispatch/reassign.service.spec.ts -t 'PROBE M1'` failed with `events` = `tx:begin, unassign, supersede, tx:commit, emit:status, leave:room, forceAssign`. The probe was then reverted (`git status` clean).
- **Why Medium rather than High:** it is a logic error, which the rubric puts at High. The in-code precedent points the other way: #120 M2 rated the same mechanism, a late throw after the release commits, Medium. The ride is not lost either, because it returns to the cascade.
- **Fix:** in the pre-flight, add `if (incoming.approvalStatus !== 'approved') throw new ConflictException('driver_not_approved');`, plus a failure case in `reassign.service.spec.ts` asserting `events` is `[]`, the same shape as the `:334` 404 case. Also add reassign to the PR body's list of places approval is checked. The plan's constraint grep found no conflict: the plan's A.4b table already lists reassign (`:362`).

**M2: "≤ 4 s" is the best case written as a bound**
- **Where:** the PR body (*How a rejected driver finds out*), the report (`:14`) and the plan (`:406`, `:841`).
- **What is wrong:** `MIN_FIX_INTERVAL_MS = 4_000` is a *floor* on the gap between kept fixes (`fix-throttle.ts:42`), and `timeInterval: 4000` is an Android floor (`location-options.ts:19`).
- **The repo's own derivation contradicts it:** `docs/runbooks/driver-device-day.md:271-275` works out that a delivery arriving at 3999 ms is dropped, so the next kept fix lands ~8 s out. It allows 12 s = 3 × 4 s to tolerate one dropped delivery.
- **What "within ≤ 4 s" really is:** the nominal-cadence case, not the worst case. This is the defect class CLAUDE.md names from #87.
- **Downstream use:** the plan's Q3 (`:840`) relies on this window to justify not pushing the revocation to the app. That decision still holds at 8–12 s, because the driver is undispatchable from the moment the reject commits. So this is Medium, not High.
- **L1 below also breaks the path this bound describes.**
- **Fix:** replace the claim in the PR body, the report and the plan with, for example: "~4 s at nominal cadence, `derived`; ~8 s when one delivery lands under the throttle floor, 12 s tolerating one dropped delivery (runbook :271), plus the ack and one `PUT` round trip; assumes the app is producing fixes and the Redis member was cleared (L1)." Retire the subject everywhere, not only the digit: grep `4 s`, `≤ 4`, `finds out`.

### Low

**L1: a reject racing a go-online can leave the rejected driver in the Redis online set** (PLAUSIBLE, read from source, not reproduced)
- **Where:** `drivers.service.ts:203,218` and `admin-drivers.service.ts:94-95`.
- **Interleaving:**
  1. The driver's `setOnlineIfEligible` commits.
  2. The admin's whole `setApproval` runs: it locks the row, finds no active ride, rejects the driver, sets them offline, and calls `markOffline`.
  3. The driver's trailing `markOnline` re-adds the member.
- **Effect:** ingest gates on set membership, so fixes keep being acked and `ack_not_online` never fires. The app shows online, and the board lists the driver: `findBoardContacts` has no approval filter.
- **Why Low:** the driver is still undispatchable, because `candidate-filter` reads Postgres `status` and `approvalStatus`.
- **Not a duplicate of the documented case:** `setApproval`'s docblock (`:75-77`) covers only a failure between the two writes.
- **Fix:** after the go-online `markOnline`, re-read approval and call `markOffline` if the driver is no longer approved. Or document the race next to the existing note.

**L2: `updateVehicle` spreads the patch into the UPDATE**
- **Where:** `services/api/src/features/drivers/admin/admin-drivers.repository.ts:206`.
- **What is wrong:** it uses `.set(patch)`. `vehicles.repository.ts:78-82` says, for this exact reason, "do not replace this with a spread of the patch": `id`/`driverId` are "one `.omit()` away in a different package".
- **Why it matters here:** the admin route is not scoped by owner, so one slip in `adminVehicleUpdateSchema` (`admin-drivers.ts:70-73`) would let a request move any car to another driver.
- **Fix:** an explicit allowlist, the same as the driver repository's, plus `category`.

**L3: the candidate-filter comment gives a reason that cannot happen**
- **Where:** `candidate-filter.ts:32-34`, and the matching wording in `candidate-filter.spec.ts`.
- **What is wrong:** it says `releaseFromRide` returns "a driver revoked mid-ride" to `online`. But `setApproval` refuses to revoke a driver who has an active ride (409 `driver_on_ride`, integration spec `:196`, `:211`).
- **What is right:** the check itself is correct as defence in depth. Only the justification is wrong.
- **Fix:** reword it to, for example, "unreachable today; guards any path that writes `online` without the gate, such as an approval changed by SQL". The plan's GOTCHA at `:349` already words it that way.

### Considered and not raised
- **A rejected driver's pending offer stays `pending`** until it times out (integration spec `:411`). This is documented and deliberate: plan Q3b (`:844`) worked out a worst case of one `offerTimeoutSeconds` and rejected expiring the offer inside the transaction because of lock order.
- **D4's "13 status PUTs"**: I count 14 `PUT /drivers/me/status` calls at the base and 15 at head (13 and 14 of them with a literal status). I cannot tell which count the figure used, and nothing depends on it.

## Validation

`observed`: `record-gate.sh --clean` in a detached worktree at `8456efe`, with `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi`, exit 0.

| Check | Result |
|---|---|
| Full gate (`pnpm turbo run typecheck lint test build --force`) | 23 successful, 23 total · 0 cached · 2m57.0s |
| @taxi/api | 996 passed, 95 suites, 0 skipped (Redis suites ran) |
| @taxi/shared | 317 passed |
| @taxi/dispatch | 303 passed |
| @taxi/driver | 364 passed |
| @taxi/rider | 231 passed |
| @taxi/db | 17 passed |
| CI on the PR | check, codeql, CodeQL, audit-diff, ready all pass |

These match the PR body's gate block on every count; only the wall time differs (2m8.9s there).

## Numbers pass

- **Re-derived and correct:**
  - **Tests:** 996 = 977 + 19, and 19 = 5 + 3 + 11. The admin integration spec has 11 `it`s and the service spec has 3.
  - **Size:** 4,709 = 1,885 + 1,027 + 813 + 984. `.claude/` is 928 + 96 + 3. `test/harness.ts` counts under code, not tests: the tests column is 829 − 16 = 813.
  - **Throttle floor:** `MIN_FIX_INTERVAL_MS = 4_000` is at `fix-throttle.ts:9`.
- **Provenance:**
  - **Gate:** the PR body's gate block is at `8456efe`, and the report's is at `4d4eb5d`. The two trees differ only in `.claude/` (`git diff --stat 4d4eb5d 8456efe`), so both describe the same code.
  - **Mutation table:** labelled `observed` and backed by the report. I did not re-run it. M1's probe is independent evidence that the unit specs pin event order.
- **Wrong:** the ≤ 4 s bound, M2.

### Claim-check comparison

- **Flags confirmed: 0.**
- **Flags rejected: 1.** L74, the "Manual, dev DB" heading: each run under it names its command, its target and its output.
- **Figure findings the check missed: 1.** M2: L29 scored `worst_case ok 0.30` and its citation `supports 0.99`. The citation does support the constant; the error is reading a floor as a bound.

## What is done well

- **The database decides the gate:** approval sits in the go-online `UPDATE`'s WHERE, and the follow-up read only chooses the message.
- **Lock order was checked explicitly:** the accept-path lock moved from first-in-transaction to just before `claimDriver` (plan AMENDMENTS), which avoids a deadlock against force-assign, reassign, complete and cancel.
- **Mutation checks prove each new guard is pinned by exactly one test.**
- **The migration backfills existing drivers to `approved`,** so the deploy knocks nobody offline.
- **Every admin handler has `@Roles('admin')`,** and 401/403 are tested on every route.
- **Shared zod schemas and LV/RU/EN catalog parity** are enforced by `satisfies`.
- **Stripping `category`, not using `.strict()`,** is deliberate and tested, so installed driver apps keep working.

## Recommendation

**Approve after M1 and M2.** M1 is a one-line pre-flight check plus a unit case. M2 is prose in the PR body, report and plan. L1–L3 are optional in the same fix pass. Next step: `piv-fix-review-findings` on this file.
