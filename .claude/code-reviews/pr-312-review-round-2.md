# PR #312 review, round 2: driver review UI at `/admin/drivers` (#20, PR 2 of 4)

**Head** `0fb7ce6` · **Base** main @ `658d052` · reviewed 2026-10-04 · round 1 at `63b89bd` (`pr-312-review.md`). The base has not moved: live `origin/main` = `658d052` = round 1's recorded base, so the guarantees pass does not apply.

## Summary

Every round-1 finding (M1–M3, L1–L4) is fixed in `d54476e`. Each fix does what it says, and the gate is green at the head. This round asked what each fix's mechanism newly permits. It found two Lows and nothing above that:
- **L5:** after any successful car save, the plate field is reset to the plate as it was when Save was clicked. A plate typed while the save was in flight is lost.
- **L6:** the two lines that make M1 work after the first save are not covered by any test. Removing either one leaves the suite green (`observed`, below).

VoiceOver (Level 4 step 8) is still owed by Linards before merge, as the PR says.

## Findings

### Low

**L5 · a plate typed during a save is overwritten when the save returns**
- **Where:** `apps/dispatch/src/features/admin-drivers/vehicle-editor.tsx:87-91`
- **Problem:** On success the editor runs `setPlate(parsed.data.plate ?? plate)`, even when the save sent no plate. `plate` is the value from the render in which Save was clicked. The inputs stay editable during the request; only the buttons take `disabled={busy}` (`:172`, `:177`, `:202`).
- **What goes wrong:** the admin changes the category, clicks Save, and starts retyping the plate before the response arrives. The response resets the field to the old plate, and the new text is gone. The other fields keep a mid-save edit, which then goes out on the next save.
- **Evidence:** `observed` with a scratch test that held the car PATCH open. The test changed the category, submitted, typed `XY9999` into the plate field, then released the response. Afterwards the plate field read `AB-1234`. The probe was deleted afterwards.
- **Fix:** reset the field only when the save carried a plate:
  ```ts
  if (parsed.data.plate !== undefined) setPlate(parsed.data.plate);
  saved.current = { ...form, plate: parsed.data.plate ?? plate };
  ```
  `observed`: with this change applied, the same probe reads `XY9999`, and `driver-detail.test.tsx` stays green (15 passed, with the probe). The change was reverted afterwards.
  - The fix leaves one narrower case: when the save itself carried a plate, a retype during that save is still replaced by the stored plate.
  - Fixing that needs a check against the live field value, which is more than this Low is worth.

**L6 · M1's snapshot update has no test**
- **Where:** `profile-form.tsx:94` (`if (outcome.ok) saved.current = form`), `vehicle-editor.tsx:87-92`
- **Problem:** `driver-detail.test.tsx` never saves the same form twice and never makes a profile or car PATCH fail. So the two things that keep M1 correct after the first save are unpinned:
  - The snapshot moving forward after a success. Without it, a later category-only save writes the plate back, which is the M1 hazard again.
  - The `outcome.ok` guard. Without it, a failed save still moves the snapshot, and the retry sends nothing while showing «Saglabāts». The admin's change is silently lost.
- **Evidence:** `observed`, each mutation run with `npx vitest run --root apps/dispatch src/features/admin-drivers/driver-detail.test.tsx` and then reverted with `git checkout`:
  - Both snapshot assignments removed: `Tests  14 passed (14)`.
  - Both `outcome.ok` guards removed, so the snapshot moves on failure too: `Tests  14 passed (14)`.
- The fixes report describes the failure-path behaviour as reasoning. These runs show that no test checks it.
- **Fix:** add two cases to `driver-detail.test.tsx`:
  - A plate save followed by a category save. The second body is exactly `{ category: 'limo' }`.
  - A name save that fails (500), then a retry. A second PATCH is sent and carries `displayName`.

### Checked and clean (fix-mechanism pass)

Round 1 had no Critical or High, so this pass is not required. It was run on every fix anyway, because M1 changes what reaches the api.
- **M1, change detection:** I found no case where a real change goes unsent or a stale value is sent.
  - The snapshot is taken from the click-time render, which holds exactly the values the patch was built from.
  - A reload does not reset either form. A different driver unmounts `ProfileForm` through the loading branch, and each `VehicleEditor` is keyed by `vehicle.id`.
  - Languages are compared as a set.
  - A `'12'` → `'12,0'` commission edit, a whitespace-only year edit or a plate case change re-sends the same value. That is harmless.
  - By design, a never-answered (`null`) female flag cannot be stored as an explicit `false`.
