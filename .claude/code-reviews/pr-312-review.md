# PR #312 review, round 1: driver review UI at `/admin/drivers` (#20, PR 2 of 4)

**Head** `63b89bd` · **Base** main @ `658d052` · reviewed 2026-09-30 · first round, so the base-moved check does not apply (live `origin/main` = `658d052` = `baseRefOid`)

## Summary

This PR does what it says. An admin logs in, lands on `/admin/drivers`, and can approve or reject a driver in one tap. The admin can also edit the driver's profile, commission override and cars.

The checks behind that:
- Every response is parsed with the shared schema.
- A 401 or 403 clears the session and sends the admin to `/login`.
- The `/admin` layout's role gate covers `/admin/drivers`.
- Every api error code the UI handles (`driver_on_ride`, `driver_not_found`, `vehicle_not_found`, `plate_taken`) matches what the api actually sends and has an LV/RU/EN string.
- The gate is green and every figure in the PR body reproduces.

There are no Critical or High findings. Three Mediums are worth fixing before merge:
- **M1:** every save sends every field, not only the ones the admin changed. It can write an old plate back over a newer one, and it turns a driver's unanswered female-driver flag into "no".
- **M2:** the admin plate field only trims spaces from the ends. A plate typed with a space in the middle skips the duplicate check, so two cars can end up with the same plate.
- **M3:** after an approval change on the detail page, keyboard focus is lost.

VoiceOver (Level 4 step 8) has not been run and is still owed before merge, as the PR says.

## Findings

### Medium

**M1 · every save sends every field and can undo newer changes**
- **Where:** `apps/dispatch/src/features/admin-drivers/profile-form.tsx:57-66`, `vehicle-editor.tsx:59-67`
- **Problem:** Only `displayName` is compared with the loaded value. `spokenLanguages`, `isFemale` and `commissionPctOverride` go on every profile save, and all seven vehicle fields go on every vehicle save. The api only writes the keys that are present (`admin-drivers.repository.ts:120` writes `isFemale` only when it is defined), so sending less is safe.
- **What goes wrong:**
  1. **The female-driver flag is overwritten.**
     - `drivers.is_female` can be null ("never answered", `db/src/schema/drivers.ts:29`), and `isFemale` is optional in the shared schema (`packages/shared/src/schemas/driver.ts:26`).
     - Null is common, not only a leftover case. The driver app sends `isFemale` only when the driver ticks the box (`apps/driver/src/features/onboarding/profile-screen.tsx:56`), so every driver who leaves it unticked stays null.
     - The admin form shows null as unchecked (`profile-form.tsx:47`) and always sends that value.
     - So an admin who only fixes a driver's name also records "not a female driver" for someone who never answered.
     - `observed`: a scratch test in the PR's own suite did a name-only save of the `detail()` fixture, which has no `isFemale`. The PATCH body was `{"spokenLanguages":["lv"],"isFemale":false,"displayName":"Jānis Bērziņš","commissionPctOverride":12}`. The probe was deleted afterwards.
  2. **A newer plate is overwritten.**
     - The vehicle editor fills its fields once, from the car as it was when the page loaded (`useState(vehicle.plate)`, and so on).
     - If the driver changes their plate in the app after that, and the admin then saves only a new `category`, the old plate goes back to the api.
     - That plate is the one a rider checks at the kerb.
  3. **`ProfileForm` keeps old values after a reload.** It has no `key` (`driver-detail.tsx:140`), so it keeps its first values after the reload that follows a vehicle delete.
- **Why Medium, not High:** dispatch reads the flag only as `a.isFemale !== true` (`candidate-filter.ts:44`), so null and false dispatch the same way today. The data loses its "never answered" meaning, but no ride goes to the wrong driver. The plate overwrite needs a driver edit and an admin edit on the same car close together.
- **Fix:**
  - Take a snapshot of the values when the form is filled, and send only the fields whose form value differs from that snapshot. In other words, only what the admin actually changed.
  - Do not compare against the current `detail`/`vehicle` prop. Because the forms keep their first values (point 3), a newer server value would then count as "changed" and the old form value would go out anyway.
  - The driver app already does this for the same fields (`profile-screen.tsx:56`).
  - If nothing differs, show «Saglabāts» without calling the api. The shared schemas' `refine(nonEmpty)` rejects an empty body anyway.
  - Update the body assertion in the edge test at `driver-detail.test.tsx:63`.
  - Add one case: a name-only save of a driver with `isFemale` undefined sends no `isFemale`.

