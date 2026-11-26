# PR #331 review: protected record layer (#316)

**Head** `a9d59e5` · **Base** main @ `b8909290ae2c93660fd0bfa127c188a5eeb064e1` · round 1 (no prior report, so the guarantees and fix-mechanism passes do not apply; live `origin/main` = `b890929`, unchanged)

## Verdict: approve, with 5 Lows

Critical 0 · High 0 · Medium 0 · Low 5. The gate is green with the Redis-gated suites on, every figure in the PR body re-observed, and no runtime path, test teardown or script reaches a `protected_record:` refusal.

## Validation

`observed`: `REDIS_TEST_URL=redis://localhost:6379 COMPOSE_PROJECT_NAME=taxi NODE_OPTIONS=--no-experimental-webstorage pnpm turbo run typecheck lint test build --force` at `a9d59e5`, exit 0.

| Package | Result |
|---|---|
| turbo | 23 successful, 23 total, 0 cached |
| @taxi/api | 96 suites, 1022 tests passed; lint 0 errors, 18 warnings |
| @taxi/db | 4 files, 48 tests passed |
| @taxi/shared | 32 files, 336 tests passed |
| @taxi/dispatch | 38 files, 365 tests passed |
| @taxi/driver | 46 suites, 364 tests passed |
| @taxi/rider | 37 suites, 231 tests passed |

CI: `check`, `audit-diff`, `codeql`, `CodeQL`, `ready` all pass.

## Findings

**L1 (docs) — comments still describe hard delete and a platform-wide plate index.** Root CLAUDE.md asks that a retired claim be retired by its subject.
- `services/api/src/features/drivers/vehicles.service.ts:34` — "The plate is unique platform-wide (migration 0004 …)". It is now unique among active cars (0017 made it partial); `services/api/CLAUDE.md` already says so.
- `vehicles.service.ts:85` ("deleting their last car"), `:102` ("read BEFORE the delete").
- `services/api/src/features/drivers/vehicles.repository.ts:11` — "The index from migration 0004".
- `services/api/src/features/drivers/drivers.repository.ts:275-280` — "the delete path … deleting the vehicle".
- Reviewer-reported, not re-read: `rides.repository.ts:322-326, :343-346` describe the stamp as "first by plate" without "active".

Risk: a reader trusting "platform-wide" writes an `onConflict` on `upper(plate)`, which a partial index cannot serve. Fix: reword to retire / "unique among active cars (0004, partial since 0017)" / "first active car by plate".

**L2 (a11y) — the note field announces "optional" when it is required.** `apps/dispatch/src/features/override/cancel-dialog.tsx:169-191`: the label is `console.cancel_reason` ("Note (optional)"), and the textarea has no `required`/`aria-required`. With `dispatcher_other` picked, VoiceOver still reads "Note (optional)"; submit then raises the alert and moves focus, so the user can recover, but the field describes itself wrongly. Fix: `aria-required` when `reasonNeedsText(reasonCode)`, and a "Note (required)" label key in that case. (The select at `:139-140` is correct.)

**L3 (type safety) — `creatorKind` accepts any actor kind on the phone-booking path.** `services/api/src/features/dispatch/bookings/bookings.service.ts:45` is typed `RideEventActorKind`; force-assign and reassign narrow to `'dispatcher' | 'admin'`. Passing `'system'` with a dispatcher id compiles and then 500s on `ride_events_actor_id_ck` inside the create transaction. Fix: narrow the type. Nit: `bookings.controller.ts:11-12` imports `'../../rides'` twice.

**L4 (design) — `CancelInput` carries the role twice.** `services/api/src/features/rides/lifecycle/ride-lifecycle.policy.ts:47-57`: `actor` and `eventActor` are set independently. A future system-cancel caller could pass `actor: 'system'`, `eventActor: 'dispatcher'`, recording a system cancel as a dispatcher act and demanding a dispatcher reason code. Fix: derive `actor` from `eventActor` (admin → dispatcher), or assert the pairing. No current caller is wrong.

**L5 (stale caller) — the mint script sends the old cancel body.** `services/api/scripts/mint-tracked-ride.ts:1387` posts `{ reason: 'mint:ride teardown' }`. Zod strips `reason`; the rider cancel still returns 201, so nothing breaks, but the note is dropped. Fix: `{ reasonText: 'mint:ride teardown' }`.

All five were confirmed by reading the cited lines, except the `rides.repository.ts` lines in L1.

## Numbers pass

- Gate counts in the PR body: all 6 per-package figures and 23/23 tasks re-observed exactly by this review's gate run.
- Test-case counts in the report: `reasons.test.ts` 17, `ride-events.integration.spec.ts` 19, `cancel-dialog.test.tsx` 16, `dialog-shell.test.tsx` 5, `use-assign.test.tsx` +4. All match `grep` counts.
- Mutation split: 10 red + 9 green = 19, matches the spec's 19 cases; the 9 green cases listed (2 created + 1 assigned + 1 released + lost race + rollback + 3 refusals) sum to 9. db: 3 red + 45 green = 48, matches.
- "Still hold at HEAD": `git diff --stat e14418a..a9d59e5` touches 2 files (the report and `status-screen.test.tsx`), as stated.
- File sizes: `wc -l` 496 and 497, as stated.
- Lint "17 baseline + 1": the 18 total re-observed; the baseline split was not re-derived.
- Task 18 (4 of 29 red at base) was not re-run. It is labelled `observed` with its run named, and nothing downstream depends on it.

No figure is mislabelled.

### Claim-check comparison
Confirmed 0 · rejected 0 · figure findings it missed 0 (it flagged none, and this pass found none).

## Constraint pass

The plan's only "frozen" hits (`:422`, `:833`) describe the offer guard's design, not a file restriction. None of the fixes above touch it.

## What is done well

- `actor` is a required argument on `transitionInTx`, `assignDriver` and `unassignDriver`, so a writer that skips the event fails to compile. The event is inserted only after the matched UPDATE, in the same transaction.
- The offer guard compares `to_jsonb(row)` minus the three mutable keys, so a column added later is frozen without editing the trigger. Every production offer write (accept, decline, expire, revoke, supersede) matches an allowed move.
- Test teardown uses `DROP DATABASE … WITH (FORCE)`, so the TRUNCATE guards cost nothing in tests.
- Every "current cars" read filters `retired_at IS NULL`; the past-ride plate read in `notifications.repository.ts` does not.
- The decline reason text stays off the wire and out of logs; only the code and `hasReason` are logged.
- The report documents its deviations, including the partial separation of duties (deviation 10), which tells a reviewer which tests to read more closely.

## Recommendation

Approve. The Lows can be fixed in this PR via `piv-fix-review-findings` or folded into a follow-up. Level 4 manual check is still pending, and the #320 note (deviation 15) is still unposted.
