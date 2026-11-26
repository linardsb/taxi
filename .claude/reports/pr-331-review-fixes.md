# PR #331 review fixes, round 1

Review: `.claude/code-reviews/pr-331-review.md` (approve, 5 Lows). Triage (owner, 2026-11-26): fix all 5 in this PR. Nothing deferred, nothing for manual look beyond the review's own pending Level 4 check and the #320 note.

## Separation of duties

A separate agent wrote the L2, L3 and L4 tests from the review file alone, before any fix, and ran them red against `a9d59e5` + the L1/L5 comment and script edits (which touch no tested code). The builder (this session) then fixed the source.

Deviation: the agent placed the L4 `@ts-expect-error` above `const input: CancelInput = {`; TypeScript reports an excess property on the property's own line, so after the fix the directive was still unused and the real error landed on `actor:`. The builder moved the directive onto `actor: 'system',` without changing the input. Re-proved by mutation (below), so the moved probe is still shown to fail on the unfixed shape.

## Fixed

**L1 — stale hard-delete and platform-wide-plate comments.** Reworded to "retire" and "unique among active cars (0004, partial since 0017)" / "first active vehicle by plate":
`vehicles.service.ts` (plate docblock, `retire` comments ×2), `vehicles.repository.ts` (`PLATE_INDEX` doc), `drivers.repository.ts` (`setOnlineIfEligible` and `setOfflineIfOnline` docblocks), `drivers.service.ts` (L8 comment), `rides.repository.ts` (`assignDriver` docblock and inline SQL comment). The last two files go beyond the review's citations; they were found by the subject sweep. No test (comments only).
Closing sweep, run 2026-11-26T15:47:02Z against the fixed tree:
```
grep -rn -i "platform-wide\|first by plate\|delete of the last\|DELETE of the last\|deleting the vehicle\|deleting their last\|BEFORE the delete\|for the delete path" services/api/src/features/drivers services/api/src/features/rides/rides.repository.ts | grep -v "\.spec\."
→ 0 hits
grep -n "platform-wide\|first by plate" .claude/plans/protected-record-layer-316.md .claude/reports/protected-record-layer-316-report.md <PR body>
→ plan:392 only ("api CLAUDE.md says plates are unique platform-wide — update that line in Task 26"): a historical note about the old CLAUDE.md, true as written; left. Report and PR body: 0 hits.
```
`drivers.repository.ts:69` ("`drivers` has no delete path") kept: still true.

**L2 — cancel note announced "optional" when required.** `cancel-dialog.tsx`: `noteRequired = reasonCode !== '' && reasonNeedsText(reasonCode)`; the label switches to the new key `console.cancel_note_required_label` (LV "Piezīme (obligāta)", EN "Note (required)", RU "Примечание (обязательно)") and the textarea gets `aria-required` when true. No native `required`, so the custom alert and focus move still run.
Tests: `cancel-dialog.test.tsx` — `dispatcher_other` → textbox named "Piezīme (obligāta)" has `aria-required="true"` (red before the fix: "Unable to find an accessible element with the role "textbox" and name "Piezīme (obligāta)""); converse with `dispatcher_rider_request` (guards over-application; green before and after).
Closing: `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/features/override/cancel-dialog.test.tsx` → `Tests 18 passed (18)` (observed, 2026-11-26, fixed tree).

**L3 — `creatorKind` accepted any actor kind.** `consoleActor` moved from `dispatch.controller.ts` to `features/dispatch/console-actor.ts` with a `ConsoleActorKind = 'dispatcher' | 'admin'` type; `BookingsService.book` takes `ConsoleActorKind`; `bookings.controller.ts` uses `consoleActor(user)` and the duplicate `'../../rides'` import is gone.
Test: `bookings.service.spec.ts` — `// @ts-expect-error` on `const kind: Parameters<BookingsService['book']>[3] = 'system';`, the review's `'system'` input. Red before: `bookings.service.spec.ts(310,5): error TS2578: Unused '@ts-expect-error' directive.`
Closing: `pnpm exec tsc --noEmit -p tsconfig.json` in `services/api` → clean (observed, fixed tree).

