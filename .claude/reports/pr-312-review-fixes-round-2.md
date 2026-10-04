# PR #312 review fixes, round 2

**Review**: `.claude/code-reviews/pr-312-review-round-2.md` (head `0fb7ce6`, on branch `docs/pr-312-review`) · **Fix commit**: `45713aa` · **Scope**: no direction was given. Both findings are Lows the review calls cheapest to fix in this PR, so both are fixed and none is deferred.

## Fixed

| Finding | Fix | Test | On unfixed code |
|---|---|---|---|
| **L5**, a plate typed during a save is overwritten | `vehicle-editor.tsx`: on success the field is set only when the save carried a plate (`if (parsed.data.plate !== undefined) setPlate(parsed.data.plate)`). The snapshot takes `parsed.data.plate ?? plate`, as before. This is the review's prescribed fix verbatim. | `keeps a plate typed while a category save is in flight (edge)`: the review's own probe, kept as a test. The car PATCH is held open, the category is changed and saved, `XY9999` is typed into the plate field, and then the response is released. The field must still read `XY9999`. | × (`1 failed \| 17 passed (18)`, the plate field reset) |
| **L6**, M1's snapshot update has no test | Tests only. The review prescribed two; I added four, so each of the four lines it names has its own failing case (table below). | `a second save sends only what changed since the first (edge)` (profile); `a category save after a plate save sends the category alone (edge)` (car, the review's first case); `a failed save leaves the change to send again on retry (failure)` (profile, the review's second case); `a failed car save leaves the change to send again on retry (failure)`. | These pin current behaviour, so they pass on the unfixed code. What matters is that they fail under the mutations below. |

### L6 mutation runs

`observed`, 2026-10-04, each with `npx vitest run --root apps/dispatch src/features/admin-drivers/driver-detail.test.tsx` and reverted afterwards.

The review's two mutations, run on the new tests before the L5 fix (18 cases):
- **Both snapshot assignments removed:** `2 failed | 16 passed (18)`. The failures were the car second-save case and the L5 case. The L5 case was already failing at baseline, so this mutation caused 1 new failure.
- **Both `outcome.ok` guards removed:** `3 failed | 15 passed (18)`. The failures were both retry cases and the L5 case. The L5 case was already failing at baseline, so this mutation caused 2 new failures.

The review's runs at `0fb7ce6` gave `14 passed (14)` under both mutations. Both mutations removed a line at each site, though, so they could not show whether each line is pinned on its own. I ran one site at a time after the L5 fix and the added profile case (19 cases):

| Mutation | Result | Failing case |
|---|---|---|
| S1: profile snapshot removed (`if (outcome.ok) { }`) | `1 failed \| 18 passed (19)` | profile second save |
| S2: car snapshot line removed | `1 failed \| 18 passed (19)` | car category-after-plate save |
| S3: profile guard removed (`saved.current = form`) | `1 failed \| 18 passed (19)` | profile failed-save retry |
| S4: car guard removed (`if (true) {`) | `1 failed \| 18 passed (19)` | car failed-save retry |

The review's prescribed pair covers S2 (the car second save) and S3 (the profile failed-save retry). S1 and S4 had no failing test until I added the profile second-save case and the car failed-save retry. That is why L6 has four cases, not two. With the L5 case, this round adds 5.

**Residual, as the review states:** when the save itself carried a plate, a retype during that save is still replaced by the stored plate. This is left as is, as the review advised.

## Deferred

None.

## Needs a manual look

- Level 4 step 8 (VoiceOver on `/admin/drivers`) is still owed by Linards before merge. This round did not change it.

## Validation

`observed`: `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` in `taxi-worktrees/wt-20-ui`, on the tree committed as `45713aa`. Every package's `dist` and dispatch's `.next` were deleted first. Result: exit 0, `Tasks: 23 successful, 23 total`, `Cached: 0 cached, 23 total`, 1m49.3s.
- dispatch `347 passed (347)`, 37 files
- shared 320, db 17, driver 364, rider 231, api 999

dispatch 347 = 342 (round-1 gate) + 5 (this round), `derived`.

## Copies chased

The changed figures are the dispatch total (342 → 347), the new-case count (39 → 44 dispatch, 42 → 47 overall) and the `driver-detail.test.tsx` count (14 → 19).

| `grep -n` | Plan (`admin-approval-config-trips-20.md`) | Implementation report | PR body |
|---|---|---|---|
| `342` | :110, :448: `drivers.integration.spec.ts` line numbers, unrelated | :44, the round-1 gate, kept because it describes that run; a round-2 gate bullet was added above it with 347 | :26, :41 → updated to 347 |
| `\b39\b` | :106, a `roles.guard.ts` line range, unrelated | :28 → 44 | :41 → 44 |
| `42 new` | none | :28 → 47 new (44 dispatch) | none |
| `driver-detail` / `\(14\)` | none | table row → 19, R2 cases listed | :41 → 19 (10 from the two review rounds) |
| size (`2,547`, `1,442`, `937`, `38 files`) | none | none | :13 → re-derived at the new head |

The plan has no PR 2 test totals, so it has nothing to update.