**M2 · the admin plate edit skips the clean-up the driver app does, so a duplicate plate gets through**
- **Where:** `vehicle-editor.tsx:60` (`plate: plate.trim()`)
- **Problem:** The driver app saves `plate.replace(/\s+/g, '').toUpperCase()` (`apps/driver/src/features/onboarding/vehicle-screen.tsx:67`). Neither the api nor `vehicleSchema.plate` (`z.string().min(2).max(10)`, `packages/shared/src/schemas/vehicle.ts:7`) cleans it up. The unique index is on `upper(plate)` (`db/src/schema/vehicles.ts:36`), so it ignores case differences but not spaces.
- **What goes wrong:**
  - A driver registered `AB1234`. An admin types `AB 1234` on another car.
  - The index sees two different values, so no `plate_taken` comes back and two cars now carry what riders read as the same plate. The index's own comment says that must never happen.
  - A plate typed in lowercase is also stored, and shown, in lowercase.
  - No server-side clean-up: grep across `services/api/src` and `packages/shared/src` found none.
  - `observed`: a scratch test typed `ab 1234` into the fixture car's plate and saved. The PATCH body carried `"plate":"ab 1234"`, along with every other field, which also shows M1's vehicle half. The probe was deleted afterwards.
- **Fix:** Apply the driver app's clean-up in the editor. The better fix is one shared function (or a zod `transform` on the plate) in `packages/shared` that both apps call, because a rule two surfaces must share belongs there. That extends the PR into shared plus a one-line driver-app change. If that is out of scope for "web code only", fix the editor alone and log the shared helper in the report.

**M3 · keyboard focus is lost after an approval change on the detail page**
- **Where:** `driver-detail.tsx:89-92, 113-125`
- **Problem:** The approval buttons are listed as `DRIVER_APPROVAL_STATUSES.filter((s) => s !== detail.approvalStatus)`, one button per status. After a successful Approve, `approvalStatus` becomes `approved`, so the button that has focus is removed from the page. `decide` does not move focus anywhere else.
- **What goes wrong:** Focus falls back to `<body>`, so a keyboard or screen-reader user starts again from the top of the page. This is the WCAG 2.4.3 failure (focus order) that report deviation 11 fixed for the list and for vehicle delete. This path was missed.
- **Tests:** The only approval test (`driver-detail.test.tsx:129`) does not check focus.
- `observed`: a scratch test focused «Apstiprināt», clicked it, and waited for the heading to change. Afterwards `document.activeElement` was `BODY` and the button's `isConnected` was `false`. The probe was deleted afterwards.
- **Fix:** On `outcome.ok`, focus the `approval-heading` h2 (give it `tabIndex={-1}`) or the h1, and assert `document.activeElement` in that test.

### Low

**L1 · a bad `?id=` shows a generic error that Retry can never fix**
- **Where:** `drivers-screen.tsx:20-25`
- **Problem:** The page passes the raw `id` from the URL to the api. For a string that is not a UUID, the api's pipe answers 400 `validation_failed` (`services/api/src/common/zod-validation.pipe.ts:18`). The catalogs have no `admin.error.validation_failed`, so `adminErrorKey` falls back to the generic message.
- **What goes wrong:** On a truncated link the admin sees «Kaut kas nogāja greizi» (something went wrong) with a Retry button that can never work.
- **Fix:** Check `uuidSchema` (or the shared id schema) in `DriversScreen` and show `driver_not_found` without calling the api.

**L2 · the reload-after-delete comment claims something the page doesn't do**
- **Where:** `use-drivers.ts:208-209`
- **Problem:** The comment says the page reloads after a delete "and the detail shows that status" (online to offline). `DriverDetail` never shows `detail.status`, only `approvalStatus`, so the offline change is not visible.
- **Fix:** Reword the comment to give the reason that holds: the deleted car's editor has to go, and the server may have changed other rows. Or show the online status on the page.

**L3 · a test title claims a case it doesn't check**
- **Where:** `admin-shell/admin-api.test.ts:146`
- **Problem:** The title says "…or a prototype name", but the body tests only an unknown code, a `TypeError` and an undefined code.
- **Fix:** Add `new AdminApiError('constructor')` expecting generic, or drop the phrase from the title.