**L4 — `CancelInput` carried the role twice.** `actor` removed from `CancelInput`. `lifecycleActorFor(kind)` in `ride-lifecycle.policy.ts` (an `as const satisfies Record<RideEventActorKind, LifecycleActor>` map, admin → dispatcher) derives it; `assertCancelReason` and `RideLifecycleService.cancel` use it. The controller's own admin → dispatcher mapping and its doc comment moved to the map. 10 spec call sites in `ride-lifecycle.service.spec.ts` dropped their `actor:` key.
Tests: `ride-lifecycle.policy.spec.ts` — the review's literal `{ actor: 'system', eventActor: 'dispatcher', … }` under `@ts-expect-error`, plus `lifecycleActorFor` for all 5 kinds.
Red before (agent run): `TS2724 … has no exported member named 'lifecycleActorFor'` and `TS2578: Unused '@ts-expect-error' directive`.
Mutation after the directive move (`observed`): re-adding `actor: LifecycleActor;` to `CancelInput` → `ride-lifecycle.policy.spec.ts(70,7): error TS2578: Unused '@ts-expect-error' directive.`; restored → tsc clean.
Closing: `pnpm exec jest src/features/rides/lifecycle src/features/dispatch/bookings/bookings.service.spec.ts` → `Test Suites: 10 passed`, `Tests: 151 passed` (observed, fixed tree).

**L5 — mint script sent the old cancel body.** `mint-tracked-ride.ts:1387` now sends `{ reasonText: 'mint:ride teardown' }`. Checked first that this cannot 400: `rideCancelSchema`'s only refine is `needsText` (a `*_other` code needs text); text with a null code passes, and the api requires a code only for dispatcher/admin, while the script cancels as the rider. No test: the script needs a live stack, not run. Closing: `grep -n "reasonText: 'mint" services/api/scripts/mint-tracked-ride.ts` → `1387` (observed).

## Gate

`observed` — `REDIS_TEST_URL=redis://localhost:6379 COMPOSE_PROJECT_NAME=taxi NODE_OPTIONS=--no-experimental-webstorage pnpm turbo run typecheck lint test build --force` on the fixed working tree (before commit), exit 0, `Tasks: 23 successful, 23 total`.

| Package | Before (`a9d59e5`) | After | Δ, derived |
|---|---|---|---|
| @taxi/api | 96 suites, 1022 | 96 suites, 1029 | +7 = L4 1 type + 5 mapping, L3 1 |
| @taxi/dispatch | 38 files, 365 | 38 files, 367 | +2 = L2 |
| @taxi/shared | 336 | 336 | 0 |
| @taxi/db | 48 | 48 | 0 |
| @taxi/driver | 364 | 364 | 0 |
| @taxi/rider | 231 | 231 | 0 |

api lint: 0 errors, 18 warnings (unchanged count).

## Figures chased

- `wc -l`: `ride-lifecycle.service.ts` 496 → 492, derived from `git diff`: +2 (the `lifecycleActorFor` import, `const actor`) − 6 (prettier joined the 7-line `logRejected(…)` call onto 1 line once `input.actor` became `actor`); `rides.repository.ts` 460 → 461; `rides.service.ts` 497 unchanged.
- `grep -n "1022\|365\|496\|497" <PR body>` → lines 28, 38, 77, 100 (77 is the frozen claim-check log, left as a log). 28, 38, 100 updated in the PR body.
- `grep -n "1022\|365\|496\|cancel-dialog.test.tsx" .claude/reports/protected-record-layer-316-report.md` → 50, 56–61, 79: annotated with the post-fix figures; the `a9d59e5` figures kept, as they are true for that commit.