- **M2, `normalizePlate`:** both driver-app write paths (create and update) go through `validate()` at `apps/driver/src/features/onboarding/vehicle-screen.tsx:68`, and the admin editor calls it too.
  - The api still normalizes nothing (`vehicles.repository.ts:92`, `admin-drivers.repository.ts:213` write `patch.plate` as received).
  - So the docblock's "every surface stores it" holds because every client calls the function, not because the server enforces it. Round 1 offered a zod `transform` as the stronger option. The client-only fix it chose is the one round 1 allowed.
- **M3, focus after an approval change:** `moveTo` replaces the detail without going back to the loading state, so the approval `h2` is the same element before and after, and the saved ref stays attached.
  - The effect also depends on `approvalFeedback`, so it runs after `focusOnRender` is set, whatever React batches.
  - On failure nothing is queued, and focus stays on the button, which still exists.
- **L1, uuid check in `getDriver`:** the client check and the api's `driverIdSchema` (`admin-drivers.controller.ts:27`) are the same `z.string().uuid()` on the same zod. `observed`: `require('zod/package.json').version` is `3.25.76` from both `apps/dispatch` and `services/api`.
  - So the client cannot refuse an id that the api accepts.
  - The seed ids are RFC-shaped (`…-4000-8000-…`) in any case.

## Validation

`observed`: `pnpm turbo run typecheck lint test build --force` at `0fb7ce6`, run in `taxi-worktrees/wt-20-ui` with `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi`. Every package's `dist` and dispatch's `.next` were deleted first. Result: exit 0, `Tasks: 23 successful, 23 total`, `Cached: 0 cached, 23 total`, 1m51.9s.

| Package | Result |
|---|---|
| @taxi/dispatch | 37 files, 342 passed |
| @taxi/api | 95 suites, 999 passed |
| @taxi/shared | 31 files, 320 passed |
| @taxi/db | 3 files, 17 passed |
| @taxi/driver | 46 suites, 364 passed |
| @taxi/rider | 37 suites, 231 passed |

CI on the head: `check`, `audit-diff`, `codeql` and `CodeQL` all pass, and `ready` passed.

### Numbers pass

Every figure the round-1 fixes added to the PR body was re-derived at `0fb7ce6`:
- **Size:** `git diff --shortstat 658d052..0fb7ce6` → 38 files, +2547 / −28. ✓
- **Buckets:** numstat summed per path class → dispatch source 1442/23, tests 937/0, `.claude` + `apps/dispatch/CLAUDE.md` 151/1, shared 15/3, driver 2/1. ✓ All five match the body.
- **Round-1 diff:** `git diff --shortstat 63b89bd..0fb7ce6` → 14 files, +292 / −54. ✓
- **dispatch 342 = 303 + 39:** `it(` count per file → 10 + 3 + 1 + 8 + 14 + 3 = 39. ✓ The 342 matches this round's gate.
- **shared 320 = 317 + 3:** the 3 `normalizePlate` cases are in the diff. ✓ The 320 matches this round's gate.
- **Unfixed-code run:** `8 failed | 6 passed (14)` is the fixes report's own run. It was not re-run here. Its breakdown (5 new cases + 3 tightened assertions = 8) agrees with the test diff.

The PR body labels its gate as run at `d54476e` and says `0fb7ce6` changes only `.claude/`. `git diff --stat d54476e 0fb7ce6` agrees, and this round's gate at `0fb7ce6` reproduces every count.

### Claim-check comparison

The body's claim-check block ran on the pre-review body at `63b89bd`, and the body says it was not re-run. It flagged 0. I confirmed 0 flags and rejected 0, and it missed 0 of my figure findings, since I have none against the body. No signal on the round-1 figures, because the check never saw them.

### Constraint pass

The plan's only frozen-file hit (`:161`, the trips list) is untouched by either fix above.

## What's good

- Comparing each save against a snapshot of the form, rather than against the props, is the right design. Round 1 asked for it, and the implementation carries the reason in a comment at both sites.
- Every behaviour fix shipped with a test that the fixes report shows failing on the unfixed source. The L3 note admits that one of them was a title fix, not a bug.
- The copies of retired figures were chased into the plan, the report and the PR body, and the table in the fixes report shows it.

## Recommendation

**Approve.** There is no Critical, High or Medium, and the gate is green. L5 is a two-line change and L6 is two test cases. Both are cheapest to fix in this PR, but neither blocks it. VoiceOver step 8 is still owed by Linards before merge.