**L4 · the report points at a gate commit that isn't in the branch**
- **Where:** `.claude/reports/admin-drivers-ui-20-report.md` §Validation
- **Problem:** It says the gate was observed at `de85235`, "the squashed commit; later commits touch only `.claude/`". The branch was squashed again, so `de85235` is not an ancestor of `63b89bd` and there are no later commits. `git merge-base --is-ancestor` exits 1. `git diff --stat de85235 63b89bd` shows only the plan and report changing, so the result still holds, but after merge the pointer leads nowhere.
- **Fix:** Cite `63b89bd`, the gate the PR body quotes, which this review re-ran.

### Considered and rejected

- **`adminFetchBlob` and the `admin.nav.config` / `admin.nav.trips` keys have no caller yet.** Rejected. Plan A0.6 (`:277`) asks for `adminFetchBlob` in this slice for PR 4's CSV download (`:680`). The nav keys were planned in PR 1's catalog task (`:268`), and report deviation 2 explains why they are unused.

## Validation

`observed`: `pnpm turbo run typecheck lint test build --force` at `63b89bd` with `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi`. Build output (`dist` in every package and `.next` in dispatch) was deleted first. Result: exit 0, `Tasks: 23 successful, 23 total`, `Cached: 0 cached, 23 total`, 2m11s.

| Package | Result |
|---|---|
| @taxi/dispatch | 37 files, 337 passed |
| @taxi/api | 95 suites, 999 passed |
| @taxi/shared | 31 files, 317 passed |
| @taxi/db | 3 files, 17 passed |
| @taxi/driver | 46 suites, 364 passed |
| @taxi/rider | 37 suites, 231 passed |

CI on the head: `check`, `audit-diff`, `codeql` and `CodeQL` all pass, and `ready` flipped the PR out of draft.

### Numbers pass

Every figure in the PR body was re-derived:
- **Size:** `git diff --shortstat 658d052..63b89bd` prints 34 files, +2308 / −27.
- **Size by bucket:** the per-bucket numstat sums reproduce exactly: src 1384/23, tests 821/0, `.claude` 97/1, shared 6/3.
- **New dispatch tests:** 34 = 10 + 3 + 1 + 8 + 9 + 3, counted with `it(` grep per file. `login-form.test.tsx` has 7 now against 6 at base.
- **Dispatch baseline of 303:** `observed` in #309's body and in both #309 review rounds. `git diff --name-only 4d4eb5d 658d052 -- apps/dispatch` is empty, so 303 still holds as the base.
- **Test counts:** api 999 and dispatch 337 match this review's gate.

### Claim-check comparison

The PR body's claim check flagged 0. I confirmed 0 flags and rejected 0. It missed 0 of my figure findings in the PR body. The one stale figure reference (L4) is in the implementation report, which the check does not read.

### Constraint pass

`grep -in "do not modify|do not edit|read-only|no changes to|frozen"` on the plan returns one hit, at `:161`, about the trips list. No fix above touches a frozen file.

## What's good

- **Loading state is worked out, not set.** It comes from the result's `filter`/`id`/`nonce`, so there is no flicker and no stale spinner on refresh.
- **Concurrent writes are handled.** `busy` plus the `inFlight` ref allow one write at a time. A reload that started before a later action is thrown away through `live=false` when `nonce` changes, so a removed row can't come back from an older reload.
- **The screen-reader work goes beyond the plan.** Repeated row buttons are described by the driver's name, and a test pins it. Each detail form is named. Focus moves to the H1 when a row or a car disappears. Step 4 checked real Tab order in a browser.
- **Commission `null` and `0` are kept apart.** The explicit «platform base» box separates "use the platform rate" from "0 %", both are tested, and an empty field is refused rather than read as 0.
- **Deviations are documented.** The report and the plan AMENDMENTS give PRs 3 and 4 what they need, including the single-router mock rule.

## Recommendation

**Approve.** There is no Critical or High, the gate is green, and the PR matches its intent. M1–M3 are recommended, not blocking. Each is small and local, so this PR is the cheapest place to fix them:
- M1: send only the fields the admin changed, compared with a snapshot taken when the form loaded.
- M2: one line in the editor, or a shared helper.
- M3: one focus call and one assertion.

VoiceOver step 8 is still owed by Linards before merge.
